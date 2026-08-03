namespace Pulse.WebApi.Features.ExerciseLifecycleAdmin;

using System.Collections.Generic;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.EngineRuntime;

/// <summary>
/// The role gate on the organization-administration endpoints (COR-074 / COR-075 / COR-076) — a sibling of
/// <see cref="EngineCockpitStaffAuthorizationFilter"/> and <see cref="EngineCockpitControllerRoleFilter"/>, and
/// the first authorization check anywhere in <c>Pulse.WebApi</c> that recognises <c>orgAdmin</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why it is a sibling and not a reuse.</b> The two engine-cockpit filters answer "is this caller a staff
/// human ASSIGNED TO the currently-resolved exercise, holding role X ON that exercise" — the right question
/// for a surface that operates INSIDE one exercise, and the wrong one here. These endpoints operate ABOVE the
/// exercise: an org-admin administers the customer's whole portfolio, including exercises they hold no
/// <c>StaffAssignment</c> on, and a newly-created exercise has no assignment until this feature makes one. So
/// this filter gates on the caller's session ROLE and their server-resolved TENANT, and takes no exercise
/// scope into account at all. Everything it needs comes from <see cref="StaffCallerContext"/>, which resolves
/// all three facts from the server-issued session — never from a body, route or query value.
/// </para>
/// <para>
/// <b>Two instances, one class, and they deliberately do not nest.</b>
/// <see cref="ExerciseAdministrators"/> admits <c>planner</c> and <c>orgAdmin</c> (creation + the org-scoped
/// exercise list); <see cref="OrgAdminOnly"/> admits <c>orgAdmin</c> alone (the org-admin surface family's own
/// reads, COR-076 — a planner is refused, which is exactly what makes <c>orgAdmin</c> a separate family rather
/// than a larger staff role). Both instances are immutable and stateless, so they are shared singletons
/// attached at the mapping call site with <c>AddEndpointFilter(filter)</c> — no DI registration.
/// </para>
/// <para>
/// <b>Fail closed, in order.</b> No live staff session, or a staff session whose customer tenant did not
/// resolve → <c>401</c> (never a default/empty <c>200</c>, and never a widened "unknown tenant sees
/// everything"). A live staff caller whose role is not in the admitted set → <c>403</c>. Only then does the
/// handler run — and every service behind it re-checks the same facts, because a gate is not a substitute for
/// a service that fails closed on its own.
/// </para>
/// </remarks>
public sealed class OrgAdminAuthorizationFilter : IEndpointFilter
{
    private readonly IReadOnlySet<string> _admittedRoles;

    private OrgAdminAuthorizationFilter(IReadOnlySet<string> admittedRoles) => _admittedRoles = admittedRoles;

    /// <summary>
    /// Admits <c>planner</c> and <c>orgAdmin</c> — the exercise-administration endpoints (COR-074 creation,
    /// COR-075 list). A controller or evaluator session is refused with <c>403</c>.
    /// </summary>
    public static OrgAdminAuthorizationFilter ExerciseAdministrators { get; } =
        new(ExerciseAdminRoles.ExerciseAdministrators);

    /// <summary>
    /// Admits <c>orgAdmin</c> alone — the org-admin surface family's own reads (COR-076). Controller,
    /// evaluator AND planner sessions are all refused with <c>403</c>.
    /// </summary>
    public static OrgAdminAuthorizationFilter OrgAdminOnly { get; } =
        new(ExerciseAdminRoles.OrganizationAdministrators);

    /// <summary>Enforces the role gate before invoking the wrapped handler.</summary>
    /// <param name="context">The endpoint filter invocation context.</param>
    /// <param name="next">The next filter/handler in the pipeline.</param>
    /// <returns>A fail-closed <see cref="IResult"/>, or the handler's result when authorized.</returns>
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        var staffCallerContext = context.HttpContext.RequestServices.GetRequiredService<StaffCallerContext>();
        var caller = await staffCallerContext.ResolveAsync(context.HttpContext.RequestAborted);

        if (caller is null)
        {
            // No live staff session, or no server-resolved customer tenant. Both fail closed at 401.
            return Results.Unauthorized();
        }

        if (!_admittedRoles.Contains(caller.Role))
        {
            return Results.StatusCode(StatusCodes.Status403Forbidden);
        }

        return await next(context);
    }
}
