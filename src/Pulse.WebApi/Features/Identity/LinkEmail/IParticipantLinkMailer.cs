namespace Pulse.WebApi.Features.Identity.LinkEmail;

/// <summary>
/// Sends one already-composed personal-link email (easy-login story 13). The seam between
/// <see cref="LinkEmailService"/> (who gets what) and the provider (how it leaves): <see cref="AcsParticipantLinkMailer"/>
/// in a configured host, the fail-closed <see cref="NullParticipantLinkMailer"/> otherwise, and a fake in tests.
/// </summary>
/// <remarks>
/// <b>One place decides "configured".</b> <see cref="IsConfigured"/> is what the endpoint's <c>503</c> reads, and it is
/// <c>true</c> only for a host whose <c>Email:*</c> settings are usable (<see cref="LinkEmailSettings.TryRead"/>). A
/// mailer never throws for a provider failure: it answers <see cref="LinkMailSendOutcome.Failed"/> or
/// <see cref="LinkMailSendOutcome.RateLimited"/>, so one bad send cannot abort a batch.
/// </remarks>
public interface IParticipantLinkMailer
{
    /// <summary>Whether this host can send at all. <c>false</c> means the endpoint answers <c>503</c> and sends nothing.</summary>
    bool IsConfigured { get; }

    /// <summary>Sends <paramref name="message"/> to its one recipient. Never logs the recipient, the subject or the body.</summary>
    /// <param name="message">The composed message.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Whether the provider accepted it for delivery.</returns>
    Task<LinkMailSendOutcome> SendAsync(LinkEmailMessage message, CancellationToken cancellationToken);
}

/// <summary>What happened to one send.</summary>
public enum LinkMailSendOutcome
{
    /// <summary>The provider accepted the message for delivery (<c>202</c>). Delivery itself is not tracked.</summary>
    Sent,

    /// <summary>The provider throttled the send (<c>429</c>). Nothing was sent; try again later.</summary>
    RateLimited,

    /// <summary>Anything else: refused, unreachable, timed out, or the credential failed. Nothing is known to be sent.</summary>
    Failed,
}

/// <summary>
/// One composed personal-link email: a single recipient, a subject, an HTML body and a plain-text alternative. Built
/// only by <see cref="LinkEmailComposer"/>. It carries a bearer credential (the join URL) and an email address, so its
/// <see cref="ToString"/> withholds everything: a message that reaches a log by accident leaks nothing.
/// </summary>
public sealed class LinkEmailMessage
{
    /// <summary>The one recipient (a bare mailbox, <see cref="LinkEmailAddresses.IsDeliverable"/>). No cc, no bcc.</summary>
    public required string RecipientAddress { get; init; }

    /// <summary>The subject, single-line and free of control characters.</summary>
    public required string Subject { get; init; }

    /// <summary>The HTML body. Every interpolated value is HTML-encoded; no image, script, style sheet or remote content.</summary>
    public required string HtmlBody { get; init; }

    /// <summary>The minimal plain-text alternative.</summary>
    public required string PlainTextBody { get; init; }

    /// <inheritdoc />
    public override string ToString() => "LinkEmailMessage (contents withheld: it carries a sign-in link)";
}

/// <summary>
/// The mailer of a host with no usable <c>Email:*</c> settings: <see cref="IsConfigured"/> is <c>false</c>, so the
/// endpoint answers <c>503</c> before any send, and <see cref="SendAsync"/> (unreachable through the service) sends
/// nothing and reports a failure. It never logs: an unconfigured host is a normal, quiet state (EL-18).
/// </summary>
public sealed class NullParticipantLinkMailer : IParticipantLinkMailer
{
    /// <inheritdoc />
    public bool IsConfigured => false;

    /// <inheritdoc />
    public Task<LinkMailSendOutcome> SendAsync(LinkEmailMessage message, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(message);
        return Task.FromResult(LinkMailSendOutcome.Failed);
    }
}
