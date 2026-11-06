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
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Org.PeopleDirectory;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Credentials;
using Xunit;

/// <summary>
/// identity-auth-roles/20 "Invite" (#575b, Tier-2 isolation + security) through the REAL <c>Program</c> pipeline against
/// real SQL: <c>POST /api/org/people/invite</c> (org admin) and the invite's redemption on
/// <c>POST /api/auth/password/reset</c> — its "sign in" vs "awaiting assignment" landing (Copilot review 5 fold), and the
/// org sign-in that follows. Covers the Invite AC, the isolation AC (a foreign org's same-address person is never touched),
/// the audit replacement of the XC-004 AC (<c>org.invite.issued</c> / <c>org.invite.redeemed</c>), and NFR-009 (no token
/// or link in a log; no-store).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class OrgInviteEndpointTests
{
    private static readonly Uri InviteUri = new(OrgPeopleEndpoints.InviteRoute, UriKind.Relative);
    private static readonly Uri ResetUri = new(CredentialEndpoints.ResetRoute, UriKind.Relative);
    private static readonly Uri LoginUri = new("/api/auth/staff/login", UriKind.Relative);

    private readonly MsSqlContainerFixture _fixture;
    private readonly CredentialTestWorld _world;

    public OrgInviteEndpointTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _world = new CredentialTestWorld(fixture);
    }

    // ---------------------------------------------------------------- Issue

    [RequiresDockerFact]
    public async Task Invite_CreatesAPersonWithNoPasswordOrGrant_IssuesA7DayInvite_AuditsIt_AndReturnsTheLinkOnce_NoStore()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (admin, adminToken) = await SeedAdminAsync(org);
        var email = $"New.Staffer.{Guid.NewGuid():N}@Example.com";

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var client = CredentialTestWorld.CreateClient(factory, adminToken);
        using var response = await client.PostAsJsonAsync(InviteUri, new { email = "  " + email + " ", displayName = " Jordan Pace " });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Headers.CacheControl?.NoStore.Should().BeTrue("the body carries a single-use credential link");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(["personId", "inviteUrl", "emailed", "created"]);
        body.GetProperty("created").GetBoolean().Should().BeTrue();
        body.GetProperty("emailed").GetBoolean().Should().BeFalse("email is off on a host without a mailer");
        var inviteUrl = body.GetProperty("inviteUrl").GetString()!;
        inviteUrl.Should().StartWith($"{CredentialTestWorld.FrontendBaseUrl}{OrgInviteService.StaffInvitePath}#token=",
            "the token rides in the URL fragment, which never reaches a server log");
        var rawToken = TokenOf(inviteUrl);
        var personId = Guid.Parse(body.GetProperty("personId").GetString()!);

        await using var read = _world.ReadContext();
        var person = await read.People.AsNoTracking().SingleAsync(p => p.Id == personId);
        person.OrganizationId.Should().Be(org, "created in the caller's OWN organization");
        person.Email.Should().Be(email.ToLowerInvariant(), "the same normalization sign-in looks people up by");
        person.DisplayName.Should().Be("Jordan Pace");
        person.PasswordHash.Should().BeNull();
        person.OrgRole.Should().BeNull("an invite grants nothing");
        (await read.StaffUsers.AsNoTracking().AnyAsync(u => u.Id == personId)).Should().BeFalse("no grant, so no staff facet yet");

        var token = await read.CredentialTokens.AsNoTracking().SingleAsync(t => t.PersonId == personId);
        token.Purpose.Should().Be(CredentialTokenPurposes.Invite);
        token.TokenHash.Should().Be(SessionTokens.Hash(rawToken), "only the hash is stored");
        token.IssuedByPersonId.Should().Be(admin, "an admin-delivered link is never a null-issuer token");
        token.OrganizationId.Should().Be(org);
        (token.ExpiresAt - token.CreatedAt).Should().Be(CredentialTokenService.InviteLifetime);

        var audit = await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(a => a.SubjectPersonId == personId && a.Kind == OrgInviteService.InviteIssuedKind);
        audit.OrganizationId.Should().Be(org);
        audit.ActorPersonId.Should().Be(admin);
        audit.ExerciseId.Should().BeNull();
        audit.Payload.Should().Contain("\"created\":true").And.NotContain(rawToken);

        factory.Logs.Messages.Should().NotContain(
            message => message.Contains(rawToken, StringComparison.Ordinal),
            "the invite token may never reach a log (NFR-009)");
    }

    [RequiresDockerFact]
    public async Task Reinvite_OfAPersonWithNoPasswordYet_ReusesThePerson_AndVoidsTheEarlierInvite()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (_, adminToken) = await SeedAdminAsync(org);
        var email = $"again.{Guid.NewGuid():N}@example.com";

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var client = CredentialTestWorld.CreateClient(factory, adminToken);
        var first = await InviteOkAsync(client, email, "First Name");
        var second = await InviteOkAsync(client, email, "Ignored Second Name");

        second.GetProperty("created").GetBoolean().Should().BeFalse();
        second.GetProperty("personId").GetString().Should().Be(first.GetProperty("personId").GetString());

        var personId = Guid.Parse(first.GetProperty("personId").GetString()!);
        await using (var read = _world.ReadContext())
        {
            (await read.People.AsNoTracking().SingleAsync(p => p.Id == personId)).DisplayName.Should().Be("First Name",
                "a re-invite does not rename the person");
            var tokens = await read.CredentialTokens.AsNoTracking().Where(t => t.PersonId == personId).ToListAsync();
            tokens.Should().HaveCount(2);
            tokens.Count(t => t.UsedAt == null).Should().Be(1, "issuing a new invite voids the earlier one");
        }

        using var anonymous = CredentialTestWorld.CreateClient(factory);
        using var stale = await anonymous.PostAsJsonAsync(ResetUri, new { token = TokenOf(first), newPassword = CredentialTestWorld.NewPassword });
        stale.StatusCode.Should().Be(HttpStatusCode.BadRequest, "the first link is void");
        (await stale.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString()
            .Should().Be(PasswordResetService.InvalidTokenError);
    }

    [RequiresDockerFact]
    public async Task Invite_Refusals_400ForABadBody_409ForAnActiveDisabledOrPeerAdminPerson_AndWriteNothing()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (_, adminToken) = await SeedAdminAsync(org);
        var (_, activeEmail) = await _world.SeedPersonAsync(org);
        var (_, disabledEmail) = await _world.SeedPersonAsync(org, disabled: true);
        var (_, peerAdminEmail) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var client = CredentialTestWorld.CreateClient(factory, adminToken);

        foreach (var (body, error) in new (object? Body, string Error)[]
        {
            (new { }, OrgInviteService.InvalidEmailError),
            (new { email = "not-an-email", displayName = "X" }, OrgInviteService.InvalidEmailError),
            (new { email = "two@@example.com", displayName = "X" }, OrgInviteService.InvalidEmailError),
            (new { email = "ok@example.com" }, OrgInviteService.InvalidDisplayNameError),
            (new { email = "ok@example.com", displayName = "   " }, OrgInviteService.InvalidDisplayNameError),
            (new { email = "ok@example.com", displayName = new string('n', Person.MaxDisplayNameLength + 1) }, OrgInviteService.InvalidDisplayNameError),
        })
        {
            using var response = await client.PostAsJsonAsync(InviteUri, body);
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString().Should().Be(error);
        }

        foreach (var (email, error) in new[]
        {
            (activeEmail, OrgInviteService.AlreadyActiveError),
            (disabledEmail, OrgInviteService.PersonDisabledError),
            (peerAdminEmail, OrgInviteService.TargetIsOrgAdminError),
        })
        {
            using var response = await client.PostAsJsonAsync(InviteUri, new { email, displayName = "Someone" });
            response.StatusCode.Should().Be(HttpStatusCode.Conflict, "{0}", error);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString().Should().Be(error);
        }

        await using var read = _world.ReadContext();
        (await read.CredentialTokens.AsNoTracking().CountAsync(t => t.OrganizationId == org)).Should().Be(0, "no refusal issues a token");
        (await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking()
            .CountAsync(a => a.OrganizationId == org && a.Kind == OrgInviteService.InviteIssuedKind)).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task Invite_OfAnAddressThatExistsInAnotherOrg_CreatesASeparatePersonInTheCallersOrg_AndNeverTouchesTheForeignOne()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (otherOrg, _) = await _world.SeedOrganizationAsync();
        var (_, adminToken) = await SeedAdminAsync(org);
        var (foreignPerson, sharedEmail) = await _world.SeedPersonAsync(otherOrg);

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var client = CredentialTestWorld.CreateClient(factory, adminToken);
        var body = await InviteOkAsync(client, sharedEmail, "Same Address");

        body.GetProperty("created").GetBoolean().Should().BeTrue("the foreign person is invisible: a different tenant, a different person");
        var personId = Guid.Parse(body.GetProperty("personId").GetString()!);
        personId.Should().NotBe(foreignPerson);

        await using var read = _world.ReadContext();
        (await read.People.AsNoTracking().SingleAsync(p => p.Id == personId)).OrganizationId.Should().Be(org);
        (await read.CredentialTokens.AsNoTracking().AnyAsync(t => t.PersonId == foreignPerson))
            .Should().BeFalse("nothing is ever issued for another customer's person");
    }

    [RequiresDockerFact]
    public async Task Invite_IsOrgAdminOnly_OnAnOrgScopeSession_AndNeedsAFrontendBaseUrl()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var exercise = await _world.SeedExerciseAsync(org);
        var (_, adminToken) = await SeedAdminAsync(org);
        var (planner, _) = await _world.SeedPersonAsync(org);
        await _world.SeedEnrollmentAsync(exercise, planner, "planner");
        var (_, plannerToken, _) = await _world.SeedStaffSessionAsync(planner, exercise, "planner");
        var body = new { email = $"gate.{Guid.NewGuid():N}@example.com", displayName = "Gate" };

        await using (var factory = new CredentialProbeFactory(_fixture.ConnectionString!))
        {
            using var asPlanner = CredentialTestWorld.CreateClient(factory, plannerToken);
            using var refused = await asPlanner.PostAsJsonAsync(InviteUri, body);
            refused.StatusCode.Should().Be(HttpStatusCode.Forbidden, "a planner cannot add people to the organization");
            refused.Headers.CacheControl?.NoStore.Should().BeTrue("no-store is on every answer of the route");

            using var anonymous = CredentialTestWorld.CreateClient(factory);
            using var unauthenticated = await anonymous.PostAsJsonAsync(InviteUri, body);
            unauthenticated.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        await using (var noBase = new CredentialProbeFactory(_fixture.ConnectionString!, frontendBaseUrl: null))
        {
            using var asAdmin = CredentialTestWorld.CreateClient(noBase, adminToken);
            using var unavailable = await asAdmin.PostAsJsonAsync(InviteUri, body);
            unavailable.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
            (await unavailable.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString()
                .Should().Be(OrgInviteService.LinkUnavailableError);
        }

        await using var read = _world.ReadContext();
        (await read.People.AsNoTracking().AnyAsync(p => p.Email == body.email)).Should().BeFalse("no refusal creates the person");
    }

    // ---------------------------------------------------------------- Redeem (Copilot review 5 fold)

    [RequiresDockerFact]
    public async Task Redeem_WithNoGrant_SetsThePassword_AnswersAwaitingAssignment_AndSignInWorksOnlyOnceAssigned()
    {
        var (org, slug) = await _world.SeedOrganizationAsync();
        var exercise = await _world.SeedExerciseAsync(org);
        var (_, adminToken) = await SeedAdminAsync(org);
        var email = $"awaiting.{Guid.NewGuid():N}@example.com";

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var asAdmin = CredentialTestWorld.CreateClient(factory, adminToken);
        var invite = await InviteOkAsync(asAdmin, email, "Awaiting Person");
        var personId = Guid.Parse(invite.GetProperty("personId").GetString()!);
        var rawToken = TokenOf(invite);

        using var anonymous = CredentialTestWorld.CreateClient(factory);
        using (var redeem = await anonymous.PostAsJsonAsync(ResetUri, new { token = rawToken, newPassword = CredentialTestWorld.NewPassword }))
        {
            redeem.StatusCode.Should().Be(HttpStatusCode.OK, "an invite answers its landing");
            redeem.Headers.CacheControl?.NoStore.Should().BeTrue();
            var landing = await redeem.Content.ReadFromJsonAsync<JsonElement>();
            landing.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(["next", "orgSlug", "email"]);
            landing.GetProperty("next").GetString().Should().Be(InviteLanding.AwaitingAssignmentNext);
            landing.GetProperty("orgSlug").GetString().Should().Be(slug);
            landing.GetProperty("email").GetString().Should().Be(email);
        }

        await using (var read = _world.ReadContext())
        {
            var person = await read.People.AsNoTracking().SingleAsync(p => p.Id == personId);
            person.PasswordHash.Should().NotBeNullOrEmpty("the password is set even with no grant");
            var kinds = await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking()
                .Where(a => a.SubjectPersonId == personId).Select(a => a.Kind).ToListAsync();
            kinds.Should().Contain([PasswordResetService.CredentialChangedKind, PasswordResetService.InviteRedeemedKind, OrgInviteService.InviteIssuedKind]);
            (await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking()
                .SingleAsync(a => a.SubjectPersonId == personId && a.Kind == PasswordResetService.InviteRedeemedKind))
                .Payload.Should().Contain(InviteLanding.AwaitingAssignmentNext).And.NotContain(rawToken);
        }

        using (var early = await anonymous.PostAsJsonAsync(LoginUri, new { orgSlug = slug, email, password = CredentialTestWorld.NewPassword }))
        {
            early.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "no grant yet: the uniform sign-in refusal");
        }

        // An org admin assigns them (the #575a route creates the enrollment and the staff facet); sign-in then works.
        using (var grant = await asAdmin.PostAsJsonAsync(
            new Uri($"/api/org/exercises/{exercise}/enrollments", UriKind.Relative), new { personId, role = "controller" }))
        {
            grant.IsSuccessStatusCode.Should().BeTrue("the org admin assigns the invitee: {0}", grant.StatusCode);
        }

        using (var signIn = await anonymous.PostAsJsonAsync(LoginUri, new { orgSlug = slug, email, password = CredentialTestWorld.NewPassword }))
        {
            signIn.StatusCode.Should().Be(HttpStatusCode.OK, "assigned: the ordinary sign-in now mints a session");
        }

        factory.Logs.Messages.Should().NotContain(
            message => message.Contains(rawToken, StringComparison.Ordinal)
                || message.Contains(CredentialTestWorld.NewPassword, StringComparison.Ordinal),
            "neither the token nor the password may reach a log (NFR-009)");
    }

    [RequiresDockerFact]
    public async Task Redeem_WithAGrant_AnswersSignIn_AndTheOrgSignInThenMintsASession()
    {
        var (org, slug) = await _world.SeedOrganizationAsync();
        var exercise = await _world.SeedExerciseAsync(org);
        var (_, adminToken) = await SeedAdminAsync(org);
        var email = $"granted.{Guid.NewGuid():N}@example.com";

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var asAdmin = CredentialTestWorld.CreateClient(factory, adminToken);
        var invite = await InviteOkAsync(asAdmin, email, "Granted Person");
        var personId = Guid.Parse(invite.GetProperty("personId").GetString()!);

        // Assigned BEFORE they redeem (the usual order: invite, assign, then the person opens the link).
        using (var grant = await asAdmin.PostAsJsonAsync(
            new Uri($"/api/org/exercises/{exercise}/enrollments", UriKind.Relative), new { personId, role = "evaluator" }))
        {
            grant.IsSuccessStatusCode.Should().BeTrue("the org admin assigns the invitee: {0}", grant.StatusCode);
        }

        using var anonymous = CredentialTestWorld.CreateClient(factory);
        using (var redeem = await anonymous.PostAsJsonAsync(ResetUri, new { token = TokenOf(invite), newPassword = CredentialTestWorld.NewPassword }))
        {
            redeem.StatusCode.Should().Be(HttpStatusCode.OK);
            var landing = await redeem.Content.ReadFromJsonAsync<JsonElement>();
            landing.GetProperty("next").GetString().Should().Be(InviteLanding.SignInNext);
            landing.GetProperty("orgSlug").GetString().Should().Be(slug);
        }

        using var signIn = await anonymous.PostAsJsonAsync(LoginUri, new { orgSlug = slug, email, password = CredentialTestWorld.NewPassword });
        signIn.StatusCode.Should().Be(HttpStatusCode.OK, "the landing said sign in, and the ordinary org sign-in agrees");
        (await signIn.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString().Should().NotBeNullOrEmpty();
    }

    [RequiresDockerFact]
    public async Task Redeem_OfARevokedOnlyEnrollment_IsAwaitingAssignment_BecauseEveryEnrollmentReadIsActiveOnly()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var exercise = await _world.SeedExerciseAsync(org);
        var (_, adminToken) = await SeedAdminAsync(org);

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var asAdmin = CredentialTestWorld.CreateClient(factory, adminToken);
        var invite = await InviteOkAsync(asAdmin, $"revoked.{Guid.NewGuid():N}@example.com", "Revoked Person");
        var personId = Guid.Parse(invite.GetProperty("personId").GetString()!);
        await SeedFacetAsync(personId, org);
        await _world.SeedEnrollmentAsync(exercise, personId, "controller", deletedAt: DateTimeOffset.UtcNow.AddMinutes(-1));

        using var anonymous = CredentialTestWorld.CreateClient(factory);
        using var redeem = await anonymous.PostAsJsonAsync(ResetUri, new { token = TokenOf(invite), newPassword = CredentialTestWorld.NewPassword });
        redeem.StatusCode.Should().Be(HttpStatusCode.OK);
        (await redeem.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("next").GetString()
            .Should().Be(InviteLanding.AwaitingAssignmentNext, "a soft-deleted enrollment is no grant");
    }

    [RequiresDockerFact]
    public async Task Redeem_OfAnInviteIssuedInTheSameInstantAsTheLastPasswordChange_IsNotStale()
    {
        // #575b IsStaleFor fix: a token staged in the same unit of work as a password change carries exactly
        // PasswordChangedAt. The tie is fresh.
        var (org, _) = await _world.SeedOrganizationAsync();
        var (person, _) = await _world.SeedPersonAsync(org);
        var instant = DateTimeOffset.UtcNow.AddMinutes(-1);
        await using (var seed = _world.ReadContext())
        {
            var row = await seed.People.SingleAsync(p => p.Id == person);
            row.PasswordChangedAt = instant;
            await seed.SaveChangesAsync();
        }

        var issued = await _world.IssueAsync(CredentialTokenPurposes.Invite, person, org, now: instant);

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var anonymous = CredentialTestWorld.CreateClient(factory);
        using var redeem = await anonymous.PostAsJsonAsync(ResetUri, new { token = issued.RawToken, newPassword = CredentialTestWorld.NewPassword });
        redeem.StatusCode.Should().Be(HttpStatusCode.OK, "CreatedAt == PasswordChangedAt is the same instant, not an older credential");
    }

    [RequiresDockerFact]
    public async Task Redeem_OfAResetToken_StillAnswers204_WithNoLanding()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (person, _) = await _world.SeedPersonAsync(org);
        var (admin, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var issued = await _world.IssueAsync(CredentialTokenPurposes.Reset, person, org, issuedBy: admin);

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var anonymous = CredentialTestWorld.CreateClient(factory);
        using var redeem = await anonymous.PostAsJsonAsync(ResetUri, new { token = issued.RawToken, newPassword = CredentialTestWorld.NewPassword });
        redeem.StatusCode.Should().Be(HttpStatusCode.NoContent, "the reset contract is unchanged");
    }

    // ---------------------------------------------------------------- helpers

    internal static string TokenOf(string url) => url[(url.IndexOf("#token=", StringComparison.Ordinal) + "#token=".Length)..];

    private static string TokenOf(JsonElement invite) => TokenOf(invite.GetProperty("inviteUrl").GetString()!);

    private static async Task<JsonElement> InviteOkAsync(HttpClient client, string email, string displayName)
    {
        using var response = await client.PostAsJsonAsync(InviteUri, new { email, displayName });
        response.StatusCode.Should().Be(HttpStatusCode.OK, "inviting {0}", email);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    /// <summary>Seeds an enabled org admin (with a staff facet) and a live org-scope session; returns (id, token).</summary>
    private async Task<(Guid Id, string Token)> SeedAdminAsync(Guid org)
    {
        var (admin, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var (_, token, _) = await _world.SeedStaffSessionAsync(admin, exerciseId: null, Person.OrgAdminRole);
        return (admin, token);
    }

    private async Task SeedFacetAsync(Guid personId, Guid org)
    {
        await using var seed = _world.ReadContext();
        seed.StaffUsers.Add(new StaffUser
        {
            Id = personId,
            OrganizationId = org,
            ExternalSubject = $"pulse|{personId:N}",
            DisplayName = "Facet",
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
    }
}
