namespace Pulse.WebApi.Tests.Features.Realtime;

using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;

/// <summary>
/// A test-only global hub filter that lets a test wait until the server has FINISHED a connection's
/// <c>OnConnectedAsync</c> (and therefore its group joins) before it broadcasts to that group.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this exists.</b> A SignalR client's <c>StartAsync</c> returns as soon as the handshake completes, but the
/// server runs the hub's <c>OnConnectedAsync</c> (where <c>ExerciseRealtimeHub</c> joins
/// <c>exercise:{id}</c>) AFTER sending the handshake response. A test that broadcasts to the group immediately
/// after <c>StartAsync</c> therefore races the join: on a busy machine or CI runner the message reaches the group
/// before the connection is in it and is silently dropped, and the test times out waiting for it. That is a test
/// race, not a product defect: a live client that misses a push in that window is covered by the feed's polling
/// fallback.
/// </para>
/// <para>
/// <b>How to use it.</b> Register one instance in the test host
/// (<c>services.Configure&lt;HubOptions&gt;(o =&gt; o.AddFilter(signal))</c>), start the client, then
/// <c>await signal.WaitForConnectedAsync()</c> before sending. The filter completes only after
/// <c>next(context)</c> returns, i.e. after the hub's own <c>OnConnectedAsync</c> has run to completion.
/// </para>
/// </remarks>
public sealed class HubConnectedSignal : IHubFilter
{
    private readonly TaskCompletionSource _connected = new(TaskCreationOptions.RunContinuationsAsynchronously);

    /// <inheritdoc />
    public async Task OnConnectedAsync(HubLifetimeContext context, Func<HubLifetimeContext, Task> next)
    {
        ArgumentNullException.ThrowIfNull(next);
        await next(context).ConfigureAwait(false);
        _connected.TrySetResult();
    }

    /// <summary>Waits until a connection's <c>OnConnectedAsync</c> has completed on the server.</summary>
    /// <param name="timeout">How long to wait; defaults to 10 seconds, the same window the tests allow a push.</param>
    /// <returns>A task that completes when the server-side connect has finished.</returns>
    /// <exception cref="TimeoutException">The server never finished <c>OnConnectedAsync</c> within the window.</exception>
    public async Task WaitForConnectedAsync(TimeSpan? timeout = null)
    {
        using var cts = new CancellationTokenSource(timeout ?? TimeSpan.FromSeconds(10));
        try
        {
            await _connected.Task.WaitAsync(cts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cts.IsCancellationRequested)
        {
            throw new TimeoutException("The hub never finished OnConnectedAsync for the test connection.");
        }
    }
}
