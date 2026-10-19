namespace Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;

using Microsoft.AspNetCore.Http;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.RoleMatrix;

/// <summary>
/// Who may apply each COR-032 lifecycle transition (identity-auth-roles/17, ADMIN-IDENTITY-MODEL §5.1/§5.2/§8.2, the
/// #481 decision): the per-transition half of the role matrix, as one table rather than scattered checks.
/// </summary>
/// <remarks>
/// <list type="bullet">
///   <item><description><b>Planner:</b> stage (build → staged), unstage / reset (→ build), archive (→ archived).</description></item>
///   <item><description><b>Controller:</b> StartEx / resume / reopen (→ live), pause (→ paused), EndEx (live|paused → completed).</description></item>
///   <item><description><b>Nobody in-exercise:</b> unarchive (archived → completed|build) is org admin only, an
///   ORG-tier action — no exercise role holds it, so the in-exercise endpoint refuses it for every role.</description></item>
/// </list>
/// Freeze and the pause tiers are the controller-only <c>/api/steering/pause-tier</c> route (not a lifecycle state).
/// The table answers by role only; whether the edge exists at all is still the state machine's (409) question.
/// </remarks>
public static class LifecycleTransitionRoles
{
    /// <summary>
    /// The one exercise role that may move an exercise from <paramref name="from"/> to <paramref name="to"/>, or
    /// <c>null</c> when no in-exercise role may (unarchive, or an unknown state — fail closed).
    /// </summary>
    /// <param name="from">The current canonical state.</param>
    /// <param name="to">The requested canonical state.</param>
    /// <returns>The required role literal, or <c>null</c>.</returns>
    public static string? RequiredRole(string? from, string? to)
    {
        if (!ExerciseLifecycleStates.TryParse(from, out var source) || !ExerciseLifecycleStates.TryParse(to, out var target))
        {
            return null;
        }

        // Unarchive is org admin only — never an exercise role.
        if (source == ExerciseLifecycleStates.Archived)
        {
            return null;
        }

        return target switch
        {
            ExerciseLifecycleStates.Staged => EnrollmentRoles.Planner,
            ExerciseLifecycleStates.Build => EnrollmentRoles.Planner,
            ExerciseLifecycleStates.Archived => EnrollmentRoles.Planner,
            ExerciseLifecycleStates.Live => EnrollmentRoles.Controller,
            ExerciseLifecycleStates.Paused => EnrollmentRoles.Controller,
            ExerciseLifecycleStates.Completed => EnrollmentRoles.Controller,
            _ => null,
        };
    }
}

/// <summary>
/// The per-transition role gate on <c>POST /api/staff/exercise-lifecycle/transition</c> (#377/#481). Runs after the
/// staff + assigned-exercise gate and BEFORE the handler, so a refused role changes nothing (403, state unchanged).
/// </summary>
/// <remarks>
/// Order: the caller's live enrollment role must be planner or controller (an evaluator — or any other role — is 403
/// whatever the body says, #61). A body whose <c>to</c> is not a lifecycle literal passes to the handler's own 400.
/// Otherwise the current state is read from the server-resolved exercise and <see cref="LifecycleTransitionRoles"/>
/// names the one role that may apply that edge; any other role is 403.
/// </remarks>
public sealed class LifecycleTransitionRoleFilter : IEndpointFilter
{
    /// <inheritdoc />
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        var caller = await ExerciseCallerRole.ResolveAsync(context.HttpContext);
        if (!caller.Holds(ExerciseRoleSets.PlannerOrController))
        {
            return caller.Refusal();
        }

        var request = context.Arguments.OfType<ExerciseLifecycleTransitionRequest>().FirstOrDefault();
        if (request is null || !ExerciseLifecycleStates.TryParse(request.To, out var target) || caller.LifecycleState is null)
        {
            // Malformed body (the handler's 400) or a missing/unknown stored state (the handler's 404/409).
            return await next(context);
        }

        var required = LifecycleTransitionRoles.RequiredRole(caller.LifecycleState, target);
        if (required is null || !string.Equals(required, caller.Role, StringComparison.OrdinalIgnoreCase))
        {
            return Results.StatusCode(StatusCodes.Status403Forbidden);
        }

        return await next(context);
    }
}
