namespace Pulse.WebApi.Tests.Features.Identity.Credentials;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Credentials;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// identity-auth-roles/21 (#576, Tier-2) — the two credential routes through the REAL <c>Program</c> pipeline against real
/// SQL: <c>POST /api/auth/password/reset</c> (pre-auth) and <c>POST /api/org/people/{personId}/password-reset</c> (org
/// admin). Covers AC "Reset", "Admin reset" (the staff half), "Cache-Control: no-store", "Tokens are stored only as
/// SHA-256 hashes", the Copilot-5 credential-change rule, and the isolation AC (foreign-org bare 404).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class CredentialEndpointsHttpTests
{
    /// <summary>
    /// How to call each allow-listed PERSON-id org route. Must cover <see cref="CredentialEndpoints.PersonIdRoutes"/>
    /// exactly, which <c>CompositionRootWiringTests</c> asserts (a plain fact, outside this SQL collection).
    /// </summary>
    internal static readonly IReadOnlyDictionary<(string Method, string Route), Func<HttpClient, Guid, Task<HttpResponseMessage>>> PersonIdCallers =
        new Dictionary<(string Method, string Route), Func<HttpClient, Guid, Task<HttpResponseMessage>>>
        {
            [("POST", CredentialEndpoints.AdminResetRoute)] = (client, id) =>
                client.PostAsync(new Uri($"/api/org/people/{id}/password-reset", UriKind.Relative), content: null),
        };

    private static readonly Uri ResetUri = new(CredentialEndpoints.ResetRoute, UriKind.Relative);

    private readonly MsSqlContainerFixture _fixture;
    private readonly CredentialTestWorld _world;

    public CredentialEndpointsHttpTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _world = new CredentialTestWorld(fixture);
    }

    [RequiresDockerFact]
    public async Task AdminReset_ByAnOrgAdmin_ReturnsTheLinkOnce_NoStore_StoresOnlyTheHash_AndAudits()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (admin, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var (_, adminToken, _) = await _world.SeedStaffSessionAsync(admin, exerciseId: null, Person.OrgAdminRole);
        var (target, _) = await _world.SeedPersonAsync(org);

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var client = CredentialTestWorld.CreateClient(factory, adminToken);

        using var response = await PersonIdCallers.Single().Value(client, target);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Headers.CacheControl?.NoStore.Should().BeTrue("the body carries a single-use credential link");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(["resetUrl"], "the response is exactly { resetUrl }");
        var resetUrl = body.GetProperty("resetUrl").GetString()!;
        resetUrl.Should().StartWith($"{CredentialTestWorld.FrontendBaseUrl}/staff/reset#token=", "the token rides in the fragment");
        var rawToken = resetUrl[(resetUrl.IndexOf("#token=", StringComparison.Ordinal) + "#token=".Length)..];
        rawToken.Length.Should().BeGreaterThanOrEqualTo(43, "32 random bytes, base64url");

        await using var read = _world.ReadContext();
        var stored = await read.CredentialTokens.AsNoTracking().SingleAsync(t => t.PersonId == target);
        stored.TokenHash.Should().Be(SessionTokens.Hash(rawToken), "only the SHA-256 of the token is stored");
        stored.TokenHash.Should().NotContain(rawToken);
        stored.Purpose.Should().Be(CredentialTokenPurposes.Reset);
        stored.OrganizationId.Should().Be(org);
        stored.IssuedByPersonId.Should().Be(admin);
        (stored.ExpiresAt - stored.CreatedAt).Should().Be(TimeSpan.FromMinutes(60), "a reset link lives 60 minutes");

        var audit = await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(a => a.SubjectPersonId == target && a.Kind == AdminPasswordResetService.ResetIssuedKind);
        audit.OrganizationId.Should().Be(org);
        audit.ActorPersonId.Should().Be(admin);
        audit.Payload.Should().NotContain(rawToken).And.NotContain("http", "the audit never carries the link");

        factory.Logs.Messages.Should().NotContain(
            message => message.Contains(rawToken, StringComparison.Ordinal),
            "neither the token nor the link may reach a log (NFR-009)");
    }

    [RequiresDockerFact]
    public async Task AdminReset_ForAnotherCustomersPerson_IsTheSameBare404AsAMissingId_AndIssuesNothing()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (otherOrg, _) = await _world.SeedOrganizationAsync();
        var (admin, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var (_, adminToken, _) = await _world.SeedStaffSessionAsync(admin, exerciseId: null, Person.OrgAdminRole);
        var (foreignPerson, _) = await _world.SeedPersonAsync(otherOrg);
        var (ownPerson, _) = await _world.SeedPersonAsync(org);

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var client = CredentialTestWorld.CreateClient(factory, adminToken);

        foreach (var (route, call) in PersonIdCallers)
        {
            using var foreign = await call(client, foreignPerson);
            using var missing = await call(client, Guid.NewGuid());

            foreign.StatusCode.Should().Be(HttpStatusCode.NotFound, "{0}: another customer's person", route);
            missing.StatusCode.Should().Be(HttpStatusCode.NotFound);
            (await foreign.Content.ReadAsByteArrayAsync()).Should().Equal(
                await missing.Content.ReadAsByteArrayAsync(),
                "{0}: the body must not distinguish 'exists elsewhere' from 'does not exist'",
                route);
            foreign.Content.Headers.ContentType?.ToString().Should().Be(missing.Content.Headers.ContentType?.ToString());

            await using var read = _world.ReadContext();
            (await read.CredentialTokens.AsNoTracking().CountAsync(t => t.PersonId == foreignPerson)).Should().Be(
                0, "{0}: nothing was issued for the other customer's person", route);
            (await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking().CountAsync(a => a.OrganizationId == otherOrg))
                .Should().Be(0, "{0}: nothing was recorded in the other customer's organization", route);

            // Positive control: the caller's OWN person is not a 404, so the 404 above is the tenant bound.
            using var own = await call(client, ownPerson);
            own.StatusCode.Should().Be(HttpStatusCode.OK, "{0} on a person of the caller's own organization", route);
        }
    }

    [RequiresDockerFact]
    public async Task AdminReset_IsRefusedToAPlanner_AndToAnAnonymousCaller_AndConflictsForADisabledPerson()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var exercise = await _world.SeedExerciseAsync(org);
        var (planner, _) = await _world.SeedPersonAsync(org);
        await _world.SeedEnrollmentAsync(exercise, planner, "planner");
        var (_, plannerToken, _) = await _world.SeedStaffSessionAsync(planner, exercise, "planner");
        var (admin, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var (_, adminToken, _) = await _world.SeedStaffSessionAsync(admin, exerciseId: null, Person.OrgAdminRole);
        var (target, _) = await _world.SeedPersonAsync(org);
        var (disabled, _) = await _world.SeedPersonAsync(org, disabled: true);

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        var call = PersonIdCallers.Single().Value;

        using (var asPlanner = CredentialTestWorld.CreateClient(factory, plannerToken))
        using (var response = await call(asPlanner, target))
        {
            response.StatusCode.Should().Be(HttpStatusCode.Forbidden, "staff resets are the org admin's alone (§3.3)");
            response.Headers.CacheControl?.NoStore.Should().BeTrue("no-store is on every answer of the route");
        }

        using (var anonymous = CredentialTestWorld.CreateClient(factory))
        using (var response = await call(anonymous, target))
        {
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "the route is not pre-auth");
        }

        using (var asAdmin = CredentialTestWorld.CreateClient(factory, adminToken))
        using (var response = await call(asAdmin, disabled))
        {
            response.StatusCode.Should().Be(HttpStatusCode.Conflict);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString()
                .Should().Be(AdminPasswordResetService.PersonDisabledError);
        }

        await using var read = _world.ReadContext();
        (await read.CredentialTokens.AsNoTracking().CountAsync(t => t.PersonId == target || t.PersonId == disabled))
            .Should().Be(0, "no refused call issued a token");
    }

    [RequiresDockerFact]
    public async Task AdminReset_WithoutAFrontendBaseUrl_Is503_AndIssuesNothing()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (admin, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var (_, adminToken, _) = await _world.SeedStaffSessionAsync(admin, exerciseId: null, Person.OrgAdminRole);
        var (target, _) = await _world.SeedPersonAsync(org);

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!, frontendBaseUrl: null);
        using var client = CredentialTestWorld.CreateClient(factory, adminToken);

        using var response = await PersonIdCallers.Single().Value(client, target);

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString()
            .Should().Be(AdminPasswordResetService.LinkUnavailableError);
        await using var read = _world.ReadContext();
        (await read.CredentialTokens.AsNoTracking().CountAsync(t => t.PersonId == target)).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task Reset_FromAnAdminIssuedLink_SetsThePassword_SignsInWithIt_AndRevokesEveryLiveSession()
    {
        var (org, slug) = await _world.SeedOrganizationAsync();
        var exercise = await _world.SeedExerciseAsync(org);
        var (admin, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var (_, adminToken, _) = await _world.SeedStaffSessionAsync(admin, exerciseId: null, Person.OrgAdminRole);
        var (target, email) = await _world.SeedPersonAsync(org);
        await _world.SeedEnrollmentAsync(exercise, target, "controller");
        var (staffSession, staffToken, staffRefresh) = await _world.SeedStaffSessionAsync(target, exercise, "controller");
        var otherExercise = await _world.SeedExerciseAsync(org);
        await _world.SeedEnrollmentAsync(otherExercise, target, "evaluator");
        var (secondSession, _, _) = await _world.SeedStaffSessionAsync(target, otherExercise, "evaluator");

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        string rawToken;
        using (var asAdmin = CredentialTestWorld.CreateClient(factory, adminToken))
        using (var issued = await PersonIdCallers.Single().Value(asAdmin, target))
        {
            var url = (await issued.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("resetUrl").GetString()!;
            rawToken = url[(url.IndexOf("#token=", StringComparison.Ordinal) + "#token=".Length)..];
        }

        using var anonymous = CredentialTestWorld.CreateClient(factory);
        using var reset = await anonymous.PostAsJsonAsync(ResetUri, new { token = rawToken, newPassword = CredentialTestWorld.NewPassword });

        reset.StatusCode.Should().Be(HttpStatusCode.NoContent, "pre-auth: no session is presented");
        reset.Headers.CacheControl?.NoStore.Should().BeTrue();

        await using (var read = _world.ReadContext())
        {
            var person = await read.People.AsNoTracking().SingleAsync(p => p.Id == target);
            new PasswordHasher<Person>().VerifyHashedPassword(person, person.PasswordHash!, CredentialTestWorld.NewPassword)
                .Should().NotBe(PasswordVerificationResult.Failed, "the SAME PasswordHasher<Person> sign-in uses");
            person.PasswordChangedAt.Should().NotBeNull();
            (await read.Sessions.AsNoTracking().Where(s => s.Id == staffSession || s.Id == secondSession).ToListAsync())
                .Should().OnlyContain(s => s.RevokedAt != null, "every live session of the person is revoked");
            (await read.Sessions.AsNoTracking().Where(s => s.PersonId == admin).ToListAsync())
                .Should().OnlyContain(s => s.RevokedAt == null, "nobody else's session is touched");
            (await read.CredentialTokens.AsNoTracking().SingleAsync(t => t.PersonId == target)).UsedAt.Should().NotBeNull();

            var audit = await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking()
                .SingleAsync(a => a.SubjectPersonId == target && a.Kind == PasswordResetService.CredentialChangedKind);
            audit.OrganizationId.Should().Be(org);
            audit.ActorPersonId.Should().Be(target);
            audit.ExerciseId.Should().BeNull();
            audit.Payload.Should().Contain("\"sessionsRevoked\":2").And.NotContain(rawToken).And.NotContain(CredentialTestWorld.NewPassword);
        }

        // The old access and refresh tokens are dead; the new password signs in through the real org sign-in.
        using (var oldSession = CredentialTestWorld.CreateClient(factory, staffToken))
        using (var probe = await oldSession.GetAsync(new Uri("/api/session", UriKind.Relative)))
        {
            probe.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "the pre-reset access token no longer authenticates");
        }

        using (var refresh = await anonymous.PostAsJsonAsync(new Uri("/api/auth/refresh", UriKind.Relative), new { refreshToken = staffRefresh }))
        {
            refresh.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "the pre-reset refresh token cannot mint a replacement");
        }

        using (var oldLogin = await anonymous.PostAsJsonAsync(new Uri("/api/auth/staff/login", UriKind.Relative), new { orgSlug = slug, email, password = CredentialTestWorld.OldPassword }))
        {
            oldLogin.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "the old password is gone");
        }

        using (var newLogin = await anonymous.PostAsJsonAsync(new Uri("/api/auth/staff/login", UriKind.Relative), new { orgSlug = slug, email, password = CredentialTestWorld.NewPassword }))
        {
            newLogin.StatusCode.Should().Be(HttpStatusCode.OK, "the new password verifies through the same hasher sign-in uses");
        }

        factory.Logs.Messages.Should().NotContain(
            message => message.Contains(rawToken, StringComparison.Ordinal)
                || message.Contains(CredentialTestWorld.NewPassword, StringComparison.Ordinal),
            "neither the token nor the password may reach a log (NFR-009)");
    }

    [RequiresDockerFact]
    public async Task Reset_VoidsTheOlderInvite_TheOlderResetLink_AndTheOlderOrgChoice()
    {
        // Copilot review 5 fold: a credential change invalidates, in the same transaction, every outstanding token of
        // BOTH purposes and every unconsumed org-choice candidate. Each older artefact is then redeemed: all three fail.
        var (org, slug) = await _world.SeedOrganizationAsync();
        var (target, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var olderInvite = await _world.IssueAsync(CredentialTokenPurposes.Invite, target, org);
        var olderReset = await _world.IssueAsync(CredentialTokenPurposes.Reset, target, org, DateTimeOffset.UtcNow.AddMinutes(-5));
        var choiceToken = await _world.SeedOrgChoiceAsync(target, org);

        // The newest reset voids the older RESET at issue (same purpose) — but not the invite, which only the
        // credential change voids.
        var newestReset = await _world.IssueAsync(CredentialTokenPurposes.Reset, target, org);
        await using (var read = _world.ReadContext())
        {
            (await read.CredentialTokens.AsNoTracking().SingleAsync(t => t.Id == olderReset.Token.Id)).UsedAt.Should().NotBeNull();
            (await read.CredentialTokens.AsNoTracking().SingleAsync(t => t.Id == olderInvite.Token.Id)).UsedAt.Should().BeNull();
        }

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var anonymous = CredentialTestWorld.CreateClient(factory);

        using (var reset = await anonymous.PostAsJsonAsync(ResetUri, new { token = newestReset.RawToken, newPassword = CredentialTestWorld.NewPassword }))
        {
            reset.StatusCode.Should().Be(HttpStatusCode.NoContent);
        }

        foreach (var (label, raw) in new[] { ("older invite", olderInvite.RawToken), ("older reset", olderReset.RawToken) })
        {
            using var replay = await anonymous.PostAsJsonAsync(ResetUri, new { token = raw, newPassword = "another-fine-sentence-42" });
            replay.StatusCode.Should().Be(HttpStatusCode.BadRequest, "the {0} link is void after the credential change", label);
            (await replay.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString().Should().Be(PasswordResetService.InvalidTokenError);
        }

        using (var choose = await anonymous.PostAsJsonAsync(new Uri("/api/auth/staff/login/choose", UriKind.Relative), new { choiceToken, orgSlug = slug }))
        {
            choose.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "an org choice verified against the old password cannot mint a session");
        }

        await using var after = _world.ReadContext();
        (await after.CredentialTokens.AsNoTracking().Where(t => t.PersonId == target).ToListAsync())
            .Should().OnlyContain(t => t.UsedAt != null, "no token of either purpose is outstanding");
        (await after.LoginChoiceCandidates.AsNoTracking().CountAsync(c => c.PersonId == target))
            .Should().Be(0, "the unconsumed org-choice candidate was removed in the reset's own transaction");
        new PasswordHasher<Person>().VerifyHashedPassword(
                await after.People.AsNoTracking().SingleAsync(p => p.Id == target),
                (await after.People.AsNoTracking().SingleAsync(p => p.Id == target)).PasswordHash!,
                CredentialTestWorld.NewPassword)
            .Should().NotBe(PasswordVerificationResult.Failed, "neither replay changed the password");
    }

    [RequiresDockerFact]
    public async Task Reset_WithAnUnknownExpiredUsedOrMissingToken_IsOneUniform400()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (target, _) = await _world.SeedPersonAsync(org);
        var expired = await _world.IssueAsync(CredentialTokenPurposes.Reset, target, org, DateTimeOffset.UtcNow.AddHours(-2));
        var used = await _world.IssueAsync(CredentialTokenPurposes.Invite, target, org);

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var anonymous = CredentialTestWorld.CreateClient(factory);
        using (var first = await anonymous.PostAsJsonAsync(ResetUri, new { token = used.RawToken, newPassword = CredentialTestWorld.NewPassword }))
        {
            first.StatusCode.Should().Be(HttpStatusCode.NoContent, "an invite token sets the password too (precondition: now used)");
        }

        var bodies = new List<string>();
        foreach (object body in new object[]
        {
            new { token = "not-a-real-token-at-all", newPassword = "another-fine-sentence-42" },
            new { token = expired.RawToken, newPassword = "another-fine-sentence-42" },
            new { token = used.RawToken, newPassword = "another-fine-sentence-42" },
            new { newPassword = "another-fine-sentence-42" },
            new { token = new string('x', 300), newPassword = "another-fine-sentence-42" },
        })
        {
            using var response = await anonymous.PostAsJsonAsync(ResetUri, body);
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            response.Headers.CacheControl?.NoStore.Should().BeTrue();
            bodies.Add(await response.Content.ReadAsStringAsync());
        }

        bodies.Should().AllBe("{\"error\":\"invalid-token\"}", "unknown, expired, used and missing tokens are indistinguishable");

        await using var read = _world.ReadContext();
        new PasswordHasher<Person>().VerifyHashedPassword(
                await read.People.AsNoTracking().SingleAsync(p => p.Id == target),
                (await read.People.AsNoTracking().SingleAsync(p => p.Id == target)).PasswordHash!,
                CredentialTestWorld.NewPassword)
            .Should().NotBe(PasswordVerificationResult.Failed, "no refused attempt changed the password");
    }

    [RequiresDockerFact]
    public async Task Reset_WithAPolicyViolation_IsTheSpecificCode_AndDoesNotConsumeTheToken()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (target, email) = await _world.SeedPersonAsync(org);
        var issued = await _world.IssueAsync(CredentialTokenPurposes.Reset, target, org);
        var emailLocalPart = email[..email.IndexOf('@', StringComparison.Ordinal)];

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var anonymous = CredentialTestWorld.CreateClient(factory);

        foreach (var (password, code) in new[]
        {
            ("short-pw", PasswordPolicy.TooShortError),
            (new string('z', 129), PasswordPolicy.TooLongError),
            ("unbelievable", PasswordPolicy.CommonError),
            ($"x-{emailLocalPart}-x", PasswordPolicy.PersonalInfoError),
        })
        {
            using var response = await anonymous.PostAsJsonAsync(ResetUri, new { token = issued.RawToken, newPassword = password });
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString().Should().Be(code);
        }

        using var ok = await anonymous.PostAsJsonAsync(ResetUri, new { token = issued.RawToken, newPassword = CredentialTestWorld.NewPassword });
        ok.StatusCode.Should().Be(HttpStatusCode.NoContent, "a policy refusal does not consume the token, so the person can retry");
    }

    [RequiresDockerFact]
    public async Task Reset_ATokenStampedWithAnotherOrganization_CannotReachThePerson()
    {
        // The token's OrganizationId bounds the person read (InOrganization): a row whose tenant does not match its
        // person (impossible through the service — forged here) is the uniform refusal, and nothing changes.
        var (org, _) = await _world.SeedOrganizationAsync();
        var (otherOrg, _) = await _world.SeedOrganizationAsync();
        var (victim, _) = await _world.SeedPersonAsync(org);
        var forged = await _world.IssueAsync(CredentialTokenPurposes.Reset, victim, otherOrg);

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var anonymous = CredentialTestWorld.CreateClient(factory);
        using var response = await anonymous.PostAsJsonAsync(ResetUri, new { token = forged.RawToken, newPassword = CredentialTestWorld.NewPassword });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).Should().Be("{\"error\":\"invalid-token\"}");

        await using var read = _world.ReadContext();
        var person = await read.People.AsNoTracking().SingleAsync(p => p.Id == victim);
        person.PasswordChangedAt.Should().BeNull("the cross-tenant token changed nothing");
        (await read.CredentialTokens.AsNoTracking().SingleAsync(t => t.Id == forged.Token.Id)).UsedAt.Should().BeNull();
    }
}
