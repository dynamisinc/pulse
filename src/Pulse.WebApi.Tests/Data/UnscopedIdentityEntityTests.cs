namespace Pulse.WebApi.Tests.Data;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Story <c>identity-backend/B2-Wave-0</c> (schema + contract seam-freeze), COR-005/COR-012/COR-014 — proves
/// the isolation-filter EXEMPTION for <see cref="StaffUser"/>, <see cref="StaffAssignment"/> and
/// <see cref="Session"/> is real and safe: each is queryable/findable ACROSS exercises regardless of the
/// context's resolved <c>CurrentExerciseId</c> (by design — see each entity's XML doc for the always-Critical
/// safety rationale), while a scoped CONTENT query (<see cref="Account"/>) in the SAME context still returns
/// only its own exercise's rows. Mirrors <see cref="QueryFilterIsolationTests"/>'s rigor (real SQL Server via
/// Testcontainers, fresh <see cref="Guid.NewGuid"/> ids, FluentAssertions because-reasons).
/// </summary>
[Collection(MsSqlCollection.Name)]
public class UnscopedIdentityEntityTests
{
    private readonly MsSqlContainerFixture _fixture;

    public UnscopedIdentityEntityTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    private static IExerciseContext ScopeFor(Guid exerciseId) =>
        new ExerciseContext { CurrentExerciseId = exerciseId };

    private static Session NewSession(Guid id, string tokenHash, Guid exerciseId) => new()
    {
        Id = id,
        TokenHash = tokenHash,
        Kind = "participant",
        ExerciseId = exerciseId,
        PrincipalId = Guid.NewGuid().ToString(),
        Role = "participant",
        ActingHumanId = $"human_{id:N}",
        IsReadOnly = false,
        IssuedAt = DateTimeOffset.UtcNow,
        ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
    };

    [RequiresDockerFact]
    public async Task StaffAssignmentQuery_ForOneStaffUser_ReturnsAssignmentsAcrossExercises_NotConfinedToCurrentScope()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var staffUserId = Guid.NewGuid();
        var assignmentA = Guid.NewGuid();
        var assignmentB = Guid.NewGuid();

