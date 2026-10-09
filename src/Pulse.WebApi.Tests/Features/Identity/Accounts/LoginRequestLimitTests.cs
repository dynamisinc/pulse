namespace Pulse.WebApi.Tests.Features.Identity.Accounts;

using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity;
using Pulse.WebApi.Features.Identity.Accounts;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Xunit;

/// <summary>
/// Wave 1b Gate-2 M-1, model half (plain <see cref="FactAttribute"/>s, no Docker): the three ANONYMOUS login routes
/// carry the 16 KiB body limit on the real <c>Program</c> host, and the raw-username bound is pinned.
/// </summary>
public sealed class LoginRequestLimitModelTests
{
    [Theory]
    [InlineData("/api/auth/login")]
    [InlineData("/api/auth/staff/login")]
    [InlineData("/api/auth/shared")]
    public void ProgramCs_MapsEveryAnonymousLoginRoute_WithThe16KiBBodyLimit(string route)
    {
        using var factory = new DummyDatabaseFactory();
        var endpoint = factory.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>()
            .Single(e => string.Equals(e.RoutePattern.RawText, route, StringComparison.OrdinalIgnoreCase)
                && (e.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains("POST") ?? false));

        endpoint.Metadata.GetMetadata<IRequestSizeLimitMetadata>()?.MaxRequestBodySize.Should().Be(
            16 * 1024, "an anonymous login must not inherit Kestrel's ~30 MB default ({0})", route);
        LoginRequestLimits.MaxLoginRequestBodyBytes.Should().Be(16 * 1024);
    }

    [Fact]
    public void TheRawUsernameBound_IsFourTimesThePersistedMaximum() =>
        ParticipantLoginService.MaxRawUsernameLength.Should().Be(4 * AccountFieldRules.MaxUsernameLength);

    /// <summary>The real host on a never-connecting database, for endpoint metadata only.</summary>
    private sealed class DummyDatabaseFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

        public DummyDatabaseFactory() =>
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, "Server=nonexistent;Database=pulse;Trusted_Connection=False;");

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}

