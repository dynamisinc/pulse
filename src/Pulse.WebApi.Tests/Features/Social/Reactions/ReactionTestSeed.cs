namespace Pulse.WebApi.Tests.Features.Social.Reactions;

using System;
using System.Collections.Generic;
using System.Data.Common;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Social.Follows;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// One self-contained, seeded exercise for the reaction suites: a provisioned host, a reacting persona bound to a
/// LIVE participant session, a second persona, and one post with a known engagement baseline. Everything the
/// reaction path reads is real persisted state; nothing is stubbed.
/// </summary>
internal sealed class ReactionWorld
{
    public required Guid Exercise { get; init; }

    public required string Host { get; init; }

    /// <summary>The reacting persona (bound to <see cref="Token"/>'s session).</summary>
    public required Guid Persona { get; init; }

    /// <summary>A second persona in the same exercise (another reactor / a reply author).</summary>
    public required Guid OtherPersona { get; init; }

    /// <summary>The post the tests react to.</summary>
    public required Guid Post { get; init; }

    public required string Token { get; init; }

    public required Guid SessionId { get; init; }

    public required string ActingHumanId { get; init; }

    public required string TimeZone { get; init; }

    /// <summary>The exercise's persisted <c>CurrentScenarioTime</c> (the clock fallback when no clock is running).</summary>
    public required DateTimeOffset ScenarioTime { get; init; }
}

/// <summary>Seeding and read-back helpers shared by the reaction test classes (real SQL only).</summary>
internal static class ReactionTestSeed
{
    /// <summary>The exercise's persisted scenario instant: far from the wall clock, so a wall-clock stamp is obvious.</summary>
    public static readonly DateTimeOffset ExerciseScenarioTime = new(2033, 9, 4, 9, 30, 0, TimeSpan.Zero);

    public static Uri ReactionUri(Guid postId, string kind) =>
        new($"/api/posts/{postId}/reactions/{kind}", UriKind.Relative);

    public static FollowTestHost CreateHost(MsSqlContainerFixture fixture)
    {
        fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string first");
        return new FollowTestHost(fixture.ConnectionString!);
    }

