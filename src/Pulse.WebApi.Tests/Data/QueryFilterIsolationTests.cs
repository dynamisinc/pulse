namespace Pulse.WebApi.Tests.Data;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;

/// <summary>
/// Story <c>exercise-isolation/01</c> (#44), COR-001 — the always-Critical BEHAVIOURAL proof of the
/// read-side global query filter, against a REAL SQL Server (Testcontainers), not an in-memory stand-in.
/// Every test seeds rows in two exercises and asserts, at the database, that:
/// <list type="bullet">
///   <item><description>a query in exercise A returns ONLY exercise A rows, for every scoped entity;</description></item>
///   <item><description>an UNSET scope (null accessor, or a null <c>CurrentExerciseId</c>) returns ZERO
///   scoped rows — fail closed, never all exercises;</description></item>
///   <item><description>the scoping IS the query filter (<c>IgnoreQueryFilters</c> reveals both rows);</description></item>
///   <item><description>non-scoped entities are never filtered; and</description></item>
///   <item><description><c>AddDbContext</c> injects the registered <see cref="IExerciseContext"/> at runtime.</description></item>
/// </list>
/// Every test is <see cref="RequiresDockerFactAttribute"/> (Gate-1 W-001): a real <c>Skipped</c> on a
/// Docker-less machine, never a silent <c>Passed</c>. Fresh <see cref="Guid.NewGuid"/> ids per test keep
/// them independent without truncating tables.
/// </summary>
[Collection(MsSqlCollection.Name)]
public class QueryFilterIsolationTests
{
    private readonly MsSqlContainerFixture _fixture;

    public QueryFilterIsolationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    private static IExerciseContext ScopeFor(Guid exerciseId) =>
        new ExerciseContext { CurrentExerciseId = exerciseId };

    private static Persona NewPersona(Guid id, Guid exerciseId) => new()
    {
        Id = id,
        ExerciseId = exerciseId,
        DisplayName = $"Persona {id:N}",
        Handle = $"@p_{id:N}",
    };

    private static Post NewPost(Guid id, Guid exerciseId) => new()
    {
        Id = id,
        ExerciseId = exerciseId,
        AuthorPersonaId = Guid.NewGuid(),
        Body = $"Post {id:N}",
        CreatedScenarioTime = DateTimeOffset.UtcNow,
        Origin = "participant",
        ActingHumanId = "human-test",
        CreatedWallClock = new DateTimeOffset(2033, 9, 4, 13, 15, 0, TimeSpan.Zero),
    };

    private static TelemetryEvent NewTelemetry(string eventId, Guid exerciseId) => new()
    {
        EventId = eventId,
        SchemaVersion = "v0",
        ExerciseId = exerciseId,
        EventType = "post",
        Channel = "social",
        Actor = new TelemetryActor { Kind = "system" },
        WallClockTime = DateTimeOffset.UtcNow,
        ScenarioTime = DateTimeOffset.UtcNow,
        TimeZone = "America/Chicago",
        EmittedAt = DateTimeOffset.UtcNow,
    };

