namespace Pulse.WebApi.Tests.Features.Portal.Data;

using FluentAssertions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Portal.Data;

/// <summary>
/// exercise-portal/01 (XC-001, always-Critical) — <see cref="PortalWriteScope"/> refuses any portal row that names an
/// exercise other than the resolved one, and every row when no exercise is resolved. Pure; no database. The database half
/// (the guarded write persists nothing) is in <see cref="PortalDataIsolationTests"/>.
/// </summary>
public class PortalWriteScopeTests
{
    private static readonly Guid ExerciseA = Guid.NewGuid();
    private static readonly Guid ExerciseB = Guid.NewGuid();

    public static TheoryData<IExerciseScoped> RowsOfA => new()
    {
        new PortalConfig { ExerciseId = ExerciseA, LayoutKey = "anchor" },
        new PortalResource { ExerciseId = ExerciseA, Title = "Open shelters" },
    };

    [Theory]
    [MemberData(nameof(RowsOfA))]
    public void ARowNamingAnotherExercise_IsRefused(IExerciseScoped rowOfA)
    {
        // Covers the stub the context's guard lets through: { Id = A's id, ExerciseId = A } attached under B, whether it
        // is about to be added, modified or removed. The check looks only at the row's exercise, so one call covers all.
        var intoB = () => PortalWriteScope.EnsureInScope(ScopeFor(ExerciseB), rowOfA);

        intoB.Should().Throw<ExerciseScopeViolationException>().WithMessage("*outside the resolved exercise scope*");
    }

    [Theory]
    [MemberData(nameof(RowsOfA))]
    public void AnUnresolvedScope_RefusesEveryRow(IExerciseScoped rowOfA)
    {
        foreach (var scope in new IExerciseContext?[] { null, new ExerciseContext(), ScopeFor(Guid.Empty) })
        {
            var unresolved = () => PortalWriteScope.EnsureInScope(scope, rowOfA);
            unresolved.Should().Throw<ExerciseScopeViolationException>("no resolved exercise, no write");
        }
    }

    [Fact]
    public void AnEmptyIdRow_IsRefused_EvenThoughTheScopeIsResolved()
    {
        var empty = () => PortalWriteScope.EnsureInScope(
            ScopeFor(ExerciseA), new PortalResource { ExerciseId = Guid.Empty, Title = "Open shelters" });

        empty.Should().Throw<ExerciseScopeViolationException>();
    }

    [Theory]
    [MemberData(nameof(RowsOfA))]
    public void ARowOfTheResolvedExercise_IsAllowed(IExerciseScoped rowOfA)
    {
        var own = () => PortalWriteScope.EnsureInScope(ScopeFor(ExerciseA), rowOfA);

        own.Should().NotThrow();
    }

    private static IExerciseContext ScopeFor(Guid exerciseId) => new ExerciseContext { CurrentExerciseId = exerciseId };
}
