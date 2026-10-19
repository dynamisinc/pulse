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
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Enrollments;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// Story 20 (#575a) — the staff ASSIGN routes over the REAL <c>Program</c> host (no test-side wiring, so a missing
/// <c>Program.cs</c> line fails here): <c>GET</c>/<c>POST /api/org/exercises/{exerciseId}/enrollments</c>,
/// <c>PATCH</c>/<c>DELETE /api/staff/enrollments/{id}</c>. The full caller matrix with exact statuses, the bare 404 for a
/// foreign exercise / foreign organization / missing id (and for a DISABLED person, who is also never a candidate), 409
/// <c>conflicting-enrollment</c>, 409 <c>last-planner</c>, re-grant after a soft-delete revoke, the grant-revoke rule (old
/// tokens 401), and the XC-004 + org-audit records.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class StaffAssignmentHttpTests
{
    /// <summary>
    /// Every allow-listed exercise-id (method, route) of the enrollment slice, driven by
    /// <see cref="ExerciseIdRoutes_AnswerAForeignOrSiblingOrMissingExercise_WithTheBare404"/>; pinned against
    /// <see cref="EnrollmentEndpoints.ExerciseIdRoutes"/> by <c>CompositionRootWiringTests</c>. Args: client, exercise id,
    /// a person of the caller's own organization (so a 404 is the exercise's, never the person's).
    /// </summary>
    internal static readonly IReadOnlyDictionary<(string Method, string Route), Func<HttpClient, Guid, Guid, Task<HttpResponseMessage>>> ExerciseIdCallers =
        new Dictionary<(string Method, string Route), Func<HttpClient, Guid, Guid, Task<HttpResponseMessage>>>
        {
            [("GET", EnrollmentEndpoints.ExerciseEnrollmentsRoute)] = (client, exerciseId, _) =>
                client.GetAsync(new Uri($"/api/org/exercises/{exerciseId}/enrollments", UriKind.Relative)),
            [("POST", EnrollmentEndpoints.ExerciseEnrollmentsRoute)] = (client, exerciseId, personId) =>
                client.PostAsJsonAsync(
                    new Uri($"/api/org/exercises/{exerciseId}/enrollments", UriKind.Relative),
                    new { personId = personId.ToString(), role = "controller" }),
        };

    private readonly MsSqlContainerFixture _fixture;
    private readonly EnrollmentTestKit _kit;

    public StaffAssignmentHttpTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _kit = new EnrollmentTestKit(fixture);
    }

    private enum Caller
    {
        Planner,
        OrgAdmin,
        OrgAdminAsPlanner,
        Controller,
        LeadController,
        Evaluator,
        Participant,
        Anonymous,
    }

    [RequiresDockerFact]
    public async Task EveryStaffAssignmentRoute_AnswersEveryCaller_WithTheExactStatus()
    {
        var world = await SeedWorldAsync();
        using var host = new StaffHost(_fixture.ConnectionString!);

        // Allowed callers' probes write nothing: {} is a 400 (judged after the gate), DELETE targets a fresh id (404).
        var routes = new (string Name, HttpStatusCode Allowed, Func<HttpClient, Task<HttpResponseMessage>> Call)[]
        {
            ("GET list", HttpStatusCode.OK, client => client.GetAsync(new Uri($"/api/org/exercises/{world.Exercise}/enrollments", UriKind.Relative))),
            ("POST grant", HttpStatusCode.BadRequest, client => client.PostAsync(new Uri($"/api/org/exercises/{world.Exercise}/enrollments", UriKind.Relative), Json("{}"))),
            ("PATCH role", HttpStatusCode.BadRequest, client => client.PatchAsync(new Uri($"/api/staff/enrollments/{world.EvaluatorEnrollment}", UriKind.Relative), Json("{}"))),
            ("DELETE", HttpStatusCode.NotFound, client => client.DeleteAsync(new Uri($"/api/staff/enrollments/{Guid.NewGuid()}", UriKind.Relative))),
        };

        var expected = new Dictionary<Caller, HttpStatusCode?>
        {
            [Caller.Planner] = null,                 // null = the route's own "allowed" status
            [Caller.OrgAdmin] = null,
            [Caller.OrgAdminAsPlanner] = null,
            [Caller.Controller] = HttpStatusCode.Forbidden,
            [Caller.LeadController] = HttpStatusCode.Forbidden,
            [Caller.Evaluator] = HttpStatusCode.Forbidden,
            [Caller.Participant] = HttpStatusCode.Forbidden,   // refused by the staff-world gate before the handler
            [Caller.Anonymous] = HttpStatusCode.Unauthorized,
        };

        var failures = new List<string>();
        foreach (var (name, allowed, call) in routes)
        {
            foreach (var (caller, refusal) in expected)
            {
                using var client = host.CreateClient();
                if (await world.TokenForAsync(caller) is { } token)
                {
                    client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
                }

                using var response = await call(client);
                var want = refusal ?? allowed;
                if (response.StatusCode != want)
                {
                    failures.Add($"{name} as {caller}: expected {(int)want}, got {(int)response.StatusCode}");
                }
            }
        }

        failures.Should().BeEmpty("every staff-assignment route answers every caller exactly as the story-20 matrix says");

        await using var read = _kit.ReadContext();
        (await read.Enrollments.IgnoreQueryFilters().CountAsync(e => e.ExerciseId == world.Exercise && e.DeletedAt != null))
            .Should().Be(0, "no probe revoked anything");
    }

    [RequiresDockerFact]
    public async Task ExerciseIdRoutes_AnswerAForeignOrSiblingOrMissingExercise_WithTheBare404()
    {
        var world = await SeedWorldAsync();
        var sibling = await _kit.SeedExerciseAsync(world.Org);
        var otherOrg = await _kit.SeedOrganizationAsync();
        var foreign = await _kit.SeedExerciseAsync(otherOrg);
        var candidate = await SeedPersonAsync(world.Org, "Casey Candidate", $"casey-{Guid.NewGuid():N}@example.com");
        using var host = new StaffHost(_fixture.ConnectionString!);

        foreach (var ((method, route), call) in ExerciseIdCallers)
        {
            // A planner: their own resolved exercise only — a sibling of the same org is as invisible as a foreign one.
            foreach (var target in new[] { sibling, foreign, Guid.NewGuid() })
            {
                using var response = await call(await ClientAsync(host, world, Caller.Planner), target, candidate);
                response.StatusCode.Should().Be(HttpStatusCode.NotFound, "{0} {1} as planner on {2}", method, route, target);
                (await response.Content.ReadAsStringAsync()).Should().BeEmpty("the bare 404 carries no body");
            }

            // An org admin: any exercise of their own organization, never another customer's.
            foreach (var target in new[] { foreign, Guid.NewGuid() })
            {
                using var response = await call(await ClientAsync(host, world, Caller.OrgAdmin), target, candidate);
                response.StatusCode.Should().Be(HttpStatusCode.NotFound, "{0} {1} as org admin on {2}", method, route, target);
                (await response.Content.ReadAsStringAsync()).Should().BeEmpty();
            }
        }

        await using var read = _kit.ReadContext();
        (await read.Enrollments.IgnoreQueryFilters().Active().CountAsync(e => e.PersonId == candidate))
            .Should().Be(0, "no refused grant wrote anything");
    }

    [RequiresDockerFact]
    public async Task PatchAndDelete_OnAForeignExerciseForeignOrgMissingOrParticipantEnrollment_AreTheBare404()
    {
        var world = await SeedWorldAsync();
        var sibling = await _kit.SeedExerciseAsync(world.Org);
        var otherOrg = await _kit.SeedOrganizationAsync();
        var foreign = await _kit.SeedExerciseAsync(otherOrg);
        var (_, siblingController) = await _kit.SeedStaffAsync(world.Org, sibling, "controller");
        var (_, foreignController) = await _kit.SeedStaffAsync(otherOrg, foreign, "controller");
        var (_, foreignPlanner) = await _kit.SeedStaffAsync(otherOrg, foreign, "planner");
        var participantEnrollment = await SeedParticipantEnrollmentAsync(world.Exercise, await SeedPersonAsync(world.Org, "Pat Participant", null));
        using var host = new StaffHost(_fixture.ConnectionString!);

        async Task ExpectBare404Async(Caller caller, Guid target, string why)
        {
            using var patch = await (await ClientAsync(host, world, caller)).PatchAsync(
                new Uri($"/api/staff/enrollments/{target}", UriKind.Relative), Json("{\"role\":\"evaluator\"}"));
            patch.StatusCode.Should().Be(HttpStatusCode.NotFound, "PATCH as {0}: {1}", caller, why);
            (await patch.Content.ReadAsStringAsync()).Should().BeEmpty();

            using var delete = await (await ClientAsync(host, world, caller)).DeleteAsync(new Uri($"/api/staff/enrollments/{target}", UriKind.Relative));
            delete.StatusCode.Should().Be(HttpStatusCode.NotFound, "DELETE as {0}: {1}", caller, why);
            (await delete.Content.ReadAsStringAsync()).Should().BeEmpty();
        }

        await ExpectBare404Async(Caller.Planner, siblingController, "another exercise of the same org");
        await ExpectBare404Async(Caller.Planner, foreignController, "another organization");
        await ExpectBare404Async(Caller.Planner, Guid.NewGuid(), "missing");
        await ExpectBare404Async(Caller.Planner, participantEnrollment, "a participant enrollment belongs to the roster");
        await ExpectBare404Async(Caller.OrgAdmin, foreignController, "another organization");
        await ExpectBare404Async(Caller.OrgAdmin, foreignPlanner, "another organization's planner");
        await ExpectBare404Async(Caller.OrgAdmin, Guid.NewGuid(), "missing");

        await using var read = _kit.ReadContext();
        var untouched = await read.Enrollments.IgnoreQueryFilters().AsNoTracking()
            .Where(e => e.Id == siblingController || e.Id == foreignController || e.Id == foreignPlanner || e.Id == participantEnrollment)
            .ToListAsync();
        untouched.Should().HaveCount(4).And.OnlyContain(e => e.DeletedAt == null && e.Role != "evaluator", "nothing was changed");
    }

    [RequiresDockerFact]
    public async Task Grant_ByThePlanner_CreatesTheEnrollmentAndFacet_AndRecordsTelemetryAndAudit()
    {
        var world = await SeedWorldAsync();
        var person = await SeedPersonAsync(world.Org, "Gina Grant", $"gina-{Guid.NewGuid():N}@example.com");
        using var host = new StaffHost(_fixture.ConnectionString!);

        using var response = await (await ClientAsync(host, world, Caller.Planner)).PostAsJsonAsync(
            new Uri($"/api/org/exercises/{world.Exercise}/enrollments", UriKind.Relative),
            new { personId = person.ToString(), role = "Controller" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(["id", "exerciseId", "personId", "role", "isLead"]);
        body.GetProperty("exerciseId").GetString().Should().Be(world.Exercise.ToString(), "the exercise is the resolved one");
        body.GetProperty("personId").GetString().Should().Be(person.ToString());
        body.GetProperty("role").GetString().Should().Be("controller", "the role is normalized");
        body.GetProperty("isLead").GetBoolean().Should().BeFalse();
        var enrollmentId = Guid.Parse(body.GetProperty("id").GetString()!);

        await using var read = _kit.ReadContext();
        (await read.Enrollments.IgnoreQueryFilters().Active().SingleAsync(e => e.Id == enrollmentId)).ExerciseId.Should().Be(world.Exercise);
        (await read.StaffUsers.IgnoreQueryFilters().AnyAsync(u => u.Id == person)).Should().BeTrue("the grant creates the staff facet");
        var telemetry = await read.TelemetryEvents.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.ExerciseId == world.Exercise && t.EventType == EnrollmentService.GrantedEventType)
            .ToListAsync();
        telemetry.Should().ContainSingle("exactly one XC-004 event in the grant's unit of work");
        telemetry[0].Channel.Should().Be("system");
        telemetry[0].Actor.Role.Should().Be("planner");
        telemetry[0].Actor.ActingHumanId.Should().Be(world.People[Caller.Planner].ToString());
        var audit = await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(a => a.OrganizationId == world.Org && a.SubjectPersonId == person);
        audit.Kind.Should().Be(EnrollmentService.GrantedAuditKind);
        audit.ExerciseId.Should().Be(world.Exercise);
    }

    [RequiresDockerFact]
    public async Task Grant_ByAnOrgScopeAdmin_ToThemselves_IsAuditedSelfGranted()
    {
        var world = await SeedWorldAsync();
        var otherExercise = await _kit.SeedExerciseAsync(world.Org);
        using var host = new StaffHost(_fixture.ConnectionString!);

        using var response = await (await ClientAsync(host, world, Caller.OrgAdmin)).PostAsJsonAsync(
            new Uri($"/api/org/exercises/{otherExercise}/enrollments", UriKind.Relative),
            new { personId = world.People[Caller.OrgAdmin].ToString(), role = "planner" });

        response.StatusCode.Should().Be(HttpStatusCode.OK, "an org admin may assign across their own organization's exercises");
        await using var read = _kit.ReadContext();
        (await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking()
                .SingleAsync(a => a.ExerciseId == otherExercise && a.SubjectPersonId == world.People[Caller.OrgAdmin]))
            .Kind.Should().Be(EnrollmentService.SelfGrantedAuditKind);
    }

    [RequiresDockerFact]
    public async Task Grant_Refusals_400Invalid_404ForeignPerson_409ConflictingEnrollment()
    {
        var world = await SeedWorldAsync();
        var otherOrg = await _kit.SeedOrganizationAsync();
        var foreignPerson = await SeedPersonAsync(otherOrg, "Fred Foreign", null);
        var person = await SeedPersonAsync(world.Org, "Nia New", null);
        var participant = await SeedPersonAsync(world.Org, "Pat Participant", null);
        await SeedParticipantEnrollmentAsync(world.Exercise, participant);
        using var host = new StaffHost(_fixture.ConnectionString!);
        var client = await ClientAsync(host, world, Caller.Planner);
        var uri = new Uri($"/api/org/exercises/{world.Exercise}/enrollments", UriKind.Relative);

        using (var r = await client.PostAsJsonAsync(uri, new { personId = person.ToString(), role = "participant" }))
        {
            r.StatusCode.Should().Be(HttpStatusCode.BadRequest, "only staff roles are granted here");
        }

        using (var r = await client.PostAsJsonAsync(uri, new { role = "controller" }))
        {
            r.StatusCode.Should().Be(HttpStatusCode.BadRequest, "a missing personId is a validation 400");
        }

        using (var r = await client.PostAsJsonAsync(uri, new { personId = foreignPerson.ToString(), role = "controller" }))
        {
            r.StatusCode.Should().Be(HttpStatusCode.NotFound, "another organization's person is the bare 404");
            (await r.Content.ReadAsStringAsync()).Should().BeEmpty();
        }

        foreach (var (already, why) in new[]
        {
            (world.People[Caller.Controller], "already holds a staff enrollment in X"),
            (participant, "already holds a PARTICIPANT enrollment in X"),
        })
        {
            using var r = await client.PostAsJsonAsync(uri, new { personId = already.ToString(), role = "evaluator" });
            r.StatusCode.Should().Be(HttpStatusCode.Conflict, why);
            (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString().Should().Be("conflicting-enrollment");
        }

        await using var read = _kit.ReadContext();
        (await read.Enrollments.IgnoreQueryFilters().Active().CountAsync(e => e.PersonId == person || e.PersonId == foreignPerson))
            .Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task DisabledPerson_IsNeverACandidate_AndGrantingThem_IsTheSameBare404AsAMissingPerson()
    {
        var world = await SeedWorldAsync();
        var disabled = await SeedPersonAsync(world.Org, "Dana Disabled", $"dana-{Guid.NewGuid():N}@example.com");
        await using (var write = _kit.ReadContext())
        {
            await write.People.IgnoreQueryFilters().Where(p => p.Id == disabled)
                .ExecuteUpdateAsync(set => set.SetProperty(p => p.DisabledAt, DateTimeOffset.UtcNow));
        }

        using var host = new StaffHost(_fixture.ConnectionString!);
        var uri = new Uri($"/api/org/exercises/{world.Exercise}/enrollments", UriKind.Relative);
        foreach (var caller in new[] { Caller.Planner, Caller.OrgAdmin })
        {
            using (var list = await (await ClientAsync(host, world, caller)).GetAsync(uri))
            {
                list.StatusCode.Should().Be(HttpStatusCode.OK);
                (await list.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("candidates").EnumerateArray()
                    .Select(c => c.GetProperty("personId").GetString())
                    .Should().NotContain(disabled.ToString(), "a disabled person cannot sign in, so is never offered ({0})", caller);
            }

            // The disabled person and a person that does not exist answer identically: status AND (empty) body.
            foreach (var (target, why) in new[] { (disabled, "disabled"), (Guid.NewGuid(), "missing") })
            {
                using var grant = await (await ClientAsync(host, world, caller)).PostAsJsonAsync(
                    uri, new { personId = target.ToString(), role = "controller" });
                grant.StatusCode.Should().Be(HttpStatusCode.NotFound, "{0} person as {1}", why, caller);
                (await grant.Content.ReadAsStringAsync()).Should().BeEmpty("the bare 404 reveals nothing ({0})", why);
            }
        }

        await using var read = _kit.ReadContext();
        (await read.Enrollments.IgnoreQueryFilters().CountAsync(e => e.PersonId == disabled))
            .Should().Be(0, "no refused grant wrote anything");
        (await read.StaffUsers.IgnoreQueryFilters().AnyAsync(u => u.Id == disabled))
            .Should().BeFalse("no staff facet is created for a refused grant");
    }

    [RequiresDockerFact]
    public async Task List_ShowsTheActiveStaffWithLeadMarker_AndTheNotYetEnrolledOrgPeopleAsCandidates()
    {
        var world = await SeedWorldAsync();
        var otherOrg = await _kit.SeedOrganizationAsync();
        var candidateEmail = $"cara-{Guid.NewGuid():N}@example.com";
        var candidate = await SeedPersonAsync(world.Org, "Cara Candidate", candidateEmail);
        var foreignPerson = await SeedPersonAsync(otherOrg, "Fred Foreign", null);
        var participant = await SeedPersonAsync(world.Org, "Pat Participant", null);
        await SeedParticipantEnrollmentAsync(world.Exercise, participant);
        var (revokedPerson, revokedEnrollment) = await _kit.SeedStaffAsync(world.Org, world.Exercise, "evaluator");
        await using (var write = _kit.ReadContext())
        {
            await write.Enrollments.IgnoreQueryFilters().Where(e => e.Id == revokedEnrollment)
                .ExecuteUpdateAsync(set => set.SetProperty(e => e.DeletedAt, DateTimeOffset.UtcNow));
        }

        using var host = new StaffHost(_fixture.ConnectionString!);
        foreach (var caller in new[] { Caller.Planner, Caller.OrgAdmin, Caller.OrgAdminAsPlanner })
        {
            using var response = await (await ClientAsync(host, world, caller)).GetAsync(
                new Uri($"/api/org/exercises/{world.Exercise}/enrollments", UriKind.Relative));
            response.StatusCode.Should().Be(HttpStatusCode.OK, "{0} may read the exercise's staff list", caller);

            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            body.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(["exerciseId", "enrollments", "candidates"]);
            body.GetProperty("exerciseId").GetString().Should().Be(world.Exercise.ToString());

            var staff = body.GetProperty("enrollments").EnumerateArray().ToList();
            staff.Select(e => e.GetProperty("id").GetString()).Should().BeEquivalentTo(
                world.StaffEnrollments.Select(id => id.ToString()),
                "active staff only: the revoked evaluator and the participant are not listed");
            staff.Select(e => e.GetProperty("role").GetString()).Should().Equal(
                ["planner", "planner", "controller", "controller", "evaluator"], "planners first, then controllers, then evaluators");
            staff[0].EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
                ["id", "personId", "displayName", "email", "role", "isLead"]);
            staff.Single(e => e.GetProperty("isLead").GetBoolean()).GetProperty("id").GetString()
                .Should().Be(world.LeadEnrollment.ToString(), "the lead controller is marked");

            var candidates = body.GetProperty("candidates").EnumerateArray().ToList();
            var ids = candidates.Select(c => c.GetProperty("personId").GetString()).ToList();
            ids.Should().Contain(candidate.ToString()).And.Contain(revokedPerson.ToString(), "a revoked person may be granted again");
            ids.Should().NotContain(foreignPerson.ToString(), "another organization's people are never listed");
            ids.Should().NotContain(participant.ToString(), "a person enrolled in X in any role would be 409");
            ids.Should().NotContain(world.People[Caller.Controller].ToString(), "an enrolled staff member is not a candidate");
            var cara = candidates.Single(c => c.GetProperty("personId").GetString() == candidate.ToString());
            cara.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(["personId", "displayName", "email"]);
            cara.GetProperty("displayName").GetString().Should().Be("Cara Candidate");
            cara.GetProperty("email").GetString().Should().Be(candidateEmail);
        }
    }

    [RequiresDockerFact]
    public async Task PatchRole_ChangesTheRole_RevokesTheTargetsSessions_AndRecordsIt()
    {
        var world = await SeedWorldAsync();
        using var host = new StaffHost(_fixture.ConnectionString!);
        var controllerToken = await world.TokenForAsync(Caller.Controller);

        using (var invalid = await (await ClientAsync(host, world, Caller.Planner)).PatchAsync(
            new Uri($"/api/staff/enrollments/{world.ControllerEnrollment}", UriKind.Relative), Json("{\"role\":\"pio\"}")))
        {
            invalid.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        using var response = await (await ClientAsync(host, world, Caller.Planner)).PatchAsync(
            new Uri($"/api/staff/enrollments/{world.ControllerEnrollment}", UriKind.Relative), Json("{\"role\":\"evaluator\"}"));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("role").GetString().Should().Be("evaluator");

        using var session = await WithToken(host, controllerToken).GetAsync(new Uri("/api/session", UriKind.Relative));
        session.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "a role change revokes the person's sessions on the exercise");

        await using var read = _kit.ReadContext();
        (await read.TelemetryEvents.IgnoreQueryFilters()
                .CountAsync(t => t.ExerciseId == world.Exercise && t.EventType == EnrollmentService.RoleChangedEventType))
            .Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task Delete_SoftRevokes_RevokesTheTargetsSessions_AndThePersonCanBeGrantedAgain()
    {
        var world = await SeedWorldAsync();
        using var host = new StaffHost(_fixture.ConnectionString!);
        var evaluatorToken = await world.TokenForAsync(Caller.Evaluator);
        var evaluator = world.People[Caller.Evaluator];

        using var removed = await (await ClientAsync(host, world, Caller.Planner)).DeleteAsync(
            new Uri($"/api/staff/enrollments/{world.EvaluatorEnrollment}", UriKind.Relative));
        removed.StatusCode.Should().Be(HttpStatusCode.OK);

        using (var again = await (await ClientAsync(host, world, Caller.Planner)).DeleteAsync(
            new Uri($"/api/staff/enrollments/{world.EvaluatorEnrollment}", UriKind.Relative)))
        {
            again.StatusCode.Should().Be(HttpStatusCode.NotFound, "a revoked enrollment is no longer reachable");
        }

        using (var session = await WithToken(host, evaluatorToken).GetAsync(new Uri("/api/session", UriKind.Relative)))
        {
            session.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "a removal revokes the person's sessions on the exercise");
        }

        using var regrant = await (await ClientAsync(host, world, Caller.Planner)).PostAsJsonAsync(
            new Uri($"/api/org/exercises/{world.Exercise}/enrollments", UriKind.Relative),
            new { personId = evaluator.ToString(), role = "controller" });
        regrant.StatusCode.Should().Be(HttpStatusCode.OK, "the soft-deleted row no longer holds the (exercise, person) unique slot");
        var newId = Guid.Parse((await regrant.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!);
        newId.Should().NotBe(world.EvaluatorEnrollment, "a re-grant is a new row; the revoked one keeps its history");

        await using var read = _kit.ReadContext();
        (await read.Enrollments.IgnoreQueryFilters().AsNoTracking().SingleAsync(e => e.Id == world.EvaluatorEnrollment))
            .DeletedAt.Should().NotBeNull("revoke is a soft delete (XC-010)");
        (await read.TelemetryEvents.IgnoreQueryFilters()
                .CountAsync(t => t.ExerciseId == world.Exercise && t.EventType == EnrollmentService.RevokedEventType))
            .Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task LastPlanner_CannotBeRemovedOrDemoted_ByThemselvesOrAnOrgAdmin_AndASecondPlannerUnlocksIt()
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var (planner, plannerEnrollment) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (admin, _) = await _kit.SeedStaffAsync(org, exerciseId: null, orgRole: "orgAdmin");
        using var host = new StaffHost(_fixture.ConnectionString!);

        async Task<HttpClient> PlannerAsync(Guid person) => WithToken(host, (await _kit.SeedStaffSessionAsync(person, exercise, "planner")).Token);
        async Task<HttpClient> AdminAsync() => WithToken(host, (await _kit.SeedStaffSessionAsync(admin, exerciseId: null, "orgAdmin")).Token);
        var target = new Uri($"/api/staff/enrollments/{plannerEnrollment}", UriKind.Relative);

        foreach (var (name, send) in new (string, Func<Task<HttpResponseMessage>>)[]
        {
            ("self-remove", async () => await (await PlannerAsync(planner)).DeleteAsync(target)),
            ("self-demote", async () => await (await PlannerAsync(planner)).PatchAsync(target, Json("{\"role\":\"controller\"}"))),
            ("org admin remove", async () => await (await AdminAsync()).DeleteAsync(target)),
            ("org admin demote", async () => await (await AdminAsync()).PatchAsync(target, Json("{\"role\":\"evaluator\"}"))),
        })
        {
            using var response = await send();
            response.StatusCode.Should().Be(HttpStatusCode.Conflict, name);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString().Should().Be("last-planner", name);
        }

        await using (var read = _kit.ReadContext())
        {
            var row = await read.Enrollments.IgnoreQueryFilters().AsNoTracking().SingleAsync(e => e.Id == plannerEnrollment);
            row.DeletedAt.Should().BeNull();
            row.Role.Should().Be("planner");
            (await read.TelemetryEvents.IgnoreQueryFilters().CountAsync(t => t.ExerciseId == exercise
                    && (t.EventType == EnrollmentService.RevokedEventType || t.EventType == EnrollmentService.RoleChangedEventType)))
                .Should().Be(0, "a refused change records nothing");
        }

        // A second planner: now the first may step down (self-demote), and the second is the new last planner.
        var (second, secondEnrollment) = await _kit.SeedStaffAsync(org, exercise, "planner");
        using (var demote = await (await PlannerAsync(planner)).PatchAsync(target, Json("{\"role\":\"controller\"}")))
        {
            demote.StatusCode.Should().Be(HttpStatusCode.OK, "self-demotion is allowed while another planner remains");
        }

        using var last = await (await PlannerAsync(second)).DeleteAsync(new Uri($"/api/staff/enrollments/{secondEnrollment}", UriKind.Relative));
        last.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await last.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString().Should().Be("last-planner");
    }

    private static StringContent Json(string body) => new(body, Encoding.UTF8, "application/json");

    private static HttpClient WithToken(StaffHost host, string? token)
    {
        var client = host.CreateClient();
        if (token is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        return client;
    }

    private static async Task<HttpClient> ClientAsync(StaffHost host, World world, Caller caller) =>
        WithToken(host, await world.TokenForAsync(caller));

    private async Task<Guid> SeedPersonAsync(Guid organizationId, string displayName, string? email)
    {
        var id = Guid.NewGuid();
        await using var seed = _kit.ReadContext();
        seed.People.Add(new Person
        {
            Id = id,
            OrganizationId = organizationId,
            DisplayName = displayName,
            Email = email,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
        return id;
    }

    private async Task<Guid> SeedParticipantEnrollmentAsync(Guid exerciseId, Guid personId) =>
        await _kit.SeedEnrollmentAsync(exerciseId, personId, "participant");

    /// <summary>
    /// One exercise with a planner, an org admin who is ALSO a planner there, a controller, the lead controller and an
    /// evaluator, plus a fresh session per request on demand.
    /// </summary>
    private async Task<World> SeedWorldAsync()
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var (planner, plannerEnrollment) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (admin, adminEnrollment) = await _kit.SeedStaffAsync(org, exercise, "planner", orgRole: "orgAdmin");
        var (controller, controllerEnrollment) = await _kit.SeedStaffAsync(org, exercise, "controller");
        var (lead, leadEnrollment) = await _kit.SeedStaffAsync(org, exercise, "controller", isLead: true);
        var (evaluator, evaluatorEnrollment) = await _kit.SeedStaffAsync(org, exercise, "evaluator");

        return new World(_kit, _fixture)
        {
            Org = org,
            Exercise = exercise,
            ControllerEnrollment = controllerEnrollment,
            LeadEnrollment = leadEnrollment,
            EvaluatorEnrollment = evaluatorEnrollment,
            StaffEnrollments = [plannerEnrollment, adminEnrollment, controllerEnrollment, leadEnrollment, evaluatorEnrollment],
            People = new Dictionary<Caller, Guid>
            {
                [Caller.Planner] = planner,
                [Caller.OrgAdmin] = admin,
                [Caller.OrgAdminAsPlanner] = admin,
                [Caller.Controller] = controller,
                [Caller.LeadController] = lead,
                [Caller.Evaluator] = evaluator,
            },
        };
    }

    private sealed class World(EnrollmentTestKit kit, MsSqlContainerFixture fixture)
    {
        public required Guid Org { get; init; }

        public required Guid Exercise { get; init; }

        public required Guid ControllerEnrollment { get; init; }

        public required Guid LeadEnrollment { get; init; }

        public required Guid EvaluatorEnrollment { get; init; }

        public required IReadOnlyList<Guid> StaffEnrollments { get; init; }

        public required IReadOnlyDictionary<Caller, Guid> People { get; init; }

        public async Task<string?> TokenForAsync(Caller caller)
        {
            switch (caller)
            {
                case Caller.Anonymous:
                    return null;
                case Caller.Participant:
                    var token = $"sa-participant-{Guid.NewGuid():N}";
                    await using (var seed = fixture.CreateContext())
                    {
                        seed.Sessions.Add(TestSessions.NewSession(token, Exercise, kind: "participant"));
                        await seed.SaveChangesAsync();
                    }

                    return token;
                case Caller.OrgAdmin:
                    return (await kit.SeedStaffSessionAsync(People[caller], exerciseId: null, "orgAdmin")).Token;
                case Caller.Planner or Caller.OrgAdminAsPlanner:
                    return (await kit.SeedStaffSessionAsync(People[caller], Exercise, "planner")).Token;
                case Caller.Evaluator:
                    return (await kit.SeedStaffSessionAsync(People[caller], Exercise, "evaluator")).Token;
                default:
                    return (await kit.SeedStaffSessionAsync(People[caller], Exercise, "controller")).Token;
            }
        }
    }

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
