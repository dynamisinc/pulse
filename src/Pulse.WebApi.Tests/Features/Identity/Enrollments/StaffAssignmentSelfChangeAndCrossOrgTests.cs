namespace Pulse.WebApi.Tests.Features.Identity.Enrollments;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Features.Identity.Enrollments;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;

/// <summary>
/// Story 20 (#575a) hardening over the REAL <c>Program</c> host and real SQL:
/// <list type="bullet">
///   <item><description>Cross-ORG isolation on all four staff-assignment routes: an org admin of org X on an org-scope
///   session gets a bare 404 for org Y's exercise / enrollment, byte-identical to a non-existent id, and nothing in org
///   Y changes (COR-001).</description></item>
///   <item><description>Self-revoke: a planner removing their OWN enrollment kills their own sessions on that exercise
///   (access 401, refresh 401), and only those.</description></item>
///   <item><description>Self-demote: a planner moving their OWN role to controller is answered 200, and the very next
///   call on the old session is 401 (the grant-revoke rule) — the client can never act on stale planner permissions; a
///   fresh controller session is then refused the planner-only route (403).</description></item>
/// </list>
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class StaffAssignmentSelfChangeAndCrossOrgTests
{
    private readonly MsSqlContainerFixture _fixture;
    private readonly EnrollmentTestKit _kit;

    public StaffAssignmentSelfChangeAndCrossOrgTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _kit = new EnrollmentTestKit(fixture);
    }

    [RequiresDockerTheory]
    [InlineData("GET list")]
    [InlineData("POST grant")]
    [InlineData("PATCH role")]
    [InlineData("DELETE")]
    public async Task OrgAdminOfOrgX_OnAnOrgScopeSession_GetsTheBare404ForOrgY_IdenticalToAMissingId_AndOrgYIsUnchanged(string route)
    {
        // Org X: the org admin (org-scope session) and an own-org person to grant, so a POST 404 is the EXERCISE's.
        var orgX = await _kit.SeedOrganizationAsync();
        var (adminX, _) = await _kit.SeedStaffAsync(orgX, exerciseId: null, orgRole: "orgAdmin");
        var (candidateX, _) = await _kit.SeedStaffAsync(orgX, exerciseId: null);

        // Org Y: an exercise with a planner, a lead controller and a controller, each with a live session.
        var orgY = await _kit.SeedOrganizationAsync();
        var exerciseY = await _kit.SeedExerciseAsync(orgY);
        var (plannerY, _) = await _kit.SeedStaffAsync(orgY, exerciseY, "planner");
        var (leadY, _) = await _kit.SeedStaffAsync(orgY, exerciseY, "controller", isLead: true);
        var (controllerY, controllerEnrollmentY) = await _kit.SeedStaffAsync(orgY, exerciseY, "controller");
        var (candidateY, _) = await _kit.SeedStaffAsync(orgY, exerciseId: null);
        foreach (var (person, role) in new[] { (plannerY, "planner"), (leadY, "controller"), (controllerY, "controller") })
        {
            await _kit.SeedStaffSessionAsync(person, exerciseY, role);
        }

        var before = await SnapshotOrgAsync(orgY, exerciseY);

        using var host = new StaffHost(_fixture.ConnectionString!);
        var adminToken = (await _kit.SeedStaffSessionAsync(adminX, exerciseId: null, "orgAdmin")).Token;

        // The foreign target and a never-existing id of the same shape, sent on the same route by the same caller.
        var (foreignTarget, missingTarget) = route is "GET list" or "POST grant"
            ? (exerciseY, Guid.NewGuid())
            : (controllerEnrollmentY, Guid.NewGuid());

        // POST is probed with BOTH an org-X person (so the 404 can only be the exercise's) and an org-Y person (who WOULD
        // be grantable in exercise Y, so only the tenant bound on the exercise lookup stands between the call and a write).
        var candidates = route == "POST grant" ? new[] { candidateX, candidateY } : new[] { candidateX };
        foreach (var candidate in candidates)
        {
            var foreign = await SendAsync(host, adminToken, route, foreignTarget, candidate);
            var missing = await SendAsync(host, adminToken, route, missingTarget, candidate);

            foreign.Status.Should().Be(HttpStatusCode.NotFound, "{0} on org Y's id is the bare 404 (COR-001)", route);
            missing.Status.Should().Be(HttpStatusCode.NotFound, "{0} on a non-existent id is the bare 404", route);
            foreign.Body.Should().BeEmpty("the bare 404 carries no body");
            foreign.Should().BeEquivalentTo(missing, "a foreign org's id must be indistinguishable from a missing one");
        }

        // The admin's own session is untouched (a refusal never costs the caller anything).
        using (var still = await WithToken(host, adminToken).GetAsync(new Uri("/api/session", UriKind.Relative)))
        {
            still.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        var after = await SnapshotOrgAsync(orgY, exerciseY);
        after.Should().BeEquivalentTo(before, "nothing in org Y changed: enrollments, sessions, telemetry and audit");

        await using var read = _kit.ReadContext();
        (await read.Enrollments.IgnoreQueryFilters().CountAsync(e => e.PersonId == candidateX || e.PersonId == candidateY))
            .Should().Be(0, "a refused grant wrote nothing for either probe person");
        (await read.OrgAuditEvents.IgnoreQueryFilters().CountAsync(a => a.OrganizationId == orgX && a.ExerciseId == exerciseY))
            .Should().Be(0, "no audit about org Y's exercise was written on org X's side");
    }

    [RequiresDockerFact]
    public async Task SelfRevoke_ByAPlannerWhoIsNotTheLast_RevokesOnlyTheirOwnSessionsOnThatExercise()
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var otherExercise = await _kit.SeedExerciseAsync(org);
        var (planner, plannerEnrollment) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (otherPlanner, _) = await _kit.SeedStaffAsync(org, exercise, "planner");
        await _kit.SeedEnrollmentAsync(otherExercise, planner, "planner");

        var (callerSession, callerToken) = await _kit.SeedStaffSessionAsync(planner, exercise, "planner");
        var (secondSession, secondToken) = await _kit.SeedStaffSessionAsync(planner, exercise, "planner");
        var (_, otherExerciseToken) = await _kit.SeedStaffSessionAsync(planner, otherExercise, "planner");
        var (_, otherPlannerToken) = await _kit.SeedStaffSessionAsync(otherPlanner, exercise, "planner");
        using var host = new StaffHost(_fixture.ConnectionString!);

        using (var removed = await WithToken(host, callerToken).DeleteAsync(
            new Uri($"/api/staff/enrollments/{plannerEnrollment}", UriKind.Relative)))
        {
            removed.StatusCode.Should().Be(HttpStatusCode.OK, "a planner who is not the last may remove themselves");
            (await removed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()
                .Should().Be(plannerEnrollment.ToString());
        }

        // The caller's own access tokens on THAT exercise (the one used and a second tab's) are dead...
        foreach (var token in new[] { callerToken, secondToken })
        {
            using var session = await WithToken(host, token).GetAsync(new Uri("/api/session", UriKind.Relative));
            session.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "self-revoke kills the caller's own sessions");
            using var list = await WithToken(host, token).GetAsync(new Uri($"/api/org/exercises/{exercise}/enrollments", UriKind.Relative));
            list.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "no planner route answers the revoked session");
        }

        // ...and so is refresh: a revoked session cannot be renewed.
        foreach (var token in new[] { callerToken, secondToken })
        {
            using var refresh = await host.CreateClient().PostAsJsonAsync(
                new Uri("/api/auth/refresh", UriKind.Relative), new { refreshToken = token + "-refresh" });
            refresh.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "refresh of a revoked session fails");
        }

        // Only that exercise's grant changed: the caller's session on another exercise and the other planner's live on.
        using (var other = await WithToken(host, otherExerciseToken).GetAsync(new Uri("/api/session", UriKind.Relative)))
        {
            other.StatusCode.Should().Be(HttpStatusCode.OK, "the caller's session on another exercise was not minted from this grant");
        }

        using (var refreshOther = await host.CreateClient().PostAsJsonAsync(
            new Uri("/api/auth/refresh", UriKind.Relative), new { refreshToken = otherPlannerToken + "-refresh" }))
        {
            refreshOther.StatusCode.Should().Be(HttpStatusCode.OK, "the remaining planner's session (and its refresh) is untouched");
        }

        await using var read = _kit.ReadContext();
        var sessions = await read.Sessions.AsNoTracking()
            .Where(s => s.Id == callerSession || s.Id == secondSession)
            .ToListAsync();
        sessions.Should().HaveCount(2).And.OnlyContain(s => s.RevokedAt != null, "RevokedAt stops access and refresh");
        (await read.Enrollments.IgnoreQueryFilters().AsNoTracking().SingleAsync(e => e.Id == plannerEnrollment))
            .DeletedAt.Should().NotBeNull("self-revoke is the same soft delete");
    }

    [RequiresDockerFact]
    public async Task SelfDemote_PlannerToController_Answers200_ThenTheOldSessionIs401_AndAFreshControllerSessionIs403OnPlannerRoutes()
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var (planner, plannerEnrollment) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (otherPlanner, _) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (callerSession, callerToken) = await _kit.SeedStaffSessionAsync(planner, exercise, "planner");
        var (_, otherPlannerToken) = await _kit.SeedStaffSessionAsync(otherPlanner, exercise, "planner");
        using var host = new StaffHost(_fixture.ConnectionString!);
        var listUri = new Uri($"/api/org/exercises/{exercise}/enrollments", UriKind.Relative);

        using (var demoted = await WithToken(host, callerToken).PatchAsync(
            new Uri($"/api/staff/enrollments/{plannerEnrollment}", UriKind.Relative),
            new StringContent("{\"role\":\"controller\"}", Encoding.UTF8, "application/json")))
        {
            demoted.StatusCode.Should().Be(HttpStatusCode.OK, "self-demotion is allowed while another planner remains");
            var body = await demoted.Content.ReadFromJsonAsync<JsonElement>();
            body.GetProperty("id").GetString().Should().Be(plannerEnrollment.ToString());
            body.GetProperty("role").GetString().Should().Be("controller", "the response is the changed enrollment");
        }

        // The grant the session was minted from changed, so the session is revoked: the next call is 401, never a stale
        // planner answer, whether it is a planner-only route or the session read itself.
        using (var list = await WithToken(host, callerToken).GetAsync(listUri))
        {
            list.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "the demoted planner's old session can no longer act");
        }

        using (var session = await WithToken(host, callerToken).GetAsync(new Uri("/api/session", UriKind.Relative)))
        {
            session.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        using (var refresh = await host.CreateClient().PostAsJsonAsync(
            new Uri("/api/auth/refresh", UriKind.Relative), new { refreshToken = callerToken + "-refresh" }))
        {
            refresh.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "refresh cannot resurrect the planner session");
        }

        // Signing in again yields a CONTROLLER session, which the planner-only route refuses.
        var (_, freshToken) = await _kit.SeedStaffSessionAsync(planner, exercise, "controller");
        using (var asController = await WithToken(host, freshToken).GetAsync(listUri))
        {
            asController.StatusCode.Should().Be(HttpStatusCode.Forbidden, "a controller may not administer staff");
        }

        using (var remaining = await WithToken(host, otherPlannerToken).GetAsync(listUri))
        {
            remaining.StatusCode.Should().Be(HttpStatusCode.OK, "the other planner's session is untouched");
            var staff = (await remaining.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("enrollments").EnumerateArray().ToList();
            staff.Single(e => e.GetProperty("id").GetString() == plannerEnrollment.ToString())
                .GetProperty("role").GetString().Should().Be("controller");
        }

        await using var read = _kit.ReadContext();
        (await read.Sessions.AsNoTracking().SingleAsync(s => s.Id == callerSession)).RevokedAt.Should().NotBeNull();
        (await read.TelemetryEvents.IgnoreQueryFilters()
                .CountAsync(t => t.ExerciseId == exercise && t.EventType == EnrollmentService.RoleChangedEventType))
            .Should().Be(1);
    }

    private static HttpClient WithToken(StaffHost host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<Answer> SendAsync(StaffHost host, string token, string route, Guid target, Guid candidate)
    {
        using var client = WithToken(host, token);
        using var response = route switch
        {
            "GET list" => await client.GetAsync(new Uri($"/api/org/exercises/{target}/enrollments", UriKind.Relative)),
            "POST grant" => await client.PostAsJsonAsync(
                new Uri($"/api/org/exercises/{target}/enrollments", UriKind.Relative),
                new { personId = candidate.ToString(), role = "controller" }),
            "PATCH role" => await client.PatchAsync(
                new Uri($"/api/staff/enrollments/{target}", UriKind.Relative),
                new StringContent("{\"role\":\"evaluator\"}", Encoding.UTF8, "application/json")),
            "DELETE" => await client.DeleteAsync(new Uri($"/api/staff/enrollments/{target}", UriKind.Relative)),
            _ => throw new ArgumentOutOfRangeException(nameof(route), route, null),
        };

        return new Answer(
            response.StatusCode,
            await response.Content.ReadAsStringAsync(),
            response.Content.Headers.ContentType?.ToString(),
            response.Content.Headers.ContentLength);
    }

    /// <summary>Everything an org-Y write could have touched, keyed so a before/after comparison is exact.</summary>
    private async Task<OrgSnapshot> SnapshotOrgAsync(Guid organizationId, Guid exerciseId)
    {
        await using var read = _kit.ReadContext();
        var enrollments = await read.Enrollments.IgnoreQueryFilters().AsNoTracking()
            .Where(e => e.ExerciseId == exerciseId)
            .OrderBy(e => e.Id)
            .Select(e => $"{e.Id}|{e.PersonId}|{e.Role}|{e.IsLead}|{e.DeletedAt}")
            .ToListAsync();
        var sessions = await read.Sessions.AsNoTracking()
            .Where(s => s.ExerciseId == exerciseId)
            .OrderBy(s => s.Id)
            .Select(s => $"{s.Id}|{s.Role}|{s.RevokedAt}")
            .ToListAsync();
        var telemetry = await read.TelemetryEvents.IgnoreQueryFilters().CountAsync(t => t.ExerciseId == exerciseId);
        var audit = await read.OrgAuditEvents.IgnoreQueryFilters().CountAsync(a => a.OrganizationId == organizationId);
        return new OrgSnapshot(enrollments, sessions, telemetry, audit);
    }

    private sealed record Answer(HttpStatusCode Status, string Body, string? ContentType, long? ContentLength);

    private sealed record OrgSnapshot(
        IReadOnlyList<string> Enrollments,
        IReadOnlyList<string> Sessions,
        int TelemetryEvents,
        int AuditEvents);

    /// <summary>The REAL <c>Program</c> host, unmodified (so the Program.cs wiring itself is under test).</summary>
    private sealed class StaffHost : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

        public StaffHost(string connectionString)
            => Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}
