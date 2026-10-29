namespace Pulse.WebApi.Features.Channels.Contracts;

using Pulse.WebApi.Data.Entities;

/// <summary>
/// FC-7, an optional check the funnel runs BEFORE <c>PublishAsync</c> / <c>ScheduleAsync</c> changes state
/// (registry and default pass-through in channels-foundation story 04). <see cref="ContentPublishGateDecision.Hold"/>
/// is a 409 <c>held</c> with state unchanged. A channel gate that needs a participant paper trail (press's
/// <c>IReleaseApprovalGate</c>) stays channel-owned and calls the funnel only after it passes.
/// </summary>
public interface IContentPublishGate
{
    /// <summary>Decides whether the action may proceed.</summary>
    /// <param name="item">The item about to change state.</param>
    /// <param name="context">The action and who is taking it.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Allow (with an optional audit note) or Hold (with a reason).</returns>
    Task<ContentPublishGateDecision> EvaluateAsync(
        ContentItem item, PublishContext context, CancellationToken cancellationToken = default);
}
