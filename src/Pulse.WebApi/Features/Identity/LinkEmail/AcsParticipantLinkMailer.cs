namespace Pulse.WebApi.Features.Identity.LinkEmail;

using System.Globalization;
using Azure;
using Azure.Communication.Email;
using Azure.Core;
using Azure.Identity;
using Microsoft.Extensions.Logging;

/// <summary>
/// The credential (and, for a test host, the client options) the Communication Services email client is built with.
/// Production registers the App Service's system-assigned managed identity, or <c>DefaultAzureCredential</c> in
/// Development, through the SAME selection the media slice makes (<c>MediaEndpoints.CreateCredential</c>). It carries a
/// <see cref="TokenCredential"/> only: there is no connection-string or access-key member to put here.
/// </summary>
public sealed class LinkEmailClientSettings
{
    /// <summary>Creates the settings.</summary>
    /// <param name="credential">The token credential (never a key).</param>
    /// <param name="clientOptions">Optional client options (a test host substitutes the transport); <c>null</c> = production options.</param>
    public LinkEmailClientSettings(TokenCredential credential, EmailClientOptions? clientOptions = null)
    {
        ArgumentNullException.ThrowIfNull(credential);

        Credential = credential;
        ClientOptions = clientOptions;
    }

    /// <summary>The token credential.</summary>
    public TokenCredential Credential { get; }

    /// <summary>Optional client options; <c>null</c> means <see cref="AcsParticipantLinkMailer.CreateClientOptions"/>.</summary>
    public EmailClientOptions? ClientOptions { get; }
}

/// <summary>
/// Sends personal-link emails through Azure Communication Services Email (<c>Azure.Communication.Email</c>), KEYLESS:
/// <c>new EmailClient(endpoint, tokenCredential)</c>, never a connection string or access key (story 13, NFR-009).
/// </summary>
/// <remarks>
/// <para>
/// <b>The message.</b> Exactly one recipient (a bare address: no display name, so nothing a participant typed reaches a
/// header), no cc, no bcc, no reply-to, no custom header, no attachment, and user-engagement tracking explicitly
/// disabled (no open or click tracking is injected). The sender is <c>Email:SenderAddress</c>.
/// </para>
/// <para>
/// <b>One attempt, bounded.</b> <see cref="CreateClientOptions"/> turns the SDK's automatic retry OFF: a timed-out
/// send may already have been accepted, so a silent retry could email the same person twice (and "resending
/// automatically" is out of scope), and a <c>429</c>'s <c>Retry-After</c> on an Azure-managed domain (5 a minute, 10 an
/// hour) would otherwise stall the whole batch. Each send waits for the provider's <c>202 Accepted</c> only
/// (<see cref="WaitUntil.Started"/>), never for delivery, and gives up after <see cref="SendTimeout"/>.
/// </para>
/// <para>
/// <b>Logs (gotcha 8).</b> A failure is logged with the operation and a status only: the HTTP status, or
/// <c>credential</c> / <c>timeout</c>. Never the exception message (a provider message can echo the recipient), the
/// recipient, the subject, the body or the URL. Request and response bodies are never logged by the SDK either
/// (<c>IsLoggingContentEnabled</c> is forced off).
/// </para>
/// </remarks>
public sealed partial class AcsParticipantLinkMailer : IParticipantLinkMailer
{
    /// <summary>The operation name in a failure log line.</summary>
    public const string SendOperation = "acs-email-send";

    /// <summary>The longest one send may take before it is reported as failed.</summary>
    public static readonly TimeSpan SendTimeout = TimeSpan.FromSeconds(20);

    private readonly EmailClient _client;
    private readonly string _senderAddress;
    private readonly ILogger<AcsParticipantLinkMailer> _logger;

    /// <summary>Creates the mailer. Constructing it performs no I/O.</summary>
    /// <param name="settings">The validated endpoint and sender.</param>
    /// <param name="clientSettings">The token credential and optional client options.</param>
    /// <param name="logger">The logger (operation + status only).</param>
    public AcsParticipantLinkMailer(
        LinkEmailSettings settings,
        LinkEmailClientSettings clientSettings,
        ILogger<AcsParticipantLinkMailer> logger)
    {
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentNullException.ThrowIfNull(clientSettings);
        ArgumentNullException.ThrowIfNull(logger);

        _client = new EmailClient(settings.Endpoint, clientSettings.Credential, clientSettings.ClientOptions ?? CreateClientOptions());
        _senderAddress = settings.SenderAddress;
        _logger = logger;
    }

    /// <inheritdoc />
    public bool IsConfigured => true;

    /// <summary>The production client options: no automatic retry, a bounded network timeout, no content logging.</summary>
    /// <returns>Fresh options.</returns>
    public static EmailClientOptions CreateClientOptions()
    {
        var options = new EmailClientOptions();
        options.Retry.MaxRetries = 0;
        options.Retry.NetworkTimeout = SendTimeout;
        options.Diagnostics.IsLoggingContentEnabled = false;
        return options;
    }

    /// <inheritdoc />
    public async Task<LinkMailSendOutcome> SendAsync(LinkEmailMessage message, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(message);

        var email = new EmailMessage(
            _senderAddress,
            new EmailRecipients([new EmailAddress(message.RecipientAddress)]),
            new EmailContent(message.Subject)
            {
                Html = message.HtmlBody,
                PlainText = message.PlainTextBody,
            })
        {
            UserEngagementTrackingDisabled = true,
        };

        try
        {
            await _client.SendAsync(WaitUntil.Started, email, cancellationToken).ConfigureAwait(false);
            return LinkMailSendOutcome.Sent;
        }
        catch (RequestFailedException exception)
        {
            // Status 0 = no HTTP response (DNS, connection refused, TLS). The message is deliberately not logged.
            var status = exception.Status == 0 ? "no-response" : exception.Status.ToString(CultureInfo.InvariantCulture);
            LogSendFailed(_logger, SendOperation, status);
            return exception.Status == 429 ? LinkMailSendOutcome.RateLimited : LinkMailSendOutcome.Failed;
        }
        catch (AuthenticationFailedException)
        {
            // The managed identity could not get a token (role not yet propagated, identity off, no az login in Dev).
            LogSendFailed(_logger, SendOperation, "credential");
            return LinkMailSendOutcome.Failed;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            // The SDK's network timeout, not the caller's cancellation.
            LogSendFailed(_logger, SendOperation, "timeout");
            return LinkMailSendOutcome.Failed;
        }
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Link email send failed: {Operation} -> {Status}.")]
    private static partial void LogSendFailed(ILogger logger, string operation, string status);
}