    /// <summary>Seeds one exercise world. The post carries the given baseline (staff-seeded engagement).</summary>
    public static async Task<ReactionWorld> SeedWorldAsync(
        MsSqlContainerFixture fixture,
        int baselineReply = 0,
        int baselineRepost = 0,
        int baselineLike = 0)
    {
        var exerciseId = Guid.NewGuid();
        var token = $"reaction-token-{Guid.NewGuid():N}";
        var persona = Guid.NewGuid();
        var session = TestSessions.NewSession(token, exerciseId, persona);

        var world = new ReactionWorld
        {
            Exercise = exerciseId,
            Host = $"react-{exerciseId:N}.example.com",
            Persona = persona,
            OtherPersona = Guid.NewGuid(),
            Post = Guid.NewGuid(),
            Token = token,
            SessionId = session.Id,
            ActingHumanId = session.ActingHumanId,
            TimeZone = "America/Chicago",
            ScenarioTime = ExerciseScenarioTime,
        };

        await using var seed = fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = exerciseId,
            Name = $"Exercise {exerciseId:N}",
            Hostname = world.Host,
            TimeZone = world.TimeZone,
            Status = "active",
            CurrentScenarioTime = world.ScenarioTime,
        });
        seed.Personas.Add(NewPersona(world.Persona, exerciseId));
        seed.Personas.Add(NewPersona(world.OtherPersona, exerciseId));
        seed.Posts.Add(NewPost(world.Post, exerciseId, world.OtherPersona, baselineReply, baselineRepost, baselineLike));
        seed.Sessions.Add(session);
        await seed.SaveChangesAsync();

        return world;
    }

    /// <summary>Seeds an extra live session (any kind) against <paramref name="exerciseId"/>, returning its token.</summary>
    public static async Task<string> SeedSessionAsync(
        MsSqlContainerFixture fixture,
        Guid exerciseId,
        Guid? personaId,
        string kind = "participant",
        bool isReadOnly = false)
    {
        var token = $"{kind}-{Guid.NewGuid():N}";
        await using var seed = fixture.CreateContext();
        seed.Sessions.Add(TestSessions.NewSession(token, exerciseId, personaId, kind, isReadOnly));
        await seed.SaveChangesAsync();
        return token;
    }

    public static Persona NewPersona(Guid id, Guid exerciseId) => new()
    {
        Id = id,
        ExerciseId = exerciseId,
        DisplayName = $"Persona {id:N}",
        Handle = $"p_{id:N}",
        Kind = "human",
    };

    public static Post NewPost(
        Guid id,
        Guid exerciseId,
        Guid authorPersonaId,
        int baselineReply = 0,
        int baselineRepost = 0,
        int baselineLike = 0,
        Guid? parentPostId = null,
        DateTimeOffset? deletedAt = null) => new()
        {
            Id = id,
            ExerciseId = exerciseId,
            AuthorPersonaId = authorPersonaId,
            Body = $"post {id:N}",
            CreatedScenarioTime = ExerciseScenarioTime,
            CreatedWallClock = DateTimeOffset.UtcNow,
            Origin = "participant",
            ActingHumanId = "human-test",
            ParentPostId = parentPostId,
            DeletedAt = deletedAt,
            BaselineReplyCount = baselineReply,
            BaselineRepostCount = baselineRepost,
            BaselineLikeCount = baselineLike,
        };

    public static PostReaction NewReaction(
        Guid exerciseId, Guid postId, Guid personaId, string kind, DateTimeOffset? deletedAt = null) => new()
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            PostId = postId,
            PersonaId = personaId,
            Kind = kind,
            CreatedScenarioTime = ExerciseScenarioTime,
            DeletedAt = deletedAt,
        };

    /// <summary>Every reaction row on <paramref name="postId"/>, in any exercise (unfiltered: physical truth).</summary>
    public static async Task<IReadOnlyList<PostReaction>> ReadReactionsAsync(MsSqlContainerFixture fixture, Guid postId)
    {
        await using var context = fixture.CreateContext();
        return await context.PostReactions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(reaction => reaction.PostId == postId)
            .ToListAsync();
    }

    /// <summary>Every reaction row stamped with <paramref name="exerciseId"/> (unfiltered).</summary>
    public static async Task<IReadOnlyList<PostReaction>> ReadReactionsInExerciseAsync(MsSqlContainerFixture fixture, Guid exerciseId)
    {
        await using var context = fixture.CreateContext();
        return await context.PostReactions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(reaction => reaction.ExerciseId == exerciseId)
            .ToListAsync();
    }

    /// <summary>Every telemetry event of <paramref name="eventTypes"/> in <paramref name="exerciseId"/> (unfiltered).</summary>
    public static async Task<IReadOnlyList<TelemetryEvent>> ReadEventsAsync(
        MsSqlContainerFixture fixture, Guid exerciseId, params string[] eventTypes)
    {
        await using var context = fixture.CreateContext();
        return await context.TelemetryEvents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(candidate => candidate.ExerciseId == exerciseId && eventTypes.Contains(candidate.EventType))
            .OrderBy(candidate => candidate.EmittedAt)
            .ToListAsync();
    }

    public static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    /// <summary>A context on the fixture's database, scoped to <paramref name="exerciseId"/>, with optional interceptors.</summary>
    public static PulseDbContext CreateScopedContext(
        MsSqlContainerFixture fixture, Guid? exerciseId, params IInterceptor[] interceptors)
    {
        fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string first");

        var builder = new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(fixture.ConnectionString!);
        if (interceptors.Length > 0)
        {
            builder.AddInterceptors(interceptors);
        }

        return new PulseDbContext(builder.Options, new ExerciseContext { CurrentExerciseId = exerciseId });
    }

    /// <summary>Runs one raw statement on a SEPARATE connection (a racing request, made deterministic).</summary>
    public static async Task ExecuteOnASeparateConnectionAsync(DbContext context, string sql, CancellationToken cancellationToken)
    {
        await using var connection = new SqlConnection(context.Database.GetConnectionString());
        await connection.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}

/// <summary>Counts the SQL commands a context executes (the reader's no-N+1 assertion).</summary>
internal sealed class CommandCountingInterceptor : DbCommandInterceptor
{
    private int _count;

    public int Count => _count;

    public void Reset() => Interlocked.Exchange(ref _count, 0);

    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<DbDataReader> result,
        CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref _count);
        return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
    }

    public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<object> result,
        CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref _count);
        return base.ScalarExecutingAsync(command, eventData, result, cancellationToken);
    }

    public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref _count);
        return base.NonQueryExecutingAsync(command, eventData, result, cancellationToken);
    }
}
