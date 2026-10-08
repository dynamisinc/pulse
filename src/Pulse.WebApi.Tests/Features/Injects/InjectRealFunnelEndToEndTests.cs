namespace Pulse.WebApi.Tests.Features.Injects;

using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.Injects;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// Story 06 AC "Cannot merge unwired" (the funnel half): a scripted post fired over HTTP travels the REAL
/// <c>PostIngestService</c> — no publisher substitute — and comes out the other side exactly like a live persona post:
/// persisted with <c>origin: inject</c>, the item's <c>injectId</c> and the firing controller as acting human; its own
/// <c>post</c> telemetry event; the one <c>inject_action</c> event; a participant broadcast with NO provenance
/// (XC-002); and an observer notification for the engine. Scenario time comes from the exercise clock (COR-053).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class InjectRealFunnelEndToEndTests
{
    private readonly MsSqlContainerFixture _fixture;

    public InjectRealFunnelEndToEndTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task Fire_TravelsTheRealFunnel_EndToEnd()
    {
        _fixture.ConnectionString.Should().NotBeNull();
        await using var host = await InjectTestHost.StartAsync(_fixture.ConnectionString!);
        using (var scope = host.Services.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<IInjectPostPublisher>().Should().BeOfType<FunnelInjectPostPublisher>(
                "this test must exercise the real funnel, not a substitute");
        }

        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        var scenarioStart = new DateTimeOffset(2033, 5, 1, 9, 0, 0, TimeSpan.FromHours(-5));
        host.Clock.Start(seeded.ExerciseId, scenarioStart, TimeZoneInfo.Utc);

        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0], "Brown water <b>again</b> #WaterIssues"));
        var fired = await host.ActionOkAsync(item.Guid, "fire");

        fired.Status.Should().Be("fired");
        var postId = Guid.Parse(fired.Posts.Single().FiredPostId!);
        await using var db = host.Db(seeded.ExerciseId);

        // 1. Persisted through the funnel, with the inject attribution.
        var post = await db.Posts.SingleAsync(p => p.Id == postId);
        post.Origin.Should().Be("inject");
        post.InjectId.Should().Be(item.Id);
        post.ActingHumanId.Should().Be(seeded.StaffUserId.ToString(), "the controller who pressed Fire (COR-018)");
        post.AuthorPersonaId.Should().Be(seeded.PersonaIds[0], "the persona is the author");
        post.Body.Should().Be("Brown water again #WaterIssues", "sanitized (NFR-004)");
        post.CreatedScenarioTime.Should().Be(host.Clock.CurrentScenarioTime(seeded.ExerciseId), "scenario time from the exercise clock (COR-053)");
        DateTimeOffset.Parse(fired.Posts.Single().FiredScenarioTime!, System.Globalization.CultureInfo.InvariantCulture)
            .Should().Be(post.CreatedScenarioTime, "the child records the post's scenario instant, round-tripped");

        // 2. The post's own telemetry, carrying the inject provenance.
        var postEvent = await db.TelemetryEvents.SingleAsync(e => e.EventType == "post" && e.Target!.EntityId == postId.ToString());
        postEvent.Origin.Should().Be("inject");
        postEvent.InjectId.Should().Be(item.Id);
        postEvent.Actor.Kind.Should().Be("persona");
        postEvent.Actor.ActingHumanId.Should().Be(seeded.StaffUserId.ToString());

        // 3. Exactly one inject_action fire event, linked by the same injectId.
        var fireEvents = await db.TelemetryEvents
            .Where(e => e.EventType == "inject_action" && e.InjectId == item.Id && e.Payload!.Contains("\"fire\""))
            .ToListAsync();
        fireEvents.Should().ContainSingle();

        // 4. The participant broadcast — participant-safe projection only (XC-002).
        var (broadcastExercise, broadcastPost) = host.Broadcaster.Calls.Should().ContainSingle().Subject;
        broadcastExercise.Should().Be(seeded.ExerciseId);
        broadcastPost.Id.Should().Be(postId.ToString());
        using (var wire = JsonDocument.Parse(JsonSerializer.Serialize(broadcastPost)))
        {
            var names = wire.RootElement.EnumerateObject().Select(p => p.Name).ToList();
            names.Should().NotContain(["origin", "actingHumanId", "injectId", "createdWallClock"],
                "a participant must never learn a post was scripted, or by whom");
        }

        // 5. The engine's post observers heard about it, in the right exercise.
        host.Observer.Calls.Should().ContainSingle(call => call.Post.Id == postId)
            .Which.ExerciseId.Should().Be(seeded.ExerciseId);
    }
}
