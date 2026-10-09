namespace Pulse.WebApi.Tests.Features.Social.Moderation;

using System;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Social.Moderation;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Xunit;

/// <summary>
/// Behaviour of <c>DELETE /api/staff/posts/{postId}</c> for an authorized controller (demo-polish B6, story 09
/// ACs "Soft delete", "Idempotent" and the broadcast half of "Live removal"; XC-010, COR-053, DP-9). Real
/// <c>Program</c> pipeline, real SQL, real session tokens. Only the <c>IFeedBroadcaster</c> is a recording double.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class TakedownEndpointTests
{
    private static readonly DateTimeOffset ClockStart = new(2033, 9, 4, 14, 0, 0, TimeSpan.Zero);

    private readonly ModerationSeeder _seed;

    public TakedownEndpointTests(MsSqlContainerFixture fixture) => _seed = new ModerationSeeder(fixture);

    [RequiresDockerFact]
    public async Task TakeDown_LivePost_Returns204_StampsDeletedAtFromTheExerciseClock_AndKeepsTheRowAndItsMedia()
    {
        var exercise = await _seed.SeedExerciseAsync(currentScenarioTime: new DateTimeOffset(2033, 1, 1, 0, 0, 0, TimeSpan.Zero));
        var postId = await _seed.SeedPostAsync(exercise.Id, withMedia: true);
        var before = await _seed.ReadSurvivingPostAsync(postId);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        using var factory = new ModerationWebApplicationFactory(_seed.ConnectionString);
        var expected = StartFrozenClock(factory, exercise.Id);
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await client.DeleteAsync(new Uri($"/api/staff/posts/{postId}", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await response.Content.ReadAsByteArrayAsync()).Should().BeEmpty("204 carries no body");

        var after = await _seed.ReadSurvivingPostAsync(postId);
        after.DeletedAt.Should().Be(
            expected,
            "DeletedAt is the exercise clock's SCENARIO time (COR-053); the running clock wins over the stored fallback");
        after.DeletedAt!.Value.Offset.Should().Be(expected.Offset);
        after.Should().BeEquivalentTo(
            before,
            options => options.Excluding(p => p.DeletedAt),
            "only DeletedAt changes; body, author, provenance and scenario time stay for the staff record");
        (await _seed.CountMediaAsync(postId)).Should().Be(
            (1, 1), "the post's PostMediaItem and its MediaAsset (and so its blob) all remain");
    }

    [RequiresDockerFact]
    public async Task TakeDown_ClockNotRunning_StampsTheExercisesStoredScenarioTime()
    {
        var stored = new DateTimeOffset(2033, 9, 4, 15, 30, 0, TimeSpan.FromHours(-5));
        var exercise = await _seed.SeedExerciseAsync(currentScenarioTime: stored);
        var postId = await _seed.SeedPostAsync(exercise.Id);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        using var factory = new ModerationWebApplicationFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await client.DeleteAsync(new Uri($"/api/staff/posts/{postId}", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await _seed.ReadSurvivingPostAsync(postId)).DeletedAt.Should().Be(
            stored, "with no running clock, the exercise's stored scenario time is the next source (FollowService pattern)");
    }

    [RequiresDockerFact]
    public async Task TakeDown_NoClockAndNoStoredScenarioTime_StampsThePostsOwnScenarioTime_NeverTheWallClock()
    {
        var exercise = await _seed.SeedExerciseAsync(currentScenarioTime: null);
        var postId = await _seed.SeedPostAsync(exercise.Id);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        using var factory = new ModerationWebApplicationFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await client.DeleteAsync(new Uri($"/api/staff/posts/{postId}", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await _seed.ReadSurvivingPostAsync(postId)).DeletedAt.Should().Be(
            ModerationSeeder.PostCreatedAt,
            "with no scenario clock at all, the last fallback is the post's own scenario time; the wall clock "
            + "(2026 here) is never stamped (COR-053)");
    }

    [RequiresDockerFact]
    public async Task TakeDown_Repeated_Returns204_DoesNotMoveDeletedAt_AndBroadcastsOnlyOnce()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var postId = await _seed.SeedPostAsync(exercise.Id);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        using var factory = new ModerationWebApplicationFactory(_seed.ConnectionString);
        var firstStamp = StartFrozenClock(factory, exercise.Id);
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var first = await client.DeleteAsync(new Uri($"/api/staff/posts/{postId}", UriKind.Relative));

        // Move scenario time on, so a second stamp would be visible if it happened.
        factory.Services.GetRequiredService<IExerciseClock>().Jump(exercise.Id, 45);

        var second = await client.DeleteAsync(new Uri($"/api/staff/posts/{postId}?category=pii", UriKind.Relative));

        first.StatusCode.Should().Be(HttpStatusCode.NoContent);
        second.StatusCode.Should().Be(HttpStatusCode.NoContent, "repeating a takedown is idempotent");
        (await _seed.ReadSurvivingPostAsync(postId)).DeletedAt.Should().Be(
            firstStamp, "the repeat must not move DeletedAt, even though scenario time has advanced");
        factory.Broadcaster.Removed.Should().ContainSingle(
            "only the call that actually took the post down broadcasts PostRemoved").Which.Should().Be((exercise.Id, postId));
    }

    [RequiresDockerFact]
    public async Task TakeDown_PostAlreadySoftDeleted_Returns204_AndBroadcastsNothing()
    {
        var earlier = new DateTimeOffset(2033, 9, 4, 13, 20, 0, TimeSpan.Zero);
        var exercise = await _seed.SeedExerciseAsync();
        var postId = await _seed.SeedPostAsync(exercise.Id, deletedAt: earlier);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        using var factory = new ModerationWebApplicationFactory(_seed.ConnectionString);
        StartFrozenClock(factory, exercise.Id);
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await client.DeleteAsync(new Uri($"/api/staff/posts/{postId}", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await _seed.ReadSurvivingPostAsync(postId)).DeletedAt.Should().Be(earlier, "an existing takedown instant is never moved");
        factory.Broadcaster.Removed.Should().BeEmpty("the post was already gone from every feed");
    }

    [RequiresDockerTheory]
    [InlineData(null)]
    [InlineData("inappropriate")]
    [InlineData("pii")]
    [InlineData("real-world-reference")]
    [InlineData("other")]
    public async Task TakeDown_WithAValidOrAbsentCategory_Returns204(string? category)
    {
        var exercise = await _seed.SeedExerciseAsync();
        var postId = await _seed.SeedPostAsync(exercise.Id);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        using var factory = new ModerationWebApplicationFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var query = category is null ? string.Empty : $"?category={category}";
        var response = await client.DeleteAsync(new Uri($"/api/staff/posts/{postId}{query}", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.NoContent, $"'{category ?? "(absent, defaults to other)"}' is in the vocabulary");
        (await _seed.ReadSurvivingPostAsync(postId)).DeletedAt.Should().NotBeNull();
    }

    [RequiresDockerTheory]
    [InlineData("spam")]
    [InlineData("PII")]
    [InlineData("Other")]
    [InlineData("real_world_reference")]
    [InlineData("other,pii")]
    public async Task TakeDown_WithACategoryOutsideTheVocabulary_Returns400_AndChangesNothing(string category)
    {
        var exercise = await _seed.SeedExerciseAsync();
        var postId = await _seed.SeedPostAsync(exercise.Id);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        using var factory = new ModerationWebApplicationFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await client.DeleteAsync(
            new Uri($"/api/staff/posts/{postId}?category={Uri.EscapeDataString(category)}", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "anything outside inappropriate|pii|real-world-reference|other is a 400");
        (await _seed.ReadSurvivingPostAsync(postId)).DeletedAt.Should().BeNull("a rejected request never takes the post down");
        factory.Broadcaster.Removed.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task TakeDown_RunningClockEarlierThanThePost_StampsTheClocksTime_Unclamped()
    {
        // B3 Gate-1 M-1 (applied to B6): a running clock is authoritative. A post's CreatedScenarioTime can still
        // come from the client this phase, so a post stamped ahead of the clock must not drag DeletedAt forward.
        // The stored time is later than both, so this also shows the clock wins over the fallback.
        var exercise = await _seed.SeedExerciseAsync(currentScenarioTime: ModerationSeeder.PostCreatedAt.AddDays(1));
        var postId = await _seed.SeedPostAsync(exercise.Id);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        using var factory = new ModerationWebApplicationFactory(_seed.ConnectionString);
        var clockTime = StartFrozenClock(factory, exercise.Id, start: ModerationSeeder.PostCreatedAt.AddHours(-3));
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await client.DeleteAsync(new Uri($"/api/staff/posts/{postId}", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        clockTime.Should().BeBefore(ModerationSeeder.PostCreatedAt, "precondition: the running clock is behind the post");
        (await _seed.ReadSurvivingPostAsync(postId)).DeletedAt.Should().Be(
            clockTime, "a running exercise clock is stamped as is, never clamped to the post's scenario time");
    }

    [RequiresDockerFact]
    public async Task TakeDown_StaleStoredScenarioTimeEarlierThanThePost_IsClampedToThePostsScenarioTime()
    {
        // Gate-1 L-2: only the seed writes Exercise.CurrentScenarioTime, so it can lag behind the posts. A
        // takedown must never be recorded before the post it removed.
        var stale = ModerationSeeder.PostCreatedAt.AddDays(-30);
        var exercise = await _seed.SeedExerciseAsync(currentScenarioTime: stale);
        var postId = await _seed.SeedPostAsync(exercise.Id);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        using var factory = new ModerationWebApplicationFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await client.DeleteAsync(new Uri($"/api/staff/posts/{postId}", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await _seed.ReadSurvivingPostAsync(postId)).DeletedAt.Should().Be(
            ModerationSeeder.PostCreatedAt,
            "a stored scenario time earlier than the post is clamped up to the post's own scenario time");
    }

    [RequiresDockerFact]
    public async Task TakeDown_WhenThePostRemovedBroadcastFails_StillReturns204_KeepsTheSoftDelete_AndLogsAWarning()
    {
        // Gate-1 L-4: the takedown has committed before the broadcast. A 500 here would make the console retry,
        // and the retry is an idempotent no-op that never re-broadcasts, so the failure must not surface.
        var exercise = await _seed.SeedExerciseAsync();
        var postId = await _seed.SeedPostAsync(exercise.Id);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        using var factory = new ModerationWebApplicationFactory(
            _seed.ConnectionString, broadcasterOverride: new ThrowingPostRemovedBroadcaster());
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await client.DeleteAsync(new Uri($"/api/staff/posts/{postId}", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.NoContent, "the post IS down; a broadcast failure is not the caller's failure");
        (await _seed.ReadSurvivingPostAsync(postId)).DeletedAt.Should().NotBeNull("the soft delete committed before the broadcast");

        var warning = factory.Logs.Entries.Should().ContainSingle(
            entry => entry.Category == typeof(PostTakedownService).FullName && entry.Level == LogLevel.Warning,
            "the broadcast failure is logged once as a warning").Subject;
        warning.Exception.Should().BeOfType<InvalidOperationException>();
        warning.Properties.Should().Contain("ExerciseId", exercise.Id).And.Contain("PostId", postId);
    }

    [RequiresDockerTheory]
    [InlineData("pii", "pii")]
    [InlineData(null, "other")]
    public async Task TakeDown_Success_WritesOneStructuredLogLine_WithExercisePostStaffUserAndCategory(
        string? category, string expectedCategory)
    {
        // Gate-1 L-5: an operational log line, not telemetry (DP-9 still holds: no TelemetryEvent row).
        var exercise = await _seed.SeedExerciseAsync();
        var postId = await _seed.SeedPostAsync(exercise.Id);
        var (controller, staffUserId) = await _seed.SeedControllerWithIdAsync(exercise.Id);

        using var factory = new ModerationWebApplicationFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var query = category is null ? string.Empty : $"?category={category}";
        var first = await client.DeleteAsync(new Uri($"/api/staff/posts/{postId}{query}", UriKind.Relative));
        var repeat = await client.DeleteAsync(new Uri($"/api/staff/posts/{postId}{query}", UriKind.Relative));

        first.StatusCode.Should().Be(HttpStatusCode.NoContent);
        repeat.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var line = factory.Logs.Entries.Should().ContainSingle(
            entry => entry.Category == typeof(PostTakedownService).FullName && entry.Level == LogLevel.Information,
            "exactly one line for the one real takedown; the idempotent repeat changes nothing and logs nothing").Subject;
        line.Properties.Should().Contain("ExerciseId", exercise.Id)
            .And.Contain("PostId", postId)
            .And.Contain("StaffUserId", (Guid?)staffUserId)
            .And.Contain("Category", expectedCategory);
        (await _seed.CountTelemetryAsync(exercise.Id)).Should().Be(0, "a log line is not an XC-004 telemetry event (DP-9)");
    }

    [RequiresDockerFact]
    public async Task TakeDown_EmitsNoServerTelemetry()
    {
        // DP-9: the console emits the single steering_action event (with the category); a server event would
        // double-count the action.
        var exercise = await _seed.SeedExerciseAsync();
        var postId = await _seed.SeedPostAsync(exercise.Id);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        using var factory = new ModerationWebApplicationFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await client.DeleteAsync(new Uri($"/api/staff/posts/{postId}?category=inappropriate", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await _seed.CountTelemetryAsync(exercise.Id)).Should().Be(0, "the takedown endpoint emits no telemetry (DP-9)");
    }

    [RequiresDockerFact]
    public async Task TakeDown_NonGuidId_DoesNotMatchTheRoute()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        using var factory = new ModerationWebApplicationFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await client.DeleteAsync(new Uri("/api/staff/posts/not-a-guid", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.NotFound, "the {postId:guid} constraint leaves a non-GUID unmatched");
    }

    /// <summary>
    /// Starts <paramref name="exerciseId"/>'s clock on the host's real singleton <see cref="IExerciseClock"/> and
    /// freezes it, so its scenario time is constant for the test. Returns that instant.
    /// </summary>
    private static DateTimeOffset StartFrozenClock(
        ModerationWebApplicationFactory factory, Guid exerciseId, DateTimeOffset? start = null)
    {
        var clock = factory.Services.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseId, start ?? ClockStart, TimeZoneInfo.Utc);
        clock.Freeze(exerciseId);
        return clock.CurrentScenarioTime(exerciseId)
            ?? throw new InvalidOperationException("The exercise clock did not start.");
    }
}
