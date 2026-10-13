namespace Pulse.WebApi.Tests.Features.Identity.LinkCards;

using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.LinkCards;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// easy-login/04 (Telemetry AC, XC-004): every successful card request persists exactly one
/// <c>roster.cards.generated</c> event, on the locked v0 envelope (<c>channel: system</c>), with the card count as its
/// only payload, a staff actor carrying the role and the acting human, no target, the exercise's scenario time and
/// zone, and NO URL, token or name anywhere in it. A refused request emits nothing.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class LinkCardTelemetryTests
{
    private readonly LinkCardTestWorld _world;

    public LinkCardTelemetryTests(MsSqlContainerFixture fixture) => _world = new LinkCardTestWorld(fixture);

    [RequiresDockerFact]
    public async Task ASuccessfulRequest_EmitsOneEvent_WithTheCountAndAStaffActor()
    {
        var scenario = new DateTimeOffset(2033, 9, 4, 13, 0, 0, TimeSpan.FromHours(-4));
        var exercise = await _world.SeedExerciseAsync(scenarioTime: scenario, timeZone: "America/New_York");
        var staff = await _world.SeedStaffAsync((exercise, "planner"));
        await _world.SeedParticipantAsync(exercise, "Card One");
        await _world.SeedParticipantAsync(exercise, "Card Two");
        await _world.SeedParticipantAsync(exercise, "No Card", SeededLink.None);

        var before = DateTimeOffset.UtcNow;
        var result = await _world.GenerateAsync(exercise, staff);
        var after = DateTimeOffset.UtcNow;

        result.Sheet!.Cards.Should().HaveCount(2);
        var evt = (await _world.CardEventsAsync(exercise)).Should().ContainSingle("one event per request").Subject;

        evt.EventType.Should().Be("roster.cards.generated");
        evt.Channel.Should().Be("system");
        evt.SchemaVersion.Should().Be("v0");
        evt.ExerciseId.Should().Be(exercise, "stamped from the resolved scope");
        evt.Payload.Should().Be("{\"count\":2}", "the card count is the whole payload (skips are not cards)");
        evt.Target.Should().BeNull("the sheet has no single target");

        evt.Actor.Kind.Should().Be("system");
        evt.Actor.Role.Should().Be("planner", "the caller's role on this exercise");
        evt.Actor.ActingHumanId.Should().Be(staff.ToString(), "the staff user who printed");
        evt.Actor.ParticipantId.Should().BeNull();
        evt.Actor.PersonaId.Should().BeNull();

        evt.WallClockTime.Should().BeOnOrAfter(before.AddSeconds(-1)).And.BeOnOrBefore(after.AddSeconds(1));
        evt.EmittedAt.Should().Be(evt.WallClockTime, "one clock read per request");
        evt.ScenarioTime.Should().Be(scenario, "with no live clock, the exercise's stored scenario instant");
        evt.TimeZone.Should().Be("America/New_York");
    }

    [RequiresDockerFact]
    public async Task TheScenarioTime_IsTheLiveExerciseClock_WhenItRuns()
    {
        var exercise = await _world.SeedExerciseAsync(scenarioTime: new DateTimeOffset(2033, 1, 1, 0, 0, 0, TimeSpan.Zero));
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        var liveStart = new DateTimeOffset(2033, 9, 4, 13, 0, 0, TimeSpan.Zero);

        await using var provider = _world.BuildServices(exercise, staff);
        var clock = provider.GetRequiredService<IExerciseClock>();
        clock.Start(exercise, liveStart, TimeZoneInfo.Utc);
        clock.Freeze(exercise);
        await using (var request = provider.CreateAsyncScope())
        {
            await request.ServiceProvider.GetRequiredService<LinkCardService>().GenerateAsync(LinkCardTestWorld.Body(null));
        }

        var evt = (await _world.CardEventsAsync(exercise)).Should().ContainSingle().Subject;
        evt.ScenarioTime.Should().Be(clock.CurrentScenarioTime(exercise)!.Value, "the live exercise clock wins over the stored instant");
    }

    [RequiresDockerFact]
    public async Task ARequestThatProducesNoCard_StillEmitsOneEvent_WithCountZero()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));

        await _world.GenerateAsync(exercise, staff, [Guid.NewGuid().ToString()]);

        (await _world.CardEventsAsync(exercise)).Should().ContainSingle().Which.Payload.Should().Be("{\"count\":0}");
    }

    [RequiresDockerFact]
    public async Task TwoRequests_AreTwoEvents()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        await _world.SeedParticipantAsync(exercise, "Someone");

        await _world.GenerateAsync(exercise, staff);
        await _world.GenerateAsync(exercise, staff);

        (await _world.CardEventsAsync(exercise)).Should().HaveCount(2).And.OnlyContain(e => e.Payload == "{\"count\":1}");
    }

    [RequiresDockerFact]
    public async Task NoUrlTokenOrName_EverReachesTheEvent()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        var person = await _world.SeedParticipantAsync(exercise, "Secretive Sam", agency: "Hidden Agency", jobRole: "Quiet Role");

        var result = await _world.GenerateAsync(exercise, staff, [person.AccountId.ToString()]);
        var card = result.Sheet!.Cards.Single();

        var evt = (await _world.CardEventsAsync(exercise)).Single();
        var everything = JsonSerializer.Serialize(evt);

        foreach (var secretOrName in new[]
        {
            card.JoinUrl, person.Token!, LinkCardTestWorld.FrontendBase, "/join/", card.QrSvgDataUri[..64],
            "Secretive Sam", "Hidden Agency", "Quiet Role", person.SignInName, person.AccountId.ToString(),
        })
        {
            everything.Should().NotContain(secretOrName, "telemetry carries the count only (gotcha 8)");
        }
    }

    [RequiresDockerFact]
    public async Task ARefusedRequest_EmitsNothing()
    {
        var exercise = await _world.SeedExerciseAsync();
        var controller = await _world.SeedStaffAsync((exercise, "controller"));
        var evaluator = await _world.SeedStaffAsync((exercise, "evaluator"));
        await _world.SeedParticipantAsync(exercise, "Someone");

        (await _world.GenerateAsync(exercise, controller, frontendBase: null)).Outcome.Should().Be(LinkCardOutcome.JoinLinksUnavailable);
        (await _world.GenerateAsync(exercise, controller, ["a", "b"], maxCardsPerRequest: 1)).Outcome.Should().Be(LinkCardOutcome.TooManyIds);
        (await _world.GenerateAsync(exercise, evaluator)).Outcome.Should().Be(LinkCardOutcome.Forbidden);
        (await _world.GenerateAsync(exercise, staffUserId: null)).Outcome.Should().Be(LinkCardOutcome.Unauthenticated);

        (await _world.CardEventsAsync(exercise)).Should().BeEmpty("only a generated sheet is recorded");
    }

    [RequiresDockerFact]
    public async Task TheEvent_PassesTheEnvelopeRules()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));

        await _world.GenerateAsync(exercise, staff);

        var evt = (await _world.CardEventsAsync(exercise)).Single();
        TelemetryEnvelopeRules.Validate(TelemetryAttributionFacts.FromEntity(evt)).Should().BeEmpty("the v0 envelope validator accepts the event");
    }
}
