namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration.PracticeMode;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.ExerciseConfiguration.PracticeMode;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Xunit;

/// <summary>
/// Composition-root guard for <c>AddPracticeMode()</c> (exercise-configuration story 04, COR-033) — the DI
/// half of the story's "the seam actually resolves" AC. <see cref="IEvaluationEligibility"/> is the ONE read
/// E10's export filtering will consume, so the registration idiom itself is under test, not just the class.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why a DI-RESOLUTION test and not only a unit test of the implementation.</b> A slice can merge fully
/// green with its composition-root wiring never executed: the implementation class is correct, its own tests
/// pass, and at runtime nothing is registered (or a competing registration wins). These tests build a
/// provider from the real extension methods in the orchestrator's declared order and resolve through it.
/// </para>
/// <para>
/// <b>Why this class is deliberately NOT in <c>MsSqlCollection</c> (plain <see cref="FactAttribute"/>, no
/// Docker).</b> Every test here is a service-collection/provider assertion that opens no connection — an
/// EF <c>DbContext</c> is constructed lazily and connects only when a query runs — so it must run everywhere,
/// including a Docker-less box with no <c>PULSE_TEST_SQL_CONNECTION</c>. Joining the SQL collection would
/// construct the container fixture for this class regardless and turn these into hard infrastructure
/// failures, which was a Gate-2 finding on the sibling suite. The end-to-end half — the seam answering
/// correctly for a flagged and an unflagged exercise through a fully composed, running host — genuinely needs
/// SQL and lives in <see cref="EvaluationEligibilitySeamTests"/> under <c>[RequiresDockerFact]</c>.
/// </para>
/// </remarks>
public sealed class PracticeModeRegistrationTests
{
    [Fact]
    public void AddPracticeMode_RegistersTheSeamAndTheServiceAtScopedLifetime()
    {
        var services = new ServiceCollection();

        services.AddPracticeMode();

        services.Should().Contain(
            d => d.ServiceType == typeof(IEvaluationEligibility) && d.Lifetime == ServiceLifetime.Scoped,
            "the eligibility seam reads through the request-scoped PulseDbContext / IExerciseContext unit of work");
        services.Should().Contain(
            d => d.ServiceType == typeof(PracticeModeService) && d.Lifetime == ServiceLifetime.Scoped,
            "the staff read/write service shares the same request-scoped unit of work");
    }

    [Fact]
    public void AddPracticeMode_RegistersThisStorysEligibilityImplementation_NotSomeOtherRule()
    {
        var services = new ServiceCollection();

        services.AddPracticeMode();

        services.Where(d => d.ServiceType == typeof(IEvaluationEligibility)).Should().ContainSingle()
            .Which.ImplementationType.Should().Be(
                typeof(PracticeModeEvaluationEligibility),
                "COR-033's rule must live in exactly one place, so E10 has one thing to read");
    }

    [Fact]
    public void AddPracticeMode_CalledTwice_StillLeavesASingleEligibilityDescriptor()
    {
        // Replace (not Add) is what keeps a duplicated composition call from stacking a second descriptor
        // whose order would silently decide which eligibility rule the runtime answers with.
        var services = new ServiceCollection();

        services.AddPracticeMode();
        services.AddPracticeMode();

        services.Count(d => d.ServiceType == typeof(IEvaluationEligibility)).Should().Be(1);
    }

    [Fact]
    public void AddPracticeMode_WinsOverAPreExistingEligibilityRegistration_RegardlessOfOrder()
    {
        // Order-independence is the whole reason Replace is this feature's mandated idiom: whether a default
        // (or another contributor) registered first or not, exactly one descriptor is left and it is this
        // story's. A TryAdd here would stand down silently and leave the other rule serving.
        var services = new ServiceCollection();
        services.AddScoped<IEvaluationEligibility, AlwaysEligibleStub>();

        services.AddPracticeMode();

        services.Count(d => d.ServiceType == typeof(IEvaluationEligibility)).Should().Be(1);
        services.Single(d => d.ServiceType == typeof(IEvaluationEligibility)).ImplementationType
            .Should().Be(typeof(PracticeModeEvaluationEligibility));
    }

    [Fact]
    public void ComposedProvider_ResolvesTheSeamAndTheService_InTheOrchestratorsOrder()
    {
        // The orchestrator's declared order: persistence + scoping + staff identity, then 01b's slice, then
        // this story's contribution. Resolving through the real graph is what proves AddPracticeMode() is
        // genuinely wired rather than that the classes merely compile.
        using var provider = BuildComposedProvider();
        using var scope = provider.CreateScope();

        scope.ServiceProvider.GetRequiredService<IEvaluationEligibility>()
            .Should().BeOfType<PracticeModeEvaluationEligibility>(
                "the COR-033 rule E10 will read must be the one the runtime resolves");
        scope.ServiceProvider.GetRequiredService<PracticeModeService>()
            .Should().NotBeNull("the staff read/write surface must resolve every dependency it declares");
    }

    [Fact]
    public void ComposedProvider_ResolvesTheSeamPerScope_NeverAsASingleton()
    {
        // The verdict is a LIVE read of a staff-settable flag through a request-scoped DbContext. A captured
        // singleton would answer from a stale unit of work — an export could then include a run that was
        // flagged practice before it started.
        using var provider = BuildComposedProvider();

        using var first = provider.CreateScope();
        using var second = provider.CreateScope();

        first.ServiceProvider.GetRequiredService<IEvaluationEligibility>()
            .Should().NotBeSameAs(second.ServiceProvider.GetRequiredService<IEvaluationEligibility>());
    }

    /// <summary>
    /// Builds the fully composed provider in the orchestrator's order. The connection string is never
    /// connected to — nothing here executes a query — so this stays a Docker-free, SQL-free DI assertion.
    /// </summary>
    private static ServiceProvider BuildComposedProvider()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = "Server=(local);Database=PulseDiOnly;Trusted_Connection=True;",
            })
            .Build();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddPulsePersistence(configuration);
        services.AddExerciseScoping();
        services.AddScoped<StaffAssignmentService>();
        services.RemoveAll<ICurrentStaffSessionAccessor>();
        services.AddScoped<ICurrentStaffSessionAccessor>(_ => new StubCurrentStaffSessionAccessor(null));
        services.AddExerciseConfiguration();
        services.AddPracticeMode();

        return services.BuildServiceProvider(validateScopes: true);
    }

    /// <summary>
    /// A competing eligibility rule standing in for a fail-safe default or another contributor, used to prove
    /// this story's <c>Replace</c> registration wins regardless of order.
    /// </summary>
    private sealed class AlwaysEligibleStub : IEvaluationEligibility
    {
        public Task<EvaluationEligibilityVerdict> GetVerdictAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(EvaluationEligibilityVerdict.Eligible(Guid.NewGuid()));
    }
}
