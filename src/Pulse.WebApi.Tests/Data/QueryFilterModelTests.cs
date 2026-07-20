namespace Pulse.WebApi.Tests.Data;

using System;
using System.Linq;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Story <c>exercise-isolation/01</c> (#44), COR-001 — the STRUCTURAL half of "scoping is enforced
/// centrally, so a new endpoint/entity cannot forget it." These are model-only tests: they inspect
/// <see cref="PulseDbContext.Model"/> (which triggers <c>OnModelCreating</c>) without opening a
/// connection, so they run everywhere — no Docker required — and assert the read-side global query filter
/// covers EXACTLY the <see cref="IExerciseScoped"/> entities and nothing else. The behavioural proof (a
/// query in exercise A never returns exercise B rows; an unset scope fails closed) lives in
/// <see cref="QueryFilterIsolationTests"/> against a real SQL Server.
/// </summary>
public class QueryFilterModelTests
{
    private static PulseDbContext BuildModelOnlyContext()
    {
        // A provider is required to build the model, but no connection is ever opened — these tests only
        // read PulseDbContext.Model. A non-empty scope is supplied so nothing about the shape depends on it.
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer("Server=model-only;Database=none;")
            .Options;
        return new PulseDbContext(options, new ExerciseContext { CurrentExerciseId = Guid.NewGuid() });
    }

    [Theory]
    [InlineData(typeof(Persona))]
    [InlineData(typeof(Post))]
    [InlineData(typeof(TelemetryEvent))]
    public void EveryExerciseScopedEntity_HasAGlobalQueryFilter(Type scopedType)
    {
        using var context = BuildModelOnlyContext();

        var entityType = context.Model.FindEntityType(scopedType);

        entityType.Should().NotBeNull();
        entityType!.GetDeclaredQueryFilters().Should().NotBeEmpty(
            $"{scopedType.Name} is IExerciseScoped, so the central read-side filter must cover it — a scoped " +
            "entity must never be able to forget the exercise scope");
    }

    [Theory]
    [InlineData(typeof(Exercise))]
    [InlineData(typeof(PersonaTemplate))]
    public void NonScopedEntity_HasNoGlobalQueryFilter(Type unscopedType)
    {
        using var context = BuildModelOnlyContext();

        var entityType = context.Model.FindEntityType(unscopedType);

        entityType.Should().NotBeNull();
        entityType!.GetDeclaredQueryFilters().Should().BeEmpty(
            $"{unscopedType.Name} is not IExerciseScoped (aggregate root / shared library asset) and must NOT " +
            "be exercise-filtered — over-filtering would hide legitimately shared rows");
    }

    [Fact]
    public void EveryIExerciseScopedEntity_IsCoveredByTheCentralFilter_WithNoneMissed()
    {
        using var context = BuildModelOnlyContext();

        var uncovered = context.Model.GetEntityTypes()
            .Where(t => typeof(IExerciseScoped).IsAssignableFrom(t.ClrType))
            .Where(t => !t.GetDeclaredQueryFilters().Any())
            .Select(t => t.ClrType.Name)
            .ToList();

        uncovered.Should().BeEmpty(
            "the filter reflects over IExerciseScoped centrally, so EVERY scoped entity — including any added " +
            "later — is covered automatically; a scoped entity with no filter would leak across exercises");
    }

    [Fact]
    public void DbContext_ResolvesAndFailsClosed_EvenWhenExerciseScopingNotRegistered()
    {
        // Mirrors the intermediate composition state in this worktree: Program.cs wires AddDbContext but the
        // orchestrator has not yet wired AddExerciseScoping, so IExerciseContext is NOT registered. EF must
        // still construct PulseDbContext (the ctor param is OPTIONAL) — never a resolution throw — and the
        // captured scope must fail closed to Guid.Empty (a null accessor), not leak.
        var services = new ServiceCollection();
        services.AddDbContext<PulseDbContext>(options => options.UseSqlServer("Server=unused;Database=none;"));
        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        var resolve = () => scope.ServiceProvider.GetRequiredService<PulseDbContext>();

        var context = resolve.Should().NotThrow(
            "PulseDbContext's exercise-context ctor param is optional, so a missing IExerciseContext " +
            "registration must not break construction").Subject;

        // A scoped entity is still filtered (fail-closed), and IgnoreQueryFilters proves the filter — not a
        // missing configuration — is what an unscoped context suppresses.
        var post = context.Model.FindEntityType(typeof(Post));
        post!.GetDeclaredQueryFilters().Should().NotBeEmpty(
            "the central filter is present regardless of whether IExerciseContext was registered — an " +
            "unregistered accessor collapses to the empty (zero-row) scope, it does not disable the filter");
    }
}
