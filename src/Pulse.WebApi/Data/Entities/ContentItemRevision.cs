namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// One entry in a <see cref="ContentItem"/>'s history (channels-foundation story 01, FC-2): a pre-publish <c>edit</c>, a
/// visible <c>update</c> or <c>correction</c>, or a staff-only <c>silent_rewrite</c>. <see cref="SnapshotJson"/> holds
/// the fields as they were before the change.
/// </summary>
/// <remarks>
/// <see cref="IExerciseScoped"/> and <see cref="ISoftDeletable"/>. The item reference is a SAME-EXERCISE composite
/// foreign key; <c>(ContentItemId, Number)</c> is unique, so a concurrent double-revise cannot write two entries with
/// one number. Only <see cref="Visible"/> entries reach the participant <c>revisions[]</c>.
/// </remarks>
public sealed class ContentItemRevision : IExerciseScoped, ISoftDeletable
{
    /// <summary>Bound of <see cref="Kind"/>.</summary>
    public const int MaxKindLength = 16;

    /// <summary>Bound of <see cref="Note"/>.</summary>
    public const int MaxNoteLength = 1000;

    /// <summary>Primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>The owning exercise run (COR-001). Non-nullable; the write-guard rejects <see cref="Guid.Empty"/>.</summary>
    public Guid ExerciseId { get; set; }

    /// <summary>The revised item, in the same exercise.</summary>
    public Guid ContentItemId { get; set; }

    /// <summary>The 1-based revision number within the item.</summary>
    public int Number { get; set; }

    /// <summary>The revision kind: <c>edit</c> / <c>update</c> / <c>correction</c> / <c>silent_rewrite</c>.</summary>
    public required string Kind { get; set; }

    /// <summary>The editor's note shown with a correction, else <c>null</c>.</summary>
    public string? Note { get; set; }

    /// <summary>The revised fields as they were before this revision.</summary>
    public string SnapshotJson { get; set; } = "{}";

    /// <summary>The scenario instant of the revision.</summary>
    public required DateTimeOffset ScenarioTime { get; set; }

    /// <summary>Server wall-clock instant of the revision. Staff/telemetry only.</summary>
    public required DateTimeOffset WallClock { get; set; }

    /// <summary>The human who made the revision (COR-018). Staff-only.</summary>
    public required string ActingHumanId { get; set; }

    /// <summary>True for <c>update</c>/<c>correction</c>: the entry appears in the participant <c>revisions[]</c>.</summary>
    public bool Visible { get; set; }

    /// <inheritdoc />
    public DateTimeOffset? DeletedAt { get; set; }
}
