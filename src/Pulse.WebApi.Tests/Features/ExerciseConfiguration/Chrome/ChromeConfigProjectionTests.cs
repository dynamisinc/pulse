namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration.Chrome;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.ExerciseConfiguration.Chrome;
using Xunit;

/// <summary>
/// Unit coverage for story 02's per-exercise <see cref="ChromeConfigProjection"/>: the FROZEN
/// <c>ChromeConfigResponse</c> is filled from the resolved exercise's columns, an unconfigured column falls
/// back to the shipped Phase-1 constant, and the NFR-008 invariant is applied on the read path too.
/// </summary>
/// <remarks>
/// <b>These tests cannot prove the story's DI AC on their own — by design.</b> They exercise the projection
/// CLASS directly, which is exactly the thing that still passes when the registration idiom is wrong and the
/// constant default keeps serving. <see cref="ChromeProjectionRegistrationTests"/> (pure DI) and
/// <see cref="ChromeConfigCompositionTests"/> (real HTTP over a composed host) are what close that gap.
/// No SQL here, so plain <see cref="FactAttribute"/> outside <c>MsSqlCollection</c>.
/// </remarks>
public sealed class ChromeConfigProjectionTests
{
    private static readonly ChromeConfigProjection Projection = new();

    [Fact]
    public async Task ProjectAsync_WithAFullyConfiguredExercise_ServesThatExercisesOwnBanners()
    {
        var source = Source(configure: s => s with
        {
            ChromeTopText = "SECRET // EXERCISE ONLY",
            ChromeTopFg = "#ffffff",
            ChromeTopBg = "#111111",
            ChromeBottomText = "ATLANTA CIE 2026 — SIMULATED",
            ChromeBottomFg = "#eeeeee",
            ChromeBottomBg = "#222222",
        });

        var config = await Projection.ProjectAsync(source);

        config.Enabled.Should().BeTrue();
        config.Top.Text.Should().Be("SECRET // EXERCISE ONLY", "the config is now per-exercise, not a constant");
        config.Top.Fg.Should().Be("#ffffff");
        config.Top.Bg.Should().Be("#111111");
        config.Bottom.Text.Should().Be("ATLANTA CIE 2026 — SIMULATED");
        config.Bottom.Fg.Should().Be("#eeeeee");
        config.Bottom.Bg.Should().Be("#222222");
    }

    [Fact]
    public async Task ProjectAsync_ForTwoDifferentExercises_ServesDifferentBanners()
    {
        var a = await Projection.ProjectAsync(Source(configure: s => s with { ChromeTopText = "EXERCISE A BANNER" }));
        var b = await Projection.ProjectAsync(Source(configure: s => s with { ChromeTopText = "EXERCISE B BANNER" }));

        a.Top.Text.Should().Be("EXERCISE A BANNER");
        b.Top.Text.Should().Be("EXERCISE B BANNER", "one exercise's chrome must never be another's");
    }

    [Fact]
    public async Task ProjectAsync_WithAnUnconfiguredExercise_ServesTheShippedPhase1Constants()
    {
        var config = await Projection.ProjectAsync(Source());

        config.Enabled.Should().BeTrue();
        config.Top.Text.Should().Be(
            ParticipantShellDefaults.ChromeTopText,
            "a null column is not configuration — an exercise nobody edited is byte-for-byte unchanged");
        config.Top.Fg.Should().Be(ParticipantShellDefaults.ChromeBannerFg);
        config.Top.Bg.Should().Be(ParticipantShellDefaults.ChromeBannerBg);
        config.Bottom.Text.Should().Be(ParticipantShellDefaults.ChromeBottomText);
        config.Bottom.Fg.Should().Be(ParticipantShellDefaults.ChromeBannerFg);
        config.Bottom.Bg.Should().Be(ParticipantShellDefaults.ChromeBannerBg);
    }

