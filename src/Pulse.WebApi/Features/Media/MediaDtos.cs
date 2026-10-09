namespace Pulse.WebApi.Features.Media;

using System.Text.Json.Serialization;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The <c>POST /api/media</c> 201 body — the server-side mirror of the frontend <c>MediaAssetView</c>
/// (implementation.md §1.5.1). Null optional members are OMITTED, never emitted as <c>null</c>. Participant-safe
/// by construction (XC-002): no blob name, content type, size, original file name or uploader.
/// </summary>
/// <param name="Id">The new <see cref="MediaAsset"/> id.</param>
/// <param name="Kind"><c>image</c> or <c>video</c> (sniffed).</param>
/// <param name="Url">The signed read URL.</param>
/// <param name="PosterUrl">The signed poster URL, for a video uploaded with a poster.</param>
/// <param name="Width">The validated width hint, when supplied.</param>
/// <param name="Height">The validated height hint, when supplied.</param>
/// <param name="DurationSec">The validated duration hint (videos), when supplied.</param>
public sealed record MediaAssetView(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("url")] string Url,
    [property: JsonPropertyName("posterUrl"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? PosterUrl = null,
    [property: JsonPropertyName("width"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? Width = null,
    [property: JsonPropertyName("height"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? Height = null,
    [property: JsonPropertyName("durationSec"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] double? DurationSec = null)
{
    /// <summary>Projects an asset plus its signed URLs. Reads only participant-safe members of the entity.</summary>
    /// <param name="asset">The asset.</param>
    /// <param name="url">Its signed read URL.</param>
    /// <param name="posterUrl">Its poster's signed read URL, if any.</param>
    /// <returns>The view.</returns>
    public static MediaAssetView FromAsset(MediaAsset asset, string url, string? posterUrl)
    {
        ArgumentNullException.ThrowIfNull(asset);
        ArgumentException.ThrowIfNullOrEmpty(url);

        return new MediaAssetView(asset.Id.ToString(), asset.Kind, url, posterUrl, asset.Width, asset.Height, asset.DurationSec);
    }
}

/// <summary>
/// One <c>GET /api/staff/media</c> library row — the server-side mirror of the frontend
/// <c>StaffMediaAssetView</c> (<c>MediaAssetView &amp; { fileName; uploadedAtScenario }</c>). STAFF-ONLY; the
/// participant shape never carries <see cref="FileName"/> or <see cref="UploadedAtScenario"/>.
/// </summary>
/// <param name="Id">The asset id.</param>
/// <param name="Kind"><c>image</c> or <c>video</c>.</param>
/// <param name="Url">The signed read URL.</param>
/// <param name="FileName">The sanitized original file name.</param>
/// <param name="UploadedAtScenario">
/// The SCENARIO instant of the upload, round-trip ISO-8601 (COR-053). Staff-only metadata: when no scenario clock
/// existed at upload (e.g. seeding during <c>build</c>) it is the server wall clock — the DP-18a staff-metadata
/// exception; it is never on a participant payload.
/// </param>
/// <param name="PosterUrl">The signed poster URL, for a video with a poster.</param>
/// <param name="Width">Pixel width, when known.</param>
/// <param name="Height">Pixel height, when known.</param>
/// <param name="DurationSec">Video duration, when known.</param>
public sealed record StaffMediaAssetView(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("url")] string Url,
    [property: JsonPropertyName("fileName")] string FileName,
    [property: JsonPropertyName("uploadedAtScenario")] string UploadedAtScenario,
    [property: JsonPropertyName("posterUrl"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? PosterUrl = null,
    [property: JsonPropertyName("width"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? Width = null,
    [property: JsonPropertyName("height"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? Height = null,
    [property: JsonPropertyName("durationSec"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] double? DurationSec = null)
{
    /// <summary>Projects an asset plus its signed URLs for the staff library.</summary>
    /// <param name="asset">The asset.</param>
    /// <param name="url">Its signed read URL.</param>
    /// <param name="posterUrl">Its poster's signed read URL, if any.</param>
    /// <returns>The staff view.</returns>
    public static StaffMediaAssetView FromAsset(MediaAsset asset, string url, string? posterUrl)
    {
        ArgumentNullException.ThrowIfNull(asset);
        ArgumentException.ThrowIfNullOrEmpty(url);

        return new StaffMediaAssetView(
            asset.Id.ToString(),
            asset.Kind,
            url,
            asset.OriginalFileName,
            asset.CreatedScenarioTime.ToString("O"),
            posterUrl,
            asset.Width,
            asset.Height,
            asset.DurationSec);
    }
}

/// <summary>The <c>{"error":"&lt;code&gt;"}</c> body 429/503 answer with (implementation.md §1.1).</summary>
/// <param name="Error">The machine-readable error code.</param>
public sealed record MediaErrorDto([property: JsonPropertyName("error")] string Error);
