namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// The closed vocabulary of <see cref="MediaAsset.Kind"/> values (demo-polish <c>implementation.md</c> §1.2).
/// </summary>
public static class MediaKinds
{
    /// <summary>A still image (jpeg / png / gif / webp, by magic bytes).</summary>
    public const string Image = "image";

    /// <summary>A video clip (mp4 / webm, by magic bytes).</summary>
    public const string Video = "video";
}

/// <summary>
/// One uploaded media file (image or video) inside a single exercise run — the durable record behind a blob in
/// the PRIVATE media container. Belongs to exactly one run, so it is <see cref="IExerciseScoped"/> with a
/// non-nullable <see cref="ExerciseId"/> and inherits <see cref="PulseDbContext"/>'s central read-side query
/// filter + write-time guard (COR-001). It carries no scoping logic of its own.
/// </summary>
/// <remarks>
/// <para>
/// <b>Schema only (demo-polish B1).</b> The upload pipeline, the read-URL signer and the staff library are
/// built later against the frozen <c>IMediaStore</c>/<c>IMediaUrlSigner</c> seams; nothing here has behaviour.
/// </para>
/// <para>
/// <b>Staff-only columns (XC-002).</b> <see cref="BlobName"/>, <see cref="ContentType"/>, <see cref="Bytes"/>,
/// <see cref="OriginalFileName"/>, <see cref="UploadedByHumanId"/> and <see cref="CreatedWallClock"/> are never
/// projected onto a participant payload. A participant only ever sees a signed read URL, the kind, the
/// dimensions/duration and the alt text carried by the post's <see cref="PostMediaItem"/>.
/// </para>
/// <para>
/// <b>No hard delete (XC-010).</b> Every foreign key that touches this table is <c>Restrict</c>/<c>NoAction</c>.
/// </para>
/// </remarks>
public sealed class MediaAsset : IExerciseScoped
{
    /// <summary>The schema bound of <see cref="Kind"/>.</summary>
    public const int MaxKindLength = 16;

    /// <summary>The schema bound of <see cref="ContentType"/>.</summary>
    public const int MaxContentTypeLength = 64;

    /// <summary>The schema bound of <see cref="BlobName"/>.</summary>
    public const int MaxBlobNameLength = 256;

    /// <summary>The schema bound of <see cref="OriginalFileName"/>.</summary>
    public const int MaxOriginalFileNameLength = 255;

    /// <summary>The schema bound of <see cref="UploadedByHumanId"/>.</summary>
    public const int MaxUploadedByHumanIdLength = 256;

    /// <summary>Primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>The owning exercise run (COR-001). Non-nullable; the write-guard rejects <see cref="Guid.Empty"/>.</summary>
    public Guid ExerciseId { get; set; }

    /// <summary>The media kind — <see cref="MediaKinds.Image"/> or <see cref="MediaKinds.Video"/>.</summary>
    public required string Kind { get; set; }

    /// <summary>The SNIFFED canonical MIME type (never the client's header or file extension). Staff-only.</summary>
    public required string ContentType { get; set; }

    /// <summary>
    /// The blob's name in the private container — <c>{ExerciseId:D}/{Id:N}.{ext}</c>. Unique across the table
    /// (<c>IX_MediaAssets_BlobName</c>). Staff-only; never on a participant payload.
    /// </summary>
    public required string BlobName { get; set; }

    /// <summary>The stored size in bytes (greater than zero). Staff-only.</summary>
    public long Bytes { get; set; }

    /// <summary>Client-hinted pixel width (validated 1..16384 on upload); null when not supplied.</summary>
    public int? Width { get; set; }

    /// <summary>Client-hinted pixel height (validated 1..16384 on upload); null when not supplied.</summary>
    public int? Height { get; set; }

    /// <summary>Video duration in seconds (0 &lt; x &lt;= 3600); videos only, null otherwise.</summary>
    public double? DurationSec { get; set; }

    /// <summary>The uploaded file's name with any path and markup stripped. Staff-only (XC-002).</summary>
    public required string OriginalFileName { get; set; }

    /// <summary>The uploading session's acting human (COR-018). Staff-only (XC-002).</summary>
    public required string UploadedByHumanId { get; set; }

    /// <summary>
    /// The SCENARIO instant of the upload (DP-1, COR-053) — stamped from the exercise clock, never re-derived
    /// from the wall clock at read time.
    /// </summary>
    public DateTimeOffset CreatedScenarioTime { get; set; }

    /// <summary>The real wall-clock upload instant (server UTC). Staff/telemetry-only (XC-002).</summary>
    public DateTimeOffset CreatedWallClock { get; set; }

    /// <summary>
    /// The poster image for a video asset (DP-3); null for images and for videos without a poster. Foreign key
    /// to another <see cref="MediaAsset"/> (<c>Restrict</c>).
    /// </summary>
    public Guid? PosterMediaAssetId { get; set; }
}
