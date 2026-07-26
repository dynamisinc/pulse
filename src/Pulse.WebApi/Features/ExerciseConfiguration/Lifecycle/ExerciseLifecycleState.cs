namespace Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;

using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;
using System.Linq;

/// <summary>
/// COR-032's exercise lifecycle vocabulary and its state machine, in ONE place — the literals, the
/// legacy→canonical mapping, the allowed transitions, and the per-state behaviour hooks other features
/// subscribe to. Pure and static: no DI, no persistence, no HTTP, so the state machine can be unit-tested
/// and reasoned about without a database.
/// </summary>
/// <remarks>
/// <para>
/// <b>The literals are authoritative and are NOT re-coined.</b> They are exactly the strings story 01a
/// widened <c>Exercise.Status</c> to carry (<c>implementation.md</c> → "Lifecycle string literals"):
/// <c>build</c> | <c>staged</c> | <c>live</c> | <c>paused</c> | <c>completed</c> | <c>archived</c>.
/// Lowercase single tokens, and <c>completed</c> — never the legacy <c>complete</c>. This story introduces
/// <b>no second vocabulary, no parallel lifecycle column and no projection layer</b> (AC1): every read and
/// write below goes through <c>Exercise.Status</c> itself.
/// </para>
/// <para>
/// <b>Why a string-keyed table rather than a C# enum on the column.</b> The column stores the frozen
/// FRONTEND vocabulary verbatim (<c>exerciseContextResolver.ts</c>) and flows onto the frozen
/// <c>ExerciseScope.status</c> wire field. Round-tripping it through an enum would risk emitting a
/// PascalCase name onto a wire whose client guard fails closed on an unknown value — a blank participant
/// world, not a type error. So the canonical form here IS the wire literal.
/// </para>
/// <para>
/// <b>The legacy four are still accepted, deliberately.</b> <c>scheduled</c> | <c>active</c> |
/// <c>complete</c> remain readable through <see cref="TryParse"/>, which folds them onto their canonical
/// COR-032 equivalents using <c>implementation.md</c>'s authoritative mapping table. A transition always
/// PERSISTS the canonical literal, so a legacy row heals the first time it is moved and nothing here ever
/// writes a legacy value. Retiring the legacy four is a documented follow-up — do not "clean them up".
/// </para>
/// </remarks>
public static class ExerciseLifecycleStates
{
    /// <summary><c>build</c> — staff-only content development; participants have no access at all.</summary>
    public const string Build = "build";

    /// <summary><c>staged</c> — participant access is open and the ambient world runs, but the scenario has not started.</summary>
    public const string Staged = "staged";

    /// <summary><c>live</c> — StartEx has occurred: the exercise clock runs and scenario content fires.</summary>
    public const string Live = "live";

    /// <summary><c>paused</c> — the world is held; participants see the holding page (COR-032 / CTL-023).</summary>
    public const string Paused = "paused";

    /// <summary><c>completed</c> — EndEx has occurred. Note the spelling: NOT the legacy <c>complete</c>.</summary>
    public const string Completed = "completed";

    /// <summary><c>archived</c> — the run is closed out and read-only for staff; the terminal state.</summary>
    public const string Archived = "archived";

    /// <summary>Legacy pre-COR-032 literal, mapped to <see cref="Build"/> on read (implementation.md's table).</summary>
    public const string LegacyScheduled = "scheduled";

    /// <summary>Legacy pre-COR-032 literal, mapped to <see cref="Live"/> on read.</summary>
    public const string LegacyActive = "active";

    /// <summary>Legacy pre-COR-032 literal, mapped to <see cref="Completed"/> on read (spelling change only).</summary>
    public const string LegacyComplete = "complete";

    private static readonly IReadOnlyList<string> AllStates =
        [Build, Staged, Live, Paused, Completed, Archived];

    /// <summary>
    /// The allowed transitions (AC2). Read strictly from COR-032's chain
    /// <c>Build → Staged → Live → Paused → Completed (EndEx) → Archived</c>, plus the one transition the
    /// chain's own semantics require but do not spell out: <c>paused → live</c>, because a pause that cannot
    /// be resumed is not a pause.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Everything absent from this table is a 409, on purpose.</b> That includes self-transitions
    /// (<c>live → live</c> is not a no-op success; it is a client that thinks the world is in a state it is
    /// not), every backward move (<c>staged → build</c>, <c>live → staged</c>), every shortcut
    /// (<c>staged → completed</c>, <c>live → archived</c>), and everything out of <c>archived</c>, which is
    /// terminal. Un-staging and abandon-without-EndEx are NOT in COR-032; if <c>exercise-build-golive</c>
    /// needs one, it is a story that widens this table deliberately — not a builder quietly adding an edge.
    /// </para>
    /// </remarks>
    private static readonly Dictionary<string, IReadOnlyList<string>> Allowed =
        new(StringComparer.Ordinal)
        {
            [Build] = [Staged],
            [Staged] = [Live],
            [Live] = [Paused, Completed],
            [Paused] = [Live, Completed],
            [Completed] = [Archived],
            [Archived] = [],
        };

