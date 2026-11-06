namespace Pulse.WebApi.Features.Identity.Staff;

using Microsoft.Extensions.Options;

/// <summary>
/// The wall-clock floors of the two staff sign-in funnels (#602 M-5, adversarial review W1), bound from
/// <see cref="SectionName"/>. The PRODUCTION floors are this class's own defaults: a missing or blank setting on UAT /
/// prod yields the non-zero floors, never 0. Only test hosts and kits set 0 explicitly.
/// </summary>
/// <remarks>
/// <para>
/// <b>How the defaults were chosen.</b> Measured on the 4-core dev/CI box against SQL Server in a container: one PBKDF2
/// verification is about 90–100 ms. A warm org sign-in, which always performs
/// <see cref="OrgStaffLoginService.SlowVerificationsPerAttempt"/> = 5 verifications, took 457–595 ms across unknown email,
/// five-candidate wrong password, and five-candidate org choice. So the org floor is 750 ms, about 25% above the worst
/// warm case and inside the accepted 0.6–1 s band. A warm exercise-bound sign-in (one verification) took 91–262 ms, so its
/// floor is 350 ms, about 33% above the worst case. The first cold call after start-up (JIT, connection pool) can exceed
/// a floor. That is a one-off and reveals nothing about the account. Retune both per environment if the hardware differs.
/// </para>
/// </remarks>
public sealed class StaffSignInTimingOptions
{
    /// <summary>The configuration section the floors bind from.</summary>
    public const string SectionName = "Authentication:StaffSignInTiming";

    /// <summary>The production floor of an org sign-in attempt (<c>POST /api/auth/staff/login</c>, org shape), in ms.</summary>
    public const int DefaultOrgSignInFloorMilliseconds = 750;

    /// <summary>The production floor of an exercise-bound staff sign-in attempt, in ms.</summary>
    public const int DefaultExerciseBoundSignInFloorMilliseconds = 350;

    /// <summary>
    /// The org sign-in floor in milliseconds. Unset, blank or negative means <see cref="DefaultOrgSignInFloorMilliseconds"/>.
    /// Only an explicit 0 disables it, and only tests set that.
    /// </summary>
    public int? OrgSignInFloorMilliseconds { get; set; }

    /// <summary>
    /// The exercise-bound sign-in floor in milliseconds. Unset, blank or negative means
    /// <see cref="DefaultExerciseBoundSignInFloorMilliseconds"/>. Only an explicit 0 disables it, and only tests set that.
    /// </summary>
    public int? ExerciseBoundSignInFloorMilliseconds { get; set; }

    /// <summary>The effective org sign-in floor.</summary>
    public TimeSpan OrgSignInFloor => Effective(OrgSignInFloorMilliseconds, DefaultOrgSignInFloorMilliseconds);

    /// <summary>The effective exercise-bound sign-in floor.</summary>
    public TimeSpan ExerciseBoundSignInFloor =>
        Effective(ExerciseBoundSignInFloorMilliseconds, DefaultExerciseBoundSignInFloorMilliseconds);

    private static TimeSpan Effective(int? configured, int fallback) =>
        TimeSpan.FromMilliseconds(configured is { } value and >= 0 ? value : fallback);
}

/// <summary>
/// Enforces a staff sign-in funnel's wall-clock floor (#602 M-5 / W1). The KDF padding equalizes the slow-hash work, and
/// this floor then hides the remaining non-KDF differences. Without it, an unknown email does no database write while a
/// known email with a wrong password does an atomic failure <c>UPDATE</c> per tried candidate plus an audit insert. Every
/// attempt that passed body validation ends no earlier than <c>start + floor</c>, measured and slept on the injected
/// <see cref="TimeProvider"/>, so a test can drive it deterministically. Residual differences exist only ABOVE the floor:
/// an attempt that runs longer than its floor is not padded.
/// </summary>
public sealed class StaffSignInTiming
{
    private readonly TimeProvider _timeProvider;

    /// <summary>Creates the floor enforcer.</summary>
    /// <param name="options">The bound floors.</param>
    /// <param name="timeProvider">The clock elapsed time is measured and the delay is slept on.</param>
    public StaffSignInTiming(IOptions<StaffSignInTimingOptions> options, TimeProvider timeProvider)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(timeProvider);

        var value = options.Value ?? new StaffSignInTimingOptions();
        OrgSignInFloor = value.OrgSignInFloor;
        ExerciseBoundSignInFloor = value.ExerciseBoundSignInFloor;
        _timeProvider = timeProvider;
    }

    /// <summary>The org sign-in floor.</summary>
    public TimeSpan OrgSignInFloor { get; }

    /// <summary>The exercise-bound sign-in floor.</summary>
    public TimeSpan ExerciseBoundSignInFloor { get; }

    /// <summary>Marks the start of an attempt.</summary>
    /// <returns>The start timestamp, for <see cref="WaitForFloorAsync"/>.</returns>
    public long Start() => _timeProvider.GetTimestamp();

    /// <summary>Waits until <paramref name="floor"/> has elapsed since <paramref name="start"/>. Returns at once past it.</summary>
    /// <param name="start">The timestamp from <see cref="Start"/>.</param>
    /// <param name="floor">The funnel's floor.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task completing at the floor.</returns>
    public Task WaitForFloorAsync(long start, TimeSpan floor, CancellationToken cancellationToken)
    {
        var remaining = floor - _timeProvider.GetElapsedTime(start);
        return remaining > TimeSpan.Zero
            ? Task.Delay(remaining, _timeProvider, cancellationToken)
            : Task.CompletedTask;
    }
}
