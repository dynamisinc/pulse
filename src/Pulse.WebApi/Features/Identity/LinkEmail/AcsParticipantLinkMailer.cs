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
    /// <param name="sendTimeout">
    /// Optional bound on ONE whole send, token acquisition included; <c>null</c> =
    /// <see cref="AcsParticipantLinkMailer.SendTimeout"/>. A test shortens it.
    /// </param>
    public LinkEmailClientSettings(TokenCredential credential, EmailClientOptions? clientOptions = null, TimeSpan? sendTimeout = null)
    {
        ArgumentNullException.ThrowIfNull(credential);
        if (sendTimeout is { } timeout)
        {
            ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(timeout, TimeSpan.Zero, nameof(sendTimeout));
        }

        Credential = credential;
        ClientOptions = clientOptions;
        SendTimeout = sendTimeout ?? AcsParticipantLinkMailer.SendTimeout;
    }

    /// <summary>The token credential.</summary>
    public TokenCredential Credential { get; }

    /// <summary>Optional client options; <c>null</c> means <see cref="AcsParticipantLinkMailer.CreateClientOptions"/>.</summary>
    public EmailClientOptions? ClientOptions { get; }

    /// <summary>The bound on one whole send: the managed-identity token request AND the HTTP call.</summary>
    public TimeSpan SendTimeout { get; }
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
/// (<see cref="WaitUntil.Started"/>), never for delivery, and the WHOLE send, including the managed-identity token
/// request (which the SDK's network timeout does not cover, and which can hang while the identity endpoint retries),
/// gives up after <see cref="SendTimeout"/> through a linked cancellation source.
/// </para>
/// <para>
/// <b>Unconfirmed by default: plain failure only when nothing can have been sent</b> (Copilot review on #487 and its
/// Gate-1 fold, 10/14). The send starts a long-running operation, so anything that does not PROVE the message was
/// refused leaves its fate unknown and is <see cref="LinkMailSendOutcome.TimedOut"/> (unconfirmed: "check before sending
/// again"): no HTTP response (status <c>0</c>: DNS, connection reset or TLS, possibly after the request reached ACS),
/// <c>408</c>, any <c>5xx</c>, any other status that is not a <c>4xx</c> (e.g. a <c>200</c> where <c>202</c> was due),
/// the send's own timeout, and any unexpected fault (e.g. a <c>202</c> whose body cannot be read or parsed).
/// <see cref="LinkMailSendOutcome.Failed"/> means exactly a definite refusal (a <c>4xx</c> other than <c>408</c> and
/// <c>429</c>) or a credential failure (no token, so no request). See <see cref="Classify"/>.
/// </para>
/// <para>
/// <b>Logs (gotcha 8).</b> A failure is logged with the operation and a status only: the HTTP status, or
/// <c>no-response</c> / <c>credential</c> / <c>timeout</c> / <c>unexpected:{exception type}</c>. Never the exception
/// message (a provider or parser message can echo the recipient), the recipient, the subject, the body or the URL.
/// Request and response bodies are never logged by the SDK either (<c>IsLoggingContentEnabled</c> is forced off).
/// </para>
/// </remarks>
public sealed partial class AcsParticipantLinkMailer : IParticipantLinkMailer
{
    /// <summary>The operation name in a failure log line.</summary>
    public const string SendOperation = "acs-email-send";

    /// <summary>
    /// The longest one send may take before it is given up and reported UNCONFIRMED
    /// (<see cref="LinkMailSendOutcome.TimedOut"/>, <c>timedOut</c>): it may already have been accepted.
    /// </summary>
    public static readonly TimeSpan SendTimeout = TimeSpan.FromSeconds(20);

    private readonly EmailClient _client;
    private readonly string _senderAddress;
    private readonly TimeSpan _sendTimeout;
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
        _sendTimeout = clientSettings.SendTimeout;
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

        // Bounds the whole send, token acquisition included: the SDK's NetworkTimeout covers the HTTP call only.
        using var bounded = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        bounded.CancelAfter(_sendTimeout);

        try
        {
            await _client.SendAsync(WaitUntil.Started, email, bounded.Token).ConfigureAwait(false);
            return LinkMailSendOutcome.Sent;
        }
        catch (RequestFailedException exception)
        {
            // Status 0 = no HTTP response (DNS, connection reset, TLS). The message is deliberately not logged.
            var status = exception.Status == 0 ? "no-response" : exception.Status.ToString(CultureInfo.InvariantCulture);
            LogSendFailed(_logger, SendOperation, status);
            return Classify(exception.Status);
        }
        catch (AuthenticationFailedException)
        {
            // The managed identity could not get a token (role not yet propagated, identity off, no az login in Dev).
            LogSendFailed(_logger, SendOperation, "credential");
            return LinkMailSendOutcome.Failed;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            // The send's own bound (or the SDK's network timeout), not the caller's cancellation. Unconfirmed: the
            // provider may have accepted the message before the bound fired, so this is NOT reported as plainly failed.
            LogSendFailed(_logger, SendOperation, "timeout");
            return LinkMailSendOutcome.TimedOut;
        }
#pragma warning disable CA1031 // Any other fault after the call started must become an outcome, not abort the batch.
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // E.g. a 202 whose body cannot be read (IOException) or parsed (JsonException): ACS may well have accepted the
            // message, so it is unconfirmed, never a plain failure staff might resend by hand. The type only: the
            // exception message can carry the body, and so the recipient.
            LogSendFailed(_logger, SendOperation, "unexpected:" + exception.GetType().Name);
            return LinkMailSendOutcome.TimedOut;
        }
#pragma warning restore CA1031
    }

    /// <summary>
    /// What a <see cref="RequestFailedException"/> status means for ONE send: <c>429</c> is
    /// <see cref="LinkMailSendOutcome.RateLimited"/> (throttled, nothing taken); any other <c>4xx</c> except <c>408</c>, a
    /// definite refusal, is <see cref="LinkMailSendOutcome.Failed"/>; EVERYTHING else (<c>0</c> = no HTTP response,
    /// <c>408</c>, any <c>5xx</c>, any <c>2xx</c>/<c>3xx</c> oddity) is <see cref="LinkMailSendOutcome.TimedOut"/>
    /// (UNCONFIRMED: the provider may already have accepted the message, so it is never offered for a blind resend).
    /// </summary>
    private static LinkMailSendOutcome Classify(int status) => status switch
    {
        429 => LinkMailSendOutcome.RateLimited,
        >= 400 and < 500 and not 408 => LinkMailSendOutcome.Failed,
        _ => LinkMailSendOutcome.TimedOut,
    };

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Link email send failed: {Operation} -> {Status}.")]
    private static partial void LogSendFailed(ILogger logger, string operation, string status);
}
