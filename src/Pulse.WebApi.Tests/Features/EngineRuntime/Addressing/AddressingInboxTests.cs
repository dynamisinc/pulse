namespace Pulse.WebApi.Tests.Features.EngineRuntime.Addressing;

using System;
using System.Linq;
using FluentAssertions;
using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Addressing;
using Xunit;

/// <summary>
/// engine-runtime/06: the in-memory official-post inbox the reaction loop drains each tick, and the observer
/// that fills it from the social write path. Pure in-memory behavior, so plain <see cref="FactAttribute"/>s.
/// </summary>
public sealed class AddressingInboxTests
{
    private static AddressingObservation Post(string reference, string text = "#WaterIssues update") =>
        new(AddressingSource.OfficialPost, reference, text);

    [Fact]
    public void Drain_ReturnsEverythingQueuedForTheExercise_OldestFirst_AndEmptiesIt()
    {
        var inbox = new AddressingInbox();
        var exerciseId = Guid.NewGuid();
        inbox.Enqueue(exerciseId, Post("first"));
        inbox.Enqueue(exerciseId, Post("second"));

        inbox.Drain(exerciseId).Select(o => o.Reference).Should().Equal("first", "second");
        inbox.Drain(exerciseId).Should().BeEmpty("a drained post is resolved once, never twice");
    }

    [Fact]
    public void Drain_ForAnExerciseWithNothingQueued_IsEmpty()
    {
        new AddressingInbox().Drain(Guid.NewGuid()).Should().BeEmpty();
    }

    [Fact]
    public void Exercises_AreIsolated_FromEachOther()
    {
        var inbox = new AddressingInbox();
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        inbox.Enqueue(exerciseA, Post("a"));

        inbox.Drain(exerciseB).Should().BeEmpty("exercise B never sees exercise A's official posts (COR-001)");
        inbox.Drain(exerciseA).Should().ContainSingle();
    }

    [Fact]
    public void Clear_DiscardsOnlyThatExercisesPendingPosts()
    {
        var inbox = new AddressingInbox();
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        inbox.Enqueue(exerciseA, Post("a"));
        inbox.Enqueue(exerciseB, Post("b"));

        inbox.Clear(exerciseA);

        inbox.Drain(exerciseA).Should().BeEmpty();
        inbox.Drain(exerciseB).Should().ContainSingle();
    }

    [Fact]
    public void Enqueue_BeyondTheBound_DropsTheOldestFirst()
    {
        var inbox = new AddressingInbox();
        var exerciseId = Guid.NewGuid();
        for (var i = 0; i < AddressingInbox.MaxPendingPerExercise + 5; i++)
        {
            inbox.Enqueue(exerciseId, Post($"post-{i}"));
        }

        var drained = inbox.Drain(exerciseId);
        drained.Should().HaveCount(
            AddressingInbox.MaxPendingPerExercise, "an exercise with no registered loop must not grow the inbox without limit");
        drained[0].Reference.Should().Be("post-5", "the five oldest were dropped");
        drained[^1].Reference.Should().Be($"post-{AddressingInbox.MaxPendingPerExercise + 4}");
    }

    [Theory]
    [InlineData("engine")]
    [InlineData("controller-as-persona")]
    [InlineData("inject")]
    public void Observer_IgnoresEveryOriginButParticipant(string origin)
    {
        var inbox = new AddressingInbox();
        var exerciseId = Guid.NewGuid();
        var observer = new EngineAddressingObserver(inbox);

        observer.OnPostPublished(exerciseId, CommittedPost(exerciseId, origin, "#WaterIssues update"));

        inbox.Drain(exerciseId).Should().BeEmpty(
            "only a participant's own post is a response; the engine, a controller persona and an inject are the world talking");
    }

    [Fact]
    public void Observer_QueuesAParticipantPost_AsAnOfficialPostCandidate()
    {
        var inbox = new AddressingInbox();
        var exerciseId = Guid.NewGuid();
        var observer = new EngineAddressingObserver(inbox);
        var post = CommittedPost(exerciseId, "participant", "Fulton County EM: do not drink tap water #WaterIssues");

        observer.OnPostPublished(exerciseId, post);

        var queued = inbox.Drain(exerciseId).Should().ContainSingle().Subject;
        queued.Source.Should().Be(AddressingSource.OfficialPost);
        queued.Reference.Should().Be(post.Id.ToString(), "the post id is the telemetry lineage back to the response");
        queued.Text.Should().Be(post.Body, "the matcher reads the official text");
    }

    private static Post CommittedPost(Guid exerciseId, string origin, string body) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        AuthorPersonaId = Guid.NewGuid(),
        Body = body,
        Origin = origin,
        ActingHumanId = origin == "participant" ? "participant-1" : string.Empty,
        CreatedScenarioTime = DateTimeOffset.UnixEpoch,
        CreatedWallClock = DateTimeOffset.UnixEpoch,
    };
}
