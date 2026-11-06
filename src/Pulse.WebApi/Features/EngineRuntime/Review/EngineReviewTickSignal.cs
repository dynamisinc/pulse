namespace Pulse.WebApi.Features.EngineRuntime.Review;

using Pulse.WebApi.Features.BackgroundWork;

/// <summary>
/// The in-process wake-up line to <see cref="EngineReviewTickHost"/>. The tick sleeps while no review item is counting
/// down; every write that starts a Delayed-auto countdown (a new burst enqueued by the reaction loop through
/// <see cref="EngineReviewStore.EnqueueAsync"/>, or a controller re-roll) calls <see cref="WakeSignal.Wake"/> after it
/// commits, so the countdown is evaluated from its first second. Singleton; wakes coalesce.
/// </summary>
public sealed class EngineReviewTickSignal : WakeSignal
{
}
