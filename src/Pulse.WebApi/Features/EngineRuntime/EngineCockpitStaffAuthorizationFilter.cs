namespace Pulse.WebApi.Features.EngineRuntime;

using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// The single shared authorization gate on every review-cockpit endpoint (story 02, COR-005 authz hardening,
/// #286). The cockpit is a STAFF-only, safety-critical surface — the review-queue read plus approve / edit /
/// veto / re-roll / batch-approve and the swamped-mode + kill-switch autonomy controls. This endpoint filter
/// runs BEFORE each handler and layers a role/assignment gate ON TOP of the service's existing exercise-scope
/// resolution (COR-001), which is left exactly as-is.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why it exists.</b> These endpoints were built before B2's session auth and gated ONLY on exercise scope
/// (<see cref="IExerciseContext"/>, fail-closed). B2 now populates scope for ANY authenticated session, so a
/// non-staff participant (or shared read-only) session would otherwise reach the staff cockpit. Scope isolation
/// still held (no cross-exercise leak); this adds the missing role/assignment gate.
/// </para>
/// <para>
/// <b>Reuses B2's primitives — invents no auth of its own.</b> It calls
/// <see cref="StaffAssignmentService.GetAssignmentsAsync"/> (which itself gates on
/// <see cref="ICurrentStaffSessionAccessor"/>, yielding the caller's assignment set ONLY for a live, staff-kind
/// session — participant / shared read-only / anonymous sessions all yield <c>null</c>) and the
/// server-authoritative <see cref="IExerciseContext.CurrentExerciseId"/> (never a client-supplied exercise id).
/// </para>
/// <para>
/// <b>Fail closed, in order.</b> No staff session → <c>401</c>; a staff session but an UNRESOLVED scope →
/// <c>401</c> (the existing COR-001 fail-closed behaviour, unchanged); a staff session NOT assigned to the
/// resolved exercise → <c>403</c> (COR-005). Only a staff caller assigned to the resolved exercise reaches the
/// handler. The assignment check is defense-in-depth over B2's session→active-exercise scope: a staff session's
/// active exercise should already be one it is assigned to, but this verifies it explicitly rather than
/// trusting it implicitly.
/// </para>
/// <para>
/// <b>Composition dependency.</b> The filter resolves <see cref="StaffAssignmentService"/> and
/// <see cref="IExerciseContext"/> from the request scope, so the host must have B2's <c>AddStaffIdentity()</c>
/// and the persistence/scoping registrations wired (the orchestrator wires the engine-review feature AFTER
/// B2). The filter has no constructor dependencies so it is created by the minimal-API filter factory without
/// its own DI registration.
/// </para>
/// </remarks>
public sealed class EngineCockpitStaffAuthorizationFilter : IEndpointFilter
{
    /// <summary>
    /// Enforces the staff + assigned-exercise gate before invoking the wrapped cockpit handler. Fails closed
    /// with <c>401</c> (no staff session or unresolved scope) or <c>403</c> (staff but not assigned to the
    /// resolved exercise); otherwise passes control to the handler.
    /// </summary>
    /// <param name="context">The endpoint filter invocation context.</param>
    /// <param name="next">The next filter/handler in the pipeline.</param>
    /// <returns>A fail-closed <see cref="IResult"/>, or the handler's result when authorized.</returns>
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        var services = context.HttpContext.RequestServices;
        var assignmentService = services.GetRequiredService<StaffAssignmentService>();
        var exerciseContext = services.GetRequiredService<IExerciseContext>();
        var cancellationToken = context.HttpContext.RequestAborted;

        // Reuse B2's staff-only assignment read: a null result means "no authenticated STAFF session"
        // (participant / shared read-only / anonymous callers all yield null via ICurrentStaffSessionAccessor)
        // — fail closed with 401, never a default/empty result.
        var assignments = await assignmentService.GetAssignmentsAsync(cancellationToken);
        if (assignments is null)
        {
            return Results.Unauthorized();
        }

        // The resolved, server-authoritative scope (COR-001). An unresolved scope fails closed exactly as the
        // service already does — 401, never a default/empty 200.
        var scope = exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return Results.Unauthorized();
        }

        // COR-005: the staff caller MUST be assigned to the resolved exercise. Never trust the session's active
        // exercise implicitly — verify the assignment explicitly (defense-in-depth over the B2 scope seam).
        var assigned = assignments.Any(a => Guid.TryParse(a.ExerciseId, out var id) && id == scope.Value);
        if (!assigned)
        {
            return Results.StatusCode(StatusCodes.Status403Forbidden);
        }

        return await next(context);
    }
}
