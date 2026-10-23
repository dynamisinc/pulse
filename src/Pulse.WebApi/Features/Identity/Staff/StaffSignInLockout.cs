namespace Pulse.WebApi.Features.Identity.Staff;

using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The per-<see cref="Person"/> progressive sign-in lockout (ADMIN-IDENTITY-MODEL §3.2, identity-auth-roles/15):
/// 5 failures lock the person out for 15 minutes, each further failure doubles it, capped at 4 hours. It sits
/// alongside — never instead of — the per-IP staff-login limiter. A disabled person is treated as blocked too.
/// </summary>
/// <remarks>
/// <b>Failures are counted atomically (#602 L-4).</b> <see cref="RecordFailureAsync"/> is ONE <c>UPDATE</c> whose
/// right-hand sides read the row's pre-update values, so N concurrent failed attempts against one person always add
/// exactly N — a read-modify-write of a tracked entity would let parallel attempts overwrite each other's increment
/// and undercount the lockout. The lockout instant is computed in the same statement from the incremented count, by
/// the same rule as <see cref="LockoutDuration"/>.
/// </remarks>
public static class StaffSignInLockout
{
    /// <summary>The failure count at which the first lockout applies.</summary>
    public const int Threshold = 5;

    /// <summary>The most doublings applied beyond the threshold (bounds the shift so it cannot overflow).</summary>
    private const int MaxDoublings = 10;

    /// <summary>The first lockout's length.</summary>
    public static readonly TimeSpan BaseDuration = TimeSpan.FromMinutes(15);

    /// <summary>The longest lockout.</summary>
    public static readonly TimeSpan MaxDuration = TimeSpan.FromHours(4);

    /// <summary>Whether <paramref name="person"/> may not sign in right now (locked out, or disabled).</summary>
    /// <param name="person">The candidate person.</param>
    /// <param name="now">The server clock.</param>
    /// <returns><c>true</c> when the person must be refused (their password is never verified for real).</returns>
    public static bool IsBlocked(Person person, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(person);
        return person.DisabledAt is not null || (person.LockedOutUntil is { } until && until > now);
    }

    /// <summary>
    /// The lockout length after the <paramref name="failureCount"/>-th consecutive failure: none below
    /// <see cref="Threshold"/>, then 15 min × 2^(failures beyond the threshold), capped at <see cref="MaxDuration"/>.
    /// </summary>
    /// <param name="failureCount">The failure count INCLUDING the failure being recorded.</param>
    /// <returns>The lockout length, or <c>null</c> below the threshold.</returns>
    public static TimeSpan? LockoutDuration(int failureCount)
    {
        if (failureCount < Threshold)
        {
            return null;
        }

        var doublings = Math.Min(failureCount - Threshold, MaxDoublings);
        var duration = TimeSpan.FromTicks(BaseDuration.Ticks << doublings);
        return duration > MaxDuration ? MaxDuration : duration;
    }

    /// <summary>
    /// Records one failed attempt against <paramref name="person"/> ATOMICALLY in the database (one <c>UPDATE</c>,
    /// executed immediately — not staged in the caller's unit of work): <c>FailedLoginCount + 1</c>, and the lockout
    /// instant once the incremented count reaches <see cref="Threshold"/>. The in-memory entity is NOT touched, so a
    /// later <c>SaveChanges</c> of the same context can never write a stale count back over a concurrent increment.
    /// </summary>
    /// <param name="dbContext">The persistence context.</param>
    /// <param name="person">The person the attempt failed against (its id and organization bound the update).</param>
    /// <param name="now">The server clock.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task.</returns>
    public static async Task RecordFailureAsync(
        PulseDbContext dbContext,
        Person person,
        DateTimeOffset now,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(person);

        var lockedOutUntil = LockedOutUntilAfterIncrement(now);

        await dbContext.People
            .InOrganization(person.OrganizationId)
            .Where(p => p.Id == person.Id)
            .ExecuteUpdateAsync(
                set => set
                    .SetProperty(p => p.LockedOutUntil, lockedOutUntil)
                    .SetProperty(p => p.FailedLoginCount, p => p.FailedLoginCount + 1),
                cancellationToken);
    }

