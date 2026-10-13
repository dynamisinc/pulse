namespace Pulse.WebApi.Tests.Features.Identity.EasyLogin;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Features.Identity;
using Pulse.WebApi.Features.Identity.DayWord;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.LinkCards;
using Pulse.WebApi.Features.Identity.LinkEmail;
using Pulse.WebApi.Features.Identity.PersonalLinks;
using Pulse.WebApi.Features.Identity.Roster;
using Xunit;

/// <summary>
/// Easy-login backend seam (feature easy-login, the orchestrator's one commit after backend Wave 1), on the REAL
/// <c>Program</c> with a never-connecting database: plain <see cref="FactAttribute"/>, no SQL.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this exists.</b> Every easy-login slice (stories 02–05) is tested on its own slice-level host, which wires
/// its own <c>AddXxx()</c>/<c>MapXxx()</c>. Such a host cannot notice that <c>Program.cs</c> forgot the line: an unwired
/// slice simply 404s in production (the #310 → #317 lesson). These tests fail if any of the six <c>Add*</c> or five
/// <c>Map*</c> calls (story 13's <c>AddLinkEmail()</c> / <c>MapLinkEmailEndpoints()</c> included) is removed from
/// <c>Program.cs</c>.
/// </para>
/// <para>
/// <b>What is pinned.</b>
/// <list type="bullet">
///   <item><description>Every easy-login route is mapped exactly once.</description></item>
///   <item><description>The two anonymous sign-ins (<c>/api/auth/join</c>, <c>/api/auth/word</c>) are pre-auth, carry the
///   16 KiB login body limit and their own named rate-limit policy, and are NOT answered by the default-deny gate.</description></item>
///   <item><description>Every staff route IS answered by the gate for an anonymous caller (401 + challenge, never 404).</description></item>
///   <item><description>The card route carries its 64 KiB body limit (EL-20); the email-links route its 16 KiB limit.</description></item>
///   <item><description>Story 13 is dark on a host with no <c>Email:*</c> configuration: the mailer is the fail-closed null one.</description></item>
///   <item><description>Story 03's real link issuer replaced story 01's fail-closed null issuer.</description></item>
///   <item><description><c>AddEasyLoginFoundation()</c> is idempotent: a second call adds no second options action.</description></item>
///   <item><description>Every easy-login <c>Add*</c> call is idempotent, and the container still builds its rate-limiter
///   options after each is called twice (Gate-2 CR-001: <c>Program.cs</c> wires them, so a test host that calls one again
///   must not register a second rate-limit policy, which throws at host start).</description></item>
/// </list>
/// The pre-auth allowlist itself (now thirteen routes) is pinned by <c>DefaultDenySessionGateTests</c> and
/// <c>AnonymousAccessRegressionTests</c>.
/// </para>
/// </remarks>
public sealed class EasyLoginCompositionRootWiringTests
{
    private const string AnyId = "00000000-0000-0000-0000-000000000001";

    /// <summary>The two anonymous easy-login sign-ins: method, pattern, rate-limit policy.</summary>
    public static TheoryData<string, string, string> AnonymousSignIns() => new()
    {
        { "POST", JoinEndpoints.JoinRoute, JoinRateLimiterPolicy.PolicyName },
        { "POST", DayWordEndpoints.WordSignInRoute, DayWordEndpoints.WordSignInRateLimitPolicy },
    };

    /// <summary>Every staff-only easy-login route (stories 02, 03, 04, 05, 13).</summary>
    public static TheoryData<string, string> StaffRoutes() => new()
    {
        { "GET", "/api/staff/roster" },
        { "POST", "/api/staff/roster" },
        { "POST", "/api/staff/roster/import" },
        { "POST", "/api/staff/roster/cards" },
        { "POST", "/api/staff/roster/email-links" },
        { "POST", "/api/staff/roster/{id:guid}/link/reissue" },
        { "POST", "/api/staff/roster/{id:guid}/link/revoke" },
        { "POST", "/api/staff/roster/{id:guid}/disable" },
        { "POST", "/api/staff/roster/{id:guid}/enable" },
        { "GET", "/api/staff/day-word" },
        { "PUT", "/api/staff/day-word" },
        { "DELETE", "/api/staff/day-word" },
    };

    [Fact]
    public void ProgramCs_MapsEveryEasyLoginRoute_ExactlyOnce()
    {
        using var factory = new ProbeFactory();
        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        foreach (var row in AnonymousSignIns())
        {
            var (method, pattern) = ((string)row[0], (string)row[1]);
            CountRoutes(dataSource, method, pattern).Should().Be(1, "{0} {1} must be mapped in Program.cs exactly once", method, pattern);
        }

        foreach (var row in StaffRoutes())
        {
            var (method, pattern) = ((string)row[0], (string)row[1]);
            CountRoutes(dataSource, method, pattern).Should().Be(1, "{0} {1} must be mapped in Program.cs exactly once", method, pattern);
        }
    }

