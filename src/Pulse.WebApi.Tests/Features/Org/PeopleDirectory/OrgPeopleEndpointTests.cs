namespace Pulse.WebApi.Tests.Features.Org.PeopleDirectory;

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
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Org.PeopleDirectory;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Credentials;
using Pulse.WebApi.Tests.Features.Identity.RoleMatrix;
using Xunit;

/// <summary>
/// identity-auth-roles/19 (#574, Tier-2 isolation) — the org directory through the REAL <c>Program</c> pipeline against
/// real SQL: <c>GET /api/org/people</c>, <c>GET /api/org/people/{personId}</c> and <c>PATCH /api/org/people/{personId}</c>.
/// Covers AC "List", "Grant / revoke org admin" (incl. the staff-facet amendment and the last-org-admin race), "Disable /
/// enable", "Role gating", "Directory shows people only", the isolation ACs (foreign org bare 404, foreign exercise), the
/// org-audit replacement of the XC-004 AC, and the Copilot-4 session-revocation fold (old access AND refresh tokens 401).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class OrgPeopleEndpointTests
{
    /// <summary>
    /// How to call each allow-listed PERSON-id route of the slice. Must cover <see cref="OrgPeopleEndpoints.PersonIdRoutes"/>
    /// exactly, which <c>CompositionRootWiringTests</c> asserts.
    /// </summary>
    internal static readonly IReadOnlyDictionary<(string Method, string Route), Func<HttpClient, Guid, Task<HttpResponseMessage>>> PersonIdCallers =
        new Dictionary<(string Method, string Route), Func<HttpClient, Guid, Task<HttpResponseMessage>>>
        {
            [("GET", OrgPeopleEndpoints.PersonRoute)] = (client, id) => client.GetAsync(PersonUri(id)),
            [("PATCH", OrgPeopleEndpoints.PersonRoute)] = (client, id) => PatchAsync(client, id, "{\"disabled\":true}"),
        };

    private static readonly Uri LoginUri = new("/api/auth/staff/login", UriKind.Relative);
    private static readonly Uri RefreshUri = new("/api/auth/refresh", UriKind.Relative);
    private static readonly Uri SessionUri = new("/api/session", UriKind.Relative);

    private readonly MsSqlContainerFixture _fixture;
    private readonly CredentialTestWorld _world;

    public OrgPeopleEndpointTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _world = new CredentialTestWorld(fixture);
    }

    // ---------------------------------------------------------------- List (AC List, Directory shows people only)

    [RequiresDockerFact]
    public async Task List_ReturnsOnlyTheCallersOrgPeople_WithTheEnrollmentsSummary_AndNeverAOneOffParticipant()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (otherOrg, _) = await _world.SeedOrganizationAsync();
        var exercise = await _world.SeedExerciseAsync(org);
        var foreignExercise = await _world.SeedExerciseAsync(otherOrg);
        var (admin, adminToken) = await SeedAdminAsync(org);
        var (controller, controllerEmail) = await _world.SeedPersonAsync(org);
        await _world.SeedEnrollmentAsync(exercise, controller, "controller");
        var revokedExercise = await _world.SeedExerciseAsync(org);
        await _world.SeedEnrollmentAsync(revokedExercise, controller, "evaluator", deletedAt: DateTimeOffset.UtcNow);
        var (disabled, _) = await _world.SeedPersonAsync(org, disabled: true);
        var (foreignPerson, _) = await _world.SeedPersonAsync(otherOrg);
        await _world.SeedEnrollmentAsync(foreignExercise, foreignPerson, "planner");

        // A person straddling a tenant boundary (impossible through the services — forged): the foreign exercise's
        // enrollment must not be summarized.
        await _world.SeedEnrollmentAsync(foreignExercise, controller, "planner");
        var oneOffEnrollment = await SeedOneOffParticipantAsync(exercise);

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var client = CredentialTestWorld.CreateClient(factory, adminToken);
        using var response = await client.GetAsync(new Uri(OrgPeopleEndpoints.PeopleRoute, UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(["items", "page", "pageSize", "total"]);
        body.GetProperty("total").GetInt32().Should().Be(3, "exactly the caller's organization's three people");
        body.GetProperty("page").GetInt32().Should().Be(1);
        body.GetProperty("pageSize").GetInt32().Should().Be(OrgPeopleService.DefaultPageSize);

        var items = body.GetProperty("items").EnumerateArray().ToList();
        items.Select(i => Guid.Parse(i.GetProperty("id").GetString()!)).Should().BeEquivalentTo(
            [admin, controller, disabled], "another customer's person never appears");
        items.Select(i => i.GetProperty("id").GetString()).Should().NotContain(
            oneOffEnrollment.ToString(), "a one-off participant has no Person row, so it is never in the directory");

        var controllerRow = items.Single(i => i.GetProperty("id").GetString() == controller.ToString());
        controllerRow.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
            ["id", "displayName", "email", "orgRole", "disabled", "disabledAt", "lockedOutUntil", "enrollments"],
            "the wire shape is fixed, and carries no credential material");
        controllerRow.GetProperty("email").GetString().Should().Be(controllerEmail);
        controllerRow.GetProperty("orgRole").ValueKind.Should().Be(JsonValueKind.Null);
        controllerRow.GetProperty("disabled").GetBoolean().Should().BeFalse();
        var enrollment = controllerRow.GetProperty("enrollments").EnumerateArray().Should().ContainSingle(
            "the revoked enrollment and the cross-tenant enrollment are both excluded").Which;
        enrollment.GetProperty("exerciseId").GetString().Should().Be(exercise.ToString());
        enrollment.GetProperty("role").GetString().Should().Be("controller");
        enrollment.GetProperty("isLead").GetBoolean().Should().BeFalse();
        enrollment.GetProperty("exerciseName").GetString().Should().StartWith("Credential Exercise");

        var adminRow = items.Single(i => i.GetProperty("id").GetString() == admin.ToString());
        adminRow.GetProperty("orgRole").GetString().Should().Be(Person.OrgAdminRole);

        var disabledRow = items.Single(i => i.GetProperty("id").GetString() == disabled.ToString());
        disabledRow.GetProperty("disabled").GetBoolean().Should().BeTrue();
        disabledRow.GetProperty("disabledAt").GetString().Should().NotBeNullOrEmpty();

        var raw = await response.Content.ReadAsStringAsync();
        raw.Should().NotContain("AQAAAA", "no password hash is ever serialized");
    }

    [RequiresDockerFact]
    public async Task List_IsPaged_AndSearchableByNameAndEmail_AndShowsAnActiveLockout()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (_, adminToken) = await SeedAdminAsync(org);
        var alpha = await SeedNamedPersonAsync(org, "Alpha Rivera", "alpha.r@example.org");
        var bravo = await SeedNamedPersonAsync(org, "Bravo Chen", "b.chen@lantern.example.org");
        var charlie = await SeedNamedPersonAsync(org, "Charlie Okafor", "charlie@example.org", lockedOutUntil: DateTimeOffset.UtcNow.AddMinutes(10));

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var client = CredentialTestWorld.CreateClient(factory, adminToken);

        var byName = await ListAsync(client, "?search=rivera");
        byName.GetProperty("total").GetInt32().Should().Be(1);
        Ids(byName).Should().Equal(alpha);

        var byEmail = await ListAsync(client, "?search=LANTERN");
        Ids(byEmail).Should().Equal([bravo], "the search is case-insensitive over the email too");

        var page1 = await ListAsync(client, "?search=example.org&pageSize=2&page=1");
        var page2 = await ListAsync(client, "?search=example.org&pageSize=2&page=2");
        page1.GetProperty("total").GetInt32().Should().Be(3);
        Ids(page1).Should().Equal([alpha, bravo], "ordered by display name");
        Ids(page2).Should().Equal([charlie]);
        page2.GetProperty("page").GetInt32().Should().Be(2);
        page2.GetProperty("items")[0].GetProperty("lockedOutUntil").GetString().Should().NotBeNullOrEmpty(
            "a live lockout is shown");
        page1.GetProperty("items")[0].GetProperty("lockedOutUntil").ValueKind.Should().Be(JsonValueKind.Null);

        foreach (var bad in new[] { "?page=0", "?pageSize=0", $"?pageSize={OrgPeopleService.MaxPageSize + 1}", $"?search={new string('x', OrgPeopleService.MaxSearchLength + 1)}" })
        {
            using var response = await client.GetAsync(new Uri(OrgPeopleEndpoints.PeopleRoute + bad, UriKind.Relative));
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "{0} is out of range", bad);
        }
    }

    // ---------------------------------------------------------------- Isolation (foreign org, foreign exercise)

    [RequiresDockerFact]
    public async Task PersonIdRoutes_ForAnotherCustomersPerson_AreTheSameBare404AsAMissingId_AndChangeNothing()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (otherOrg, _) = await _world.SeedOrganizationAsync();
        var (_, adminToken) = await SeedAdminAsync(org);
        var (foreignPerson, _) = await _world.SeedPersonAsync(otherOrg);

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var client = CredentialTestWorld.CreateClient(factory, adminToken);

        foreach (var (route, call) in PersonIdCallers)
        {
            using var foreign = await call(client, foreignPerson);
            using var missing = await call(client, Guid.NewGuid());

            foreign.StatusCode.Should().Be(HttpStatusCode.NotFound, "{0}: another customer's person", route);
            missing.StatusCode.Should().Be(HttpStatusCode.NotFound);
            (await foreign.Content.ReadAsByteArrayAsync()).Should().Equal(
                await missing.Content.ReadAsByteArrayAsync(), "{0}: 'exists elsewhere' must equal 'does not exist'", route);
            foreign.Content.Headers.ContentType?.ToString().Should().Be(missing.Content.Headers.ContentType?.ToString());

            // Positive control: the caller's OWN person is not a 404, so the 404 above is the tenant bound.
            var (ownPerson, _) = await _world.SeedPersonAsync(org);
            using var own = await call(client, ownPerson);
            own.StatusCode.Should().Be(HttpStatusCode.OK, "{0} on a person of the caller's own organization", route);
        }

        await using var read = _world.ReadContext();
        (await read.People.AsNoTracking().SingleAsync(p => p.Id == foreignPerson)).DisabledAt.Should().BeNull(
            "the foreign person was not disabled");
        (await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking().CountAsync(a => a.OrganizationId == otherOrg))
            .Should().Be(0, "nothing was recorded in the other customer's organization");
    }

    [RequiresDockerFact]
    public async Task EveryRoute_RefusesEveryNonOrgAdminSession_IncludingAnExerciseBoundSessionOfTheSameOrg()
    {
        // AC "Role gating" + the foreign-exercise case: every caller bound to an exercise (planner, controller, lead,
        // evaluator, participant, pio, read-only) is refused on the org-scope directory, and anonymous is 401.
        var world = await RoleMatrixWorld.SeedAsync(_fixture);
        var target = world.PersonOf(MatrixRole.Planner);
        using var host = new RoleMatrixHost(_fixture.ConnectionString!);

        var calls = new (string Label, Func<HttpClient, Task<HttpResponseMessage>> Call)[]
        {
            ("GET list", c => c.GetAsync(new Uri(OrgPeopleEndpoints.PeopleRoute, UriKind.Relative))),
            ("GET person", c => c.GetAsync(PersonUri(target))),
            ("PATCH person", c => PatchAsync(c, target, "{\"disabled\":true}")),
        };

        foreach (var role in Enum.GetValues<MatrixRole>().Where(r => r != MatrixRole.OrgAdmin))
        {
            foreach (var (label, call) in calls)
            {
                using var client = world.Client(host, await world.TokenForAsync(role));
                using var response = await call(client);
                response.StatusCode.Should().BeOneOf(
                    [HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden], "{0} as {1} must be refused", label, role);
                if (role is MatrixRole.Planner or MatrixRole.Controller or MatrixRole.LeadController or MatrixRole.Evaluator)
                {
                    response.StatusCode.Should().Be(HttpStatusCode.Forbidden, "{0}: a live staff caller of another role is a 403", label);
                }
            }
        }

        using (var asAdmin = world.Client(host, await world.TokenForAsync(MatrixRole.OrgAdmin)))
        using (var allowed = await asAdmin.GetAsync(PersonUri(target)))
        {
            allowed.StatusCode.Should().Be(HttpStatusCode.OK, "positive control: the org admin reaches the same person");
        }

        await using var read = _world.ReadContext();
        (await read.People.AsNoTracking().SingleAsync(p => p.Id == target)).DisabledAt.Should().BeNull("no refused PATCH wrote");
    }

    // ---------------------------------------------------------------- Grant / revoke

    [RequiresDockerFact]
    public async Task Grant_CreatesTheMissingStaffFacet_Audits_AndTheNewAdminSignsInOrgScope()
    {
        var (org, slug) = await _world.SeedOrganizationAsync();
        var (admin, adminToken) = await SeedAdminAsync(org);
        var (bare, email) = await SeedPersonWithoutFacetAsync(org);

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var client = CredentialTestWorld.CreateClient(factory, adminToken);
        using var anonymous = CredentialTestWorld.CreateClient(factory);

        using (var before = await anonymous.PostAsJsonAsync(LoginUri, new { orgSlug = slug, email, password = CredentialTestWorld.OldPassword }))
        {
            before.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "precondition: with no grant and no facet there is nothing to sign in to");
        }

        using var grant = await PatchAsync(client, bare, "{\"isOrgAdmin\":true}");
        grant.StatusCode.Should().Be(HttpStatusCode.OK);
        (await grant.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("orgRole").GetString().Should().Be(Person.OrgAdminRole);

        await using (var read = _world.ReadContext())
        {
            (await read.People.AsNoTracking().SingleAsync(p => p.Id == bare)).OrgRole.Should().Be(Person.OrgAdminRole);
            var facet = await read.StaffUsers.AsNoTracking().SingleAsync(u => u.Id == bare);
            facet.OrganizationId.Should().Be(org);
            facet.ExternalSubject.Should().Be($"pulse|{bare:N}");
            (await read.Enrollments.IgnoreQueryFilters().AsNoTracking().CountAsync(e => e.PersonId == bare))
                .Should().Be(0, "granting the org-admin grant creates no enrollment");

            var audit = await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking()
                .SingleAsync(a => a.SubjectPersonId == bare && a.Kind == OrgPeopleService.OrgRoleGrantedKind);
            audit.OrganizationId.Should().Be(org);
            audit.ActorPersonId.Should().Be(admin);
            audit.ExerciseId.Should().BeNull("an org-level change touches no exercise");
            audit.Payload.Should().Contain("\"actorRole\":\"orgAdmin\"");
            (await read.TelemetryEvents.IgnoreQueryFilters().AsNoTracking().CountAsync(t => t.Actor.ActingHumanId == admin.ToString()))
                .Should().Be(0, "no XC-004 event is invented for an org-level change");
        }

        using (var after = await anonymous.PostAsJsonAsync(LoginUri, new { orgSlug = slug, email, password = CredentialTestWorld.OldPassword }))
        {
            after.StatusCode.Should().Be(HttpStatusCode.OK, "a freshly granted admin with a password signs in org-scope");
        }

        await using var final = _world.ReadContext();
        (await final.Sessions.AsNoTracking().Where(s => s.PersonId == bare && s.RevokedAt == null).ToListAsync())
            .Should().ContainSingle().Which.ExerciseId.Should().BeNull("the session is org scope");

        // A repeat grant is a no-op: 200, nothing new audited.
        using var again = await PatchAsync(client, bare, "{\"isOrgAdmin\":true}");
        again.StatusCode.Should().Be(HttpStatusCode.OK);
        (await final.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking().CountAsync(a => a.SubjectPersonId == bare && a.Kind == OrgPeopleService.OrgRoleGrantedKind))
            .Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task Grant_VoidsEveryOutstandingCredentialTokenOfThePerson_SoAPrePromotionLinkCannotBeRedeemed()
    {
        // #665 adversarial review W5: a reset (or invite) link issued while the person was a non-admin must be dead the
        // moment they are promoted — in the grant's own transaction.
        var (org, _) = await _world.SeedOrganizationAsync();
        var (_, adminToken) = await SeedAdminAsync(org);
        var (target, _) = await _world.SeedPersonAsync(org);
        var (bystander, _) = await _world.SeedPersonAsync(org);
        var invite = await _world.IssueAsync(CredentialTokenPurposes.Invite, target, org);
        var reset = await _world.IssueAsync(CredentialTokenPurposes.Reset, target, org);
        var bystanderReset = await _world.IssueAsync(CredentialTokenPurposes.Reset, bystander, org);

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var client = CredentialTestWorld.CreateClient(factory, adminToken);
        using (var grant = await PatchAsync(client, target, "{\"isOrgAdmin\":true}"))
        {
            grant.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        await using (var read = _world.ReadContext())
        {
            (await read.CredentialTokens.AsNoTracking().Where(t => t.PersonId == target).ToListAsync())
                .Should().HaveCount(2).And.OnlyContain(t => t.UsedAt != null, "both pre-promotion links are voided");
            (await read.CredentialTokens.AsNoTracking().SingleAsync(t => t.Id == bystanderReset.Token.Id)).UsedAt
                .Should().BeNull("only the promoted person's tokens are voided");
            (await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking()
                    .SingleAsync(a => a.SubjectPersonId == target && a.Kind == OrgPeopleService.OrgRoleGrantedKind))
                .Payload.Should().Contain("\"tokensVoided\":2");
        }

        using var anonymous = CredentialTestWorld.CreateClient(factory);
        foreach (var raw in new[] { reset.RawToken, invite.RawToken })
        {
            using var redeem = await anonymous.PostAsJsonAsync(
                new Uri("/api/auth/password/reset", UriKind.Relative),
                new { token = raw, newPassword = CredentialTestWorld.NewPassword });
            redeem.StatusCode.Should().Be(HttpStatusCode.BadRequest, "a pre-promotion link cannot set the new admin's password");
            (await redeem.Content.ReadAsStringAsync()).Should().Be("{\"error\":\"invalid-token\"}");
        }
    }

    [RequiresDockerFact]
    public async Task Revoke_RevokesOnlyTheOrgScopeSessions_TheirAccessAndRefreshTokens401_AndKeepsEnrollments()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var exercise = await _world.SeedExerciseAsync(org);
        var (admin, adminToken) = await SeedAdminAsync(org);
        var (peer, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        await _world.SeedEnrollmentAsync(exercise, peer, "planner");
        var (_, peerOrgToken, peerOrgRefresh) = await _world.SeedStaffSessionAsync(peer, exerciseId: null, Person.OrgAdminRole);
        var (peerExerciseSession, peerExerciseToken, _) = await _world.SeedStaffSessionAsync(peer, exercise, "planner");

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var client = CredentialTestWorld.CreateClient(factory, adminToken);

        using var revoke = await PatchAsync(client, peer, "{\"isOrgAdmin\":false}");
        revoke.StatusCode.Should().Be(HttpStatusCode.OK);
        (await revoke.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("orgRole").ValueKind.Should().Be(JsonValueKind.Null);

        await AssertAccessAndRefreshDeadAsync(factory, peerOrgToken, peerOrgRefresh, "the revoked org-scope session");

        using (var stillPlanner = CredentialTestWorld.CreateClient(factory, peerExerciseToken))
        using (var probe = await stillPlanner.GetAsync(SessionUri))
        {
            probe.StatusCode.Should().Be(HttpStatusCode.OK, "the exercise session was minted from the enrollment, not the OrgRole grant");
        }

        await using var read = _world.ReadContext();
        (await read.People.AsNoTracking().SingleAsync(p => p.Id == peer)).OrgRole.Should().BeNull();
        (await read.Sessions.AsNoTracking().SingleAsync(s => s.Id == peerExerciseSession)).RevokedAt.Should().BeNull();
        (await read.Enrollments.IgnoreQueryFilters().AsNoTracking().CountAsync(e => e.PersonId == peer && e.DeletedAt == null))
            .Should().Be(1, "clearing OrgRole does not remove the person's exercise enrollments");
        var audit = await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(a => a.SubjectPersonId == peer && a.Kind == OrgPeopleService.OrgRoleRevokedKind);
        audit.ActorPersonId.Should().Be(admin);
        audit.Payload.Should().Contain("\"sessionsRevoked\":1");
    }

    [RequiresDockerFact]
    public async Task LastOrgAdmin_RevokeAndDisableOfTheLastEnabledAdmin_Are409_AndADisabledAdminDoesNotCount()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (admin, adminToken) = await SeedAdminAsync(org);
        var (disabledAdmin, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole, disabled: true);

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var client = CredentialTestWorld.CreateClient(factory, adminToken);

        // The caller is the only ENABLED admin (the other admin is disabled and does not count).
        await AssertConflictAsync(await PatchAsync(client, admin, "{\"isOrgAdmin\":false}"), OrgPeopleService.LastOrgAdminError);
        await AssertConflictAsync(await PatchAsync(client, admin, "{\"disabled\":true}"), OrgPeopleService.LastOrgAdminError);

        // Revoking the DISABLED admin's grant is allowed: it never counted.
        using (var revokeDisabled = await PatchAsync(client, disabledAdmin, "{\"isOrgAdmin\":false}"))
        {
            revokeDisabled.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        // With a second enabled admin, disabling them is allowed, which leaves the caller the last again.
        var (second, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        using (var disableSecond = await PatchAsync(client, second, "{\"disabled\":true}"))
        {
            disableSecond.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        await AssertConflictAsync(await PatchAsync(client, admin, "{\"isOrgAdmin\":false}"), OrgPeopleService.LastOrgAdminError);

        await using var read = _world.ReadContext();
        var self = await read.People.AsNoTracking().SingleAsync(p => p.Id == admin);
        self.OrgRole.Should().Be(Person.OrgAdminRole);
        self.DisabledAt.Should().BeNull();
        (await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking().CountAsync(a => a.SubjectPersonId == admin))
            .Should().Be(0, "a refused change is not recorded as a change");
    }

    [RequiresDockerFact]
    public async Task LastOrgAdmin_TwoAdminsDemotingOrDisablingEachOtherConcurrently_NeverLeaveZero()
    {
        // The safeguard's count is taken under row locks in the write's own transaction; without them both requests
        // would read "two admins" and both commit.
        for (var round = 0; round < 6; round++)
        {
            var (org, _) = await _world.SeedOrganizationAsync();
            var (a, aToken) = await SeedAdminAsync(org);
            var (b, bToken) = await SeedAdminAsync(org);
            var body = round % 2 == 0 ? "{\"isOrgAdmin\":false}" : "{\"disabled\":true}";

            await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
            using var asA = CredentialTestWorld.CreateClient(factory, aToken);
            using var asB = CredentialTestWorld.CreateClient(factory, bToken);

            var responses = await Task.WhenAll(PatchAsync(asA, b, body), PatchAsync(asB, a, body));
            var statuses = responses.Select(r => r.StatusCode).ToList();
            foreach (var response in responses)
            {
                response.Dispose();
            }

            statuses.Count(s => s == HttpStatusCode.OK).Should().BeLessThanOrEqualTo(1, "round {0} ({1}): at most one demotion may win", round, body);

            await using var read = _world.ReadContext();
            (await read.People.AsNoTracking().CountAsync(p => p.OrganizationId == org && p.OrgRole == Person.OrgAdminRole && p.DisabledAt == null))
                .Should().Be(1, "round {0} ({1}): exactly one enabled org admin survives, never zero", round, body);
        }
    }

    // ---------------------------------------------------------------- Disable / enable

    [RequiresDockerFact]
    public async Task Disable_RevokesEverySession_SignInIsTheUniform401_AndEnableReverses()
    {
        var (org, slug) = await _world.SeedOrganizationAsync();
        var exercise = await _world.SeedExerciseAsync(org);
        var otherExercise = await _world.SeedExerciseAsync(org);
        var (admin, adminToken) = await SeedAdminAsync(org);
        var (target, email) = await _world.SeedPersonAsync(org);
        await _world.SeedEnrollmentAsync(exercise, target, "controller");
        await _world.SeedEnrollmentAsync(otherExercise, target, "evaluator");
        var (_, firstToken, firstRefresh) = await _world.SeedStaffSessionAsync(target, exercise, "controller");
        var (_, secondToken, secondRefresh) = await _world.SeedStaffSessionAsync(target, otherExercise, "evaluator");

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var client = CredentialTestWorld.CreateClient(factory, adminToken);
        using var anonymous = CredentialTestWorld.CreateClient(factory);

        using (var disable = await PatchAsync(client, target, "{\"disabled\":true}"))
        {
            disable.StatusCode.Should().Be(HttpStatusCode.OK);
            (await disable.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("disabled").GetBoolean().Should().BeTrue();
        }

        await AssertAccessAndRefreshDeadAsync(factory, firstToken, firstRefresh, "the first exercise session");
        await AssertAccessAndRefreshDeadAsync(factory, secondToken, secondRefresh, "the second exercise session");

        string disabledBody;
        using (var disabledLogin = await anonymous.PostAsJsonAsync(LoginUri, new { orgSlug = slug, email, password = CredentialTestWorld.OldPassword }))
        {
            disabledLogin.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "a disabled person cannot sign in");
            disabledBody = await disabledLogin.Content.ReadAsStringAsync();
        }

        using (var wrongPassword = await anonymous.PostAsJsonAsync(LoginUri, new { orgSlug = slug, email = $"nobody.{Guid.NewGuid():N}@example.com", password = "not-the-password-at-all" }))
        {
            wrongPassword.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await wrongPassword.Content.ReadAsStringAsync()).Should().Be(disabledBody, "the refusal is the UNIFORM 401");
        }

        using (var enable = await PatchAsync(client, target, "{\"disabled\":false}"))
        {
            enable.StatusCode.Should().Be(HttpStatusCode.OK);
            (await enable.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("disabled").GetBoolean().Should().BeFalse();
        }

        using (var enabledLogin = await anonymous.PostAsJsonAsync(LoginUri, new { orgSlug = slug, email, password = CredentialTestWorld.OldPassword }))
        {
            enabledLogin.StatusCode.Should().Be(HttpStatusCode.OK, "enabling reverses the disable");
        }

        await using var read = _world.ReadContext();
        var kinds = await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking()
            .Where(a => a.SubjectPersonId == target && a.ActorPersonId == admin)
            .OrderBy(a => a.OccurredAt)
            .Select(a => new { a.Kind, a.Payload, a.ExerciseId })
            .ToListAsync();
        kinds.Select(k => k.Kind).Should().Equal(OrgPeopleService.DisabledKind, OrgPeopleService.EnabledKind);
        kinds[0].Payload.Should().Contain("\"sessionsRevoked\":2");
        kinds.Should().OnlyContain(k => k.ExerciseId == null);
    }

    [RequiresDockerFact]
    public async Task Disable_OfAnOrgAdmin_AlsoRevokesTheirOrgScopeSession_AndSelfDisableIsRefused()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (admin, adminToken) = await SeedAdminAsync(org);
        var (peer, peerToken) = await SeedAdminAsync(org);

        // CredentialTestWorld's seeded sessions carry the refresh token "<token>-refresh".
        var peerRefresh = peerToken + "-refresh";

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var client = CredentialTestWorld.CreateClient(factory, adminToken);

        await AssertConflictAsync(await PatchAsync(client, admin, "{\"disabled\":true}"), OrgPeopleService.CannotDisableSelfError);

        using (var disablePeer = await PatchAsync(client, peer, "{\"disabled\":true}"))
        {
            disablePeer.StatusCode.Should().Be(HttpStatusCode.OK, "two enabled admins: disabling the other one is allowed");
        }

        await AssertAccessAndRefreshDeadAsync(factory, peerToken, peerRefresh, "the disabled admin's org-scope session");

        await using var after = _world.ReadContext();
        (await after.People.AsNoTracking().SingleAsync(p => p.Id == admin)).DisabledAt.Should().BeNull("self-disable was refused");
    }

    [RequiresDockerFact]
    public async Task Patch_WithNeitherOrBothFields_Is400_AndANoOpWritesNothing()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (_, adminToken) = await SeedAdminAsync(org);
        var (target, _) = await _world.SeedPersonAsync(org);

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var client = CredentialTestWorld.CreateClient(factory, adminToken);

        foreach (var body in new[] { "{}", "{\"isOrgAdmin\":true,\"disabled\":true}", "{\"isOrgAdmin\":null}", "null" })
        {
            using var response = await PatchAsync(client, target, body);
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "body {0}", body);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString()
                .Should().Be(OrgPeopleService.InvalidRequestError);
        }

        foreach (var body in new[] { "{\"disabled\":false}", "{\"isOrgAdmin\":false}" })
        {
            using var response = await PatchAsync(client, target, body);
            response.StatusCode.Should().Be(HttpStatusCode.OK, "{0} on an enabled non-admin is a no-op", body);
        }

        await using var read = _world.ReadContext();
        (await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking().CountAsync(a => a.SubjectPersonId == target))
            .Should().Be(0, "neither a refused nor a no-op change is audited");
    }

    // ---------------------------------------------------------------- helpers

    internal static Uri PersonUri(Guid personId) => new($"/api/org/people/{personId}", UriKind.Relative);

    internal static Task<HttpResponseMessage> PatchAsync(HttpClient client, Guid personId, string json) =>
        client.PatchAsync(PersonUri(personId), new StringContent(json, Encoding.UTF8, "application/json"));

    private static List<Guid> Ids(JsonElement page) =>
        page.GetProperty("items").EnumerateArray().Select(i => Guid.Parse(i.GetProperty("id").GetString()!)).ToList();

    private static async Task<JsonElement> ListAsync(HttpClient client, string query)
    {
        using var response = await client.GetAsync(new Uri(OrgPeopleEndpoints.PeopleRoute + query, UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK, "GET {0}", query);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task AssertConflictAsync(HttpResponseMessage response, string error)
    {
        using (response)
        {
            response.StatusCode.Should().Be(HttpStatusCode.Conflict);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString().Should().Be(error);
        }
    }

    private static async Task AssertAccessAndRefreshDeadAsync(CredentialProbeFactory factory, string accessToken, string refreshToken, string what)
    {
        using (var old = CredentialTestWorld.CreateClient(factory, accessToken))
        using (var probe = await old.GetAsync(SessionUri))
        {
            probe.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "{0}: the old access token no longer authenticates", what);
        }

        using var anonymous = CredentialTestWorld.CreateClient(factory);
        using var refresh = await anonymous.PostAsJsonAsync(RefreshUri, new { refreshToken });
        refresh.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "{0}: the old refresh token cannot mint a replacement", what);
    }

    /// <summary>Seeds an enabled org admin (with a staff facet) and a live org-scope session; returns (id, token).</summary>
    private async Task<(Guid Id, string Token)> SeedAdminAsync(Guid org)
    {
        var (admin, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var (_, token, _) = await _world.SeedStaffSessionAsync(admin, exerciseId: null, Person.OrgAdminRole);
        return (admin, token);
    }

    private async Task<Guid> SeedNamedPersonAsync(Guid org, string displayName, string email, DateTimeOffset? lockedOutUntil = null)
    {
        var id = Guid.NewGuid();
        await using var seed = _world.ReadContext();
        seed.People.Add(new Person
        {
            Id = id,
            OrganizationId = org,
            DisplayName = displayName,
            Email = email,
            LockedOutUntil = lockedOutUntil,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
        return id;
    }

    /// <summary>A directory person with a Pulse password but NO staff facet (never enrolled as staff, never an admin).</summary>
    private async Task<(Guid Id, string Email)> SeedPersonWithoutFacetAsync(Guid org)
    {
        var id = Guid.NewGuid();
        var email = $"bare.{id:N}@example.com";
        var person = new Person { Id = id, OrganizationId = org, DisplayName = "Bare Person", Email = email, CreatedAt = DateTimeOffset.UtcNow };
        person.PasswordHash = new PasswordHasher<Person>().HashPassword(person, CredentialTestWorld.OldPassword);
        await using var seed = _world.ReadContext();
        seed.People.Add(person);
        await seed.SaveChangesAsync();
        return (id, email);
    }

    /// <summary>A one-off participant enrollment (no Person) on <paramref name="exerciseId"/>; returns the enrollment id.</summary>
    private async Task<Guid> SeedOneOffParticipantAsync(Guid exerciseId)
    {
        var id = Guid.NewGuid();
        await using var seed = _world.ReadContext();
        seed.Enrollments.Add(new Enrollment { Id = id, ExerciseId = exerciseId, PersonId = null, Role = "participant", CreatedAt = DateTimeOffset.UtcNow });
        await seed.SaveChangesAsync();
        return id;
    }
}
