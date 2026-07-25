namespace Pulse.WebApi.Features.EngineRuntime;

using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// The controller-role gate on every <b>mutating</b> <c>/api/engine</c> cockpit endpoint (#297, autonomy-safety
/// story 05): the review actions (approve / edit / veto / re-roll / batch-approve), the autonomy controls
/// (swamped-mode / kill-switch / restore), and the two engine-settings <c>POST</c>s. An evaluator (or any other
/// assigned staff role) may WATCH the cockpit — <c>GET /api/engine/review-queue</c> and
/// <c>GET /api/engine/settings</c> stay open to any assigned staff — but only a <c>controller</c> may STEER it.
/// </summary>
/// <remarks>
/// <para>
/// <b>A sibling of <see cref="EngineCockpitStaffAuthorizationFilter"/>, not a replacement.</b> It composes with
/// (and runs after) that filter's staff + assigned-exercise gate rather than inventing a second auth mechanism:
/// the staff filter is applied to the whole cockpit group, this one only to the mutating sub-group, so a
/// mutation passes BOTH checks and a read passes only the first. It reuses exactly the same B2 primitives —
/// <see cref="StaffAssignmentService.GetAssignmentsAsync"/> (staff-session-gated; participant / shared
/// read-only / anonymous callers all yield <c>null</c>) and the server-authoritative
/// <see cref="IExerciseContext.CurrentExerciseId"/> — and reads the role off the
/// <see cref="StaffAssignmentDto.Role"/> that read already returns. No new persistence, no new session claim.
/// </para>
/// <para>
/// <b>Fail closed, in order.</b> No staff session → <c>401</c>; an unresolved scope → <c>401</c> (the standing
/// COR-001 behaviour); a staff session with no assignment on the resolved exercise → <c>403</c> (COR-005,
/// re-checked here so this filter is safe even if the ordering ever changed); an assignment whose role is not
/// <c>controller</c> → <c>403</c>. Only an assigned CONTROLLER reaches the handler.
/// </para>
/// <para>
/// <b>Composition.</b> Resolves its collaborators from the request scope (so the host needs B2's
/// <c>AddStaffIdentity()</c> + the persistence/scoping registrations, exactly as the staff filter does) and has
/// no constructor dependencies, so the minimal-API filter factory creates it with no DI registration.
/// </para>
/// </remarks>
public sealed class EngineCockpitControllerRoleFilter : IEndpointFilter
{
    /// <summary>
    /// The <c>ExerciseRole</c> vocabulary value that may steer the engine. Compared case-insensitively against
    /// the stored <see cref="Data.Entities.StaffAssignment.Role"/> (stored verbatim as the frozen frontend
    /// literal) — the role WORD must match; only its casing is forgiven.
    /// </summary>
    public const string ControllerRole = "controller";

    /// <summary>
    /// Enforces the controller-role gate before invoking the wrapped mutating cockpit handler.
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

        // No authenticated STAFF session (participant / shared read-only / anonymous) → 401, never a default.
        var assignments = await assignmentService.GetAssignmentsAsync(cancellationToken);
        if (assignments is null)
        {
            return Results.Unauthorized();
        }

        // Scope is server-authoritative (COR-001) and fails closed when unresolved — a steering mutation is
        // never applied to a guessed exercise.
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

        // #297: only a controller steers. An evaluator/planner assigned to this exercise reads the cockpit fine
        // but cannot approve, veto, trip the kill switch, or change the engine's settings.
        if (!string.Equals(assignment.Role, ControllerRole, StringComparison.OrdinalIgnoreCase))
        {
            return Results.StatusCode(StatusCodes.Status403Forbidden);
        }

        return await next(context);
    }
}
