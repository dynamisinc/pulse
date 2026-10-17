namespace Pulse.WebApi.Features.EngineRuntime;

using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.WebApi.Features.Identity.RoleMatrix;

/// <summary>
/// The LEAD-controller gate on the engine's autonomy RAISES (identity-auth-roles/17; ADMIN-IDENTITY-MODEL §1.1, §8.2 and
/// §12 Option A, signed off by Tom 2026-10-16) — a sibling of <see cref="EngineCockpitControllerRoleFilter"/>, composed
/// AFTER it on the five covered routes: <c>POST /api/engine/autonomy/swamped-mode</c>, <c>/api/engine/autonomy/restore</c>,
/// <c>/api/engine/settings/autonomy-default</c>, <c>/api/engine/settings/tier-policy</c> and
/// <c>/api/engine/generation-provider/restore</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Raise-only.</b> Swamped mode ON (any <c>enabled:true</c>, whatever the current state), an autonomy default above
/// the current one, a tier policy towards more engine autonomy, and either restore are RAISES and need the lead. For
/// the autonomy default and the tier policy this filter is only a cheap first line: the service re-judges the raise
/// against the state it then compare-and-sets (Gate-1 WR-001), so a concurrent lower between this read and the write
/// cannot slip a non-lead raise through. Everything else — swamped off, autonomy down, a no-op, and the never-gated kill switch and
/// <c>cut-to-fake</c> — is a LOWER and stays open to any controller ("controls only ever lower").
/// </para>
/// <para>
/// <b>Tier-policy ordering.</b> <c>ambient</c> &lt; <c>standard</c> &lt; <c>auto</c>: <c>auto</c> clears the override
/// and lets the engine choose its tier (the most engine autonomy); forcing a tier constrains it, and forcing the cheaper
/// <c>ambient</c> tier constrains it most.
/// </para>
/// <para>
/// <b>Live, keyed on the session person.</b> The lead flag is <c>Enrollment.IsLead</c> read on THIS request
/// (<see cref="ExerciseCallerRole"/>) for the session's own person — never a body <c>actingHumanId</c> — so a lead change
/// takes effect immediately and revokes no session. An unparseable body is treated as a raise (fail closed): a non-lead
/// gets 403, the lead reaches the handler's own 400.
/// </para>
/// </remarks>
public sealed class LeadControllerRaiseFilter : IEndpointFilter
{
    private readonly Func<EndpointFilterInvocationContext, Guid, bool> _isRaise;

    private LeadControllerRaiseFilter(Func<EndpointFilterInvocationContext, Guid, bool> isRaise) => _isRaise = isRaise;

    /// <summary>
    /// <c>swamped-mode</c>: ANY <c>enabled:true</c> is a raise, whatever the current state (Gate-1 WR-001). Judging it
    /// against the current state would be a TOCTOU: a non-lead's "on while already on" no-op could land just after a
    /// concurrent OFF and turn auto-send back on. Only <c>enabled:false</c> is a lower; an unparseable body is a raise.
    /// </summary>
    public static LeadControllerRaiseFilter SwampedMode { get; } = new((context, _) =>
    {
        var request = context.Arguments.OfType<EngineSwampedModeRequest>().FirstOrDefault();
        return request?.Enabled is not { } enabled || enabled;
    });

    /// <summary>
    /// <c>settings/autonomy-default</c>: a level above the current default is a raise. A cheap first line only — the
    /// authoritative judgment is <see cref="EngineReviewService.SetExerciseAutonomyDefaultAsync"/>'s, made atomically
    /// with the write (Gate-1 WR-001).
    /// </summary>
    public static LeadControllerRaiseFilter AutonomyDefault { get; } = new((context, exerciseId) =>
    {
        var request = context.Arguments.OfType<EngineAutonomyDefaultRequest>().FirstOrDefault();
        if (!TryRankAutonomy(request?.Level, out var requested))
        {
            return true;
        }

        var registry = context.HttpContext.RequestServices.GetService<EngineAutonomyRegistry>();
        return registry is null || requested > (int)registry.GetOrCreate(exerciseId).ExerciseDefault;
    });

    /// <summary>
    /// <c>settings/tier-policy</c>: a mode towards more engine autonomy than the current one is a raise. A cheap first
    /// line only — the authoritative judgment is <see cref="EngineReviewService.SetTierPolicyModeAsync"/>'s, made
    /// atomically with the write (Gate-1 WR-001).
    /// </summary>
    public static LeadControllerRaiseFilter TierPolicy { get; } = new((context, exerciseId) =>
    {
        var request = context.Arguments.OfType<EngineTierPolicyRequest>().FirstOrDefault();
        if (!TierPolicyModes.TryParse(request?.Mode, out var requested))
        {
            return true;
        }

        var registry = context.HttpContext.RequestServices.GetService<EngineTierPolicyRegistry>();
        return registry is null || RankTier(requested) > RankTier(registry.GetMode(exerciseId));
    });

    /// <summary><c>autonomy/restore</c> and <c>generation-provider/restore</c>: always a raise.</summary>
    public static LeadControllerRaiseFilter AlwaysRaise { get; } = new((_, _) => true);

    /// <inheritdoc />
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        var caller = await ExerciseCallerRole.ResolveAsync(context.HttpContext);
        if (!caller.Holds(ExerciseRoleSets.Controller))
        {
            // Defense in depth: the controller-role filter in front of this one has already refused these.
            return caller.Refusal();
        }

        if (!caller.IsLead && _isRaise(context, caller.ExerciseId))
        {
            return Results.StatusCode(StatusCodes.Status403Forbidden);
        }

        return await next(context);
    }

    /// <summary>The tier-policy autonomy rank: <c>ambient</c> 0, <c>standard</c> 1, <c>auto</c> 2.</summary>
    /// <param name="mode">The mode.</param>
    /// <returns>The rank.</returns>
    public static int RankTier(TierPolicyMode mode) => mode switch
    {
        TierPolicyMode.Ambient => 0,
        TierPolicyMode.Standard => 1,
        _ => 2,
    };

    private static bool TryRankAutonomy(string? literal, out int rank)
    {
        rank = literal switch
        {
            "suggest" => (int)AutonomyLevel.Suggest,
            "delayed-auto" => (int)AutonomyLevel.DelayedAuto,
            "auto" => (int)AutonomyLevel.Auto,
            _ => -1,
        };

        return rank >= 0;
    }

}
