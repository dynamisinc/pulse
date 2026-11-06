namespace Pulse.WebApi.Tests.Features.Identity.Staff;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Xunit;

/// <summary>
/// identity-auth-roles/15 (COR-077, ADMIN-IDENTITY-MODEL §1.2) — the org staff sign-in over REAL SQL: org-scope sessions
/// for an org admin of an EMPTY organization, landing on the most recently used staff enrollment otherwise, the
/// email-first org choice (LoginChoice), slugless lockout attribution, the credential-change invalidation of choices,
/// foreign-org refusals, and OrgAuditEvent / TelemetryEvent audit.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class OrgStaffLoginServiceTests
{
    private readonly MsSqlContainerFixture _fixture;
    private readonly OrgSignInTestKit _kit;

    public OrgStaffLoginServiceTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _kit = new OrgSignInTestKit(fixture);
    }

    [Fact]
    public void IsOrgShape_RoutesOnlyExerciselessBodiesToTheOrgSignIn_TheExerciseBoundShapeIsUntouched()
    {
        // AC6: the exercise-bound shape ({username, secret, exerciseId}) never reaches the org sign-in.
        OrgStaffLoginService.IsOrgShape(new StaffLoginRequest { Username = "u", Secret = "s", ExerciseId = Guid.NewGuid().ToString() })
            .Should().BeFalse();
        OrgStaffLoginService.IsOrgShape(new StaffLoginRequest { Email = "a@b.c", Password = "p", ExerciseId = "x" })
            .Should().BeFalse("a body naming an exercise always takes the unchanged exercise-bound path");
        OrgStaffLoginService.IsOrgShape(new StaffLoginRequest { Username = "u", Secret = "s" })
            .Should().BeFalse("a legacy body without exerciseId keeps its legacy 400");
        OrgStaffLoginService.IsOrgShape(new StaffLoginRequest { Email = "a@b.c", Password = "p" }).Should().BeTrue();
        OrgStaffLoginService.IsOrgShape(new StaffLoginRequest { OrgSlug = "acme" }).Should().BeTrue();
    }

    [RequiresDockerFact]
    public async Task OrgAdminOfAnEmptyOrganization_SignsInBySlug_ToAnOrgScopeSession_AndItIsAudited()
    {
        // AC1: zero exercises, zero enrollments — the case the exercise-bound login can never serve.
        var org = await _kit.SeedOrganizationAsync();
        var email = OrgSignInTestKit.NewEmail();
        var admin = await _kit.SeedPersonAsync(org.Id, email, orgRole: Person.OrgAdminRole);

        await using var context = _kit.Context();
        var issuer = new RecordingSessionIssuer();
        var result = await OrgSignInTestKit.Service(context, issuer).LoginAsync(
            new StaffLoginRequest { OrgSlug = org.Slug.ToUpperInvariant(), Email = email.ToUpperInvariant(), Password = OrgSignInTestKit.Password },
            remoteIp: null);

        result.Outcome.Should().Be(OrgStaffLoginOutcome.Authenticated);
        issuer.LastRequest!.ExerciseId.Should().BeNull("org scope is a structural null, never Guid.Empty (AC2)");
        issuer.LastRequest.Role.Should().Be("orgAdmin");
        issuer.LastRequest.Kind.Should().Be("staff");
        issuer.LastRequest.StaffUserId.Should().Be(admin);
        issuer.LastRequest.PersonId.Should().Be(admin);

        await using var read = _kit.Context();
        var audit = await read.OrgAuditEvents.IgnoreQueryFilters().Where(e => e.OrganizationId == org.Id).ToListAsync();
        audit.Should().ContainSingle().Which.Should().Match<OrgAuditEvent>(e =>
            e.Kind == OrgStaffLoginService.SignInAuditKind && e.Outcome == "success" && e.SubjectPersonId == admin && e.ExerciseId == null);
    }

    [RequiresDockerFact]
    public async Task OrgAdmin_SignsInEmailFirst_WithOneOrganization_ToAnOrgScopeSession()
    {
        var org = await _kit.SeedOrganizationAsync();
        var email = OrgSignInTestKit.NewEmail();
        await _kit.SeedPersonAsync(org.Id, email, orgRole: Person.OrgAdminRole);

        await using var context = _kit.Context();
        var issuer = new RecordingSessionIssuer();
        var result = await OrgSignInTestKit.Service(context, issuer).LoginAsync(
            new StaffLoginRequest { Email = email, Password = OrgSignInTestKit.Password }, remoteIp: null);

        result.Outcome.Should().Be(OrgStaffLoginOutcome.Authenticated);
        issuer.LastRequest!.ExerciseId.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task NonAdmin_LandsOnTheMostRecentlyUsedStaffEnrollment_AndTheLoginIsTheExercisesTelemetry()
    {
        var org = await _kit.SeedOrganizationAsync();
        var older = await _kit.SeedExerciseAsync(org.Id);
        var newer = await _kit.SeedExerciseAsync(org.Id);
        var email = OrgSignInTestKit.NewEmail();
        var person = await _kit.SeedPersonAsync(org.Id, email);
        await _kit.SeedEnrollmentAsync(older, person, "planner", DateTimeOffset.UtcNow.AddDays(-2));
        await _kit.SeedEnrollmentAsync(newer, person, "evaluator", DateTimeOffset.UtcNow.AddDays(-1));

        // Last used = the OLDER enrollment's exercise (its latest staff session is the most recent).
        await _kit.SeedPastStaffSessionAsync(person, newer, DateTimeOffset.UtcNow.AddHours(-5));
        await _kit.SeedPastStaffSessionAsync(person, older, DateTimeOffset.UtcNow.AddHours(-1));

        await using var context = _kit.Context();
        var issuer = new RecordingSessionIssuer();
        var result = await OrgSignInTestKit.Service(context, issuer).LoginAsync(
            new StaffLoginRequest { OrgSlug = org.Slug, Email = email, Password = OrgSignInTestKit.Password }, remoteIp: null);

        result.Outcome.Should().Be(OrgStaffLoginOutcome.Authenticated);
        issuer.LastRequest!.ExerciseId.Should().Be(older, "the most recently used staff enrollment wins over the newest one");
        issuer.LastRequest.Role.Should().Be("planner");

        await using var read = _kit.Context();
        (await read.TelemetryEvents.IgnoreQueryFilters()
                .CountAsync(e => e.ExerciseId == older && e.EventType == "login" && e.Actor.ActingHumanId == person.ToString()))
            .Should().Be(1, "an exercise-scoped sign-in stays the exercise's XC-004 login event (§7.5)");
        (await read.OrgAuditEvents.IgnoreQueryFilters().CountAsync(e => e.OrganizationId == org.Id))
            .Should().Be(0, "only ORG-scope sign-ins go to OrgAuditEvent");
    }

    [RequiresDockerFact]
    public async Task NonAdmin_WithNoStaffEnrollment_IsTheUniformRefusal_NotAFailureCount()
    {
        var org = await _kit.SeedOrganizationAsync();
        var participantOnlyExercise = await _kit.SeedExerciseAsync(org.Id);
        var email = OrgSignInTestKit.NewEmail();
        var person = await _kit.SeedPersonAsync(org.Id, email);
        await _kit.SeedEnrollmentAsync(participantOnlyExercise, person, "participant");

        await using var context = _kit.Context();
        var issuer = new RecordingSessionIssuer();
        var result = await OrgSignInTestKit.Service(context, issuer).LoginAsync(
            new StaffLoginRequest { OrgSlug = org.Slug, Email = email, Password = OrgSignInTestKit.Password }, remoteIp: null);

        result.Outcome.Should().Be(OrgStaffLoginOutcome.Rejected, "never a participant enrollment, and no grant means no session");
        issuer.IssueCount.Should().Be(0);

        await using var read = _kit.Context();
        (await read.People.SingleAsync(p => p.Id == person)).FailedLoginCount.Should().Be(0);
        (await read.OrgAuditEvents.IgnoreQueryFilters().SingleAsync(e => e.OrganizationId == org.Id))
            .Outcome.Should().Be("refused");
    }

    [RequiresDockerFact]
    public async Task WrongPassword_WithASlug_IsRefused_CountsAFailure_AndIsAudited()
    {
        var org = await _kit.SeedOrganizationAsync();
        var email = OrgSignInTestKit.NewEmail();
        var person = await _kit.SeedPersonAsync(org.Id, email, orgRole: Person.OrgAdminRole);

        await using var context = _kit.Context();
        var result = await OrgSignInTestKit.Service(context, new RecordingSessionIssuer()).LoginAsync(
            new StaffLoginRequest { OrgSlug = org.Slug, Email = email, Password = "wrong password entirely" }, remoteIp: null);

        result.Outcome.Should().Be(OrgStaffLoginOutcome.Rejected);
        await using var read = _kit.Context();
        (await read.People.SingleAsync(p => p.Id == person)).FailedLoginCount.Should().Be(1);
        (await read.OrgAuditEvents.IgnoreQueryFilters().SingleAsync(e => e.OrganizationId == org.Id))
            .Should().Match<OrgAuditEvent>(e => e.Outcome == "refused" && e.SubjectPersonId == person && e.ActorPersonId == null);
    }

    [RequiresDockerFact]
    public async Task ForeignOrgSlug_WithAnotherOrganizationsCorrectPassword_IsRefused_AndTheHomePersonIsUntouched()
    {
        var home = await _kit.SeedOrganizationAsync();
        var foreign = await _kit.SeedOrganizationAsync();
        var email = OrgSignInTestKit.NewEmail();
        var person = await _kit.SeedPersonAsync(home.Id, email, orgRole: Person.OrgAdminRole);

        await using var context = _kit.Context();
        var issuer = new RecordingSessionIssuer();
        var result = await OrgSignInTestKit.Service(context, issuer).LoginAsync(
            new StaffLoginRequest { OrgSlug = foreign.Slug, Email = email, Password = OrgSignInTestKit.Password }, remoteIp: null);

        result.Outcome.Should().Be(OrgStaffLoginOutcome.Rejected, "the person lookup is bounded by the slug's organization");
        issuer.IssueCount.Should().Be(0);
        await using var read = _kit.Context();
        (await read.People.SingleAsync(p => p.Id == person)).FailedLoginCount.Should().Be(0);
        (await read.OrgAuditEvents.IgnoreQueryFilters().CountAsync(e => e.OrganizationId == home.Id)).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task UnknownSlug_OrUnknownEmail_IsTheUniformRefusal_WithNoOrgAudit()
    {
        var org = await _kit.SeedOrganizationAsync();
        await using var context = _kit.Context();
        var service = OrgSignInTestKit.Service(context, new RecordingSessionIssuer());

        (await service.LoginAsync(new StaffLoginRequest { OrgSlug = $"nope-{Guid.NewGuid():N}", Email = OrgSignInTestKit.NewEmail(), Password = "x" }, null))
            .Outcome.Should().Be(OrgStaffLoginOutcome.Rejected);
        (await service.LoginAsync(new StaffLoginRequest { Email = OrgSignInTestKit.NewEmail(), Password = "x" }, null))
            .Outcome.Should().Be(OrgStaffLoginOutcome.Rejected);

        await using var read = _kit.Context();
        (await read.OrgAuditEvents.IgnoreQueryFilters().CountAsync(e => e.OrganizationId == org.Id)).Should().Be(0);
    }

    [RequiresDockerTheory]
    [InlineData(null, "pw", "email")]
    [InlineData("a@b.c", null, "password")]
    [InlineData("a@b.c", "", "password")]
    public async Task MissingField_IsAValidation400(string? email, string? password, string field)
    {
        await using var context = _kit.Context();
        var result = await OrgSignInTestKit.Service(context, new RecordingSessionIssuer())
            .LoginAsync(new StaffLoginRequest { Email = email, Password = password, OrgSlug = "x" }, null);

        result.Outcome.Should().Be(OrgStaffLoginOutcome.Invalid);
        result.ValidationError.Should().Contain(field);
    }

    [RequiresDockerFact]
    public async Task EmailFirst_VerifyingInTwoOrganizations_OffersTheChoice_ThenChooseMintsOnce_ForThatOrgOnly()
    {
        var orgA = await _kit.SeedOrganizationAsync();
        var orgB = await _kit.SeedOrganizationAsync();
        var orgC = await _kit.SeedOrganizationAsync();
        var email = OrgSignInTestKit.NewEmail();
        await _kit.SeedPersonAsync(orgA.Id, email, orgRole: Person.OrgAdminRole);
        var personB = await _kit.SeedPersonAsync(orgB.Id, email, orgRole: Person.OrgAdminRole);
        await _kit.SeedPersonAsync(orgC.Id, email, password: "a different password here", orgRole: Person.OrgAdminRole);

        await using var context = _kit.Context();
        var issuer = new RecordingSessionIssuer();
        var service = OrgSignInTestKit.Service(context, issuer);
        var login = await service.LoginAsync(new StaffLoginRequest { Email = email, Password = OrgSignInTestKit.Password }, "203.0.113.9");

        login.Outcome.Should().Be(OrgStaffLoginOutcome.ChoiceRequired);
        issuer.IssueCount.Should().Be(0, "no session until an organization is chosen");
        login.Choice!.Choose.Select(o => o.Slug).Should().BeEquivalentTo(
            [orgA.Slug, orgB.Slug], "only organizations whose password verified are disclosed — never org C");
        login.Choice.Choose.Single(o => o.Slug == orgB.Slug).OrgName.Should().Be(orgB.Name);

        // A foreign (non-candidate) org is refused and does NOT consume the choice.
        (await service.ChooseAsync(new StaffLoginChooseRequest { ChoiceToken = login.Choice.ChoiceToken, OrgSlug = orgC.Slug }, "203.0.113.9"))
            .Outcome.Should().Be(OrgStaffLoginOutcome.Rejected);

        var chosen = await service.ChooseAsync(new StaffLoginChooseRequest { ChoiceToken = login.Choice.ChoiceToken, OrgSlug = orgB.Slug }, "203.0.113.9");
        chosen.Outcome.Should().Be(OrgStaffLoginOutcome.Authenticated);
        issuer.LastRequest!.PersonId.Should().Be(personB);
        issuer.LastRequest.ExerciseId.Should().BeNull();

        // Single use: the WHOLE choice was consumed, so the other candidate org cannot be minted from it.
        (await service.ChooseAsync(new StaffLoginChooseRequest { ChoiceToken = login.Choice.ChoiceToken, OrgSlug = orgA.Slug }, "203.0.113.9"))
            .Outcome.Should().Be(OrgStaffLoginOutcome.Rejected);
        issuer.IssueCount.Should().Be(1);

        await using var read = _kit.Context();
        var choiceId = (await read.LoginChoiceCandidates.SingleAsync(k => k.PersonId == personB)).ChoiceId;
        var stored = await read.LoginChoices.SingleAsync(c => c.Id == choiceId);
        stored.ConsumedAt.Should().NotBeNull();
        stored.TokenHash.Should().NotBe(login.Choice.ChoiceToken, "only the token's hash is stored");
        stored.ExpiresAt.Should().BeCloseTo(DateTimeOffset.UtcNow.AddMinutes(2), TimeSpan.FromSeconds(30));
        (await read.OrgAuditEvents.IgnoreQueryFilters().CountAsync(e => e.OrganizationId == orgB.Id && e.Kind == OrgStaffLoginService.ChoiceAuditKind))
            .Should().Be(1, "the org choice is audited in the chosen organization");
    }

    [RequiresDockerFact]
    public async Task ExpiredChoice_IsRefused()
    {
        var (token, orgB, _) = await SeedChoiceAsync();
        await using (var expire = _kit.Context())
        {
            await expire.LoginChoices
                .Where(c => c.TokenHash == Pulse.WebApi.Features.Identity.Sessions.SessionTokens.Hash(token))
                .ExecuteUpdateAsync(set => set.SetProperty(c => c.ExpiresAt, DateTimeOffset.UtcNow.AddSeconds(-1)));
        }

        await using var context = _kit.Context();
        (await OrgSignInTestKit.Service(context, new RecordingSessionIssuer())
                .ChooseAsync(new StaffLoginChooseRequest { ChoiceToken = token, OrgSlug = orgB }, null))
            .Outcome.Should().Be(OrgStaffLoginOutcome.Rejected);
    }

    [RequiresDockerFact]
    public async Task ACredentialChange_InvalidatesEveryUnconsumedCandidate_SoTheOldChoiceCannotMint()
    {
        // Copilot review 5 fold / ADMIN-IDENTITY-MODEL §3.3: the A2 credential-change paths call
        // StageCredentialChangeInvalidationAsync in the same unit of work as the password change.
        var (token, orgB, personB) = await SeedChoiceAsync();

        await using (var change = _kit.Context())
        {
            var person = await change.People.SingleAsync(p => p.Id == personB);
            person.PasswordChangedAt = DateTimeOffset.UtcNow.AddMinutes(-10); // the stage alone must refuse it
            var staged = await OrgStaffLoginService.StageCredentialChangeInvalidationAsync(change, personB);
            staged.Should().Be(1);
            await change.SaveChangesAsync();
        }

        await using var context = _kit.Context();
        var issuer = new RecordingSessionIssuer();
        (await OrgSignInTestKit.Service(context, issuer).ChooseAsync(new StaffLoginChooseRequest { ChoiceToken = token, OrgSlug = orgB }, null))
            .Outcome.Should().Be(OrgStaffLoginOutcome.Rejected);
        issuer.IssueCount.Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task APasswordChangedAfterTheChoiceWasVerified_RefusesTheChoice_EvenWithoutTheStagedInvalidation()
    {
        var (token, orgB, personB) = await SeedChoiceAsync();
        await using (var change = _kit.Context())
        {
            (await change.People.SingleAsync(p => p.Id == personB)).PasswordChangedAt = DateTimeOffset.UtcNow;
            await change.SaveChangesAsync();
        }

        await using var context = _kit.Context();
        (await OrgSignInTestKit.Service(context, new RecordingSessionIssuer())
                .ChooseAsync(new StaffLoginChooseRequest { ChoiceToken = token, OrgSlug = orgB }, null))
            .Outcome.Should().Be(OrgStaffLoginOutcome.Rejected);
    }

    [RequiresDockerFact]
    public async Task SluglessLockoutAttribution_ASuccessInOneOrgNeverCountsAgainstAnother_AWholeFailureCountsAgainstEach()
    {
        var orgA = await _kit.SeedOrganizationAsync();
        var orgB = await _kit.SeedOrganizationAsync();
        var email = OrgSignInTestKit.NewEmail();
        var personA = await _kit.SeedPersonAsync(orgA.Id, email, orgRole: Person.OrgAdminRole);
        var personB = await _kit.SeedPersonAsync(orgB.Id, email, password: "org B has its own password", orgRole: Person.OrgAdminRole);

        await using (var context = _kit.Context())
        {
            var service = OrgSignInTestKit.Service(context, new RecordingSessionIssuer());
            for (var i = 0; i < 6; i++)
            {
                (await service.LoginAsync(new StaffLoginRequest { Email = email, Password = OrgSignInTestKit.Password }, null))
                    .Outcome.Should().Be(OrgStaffLoginOutcome.Authenticated);
            }
        }

        await using (var read = _kit.Context())
        {
            (await read.People.SingleAsync(p => p.Id == personB)).FailedLoginCount
                .Should().Be(0, "six good sign-ins to org A never lock out the same email's person in org B");
        }

        await using (var context = _kit.Context())
        {
            (await OrgSignInTestKit.Service(context, new RecordingSessionIssuer())
                    .LoginAsync(new StaffLoginRequest { Email = email, Password = "a guess that matches nothing" }, null))
                .Outcome.Should().Be(OrgStaffLoginOutcome.Rejected);
        }

        await using var after = _kit.Context();
        (await after.People.SingleAsync(p => p.Id == personA)).FailedLoginCount.Should().Be(1);
        (await after.People.SingleAsync(p => p.Id == personB)).FailedLoginCount.Should().Be(1, "a whole failure counts against every tried candidate");
    }

    [RequiresDockerFact]
    public async Task ALockedOutCandidate_IsSkippedWithoutVerification_AndFiveFailuresLockAPerson()
    {
        var org = await _kit.SeedOrganizationAsync();
        var email = OrgSignInTestKit.NewEmail();
        var person = await _kit.SeedPersonAsync(org.Id, email, orgRole: Person.OrgAdminRole);

        await using (var context = _kit.Context())
        {
            var service = OrgSignInTestKit.Service(context, new RecordingSessionIssuer());
            for (var i = 0; i < StaffSignInLockout.Threshold; i++)
            {
                await service.LoginAsync(new StaffLoginRequest { OrgSlug = org.Slug, Email = email, Password = "wrong" }, null);
            }
        }

        await using (var read = _kit.Context())
        {
            var locked = await read.People.SingleAsync(p => p.Id == person);
            locked.FailedLoginCount.Should().Be(5);
            locked.LockedOutUntil.Should().BeCloseTo(DateTimeOffset.UtcNow.AddMinutes(15), TimeSpan.FromMinutes(1));
        }

        await using (var context = _kit.Context())
        {
            var issuer = new RecordingSessionIssuer();
            var service = OrgSignInTestKit.Service(context, issuer);
            (await service.LoginAsync(new StaffLoginRequest { OrgSlug = org.Slug, Email = email, Password = OrgSignInTestKit.Password }, null))
                .Outcome.Should().Be(OrgStaffLoginOutcome.Rejected, "even the right password is refused while locked out");
            (await service.LoginAsync(new StaffLoginRequest { Email = email, Password = OrgSignInTestKit.Password }, null))
                .Outcome.Should().Be(OrgStaffLoginOutcome.Rejected, "slugless: the locked candidate is skipped");
            issuer.IssueCount.Should().Be(0);
        }

        await using var final = _kit.Context();
        (await final.People.SingleAsync(p => p.Id == person)).FailedLoginCount
            .Should().Be(5, "a skipped (locked) candidate is never verified, so it gains no further failure");
    }

    [Fact]
    public void Lockout_DoublesFromFifteenMinutes_CappedAtFourHours()
    {
        var now = DateTimeOffset.UtcNow;
        var person = new Person { DisplayName = "x", FailedLoginCount = 4 };
        StaffSignInLockout.RecordFailure(person, now);
        person.LockedOutUntil.Should().Be(now.AddMinutes(15));
        StaffSignInLockout.RecordFailure(person, now);
        person.LockedOutUntil.Should().Be(now.AddMinutes(30));
        person.FailedLoginCount = 40;
        StaffSignInLockout.RecordFailure(person, now);
        person.LockedOutUntil.Should().Be(now.AddHours(4));
        StaffSignInLockout.RecordSuccess(person);
        person.FailedLoginCount.Should().Be(0);
        person.LockedOutUntil.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task EmailFirst_VerifiesAtMostFiveCandidates()
    {
        var email = OrgSignInTestKit.NewEmail();
        for (var i = 0; i < OrgStaffLoginService.MaxCandidates + 1; i++)
        {
            var org = await _kit.SeedOrganizationAsync();
            await _kit.SeedPersonAsync(org.Id, email, orgRole: Person.OrgAdminRole);
        }

        await using var context = _kit.Context();
        var result = await OrgSignInTestKit.Service(context, new RecordingSessionIssuer())
            .LoginAsync(new StaffLoginRequest { Email = email, Password = OrgSignInTestKit.Password }, null);

        result.Outcome.Should().Be(OrgStaffLoginOutcome.ChoiceRequired);
        result.Choice!.Choose.Should().HaveCount(OrgStaffLoginService.MaxCandidates);
    }

    [RequiresDockerFact]
    public async Task ALegacyAllowlistedOrgAdminWithNoEmail_SignsInEmailFirst_ThroughTheChainedFallback()
    {
        // §1.3 interim: backfilled staff have no email/Pulse password until invited (A2); the allowlist, keyed on the
        // staff facet's ExternalSubject, carries them — so a seeded org admin of an empty org can sign in today.
        var org = await _kit.SeedOrganizationAsync();
        var admin = await _kit.SeedPersonAsync(org.Id, email: null, orgRole: Person.OrgAdminRole);
        var handle = $"legacy-{Guid.NewGuid():N}";

        await using var context = _kit.Context();
        var issuer = new RecordingSessionIssuer();
        var allowlist = new[]
        {
            new DynamisStaffAccount { Username = handle, Secret = "allowlist-secret", ExternalSubject = $"idp|{admin:N}", DisplayName = "Legacy" },
        };

        var good = await OrgSignInTestKit.Service(context, issuer, allowlist)
            .LoginAsync(new StaffLoginRequest { Email = handle, Password = "allowlist-secret" }, null);
        good.Outcome.Should().Be(OrgStaffLoginOutcome.Authenticated);
        issuer.LastRequest!.ExerciseId.Should().BeNull();
        issuer.LastRequest.StaffUserId.Should().Be(admin);

        var bySlug = await OrgSignInTestKit.Service(context, issuer, allowlist)
            .LoginAsync(new StaffLoginRequest { OrgSlug = org.Slug, Email = handle, Password = "allowlist-secret" }, null);
        bySlug.Outcome.Should().Be(OrgStaffLoginOutcome.Authenticated);

        var foreignSlug = await _kit.SeedOrganizationAsync();
        (await OrgSignInTestKit.Service(context, issuer, allowlist)
                .LoginAsync(new StaffLoginRequest { OrgSlug = foreignSlug.Slug, Email = handle, Password = "allowlist-secret" }, null))
            .Outcome.Should().Be(OrgStaffLoginOutcome.Rejected, "the allowlisted staff human belongs to another organization");
    }

    /// <summary>Seeds two orgs whose person verifies the same password and returns an open choice + org B.</summary>
    private async Task<(string Token, string OrgBSlug, Guid PersonB)> SeedChoiceAsync()
    {
        var orgA = await _kit.SeedOrganizationAsync();
        var orgB = await _kit.SeedOrganizationAsync();
        var email = OrgSignInTestKit.NewEmail();
        await _kit.SeedPersonAsync(orgA.Id, email, orgRole: Person.OrgAdminRole);
        var personB = await _kit.SeedPersonAsync(orgB.Id, email, orgRole: Person.OrgAdminRole);

        await using var context = _kit.Context();
        var login = await OrgSignInTestKit.Service(context, new RecordingSessionIssuer())
            .LoginAsync(new StaffLoginRequest { Email = email, Password = OrgSignInTestKit.Password }, null);
        login.Outcome.Should().Be(OrgStaffLoginOutcome.ChoiceRequired);
        return (login.Choice!.ChoiceToken, orgB.Slug, personB);
    }
}
