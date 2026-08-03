namespace Pulse.WebApi.Tests.Data;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// exercise-isolation/11 (Tier-2, COR-001 / COR-010) — the CROSS-ORGANIZATION half of the standing isolation
/// suite, against a REAL SQL Server. The sibling of <see cref="QueryFilterIsolationTests"/> one tier out: it
/// gives the CUSTOMER-tenant boundary the same fail-closed proof the exercise boundary has.
/// </summary>
/// <remarks>
/// <para>
/// <b>Every test seeds TWO customers</b> and asserts, at the database, that:
/// </para>
/// <list type="bullet">
///   <item><description>a query in organization X returns none of organization Y's exercises, persona
///   templates or accounts (AC-XC1);</description></item>
///   <item><description>an UNRESOLVED tenant returns ZERO rows — fail closed, never every customer;</description></item>
///   <item><description><c>IgnoreQueryFilters()</c> / an unbounded read reveals the other customer's rows DO
///   exist, so a zero is the door closing and not an empty table (the anti-vacuity control every one of
///   these tests carries);</description></item>
///   <item><description>a persona template IS shared across its OWN organization's exercises and NOT across
///   organizations — story 11's "gap 2", the latent cross-customer library leak, closed (AC2);</description></item>
///   <item><description>a staff user's reachable exercises are org-bounded (AC3).</description></item>
/// </list>
/// <para>
/// <b>The two axes are proved SEPARATELY, on purpose.</b> The org tier is additive: it must never be able to
/// stand in for the exercise tier, and the exercise tier must not have been weakened to make room for it.
/// <see cref="TwoExercisesInTheSAMEOrganization_AreStillFullyIsolatedFromEachOther"/> is the regression fence
/// for the second half of that — the always-Critical participant guarantee, re-proved with a shared tenant
/// underneath it.
/// </para>
/// <para>
/// <see cref="RequiresDockerFactAttribute"/> throughout (a real <c>Skipped</c>, never a silent <c>Passed</c>,
/// on a machine with neither Docker nor <c>PULSE_TEST_SQL_CONNECTION</c>). Fresh
/// <see cref="Guid.NewGuid"/> ids per test keep them independent without truncating tables.
/// </para>
/// </remarks>
[Collection(MsSqlCollection.Name)]
public class OrganizationIsolationTests
{
    private readonly MsSqlContainerFixture _fixture;

    public OrganizationIsolationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // ==========================================================================================
    // AC-XC1 — a query in organization X returns none of organization Y's ...
    // ==========================================================================================

    [RequiresDockerFact]
    public async Task ExerciseQuery_InOrganizationX_ReturnsNoneOfOrganizationYsExercises()
    {
        var (orgX, orgY) = await SeedTwoOrganizationsAsync();
        var exerciseX = Guid.NewGuid();
        var exerciseY = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Exercises.Add(NewExercise(exerciseX, orgX));
            seed.Exercises.Add(NewExercise(exerciseY, orgY));
            await seed.SaveChangesAsync();
        }

        await using var read = _fixture.CreateContext();

        var visible = await read.Exercises
            .Where(e => e.Id == exerciseX || e.Id == exerciseY)
            .InOrganization(orgX)
            .Select(e => e.Id)
            .ToListAsync();

        visible.Should().ContainSingle().Which.Should().Be(
            exerciseX, "a tenant-bounded exercise listing in organization X must never surface organization "
            + "Y's run — that is the cross-CUSTOMER analogue of the COR-001 leak");

