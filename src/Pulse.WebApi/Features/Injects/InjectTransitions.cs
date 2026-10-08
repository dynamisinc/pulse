namespace Pulse.WebApi.Features.Injects;

using System.Collections.Generic;
using System.Linq;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The pure item state machine (inject-queue story 06): which controller actions are allowed from which status,
/// and what each one does to the item and its children. No database, no clock — the service loads the item, asks
/// this class, bumps the version and saves, so every allowed and refused transition is unit-testable.
/// </summary>
/// <remarks>
/// <para><b>The machine</b> (anything else is refused with a readable message → <c>409</c>):</para>
/// <list type="bullet">
///   <item><c>hold</c>: <c>pending → held</c>; <c>firing → held</c> for a burst (its remaining posts wait).</item>
///   <item><c>release</c>: <c>held → pending</c>, or <c>held → firing</c> when the burst has already started.</item>
///   <item><c>skip</c>: <c>pending|held → skipped</c>; the remaining posts are skipped.</item>
///   <item><c>unskip</c>: <c>skipped → pending</c>, or <c>→ held</c> when anything already went out.</item>
///   <item><c>retry</c>: <c>failed →</c> re-fire the failed posts.</item>
///   <item><c>fire</c>: <c>pending|held →</c> publishing (a held item may be fired directly: release + fire).</item>
///   <item>edit: only while <c>pending|held|failed</c> and no post is in flight (posts that already went out are
///   immutable and must be kept); delete: only while <c>pending|held|skipped|failed</c>.</item>
/// </list>
/// <para><c>fired</c> is terminal: a published post is corrected with a takedown, never here.</para>
/// <para>
/// A burst has "started" once its first release happened (<see cref="InjectItem.ReleasedAt"/> is set) — it then has
/// posts that went out or failed, so it can never be returned to a fresh <c>pending</c>.
/// </para>
/// </remarks>
public static class InjectTransitions
{
    /// <summary>The live (non-deleted) children in sequence order.</summary>
    /// <param name="item">The item.</param>
    /// <returns>The live children.</returns>
    public static IReadOnlyList<InjectItemPost> LiveChildren(InjectItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        return item.Posts.Where(post => post.DeletedAt is null).OrderBy(post => post.Sequence).ToList();
    }

    /// <summary>Whether the item's first release has happened.</summary>
    /// <param name="item">The item.</param>
    /// <returns><c>true</c> once the item has been fired at least once.</returns>
    public static bool HasStarted(InjectItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        return item.ReleasedAt is not null;
    }

    /// <summary>Why the item may not be edited, or <c>null</c> when it may.</summary>
    /// <param name="item">The item.</param>
    /// <returns>A refusal message or <c>null</c>.</returns>
    public static string? WhyNotEditable(InjectItem item)
    {
        ArgumentNullException.ThrowIfNull(item);

        if (item.Status is not (InjectStatuses.Pending or InjectStatuses.Held or InjectStatuses.Failed))
        {
            return $"This item is {item.Status} and is read-only.";
        }

        // A post being published right now cannot be edited around; the next poll will show its outcome. (Posts that
        // already went out stay editable-around but are themselves immutable — see InjectQueueService.UpdateAsync.)
        if (LiveChildren(item).Any(post => post.ClaimedAt is not null))
        {
            return "A post of this item is being published right now. Try again in a moment.";
        }

        return null;
    }

    /// <summary>
    /// Why applying <paramref name="draft"/> would rewrite what participants already saw, or <c>null</c> when it would
    /// not. Once an item has fired its kind is fixed, and every published child must be echoed back (by id) with its
    /// content unchanged — a published post is corrected with a takedown, never by editing its record (<c>409</c>).
    /// Unpublished children may be changed, reordered or removed freely.
    /// </summary>
    /// <param name="item">The item, with its children loaded.</param>
    /// <param name="draft">The validated edit.</param>
    /// <returns>A refusal message or <c>null</c>.</returns>
    public static string? WhyEditWouldRewriteHistory(InjectItem item, InjectItemDraft draft)
    {
        ArgumentNullException.ThrowIfNull(item);
        ArgumentNullException.ThrowIfNull(draft);

        if (HasStarted(item) && draft.Kind != item.Kind)
        {
            return "An item's kind cannot change once it has fired.";
        }

        var echoed = draft.Posts.Select(post => post.Id).ToList();
        foreach (var published in LiveChildren(item).Where(post => post.Status == InjectPostStatuses.Fired))
        {
            var index = echoed.IndexOf(published.Id);
            if (index < 0)
            {
                return $"Post {published.Sequence} was already published and cannot be removed.";
            }

            var source = draft.Posts[index];
            var replyTo = source.ReplyToInjectPostId
                ?? (source.ReplyToSequence is { } sequence ? echoed[sequence - 1] ?? Guid.NewGuid() : null);
            var unchanged = source.PersonaId == published.PersonaId
                && source.Text == published.Text
                && source.Media.Select(media => (media.MediaId, media.Alt))
                    .SequenceEqual(published.Media.Select(media => (media.MediaId, media.Alt)))
                && replyTo == published.ReplyToInjectPostId
                && source.ReplyToPostId == published.ReplyToPostId
                && source.BaselineLike == published.BaselineLike
                && source.BaselineRepost == published.BaselineRepost
                && source.BaselineReply == published.BaselineReply;
            if (!unchanged)
            {
                return $"Post {index + 1} was already published and cannot be changed.";
            }
        }

        return null;
    }

