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

/// <summary>
/// The <c>POST /api/media/documents</c> 201 body (press-room story 02; PC-1 <c>payload.document</c>): exactly
/// <c>{ mediaId, fileName, sizeBytes }</c> — no URL, no page count, no extracted text. For a document the download
/// name is participant-visible BY DESIGN (it names the attachment a release carries); it is the normalized,
/// <c>.pdf</c>-terminated name, never the raw client value.
/// </summary>
/// <param name="MediaId">The new <see cref="MediaAsset"/> id.</param>
/// <param name="FileName">The normalized download name.</param>
/// <param name="SizeBytes">The stored size in bytes.</param>
public sealed record DocumentUploadView(
    [property: JsonPropertyName("mediaId")] string MediaId,
    [property: JsonPropertyName("fileName")] string FileName,
    [property: JsonPropertyName("sizeBytes")] long SizeBytes)
{
    /// <summary>Projects a stored document.</summary>
    /// <param name="asset">The document asset.</param>
    /// <returns>The view.</returns>
    public static DocumentUploadView FromAsset(MediaAsset asset)
    {
        ArgumentNullException.ThrowIfNull(asset);

        return new DocumentUploadView(asset.Id.ToString(), asset.OriginalFileName, asset.Bytes);
    }
}

/// <summary>
/// The <c>GET /api/media/documents/{id}</c> 200 body: the upload view plus a signed, download-only URL (the signer
/// pins <c>application/pdf</c> and an <c>attachment</c> disposition).
/// </summary>
/// <param name="MediaId">The document id.</param>
/// <param name="FileName">The normalized download name.</param>
/// <param name="SizeBytes">The stored size in bytes.</param>
/// <param name="Url">The signed download URL.</param>
public sealed record DocumentDownloadView(
    [property: JsonPropertyName("mediaId")] string MediaId,
    [property: JsonPropertyName("fileName")] string FileName,
    [property: JsonPropertyName("sizeBytes")] long SizeBytes,
    [property: JsonPropertyName("url")] string Url);

/// <summary>
/// The 422 body for a document the structural scan rejected: <c>{"error":"document-rejected","reason":"&lt;code&gt;"}</c>.
/// The reason is one of <c>DocumentRejectionReasons</c> — never the matched token, its offset or any scanner detail.
/// </summary>
/// <param name="Error">Always <c>document-rejected</c>.</param>
/// <param name="Reason">The reason code.</param>
public sealed record DocumentRejectedDto(
    [property: JsonPropertyName("error")] string Error,
    [property: JsonPropertyName("reason")] string Reason);
