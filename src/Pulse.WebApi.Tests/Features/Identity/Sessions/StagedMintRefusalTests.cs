namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Credentials;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Org.PeopleDirectory;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Tests.Features.Identity.Credentials;
using Pulse.WebApi.Tests.Features.Identity.Enrollments;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Pulse.WebApi.Tests.Features.Org.PeopleDirectory;
using Pulse.WebApi.Tests.Helpers;
using Xunit;

/// <summary>
/// #858 review — the MINT-SIDE predicates, staged at the one moment only they can catch. The sign-in has finished all its
/// reads and verified the password; then, just before its person-row lock (<see cref="PersonSessionLock"/>), a reset, a
/// disable or a demote COMMITS on another connection. No lock is held by anyone at that instant, so nothing blocks:
/// only the lock's conditions (the verified hash, not disabled, the org-admin grant) can notice the person changed. The
/// sign-in must be refused, write the <c>"reason":"changed"</c> refusal and nothing else it had staged, and leave no live
/// session. The exercise-bound staff login and the staff exercise switch are covered the same way. Runs on the
/// READ_COMMITTED_SNAPSHOT database (<see cref="MsSqlRcsiFixture"/>), the production isolation.
/// </summary>
[Collection(MsSqlRcsiCollection.Name)]
public sealed class StagedMintRefusalTests
{
    private readonly MsSqlContainerFixture _fixture;
    private readonly CredentialTestWorld _world;
    private readonly EnrollmentTestKit _enrollments;

    public StagedMintRefusalTests(MsSqlRcsiFixture rcsi)
    {
        ArgumentNullException.ThrowIfNull(rcsi);
        _fixture = rcsi.Sql;
        _world = new CredentialTestWorld(_fixture);
        _enrollments = new EnrollmentTestKit(_fixture);
    }

    [RequiresDockerTheory]
    [InlineData("reset")]
    [InlineData("disable")]
    [InlineData("demote")]
    public async Task OrgSignIn_APersonChangeCommittedJustBeforeTheMintLock_IsRefusedAsChanged(string arm)
    {
        var world = await SeedAsync(arm);
        var hook = BeforeMintLock(() => RunChangeAsync(arm, world));

        var result = await OrgSignInAsync(world, hook);

        hook.Fired.Should().BeTrue("the {0} committed after the sign-in verified, just before its lock", arm);
        result.Outcome.Should().Be(OrgStaffLoginOutcome.Rejected, "the lock's conditions see the committed {0}", arm);
        await AssertRefusedAsChangedAsync(world);
        await AssertNoLiveSessionAsync(world.Target);
    }

    [RequiresDockerFact]
    public async Task OrgChoice_ADisableCommittedJustBeforeTheMintLock_IsRefused_AndTheChoiceSuccessIsNotAudited()
    {
        // S-003: a refusal writes only the refusal — not the choice-success audit staged before the mint.
        var world = await SeedAsync("disable");
        var choiceToken = await _world.SeedOrgChoiceAsync(world.Target, world.Org);
        var hook = BeforeMintLock(() => RunChangeAsync("disable", world));

        OrgStaffLoginResult result;
        await using (var context = SignInContext(hook))
        {
            result = await OrgSignInTestKit.Service(context, IssuerFor(context)).ChooseAsync(
                new StaffLoginChooseRequest { ChoiceToken = choiceToken, OrgSlug = world.Slug }, remoteIp: "test");
        }

        hook.Fired.Should().BeTrue();
        result.Outcome.Should().Be(OrgStaffLoginOutcome.Rejected);
        await AssertRefusedAsChangedAsync(world);
        await using var read = _fixture.CreateContext();
        (await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking()
                .CountAsync(a => a.SubjectPersonId == world.Target && a.Kind == OrgStaffLoginService.ChoiceAuditKind))
            .Should().Be(0, "the choice success was staged on the strength of the replaced state and must not land");
        await AssertNoLiveSessionAsync(world.Target);
    }

