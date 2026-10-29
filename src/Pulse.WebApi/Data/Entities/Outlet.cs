namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// One in-fiction publisher on a content channel (channels-foundation story 01, FC-2): a TV station, a paper, the wire
/// room or a press org's newsroom, the weather desk. Every <see cref="ContentItem"/> is published by exactly one outlet,
/// and the outlet's <see cref="SkinKey"/> picks the participant skin its content renders in.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (COR-001).</b> <see cref="IExerciseScoped"/>, so the central read filter and write guard cover it with no
/// per-entity code. The parent outlet reference is a SAME-EXERCISE composite foreign key
/// (<c>(ExerciseId, ParentOutletId)</c> → <c>(ExerciseId, Id)</c>), so the database refuses a child of another
/// exercise's outlet.
/// </para>
/// <para>
/// <b>Soft delete (XC-010)</b> via <see cref="ISoftDeletable"/>; <b>concurrency</b> via <see cref="Version"/> (the
/// <see cref="InjectItem"/> pattern: every write bumps it, a stale writer gets <c>DbUpdateConcurrencyException</c>).
/// Enum-like columns are wire-literal strings; the vocabulary lives in <c>ChannelVocabulary</c> (story 02).
/// </para>
/// </remarks>
public sealed class Outlet : IExerciseScoped, ISoftDeletable
{
    /// <summary>Bound of <see cref="ChannelId"/> (FC-1 channel ids are short literals).</summary>
    public const int MaxChannelIdLength = 16;

    /// <summary>Bound of <see cref="Slug"/>: FC-1 slugs are <c>[a-z0-9-]{1,80}</c>.</summary>
    public const int MaxSlugLength = 80;

    /// <summary>Bound of <see cref="Name"/>.</summary>
    public const int MaxNameLength = 120;

    /// <summary>Bound of <see cref="Tagline"/>.</summary>
    public const int MaxTaglineLength = 200;

    /// <summary>Bound of <see cref="SkinKey"/>.</summary>
    public const int MaxSkinKeyLength = 64;

    /// <summary>Primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>The owning exercise run (COR-001). Non-nullable; the write-guard rejects <see cref="Guid.Empty"/>.</summary>
    public Guid ExerciseId { get; set; }

    /// <summary>The channel this outlet publishes on (<c>news</c> / <c>press</c> / <c>weather</c>).</summary>
    public required string ChannelId { get; set; }

    /// <summary>The permalink segment; unique per <c>(ExerciseId, ChannelId)</c> (FC-1).</summary>
    public required string Slug { get; set; }

    /// <summary>The in-fiction display name ("Newsline 7").</summary>
    public required string Name { get; set; }

    /// <summary>Optional strapline under the masthead.</summary>
    public string? Tagline { get; set; }

    /// <summary>The parent outlet in the same exercise (press org newsrooms under The Wire Room), else <c>null</c>.</summary>
    public Guid? ParentOutletId { get; set; }

    /// <summary>The paired social persona (NWS-004 / PRS-013 / WX-020); a logical reference resolved in scope.</summary>
    public Guid? PairedPersonaId { get; set; }

    /// <summary>The masthead logo (a media-library asset), else <c>null</c>.</summary>
    public Guid? LogoMediaId { get; set; }

    /// <summary>The outlet's section list as a JSON string array (opaque here; validated by the outlet service).</summary>
    public string CategoriesJson { get; set; } = "[]";

    /// <summary>The registered participant skin (FC-8a).</summary>
    public required string SkinKey { get; set; }

    /// <summary>A partial <c>OutletSkinTokens</c> override (FC-3b), validated and size-capped by the outlet service.</summary>
    public string? SkinOverridesJson { get; set; }

    /// <summary>Display order within the channel.</summary>
    public int SortOrder { get; set; }

    /// <summary>Whether participants see the outlet.</summary>
    public bool Enabled { get; set; }

    /// <summary>The optimistic-concurrency token every write bumps.</summary>
    public int Version { get; set; }

    /// <inheritdoc />
    public DateTimeOffset? DeletedAt { get; set; }
}
