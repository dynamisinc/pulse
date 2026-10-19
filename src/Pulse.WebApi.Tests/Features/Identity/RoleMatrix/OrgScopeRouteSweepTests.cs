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
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// #602 M-7 — THE ORG-SCOPE ROUTE SWEEP. An org-scope staff session (<c>Session.ExerciseId</c> null — an org admin
/// signed in to the ORGANIZATION, not an exercise) must be refused by EVERY exercise-scoped route, GET and mutating alike:
/// it has no exercise, so an exercise-scoped handler must never fall back to the request host's exercise (or any other)
/// and serve or change it. Every route of the REAL <c>Program</c> host is enumerated from <see cref="EndpointDataSource"/>
/// and driven over HTTP on the exercise's own host, with a fresh org-scope session per request; each must answer 401, 403
/// or 404 — never a 2xx, and never a handler-level 400/409 (which would mean the handler ran with some scope).
/// </summary>
/// <remarks>
/// <para>
/// Two org-scope callers are swept: the matrix's org admin (no enrollment on the exercise), and an org admin who ALSO holds
/// a planner enrollment on it — the enrollment must not leak into an org-scope session (a staffer reaches an exercise only
/// by switching to it, which re-binds the session).
/// </para>
/// <para>
/// <b>Not swept:</b> anonymous-allowlisted routes (sign-in, refresh, logout, secret-gated ops, health — reachable with no
/// session at all, so an org session is no worse than none; <c>RoleMatrixTests.PreAuthRows_AreExactlyTheAnonymousAllowlistedMutatingRoutes</c>
/// pins the mutating ones), and the explicit <see cref="OrgScopeRoutes"/> allowlist of routes that are org-scope by design.
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

    [RequiresDockerFact]
    public async Task EveryExerciseScopedRoute_RefusesAnOrgScopeSession()
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture);
        var enrolledOrgAdmin = await SeedEnrolledOrgAdminAsync(world);
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
                using var request = new HttpRequestMessage(new HttpMethod(method), Path(pattern, world)) { Content = Body(key, method) };
                using var response = await client.SendAsync(request);

                if (response.StatusCode is not (HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden or HttpStatusCode.NotFound))
                {
                    failures.Add($"{key} as {caller}: {(int)response.StatusCode}");
                }
            }
        }

        failures.Should().BeEmpty(
            "an org-scope session has no exercise: every exercise-scoped route must refuse it (401/403/404), never serve or "
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

    /// <summary>Real ids of the world where a route names them (so a 404 is the scope refusing, not a missing row).</summary>
    private static string Path(string pattern, RoleMatrixWorld world)
    {
        var path = pattern
            .Replace("{exerciseId:guid}", world.ExerciseId.ToString(), StringComparison.Ordinal)
            .Replace("{personaId:guid}", world.PersonaId.ToString(), StringComparison.Ordinal)
            .Replace("/api/staff/enrollments/{id:guid}", $"/api/staff/enrollments/{world.EvaluatorEnrollmentId}", StringComparison.Ordinal)
            .Replace("{kind}", "like", StringComparison.Ordinal);

        path = Regex.Replace(path, @"\{[^}:]+:guid\}", _ => Guid.NewGuid().ToString());
        path = Regex.Replace(path, @"\{\*\*?[^}]+\}", "sweep-probe");
        return Regex.Replace(path, @"\{[^}]+\}", "sweep-probe");
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
}
