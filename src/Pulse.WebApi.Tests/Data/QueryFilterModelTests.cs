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
    [InlineData(typeof(Organization))]
    public void NonScopedEntity_HasNoExerciseGlobalQueryFilter(Type unscopedType)
    {
        using var context = BuildModelOnlyContext();

        var entityType = context.Model.FindEntityType(unscopedType);

        entityType.Should().NotBeNull();

        // The EXERCISE axis is the anonymous (null-keyed) filter. PersonaTemplate now also carries the
        // exercise-isolation/11 ORGANIZATION filter under its own key, so "has no filters at all" is no
        // longer the right assertion — "is not confined to one EXERCISE" is, and it is the one that matters
        // here: over-filtering by exercise would hide legitimately cross-run shared rows (XC-005).
        entityType!.FindDeclaredQueryFilter(null).Should().BeNull(
            $"{unscopedType.Name} is not IExerciseScoped (aggregate root / tenant root / shared library " +
            "asset) and must NOT be exercise-filtered — over-filtering would hide legitimately shared rows");
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

    [Theory]
    [InlineData(typeof(PersonaTemplate))]
    public void EveryOrganizationScopedEntity_HasTheTenantGlobalQueryFilter(Type orgScopedType)
    {
        using var context = BuildModelOnlyContext();

        var entityType = context.Model.FindEntityType(orgScopedType);

        entityType.Should().NotBeNull();
        entityType!.FindDeclaredQueryFilter(PulseDbContext.OrganizationScopeFilterKey).Should().NotBeNull(
            $"{orgScopedType.Name} is IOrganizationScoped, so the central CUSTOMER-tenant filter must cover " +
            "it — this is exercise-isolation/11's gap 2 (a shared library asset visible to every customer)");
    }

    [Fact]
    public void EveryIOrganizationScopedEntity_IsCoveredByTheCentralTenantFilter_WithNoneMissed()
    {
        using var context = BuildModelOnlyContext();

        var uncovered = context.Model.GetEntityTypes()
            .Where(t => typeof(IOrganizationScoped).IsAssignableFrom(t.ClrType))
            .Where(t => t.FindDeclaredQueryFilter(PulseDbContext.OrganizationScopeFilterKey) is null)
            .Select(t => t.ClrType.Name)
            .ToList();

        uncovered.Should().BeEmpty(
            "the tenant filter reflects over IOrganizationScoped centrally, so EVERY org-scoped entity — " +
            "including any added later — is covered automatically; an uncovered one would leak across customers");
    }

    [Fact]
    public void TheTwoAxesAreSeparatelyKeyed_SoNeitherCanSilentlyReplaceTheOther()
    {
        // The load-bearing structural property of exercise-isolation/11. EF Core keys global query filters;
        // registering the tenant filter under the SAME (anonymous) key the exercise axis uses would REPLACE
        // the always-Critical exercise predicate on any entity carrying both markers — and the model would
        // still look "filtered". Asserting the keys are distinct is what makes that unrepresentable.
        using var context = BuildModelOnlyContext();

        var post = context.Model.FindEntityType(typeof(Post));
        post!.FindDeclaredQueryFilter(null).Should().NotBeNull(
            "the exercise axis is the anonymous (null-keyed) filter and must stay exactly where it was");
        post.FindDeclaredQueryFilter(PulseDbContext.OrganizationScopeFilterKey).Should().BeNull(
            "Post is not IOrganizationScoped — it is transitively bounded by its exercise's organization");

        var template = context.Model.FindEntityType(typeof(PersonaTemplate));
        template!.FindDeclaredQueryFilter(PulseDbContext.OrganizationScopeFilterKey).Should().NotBeNull(
            "the tenant axis is registered under its own distinct key");
        template.FindDeclaredQueryFilter(null).Should().BeNull(
            "and it did not land on the exercise axis's key, which would have made the two compete");

        PulseDbContext.OrganizationScopeFilterKey.Should().NotBeNullOrEmpty(
            "an empty/null tenant filter key would collide with the exercise axis's anonymous key");
    }

    [Fact]
    public void EveryExerciseScopedEntity_StillHasItsExerciseFilter_AfterTheTenantAxisLanded()
    {
        // A regression fence around the always-Critical guarantee: the org axis is additive, so the set of
        // exercise-filtered entities must be exactly what it was. If a future refactor moves an entity from
        // IExerciseScoped onto IOrganizationScoped to "simplify", this goes red — the tenant boundary is a
        // COARSER bound and would not protect participants of two exercises from each other.
        using var context = BuildModelOnlyContext();

        var exerciseFiltered = context.Model.GetEntityTypes()
            .Where(t => t.FindDeclaredQueryFilter(null) is not null)
            .Select(t => t.ClrType.Name)
            .ToList();

        exerciseFiltered.Should().BeEquivalentTo(
            context.Model.GetEntityTypes()
                .Where(t => typeof(IExerciseScoped).IsAssignableFrom(t.ClrType))
                .Select(t => t.ClrType.Name),
            "the exercise axis must cover exactly the IExerciseScoped entities — no more (over-filtering " +
            "hides shared rows) and no fewer (a gap leaks across exercises)");
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
