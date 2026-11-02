namespace Pulse.WebApi.Features.Channels.Content.Read;

using System.Buffers.Text;
using System.Globalization;
using System.Text;

/// <summary>
/// The opaque <c>nextCursor</c> of <c>GET /api/channels/{channelId}/content</c>: where the previous page stopped.
/// </summary>
/// <remarks>
/// <para>
/// Three stages, one per ordering the list can be in:
/// <list type="bullet">
/// <item><see cref="ContentListStage.Recency"/> (plain list): keyset on <c>PublishedScenarioTime</c> descending. A frozen
/// clock can publish many items at one instant, so the cursor carries the last instant served and how many of ITS rows
/// were served (the <c>AlertReader</c> history pattern: Guid comparisons are not translatable, so the offset applies
/// within the tie only).</item>
/// <item><see cref="ContentListStage.Featured"/> (<c>featured=true</c>, still inside the featured block): an offset into
/// the one combined "featured by rank, then the rest by recency" ordering. The featured block is a hand-curated handful,
/// so the offset is short.</item>
/// <item><see cref="ContentListStage.FeaturedRest"/> (<c>featured=true</c>, past the featured block): the recency keyset
/// over the non-featured rows only.</item>
/// </list>
/// </para>
/// <para>A cursor from one ordering is refused by the other (a 400), so a client cannot splice a plain page onto a
/// featured one.</para>
/// </remarks>
internal readonly record struct ContentListCursor(ContentListStage Stage, long UtcTicks, int Served)
{
    private const char RecencyTag = 'r';
    private const char FeaturedTag = 'f';
    private const char FeaturedRestTag = 'n';

    /// <summary>The cursor as its opaque wire string.</summary>
    /// <returns>Base64url text.</returns>
    public string Encode()
    {
        var tag = Stage switch
        {
            ContentListStage.Recency => RecencyTag,
            ContentListStage.Featured => FeaturedTag,
            _ => FeaturedRestTag,
        };
        var text = string.Create(CultureInfo.InvariantCulture, $"{tag}:{UtcTicks}:{Served}");
        return Base64Url.EncodeToString(Encoding.UTF8.GetBytes(text));
    }

    /// <summary>Decodes a cursor this endpoint issued.</summary>
    /// <param name="value">The wire string.</param>
    /// <param name="cursor">The decoded cursor.</param>
    /// <returns>Whether <paramref name="value"/> is a well-formed cursor.</returns>
    public static bool TryDecode(string value, out ContentListCursor cursor)
    {
        cursor = default;
        string text;
        try
        {
            text = Encoding.UTF8.GetString(Base64Url.DecodeFromChars(value));
        }
        catch (FormatException)
        {
            return false;
        }

        var parts = text.Split(':');
        if (parts.Length != 3
            || parts[0].Length != 1
            || !long.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var ticks)
            || !int.TryParse(parts[2], NumberStyles.None, CultureInfo.InvariantCulture, out var served)
            || served < 1)
        {
            return false;
        }

        ContentListStage stage;
        switch (parts[0][0])
        {
            case RecencyTag:
                stage = ContentListStage.Recency;
                break;
            case FeaturedTag:
                stage = ContentListStage.Featured;
                break;
            case FeaturedRestTag:
                stage = ContentListStage.FeaturedRest;
                break;
            default:
                return false;
        }

        if (stage == ContentListStage.Featured ? ticks != 0 : ticks < DateTimeOffset.MinValue.UtcTicks || ticks > DateTimeOffset.MaxValue.UtcTicks)
        {
            return false;
        }

        cursor = new ContentListCursor(stage, ticks, served);
        return true;
    }
}

/// <summary>Which ordering, and which part of it, a <see cref="ContentListCursor"/> resumes.</summary>
internal enum ContentListStage
{
    /// <summary>The plain newest-first list.</summary>
    Recency,

    /// <summary>Inside the featured block of a <c>featured=true</c> list (an offset into the combined ordering).</summary>
    Featured,

    /// <summary>Past the featured block of a <c>featured=true</c> list (recency keyset over non-featured rows).</summary>
    FeaturedRest,
}
