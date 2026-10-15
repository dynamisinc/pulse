namespace Pulse.WebApi.Tests.Features.Injects.Import;

using System;
using System.Collections.Generic;
using System.Linq;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Injects;
using Pulse.WebApi.Features.Injects.Import;
using Xunit;

/// <summary>
/// demo-feedback/16 (DF-22 order) — <see cref="ImportQueuePlacement"/>, pure: a created item goes immediately before the
/// first PENDING item whose planned minute is greater than its own; ties after; no minute or no later pending item ⇒ the
/// end; non-pending items and existing pending items never change their relative order.
/// </summary>
public sealed class ImportQueuePlacementTests
{
    [Fact]
    public void ACreatedItem_GoesImmediatelyBeforeTheFirstPendingItemPlannedLater()
    {
        var queue = Queue(("p0", InjectStatuses.Pending, 0), ("p10", InjectStatuses.Pending, 10), ("p20", InjectStatuses.Pending, 20));

        var order = Place(queue, New("n15", 15), New("n5", 5));

        order.Should().Equal("p0", "n5", "p10", "n15", "p20");
    }

    [Fact]
    public void Ties_GoAfterTheExistingItemsWithTheSameMinute()
    {
        var queue = Queue(
            ("p5", InjectStatuses.Pending, 5),
            ("p10", InjectStatuses.Pending, 10),
            ("p10b", InjectStatuses.Pending, 10),
            ("p20", InjectStatuses.Pending, 20));

        Place(queue, New("n10", 10)).Should().Equal(
            ["p5", "p10", "p10b", "n10", "p20"],
            "equal is not greater: a tie lands after every pending item already at that minute");
    }

    [Fact]
    public void SeveralCreatedItemsWithOneMinute_KeepTheirFileRowOrder()
    {
        var queue = Queue(("p5", InjectStatuses.Pending, 5), ("p20", InjectStatuses.Pending, 20));

        Place(queue, New("a", 10), New("b", 10), New("c", 10)).Should().Equal("p5", "a", "b", "c", "p20");
    }

    [Fact]
    public void ACreatedItemWithNoMinute_OrWithNoLaterPendingItem_GoesAtTheEnd()
    {
        var queue = Queue(("p5", InjectStatuses.Pending, 5), ("p20", InjectStatuses.Pending, 20));

        Place(queue, New("unplanned", null), New("n30", 30)).Should().Equal(
            ["p5", "p20", "unplanned", "n30"],
            "no minute, or nothing pending planned later, appends — in file row order");
    }

    [Fact]
    public void NonPendingItems_AreNeverAnAnchor_AndKeepTheirPlaces()
    {
        var queue = Queue(
            ("fired0", InjectStatuses.Fired, 0),
            ("p5", InjectStatuses.Pending, 5),
            ("held12", InjectStatuses.Held, 12),
            ("skipped14", InjectStatuses.Skipped, 14),
            ("failed16", InjectStatuses.Failed, 16),
            ("firing18", InjectStatuses.Firing, 18),
            ("p20", InjectStatuses.Pending, 20),
            ("fired25", InjectStatuses.Fired, 25));

        var order = Place(queue, New("n10", 10), New("n1", 1), New("n30", 30));

        order.Should().Equal(
            ["fired0", "n1", "p5", "held12", "skipped14", "failed16", "firing18", "n10", "p20", "fired25", "n30"],
            "only a pending item can anchor; a fired, held, skipped, failed or firing item planned later never does");
        order.Where(name => !name.StartsWith('n')).Should().Equal(
            queue.Select(item => item.Title),
            "existing items never change their relative order — the only change is the shift an insertion causes");
    }

    [Fact]
    public void ExistingPendingItems_KeepTheirRelativeOrder_EvenWhenTheyAreNotInTimeOrder()
    {
        var queue = Queue(("p30", InjectStatuses.Pending, 30), ("p10", InjectStatuses.Pending, 10), ("p20", InjectStatuses.Pending, 20));

        Place(queue, New("n15", 15)).Should().Equal(
            ["n15", "p30", "p10", "p20"],
            "the rule is the FIRST pending item in current order planned later; existing rows are never re-sorted");
    }

    [Fact]
    public void AnExistingPendingItemWithNoMinute_IsNeverAnAnchor()
    {
        var queue = Queue(("p5", InjectStatuses.Pending, 5), ("unplanned", InjectStatuses.Pending, null), ("p20", InjectStatuses.Pending, 20));

        Place(queue, New("n10", 10)).Should().Equal("p5", "unplanned", "n10", "p20");
    }

    [Fact]
    public void CreatedItemsOutOfTimeOrderInTheFile_StillEndUpInTimeOrder()
    {
        var queue = Queue(("p10", InjectStatuses.Pending, 10));

        Place(queue, New("n30", 30), New("n20", 20)).Should().Equal(
            ["p10", "n20", "n30"],
            "a placed item is pending, so a later file row planned earlier lands before it");
        Place([], New("n20", 20), New("n10", 10)).Should().Equal("n10", "n20");
    }

    [Fact]
    public void AnUpdatedItem_IsJudgedByTheMinuteTheCallerSays_ItsStoredOne()
    {
        // The import updated "moved" from minute 5 to 45 in this same run; it keeps its place, so it is judged by the
        // minute that put it there (5). Judged by 45 it would pull the new minute-12 item ahead of the minute-10 item.
        var moved = Item("moved", InjectStatuses.Pending, 45);
        var queue = new List<InjectItem> { Item("fired0", InjectStatuses.Fired, 0), moved, Item("p10", InjectStatuses.Pending, 10), Item("p20", InjectStatuses.Pending, 20) };
        var stored = new Dictionary<InjectItem, int?> { [moved] = 5 };

        var order = ImportQueuePlacement.Place(
            queue,
            [Item("n12", InjectStatuses.Pending, 12)],
            item => stored.TryGetValue(item, out var minute) ? minute : item.PlannedMinute);

        order.Select(item => item.Title).Should().Equal("fired0", "moved", "p10", "n12", "p20");
    }

    [Fact]
    public void EveryItemOfBothLists_IsInTheResult_Once()
    {
        var queue = Queue(("p5", InjectStatuses.Pending, 5), ("f", InjectStatuses.Fired, 1));
        var created = new List<InjectItem> { Item("n1", InjectStatuses.Pending, 1), Item("n9", InjectStatuses.Pending, null) };

        var order = ImportQueuePlacement.Place(queue, created);

        order.Should().HaveCount(4).And.OnlyHaveUniqueItems().And.Contain(queue).And.Contain(created);
    }

    // ---- helpers ----

    private static List<InjectItem> Queue(params (string Title, string Status, int? Minute)[] items) =>
        items.Select(item => Item(item.Title, item.Status, item.Minute)).ToList();

    private static InjectItem New(string title, int? minute) => Item(title, InjectStatuses.Pending, minute);

    private static List<string> Place(IReadOnlyList<InjectItem> queue, params InjectItem[] created) =>
        ImportQueuePlacement.Place(queue, created).Select(item => item.Title).ToList();

    private static InjectItem Item(string title, string status, int? minute) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = Guid.NewGuid(),
        Kind = InjectKinds.Post,
        Title = title,
        Status = status,
        PlannedMinute = minute,
    };
}
