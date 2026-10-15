namespace Pulse.WebApi.Features.Injects.Import;

using System.Collections.Generic;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Where the items an MSEL import CREATES go in the run sheet (demo-feedback story 14, DF-18): by planned minute among
/// the pending items, so "Fire next" (the first pending item in order) fires imported and seeded items in time order.
/// A pure function over the queue as the import read it — no I/O — so every rule is unit-testable.
/// </summary>
/// <remarks>
/// <para>
/// <b>The rule.</b> Each created item, in file row order, goes immediately before the first PENDING item (in the order
/// built so far) whose planned minute is greater than its own. Equal is not greater, so ties go after the items that
/// already have that minute, and several new items with one minute keep their file row order. A created item with no
/// minute, or with no later pending item, goes at the end. A pending item with no minute is never an anchor.
/// </para>
/// <para>
/// <b>What never moves.</b> Non-pending items (held, firing, fired, skipped, failed) are never an anchor and keep their
/// places; existing pending items keep their relative order. The only change to existing rows is the shift an
/// insertion causes.
/// </para>
/// <para>
/// <b>Updated items.</b> An item the same import updates keeps its place and is judged by its STORED minute (the run
/// sheet as it stands, which is what put it where it is), not by a new minute from the file: judging a row that stays
/// put by a minute it has not been placed for would drop new items out of time order around it. The service passes
/// that minute through <c>minuteOf</c>.
/// </para>
/// <para>
/// <b>Created items are placed one at a time.</b> Once placed, a created item is a pending item like any other, so a
/// later row of the same file can land before it (a file listing minute 30 before minute 20 still ends up 20, 30).
/// </para>
/// </remarks>
public static class ImportQueuePlacement
{
    /// <summary>The full new queue order, judging every item by its <see cref="InjectItem.PlannedMinute"/>.</summary>
    /// <param name="queue">The exercise's live items in their current order (the import's scoped read).</param>
    /// <param name="created">The items the import creates, in file row order.</param>
    /// <returns>Every item of both lists, in the new order.</returns>
    public static IReadOnlyList<InjectItem> Place(IReadOnlyList<InjectItem> queue, IReadOnlyList<InjectItem> created) =>
        Place(queue, created, item => item.PlannedMinute);

    /// <summary>The full new queue order: <paramref name="queue"/> with <paramref name="created"/> placed into it.</summary>
    /// <param name="queue">The exercise's live items in their current order (the import's scoped read).</param>
    /// <param name="created">The items the import creates, in file row order.</param>
    /// <param name="minuteOf">The planned minute an item is judged by (see the remarks on updated items).</param>
    /// <returns>Every item of both lists, in the new order.</returns>
    public static IReadOnlyList<InjectItem> Place(
        IReadOnlyList<InjectItem> queue,
        IReadOnlyList<InjectItem> created,
        Func<InjectItem, int?> minuteOf)
    {
        ArgumentNullException.ThrowIfNull(queue);
        ArgumentNullException.ThrowIfNull(created);
        ArgumentNullException.ThrowIfNull(minuteOf);

        var order = new List<InjectItem>(queue.Count + created.Count);
        order.AddRange(queue);

        foreach (var item in created)
        {
            var anchor = minuteOf(item) is { } minute
                ? order.FindIndex(candidate => candidate.Status == InjectStatuses.Pending && minuteOf(candidate) > minute)
                : -1;

            if (anchor < 0)
            {
                order.Add(item);
            }
            else
            {
                order.Insert(anchor, item);
            }
        }

        return order;
    }
}
