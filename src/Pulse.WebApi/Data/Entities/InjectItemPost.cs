namespace Pulse.WebApi.Data.Entities;

using System.Collections.Generic;

/// <summary>
/// One scripted persona post inside an <see cref="InjectItem"/> (inject-queue story 06). It is published through the
/// one ingest funnel when its item fires (a <c>post</c>) or when its paced turn comes (a <c>burst</c> child), and
/// records the post it produced. <see cref="IExerciseScoped"/>, so it inherits the central filter and write guard
/// (COR-001) exactly like its item.
/// </summary>
/// <remarks>
/// <para>
/// <b>No concurrency token of its own.</b> Every mutation of a child is saved together with a bump of its item's
/// <see cref="InjectItem.Version"/>, so the item row serializes the whole aggregate (IQ-9).
/// </para>
/// <para>
/// <b>Stored now, mapped later (IQ-10).</b> <see cref="Media"/>, the reply target and the engagement baseline are
/// persisted and returned to the console today, but are only handed to the ingest funnel once demo-polish BP gives
/// <c>CreatePostRequest</c> its typed members.
/// </para>
/// </remarks>
public sealed class InjectItemPost : IExerciseScoped
{
    /// <summary>Primary key — the id another scripted post names in <c>replyTo.injectPostId</c>.</summary>
    public Guid Id { get; set; }

    /// <summary>The owning exercise run (COR-001). Non-nullable; the write-guard rejects <see cref="Guid.Empty"/>.</summary>
    public Guid ExerciseId { get; set; }

    /// <summary>The owning <see cref="InjectItem"/>.</summary>
    public Guid InjectItemId { get; set; }

    /// <summary>The 1-based position within the item; edits preserve a child's id at its position.</summary>
    public int Sequence { get; set; }

    /// <summary>The authoring persona instance (validated to exist in the exercise on write).</summary>
    public Guid PersonaId { get; set; }

    /// <summary>The post text (1..280 code points, sanitized on write; the funnel sanitizes again at fire).</summary>
    public required string Text { get; set; }

    /// <summary>Library media references (at most 4), stored as a JSON column.</summary>
    public IList<InjectMediaRef> Media { get; set; } = new List<InjectMediaRef>();

    /// <summary>Reply target: another scripted post in this exercise, or <c>null</c>.</summary>
    public Guid? ReplyToInjectPostId { get; set; }

    /// <summary>Reply target: an existing post id, or <c>null</c>. Existence is the funnel's check at fire.</summary>
    public Guid? ReplyToPostId { get; set; }

    /// <summary>Seeded like count (0..1,000,000), or <c>null</c>.</summary>
    public int? BaselineLike { get; set; }

    /// <summary>Seeded repost count (0..1,000,000), or <c>null</c>.</summary>
    public int? BaselineRepost { get; set; }

    /// <summary>Seeded reply count (0..1,000,000), or <c>null</c>.</summary>
    public int? BaselineReply { get; set; }

    /// <summary>The child status wire literal — <c>pending</c>/<c>fired</c>/<c>skipped</c>/<c>failed</c>.</summary>
    public required string Status { get; set; }

    /// <summary>Burst pacing: seconds after the item's release this child is due (the first child is 0).</summary>
    public int? DueOffsetSeconds { get; set; }

    /// <summary>
    /// Server wall-clock instant this child was CLAIMED for publishing, before the funnel was called; cleared when
    /// the outcome is recorded. A claim older than the lease is treated as abandoned (a crash between claim and
    /// record) and is reconciled against the posts table before anything is published again.
    /// </summary>
    public DateTimeOffset? ClaimedAt { get; set; }

    /// <summary>
    /// When a CONTROLLER action (fire / retry) made the claim: the pre-assigned <c>EventId</c> of that action's one
    /// <c>inject_action</c> event. Whichever save resolves the claim — the normal record, a give-up, or a later
    /// reconcile — emits the event under this id, so the database primary key makes it exactly once (XC-004).
    /// <c>null</c> for a runner claim, which emits no action event.
    /// </summary>
    public string? ClaimEventId { get; set; }

    /// <summary>The controller action that made the claim (<c>fire</c> / <c>retry</c>), or <c>null</c> for the runner.</summary>
    public string? ClaimAction { get; set; }

    /// <summary>The staff user whose action made the claim, or <c>null</c> for the runner.</summary>
    public Guid? ClaimActorId { get; set; }

    /// <summary>The post the funnel created for this child.</summary>
    public Guid? FiredPostId { get; set; }

    /// <summary>The published post's scenario instant (COR-053), round-tripped from the post.</summary>
    public DateTimeOffset? FiredScenarioTime { get; set; }

    /// <summary>The published post's server wall-clock instant (staff-only).</summary>
    public DateTimeOffset? FiredWallClock { get; set; }

    /// <summary>The staff user the published post is attributed to (COR-018).</summary>
    public Guid? FiredByHumanId { get; set; }

    /// <summary>The readable reason this child failed (the funnel's message), else <c>null</c>.</summary>
    public string? Error { get; set; }

    /// <summary>Soft-delete marker (XC-010) — set when an edit removes this position; <c>null</c> while live.</summary>
    public DateTimeOffset? DeletedAt { get; set; }
}

/// <summary>A library media reference on a scripted post — stored inside the child's JSON <c>Media</c> column.</summary>
public sealed class InjectMediaRef
{
    /// <summary>The media library asset id (resolved in scope by the funnel once BP lands).</summary>
    public required string MediaId { get; set; }

    /// <summary>The alt text (1..1000, sanitized on write; NFR-001).</summary>
    public required string Alt { get; set; }
}
