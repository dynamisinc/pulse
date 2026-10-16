namespace Pulse.WebApi.Features.Identity.RoleMatrix;

using Microsoft.AspNetCore.Http;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;

/// <summary>
/// The STAFF half of a route both worlds write through (posts, follows, staff pins, media upload) — identity-auth-roles/17,
/// ADMIN-IDENTITY-MODEL §8.2 "setup authoring in build" vs "conduct (staged/live)". A non-staff caller passes straight
/// through to the route's own participant logic (and its read-only gate); only a staff session is role-checked here.
/// </summary>
/// <remarks>
/// <para>
/// <b><see cref="PersonaAuthoring"/></b> — posting / following as a persona and pinning. In <c>build</c> a planner or a
/// controller may author setup content; in every other state (staged dry runs, live, paused, completed) posting is
/// conduct and is <b>controller only</b>. An evaluator is refused in every state (#61). An unreadable state fails closed
/// to the conduct rule.
/// </para>
/// <para>
/// <b><see cref="StaffUpload"/></b> — a staff media upload (persona avatars, composer attachments): planner or controller
/// in any state; evaluator refused.
/// </para>
/// <para>
/// A staff caller with no resolved scope (an org-scope session) gets <c>401</c>, and one not enrolled on the resolved
/// exercise <c>403</c>, exactly as <see cref="ExerciseRoleFilter"/>.
/// </para>
/// </remarks>
public sealed class StaffAuthoringRoleFilter : IEndpointFilter
{
    private readonly bool _buildAdmitsPlanner;

    private StaffAuthoringRoleFilter(bool buildAdmitsPlanner, IReadOnlySet<string> otherwise)
    {
        _buildAdmitsPlanner = buildAdmitsPlanner;
        Otherwise = otherwise;
    }

    /// <summary>Post / follow as a persona, and pin: build = planner or controller; otherwise controller only.</summary>
    public static StaffAuthoringRoleFilter PersonaAuthoring { get; } = new(buildAdmitsPlanner: true, ExerciseRoleSets.Controller);

    /// <summary>Staff media upload: planner or controller in any state.</summary>
    public static StaffAuthoringRoleFilter StaffUpload { get; } = new(buildAdmitsPlanner: false, ExerciseRoleSets.PlannerOrController);

    /// <summary>The roles admitted outside <c>build</c>.</summary>
    public IReadOnlySet<string> Otherwise { get; }

    /// <summary>The roles admitted for a staff caller when the exercise is in <paramref name="lifecycleState"/>.</summary>
    /// <param name="lifecycleState">The canonical lifecycle state, or <c>null</c> when unreadable.</param>
    /// <returns>The admitted set.</returns>
    public IReadOnlySet<string> AdmittedIn(string? lifecycleState) =>
        _buildAdmitsPlanner && string.Equals(lifecycleState, ExerciseLifecycleStates.Build, StringComparison.Ordinal)
            ? ExerciseRoleSets.PlannerOrController
            : Otherwise;

    /// <inheritdoc />
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        var caller = await ExerciseCallerRole.ResolveAsync(context.HttpContext);
        if (caller.Outcome == ExerciseCallerOutcome.NoStaffSession)
        {
            // Not staff: the route's own participant / read-only logic decides.
            return await next(context);
        }

        if (!caller.Holds(AdmittedIn(caller.LifecycleState)))
        {
            return caller.Refusal();
        }

        return await next(context);
    }
}