    [RequiresDockerTheory]
    [InlineData("reset")]
    [InlineData("disable")]
    public async Task ExerciseBoundStaffLogin_APersonChangeCommittedJustBeforeTheMintLock_IsRejected(string arm)
    {
        var world = await SeedAsync(arm);
        await using (var write = _fixture.CreateContext())
        {
            // A failure count the refusal must NOT clear (S-003): a disable leaves it alone, so it must survive.
            (await write.People.SingleAsync(p => p.Id == world.Target)).FailedLoginCount = 2;
            await write.SaveChangesAsync();
        }

        var hook = BeforeMintLock(() => RunChangeAsync(arm, world));

        StaffLoginResult result;
        await using (var context = SignInContext(hook))
        {
            var verifier = TestPasswordVerifiers.New();
            var provider = new PulsePasswordIdentityProvider(
                context, new DynamisIdentityProvider(Options.Create(new DynamisIdentityProviderOptions())), verifier);
            var service = new StaffLoginService(context, provider, verifier, TestSignInTiming.NoFloor, IssuerFor(context));
            result = await service.LoginAsync(new StaffLoginRequest
            {
                Username = world.Email,
                Secret = CredentialTestWorld.OldPassword,
                ExerciseId = world.Exercise.ToString(),
            });
        }

        hook.Fired.Should().BeTrue("the {0} committed after the login verified, just before its lock", arm);
        result.Outcome.Should().Be(StaffLoginOutcome.Rejected);
        await AssertNoLiveSessionAsync(world.Target);
        if (arm == "disable")
        {
            await using var read = _fixture.CreateContext();
            (await read.People.AsNoTracking().SingleAsync(p => p.Id == world.Target)).FailedLoginCount.Should().Be(
                2, "the counter is cleared only once the verified password is known to still be the person's");
        }
    }

    [RequiresDockerFact]
    public async Task ExerciseSwitch_AnEnrollmentRemovalCommittedJustBeforeItsLock_IsNotAssigned_AndNothingIsRebound()
    {
        var world = await SeedAsync("enrollment");
        var (sessionId, _, _) = await _world.SeedStaffSessionAsync(world.Target, world.HomeExercise, "controller");
        var hook = BeforeMintLock(async () =>
        {
            var (service, context) = _enrollments.ServiceFor(world.PlannerSession, world.Planner, world.Org, world.Exercise);
            await using (context)
            {
                (await service.RevokeAsync(world.Enrollment)).Outcome.Should().Be(
                    Pulse.WebApi.Features.Identity.Enrollments.EnrollmentOutcome.Ok);
            }
        });

        var result = await SwitchAsync(world, sessionId, hook);

        hook.Fired.Should().BeTrue("the removal committed just before the switch's lock");
        result.Outcome.Should().Be(SetActiveExerciseOutcome.NotAssigned, "the enrollment is read under the lock, after the removal");
        await using var read = _fixture.CreateContext();
        (await read.Sessions.AsNoTracking().SingleAsync(s => s.Id == sessionId)).ExerciseId.Should().Be(
            world.HomeExercise, "the session was never re-bound to the removed grant");
    }

    [RequiresDockerFact]
    public async Task ExerciseSwitch_ADisableCommittedJustBeforeItsLock_IsUnauthenticated()
    {
        // S-002: the disable revoked the session that is switching; the switch must not re-bind a dead session.
        var world = await SeedAsync("enrollment");
        var (sessionId, _, _) = await _world.SeedStaffSessionAsync(world.Target, world.HomeExercise, "controller");
        var hook = BeforeMintLock(() => RunChangeAsync("disable", world));

        var result = await SwitchAsync(world, sessionId, hook);

        hook.Fired.Should().BeTrue();
        result.Outcome.Should().Be(SetActiveExerciseOutcome.Unauthenticated);
        await using var read = _fixture.CreateContext();
        var session = await read.Sessions.AsNoTracking().SingleAsync(s => s.Id == sessionId);
        session.RevokedAt.Should().NotBeNull("the disable revoked it");
        session.ExerciseId.Should().Be(world.HomeExercise, "a revoked session is never re-bound");
    }

    private static BeforeCommandHook BeforeMintLock(Func<Task> change) => new(
        sql => sql.Contains("UPDATE", StringComparison.Ordinal) && sql.Contains("[People]", StringComparison.Ordinal),
        change);

    private PulseDbContext SignInContext(IInterceptor hook) =>
        new(new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(_fixture.ConnectionString!).AddInterceptors(hook).Options);

    private static SessionIssuer IssuerFor(PulseDbContext context) => new(
        context,
        Options.Create(new SessionOptions()),
        new ExerciseFactsReader(context),
        Options.Create(new EasyLoginOptions()),
        TimeProvider.System,
        NullLogger<SessionIssuer>.Instance,
        new HttpContextAccessor());

    private async Task<OrgStaffLoginResult> OrgSignInAsync(World world, IInterceptor hook)
    {
        await using var context = SignInContext(hook);
        return await OrgSignInTestKit.Service(context, IssuerFor(context)).LoginAsync(
            new StaffLoginRequest { OrgSlug = world.Slug, Email = world.Email, Password = CredentialTestWorld.OldPassword },
            remoteIp: null);
    }

