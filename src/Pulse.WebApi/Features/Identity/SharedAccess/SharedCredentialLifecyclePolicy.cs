namespace Pulse.WebApi.Features.Identity.SharedAccess;

/// <summary>
/// The single source of truth for the shared-credential lifecycle timing/threshold constants (story 07,
/// COR-016 / NFR-009). Kept in one place so the ROTATION grace window (used by
/// <see cref="SharedCredentialLifecycleService"/>) and the brute-force LOCKOUT threshold/duration (enforced by
/// <see cref="SharedReadOnlyLoginService"/>'s verification) never drift apart between the two slices that share
/// them.
/// </summary>
/// <remarks>
/// <para>
/// <b>Values (chosen defaults, reviewer-tunable).</b>
/// <list type="bullet">
///   <item><description><see cref="GraceWindow"/> = 1 hour. After a rotation the PREVIOUS password keeps working
///   for this long so staff can announce the new one to a room of passive participants without cutting live
///   viewers off mid-session; once it elapses the old password stops authenticating.</description></item>
///   <item><description><see cref="MaxFailedAttempts"/> = 10 consecutive failed shared-login attempts trips the
///   lockout. This is the per-credential brute-force backstop that sits BEHIND story 06's per-IP
///   5-requests/minute rate limit (the first line of defence).</description></item>
///   <item><description><see cref="LockoutDuration"/> = 15 minutes. While locked, EVERY shared-login attempt is
///   rejected — even a correct password — until the window elapses.</description></item>
/// </list>
/// </para>
/// <para>
/// <b>The shared-credential DoS tension (documented for the reviewer).</b> The lockout is per-credential (one
/// row per exercise), so a determined attacker who knows the exercise host could, in principle, keep the shared
/// login locked by feeding wrong passwords. That is an inherent property of a SHARED secret with a global
/// lockout; it is bounded by (a) the per-IP rate limit throttling how fast any one source can burn attempts and
/// (b) a deliberately SHORT lockout window (recovery without staff action), and it is recoverable immediately by
/// a staff rotate (which resets the counter). Raising <see cref="MaxFailedAttempts"/> trades brute-force
/// resistance for fewer malicious/false lockouts.
/// </para>
/// </remarks>
public static class SharedCredentialLifecyclePolicy
{
    /// <summary>How long the previous password keeps authenticating after a rotation before it stops (announce window).</summary>
    public static readonly TimeSpan GraceWindow = TimeSpan.FromHours(1);

    /// <summary>Consecutive failed shared-login attempts that trip the brute-force lockout.</summary>
    public const int MaxFailedAttempts = 10;

    /// <summary>How long the shared login stays locked once the failed-attempt threshold is crossed.</summary>
    public static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(15);
}
