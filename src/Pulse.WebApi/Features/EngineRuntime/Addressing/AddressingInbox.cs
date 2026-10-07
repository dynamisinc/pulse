namespace Pulse.WebApi.Features.EngineRuntime.Addressing;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using Pulse.Core.Features.ReactionLoop.Models;

/// <summary>
/// The engine's inbox of official posts awaiting the next reaction-loop tick (engine-runtime/06). The social
/// write path fills it through <see cref="EngineAddressingObserver"/> the moment a participant posts; the loop
/// drains it once per tick into <c>ObserveStage</c>. Before this story the loop handed the observe stage an
/// empty list on every tick, so no participant post could ever address a storyline.
/// </summary>
/// <remarks>
/// <para>
/// In-memory and per exercise, like the rest of the engine's state: a restart drops whatever is pending, and
/// the seed clears an exercise's inbox when it registers a fresh storyline, so a post made during an earlier
/// run can never satisfy the new one.
/// </para>
/// <para>
/// Bounded: at most <see cref="AddressingInbox.MaxPendingPerExercise"/> observations wait per exercise (the
/// oldest are dropped first), so an exercise with no registered loop can't grow it without limit.
/// Thread-safe: posts arrive on request threads while the loop drains on its scheduler thread.
/// </para>
/// </remarks>
public interface IAddressingInbox
{
    /// <summary>Queues an official post (or marker) for the exercise's next tick.</summary>
    /// <param name="exerciseId">The server-resolved exercise the observation belongs to (COR-001).</param>
    /// <param name="observation">The observation to queue.</param>
    void Enqueue(Guid exerciseId, AddressingObservation observation);

    /// <summary>Removes and returns everything queued for the exercise, oldest first.</summary>
    /// <param name="exerciseId">The exercise whose inbox to drain.</param>
    /// <returns>The drained observations; empty when nothing is pending.</returns>
    IReadOnlyList<AddressingObservation> Drain(Guid exerciseId);

    /// <summary>Discards everything queued for the exercise (the seed calls this when it re-registers a loop).</summary>
    /// <param name="exerciseId">The exercise whose inbox to clear.</param>
    void Clear(Guid exerciseId);
}

/// <summary>The default thread-safe <see cref="IAddressingInbox"/>: one concurrent queue per exercise.</summary>
public sealed class AddressingInbox : IAddressingInbox
{
    /// <summary>The most observations that may wait for one exercise; older ones are dropped first.</summary>
    public const int MaxPendingPerExercise = 50;

    private readonly ConcurrentDictionary<Guid, ConcurrentQueue<AddressingObservation>> _pending = new();

    /// <inheritdoc />
    public void Enqueue(Guid exerciseId, AddressingObservation observation)
    {
        ArgumentNullException.ThrowIfNull(observation);

        var queue = _pending.GetOrAdd(exerciseId, _ => new ConcurrentQueue<AddressingObservation>());
        queue.Enqueue(observation);
        while (queue.Count > MaxPendingPerExercise && queue.TryDequeue(out _))
        {
            // Drop the oldest until the queue is back within its bound.
        }
    }

    /// <inheritdoc />
    public IReadOnlyList<AddressingObservation> Drain(Guid exerciseId)
    {
        if (!_pending.TryGetValue(exerciseId, out var queue))
        {
            return [];
        }

        var drained = new List<AddressingObservation>();
        while (queue.TryDequeue(out var observation))
        {
            drained.Add(observation);
        }

        return drained;
    }

    /// <inheritdoc />
    public void Clear(Guid exerciseId) => _pending.TryRemove(exerciseId, out _);
}
