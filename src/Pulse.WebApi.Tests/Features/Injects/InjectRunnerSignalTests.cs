namespace Pulse.WebApi.Tests.Features.Injects;

using System;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Features.Injects;
using Xunit;

/// <summary>The runner's wake-up line (L6): a wake ends the idle wait at once, wakes coalesce, and a timeout is a timeout.</summary>
public sealed class InjectRunnerSignalTests
{
    [Fact]
    public async Task AWakeBeforeTheWait_EndsItImmediately()
    {
        var signal = new InjectRunnerSignal();
        signal.Wake();

        var watch = Stopwatch.StartNew();
        var woken = await signal.WaitAsync(TimeSpan.FromMinutes(10), TimeProvider.System, CancellationToken.None);

        woken.Should().BeTrue();
        watch.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task AWakeDuringTheWait_EndsIt()
    {
        var signal = new InjectRunnerSignal();
        var waiting = signal.WaitAsync(TimeSpan.FromMinutes(10), TimeProvider.System, CancellationToken.None);

        await Task.Delay(50);
        signal.Wake();

        (await waiting.WaitAsync(TimeSpan.FromSeconds(5))).Should().BeTrue("the idle sleep is cut short by a wake");
    }

    [Fact]
    public async Task WakesCoalesce_AndWithoutOneTheTimeoutElapses()
    {
        var signal = new InjectRunnerSignal();
        signal.Wake();
        signal.Wake();
        signal.Wake();

        (await signal.WaitAsync(TimeSpan.FromSeconds(5), TimeProvider.System, CancellationToken.None)).Should().BeTrue();
        (await signal.WaitAsync(TimeSpan.FromMilliseconds(100), TimeProvider.System, CancellationToken.None))
            .Should().BeFalse("three wakes before one wait count as one");
    }

    [Fact]
    public async Task Cancellation_EndsTheWait_WithAnException()
    {
        var signal = new InjectRunnerSignal();
        using var cancel = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));

        var act = () => signal.WaitAsync(TimeSpan.FromMinutes(10), TimeProvider.System, cancel.Token);

        await act.Should().ThrowAsync<OperationCanceledException>();
    }
}
