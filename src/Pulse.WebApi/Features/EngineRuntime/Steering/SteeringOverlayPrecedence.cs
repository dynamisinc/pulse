namespace Pulse.WebApi.Features.EngineRuntime.Steering;

using System.Threading;
using System.Threading.Tasks;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;

/// <summary>
/// <b>The ONE overlay-precedence rule (Tom's ruling, 2026-07-27: <c>endex</c> &gt; <c>pre-start</c> &gt;
/// <c>pause</c> &gt; <c>none</c>), in one place, because story 08 has TWO participant channels.</b>
/// </summary>
/// <remarks>
/// <para>
/// The pause overlay reaches participants two independent ways: the pull —
/// <c>GET /api/overlay-state</c> via <see cref="SteeringPauseOverlayProjection"/> — and the push —
/// <c>OverlayStateChanged</c> via <see cref="PauseOverlayPublisher"/>, which an already-connected tab renders
/// with no refresh. <b>Gating only the pull is not a partial fix, it is no fix</b> (Gate-1 CR-001): a tab that was
/// already joined to <c>exercise-{id}</c> when EndEx happened is never disconnected —
/// <c>ExerciseLifecycleGatingMiddleware</c>'s own remarks call "nothing publishes into a closed exercise" an
/// ASSUMPTION rather than an invariant — so a Freeze after EndEx would push the in-fiction holding page straight
/// onto a permanently ended exercise while that same tab's re-GET said <c>none</c>. Two channels, one rule; both
/// consumers call THIS method and neither owns a copy of it.
/// </para>
/// <para>
/// <b>Change the ruling here and both channels follow.</b> Whether <c>staged</c> should count as freezable is an
/// open question for Tom (Gate-1 WR-003) — it is one line, in this method, and no consumer needs touching.
/// </para>
/// </remarks>
public static class SteeringOverlayPrecedence
{
    /// <summary>
    /// Whether a controller's Freeze may be made participant-visible while the exercise is in lifecycle state
    /// <paramref name="lifecycleStatus"/> — the "is this exercise actually running" half of the ruling, answered by
    /// COR-032's own behaviour hooks rather than by a second status vocabulary coined here.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The question asked is <see cref="ExerciseLifecycleBehaviour.ClockRuns"/>: scenario time is advancing, so a
    /// Freeze stops something real. That is <c>live</c> alone (plus legacy <c>active</c>, which folds onto it), and
    /// it lands each other state where the ruling puts it:
    /// </para>
    /// <list type="bullet">
    ///   <item><c>build</c> / <c>staged</c> — PRE-START (StartEx has not happened; COR-032 states the scenario has
    ///   not started and the clock does not run). Pre-start outranks pause.</item>
    ///   <item><c>completed</c> / <c>archived</c> — the run is over. ENDEX is terminal; nothing may put a holding
    ///   page over a finished exercise (COR-054).</item>
    ///   <item><c>paused</c> — the lifecycle already authors its own <c>pause</c>, so the participant sees the
    ///   COR-032 holding page regardless; this only means a controller's chosen register does not override the
    ///   composed lifecycle register, which resolves to the fail-closed <c>out-of-fiction</c>. That is the safe
    ///   direction: an out-of-fiction notice cannot HIDE a real stop.</item>
    ///   <item>anything unrecognized, and the "resolved scope but no <c>Exercise</c> row" fallback
    ///   (<c>ExerciseShellConfigSource.Unconfigured</c>, which reports <c>build</c>) — fails closed via
    ///   <see cref="ExerciseLifecycleBehaviour.Closed"/>, inventing no overlay.</item>
    /// </list>
    /// <para>
    /// <b>This gates ADDING a participant overlay only, never REMOVING one.</b> A clearing publish (Resume) is
    /// deliberately never gated — see <see cref="PauseOverlayPublisher"/>. Suppressing a clear would strand a
    /// holding page on a tab that had already received a legitimate Freeze push before the lifecycle moved.
    /// </para>
    /// </remarks>
    /// <param name="lifecycleStatus">A canonical or legacy COR-032 lifecycle literal.</param>
    /// <returns><c>true</c> when a Freeze may be written to the store and pushed to participants.</returns>
    public static bool PauseIsParticipantVisibleIn(string? lifecycleStatus) =>
        ExerciseLifecycleStates.BehaviourOf(lifecycleStatus).ClockRuns;
}

/// <summary>
/// Reads an exercise's COR-032 lifecycle status (<c>Exercise.Status</c>) for the SINGLETON
/// <see cref="PauseOverlayPublisher"/> — the seam that lets a singleton reach request-scoped persistence without
/// taking a captive dependency on it.
/// </summary>
/// <remarks>
/// <para>
/// A one-method delegate rather than a constructor-injected <c>IServiceScopeFactory</c>, mirroring
/// <see cref="PauseTierReader"/> — the seam this slice already uses for exactly this shape of problem.
/// <see cref="PauseOverlayServiceCollectionExtensions.AddPauseParticipantOverlay"/> registers it as a factory that
/// opens its own scope per call and reads through a scoped <c>PulseDbContext</c>. Two things fall out:
/// </para>
/// <list type="bullet">
///   <item>the publisher's constructor still takes NO persistence type, so AC7's
///   <c>PauseOverlayWritePath_TakesNoTelemetryOrPersistenceDependency</c> stays an honest assertion rather than
///   something that had to be weakened;</item>
///   <item>the publisher's unit suite stays database-free while still being able to vary the lifecycle state,
///   which is what the suppression tests need.</item>
/// </list>
/// <para>
/// <b>Isolation (COR-001).</b> The parameter is always the SERVER-resolved exercise off
/// <see cref="PauseTierTransition.ExerciseId"/>. <c>Exercise</c> is the scope rather than an
/// <c>IExerciseScoped</c> entity, so this is a direct read by that id — never a client-supplied one.
/// </para>
/// </remarks>
/// <param name="exerciseId">The server-resolved exercise (COR-001).</param>
/// <param name="cancellationToken">Cancellation token.</param>
/// <returns>The raw stored status literal, or <c>null</c> when the exercise row does not exist.</returns>
public delegate Task<string?> ExerciseLifecycleStatusReader(Guid exerciseId, CancellationToken cancellationToken);
