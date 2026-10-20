namespace Pulse.WebApi.Features.Injects;

using Pulse.WebApi.Features.BackgroundWork;

/// <summary>
/// The in-process wake-up line from <see cref="InjectQueueService"/> to <see cref="InjectBurstRunner"/> (L6). The
/// runner sleeps when nothing is firing and ticks every second while something is; a controller action that starts or
/// resumes a burst calls <see cref="WakeSignal.Wake"/> so the runner sweeps at once. Singleton; wakes coalesce.
/// </summary>
public sealed class InjectRunnerSignal : WakeSignal
{
}
