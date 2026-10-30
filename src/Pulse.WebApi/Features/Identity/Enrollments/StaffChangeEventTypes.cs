namespace Pulse.WebApi.Features.Identity.Enrollments;

/// <summary>
/// The XC-004 <c>eventType</c> vocabulary of the STAFF-CHANGE records staged through <see cref="StaffChangeRecorder"/>
/// (ADMIN-IDENTITY-MODEL §7.5): enrollment administration and the engine autonomy levers (#618). Each is written on the
/// <c>system</c> channel with an actor that names the acting person, role and session (or none, for a system action),
/// and is mirrored to the org audit.
/// </summary>
/// <remarks>
/// <b>Naming.</b> Dotted segments whose words are kebab-case (<c>engine.swamped-mode.turned-off</c>) — a family distinct
/// from the engine-LOOP taxonomy (<c>EngineEventTypes</c>: dotted segments in lower_snake, e.g.
/// <c>engine.autonomy_default_changed</c>, actor kind <c>engine</c>). <c>StaffChangeEventTypesTests</c> pins the set and
/// the pattern, so a new staff-change type is a deliberate, reviewed addition.
/// </remarks>
public static class StaffChangeEventTypes
{
    /// <summary>A staff role was granted.</summary>
    public const string EnrollmentGranted = "enrollment.granted";

    /// <summary>A staff enrollment's role was changed.</summary>
    public const string EnrollmentRoleChanged = "enrollment.role.changed";

    /// <summary>A staff enrollment was removed.</summary>
    public const string EnrollmentRevoked = "enrollment.revoked";

    /// <summary>The exercise's lead controller was set.</summary>
    public const string LeadChanged = "enrollment.lead.changed";

    /// <summary>A lead was released because its holder lost the controller grant.</summary>
    public const string LeadReleased = "enrollment.lead.released";

    /// <summary>Swamped mode (timeout auto-send) was turned ON by a controller.</summary>
    public const string SwampedModeTurnedOn = "engine.swamped-mode.turned-on";

    /// <summary>Swamped mode was turned OFF — by a controller, a lead release, the no-lead re-check, or a lead-lost revert.</summary>
    public const string SwampedModeTurnedOff = "engine.swamped-mode.turned-off";

    /// <summary>The manual kill switch (ADP-042) was engaged and moved the safety posture.</summary>
    public const string KillSwitchEngaged = "engine.kill-switch.engaged";

    /// <summary>A controller's restore lifted a safety clamp (kill switch / degraded mode).</summary>
    public const string AutonomyRestored = "engine.autonomy.restored";
}
