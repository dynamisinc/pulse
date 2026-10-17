namespace Pulse.WebApi.Features.EngineRuntime;

using System;
using System.Linq;
using Pulse.Core.Features.Ambient.Models;
using Pulse.Core.Features.Ambient.Services;

/// <summary>
/// The pure "is this a raise?" rule for the ambient-chatter policy (ambient-chatter story 01, orchestrator review W-1),
/// for Session A's lead-only gate (A1c, <c>LeadControllerRaiseFilter.AmbientPolicy</c>): raising ambient toward
/// unreviewed output is lead-only; lowering it is open to any controller.
/// </summary>
/// <remarks>
/// <para>A request is a <b>raise</b> when it moves toward unreviewed (autonomous) output:</para>
/// <list type="bullet">
/// <item><description>(a) the requested mode is <c>autonomous</c> and the current mode is not; or</description></item>
/// <item><description>(b) the current mode is <c>autonomous</c>, the requested mode is still <c>autonomous</c>, and the
/// request raises <c>maxPerMinute</c> or <c>maxPerHour</c>, or adds any topic or persona to the allow-lists.</description></item>
/// </list>
/// <para>
/// Everything else is <b>not</b> a raise: any change between <c>off</c> and <c>review</c> (review drafts still wait for
/// a human), lowering a cap, removing allow-list entries, and switching from <c>autonomous</c> to <c>review</c> or
/// <c>off</c>. A request whose mode literal does not parse is not a raise (validation rejects it 400). A persona entry
/// that does not parse as a GUID counts as an addition (fail closed); a missing cap is not a raise (validation 400s).
/// Pure: no I/O, no clock.
/// </para>
/// </remarks>
public static class AmbientPolicyRaise
{
    /// <summary>Whether <paramref name="request"/> raises <paramref name="current"/> toward unreviewed output (see remarks).</summary>
    /// <param name="current">The exercise's current policy (<see cref="EngineAmbientPolicyRegistry.Get"/>).</param>
    /// <param name="request">The incoming <c>POST /api/engine/settings/ambient-policy</c> body.</param>
    /// <returns><c>true</c> for a raise (lead-only once A1c lands); otherwise <c>false</c>.</returns>
    public static bool IsRaise(AmbientTierPolicy current, EngineAmbientPolicyRequest request)
    {
        ArgumentNullException.ThrowIfNull(current);
        ArgumentNullException.ThrowIfNull(request);

        if (!AmbientPolicyModes.TryParse(request.Mode, out var requested) || requested != AmbientPolicyMode.Autonomous)
        {
            return false;
        }

        if (current.Mode != AmbientPolicyMode.Autonomous)
        {
            return true; // (a)
        }

        // (b) autonomous → autonomous: widening the caps or the allow-lists.
        if (request.MaxPerMinute is { } perMinute && perMinute > current.MaxPerMinute)
        {
            return true;
        }

        if (request.MaxPerHour is { } perHour && perHour > current.MaxPerHour)
        {
            return true;
        }

        if ((request.TopicAllowList ?? []).Any(topic => !current.TopicAllowList.Contains(topic, StringComparer.Ordinal)))
        {
            return true;
        }

        return (request.PersonaAllowList ?? []).Any(raw =>
            !Guid.TryParse(raw, out var personaId) || !current.PersonaAllowList.Contains(personaId));
    }
}
