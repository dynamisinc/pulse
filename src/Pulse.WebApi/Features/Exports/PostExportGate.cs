namespace Pulse.WebApi.Features.Exports;

using System.Threading;

/// <summary>
/// The process-wide single-flight guard on the post export (demo-feedback story 02, Gate-1 M1). Building a workbook
/// holds the whole file in memory, so only one export runs at a time per process: a second request while one is
/// running is refused at once (no queueing) and the endpoint answers 429 with a readable reason. Registered as a
/// singleton, so every request in the process shares the one gate.
/// </summary>
/// <remarks>
/// The lease covers the build AND the response write: the endpoint ties a successful lease to the response
/// (<c>RegisterForDispose</c>), so the gate opens only once the file has been sent and its buffer released.
/// </remarks>
public sealed class PostExportGate : IDisposable
{
    private readonly SemaphoreSlim _semaphore = new(1, 1);

    /// <summary>Takes the gate without waiting.</summary>
    /// <returns>A lease that opens the gate when disposed (exactly once), or <c>null</c> when another export holds it.</returns>
    public IDisposable? TryEnter() => _semaphore.Wait(0) ? new Lease(_semaphore) : null;

    /// <inheritdoc />
    public void Dispose() => _semaphore.Dispose();

    /// <summary>Releases the semaphore once, however many times it is disposed.</summary>
    private sealed class Lease(SemaphoreSlim semaphore) : IDisposable
    {
        private int _released;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _released, 1) == 0)
            {
                semaphore.Release();
            }
        }
    }
}
