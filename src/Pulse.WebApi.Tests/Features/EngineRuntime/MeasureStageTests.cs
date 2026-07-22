namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Linq;
using FluentAssertions;
using Pulse.Core.Features.Storylines.Models;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Xunit;

/// <summary>
/// Story 01 AC "Measure stage": the measure stage advances a storyline via the built
/// <see cref="Storyline.Tick"/> and records the phase transition + intensity/sentiment delta as XC-004
/// <c>storyline.state_changed</c> + <c>engine.measured</c> events (each once per tick). Model-only (an
/// injected scenario clock, no DB) → plain <see cref="FactAttribute"/>.
/// </summary>
public sealed class MeasureStageTests
{
    private static readonly Guid ExerciseId = Guid.NewGuid();

    private static MeasureStage NewStage() => new(new EngineTelemetryEmitter());

    private static EngineTelemetryContext Context() => new()
    {
        ExerciseId = ExerciseId,
        WallClockTime = DateTimeOffset.UnixEpoch,
        ScenarioTime = new DateTimeOffset(2033, 6, 1, 9, 0, 0, TimeSpan.Zero),
        TimeZone = "America/Chicago",
        Channel = "social",
    };

    private static Storyline SeededStoryline()
    {
        var storyline = Storyline.Create(
            ExerciseId,
            title: "Water main contamination fears",
            expectation: "an official statement from the county",
            responseWindowMin: 20,
            hashtags: ["#WaterIssues"]);
        storyline.Seed(0);
        return storyline;
    }

    [Fact]
    public void Measure_WhenSilenceWindowElapses_EmitsMeasuredAndStateChanged_EachOnce()
    {
        var stage = NewStage();
        var storyline = SeededStoryline();
        var clock = new FakeScenarioClock { CurrentScenarioMinute = 25 };

        var result = stage.Measure(storyline, clock, Context());

        storyline.Phase.Should().Be(StorylinePhase.Escalating, "25 scenario minutes of silence blew the 20-minute window");
        result.TelemetryEvents.Count(e => e.EventType == EngineEventTypes.StorylineStateChanged)
            .Should().Be(1, "the window-opening transition emits exactly one storyline.state_changed");
        result.TelemetryEvents.Count(e => e.EventType == EngineEventTypes.Measured)
            .Should().Be(1, "each tick emits exactly one engine.measured");
    }

    [Fact]
    public void Measure_WithNoScenarioTimeElapsed_EmitsMeasured_ButNoStateChange()
    {
        // Model a freeze: the scenario minute is held constant, so a second tick elapses 0 minutes — no
        // silence accrues and no phase moves, though the measure tick is still recorded.
        var stage = NewStage();
        var storyline = SeededStoryline();
        var clock = new FakeScenarioClock { CurrentScenarioMinute = 25 };
        stage.Measure(storyline, clock, Context()); // opens the window at minute 25

        var frozen = stage.Measure(storyline, clock, Context()); // clock held at 25 → elapsed 0

        frozen.TelemetryEvents.Should().OnlyContain(e => e.EventType == EngineEventTypes.Measured,
            "a held (frozen) tick accrues no silence and raises no phase transition");
        frozen.TickResult.ElapsedScenarioMinutes.Should().Be(0);
    }

    [Fact]
    public void Measure_MeasuredEvent_IsBuiltAgainstTheV0Envelope()
    {
        var stage = NewStage();
        var storyline = SeededStoryline();
        var clock = new FakeScenarioClock { CurrentScenarioMinute = 25 };

        var result = stage.Measure(storyline, clock, Context());

        var measured = result.TelemetryEvents.Single(e => e.EventType == EngineEventTypes.Measured);
        measured.SchemaVersion.Should().Be("v0");
        measured.ExerciseId.Should().Be(ExerciseId, "the event is stamped with the server-authoritative scope (COR-001)");
        measured.Actor.Kind.Should().Be("engine");
        measured.Channel.Should().Be("social");
        measured.Payload.Should().NotBeNull();
        measured.Payload.Should().Contain("intensity").And.Contain("amplification");
    }
}
