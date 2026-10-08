namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// The closed vocabulary of <see cref="PostReaction.Kind"/> values (demo-polish <c>implementation.md</c> §1.2).
/// </summary>
public static class ReactionKinds
{
    /// <summary>A like (SOC-030).</summary>
    public const string Like = "like";

    /// <summary>A repost (SOC-030).</summary>
    public const string Repost = "repost";
}

/// <summary>
/// One REAL reaction — a persona liking or reposting a <see cref="Post"/> — inside a single exercise run.
/// <see cref="IExerciseScoped"/> with a non-nullable <see cref="ExerciseId"/>, so it inherits
/// <see cref="PulseDbContext"/>'s central read-side query filter + write-time guard (COR-001).
/// </summary>
/// <remarks>
/// <para>
/// <b>At most one ACTIVE reaction per (post, persona, kind) — soft delete, never hard delete (DP-15, XC-010).</b>
/// <c>IX_PostReactions_PostId_PersonaId_Kind</c> is a FILTERED unique index (<c>WHERE [DeletedAt] IS NULL</c>), so
/// the database is the last word on idempotency for active rows, exactly as the follow graph's unique edge index
/// is. Un-liking / un-reposting stamps <see cref="DeletedAt"/>; the inactive rows accumulate as history, and a
/// re-like inserts a NEW row rather than reviving the old one.
/// </para>
/// <para>
/// <b><see cref="PersonaId"/> is a logical reference</b> (house style, see <see cref="Follow"/>): no foreign key
/// and no navigation; every read resolves it through the exercise-scoped <c>Personas</c> set, so a
/// cross-exercise id does not resolve. <see cref="PostId"/> is a real foreign key (<c>Restrict</c>, XC-010).
/// </para>
/// <para>
/// <b>Schema only (demo-polish B1)</b> — the reaction endpoints and the engagement reader are built later.
/// </para>
/// </remarks>
public sealed class PostReaction : IExerciseScoped
{
    /// <summary>The schema bound of <see cref="Kind"/>.</summary>
    public const int MaxKindLength = 16;

    /// <summary>Primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>The owning exercise run (COR-001). Non-nullable; the write-guard rejects <see cref="Guid.Empty"/>.</summary>
    public Guid ExerciseId { get; set; }

    /// <summary>The reacted-to <see cref="Post"/> (foreign key, <c>Restrict</c>).</summary>
    public Guid PostId { get; set; }

    /// <summary>The reacting <see cref="Persona"/> — a logical reference resolved through the scoped <c>Personas</c> set.</summary>
    public Guid PersonaId { get; set; }

    /// <summary>The reaction kind — <see cref="ReactionKinds.Like"/> or <see cref="ReactionKinds.Repost"/>.</summary>
    public required string Kind { get; set; }

    /// <summary>
    /// The SCENARIO instant of the reaction (COR-053) — stamped from the exercise clock, never re-derived from
    /// the wall clock at read time.
    /// </summary>
    public DateTimeOffset CreatedScenarioTime { get; set; }

    /// <summary>
    /// Soft-delete marker (DP-15, XC-010). Null = active; set = un-liked / un-reposted. A reaction row is never
    /// hard-deleted; only active rows count, and only active rows are held unique.
    /// </summary>
    public DateTimeOffset? DeletedAt { get; set; }
}