    private async Task<SetActiveExerciseResult> SwitchAsync(World world, Guid sessionId, IInterceptor hook)
    {
        await using var context = new PulseDbContext(
            new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(_fixture.ConnectionString!).AddInterceptors(hook).Options,
            new ExerciseContext { CurrentExerciseId = world.HomeExercise },
            new OrganizationContext { CurrentOrganizationId = world.Org });
        var service = new StaffAssignmentService(context, new FixedStaffSession(sessionId, world.Target));
        return await service.SetActiveExerciseAsync(world.Exercise);
    }

    private async Task<World> SeedAsync(string arm)
    {
        var (org, slug) = await _world.SeedOrganizationAsync();
        var exercise = await _world.SeedExerciseAsync(org);
        var homeExercise = await _world.SeedExerciseAsync(org);
        var (admin, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var (adminSession, _, _) = await _world.SeedStaffSessionAsync(admin, exerciseId: null, Person.OrgAdminRole);
        var (target, email) = await _world.SeedPersonAsync(org, orgRole: arm == "demote" ? Person.OrgAdminRole : null);
        var enrollment = arm == "demote" ? Guid.Empty : await _world.SeedEnrollmentAsync(exercise, target, "controller");
        await _world.SeedEnrollmentAsync(homeExercise, target, "controller");
        var (planner, _) = await _enrollments.SeedStaffAsync(org, exercise, "planner");
        var (plannerSession, _) = await _enrollments.SeedStaffSessionAsync(planner, exercise, "planner");
        var resetToken = arm == "reset" ? (await _world.IssueAsync(CredentialTokenPurposes.Reset, target, org)).RawToken : null;

        return new World(org, slug, exercise, homeExercise, admin, adminSession, target, email, enrollment, planner, plannerSession, resetToken);
    }

    private async Task RunChangeAsync(string arm, World world)
    {
        if (arm == "reset")
        {
            await using var context = _fixture.CreateContext();
            var service = new PasswordResetService(
                context, new CredentialTokenService(context, TimeProvider.System), TimeProvider.System, new RecordingConnectionRevoker());
            (await service.ResetAsync(new PasswordResetRequest { Token = world.ResetToken, NewPassword = CredentialTestWorld.NewPassword }))
                .Outcome.Should().Be(PasswordResetOutcome.Ok);
            return;
        }

        var (people, _, peopleContext) = OrgPeopleServiceKit.For(_fixture, world.AdminSession, world.Admin, world.Org);
        await using (peopleContext)
        {
            var request = arm == "disable" ? new UpdateOrgPersonRequest { Disabled = true } : new UpdateOrgPersonRequest { IsOrgAdmin = false };
            (await people.UpdateAsync(world.Target, request)).Outcome.Should().Be(OrgPeopleOutcome.Ok);
        }
    }

    private async Task AssertRefusedAsChangedAsync(World world)
    {
        await using var read = _fixture.CreateContext();
        var audits = await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking()
            .Where(a => a.OrganizationId == world.Org && a.SubjectPersonId == world.Target && a.Kind == OrgStaffLoginService.SignInAuditKind)
            .ToListAsync();
        audits.Should().ContainSingle("only the refusal is written").Which.Should().Match<OrgAuditEvent>(a =>
            a.Outcome == OrgStaffLoginService.RefusedOutcome && a.Payload.Contains("\"reason\":\"changed\""));
    }

    private async Task AssertNoLiveSessionAsync(Guid personId)
    {
        await using var read = _fixture.CreateContext();
        var now = DateTimeOffset.UtcNow;
        (await read.Sessions.AsNoTracking()
                .Where(s => (s.PersonId == personId || s.StaffUserId == personId) && s.RevokedAt == null)
                .ToListAsync())
            .Where(s => s.ExpiresAt > now)
            .Should().BeEmpty("the refused sign-in minted nothing that could outlive the change");
    }

    private sealed record World(
        Guid Org,
        string Slug,
        Guid Exercise,
        Guid HomeExercise,
        Guid Admin,
        Guid AdminSession,
        Guid Target,
        string Email,
        Guid Enrollment,
        Guid Planner,
        Guid PlannerSession,
        string? ResetToken);

    private sealed class FixedStaffSession(Guid sessionId, Guid staffUserId) : ICurrentStaffSessionAccessor
    {
        public Task<CurrentStaffSession?> GetCurrentStaffSessionAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult<CurrentStaffSession?>(new CurrentStaffSession { SessionId = sessionId, StaffUserId = staffUserId });
    }
}
