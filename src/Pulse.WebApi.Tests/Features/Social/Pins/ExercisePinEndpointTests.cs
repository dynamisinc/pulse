namespace Pulse.WebApi.Tests.Features.Social.Pins;

using System;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Social.Pins;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// <c>PUT</c> / <c>DELETE /api/staff/posts/{postId}/pin</c> (demo-feedback story 04, ACs "Exercise pin (DF-7)",
/// "Push", "Takedown", XC-004) through the REAL <c>Program</c> pipeline and real SQL, driven by real session tokens.
/// Only the <c>IFeedBroadcaster</c> is a recording double.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ExercisePinEndpointTests
{
    private static readonly DateTimeOffset ClockStart = new(2033, 9, 4, 14, 0, 0, TimeSpan.Zero);

    private readonly PinsSeeder _seed;

    public ExercisePinEndpointTests(MsSqlContainerFixture fixture) => _seed = new PinsSeeder(fixture);

    [RequiresDockerFact]
    public async Task Pin_Returns204_StampsScenarioTimeAndTheStaffUser_EmitsOneEvent_AndPushesOnce()
    {
        var exercise = await _seed.Sessions.SeedExerciseAsync();
        var author = await _seed.Sessions.SeedPersonaAsync(exercise.Id);
        var postId = await _seed.SeedPostAsync(exercise.Id, author);
        var (controller, staffUserId) = await _seed.Sessions.SeedControllerWithIdAsync(exercise.Id);

        using var factory = _seed.CreateHost();
        var expected = StartFrozenClock(factory, exercise.Id);
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await client.PutAsync(PinsSeeder.StaffPinUri(postId), content: null);

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        var row = await _seed.ReadPostAsync(postId);
        row.PinnedForAllAt.Should().Be(expected, "the exercise pin is stamped in SCENARIO time from the running clock (COR-053)");
        row.PinnedForAllByHumanId.Should().Be(staffUserId.ToString(), "the pin records the staff user from the session, never the request");
        row.DeletedAt.Should().BeNull();

        factory.Broadcaster.PinChanges.Should().ContainSingle().Which.Should().Be((exercise.Id, postId, true));

        var events = await _seed.ReadEventsAsync(exercise.Id, "post.pinned", "post.unpinned");
        var pinned = events.Should().ContainSingle().Which;
        pinned.EventType.Should().Be("post.pinned");
        pinned.Payload.Should().Be("{\"scope\":\"exercise\"}", "the event carries the pin's scope only (counts-only telemetry)");
        pinned.Channel.Should().Be("social");
        pinned.Actor.Kind.Should().Be("system");
        pinned.Actor.ActingHumanId.Should().Be(staffUserId.ToString());
        pinned.Actor.Role.Should().Be("controller");
        pinned.Actor.SessionId.Should().NotBeNullOrEmpty();
        pinned.Target!.EntityType.Should().Be("post");
        pinned.Target.EntityId.Should().Be(postId.ToString());
        pinned.ScenarioTime.Should().Be(expected);
    }

    [RequiresDockerFact]
    public async Task Pin_Repeated_Returns204_DoesNotMoveThePin_AndNeitherEmitsNorPushesAgain()
    {
        var exercise = await _seed.Sessions.SeedExerciseAsync();
        var postId = await _seed.SeedPostAsync(exercise.Id, Guid.NewGuid());
        var controller = await _seed.Sessions.SeedControllerSessionAsync(exercise.Id);

        using var factory = _seed.CreateHost();
        var firstStamp = StartFrozenClock(factory, exercise.Id);
        using var client = factory.CreateClientFor(exercise.Host, controller);

        (await client.PutAsync(PinsSeeder.StaffPinUri(postId), content: null)).StatusCode.Should().Be(HttpStatusCode.NoContent);
        factory.Services.GetRequiredService<IExerciseClock>().Jump(exercise.Id, 30);
        var second = await client.PutAsync(PinsSeeder.StaffPinUri(postId), content: null);

        second.StatusCode.Should().Be(HttpStatusCode.NoContent, "pinning a pinned post is an idempotent success");
        (await _seed.ReadPostAsync(postId)).PinnedForAllAt.Should().Be(firstStamp, "a repeat never moves the pin");
        factory.Broadcaster.PinChanges.Should().ContainSingle("a no-op pushes nothing");
        (await _seed.ReadEventsAsync(exercise.Id, "post.pinned")).Should().ContainSingle("a no-op emits nothing");
    }

    [RequiresDockerFact]
    public async Task Unpin_ClearsBothColumns_EmitsUnpinned_PushesFalse_AndARepeatIsANoOp()
    {
        var exercise = await _seed.Sessions.SeedExerciseAsync();
        var postId = await _seed.SeedPostAsync(exercise.Id, Guid.NewGuid(), pinnedForAllAt: ClockStart.AddMinutes(-10));
        var controller = await _seed.Sessions.SeedControllerSessionAsync(exercise.Id);

        using var factory = _seed.CreateHost();
        StartFrozenClock(factory, exercise.Id);
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var first = await client.DeleteAsync(PinsSeeder.StaffPinUri(postId));
        var second = await client.DeleteAsync(PinsSeeder.StaffPinUri(postId));

        first.StatusCode.Should().Be(HttpStatusCode.NoContent);
        second.StatusCode.Should().Be(HttpStatusCode.NoContent, "clearing an unpinned post is an idempotent success");
        var row = await _seed.ReadPostAsync(postId);
        row.PinnedForAllAt.Should().BeNull();
        row.PinnedForAllByHumanId.Should().BeNull("clearing the pin clears who set it too");
        factory.Broadcaster.PinChanges.Should().ContainSingle().Which.Should().Be((exercise.Id, postId, false));
        var unpinned = (await _seed.ReadEventsAsync(exercise.Id, "post.unpinned")).Should().ContainSingle().Which;
        unpinned.Payload.Should().Be("{\"scope\":\"exercise\"}");
    }

    [RequiresDockerFact]
    public async Task Unpin_NotPinned_Returns204_AndNeitherEmitsNorPushes()
    {
        var exercise = await _seed.Sessions.SeedExerciseAsync();
        var postId = await _seed.SeedPostAsync(exercise.Id, Guid.NewGuid());
        var controller = await _seed.Sessions.SeedControllerSessionAsync(exercise.Id);

        using var factory = _seed.CreateHost();
        using var client = factory.CreateClientFor(exercise.Host, controller);

        (await client.DeleteAsync(PinsSeeder.StaffPinUri(postId))).StatusCode.Should().Be(HttpStatusCode.NoContent);
        factory.Broadcaster.PinChanges.Should().BeEmpty();
        (await _seed.ReadEventsAsync(exercise.Id, "post.pinned", "post.unpinned")).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task Pin_ClockNotRunning_StampsTheStoredScenarioTime_NeverTheWallClock()
    {
        var stored = new DateTimeOffset(2033, 9, 4, 15, 30, 0, TimeSpan.FromHours(-5));
        var exercise = await _seed.Sessions.SeedExerciseAsync(currentScenarioTime: stored);
        var postId = await _seed.SeedPostAsync(exercise.Id, Guid.NewGuid());
        var controller = await _seed.Sessions.SeedControllerSessionAsync(exercise.Id);

        using var factory = _seed.CreateHost();
        using var client = factory.CreateClientFor(exercise.Host, controller);

        (await client.PutAsync(PinsSeeder.StaffPinUri(postId), content: null)).StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await _seed.ReadPostAsync(postId)).PinnedForAllAt.Should().Be(stored);
    }

    [RequiresDockerFact]
    public async Task Pin_TakenDownPost_Returns404_AndWritesNothing()
    {
        var exercise = await _seed.Sessions.SeedExerciseAsync();
        var postId = await _seed.SeedPostAsync(exercise.Id, Guid.NewGuid(), deletedAt: ClockStart);
        var controller = await _seed.Sessions.SeedControllerSessionAsync(exercise.Id);

        using var factory = _seed.CreateHost();
        using var client = factory.CreateClientFor(exercise.Host, controller);

        (await client.PutAsync(PinsSeeder.StaffPinUri(postId), content: null)).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await _seed.ReadPostAsync(postId)).PinnedForAllAt.Should().BeNull();
        factory.Broadcaster.PinChanges.Should().BeEmpty();
        (await _seed.ReadEventsAsync(exercise.Id, "post.pinned")).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task Unpin_TakenDownPost_IsStillAllowed_Returns204_AndClearsThePin()
    {
        var exercise = await _seed.Sessions.SeedExerciseAsync();
        var postId = await _seed.SeedPostAsync(
            exercise.Id, Guid.NewGuid(), deletedAt: ClockStart, pinnedForAllAt: ClockStart.AddMinutes(-5));
        var controller = await _seed.Sessions.SeedControllerSessionAsync(exercise.Id);

        using var factory = _seed.CreateHost();
        using var client = factory.CreateClientFor(exercise.Host, controller);

        (await client.DeleteAsync(PinsSeeder.StaffPinUri(postId))).StatusCode.Should().Be(HttpStatusCode.NoContent);
        var row = await _seed.ReadPostAsync(postId);
        row.PinnedForAllAt.Should().BeNull("un-pinning a taken-down post for everyone is still allowed (Takedown AC)");
        row.DeletedAt.Should().Be(ClockStart, "clearing the pin never touches the takedown");
        factory.Broadcaster.PinChanges.Should().ContainSingle().Which.PinnedForAll.Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task Pin_UnknownPost_Returns404()
    {
        var exercise = await _seed.Sessions.SeedExerciseAsync();
        var controller = await _seed.Sessions.SeedControllerSessionAsync(exercise.Id);

        using var factory = _seed.CreateHost();
        using var client = factory.CreateClientFor(exercise.Host, controller);

        (await client.PutAsync(PinsSeeder.StaffPinUri(Guid.NewGuid()), content: null)).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await client.DeleteAsync(PinsSeeder.StaffPinUri(Guid.NewGuid()))).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [RequiresDockerFact]
    public async Task Pin_PushFails_StillReturns204_KeepsThePin_AndLogsAWarning()
    {
        var exercise = await _seed.Sessions.SeedExerciseAsync();
        var postId = await _seed.SeedPostAsync(exercise.Id, Guid.NewGuid());
        var controller = await _seed.Sessions.SeedControllerSessionAsync(exercise.Id);

        using var factory = _seed.CreateHost(new ThrowingPinBroadcaster());
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await client.PutAsync(PinsSeeder.StaffPinUri(postId), content: null);

        response.StatusCode.Should().Be(HttpStatusCode.NoContent, "a failed push never fails a committed pin");
        (await _seed.ReadPostAsync(postId)).PinnedForAllAt.Should().NotBeNull();
        (await _seed.ReadEventsAsync(exercise.Id, "post.pinned")).Should().ContainSingle();
        factory.Logs.Entries.Should().Contain(entry =>
            entry.Category == typeof(PinService).FullName
            && entry.Level == LogLevel.Warning
            && entry.Exception is InvalidOperationException);
    }

    // ---- authorization: staff + controller role only -------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Evaluator_Gets403_AndNothingChanges()
    {
        var exercise = await _seed.Sessions.SeedExerciseAsync();
        var postId = await _seed.SeedPostAsync(exercise.Id, Guid.NewGuid());
        var evaluator = await _seed.SeedStaffAsync(exercise.Id, "evaluator");

        using var factory = _seed.CreateHost();
        using var client = factory.CreateClientFor(exercise.Host, evaluator);

        (await client.PutAsync(PinsSeeder.StaffPinUri(postId), content: null)).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await client.DeleteAsync(PinsSeeder.StaffPinUri(postId))).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await _seed.ReadPostAsync(postId)).PinnedForAllAt.Should().BeNull();
        factory.Broadcaster.PinChanges.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task Participant_ReadOnly_And_Anonymous_Get401_AndNothingChanges()
    {
        var exercise = await _seed.Sessions.SeedExerciseAsync();
        var persona = await _seed.Sessions.SeedPersonaAsync(exercise.Id);
        var postId = await _seed.SeedPostAsync(exercise.Id, persona);
        var participant = await _seed.SeedParticipantAsync(exercise.Id, persona);
        var readOnly = await _seed.Sessions.SeedReadOnlySessionAsync(exercise.Id);

        using var factory = _seed.CreateHost();
        foreach (var token in new[] { participant, readOnly, null })
        {
            using var client = factory.CreateClientFor(exercise.Host, token);
            (await client.PutAsync(PinsSeeder.StaffPinUri(postId), content: null)).StatusCode.Should().Be(
                HttpStatusCode.Unauthorized, "only a staff session reaches the exercise pin");
        }

        (await _seed.ReadPostAsync(postId)).PinnedForAllAt.Should().BeNull();
        factory.Broadcaster.PinChanges.Should().BeEmpty();
    }

    private static DateTimeOffset StartFrozenClock(PinsWebApplicationFactory factory, Guid exerciseId)
    {
        var clock = factory.Services.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseId, ClockStart, TimeZoneInfo.Utc);
        clock.Freeze(exerciseId);
        return clock.CurrentScenarioTime(exerciseId)
            ?? throw new InvalidOperationException("The exercise clock did not start.");
    }
}
