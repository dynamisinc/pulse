namespace Pulse.WebApi.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using Pulse.Core.Features.Storylines.Models;
using Pulse.Core.Features.Storylines.Services;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;

/// <summary>
/// The reaction loop's <b>measure</b> stage (E8 architecture §1.2 back-half, §6.2) — the missing stage
/// story 01 builds. It advances a storyline one tick in scenario time via the built
/// <see cref="Storyline.Tick"/> (which folds <see cref="IntensityModel"/> + <see cref="SentimentModel"/> +
/// the escalation curve), then maps the raised domain events onto the XC-004 telemetry taxonomy: one
/// <c>engine.measured</c> per tick (intensity/sentiment delta + amplification) and one
/// <c>storyline.state_changed</c> per phase transition (from→to + cause). It builds the events; the caller
/// adds them to its own unit of work and saves them alongside the loop's other stage events.
/// </summary>
/// <remarks>
/// <para>
/// <b>Scenario time only (COR-053).</b> The tick's elapsed span is measured from the scenario clock, so a
/// freeze holds everything (elapsed 0 — no accrual, no transition) and a time-jump advances it in one step,
/// possibly blowing several transitions at once. Nothing here reads the wall clock; the wall-clock value on
/// the telemetry envelope is the server clock stamped by the caller.
/// </para>
/// <para>Stateless over the injected emitter → registered as a singleton.</para>
/// </remarks>
public sealed class MeasureStage
{
    private readonly IEngineTelemetryEmitter _telemetryEmitter;

    /// <summary>Creates the measure stage over the XC-004 telemetry emitter.</summary>
    /// <param name="telemetryEmitter">Builds the <c>engine.measured</c> / <c>storyline.state_changed</c> events.</param>
    public MeasureStage(IEngineTelemetryEmitter telemetryEmitter)
    {
        ArgumentNullException.ThrowIfNull(telemetryEmitter);
        _telemetryEmitter = telemetryEmitter;
    }

    /// <summary>
    /// Advances <paramref name="storyline"/> one tick against <paramref name="clock"/> and builds the tick's
    /// telemetry. Returns the <see cref="StorylineTickResult"/> (so the caller can read the new intensity /
    /// phase) plus the built (not yet persisted) <c>engine.measured</c> + <c>storyline.state_changed</c>
    /// events, stamped with the envelope <paramref name="context"/> (exercise, wall + scenario time, zone).
    /// </summary>
    /// <param name="storyline">The storyline to advance (mutated in place by the built <see cref="Storyline.Tick"/>).</param>
    /// <param name="clock">The scenario clock the tick reads (freeze holds, jump advances).</param>
    /// <param name="context">The server-authoritative telemetry envelope context for this tick.</param>
    /// <param name="signals">Optional per-tick amplification/reaction signals; defaults to the neutral set.</param>
    /// <returns>The tick result and the telemetry events raised by the tick.</returns>
    public MeasureStageResult Measure(
        Storyline storyline,
        IScenarioClock clock,
        EngineTelemetryContext context,
        StorylineTickSignals? signals = null)
    {
        ArgumentNullException.ThrowIfNull(storyline);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(context);

        var sentimentBefore = storyline.Sentiment;
        var tick = storyline.Tick(clock, signals);
        var amplification = signals?.Amplification?.Velocity ?? 0.0;

        var events = new List<TelemetryEvent>();
        foreach (var raised in tick.Events)
        {
            switch (raised)
            {
                case StorylineStateChanged stateChanged:
                    events.Add(BuildStateChangedEvent(stateChanged, context));
                    break;

                case StorylineMeasured measured:
                    events.Add(BuildMeasuredEvent(measured, storyline.Sentiment - sentimentBefore, amplification, context));
                    break;

                default:
                    // Steering-action events are logged on the controller path, not the measure tick.
                    break;
            }
        }

        return new MeasureStageResult(tick, events);
    }

    /// <summary>Builds the <c>storyline.state_changed</c> event (from→to phase + cause) for a transition.</summary>
    private TelemetryEvent BuildStateChangedEvent(StorylineStateChanged stateChanged, EngineTelemetryContext context)
    {
        var payload = new EngineEventPayloads.StorylineStateChanged
        {
            Storyline = stateChanged.StorylineId.ToString(),
            FromPhase = stateChanged.From.ToString(),
            ToPhase = stateChanged.To.ToString(),
            Cause = CauseLiteral(stateChanged.Cause),
        };

        return _telemetryEmitter.BuildEvent(EngineEventTypes.StorylineStateChanged, context, payload);
    }

    /// <summary>Builds the <c>engine.measured</c> event (intensity + sentiment delta + amplification) for the tick.</summary>
    private TelemetryEvent BuildMeasuredEvent(
        StorylineMeasured measured,
        double sentimentDelta,
        double amplification,
        EngineTelemetryContext context)
    {
        var payload = new EngineEventPayloads.Measured
        {
            Storyline = measured.StorylineId.ToString(),
            Intensity = measured.Intensity,
            SentimentDelta = sentimentDelta,
            Amplification = amplification,
        };

        return _telemetryEmitter.BuildEvent(EngineEventTypes.Measured, context, payload);
    }

    /// <summary>Maps the domain <see cref="StorylineCause"/> to its XC-004 <c>cause</c> wire literal (E8 §11).</summary>
    private static string CauseLiteral(StorylineCause cause) => cause switch
    {
        StorylineCause.Seed => "seed",
        StorylineCause.WindowOpened => "window-opened",
        StorylineCause.Activity => "activity",
        StorylineCause.Unaddressed => "unaddressed",
        StorylineCause.MatchedResponse => "matched-response",
        StorylineCause.OffPlatformMarker => "off-platform-marker",
        StorylineCause.DialTarget => "dial-target",
        StorylineCause.CurveDecay => "curve-decay",
        StorylineCause.ReOpened => "re-opened",
        _ => cause.ToString(),
    };
}

/// <summary>
/// The outcome of <see cref="MeasureStage.Measure"/>: the <see cref="StorylineTickResult"/> the tick
/// produced and the built (not yet persisted) telemetry events (<c>engine.measured</c> +
/// <c>storyline.state_changed</c>) the caller adds to its own unit of work.
/// </summary>
/// <param name="TickResult">The storyline tick result — new intensity, sentiment, and phase transitions.</param>
/// <param name="TelemetryEvents">The built XC-004 events raised by the tick, in order.</param>
public sealed record MeasureStageResult(
    StorylineTickResult TickResult,
    IReadOnlyList<TelemetryEvent> TelemetryEvents);
