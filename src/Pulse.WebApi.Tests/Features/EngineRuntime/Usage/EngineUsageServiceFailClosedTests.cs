namespace Pulse.WebApi.Tests.Features.EngineRuntime.Usage;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Usage;
using Xunit;

/// <summary>
/// <b>The gap this file exists to close (story 03a adversarial pass).</b> <see cref="EngineUsageService"/> has its
/// OWN fail-closed scope check and its own window validation, but neither is reached by any HTTP test: every
/// cockpit request first passes through <c>EngineCockpitStaffAuthorizationFilter</c>, which returns <c>401</c> for
/// an unresolved scope itself. So <c>GetUsage_UnresolvedScope_Returns401_FailClosed</c> proves the ENDPOINT fails
/// closed while crediting the filter — the service's <see cref="EngineReviewOutcome.ScopeUnresolved"/> branch and
/// its <see cref="EngineReviewOutcome.Invalid"/> branch were both dead as far as the suite was concerned. A
/// regression that deleted them would not have reddened anything.
/// </summary>
/// <remarks>
/// <para>
/// The service is exercised directly over a <see cref="PulseDbContext"/> pointed at an UNREACHABLE SQL Server, so
/// "it refused without querying" is observable rather than asserted: had the refusal come after the query, the
/// call would have thrown a connection failure instead of returning a result.
/// <see cref="TheUnreachableHarnessReallyBites_AQueryHereThrows"/> is the positive control that keeps that
/// argument honest — without it, these tests could be passing because the harness never fails at all.
/// </para>
/// <para>
/// No Docker gate: nothing here connects to anything, by design.
/// </para>
/// </remarks>
public sealed class EngineUsageServiceFailClosedTests
{
    /// <summary>An unroutable server with a 1-second connect timeout — a query against it fails fast and loudly.</summary>
    private const string UnreachableConnectionString =
        "Server=pulse-usage-tests-no-such-host;Database=pulse;Trusted_Connection=False;User ID=x;Password=y;"
        + "Connect Timeout=1;TrustServerCertificate=true";

    [Fact]
    public async Task GetUsageAsync_WithAnUnresolvedScope_FailsClosed_WithoutEverRunningAQuery()
    {
        var service = BuildService(currentExerciseId: null);

        var result = await service.GetUsageAsync();

        result.Outcome.Should().Be(
            EngineReviewOutcome.ScopeUnresolved,
            "the SERVICE's own COR-001 fail-closed branch — not the cockpit filter's 401, which is what every "
            + "HTTP test in this feature actually exercises");
        result.Usage.Should().BeNull("a fail-closed read returns no rollup at all, not an empty/default one");
    }

    [Fact]
    public async Task GetUsageAsync_WithAnEmptyGuidScope_FailsClosedTheSameWay()
    {
        // Guid.Empty is what an unset scope collapses to inside PulseDbContext, so it must be refused UP FRONT
        // rather than handed to the query filter as a legitimate-looking exercise id.
        var service = BuildService(Guid.Empty);

        var result = await service.GetUsageAsync();

        result.Outcome.Should().Be(EngineReviewOutcome.ScopeUnresolved);
        result.Usage.Should().BeNull();
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(-1440)]
    [InlineData(1441)]
    [InlineData(int.MaxValue)]
    [InlineData(int.MinValue)]
    public async Task GetUsageAsync_WithAWindowOutsideTheBounds_IsRejectedBeforeTheQueryRuns(int windowMinutes)
    {
        var service = BuildService(Guid.NewGuid());

        var result = await service.GetUsageAsync(windowMinutes);

        result.Outcome.Should().Be(
            EngineReviewOutcome.Invalid,
            "a rejected window must be rejected before any scan is issued — and because the database here is "
            + "unreachable, returning at all is the proof that it was");
        result.ValidationError.Should().Contain(
            "windowMinutes", "the 400 body names the parameter it is talking about");
        result.Usage.Should().BeNull();
    }

    [Theory]
    [InlineData(1)]
    [InlineData(1440)]
    public async Task GetUsageAsync_AcceptsBothEndsOfTheDocumentedRange_SoTheRejectionsAboveAreNotOffByOne(
        int windowMinutes)
    {
        // Accepted means "gets as far as the query", which against the unreachable harness means it THROWS. That
        // is the assertion: an off-by-one that rejected 1 or 1440 would return Invalid instead of throwing.
        var service = BuildService(Guid.NewGuid());

        var act = async () => await service.GetUsageAsync(windowMinutes);

        await ShouldHaveReachedTheDatabaseAsync(
            act,
            "both bounds are INCLUSIVE, so the service proceeds to the scan rather than returning Invalid");
    }

    /// <summary>
    /// <b>The positive control for every "without running a query" claim above.</b> A resolved scope and a valid
    /// window must reach the database — and against this deliberately unreachable server that surfaces as a
    /// connection failure. If this test ever stopped throwing, the harness would have stopped biting and the
    /// fail-closed tests above would be proving nothing.
    /// </summary>
    [Fact]
    public async Task TheUnreachableHarnessReallyBites_AQueryHereThrows()
    {
        var service = BuildService(Guid.NewGuid());

        var act = async () => await service.GetUsageAsync(60);

        await ShouldHaveReachedTheDatabaseAsync(
            act,
            "a valid, in-scope request runs the scan — so the unreachable harness must fail loudly, which is "
            + "what makes 'it returned instead of throwing' a meaningful assertion in the tests above");
    }

    /// <summary>
    /// Asserts the call got as far as opening a connection. EF Core's SQL Server provider wraps a connection
    /// failure in an <see cref="InvalidOperationException"/> ("likely due to a transient failure … consider
    /// EnableRetryOnFailure") with the <see cref="SqlException"/> underneath, so the assertion walks the chain
    /// rather than naming the outer type — which would make this control brittle against a provider change and,
    /// worse, could turn it green-by-accident on a completely different exception.
    /// </summary>
    private static async Task ShouldHaveReachedTheDatabaseAsync(Func<Task> act, string because)
    {
        var thrown = await act.Should().ThrowAsync<Exception>(because);

        var sqlFailureInChain = false;
        for (Exception? error = thrown.Which; error is not null; error = error.InnerException)
        {
            sqlFailureInChain |= error is SqlException;
        }

        sqlFailureInChain.Should().BeTrue(
            "the failure must be a SQL CONNECTION failure — that is what proves the query was actually issued, "
            + "rather than some unrelated exception making this control pass for the wrong reason");
    }

    private static EngineUsageService BuildService(Guid? currentExerciseId)
    {
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(UnreachableConnectionString)
            .Options;

        var context = new PulseDbContext(
            options,
            new ExerciseContext { CurrentExerciseId = currentExerciseId });

        return new EngineUsageService(
            context,
            new ExerciseContext { CurrentExerciseId = currentExerciseId },
            Options.Create(new EngineUsagePricingOptions()));
    }
}