    [Theory]
    [MemberData(nameof(AnonymousSignIns))]
    public void TheAnonymousSignIns_ArePreAuth_BodyLimited_AndRateLimited(string method, string pattern, string policy)
    {
        using var factory = new ProbeFactory();
        var endpoint = FindRoute(factory.Services.GetRequiredService<EndpointDataSource>(), method, pattern);

        endpoint.Metadata.GetMetadata<IAllowAnonymous>().Should().NotBeNull(
            "{0} {1} establishes the session, so it must be on the pre-auth allowlist", method, pattern);
        var sizeLimit = endpoint.Metadata.GetMetadata<IRequestSizeLimitMetadata>();
        sizeLimit.Should().NotBeNull("{0} {1} must carry a body limit", method, pattern);
        sizeLimit!.MaxRequestBodySize.Should().Be(
            LoginRequestLimits.MaxLoginRequestBodyBytes, "every anonymous sign-in carries the 16 KiB login body limit");

        var rateLimit = endpoint.Metadata.GetMetadata<EnableRateLimitingAttribute>();
        rateLimit.Should().NotBeNull("{0} {1} must be rate-limited", method, pattern);
        rateLimit!.PolicyName.Should().Be(policy, "{0} {1} must carry its own named per-IP limiter (EL-16)", method, pattern);
    }

    [Fact]
    public void TheCardRoute_CarriesItsBodyLimit()
    {
        using var factory = new ProbeFactory();
        var endpoint = FindRoute(factory.Services.GetRequiredService<EndpointDataSource>(), "POST", LinkCardEndpoints.CardsRoute);

        var sizeLimit = endpoint.Metadata.GetMetadata<IRequestSizeLimitMetadata>();
        sizeLimit.Should().NotBeNull("the cards route must carry a body limit");
        sizeLimit!.MaxRequestBodySize.Should().Be(
            LinkCardEndpoints.MaxRequestBodyBytes, "EL-20: the cards body is capped at 64 KiB (413 beyond it)");
        endpoint.Metadata.GetMetadata<IAllowAnonymous>().Should().BeNull("the card sheet is staff-only");
    }

    [Fact]
    public void TheEmailLinksRoute_CarriesItsBodyLimit_AndIsNotAnonymous()
    {
        using var factory = new ProbeFactory();
        var endpoint = FindRoute(factory.Services.GetRequiredService<EndpointDataSource>(), "POST", LinkEmailEndpoints.EmailLinksRoute);

        var sizeLimit = endpoint.Metadata.GetMetadata<IRequestSizeLimitMetadata>();
        sizeLimit.Should().NotBeNull("the email-links route must carry a body limit");
        sizeLimit!.MaxRequestBodySize.Should().Be(
            LinkEmailEndpoints.MaxRequestBodyBytes, "story 13: the body is capped at 16 KiB (100 ids are about 4 KB)");
        endpoint.Metadata.GetMetadata<IAllowAnonymous>().Should().BeNull("emailing links is staff-only");
    }

    [Fact]
    public void WithNoEmailConfiguration_TheRealHostIsDark_TheMailerIsTheNullOne()
    {
        using var factory = new ProbeFactory();

        var mailer = factory.Services.GetRequiredService<IParticipantLinkMailer>();

        mailer.Should().BeOfType<NullParticipantLinkMailer>(
            "story 13 is dark until Email:Endpoint and Email:SenderAddress are usable (EL-18)");
        mailer.IsConfigured.Should().BeFalse();
    }

