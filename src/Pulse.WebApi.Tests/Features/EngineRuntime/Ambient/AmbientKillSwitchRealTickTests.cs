namespace Pulse.WebApi.Tests.Features.EngineRuntime.Ambient;

using System;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Pulse.Core.Features.Ambient.Models;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.WebApi.Features.EngineRuntime;
using Xunit;

/// <summary>
/// ambient-chatter story 01, AC6 "kill switch within 5 s" with the REAL <see cref="ReactionLoopHost"/> and its REAL
/// default tick interval (5 s, wall clock): autonomous ambient is publishing; a safety lever is pulled; nothing is
/// published after that instant. Both kill-switch modes and the cut to Fake. Docker-free (in-memory store,
/// recording funnel); each case takes roughly 12 s of wall time.
/// </summary>
public sealed class AmbientKillSwitchRealTickTests
{
    public enum Lever
    {
        FullStop,
        DropToSuggest,
        CutToFake,
    }

    [Theory]
    [InlineData(Lever.FullStop)]
    [InlineData(Lever.DropToSuggest)]
    [InlineData(Lever.CutToFake)]
    public async Task AfterTheLever_NoAmbientPostIsPublished_WithinTheRealTickInterval(Lever lever)
    {
        await using var harness = await AmbientLoopHarness.CreateAsync(timeProvider: TimeProvider.System);
        harness.SetPolicy(AmbientPolicyMode.Autonomous, perMinute: 60, perHour: 1000);
        harness.Services.GetRequiredService<IReactionLoopRegistry>().Register(harness.Registration);

        var options = harness.Services.GetRequiredService<ReactionLoopHostOptions>();
        options.TickInterval.Should().Be(TimeSpan.FromSeconds(5), "the test runs at the real default cadence");

        var host = harness.Services.GetServices<IHostedService>().OfType<ReactionLoopHost>().Single();
        using var stop = new CancellationTokenSource();
        await host.StartAsync(stop.Token);
        try
        {
            await WaitUntilAsync(() => harness.Publisher.Published.Count > 0, TimeSpan.FromSeconds(15));

            var pulledAt = DateTimeOffset.UtcNow;
            switch (lever)
            {
                case Lever.FullStop:
                    harness.Autonomy.GetOrCreate(harness.ExerciseId).EngageKillSwitch(KillSwitchMode.FullStop, "lead-1", 0);
                    break;
                case Lever.DropToSuggest:
                    harness.Autonomy.GetOrCreate(harness.ExerciseId).EngageKillSwitch(KillSwitchMode.DropToSuggest, "lead-1", 0);
                    break;
                default:
                    harness.Cut.Cut(harness.ExerciseId);
                    break;
            }

            // More than one full tick interval, so at least one tick runs after the lever.
            await Task.Delay(TimeSpan.FromSeconds(7));

            // A post already handed to the funnel at the instant of the pull may complete (the documented residual),
            // so allow a sub-second race; anything a later tick published would land >= 5 s after the pull.
            harness.Publisher.PublishedAt.Should().OnlyContain(
                at => at <= pulledAt + TimeSpan.FromSeconds(1),
                "no ambient post may publish after the lever (AC6: well inside the 5 s bound)");
            harness.Ambient.Get(harness.ExerciseId).Mode.Should().Be(AmbientPolicyMode.Off);
        }
        finally
        {
            await host.StopAsync(CancellationToken.None);
        }
    }

    private static async Task WaitUntilAsync(Func<bool> condition, TimeSpan timeout)
    {
        var watch = Stopwatch.StartNew();
        while (!condition())
        {
            if (watch.Elapsed > timeout)
            {
                throw new TimeoutException("The reaction loop did not publish an ambient post in time.");
            }

            await Task.Delay(100);
        }
    }
}
