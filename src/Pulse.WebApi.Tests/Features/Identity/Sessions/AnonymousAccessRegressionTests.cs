namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using FluentAssertions.Execution;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// Story <c>identity-auth-roles/14</c> (#367) — the anonymous-access regression suite, and the audit's own
/// "highest-leverage item". Verifies stories 11, 12 and 13 together by driving the REAL
/// <see cref="WebApplicationFactory{TEntryPoint}"/> host with NO credential at all, over EVERY route the host
/// actually maps.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why enumeration rather than a list.</b> Twelve routes plus both hub endpoints sat open to a completely
/// unauthenticated caller in a 747-test suite, for one reason: the SPA always attaches a bearer token and every
/// existing test authenticated first, so nothing in CI had ever walked the anonymous path. A hand-typed list of
/// routes would reproduce that blind spot for every endpoint added after this file. So the route set comes from
/// the live <see cref="EndpointDataSource"/> of a real host — a newly mapped endpoint is covered the moment it is
/// mapped, with nobody writing a test for it. <see cref="PreAuthAllowlist"/> is the ONLY hand-maintained artifact,
/// and it is the same constant the runtime marks reference, so the two cannot drift.
/// </para>
/// <para>
/// <b>What this adds over <see cref="DefaultDenySessionGateTests"/>.</b> That suite (story 11) asserts the
/// composition-root INVARIANT over the same enumeration — an endpoint carries <c>IAllowAnonymous</c> if and only
/// if the allowlist names it — plus behavioural spot checks on the twelve routes the audit proved open. This suite
/// is the BEHAVIOURAL sweep: it actually issues a credential-less request to every mapped route and reads the
/// answer. Metadata being right and the pipeline behaving right are different claims, and only the second one is
/// what a caller experiences.
/// </para>
/// <para>
/// <b>Status alone cannot discriminate; the RFC 6750 challenge header can.</b> <c>POST /api/auth/refresh</c> is
/// allowlisted and still answers 401 with no refresh token, so "did it 401?" cannot tell "the gate refused" from
/// "a handler refused". Only <c>AuthorizationMiddleware</c>'s challenge writes
/// <c>WWW-Authenticate: Bearer</c>, so that header is the discriminator throughout.
/// </para>
/// <para>
/// <b>Two traps, both live.</b> (1) Naming any service method <c>BindAsync</c> or <c>TryParse</c> makes
/// <c>ParameterBindingMethodCache</c> throw while BUILDING the <see cref="EndpointDataSource"/> — a completely
/// unrelated-looking naming choice anywhere in the codebase makes this suite fail to even construct its host.
/// Check for that before assuming the gate broke. (2) A slice can merge fully green with its <c>Program.cs</c>
/// wiring never executed (#310/#317), because a slice's own tests map the endpoint in their own
/// <c>TestServer</c>. This suite therefore uses <see cref="WebApplicationFactory{TEntryPoint}"/> EXCLUSIVELY —
/// a self-hosted <c>TestServer</c> here would validate nothing.
/// </para>
/// </remarks>
public sealed class AnonymousAccessRegressionTests
{
    /// <summary>
    /// The three engine review routes the audit inferred rather than probed ("behavior inferred from the shared
    /// MapGroup filter"). Named explicitly so the inference becomes an assertion — the sweeps cover them anyway via
    /// enumeration, and this list only guarantees the enumeration really reached them.
    /// </summary>
    /// <remarks>
    /// A COVERAGE guard, not an exemption: like the pattern list in
    /// <see cref="TheEnumerationCoversTheRoutesTheAuditProvedOpen"/>, it can only ever make the sweep stricter. The
    /// suite's one hand-maintained EXEMPTION — the only list that can excuse a route from an assertion — is
    /// <see cref="BodyValidatedBeforeIdentity"/>.
    /// </remarks>
    private static readonly string[] PreviouslyUnprobedEngineRoutes =
    [
        "/api/engine/review/{draftId:guid}/edit",
        "/api/engine/review/{draftId:guid}/re-roll",
        "/api/engine/review/{draftId:guid}/veto",
    ];

