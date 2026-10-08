namespace Pulse.WebApi.Features.Media;

/// <summary>
/// The closed vocabulary of <see cref="MediaStorageOptions.Provider"/> values (demo-polish <c>implementation.md</c>
/// §1.7). Anything else — including an unset value — is treated as <see cref="None"/> (fail closed).
/// </summary>
public static class MediaStorageProviders
{
    /// <summary>Azure Blob Storage through <c>DefaultAzureCredential</c> (keyless). The UAT/production provider.</summary>
    public const string Azure = "Azure";

    /// <summary>A directory on the local disk. Honoured ONLY when <c>ASPNETCORE_ENVIRONMENT=Development</c>.</summary>
    public const string Local = "Local";

    /// <summary>No store: <c>POST /api/media</c> answers 503 while the rest of the API keeps working.</summary>
    public const string None = "None";
}

/// <summary>
/// The blob-storage settings, bound from <see cref="SectionName"/>. The key names match the app settings
/// <c>infrastructure/modules/webapp.bicep</c> deploys VERBATIM (<c>Azure__BlobStorage__Provider</c>,
/// <c>Azure__BlobStorage__ServiceUri</c>, <c>Azure__BlobStorage__ContainerName</c>).
/// </summary>
/// <remarks>
/// <b>There is deliberately no connection-string or account-key member.</b> Media storage is keyless: the
/// service URI plus the App Service's managed identity (<c>DefaultAzureCredential</c>) is the whole credential
/// story, so no code path exists that could authenticate with a shared key (demo-polish BM, COR-002).
/// </remarks>
public sealed class MediaStorageOptions
{
    /// <summary>The configuration section the options bind from.</summary>
    public const string SectionName = "Azure:BlobStorage";

    /// <summary>The default private container name (§1.7).</summary>
    public const string DefaultContainerName = "post-media";

    /// <summary>The default Development-only local root (§1.7), resolved against the content root.</summary>
    public const string DefaultLocalRootPath = "./.local-media";

    /// <summary>
    /// <c>Azure</c> | <c>Local</c> | <c>None</c>. The code default is <c>None</c> (uploads 503); <c>Local</c> is
    /// honoured only in Development.
    /// </summary>
    public string Provider { get; set; } = MediaStorageProviders.None;

    /// <summary>The blob service endpoint, e.g. <c>https://stpulseuat.blob.core.windows.net</c> (no key, no SAS).</summary>
    public string? ServiceUri { get; set; }

    /// <summary>The PRIVATE container uploads are written to.</summary>
    public string ContainerName { get; set; } = DefaultContainerName;

    /// <summary>The Development-only directory the local store writes to (relative paths resolve against the content root).</summary>
    public string LocalRootPath { get; set; } = DefaultLocalRootPath;
}

/// <summary>The upload limits, bound from <see cref="SectionName"/> (§1.7).</summary>
public sealed class MediaUploadOptions
{
    /// <summary>The configuration section the options bind from.</summary>
    public const string SectionName = "Media:Upload";

    /// <summary>The default image ceiling: 5 MiB.</summary>
    public const long DefaultImageMaxBytes = 5L * 1024 * 1024;

    /// <summary>The default video ceiling: 100 MiB.</summary>
    public const long DefaultVideoMaxBytes = 100L * 1024 * 1024;

    /// <summary>The default per-account upload rate (NFR-009).</summary>
    public const int DefaultPermitPerMinute = 30;

    /// <summary>
    /// Headroom added to the larger per-kind ceiling for the endpoint's own request-size limit — the multipart
    /// boundaries, part headers and the small text fields. The per-kind ceiling is still enforced exactly while
    /// streaming; this only stops the SERVER-level limit (Kestrel's ~30 MB default) from cutting a legal video off.
    /// </summary>
    public const long MultipartOverheadBytes = 1024 * 1024;

    /// <summary>The streamed ceiling for an image (jpeg/png/gif/webp), enforced while reading.</summary>
    public long ImageMaxBytes { get; set; } = DefaultImageMaxBytes;

    /// <summary>The streamed ceiling for a video (mp4/webm), enforced while reading.</summary>
    public long VideoMaxBytes { get; set; } = DefaultVideoMaxBytes;

    /// <summary>Uploads per minute per ACCOUNT (participant <c>AccountId</c> / staff user id) — never per session or IP.</summary>
    public int PermitPerMinute { get; set; } = DefaultPermitPerMinute;

    /// <summary>
    /// The request-body ceiling <c>POST /api/media</c> sets for itself: the larger per-kind ceiling plus
    /// <see cref="MultipartOverheadBytes"/>.
    /// </summary>
    /// <returns>The maximum request body size in bytes.</returns>
    public long MaxRequestBodyBytes() => Math.Max(ImageMaxBytes, VideoMaxBytes) + MultipartOverheadBytes;
}

/// <summary>The read-SAS expiry bucketing, bound from <see cref="SectionName"/> (§1.7).</summary>
/// <remarks>
/// <c>bucketStart = floor(now, BucketMinutes)</c>; <c>expiresOn = bucketStart + BucketMinutes + LifetimeHours</c>.
/// With the defaults (60 / 12) that is <c>bucketStart + 13 h</c>, so every URL minted in one bucket is
/// byte-identical and has at least <see cref="LifetimeHours"/> left.
/// </remarks>
public sealed class MediaSasOptions
{
    /// <summary>The configuration section the options bind from.</summary>
    public const string SectionName = "Media:Sas";

    /// <summary>The bucket width in minutes (default 60).</summary>
    public int BucketMinutes { get; set; } = 60;

    /// <summary>The minimum remaining life of every minted URL, in hours (default 12).</summary>
    public int LifetimeHours { get; set; } = 12;
}
