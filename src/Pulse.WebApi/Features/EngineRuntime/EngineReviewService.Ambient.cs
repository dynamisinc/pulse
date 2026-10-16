namespace Pulse.WebApi.Features.EngineRuntime;

using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pulse.Core.Features.Ambient.Models;
using Pulse.Core.Features.Ambient.Services;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;

/// <summary>
/// The ambient-chatter half of the engine-settings API (ambient-chatter story 01, AC0-AC2): set the exercise's
/// <see cref="AmbientTierPolicy"/>, and lower an autonomous policy when a safety lever is pulled. A separate partial
/// file so the shared <c>EngineReviewService.cs</c> (autonomy-safety, world-steering) carries only the wiring lines.
/// </summary>
public sealed partial class EngineReviewService
{
    /// <summary>
    /// Sets the exercise's ambient-chatter policy (<c>POST /api/engine/settings/ambient-policy</c>). Controller-role
    /// only (the endpoint group's filter); scope from <see cref="Pulse.WebApi.Data.IExerciseContext"/> only (COR-001).
    /// Live for the next tick. Emits ONE <see cref="EngineEventTypes.TierPolicyChanged"/> event carrying an
    /// <see cref="EngineEventPayloads.AmbientPolicyChanged"/> payload (from→to + the acting human).
    /// </summary>
    /// <remarks>
    /// Rejected with a 400 and NOTHING mutated: an unknown mode; <c>autonomous</c> while the governed
    /// <c>Generation:Governance:AmbientAutonomyAuthorized</c> flag is false (AC0); a cap above the exercise's
    /// <c>MaxEnginePostsPerMinute</c>; a topic outside the fixed vocabulary; a persona id that is not a persona of
    /// THIS exercise (a cross-exercise id resolves to nothing through the central query filter, so it is rejected
    /// exactly like an unknown one).
    /// </remarks>
    /// <param name="request">The requested policy.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The resulting settings snapshot, or a fail-closed/invalid outcome.</returns>
    public async Task<EngineSettingsResult> SetAmbientPolicyAsync(
        EngineAmbientPolicyRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (!TryResolveScope(out var exerciseId))
        {
            return EngineSettingsResult.ScopeUnresolved();
        }

        if (string.IsNullOrWhiteSpace(request.ActingHumanId))
        {
            return EngineSettingsResult.Invalid("actingHumanId is required (COR-018).");
        }

        var validation = AmbientPolicyValidator.Validate(
            request.Mode,
            request.MaxPerMinute,
            request.MaxPerHour,
            request.TopicAllowList,
            request.PersonaAllowList,
            _ambientPolicy.MaxEnginePostsPerMinute(exerciseId),
            _ambientPolicy.AutonomyAuthorized);
        if (validation.Draft is not { } draft)
        {
            return EngineSettingsResult.Invalid(validation.Error!);
        }

        // Personas of THIS exercise only. The read goes through the central exercise filter, so an id from another
        // exercise is simply not found here — rejected like any unknown id, never accepted and never disclosed.
        if (draft.PersonaIds.Count > 0)
        {
            var ids = draft.PersonaIds.ToList();
            var known = await _dbContext.Personas
                .AsNoTracking()
                .Where(persona => ids.Contains(persona.Id))
                .Select(persona => persona.Id)
                .ToListAsync(cancellationToken);

            var unknown = ids.FirstOrDefault(id => !known.Contains(id));
            if (unknown != Guid.Empty)
            {
                return EngineSettingsResult.Invalid($"persona '{unknown}' is not a persona of this exercise.");
            }
        }

        var policy = draft.ToPolicy(request.ActingHumanId);
        var from = _ambientPolicy.Set(exerciseId, policy);

        await CommitSettingsEventAsync(
            EngineEventTypes.TierPolicyChanged,
            exerciseId,
            request.ToInput(),
            BuildAmbientChange(from.Mode, policy, EngineEventPayloads.AmbientPolicyChanged.ReasonController, exerciseId),
            cancellationToken);

        return EngineSettingsResult.Ok(BuildSettings(exerciseId));
    }

    /// <summary>
    /// Lowers an AUTONOMOUS ambient policy to off when a controller pulls a safety lever (kill switch in either mode,
    /// cut to Fake; AC6), and records it as one <see cref="EngineEventTypes.TierPolicyChanged"/> event attributed to
    /// that controller. A no-op (no event) for any other mode. Restoring the engine never re-raises the policy.
    /// </summary>
    private async Task DemoteAutonomousAmbientAsync(
        Guid exerciseId,
        EngineReviewActionInput input,
        CancellationToken cancellationToken)
    {
        if (!_ambientPolicy.DemoteAutonomous(exerciseId, out var demoted))
        {
            return;
        }

        await CommitSettingsEventAsync(
            EngineEventTypes.TierPolicyChanged,
            exerciseId,
            input,
            BuildAmbientChange(
                demoted.Mode,
                demoted with { Mode = AmbientPolicyMode.Off },
                EngineEventPayloads.AmbientPolicyChanged.ReasonSafetyClamp,
                exerciseId),
            cancellationToken);
    }

    private EngineEventPayloads.AmbientPolicyChanged BuildAmbientChange(
        AmbientPolicyMode fromMode,
        AmbientTierPolicy to,
        string reason,
        Guid exerciseId) => new()
        {
            FromMode = AmbientPolicyModes.ToLiteral(fromMode),
            ToMode = AmbientPolicyModes.ToLiteral(to.Mode),
            MaxPerMinute = to.MaxPerMinute,
            MaxPerHour = to.MaxPerHour,
            TopicAllowList = to.TopicAllowList.ToList(),
            PersonaAllowList = to.PersonaAllowList.Select(id => id.ToString()).ToList(),
            Reason = reason,
            ScenarioMinute = _clock.CurrentScenarioMinute(exerciseId),
        };
}
