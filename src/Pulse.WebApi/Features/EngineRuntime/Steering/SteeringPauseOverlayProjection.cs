namespace Pulse.WebApi.Features.EngineRuntime.Steering;

using System.Threading;
using System.Threading.Tasks;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Features.ParticipantShell;

/// <summary>
/// The CTL-023 pause CONTRIBUTOR to <c>GET /api/overlay-state</c>'s <see cref="IOverlayStateProjection"/> seam
/// (feature: world-steering, story 08). It DECORATES <see cref="LifecycleOverlayStateProjection"/> rather than
/// replacing the overlay read: the exercise lifecycle is consulted first and its answer is final, and only when
/// the lifecycle authors no overlay AND the exercise is genuinely running is this exercise's
/// <see cref="OverlayStateService"/> snapshot consulted.
/// </summary>
/// <remarks>
/// <para>
/// <b>The ordered chain (Tom's ruling, 2026-07-27): <c>endex</c> &gt; <c>pre-start</c> &gt; <c>pause</c> &gt;
/// <c>none</c>.</b> The lifecycle answers "is this exercise live at all"; a controller's Freeze is a control
/// WITHIN a live exercise. ENDEX especially must be terminal — rendering the in-fiction "We'll be right back"
/// after an exercise has permanently ended would be an outright lie to participants (COR-054). A Freeze still
/// wins whenever the exercise is actually running, which is the only time a Freeze means anything.
/// </para>
/// <para>
/// <b>Why this is a decorator and not a rewrite.</b> Story 08 originally replaced the overlay-state handler in
/// the shared <c>ParticipantShellEndpoints.cs</c> to read its pause store directly, which silently discarded the
/// lifecycle's claim on the same single overlay slot. This type instead delegates: every lifecycle rule
/// (<see cref="LifecycleOverlayComposer"/>, its Tier-2-signed register join, its <c>Replace</c>-registered
/// projection) keeps running unmodified and unduplicated, and world-steering contributes exactly one thing —
/// the pause snapshot, in the one position the ruling gives it. Story 08 therefore edits neither
/// <c>ParticipantShellEndpoints.cs</c> nor <c>Program.cs</c>.
/// </para>
/// <para>
/// <b>Why <see cref="ISteeringOverlaySource"/> is deliberately LEFT at its no-op floor — do not "finish the
/// merge" by registering it.</b> <see cref="LifecycleProjection"/>'s remarks invite the world-steering merge to
/// contribute an <see cref="ISteeringOverlaySource"/> adapter, and that seam is a genuinely good fit for a
/// steering overlay that is joined field-by-field with a lifecycle pause. It cannot express THIS ruling, though:
/// <see cref="LifecycleOverlayComposer"/>'s rule 2 makes the composed state a <c>pause</c> if EITHER side asks
/// for one, and the source is handed only an exercise id — never the lifecycle status — so it cannot decline. A
/// frozen world that has since reached EndEx (<c>completed</c>) would compose to <c>pause</c> and show
/// participants the holding page over a finished exercise: precisely the failure the ruling forbids. Registering
/// the adapter as well as this decorator would reintroduce that through the inner projection, where this outer
/// gate can no longer see which side contributed. One mechanism, in one place. Pinned by
/// <c>SteeringCompositionRootWiringTests.ProgramCs_LeavesTheSteeringOverlaySourceAtItsNoOpFloor_ByDesign</c>.
/// </para>
/// <para>
/// <b>Isolation (COR-001, always-Critical).</b> The exercise comes from
/// <see cref="ExerciseShellConfigSource.ExerciseId"/>, which
/// <see cref="ParticipantShellConfigService"/> populates from the SERVER-resolved
/// <see cref="Pulse.WebApi.Data.IExerciseContext"/> alone — never a route, query or body value. An unresolved
/// scope never reaches a projection at all (the service returns <c>null</c> and the endpoint 401s), and
/// <see cref="OverlayStateService.Get"/> answers the cleared snapshot for
/// <see cref="Guid.Empty"/>, so there is no path by which exercise B reads exercise A's Freeze.
/// </para>
/// <para>
/// <b>XC-002 / COR-053.</b> The only input to the pause branch is an <see cref="OverlayStateSnapshot"/>, a record
/// that structurally carries no staff field — no <c>actingHumanId</c> (COR-018), no <see cref="PauseTier"/> staff
/// vocabulary, no timestamp of any kind. The output is the unchanged frozen three-field
/// <see cref="OverlayStateResponse"/>. Note that the snapshot's additive <c>sequence</c> is NOT projected: the
/// frozen shape carries three keys and the frontend's own wire guard types <c>sequence</c> as optional for
/// exactly this body (a sequence-less GET re-bases the client's stale-push cutoff to 0, so later pushes are still
/// accepted — it degrades permissively, never into a stuck holding page).
/// </para>
/// <para>
/// <b>XC-004.</b> A read path emits nothing. Story 07's one <c>steering_action</c> event per pause transition
/// remains the sole audit record of the causal action.
/// </para>
/// <para>
/// <b>⚠ FORWARD COLLISION with Break Fiction (world-steering story 04) — read this before adding a
/// <c>broadcast</c> writer (Gate-1 SG-003).</b> Step 1 below treats the lifecycle's answer as FINAL, which is
/// correct for the two states the lifecycle can author today (<c>none</c> and a COR-032 <c>pause</c>) but
/// <b>inverts <see cref="LifecycleOverlayComposer"/>'s rule 1</b> the moment
/// <see cref="OverlayStateService"/> can hold a <c>broadcast</c>: a lifecycle <c>paused</c> exercise would
/// suppress an authored controller broadcast, and rule 1 exists precisely because "hiding a Break Fiction
/// broadcast behind 'We'll be right back' is a safety failure, not a cosmetic one". Nothing breaks today —
/// story 04 is deferred and <see cref="OverlayStateWire"/> deliberately names no <c>broadcast</c> literal, so
/// this store can only ever hold <c>none</c>/<c>pause</c>. <b>Whoever builds story 04 must change this class,
/// not just add a writer:</b> a non-<c>pause</c> steering state has to be checked BEFORE the lifecycle result
/// is returned, and must outrank a lifecycle <c>pause</c> exactly as rule 1 specifies (while still yielding to
/// a terminal ENDEX, which is this story's ruling). Pinned by
/// <c>SteeringPauseOverlayProjectionTests.ABroadcastStateInTheStore_IsNotYetReachable_AndIsTheDocumentedStory04Collision</c>.
/// </para>
/// </remarks>
public sealed class SteeringPauseOverlayProjection : IOverlayStateProjection
{
    private readonly LifecycleOverlayStateProjection _lifecycleProjection;
    private readonly OverlayStateService _overlayStates;