        // Anti-vacuity control: prove Y's row is really there, so the single result above is the bound
        // working rather than an empty table.
        var both = await read.Exercises
            .Where(e => e.Id == exerciseX || e.Id == exerciseY)
            .CountAsync();
        both.Should().Be(
            2, "both exercises must physically exist — otherwise the assertion above would pass on an empty "
            + "table and prove nothing at all");
    }

    [RequiresDockerFact]
    public async Task PersonaTemplateQuery_InOrganizationX_ReturnsNoneOfOrganizationYsTemplates()
    {
        var (orgX, orgY) = await SeedTwoOrganizationsAsync();
        var templateX = Guid.NewGuid();
        var templateY = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.PersonaTemplates.Add(NewTemplate(templateX, orgX));
            seed.PersonaTemplates.Add(NewTemplate(templateY, orgY));
            await seed.SaveChangesAsync();
        }

        // The org axis here is the CENTRAL global query filter (PersonaTemplate is IOrganizationScoped) — no
        // per-query bound is written, which is exactly the point: nobody can forget it.
        await using var readX = _fixture.CreateContextForOrganization(orgX);

        var visible = await readX.PersonaTemplates
            .Where(t => t.Id == templateX || t.Id == templateY)
            .Select(t => t.Id)
            .ToListAsync();

        visible.Should().ContainSingle().Which.Should().Be(
            templateX, "story 11's gap 2: the persona-template library is org-owned, so one customer's "
            + "authored templates must be invisible to another customer");

        var ignoringFilters = await readX.PersonaTemplates
            .IgnoreQueryFilters()
            .Where(t => t.Id == templateX || t.Id == templateY)
            .CountAsync();

        ignoringFilters.Should().Be(
            2, "IgnoreQueryFilters must reveal BOTH templates — that is what makes the single visible row "
            + "above a filter closing the door, not an empty table");
    }

    [RequiresDockerFact]
    public async Task AccountQuery_InOrganizationXsExercise_ReturnsNoneOfOrganizationYsAccounts()
    {
        // Account is IExerciseScoped, NOT IOrganizationOwned — deliberately (see IOrganizationOwned's
        // remarks: a redundant OrganizationId would be a second copy of the truth that could drift from
        // Exercise.OrganizationId). Its cross-CUSTOMER bound is therefore TRANSITIVE, and this test proves
        // the transitive claim actually holds end to end rather than assuming it.
        var (orgX, orgY) = await SeedTwoOrganizationsAsync();
        var exerciseX = Guid.NewGuid();
        var exerciseY = Guid.NewGuid();
        var accountX = Guid.NewGuid();
        var accountY = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Exercises.Add(NewExercise(exerciseX, orgX));
            seed.Exercises.Add(NewExercise(exerciseY, orgY));
            seed.Accounts.Add(NewAccount(accountX, exerciseX));
            seed.Accounts.Add(NewAccount(accountY, exerciseY));
            await seed.SaveChangesAsync();
        }

        await using var readX = _fixture.CreateContext(ScopeFor(exerciseX));

        var visible = await readX.Accounts
            .Where(a => a.Id == accountX || a.Id == accountY)
            .Select(a => a.Id)
            .ToListAsync();

        visible.Should().ContainSingle().Which.Should().Be(
            accountX, "a caller confined to organization X's exercise must not reach organization Y's "
            + "account — the exercise filter carries the tenant bound transitively, because an exercise "
            + "belongs to exactly one organization");

        // IDOR: naming the other customer's account id directly must still resolve to nothing.
        var idor = await readX.Accounts.FirstOrDefaultAsync(a => a.Id == accountY);
        idor.Should().BeNull(
            "an IDOR by another CUSTOMER's account id must fail closed, not merely be absent from a list");

        var ignoringFilters = await readX.Accounts
            .IgnoreQueryFilters()
            .Where(a => a.Id == accountX || a.Id == accountY)
            .CountAsync();
        ignoringFilters.Should().Be(
            2, "both accounts must physically exist — otherwise the two assertions above are vacuous");
    }

    // ==========================================================================================
    // Fail closed — an unresolved tenant reaches NOTHING, never everything.
    // ==========================================================================================

    [RequiresDockerFact]
    public async Task UnresolvedOrganization_SeesZeroPersonaTemplates_NeverEveryCustomers()
    {
        var (orgX, orgY) = await SeedTwoOrganizationsAsync();
        var templateX = Guid.NewGuid();
        var templateY = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.PersonaTemplates.Add(NewTemplate(templateX, orgX));
            seed.PersonaTemplates.Add(NewTemplate(templateY, orgY));
            await seed.SaveChangesAsync();
        }

        // No IOrganizationContext at all — the "unregistered / unset" shape, which collapses to Guid.Empty.
        await using var unresolved = _fixture.CreateContext();

        var visible = await unresolved.PersonaTemplates
            .Where(t => t.Id == templateX || t.Id == templateY)
            .CountAsync();

        visible.Should().Be(
            0, "an unresolved tenant must match ZERO library rows. The dangerous inversion — 'no organization "
            + "resolved means see everything' — would hand every customer's authored library to any caller "
            + "on a path that simply forgot to set the scope");

        var ignoringFilters = await unresolved.PersonaTemplates
            .IgnoreQueryFilters()
            .Where(t => t.Id == templateX || t.Id == templateY)
            .CountAsync();
        ignoringFilters.Should().Be(
            2, "both templates exist — the zero above is the filter failing closed, not an empty table");
    }

    [RequiresDockerFact]
    public async Task UnresolvedOrganization_SeesZeroExercises_ThroughTheResolutionConstraint()
    {
        var (orgX, orgY) = await SeedTwoOrganizationsAsync();
        var exerciseX = Guid.NewGuid();
        var exerciseY = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Exercises.Add(NewExercise(exerciseX, orgX));
            seed.Exercises.Add(NewExercise(exerciseY, orgY));
            await seed.SaveChangesAsync();
        }

        await using var read = _fixture.CreateContext();

        var nullTenant = await read.Exercises
            .Where(e => e.Id == exerciseX || e.Id == exerciseY)
            .InOrganization(null)
            .CountAsync();
        nullTenant.Should().Be(
            0, "InOrganization(null) means 'no tenant resolved' and must match nothing — the constraint is "
            + "the fail-closed half of the mechanism for the entities a global filter cannot cover");

        var emptyTenant = await read.Exercises
            .Where(e => e.Id == exerciseX || e.Id == exerciseY)
            .InOrganization(Guid.Empty)
            .CountAsync();
        emptyTenant.Should().Be(
            0, "the Guid.Empty sentinel must match nothing either — GuardOrganizationScope guarantees no "
            + "persisted row carries it, which is precisely what makes it a usable 'no tenant' value");

        var unbounded = await read.Exercises
            .Where(e => e.Id == exerciseX || e.Id == exerciseY)
            .CountAsync();
        unbounded.Should().Be(
            2, "without the constraint BOTH rows are visible — that contrast is the whole proof that "
            + "InOrganization is doing the work, and it is also why forgetting it is a real leak (which is "
            + "what OrganizationScopeSweepTests exists to make impossible)");
    }

    [RequiresDockerFact]
    public async Task CrossOrganizationIdorByExerciseId_FailsClosed()
    {
        var (orgX, orgY) = await SeedTwoOrganizationsAsync();
        var exerciseY = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Exercises.Add(NewExercise(exerciseY, orgY));
            await seed.SaveChangesAsync();
        }

        await using var read = _fixture.CreateContext();

        // The caller knows organization Y's exercise id exactly and is bounded to organization X.
        var stolen = await read.Exercises
            .InOrganization(orgX)
            .FirstOrDefaultAsync(e => e.Id == exerciseY);

        stolen.Should().BeNull(
            "a direct lookup by another CUSTOMER's exercise id, bounded to the caller's own tenant, must "
            + "return null — knowing the id must not be sufficient");

        var exists = await read.Exercises.FirstOrDefaultAsync(e => e.Id == exerciseY);
        exists.Should().NotBeNull(
            "the row must genuinely exist, or the null above proves nothing");
    }

    [RequiresDockerFact]
    public async Task CrossOrganizationAggregateCount_DoesNotLeakTheOtherCustomersSize()
    {
        var (orgX, orgY) = await SeedTwoOrganizationsAsync();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Exercises.Add(NewExercise(Guid.NewGuid(), orgX));
            seed.Exercises.Add(NewExercise(Guid.NewGuid(), orgY));
            seed.Exercises.Add(NewExercise(Guid.NewGuid(), orgY));
            seed.Exercises.Add(NewExercise(Guid.NewGuid(), orgY));
            await seed.SaveChangesAsync();
        }

        await using var read = _fixture.CreateContext();

        var countX = await read.Exercises.InOrganization(orgX).CountAsync();
        var countY = await read.Exercises.InOrganization(orgY).CountAsync();

        countX.Should().Be(
            1, "an aggregate must be computed over the caller's tenant alone — a count that includes another "
            + "customer's rows discloses their scale even when no row is readable");
        countY.Should().Be(
            3, "and the other tenant's own count must be intact, so the bound is a partition and not a "
            + "blanket zero that would pass this test for the wrong reason");
    }

    // ==========================================================================================
    // AC2 — shared across an ORGANIZATION's exercises, not across organizations (XC-005, one tier in).
    // ==========================================================================================

    [RequiresDockerFact]
    public async Task PersonaTemplate_IsSharedAcrossAllOfItsOwnOrganizationsExercises()
    {
        var (orgX, orgY) = await SeedTwoOrganizationsAsync();
        var exerciseOne = Guid.NewGuid();
        var exerciseTwo = Guid.NewGuid();
        var templateX = Guid.NewGuid();
        var templateY = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            // Two DIFFERENT exercise runs, both owned by organization X.
            seed.Exercises.Add(NewExercise(exerciseOne, orgX));
            seed.Exercises.Add(NewExercise(exerciseTwo, orgX));
            seed.PersonaTemplates.Add(NewTemplate(templateX, orgX));
            seed.PersonaTemplates.Add(NewTemplate(templateY, orgY));
            await seed.SaveChangesAsync();
        }

        // Read the library from INSIDE each of organization X's runs. XC-005 says the template is reusable
        // across runs; story 11 narrows that to "across THIS CUSTOMER's runs" and must not narrow it further.
        foreach (var exerciseId in new[] { exerciseOne, exerciseTwo })
        {
            await using var read = _fixture.CreateContext(
                ScopeFor(exerciseId),
                new OrganizationContext { CurrentOrganizationId = orgX });

            var visible = await read.PersonaTemplates
                .Where(t => t.Id == templateX || t.Id == templateY)
                .Select(t => t.Id)
                .ToListAsync();

            visible.Should().ContainSingle().Which.Should().Be(
                templateX, "the template must stay visible from EVERY exercise run of its owning "
                + "organization (XC-005 reuse, preserved), while organization Y's template stays invisible "
                + "— shared across the customer's runs, and no further");
        }
    }

    [RequiresDockerFact]
    public async Task PersonaTemplate_IsNotSharedAcrossOrganizations_EvenFromAnExerciseScopedRead()
    {
        var (orgX, orgY) = await SeedTwoOrganizationsAsync();
        var exerciseY = Guid.NewGuid();
        var templateX = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Exercises.Add(NewExercise(exerciseY, orgY));
            seed.PersonaTemplates.Add(NewTemplate(templateX, orgX));
            await seed.SaveChangesAsync();
        }

        // Organization Y's run, correctly scoped to organization Y, asking for organization X's template
        // by its exact id.
        await using var read = _fixture.CreateContext(
            ScopeFor(exerciseY),
            new OrganizationContext { CurrentOrganizationId = orgY });

        var stolen = await read.PersonaTemplates.FirstOrDefaultAsync(t => t.Id == templateX);
        stolen.Should().BeNull(
            "before story 11 this returned the row: PersonaTemplate was globally unfiltered, so every "
            + "customer's authored library was readable by every other customer. That is gap 2, and this is "
            + "the assertion that keeps it closed");

        var exists = await read.PersonaTemplates.IgnoreQueryFilters().AnyAsync(t => t.Id == templateX);
        exists.Should().BeTrue(
            "the template must genuinely exist, or the null above is an empty-table false positive");
    }

    // ==========================================================================================
    // AC3 — a staff user's reachable exercises are org-bounded.
    // ==========================================================================================

    [RequiresDockerFact]
    public async Task StaffUsersReachableExercises_AreBoundedByTheirOwnOrganization()
    {
        var (orgX, orgY) = await SeedTwoOrganizationsAsync();
        var staffUserId = Guid.NewGuid();
        var exerciseX = Guid.NewGuid();
        var exerciseY = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Exercises.Add(NewExercise(exerciseX, orgX));
            seed.Exercises.Add(NewExercise(exerciseY, orgY));
            seed.StaffUsers.Add(new StaffUser
            {
                Id = staffUserId,
                OrganizationId = orgX,
                ExternalSubject = $"idp|{staffUserId:N}",
                DisplayName = "Cross-Tenant Controller",
                CreatedAt = DateTimeOffset.UtcNow,
            });

            // The adversarial fixture: this human is ASSIGNED to both runs, including one belonging to a
            // DIFFERENT customer. Assignment alone must no longer be sufficient — that is exactly AC3.
            seed.StaffAssignments.Add(NewAssignment(staffUserId, exerciseX));
            seed.StaffAssignments.Add(NewAssignment(staffUserId, exerciseY));
            await seed.SaveChangesAsync();
        }

        await using var read = _fixture.CreateContext();

        var callerOrganizationId = await read.StaffUsers
            .AsNoTracking()
            .Where(u => u.Id == staffUserId)
            .Select(u => (Guid?)u.OrganizationId)
            .FirstOrDefaultAsync();

        // The shape StaffAssignmentService.GetAssignmentsAsync uses.
        var reachable = await (
            from a in read.StaffAssignments.AsNoTracking()
            where a.StaffUserId == staffUserId
            join e in read.Exercises.AsNoTracking().InOrganization(callerOrganizationId) on a.ExerciseId equals e.Id
            select a.ExerciseId).ToListAsync();

        reachable.Should().ContainSingle().Which.Should().Be(
            exerciseX, "a staff human spans EXERCISES but never CUSTOMERS: an assignment pointing at another "
            + "organization's run must not make it reachable, even though the StaffAssignment row exists");

        var unbounded = await (
            from a in read.StaffAssignments.AsNoTracking()
            where a.StaffUserId == staffUserId
            join e in read.Exercises.AsNoTracking() on a.ExerciseId equals e.Id
            select a.ExerciseId).ToListAsync();

        unbounded.Should().HaveCount(
            2, "WITHOUT the tenant bound both assignments join successfully — that contrast is the proof "
            + "that InOrganization is what removes the cross-customer one, not a missing fixture row");
    }

    [RequiresDockerFact]
    public async Task StaffUserWithNoRow_ReachesNoExercisesAtAll_RatherThanAllOfThem()
    {
        var (orgX, _) = await SeedTwoOrganizationsAsync();
        var ghostStaffUserId = Guid.NewGuid();
        var exerciseX = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Exercises.Add(NewExercise(exerciseX, orgX));

            // An assignment whose StaffUser row does not exist. Production cannot produce this (login
            // creates the human before any session names them), but the resolution must still fail CLOSED.
            seed.StaffAssignments.Add(NewAssignment(ghostStaffUserId, exerciseX));
            await seed.SaveChangesAsync();
        }

        await using var read = _fixture.CreateContext();

        var callerOrganizationId = await read.StaffUsers
            .AsNoTracking()
            .Where(u => u.Id == ghostStaffUserId)
            .Select(u => (Guid?)u.OrganizationId)
            .FirstOrDefaultAsync();

        callerOrganizationId.Should().BeNull("there is no staff row, so no tenant can be resolved");

        var reachable = await (
            from a in read.StaffAssignments.AsNoTracking()
            where a.StaffUserId == ghostStaffUserId
            join e in read.Exercises.AsNoTracking().InOrganization(callerOrganizationId) on a.ExerciseId equals e.Id
            select a.ExerciseId).ToListAsync();

        reachable.Should().BeEmpty(
            "an unresolvable caller tenant must collapse to zero reachable exercises. The failure mode this "
            + "guards is the tempting 'no organization known, so don't filter' fallback, which would hand an "
            + "unidentifiable session every customer's runs");
    }

    // ==========================================================================================
    // The exercise axis is UNTOUCHED — the org tier is additive, never a substitute.
    // ==========================================================================================

    [RequiresDockerFact]
    public async Task TwoExercisesInTheSAMEOrganization_AreStillFullyIsolatedFromEachOther()
    {
        // The always-Critical guarantee, re-proved with a shared tenant underneath it. If anyone ever
        // "simplifies" the exercise axis into the coarser org axis, this is the test that refuses.
        var (orgX, _) = await SeedTwoOrganizationsAsync();
        var exerciseOne = Guid.NewGuid();
        var exerciseTwo = Guid.NewGuid();
        var accountOne = Guid.NewGuid();
        var accountTwo = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Exercises.Add(NewExercise(exerciseOne, orgX));
            seed.Exercises.Add(NewExercise(exerciseTwo, orgX));
            seed.Accounts.Add(NewAccount(accountOne, exerciseOne));
            seed.Accounts.Add(NewAccount(accountTwo, exerciseTwo));
            await seed.SaveChangesAsync();
        }

        // Same organization on BOTH axes — so only the exercise filter can separate these two.
        await using var read = _fixture.CreateContext(
            ScopeFor(exerciseOne),
            new OrganizationContext { CurrentOrganizationId = orgX });

        var visible = await read.Accounts
            .Where(a => a.Id == accountOne || a.Id == accountTwo)
            .Select(a => a.Id)
            .ToListAsync();

        visible.Should().ContainSingle().Which.Should().Be(
            accountOne, "two exercises are isolated from each other WHETHER OR NOT they share an "
            + "organization — the tenant tier is a coarser boundary and must never be allowed to stand in "
            + "for the per-exercise participant guarantee (COR-001 / XC-001)");
    }

    // ==========================================================================================
    // Write-time guard — no row can be persisted without a customer.
    // ==========================================================================================

    [RequiresDockerFact]
    public async Task WriteGuard_RefusesAnExerciseWithNoOrganization()
    {
        await using var write = _fixture.CreateContext();
        write.Exercises.Add(new Exercise
        {
            Id = Guid.NewGuid(),
            OrganizationId = Guid.Empty,
            Name = "Orphan Exercise",
            TimeZone = "UTC",
            Status = "live",
        });

        var act = async () => await write.SaveChangesAsync();

        await act.Should().ThrowAsync<OrganizationScopeViolationException>(
            "an exercise owned by no customer is unreachable by every org-bounded surface and could never be "
            + "administered — and it is what makes Guid.Empty a safe 'no tenant' sentinel on both read paths");
    }

    [RequiresDockerFact]
    public async Task WriteGuard_RefusesAPersonaTemplateWithNoOrganization()
    {
        var templateId = Guid.NewGuid();

        await using var write = _fixture.CreateContext();
        write.PersonaTemplates.Add(new PersonaTemplate
        {
            Id = templateId,
            OrganizationId = Guid.Empty,
            DisplayName = "Orphan Template",
            Handle = $"@t_{templateId:N}",
        });

        var act = async () => await write.SaveChangesAsync();

        await act.Should().ThrowAsync<OrganizationScopeViolationException>(
            "a library asset owned by no customer would be permanently invisible behind the org filter — the "
            + "write guard is what keeps the fail-closed sentinel unmatchable by any real row");
    }

    [RequiresDockerFact]
    public async Task WriteGuard_RefusesAStaffUserWithNoOrganization()
    {
        var staffUserId = Guid.NewGuid();

        await using var write = _fixture.CreateContext();
        write.StaffUsers.Add(new StaffUser
        {
            Id = staffUserId,
            OrganizationId = Guid.Empty,
            ExternalSubject = $"idp|{staffUserId:N}",
            DisplayName = "Orphan Staff User",
            CreatedAt = DateTimeOffset.UtcNow,
        });

        var act = async () => await write.SaveChangesAsync();

        await act.Should().ThrowAsync<OrganizationScopeViolationException>(
            "StaffUser carries no read filter (it is a resolution root), so this write guard is the ONLY "
            + "structural thing stopping a staff human who belongs to no customer and can reach nothing");
    }

    // ==========================================================================================
    // Fixtures.
    // ==========================================================================================

    private static IExerciseContext ScopeFor(Guid exerciseId) =>
        new ExerciseContext { CurrentExerciseId = exerciseId };

    /// <summary>
    /// Seeds two fresh customer tenants per test. Fresh ids (not
    /// <see cref="Organization.DefaultOrganizationId"/>) keep the suites independent on the shared database
    /// and keep these tests honest: nothing here may depend on the well-known default row existing.
    /// </summary>
    private async Task<(Guid OrgX, Guid OrgY)> SeedTwoOrganizationsAsync()
    {
        var orgX = Guid.NewGuid();
        var orgY = Guid.NewGuid();

        await using var seed = _fixture.CreateContext();
        seed.Organizations.Add(new Organization
        {
            Id = orgX,
            Name = $"Customer X {orgX:N}",
            CreatedAt = DateTimeOffset.UtcNow,
        });
        seed.Organizations.Add(new Organization
        {
            Id = orgY,
            Name = $"Customer Y {orgY:N}",
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();

        return (orgX, orgY);
    }

    private static Exercise NewExercise(Guid id, Guid organizationId) => new()
    {
        Id = id,
        OrganizationId = organizationId,
        Name = $"Exercise {id:N}",
        TimeZone = "UTC",
        Status = "live",
    };

    private static PersonaTemplate NewTemplate(Guid id, Guid organizationId) => new()
    {
        Id = id,
        OrganizationId = organizationId,
        DisplayName = $"Template {id:N}",
        Handle = $"@t_{id:N}",
    };

    private static Account NewAccount(Guid id, Guid exerciseId) => new()
    {
        Id = id,
        ExerciseId = exerciseId,
        Username = $"user_{id:N}",
        DisplayName = $"Account {id:N}",
        Role = "participant",
        CreatedAt = DateTimeOffset.UtcNow,
    };

    private static StaffAssignment NewAssignment(Guid staffUserId, Guid exerciseId) => new()
    {
        Id = Guid.NewGuid(),
        StaffUserId = staffUserId,
        ExerciseId = exerciseId,
        Role = "controller",
        CreatedAt = DateTimeOffset.UtcNow,
    };
}
