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

/// <summary>The action a gate is asked about.</summary>
public sealed record PublishContext
{
    /// <summary>The publish action: <see cref="Publish"/> or <see cref="Schedule"/>.</summary>
    public required string Action { get; init; }

    /// <summary>The caller's origin (<see cref="ChannelVocabulary.ContentOrigins"/>).</summary>
    public required string Origin { get; init; }

    /// <summary>The acting human.</summary>
    public required string ActingHumanId { get; init; }

    /// <summary>The <c>publish</c> action literal.</summary>
    public const string Publish = "publish";

    /// <summary>The <c>schedule</c> action literal.</summary>
    public const string Schedule = "schedule";
}

/// <summary>A gate's decision.</summary>
public sealed record ContentPublishGateDecision
{
    private ContentPublishGateDecision(bool allowed, string? auditNote, string? reason)
    {
        Allowed = allowed;
        AuditNote = auditNote;
        Reason = reason;
    }

    /// <summary>Whether the action may proceed.</summary>
    public bool Allowed { get; }

    /// <summary>
    /// On allow: a note written to the <c>content_published</c> event as <c>payload.gateNote</c> (press records a
    /// controller bypass of a pending approval this way), or null.
    /// </summary>
    public string? AuditNote { get; }

    /// <summary>On hold: why.</summary>
    public string? Reason { get; }

    /// <summary>Proceed.</summary>
    /// <param name="auditNote">An optional audit note.</param>
    /// <returns>The decision.</returns>
    public static ContentPublishGateDecision Allow(string? auditNote = null) => new(true, auditNote, null);

    /// <summary>Hold: 409 <c>held</c>, state unchanged.</summary>
    /// <param name="reason">Why.</param>
    /// <returns>The decision.</returns>
    public static ContentPublishGateDecision Hold(string reason) => new(false, null, reason);
}
