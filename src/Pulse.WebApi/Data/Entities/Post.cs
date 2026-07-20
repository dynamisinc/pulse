namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// A single post authored by a <see cref="Persona"/> within one exercise run. Belongs to exactly one run,
/// so it is <see cref="IExerciseScoped"/> with a non-nullable <see cref="ExerciseId"/>. This story models
/// only the durable shape — no read/write API is built here.
/// </summary>
/// <remarks>
/// Reserves forward-looking nullable columns so neither capability needs a later breaking migration:
/// <list type="bullet">
///   <item><description><see cref="RumorRef"/> / <see cref="MutationOf"/> — the E8 rumor model
///   (<c>BACKEND_ROADMAP</c> Risk 1: reserve <c>rumorRef</c>/<c>mutationOf</c> even though rumors are v1.1).
///   Unused at v0.</description></item>
///   <item><description><see cref="DeletedAt"/> — soft delete. Nothing is hard-deleted during a live
///   exercise (XC-010); a takedown stamps this instead.</description></item>
/// </list>
/// </remarks>
public sealed class Post : IExerciseScoped
{
    /// <summary>Primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>The owning exercise run (COR-001). Non-nullable; the write-guard rejects <see cref="Guid.Empty"/>.</summary>
    public Guid ExerciseId { get; set; }

    /// <summary>The <see cref="Persona"/> that authored this post.</summary>
    public Guid AuthorPersonaId { get; set; }

    /// <summary>The post body text.</summary>
    public required string Body { get; set; }

    /// <summary>When the post was created, in scenario time (COR-053) — never wall-clock.</summary>
    public DateTimeOffset CreatedScenarioTime { get; set; }

    /// <summary>
    /// Provenance of the post — the <c>PostOrigin</c> union value as a string (<c>participant</c> /
    /// <c>controller-as-persona</c> / <c>engine</c> / <c>inject</c>). Stamped server-side by the write path;
    /// staff/telemetry-only (XC-002) — NEVER projected onto a participant response.
    /// </summary>
    public required string Origin { get; set; }

    /// <summary>
    /// The individual human behind the (possibly shared) account (COR-018) — e.g. which controller was
    /// operating a shared org persona, or which participant authored their own post. Staff/telemetry-only
    /// (XC-002) — never participant-visible.
    /// </summary>
    public required string ActingHumanId { get; set; }

    /// <summary>
    /// REAL wall-clock ingest instant (server UTC now) — telemetry/staff-only. Contrast
    /// <see cref="CreatedScenarioTime"/>, the only participant-visible time (COR-053).
    /// </summary>
    public DateTimeOffset CreatedWallClock { get; set; }

    /// <summary>The MSEL inject id — set only when <see cref="Origin"/> is <c>inject</c>; null otherwise. Staff/telemetry-only.</summary>
    public string? InjectId { get; set; }

    /// <summary>Reserved for the E8 rumor model (v1.1) — the rumor this post belongs to. Unused at v0.</summary>
    public Guid? RumorRef { get; set; }

    /// <summary>Reserved for the E8 rumor model (v1.1) — the parent post this one mutated from. Unused at v0.</summary>
    public Guid? MutationOf { get; set; }

    /// <summary>Soft-delete marker (scenario time). Null = live; set = taken down. Nothing is hard-deleted (XC-010).</summary>
    public DateTimeOffset? DeletedAt { get; set; }
}