        // Content rows (Account) also seeded in exercise A AND exercise B, so the SAME context that reveals
        // cross-exercise assignments can also be asserted to keep content isolation intact.
        var accountA = Guid.NewGuid();
        var accountB = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.StaffUsers.Add(new StaffUser
            {
                OrganizationId = Organization.DefaultOrganizationId,
                Id = staffUserId,
                ExternalSubject = $"idp|{staffUserId:N}",
                DisplayName = "Cross-Exercise Controller",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            seed.StaffAssignments.Add(new StaffAssignment
            {
                Id = assignmentA,
                StaffUserId = staffUserId,
                ExerciseId = exerciseA,
                Role = "controller",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            seed.StaffAssignments.Add(new StaffAssignment
            {
                Id = assignmentB,
                StaffUserId = staffUserId,
                ExerciseId = exerciseB,
                Role = "evaluator",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            seed.Accounts.Add(new Account
            {
                Id = accountA,
                ExerciseId = exerciseA,
                Username = $"user_{accountA:N}",
                DisplayName = "Exercise A Account",
                Role = "participant",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            seed.Accounts.Add(new Account
            {
                Id = accountB,
                ExerciseId = exerciseB,
                Username = $"user_{accountB:N}",
                DisplayName = "Exercise B Account",
                Role = "participant",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await seed.SaveChangesAsync();
        }

        // The context's resolved scope is exercise A ONLY — but the assignment-switcher query must still
        // see BOTH of this staff user's assignments (COR-005: a staff human spans exercises).
        await using var read = _fixture.CreateContext(ScopeFor(exerciseA));

        var assignedExercises = await read.StaffAssignments
            .Where(a => a.StaffUserId == staffUserId)
            .Select(a => a.ExerciseId)
            .ToListAsync();

        assignedExercises.Should().BeEquivalentTo(
            [exerciseA, exerciseB],
            "StaffAssignment is NOT IExerciseScoped — a staff user's assignment read must return every " +
            "exercise they're assigned to, even though the context's CurrentExerciseId is set to only one of them");

        // Content isolation still holds IN THE SAME CONTEXT: an Account read is still confined to exercise A.
        var visibleAccounts = await read.Accounts
            .Where(a => a.Id == accountA || a.Id == accountB)
            .Select(a => a.Id)
            .ToListAsync();

        visibleAccounts.Should().ContainSingle().Which.Should().Be(
            accountA,
            "the StaffAssignment exemption must not weaken content isolation — an Account query in the same " +
            "context, scoped to exercise A, must still see only exercise A's account");
    }

    [RequiresDockerFact]
    public async Task StaffUserQuery_IsFindableRegardlessOfCurrentExerciseId()
    {
        var staffUserId = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.StaffUsers.Add(new StaffUser
            {
                OrganizationId = Organization.DefaultOrganizationId,
                Id = staffUserId,
                ExternalSubject = $"idp|{staffUserId:N}",
                DisplayName = "Unconfined Staff User",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await seed.SaveChangesAsync();
        }

        // An unrelated exercise's scope — StaffUser carries no ExerciseId at all, so it must be visible
        // regardless of the current scope, including one it has no assignment on.
        await using var read = _fixture.CreateContext(ScopeFor(Guid.NewGuid()));

        var found = await read.StaffUsers.FindAsync(staffUserId);

        found.Should().NotBeNull(
            "StaffUser is NOT IExerciseScoped (a staff-world access record spanning exercises, COR-005/COR-014) " +
            "— it must be findable under any resolved exercise scope, including one unrelated to any assignment");
    }

    [RequiresDockerFact]
    public async Task StaffUserQuery_IsFindableWhenScopeIsUnset()
    {
        var staffUserId = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.StaffUsers.Add(new StaffUser
            {
                OrganizationId = Organization.DefaultOrganizationId,
                Id = staffUserId,
                ExternalSubject = $"idp|{staffUserId:N}",
                DisplayName = "Pre-Scope Staff User",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await seed.SaveChangesAsync();
        }

        // No scope resolved at all (pre-auth) — StaffUser must still be findable, since staff login itself
        // happens before any exercise is selected.
        await using var read = _fixture.CreateContext((IExerciseContext?)null);

        var found = await read.StaffUsers.FindAsync(staffUserId);

        found.Should().NotBeNull(
            "StaffUser lookups (e.g. resolving the external IdP subject at login) happen before any exercise " +
            "scope is resolved, so an unset scope must not hide it");
    }

    [RequiresDockerFact]
    public async Task SessionQuery_ByTokenHash_IsFindable_WhenScopeIsUnset_PreAuthTokenLookup()
    {
        var exerciseId = Guid.NewGuid();
        var sessionId = Guid.NewGuid();
        var tokenHash = $"hash_{sessionId:N}";

        await using (var seed = _fixture.CreateContext())
        {
            seed.Sessions.Add(NewSession(sessionId, tokenHash, exerciseId));
            await seed.SaveChangesAsync();
        }

        // The pre-auth shape: NO scope resolved yet (CurrentExerciseId unset) — this is exactly the moment a
        // token-based lookup must still resolve the session, since the session IS what resolves the scope.
        await using var read = _fixture.CreateContext((IExerciseContext?)null);

        var found = await read.Sessions.SingleOrDefaultAsync(s => s.TokenHash == tokenHash);

        found.Should().NotBeNull(
            "Session is NOT IExerciseScoped — a pre-auth token lookup happens BEFORE any exercise scope is " +
            "resolved, so it must find the session even when CurrentExerciseId is unset (Guid.Empty); if " +
            "Session regressed to being filtered, the whole auth path would break (the session that RESOLVES " +
            "the scope could never itself be found)");
        found!.ExerciseId.Should().Be(exerciseId);
    }

    [RequiresDockerFact]
    public async Task SessionQuery_ByTokenHash_IsFindable_WhenScopeIsADifferentExercise()
    {
        var sessionExerciseId = Guid.NewGuid();
        var unrelatedExerciseId = Guid.NewGuid();
        var sessionId = Guid.NewGuid();
        var tokenHash = $"hash_{sessionId:N}";

        await using (var seed = _fixture.CreateContext())
        {
            seed.Sessions.Add(NewSession(sessionId, tokenHash, sessionExerciseId));
            await seed.SaveChangesAsync();
        }

        // A DIFFERENT resolved scope than the session's own bound exercise — e.g. a staff user who has since
        // switched their active exercise. The session lookup itself must still resolve; it is Wave-2
        // issuance/validation logic (not the query) that later checks the bound exercise matches (story 08
        // precedence), so the lookup path must not pre-filter this away.
        await using var read = _fixture.CreateContext(ScopeFor(unrelatedExerciseId));

        var found = await read.Sessions.SingleOrDefaultAsync(s => s.TokenHash == tokenHash);

        found.Should().NotBeNull(
            "Session is NOT IExerciseScoped — a token lookup must resolve the session even when the context's " +
            "CurrentExerciseId is set to a DIFFERENT exercise than the session's own bound ExerciseId");
        found!.ExerciseId.Should().Be(sessionExerciseId);
    }
}
