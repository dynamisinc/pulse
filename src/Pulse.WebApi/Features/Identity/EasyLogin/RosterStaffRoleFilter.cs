namespace Pulse.WebApi.Features.Identity.EasyLogin;

using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// The role gate on every easy-login staff route (<c>/api/staff/roster*</c>, <c>/api/staff/day-word</c>), EL-13: the
/// caller must be a staff user assigned to the resolved exercise AND hold <c>controller</c> or <c>planner</c> there.
/// These routes hand out sign-in credentials, so they are tighter than the legacy accounts endpoints (any live staff
/// session) from day one. An evaluator, or any other assigned role, is refused.
/// </summary>
/// <remarks>
/// <para>
/// <b>A sibling of <c>EngineCockpitControllerRoleFilter</c>, composed after
/// <c>EngineCockpitStaffAuthorizationFilter</c>.</b> Each route adds the staff filter first and this one second
/// (<c>.AddEndpointFilter&lt;EngineCockpitStaffAuthorizationFilter&gt;().AddEndpointFilter&lt;RosterStaffRoleFilter&gt;()</c>).
/// It reuses the same B2 primitives and no new auth: <see cref="StaffAssignmentService.GetAssignmentsAsync"/> (null for
/// any participant, read-only or anonymous caller) and the server-resolved <see cref="IExerciseContext"/>, reading the
/// role off the assignment that read already returns.
/// </para>
/// <para>
/// <b>Fail closed, in order</b> (re-checked here so the filter is safe even if the order ever changed): no staff session
/// gives <c>401</c>; an unresolved scope gives <c>401</c>; no assignment on the resolved exercise gives <c>403</c>; a
/// role other than controller or planner gives <c>403</c>. The exercise ALWAYS comes from
/// <see cref="IExerciseContext"/>: a route value, query value or body field naming another exercise is never read.
/// </para>
/// <para>
/// <b>Composition.</b> No constructor dependencies: the minimal-API filter factory creates it, and it resolves its
/// collaborators from the request scope. No DI registration is needed.
/// </para>
/// </remarks>
public sealed class RosterStaffRoleFilter : IEndpointFilter
{
    /// <summary>The <c>ExerciseRole</c> value of a controller (matched case-insensitively against the stored assignment role).</summary>
    public const string ControllerRole = "controller";

    /// <summary>The <c>ExerciseRole</c> value of a planner (matched case-insensitively against the stored assignment role).</summary>
    public const string PlannerRole = "planner";

    /// <summary>Whether <paramref name="role"/> may use the roster and day-word routes (controller or planner).</summary>
    /// <param name="role">The caller's assignment role on the resolved exercise.</param>
    /// <returns><c>true</c> for <c>controller</c> or <c>planner</c>, in any casing.</returns>
    public static bool IsAdmittedRole(string? role) =>
        string.Equals(role, ControllerRole, StringComparison.OrdinalIgnoreCase)
        || string.Equals(role, PlannerRole, StringComparison.OrdinalIgnoreCase);

    /// <summary>Enforces the controller-or-planner gate before invoking the wrapped staff handler.</summary>
    /// <param name="context">The endpoint filter invocation context.</param>
    /// <param name="next">The next filter or handler.</param>
    /// <returns>A fail-closed <see cref="IResult"/>, or the handler's result when authorized.</returns>
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        var services = context.HttpContext.RequestServices;
        var assignmentService = services.GetRequiredService<StaffAssignmentService>();
        var exerciseContext = services.GetRequiredService<IExerciseContext>();
        var cancellationToken = context.HttpContext.RequestAborted;

        // No authenticated STAFF session (participant / shared read-only / anonymous): 401, never a default.
        var assignments = await assignmentService.GetAssignmentsAsync(cancellationToken);
        if (assignments is null)
        {
            return Results.Unauthorized();
        }

        // The server-resolved scope (COR-001). Unresolved: 401. Nothing from the request is consulted.
        var scope = exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return Results.Unauthorized();
        }

        var assignment = assignments.FirstOrDefault(
            a => Guid.TryParse(a.ExerciseId, out var id) && id == scope.Value);
        if (assignment is null)
        {
            return Results.StatusCode(StatusCodes.Status403Forbidden);
        }

        // EL-13: controllers and planners provision and admit participants; evaluators observe and do not.
        if (!IsAdmittedRole(assignment.Role))
        {
            return Results.StatusCode(StatusCodes.Status403Forbidden);
        }

        return await next(context);
    }
}
