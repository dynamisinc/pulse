namespace Pulse.WebApi.Tests.Data;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Story <c>identity-backend/B2-Wave-0</c> (schema + contract seam-freeze), COR-001/COR-011/COR-015/016 —
/// the always-Critical behavioural isolation proof for the TWO NEW <see cref="IExerciseScoped"/> entities
/// this wave added: <see cref="Account"/> (a provisioned participant login) and <see cref="SharedCredential"/>
/// (the one-per-exercise shared view-only credential). Mirrors <see cref="QueryFilterIsolationTests"/>'s
/// structure and rigor EXACTLY — real SQL Server (Testcontainers), fresh <see cref="Guid.NewGuid"/> ids per
/// test, FluentAssertions because-reasons — rather than trusting that the central reflection-driven filter
/// loop (<c>PulseDbContext.OnModelCreating</c>) which already covers <c>Persona</c>/<c>Post</c>/
/// <c>TelemetryEvent</c> also correctly covers these two: prove it directly, entity by entity, since a
/// schema mistake (e.g. a new entity silently NOT implementing <see cref="IExerciseScoped"/>) would escape
/// the reflection loop with no compiler error.
/// </summary>
[Collection(MsSqlCollection.Name)]
public class AccountAndSharedCredentialIsolationTests
{
    private readonly MsSqlContainerFixture _fixture;

    public AccountAndSharedCredentialIsolationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    private static IExerciseContext ScopeFor(Guid exerciseId) =>
        new ExerciseContext { CurrentExerciseId = exerciseId };

    private static Account NewAccount(Guid id, Guid exerciseId) => new()
    {
        Id = id,
        ExerciseId = exerciseId,
        Username = $"user_{id:N}",
        DisplayName = $"Account {id:N}",
        Role = "participant",
        CreatedAt = DateTimeOffset.UtcNow,
    };

    private static SharedCredential NewSharedCredential(Guid id, Guid exerciseId) => new()
    {
        Id = id,
        ExerciseId = exerciseId,
        IsEnabled = true,
        CreatedAt = DateTimeOffset.UtcNow,
    };

