namespace Pulse.WebApi.Features.WhiteNoise;

using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;

/// <summary>
/// The pacer's in-memory timetable (DF-12/DF-13): for each exercise that is making noise, when its next post is due.
/// Holds no content and touches no database, so the rate and jitter rules are testable on their own.
/// </summary>
/// <remarks>
/// <para>
/// <b>No catch-up, ever.</b> An exercise the scheduler has not seen yet — after an API restart, after a level change,
/// or after a stop (Freeze, a frozen or stopped clock) clears — gets its first post one jittered gap from that moment.
/// Nothing that "came due" while the exercise was stopped or the host was down is posted.
/// </para>
/// <para>
/// <b>Isolation (COR-001).</b> Entries are keyed by exercise id; one exercise's level, stop or timetable never moves
/// another's.
/// </para>
/// </remarks>
public sealed class NoiseScheduler
{
    private readonly INoiseJitterSource _jitter;
    private readonly ConcurrentDictionary<Guid, Entry> _entries = new();

    /// <summary>Creates the scheduler over a jitter source.</summary>
    /// <param name="jitter">The jitter draws.</param>
    public NoiseScheduler(INoiseJitterSource jitter)
    {
        ArgumentNullException.ThrowIfNull(jitter);
        _jitter = jitter;
    }

    /// <summary>The exercises that currently have a timetable (for tests and diagnostics).</summary>
    public IReadOnlyCollection<Guid> Scheduled => _entries.Keys.ToList();

    /// <summary>
    /// Whether exercise <paramref name="exerciseId"/> should publish a noise post now. A stopped exercise, or a level
    /// that posts nothing, loses its timetable and answers <c>false</c>. A first sighting, or a level different from
    /// the one the timetable was made for, starts a new timetable one gap from <paramref name="now"/> and answers
    /// <c>false</c>.
    /// </summary>
    /// <param name="exerciseId">The exercise.</param>
    /// <param name="level">Its persisted level.</param>
    /// <param name="stopped">Whether noise is stopped for it right now (Freeze, frozen or stopped clock).</param>
    /// <param name="now">The current server time.</param>
    /// <returns><c>true</c> when a post is due.</returns>
    public bool IsDue(Guid exerciseId, string level, bool stopped, DateTimeOffset now)
    {
        if (stopped || NoiseRates.PerMinute(level) <= 0)
        {
            _entries.TryRemove(exerciseId, out _);
            return false;
        }

        if (!_entries.TryGetValue(exerciseId, out var entry) || !string.Equals(entry.Level, level, StringComparison.Ordinal))
        {
            _entries[exerciseId] = new Entry(level, now + NextGap(level));
            return false;
        }

        return now >= entry.Due;
    }

    /// <summary>
    /// Moves exercise <paramref name="exerciseId"/>'s timetable on by one jittered gap after a due post was handled
    /// (published, found nothing to post, or failed), so it is not retried on every tick.
    /// </summary>
    /// <param name="exerciseId">The exercise.</param>
    /// <param name="now">The current server time.</param>
    public void Advance(Guid exerciseId, DateTimeOffset now)
    {
        if (_entries.TryGetValue(exerciseId, out var entry))
        {
            _entries[exerciseId] = entry with { Due = NoiseRates.NextDue(entry.Due, now, NextGap(entry.Level)) };
        }
    }

    /// <summary>Drops every timetable whose exercise is not in <paramref name="active"/> (it went quiet).</summary>
    /// <param name="active">The exercises whose level is not <c>off</c>.</param>
    public void Retain(IReadOnlyCollection<Guid> active)
    {
        ArgumentNullException.ThrowIfNull(active);

        foreach (var exerciseId in _entries.Keys)
        {
            if (!active.Contains(exerciseId))
            {
                _entries.TryRemove(exerciseId, out _);
            }
        }
    }

    /// <summary>When exercise <paramref name="exerciseId"/>'s next post is due, or <c>null</c> without a timetable.</summary>
    /// <param name="exerciseId">The exercise.</param>
    /// <returns>The due time.</returns>
    public DateTimeOffset? DueAt(Guid exerciseId) =>
        _entries.TryGetValue(exerciseId, out var entry) ? entry.Due : null;

    private TimeSpan NextGap(string level) => NoiseRates.Gap(level, _jitter.NextUnit());

    private sealed record Entry(string Level, DateTimeOffset Due);
}