/// <summary>
/// Wave 1b Gate-2 M-1 over the REAL server: the anonymous participant login used to sanitize an uncapped username
/// under Kestrel's ~30 MB default body limit (0.3–1.7 s of CPU and 90–240 MiB per request, measured). Now the raw
/// username is bounded before sanitizing (400, fast), the body is bounded while it is read (413), and an ordinary
/// login is unchanged. Boots <c>Program</c> on Kestrel because TestServer does not enforce body limits.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class LoginRequestLimitTests
{
    private const string Password = "pw-kestrel-123";

    private readonly MsSqlContainerFixture _fixture;

    public LoginRequestLimitTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task ParticipantLogin_OrdinaryIsUnchanged_OversizeRawUsernameIs400BeforeSanitizing_OversizeBodyIs413()
    {
        var (host, username) = await SeedAsync();
        await using var factory = KestrelFactory.Start(_fixture.ConnectionString!);
        using var client = factory.ClientFor(host);

        using var ordinary = await client.PostAsJsonAsync("/api/auth/login", new { username, password = Password });
        ordinary.StatusCode.Should().Be(HttpStatusCode.OK, "an ordinary login is unchanged: " + await ordinary.Content.ReadAsStringAsync());
        JsonDocument.Parse(await ordinary.Content.ReadAsStringAsync()).RootElement.EnumerateObject().Should().NotBeEmpty();

        // The handle is pure markup, so it would SANITIZE to empty ("username is required."). Getting the length
        // message instead is what proves the raw cap ran before the sanitizer.
        var stopwatch = Stopwatch.StartNew();
        using var oversizeRaw = await client.PostAsJsonAsync(
            "/api/auth/login",
            new { username = string.Concat(Enumerable.Repeat("<b>", ParticipantLoginService.MaxRawUsernameLength / 3 + 1)), password = Password });
        stopwatch.Stop();
        oversizeRaw.StatusCode.Should().Be(HttpStatusCode.BadRequest, "a raw handle over 4x the maximum is refused before sanitizing");
        (await oversizeRaw.Content.ReadAsStringAsync()).Should().Contain($"username must be at most {AccountFieldRules.MaxUsernameLength} characters.");

        // A coarse REGRESSION GUARD only, not the proof of the cap (the message above is): the linear sanitizer is
        // quick on 1 KB either way. It trips if a refused login ever starts doing real work again (a KDF, a
        // quadratic sanitizer), with headroom for a loaded CI runner.
        stopwatch.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(2), "regression guard: a refused login stays cheap");

        using var oversizeBody = await client.PostAsync("/api/auth/login", OversizeJsonBody("username"));
        oversizeBody.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge, "a body over 16 KiB is refused while it is read");
    }

    [RequiresDockerTheory]
    [InlineData("/api/auth/login", "username", false)]
    [InlineData("/api/auth/login", "username", true)]
    [InlineData("/api/auth/staff/login", "username", false)]
    [InlineData("/api/auth/staff/login", "username", true)]
    [InlineData("/api/auth/shared", "password", false)]
    [InlineData("/api/auth/shared", "password", true)]
    public async Task EveryAnonymousLogin_RefusesAnOversizeBody_With413_EvenChunked(string route, string field, bool chunked)
    {
        // The chunked case sends NO Content-Length (Transfer-Encoding: chunked), so the limit has to be enforced while
        // the body streams in rather than from the header (Wave 3 Gate-2 L-4).
        var (host, _) = await SeedAsync();
        await using var factory = KestrelFactory.Start(_fixture.ConnectionString!);
        using var client = factory.ClientFor(host);

        var body = OversizeJsonBytes(field);
        using var request = new HttpRequestMessage(HttpMethod.Post, route)
        {
            Content = chunked ? new UnknownLengthContent(body) : new ByteArrayContent(body),
        };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        if (chunked)
        {
            request.Headers.TransferEncodingChunked = true;
        }

        using var response = await client.SendAsync(request);

        response.StatusCode.Should().Be(
            HttpStatusCode.RequestEntityTooLarge, "{0} is bounded at 16 KiB while the body is read (chunked: {1})", route, chunked);
        request.Content.Headers.ContentLength.Should().Be(chunked ? null : (long?)body.Length, "precondition: chunked sends no Content-Length");
    }

    [RequiresDockerFact]
    public async Task ParticipantLogin_AHandleOverTheMaximum_GetsTheSame400Text_BelowAndAboveTheRawCap()
    {
        // Wave 3 Gate-2 S-5: the raw cap (1,024) is 4x the stored maximum (256). Between the two, a handle reaches the
        // normal validation (AccountFieldRules.TryNormalizeUsername, the rule accounts are created under) and gets
        // the same text as one over the raw cap — never an ordinary 401 that a handle no account can have would earn.
        var (host, _) = await SeedAsync();
        await using var factory = KestrelFactory.Start(_fixture.ConnectionString!);
        using var client = factory.ClientFor(host);
        var tooLong = $"username must be at most {AccountFieldRules.MaxUsernameLength} characters.";

        foreach (var length in new[]
        {
            AccountFieldRules.MaxUsernameLength + 1,
            300,
            ParticipantLoginService.MaxRawUsernameLength,
            ParticipantLoginService.MaxRawUsernameLength + 1,
        })
        {
            using var response = await client.PostAsJsonAsync("/api/auth/login", new { username = new string('u', length), password = Password });
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "a {0}-character handle is longer than any stored one", length);
            (await response.Content.ReadAsStringAsync()).Should().Contain(tooLong, "one message on both sides of the raw cap ({0})", length);
        }

        using var atMaximum = await client.PostAsJsonAsync(
            "/api/auth/login", new { username = new string('u', AccountFieldRules.MaxUsernameLength), password = Password });
        atMaximum.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "a handle at the maximum is a normal credential check (no such account)");
    }

    private static StringContent OversizeJsonBody(string field) =>
        new(Encoding.UTF8.GetString(OversizeJsonBytes(field)), Encoding.UTF8, "application/json");

    private static byte[] OversizeJsonBytes(string field) =>
        Encoding.UTF8.GetBytes($"{{\"{field}\":\"{new string('a', (int)LoginRequestLimits.MaxLoginRequestBodyBytes + 1024)}\"}}");

    private async Task<(string Host, string Username)> SeedAsync()
    {
        var exerciseId = Guid.NewGuid();
        var host = $"login-{exerciseId:N}.pulse.test";
        var username = $"user-{exerciseId:N}";
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = exerciseId,
            Name = $"Exercise {exerciseId:N}",
            Hostname = host,
            TimeZone = "UTC",
            Status = "live",
        });
        seed.Accounts.Add(new Account
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            Username = username,
            DisplayName = "Kestrel User",
            Role = "participant",
            CredentialHash = new ParticipantPasswordHasher().Hash(Password),
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
        return (host, username);
    }

    /// <summary>A body whose length is not computed up front, so the client must send it chunked.</summary>
    private sealed class UnknownLengthContent(byte[] bytes) : HttpContent
    {
        protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) =>
            stream.WriteAsync(bytes, 0, bytes.Length);

        protected override bool TryComputeLength(out long length)
        {
            length = -1;
            return false;
        }
    }

    /// <summary>The real <c>Program</c> host on Kestrel (dynamic port), nothing replaced.</summary>
    private sealed class KestrelFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

        private KestrelFactory(string connectionString) =>
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);

        public static KestrelFactory Start(string connectionString)
        {
            var factory = new KestrelFactory(connectionString);
            factory.UseKestrel(0);
            factory.StartServer();
            return factory;
        }

        public HttpClient ClientFor(string host)
        {
            var address = Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First();
            var client = new HttpClient { BaseAddress = new Uri(address) };
            client.DefaultRequestHeaders.Host = host;
            return client;
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}
