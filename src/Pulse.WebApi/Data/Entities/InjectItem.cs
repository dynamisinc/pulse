namespace Pulse.WebApi.Data.Entities;

using System.Collections.Generic;

/// <summary>
/// One row of the server-side scripted-post queue (inject-queue story 06; CTL-010 lite, CTL-011, CTL-014 lite): a
/// pre-written persona post (<c>kind: post</c>, exactly one child) or a paced pile-on (<c>kind: burst</c>, 2..20
/// children released across a 30..600 s window) that a controller releases on cue. Belongs to exactly one exercise
/// run, so it is <see cref="IExerciseScoped"/> and inherits <see cref="PulseDbContext"/>'s central read filter and
/// write guard (COR-001) — no query or endpoint scopes it by hand, and no request ever carries an exercise id.
/// </summary>
/// <remarks>
/// <para>
/// <b>Staff world only (XC-002).</b> Every column here is controller tooling: titles, notes, assignment, who fired
/// what and when. Nothing on this row reaches a participant; only the posts it publishes do, and those go through
/// the one ingest funnel and its participant-safe projection.
/// </para>
/// <para>
/// <b>Exactly once (IQ-9).</b> <see cref="Version"/> is an EF concurrency token, and EVERY state change — an
/// edit, the claim that precedes a publish, each burst child's claim and its recorded outcome — bumps it in the
/// same <c>SaveChanges</c>. A second writer holding the old version gets a <c>DbUpdateConcurrencyException</c>
/// (mapped to <c>409</c>, or "skip this tick" for the runner), so two controllers, two app instances, or a
/// restarted runner can never publish the same child twice. Child rows carry no token of their own: every child
/// mutation is accompanied by a bump of its item, so the item row is the single lock for the whole aggregate.
/// </para>
/// <para>
/// <b>Soft delete (XC-010).</b> <see cref="DeletedAt"/> marks a deleted item. There is no global soft-delete
/// convention in this model, so every query in the inject slice excludes deleted rows explicitly.
/// </para>
/// </remarks>
public sealed class InjectItem : IExerciseScoped
{
    /// <summary>Primary key — the id the published posts carry as their <c>injectId</c>.</summary>
    public Guid Id { get; set; }

    /// <summary>The owning exercise run (COR-001). Non-nullable; the write-guard rejects <see cref="Guid.Empty"/>.</summary>
    public Guid ExerciseId { get; set; }

    /// <summary>The item kind wire literal — <c>post</c> or <c>burst</c>.</summary>
    public required string Kind { get; set; }

    /// <summary>The controller-facing title (1..120 code points, sanitized on write).</summary>
    public required string Title { get; set; }

    /// <summary>Optional controller notes (at most 500 code points, sanitized on write).</summary>
    public string? Notes { get; set; }

    /// <summary>The planned scenario minute (T+N) — a display and sort hint only; nothing auto-fires on it.</summary>
    public int? PlannedMinute { get; set; }

    /// <summary>The staff user this item is assigned to (a filter, never a lock — IQ-3), or <c>null</c>.</summary>
    public Guid? AssigneeId { get; set; }

    /// <summary>The burst release window in seconds (30..600); <c>null</c> for a <c>post</c>.</summary>
    public int? BurstWindowSeconds { get; set; }

    /// <summary>The queue sort key. The wire <c>order</c> is the dense 1-based position derived from it.</summary>
    public int Order { get; set; }

    /// <summary>The item status wire literal — <c>pending</c>/<c>held</c>/<c>firing</c>/<c>fired</c>/<c>skipped</c>/<c>failed</c>.</summary>
    public required string Status { get; set; }

    /// <summary>The optimistic-concurrency token every state change bumps (IQ-9).</summary>
    public int Version { get; set; }

    /// <summary>The staff user who authored the item (COR-018, server-derived).</summary>
    public Guid CreatedByHumanId { get; set; }

    /// <summary>Server wall-clock instant the item was created (staff-only).</summary>
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Server wall-clock instant of the item's last state change (staff-only).</summary>
    public DateTimeOffset UpdatedAt { get; set; }

    /// <summary>The staff user who pressed Fire on the item's FIRST release (COR-018).</summary>
    public Guid? FiredByHumanId { get; set; }

    /// <summary>The exercise scenario instant of the item's first release (COR-053).</summary>
    public DateTimeOffset? FiredScenarioTime { get; set; }

    /// <summary>
    /// The staff user whose action last set the item running (fire, release, or retry). Posts the runner publishes
    /// on the item's behalf are attributed to this human (COR-018) — a background tick has no session of its own.
    /// </summary>
    public Guid? DriverHumanId { get; set; }

    /// <summary>Server wall-clock instant of the first release — the burst pacing anchor (IQ-4).</summary>
    public DateTimeOffset? ReleasedAt { get; set; }

    /// <summary>
    /// Accumulated lateness in seconds (IQ-4). When a child publishes after its due instant, the lateness is added
    /// here so every later child keeps its original spacing — one rule for PAUSE INJECTS, FREEZE, a hold, and a
    /// backend restart, and overdue posts are never dumped together.
    /// </summary>
    public double ShiftSeconds { get; set; }

    /// <summary>The readable reason a <c>failed</c> item failed (the first failed child's message), else <c>null</c>.</summary>
    public string? Error { get; set; }

    /// <summary>Soft-delete marker (XC-010); <c>null</c> while the item is live.</summary>
    public DateTimeOffset? DeletedAt { get; set; }

    /// <summary>The child posts, including soft-deleted ones; readers order by sequence and exclude deleted rows.</summary>
    public IList<InjectItemPost> Posts { get; set; } = new List<InjectItemPost>();
}
