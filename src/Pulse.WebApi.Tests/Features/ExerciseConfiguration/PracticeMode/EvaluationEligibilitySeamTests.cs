namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration.PracticeMode;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseConfiguration.PracticeMode;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// The end-to-end half of story 04's "the seam actually resolves" AC: <see cref="IEvaluationEligibility"/>
/// resolved from a FULLY COMPOSED, running host (the orchestrator's wiring order) and answering against real
/// SQL for a flagged and an unflagged exercise — the contract E10's export filtering will consume.
/// </summary>
/// <remarks>
/// Its sibling <see cref="PracticeModeRegistrationTests"/> holds the Docker-free DI half. This class needs a
/// real database (the verdict is a query), so every test is <c>[RequiresDockerFact]</c> in the shared SQL
/// collection.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class EvaluationEligibilitySeamTests
{
    private readonly MsSqlContainerFixture _fixture;

    public EvaluationEligibilitySeamTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task Verdict_ForAnExerciseThatWasNeverFlagged_IsEligible()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var verdict = await GetVerdictAsync(host);

        verdict.IsEligible.Should().BeTrue(
            "an exercise that has never been flagged is real conduct — its data belongs in the AAR (COR-033)");
        verdict.Reason.Should().Be(EvaluationEligibilityReason.Eligible);
        verdict.ExerciseId.Should().Be(exerciseId, "the verdict echoes the SERVER-resolved scope");
    }

    [RequiresDockerFact]
    public async Task Verdict_ForAFlaggedExercise_IsNotEligible_AndSaysWhy()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, practiceMode: true);

        await using var host = await StartHostAsync(exerciseId);
        var verdict = await GetVerdictAsync(host);

        verdict.IsEligible.Should().BeFalse(
            "a practice/sandbox rehearsal must never pollute an evaluation export (COR-033)");
        verdict.Reason.Should().Be(
            EvaluationEligibilityReason.PracticeExercise,
            "the reason lets an export log WHY it excluded a run without re-deriving the rule");
    }

    [RequiresDockerFact]
    public async Task Verdict_WithNoResolvedScope_IsNotEligible_FailingClosed()
    {
        await using var host = await StartHostAsync(exerciseId: null);
        var verdict = await GetVerdictAsync(host);

        verdict.IsEligible.Should().BeFalse(
            "an unresolved scope must fail closed — a broken deployment omits data rather than publishing it");
        verdict.Reason.Should().Be(EvaluationEligibilityReason.ScopeUnresolved);
        verdict.ExerciseId.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task Verdict_ForAScopeWithNoExerciseRow_IsNotEligible_FailingClosed()
    {
        var missingExerciseId = Guid.NewGuid();

        // authenticatedStaff:false so the host seeds NO exercise row for the resolved scope.
        await using var host = await StartHostAsync(missingExerciseId, authenticatedStaff: false);
        var verdict = await GetVerdictAsync(host);

        verdict.IsEligible.Should().BeFalse("an exercise the seam cannot find is never assumed to be real conduct");
        verdict.Reason.Should().Be(EvaluationEligibilityReason.ExerciseNotFound);
    }

    [RequiresDockerFact]
    public async Task Verdict_IsReadLive_SoFlaggingAnExerciseTakesEffectImmediately()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        (await GetVerdictAsync(host)).IsEligible.Should().BeTrue();

        await using (var context = _fixture.CreateContext())
        {
            var exercise = await context.Exercises.SingleAsync(e => e.Id == exerciseId);
            exercise.IsPracticeMode = true;
            await context.SaveChangesAsync();
        }

        (await GetVerdictAsync(host)).IsEligible.Should().BeFalse(
            "the verdict is a live read with no caching, so an export always sees the CURRENT flag");
    }

    [RequiresDockerFact]
    public async Task Verdict_InExerciseA_IsUnaffectedByExerciseBsFlag()
    {
        // Isolation (always-Critical): Exercise is the SCOPE, not an IExerciseScoped entity, so the central
        // query filter is a NO-OP on this table. The seam's own scoping is the only guard — and it takes the
        // exercise from IExerciseContext alone (there is no id parameter to aim anywhere else).
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        await SeedExerciseAsync(exerciseA);
        await SeedExerciseAsync(exerciseB, practiceMode: true);

        await using var hostA = await StartHostAsync(exerciseA);
        var verdictA = await GetVerdictAsync(hostA);

        verdictA.IsEligible.Should().BeTrue("A is real conduct; B being a rehearsal is none of A's business");
        verdictA.ExerciseId.Should().Be(exerciseA);

        await using var hostB = await StartHostAsync(exerciseB);
        var verdictB = await GetVerdictAsync(hostB);

        verdictB.IsEligible.Should().BeFalse("B is the flagged rehearsal");
        verdictB.ExerciseId.Should().Be(exerciseB);
    }

    // ---- helpers ---------------------------------------------------------------------------------

    /// <summary>Resolves the seam from the host's FULLY COMPOSED provider — the point of the AC.</summary>
    private static async Task<EvaluationEligibilityVerdict> GetVerdictAsync(PracticeModeTestHost host)
    {
        using var scope = host.Services.CreateScope();
        var eligibility = scope.ServiceProvider.GetRequiredService<IEvaluationEligibility>();

        eligibility.Should().BeOfType<PracticeModeEvaluationEligibility>(
            "AddPracticeMode() must be what the composed host resolves — a slice can merge green with its "
            + "composition-root wiring never executed");

        return await eligibility.GetVerdictAsync();
    }

    private async Task SeedExerciseAsync(Guid exerciseId, bool practiceMode = false)
    {
        var exercise = ExerciseConfigurationTestData.UnconfiguredExercise(exerciseId, "Eligibility Seam Exercise");
        exercise.IsPracticeMode = practiceMode;

        await using var context = _fixture.CreateContext();
        context.Exercises.Add(exercise);
        await context.SaveChangesAsync();
    }

    private Task<PracticeModeTestHost> StartHostAsync(Guid? exerciseId, bool authenticatedStaff = true)
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");
        return PracticeModeTestHost.StartAsync(_fixture.ConnectionString!, exerciseId, authenticatedStaff);
    }
}
