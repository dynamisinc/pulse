namespace Pulse.WebApi.Tests.Features.Identity.Accounts;

using System;
using System.Diagnostics;
using System.Linq;
using System.Net;
using System.Net.Http;
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
    public async Task ParticipantLogin_OrdinaryIsUnchanged_OversizeRawUsernameIs400Fast_OversizeBodyIs413()
    {
        var (host, username) = await SeedAsync();
        await using var factory = KestrelFactory.Start(_fixture.ConnectionString!);
        using var client = factory.ClientFor(host);

        using var ordinary = await client.PostAsJsonAsync("/api/auth/login", new { username, password = Password });
        ordinary.StatusCode.Should().Be(HttpStatusCode.OK, "an ordinary login is unchanged: " + await ordinary.Content.ReadAsStringAsync());
        JsonDocument.Parse(await ordinary.Content.ReadAsStringAsync()).RootElement.EnumerateObject().Should().NotBeEmpty();

        var stopwatch = Stopwatch.StartNew();
        using var oversizeRaw = await client.PostAsJsonAsync(
            "/api/auth/login",
            new { username = string.Concat(Enumerable.Repeat("<b>", ParticipantLoginService.MaxRawUsernameLength / 3 + 1)), password = Password });
        stopwatch.Stop();
        oversizeRaw.StatusCode.Should().Be(HttpStatusCode.BadRequest, "a raw handle over 4x the maximum is refused before sanitizing");
        (await oversizeRaw.Content.ReadAsStringAsync()).Should().Contain($"username must be at most {AccountFieldRules.MaxUsernameLength} characters.");
        stopwatch.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(2));

        using var oversizeBody = await client.PostAsync("/api/auth/login", OversizeJsonBody("username"));
        oversizeBody.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge, "a body over 16 KiB is refused while it is read");
    }

    [RequiresDockerTheory]
    [InlineData("/api/auth/staff/login", "username")]
    [InlineData("/api/auth/shared", "password")]
    public async Task TheOtherAnonymousLogins_RefuseAnOversizeBody_With413(string route, string field)
    {
        var (host, _) = await SeedAsync();
        await using var factory = KestrelFactory.Start(_fixture.ConnectionString!);
        using var client = factory.ClientFor(host);

        using var response = await client.PostAsync(route, OversizeJsonBody(field));

        response.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge, "{0} is bounded at 16 KiB too", route);
    }

    private static StringContent OversizeJsonBody(string field) =>
        new($"{{\"{field}\":\"{new string('a', (int)LoginRequestLimits.MaxLoginRequestBodyBytes + 1024)}\"}}", Encoding.UTF8, "application/json");

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