    [Theory]
    [MemberData(nameof(StaffRoutes))]
    public async Task AnAnonymousStaffCall_IsAnsweredByTheGate_NeverA404(string method, string pattern)
    {
        using var factory = new ProbeFactory(resolveExercise: true);
        using var client = factory.CreateClient();

        using var request = new HttpRequestMessage(new HttpMethod(method), pattern.Replace("{id:guid}", AnyId, StringComparison.Ordinal));
        using var response = await client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "{0} {1}: anonymous callers are refused", method, pattern);
        response.Headers.WwwAuthenticate.Should().NotBeEmpty("the default-deny gate answers first, before any handler or database work");
    }

    [Theory]
    [MemberData(nameof(AnonymousSignIns))]
    public async Task AnAnonymousSignIn_IsNeverAnsweredByTheGate(string method, string pattern, string policy)
    {
        _ = policy;
        using var factory = new ProbeFactory(resolveExercise: true);
        using var client = factory.CreateClient();

        using var request = new HttpRequestMessage(new HttpMethod(method), pattern);
        using var response = await client.SendAsync(request);

        // Gate-2 S-2: the exact answer, not merely "not 404". An empty body reaches the HANDLER on the real host and is
        // its 400 ProblemDetails, before any database work. A 401 here would be the gate (or a handler refusing a
        // request it should never have judged), a 404 a missing Map call, a 415 a binding change.
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "{0} {1} with an empty body is the handler's 400", method, pattern);
        response.Content.Headers.ContentType?.MediaType.Should().Be("application/problem+json");
        response.Headers.WwwAuthenticate.Should().BeEmpty(
            "{0} {1} is pre-auth: the default-deny gate must not be what answers", method, pattern);
        response.Headers.CacheControl?.NoStore.Should().BeTrue(
            "{0} {1}: every answer of an anonymous sign-in is no-store (its 200 carries the tokens; Gate-2 S-3)", method, pattern);
    }

    [Fact]
    public void TheRealLinkIssuer_ReplacedTheNullIssuer()
    {
        using var factory = new ProbeFactory();
        using var scope = factory.Services.CreateScope();

        scope.ServiceProvider.GetRequiredService<IParticipantLinkIssuer>().Should().BeOfType<ParticipantLinkService>(
            "story 03's AddPersonalLinks must Replace story 01's fail-closed NullParticipantLinkIssuer, or no roster "
            + "participant ever gets a link");
    }

    [Fact]
    public void AddLinkEmail_IsIdempotent()
    {
        var once = new ServiceCollection().AddSingleton<IConfiguration>(new ConfigurationBuilder().Build());
        once.AddLinkEmail();

        var twice = new ServiceCollection().AddSingleton<IConfiguration>(new ConfigurationBuilder().Build());
        twice.AddLinkEmail();
        twice.AddLinkEmail();

        twice.Count.Should().Be(once.Count, "a repeat call registers nothing more (marker, as AddEasyLoginFoundation)");
        twice.Count(d => d.ServiceType == typeof(IConfigureOptions<LinkEmailPacing>)).Should().Be(
            once.Count(d => d.ServiceType == typeof(IConfigureOptions<LinkEmailPacing>)));
    }

    [Fact]
    public void AddEasyLoginFoundation_IsIdempotent()
    {
        var once = new ServiceCollection().AddSingleton<IConfiguration>(new ConfigurationBuilder().Build());
        once.AddEasyLoginFoundation();

        var twice = new ServiceCollection().AddSingleton<IConfiguration>(new ConfigurationBuilder().Build());
        twice.AddEasyLoginFoundation();
        twice.AddEasyLoginFoundation();

        twice.Count.Should().Be(once.Count, "a repeat call (AddLinkCards calls it too) must register nothing more");
        twice.Count(d => d.ServiceType == typeof(IConfigureOptions<EasyLoginOptions>)).Should().Be(
            once.Count(d => d.ServiceType == typeof(IConfigureOptions<EasyLoginOptions>)),
            "a second copy-from-configuration action would overwrite an override registered between the two calls");
    }

    [Fact]
    public void EveryEasyLoginAddCall_IsIdempotent_AndTheRateLimiterOptionsStillBuild()
    {
        // Gate-2 CR-001: Program.cs wires all five, and a test host's ConfigureTestServices runs AFTER Program.cs, so a
        // host that adds one again used to register a second easy-login-word policy and throw at start-up.
        static ServiceCollection Compose(int calls)
        {
            var services = new ServiceCollection();
            services.AddLogging();
            services.AddSingleton<IConfiguration>(new ConfigurationBuilder().Build());
            for (var call = 0; call < calls; call++)
            {
                services.AddEasyLoginFoundation();
                services.AddRoster();
                services.AddPersonalLinks();
                services.AddLinkCards();
                services.AddDayWord();
            }

            return services;
        }

        var once = Compose(1);
        var twice = Compose(2);

        twice.Count.Should().Be(once.Count, "a repeat of any easy-login Add* call must register nothing more");

        using var provider = twice.BuildServiceProvider();
        var build = () => provider.GetRequiredService<IOptions<RateLimiterOptions>>().Value;
        build.Should().NotThrow("the easy-login-join and easy-login-word policies must each be added exactly once");
    }

    private static RouteEndpoint FindRoute(EndpointDataSource dataSource, string method, string rawText) =>
        dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Single(endpoint => Matches(endpoint, method, rawText));

    private static int CountRoutes(EndpointDataSource dataSource, string method, string rawText) =>
        dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Count(endpoint => Matches(endpoint, method, rawText));

    private static bool Matches(RouteEndpoint endpoint, string method, string rawText) =>
        string.Equals(endpoint.RoutePattern.RawText, rawText, StringComparison.OrdinalIgnoreCase)
        && (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false);

    /// <summary>
    /// The real <c>Program</c> host on a never-connecting connection string. When asked, every request resolves to a
    /// fixed exercise (a scope from the bare Host header, and still no session).
    /// </summary>
    private sealed class ProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";
        private readonly bool _resolveExercise;

        public ProbeFactory(bool resolveExercise = false)
        {
            _resolveExercise = resolveExercise;
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, "Server=nonexistent;Database=pulse;Trusted_Connection=False;");
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            ArgumentNullException.ThrowIfNull(builder);
            if (_resolveExercise)
            {
                builder.ConfigureTestServices(services =>
                    services.AddSingleton<IHostExerciseResolver>(new FixedHostExerciseResolver()));
            }
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }

    private sealed class FixedHostExerciseResolver : IHostExerciseResolver
    {
        private static readonly Guid ExerciseId = Guid.Parse("eeeeeeee-0000-4000-8000-00000000000e");

        public Task<Guid?> ResolveExerciseIdAsync(string? rawHost, CancellationToken cancellationToken) =>
            Task.FromResult<Guid?>(ExerciseId);
    }
}
