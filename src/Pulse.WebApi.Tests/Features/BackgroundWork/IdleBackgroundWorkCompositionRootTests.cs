namespace Pulse.WebApi.Tests.Features.BackgroundWork;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Pulse.WebApi.Features.BackgroundWork;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Review;
using Pulse.WebApi.Features.Injects;
using Pulse.WebApi.Features.WhiteNoise;
using Xunit;

/// <summary>
/// Composition-root guard for the idle sleeps (plain <see cref="FactAttribute"/>, no Docker): boots the REAL
/// <c>Program</c> host with no test overrides and proves that, for each sleeping service, the producers that wake it,
/// the hosted service that sleeps, the clock and the safety sweep all hold the SAME signal instance. A sleeper whose
/// producers poke a different (or no) instance looks exactly like a correctly idle one — and then never wakes: the
/// "built, tested, green, wired to nothing" defect class. The unit tests pass their signals in by hand, so only this
/// file sees the real wiring.
/// </summary>
/// <remarks>
/// The checks read private fields by name. That is deliberate for a wiring guard: renaming a field fails this test
/// loudly, which is the point — the guard must be updated with the wiring, never silently skipped. Waking the running
/// host's signals and watching would race the hosted services themselves (they consume the wake), so identity is
/// checked instead. The host only needs to BUILD, so it gets a dummy, never-connecting connection string.
/// </remarks>
public sealed class IdleBackgroundWorkCompositionRootTests
{
    [Fact]
    public void ProgramCs_TheReviewTick_ItsProducers_TheClockAndTheSafetySweep_ShareOneSignal()
    {
        using var factory = new WiringProbeFactory();
        var signal = factory.Services.GetRequiredService<EngineReviewTickSignal>();

        Field(Hosted<EngineReviewTickHost>(factory), "_signal").Should().BeSameAs(signal, "the sleeping tick waits on it");

        using var scope = factory.Services.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<IEngineReviewStore>();
        store.Should().BeOfType<EngineReviewStore>();
        Field(store, "_tickSignal").Should().BeSameAs(signal, "every new countdown from the reaction loop is enqueued through the store");
        Field(scope.ServiceProvider.GetRequiredService<EngineReviewService>(), "_tickSignal").Should().BeSameAs(
            signal, "a re-roll that restarts a countdown must wake the tick (the parameter is optional, so only this proves DI supplies it)");

        ClockObserverSignals(factory).Should().Contain(signal, "a clock that starts or unfreezes can make a countdown progress");
        SweepSignals(factory).Should().Contain(signal);
    }

    [Fact]
    public void ProgramCs_TheNoisePacer_ItsProducers_TheClockAndTheSafetySweep_ShareOneSignal()
    {
        using var factory = new WiringProbeFactory();
        var signal = factory.Services.GetRequiredService<WhiteNoisePacerSignal>();

        Field(Hosted<WhiteNoisePacer>(factory), "_signal").Should().BeSameAs(signal);

        using var scope = factory.Services.CreateScope();
        Field(scope.ServiceProvider.GetRequiredService<WhiteNoiseService>(), "_pacerSignal").Should().BeSameAs(
            signal, "level and pool changes must wake the pacer");

        ClockObserverSignals(factory).Should().Contain(signal, "leaving Freeze unfreezes the clock, which must wake the pacer");
        SweepSignals(factory).Should().Contain(signal);
    }

    [Fact]
    public void ProgramCs_TheBurstRunner_ItsProducers_AndTheSafetySweep_ShareOneSignal()
    {
        using var factory = new WiringProbeFactory();
        var signal = factory.Services.GetRequiredService<InjectRunnerSignal>();

        Field(Hosted<InjectBurstRunner>(factory), "_signal").Should().BeSameAs(signal);

        using var scope = factory.Services.CreateScope();
        Field(scope.ServiceProvider.GetRequiredService<InjectQueueService>(), "_runnerSignal").Should().BeSameAs(
            signal, "Fire, Retry and Release must wake the runner");

        SweepSignals(factory).Should().Contain(signal);
    }

    [Fact]
    public void ProgramCs_RunsExactlyOneSafetySweep()
    {
        using var factory = new WiringProbeFactory();

        factory.Services.GetServices<IHostedService>().OfType<BackgroundWorkSafetySweep>().Should().ContainSingle(
            "one coordinated sweep wakes every sleeper together, so the database is woken once per interval");
    }

    private static T Hosted<T>(WiringProbeFactory factory)
        where T : IHostedService =>
        factory.Services.GetServices<IHostedService>().OfType<T>().Should().ContainSingle().Which;

    private static IEnumerable<WakeSignal> SweepSignals(WiringProbeFactory factory) =>
        ((IEnumerable<WakeSignal>)Field(Hosted<BackgroundWorkSafetySweep>(factory), "_signals")!).ToList();

    private static IEnumerable<WakeSignal> ClockObserverSignals(WiringProbeFactory factory)
    {
        var clock = factory.Services.GetRequiredService<IExerciseClock>();
        clock.Should().BeOfType<ExerciseClockService>();
        var observers = (IEnumerable<IExerciseClockChangeObserver>)Field(clock, "_observers")!;
        return observers.OfType<WakeOnClockChange>().Select(observer => (WakeSignal)Field(observer, "_signal")!).ToList();
    }

    private static object? Field(object target, string name)
    {
        var field = target.GetType().GetField(name, BindingFlags.NonPublic | BindingFlags.Instance);
        field.Should().NotBeNull($"{target.GetType().Name} must keep its '{name}' field (or this wiring guard must be updated with it)");
        return field!.GetValue(target);
    }

    private sealed class WiringProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";
        private const string DummyConnectionString =
            "Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;";

        public WiringProbeFactory()
        {
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, DummyConnectionString);
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}
