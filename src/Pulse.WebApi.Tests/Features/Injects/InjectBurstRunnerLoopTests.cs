namespace Pulse.WebApi.Tests.Features.Injects;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Injects;
using Xunit;

/// <summary>
/// The runner's LOOP — not its tick — in every host the app builds, including test hosts with no reachable database
/// (#458: the SignalR hub tests timed out on this branch only). The loop must do no database work while the host
/// starts, back off while sweeps keep failing, and log a repeated failure once. No SQL: the sweep's database is a
/// registration that counts resolutions and throws, exactly what an unreachable server looks like to the loop.
/// </summary>
public sealed class InjectBurstRunnerLoopTests
{
    private static readonly InjectBurstRunnerOptions Defaults = new();

    [Fact]
    public void NextDelay_IsTheActiveCadenceWhileFiring_AndASleepUntilWokenOtherwise()
    {
        InjectBurstRunner.NextDelay(firing: 2, consecutiveFailures: 0, Defaults).Should().Be(TimeSpan.FromSeconds(1));
        InjectBurstRunner.NextDelay(firing: 0, consecutiveFailures: 0, Defaults).Should().Be(
            Timeout.InfiniteTimeSpan,
            "an idle runner must not poll: a 5 s idle sweep alone kept the serverless database from ever auto-pausing, "
            + "and every path into Firing wakes the runner");
    }

    [Fact]
    public async Task TheLoop_AfterASweepThatFindsNothingFiring_DoesNoMoreDatabaseWorkUntilWoken()
    {
        var harness = new LoopHarness(
            new InjectBurstRunnerOptions
            {
                ActiveInterval = TimeSpan.FromMilliseconds(20),
                IdleInterval = TimeSpan.FromMilliseconds(20),
                MaxFailureBackoff = TimeSpan.FromMilliseconds(20),
            },
            emptyDatabase: true);

        await harness.Runner.StartAsync(CancellationToken.None);
        try
        {
            (await harness.WaitForSweepsAsync(1, TimeSpan.FromSeconds(10))).Should().BeTrue("the first sweep runs one idle interval after start");
            await Task.Delay(TimeSpan.FromMilliseconds(400));
            harness.Sweeps.Should().Be(1, "with nothing firing the runner sleeps instead of re-sweeping every idle interval");

            harness.Signal.Wake(); // a controller's Fire
            (await harness.WaitForSweepsAsync(2, TimeSpan.FromSeconds(10))).Should().BeTrue("a wake-up starts a sweep at once");
        }
        finally
        {
            await harness.Runner.StopAsync(CancellationToken.None);
        }
    }

    [Fact]
    public void NextDelay_DoublesFromTheIdleCadencePerFailedSweep_UpToTheCap()
    {
        Enumerable.Range(1, 7)
            .Select(failures => InjectBurstRunner.NextDelay(firing: 0, failures, Defaults).TotalSeconds)
            .Should().Equal([5, 10, 20, 40, 60, 60, 60], "idle, 2x, 4x, 8x, then the 60 s cap");
        InjectBurstRunner.NextDelay(firing: 0, consecutiveFailures: 10_000, Defaults)
            .Should().Be(TimeSpan.FromSeconds(60), "no overflow, however long the outage");
    }

    [Fact]
    public void NextDelay_AfterAFailure_IsNeverShorterThanTheIdleCadence_EvenWithACapBelowIt()
    {
        var odd = new InjectBurstRunnerOptions { IdleInterval = TimeSpan.FromSeconds(5), MaxFailureBackoff = TimeSpan.FromSeconds(1) };

        InjectBurstRunner.NextDelay(firing: 3, consecutiveFailures: 1, odd).Should().Be(
            TimeSpan.FromSeconds(5), "a failing sweep never retries faster than idle, whatever the cap or the last firing count");
    }

    [Fact]
    public async Task TheLoop_DoesNoDatabaseWorkWhileTheHostStarts_AndFirstSweepsOnAWakeUp()
    {
        var harness = new LoopHarness(new InjectBurstRunnerOptions
        {
            ActiveInterval = TimeSpan.FromSeconds(1),
            IdleInterval = TimeSpan.FromMinutes(10),
            MaxFailureBackoff = TimeSpan.FromMinutes(10),
        });

        await harness.Runner.StartAsync(CancellationToken.None);
        try
        {
            await Task.Delay(TimeSpan.FromMilliseconds(400));
            harness.Sweeps.Should().Be(0, "start-up does no database work: the first sweep waits the idle interval or a wake-up");

            harness.Signal.Wake(); // a controller's Fire
            (await harness.WaitForSweepsAsync(1, TimeSpan.FromSeconds(10))).Should().BeTrue("a wake-up starts a sweep at once");
        }
        finally
        {
            await harness.Runner.StopAsync(CancellationToken.None);
        }
    }