    [Fact]
    public async Task ProjectAsync_WithABlankStoredBannerText_FallsBackRatherThanServingAnEmptyBanner()
    {
        var config = await Projection.ProjectAsync(Source(configure: s => s with { ChromeTopText = "   " }));

        config.Top.Text.Should().Be(
            ParticipantShellDefaults.ChromeTopText,
            "a whitespace-only column would render a blank classification banner, which marks nothing");
    }

    [Fact]
    public async Task ProjectAsync_WithChromeOffAndTheWatermarkOn_ServesChromeDisabled()
    {
        var source = Source(configure: s => s with { ComplianceChromeEnabled = false, WatermarkEnabled = true });

        var config = await Projection.ProjectAsync(source);

        config.Enabled.Should().BeFalse(
            "chrome-off is a legal per-exercise state (D7-008) whenever the watermark still carries the signal");
    }

    [Fact]
    public async Task ProjectAsync_WithAStoredRowThatHasBothMarkingsOff_ServesChromeEnabled_NFR008()
    {
        var source = Source(configure: s => s with { ComplianceChromeEnabled = false, WatermarkEnabled = false });

        var config = await Projection.ProjectAsync(source);

        config.Enabled.Should().BeTrue(
            "a row that violates NFR-008 (only reachable outside this API) must not serve an unmarked "
            + "participant world — the read path applies the same guard the write path enforces");
    }

    [Fact]
    public async Task ProjectAsync_FillsTheFrozenShapeAndCarriesNoProvenanceOrStaffState()
    {
        // The frozen ChromeConfigResponse is { enabled, top{text,fg,bg}, bottom{text,fg,bg} }. This asserts the
        // projection populates every one of those slots with a non-empty value: the frontend guard rejects a
        // missing key outright and the shell falls back to its default, blanking the per-exercise config.
        var config = await Projection.ProjectAsync(Source());

        config.Top.Text.Should().NotBeNullOrWhiteSpace();
        config.Top.Fg.Should().NotBeNullOrWhiteSpace();
        config.Top.Bg.Should().NotBeNullOrWhiteSpace();
        config.Bottom.Text.Should().NotBeNullOrWhiteSpace();
        config.Bottom.Fg.Should().NotBeNullOrWhiteSpace();
        config.Bottom.Bg.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task ProjectAsync_WithANullSource_Throws()
    {
        var act = async () => await Projection.ProjectAsync(null!);

        await act.Should().ThrowAsync<ArgumentNullException>();
    }

    /// <summary>
    /// Builds a participant-safe read model for a fresh exercise. The projection takes NO exercise id and reads
    /// no database — its whole input is this record, which <c>ParticipantShellConfigService</c> builds from the
    /// SERVER-resolved scope (COR-001).
    /// </summary>
    private static ExerciseShellConfigSource Source(Func<SourceValues, SourceValues>? configure = null)
    {
        var values = configure?.Invoke(new SourceValues()) ?? new SourceValues();

        return new ExerciseShellConfigSource
        {
            ExerciseId = Guid.NewGuid(),
            TimeZone = "UTC",
            Status = "live",
            ComplianceChromeEnabled = values.ComplianceChromeEnabled,
            WatermarkEnabled = values.WatermarkEnabled,
            ChromeTopText = values.ChromeTopText,
            ChromeTopFg = values.ChromeTopFg,
            ChromeTopBg = values.ChromeTopBg,
            ChromeBottomText = values.ChromeBottomText,
            ChromeBottomFg = values.ChromeBottomFg,
            ChromeBottomBg = values.ChromeBottomBg,
        };
    }

    /// <summary>The chrome-relevant slice of the read model, as a record so tests can tweak it with <c>with</c>.</summary>
    private sealed record SourceValues
    {
        public bool ComplianceChromeEnabled { get; init; } = true;

        public bool WatermarkEnabled { get; init; } = true;

        public string? ChromeTopText { get; init; }

        public string? ChromeTopFg { get; init; }

        public string? ChromeTopBg { get; init; }

        public string? ChromeBottomText { get; init; }

        public string? ChromeBottomFg { get; init; }

        public string? ChromeBottomBg { get; init; }
    }
}
