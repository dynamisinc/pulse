namespace Pulse.WebApi.Tests.Features.Identity.LinkEmail;

using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.LinkEmail;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// easy-login/13 (Isolation AC, XC-001/COR-001, always-Critical). Emailing links sends bearer credentials to inboxes, so
/// it must only ever read the caller's exercise. Extends the standing suite (<see cref="QueryFilterIsolationTests"/>,
/// <see cref="EasyLoginIsolationTests"/>, the card sheet's <c>LinkCardIsolationTests</c>) to this read: an id from
/// another exercise is a <c>notFound</c> skip indistinguishable from an unknown id (same outcome, same body shape) and
/// nobody in that exercise is emailed; "everyone" means everyone IN THIS EXERCISE; the exercise name in the subject is
/// the caller's exercise, from <c>ExerciseFactsReader</c>; an unset or empty scope reads, sends and records nothing; and
/// the other exercise's rows provably exist, so every zero below is the filter closing the door. Real SQL Server.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class LinkEmailIsolationTests
{
    private readonly LinkEmailTestWorld _world;

    public LinkEmailIsolationTests(MsSqlContainerFixture fixture) => _world = new LinkEmailTestWorld(fixture);

    [RequiresDockerFact]
    public async Task AnIdFromAnotherExercise_IsNotFound_ExactlyLikeAnUnknownId_AndNobodyIsEmailed()
    {
        var (exerciseA, exerciseB, staffOnA) = await TwoExercisesAsync();
        var bob = await _world.SeedParticipantAsync(exerciseB, "Bob In B");
        var unknown = Guid.NewGuid();
        var mailer = new FakeParticipantLinkMailer();

        var crossExercise = await _world.SendAsync(exerciseA, staffOnA, mailer, [bob.AccountId.ToString()]);
        var unknownId = await _world.SendAsync(exerciseA, staffOnA, mailer, [unknown.ToString()]);

        crossExercise.Outcome.Should().Be(LinkEmailOutcome.Ok);
        crossExercise.Body!.Results.Should().ContainSingle().Which.Should().BeEquivalentTo(new RosterEmailResultItemDto
        {
            ParticipantId = bob.AccountId.ToString(),
            Status = RosterEmailStatuses.Skipped,
            Reason = RosterEmailSkipReasons.NotFound,
        });

        unknownId.Outcome.Should().Be(crossExercise.Outcome);
        Normalized(crossExercise, bob.AccountId.ToString()).Should().Be(
            Normalized(unknownId, unknown.ToString()),
            "a cross-exercise id must look exactly like an id that exists nowhere");

        mailer.Messages.Should().BeEmpty("B's participant is never emailed from A");
        (await _world.EmailEventsAsync(exerciseA)).Should().BeEmpty();
        (await _world.EmailEventsAsync(exerciseB)).Should().BeEmpty();

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
        var bea = await _world.SeedParticipantAsync(exerciseB, "Bea In B", email: string.Empty);
        var mailer = new FakeParticipantLinkMailer();

        var result = await _world.SendAsync(exerciseA, staffOnA, mailer);

        result.Body!.Results.Should().ContainSingle().Which.ParticipantId.Should().Be(alice.AccountId.ToString());
        mailer.Messages.Select(m => m.RecipientAddress).Should().Equal([alice.Email]);

        var everything = JsonSerializer.Serialize(result.Body) + string.Join("|", mailer.Messages.Select(m => m.HtmlBody + m.PlainTextBody));
        everything.Should().NotContain(bob.AccountId.ToString()).And.NotContain(bea.AccountId.ToString())
            .And.NotContain(bob.Token!).And.NotContain(bob.Email!).And.NotContain("Bob In B");
    }

    [RequiresDockerFact]
    public async Task MixedRequest_EmailsOnlyTheCallersExercise()
    {
        var (exerciseA, exerciseB, staffOnA) = await TwoExercisesAsync();
        var alice = await _world.SeedParticipantAsync(exerciseA, "Alice In A");
        var bob = await _world.SeedParticipantAsync(exerciseB, "Bob In B");
        var mailer = new FakeParticipantLinkMailer();

        var result = await _world.SendAsync(exerciseA, staffOnA, mailer, [bob.AccountId.ToString(), alice.AccountId.ToString()]);

        result.Body!.Results.Select(r => (r.ParticipantId, r.Status)).Should().Equal(
            [
                (alice.AccountId.ToString(), RosterEmailStatuses.Sent),
                (bob.AccountId.ToString(), RosterEmailStatuses.Skipped),
            ]);
        var message = mailer.Messages.Should().ContainSingle().Subject;
        message.RecipientAddress.Should().Be(alice.Email);
        message.HtmlBody.Should().Contain(alice.JoinUrl).And.NotContain(bob.Token!, "B's credential never leaves B");

        var events = await _world.EmailEventsAsync(exerciseA);
        events.Should().ContainSingle().Which.Target!.EntityId.Should().Be(alice.LinkId.ToString());
        (await _world.EmailEventsAsync(exerciseB)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task TheExerciseNameInTheSubject_IsTheCallersExercise()
    {
        var exerciseA = await _world.SeedExerciseAsync(name: "Exercise A name");
        await _world.SeedExerciseAsync(name: "Exercise B name");
        var staff = await _world.SeedStaffAsync((exerciseA, "controller"));
        await _world.SeedParticipantAsync(exerciseA, "Alice In A");
        var mailer = new FakeParticipantLinkMailer();

        await _world.SendAsync(exerciseA, staff, mailer);

        mailer.Messages.Should().ContainSingle().Which.Subject.Should().Be("Your sign-in link for Exercise A name");
    }

    [RequiresDockerFact]
    public async Task AControllerOfB_ScopedToA_EmailsNothingFromEither()
    {
        var exerciseA = await _world.SeedExerciseAsync();
        var exerciseB = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exerciseA, "evaluator"), (exerciseB, "controller"));
        var bob = await _world.SeedParticipantAsync(exerciseB, "Bob In B");
        var mailer = new FakeParticipantLinkMailer();

        var result = await _world.SendAsync(exerciseA, staff, mailer, [bob.AccountId.ToString()]);

        result.Outcome.Should().Be(LinkEmailOutcome.Forbidden);
        result.Body.Should().BeNull();
        mailer.Messages.Should().BeEmpty();
        (await _world.EmailEventsAsync(exerciseA)).Should().BeEmpty();
        (await _world.EmailEventsAsync(exerciseB)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task AnUnsetOrEmptyScope_ReadsNothing_SendsNothing_AndRecordsNothing()
    {
        var (_, exerciseB, _) = await TwoExercisesAsync();
        var staffOnB = await _world.SeedStaffAsync((exerciseB, "controller"));
        var bob = await _world.SeedParticipantAsync(exerciseB, "Bob In B");
        var mailer = new FakeParticipantLinkMailer();

        foreach (var scope in new Guid?[] { null, Guid.Empty })
        {
            var everyone = await _world.SendAsync(scope, staffOnB, mailer);
            var named = await _world.SendAsync(scope, staffOnB, mailer, [bob.AccountId.ToString()]);

            everyone.Outcome.Should().Be(LinkEmailOutcome.Unauthenticated, "no scope is a 401, never 'every exercise'");
            named.Outcome.Should().Be(LinkEmailOutcome.Unauthenticated);
        }

        mailer.Messages.Should().BeEmpty();
        (await _world.EmailEventsAsync(exerciseB)).Should().BeEmpty();
    }

    /// <summary>Seeds exercises A and B and a controller on A.</summary>
    private async Task<(Guid ExerciseA, Guid ExerciseB, Guid StaffOnA)> TwoExercisesAsync()
    {
        var exerciseA = await _world.SeedExerciseAsync();
        var exerciseB = await _world.SeedExerciseAsync();
        var staffOnA = await _world.SeedStaffAsync((exerciseA, "controller"));
        return (exerciseA, exerciseB, staffOnA);
    }

    /// <summary>The serialized body with the one requested id replaced by a placeholder.</summary>
    private static string Normalized(LinkEmailResult result, string requestedId) =>
        JsonSerializer.Serialize(result.Body).Replace(requestedId, "<requested-id>", StringComparison.Ordinal);
}
