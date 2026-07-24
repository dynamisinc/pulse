namespace Pulse.WebApi.Features.Ops.EngineContentSeed;

using System;
using System.Collections.Generic;
using System.Linq;
using Pulse.Core.Features.Storylines.Models;

/// <summary>
/// A pure, stateless factory (feature engine-content-seed, story 02) that builds ONE canned starter
/// <see cref="Storyline"/> in memory via the already-built <see cref="Storyline.Create"/> / <see cref="Storyline.Seed"/>
/// domain factory — matching the shipped frontend mock's Fairhaven water-contamination arc
/// (<c>storylineMock.ts</c>) so a demo/pilot exercise's engine content is narratively consistent with the
/// controller console's escalation-dial mock. It calls the existing storyline-model verbatim: no new curve,
/// no new state-machine transition, no new storyline logic.
/// </summary>
/// <remarks>
/// <para>
/// <b>In-memory only (deliberately deferred persistence).</b> <see cref="Storyline"/> has no <c>DbSet</c> and
/// no authoring endpoint this phase; this factory returns a fresh instance every call. A host restart or a
/// re-seed discards accrued intensity/phase progress and restarts the arc at <c>Dormant → Seeded</c>, minute
/// 0 — the accepted Phase-1 limitation documented in <c>feature.md</c>.
/// </para>
/// <para>
/// <b>Isolation (COR-001).</b> The returned <see cref="Storyline.ExerciseId"/> always equals the
/// <paramref name="exerciseId"/> parameter — the same field <c>ReactionLoopDriver.BuildReviewItem</c>
/// defensively re-checks against the tick's resolved scope and throws on mismatch, so this factory never lets
/// a stale or foreign id slip through.
/// </para>
/// <para>
/// <b>Pure / stateless.</b> No <c>PulseDbContext</c>, no I/O, no shared mutable state (the ordering/constant
/// tables are immutable) — calling it twice with the same inputs yields two fully independent storylines, so
/// a re-seed can always rebuild a fresh one with no hidden coupling to a prior call. The same house
/// convention as <c>AccountFieldRules</c>: a stateless static class needing no DI registration.
/// </para>
/// </remarks>
public static class StarterStorylineFactory
{
    /// <summary>The canned storyline title — the exact Fairhaven arc the frontend controller mock displays.</summary>
    public const string StorylineTitle = "Water main contamination fears";

    /// <summary>The silence test (ADP-001): the official action that would address this concern.</summary>
    public const string StorylineExpectation =
        "an official statement from Fulton County Emergency Management addressing the water safety concern";

    /// <summary>The escalation-profile name (ADP-010) — the built <c>Standard</c> curve, unchanged.</summary>
    public const string CurveName = "Standard";

    /// <summary>The match/amplification tag (ADP-004) the starter arc carries.</summary>
    public const string PrimaryHashtag = "#WaterIssues";

    /// <summary>
    /// The default silence window in scenario minutes (AC2) — deliberately short and demo/pilot-tuned. Scenario
    /// time advances 1:1 with wall-clock (no acceleration multiplier exists anywhere today), so a controller
    /// running this seed sees the first review-queue item within a few real minutes, not the ~20 used in
    /// illustrative engine tests.
    /// </summary>
    public const int DefaultResponseWindowMinutes = 3;

    /// <summary>The documented sane lower bound the supplied window is clamped to (a window must be at least one minute).</summary>
    public const int MinResponseWindowMinutes = 1;

    /// <summary>The documented sane upper bound the supplied window is clamped to (three hours of scenario silence).</summary>
    public const int MaxResponseWindowMinutes = 180;

    /// <summary>
    /// The citizens-first priority order (ADP-001: "the vacuum fills with worry and speculation before
    /// officials speak"). <c>IntentComposer.Compose</c> takes the eligible cast in list order via
    /// <c>EligiblePersonas.Take(allowed)</c>, so anxious citizen voices are picked for the first, smaller
    /// bursts before the official/outlet accounts. Handles not in this table are appended in their supplied
    /// order (stable), so an unexpected extra handle is never dropped.
    /// </summary>
    private static readonly string[] CitizensFirstOrder =
    [
        "mvega_fh",
        "tbrandt41",
        "kwardFH",
        "Newsline7",
        "FairhavenWater",
        "FulcoEM",
    ];

    private static readonly Dictionary<string, int> CitizensFirstRank =
        CitizensFirstOrder
            .Select((handle, index) => (handle, index))
            .ToDictionary(pair => pair.handle, pair => pair.index, StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Builds one seeded starter storyline for <paramref name="exerciseId"/> from the given persona
    /// <paramref name="personaHandles"/>. The storyline is created via <see cref="Storyline.Create"/> with the
    /// canned Fairhaven constants and a citizens-first <c>ParticipatingPersonas</c> order, then armed with
    /// <see cref="Storyline.Seed"/> at scenario minute 0 — so it is immediately eligible for observe/measure on
    /// the very next loop tick after registration, with no further setup.
    /// </summary>
    /// <param name="exerciseId">The exercise the storyline is scoped to (COR-001); must not be empty.</param>
    /// <param name="personaHandles">
    /// The seeded persona handles (story 01's output) eligible to voice the storyline — a plain list of handle
    /// strings (no compile-time dependency on story 01's types); reordered citizens-first here.
    /// </param>
    /// <param name="options">Optional tuning (the <c>responseWindowMinutes</c> override); defaults applied when null.</param>
    /// <returns>A <see cref="Storyline"/> in <see cref="StorylinePhase.Seeded"/> at scenario minute 0.</returns>
    public static Storyline Build(
        Guid exerciseId,
        IReadOnlyList<string> personaHandles,
        StarterStorylineOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(personaHandles);

        var requested = options?.ResponseWindowMinutes ?? DefaultResponseWindowMinutes;
        var responseWindow = Math.Clamp(requested, MinResponseWindowMinutes, MaxResponseWindowMinutes);

        var ordered = OrderCitizensFirst(personaHandles);

        var storyline = Storyline.Create(
            exerciseId,
            title: StorylineTitle,
            expectation: StorylineExpectation,
            curveName: CurveName,
            responseWindowMin: responseWindow,
            participatingPersonas: ordered,
            hashtags: [PrimaryHashtag]);

        // Dormant → Seeded, tick baseline anchored at scenario minute 0 (AC3).
        storyline.Seed(0);
        return storyline;
    }

    /// <summary>Orders the supplied handles citizens-first by <see cref="CitizensFirstRank"/>; unknown handles keep their supplied order at the end (stable).</summary>
    private static List<string> OrderCitizensFirst(IReadOnlyList<string> personaHandles) =>
        personaHandles
            .Select((handle, index) => (handle, index))
            .OrderBy(pair => CitizensFirstRank.TryGetValue(pair.handle, out var rank) ? rank : int.MaxValue)
            .ThenBy(pair => pair.index)
            .Select(pair => pair.handle)
            .ToList();
}

/// <summary>
/// Caller-supplied tuning for <see cref="StarterStorylineFactory.Build"/>. Carries the optional
/// <see cref="ResponseWindowMinutes"/> override; a null value (or a null options object) falls back to
/// <see cref="StarterStorylineFactory.DefaultResponseWindowMinutes"/>, and any supplied value is clamped to
/// <c>[1, 180]</c> regardless.
/// </summary>
public sealed class StarterStorylineOptions
{
    /// <summary>
    /// The silence window in scenario minutes before escalation opens. Optional — omit for the demo-tuned
    /// default (3). Clamped to <c>[1, 180]</c> by the factory.
    /// </summary>
    public int? ResponseWindowMinutes { get; init; }
}
