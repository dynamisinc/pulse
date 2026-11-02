namespace Pulse.WebApi.Tests.Features.Channels.Scheduling;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Channels.Content.Scheduling;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Xunit;

/// <summary>
/// The scheduler's LOOP — not its tick — with the <c>InjectBurstRunnerLoopTests</c> guarantees (story 05): no database
/// work while the host starts, a failing sweep backs off, and a repeated failure is logged once. No SQL: the sweep's
/// database is a registration that counts resolutions and throws, exactly what an unreachable server looks like.
/// </summary>
public sealed class ContentScheduleRunnerLoopTests
{
    [Fact]
    public void NextDelay_IsTheInterval_AndDoublesPerFailedSweep_UpToTheCap()
    {
        var defaults = new ContentScheduleRunnerOptions();

        ContentScheduleRunner.NextDelay(0, defaults).Should().Be(TimeSpan.FromSeconds(5));
        Enumerable.Range(1, 7)
            .Select(failures => ContentScheduleRunner.NextDelay(failures, defaults).TotalSeconds)
            .Should().Equal([5, 10, 20, 40, 60, 60, 60], "interval, 2x, 4x, 8x, then the 60 s cap");
        ContentScheduleRunner.NextDelay(10_000, defaults).Should().Be(TimeSpan.FromSeconds(60), "no overflow");
        ContentScheduleRunner.NextDelay(3, new ContentScheduleRunnerOptions { MaxFailureBackoff = TimeSpan.FromSeconds(1) })
            .Should().Be(TimeSpan.FromSeconds(5), "a failing sweep never retries faster than the interval");
    }

    [Fact]
    public async Task TheLoop_DoesNoDatabaseWorkWhileTheHostStarts_AndFirstSweepsOnAClockChange()
    {
        var harness = new LoopHarness(new ContentScheduleRunnerOptions
        {
            Interval = TimeSpan.FromMinutes(10),
            MaxFailureBackoff = TimeSpan.FromMinutes(10),
        });

        await harness.Runner.StartAsync(CancellationToken.None);
        try
        {
            await Task.Delay(TimeSpan.FromMilliseconds(400));
            harness.Sweeps.Should().Be(0, "start-up does no database work: the first sweep waits the interval or a wake-up");

            new ContentScheduleClockObserver(harness.Signal).ClockChanged(Guid.NewGuid()); // a controller's jump
            (await harness.WaitForSweepsAsync(1, TimeSpan.FromSeconds(10))).Should().BeTrue("a clock change starts a sweep at once");
        }
        finally
        {
            await harness.Runner.StopAsync(CancellationToken.None);
        }
    }

    [Fact]
    public async Task TheLoop_BacksOffWhileSweepsKeepFailing_AndLogsTheRepeatedFailureOnce()
    {
        // Without backoff a 40 ms cadence would sweep ~30 times in 1.2 s; doubling to a 320 ms cap allows ~6.
        var harness = new LoopHarness(new ContentScheduleRunnerOptions
        {
            Interval = TimeSpan.FromMilliseconds(40),
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

        harness.Sweeps.Should().BeInRange(2, 12, "each failed sweep doubles the wait instead of retrying at the interval");
        harness.Logger.Entries.Count(entry => entry.EventId == 1).Should().Be(1, "the same failure, repeated, is logged once");
        harness.Logger.Entries.Single(entry => entry.EventId == 1).Level.Should().Be(LogLevel.Warning);
    }

    /// <summary>A runner over a "database" that counts every sweep's resolution and throws as an unreachable server would.</summary>
    private sealed class LoopHarness
    {
        private int _sweeps;

        public LoopHarness(ContentScheduleRunnerOptions options)
        {
            var services = new ServiceCollection();
            services.AddScoped<PulseDbContext>(_ =>
            {
                Interlocked.Increment(ref _sweeps);
                throw new InvalidOperationException("A network-related error occurred: the server was not found.");
            });
            var scopeFactory = services.BuildServiceProvider().GetRequiredService<IServiceScopeFactory>();
            var clock = new ExerciseClockService(TimeProvider.System);
            Runner = new ContentScheduleRunner(
                scopeFactory,
                new PauseTierRegistry(clock, new NullPauseOverlayPublisher(), NullLogger<PauseTierRegistry>.Instance),
                clock,
                TimeProvider.System,
                Signal,
                options,
                Logger);
        }

        public ContentScheduleRunner Runner { get; }

        public ContentScheduleSignal Signal { get; } = new();

        public ListLogger Logger { get; } = new();

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

    /// <summary>Captures every log entry (level and event id) the runner writes.</summary>
    private sealed class ListLogger : ILogger<ContentScheduleRunner>
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
