namespace Pulse.WebApi.Tests.Features.Identity.RoleMatrix;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Routing;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Enrollments;
using Pulse.WebApi.Features.Injects;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// #602 M-7 — THE ORG-SCOPE ROUTE SWEEP. An org-scope staff session (<c>Session.ExerciseId</c> null — an org admin
/// signed in to the ORGANIZATION, not an exercise) must be refused by EVERY exercise-scoped route, GET and mutating alike:
/// it has no exercise, so an exercise-scoped handler must never fall back to the request host's exercise (or any other)
/// and serve or change it. Every route of the REAL <c>Program</c> host is enumerated from <see cref="EndpointDataSource"/>
/// and driven over HTTP on the exercise's own host, with a fresh org-scope session per request; each must be REFUSED —
/// never a 2xx, and never a 400/409 (a handler validating input or state means it ran with some scope).
/// </summary>
/// <remarks>
/// <para>
/// Two org-scope callers are swept: the matrix's org admin (no enrollment on the exercise), and an org admin who ALSO holds
/// a planner enrollment on it — the enrollment must not leak into an org-scope session (a staffer reaches an exercise only
/// by switching to it, which re-binds the session).
/// </para>
/// <para>
/// <b>What counts as a refusal.</b> 401 and 403 always. 404 only where every id in the path is a REAL seeded row of the
/// world's exercise (the persona, the evaluator enrollment, a post, an inject item): there a 404 can only mean the scope
/// closed the door on a row that exists. A route whose path names an id this sweep does not seed (a draft, a roster
/// entry, a storyline) is probed with a random id, where a 404 could just be "no such row" — so for those only 401/403
/// is accepted.
/// </para>
/// <para>
/// <b>Not swept:</b> anonymous-allowlisted routes (sign-in, refresh, logout, secret-gated ops, health — reachable with no
/// session at all, so an org session is no worse than none; <c>RoleMatrixTests.PreAuthRows_AreExactlyTheAnonymousAllowlistedMutatingRoutes</c>
/// pins the mutating ones), the explicit <see cref="OrgScopeRoutes"/> allowlist of routes that are org-scope by design, and
/// endpoints with no HTTP-method metadata — the anonymous health probes and, session-gated, exactly the SignalR hub
/// endpoints (<see cref="HubEndpointPatterns"/>, pinned by
/// <see cref="TheOnlyMethodlessEndpoints_AreTheKnownHubEndpoints"/>), whose org-scope refusal happens in the hub's
/// <c>OnConnectedAsync</c> and is covered by <c>ExerciseRealtimeHubStaffGroupTests.OrgScopeSession_IsRefusedByTheHub</c>.
/// </para>
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class OrgScopeRouteSweepTests
{
    /// <summary>
    /// The routes an org-scope session may legitimately use, each with WHY. Anything not listed here (and not anonymous)
    /// is exercise-scoped and must refuse an org-scope session.
    /// </summary>
    private static readonly IReadOnlyDictionary<string, string> OrgScopeRoutes = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["GET /api/session"] = "the caller's OWN session projection — how an org-scope client learns it is org scope",
        ["GET /api/staff/assignments"] = "the caller's OWN enrollments across exercises — the switcher's list, read by person, not by exercise",
        ["POST /api/staff/active-exercise"] = "the switcher itself: binds the session to an exercise the caller is enrolled in (or an org admin's own org)",
        ["GET /api/org/exercises"] = "the org admin's exercise list, bounded by the caller's organization (InOrganization)",
        ["GET /api/org/staff-assignments"] = "the org staff directory (COR-076): the caller's organization's staff and their enrollments, org-bounded",
        ["POST /api/org/exercises"] = "org-admin exercise creation in the caller's organization",
        ["PATCH /api/org/exercises/{exerciseId:guid}"] = "org-admin exercise management, resolved InOrganization (a foreign id is the bare 404)",
        ["POST /api/org/exercises/{exerciseId:guid}/archive"] = "org-admin exercise archive, resolved InOrganization (a foreign id is the bare 404)",
    };

    /// <summary>
    /// The SESSION-GATED endpoints with no <see cref="IHttpMethodMetadata"/> (so not enumerable as METHOD routes): the
    /// SignalR hub's negotiate and connection endpoints. Org-scope refusal there is the hub's own (see the class remarks).
    /// </summary>
    private static readonly string[] HubEndpointPatterns = ["/hubs/exercise", "/hubs/exercise/negotiate"];

    /// <summary>The ANONYMOUS methodless endpoints: the platform health probes (no session, no exercise content).</summary>
    private static readonly string[] AnonymousMethodlessPatterns = ["/health", "/health/ready"];

    private readonly MsSqlContainerFixture _fixture;

    public OrgScopeRouteSweepTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [Fact]
    public void TheOrgScopeAllowlist_NamesOnlyMappedRoutes()
    {
        using var host = new RoleMatrixHost(connectionString: null);
        var mapped = RouteKeys(host).Select(route => route.Key).ToHashSet(StringComparer.Ordinal);

        OrgScopeRoutes.Keys.Where(key => !mapped.Contains(key)).Should().BeEmpty(
            "an allowlisted org-scope route that is no longer mapped is stale — remove it");
    }

    [Fact]
    public void TheOnlyMethodlessEndpoints_AreTheKnownHubEndpoints()
    {
        // A methodless endpoint is invisible to the sweep; it must be a hub endpoint whose org-scope refusal is proven
        // elsewhere (ExerciseRealtimeHubStaffGroupTests), never a new API surface that silently escapes the sweep.
        using var host = new RoleMatrixHost(connectionString: null);
        var methodless = host.RouteEndpoints()
            .Where(endpoint => endpoint.Metadata.GetMetadata<IHttpMethodMetadata>() is null)
            .Select(endpoint => (
                Pattern: "/" + endpoint.RoutePattern.RawText!.TrimStart('/'),
                Anonymous: endpoint.Metadata.GetMetadata<IAllowAnonymous>() is not null))
            .ToList();

        methodless.Where(e => !e.Anonymous).Select(e => e.Pattern).Should().BeEquivalentTo(
            HubEndpointPatterns,
            "the only session-gated endpoints the sweep cannot enumerate are the SignalR hub's (count and identity pinned)");
        methodless.Where(e => e.Anonymous).Select(e => e.Pattern).Should().BeEquivalentTo(
            AnonymousMethodlessPatterns,
            "the only anonymous methodless endpoints are the health probes");
    }

    [RequiresDockerFact]
    public async Task EveryExerciseScopedRoute_RefusesAnOrgScopeSession()
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture);
        var enrolledOrgAdmin = await SeedEnrolledOrgAdminAsync(world);
        var ids = await SeedByIdResourcesAsync(world);
        using var host = new RoleMatrixHost(_fixture.ConnectionString!);

        var swept = RouteKeys(host)
            .Where(route => !route.Anonymous && !OrgScopeRoutes.ContainsKey(route.Key))
            .Select(route => route.Key)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(key => key, StringComparer.Ordinal)
            .ToList();

        swept.Should().HaveCountGreaterThan(40, "anti-vacuity: the sweep must actually reach the exercise-scoped surface");
        swept.Should().Contain("GET /api/feed", "pattern-rot anchor: the participant feed is the canonical exercise-scoped read");

        // Positive control: the org-scope tokens are LIVE (an org-scope route answers 200), so every refusal below is the
        // route refusing the org scope — not a dead credential.
        foreach (var token in new[]
        {
            await world.TokenForAsync(MatrixRole.OrgAdmin),
            (await world.StaffTokenAsync(enrolledOrgAdmin, exerciseId: null, Person.OrgAdminRole)).Token,
        })
        {
            using var control = world.Client(host, token);
            using var session = await control.GetAsync("/api/session");
            session.StatusCode.Should().Be(HttpStatusCode.OK, "the org-scope session must authenticate for the sweep to mean anything");
        }

        var failures = new List<string>();
        foreach (var key in swept)
        {
            var method = key[..key.IndexOf(' ', StringComparison.Ordinal)];
            var pattern = key[(method.Length + 1)..];

            foreach (var (caller, token) in new[]
            {
                ("org admin", await world.TokenForAsync(MatrixRole.OrgAdmin)),
                ("enrolled org admin", (await world.StaffTokenAsync(enrolledOrgAdmin, exerciseId: null, Person.OrgAdminRole)).Token),
            })
            {
                await world.SetStatusAsync("live", DateTimeOffset.UtcNow.AddDays(-1));
                using var client = world.Client(host, token);
                var (path, allIdsReal) = Path(pattern, world, ids);
                using var request = new HttpRequestMessage(new HttpMethod(method), path) { Content = Body(key, method) };
                using var response = await client.SendAsync(request);

                var refused = response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden
                    || (allIdsReal && response.StatusCode is HttpStatusCode.NotFound);
                if (!refused)
                {
                    failures.Add($"{key} as {caller}: {(int)response.StatusCode}{(allIdsReal ? string.Empty : " (unseeded id: 401/403 only)")}");
                }
            }
        }

        failures.Should().BeEmpty(
            "an org-scope session has no exercise: every exercise-scoped route must refuse it (401/403, or 404 on a real row), never serve or "
            + "change the host's exercise. A route that is org-scope BY DESIGN belongs in OrgScopeRoutes, with its reason");
    }

    /// <summary>Every (METHOD pattern) of the live host, and whether the endpoint is anonymous-allowlisted.</summary>
    private static IEnumerable<(string Key, bool Anonymous)> RouteKeys(RoleMatrixHost host)
    {
        foreach (var endpoint in host.RouteEndpoints())
        {
            var anonymous = endpoint.Metadata.GetMetadata<IAllowAnonymous>() is not null;
            var methods = endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods ?? [];
            foreach (var method in methods.Where(m => m is "GET" or "POST" or "PUT" or "PATCH" or "DELETE"))
            {
                yield return ($"{method} /{endpoint.RoutePattern.RawText!.TrimStart('/')}", anonymous);
            }
        }
    }

    /// <summary>The probe body: the role matrix's row body where it has one, else <c>{}</c> (none for GET / DELETE).</summary>
    private static HttpContent? Body(string key, string method)
    {
        var body = RoleMatrixTests.Matrix.TryGetValue(key, out var row) ? row.Body : null;
        if (body == "multipart")
        {
            var content = new MultipartFormDataContent();
            var file = new ByteArrayContent(Encoding.UTF8.GetBytes(string.Empty));
            file.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("text/csv");
            content.Add(file, "file", "sweep.csv");
            return content;
        }

        return method is "GET" or "DELETE" && body is null
            ? null
            : new StringContent(body ?? "{}", Encoding.UTF8, "application/json");
    }

    /// <summary>
    /// The probe path, with the world's REAL ids where the route names a resource this sweep seeds; any other id is a
    /// random GUID / placeholder, reported via <c>AllIdsReal = false</c> (then a 404 is not accepted as a refusal).
    /// </summary>
    private static (string Path, bool AllIdsReal) Path(string pattern, RoleMatrixWorld world, SeededIds ids)
    {
        var path = pattern
            .Replace("{exerciseId:guid}", world.ExerciseId.ToString(), StringComparison.Ordinal)
            .Replace("{personaId:guid}", world.PersonaId.ToString(), StringComparison.Ordinal)
            .Replace("/api/staff/enrollments/{id:guid}", $"/api/staff/enrollments/{world.EvaluatorEnrollmentId}", StringComparison.Ordinal)
            .Replace("{postId:guid}", ids.PostId.ToString(), StringComparison.Ordinal)
            .Replace("{postId}", ids.PostId.ToString(), StringComparison.Ordinal)
            .Replace("/api/injects/{id:guid}", $"/api/injects/{ids.InjectItemId}", StringComparison.Ordinal)
            .Replace("/api/injects/{itemId:guid}", $"/api/injects/{ids.InjectItemId}", StringComparison.Ordinal)
            .Replace("{kind}", "like", StringComparison.Ordinal);

        var allIdsReal = !path.Contains('{', StringComparison.Ordinal);
        path = Regex.Replace(path, @"\{[^}:]+:guid\}", _ => Guid.NewGuid().ToString());
        path = Regex.Replace(path, @"\{\*\*?[^}]+\}", "sweep-probe");
        return (Regex.Replace(path, @"\{[^}]+\}", "sweep-probe"), allIdsReal);
    }

    /// <summary>Seeds a post and an inject item in the world's exercise, so the main by-id routes probe REAL rows.</summary>
    private async Task<SeededIds> SeedByIdResourcesAsync(RoleMatrixWorld world)
    {
        var ids = new SeededIds(Guid.NewGuid(), Guid.NewGuid());
        await using var seed = _fixture.CreateContext();
        seed.Posts.Add(new Post
        {
            Id = ids.PostId,
            ExerciseId = world.ExerciseId,
            AuthorPersonaId = world.PersonaId,
            Body = "Org-scope sweep probe post",
            CreatedScenarioTime = DateTimeOffset.Parse("2026-10-16T09:00:00Z", System.Globalization.CultureInfo.InvariantCulture),
            Origin = "participant",
            ActingHumanId = "sweep-human",
            CreatedWallClock = DateTimeOffset.UtcNow,
        });
        seed.InjectItems.Add(new InjectItem
        {
            Id = ids.InjectItemId,
            ExerciseId = world.ExerciseId,
            Kind = InjectKinds.Post,
            Title = "Org-scope sweep probe inject",
            Status = InjectStatuses.Pending,
            Order = 1,
            Version = 1,
            CreatedByHumanId = world.PersonOf(MatrixRole.Planner),
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
        return ids;
    }

    /// <summary>A second org admin of the world's organization who ALSO holds a planner enrollment on its exercise.</summary>
    private async Task<Guid> SeedEnrolledOrgAdminAsync(RoleMatrixWorld world)
    {
        var personId = Guid.NewGuid();
        var staff = StaffTenantSeed.StaffUserFor(personId, world.OrganizationId);
        staff.Person!.OrgRole = Person.OrgAdminRole;

        await using var seed = _fixture.CreateContext();
        seed.StaffUsers.Add(staff);
        seed.Enrollments.Add(new Enrollment
        {
            Id = Guid.NewGuid(),
            ExerciseId = world.ExerciseId,
            PersonId = personId,
            Role = EnrollmentRoles.Planner,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
        return personId;
    }

    private sealed record SeededIds(Guid PostId, Guid InjectItemId);
}
