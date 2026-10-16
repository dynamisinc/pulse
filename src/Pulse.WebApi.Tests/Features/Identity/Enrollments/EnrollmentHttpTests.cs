namespace Pulse.WebApi.Tests.Features.Identity.Enrollments;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.Identity.Enrollments;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;

/// <summary>
/// identity-auth-roles/16 (#572) over the REAL <c>Program</c> host (plus this slice's not-yet-wired
/// <c>AddEnrollments()</c> / <c>MapEnrollmentEndpoints()</c>): the org-scope session contract (<c>SessionDto</c> scope /
/// world / role / personId), the two staff routes that accept an org-scope session (own same-org enrollment only; a
/// foreign or missing target is the bare 404), exercise-scoped routes failing closed under org scope, and
/// <c>PUT /api/staff/enrollments/{id}/lead</c> with its foreign-exercise and foreign-org bare 404s and the LIVE isLead.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class EnrollmentHttpTests
{
    private readonly MsSqlContainerFixture _fixture;
    private readonly EnrollmentTestKit _kit;

    public EnrollmentHttpTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _kit = new EnrollmentTestKit(fixture);
    }

    [RequiresDockerFact]
    public async Task GetSession_ForAnOrgScopeSession_ProjectsScopeOrg_NullExercise_OrgAdminRole_AndThePerson()
    {
        var org = await _kit.SeedOrganizationAsync();
        var (admin, _) = await _kit.SeedStaffAsync(org, exerciseId: null, orgRole: "orgAdmin");
        var (_, token) = await _kit.SeedStaffSessionAsync(admin, exerciseId: null, "orgAdmin");

        using var host = new EnrollmentHost(_fixture.ConnectionString!);
        using var response = await Client(host, token).GetAsync("/api/session");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = json.RootElement;
        root.GetProperty("exerciseId").ValueKind.Should().Be(JsonValueKind.Null, "org scope is a structural null, never Guid.Empty");
        root.GetProperty("scope").GetString().Should().Be("org");
        root.GetProperty("world").GetString().Should().Be("staff");
        root.GetProperty("role").GetString().Should().Be("orgAdmin");
        root.GetProperty("personId").GetString().Should().Be(admin.ToString());
        root.GetProperty("isLead").GetBoolean().Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task AnOrgScopeSession_FailsClosedOnAnExerciseScopedRoute()
    {
        var org = await _kit.SeedOrganizationAsync();
        var (admin, _) = await _kit.SeedStaffAsync(org, exerciseId: null, orgRole: "orgAdmin");
        var (_, token) = await _kit.SeedStaffSessionAsync(admin, exerciseId: null, "orgAdmin");

        using var host = new EnrollmentHost(_fixture.ConnectionString!);
        using var response = await Client(host, token).GetAsync("/api/staff/exercise-lifecycle");

        response.StatusCode.Should().BeOneOf(
            [HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden],
            "an org-scope session leaves CurrentExerciseId unset, so exercise-scoped routes fail closed — never 'every exercise'");
    }

    [RequiresDockerFact]
    public async Task GetAssignments_ForAnOrgScopeSession_ListsOnlyTheCallersOwnSameOrgStaffEnrollments()
    {
        var org = await _kit.SeedOrganizationAsync();
        var otherOrg = await _kit.SeedOrganizationAsync();
        var own = await _kit.SeedExerciseAsync(org);
        var foreign = await _kit.SeedExerciseAsync(otherOrg);
        var (admin, _) = await _kit.SeedStaffAsync(org, own, "planner", orgRole: "orgAdmin");
        await _kit.SeedEnrollmentAsync(foreign, admin, "planner");
        await _kit.SeedStaffAsync(org, own, "controller");
        var (_, token) = await _kit.SeedStaffSessionAsync(admin, exerciseId: null, "orgAdmin");

        using var host = new EnrollmentHost(_fixture.ConnectionString!);
        using var response = await Client(host, token).GetAsync("/api/staff/assignments");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var rows = json.RootElement.EnumerateArray().ToList();
        rows.Should().ContainSingle("only the caller's own enrollment in an exercise of the caller's own organization");
        rows[0].GetProperty("exerciseId").GetString().Should().Be(own.ToString());
        rows[0].GetProperty("role").GetString().Should().Be("planner");
        rows[0].GetProperty("personId").GetString().Should().Be(admin.ToString());
        rows[0].GetProperty("isLead").GetBoolean().Should().BeFalse("the Enrollment wire type carries the live lead flag");
    }

    [RequiresDockerTheory]
    [InlineData("participant")]
    [InlineData("readonly")]
    public async Task TheTwoStaffRoutes_RefuseANonStaffWorldSession(string kind)
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var token = $"nonstaff-{Guid.NewGuid():N}";
        await using (var seed = _kit.ReadContext())
        {
            seed.Sessions.Add(Pulse.WebApi.Tests.Helpers.TestSessions.NewSession(token, exercise, kind: kind, isReadOnly: kind == "readonly"));
            await seed.SaveChangesAsync();
        }

        using var host = new EnrollmentHost(_fixture.ConnectionString!);
        using var list = await Client(host, token).GetAsync("/api/staff/assignments");
        using var enter = await Client(host, token).PostAsJsonAsync("/api/staff/active-exercise", new { exerciseId = exercise.ToString() });

        list.StatusCode.Should().BeOneOf([HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden], "only a staff-world session lists enrollments");
        enter.StatusCode.Should().BeOneOf([HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden], "only a staff-world session can switch");
    }

    [RequiresDockerFact]
    public async Task SetActiveExercise_FromOrgScope_EntersTheCallersOwnEnrollment_AndEveryOtherTargetIsTheBare404()
    {
        var org = await _kit.SeedOrganizationAsync();
        var otherOrg = await _kit.SeedOrganizationAsync();
        var own = await _kit.SeedExerciseAsync(org);
        var notEnrolled = await _kit.SeedExerciseAsync(org);
        var foreign = await _kit.SeedExerciseAsync(otherOrg);
        var (admin, _) = await _kit.SeedStaffAsync(org, own, "planner", orgRole: "orgAdmin");
        await _kit.SeedEnrollmentAsync(foreign, admin, "planner");

        using var host = new EnrollmentHost(_fixture.ConnectionString!);
        foreach (var target in new[] { foreign, notEnrolled, Guid.NewGuid() })
        {
            var (_, probeToken) = await _kit.SeedStaffSessionAsync(admin, exerciseId: null, "orgAdmin");
            using var refused = await Client(host, probeToken).PostAsJsonAsync("/api/staff/active-exercise", new { exerciseId = target.ToString() });
            refused.StatusCode.Should().Be(HttpStatusCode.NotFound, "a foreign-org, not-enrolled or missing target is the same bare 404");
            (await refused.Content.ReadAsStringAsync()).Should().BeEmpty("the bare 404 carries no body");
        }

        var (sessionId, token) = await _kit.SeedStaffSessionAsync(admin, exerciseId: null, "orgAdmin");
        using var entered = await Client(host, token).PostAsJsonAsync("/api/staff/active-exercise", new { exerciseId = own.ToString() });
        entered.StatusCode.Should().Be(HttpStatusCode.OK);

        await using var read = _kit.ReadContext();
        var session = await read.Sessions.SingleAsync(s => s.Id == sessionId);
        session.ExerciseId.Should().Be(own, "the session now carries the selected exercise");
        session.Role.Should().Be("planner", "and the role of the caller's own enrollment there — never orgAdmin");
    }

    [RequiresDockerFact]
    public async Task PutLead_ByThePlanner_Is200_AndTheNewLeadsSessionReadsIsLeadLive_WithoutReSigningIn()
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var (planner, _) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (controller, controllerEnrollment) = await _kit.SeedStaffAsync(org, exercise, "controller");
        var (_, plannerToken) = await _kit.SeedStaffSessionAsync(planner, exercise, "planner");
        var (_, controllerToken) = await _kit.SeedStaffSessionAsync(controller, exercise, "controller");

        using var host = new EnrollmentHost(_fixture.ConnectionString!);
        using (var before = await Client(host, controllerToken).GetAsync("/api/session"))
        {
            (await before.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("isLead").GetBoolean().Should().BeFalse();
        }

        using var response = await Client(host, plannerToken).PutAsync($"/api/staff/enrollments/{controllerEnrollment}/lead", content: null);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("isLead").GetBoolean().Should().BeTrue();

        using var after = await Client(host, controllerToken).GetAsync("/api/session");
        after.StatusCode.Should().Be(HttpStatusCode.OK, "a lead change revokes nothing");
        (await after.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("isLead").GetBoolean().Should().BeTrue(
            "isLead is read live from the enrollment when the DTO is built");
    }

    [RequiresDockerFact]
    public async Task PutLead_OnAForeignExerciseOrForeignOrgEnrollment_IsTheBare404_AndANonController409s()
    {
        var org = await _kit.SeedOrganizationAsync();
        var otherOrg = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var sibling = await _kit.SeedExerciseAsync(org);
        var foreign = await _kit.SeedExerciseAsync(otherOrg);
        var (planner, _) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (_, evaluatorEnrollment) = await _kit.SeedStaffAsync(org, exercise, "evaluator");
        var (_, siblingController) = await _kit.SeedStaffAsync(org, sibling, "controller");
        var (_, foreignController) = await _kit.SeedStaffAsync(otherOrg, foreign, "controller");
        var (_, plannerToken) = await _kit.SeedStaffSessionAsync(planner, exercise, "planner");

        using var host = new EnrollmentHost(_fixture.ConnectionString!);
        var client = Client(host, plannerToken);

        foreach (var target in new[] { siblingController, foreignController, Guid.NewGuid() })
        {
            using var response = await client.PutAsync($"/api/staff/enrollments/{target}/lead", content: null);
            response.StatusCode.Should().Be(HttpStatusCode.NotFound, "foreign-exercise, foreign-org and missing are the same bare 404");
            (await response.Content.ReadAsStringAsync()).Should().BeEmpty();
        }

        using var conflict = await client.PutAsync($"/api/staff/enrollments/{evaluatorEnrollment}/lead", content: null);
        conflict.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await conflict.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString().Should().Be("not-a-controller");

        using var anonymous = await host.CreateClient().PutAsync($"/api/staff/enrollments/{evaluatorEnrollment}/lead", content: null);
        anonymous.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    private static HttpClient Client(EnrollmentHost host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    /// <summary>The real Program host plus this slice's AddEnrollments()/MapEnrollmentEndpoints() (not yet wired in Program).</summary>
    private sealed class EnrollmentHost : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

        public EnrollmentHost(string connectionString)
            => Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.ConfigureTestServices(services =>
            {
                services.AddEnrollments();
                services.AddSingleton<Microsoft.AspNetCore.Hosting.IStartupFilter>(new MapEnrollmentsStartupFilter());
            });
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }

        private sealed class MapEnrollmentsStartupFilter : Microsoft.AspNetCore.Hosting.IStartupFilter
        {
            public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
            {
                next(app);

                if (app.Properties.TryGetValue("__EndpointRouteBuilder", out var value) && value is IEndpointRouteBuilder routes
                    && !routes.DataSources.SelectMany(source => source.Endpoints).OfType<RouteEndpoint>()
                        .Any(endpoint => string.Equals(endpoint.RoutePattern.RawText, EnrollmentEndpoints.LeadRoute, StringComparison.Ordinal)))
                {
                    routes.MapEnrollmentEndpoints();
                }
            };
        }
    }
}
