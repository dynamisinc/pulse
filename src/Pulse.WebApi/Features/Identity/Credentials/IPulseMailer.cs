namespace Pulse.WebApi.Features.Identity.Credentials;

using Microsoft.Extensions.Logging;
using Pulse.WebApi.Features.Identity.LinkEmail;

/// <summary>
/// Sends Pulse's credential emails (ADMIN-IDENTITY-MODEL §3.3: one template per purpose — invite, reset). The seam the
/// credential services call; the design generalizes the easy-login <see cref="IParticipantLinkMailer"/> into this, and
/// it deliberately reuses that seam's <see cref="LinkMailSendOutcome"/> vocabulary so the two converge on ONE
/// provider contract when the ACS path is generalized (§3.3 "Email goes through the existing ACS path").
/// </summary>
/// <remarks>
/// <para>
/// <b>Off by default.</b> Email is not configured on UAT and ACS is not deployed, so the registered default is
/// <see cref="NullPulseMailer"/>: <see cref="IsConfigured"/> is <c>false</c> and nothing is sent. Every caller must
/// therefore work without email — the admin reset returns its link once in the response (the copy-link flow).
/// </para>
/// <para>
/// <b>Never logs a recipient, a link or a token</b> (NFR-009): a <see cref="CredentialMail"/> carries a bearer
/// credential, so its <see cref="CredentialMail.ToString"/> withholds everything.
/// </para>
/// </remarks>
public interface IPulseMailer
{
    /// <summary>Whether this host can send at all.</summary>
    bool IsConfigured { get; }

    /// <summary>Sends one credential email to its one recipient. Never throws for a provider failure.</summary>
    /// <param name="mail">The credential email.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Whether the provider accepted it (<see cref="LinkMailSendOutcome.Failed"/> when not configured).</returns>
    Task<LinkMailSendOutcome> SendCredentialLinkAsync(CredentialMail mail, CancellationToken cancellationToken);
}

/// <summary>
/// One credential email: the purpose (which template), the one recipient and the link. Carries a bearer credential, so
/// <see cref="ToString"/> withholds everything and a message that reaches a log by accident leaks nothing.
/// </summary>
public sealed class CredentialMail
{
    /// <summary>The purpose — <c>invite</c> or <c>reset</c> (<see cref="Data.Entities.CredentialTokenPurposes"/>).</summary>
    public required string Purpose { get; init; }

    /// <summary>The one recipient address.</summary>
    public required string RecipientAddress { get; init; }

    /// <summary>The single-use link (its token is in the URL fragment).</summary>
    public required string Link { get; init; }

    /// <inheritdoc />
    public override string ToString() => "CredentialMail (contents withheld: it carries a single-use credential link)";
}

/// <summary>
/// The default <see cref="IPulseMailer"/> of a host with no email: sends nothing, reports
/// <see cref="LinkMailSendOutcome.Failed"/>, and logs ONE line carrying only the purpose — never the recipient, the
/// link or the token.
/// </summary>
public sealed partial class NullPulseMailer : IPulseMailer
{
    private readonly ILogger<NullPulseMailer> _logger;

    /// <summary>Creates the no-op mailer.</summary>
    /// <param name="logger">The structured log (purpose only).</param>
    public NullPulseMailer(ILogger<NullPulseMailer> logger)
    {
        ArgumentNullException.ThrowIfNull(logger);
        _logger = logger;
    }

    /// <inheritdoc />
    public bool IsConfigured => false;

    /// <inheritdoc />
    public Task<LinkMailSendOutcome> SendCredentialLinkAsync(CredentialMail mail, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(mail);
        LogNotSent(mail.Purpose);
        return Task.FromResult(LinkMailSendOutcome.Failed);
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Information,
        Message = "Credential email not sent: email is not configured on this host (purpose {Purpose}).")]
    private partial void LogNotSent(string purpose);
}