    // ==========================================================================================
    // The sweep.
    // ==========================================================================================

    [Fact]
    public async Task EveryNonAllowlistedRoute_WithNoCredential_IsRefusedByTheGate()
    {
        // The whole point of the story, in one assertion over every route the host maps. Run as a single Fact
        // rather than a [MemberData] theory on purpose: parameterizing would force the host to be built during
        // xUnit's DISCOVERY phase, where the process-wide ConnectionStrings__DefaultConnection mutation this
        // factory needs has no ordering guarantee against other test classes' hosts. An AssertionScope buys back
        // what the theory would have given — every failing route is reported in one run, not just the first.
        using var factory = new AnonymousProbeFactory();
        using var client = factory.CreateClient();

        var probes = GatedProbes(factory).ToList();

        probes.Should().NotBeEmpty(
            "the enumeration must actually have found gated routes — an empty sweep would pass silently and "
            + "prove nothing, which is the exact failure mode this story exists to prevent");

        using var scope = new AssertionScope();
        foreach (var probe in probes)
        {
            using var request = new HttpRequestMessage(new HttpMethod(probe.Method), probe.Url);
            using var response = await client.SendAsync(request);

            response.StatusCode.Should().Be(
                HttpStatusCode.Unauthorized,
                "{0} {1} is not on the pre-auth allowlist, so a caller presenting no credential at all must be "
                + "refused before any handler runs",
                probe.Method,
                probe.Pattern);
            response.Headers.WwwAuthenticate.Should().NotBeEmpty(
                "{0} {1} must be refused by the GATE (which challenges per RFC 6750), not incidentally by a "
                + "handler that ran anyway",
                probe.Method,
                probe.Pattern);
        }
    }

    [Fact]
    public async Task EveryAllowlistedRoute_WithNoCredential_IsNotRefusedByTheGate()
    {
        // The inverse sweep, and the one that catches an over-broad gate. What these routes RETURN is each
        // endpoint's own business — 400 for a missing body, 404 for an unconfigured ops secret, 401 from
        // /api/auth/refresh itself, 500 where the handler reaches this host's deliberately-dead database. The
        // regression guarded here is narrow and exact: the gate must not be what answers.
        using var factory = new AnonymousProbeFactory();
        using var client = factory.CreateClient();

        var probes = AllowlistedProbes(factory).ToList();

        // Not self-referential, and that is the point. `HaveCount(PreAuthAllowlist.Routes.Count)` alone would pass
        // for ANY allowlist, however large — and story 11's marks-equal-allowlist invariant is self-referential the
        // same way, so a route added to the allowlist AND marked .AllowAnonymousPreAuth() would be invisible to
        // every test in both suites. The literal pins it: GROWING the pre-auth allowlist must fail a test and force
        // a decision, not merely appear in a diff and hope a human notices (AC4).
        PreAuthAllowlist.Routes.Should().HaveCount(
            11,
            "the pre-auth allowlist is the one deliberately hand-maintained opt-out in the whole gate; a new entry "
            + "is a security decision and must be made explicitly here as well as there");

        probes.Should().HaveCount(
            PreAuthAllowlist.Routes.Count,
            "every allowlisted route must actually be mapped by the host — an allowlist entry naming a route "
            + "nobody maps is a stale opt-out nobody would notice");

        using var scope = new AssertionScope();
        foreach (var probe in probes)
        {
            using var request = new HttpRequestMessage(new HttpMethod(probe.Method), probe.Url);
            using var response = await client.SendAsync(request);

            response.Headers.WwwAuthenticate.Should().BeEmpty(
                "{0} {1} is on the pre-auth allowlist and must stay reachable without a session — the three "
                + "/api/ops/* routes especially, since bootstrap runs against an empty database with no session "
                + "to present and its X-Bootstrap-Secret is checked INSIDE the handler, after the gate",
                probe.Method,
                probe.Pattern);
        }
    }

