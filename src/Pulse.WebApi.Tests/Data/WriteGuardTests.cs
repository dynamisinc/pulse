namespace Pulse.WebApi.Tests.Data;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Story <c>backend-host/02-persistence-efcore</c> (#269) AC5 (Tier-2, isolation): "a
/// <c>SaveChangesAsync</c> override rejects (throws, before the write reaches the database) any tracked
/// scoped entity whose <c>ExerciseId</c> is <c>Guid.Empty</c>/default." Every negative test here asserts
/// BOTH halves of the fail-closed guarantee — the throw AND that zero rows landed in the real SQL Server
/// container — against a fresh, separately-opened context so an in-memory change tracker cache can't
/// mask a write that never actually reached the database. A positive control (valid <c>ExerciseId</c>)
/// proves the guard isn't rejecting everything.
///
/// Every test is <see cref="RequiresDockerFactAttribute"/> (Gate-1 W-001): a real <c>Skipped</c> outcome on
/// a Docker-less machine, never a silent <c>Passed</c>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public class WriteGuardTests
{
    private readonly MsSqlContainerFixture _fixture;

    public WriteGuardTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task SaveChangesAsync_RejectsPostWithEmptyExerciseId_AndWritesNoRow()
    {
        var postId = Guid.NewGuid();

        await using var writeContext = _fixture.CreateContext();
        writeContext.Posts.Add(new Post
        {
            Id = postId,
            ExerciseId = Guid.Empty,
            AuthorPersonaId = Guid.NewGuid(),
            Body = "This should never reach the database.",
            CreatedScenarioTime = DateTimeOffset.UtcNow,
        });

        var act = async () => await writeContext.SaveChangesAsync();

        await act.Should().ThrowAsync<ExerciseScopeViolationException>(
            "the write-time guard must reject a scoped entity with a default ExerciseId before it reaches the database");

        // Zero-rows-written half of the fail-closed guarantee: query with a SEPARATE context so the
        // (correctly non-persisted) locally-tracked entity can't make the assertion pass for the wrong reason.
        await using var verifyContext = _fixture.CreateContext();
        var count = await verifyContext.Posts.CountAsync(p => p.Id == postId);
        count.Should().Be(0, "the rejected Post must never have been written to the database");
    }

    [RequiresDockerFact]
    public async Task SaveChangesAsync_RejectsTelemetryEventWithEmptyExerciseId_AndWritesNoRow()
    {
        var eventId = Guid.NewGuid().ToString();

        await using var writeContext = _fixture.CreateContext();
        writeContext.TelemetryEvents.Add(new TelemetryEvent
        {
            EventId = eventId,
            SchemaVersion = "v0",
            ExerciseId = Guid.Empty,
            EventType = "post",
            Channel = "social",
            Actor = new TelemetryActor { Kind = "system" },
            WallClockTime = DateTimeOffset.UtcNow,
            ScenarioTime = DateTimeOffset.UtcNow,
            TimeZone = "America/Chicago",
            EmittedAt = DateTimeOffset.UtcNow,
        });

        var act = async () => await writeContext.SaveChangesAsync();

        await act.Should().ThrowAsync<ExerciseScopeViolationException>(
            "the write-time guard must reject a scoped TelemetryEvent with a default ExerciseId before it reaches the database");

        await using var verifyContext = _fixture.CreateContext();
        var count = await verifyContext.TelemetryEvents.CountAsync(e => e.EventId == eventId);
        count.Should().Be(0, "the rejected TelemetryEvent must never have been written to the database");
    }

    [RequiresDockerFact]
    public async Task SaveChangesAsync_RejectsMixedBatch_WhenAnyScopedEntityHasEmptyExerciseId()
    {
        var exerciseId = Guid.NewGuid();
        var validPostId = Guid.NewGuid();
        var invalidPostId = Guid.NewGuid();

        await using var writeContext = _fixture.CreateContext();
        writeContext.Exercises.Add(new Exercise { Id = exerciseId, Name = "Mixed Batch Exercise" });
        writeContext.Posts.Add(new Post
        {
            Id = validPostId,
            ExerciseId = exerciseId,
            AuthorPersonaId = Guid.NewGuid(),
            Body = "Valid — carries a real ExerciseId.",
            CreatedScenarioTime = DateTimeOffset.UtcNow,
        });
        writeContext.Posts.Add(new Post
        {
            Id = invalidPostId,
            ExerciseId = Guid.Empty,
            AuthorPersonaId = Guid.NewGuid(),
            Body = "Invalid — should sink the whole batch.",
            CreatedScenarioTime = DateTimeOffset.UtcNow,
        });

        var act = async () => await writeContext.SaveChangesAsync();

        await act.Should().ThrowAsync<ExerciseScopeViolationException>(
            "one invalid scoped entity in a batch must fail the whole SaveChangesAsync call, not just itself");

        await using var verifyContext = _fixture.CreateContext();
        (await verifyContext.Posts.CountAsync(p => p.Id == validPostId)).Should().Be(
            0, "the guard runs before base.SaveChangesAsync, so even the otherwise-valid Post in the same batch must not be written");
        (await verifyContext.Posts.CountAsync(p => p.Id == invalidPostId)).Should().Be(0);
        (await verifyContext.Exercises.CountAsync(e => e.Id == exerciseId)).Should().Be(
            0, "the anchor Exercise queued in the same failed SaveChangesAsync call must not be written either");
    }

    [RequiresDockerFact]
    public async Task SaveChangesAsync_Succeeds_WhenScopedEntityHasValidExerciseId()
    {
        var exerciseId = Guid.NewGuid();
        var postId = Guid.NewGuid();

        await using (var writeContext = _fixture.CreateContext())
        {
            writeContext.Exercises.Add(new Exercise { Id = exerciseId, Name = "Positive Control Exercise" });
            writeContext.Posts.Add(new Post
            {
                Id = postId,
                ExerciseId = exerciseId,
                AuthorPersonaId = Guid.NewGuid(),
                Body = "A validly-scoped post saves fine.",
                CreatedScenarioTime = DateTimeOffset.UtcNow,
            });

            var act = async () => await writeContext.SaveChangesAsync();

            await act.Should().NotThrowAsync("a scoped entity with a real, non-empty ExerciseId is the positive control");
        }

        await using var verifyContext = _fixture.CreateContext();
        var count = await verifyContext.Posts.CountAsync(p => p.Id == postId);
        count.Should().Be(1, "the validly-scoped Post must have actually reached the database");
    }
}