    /// <summary>The six canonical COR-032 literals, in lifecycle order.</summary>
    public static IReadOnlyList<string> All => AllStates;

    /// <summary>
    /// Parses a stored or client-supplied status into its CANONICAL COR-032 literal, folding the legacy four
    /// onto their mapped equivalents (<c>scheduled→build</c>, <c>active→live</c>, <c>complete→completed</c>,
    /// <c>archived</c> unchanged). Matching is ordinal and case-INSENSITIVE on input, but the result is always
    /// the exact lowercase wire literal — so a hand-edited <c>"Live"</c> row is readable while nothing here
    /// can ever emit a cased variant.
    /// </summary>
    /// <param name="raw">The raw status value.</param>
    /// <param name="state">The canonical COR-032 literal on success.</param>
    /// <returns><c>true</c> when the value is a known lifecycle literal (canonical or legacy).</returns>
    public static bool TryParse(string? raw, [NotNullWhen(true)] out string? state)
    {
        state = null;

        var trimmed = raw?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return false;
        }

        state = trimmed.ToLowerInvariant() switch
        {
            Build or LegacyScheduled => Build,
            Staged => Staged,
            Live or LegacyActive => Live,
            Paused => Paused,
            Completed or LegacyComplete => Completed,
            Archived => Archived,
            _ => null,
        };

        return state is not null;
    }

    /// <summary>Whether <paramref name="raw"/> is a known lifecycle literal (canonical or legacy).</summary>
    /// <param name="raw">The raw status value.</param>
    /// <returns><c>true</c> when it parses.</returns>
    public static bool IsKnown(string? raw) => TryParse(raw, out _);

    /// <summary>
    /// The states reachable from <paramref name="state"/>. An unknown state — and <c>archived</c>, which is
    /// terminal — yields an empty list, so a caller can render "no transitions available" without special-casing.
    /// </summary>
    /// <param name="state">A canonical or legacy lifecycle literal.</param>
    /// <returns>The allowed target states, in COR-032 order.</returns>
    public static IReadOnlyList<string> AllowedTransitionsFrom(string? state) =>
        TryParse(state, out var canonical) && Allowed.TryGetValue(canonical, out var targets)
            ? targets
            : [];

    /// <summary>
    /// Whether the machine permits moving from <paramref name="from"/> to <paramref name="to"/>. Both sides
    /// are canonicalized first, so a legacy <c>active</c> row transitions exactly as a <c>live</c> one does.
    /// An unknown state on either side is never allowed (fail closed).
    /// </summary>
    /// <param name="from">The current state.</param>
    /// <param name="to">The requested state.</param>
    /// <returns><c>true</c> when the transition is allowed.</returns>
    public static bool IsTransitionAllowed(string? from, string? to) =>
        TryParse(to, out var target) && AllowedTransitionsFrom(from).Contains(target, StringComparer.Ordinal);

    /// <summary>
    /// <b>The participant-access rule (COR-032, AC3).</b> "Participants can access Staged and Live only" —
    /// plus <c>paused</c>, which is served precisely so the holding page can render (AC6: a paused exercise
    /// must still answer <c>/api/overlay-state</c> with <c>state: pause</c>). The refusal set is therefore
    /// exactly <c>build</c> / <c>completed</c> / <c>archived</c>, matching AC3's explicit list.
    /// </summary>
    /// <remarks>
    /// <b>Fail closed on anything unrecognized.</b> A status literal this machine does not know is NOT
    /// participant-accessible. A typo in the column must blank the participant world rather than open an
    /// unknown one — the same direction the frontend's own <c>isExerciseStatus</c> guard already fails in.
    /// </remarks>
    /// <param name="state">A canonical or legacy lifecycle literal.</param>
    /// <returns><c>true</c> when a participant may be served this exercise.</returns>
    public static bool IsParticipantAccessible(string? state) =>
        TryParse(state, out var canonical)
        && canonical is Staged or Live or Paused;

    /// <summary>
    /// The per-state behaviour hooks (AC7) other subsystems subscribe to instead of each keeping its own copy
    /// of the lifecycle. <c>exercise-build-golive</c> reads the transitions; <c>exercise-clock</c> reads
    /// <see cref="ExerciseLifecycleBehaviour.ClockRuns"/>; E8 reads
    /// <see cref="ExerciseLifecycleBehaviour.AmbientWorldRuns"/> /
    /// <see cref="ExerciseLifecycleBehaviour.ScenarioContentFires"/>.
    /// </summary>
    /// <param name="state">A canonical or legacy lifecycle literal.</param>
    /// <returns>The behaviour hooks for that state; the fully-closed set for an unknown state.</returns>
    public static ExerciseLifecycleBehaviour BehaviourOf(string? state)
    {
        if (!TryParse(state, out var canonical))
        {
            // Fail closed: an unrecognized state runs nothing and admits nobody.
            return ExerciseLifecycleBehaviour.Closed;
        }

        return canonical switch
        {
            // Build: staff-only content development. Nothing runs and no participant is admitted.
            Build => ExerciseLifecycleBehaviour.Closed,

            // Staged: "participant access is open and the ambient world is running, but the scenario has not
            // started" (COR-032). So ambient texture runs, the clock does NOT, and scheduled scenario content
            // is held — the pre-StartEx familiarization state.
            Staged => new ExerciseLifecycleBehaviour
            {
                ParticipantAccessOpen = true,
                ParticipantWritesAccepted = true,
                AmbientWorldRuns = true,
                ClockRuns = false,
                ScenarioContentFires = false,
                IsTerminal = false,
            },

            // Live: StartEx has occurred — the clock runs and scenario content fires.
            Live => new ExerciseLifecycleBehaviour
            {
                ParticipantAccessOpen = true,
                ParticipantWritesAccepted = true,
                AmbientWorldRuns = true,
                ClockRuns = true,
                ScenarioContentFires = true,
                IsTerminal = false,
            },

            // Paused: the world is held behind the holding page. Participants are still SERVED (that is how
            // they see the holding page) but nothing advances and nothing is authored while held.
            Paused => new ExerciseLifecycleBehaviour
            {
                ParticipantAccessOpen = true,
                ParticipantWritesAccepted = false,
                AmbientWorldRuns = false,
                ClockRuns = false,
                ScenarioContentFires = false,
                IsTerminal = false,
            },

            // Completed (EndEx) and Archived: the run is over. Everything is off; archived is terminal.
            Completed => ExerciseLifecycleBehaviour.Closed,
            _ => ExerciseLifecycleBehaviour.Closed with { IsTerminal = true },
        };
    }
}

