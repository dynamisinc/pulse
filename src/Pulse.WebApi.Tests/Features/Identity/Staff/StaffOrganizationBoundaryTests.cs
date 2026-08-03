namespace Pulse.WebApi.Tests.Features.Identity.Staff;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// exercise-isolation/11 AC3 (Tier-2, COR-010) — the CUSTOMER-tenant bound on the two staff SERVICES, proved
/// through the services themselves rather than through a re-typed copy of their queries.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this file exists separately from <see cref="OrganizationIsolationTests"/>.</b> That suite proves the
/// DATA-LAYER mechanism (the global filter, the <c>InOrganization</c> constraint, the write guard). These
/// tests prove the two places production code has to APPLY it — <see cref="StaffLoginService"/> and
/// <see cref="StaffAssignmentService"/> — because <c>Exercise</c> and <c>StaffUser</c> are resolution roots
/// and therefore inherit nothing. A data-layer test passing while a service forgot the bound is exactly the
/// gap that would ship a cross-customer leak with a green suite.
/// </para>
/// <para>
/// Every test builds the adversarial fixture deliberately: the staff human IS assigned to the other
/// customer's exercise. Assignment used to be sufficient; AC3 says it no longer is. Each test also asserts
/// the same caller CAN reach their own organization's exercise, so a blanket "deny everything" regression
/// cannot pass these for the wrong reason.
/// </para>
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class StaffOrganizationBoundaryTests
{
    private readonly MsSqlContainerFixture _fixture;

    public StaffOrganizationBoundaryTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task GetAssignments_OmitsAnExerciseBelongingToAnotherCustomer_EvenWhenAssigned()
    {
        var world = await SeedCrossTenantWorldAsync();

        await using var context = _fixture.CreateContext();
        var service = new StaffAssignmentService(
            context,
            new StubCurrentStaffSessionAccessor(new CurrentStaffSession
            {
                SessionId = Guid.NewGuid(),
                StaffUserId = world.StaffUserId,
            }));

        var assignments = await service.GetAssignmentsAsync();

        assignments.Should().NotBeNull();
        assignments!.Select(a => a.ExerciseId).Should().BeEquivalentTo(
            [world.OwnExercise.Id.ToString()],
            "a staff human spans EXERCISES but never CUSTOMERS — the switcher must list only their own "
            + "organization's runs, even though a StaffAssignment row exists for the other customer's");
    }

    [RequiresDockerFact]
    public async Task SetActiveExercise_RefusesAnExerciseBelongingToAnotherCustomer_EvenWhenAssigned()
    {
        var world = await SeedCrossTenantWorldAsync();
        var sessionId = await SeedStaffSessionAsync(world.StaffUserId, world.OwnExercise.Id);

        await using var context = _fixture.CreateContext();
        var service = new StaffAssignmentService(
            context,
            new StubCurrentStaffSessionAccessor(new CurrentStaffSession
            {
                SessionId = sessionId,
                StaffUserId = world.StaffUserId,
            }));

        var refused = await service.SetActiveExerciseAsync(world.OtherCustomerExercise.Id);

        refused.Outcome.Should().Be(
            SetActiveExerciseOutcome.NotAssigned,
            "switching INTO another customer's exercise must fail closed. NotAssigned (403) — the same shape "
            + "as an unassigned exercise — so the refusal discloses nothing about the other tenant's run");
        refused.Active.Should().BeNull("a refused switch must carry no exercise name or role");

        // Positive control: the SAME caller, same call, on their own organization's exercise.
        var allowed = await service.SetActiveExerciseAsync(world.OwnExercise.Id);
        allowed.Outcome.Should().Be(
            SetActiveExerciseOutcome.Ok,
            "the tenant bound must be a partition, not a blanket denial — otherwise the refusal above would "
            + "pass even if the switch were simply broken");

        // And nothing was persisted from the refused attempt.
        await using var read = _fixture.CreateContext();
        var boundExerciseId = await read.Sessions
            .AsNoTracking()
            .Where(s => s.Id == sessionId)
            .Select(s => s.ExerciseId)
            .SingleAsync();
        boundExerciseId.Should().Be(
            world.OwnExercise.Id,
            "the session must never end up bound to the other customer's exercise");
    }

    [RequiresDockerFact]
    public async Task StaffLogin_RefusesAnExerciseBelongingToAnotherCustomer_EvenWhenAssigned()
    {
        var world = await SeedCrossTenantWorldAsync();
        var issuer = new RecordingSessionIssuer();

        await using (var context = _fixture.CreateContext())
        {
            var service = new StaffLoginService(
                context,
                ProviderFor("ctrl", "pw-123456", world.ExternalSubject, "Cross-Tenant Controller"),
                issuer);

            var refused = await service.LoginAsync(new StaffLoginRequest
            {
                Username = "ctrl",
                Secret = "pw-123456",
                ExerciseId = world.OtherCustomerExercise.Id.ToString(),
            });

            refused.Outcome.Should().Be(
                StaffLoginOutcome.NotAssigned,
                "a staff human authenticating INTO another customer's exercise must fail closed with no "
                + "session — credentials that are valid for customer X must not become valid for customer Y");
        }

        issuer.IssueCount.Should().Be(
            0, "no session may be minted for a cross-customer login — a 403 that still issued a token would "
            + "be the whole tenant boundary defeated");

        // Positive control: the same credentials, on their own organization's exercise, still work.
        await using (var context = _fixture.CreateContext())
        {
            var service = new StaffLoginService(
                context,
                ProviderFor("ctrl", "pw-123456", world.ExternalSubject, "Cross-Tenant Controller"),
                issuer);

            var allowed = await service.LoginAsync(new StaffLoginRequest
            {
                Username = "ctrl",
                Secret = "pw-123456",
                ExerciseId = world.OwnExercise.Id.ToString(),
            });

            allowed.Outcome.Should().Be(
                StaffLoginOutcome.Authenticated,
                "the bound must be a partition, not a blanket denial, or the refusal above proves nothing");
        }

        issuer.IssueCount.Should().Be(1, "exactly the in-tenant login issued a session");
    }

    [RequiresDockerFact]
    public async Task StaffLogin_DoesNotReHomeAnExistingStaffHumanOntoTheExercisesCustomer()
    {
        // The quiet version of the leak: a routine login silently moving a human across a customer boundary
        // would make the very next request legitimately cross-tenant, with nothing in the audit trail.
        var world = await SeedCrossTenantWorldAsync();

        await using (var context = _fixture.CreateContext())
        {
            var service = new StaffLoginService(
                context,
                ProviderFor("ctrl", "pw-123456", world.ExternalSubject, "Cross-Tenant Controller"),
                new RecordingSessionIssuer());

            await service.LoginAsync(new StaffLoginRequest
            {
                Username = "ctrl",
                Secret = "pw-123456",
                ExerciseId = world.OtherCustomerExercise.Id.ToString(),
            });
        }

        await using var read = _fixture.CreateContext();
        var organizationId = await read.StaffUsers
            .AsNoTracking()
            .Where(u => u.Id == world.StaffUserId)
            .Select(u => u.OrganizationId)
            .SingleAsync();

        organizationId.Should().Be(
            world.OwnOrganizationId,
            "the refreshed identity keeps DisplayName/Username current but must NEVER re-home the tenant — "
            + "re-homing on login would turn a refused cross-customer attempt into a permanent one");
    }

    [RequiresDockerFact]
    public async Task StaffLogin_EmitsAFailureTelemetryEvent_ForTheCrossCustomerRefusal()
    {
        var world = await SeedCrossTenantWorldAsync();

        await using (var context = _fixture.CreateContext())
        {
            var service = new StaffLoginService(
                context,
                ProviderFor("ctrl", "pw-123456", world.ExternalSubject, "Cross-Tenant Controller"),
                new RecordingSessionIssuer());

            await service.LoginAsync(new StaffLoginRequest
            {
                Username = "ctrl",
                Secret = "pw-123456",
                ExerciseId = world.OtherCustomerExercise.Id.ToString(),
            });
        }

        await using var read = _fixture.CreateContext();
        var events = await read.TelemetryEvents
            .IgnoreQueryFilters()
            .Where(e => e.ExerciseId == world.OtherCustomerExercise.Id && e.EventType == "login")
            .ToListAsync();

        events.Should().ContainSingle(
            "a cross-customer login attempt is exactly the thing an operator must be able to see afterwards "
            + "(XC-004: emit on login failure as well as success) — and exactly one event, not two");
    }

    // ==========================================================================================
    // Fixture.
    // ==========================================================================================

    private static DynamisIdentityProvider ProviderFor(string username, string secret, string subject, string displayName) =>
        new(Options.Create(new DynamisIdentityProviderOptions
        {
            Accounts = new List<DynamisStaffAccount>
            {
                new() { Username = username, Secret = secret, ExternalSubject = subject, DisplayName = displayName },
            },
        }));

    /// <summary>
    /// Two customers, one exercise each, and ONE staff human who belongs to customer X but carries a
    /// <see cref="StaffAssignment"/> to BOTH runs. That last part is the adversarial bit: before AC3 the
    /// assignment alone was sufficient, so a fixture without it would pass every test below vacuously.
    /// </summary>
    private async Task<CrossTenantWorld> SeedCrossTenantWorldAsync()
    {
        var ownOrganizationId = Guid.NewGuid();
        var otherOrganizationId = Guid.NewGuid();
        var staffUserId = Guid.NewGuid();
        var externalSubject = $"idp|{staffUserId:N}";

        var ownExercise = NewExercise(ownOrganizationId, "Own Customer Run");
        var otherCustomerExercise = NewExercise(otherOrganizationId, "Other Customer Run");

        await using var seed = _fixture.CreateContext();

        seed.Organizations.Add(new Organization
        {
            Id = ownOrganizationId,
            Name = $"Customer X {ownOrganizationId:N}",
            CreatedAt = DateTimeOffset.UtcNow,
        });
        seed.Organizations.Add(new Organization
        {
            Id = otherOrganizationId,
            Name = $"Customer Y {otherOrganizationId:N}",
            CreatedAt = DateTimeOffset.UtcNow,
        });
        seed.Exercises.Add(ownExercise);
        seed.Exercises.Add(otherCustomerExercise);
        seed.StaffUsers.Add(new StaffUser
        {
            Id = staffUserId,
            OrganizationId = ownOrganizationId,
            ExternalSubject = externalSubject,
            DisplayName = "Cross-Tenant Controller",
            CreatedAt = DateTimeOffset.UtcNow,
        });
        seed.StaffAssignments.Add(NewAssignment(staffUserId, ownExercise.Id));
        seed.StaffAssignments.Add(NewAssignment(staffUserId, otherCustomerExercise.Id));
        await seed.SaveChangesAsync();

        return new CrossTenantWorld(
            ownOrganizationId, staffUserId, externalSubject, ownExercise, otherCustomerExercise);
    }

    private async Task<Guid> SeedStaffSessionAsync(Guid staffUserId, Guid exerciseId)
    {
        var sessionId = Guid.NewGuid();

        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(new Session
        {
            Id = sessionId,
            TokenHash = $"hash_{sessionId:N}",
            Kind = "staff",
            ExerciseId = exerciseId,
            PrincipalId = staffUserId.ToString(),
            StaffUserId = staffUserId,
            Role = "controller",
            ActingHumanId = staffUserId.ToString(),
            IsReadOnly = false,
            IssuedAt = DateTimeOffset.UtcNow,
            ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
        });
        await seed.SaveChangesAsync();

        return sessionId;
    }

    private static Exercise NewExercise(Guid organizationId, string name) => new()
    {
        Id = Guid.NewGuid(),
        OrganizationId = organizationId,
        Name = $"{name} {Guid.NewGuid():N}",
        TimeZone = "America/Chicago",
        Status = "active",
    };

    private static StaffAssignment NewAssignment(Guid staffUserId, Guid exerciseId) => new()
    {
        Id = Guid.NewGuid(),
        StaffUserId = staffUserId,
        ExerciseId = exerciseId,
        Role = "controller",
        CreatedAt = DateTimeOffset.UtcNow,
    };

    private sealed record CrossTenantWorld(
        Guid OwnOrganizationId,
        Guid StaffUserId,
        string ExternalSubject,
        Exercise OwnExercise,
        Exercise OtherCustomerExercise);
}
