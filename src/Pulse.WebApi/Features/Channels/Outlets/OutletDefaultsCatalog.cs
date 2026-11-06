namespace Pulse.WebApi.Features.Channels.Outlets;

using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// The "add default outlets" catalog (channels-foundation story 03, AC "Defaults"): the starter outlets
/// <c>POST /api/outlets/defaults</c> creates for one content channel.
/// </summary>
/// <remarks>
/// <para>
/// <b>DEMO CONFIG, not shell brand.</b> Like the "Fairhaven" strings, these names belong to the demo fiction, not to
/// the platform: nothing in shell or channel code may key on them. A planner renames, disables or deletes them like any
/// other outlet. Skin keys name the registered token files (FC-8a); paired handles name personas from the cast library
/// (<c>PersonaCastSeeder</c>), resolved in the exercise at creation time and left unpaired when absent (creating the
/// persona is E2's).
/// </para>
/// <para>
/// <b>Metro Desk 9.</b> The story text lists "Newsline 7"; docs/design/DECISIONS.md FIC-001 (Tom, 10/13) renamed the
/// station to Metro Desk 9 / <c>@MetroDesk9</c> and the cast seeder retired the old name, so the entry uses the new
/// name. Its skin key stays <c>newsline7</c> because E4's token file is registered under that key.
/// </para>
/// <para>
/// <b>Weather has exactly one default</b> (<c>weather-desk</c>, paired <c>@WeatherDesk</c>, D4-011), so weather
/// products resolve their outlet by channel without a picker (weather FU-8).
/// </para>
/// </remarks>
public sealed class OutletDefaultsCatalog
{
    /// <summary>Every default outlet, grouped by channel in <see cref="ChannelVocabulary.ContentChannelIds"/> order.</summary>
    public IReadOnlyList<OutletDefault> Entries { get; } =
    [
        new(
            ChannelVocabulary.News,
            "metro-desk-9",
            "Metro Desk 9",
            "Local news, weather and traffic, around the clock.",
            "newsline7",
            "MetroDesk9",
            ["Local", "Weather", "Traffic", "Community"]),
        new(
            ChannelVocabulary.News,
            "courier-ledger",
            "The Courier-Ledger",
            "Your community newspaper.",
            "courier-ledger",
            null,
            ["Local", "Government", "Business", "Opinion"]),
        new(
            ChannelVocabulary.News,
            "national-wire",
            "The National Wire",
            "News from across the country.",
            "national-wire",
            null,
            ["National", "Politics", "Business", "Science"]),
        new(
            ChannelVocabulary.News,
            "the-scoop",
            "The Scoop",
            "The stories everyone is talking about.",
            "the-scoop",
            "TheScoopHQ",
            ["Trending", "Local", "Viral", "Opinion"]),
        new(
            ChannelVocabulary.Press,
            "wire-room",
            "The Wire Room",
            "Official statements and news releases.",
            "wire-room",
            null,
            ["Statements", "Advisories", "Updates"]),
        new(
            ChannelVocabulary.Weather,
            "weather-desk",
            "The Weather Desk",
            "Forecasts, watches and warnings.",
            "weather-desk",
            "WeatherDesk",
            []),
    ];

    /// <summary>The defaults for one channel, in catalog order.</summary>
    /// <param name="channelId">A channel id.</param>
    /// <returns>The channel's entries; empty for a channel with none.</returns>
    public IReadOnlyList<OutletDefault> ForChannel(string channelId) =>
        Entries.Where(entry => string.Equals(entry.ChannelId, channelId, StringComparison.Ordinal)).ToList();
}

/// <summary>One default outlet.</summary>
/// <param name="ChannelId">The content channel.</param>
/// <param name="Slug">The FC-1 slug.</param>
/// <param name="Name">The display name.</param>
/// <param name="Tagline">The strapline.</param>
/// <param name="SkinKey">The registered skin key.</param>
/// <param name="PairedHandle">The cast persona's handle (no leading <c>@</c>), or null for an unpaired outlet.</param>
/// <param name="Categories">The section categories.</param>
public sealed record OutletDefault(
    string ChannelId,
    string Slug,
    string Name,
    string Tagline,
    string SkinKey,
    string? PairedHandle,
    IReadOnlyList<string> Categories);
