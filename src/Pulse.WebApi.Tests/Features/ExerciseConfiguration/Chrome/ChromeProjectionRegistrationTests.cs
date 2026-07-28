namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration.Chrome;

using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.ExerciseConfiguration.Chrome;
using Xunit;

/// <summary>
/// The DI half of story 02's projection-override AC: resolving <see cref="IChromeConfigProjection"/> from a
/// provider composed by the REAL <c>Add*()</c> calls, in the orchestrator's order, must yield story 02's
/// <see cref="ChromeConfigProjection"/> — not 01b's <c>TryAdd</c>ed constant default.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this exists at all.</b> The failure it guards against ships green: <c>ChromeConfigProjection</c>
/// itself is correct, <see cref="ChromeConfigProjectionTests"/> passes, and yet — had
/// <see cref="ChromeExtensions.AddComplianceChromeConfig"/> copied 01b's own <c>TryAddScoped</c> idiom — the
/// already-registered default would win silently and <c>/api/chrome-config</c> would keep serving one identical
/// banner set to every exercise. Nothing raises. Only resolving from a composed provider catches it.
/// </para>
/// <para>
/// <b>Deliberately OUTSIDE <c>MsSqlCollection</c>, with plain <see cref="FactAttribute"/>.</b> Every test here
/// is a bare <see cref="ServiceCollection"/> assertion that touches no database, so it must run everywhere —
/// including a Docker-less box with no <c>PULSE_TEST_SQL_CONNECTION</c>. Joining the SQL collection would
/// construct the container fixture regardless and turn these into hard failures exactly where a wave-3
/// contributor most needs to tell a real break in this contract from infrastructure noise. The SQL-touching
/// end-to-end half lives in <see cref="ChromeConfigCompositionTests"/>, gated with <c>[RequiresDockerFact]</c>.
/// </para>
/// </remarks>
public sealed class ChromeProjectionRegistrationTests
{
    [Fact]
    public void AddComplianceChromeConfig_RegistersTheChromeSettingsServiceAtScopedLifetime()
    {
        var services = new ServiceCollection();

        services.AddComplianceChromeConfig();

        services.Should().Contain(
            d => d.ServiceType == typeof(ChromeSettingsService) && d.Lifetime == ServiceLifetime.Scoped,
            "the chrome settings service shares the request-scoped PulseDbContext unit of work");
    }

    [Fact]
    public void ChromeProjection_WinsOverTheConstantDefault_InTheOrchestratorsOrder()
    {
        // The orchestrator's declared order: 01b's AddExerciseConfiguration() first, story 02's Add after.
        var services = new ServiceCollection();
        services.AddExerciseConfiguration();
        services.AddComplianceChromeConfig();

        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        scope.ServiceProvider.GetRequiredService<IChromeConfigProjection>()
            .Should().BeOfType<ChromeConfigProjection>(
                "story 02 registers with Replace, so its per-exercise projection is what the runtime resolves — "
                + "a TryAdd here would be a SILENT no-op leaving the constant default serving");
    }

    [Fact]
    public void ChromeProjection_WinsEvenWhenItRunsBeforeTheDefault()
    {
        // Replace is ORDER-INDEPENDENT: it swaps the descriptor whether or not the default is registered yet,
        // and 01b's subsequent TryAdd sees a registration already present and stands down.
        var services = new ServiceCollection();
        services.AddComplianceChromeConfig();
        services.AddExerciseConfiguration();

        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        scope.ServiceProvider.GetRequiredService<IChromeConfigProjection>()
            .Should().BeOfType<ChromeConfigProjection>(
                "a contributor must not depend on the orchestrator's call order to win");
    }

    [Fact]
    public void ChromeProjection_LeavesExactlyOneDescriptor_SoIEnumerableResolutionNeverSeesAStaleDefault()
    {
        var services = new ServiceCollection();
        services.AddExerciseConfiguration();
        services.AddComplianceChromeConfig();

        services.Count(d => d.ServiceType == typeof(IChromeConfigProjection)).Should().Be(
            1, "Replace swaps the descriptor rather than stacking a second one behind it");

        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        scope.ServiceProvider.GetServices<IChromeConfigProjection>().Should().ContainSingle()
            .Which.Should().BeOfType<ChromeConfigProjection>();
    }

    [Fact]
    public void ChromeProjection_IsScoped_MatchingTheRequestScopedUnitOfWork()
    {
        var services = new ServiceCollection();
        services.AddExerciseConfiguration();
        services.AddComplianceChromeConfig();

        services.Should().ContainSingle(d => d.ServiceType == typeof(IChromeConfigProjection))
            .Which.Lifetime.Should().Be(ServiceLifetime.Scoped);
    }

    [Fact]
    public void ChromeProjection_AddedTwice_StillLeavesOneDescriptor()
    {
        var services = new ServiceCollection();
        services.AddExerciseConfiguration();
        services.AddComplianceChromeConfig();
        services.AddComplianceChromeConfig();

        services.Count(d => d.ServiceType == typeof(IChromeConfigProjection)).Should().Be(1);
    }

    [Fact]
    public async Task ResolvedChromeProjection_ProducesPerExerciseOutput_NotTheConstant()
    {
        // Resolution alone is not the AC: the resolved instance must also be the thing that turns a configured
        // exercise into ITS OWN banners. This asserts both halves through one composed provider.
        var services = new ServiceCollection();
        services.AddExerciseConfiguration();
        services.AddComplianceChromeConfig();

        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();
        var projection = scope.ServiceProvider.GetRequiredService<IChromeConfigProjection>();

        var configured = await projection.ProjectAsync(new ExerciseShellConfigSource
        {
            ExerciseId = Guid.NewGuid(),
            TimeZone = "UTC",
            Status = "live",
            ComplianceChromeEnabled = true,
            WatermarkEnabled = true,
            ChromeTopText = "PER-EXERCISE TOP BANNER",
        });

        configured.Top.Text.Should().Be(
            "PER-EXERCISE TOP BANNER",
            "the resolved projection must be per-exercise; the constant default would answer with the shipped copy");
        configured.Top.Text.Should().NotBe(ParticipantShellDefaults.ChromeTopText);
    }
}
