namespace Pulse.WebApi.Tests.Features.Ops.Bootstrap;

using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Accounts;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Features.Identity.SharedAccess;
using Pulse.WebApi.Features.Ops.Bootstrap;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// exercise-isolation/11 — <see cref="BootstrapService"/> under the CUSTOMER-tenant tier. Bootstrap is the one
/// path that can seed an EMPTY database, and it now writes two <see cref="IOrganizationOwned"/> entity types
/// whose write guard refuses an empty tenant — so if it did not resolve an <see cref="Organization"/> first,
/// UAT provisioning would throw instead of seeding.
/// </summary>
/// <remarks>
/// <para>
/// Three properties are load-bearing and each has a test here: (1) a fresh database gets the well-known
/// DEFAULT tenant and everything homes onto it; (2) re-running mints no SECOND tenant — the unique name index
/// would reject it and fail the whole bootstrap; (3) a REUSED exercise keeps its OWN tenant and never gets
/// re-homed onto the default, which is the safe direction across a customer boundary and the same
/// non-clobbering rule this service applies to every other reused row.
/// </para>
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class BootstrapOrganizationTests
{
    private const string Secret = "s3cr3t-bootstrap-value";

    private readonly MsSqlContainerFixture _fixture;
    private readonly SharedCredentialHasher _sharedHasher = new();
    private readonly ParticipantPasswordHasher _participantHasher = new();

    public BootstrapOrganizationTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task Bootstrap_EmptyDatabase_HomesTheExerciseOnTheWellKnownDefaultOrganization()
    {
        var host = NewHostname();

        await using (var context = _fixture.CreateContext())
        {
            var result = await NewService(context).BootstrapAsync(
                new BootstrapExerciseRequest { Hostname = host, ExerciseName = "UAT Pilot" }, Secret);

            result.Outcome.Should().Be(
                BootstrapOutcome.Provisioned,
                "bootstrap must still seed a fresh database after the tenant tier landed — the write guard "
                + "refuses an exercise with no customer, so a bootstrap that skipped resolving one would throw");
        }

        await using var read = _fixture.CreateContext();
        var exercise = await read.Exercises.AsNoTracking().SingleAsync(e => e.Hostname == host);

        exercise.OrganizationId.Should().Be(
            Organization.DefaultOrganizationId,
            "bootstrap is the single-customer seed path, so it uses the SAME well-known tenant the "
            + "OrganizationTenantBoundary migration backfills existing data onto — one 'default' concept, not two");

        (await read.Organizations.AsNoTracking().AnyAsync(o => o.Id == Organization.DefaultOrganizationId))
            .Should().BeTrue("the tenant row itself must exist, created on first use if the migration's was removed");
    }

    [RequiresDockerFact]
    public async Task Bootstrap_ProvisionedStaffUser_JoinsTheExercisesOrganization()
    {
        var host = NewHostname();
        var staff = new DynamisStaffAccount
        {
            Username = $"ctrl-{Guid.NewGuid():N}",
            Secret = "staff-secret-value",
            ExternalSubject = $"idp|{Guid.NewGuid():N}",
            DisplayName = "Controller One",
        };

        Guid staffUserId;
        await using (var context = _fixture.CreateContext())
        {
            var result = await NewService(context, staff).BootstrapAsync(
                new BootstrapExerciseRequest
                {
                    Hostname = host,
                    ExerciseName = "UAT",
                    Staff = new BootstrapStaffRequest { Username = staff.Username, Role = "controller" },
                },
                Secret);

            result.Staff.Should().NotBeNull();
            staffUserId = result.Staff!.StaffUserId;
        }

        await using var read = _fixture.CreateContext();
        var exercise = await read.Exercises.AsNoTracking().SingleAsync(e => e.Hostname == host);
        var staffUser = await read.StaffUsers.AsNoTracking().SingleAsync(u => u.Id == staffUserId);

        staffUser.OrganizationId.Should().Be(
            exercise.OrganizationId,
            "a newly-provisioned staff human joins the customer whose exercise they are being assigned to. If "
            + "the two disagreed, the org bound would refuse the very login this bootstrap exists to unblock");
    }

    [RequiresDockerFact]
    public async Task Bootstrap_ReRun_MintsNoSecondDefaultOrganization()
    {
        var firstHost = NewHostname();
        var secondHost = NewHostname();

        foreach (var host in new[] { firstHost, firstHost, secondHost })
        {
            await using var context = _fixture.CreateContext();
            var result = await NewService(context).BootstrapAsync(
                new BootstrapExerciseRequest { Hostname = host, ExerciseName = "UAT" }, Secret);
            result.Outcome.Should().Be(BootstrapOutcome.Provisioned, "every one of these calls must succeed");
        }

        await using var read = _fixture.CreateContext();
        var defaults = await read.Organizations
            .AsNoTracking()
            .CountAsync(o => o.Id == Organization.DefaultOrganizationId);

        defaults.Should().Be(
            1, "the tenant is resolved by a FIXED id, so a re-run (same host) and a new exercise (new host) "
            + "both reuse the one row. A second 'Default Organization' could not even be inserted — the "
            + "unique name index would reject it and take the whole bootstrap down with it");
    }

    [RequiresDockerFact]
    public async Task Bootstrap_ReusedExercise_KeepsItsOwnTenant_AndIsNeverReHomedOntoTheDefault()
    {
        var host = NewHostname();
        var customerOrganizationId = Guid.NewGuid();
        var exerciseId = Guid.NewGuid();

        // A pre-existing exercise belonging to a REAL customer, not the default tenant.
        await using (var seed = _fixture.CreateContext())
        {
            seed.Organizations.Add(new Organization
            {
                Id = customerOrganizationId,
                Name = $"Real Customer {customerOrganizationId:N}",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            seed.Exercises.Add(new Exercise
            {
                Id = exerciseId,
                OrganizationId = customerOrganizationId,
                Name = "Customer's Own Run",
                Hostname = host,
                TimeZone = "UTC",
                Status = "live",
            });
            await seed.SaveChangesAsync();
        }

        var staff = new DynamisStaffAccount
        {
            Username = $"ctrl-{Guid.NewGuid():N}",
            Secret = "staff-secret-value",
            ExternalSubject = $"idp|{Guid.NewGuid():N}",
            DisplayName = "Controller One",
        };

        Guid staffUserId;
        await using (var context = _fixture.CreateContext())
        {
            var result = await NewService(context, staff).BootstrapAsync(
                new BootstrapExerciseRequest
                {
                    Hostname = host,
                    ExerciseName = "Ignored On Re-Run",
                    Staff = new BootstrapStaffRequest { Username = staff.Username, Role = "controller" },
                },
                Secret);

            result.ExerciseCreated.Should().BeFalse("the hostname already resolves");
            result.ExerciseId.Should().Be(exerciseId);
            staffUserId = result.Staff!.StaffUserId;
        }

        await using var read = _fixture.CreateContext();

        (await read.Exercises.AsNoTracking().SingleAsync(e => e.Id == exerciseId)).OrganizationId
            .Should().Be(
                customerOrganizationId,
                "silently moving a customer's exercise onto another tenant is the worst thing this endpoint "
                + "could do — a reused row keeps its own tenant, exactly as it keeps its own name");

        (await read.StaffUsers.AsNoTracking().SingleAsync(u => u.Id == staffUserId)).OrganizationId
            .Should().Be(
                customerOrganizationId,
                "and the staff human provisioned for it joins THAT customer, not the default — otherwise the "
                + "org bound would refuse them the exercise they were just assigned to");
    }

    private static string NewHostname() => $"uat-{Guid.NewGuid():N}.example.com";

    private BootstrapService NewService(PulseDbContext context, params DynamisStaffAccount[] allowlist) =>
        new(
            context,
            Options.Create(new BootstrapOptions { Secret = Secret }),
            Options.Create(new DynamisIdentityProviderOptions { Accounts = new List<DynamisStaffAccount>(allowlist) }),
            _sharedHasher,
            _participantHasher,
            new OpsPersonaResolver(context));
}