    /// <summary>
    /// The in-memory model of one failure (the rule <see cref="RecordFailureAsync"/> applies in SQL). Not for production
    /// sign-in paths — a tracked read-modify-write undercounts under concurrency.
    /// </summary>
    /// <param name="person">The person.</param>
    /// <param name="now">The server clock.</param>
    internal static void RecordFailure(Person person, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(person);

        person.FailedLoginCount++;
        if (LockoutDuration(person.FailedLoginCount) is { } duration)
        {
            person.LockedOutUntil = now + duration;
        }
    }

    /// <summary>Clears the failure counter and any lockout after a verified password.</summary>
    /// <param name="person">The (tracked) person that verified.</param>
    public static void RecordSuccess(Person person)
    {
        ArgumentNullException.ThrowIfNull(person);

        person.FailedLoginCount = 0;
        person.LockedOutUntil = null;
    }

    /// <summary>
    /// Builds <c>p =&gt; (p.FailedLoginCount + 1) &lt; Threshold ? p.LockedOutUntil : (… == Threshold ? at[0] : … : at[k])</c>
    /// — a SQL <c>CASE</c> over the PRE-update count, one arm per distinct <see cref="LockoutDuration"/> value up to the
    /// count from which it no longer changes, so the statement applies exactly the in-memory rule.
    /// </summary>
    /// <remarks>
    /// <b>Parameterized, never literal (#660 W-1).</b> The lockout instants are read from a per-call
    /// <see cref="LockoutInstants"/> holder (<c>holder.At[i]</c>), not inlined as <see cref="ConstantExpression"/>s: EF
    /// funcletizes the holder access into SQL PARAMETERS, so the tree shape — and therefore the compiled query and the SQL
    /// text / server plan — is identical on every failed sign-in. A literal <c>now + d</c> per call would compile a new
    /// query (and a new plan) each time, adding a measurable cost to exactly the known-email path M-2 equalizes.
    /// </remarks>
    private static Expression<Func<Person, DateTimeOffset?>> LockedOutUntilAfterIncrement(DateTimeOffset now)
    {
        var person = Expression.Parameter(typeof(Person), "p");
        var next = Expression.Add(
            Expression.Property(person, nameof(Person.FailedLoginCount)),
            Expression.Constant(1));

        var instants = new LockoutInstants(now);
        var at = Expression.Property(Expression.Constant(instants), nameof(LockoutInstants.At));

        // The last arm is the stable (capped) value; every earlier arm is an exact count.
        var last = LockoutInstants.ArmCount - 1;
        Expression ladder = Expression.ArrayIndex(at, Expression.Constant(last));
        for (var arm = last - 1; arm >= 0; arm--)
        {
            ladder = Expression.Condition(
                Expression.Equal(next, Expression.Constant(Threshold + arm)),
                Expression.ArrayIndex(at, Expression.Constant(arm)),
                ladder);
        }

        var body = Expression.Condition(
            Expression.LessThan(next, Expression.Constant(Threshold)),
            Expression.Property(person, nameof(Person.LockedOutUntil)),
            ladder);

        return Expression.Lambda<Func<Person, DateTimeOffset?>>(body, person);
    }

    /// <summary>
    /// The per-call lockout instants the <see cref="LockedOutUntilAfterIncrement"/> ladder reads as SQL parameters:
    /// <c>At[i] = now + LockoutDuration(Threshold + i)</c>, the last entry being the stable (capped) value.
    /// </summary>
    private sealed class LockoutInstants
    {
        /// <summary>
        /// How many arms the ladder has: one per count from <see cref="Threshold"/> up to the first count at which the
        /// duration stops changing (the cap, or the doubling bound), inclusive. Fixed for the process, so the tree shape is.
        /// </summary>
        public static readonly int ArmCount = ComputeArmCount();

        public LockoutInstants(DateTimeOffset now)
        {
            At = new DateTimeOffset?[ArmCount];
            for (var arm = 0; arm < ArmCount; arm++)
            {
                At[arm] = now + LockoutDuration(Threshold + arm)!.Value;
            }
        }

        /// <summary>The instants, by arm.</summary>
        public DateTimeOffset?[] At { get; }

        private static int ComputeArmCount()
        {
            var stable = Threshold;
            while (stable - Threshold < MaxDoublings && LockoutDuration(stable) < MaxDuration)
            {
                stable++;
            }

            return stable - Threshold + 1;
        }
    }
}
