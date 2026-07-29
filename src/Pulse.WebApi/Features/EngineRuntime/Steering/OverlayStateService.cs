namespace Pulse.WebApi.Features.EngineRuntime.Steering;

using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Threading;

/// <summary>
/// The PARTICIPANT-facing overlay wire vocabulary — the exact literals the frozen frontend unions use
/// (<c>OverlayStateKind</c> = <c>'none' | 'pause' | 'endex' | 'broadcast'</c> and <c>OverlayRegister</c> =
/// <c>'in-fiction' | 'out-of-fiction'</c>, see
/// <c>features/participant-shell/components/OverlayLayer/types.ts</c>). The frozen client is the seam, so these
/// are string constants rather than a C# enum: the wire value is guaranteed to be <c>"in-fiction"</c> verbatim,
/// never a PascalCase enum name.
///
/// <para>Only the two states this feature writes are named here — <see cref="None"/> and <see cref="Pause"/>.
/// <c>'broadcast'</c> (Break Fiction, world-steering story 04) and <c>'endex'</c> (COR-054) are deliberately
/// absent: they are other stories' write paths, and nothing in this slice may set them.</para>
/// </summary>
public static class OverlayStateWire
{
    /// <summary><c>none</c> — no overlay; the participant shell renders nothing extra.</summary>
    public const string None = "none";

    /// <summary><c>pause</c> — the calm holding page a WORLD FROZEN shows participants (CTL-023, D7-004).</summary>
    public const string Pause = "pause";

    /// <summary><c>in-fiction</c> — the fiction-preserving register ("We'll be right back").</summary>
    public const string InFiction = "in-fiction";

    /// <summary><c>out-of-fiction</c> — the calm slate/mono register that names the exercise ("EXERCISE PAUSED").</summary>
    public const string OutOfFiction = "out-of-fiction";

    /// <summary>
    /// Validates a CLIENT-SUPPLIED overlay register against the two contract literals, FAILING CLOSED to
    /// <see cref="OutOfFiction"/>: only an exact <c>in-fiction</c> selects the fiction-preserving register, and
    /// anything else — <c>null</c>, an omitted field, a case variant, a bogus literal — becomes
    /// <c>out-of-fiction</c>.
    ///
    /// <para><b>Why out-of-fiction is the conservative default.</b> An out-of-fiction notice ("EXERCISE PAUSED")
    /// is safe when the fiction is already broken; wrongly staying in-fiction ("We'll be right back") would HIDE a
    /// real stop from participants. The register is presentation only, so an unrecognised value is coerced rather
    /// than refused — a typo must never block the safety action the Freeze is.</para>
    /// </summary>
    /// <param name="raw">The client-supplied register literal, or <c>null</c>.</param>
    /// <returns><see cref="InFiction"/> for an exact <c>in-fiction</c>; otherwise <see cref="OutOfFiction"/>.</returns>
    public static string CoerceRegister(string? raw) =>
        string.Equals(raw, InFiction, StringComparison.Ordinal) ? InFiction : OutOfFiction;
}

/// <summary>
/// One exercise's PARTICIPANT-VISIBLE overlay state, plus the monotonic <see cref="Sequence"/> that stamps how
/// recent it is. This record is the ONLY thing a participant projection is built from, and it structurally
/// carries no staff field at all — no acting human, no pause tier, no provenance (XC-002).
/// </summary>
/// <param name="State">The overlay kind — an <see cref="OverlayStateWire"/> literal (<c>none</c>/<c>pause</c>).</param>
/// <param name="Register">Which register a <c>pause</c> page renders in — an <see cref="OverlayStateWire"/> literal.</param>
/// <param name="Message">
/// The overlay message. ALWAYS empty in this feature: holding-page content authoring (COR-032) is out of scope,
/// so the participant shell renders its own static, generic copy. The field exists for wire parity with the
/// frozen <c>OverlayState</c> triple (Break Fiction, story 04, is what will one day populate it).
/// </param>
/// <param name="Sequence">
/// The monotonic write sequence this snapshot was applied at (0 = never written), counted PER EXERCISE. Used to
/// make the overlay converge under out-of-order writes/pushes — see <see cref="OverlayStateService"/>.
/// <para><b>Per-exercise by design (XC-002/COR-001).</b> This is the one number on a participant-visible payload,
/// so it must be derived from THIS exercise's own overlay writes and nothing else. A host-global counter would
/// have made it a coarse side channel about other exercises' activity ("13 overlay writes happened somewhere on
/// this host") — harmless-looking, but a cross-exercise-derived value on a participant wire is exactly what
/// XC-002 exists to prevent.</para>
/// </param>
public sealed record OverlayStateSnapshot(string State, string Register, string Message, long Sequence);

