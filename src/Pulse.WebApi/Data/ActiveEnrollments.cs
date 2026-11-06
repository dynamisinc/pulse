namespace Pulse.WebApi.Data;

using System.Linq;
using System.Linq.Expressions;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The one shared "live enrollment" predicate (XC-010 soft delete, identity-auth-roles/21): a revoked enrollment keeps
/// its row with <see cref="Enrollment.DeletedAt"/> set, and EVERY read of <c>PulseDbContext.Enrollments</c> must
/// exclude it through <see cref="Active"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why an explicit predicate and not an EF global query filter.</b> Roughly half the enrollment reads are the
/// org tier's deliberate cross-exercise reads (sign-in, the switcher, the org directory, the lead gate, enrollment
/// administration), and each of those calls <c>IgnoreQueryFilters()</c> to bypass the central exercise filter.
/// <c>IgnoreQueryFilters()</c> would silently drop a soft-delete filter with it — exactly at the sign-in and grant
/// paths where a revoked enrollment matters most — and splitting the always-Critical exercise filter into a named
/// key so those sites could ignore it selectively would mean editing the isolation seam itself. An explicit,
/// shared predicate behaves identically on both kinds of read, and <c>ActiveEnrollmentSweepTests</c> makes it
/// unforgettable: a new <c>.Enrollments</c> read without <c>.Active()</c> fails the build's test run.
/// </para>
/// <para>
/// <b>The navigation reads are covered by the database instead.</b> <c>Account.Enrollment</c> is only ever a
/// participant-world enrollment, and <c>CK_Enrollments_DeletedAt_StaffOnly</c> refuses a <see cref="Enrollment.DeletedAt"/>
/// on a participant-world role, so an account can never reach a revoked enrollment through its navigation.
/// </para>
/// </remarks>
public static class ActiveEnrollments
{
    /// <summary>The translatable predicate "this enrollment has not been revoked".</summary>
    public static Expression<Func<Enrollment, bool>> IsActive { get; } = enrollment => enrollment.DeletedAt == null;

    /// <summary>Confines <paramref name="source"/> to live (not revoked) enrollments.</summary>
    /// <param name="source">An enrollment query.</param>
    /// <returns>The query, restricted to rows whose <see cref="Enrollment.DeletedAt"/> is <c>null</c>.</returns>
    public static IQueryable<Enrollment> Active(this IQueryable<Enrollment> source)
    {
        ArgumentNullException.ThrowIfNull(source);
        return source.Where(IsActive);
    }
}