    [RequiresDockerFact]
    public async Task AccountQuery_InExerciseA_ReturnsOnlyExerciseARows()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var accountA = Guid.NewGuid();
        var accountB = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Accounts.Add(NewAccount(accountA, exerciseA));
            seed.Accounts.Add(NewAccount(accountB, exerciseB));
            await seed.SaveChangesAsync();
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));
        var visible = await readA.Accounts
            .Where(a => a.Id == accountA || a.Id == accountB)
            .Select(a => a.Id)
            .ToListAsync();

        visible.Should().ContainSingle().Which.Should().Be(
            accountA, "a query in exercise A must see only exercise A's account, never exercise B's");
    }

    [RequiresDockerFact]
    public async Task SharedCredentialQuery_InExerciseA_ReturnsOnlyExerciseARows()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var credentialA = Guid.NewGuid();
        var credentialB = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            // Exactly one credential per exercise (unique ExerciseId index) — A and B are different
            // exercises, so both rows are simultaneously valid.
            seed.SharedCredentials.Add(NewSharedCredential(credentialA, exerciseA));
            seed.SharedCredentials.Add(NewSharedCredential(credentialB, exerciseB));
            await seed.SaveChangesAsync();
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));
        var visible = await readA.SharedCredentials
            .Where(c => c.Id == credentialA || c.Id == credentialB)
            .Select(c => c.Id)
            .ToListAsync();

        visible.Should().ContainSingle().Which.Should().Be(
            credentialA,
            "a query in exercise A must see only exercise A's shared credential, never exercise B's — this is " +
            "the exact row that grants view-only login, so leaking it across exercises would leak sim access");
    }

    [RequiresDockerFact]
    public async Task UnsetScope_NullAccessor_ReturnsZeroRows_FailClosed()
    {
        var (accountId, credentialId) = await SeedOneOfEachAsync();

        // Fail-closed (always-Critical): a context with NO IExerciseContext at all captures Guid.Empty, which
        // the write-guard guarantees no scoped row can carry — so it must see NOTHING, not everything.
        await using var read = _fixture.CreateContext((IExerciseContext?)null);

        (await read.Accounts.CountAsync(a => a.Id == accountId)).Should().Be(
            0, "a null exercise accessor scopes to Guid.Empty, which matches no scoped Account row — fail closed");
        (await read.SharedCredentials.CountAsync(c => c.Id == credentialId)).Should().Be(
            0, "a null exercise accessor scopes to Guid.Empty, which matches no scoped SharedCredential row — fail closed");

        await AssertRowsPhysicallyExistAsync(accountId, credentialId);
    }

    [RequiresDockerFact]
    public async Task UnsetScope_NullCurrentExerciseId_ReturnsZeroRows_FailClosed()
    {
        var (accountId, credentialId) = await SeedOneOfEachAsync();

        // The other fail-closed input shape: an accessor is present but its CurrentExerciseId is null. The
        // ctor's `?? Guid.Empty` collapses that to the empty scope — still zero rows, never all exercises.
        await using var read = _fixture.CreateContext(new ExerciseContext());

        (await read.Accounts.CountAsync(a => a.Id == accountId)).Should().Be(
            0, "a null CurrentExerciseId collapses to Guid.Empty via `?? Guid.Empty` — fail closed for Account");
        (await read.SharedCredentials.CountAsync(c => c.Id == credentialId)).Should().Be(
            0, "a null CurrentExerciseId collapses to Guid.Empty — fail closed for SharedCredential");

        await AssertRowsPhysicallyExistAsync(accountId, credentialId);
    }

    [RequiresDockerFact]
    public async Task ExplicitGuidEmptyScope_ReturnsZeroRows_FailClosed()
    {
        var (accountId, credentialId) = await SeedOneOfEachAsync();

        await using var read = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = Guid.Empty });

        (await read.Accounts.CountAsync(a => a.Id == accountId)).Should().Be(
            0, "an explicit Guid.Empty scope must match zero Account rows — no scoped row is ever persisted " +
               "with an empty ExerciseId, so this predicate can never open the door");
        (await read.SharedCredentials.CountAsync(c => c.Id == credentialId)).Should().Be(
            0, "an explicit Guid.Empty scope must match zero SharedCredential rows for the same reason");

        await AssertRowsPhysicallyExistAsync(accountId, credentialId);
    }

    [RequiresDockerFact]
    public async Task IgnoreQueryFilters_RevealsBothExercisesAccounts_ProvingScopingIsTheFilter()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var accountA = Guid.NewGuid();
        var accountB = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Accounts.Add(NewAccount(accountA, exerciseA));
            seed.Accounts.Add(NewAccount(accountB, exerciseB));
            await seed.SaveChangesAsync();
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));

        (await readA.Accounts.CountAsync(a => a.Id == accountA || a.Id == accountB)).Should().Be(
            1, "the query filter confines a scope-A read to exercise A");
        (await readA.Accounts.IgnoreQueryFilters().CountAsync(a => a.Id == accountA || a.Id == accountB)).Should().Be(
            2, "ignoring the filter reveals BOTH accounts exist — proving the scoping is the filter, not missing data");
    }

    [RequiresDockerFact]
    public async Task IgnoreQueryFilters_RevealsBothExercisesSharedCredentials_ProvingScopingIsTheFilter()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var credentialA = Guid.NewGuid();
        var credentialB = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.SharedCredentials.Add(NewSharedCredential(credentialA, exerciseA));
            seed.SharedCredentials.Add(NewSharedCredential(credentialB, exerciseB));
            await seed.SaveChangesAsync();
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));

        (await readA.SharedCredentials.CountAsync(c => c.Id == credentialA || c.Id == credentialB)).Should().Be(
            1, "the query filter confines a scope-A read to exercise A");
        (await readA.SharedCredentials.IgnoreQueryFilters().CountAsync(c => c.Id == credentialA || c.Id == credentialB)).Should().Be(
            2, "ignoring the filter reveals BOTH shared credentials exist — proving the scoping is the filter, not missing data");
    }

    [RequiresDockerFact]
    public async Task IdorAttempt_FindByKnownCrossExerciseAccountId_ReturnsNull()
    {
        // The realistic attack shape: a participant in exercise A learns another exercise's real account id
        // (leaked link, screenshot, guessed guid) and asks the API for it directly by id, not via a list.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var accountA = Guid.NewGuid();
        var accountB = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Accounts.Add(NewAccount(accountA, exerciseA));
            seed.Accounts.Add(NewAccount(accountB, exerciseB));
            await seed.SaveChangesAsync();
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));

        (await readA.Accounts.FindAsync(accountB)).Should().BeNull(
            "FindAsync by exercise B's real account id, from an exercise-A scope, must not resolve the row — " +
            "an IDOR attempt against a known/guessed foreign id must fail closed like a list query does");
        (await readA.Accounts.SingleOrDefaultAsync(a => a.Id == accountB)).Should().BeNull(
            "SingleOrDefaultAsync by exercise B's account id must also be filtered out under exercise A's scope");

        // Sanity: the caller's own exercise's account DOES resolve, proving the null above is isolation,
        // not a broken/no-op Find.
        (await readA.Accounts.FindAsync(accountA)).Should().NotBeNull(
            "the caller's own exercise A account must still resolve");
    }

    [RequiresDockerFact]
    public async Task IdorAttempt_FindByKnownCrossExerciseSharedCredentialId_ReturnsNull()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var credentialA = Guid.NewGuid();
        var credentialB = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.SharedCredentials.Add(NewSharedCredential(credentialA, exerciseA));
            seed.SharedCredentials.Add(NewSharedCredential(credentialB, exerciseB));
            await seed.SaveChangesAsync();
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));

        (await readA.SharedCredentials.FindAsync(credentialB)).Should().BeNull(
            "FindAsync by exercise B's real shared-credential id, from an exercise-A scope, must not resolve " +
            "— the shared login credential is exactly the row an exercise-A participant must never see for " +
            "exercise B (it would grant view-only access into another exercise's sim)");
        (await readA.SharedCredentials.SingleOrDefaultAsync(c => c.Id == credentialB)).Should().BeNull(
            "SingleOrDefaultAsync by exercise B's shared-credential id must also be filtered out under exercise A's scope");

        (await readA.SharedCredentials.FindAsync(credentialA)).Should().NotBeNull(
            "the caller's own exercise A shared credential must still resolve");
    }

    /// <summary>Seeds one scoped Account and one scoped SharedCredential in the SAME exercise; returns their ids.</summary>
    private async Task<(Guid AccountId, Guid CredentialId)> SeedOneOfEachAsync()
    {
        var exerciseId = Guid.NewGuid();
        var accountId = Guid.NewGuid();
        var credentialId = Guid.NewGuid();

        await using var seed = _fixture.CreateContext();
        seed.Accounts.Add(NewAccount(accountId, exerciseId));
        seed.SharedCredentials.Add(NewSharedCredential(credentialId, exerciseId));
        await seed.SaveChangesAsync();

        return (accountId, credentialId);
    }

    /// <summary>
    /// Proves the seeded rows really landed — read with the filter ignored — so a fail-closed zero above is
    /// the FILTER closing the door, not an empty table making the assertion pass for the wrong reason.
    /// </summary>
    private async Task AssertRowsPhysicallyExistAsync(Guid accountId, Guid credentialId)
    {
        await using var unfiltered = _fixture.CreateContext();

        (await unfiltered.Accounts.IgnoreQueryFilters().CountAsync(a => a.Id == accountId)).Should().Be(1);
        (await unfiltered.SharedCredentials.IgnoreQueryFilters().CountAsync(c => c.Id == credentialId)).Should().Be(1);
    }
}
