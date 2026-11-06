namespace Pulse.WebApi.Features.Channels.Content.Scheduling;

using Pulse.WebApi.Features.BackgroundWork;

/// <summary>
/// The <see cref="ContentScheduleRunner"/>'s wake-up line (a singleton, registered with <c>AddWakeSignal</c>): the funnel
/// pokes it after a schedule commits, any exercise clock change pokes it (<c>WakeOnClockChange</c>: a start, a jump,
/// leaving Freeze), and so does the <c>BackgroundWorkSafetySweep</c>, so an idle runner can sleep until there is work.
/// Wakes coalesce.
/// </summary>
public sealed class ContentScheduleSignal : WakeSignal
{
}