/// <summary>
/// The documented behaviour hooks of one lifecycle state (AC7) — the single server-side seam
/// <c>exercise-build-golive</c>, <c>exercise-clock</c> (COR-050) and the engine (E8) consume, so none of them
/// keeps a duplicated copy of the state machine.
/// </summary>
/// <remarks>
/// Every flag is a fact COR-032 states about the state, not a policy invented here. Consumers ask this type a
/// question ("may the clock run?") rather than comparing status strings, which is what stops the vocabulary
/// leaking into a dozen <c>Status == "live"</c> comparisons across the codebase.
/// </remarks>
public sealed record ExerciseLifecycleBehaviour
{
    /// <summary>The fully-closed set: nothing runs, nobody is admitted. The fail-closed default.</summary>
    public static ExerciseLifecycleBehaviour Closed { get; } = new();

    /// <summary>Whether a participant may be served this exercise at all (the gating middleware's question).</summary>
    public bool ParticipantAccessOpen { get; init; }

    /// <summary>Whether participant sim WRITES (post/reply/react) are meaningful in this state.</summary>
    /// <remarks>
    /// <b>Advisory in this story, not enforced by it.</b> <c>paused</c> reports <c>false</c> while
    /// <see cref="ParticipantAccessOpen"/> stays <c>true</c> (the holding page must render), but this story's
    /// gating middleware refuses service on <see cref="ParticipantAccessOpen"/> alone — refusing a write in a
    /// paused world is CTL-023's tiered-pause behaviour (world-steering), and adding a second, parallel
    /// enforcement of it here is exactly the duplication hazard 1 forbids.
    /// </remarks>
    public bool ParticipantWritesAccepted { get; init; }

    /// <summary>Whether the ambient (background) world is running — E8's ambient drive.</summary>
    public bool AmbientWorldRuns { get; init; }

    /// <summary>Whether the exercise clock advances (COR-050). Only <c>live</c>.</summary>
    public bool ClockRuns { get; init; }

    /// <summary>Whether scheduled scenario content fires, or is held. Only <c>live</c>.</summary>
    public bool ScenarioContentFires { get; init; }

    /// <summary>Whether the state is terminal (no transition leaves it). Only <c>archived</c>.</summary>
    public bool IsTerminal { get; init; }
}
