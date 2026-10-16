namespace Pulse.WebApi.Features.Identity.Staff;

using Pulse.WebApi.Data.Entities;

/// <summary>
/// The per-<see cref="Person"/> progressive sign-in lockout (ADMIN-IDENTITY-MODEL §3.2, identity-auth-roles/15):
/// 5 failures lock the person out for 15 minutes, each further failure doubles it, capped at 4 hours. It sits
/// alongside — never instead of — the per-IP staff-login limiter. A disabled person is treated as blocked too.
/// </summary>
public static class StaffSignInLockout
{
    /// <summary>The failure count at which the first lockout applies.</summary>
    public const int Threshold = 5;

    /// <summary>The first lockout's length.</summary>
    public static readonly TimeSpan BaseDuration = TimeSpan.FromMinutes(15);

    /// <summary>The longest lockout.</summary>
    public static readonly TimeSpan MaxDuration = TimeSpan.FromHours(4);

    /// <summary>Whether <paramref name="person"/> may not sign in right now (locked out, or disabled).</summary>
    /// <param name="person">The candidate person.</param>
    /// <param name="now">The server clock.</param>
    /// <returns><c>true</c> when the person must be skipped without verifying a password.</returns>
    public static bool IsBlocked(Person person, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(person);
        return person.DisabledAt is not null || (person.LockedOutUntil is { } until && until > now);
    }

    /// <summary>Records one failed attempt, locking the person out once the threshold is reached.</summary>
    /// <param name="person">The (tracked) person the attempt failed against.</param>
    /// <param name="now">The server clock.</param>
    public static void RecordFailure(Person person, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(person);

        person.FailedLoginCount++;
        if (person.FailedLoginCount < Threshold)
        {
            return;
        }

        // 15 min × 2^(failures beyond the threshold), capped. The exponent is bounded so the shift cannot overflow.
        var doublings = Math.Min(person.FailedLoginCount - Threshold, 10);
        var duration = TimeSpan.FromTicks(BaseDuration.Ticks << doublings);
        person.LockedOutUntil = now + (duration > MaxDuration ? MaxDuration : duration);
    }

    /// <summary>Clears the failure counter and any lockout after a verified password.</summary>
    /// <param name="person">The (tracked) person that verified.</param>
    public static void RecordSuccess(Person person)
    {
        ArgumentNullException.ThrowIfNull(person);

        person.FailedLoginCount = 0;
        person.LockedOutUntil = null;
    }
}
