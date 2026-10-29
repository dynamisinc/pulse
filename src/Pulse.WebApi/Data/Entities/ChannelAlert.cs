namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// One entry in the persistent alert bar (channels-foundation story 01, FC-2; PRT-010, the EAS analog across every
/// channel). Raised by staff, by a weather issuance or by a content publish through <c>IAlertRaiser</c> (story 10).
/// </summary>
/// <remarks>
/// <see cref="IExerciseScoped"/> and <see cref="ISoftDeletable"/>; <see cref="Version"/> is the concurrency token.
/// Every instant is scenario time (COR-053): an alert has no wall-clock column at all. <see cref="Origin"/> and
/// <see cref="ActingHumanId"/> are staff-only (XC-002).
/// </remarks>
public sealed class ChannelAlert : IExerciseScoped, ISoftDeletable
{
    /// <summary>Bound of <see cref="Severity"/>, <see cref="SourceChannel"/> and <see cref="Origin"/>.</summary>
    public const int MaxLiteralLength = 16;

    /// <summary>Bound of <see cref="Headline"/>.</summary>
    public const int MaxHeadlineLength = 300;

    /// <summary>Bound of <see cref="Href"/> (a host-relative path, FC-9).</summary>
    public const int MaxHrefLength = 512;

    /// <summary>Primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>The owning exercise run (COR-001). Non-nullable; the write-guard rejects <see cref="Guid.Empty"/>.</summary>
    public Guid ExerciseId { get; set; }

    /// <summary>The severity: <c>info</c> / <c>advisory</c> / <c>emergency</c>.</summary>
    public required string Severity { get; set; }

    /// <summary>The alert text, shown verbatim.</summary>
    public required string Headline { get; set; }

    /// <summary>The raising channel id, or <c>system</c>.</summary>
    public required string SourceChannel { get; set; }

    /// <summary>The content item that raised it (a logical reference), else <c>null</c>.</summary>
    public Guid? SourceContentId { get; set; }

    /// <summary>The "Details" target, a host-relative path, else <c>null</c>.</summary>
    public string? Href { get; set; }

    /// <summary>The scenario instant the alert was issued.</summary>
    public DateTimeOffset IssuedScenarioTime { get; set; }

    /// <summary>The scenario instant the alert lapses, else <c>null</c>.</summary>
    public DateTimeOffset? ExpiresScenarioTime { get; set; }

    /// <summary>The scenario instant staff cleared the alert, else <c>null</c>.</summary>
    public DateTimeOffset? ClearedScenarioTime { get; set; }

    /// <summary>Who raised it: <c>controller</c> / <c>participant</c> / <c>engine</c> / <c>inject</c>. Staff-only.</summary>
    public required string Origin { get; set; }

    /// <summary>The human the alert is attributed to (COR-018). Staff-only.</summary>
    public required string ActingHumanId { get; set; }

    /// <summary>The optimistic-concurrency token every write bumps.</summary>
    public int Version { get; set; }

    /// <inheritdoc />
    public DateTimeOffset? DeletedAt { get; set; }
}