    [Fact]
    public async Task TheLoop_BacksOffWhileSweepsKeepFailing_AndLogsTheRepeatedFailureOnce()
    {
        // Without backoff a 40 ms idle cadence would sweep ~30 times in 1.2 s; doubling to a 320 ms cap allows ~6.
        var harness = new LoopHarness(new InjectBurstRunnerOptions
        {
            ActiveInterval = TimeSpan.FromMilliseconds(40),
            IdleInterval = TimeSpan.FromMilliseconds(40),
            MaxFailureBackoff = TimeSpan.FromMilliseconds(320),
        });

        await harness.Runner.StartAsync(CancellationToken.None);
        try
        {
            await Task.Delay(TimeSpan.FromMilliseconds(1200));
        }
        finally
        {
            await harness.Runner.StopAsync(CancellationToken.None);
        }

        harness.Sweeps.Should().BeInRange(2, 12, "each failed sweep doubles the wait (40, 80, 160, 320 ms...) instead of retrying at the idle cadence");
        harness.Logger.Entries.Count(entry => entry.EventId == 1).Should().Be(
            1, "the same failure, repeated, is logged once — not once per sweep");
        harness.Logger.Entries.Single(entry => entry.EventId == 1).Level.Should().Be(LogLevel.Warning);
    }

    /// <summary>
    /// A runner over a "database" that counts every sweep's resolution and either throws as an unreachable server would,
    /// or (<c>emptyDatabase</c>) answers with an empty in-memory store — nothing firing.
    /// </summary>
    private sealed class LoopHarness
    {
        private int _sweeps;

        public LoopHarness(InjectBurstRunnerOptions options, bool emptyDatabase = false)
        {
            var services = new ServiceCollection();
            var databaseName = Guid.NewGuid().ToString();
            services.AddScoped<PulseDbContext>(_ =>
            {
                Interlocked.Increment(ref _sweeps);
                if (emptyDatabase)
                {
                    return new PulseDbContext(new DbContextOptionsBuilder<PulseDbContext>().UseInMemoryDatabase(databaseName).Options);
                }

                throw new InvalidOperationException("A network-related error occurred: the server was not found.");
            });
            var scopeFactory = services.BuildServiceProvider().GetRequiredService<IServiceScopeFactory>();

            Signal = new InjectRunnerSignal();
            Logger = new ListLogger<InjectBurstRunner>();
            Runner = new InjectBurstRunner(
                scopeFactory,
                new PauseTierRegistry(new ExerciseClockService(TimeProvider.System), new NullPauseOverlayPublisher(), NullLogger<PauseTierRegistry>.Instance),
                TimeProvider.System,
                Signal,
                options,
                Logger);
        }

        public InjectBurstRunner Runner { get; }

        public InjectRunnerSignal Signal { get; }

        public ListLogger<InjectBurstRunner> Logger { get; }

        public int Sweeps => Volatile.Read(ref _sweeps);

        public async Task<bool> WaitForSweepsAsync(int atLeast, TimeSpan within)
        {
            var deadline = DateTime.UtcNow + within;
            while (DateTime.UtcNow < deadline)
            {
                if (Sweeps >= atLeast)
                {
                    return true;
                }

                await Task.Delay(TimeSpan.FromMilliseconds(20));
            }

            return Sweeps >= atLeast;
        }
    }

    /// <summary>Captures every log entry (level and event id) a component writes.</summary>
    private sealed class ListLogger<T> : ILogger<T>
    {
        private readonly List<(LogLevel Level, int EventId)> _entries = [];
        private readonly Lock _gate = new();

        public IReadOnlyList<(LogLevel Level, int EventId)> Entries
        {
            get
            {
                lock (_gate)
                {
                    return _entries.ToList();
                }
            }
        }

        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            lock (_gate)
            {
                _entries.Add((logLevel, eventId.Id));
            }
        }
    }
}
