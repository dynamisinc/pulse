namespace Pulse.WebApi.Tests.Features.Org.PeopleDirectory;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Credentials;
using Pulse.WebApi.Features.Org.PeopleDirectory;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Credentials;
using Xunit;

/// <summary>
/// #849 (Tier-2 isolation) — "invite this person": <c>POST /api/org/people/{personId}/invite {email}</c> through the REAL
/// <c>Program</c> pipeline against real SQL. A legacy directory person with no email on file (backfilled from
/// <c>StaffUser</c>) gets the email and the invite in ONE transaction, keeps their enrollments, and redeeming the invite
/// sets the password on THAT person — no duplicate is created. Covers the <c>(OrganizationId, Email)</c> unique index
/// (409 <c>email-in-use</c>), the differing-email refusal (409 <c>email-mismatch</c>), the email invite's reuse rules, the
/// foreign-organization bare 404, the role gate, the audit in the same unit of work, and no-store.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class OrgInviteByIdEndpointTests
{
    private static readonly Uri ResetUri = new(CredentialEndpoints.ResetRoute, UriKind.Relative);

    private readonly MsSqlContainerFixture _fixture;
    private readonly CredentialTestWorld _world;

    public OrgInviteByIdEndpointTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _world = new CredentialTestWorld(fixture);
    }

    [RequiresDockerFact]
    public async Task InviteById_OfALegacyPersonWithNoEmail_SetsTheEmailAndIssuesTheInvite_InOneUnitOfWork_AndKeepsTheirEnrollments()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var exercise = await _world.SeedExerciseAsync(org);
        var (admin, adminToken) = await SeedAdminAsync(org);
        var legacy = await SeedLegacyPersonAsync(org);
        await _world.SeedEnrollmentAsync(exercise, legacy, "controller");
        var email = $"Legacy.{Guid.NewGuid():N}@Example.com";

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var client = CredentialTestWorld.CreateClient(factory, adminToken);
        using var response = await InviteAsync(client, legacy, "  " + email + " ");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Headers.CacheControl?.NoStore.Should().BeTrue("the body carries a single-use credential link");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(["personId", "inviteUrl", "emailed", "created"]);
        body.GetProperty("personId").GetString().Should().Be(legacy.ToString(), "the invite targets the existing person");
        body.GetProperty("created").GetBoolean().Should().BeFalse("no person is created");
        body.GetProperty("emailed").GetBoolean().Should().BeFalse("email is off on a host without a mailer");
        var rawToken = OrgInviteEndpointTests.TokenOf(body.GetProperty("inviteUrl").GetString()!);

        await using (var read = _world.ReadContext())
        {
            var person = await read.People.AsNoTracking().SingleAsync(p => p.Id == legacy);
            person.Email.Should().Be(email.ToLowerInvariant(), "the email is set, normalized as sign-in looks it up");
            person.PasswordHash.Should().BeNull("no password until the invite is redeemed");
            (await read.People.AsNoTracking().CountAsync(p => p.OrganizationId == org && p.Email == person.Email))
                .Should().Be(1, "no duplicate person was created");
            (await read.Enrollments.IgnoreQueryFilters().AsNoTracking().CountAsync(e => e.PersonId == legacy && e.DeletedAt == null))
                .Should().Be(1, "the person keeps their enrollments");

            var token = await read.CredentialTokens.AsNoTracking().SingleAsync(t => t.PersonId == legacy);
            token.Purpose.Should().Be(CredentialTokenPurposes.Invite);
            token.IssuedByPersonId.Should().Be(admin, "admin-issued, exactly like the email invite");
            token.OrganizationId.Should().Be(org);

            var audit = await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking()
                .SingleAsync(a => a.SubjectPersonId == legacy && a.Kind == OrgInviteService.InviteIssuedKind);
            audit.OrganizationId.Should().Be(org);
            audit.ActorPersonId.Should().Be(admin);
            audit.Payload.Should().Contain("\"created\":false").And.Contain("\"emailSet\":true").And.NotContain(rawToken);
        }

        // Redeeming sets the password on THAT person (and the email invite now finds them by the address).
        using var anonymous = CredentialTestWorld.CreateClient(factory);
        using (var redeem = await anonymous.PostAsJsonAsync(ResetUri, new { token = rawToken, newPassword = CredentialTestWorld.NewPassword }))
        {
            redeem.StatusCode.Should().Be(HttpStatusCode.OK, "an invite answers its landing");
        }

        await using (var after = _world.ReadContext())
        {
            (await after.People.AsNoTracking().SingleAsync(p => p.Id == legacy)).PasswordHash.Should().NotBeNullOrEmpty();
        }

        factory.Logs.Messages.Should().NotContain(
            message => message.Contains(rawToken, StringComparison.Ordinal), "the invite token may never reach a log (NFR-009)");
    }

    [RequiresDockerFact]
    public async Task InviteById_ReInvitingTheSameAddress_VoidsTheEarlierInvite_AndLeavesTheEmailAsIs()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (_, adminToken) = await SeedAdminAsync(org);
        var legacy = await SeedLegacyPersonAsync(org);
        var email = $"twice.{Guid.NewGuid():N}@example.com";

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var client = CredentialTestWorld.CreateClient(factory, adminToken);
        using (var first = await InviteAsync(client, legacy, email))
        {
            first.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        using (var second = await InviteAsync(client, legacy, email.ToUpperInvariant()))
        {
            second.StatusCode.Should().Be(HttpStatusCode.OK, "the stored email equals the requested one (case-insensitively)");
        }

        await using var read = _world.ReadContext();
        var tokens = await read.CredentialTokens.AsNoTracking().Where(t => t.PersonId == legacy).ToListAsync();
        tokens.Should().HaveCount(2);
        tokens.Count(t => t.UsedAt == null).Should().Be(1, "issuing a new invite voids the earlier one");
        (await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking()
                .Where(a => a.SubjectPersonId == legacy && a.Kind == OrgInviteService.InviteIssuedKind)
                .Select(a => a.Payload)
                .ToListAsync())
            .Should().ContainSingle(p => p.Contains("\"emailSet\":false"), "the second invite set no email");
    }

    [RequiresDockerFact]
    public async Task InviteById_Refusals_WriteNothing()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (_, adminToken) = await SeedAdminAsync(org);
        var legacy = await SeedLegacyPersonAsync(org);
        var (_, takenEmail) = await _world.SeedPersonAsync(org);
        var (active, _) = await _world.SeedPersonAsync(org);
        var (disabled, _) = await _world.SeedPersonAsync(org, disabled: true);
        var (peerAdmin, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var otherAddress = await SeedInviteeAsync(org);

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var client = CredentialTestWorld.CreateClient(factory, adminToken);

        foreach (var body in new object[] { new { }, new { email = "not-an-email" }, new { email = "two@@example.com" } })
        {
            using var bad = await client.PostAsJsonAsync(InviteUri(legacy), body);
            bad.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await bad.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString().Should().Be(OrgInviteService.InvalidEmailError);
        }

        foreach (var (target, email, error) in new[]
        {
            (legacy, takenEmail, OrgInviteService.EmailInUseError),
            (otherAddress.Id, $"different.{Guid.NewGuid():N}@example.com", OrgInviteService.EmailMismatchError),
            (active, $"a.{Guid.NewGuid():N}@example.com", OrgInviteService.AlreadyActiveError),
            (disabled, $"d.{Guid.NewGuid():N}@example.com", OrgInviteService.PersonDisabledError),
            (peerAdmin, $"p.{Guid.NewGuid():N}@example.com", OrgInviteService.TargetIsOrgAdminError),
        })
        {
            using var response = await InviteAsync(client, target, email);
            response.StatusCode.Should().Be(HttpStatusCode.Conflict, "{0}", error);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString().Should().Be(error);
        }

        await using var read = _world.ReadContext();
        (await read.People.AsNoTracking().SingleAsync(p => p.Id == legacy)).Email.Should().BeNull(
            "the email-in-use refusal rolled the email back");
        (await read.People.AsNoTracking().SingleAsync(p => p.Id == otherAddress.Id)).Email.Should().Be(
            otherAddress.Email, "an address already on file is never changed");
        (await read.CredentialTokens.AsNoTracking().CountAsync(t => t.OrganizationId == org)).Should().Be(0, "no refusal issues a token");
        (await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking()
            .CountAsync(a => a.OrganizationId == org && a.Kind == OrgInviteService.InviteIssuedKind)).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task InviteById_OfAnotherCustomersPerson_IsTheSameBare404AsAMissingId_AndChangesNothing()
    {
        // The strongest foreign target: a legacy person in the other org who WOULD be invitable in their own org.
        var (org, _) = await _world.SeedOrganizationAsync();
        var (otherOrg, _) = await _world.SeedOrganizationAsync();
        var (_, adminToken) = await SeedAdminAsync(org);
        var foreign = await SeedLegacyPersonAsync(otherOrg);

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var client = CredentialTestWorld.CreateClient(factory, adminToken);
        using var foreignResponse = await InviteAsync(client, foreign, $"f.{Guid.NewGuid():N}@example.com");
        using var missing = await InviteAsync(client, Guid.NewGuid(), $"m.{Guid.NewGuid():N}@example.com");

        foreignResponse.StatusCode.Should().Be(HttpStatusCode.NotFound, "another customer's person");
        missing.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await foreignResponse.Content.ReadAsByteArrayAsync()).Should().Equal(
            await missing.Content.ReadAsByteArrayAsync(), "'exists elsewhere' must equal 'does not exist'");
        foreignResponse.Content.Headers.ContentType?.ToString().Should().Be(missing.Content.Headers.ContentType?.ToString());

        await using var read = _world.ReadContext();
        (await read.People.AsNoTracking().SingleAsync(p => p.Id == foreign)).Email.Should().BeNull("the foreign person was not touched");
        (await read.CredentialTokens.AsNoTracking().AnyAsync(t => t.PersonId == foreign)).Should().BeFalse();
        (await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking().CountAsync(a => a.OrganizationId == otherOrg))
            .Should().Be(0, "nothing was recorded in the other customer's organization");
    }

    [RequiresDockerFact]
    public async Task InviteById_IsOrgAdminOnly_OnAnOrgScopeSession_AndNeedsAFrontendBaseUrl()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var exercise = await _world.SeedExerciseAsync(org);
        var (_, adminToken) = await SeedAdminAsync(org);
        var (planner, _) = await _world.SeedPersonAsync(org);
        await _world.SeedEnrollmentAsync(exercise, planner, "planner");
        var (_, plannerToken, _) = await _world.SeedStaffSessionAsync(planner, exercise, "planner");
        var legacy = await SeedLegacyPersonAsync(org);
        var email = $"gate.{Guid.NewGuid():N}@example.com";

        await using (var factory = new CredentialProbeFactory(_fixture.ConnectionString!))
        {
            using var asPlanner = CredentialTestWorld.CreateClient(factory, plannerToken);
            using var refused = await InviteAsync(asPlanner, legacy, email);
            refused.StatusCode.Should().Be(HttpStatusCode.Forbidden, "a planner cannot invite people");
            refused.Headers.CacheControl?.NoStore.Should().BeTrue("no-store is on every answer of the route");

            using var anonymous = CredentialTestWorld.CreateClient(factory);
            using var unauthenticated = await InviteAsync(anonymous, legacy, email);
            unauthenticated.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        await using (var noBase = new CredentialProbeFactory(_fixture.ConnectionString!, frontendBaseUrl: null))
        {
            using var asAdmin = CredentialTestWorld.CreateClient(noBase, adminToken);
            using var unavailable = await InviteAsync(asAdmin, legacy, email);
            unavailable.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
            (await unavailable.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString()
                .Should().Be(OrgInviteService.LinkUnavailableError);
        }

        await using var read = _world.ReadContext();
        (await read.People.AsNoTracking().SingleAsync(p => p.Id == legacy)).Email.Should().BeNull("no refusal sets the email");
    }

    // ---------------------------------------------------------------- helpers

    private static Uri InviteUri(Guid personId) => new($"/api/org/people/{personId}/invite", UriKind.Relative);

    private static Task<HttpResponseMessage> InviteAsync(HttpClient client, Guid personId, string email) =>
        client.PostAsJsonAsync(InviteUri(personId), new { email });

    /// <summary>Seeds an enabled org admin (with a staff facet) and a live org-scope session; returns (id, token).</summary>
    private async Task<(Guid Id, string Token)> SeedAdminAsync(Guid org)
    {
        var (admin, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var (_, token, _) = await _world.SeedStaffSessionAsync(admin, exerciseId: null, Person.OrgAdminRole);
        return (admin, token);
    }

    /// <summary>A legacy allowlist staffer: a staff facet, NO email and NO Pulse password (the #849 shape).</summary>
    private async Task<Guid> SeedLegacyPersonAsync(Guid org)
    {
        var (id, _) = await _world.SeedPersonAsync(org);
        await using var context = _world.ReadContext();
        await context.People
            .IgnoreQueryFilters()
            .Where(p => p.Id == id)
            .ExecuteUpdateAsync(set => set.SetProperty(p => p.Email, (string?)null).SetProperty(p => p.PasswordHash, (string?)null));
        return id;
    }

    /// <summary>An invited person with an email on file and no password yet.</summary>
    private async Task<(Guid Id, string Email)> SeedInviteeAsync(Guid org)
    {
        var id = Guid.NewGuid();
        var email = $"invitee.{id:N}@example.com";
        await using var seed = _world.ReadContext();
        seed.People.Add(new Person { Id = id, OrganizationId = org, DisplayName = "Invitee", Email = email, CreatedAt = DateTimeOffset.UtcNow });
        await seed.SaveChangesAsync();
        return (id, email);
    }
}
