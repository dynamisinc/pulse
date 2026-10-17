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
    /// <summary>The 400 message when <c>autonomous</c> is requested while the kill switch or the cut to Fake is active.</summary>
    internal const string AutonomousWhileSafetyHeldError =
        "engine is stopped or cut to Fake — restore it before enabling autonomous ambient";

    /// <summary>The 400 message when every compare-and-set attempt met a concurrently-changed policy (WR-5).</summary>
    internal const string AmbientPolicyConcurrentChangeError =
        "the ambient policy changed while this request was being applied — reload the settings and try again";

    /// <summary>How many read→check→compare-and-set attempts <see cref="SetAmbientPolicyAsync"/> makes before giving up (WR-5).</summary>
    internal const int AmbientPolicyCasAttempts = 3;

    /// <summary>
    /// Sets the exercise's ambient-chatter policy (<c>POST /api/engine/settings/ambient-policy</c>). Controller-role
    /// only (the endpoint group's filter); scope from <see cref="Pulse.WebApi.Data.IExerciseContext"/> only (COR-001).
    /// Live for the next tick. Emits ONE <see cref="EngineEventTypes.TierPolicyChanged"/> event carrying an
    /// <see cref="EngineEventPayloads.AmbientPolicyChanged"/> payload (from→to + the acting human).
    /// </summary>
    /// <remarks>
    /// The write is a compare-and-set against the snapshot the safety check read
    /// (<see cref="EngineAmbientPolicyRegistry.TrySet"/>, orchestrator review WR-5), retried up to
    /// <see cref="AmbientPolicyCasAttempts"/> times; exhausting them is a 400 with nothing mutated. After a successful
    /// autonomous swap the safety levers are re-checked (orchestrator delta-review W-2): a lever that landed between the
    /// check and the swap demotes the policy straight back to off (an engine-attributed audit event, after the
    /// controller's) and the request is the same safety 400.
    /// Rejected with a 400 and NOTHING mutated: an unknown mode; <c>autonomous</c> while the governed
    /// <c>Generation:Governance:AmbientAutonomyAuthorized</c> flag is false (AC0); <c>autonomous</c> while the kill switch
    /// (either mode) or the cut to Fake is active for the exercise (Gate-1 L-1); a cap above the exercise's
    /// <c>MaxEnginePostsPerMinute</c>; a topic outside the fixed vocabulary; a persona id that is not a persona of
    /// THIS exercise (a cross-exercise id resolves to nothing through the central query filter, so it is rejected
    /// exactly like an unknown one).
    /// <para>
    /// <b>Attribution (orchestrator review W-2).</b> The policy's <see cref="AmbientTierPolicy.SetBy"/> — which an
    /// autonomous post's <c>engine.published</c> actor carries as the human who authorised it — and the audit event's
    /// acting human are the AUTHENTICATED staff user (<paramref name="authenticatedStaffUserId"/>, resolved by the
    /// endpoint from the verified session token via <c>ICurrentStaffSessionAccessor</c>), never the client-supplied
    /// <see cref="EngineAmbientPolicyRequest.ActingHumanId"/>. That field is still required for wire compatibility but is
    /// not trusted for attribution. No resolved staff user fails closed (401), like the route's staff filter.
    /// </para>
    /// <para>
    /// <b>Eligible personas (W-4).</b> Each allow-listed persona must be of an ambient-eligible type
    /// (<see cref="AmbientPolicyValidator.EligiblePersonaTypes"/>): its engine type when it is in the loop's cast,
    /// otherwise its stored archetype (<c>citizen</c> is the only one that maps to an eligible type, Resident). A 400
    /// names the persona and its type.
    /// </para>
    /// </remarks>
    /// <param name="request">The requested policy.</param>
    /// <param name="authenticatedStaffUserId">The verified session's <c>StaffUser.Id</c>, or <c>null</c> when none resolved.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The resulting settings snapshot, or a fail-closed/invalid outcome.</returns>
    public async Task<EngineSettingsResult> SetAmbientPolicyAsync(
        EngineAmbientPolicyRequest request,
        Guid? authenticatedStaffUserId,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (!TryResolveScope(out var exerciseId))
        {
            return EngineSettingsResult.ScopeUnresolved();
        }

        // W-2: attribution comes from the verified session only. No staff user → 401 (fail closed), never a fallback to
        // the client-supplied actingHumanId.
        if (authenticatedStaffUserId is not { } staffUserId || staffUserId == Guid.Empty)
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
                .Select(persona => new { persona.Id, persona.Handle, persona.PersonaType })
                .ToListAsync(cancellationToken);

            foreach (var id in ids)
            {
                var persona = known.FirstOrDefault(p => p.Id == id);
                if (persona is null)
                {
                    return EngineSettingsResult.Invalid($"persona '{id}' is not a persona of this exercise.");
                }

                var ineligibleType = IneligibleAmbientType(exerciseId, id, persona.PersonaType);
                if (ineligibleType is not null)
                {
                    return EngineSettingsResult.Invalid(
                        $"persona '{id}' (@{persona.Handle.TrimStart('@')}) is of type {ineligibleType}, which is not eligible "
                        + $"for ambient chatter (eligible: {string.Join(", ", AmbientPolicyValidator.EligiblePersonaTypes)}).");
                }
            }
        }

        var actor = staffUserId.ToString();
        var policy = draft.ToPolicy(actor);

        // WR-5: compare-and-set. Read the snapshot, run every snapshot-dependent check against it, then TrySet against
        // THAT snapshot; a demotion or another writer landing in between fails the swap, and the loop re-reads and
        // re-checks (bounded). The persona/validation checks above do not depend on the snapshot, so they run once.
        //
        // A1c (Session A): the lead-only raise gate MUST live INSIDE this loop — call
        // AmbientPolicyRaise.IsRaise(snapshot, request) on the snapshot just read, then TrySet(snapshot, next), and on a
        // mismatch re-read and retry — so the raise check and the write are atomic. A pre-Set endpoint filter alone is a
        // TOCTOU: the policy can change between the filter's read and this write.
        AmbientTierPolicy? from = null;
        for (var attempt = 0; attempt < AmbientPolicyCasAttempts && from is null; attempt++)
        {
            var snapshot = _ambientPolicy.Get(exerciseId);

            // Gate-1 L-1: autonomous cannot be (re-)selected while a safety lever is holding the engine — the kill switch
            // in either mode (SafetyClampActive also covers a degraded clamp) or the cut to Fake. Re-evaluated on every
            // attempt, so a set that raced a kill-switch demotion re-reads the clamp and is rejected rather than
            // resurrecting autonomous.
            if (draft.Mode == AmbientPolicyMode.Autonomous && SafetyHeldForAmbient(exerciseId))
            {
                return EngineSettingsResult.Invalid(AutonomousWhileSafetyHeldError);
            }

            if (_ambientPolicy.TrySet(exerciseId, snapshot, policy))
            {
                from = snapshot;
            }
        }

        if (from is null)
        {
            return EngineSettingsResult.Invalid(AmbientPolicyConcurrentChangeError);
        }

        await CommitSettingsEventAsync(
            EngineEventTypes.TierPolicyChanged,
            exerciseId,
            new EngineReviewActionInput(actor, request.TimeZone),
            BuildAmbientChange(from.Mode, policy, EngineEventPayloads.AmbientPolicyChanged.ReasonController, exerciseId),
            cancellationToken);

        // Orchestrator delta-review W-2: re-check the safety levers AFTER the swap. A kill switch / cut to Fake that lands
        // between the in-loop check and TrySet runs its own demotion while the policy is not yet autonomous (a no-op), so
        // the swap would then store autonomous under an engaged lever. The lever is visible here, so the policy is
        // lowered again at once — recorded as an ENGINE demotion (no acting human) — and the request gets the same 400
        // as the pre-check. The controller's swap stays on the record above: it really was live, however briefly.
        if (policy.Mode == AmbientPolicyMode.Autonomous && SafetyHeldForAmbient(exerciseId))
        {
            await DemoteAutonomousAmbientAsync(exerciseId, new EngineReviewActionInput(null, request.TimeZone), cancellationToken);
            return EngineSettingsResult.Invalid(AutonomousWhileSafetyHeldError);
        }

        return EngineSettingsResult.Ok(BuildSettings(exerciseId));
    }

    /// <summary>
    /// Whether a safety lever holds the engine for the exercise — the kill switch in either mode (or a degraded clamp,
    /// via <see cref="Pulse.Core.Features.Autonomy.Services.EngineAutonomyState.SafetyClampActive"/>) or the cut to Fake — so autonomous ambient is refused.
    /// </summary>
    private bool SafetyHeldForAmbient(Guid exerciseId) =>
        _autonomy.GetOrCreate(exerciseId).SafetyClampActive || _providerCut.IsCutToFake(exerciseId);

    /// <summary>
    /// The stored persona archetype (the frontend <c>PersonaType</c> union) that maps to an ambient-eligible engine type
    /// for a persona NOT in the loop's cast: <c>citizen</c> (an ordinary member of the public ⇒ Resident). Every other
    /// archetype — news-outlet, agency, weather-scientific, influencer, business, bad-actor — is ineligible.
    /// </summary>
    internal const string AmbientEligibleProfileType = "citizen";

    /// <summary>
    /// The ineligible type to name in the 400, or <c>null</c> when the persona may voice ambient chatter (W-4). The
    /// loop cast's engine type decides when the persona is in the cast; otherwise the stored archetype does.
    /// </summary>
    private string? IneligibleAmbientType(Guid exerciseId, Guid personaId, string profileType)
    {
        if (_ambientPolicy.CastPersonaType(exerciseId, personaId) is { } castType)
        {
            return AmbientPolicyValidator.IsEligiblePersonaType(castType) ? null : castType.ToString();
        }

        return string.Equals(profileType, AmbientEligibleProfileType, StringComparison.OrdinalIgnoreCase) ? null : $"'{profileType}'";
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

    /// <summary>
    /// Whether a review item is a review-mode AMBIENT draft (no storyline + the ambient tag the loop stamps), so its
    /// approved publish carries <c>trigger = ambient-floor</c> / <c>publishPath = ambient-reviewed</c> (S-1).
    /// </summary>
    private static bool IsAmbientDraft(Data.Entities.EngineReviewItemEntity item) =>
        item.StorylineId == Guid.Empty
        && string.Equals(item.StorylineTag, ReactionLoopDriver.AmbientStorylineTag, StringComparison.Ordinal);

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
