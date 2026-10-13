namespace Pulse.WebApi.Tests.Features.Identity.PersonalLinks;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.PersonalLinks;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// easy-login/03 (join AC 2, abuse AC) — <c>POST /api/auth/join</c> over HTTP. The <c>[Fact]</c>s run on a DB-less slice
/// host (every path they assert returns before a database is touched): 400 for a missing body or empty token, the
/// bodyless 401 for an unresolved host, the <c>easy-login-join</c> limit (default 30 per minute, configurable, 429
/// beyond), the 16 KiB body limit enforced by Kestrel (413), and the route's pre-auth / body-limit / rate-limit
/// metadata. The <c>[RequiresDockerFact]</c>s run the real pipeline (host resolution, sessions, default-deny) against
/// SQL: the 200 is exactly the <c>/api/auth/login</c> envelope, and every refusal is the same bodyless 401.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class JoinEndpointsHttpTests
{
    private readonly MsSqlContainerFixture _fixture;

    public JoinEndpointsHttpTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private static async Task<IHost> StartSliceHostAsync(IDictionary<string, string?>? settings = null, bool kestrel = false)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(settings ?? new Dictionary<string, string?>())
            .Build();

        return await new HostBuilder()
            .ConfigureAppConfiguration(builder => builder.AddConfiguration(configuration))
            .ConfigureWebHost(web =>
            {
                if (kestrel)
                {
                    web.UseKestrel(options => options.Listen(IPAddress.Loopback, 0));
                }
                else
                {
                    web.UseTestServer();
                }

                web.ConfigureServices(services =>
                {
                    services.AddRouting();

                    // Never connects: every asserted path returns first. No host resolution: the scope stays unset.
                    services.AddDbContext<PulseDbContext>(options =>
                        options.UseSqlServer("Server=nonexistent;Database=pulse;Trusted_Connection=False;"));
                    services.AddScoped<IExerciseContext, ExerciseContext>();
                    services.AddScoped<ISessionIssuer, RecordingSessionIssuer>();
                    services.AddEasyLoginFoundation();
                    services.AddPersonalLinks();
                });
                web.Configure(app =>
                {
                    app.UseRouting();
                    app.UseRateLimiter();
                    app.UseEndpoints(endpoints => endpoints.MapPersonalLinkEndpoints());
                });
            })
            .StartAsync();
    }

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");

    [Theory]
    [InlineData("null")]
    [InlineData("{}")]
    [InlineData("{\"token\":null}")]
    [InlineData("{\"token\":\"\"}")]
    [InlineData("{\"token\":\"   \"}")]
    public async Task Join_AMissingBodyOrEmptyToken_Is400ProblemDetails(string body)
    {
        using var host = await StartSliceHostAsync();
        using var client = host.GetTestClient();

        using var response = await client.PostAsync(JoinEndpoints.JoinRoute, Json(body));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "{0} carries no token", body);
        response.Content.Headers.ContentType?.MediaType.Should().Be("application/problem+json");
        (await response.Content.ReadAsStringAsync()).Should().Contain("token is required.");
    }

    [Fact]
    public async Task Join_WithNoResolvedHost_IsABodyless401()
    {
        using var host = await StartSliceHostAsync();
        using var client = host.GetTestClient();

        using var response = await client.PostAsJsonAsync(JoinEndpoints.JoinRoute, new { token = ParticipantLinkTokens.Generate() });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await response.Content.ReadAsByteArrayAsync()).Should().BeEmpty("a refusal never explains itself");
        response.Headers.CacheControl!.NoStore.Should().BeTrue("every join response is no-store (S-001)");
    }

    [Fact]
    public async Task Join_TheThirtyFirstRequestInAMinute_Is429_ByDefault()
    {
        using var host = await StartSliceHostAsync();
        using var client = host.GetTestClient();

        for (var attempt = 1; attempt <= 30; attempt++)
        {
            using var allowed = await client.PostAsync(JoinEndpoints.JoinRoute, Json("null"));
            allowed.StatusCode.Should().Be(HttpStatusCode.BadRequest, "attempt {0} is within the default 30 per minute", attempt);
        }

        using var limited = await client.PostAsync(JoinEndpoints.JoinRoute, Json("null"));
        limited.StatusCode.Should().Be(HttpStatusCode.TooManyRequests, "easy-login-join admits 30 per minute per IP (EL-16)");
    }

    [Fact]
    public async Task Join_TheLimit_ComesFromEasyLoginOptions()
    {
        using var host = await StartSliceHostAsync(new Dictionary<string, string?>
        {
            ["Authentication:EasyLogin:JoinPermitPerMinute"] = "3",
        });
        using var client = host.GetTestClient();

        for (var attempt = 1; attempt <= 3; attempt++)
        {
            using var allowed = await client.PostAsync(JoinEndpoints.JoinRoute, Json("null"));
            allowed.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        using var limited = await client.PostAsync(JoinEndpoints.JoinRoute, Json("null"));
        limited.StatusCode.Should().Be(HttpStatusCode.TooManyRequests, "operators set the limit without a deploy");
    }

    [Fact]
    public async Task Join_AnOversizeBody_IsRefusedWith413_WhileItIsRead()
    {
        // TestServer does not enforce body limits; Kestrel does.
        using var host = await StartSliceHostAsync(kestrel: true);
        var address = host.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First();
        using var client = new HttpClient { BaseAddress = new Uri(address) };

        var oversize = $"{{\"token\":\"{new string('a', (int)LoginRequestLimits.MaxLoginRequestBodyBytes + 1024)}\"}}";
        using var response = await client.PostAsync(JoinEndpoints.JoinRoute, Json(oversize));

        response.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge, "the join body is bounded at 16 KiB");
    }

    [Fact]
    public async Task Join_Route_IsPreAuth_BodyLimited_AndOnItsOwnRateLimitPolicy()
    {
        using var host = await StartSliceHostAsync();

        var endpoint = host.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>()
            .Should().ContainSingle(e => e.RoutePattern.RawText == JoinEndpoints.JoinRoute).Subject;

        endpoint.Metadata.GetMetadata<HttpMethodMetadata>()!.HttpMethods.Should().Equal("POST");
        endpoint.Metadata.GetMetadata<IAllowAnonymous>().Should().NotBeNull(
            "the join establishes the session (.AllowAnonymousPreAuth()); the seam commit adds it to PreAuthAllowlist");
        endpoint.Metadata.GetMetadata<IRequestSizeLimitMetadata>()!.MaxRequestBodySize.Should().Be(16 * 1024);
        endpoint.Metadata.GetMetadata<EnableRateLimitingAttribute>()!.PolicyName.Should().Be("easy-login-join");
        PreAuthAllowlist.KeysFor(endpoint).Should().Equal("POST /api/auth/join");
    }

    [RequiresDockerFact]
    public async Task Join_Success_Is200_WithExactlyTheLoginEnvelope()
    {
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var personaId = Guid.NewGuid();
        var account = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id, personaId: personaId, withPassword: true);
        var (_, token) = await PersonalLinkSeed.LinkAsync(_fixture, account);

        await using var host = await PersonalLinksTestHost.StartAsync(_fixture.ConnectionString!);
        using var client = host.Client(exercise.Hostname);

        using var joined = await PersonalLinksTestHost.JoinAsync(client, token);
        joined.StatusCode.Should().Be(HttpStatusCode.OK, await joined.Content.ReadAsStringAsync());
        joined.Headers.CacheControl!.NoStore.Should().BeTrue("the 200 carries session and refresh tokens (S-001)");
        var join = await PersonalLinksTestHost.JsonAsync(joined);

        using var loggedIn = await client.PostAsJsonAsync("/api/auth/login", new { username = account.Username, password = PersonalLinkSeed.Password });
        loggedIn.StatusCode.Should().Be(HttpStatusCode.OK);
        var login = await PersonalLinksTestHost.JsonAsync(loggedIn);

        Keys(join).Should().Equal(Keys(login), "the join answers exactly the /api/auth/login envelope");
        Keys(join.GetProperty("session")).Should().Equal(Keys(login.GetProperty("session")));
        Keys(join).Should().BeEquivalentTo("token", "refreshToken", "session");

        var session = join.GetProperty("session");
        session.GetProperty("exerciseId").GetString().Should().Be(exercise.Id.ToString());
        session.GetProperty("accountId").GetString().Should().Be(account.Id.ToString());
        session.GetProperty("role").GetString().Should().Be("participant");
        session.GetProperty("personaId").GetString().Should().Be(personaId.ToString());
        session.GetProperty("actingHumanId").GetString().Should().Be(account.Id.ToString());
        session.GetProperty("isReadOnly").GetBoolean().Should().BeFalse();
        join.GetProperty("token").GetString().Should().NotBeNullOrEmpty();
        join.GetProperty("refreshToken").GetString().Should().NotBeNullOrEmpty();

        // The issued token is a working participant session on this exercise's host.
        using var authed = host.Client(exercise.Hostname, join.GetProperty("token").GetString());
        (await authed.GetAsync("/api/session")).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [RequiresDockerFact]
    public async Task Join_EveryRefusal_IsTheSameBodyless401_OverTheRealPipeline()
    {
        var exerciseA = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var exerciseB = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var closed = await PersonalLinkSeed.ExerciseAsync(_fixture, status: "completed");

        var revokedAccount = await PersonalLinkSeed.AccountAsync(_fixture, exerciseA.Id);
        var (_, revokedToken) = await PersonalLinkSeed.LinkAsync(_fixture, revokedAccount, revoked: true);
        var disabledAccount = await PersonalLinkSeed.AccountAsync(_fixture, exerciseA.Id, disabledAt: DateTimeOffset.UtcNow);
        var (_, disabledToken) = await PersonalLinkSeed.LinkAsync(_fixture, disabledAccount);
        var accountB = await PersonalLinkSeed.AccountAsync(_fixture, exerciseB.Id);
        var (_, tokenB) = await PersonalLinkSeed.LinkAsync(_fixture, accountB);
        var closedAccount = await PersonalLinkSeed.AccountAsync(_fixture, closed.Id);
        var (_, closedToken) = await PersonalLinkSeed.LinkAsync(_fixture, closedAccount);

        await using var host = await PersonalLinksTestHost.StartAsync(_fixture.ConnectionString!);

        var attempts = new (string Case, string? Host, string Token)[]
        {
            ("unknown token", exerciseA.Hostname, ParticipantLinkTokens.Generate()),
            ("malformed token", exerciseA.Hostname, "%%%"),
            ("revoked link", exerciseA.Hostname, revokedToken),
            ("disabled account", exerciseA.Hostname, disabledToken),
            ("exercise B's token on A's host", exerciseA.Hostname, tokenB),
            ("completed exercise", closed.Hostname, closedToken),
            ("unresolved host", "nobody.pulse.test", tokenB),
        };

        foreach (var (name, hostName, token) in attempts)
        {
            using var client = host.Client(hostName);
            using var response = await PersonalLinksTestHost.JoinAsync(client, token);

            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "{0} is refused", name);
            (await response.Content.ReadAsByteArrayAsync()).Should().BeEmpty("{0}: the 401 carries no body", name);
            response.Content.Headers.ContentType.Should().BeNull("{0}: every 401 has the same (empty) shape", name);
        }

        // Exercise B's token still works on B's host: it was refused on A only because it is not A's.
        using var onB = host.Client(exerciseB.Hostname);
        (await PersonalLinksTestHost.JoinAsync(onB, tokenB)).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [RequiresDockerTheory]
    [InlineData("disable")]
    [InlineData("reissue")]
    [InlineData("revoke")]
    public async Task Join_RacingAStaffAction_BetweenTheLookupAndTheIssue_IsTheUniform401_AndLeavesNoLiveSession(string staffAction)
    {
        // Gate-1 W-001: the lookup admits the token, then staff disables / reissues / revokes BEFORE the session is minted
        // (the racing issuer runs the change on its own connection first). The staff sweep cannot see a session that does
        // not exist yet, so the join itself must notice and refuse.
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var account = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id);
        var (seededLink, token) = await PersonalLinkSeed.LinkAsync(_fixture, account);

        async Task RaceAsync()
        {
            await using var staffSide = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id });
            switch (staffAction)
            {
                case "disable":
                    (await staffSide.Accounts.SingleAsync(a => a.Id == account.Id)).DisabledAt = DateTimeOffset.UtcNow;
                    break;
                case "reissue":
                    await PersonalLinkSeed.LinkService(staffSide, exercise.Id).ReissueAsync(account, Guid.NewGuid(), DateTimeOffset.UtcNow);
                    break;
                default:
                    ParticipantLinkService.Revoke(
                        await staffSide.ParticipantLinks.SingleAsync(l => l.Id == seededLink.Id), Guid.NewGuid(), DateTimeOffset.UtcNow);
                    break;
            }

            await staffSide.SaveChangesAsync();
        }

        await using var host = await PersonalLinksTestHost.StartAsync(
            _fixture.ConnectionString!,
            configureServices: services => services.Replace(ServiceDescriptor.Scoped<ISessionIssuer>(
                provider => new RacingSessionIssuer(ActivatorUtilities.CreateInstance<SessionIssuer>(provider), RaceAsync))));
        using var client = host.Client(exercise.Hostname);

        using var response = await PersonalLinksTestHost.JoinAsync(client, token);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "a join that lost the race to {0} is refused", staffAction);
        (await response.Content.ReadAsByteArrayAsync()).Should().BeEmpty("the same bodyless 401 as every other refusal");

        await using var unfiltered = _fixture.CreateContext();
        var sessions = await unfiltered.Sessions.AsNoTracking().Where(s => s.AccountId == account.Id).ToListAsync();
        sessions.Should().ContainSingle("precondition: the session was minted before the re-check").Which.RevokedAt.Should().NotBeNull(
            "the raced session is ended at once: no live session survives the {0}", staffAction);

        var events = await PersonalLinkSeed.ReadEventsAsync(_fixture, exercise.Id);
        var evt = events.Should().ContainSingle("a raced attempt emits exactly one login event, and no success event").Subject;
        evt.Payload.Should().Be("{\"outcome\":\"failure\",\"method\":\"link\"}");
        evt.Actor.Kind.Should().Be("system");
        evt.Actor.ParticipantId.Should().BeNull("the refusal names nobody");
        evt.Target.Should().BeNull();

        var link = await PersonalLinkSeed.ReadLinkAsync(_fixture, exercise.Id, account.Id);
        link!.UseCount.Should().Be(0, "a refused attempt is not a use");
        (await PersonalLinkSeed.ReadAccountAsync(_fixture, exercise.Id, account.Id)).LastLoginAt.Should().BeNull();
    }

    private static string[] Keys(JsonElement element) =>
        element.EnumerateObject().Select(property => property.Name).OrderBy(name => name, StringComparer.Ordinal).ToArray();
}
