namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// One REAL, directed follow edge inside a single exercise run (SOC-051): the persona identified by
/// <see cref="FollowerPersonaId"/> follows the persona identified by <see cref="FolloweePersonaId"/>. Belongs
/// to exactly one run, so it is <see cref="IExerciseScoped"/> with a non-nullable <see cref="ExerciseId"/> and
/// inherits <see cref="PulseDbContext"/>'s central read-side query filter + write-time guard (COR-001) — this
/// entity never carries its own scoping logic and no endpoint ever filters by a client-supplied exerciseId.
/// </summary>
/// <remarks>
/// <para>
/// <b>Distinct from the SOC-054 audience magnitude.</b> <see cref="Persona.AudienceMagnitude"/> is the
/// believable SIMULATED crowd derived from the persona's band at seed time — a number, not rows. THIS table is
/// the real graph: the accounts that actually exist as rows because a participant followed them. The two
/// populations never overlap, which is why the displayed follower count is
/// <c>magnitude + inbound edges</c> while the following count is <c>outbound edges only</c> (magnitude is a
/// follower-side construct and never inflates a following count).
/// </para>
/// <para>
/// <b>One edge per ordered pair.</b> <c>IX_Follows_ExerciseId_FollowerPersonaId_FolloweePersonaId</c> is
/// UNIQUE, so following the same account twice is the same row rather than a duplicate — the database, not
/// the service, is the last word on idempotency. Both persona ids are logical references (no navigation
/// properties): every read that resolves them goes through the exercise-scoped <c>Personas</c> set, so a
/// cross-exercise id simply does not resolve.
/// </para>
/// <para>
/// <b>Carries no participant-visible content.</b> An edge is two ids and two instants; nothing here is free
/// text, so there is no NFR-004 sanitization boundary on this entity.
/// </para>
/// </remarks>
public sealed class Follow : IExerciseScoped
{
    /// <summary>Primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>The owning exercise run (COR-001). Non-nullable; the write-guard rejects <see cref="Guid.Empty"/>.</summary>
    public Guid ExerciseId { get; set; }

    /// <summary>
    /// The <see cref="Persona"/> instance doing the following — resolved SERVER-side from the caller's
    /// session-bound persona, never from the request body (the same posture <c>Post.ExerciseId</c> takes on
    /// scope).
    /// </summary>
    public Guid FollowerPersonaId { get; set; }

    /// <summary>The <see cref="Persona"/> instance being followed. Must resolve inside the same exercise scope.</summary>
    public Guid FolloweePersonaId { get; set; }

    /// <summary>
    /// The SCENARIO instant the edge was created (COR-053) — the only participant-visible time. Stamped
    /// server-side from the exercise's scenario clock, never from client input and never re-derived from the
    /// wall clock at read time.
    /// </summary>
    public DateTimeOffset CreatedScenarioTime { get; set; }

    /// <summary>
    /// The real wall-clock instant the edge was created (server UTC) — telemetry/audit only, never projected
    /// onto a participant-facing response (XC-002).
    /// </summary>
    public DateTimeOffset CreatedWallClock { get; set; }
}
