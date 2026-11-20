namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using System;
using System.Linq;
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
using Pulse.WebApi.Features.Identity.Enrollments;
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
/// #839 (CR-001) — a REAL staff sign-in (<see cref="OrgStaffLoginService"/>) racing each change that sweeps a person's
/// sessions: a password reset, a disable, an org-admin demote, an enrollment removal and an enrollment role change. Both
/// sides take the person-row lock (<see cref="PersonSessionLock"/>) before reading what the other writes, so whichever
/// locks first wins and the other WAITS. Each arm is staged in both orders, deterministically by command hooks:
/// <list type="bullet">
///   <item><description><b>change first</b> — the sign-in starts once the change holds the person lock and is about to
///   sweep (so its reads and its clock come AFTER the change's, the realistic order). It must block on the person row,
///   then be refused — or, for a role change, land on the NEW role;</description></item>
///   <item><description><b>sign-in first</b> — the change starts once the sign-in holds the person lock. The change must
///   block on the person row, and its sweep must then revoke the session the sign-in committed.</description></item>
/// </list>
/// Either way the invariant holds: no live session carries the person state the change replaced.
/// </summary>
[Collection(MsSqlRcsiCollection.Name)]
public sealed class PersonRowSerializationTests
{
    /// <summary>Long enough for an un-blocked competitor to finish (one PBKDF2 verify, a few statements).</summary>
    private static readonly TimeSpan BlockedWindow = TimeSpan.FromSeconds(3);

    private readonly MsSqlContainerFixture _fixture;
    private readonly CredentialTestWorld _world;
    private readonly EnrollmentTestKit _enrollments;

    public PersonRowSerializationTests(MsSqlRcsiFixture rcsi)
    {
        ArgumentNullException.ThrowIfNull(rcsi);
        var fixture = rcsi.Sql;
        _fixture = fixture;
        _world = new CredentialTestWorld(fixture);
        _enrollments = new EnrollmentTestKit(fixture);
    }

    public static TheoryData<string> Arms => new() { "reset", "disable", "demote", "enrollment-revoke", "role-change" };

    [RequiresDockerTheory]
    [MemberData(nameof(Arms))]
    public async Task ChangeFirst_TheSignInWaitsOnThePersonRow_ThenCannotMintFromTheReplacedState(string arm)
    {
        var world = await SeedAsync(arm);

        Task<OrgStaffLoginResult>? signIn = null;
        var signInBlocked = false;
        var hook = new BeforeSweepHook(async () =>
        {
            signIn = SignInAsync(world, interceptor: null);
            signInBlocked = await Task.WhenAny(signIn, Task.Delay(BlockedWindow)) != signIn;
        });

        (await RunChangeAsync(arm, world, hook)).Should().BeTrue("the {0} commits", arm);
        hook.Fired.Should().BeTrue("the sign-in started while the change held the person lock");
        signInBlocked.Should().BeTrue("the sign-in waited on the person row the {0} held", arm);

        var result = await signIn!;
        if (arm == "role-change")
        {
            result.Outcome.Should().Be(OrgStaffLoginOutcome.Authenticated, "the person may still sign in, to the role they now hold");
            result.Issued!.Session.Role.Should().Be("evaluator", "the grant is read under the lock, after the change committed");
        }
        else
        {
            result.Outcome.Should().Be(OrgStaffLoginOutcome.Rejected, "the {0} committed before the sign-in got the person lock", arm);
        }

        await AssertNoLiveSessionCarriesTheReplacedStateAsync(arm, world);
    }

    [RequiresDockerTheory]
    [MemberData(nameof(Arms))]
    public async Task SignInFirst_TheChangeWaitsOnThePersonRow_ThenItsSweepRevokesTheNewSession(string arm)
    {
        var world = await SeedAsync(arm);

        Task<bool>? change = null;
        var changeBlocked = false;
        var hook = new AfterPersonLockHook(async () =>
        {
            change = RunChangeAsync(arm, world, interceptor: null);
            changeBlocked = await Task.WhenAny(change, Task.Delay(BlockedWindow)) != change;
        });

        var result = await SignInAsync(world, hook);
        result.Outcome.Should().Be(OrgStaffLoginOutcome.Authenticated, "the sign-in locked the person first");
        hook.Fired.Should().BeTrue("the change started while the sign-in held the person lock");
        changeBlocked.Should().BeTrue("the {0} waited on the person row the sign-in held", arm);
        (await change!).Should().BeTrue("the {0} commits once the sign-in has", arm);

        await using (var read = _fixture.CreateContext())
        {
            (await read.Sessions.AsNoTracking().SingleAsync(s => s.Id == result.Issued!.Session.Id)).RevokedAt.Should().NotBeNull(
                "the {0}'s sweep ran after the sign-in committed, so it saw and revoked the new session", arm);
        }

        await AssertNoLiveSessionCarriesTheReplacedStateAsync(arm, world);
    }