    /// <summary>Why the item may not be deleted, or <c>null</c> when it may.</summary>
    /// <param name="item">The item.</param>
    /// <returns>A refusal message or <c>null</c>.</returns>
    public static string? WhyNotDeletable(InjectItem item)
    {
        ArgumentNullException.ThrowIfNull(item);

        return item.Status is InjectStatuses.Pending or InjectStatuses.Held or InjectStatuses.Skipped
            or InjectStatuses.Failed
            ? null
            : $"This item is {item.Status} and cannot be deleted.";
    }

    /// <summary>Why the item may not be fired, or <c>null</c> when it may.</summary>
    /// <param name="item">The item.</param>
    /// <returns>A refusal message or <c>null</c>.</returns>
    public static string? WhyNotFireable(InjectItem item)
    {
        ArgumentNullException.ThrowIfNull(item);

        return item.Status switch
        {
            InjectStatuses.Pending or InjectStatuses.Held => null,
            InjectStatuses.Fired => "This item has already been fired.",
            InjectStatuses.Firing => "This item is already firing.",
            _ => $"This item is {item.Status} and cannot be fired.",
        };
    }

    /// <summary>Why the item may not be retried, or <c>null</c> when it may.</summary>
    /// <param name="item">The item.</param>
    /// <returns>A refusal message or <c>null</c>.</returns>
    public static string? WhyNotRetryable(InjectItem item)
    {
        ArgumentNullException.ThrowIfNull(item);

        return item.Status == InjectStatuses.Failed ? null : $"Only a failed item can be retried; this one is {item.Status}.";
    }

    /// <summary><c>hold</c>: <c>pending → held</c>, or <c>firing → held</c> for a burst.</summary>
    /// <param name="item">The item to mutate.</param>
    /// <returns>A refusal message, or <c>null</c> when applied.</returns>
    public static string? Hold(InjectItem item)
    {
        ArgumentNullException.ThrowIfNull(item);

        var allowed = item.Status == InjectStatuses.Pending
            || (item.Status == InjectStatuses.Firing && item.Kind == InjectKinds.Burst);
        if (!allowed)
        {
            return $"This item is {item.Status} and cannot be held.";
        }

        item.Status = InjectStatuses.Held;
        return null;
    }

    /// <summary><c>release</c>: <c>held → pending</c>, or <c>held → firing</c> when the burst already started.</summary>
    /// <param name="item">The item to mutate.</param>
    /// <param name="actingHumanId">The releasing controller — attributed to the posts the runner then publishes.</param>
    /// <returns>A refusal message, or <c>null</c> when applied.</returns>
    public static string? Release(InjectItem item, Guid actingHumanId)
    {
        ArgumentNullException.ThrowIfNull(item);

        if (item.Status != InjectStatuses.Held)
        {
            return $"This item is {item.Status} and is not held.";
        }

        if (HasStarted(item))
        {
            item.Status = InjectStatuses.Firing;
            item.DriverHumanId = actingHumanId;
        }
        else
        {
            item.Status = InjectStatuses.Pending;
        }

        return null;
    }

    /// <summary><c>skip</c>: <c>pending|held → skipped</c>; every remaining (pending) post is skipped.</summary>
    /// <param name="item">The item to mutate.</param>
    /// <returns>A refusal message, or <c>null</c> when applied.</returns>
    public static string? Skip(InjectItem item)
    {
        ArgumentNullException.ThrowIfNull(item);

        if (item.Status is not (InjectStatuses.Pending or InjectStatuses.Held))
        {
            return $"This item is {item.Status} and cannot be skipped.";
        }

        item.Status = InjectStatuses.Skipped;
        foreach (var post in LiveChildren(item).Where(post => post.Status == InjectPostStatuses.Pending))
        {
            post.Status = InjectPostStatuses.Skipped;
        }

        return null;
    }

    /// <summary><c>unskip</c>: <c>skipped → pending</c>, or <c>→ held</c> when anything already went out.</summary>
    /// <param name="item">The item to mutate.</param>
    /// <returns>A refusal message, or <c>null</c> when applied.</returns>
    public static string? Unskip(InjectItem item)
    {
        ArgumentNullException.ThrowIfNull(item);

        if (item.Status != InjectStatuses.Skipped)
        {
            return $"This item is {item.Status} and is not skipped.";
        }

        item.Status = HasStarted(item) ? InjectStatuses.Held : InjectStatuses.Pending;
        foreach (var post in LiveChildren(item).Where(post => post.Status == InjectPostStatuses.Skipped))
        {
            post.Status = InjectPostStatuses.Pending;
        }

        return null;
    }

    /// <summary>
    /// Settles the item after a child's outcome is recorded: once no live child is still pending, the item becomes
    /// <c>fired</c> — or <c>failed</c>, carrying the first failure's message, if any child failed. A controller's
    /// explicit <c>skipped</c> is never overwritten, and an item with posts still to go keeps its status.
    /// </summary>
    /// <param name="item">The item to mutate.</param>
    public static void Settle(InjectItem item)
    {
        ArgumentNullException.ThrowIfNull(item);

        if (item.Status == InjectStatuses.Skipped)
        {
            return;
        }

        var children = LiveChildren(item);
        if (children.Any(post => post.Status == InjectPostStatuses.Pending))
        {
            return;
        }

        var firstFailure = children.FirstOrDefault(post => post.Status == InjectPostStatuses.Failed);
        item.Status = firstFailure is null ? InjectStatuses.Fired : InjectStatuses.Failed;
        item.Error = firstFailure?.Error;
    }
}
