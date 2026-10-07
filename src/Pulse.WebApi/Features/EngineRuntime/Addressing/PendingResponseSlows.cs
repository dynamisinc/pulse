namespace Pulse.WebApi.Features.EngineRuntime.Addressing;

using System;
using System.Collections.Generic;

/// <summary>
/// The miss-safe slows an exercise's official posts have left pending (ADP-002a, engine-runtime/06). An
/// unconfirmed or unmatched official post slows escalation from the moment it lands until the controller
/// answers "does this address #X?" (E8 §7.1). Posts land between escalation bursts, though: the reaction
/// cadence lets a storyline's silence re-fire only every few scenario minutes, so a slow applied only on the
/// tick that drained the post would almost never meet a burst, and the next one would go out at full size,
/// as if the PIO had said nothing. The slow therefore waits here until that storyline's next escalation burst
/// carries it, and a match removes it (the storyline is answered).
/// </summary>
/// <remarks>
/// Bounded per answer: one pending slow per storyline, carried by one burst. A stream of irrelevant posts can
/// at most keep every burst slowed (fewer voices, never zero); it can never pause or calm a storyline, which is
/// the anti-gaming half of ADP-002a. It lives on the <see cref="ReactionLoopRegistration"/>, so a re-seed (new
/// storylines) starts clean. Like the storylines themselves, it is touched only by the driver on the host's
/// sequential ticks, so it takes no lock.
/// </remarks>
public sealed class PendingResponseSlows
{
    private readonly HashSet<Guid> _pending = [];

    /// <summary>Leaves a slow pending on a storyline's escalation.</summary>
    /// <param name="storylineId">The storyline whose next escalation burst is slowed.</param>
    public void Add(Guid storylineId) => _pending.Add(storylineId);

    /// <summary>Whether a slow is pending on the storyline's escalation.</summary>
    /// <param name="storylineId">The storyline to check.</param>
    /// <returns><c>true</c> when its next escalation burst is to be slowed.</returns>
    public bool IsPending(Guid storylineId) => _pending.Contains(storylineId);

    /// <summary>Removes a storyline's pending slow: a burst carried it, or a match answered the storyline.</summary>
    /// <param name="storylineId">The storyline whose slow is spent.</param>
    public void Remove(Guid storylineId) => _pending.Remove(storylineId);
}