    private async Task<World> SeedAsync(string arm)
    {
        var (org, slug) = await _world.SeedOrganizationAsync();
        var exercise = await _world.SeedExerciseAsync(org);
        var (admin, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var (adminSession, _, _) = await _world.SeedStaffSessionAsync(admin, exerciseId: null, Person.OrgAdminRole);
        var (target, email) = await _world.SeedPersonAsync(org, orgRole: arm == "demote" ? Person.OrgAdminRole : null);

        Guid? enrollment = null;
        if (arm != "demote")
        {
            enrollment = await _world.SeedEnrollmentAsync(exercise, target, "controller");
        }

        var (planner, _) = await _enrollments.SeedStaffAsync(org, exercise, "planner");
        var (plannerSession, _) = await _enrollments.SeedStaffSessionAsync(planner, exercise, "planner");

        string? resetToken = null;
        if (arm == "reset")
        {
            resetToken = (await _world.IssueAsync(CredentialTokenPurposes.Reset, target, org)).RawToken;
        }

        return new World(org, slug, exercise, admin, adminSession, target, email, enrollment, planner, plannerSession, resetToken);
    }

    private async Task<OrgStaffLoginResult> SignInAsync(World world, IInterceptor? interceptor)
    {
        var builder = new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(_fixture.ConnectionString!);
        if (interceptor is not null)
        {
            builder.AddInterceptors(interceptor);
        }

        await using var context = new PulseDbContext(builder.Options);
        var issuer = new SessionIssuer(
            context,
            Options.Create(new SessionOptions()),
            new ExerciseFactsReader(context),
            Options.Create(new EasyLoginOptions()),
            TimeProvider.System,
            NullLogger<SessionIssuer>.Instance,
            new HttpContextAccessor());
        return await OrgSignInTestKit.Service(context, issuer).LoginAsync(
            new StaffLoginRequest { OrgSlug = world.Slug, Email = world.Email, Password = CredentialTestWorld.OldPassword },
            remoteIp: null);
    }

    private async Task<bool> RunChangeAsync(string arm, World world, IInterceptor? interceptor)
    {
        switch (arm)
        {
            case "reset":
            {
                var builder = new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(_fixture.ConnectionString!);
                if (interceptor is not null)
                {
                    builder.AddInterceptors(interceptor);
                }

                await using var context = new PulseDbContext(builder.Options);
                var service = new PasswordResetService(
                    context, new CredentialTokenService(context, TimeProvider.System), TimeProvider.System, new RecordingConnectionRevoker());
                var result = await service.ResetAsync(
                    new PasswordResetRequest { Token = world.ResetToken, NewPassword = CredentialTestWorld.NewPassword });
                return result.Outcome == PasswordResetOutcome.Ok;
            }

            case "disable":
            case "demote":
            {
                var (service, _, context) = OrgPeopleServiceKit.For(_fixture, world.AdminSession, world.Admin, world.Org, interceptor);
                await using (context)
                {
                    var request = arm == "disable"
                        ? new UpdateOrgPersonRequest { Disabled = true }
                        : new UpdateOrgPersonRequest { IsOrgAdmin = false };
                    return (await service.UpdateAsync(world.Target, request)).Outcome == OrgPeopleOutcome.Ok;
                }
            }

            default:
            {
                var (service, context) = _enrollments.ServiceFor(
                    world.PlannerSession, world.Planner, world.Org, world.Exercise, interceptor: interceptor);
                await using (context)
                {
                    var result = arm == "enrollment-revoke"
                        ? await service.RevokeAsync(world.Enrollment!.Value)
                        : await service.ChangeRoleAsync(world.Enrollment!.Value, "evaluator");
                    return result.Outcome == EnrollmentOutcome.Ok;
                }
            }
        }
    }

    private async Task AssertNoLiveSessionCarriesTheReplacedStateAsync(string arm, World world)
    {
        await using var read = _fixture.CreateContext();
        var now = DateTimeOffset.UtcNow;
        var live = (await read.Sessions.AsNoTracking()
                .Where(s => (s.PersonId == world.Target || s.StaffUserId == world.Target) && s.RevokedAt == null)
                .ToListAsync())
            .Where(s => s.ExpiresAt > now)
            .ToList();

        switch (arm)
        {
            case "reset":
                live.Should().BeEmpty("no session minted on the old password survives the reset");
                break;
            case "disable":
                live.Should().BeEmpty("no session survives the disable");
                break;
            case "demote":
                live.Where(s => s.ExerciseId == null).Should().BeEmpty("no org-scope session survives losing the grant");
                break;
            case "enrollment-revoke":
                live.Where(s => s.ExerciseId == world.Exercise).Should().BeEmpty("no session survives the enrollment's removal");
                break;
            default:
                live.Where(s => s.ExerciseId == world.Exercise).Should().NotContain(
                    s => s.Role != "evaluator", "no session carries the role the change replaced");
                break;
        }
    }

    private sealed record World(
        Guid Org,
        string Slug,
        Guid Exercise,
        Guid Admin,
        Guid AdminSession,
        Guid Target,
        string Email,
        Guid? Enrollment,
        Guid Planner,
        Guid PlannerSession,
        string? ResetToken);
}