    [Fact]
    public void TheEnumerationCoversTheRoutesTheAuditProvedOpen()
    {
        // The guard that makes both sweeps above discriminating. Without it, a route table that silently stopped
        // including (say) the whole Social slice would make the sweep pass by covering nothing — and #310/#317 is
        // the proof that a slice CAN vanish from the real host's route table while its own tests stay green.
        using var factory = new AnonymousProbeFactory();

        var patterns = GatedProbes(factory).Select(probe => probe.Pattern).ToHashSet(StringComparer.OrdinalIgnoreCase);

        patterns.Should().Contain(
        [
            "/api/feed",
            "/api/personas",

            // The only parameterized route in the table with NO route constraint, so the only one that takes
            // Concretize's "probe" fallback — pinned deliberately, since it is the pattern most likely to stop
            // matching its endpoint (and therefore to be silently unprobed) after a refactor.
            "/api/threads/{postId}",

            "/api/shell-state",
            "/api/chrome-config",
            "/api/brand-tokens",
            "/api/channel-nav-config",
            "/api/alerts",
            "/api/overlay-state",
            "/api/posts",
            "/api/telemetry",
            "/hubs/exercise",
            "/hubs/exercise/negotiate",
        ]);

        // The three engine review routes the audit INFERRED rather than probed ("behavior inferred from the shared
        // MapGroup filter"). Asserted here rather than in their own theory so the whole coverage guard costs ONE
        // host build: a refactor that moved them out of the group, or dropped them from the route table, could
        // otherwise make the sweeps pass by simply never visiting them.
        patterns.Should().Contain(PreviouslyUnprobedEngineRoutes);
    }

    // ==========================================================================================
    // The hub — behaviourally, both endpoints.
    // ==========================================================================================

    [Fact]
    public async Task TheHubNegotiateEndpoint_WithNoCredential_IsRefusedByTheGate()
    {
        // The exploit's first step: negotiate answered 200 to a credential-less caller, which is what made the
        // handshake and the group join reachable at all (#359, exploit 3). Probed as plain HTTP because that is
        // how the exploit was performed — a raw POST, not a SignalR client.
        using var factory = new AnonymousProbeFactory();
        using var client = factory.CreateClient();

        using var response = await client.PostAsync("/hubs/exercise/negotiate", content: null);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        response.Headers.WwwAuthenticate.Should().NotBeEmpty();
    }

    // The SignalR-client view of the same refusal — a real HubConnection presenting nothing must never reach
    // OnConnectedAsync, so it can never have joined exercise:{id} — is
    // DefaultDenySessionGateTests.UnauthenticatedHubConnection_IsRefused_AndJoinsNoGroup. Deliberately NOT
    // duplicated here: the /negotiate probe above is what story 11's suite genuinely lacks (it asserts that
    // endpoint's METADATA only), and a second identical connection test would add coverage of nothing while
    // doubling the maintenance surface.

    // ==========================================================================================
    // The staff / engine surfaces — gated before this feature existed, and STILL gated by their own filters.
    // ==========================================================================================