/// <summary>
/// The server-authoritative PARTICIPANT-OVERLAY store (feature: world-steering, story 08; CTL-023, COR-001,
/// XC-001/XC-002). Holds ONE independently mutable overlay state per exercise — keyed by <c>exerciseId</c> in a
/// <see cref="ConcurrentDictionary{TKey,TValue}"/> exactly the way <see cref="PauseTierRegistry"/> and
/// <see cref="Clock.ExerciseClockService"/> key their own runtime state — and is what
/// <c>GET /api/overlay-state</c> reads instead of the static <c>'none'</c> constant it returned before this
/// story.
///
/// <para><b>Isolation (COR-001, always-Critical).</b> Isolation is structural: there is no shared overlay
/// state. A Freeze on exercise A writes A's key and can never be read under B's — <see cref="Get"/> for an
/// exercise that was never written (or for <see cref="Guid.Empty"/>, the fail-closed unresolved scope) returns
/// the CLEARED snapshot, never another exercise's. Nothing in this type accepts a client-supplied exercise id:
/// every caller passes the server-resolved scope.</para>
///
/// <para><b>Out-of-order convergence (the story-07 review's SG-206 note).</b>
/// <see cref="PauseTierRegistry"/> publishes a transition OUTSIDE its own <c>_gate</c> (you cannot await inside
/// a lock), so two rapid transitions can reach <see cref="IPauseOverlayPublisher"/> in either order, and a late
/// stale one must not be able to leave a Freeze overlay on a resumed world. Two mechanisms combine:
/// <list type="number">
///   <item><see cref="NextSequence"/> hands every publish a monotonic ticket BEFORE it reads the authoritative
///   tier, and <see cref="Apply"/> IGNORES a write whose sequence is older than the stored one — so the store
///   settles on the highest-sequence write;</item>
///   <item>the publisher does not trust <c>transition.To</c>: it reads the tier from
///   <see cref="PauseTierRegistry"/> at publish time. Because the last-invoked publish necessarily holds the
///   highest ticket AND reads the registry after the final tier was recorded, the surviving write is the TRUE
///   final state.</item>
/// </list>
/// Neither mechanism alone is sufficient (a ticket alone would faithfully persist a stale <c>transition.To</c>;
/// an authoritative read alone could still be overwritten by a slower stale writer), which is why both are
/// here.</para>
///
/// <para><b>In-memory, not persisted.</b> A singleton runtime service, with the same accepted limitation
/// <see cref="Clock.ExerciseClockService"/> and <see cref="PauseTierRegistry"/> already carry: an App Service
/// restart clears the overlays (and the participant's next reconnect re-GETs, so it heals to <c>none</c> —
/// never to a stuck holding page). It is deliberately NOT an
/// <see cref="Pulse.WebApi.Data.IExerciseScoped"/> entity: no schema change belongs in a behaviour-only wave.</para>
///
/// <para><b>No telemetry (XC-004).</b> The ONE <c>steering_action</c> event per pause transition is emitted by
/// the console (story 03/07). This store emits nothing, so a Freeze can never produce a competing or duplicate
/// audit record.</para>
/// </summary>
public sealed class OverlayStateService
{
    private readonly ConcurrentDictionary<Guid, OverlayStateSnapshot> _states = new();

    // One ticket counter PER EXERCISE (SG-001): the sequence rides a participant-visible payload, so it must
    // never be derived from another exercise's activity. A StrongBox holds the counter so the increment is a
    // plain Interlocked on a field — unambiguously atomic, without depending on AddOrUpdate's retry semantics.
    private readonly ConcurrentDictionary<Guid, StrongBox<long>> _sequences = new();

