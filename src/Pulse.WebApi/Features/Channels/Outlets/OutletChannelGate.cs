namespace Pulse.WebApi.Features.Channels.Outlets;

using Pulse.WebApi.Features.ExerciseConfiguration;

/// <summary>
/// The INTERIM channel-enablement check for the outlet registry's participant reads (channels-foundation story 03, AC
/// "Channel gate"): whether the RESOLVED exercise has a channel enabled (COR-030).
/// </summary>
/// <remarks>
/// <para>
/// <b>Interim; replaced by F08 (#704).</b> Its signature is exactly
/// <c>Pulse.WebApi.Features.Channels.Enablement.IChannelEnablement.IsEnabledAsync(string, CancellationToken)</c>, so the
/// swap is a one-line change of the <see cref="OutletService"/> constructor parameter (and this class deleted). Story 08
/// owns the real seam and its <c>RequireChannelEnabled</c> filter.
/// </para>
/// <para>
/// <b>Same rule as F08.</b> <c>ChannelCatalog.ParseStored(Exercise.EnabledChannels) ?? ChannelCatalog.DefaultEnabledIds</c>,
/// read through <see cref="ParticipantShellConfigService.GetChannelNavConfigAsync"/>, which applies exactly that rule
/// (so this adds no new read of the <c>Exercise</c> row, whose unbounded reads are a pinned inventory in
/// <c>OrganizationScopeSweepTests</c>). Matching is ORDINAL: an uncatalogued or wrong-case id (<c>News</c>) is not
/// enabled. An unresolved scope enables nothing; a resolved scope with no exercise row falls back to the default set
/// (social only). No staff bypass: it is applied to participant reads only, and staff writes are not gated (planners
/// prepare content before a channel is enabled, story 08).
/// </para>
/// </remarks>
public sealed class OutletChannelGate
{
    private readonly ParticipantShellConfigService _shellConfig;
    private IReadOnlySet<string>? _enabled;

    /// <summary>Creates the gate over the participant-shell config projection.</summary>
    /// <param name="shellConfig">The per-exercise shell config (scoped to the resolved exercise).</param>
    public OutletChannelGate(ParticipantShellConfigService shellConfig)
    {
        ArgumentNullException.ThrowIfNull(shellConfig);
        _shellConfig = shellConfig;
    }

    /// <summary>Whether the resolved exercise has <paramref name="channelId"/> enabled (ordinal; false when unresolved).</summary>
    /// <param name="channelId">The channel id, matched ordinally.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns><c>true</c> when the channel is enabled.</returns>
    public async Task<bool> IsEnabledAsync(string channelId, CancellationToken ct = default)
    {
        // Read once per request scope: a slug read asks about up to three channels.
        _enabled ??= await ReadEnabledAsync(ct);
        return channelId is not null && _enabled.Contains(channelId);
    }

    private async Task<IReadOnlySet<string>> ReadEnabledAsync(CancellationToken ct)
    {
        var config = await _shellConfig.GetChannelNavConfigAsync(ct);
        return config is null
            ? new HashSet<string>(StringComparer.Ordinal)
            : config.Channels.Where(channel => channel.Enabled).Select(channel => channel.Id).ToHashSet(StringComparer.Ordinal);
    }
}
