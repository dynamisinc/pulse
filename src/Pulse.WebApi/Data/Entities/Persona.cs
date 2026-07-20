namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// A persona as it exists WITHIN one exercise run — a fictional actor whose posts populate the world.
/// Belongs to exactly one run, so it is <see cref="IExerciseScoped"/> with a non-nullable
/// <see cref="ExerciseId"/>. May optionally record the shared <see cref="PersonaTemplate"/> it was
/// instantiated from (<see cref="PersonaTemplateId"/>), but the template lives in a cross-run library.
/// </summary>
public sealed class Persona : IExerciseScoped
{
    /// <summary>Primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>The owning exercise run (COR-001). Non-nullable; the write-guard rejects <see cref="Guid.Empty"/>.</summary>
    public Guid ExerciseId { get; set; }

    /// <summary>Display name shown on participant surfaces.</summary>
    public required string DisplayName { get; set; }

    /// <summary>Social handle shown on participant surfaces (uniqueness policy is out of scope here).</summary>
    public required string Handle { get; set; }

    /// <summary>
    /// Optional pointer to the shared <see cref="PersonaTemplate"/> this persona was instantiated from.
    /// Nullable — a persona can be authored directly in-run with no template. Not a scoped reference:
    /// templates are shared across runs.
    /// </summary>
    public Guid? PersonaTemplateId { get; set; }

    /// <summary>
    /// The frontend <c>PersonaKind</c> union value — <c>human</c> (individual) or <c>org</c>
    /// (institutional) — as a string. Governs the R-004 avatar treatment (duotone silhouette vs.
    /// monogram); never inferred from a persona type, since a bad-actor persona impersonating an org
    /// is still <c>org</c>.
    /// </summary>
    public required string Kind { get; set; }

    /// <summary>
    /// The SOC-052 trust signal — whether this persona instance carries the platform's verified seal.
    /// A plain per-instance flag, never inferred from <see cref="Kind"/> alone, so an unverified
    /// lookalike account remains visually possible (impersonation training).
    /// </summary>
    public bool Verified { get; set; }
}
