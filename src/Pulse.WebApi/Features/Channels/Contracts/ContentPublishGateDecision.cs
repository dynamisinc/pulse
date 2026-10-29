namespace Pulse.WebApi.Features.Channels.Contracts;

// The value types of FC-7's IContentPublishGate (IContentPublishGate.cs). A gate runs before PublishAsync /
// ScheduleAsync changes state; Hold is a 409 "held" with state unchanged.

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