    [RequiresDockerFact]
    public async Task PersonaQuery_InExerciseA_ReturnsOnlyExerciseARows()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var personaA = Guid.NewGuid();
        var personaB = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Personas.Add(NewPersona(personaA, exerciseA));
            seed.Personas.Add(NewPersona(personaB, exerciseB));
            await seed.SaveChangesAsync();
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));
        var visible = await readA.Personas
            .Where(p => p.Id == personaA || p.Id == personaB)
            .Select(p => p.Id)
            .ToListAsync();

        visible.Should().ContainSingle().Which.Should().Be(
            personaA, "a query in exercise A must see only exercise A's persona, never exercise B's");
    }

    [RequiresDockerFact]
    public async Task PostQuery_InExerciseA_ReturnsOnlyExerciseARows()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var postA = Guid.NewGuid();
        var postB = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Posts.Add(NewPost(postA, exerciseA));
            seed.Posts.Add(NewPost(postB, exerciseB));
            await seed.SaveChangesAsync();
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));
        var visible = await readA.Posts
            .Where(p => p.Id == postA || p.Id == postB)
            .Select(p => p.Id)
            .ToListAsync();

        visible.Should().ContainSingle().Which.Should().Be(
            postA, "a query in exercise A must see only exercise A's post, never exercise B's");
    }

    [RequiresDockerFact]
    public async Task TelemetryEventQuery_InExerciseA_ReturnsOnlyExerciseARows()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var eventA = Guid.NewGuid().ToString();
        var eventB = Guid.NewGuid().ToString();

        await using (var seed = _fixture.CreateContext())
        {
            seed.TelemetryEvents.Add(NewTelemetry(eventA, exerciseA));
            seed.TelemetryEvents.Add(NewTelemetry(eventB, exerciseB));
            await seed.SaveChangesAsync();
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));
        var visible = await readA.TelemetryEvents
            .Where(e => e.EventId == eventA || e.EventId == eventB)
            .Select(e => e.EventId)
            .ToListAsync();

        visible.Should().ContainSingle().Which.Should().Be(
            eventA, "a query in exercise A must see only exercise A's telemetry event, never exercise B's");
    }

    [RequiresDockerFact]
    public async Task UnsetScope_NullAccessor_ReturnsZeroScopedRows_FailClosed()
    {
        var (personaId, postId, eventId) = await SeedOneOfEachAsync();

        // Fail-closed (always-Critical): a context with NO IExerciseContext at all captures Guid.Empty,
        // which the write-guard guarantees no scoped row can carry — so it must see NOTHING, not everything.
        await using var read = _fixture.CreateContext((IExerciseContext?)null);

        (await read.Personas.CountAsync(p => p.Id == personaId)).Should().Be(
            0, "a null exercise accessor scopes to Guid.Empty, which matches no scoped row — fail closed");
        (await read.Posts.CountAsync(p => p.Id == postId)).Should().Be(0, "fail closed");
        (await read.TelemetryEvents.CountAsync(e => e.EventId == eventId)).Should().Be(0, "fail closed");

        await AssertRowsPhysicallyExistAsync(personaId, postId, eventId);
    }

    [RequiresDockerFact]
    public async Task UnsetScope_NullCurrentExerciseId_ReturnsZeroScopedRows_FailClosed()
    {
        var (personaId, postId, eventId) = await SeedOneOfEachAsync();

        // The other fail-closed input shape: an accessor is present but its CurrentExerciseId is null. The
        // ctor's `?? Guid.Empty` collapses that to the empty scope — still zero rows, never all exercises.
        await using var read = _fixture.CreateContext(new ExerciseContext());

        (await read.Personas.CountAsync(p => p.Id == personaId)).Should().Be(
            0, "a null CurrentExerciseId collapses to Guid.Empty via `?? Guid.Empty` — fail closed");
        (await read.Posts.CountAsync(p => p.Id == postId)).Should().Be(0, "fail closed");
        (await read.TelemetryEvents.CountAsync(e => e.EventId == eventId)).Should().Be(0, "fail closed");

        await AssertRowsPhysicallyExistAsync(personaId, postId, eventId);
    }

    [RequiresDockerFact]
    public async Task IdorAttempt_FindByKnownCrossExerciseId_ReturnsNull()
    {
        // The realistic attack shape: a participant in exercise A learns (or guesses) another exercise's
        // real row id — e.g. from a shared link, a leaked screenshot, or brute-forcing a sequential-looking
        // guid — and asks the API to fetch it directly by id, NOT via a filtered list. `FindAsync`/
        // `SingleOrDefaultAsync` are exactly the shape a "get by id" endpoint would use, and must be just as
        // fail-closed as the list-query path above.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var postA = Guid.NewGuid();
        var postB = Guid.NewGuid();
        var personaA = Guid.NewGuid();
        var personaB = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Posts.Add(NewPost(postA, exerciseA));
            seed.Posts.Add(NewPost(postB, exerciseB));
            seed.Personas.Add(NewPersona(personaA, exerciseA));
            seed.Personas.Add(NewPersona(personaB, exerciseB));
            await seed.SaveChangesAsync();
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));

        (await readA.Posts.FindAsync(postB)).Should().BeNull(
            "FindAsync by exercise B's real post id, from an exercise-A scope, must not resolve the row — " +
            "an IDOR attempt against a known/guessed foreign id must fail closed like a list query does");
        (await readA.Posts.SingleOrDefaultAsync(p => p.Id == postB)).Should().BeNull(
            "SingleOrDefaultAsync by exercise B's post id must also be filtered out under exercise A's scope");
        (await readA.Personas.FindAsync(personaB)).Should().BeNull(
            "FindAsync by exercise B's real persona id must not resolve under exercise A's scope");

        // Sanity: the same lookups DO resolve the caller's own exercise's rows, proving the null above is
        // isolation, not a broken/no-op Find.
        (await readA.Posts.FindAsync(postA)).Should().NotBeNull("the caller's own exercise A post must still resolve");
        (await readA.Personas.FindAsync(personaA)).Should().NotBeNull("the caller's own exercise A persona must still resolve");
    }

    [RequiresDockerFact]
    public async Task AggregateCount_InExerciseA_ExcludesExerciseBRows_NoTotalLeak()
    {
        // A different leak shape than a targeted id lookup: an unfiltered COUNT (e.g. a "N posts in this
        // exercise" dashboard stat) must reflect only the scoped exercise's rows, never the combined total
        // across exercises — an aggregate is just as capable of leaking the SIZE of another exercise as a
        // list query is of leaking its CONTENT.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            for (var i = 0; i < 3; i++)
            {
                seed.Posts.Add(NewPost(Guid.NewGuid(), exerciseA));
            }

            for (var i = 0; i < 5; i++)
            {
                seed.Posts.Add(NewPost(Guid.NewGuid(), exerciseB));
            }

            await seed.SaveChangesAsync();
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));

        // No predicate at all: a naive `_context.Posts.CountAsync()` dashboard-style call.
        (await readA.Posts.CountAsync()).Should().Be(
            3, "an unfiltered count under exercise A's scope must equal exactly A's row count (3), never A+B " +
               "(8) or B's alone (5) — the filter must confine aggregates, not only itemised reads");
    }

    [RequiresDockerFact]
    public async Task UnrelatedThirdExerciseScope_SeesNeitherSeededExercise()
    {
        // A third, wholly unrelated exercise C's scope (not seeded with any rows of its own) must see ZERO
        // rows of either A or B — proving the filter is a positive match on the caller's own scope, not
        // merely "not exercise A" or "not exercise B" exclusion logic that could accidentally admit a third
        // party.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var exerciseC = Guid.NewGuid();
        var postA = Guid.NewGuid();
        var postB = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Posts.Add(NewPost(postA, exerciseA));
            seed.Posts.Add(NewPost(postB, exerciseB));
            await seed.SaveChangesAsync();
        }

        await using var readC = _fixture.CreateContext(ScopeFor(exerciseC));

        (await readC.Posts.CountAsync(p => p.Id == postA || p.Id == postB)).Should().Be(
            0, "an unrelated exercise C, seeded with nothing of its own, must see none of exercise A's or " +
               "B's rows — the filter must be a positive match on C, not a mere exclusion of A or B");
    }

    [RequiresDockerFact]
    public async Task ExplicitGuidEmptyScope_ReturnsZeroScopedRows_FailClosed()
    {
        // A third fail-closed input shape, distinct from "null accessor" and "null CurrentExerciseId": an
        // accessor whose CurrentExerciseId is EXPLICITLY Guid.Empty (not defaulted there via `??`). Exercises
        // the ctor's capture directly rather than the `?? Guid.Empty` fallback branch, guarding against a
        // future refactor of that fallback silently changing this path's behaviour.
        var (personaId, postId, eventId) = await SeedOneOfEachAsync();

        await using var read = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = Guid.Empty });

        (await read.Personas.CountAsync(p => p.Id == personaId)).Should().Be(
            0, "an explicit Guid.Empty scope must match zero rows — no scoped row is ever persisted with an " +
               "empty ExerciseId, so this predicate can never open the door");
        (await read.Posts.CountAsync(p => p.Id == postId)).Should().Be(0, "fail closed");
        (await read.TelemetryEvents.CountAsync(e => e.EventId == eventId)).Should().Be(0, "fail closed");

        await AssertRowsPhysicallyExistAsync(personaId, postId, eventId);
    }

    [RequiresDockerFact]
    public async Task IgnoreQueryFilters_RevealsAllExercises_ProvingScopingIsTheFilter()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var postA = Guid.NewGuid();
        var postB = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Posts.Add(NewPost(postA, exerciseA));
            seed.Posts.Add(NewPost(postB, exerciseB));
            await seed.SaveChangesAsync();
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));

        (await readA.Posts.CountAsync(p => p.Id == postA || p.Id == postB)).Should().Be(
            1, "the query filter confines a scope-A read to exercise A");
        (await readA.Posts.IgnoreQueryFilters().CountAsync(p => p.Id == postA || p.Id == postB)).Should().Be(
            2, "ignoring the filter reveals BOTH rows exist — proving the scoping is the filter, not missing data");
    }

    [RequiresDockerFact]
    public async Task NonScopedEntities_AreNeverFiltered_RegardlessOfScope()
    {
        var exerciseId = Guid.NewGuid();
        var templateId = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Exercises.Add(new Exercise { Id = exerciseId, Name = "Visible Exercise" });
            seed.PersonaTemplates.Add(new PersonaTemplate
            {
                Id = templateId,
                DisplayName = "Visible Template",
                Handle = $"@t_{templateId:N}",
            });
            await seed.SaveChangesAsync();
        }

        // Read under an unrelated exercise scope — the non-scoped entities must stay fully visible.
        await using var read = _fixture.CreateContext(ScopeFor(Guid.NewGuid()));

        (await read.Exercises.CountAsync(e => e.Id == exerciseId)).Should().Be(
            1, "Exercise is the aggregate root and carries no query filter");
        (await read.PersonaTemplates.CountAsync(t => t.Id == templateId)).Should().Be(
            1, "PersonaTemplate is a shared library asset and carries no query filter");
    }

    [RequiresDockerFact]
    public async Task AddDbContext_InjectsRegisteredExerciseContext_DrivingTheFilter()
    {
        // The runtime wiring the story hinges on: AddExerciseScoping registers IExerciseContext (Scoped),
        // and AddDbContext's constructor injection resolves it into PulseDbContext's optional ctor param, so
        // the filter uses the request's exercise. (Program.cs is orchestrator-wired and untouched here.)
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var postA = Guid.NewGuid();
        var postB = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Posts.Add(NewPost(postA, exerciseA));
            seed.Posts.Add(NewPost(postB, exerciseB));
            await seed.SaveChangesAsync();
        }

        var services = new ServiceCollection();
        services.AddDbContext<PulseDbContext>(options => options.UseSqlServer(_fixture.ConnectionString));
        services.AddExerciseScoping();
        await using var provider = services.BuildServiceProvider();

        await using var scope = provider.CreateAsyncScope();

        // Set the scope's exercise BEFORE the DbContext is resolved: the context captures the value in its
        // ctor (the story's fail-closed capture-at-construction design), so ordering within the scope matters.
        var exerciseContext = (ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>();
        exerciseContext.CurrentExerciseId = exerciseA;

        var context = scope.ServiceProvider.GetRequiredService<PulseDbContext>();
        var visible = await context.Posts
            .Where(p => p.Id == postA || p.Id == postB)
            .Select(p => p.Id)
            .ToListAsync();

        visible.Should().ContainSingle().Which.Should().Be(
            postA,
            "the DI-resolved context must inject the scope's IExerciseContext and filter to its exercise — " +
            "if injection failed, the empty scope would return zero rows and this assertion would fail");
    }

    /// <summary>Seeds one scoped row of each entity type in one exercise; returns their ids.</summary>
    private async Task<(Guid PersonaId, Guid PostId, string EventId)> SeedOneOfEachAsync()
    {
        var exerciseId = Guid.NewGuid();
        var personaId = Guid.NewGuid();
        var postId = Guid.NewGuid();
        var eventId = Guid.NewGuid().ToString();

        await using var seed = _fixture.CreateContext();
        seed.Personas.Add(NewPersona(personaId, exerciseId));
        seed.Posts.Add(NewPost(postId, exerciseId));
        seed.TelemetryEvents.Add(NewTelemetry(eventId, exerciseId));
        await seed.SaveChangesAsync();

        return (personaId, postId, eventId);
    }

    /// <summary>
    /// Proves the seeded rows really landed — read with the filter ignored — so a fail-closed zero above is
    /// the FILTER closing the door, not an empty table making the assertion pass for the wrong reason.
    /// </summary>
    private async Task AssertRowsPhysicallyExistAsync(Guid personaId, Guid postId, string eventId)
    {
        await using var unfiltered = _fixture.CreateContext();

        (await unfiltered.Personas.IgnoreQueryFilters().CountAsync(p => p.Id == personaId)).Should().Be(1);
        (await unfiltered.Posts.IgnoreQueryFilters().CountAsync(p => p.Id == postId)).Should().Be(1);
        (await unfiltered.TelemetryEvents.IgnoreQueryFilters().CountAsync(e => e.EventId == eventId)).Should().Be(1);
    }
}
