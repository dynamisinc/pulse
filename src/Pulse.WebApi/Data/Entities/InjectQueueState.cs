namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// One row per exercise that serializes changes to the SET and ORDER of its scripted-post queue (inject-queue story 06,
/// Copilot review on #458). Create, delete and reorder each bump <see cref="Version"/> — an EF concurrency token — in
/// the same <c>SaveChanges</c> as their own change, so a reorder computed against one membership can never save over a
/// queue that gained or lost an item meanwhile (it gets <c>DbUpdateConcurrencyException</c> → <c>409</c>).
/// </summary>
/// <remarks>
/// <para>
/// <b>Why a token row, not a serializable transaction.</b> The per-item <see cref="InjectItem.Version"/> tokens cannot see
/// a row that was INSERTED after the reorder read the set, nor a soft delete of a row whose order did not change. A
/// serializable transaction would close that by holding key-range locks across the read and the save — which BLOCKS
/// every concurrent create/delete in the exercise for the duration and can deadlock two reorders. A token row keeps the
/// house pattern (optimistic, the same as the item token, IQ-9): nobody waits, the loser of a race is told, and the race
/// is deterministic to test.
/// </para>
/// <para>
/// <see cref="IExerciseScoped"/> like the rest of the queue (keyed by its exercise), so it inherits the central filter
/// and write guard. Created lazily by the first create in an exercise. Carries no participant-visible content.
/// </para>
/// </remarks>
public sealed class InjectQueueState : IExerciseScoped
{
    /// <summary>The owning exercise — also the primary key (one queue per exercise).</summary>
    public Guid ExerciseId { get; set; }

    /// <summary>The queue-membership concurrency token: bumped by every create, delete and reorder.</summary>
    public int Version { get; set; }
}
