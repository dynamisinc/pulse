namespace Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// FC-7, raises and clears in-fiction alerts (implemented by channels-foundation story 10). Used by the
/// console flag (CTL-021), weather issuance (WX-011), news flash (NWS-012) and the funnel's
/// <see cref="PublishOptions.Alert"/>. Every change broadcasts <c>AlertsChanged</c> with the full active set.
/// Scope is the ambient server-resolved exercise; no member takes an exercise id.
/// </summary>
public interface IAlertRaiser
{
    /// <summary>Raises an alert, stamped with the exercise's scenario time.</summary>
    /// <param name="raise">What to raise.</param>
    /// <param name="caller">The authenticated caller (origin + acting human, staff-only provenance).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The participant-safe alert as raised.</returns>
    Task<AlertDto> RaiseAsync(AlertRaise raise, ContentCaller caller, CancellationToken cancellationToken = default);

    /// <summary>Clears an active alert. Clearing an unknown, cross-exercise or already-cleared id is a no-op returning false.</summary>
    /// <param name="id">The alert id.</param>
    /// <param name="caller">The authenticated caller.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns><c>true</c> when an active alert was cleared.</returns>
    Task<bool> ClearAsync(Guid id, ContentCaller caller, CancellationToken cancellationToken = default);
}

/// <summary>The input to <see cref="IAlertRaiser.RaiseAsync"/>.</summary>
public sealed record AlertRaise
{
    /// <summary>The severity (<see cref="ChannelVocabulary.AlertSeverities"/>).</summary>
    public required string Severity { get; init; }

    /// <summary>The headline, shown verbatim as the alert <c>message</c>.</summary>
    public required string Headline { get; init; }

    /// <summary>The host-relative "Details" target (never absolute, FC-9.3), or null.</summary>
    public string? Href { get; init; }

    /// <summary>The source channel id, or <see cref="ChannelVocabulary.AlertSourceSystem"/>.</summary>
    public required string SourceChannel { get; init; }

    /// <summary>The content item that raised it, or null.</summary>
    public Guid? SourceContentId { get; init; }

    /// <summary>The scenario-time expiry as an ISO string, or null.</summary>
    public string? ExpiresScenarioTime { get; init; }
}
