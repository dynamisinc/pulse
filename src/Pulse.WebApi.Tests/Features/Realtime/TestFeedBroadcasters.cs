namespace Pulse.WebApi.Tests.Features.Realtime;

using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Realtime;

/// <summary>
/// Builds a REAL <see cref="SignalRFeedBroadcaster"/> over a mocked hub context for tests that construct it by hand
/// (#375). The broadcaster now reads the exercise's lifecycle status before every send and fails closed to the staff
/// group when participants are not admitted, so a test about something else (the frame shape, the target exercise)
/// supplies a fixed <c>live</c> status here rather than seeding an exercise row.
/// </summary>
internal static class TestFeedBroadcasters
{
    /// <summary>A real broadcaster whose lifecycle reader always answers <paramref name="status"/>.</summary>
    /// <param name="hubContext">The (usually mocked) hub context.</param>
    /// <param name="status">The stored status every read returns; <c>null</c> models a missing exercise row.</param>
    /// <returns>The broadcaster.</returns>
    public static SignalRFeedBroadcaster Create(IHubContext<ExerciseRealtimeHub> hubContext, string? status = "live") =>
        new(hubContext, FixedStatus(status), NullLogger<SignalRFeedBroadcaster>.Instance);

    /// <summary>A lifecycle reader that always answers <paramref name="status"/>, for any exercise.</summary>
    /// <param name="status">The stored status to answer.</param>
    /// <returns>The reader.</returns>
    public static ExerciseLifecycleStatusReader FixedStatus(string? status) =>
        (Guid _, CancellationToken _) => Task.FromResult(status);
}

/// <summary>
/// A lifecycle reader whose answer a test can change mid-run (#375): flip <see cref="Status"/> from <c>live</c> to
/// <c>completed</c> and the very next broadcast sees EndEx.
/// </summary>
internal sealed class MutableLifecycleStatusReader
{
    private volatile string? _status;

    /// <summary>Creates the reader answering <paramref name="initialStatus"/>.</summary>
    /// <param name="initialStatus">The first status every read returns.</param>
    public MutableLifecycleStatusReader(string? initialStatus) => _status = initialStatus;

    /// <summary>The status every read currently returns.</summary>
    public string? Status
    {
        get => _status;
        set => _status = value;
    }

    /// <summary>The <see cref="ExerciseLifecycleStatusReader"/> view of this reader.</summary>
    /// <param name="exerciseId">Ignored: every exercise answers the same status.</param>
    /// <param name="cancellationToken">Ignored.</param>
    /// <returns>The current <see cref="Status"/>.</returns>
    public Task<string?> ReadAsync(Guid exerciseId, CancellationToken cancellationToken) => Task.FromResult(_status);
}
