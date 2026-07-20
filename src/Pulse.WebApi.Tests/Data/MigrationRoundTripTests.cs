namespace Pulse.WebApi.Tests.Data;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Story <c>backend-host/02-persistence-efcore</c> (#269) AC4: "Given a clean database, when the initial
/// EF Core migration is applied, then it succeeds against an Azure-SQL-compatible target ... and
/// <c>dotnet test</c> includes a test that applies the migration and round-trips one row per entity."
/// Runs against a REAL SQL Server (Testcontainers), not an in-memory provider stand-in, so it actually
/// proves the migration + column types/collation apply, not just that the C# model compiles.
/// </summary>
[Collection(MsSqlCollection.Name)]
public class MigrationRoundTripTests
{
    private readonly MsSqlContainerFixture _fixture;

    public MigrationRoundTripTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public async Task Exercise_RoundTrips()
    {
        if (!_fixture.DockerAvailable)
        {
            return; // Docker unreachable — see MsSqlContainerFixture remarks.
        }

        var id = Guid.NewGuid();
        var exercise = new Exercise { Id = id, Name = $"Round Trip Exercise {id}" };

        await using (var writeContext = _fixture.CreateContext())
        {
            writeContext.Exercises.Add(exercise);
            await writeContext.SaveChangesAsync();
        }

        await using var readContext = _fixture.CreateContext();
        var reloaded = await readContext.Exercises.SingleAsync(e => e.Id == id);

        reloaded.Id.Should().Be(exercise.Id);
        reloaded.Name.Should().Be(exercise.Name);
    }

    [Fact]
    public async Task PersonaTemplate_RoundTrips()
    {
        if (!_fixture.DockerAvailable)
        {
            return;
        }

        var id = Guid.NewGuid();
        var template = new PersonaTemplate
        {
            Id = id,
            DisplayName = "Reporter Template",
            Handle = $"@template_{id:N}",
        };

        await using (var writeContext = _fixture.CreateContext())
        {
            writeContext.PersonaTemplates.Add(template);
            await writeContext.SaveChangesAsync();
        }

        await using var readContext = _fixture.CreateContext();
        var reloaded = await readContext.PersonaTemplates.SingleAsync(p => p.Id == id);

        reloaded.Id.Should().Be(template.Id);
        reloaded.DisplayName.Should().Be(template.DisplayName);
        reloaded.Handle.Should().Be(template.Handle);
    }

    [Fact]
    public async Task Persona_RoundTrips_WithRealExerciseId()
    {
        if (!_fixture.DockerAvailable)
        {
            return;
        }

        var exerciseId = Guid.NewGuid();
        var personaId = Guid.NewGuid();
        var templateId = Guid.NewGuid();

        await using (var writeContext = _fixture.CreateContext())
        {
            writeContext.Exercises.Add(new Exercise { Id = exerciseId, Name = "Persona Round Trip Exercise" });
            writeContext.PersonaTemplates.Add(new PersonaTemplate
            {
                Id = templateId,
                DisplayName = "Anchor Template",
                Handle = $"@anchor_{templateId:N}",
            });
            writeContext.Personas.Add(new Persona
            {
                Id = personaId,
                ExerciseId = exerciseId,
                DisplayName = "Jordan Ferry",
                Handle = $"@jferry_{personaId:N}",
                PersonaTemplateId = templateId,
            });
            await writeContext.SaveChangesAsync();
        }

        await using var readContext = _fixture.CreateContext();
        var reloaded = await readContext.Personas.SingleAsync(p => p.Id == personaId);

        reloaded.ExerciseId.Should().Be(exerciseId);
        reloaded.ExerciseId.Should().NotBe(Guid.Empty, "scoped rows must carry a real ExerciseId");
        reloaded.DisplayName.Should().Be("Jordan Ferry");
        reloaded.Handle.Should().Be($"@jferry_{personaId:N}");
        reloaded.PersonaTemplateId.Should().Be(templateId);
    }

    [Fact]
    public async Task Post_RoundTrips_WithRealExerciseId()
    {
        if (!_fixture.DockerAvailable)
        {
            return;
        }

        var exerciseId = Guid.NewGuid();
        var authorPersonaId = Guid.NewGuid();
        var postId = Guid.NewGuid();
        var createdScenarioTime = new DateTimeOffset(2033, 6, 14, 9, 30, 0, TimeSpan.FromHours(-5));

        await using (var writeContext = _fixture.CreateContext())
        {
            writeContext.Exercises.Add(new Exercise { Id = exerciseId, Name = "Post Round Trip Exercise" });
            writeContext.Posts.Add(new Post
            {
                Id = postId,
                ExerciseId = exerciseId,
                AuthorPersonaId = authorPersonaId,
                Body = "Reports of flooding downtown; avoid Elm Street.",
                CreatedScenarioTime = createdScenarioTime,
                RumorRef = null,
                MutationOf = null,
                DeletedAt = null,
            });
            await writeContext.SaveChangesAsync();
        }

        await using var readContext = _fixture.CreateContext();
        var reloaded = await readContext.Posts.SingleAsync(p => p.Id == postId);

        reloaded.ExerciseId.Should().Be(exerciseId);
        reloaded.ExerciseId.Should().NotBe(Guid.Empty, "scoped rows must carry a real ExerciseId");
        reloaded.AuthorPersonaId.Should().Be(authorPersonaId);
        reloaded.Body.Should().Be("Reports of flooding downtown; avoid Elm Street.");
        reloaded.CreatedScenarioTime.Should().Be(createdScenarioTime);
        reloaded.RumorRef.Should().BeNull();
        reloaded.MutationOf.Should().BeNull();
        reloaded.DeletedAt.Should().BeNull();
    }

    [Fact]
    public async Task TelemetryEvent_RoundTrips_WithRealExerciseId()
    {
        if (!_fixture.DockerAvailable)
        {
            return;
        }

        var exerciseId = Guid.NewGuid();
        var eventId = Guid.NewGuid().ToString();
        var wallClockTime = new DateTimeOffset(2033, 6, 14, 15, 0, 0, TimeSpan.Zero);
        var scenarioTime = new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5));
        var emittedAt = wallClockTime.AddSeconds(1);

        await using (var writeContext = _fixture.CreateContext())
        {
            writeContext.Exercises.Add(new Exercise { Id = exerciseId, Name = "Telemetry Round Trip Exercise" });
            writeContext.TelemetryEvents.Add(new TelemetryEvent
            {
                EventId = eventId,
                SchemaVersion = "v0",
                ExerciseId = exerciseId,
                EventType = "post",
                Channel = "social",
                Actor = new TelemetryActor
                {
                    Kind = "participant",
                    ParticipantId = "participant-42",
                    PersonaId = null,
                    ActingHumanId = null,
                    SessionId = "session-abc",
                    Role = "evaluator",
                },
                Origin = "participant",
                InjectId = null,
                CorrelationId = "corr-1",
                CausationId = "cause-1",
                Sequence = 7,
                Source = "social-feed",
                WallClockTime = wallClockTime,
                ScenarioTime = scenarioTime,
                TimeZone = "America/Chicago",
                Target = new TelemetryTarget
                {
                    EntityType = "post",
                    EntityId = "post-99",
                },
                Payload = "{\"text\":\"hello\"}",
                EmittedAt = emittedAt,
            });
            await writeContext.SaveChangesAsync();
        }

        await using var readContext = _fixture.CreateContext();
        var reloaded = await readContext.TelemetryEvents.SingleAsync(e => e.EventId == eventId);

        reloaded.EventId.Should().Be(eventId);
        reloaded.SchemaVersion.Should().Be("v0");
        reloaded.ExerciseId.Should().Be(exerciseId);
        reloaded.ExerciseId.Should().NotBe(Guid.Empty, "scoped rows must carry a real ExerciseId");
        reloaded.EventType.Should().Be("post");
        reloaded.Channel.Should().Be("social");
        reloaded.Actor.Kind.Should().Be("participant");
        reloaded.Actor.ParticipantId.Should().Be("participant-42");
        reloaded.Actor.PersonaId.Should().BeNull();
        reloaded.Actor.ActingHumanId.Should().BeNull();
        reloaded.Actor.SessionId.Should().Be("session-abc");
        reloaded.Actor.Role.Should().Be("evaluator");
        reloaded.Origin.Should().Be("participant");
        reloaded.InjectId.Should().BeNull();
        reloaded.CorrelationId.Should().Be("corr-1");
        reloaded.CausationId.Should().Be("cause-1");
        reloaded.Sequence.Should().Be(7);
        reloaded.Source.Should().Be("social-feed");
        reloaded.WallClockTime.Should().Be(wallClockTime);
        reloaded.ScenarioTime.Should().Be(scenarioTime);
        reloaded.TimeZone.Should().Be("America/Chicago");
        reloaded.Target.Should().NotBeNull();
        reloaded.Target!.EntityType.Should().Be("post");
        reloaded.Target!.EntityId.Should().Be("post-99");
        reloaded.Payload.Should().Be("{\"text\":\"hello\"}");
        reloaded.EmittedAt.Should().Be(emittedAt);
    }
}
