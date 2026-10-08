namespace Pulse.WebApi.Features.Injects;

using System.Collections.Generic;
using System.Linq;
using Pulse.WebApi.Data.Entities;

/// <summary>What the next publishing step for a <c>firing</c> item is.</summary>
public enum InjectStepKind
{
    /// <summary>Nothing to do yet: the next post is not due, is in flight elsewhere, or waits for its parent.</summary>
    Wait,

    /// <summary>No post is pending any more — settle the item (<c>fired</c> or <c>failed</c>).</summary>
    Complete,

    /// <summary>The next post's claim outlived the lease (a crash between claim and record) — reconcile it first.</summary>
    Reconcile,

    /// <summary>The next post can never publish (its reply parent was not published) — record it as failed.</summary>
    Fail,

    /// <summary>Publish the next post now.</summary>
    Publish,
}

/// <summary>One decision of <see cref="InjectBurstPlanner.Next"/>.</summary>
/// <param name="Kind">The step kind.</param>
/// <param name="Child">The child the step is about (all kinds but <see cref="InjectStepKind.Wait"/> and <see cref="InjectStepKind.Complete"/>).</param>
/// <param name="LatenessSeconds">How late the child is against its due instant (0 or more) — added to the item's shift.</param>
/// <param name="ParentPostId">The resolved reply parent post id for a <see cref="InjectStepKind.Publish"/>, if any.</param>
/// <param name="Error">The readable failure for a <see cref="InjectStepKind.Fail"/>.</param>
public sealed record InjectStep(
    InjectStepKind Kind,
    InjectItemPost? Child = null,
    double LatenessSeconds = 0,
    Guid? ParentPostId = null,
    string? Error = null);

/// <summary>
/// The pure pacing decision for a <c>firing</c> item (IQ-4): given the item, the current instant and the publish state
/// of reply parents in OTHER items, says what to do with the next post. The runner calls it once per item per tick,
/// so a burst publishes at most one post per tick; a fresh Fire calls it once in the request for the immediate first post.
/// </summary>
/// <remarks>
/// <para>
/// <b>Due instant:</b> <c>ReleasedAt + DueOffsetSeconds + ShiftSeconds</c>. <b>Lateness rule:</b> a post that goes
/// out after its due instant reports its lateness, which the caller adds to <see cref="InjectItem.ShiftSeconds"/> —
/// so every later post keeps its original spacing. That one rule covers PAUSE INJECTS, FREEZE, a hold, and a
/// backend restart, and it never dumps overdue posts together.
/// </para>
/// <para>
/// <b>Reply parents.</b> A post replying to an earlier post of the same item waits while that parent is still
/// pending, uses its post id once it fired, and fails ("Fire the parent first") if the parent can never publish. A
/// post replying to a scripted post in another item fails unless that parent has already fired.
/// </para>
/// </remarks>
public static class InjectBurstPlanner
{
    /// <summary>
    /// How long a claim may stay unrecorded before it is presumed abandoned (a crash between the claim and the
    /// recorded outcome). Ingest normally takes well under a second.
    /// </summary>
    public static readonly TimeSpan ClaimLease = TimeSpan.FromSeconds(60);

    /// <summary>The readable failure for a reply whose scripted parent was never published.</summary>
    public const string ParentNotFiredMessage =
        "Fire the parent first: the scripted post this one replies to has not been published.";

    /// <summary>Decides the next publishing step for <paramref name="item"/>.</summary>
    /// <param name="item">The item, with its children loaded.</param>
    /// <param name="now">The current server instant.</param>
    /// <param name="externalParentPostIds">
    /// For each scripted reply target in ANOTHER item: its published post id, or <c>null</c> when it has not fired.
    /// A target missing from the map is treated as unpublished.
    /// </param>
    /// <returns>The step.</returns>
    public static InjectStep Next(
        InjectItem item,
        DateTimeOffset now,
        IReadOnlyDictionary<Guid, Guid?> externalParentPostIds)
    {
        ArgumentNullException.ThrowIfNull(item);
        ArgumentNullException.ThrowIfNull(externalParentPostIds);

        var children = InjectTransitions.LiveChildren(item);
        var next = children.FirstOrDefault(post => post.Status == InjectPostStatuses.Pending);
        if (next is null)
        {
            return new InjectStep(InjectStepKind.Complete);
        }

        if (next.ClaimedAt is { } claimedAt)
        {
            return now - claimedAt < ClaimLease
                ? new InjectStep(InjectStepKind.Wait, next)
                : new InjectStep(InjectStepKind.Reconcile, next);
        }

        var due = DueAt(item, next, now);
        if (due > now)
        {
            return new InjectStep(InjectStepKind.Wait, next);
        }

        var lateness = (now - due).TotalSeconds;

        if (next.ReplyToInjectPostId is not { } target)
        {
            return new InjectStep(InjectStepKind.Publish, next, lateness, next.ReplyToPostId);
        }

        var sibling = children.FirstOrDefault(post => post.Id == target);
        if (sibling is not null)
        {
            if (sibling.Status == InjectPostStatuses.Pending)
            {
                return new InjectStep(InjectStepKind.Wait, next);
            }

            return sibling is { Status: InjectPostStatuses.Fired, FiredPostId: { } siblingPostId }
                ? new InjectStep(InjectStepKind.Publish, next, lateness, siblingPostId)
                : new InjectStep(InjectStepKind.Fail, next, lateness, Error: ParentNotFiredMessage);
        }

        return externalParentPostIds.TryGetValue(target, out var parentPostId) && parentPostId is { } published
            ? new InjectStep(InjectStepKind.Publish, next, lateness, published)
            : new InjectStep(InjectStepKind.Fail, next, lateness, Error: ParentNotFiredMessage);
    }

    /// <summary>The instant <paramref name="child"/> is due: release + its offset + the item's accumulated shift.</summary>
    /// <param name="item">The item.</param>
    /// <param name="child">The child.</param>
    /// <param name="fallbackRelease">The anchor used if the item has (unexpectedly) no release instant.</param>
    /// <returns>The due instant.</returns>
    public static DateTimeOffset DueAt(InjectItem item, InjectItemPost child, DateTimeOffset fallbackRelease)
    {
        ArgumentNullException.ThrowIfNull(item);
        ArgumentNullException.ThrowIfNull(child);

        var release = item.ReleasedAt ?? fallbackRelease;
        var seconds = (child.DueOffsetSeconds ?? 0) + item.ShiftSeconds;

        // Tick arithmetic, not AddSeconds, so an aligned shift lands EXACTLY on the instant it was aligned to.
        return release.AddTicks((long)Math.Round(seconds * TimeSpan.TicksPerSecond));
    }

    /// <summary>
    /// The shift that makes <paramref name="child"/> due exactly at <paramref name="now"/> — used when a controller
    /// fires a started burst directly, so the next post goes out immediately and the rest keep their spacing.
    /// </summary>
    /// <param name="item">The item (must have been released).</param>
    /// <param name="child">The next child to publish.</param>
    /// <param name="now">The current instant.</param>
    /// <returns>The aligned shift in seconds.</returns>
    public static double ShiftToMakeDueNow(InjectItem item, InjectItemPost child, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(item);
        ArgumentNullException.ThrowIfNull(child);

        var release = item.ReleasedAt ?? now;
        return (now - release).TotalSeconds - (child.DueOffsetSeconds ?? 0);
    }
}
