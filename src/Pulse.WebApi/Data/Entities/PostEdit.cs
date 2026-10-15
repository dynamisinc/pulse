namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// One edit of a participant's own post or reply (demo-feedback Wave 4, DF-29..DF-31): the text the post carried
/// BEFORE edit number <see cref="EditNumber"/> was applied. Edit 1 holds the original text; the current text is
/// <see cref="Post.Body"/>. <see cref="IExerciseScoped"/>, so it inherits the central read filter and write guard.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="PostId"/> is a foreign key to <c>Posts</c> with <c>Restrict</c> (no cascade, no hard-delete path, XC-010).
/// The unique index (<see cref="PostId"/>, <see cref="EditNumber"/>) makes the database the last word on one row per
/// edit number, even under a concurrent double-submit. <see cref="EditNumber"/> runs 1..5 (the limit is enforced in
/// code, story 19).
/// </para>
/// <para>
/// <see cref="EditedAt"/> and <see cref="ActingHumanId"/> are staff/export only (XC-002) — never projected to a
/// participant. <see cref="EditedScenarioTime"/> is the participant-visible time (COR-053). Schema only here (story 17).
/// </para>
/// </remarks>
public sealed class PostEdit : IExerciseScoped
{
    /// <summary>Primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>The owning exercise run (COR-001). Non-nullable; the write guard rejects <see cref="Guid.Empty"/>.</summary>
    public Guid ExerciseId { get; set; }

    /// <summary>The edited <see cref="Post"/> (foreign key, <c>Restrict</c>).</summary>
    public Guid PostId { get; set; }

    /// <summary>Which edit this is, 1..5; unique per post.</summary>
    public int EditNumber { get; set; }

    /// <summary>The post's text before this edit — unbounded like <see cref="Post.Body"/>, sanitized on ingest like it.</summary>
    public required string PreviousBody { get; set; }

    /// <summary>When the edit was applied — REAL wall clock (server UTC). Staff/export only (XC-002).</summary>
    public DateTimeOffset EditedAt { get; set; }

    /// <summary>When the edit was applied, in scenario time (COR-053) — the only participant-visible time.</summary>
    public DateTimeOffset EditedScenarioTime { get; set; }

    /// <summary>The individual human who made the edit (COR-018), same type as <see cref="Post.ActingHumanId"/>; null when unknown. Staff/export only (XC-002).</summary>
    public string? ActingHumanId { get; set; }
}