    /// <summary>
    /// The CLEARED overlay — no overlay active. What an exercise that has never been frozen reads, what a
    /// Resume writes, and the fail-closed answer for an unresolved/empty scope: this feature never fails OPEN
    /// into showing participants an overlay nobody triggered.
    /// </summary>
    public static OverlayStateSnapshot Cleared { get; } =
        new(OverlayStateWire.None, OverlayStateWire.InFiction, string.Empty, 0);

    /// <summary>
    /// Takes exercise <paramref name="exerciseId"/>'s next monotonic write ticket. Taken by a publisher BEFORE it
    /// reads the authoritative pause tier, so the last-invoked publish for that exercise holds the highest ticket
    /// (see the type's out-of-order note).
    ///
    /// <para>Counted per exercise, so the participant-visible <see cref="OverlayStateSnapshot.Sequence"/> reveals
    /// nothing about any other exercise (SG-001) — and the client's own stale-push cutoff compares only values
    /// from its own exercise, which is all it ever sees.</para>
    /// </summary>
    /// <param name="exerciseId">The SERVER-resolved exercise the ticket belongs to (COR-001).</param>
    /// <returns>A strictly increasing sequence number for that exercise, starting at 1.</returns>
    public long NextSequence(Guid exerciseId)
    {
        if (exerciseId == Guid.Empty)
        {
            throw new ArgumentException("An overlay-state ticket must name an exercise (COR-001).", nameof(exerciseId));
        }

        return Interlocked.Increment(ref _sequences.GetOrAdd(exerciseId, _ => new StrongBox<long>(0L)).Value);
    }

    /// <summary>
    /// The overlay state exercise <paramref name="exerciseId"/> is currently in. An exercise that has never
    /// been frozen — and the empty (unresolved) scope — reads <see cref="Cleared"/>, never another exercise's
    /// overlay (COR-001).
    /// </summary>
    /// <param name="exerciseId">The SERVER-resolved exercise whose overlay to read.</param>
    /// <returns>That exercise's overlay snapshot, or <see cref="Cleared"/>.</returns>
    public OverlayStateSnapshot Get(Guid exerciseId) =>
        exerciseId != Guid.Empty && _states.TryGetValue(exerciseId, out var snapshot) ? snapshot : Cleared;

    /// <summary>
    /// Records <paramref name="state"/>/<paramref name="register"/> as exercise
    /// <paramref name="exerciseId"/>'s overlay, unless a NEWER write already landed (a write whose
    /// <paramref name="sequence"/> is not greater than the stored one is dropped — see the type's out-of-order
    /// note). Returns whatever the store holds afterwards, so a caller broadcasts the CURRENT state rather than
    /// the one it hoped to write.
    /// </summary>
    /// <param name="exerciseId">The SERVER-resolved exercise (COR-001); must not be <see cref="Guid.Empty"/>.</param>
    /// <param name="state">The overlay kind — an <see cref="OverlayStateWire"/> literal.</param>
    /// <param name="register">The register — an <see cref="OverlayStateWire"/> literal.</param>
    /// <param name="sequence">This write's ticket from <see cref="NextSequence"/>.</param>
    /// <returns>The authoritative snapshot after the write (this write's, or the newer one that beat it).</returns>
    public OverlayStateSnapshot Apply(Guid exerciseId, string state, string register, long sequence)
    {
        if (exerciseId == Guid.Empty)
        {
            throw new ArgumentException("An overlay-state write must name an exercise (COR-001).", nameof(exerciseId));
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(state);
        ArgumentException.ThrowIfNullOrWhiteSpace(register);

        // Message is deliberately NOT a parameter: holding-page authoring (COR-032) is out of scope, so this
        // feature can only ever write the empty message the participant shell's static copy expects.
        var candidate = new OverlayStateSnapshot(state, register, string.Empty, sequence);

        return _states.AddOrUpdate(
            exerciseId,
            candidate,
            (_, existing) => existing.Sequence >= sequence ? existing : candidate);
    }

    /// <summary>
    /// TEST-ONLY reset: clears every exercise's overlay and the sequence counter. Production has one long-lived
    /// store per host.
    /// </summary>
    internal void ResetForTests()
    {
        _states.Clear();
        _sequences.Clear();
    }
}
