namespace Pulse.WebApi.Features.Identity.RoleMatrix;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The declarative per-route role gate of the §8.2 role matrix (identity-auth-roles/17): a staff-only route admits a
/// fixed set of in-exercise roles, read LIVE from the caller's own enrollment on the server-resolved exercise
/// (<see cref="ExerciseCallerRole"/>). One class, three shared immutable instances, attached at the mapping call site with
/// <see cref="RoleMatrixEndpointExtensions.RequireExerciseRole{TBuilder}"/> — never a scattered <c>if</c> in a handler.
/// </summary>
/// <remarks>
/// <para>
/// <b>Fail closed, in order.</b> No staff session or no resolved scope (participant, read-only, anonymous, and an
/// org-scope session, which has no in-exercise powers) → <c>401</c>; not enrolled on the resolved exercise → <c>403</c>;
/// enrolled in a role the route does not admit (for example every evaluator write, #61) → <c>403</c>. The gate depends
/// on no route value, so its answer can never disclose whether an id exists (the bare-404 pattern runs behind it).
/// </para>
/// <para>
/// <b>No implicit org-admin power.</b> <c>orgAdmin</c> is not an exercise role, so it is never in an admitted set here:
/// an org admin acts in an exercise only through an enrollment they hold (ADMIN-IDENTITY-MODEL §1.1).
/// </para>
/// </remarks>
public sealed class ExerciseRoleFilter : IEndpointFilter
{
    private ExerciseRoleFilter(IReadOnlySet<string> admitted) => Admitted = admitted;

    /// <summary>Planners only: settings, chrome, practice mode (§8.2, a narrowing from "any staff").</summary>
    public static ExerciseRoleFilter PlannerOnly { get; } = new(ExerciseRoleSets.Planner);

    /// <summary>Planners and controllers: roster, view-only code, personas, run-sheet edit (§8.2).</summary>
    public static ExerciseRoleFilter PlannerOrController { get; } = new(ExerciseRoleSets.PlannerOrController);

    /// <summary>Controllers only: conduct (§8.2).</summary>
    public static ExerciseRoleFilter ControllerOnly { get; } = new(ExerciseRoleSets.Controller);

    /// <summary>The admitted roles.</summary>
    public IReadOnlySet<string> Admitted { get; }

    /// <inheritdoc />
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        var caller = await ExerciseCallerRole.ResolveAsync(context.HttpContext);
        if (!caller.Holds(Admitted))
        {
            return caller.Refusal();
        }

        return await next(context);
    }
}

/// <summary>The admitted-role sets the role-matrix gates share (the frozen <c>ExerciseRole</c> literals).</summary>
public static class ExerciseRoleSets
{
    /// <summary><c>planner</c>.</summary>
    public static IReadOnlySet<string> Planner { get; } =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { EnrollmentRoles.Planner };

    /// <summary><c>controller</c>.</summary>
    public static IReadOnlySet<string> Controller { get; } =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { EnrollmentRoles.Controller };

    /// <summary><c>planner</c> + <c>controller</c>.</summary>
    public static IReadOnlySet<string> PlannerOrController { get; } =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { EnrollmentRoles.Planner, EnrollmentRoles.Controller };
}

/// <summary>Mapping-site helpers for the role-matrix gates (identity-auth-roles/17).</summary>
public static class RoleMatrixEndpointExtensions
{
    /// <summary>Attaches a role gate to a route or group.</summary>
    /// <typeparam name="TBuilder">The endpoint convention builder.</typeparam>
    /// <param name="builder">The route or group.</param>
    /// <param name="filter">One of the shared instances.</param>
    /// <returns>The same builder.</returns>
    public static TBuilder RequireExerciseRole<TBuilder>(this TBuilder builder, ExerciseRoleFilter filter)
        where TBuilder : IEndpointConventionBuilder
    {
        ArgumentNullException.ThrowIfNull(builder);
        ArgumentNullException.ThrowIfNull(filter);
        return builder.AddEndpointFilter(filter);
    }
}
