namespace Pulse.WebApi.Features.WhiteNoise;

using Pulse.WebApi.Features.BackgroundWork;

/// <summary>
/// The in-process wake-up line from <see cref="WhiteNoiseService"/> to <see cref="WhiteNoisePacer"/>. The pacer sleeps
/// while no exercise has both a pool and a level other than <c>off</c>; a level change (<c>PUT /api/staff/noise</c>) or a
/// pool change (<c>PUT /api/staff/noise/pool</c>) calls <see cref="WakeSignal.Wake"/> after it commits, so turning noise
/// on starts the timetable at once. Singleton; wakes coalesce.
/// </summary>
public sealed class WhiteNoisePacerSignal : WakeSignal
{
}
