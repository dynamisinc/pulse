namespace Pulse.WebApi.Tests.Features.Injects;

using System;
using System.Collections.Generic;
using System.Linq;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Injects;

/// <summary>In-memory builders for inject-queue unit tests (no database).</summary>
internal static class InjectTestData
{
    public static readonly DateTimeOffset T0 = new(2026, 10, 20, 14, 0, 0, TimeSpan.Zero);

    /// <summary>An item with <paramref name="childCount"/> pending children.</summary>
    public static InjectItem Item(
        string kind = InjectKinds.Burst,
        string status = InjectStatuses.Pending,
        int childCount = 3,
        Guid? exerciseId = null)
    {
        var exercise = exerciseId ?? Guid.NewGuid();
        var item = new InjectItem
        {
            Id = Guid.NewGuid(),
            ExerciseId = exercise,
            Kind = kind,
            Title = "Brown tap water pile-on",
            Status = status,
            Version = 1,
            CreatedByHumanId = Guid.NewGuid(),
            CreatedAt = T0,
            UpdatedAt = T0,
            BurstWindowSeconds = kind == InjectKinds.Burst ? 90 : null,
        };

        for (var sequence = 1; sequence <= childCount; sequence++)
        {
            item.Posts.Add(new InjectItemPost
            {
                Id = Guid.NewGuid(),
                ExerciseId = exercise,
                InjectItemId = item.Id,
                Sequence = sequence,
                PersonaId = Guid.NewGuid(),
                Text = $"post {sequence}",
                Status = InjectPostStatuses.Pending,
            });
        }

        return item;
    }

    /// <summary>Marks <paramref name="item"/> released at <paramref name="releasedAt"/> with the given offsets.</summary>
    public static InjectItem Released(InjectItem item, DateTimeOffset releasedAt, params int[] offsets)
    {
        item.ReleasedAt = releasedAt;
        item.Status = InjectStatuses.Firing;
        var children = Children(item);
        for (var index = 0; index < children.Count; index++)
        {
            children[index].DueOffsetSeconds = offsets.Length > index ? offsets[index] : index * 10;
        }

        return item;
    }

    /// <summary>The live children in sequence order.</summary>
    public static IReadOnlyList<InjectItemPost> Children(InjectItem item) =>
        item.Posts.Where(post => post.DeletedAt is null).OrderBy(post => post.Sequence).ToList();

    /// <summary>Marks a child fired with a fresh post id.</summary>
    public static InjectItemPost Fire(InjectItemPost child)
    {
        child.Status = InjectPostStatuses.Fired;
        child.FiredPostId = Guid.NewGuid();
        return child;
    }
}

/// <summary>
/// A jitter source that replays a fixed sequence of draws, cyclically and clamped into range — so every burst a test
/// fires gets the same pinned layout. With no draws it always returns the minimum.
/// </summary>
internal sealed class FixedJitterSource : IBurstJitterSource
{
    private readonly int[] _draws;
    private int _next;

    public FixedJitterSource(params int[] draws) => _draws = draws;

    public int Draw(int minInclusive, int maxExclusive)
    {
        var value = _draws.Length > 0 ? _draws[_next++ % _draws.Length] : minInclusive;
        return Math.Clamp(value, minInclusive, maxExclusive - 1);
    }
}
