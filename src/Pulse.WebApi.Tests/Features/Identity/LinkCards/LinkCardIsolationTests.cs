namespace Pulse.WebApi.Tests.Features.Identity.LinkCards;

using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.LinkCards;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// easy-login/04 (Isolation AC, XC-001/COR-001, always-Critical). The card sheet hands out bearer credentials in bulk,
/// so it must only ever read the caller's exercise. Extends the standing suite
/// (<see cref="QueryFilterIsolationTests"/>, <see cref="EasyLoginIsolationTests"/>) to this read: an <c>id</c> from
/// another exercise is a <c>notFound</c> skip indistinguishable from an unknown id (same outcome, same body shape),
/// "everyone" means everyone IN THIS EXERCISE, an unset or empty scope reads nothing and writes nothing (fail closed),
/// and the other exercise's rows provably exist, so every zero below is the filter closing the door, not an empty
/// table. Real SQL Server, fresh ids per test.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class LinkCardIsolationTests
{
    private readonly LinkCardTestWorld _world;

    public LinkCardIsolationTests(MsSqlContainerFixture fixture) => _world = new LinkCardTestWorld(fixture);

    [RequiresDockerFact]
    public async Task AnIdFromAnotherExercise_IsNotFound_ExactlyLikeAnUnknownId()
    {
        var (exerciseA, exerciseB, staffOnA) = await TwoExercisesAsync();
        var bob = await _world.SeedParticipantAsync(exerciseB, "Bob In B");
        var unknown = Guid.NewGuid();

        var crossExercise = await _world.GenerateAsync(exerciseA, staffOnA, [bob.AccountId.ToString()]);
        var unknownId = await _world.GenerateAsync(exerciseA, staffOnA, [unknown.ToString()]);

        crossExercise.Outcome.Should().Be(LinkCardOutcome.Ok);
        crossExercise.Sheet!.Cards.Should().BeEmpty("B's participant never gets a card on A's sheet");
        crossExercise.Sheet.Skipped.Should().ContainSingle().Which.Should().BeEquivalentTo(
            new RosterCardSkipDto { ParticipantId = bob.AccountId.ToString(), Reason = RosterCardSkipReasons.NotFound });

        // Indistinguishable: identical outcome, and identical bodies once the requested id itself is set aside.
        unknownId.Outcome.Should().Be(crossExercise.Outcome);
        Normalized(crossExercise, bob.AccountId.ToString()).Should().Be(
            Normalized(unknownId, unknown.ToString()),
            "a cross-exercise id must look exactly like an id that exists nowhere (no status, body or shape difference)");

        await using var unfiltered = _world.Fixture.CreateContext();
        (await unfiltered.ParticipantLinks.IgnoreQueryFilters().CountAsync(l => l.AccountId == bob.AccountId))
            .Should().Be(1, "B's active link exists, so the notFound is the filter closing the door, not a missing row");
    }

    [RequiresDockerFact]
    public async Task Everyone_MeansEveryoneInTheCallersExercise_Only()
    {
        var (exerciseA, exerciseB, staffOnA) = await TwoExercisesAsync();
        var alice = await _world.SeedParticipantAsync(exerciseA, "Alice In A");
        var bob = await _world.SeedParticipantAsync(exerciseB, "Bob In B");
        var bobNoLink = await _world.SeedParticipantAsync(exerciseB, "Bea In B", SeededLink.None);

        var result = await _world.GenerateAsync(exerciseA, staffOnA, ids: null);

        result.Sheet!.Cards.Should().ContainSingle().Which.ParticipantId.Should().Be(alice.AccountId.ToString());
        result.Sheet.Skipped.Should().BeEmpty("B's participants are not even counted as skipped on A's sheet");

        var serialized = JsonSerializer.Serialize(result.Sheet);
        serialized.Should().NotContain(bob.AccountId.ToString()).And.NotContain(bobNoLink.AccountId.ToString())
            .And.NotContain(bob.Token!).And.NotContain("Bob In B").And.NotContain("Bea In B");
    }

    [RequiresDockerFact]
    public async Task MixedRequest_GivesCardsOnlyForTheCallersExercise()
    {
        var (exerciseA, exerciseB, staffOnA) = await TwoExercisesAsync();
        var alice = await _world.SeedParticipantAsync(exerciseA, "Alice In A");
        var bob = await _world.SeedParticipantAsync(exerciseB, "Bob In B");

        var result = await _world.GenerateAsync(exerciseA, staffOnA, [bob.AccountId.ToString(), alice.AccountId.ToString()]);

        result.Sheet!.Cards.Should().ContainSingle().Which.JoinUrl.Should().Be(alice.JoinUrl);
        result.Sheet.Skipped.Should().ContainSingle().Which.Reason.Should().Be(RosterCardSkipReasons.NotFound);
        JsonSerializer.Serialize(result.Sheet).Should().NotContain(bob.Token!, "B's credential never leaves B");
    }

    [RequiresDockerFact]
    public async Task TheExerciseName_IsTheCallersExercise()
    {
        var exerciseA = await _world.SeedExerciseAsync(name: "Exercise A name");
        await _world.SeedExerciseAsync(name: "Exercise B name");
        var staff = await _world.SeedStaffAsync((exerciseA, "controller"));

        var result = await _world.GenerateAsync(exerciseA, staff);

        result.Sheet!.ExerciseName.Should().Be("Exercise A name");
    }

    [RequiresDockerFact]
    public async Task AControllerOfB_ScopedToA_GetsNothingFromEither()
    {
        // The caller is a controller on B and an evaluator on A, and the request is scoped to A. Their role on B is
        // irrelevant: the scope is A, where they may not print, and B is never read.
        var exerciseA = await _world.SeedExerciseAsync();
        var exerciseB = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exerciseA, "evaluator"), (exerciseB, "controller"));
        var bob = await _world.SeedParticipantAsync(exerciseB, "Bob In B");

        var result = await _world.GenerateAsync(exerciseA, staff, [bob.AccountId.ToString()]);

        result.Outcome.Should().Be(LinkCardOutcome.Forbidden);
        result.Sheet.Should().BeNull();
        (await _world.CardEventsAsync(exerciseA)).Should().BeEmpty();
        (await _world.CardEventsAsync(exerciseB)).Should().BeEmpty("nothing is recorded against an exercise the request was not scoped to");
    }

    [RequiresDockerFact]
    public async Task AnUnsetOrEmptyScope_ReadsNothing_AndWritesNothing()
    {
        var (_, exerciseB, _) = await TwoExercisesAsync();
        var staffOnB = await _world.SeedStaffAsync((exerciseB, "controller"));
        var bob = await _world.SeedParticipantAsync(exerciseB, "Bob In B");

        foreach (var scope in new Guid?[] { null, Guid.Empty })
        {
            var everyone = await _world.GenerateAsync(scope, staffOnB);
            var named = await _world.GenerateAsync(scope, staffOnB, [bob.AccountId.ToString()]);

            everyone.Outcome.Should().Be(LinkCardOutcome.Unauthenticated, "no scope is a 401, never 'every exercise'");
            everyone.Sheet.Should().BeNull();
            named.Outcome.Should().Be(LinkCardOutcome.Unauthenticated);
            named.Sheet.Should().BeNull();
        }

        (await _world.CardEventsAsync(exerciseB)).Should().BeEmpty();
        await using var unfiltered = _world.Fixture.CreateContext();
        (await unfiltered.Accounts.IgnoreQueryFilters().CountAsync(a => a.Id == bob.AccountId))
            .Should().Be(1, "the row exists; the unscoped request simply cannot reach it");
    }

    [RequiresDockerFact]
    public async Task TheSameAccountRead_UnderTheCentralFilter_IsInvisibleCrossExercise()
    {
        // The two sets the service reads, read the way it reads them: under A's scope, B's account and link are gone,
        // by id (IDOR) and by aggregate.
        var (exerciseA, exerciseB, _) = await TwoExercisesAsync();
        var bob = await _world.SeedParticipantAsync(exerciseB, "Bob In B");

        await using var underA = _world.Fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseA });
        (await underA.Accounts.AsNoTracking().SingleOrDefaultAsync(a => a.Id == bob.AccountId)).Should().BeNull();
        (await underA.ParticipantLinks.AsNoTracking().SingleOrDefaultAsync(l => l.AccountId == bob.AccountId)).Should().BeNull();
        (await underA.Accounts.CountAsync()).Should().Be(0, "A has no participants, and B's do not count towards A's size");
    }

    /// <summary>Seeds exercises A and B and a controller on A.</summary>
    private async Task<(Guid ExerciseA, Guid ExerciseB, Guid StaffOnA)> TwoExercisesAsync()
    {
        var exerciseA = await _world.SeedExerciseAsync();
        var exerciseB = await _world.SeedExerciseAsync();
        var staffOnA = await _world.SeedStaffAsync((exerciseA, "controller"));
        return (exerciseA, exerciseB, staffOnA);
    }

    /// <summary>The serialized sheet with the one requested id replaced by a placeholder.</summary>
    private static string Normalized(LinkCardResult result, string requestedId) =>
        JsonSerializer.Serialize(result.Sheet).Replace(requestedId, "<requested-id>", StringComparison.Ordinal);
}
