namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration;

using System;
using System.Threading;
using System.Threading.Tasks;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.ParticipantShell;

/// <summary>
/// Stands in for story 02's <c>ChromeConfigProjection</c> — per-exercise, not a constant.
/// </summary>
/// <remarks>
/// Shared by BOTH halves of the projection-override suite: the pure-DI
/// <see cref="ExerciseConfigurationProjectionRegistrationTests"/> (which asserts the registration idiom that
/// decides whether this type wins) and the SQL-backed <see cref="ExerciseConfigurationCompositionTests"/>
/// (which proves the winner is what real HTTP serves), so both assert about the very same type.
/// </remarks>
public sealed class ContributedChromeProjection : IChromeConfigProjection
{
    /// <summary>The top-banner text a contributed projection serves, distinct from every shipped constant.</summary>
    public const string TopText = "CONTRIBUTED TOP BANNER";

    /// <summary>The bottom-banner text, suffixed with the resolved exercise id to prove per-exercise output.</summary>
    public const string BottomText = "CONTRIBUTED BOTTOM BANNER";

    /// <inheritdoc />
    public Task<ChromeConfigResponse> ProjectAsync(ExerciseShellConfigSource source, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);

        return Task.FromResult(new ChromeConfigResponse
        {
            Enabled = source.ComplianceChromeEnabled,
            Top = new ChromeBannerConfig { Text = TopText, Fg = "#ffffff", Bg = "#000000" },
            Bottom = new ChromeBannerConfig
            {
                Text = $"{BottomText} {source.ExerciseId}",
                Fg = "#ffffff",
                Bg = "#000000",
            },
        });
    }
}

/// <summary>Stands in for story 03's shell-variant projection.</summary>
public sealed class ContributedShellVariantProjection : IShellVariantProjection
{
    /// <inheritdoc />
    public Task<ShellStateResponse> ProjectAsync(ExerciseShellConfigSource source, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);
        return Task.FromResult(new ShellStateResponse { Variant = "readOnly" });
    }
}

/// <summary>Stands in for story 03's overlay-state projection.</summary>
public sealed class ContributedOverlayStateProjection : IOverlayStateProjection
{
    /// <inheritdoc />
    public Task<OverlayStateResponse> ProjectAsync(ExerciseShellConfigSource source, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);

        return Task.FromResult(new OverlayStateResponse
        {
            State = "pause",
            Register = "out-of-fiction",
            Message = $"paused {source.ExerciseId}",
        });
    }
}
