namespace Pulse.WebApi.Features.EngineRuntime;

using System.Globalization;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Autonomy.Services;
using Pulse.WebApi.Features.Identity.Enrollments;

/// <summary>
/// The record vocabulary of the three in-memory autonomy steering levers (issue #618): swamped mode on/off, the kill
/// switch and the restore. Each lever that really changes the exercise's autonomy state is recorded twice through the
/// shared <see cref="StaffChangeRecorder"/> — one XC-004 event on the exercise and one org-audit row on the
/// organization — exactly like the lead-release swamped-off flip (<see cref="EnrollmentService.SwampedModeOffEventType"/>).
/// </summary>
/// <remarks>
/// <para>
/// <b>Why these are not in <c>EngineEventTypes</c>.</b> These are STAFF-CHANGE records (channel <c>system</c>, an
/// actor carrying the acting person, role and session, mirrored to the org audit), the family
/// <see cref="EnrollmentService.SwampedModeOffEventType"/> already belongs to — so they share its dotted-kebab naming
/// (<c>engine.swamped-mode.turned-off</c>), and the OFF lever REUSES that exact type and audit kind rather than coining
/// a second name for the same change. <c>EngineEventTypes</c> is the engine LOOP taxonomy (lower_snake, actor kind
/// <c>engine</c>), pinned by <c>EngineEventTaxonomyTests</c>.
/// </para>
/// <para>
/// <b>Payload.</b> Every payload carries the scenario minute the lever acted at and the previous + new state; the
/// payload is opaque <c>nvarchar(max)</c>, shared verbatim by the event and the audit row, and never carries an
/// identity (the actor is on the envelope).
/// </para>
/// </remarks>
public static class EngineSteeringLeverRecords
{
    /// <summary>The XC-004 event type of swamped mode turned ON by a controller.</summary>
    public const string SwampedModeOnEventType = "engine.swamped-mode.turned-on";

    /// <summary>The XC-004 event type of swamped mode turned OFF — the SAME type the lead-release / no-lead paths record.</summary>
    public const string SwampedModeOffEventType = EnrollmentService.SwampedModeOffEventType;

    /// <summary>The XC-004 event type of the manual kill switch engaged (ADP-042).</summary>
    public const string KillSwitchEngagedEventType = "engine.kill-switch.engaged";

    /// <summary>The XC-004 event type of a safety clamp (kill switch / degraded mode) lifted by a controller's restore.</summary>
    public const string AutonomyRestoredEventType = "engine.autonomy.restored";

    /// <summary>The org-audit kind of swamped mode turned ON.</summary>
    public const string SwampedModeOnAuditKind = "org.engine.swamped-mode-on";

    /// <summary>The org-audit kind of swamped mode turned OFF — the SAME kind the lead-release / no-lead paths record.</summary>
    public const string SwampedModeOffAuditKind = EnrollmentService.SwampedModeOffAuditKind;

    /// <summary>The org-audit kind of the kill switch engaged.</summary>
    public const string KillSwitchEngagedAuditKind = "org.engine.kill-switch-engaged";

    /// <summary>The org-audit kind of a safety clamp lifted by a restore.</summary>
    public const string AutonomyRestoredAuditKind = "org.engine.autonomy-restored";

    /// <summary>The swamped-mode payload <c>reason</c> when a controller flipped it through the cockpit route.</summary>
    public const string ControllerReason = "controller";

    /// <summary>The safety posture with no clamp: generation runs at the configured levels.</summary>
    public const string PostureRunning = "running";

    /// <summary>The safety posture clamped to Suggest (kill switch drop-to-suggest, or the degraded-mode clamp).</summary>
    public const string PostureClamped = "clamped";

    /// <summary>The safety posture fully stopped (kill switch full-stop): no generation at all.</summary>
    public const string PostureStopped = "stopped";

    /// <summary>The kebab wire literal of a kill-switch mode (the same literal the route accepts).</summary>
    /// <param name="mode">The mode.</param>
    /// <returns><c>drop-to-suggest</c> or <c>full-stop</c>.</returns>
    public static string ModeLiteral(KillSwitchMode mode) => mode == KillSwitchMode.FullStop ? "full-stop" : "drop-to-suggest";

    /// <summary>The safety posture of an autonomy state: <see cref="PostureStopped"/>, <see cref="PostureClamped"/> or <see cref="PostureRunning"/>.</summary>
    /// <param name="state">The exercise's autonomy state.</param>
    /// <returns>The posture literal.</returns>
    public static string PostureOf(EngineAutonomyState state)
    {
        ArgumentNullException.ThrowIfNull(state);
        return PostureOf(state.IsGenerationStopped, state.SafetyClampActive);
    }

    /// <summary>The safety posture of the given flags.</summary>
    /// <param name="generationStopped">Whether generation is fully stopped.</param>
    /// <param name="safetyClampActive">Whether any safety clamp is active.</param>
    /// <returns>The posture literal.</returns>
    public static string PostureOf(bool generationStopped, bool safetyClampActive) =>
        generationStopped ? PostureStopped : safetyClampActive ? PostureClamped : PostureRunning;

    /// <summary>The swamped-mode payload: <c>{"reason":"controller","wasOn":…,"isOn":…,"scenarioMinute":…}</c>.</summary>
    /// <param name="wasOn">The state before the lever.</param>
    /// <param name="isOn">The state after it.</param>
    /// <param name="scenarioMinute">The scenario minute the lever acted at.</param>
    /// <returns>The JSON payload.</returns>
    public static string SwampedModePayload(bool wasOn, bool isOn, int scenarioMinute) => string.Create(
        CultureInfo.InvariantCulture,
        $"{{\"reason\":\"{ControllerReason}\",\"wasOn\":{Bool(wasOn)},\"isOn\":{Bool(isOn)},\"scenarioMinute\":{scenarioMinute}}}");

    /// <summary>The kill-switch payload: <c>{"mode":…,"fromPosture":…,"toPosture":…,"scenarioMinute":…}</c>.</summary>
    /// <param name="mode">The engaged mode.</param>
    /// <param name="fromPosture">The posture before.</param>
    /// <param name="toPosture">The posture after.</param>
    /// <param name="scenarioMinute">The scenario minute the lever acted at.</param>
    /// <returns>The JSON payload.</returns>
    public static string KillSwitchPayload(KillSwitchMode mode, string fromPosture, string toPosture, int scenarioMinute) => string.Create(
        CultureInfo.InvariantCulture,
        $"{{\"mode\":\"{ModeLiteral(mode)}\",\"fromPosture\":\"{fromPosture}\",\"toPosture\":\"{toPosture}\",\"scenarioMinute\":{scenarioMinute}}}");

    /// <summary>The restore payload: <c>{"fromPosture":…,"toPosture":…,"scenarioMinute":…}</c>.</summary>
    /// <param name="fromPosture">The posture before.</param>
    /// <param name="toPosture">The posture after.</param>
    /// <param name="scenarioMinute">The scenario minute the lever acted at.</param>
    /// <returns>The JSON payload.</returns>
    public static string RestorePayload(string fromPosture, string toPosture, int scenarioMinute) => string.Create(
        CultureInfo.InvariantCulture,
        $"{{\"fromPosture\":\"{fromPosture}\",\"toPosture\":\"{toPosture}\",\"scenarioMinute\":{scenarioMinute}}}");

    private static string Bool(bool value) => value ? "true" : "false";
}