    /// <summary>Creates the contributor over the lifecycle projection it decorates and the pause store.</summary>
    /// <param name="lifecycleProjection">
    /// The COR-032 projection this one composes. Depended on as the CONCRETE type on purpose: this class is
    /// registered AS <see cref="IOverlayStateProjection"/>, so injecting that interface would resolve this class
    /// again and stack-overflow on the first request. Taking the implementation type makes the recursion
    /// impossible to write rather than merely avoided.
    /// </param>
    /// <param name="overlayStates">
    /// The per-exercise pause store the real <see cref="PauseOverlayPublisher"/> writes. A SINGLETON consumed by
    /// this SCOPED projection, which is the safe direction — the reverse (a singleton capturing a scoped
    /// dependency) is the captive-dependency bug, and <c>BuildServiceProvider(validateScopes: true)</c> in the
    /// composition suites would fail on it.
    /// </param>
    public SteeringPauseOverlayProjection(
        LifecycleOverlayStateProjection lifecycleProjection,
        OverlayStateService overlayStates)
    {
        ArgumentNullException.ThrowIfNull(lifecycleProjection);
        ArgumentNullException.ThrowIfNull(overlayStates);

        _lifecycleProjection = lifecycleProjection;
        _overlayStates = overlayStates;
    }

    /// <inheritdoc />
    public async Task<OverlayStateResponse> ProjectAsync(
        ExerciseShellConfigSource source,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);

        // 1. LIFECYCLE FIRST, and its answer is final. endex / the COR-032 holding page / a broadcast composed in
        //    below it all reach the participant unchanged — this decorator can only ever ADD a pause where the
        //    lifecycle authored no overlay, never suppress or reshape one it did.
        var lifecycleOverlay = await _lifecycleProjection.ProjectAsync(source, cancellationToken);
        if (!IsNoOverlay(lifecycleOverlay))
        {
            return lifecycleOverlay;
        }

        // 2. The lifecycle authored nothing — but is the exercise LIVE at all? Pre-start and post-EndEx worlds
        //    keep the lifecycle's answer; a Freeze means nothing there. The SAME predicate gates the PUSH side in
        //    PauseOverlayPublisher — one rule, one place (see SteeringOverlayPrecedence).
        if (!SteeringOverlayPrecedence.PauseIsParticipantVisibleIn(source.Status))
        {
            return lifecycleOverlay;
        }

        // 3. A running world: the controller's Freeze is the participant-visible truth (CTL-023, D5-014/1.3).
        var snapshot = _overlayStates.Get(source.ExerciseId);

        // SG-004: the STATE is allowlisted on the read path, symmetrically with the register below. This slice
        // writes only 'none'/'pause', so anything else in the store is either corruption or a future writer that
        // has not been reconciled with the precedence chain (see the SG-003 collision note on this type) — and the
        // fail-closed answer to both is "serve the lifecycle's overlay, invent nothing".
        if (!string.Equals(snapshot.State, OverlayStateWire.Pause, StringComparison.Ordinal))
        {
            return lifecycleOverlay;
        }

        return new OverlayStateResponse
        {
            State = OverlayStateWire.Pause,
            // Re-coerced on the READ path as well as the write path: a register that is not exactly 'in-fiction'
            // serves as 'out-of-fiction', so no coined literal can reach the frozen client union even if some
            // future writer skipped OverlayStateWire.CoerceRegister.
            Register = OverlayStateWire.CoerceRegister(snapshot.Register),
            Message = snapshot.Message,
        };
    }

    private static bool IsNoOverlay(OverlayStateResponse overlay) =>
        string.Equals(overlay.State, OverlayStateWire.None, StringComparison.Ordinal);
}