    [Fact]
    public async Task EveryStaffAndEngineRoute_WithNoCredential_IsRefusedByTheGate()
    {
        using var factory = new AnonymousProbeFactory();
        using var client = factory.CreateClient();

        var probes = StaffAndEngineProbes(factory);

        using var scope = new AssertionScope();
        foreach (var probe in probes)
        {
            using var request = new HttpRequestMessage(new HttpMethod(probe.Method), probe.Url);
            using var response = await client.SendAsync(request);

            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "{0} {1}", probe.Method, probe.Pattern);
            response.Headers.WwwAuthenticate.Should().NotBeEmpty(
                "{0} {1} must be refused by the gate before its own filter has to care — the challenge header is "
                + "the discriminator throughout this file",
                probe.Method,
                probe.Pattern);
        }
    }

    [Fact]
    public async Task StaffAndEngineRoutes_WithALiveNonStaffSession_AreStillRefusedByTHEIROWNFilters()
    {
        // The anti-redundancy assertion, and the reason this test exists at all. Story 11's gate now answers first
        // for an ANONYMOUS caller, which means every anonymous probe above would pass even if
        // EngineCockpitStaffAuthorizationFilter and the staff endpoints' own ICurrentStaffSessionAccessor checks
        // were deleted outright. A suite that only probed anonymously would therefore have gone
        // non-discriminating about the staff-only guarantee (XC-002) the moment the gate landed — exactly what
        // happened to a test in another feature after story 12 (WR-003, #388).
        //
        // So: present a LIVE session that is not a staff user, get past the gate, and require the pre-existing
        // filters to be the ones that refuse. No WWW-Authenticate is the proof of authorship — the gate did not
        // answer, a handler/filter did.
        using var factory = new AnonymousProbeFactory(AcceptedToken);
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", AcceptedToken);

        // POSITIVE CONTROL, and not optional. Everything below asserts that a request was REFUSED, so the whole
        // test would pass just as well if the session were never accepted at all and something upstream refused
        // everything. A gated NON-staff route proves the session is genuinely live and past the gate: /api/feed
        // must not answer 401, and must carry no challenge. (It 500s here — the host's connection string is
        // deliberately dead — which is itself proof the request reached the handler.)
        using (var control = await client.GetAsync("/api/feed"))
        {
            control.StatusCode.Should().NotBe(
                HttpStatusCode.Unauthorized,
                "the probe session must actually be live, or every assertion below passes for the wrong reason");
            control.Headers.WwwAuthenticate.Should().BeEmpty("and it must actually be past the gate");
        }

        var probes = StaffAndEngineProbes(factory);

        probes.Select(probe => probe.Pattern).Should().Contain(
            BodyValidatedBeforeIdentity,
            "the documented exception must still name mapped routes — a stale exception would quietly excuse a "
            + "route from the strict assertion below forever");

        using var scope = new AssertionScope();
        foreach (var probe in probes)
        {
            using var request = new HttpRequestMessage(new HttpMethod(probe.Method), probe.Url)
            {
                Content = ProbeBody(probe),
            };
            using var response = await client.SendAsync(request);

            // Universal, and the real claim: whatever the status, the GATE must not be the author. Only
            // AuthorizationMiddleware writes the RFC 6750 challenge.
            response.Headers.WwwAuthenticate.Should().BeEmpty(
                "{0} {1} must be refused by its OWN filter, not by the default-deny gate — otherwise the gate has "
                + "made the staff-only check redundant and nothing would notice if it were deleted",
                probe.Method,
                probe.Pattern);

            if (BodyValidatedBeforeIdentity.Contains(probe.Pattern, StringComparer.OrdinalIgnoreCase))
            {
                continue;
            }

            response.StatusCode.Should().BeOneOf(
                [HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden],
                "{0} {1} is staff-only (XC-002) and this session is not a staff user. If this route now validates "
                + "its body before establishing identity, that is a finding to file and reason about — not a "
                + "reason to add it to BodyValidatedBeforeIdentity",
                probe.Method,
                probe.Pattern);
        }
    }

    /// <summary>
    /// The one route that answers a BODY question before an IDENTITY question, so a non-staff caller sees its 400
    /// rather than a 401/403. Recorded rather than fixed: story 14's Out of Scope says a genuinely new finding gets
    /// its own issue, not a silent fix folded in.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>StaffAuthEndpoints.SetActiveExerciseAsync</c> returns <c>BadRequest("exerciseId must be a GUID.")</c>
    /// before it calls <c>StaffAssignmentService</c>, and the service is the only thing that can produce the
    /// <c>Unauthenticated</c>/<c>NotAssigned</c> outcomes. Not a vulnerability — an anonymous caller never gets
    /// here (the gate answers 401 in <c>AuthorizationMiddleware</c>, proven by the sweeps above), the message
    /// discloses nothing, and the handler still never reaches the service. But it is the SAME SHAPE as the pattern
    /// that produced #359: answering a non-identity question first. Filed as a follow-up.
    /// </para>
    /// <para>
    /// This list is deliberately tiny, named, and self-policing: the assertion above requires every entry to still
    /// be a mapped route, and every route NOT listed to return a real 401/403 — so a future endpoint acquiring this
    /// shape fails the suite and forces a decision rather than being quietly excused.
    /// </para>
    /// </remarks>
    private static readonly string[] BodyValidatedBeforeIdentity = ["/api/staff/active-exercise"];

    // ==========================================================================================
    // Enumeration
    // ==========================================================================================

    /// <summary>The one raw token <see cref="AnonymousProbeFactory"/> resolves to a live session when asked to.</summary>
    private const string AcceptedToken = "anonymous-sweep-live-session-token";

    /// <summary>
    /// The minimum body that gets a body-bearing minimal-API route past PARAMETER BINDING (which runs BEFORE
    /// endpoint filters, so a body the binder rejects means the authorization filter never executes and the route
    /// is left effectively unprobed while the test looks green). Deliberately not a per-route VALID payload — the
    /// point is to reach the authorization decision, not to succeed.
    /// </summary>
    /// <remarks>
    /// The content type is read from the endpoint's own inferred <see cref="IAcceptsMetadata"/> rather than
    /// hand-mapped per route, so a <c>multipart/form-data</c> endpoint (<c>POST /api/staff/accounts/import</c> binds
    /// an <c>IFormFile</c>, and answers 415 to JSON before any filter runs) is probed correctly without anyone
    /// listing it — the same enumeration-not-a-list principle the route set itself follows.
    /// </remarks>
    /// <param name="probe">The route probe whose body is being built.</param>
    /// <returns>The request content, or <c>null</c> for a method that carries none.</returns>
    private static HttpContent? ProbeBody(RouteProbe probe)
    {
        if (probe.Method is "GET" or "HEAD" or "DELETE" or "OPTIONS")
        {
            return null;
        }

        if (probe.ContentTypes.Any(type => type.StartsWith("multipart/", StringComparison.OrdinalIgnoreCase)))
        {
            // A form field, not a real file: enough for the multipart binder to succeed so the filter can run.
            var form = new MultipartFormDataContent();
            form.Add(new StringContent("probe"), "file", "probe.csv");
            return form;
        }

        return new StringContent("{}", System.Text.Encoding.UTF8, "application/json");
    }

    /// <summary>Every mapped route that is NOT on the pre-auth allowlist, as a callable probe.</summary>
    private static IEnumerable<RouteProbe> GatedProbes(AnonymousProbeFactory factory) =>
        Probes(factory, allowlisted: false);

    /// <summary>Every mapped route that IS on the pre-auth allowlist, as a callable probe.</summary>
    private static IEnumerable<RouteProbe> AllowlistedProbes(AnonymousProbeFactory factory) =>
        Probes(factory, allowlisted: true);

    /// <summary>
    /// The gated <c>/api/staff/*</c> and <c>/api/engine/*</c> probes, with a per-prefix non-emptiness guard.
    /// </summary>
    /// <remarks>
    /// Asserted per PREFIX, not as one total: a single "more than N routes" check on the combined set would still
    /// pass after losing the entire staff surface, because the engine surface alone clears it. Non-emptiness rather
    /// than an exact count so that adding a staff or engine route is not a failing test for no reason —
    /// <see cref="TheEnumerationCoversTheRoutesTheAuditProvedOpen"/> is what pins specific patterns.
    /// </remarks>
    /// <param name="factory">The running host whose route table is read.</param>
    /// <returns>The staff and engine probes.</returns>
    private static List<RouteProbe> StaffAndEngineProbes(AnonymousProbeFactory factory)
    {
        var probes = GatedProbes(factory).ToList();

        var staff = probes.Where(probe => probe.Pattern.StartsWith("/api/staff/", StringComparison.OrdinalIgnoreCase))
            .ToList();
        var engine = probes.Where(probe => probe.Pattern.StartsWith("/api/engine/", StringComparison.OrdinalIgnoreCase))
            .ToList();

        staff.Should().NotBeEmpty("the /api/staff/* surface must be enumerated, not silently absent");
        engine.Should().NotBeEmpty("the /api/engine/* surface must be enumerated, not silently absent");

        return [.. staff, .. engine];
    }

    /// <summary>
    /// Turns the live <see cref="EndpointDataSource"/> into callable probes — one per (route, declared method)
    /// pair, so a <c>MapMethods(["GET", "POST"], …)</c> endpoint is probed on both.
    /// </summary>
    /// <param name="factory">The running host whose route table is read.</param>
    /// <param name="allowlisted">Whether to return the allowlisted routes or the gated ones.</param>
    /// <returns>The probes.</returns>
    private static IEnumerable<RouteProbe> Probes(AnonymousProbeFactory factory, bool allowlisted)
    {
        var endpoints = factory.Services.GetRequiredService<EndpointDataSource>()
            .Endpoints.OfType<RouteEndpoint>();

        foreach (var endpoint in endpoints)
        {
            // PreAuthAllowlist.Contains is fail-closed (ALL declared methods must be listed), so an endpoint whose
            // methods are only partly allowlisted is swept as gated — which is the safe direction.
            if (PreAuthAllowlist.Contains(endpoint) != allowlisted)
            {
                continue;
            }

            var pattern = endpoint.RoutePattern.RawText ?? string.Empty;
            if (!pattern.StartsWith('/'))
            {
                pattern = "/" + pattern;
            }

            var methods = endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods;

            // An endpoint constraining no method (the health probes) is reachable by any; GET is the honest probe.
            var contentTypes = endpoint.Metadata.GetMetadata<IAcceptsMetadata>()?.ContentTypes ?? [];

            foreach (var method in methods is null || methods.Count == 0 ? ["GET"] : methods)
            {
                yield return new RouteProbe(method, pattern, Concretize(pattern), contentTypes);
            }
        }
    }

    /// <summary>
    /// Substitutes a concrete value for every route parameter so the pattern is actually callable —
    /// <c>/api/engine/review/{draftId:guid}/veto</c> becomes a real path. The value is chosen from the parameter's
    /// constraint so a <c>:guid</c> or <c>:int</c> segment still MATCHES its endpoint; a probe that failed to match
    /// would fall through to the no-endpoint case and prove nothing about the gate.
    /// </summary>
    /// <param name="pattern">The raw route pattern.</param>
    /// <returns>A concrete, callable path.</returns>
    private static string Concretize(string pattern) =>
        RouteParameterPattern.Replace(pattern, match =>
        {
            var token = match.Groups[1].Value;
            return token.Contains(":guid", StringComparison.OrdinalIgnoreCase)
                ? "00000000-0000-4000-8000-000000000001"
                : token.Contains(":int", StringComparison.OrdinalIgnoreCase) ? "1" : "probe";
        });

    /// <summary>Matches a single <c>{name[:constraint…]}</c> route-parameter segment.</summary>
    private static readonly Regex RouteParameterPattern =
        new(@"\{([^{}]+)\}", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>One callable route probe.</summary>
    /// <param name="Method">The HTTP method to issue.</param>
    /// <param name="Pattern">The raw route pattern, for assertion messages.</param>
    /// <param name="Url">The concrete path to request.</param>
    /// <param name="ContentTypes">The content types the endpoint's inferred binding accepts, for <see cref="ProbeBody"/>.</param>
    private sealed record RouteProbe(
        string Method,
        string Pattern,
        string Url,
        IReadOnlyList<string> ContentTypes);

    /// <summary>
    /// The real <c>Program</c> host — never a self-mapped <c>TestServer</c> (#310/#317) — with a dummy,
    /// never-connecting connection string and a host resolver that resolves every request to a fixed exercise.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The always-resolving stub reproduces the #359 precondition exactly: the request's exercise scope resolves
    /// perfectly well from the <c>Host</c> header and the caller still has no session. Before story 11 that
    /// combination was honored. A gated route is refused in <c>AuthorizationMiddleware</c> before any handler, so
    /// nothing under sweep reaches the dead database — which is itself part of what the sweep asserts.
    /// </para>
    /// <para>
    /// <see cref="NullCurrentStaffSessionAccessor"/> is registered so the staff/engine filters can answer without a
    /// database: the token→session lookup is <c>CurrentStaffSessionAccessorTests</c>' subject, whereas this suite's
    /// subject is WHO refuses. Story 05's own fail-closed default is reused rather than a bespoke stub.
    /// </para>
    /// </remarks>
    private sealed class AnonymousProbeFactory : WebApplicationFactory<Program>
    {
        internal static readonly Guid ResolvedExerciseId = Guid.Parse("bbbbbbbb-0000-4000-8000-00000000000b");

        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

        private readonly string? _acceptedToken;

        /// <param name="acceptedToken">
        /// When supplied, <see cref="ISessionAuthenticator"/> resolves EXACTLY this raw token to a live participant
        /// session and nothing else, so a probe can get PAST the gate and observe who refuses next.
        /// </param>
        public AnonymousProbeFactory(string? acceptedToken = null)
        {
            _acceptedToken = acceptedToken;
            Environment.SetEnvironmentVariable(
                ConnectionStringEnvVar,
                "Server=nonexistent;Database=pulse;Trusted_Connection=False;");
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            ArgumentNullException.ThrowIfNull(builder);

            builder.ConfigureTestServices(services =>
            {
                services.AddSingleton<IHostExerciseResolver>(new AlwaysResolvingHostResolver(ResolvedExerciseId));

                if (_acceptedToken is not null)
                {
                    services.AddScoped<ISessionAuthenticator>(
                        _ => new SingleTokenSessionAuthenticator(_acceptedToken, ResolvedExerciseId));
                    services.AddScoped<ICurrentStaffSessionAccessor, NullCurrentStaffSessionAccessor>();
                }
            });
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }

    /// <summary>
    /// Resolves one known raw token to a live <c>participant</c> session; every other token resolves to
    /// <c>null</c> (fail closed), exactly as the real authenticator does for an unknown, expired or revoked one.
    /// </summary>
    private sealed class SingleTokenSessionAuthenticator : ISessionAuthenticator
    {
        private readonly string _acceptedToken;
        private readonly Guid _exerciseId;

        public SingleTokenSessionAuthenticator(string acceptedToken, Guid exerciseId)
        {
            _acceptedToken = acceptedToken;
            _exerciseId = exerciseId;
        }

        public Task<AuthenticatedSession?> AuthenticateAsync(string rawToken, CancellationToken cancellationToken)
            => Task.FromResult(
                string.Equals(rawToken, _acceptedToken, StringComparison.Ordinal)
                    ? new AuthenticatedSession
                    {
                        SessionId = Guid.NewGuid(),
                        ExerciseId = _exerciseId,

                        // NOT "participant", and the choice is load-bearing. A participant session is HOST-BOUND:
                        // SessionAuthenticationMiddleware short-circuits with a bare 403 — no WWW-Authenticate,
                        // before UseAuthorization — whenever the host-resolved exercise is absent. That 403 would
                        // satisfy BOTH assertions in the live-session sweep (a 403 with no challenge) while the
                        // endpoint, its filter, and the entire authorization decision stayed unreachable, which is
                        // precisely the vacuity that sweep exists to prevent. `readonly` is a genuine non-staff
                        // kind and is not host-bound, so a refusal there can only have been authored by the
                        // endpoint's own check.
                        Kind = "readonly",
                        PrincipalId = "anonymous-sweep-principal",
                        ActingHumanId = "anonymous-sweep-human",
                    }
                    : null);
    }

    /// <summary>Resolves every host to one fixed exercise, with no database access.</summary>
    private sealed class AlwaysResolvingHostResolver : IHostExerciseResolver
    {
        private readonly Guid _exerciseId;

        public AlwaysResolvingHostResolver(Guid exerciseId) => _exerciseId = exerciseId;

        public Task<Guid?> ResolveExerciseIdAsync(string? rawHost, CancellationToken cancellationToken)
            => Task.FromResult<Guid?>(_exerciseId);
    }
}
