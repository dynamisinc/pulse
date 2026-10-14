namespace Pulse.WebApi.Tests.Features.Identity.LinkEmail;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Azure.Communication.Email;
using Azure.Core;
using Azure.Core.Pipeline;
using Azure.Identity;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Features.Identity.LinkEmail;

/// <summary>
/// easy-login/13: <see cref="AcsParticipantLinkMailer"/> against a fake HTTP transport (no network). It proves the
/// send is KEYLESS (a bearer token from the <c>TokenCredential</c>, never an HMAC access-key signature), the message is
/// exactly one bare recipient with no cc/bcc/reply-to and tracking disabled, from <c>Email:SenderAddress</c>; that
/// <c>202</c> is sent, <c>429</c> is rate-limited and anything else (including a credential failure) is failed, each
/// after ONE attempt (no automatic resend); and that a failure log names the operation and status only.
/// </summary>
public sealed class AcsParticipantLinkMailerTests
{
    private const string Recipient = "jane.smith@example.org";
    private const string JoinUrl = "https://pulse-uat.cobrasoftware.com/join/AbCdEfGhIjKlMnOpQrSt_-";

    [Fact]
    public async Task A202_IsSent_KeylessWithABearerToken_ToOneBareRecipient_WithTrackingOff()
    {
        var transport = new FakeAcsEmailHandler(HttpStatusCode.Accepted);
        var mailer = CreateMailer(transport, new LinkEmailCapturingLoggerProvider());

        var outcome = await mailer.SendAsync(Message(), CancellationToken.None);

        outcome.Should().Be(LinkMailSendOutcome.Sent);
        var request = transport.Requests.Should().ContainSingle().Subject;
        request.Method.Should().Be("POST");
        request.Uri.GetLeftPart(UriPartial.Path).Should().Be($"{LinkEmailTestWorld.AcsEndpoint}/emails:send");
        request.Authorization.Should().Be("Bearer fake-managed-identity-token", "the managed identity's token, never an access key");
        request.HasHmacSignature.Should().BeFalse("no access-key (HMAC) authentication is ever used");

        using var body = JsonDocument.Parse(request.Body);
        var root = body.RootElement;
        root.GetProperty("senderAddress").GetString().Should().Be(LinkEmailTestWorld.Sender);
        root.GetProperty("userEngagementTrackingDisabled").GetBoolean().Should().BeTrue("no open or click tracking is injected");

        var recipients = root.GetProperty("recipients");
        var to = recipients.GetProperty("to").EnumerateArray().Should().ContainSingle().Subject;
        to.GetProperty("address").GetString().Should().Be(Recipient);
        if (to.TryGetProperty("displayName", out var displayName) && displayName.ValueKind == JsonValueKind.String)
        {
            displayName.GetString().Should().BeNullOrEmpty("nothing the participant typed is placed in a header");
        }

        CountOrZero(recipients, "cc").Should().Be(0, "no other recipients");
        CountOrZero(recipients, "bcc").Should().Be(0, "no other recipients");
        CountOrZero(root, "replyTo").Should().Be(0);
        CountOrZero(root, "attachments").Should().Be(0);
        if (root.TryGetProperty("headers", out var headers) && headers.ValueKind == JsonValueKind.Object)
        {
            headers.EnumerateObject().Should().BeEmpty("no custom header carries anything");
        }

        var content = root.GetProperty("content");
        content.GetProperty("subject").GetString().Should().Be("Your sign-in link for Coastal Surge 2026");
        content.GetProperty("html").GetString().Should().Contain(JoinUrl);
        content.GetProperty("plainText").GetString().Should().Contain(JoinUrl);
    }

    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests, LinkMailSendOutcome.RateLimited, "429")]
    [InlineData(HttpStatusCode.InternalServerError, LinkMailSendOutcome.Failed, "500")]
    [InlineData(HttpStatusCode.ServiceUnavailable, LinkMailSendOutcome.Failed, "503")]
    [InlineData(HttpStatusCode.Unauthorized, LinkMailSendOutcome.Failed, "401")]
    [InlineData(HttpStatusCode.BadRequest, LinkMailSendOutcome.Failed, "400")]
    public async Task AProviderRefusal_IsOneAttempt_MappedToAnOutcome_AndLoggedWithOperationAndStatusOnly(
        HttpStatusCode status,
        LinkMailSendOutcome expected,
        string loggedStatus)
    {
        var transport = new FakeAcsEmailHandler(status);
        var logs = new LinkEmailCapturingLoggerProvider();
        var mailer = CreateMailer(transport, logs);

        var outcome = await mailer.SendAsync(Message(), CancellationToken.None);

        outcome.Should().Be(expected);
        transport.Requests.Should().ContainSingle("no automatic retry: a resend could email the person twice");
        var line = logs.Messages.Should().ContainSingle(m => m.Contains("Link email send failed", StringComparison.Ordinal)).Subject;
        line.Should().Contain(AcsParticipantLinkMailer.SendOperation).And.Contain(loggedStatus);
        AssertNoSecret(logs.All);
    }

    [Fact]
    public async Task ACredentialFailure_IsFailed_AndSendsNothing()
    {
        var transport = new FakeAcsEmailHandler(HttpStatusCode.Accepted);
        var logs = new LinkEmailCapturingLoggerProvider();
        var mailer = CreateMailer(transport, logs, new FailingTokenCredential());

        var outcome = await mailer.SendAsync(Message(), CancellationToken.None);

        outcome.Should().Be(LinkMailSendOutcome.Failed);
        transport.Requests.Should().BeEmpty("without a token the request is never sent");
        logs.All.Should().Contain("credential");
        AssertNoSecret(logs.All);
    }

    [Fact]
    public async Task ASlowTokenRequest_IsBoundedBySendTimeout_AndReportedAsTimedOut_NotPlainlyFailed()
    {
        // W-3: the SDK's NetworkTimeout covers the HTTP call only; a managed-identity endpoint that hangs or retries
        // would otherwise hold the whole batch. The linked cancellation source bounds token acquisition too.
        var transport = new FakeAcsEmailHandler(HttpStatusCode.Accepted);
        var logs = new LinkEmailCapturingLoggerProvider();
        var mailer = CreateMailer(transport, logs, new HangingTokenCredential(), sendTimeout: TimeSpan.FromMilliseconds(200));
        var clock = System.Diagnostics.Stopwatch.StartNew();

        var outcome = await mailer.SendAsync(Message(), CancellationToken.None);

        clock.Stop();
        outcome.Should().Be(
            LinkMailSendOutcome.TimedOut, "a timed-out send is unconfirmed (it may have been accepted), not plainly failed");
        clock.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(10), "the send gave up at its bound, not when the token arrived");
        transport.Requests.Should().BeEmpty("no token, no request");
        logs.Messages.Should().ContainSingle(m => m.Contains("Link email send failed", StringComparison.Ordinal))
            .Which.Should().Contain("timeout");
    }

    [Fact]
    public async Task TheCallersCancellation_IsNotATimeout_ItPropagates()
    {
        var mailer = CreateMailer(
            new FakeAcsEmailHandler(HttpStatusCode.Accepted),
            new LinkEmailCapturingLoggerProvider(),
            new HangingTokenCredential(),
            sendTimeout: TimeSpan.FromMinutes(5));
        using var cancelled = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));

        var send = () => mailer.SendAsync(Message(), cancelled.Token);

        await send.Should().ThrowAsync<OperationCanceledException>();
    }

    [Fact]
    public void TheProductionClientOptions_RetryNothing_AreBounded_AndNeverLogContent()
    {
        var options = AcsParticipantLinkMailer.CreateClientOptions();
        new LinkEmailClientSettings(new FixedTokenCredential()).SendTimeout.Should().Be(
            AcsParticipantLinkMailer.SendTimeout, "the whole send is bounded by default");

        options.Retry.MaxRetries.Should().Be(0);
        options.Retry.NetworkTimeout.Should().Be(AcsParticipantLinkMailer.SendTimeout);
        options.Diagnostics.IsLoggingContentEnabled.Should().BeFalse("a request body holds the address and the join URL");
    }

    [Theory]
    [InlineData(null, null, false, new string[0])]
    [InlineData("", "DoNotReply@x.azurecomm.net", false, new string[0])]
    [InlineData("https://acs.unitedstates.communication.azure.com", "DoNotReply@x.azurecomm.net", true, new string[0])]
    [InlineData("http://acs.unitedstates.communication.azure.com", "DoNotReply@x.azurecomm.net", false, new[] { "Email:Endpoint" })]
    [InlineData("acs.unitedstates.communication.azure.com", "DoNotReply@x.azurecomm.net", false, new[] { "Email:Endpoint" })]
    [InlineData("https://acs.example.com/?key=abc", "DoNotReply@x.azurecomm.net", false, new[] { "Email:Endpoint" })]
    [InlineData("https://acs.unitedstates.communication.azure.com", null, false, new[] { "Email:SenderAddress" })]
    [InlineData("https://acs.unitedstates.communication.azure.com", "Pulse <DoNotReply@x.azurecomm.net>", false, new[] { "Email:SenderAddress" })]
    public void TheSettings_AreUsableOnlyWithAnHttpsEndpointAndABareSender(
        string? endpoint,
        string? sender,
        bool usable,
        string[] problemKeys)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            [LinkEmailSettings.EndpointKey] = endpoint,
            [LinkEmailSettings.SenderAddressKey] = sender,
        }).Build();

        var settings = LinkEmailSettings.TryRead(configuration, out var problems);

        (settings is not null).Should().Be(usable);
        problems.Should().Equal(problemKeys, "only KEY names are reported, never a value");
        LinkEmailSettings.IsRequested(configuration).Should().Be(!string.IsNullOrWhiteSpace(endpoint),
            "the same rule the roster's capabilities.emailLinks applies");
    }

    private static AcsParticipantLinkMailer CreateMailer(
        FakeAcsEmailHandler transport,
        LinkEmailCapturingLoggerProvider logs,
        TokenCredential? credential = null,
        TimeSpan? sendTimeout = null)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            [LinkEmailSettings.EndpointKey] = LinkEmailTestWorld.AcsEndpoint,
            [LinkEmailSettings.SenderAddressKey] = LinkEmailTestWorld.Sender,
        }).Build();
        var settings = LinkEmailSettings.TryRead(configuration, out _)!;

        var options = AcsParticipantLinkMailer.CreateClientOptions();
        options.Transport = new HttpClientTransport(new HttpClient(transport));

        var factory = LoggerFactory.Create(builder => builder.AddProvider(logs));
        return new AcsParticipantLinkMailer(
            settings,
            new LinkEmailClientSettings(credential ?? new FixedTokenCredential(), options, sendTimeout),
            factory.CreateLogger<AcsParticipantLinkMailer>());
    }

    private static LinkEmailMessage Message() =>
        LinkEmailComposer.Compose(Recipient, "Coastal Surge 2026", "Jane Smith", "jsmith", JoinUrl);

    private static int CountOrZero(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Array ? value.GetArrayLength() : 0;

    private static void AssertNoSecret(string logs)
    {
        logs.Should().NotContain(Recipient).And.NotContain(JoinUrl).And.NotContain("AbCdEfGhIjKlMnOpQrSt_-")
            .And.NotContain("Jane Smith").And.NotContain("fake-managed-identity-token");
    }

    /// <summary>A fixed bearer token: the managed identity's stand-in.</summary>
    private sealed class FixedTokenCredential : TokenCredential
    {
        public override AccessToken GetToken(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
            new("fake-managed-identity-token", DateTimeOffset.UtcNow.AddHours(1));

        public override ValueTask<AccessToken> GetTokenAsync(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
            ValueTask.FromResult(GetToken(requestContext, cancellationToken));
    }

    /// <summary>A credential whose token request never answers (an identity endpoint that hangs); it honours cancellation.</summary>
    private sealed class HangingTokenCredential : TokenCredential
    {
        public override AccessToken GetToken(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
            GetTokenAsync(requestContext, cancellationToken).AsTask().GetAwaiter().GetResult();

        public override async ValueTask<AccessToken> GetTokenAsync(TokenRequestContext requestContext, CancellationToken cancellationToken)
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            throw new InvalidOperationException("unreachable");
        }
    }

    /// <summary>A credential that cannot get a token (role not propagated, identity off).</summary>
    private sealed class FailingTokenCredential : TokenCredential
    {
        public override AccessToken GetToken(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
            throw new AuthenticationFailedException("ManagedIdentityCredential authentication failed for jane.smith@example.org");

        public override ValueTask<AccessToken> GetTokenAsync(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
            throw new AuthenticationFailedException("ManagedIdentityCredential authentication failed for jane.smith@example.org");
    }
}

/// <summary>A fake Communication Services email endpoint: records each request and answers with a fixed status.</summary>
internal sealed class FakeAcsEmailHandler : HttpMessageHandler
{
    private readonly HttpStatusCode _status;
    private readonly ConcurrentQueue<RecordedEmailRequest> _requests = new();

    public FakeAcsEmailHandler(HttpStatusCode status) => _status = status;

    public IReadOnlyList<RecordedEmailRequest> Requests => _requests.ToArray();

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content is null ? string.Empty : await request.Content.ReadAsStringAsync(cancellationToken);
        _requests.Enqueue(new RecordedEmailRequest(
            request.Method.Method,
            request.RequestUri!,
            request.Headers.Authorization?.ToString(),
            request.Headers.Contains("x-ms-content-sha256"),
            body));

        var operationId = Guid.NewGuid().ToString();
        var response = new HttpResponseMessage(_status)
        {
            Content = _status == HttpStatusCode.Accepted
                ? new StringContent($"{{\"id\":\"{operationId}\",\"status\":\"Running\"}}", Encoding.UTF8, "application/json")
                : new StringContent(
                    "{\"error\":{\"code\":\"Refused\",\"message\":\"Refused for jane.smith@example.org\"}}",
                    Encoding.UTF8,
                    "application/json"),
        };
        if (_status == HttpStatusCode.Accepted)
        {
            response.Headers.TryAddWithoutValidation(
                "Operation-Location",
                $"{LinkEmailTestWorld.AcsEndpoint}/emails/operations/{operationId}?api-version=2023-03-31");
        }

        if (_status == HttpStatusCode.TooManyRequests)
        {
            response.Headers.TryAddWithoutValidation("Retry-After", "60");
        }

        return response;
    }
}

/// <summary>One request the SDK sent.</summary>
internal sealed record RecordedEmailRequest(string Method, Uri Uri, string? Authorization, bool HasHmacSignature, string Body);
