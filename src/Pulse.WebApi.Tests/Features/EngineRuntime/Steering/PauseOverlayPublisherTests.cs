namespace Pulse.WebApi.Tests.Features.EngineRuntime.Steering;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Realtime;
using Xunit;

/// <summary>
/// Unit tests for the REAL <see cref="IPauseOverlayPublisher"/> (world-steering/08; CTL-023, COR-001, XC-001,
/// XC-002, XC-004). Docker-free (<see cref="FactAttribute"/>): the only collaborators are
/// <see cref="IHubContext{THub}"/> (mocked, exactly as <c>EngineReviewBroadcasterTests</c> does), the in-memory
/// overlay store, and the tier-reader delegate.
///
/// <para>Proves: a Freeze writes the pause overlay AND pushes <c>OverlayStateChanged</c> to the OWNING exercise's
/// group only (never another's — the always-Critical property); a Resume clears it; the payload is the
/// participant projection with NO staff field on it; the authoritative tier — not a possibly-stale
/// <c>transition.To</c> — decides what participants see; a hub failure is swallowed so a freeze that already
/// stands is never undone (WR-004); and no telemetry is emitted (story 07's <c>steering_action</c> stays the
/// single audit record).</para>
/// </summary>
public sealed class PauseOverlayPublisherTests
{
    private const string StaffActingHumanId = "human-controller-01";

    [Fact]
    public async Task PublishAsync_Freeze_WritesThePauseOverlay_AndPushesToTheExercisesGroup()
    {
        var exerciseId = Guid.NewGuid();
        var harness = new Harness(tier: PauseTier.Freeze);

        await harness.Publisher.PublishAsync(Transition(exerciseId, PauseTier.Running, PauseTier.Freeze));

        var stored = harness.OverlayState.Get(exerciseId);
        stored.State.Should().Be("pause", "AC1: a Freeze must make GET /api/overlay-state report the holding page");
        stored.Register.Should().Be(
            "out-of-fiction",
            "the console's own default overlayRegister selection — see PauseOverlayPublisher.FreezeRegister for the documented wire gap");

        harness.PushesTo($"exercise:{exerciseId}").Should().ContainSingle(
            "AC2: exactly one OverlayStateChanged push per transition, to the exercise's own group");
        harness.PushesTo($"exercise:{exerciseId}")[0].State.Should().Be("pause");
    }

    [Fact]
    public async Task PublishAsync_Resume_ClearsTheOverlay_AndPushesTheClearedState()
    {
        var exerciseId = Guid.NewGuid();
        var harness = new Harness(tier: PauseTier.Freeze);
        await harness.Publisher.PublishAsync(Transition(exerciseId, PauseTier.Running, PauseTier.Freeze));

        harness.Tier = PauseTier.Running;
        await harness.Publisher.PublishAsync(Transition(exerciseId, PauseTier.Freeze, PauseTier.Running));

        harness.OverlayState.Get(exerciseId).State.Should().Be(
            "none", "AC3: Resume reverts the store to the cleared state — OverlayLayer renders null for 'none'");
        harness.OverlayState.Get(exerciseId).Register.Should().Be("in-fiction");

        var pushes = harness.PushesTo($"exercise:{exerciseId}");
        pushes.Should().HaveCount(2);
        pushes[1].State.Should().Be("none", "the push clears the rendered holding page with no manual refresh");
    }

    [Fact]
    public async Task PublishAsync_NonFreezeTiers_LeaveTheParticipantOverlayCleared()
    {
        // Only WORLD FROZEN is participant-visible: INJECTS PAUSED / ENGINE PAUSED are staff-side halts, and a
        // participant must never be shown a holding page for them.
        var exerciseId = Guid.NewGuid();
        var harness = new Harness(tier: PauseTier.Engine);

        await harness.Publisher.PublishAsync(Transition(exerciseId, PauseTier.Running, PauseTier.Engine));

        harness.OverlayState.Get(exerciseId).State.Should().Be("none");
    }

    // ---- AC6: isolation (COR-001/XC-001, always-Critical) --------------------------------------

    [Fact]
    public async Task PublishAsync_TargetsOnlyTheOwningExercisesGroup_NeverAnothers()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var harness = new Harness(tier: PauseTier.Freeze);

        await harness.Publisher.PublishAsync(Transition(exerciseA, PauseTier.Running, PauseTier.Freeze));

        harness.PushesTo($"exercise:{exerciseA}").Should().ContainSingle();
        harness.PushesTo($"exercise:{exerciseB}").Should().BeEmpty(
            "a participant session in exercise B must never receive exercise A's Freeze push (COR-001)");
        harness.OverlayState.Get(exerciseB).State.Should().Be(
            "none", "nor may B's overlay state be written by A's Freeze");
    }

    [Fact]
    public async Task PublishAsync_DerivesTheGroupName_ExactlyAsTheHubJoinsIt()
    {
        var exerciseId = Guid.NewGuid();
        var harness = new Harness(tier: PauseTier.Freeze);

        await harness.Publisher.PublishAsync(Transition(exerciseId, PauseTier.Running, PauseTier.Freeze));

        harness.GroupsPushed.Should().Equal(
            [$"exercise:{exerciseId}"],
            "the broadcast side must reuse ExerciseRealtimeHub.GroupNameFor — the same derivation OnConnectedAsync "
            + "uses to place a connection, so the join and broadcast sides can never drift (PR #347)");
    }

    [Fact]
    public async Task PublishAsync_EmptyExerciseId_WritesNothing_AndPushesNothing()
    {
        var harness = new Harness(tier: PauseTier.Freeze);

        await harness.Publisher.PublishAsync(
            new PauseTierTransition(Guid.Empty, PauseTier.Running, PauseTier.Freeze, StaffActingHumanId));

        harness.GroupsPushed.Should().BeEmpty(
            "fail closed: an unscoped transition must never fan out to an ambient/empty exercise group");
        harness.OverlayState.Get(Guid.Empty).State.Should().Be("none");
    }

    // ---- XC-002: the participant payload carries no staff field --------------------------------

    [Fact]
    public async Task PublishAsync_PayloadIsTheParticipantProjection_WithNoStaffFieldAtAll()
    {
        var exerciseId = Guid.NewGuid();
        var harness = new Harness(tier: PauseTier.Freeze);

        await harness.Publisher.PublishAsync(
            new PauseTierTransition(exerciseId, PauseTier.Running, PauseTier.Freeze, "human-director-42"));

        var payload = harness.RawPayloads.Should().ContainSingle().Subject;
        payload.Should().BeOfType<ParticipantOverlayStateDto>();

        var json = JsonSerializer.Serialize(payload);
        using var document = JsonDocument.Parse(json);
        document.RootElement.EnumerateObject().Select(property => property.Name).Should().BeEquivalentTo(
            ["state", "register", "message", "sequence"],
            "the participant wire shape is the frozen OverlayState triple plus the ordering sequence — nothing else");

        json.Should().NotContain(
            "human-director-42",
            "XC-002/COR-018: a participant must never learn WHICH controller paused the exercise");
        json.Should().NotContain("actingHumanId");
        json.Should().NotContain("tier", "the staff PauseTier vocabulary (WORLD FROZEN) never crosses into the fiction");
    }

    [Fact]
    public void ParticipantOverlayStateDto_ExposesNoStaffProperty()
    {
        var propertyNames = typeof(ParticipantOverlayStateDto)
            .GetProperties()
            .Select(property => property.Name);

        propertyNames.Should().BeEquivalentTo(
            ["State", "Register", "Message", "Sequence"],
            "a future maintainer must not be able to leak provenance/attribution through this projection — it is "
            + "built ONLY from OverlayStateSnapshot, which has no staff field to project");
    }

    // ---- the out-of-order strategy: trust the registry, not transition.To ----------------------

    [Fact]
    public async Task PublishAsync_ReadsTheAuthoritativeTier_NotTheTransitionsPossiblyStaleTarget()
    {
        // The registry publishes OUTSIDE its lock, so a Freeze's publish can run AFTER a Resume has already been
        // recorded. The stale transition says "freeze"; the authoritative tier says RUNNING — participants must
        // see the truth (and the store's sequence guard then keeps the older write from winning).
        var exerciseId = Guid.NewGuid();
        var harness = new Harness(tier: PauseTier.Running);

        await harness.Publisher.PublishAsync(Transition(exerciseId, PauseTier.Running, PauseTier.Freeze));

        harness.OverlayState.Get(exerciseId).State.Should().Be(
            "none",
            "a stale transition.To must never strand a holding page on a world the controller has already resumed");
        harness.PushesTo($"exercise:{exerciseId}")[0].State.Should().Be("none");
    }

    [Fact]
    public async Task PublishAsync_BroadcastsTheStoresCurrentState_NotTheStateItTriedToWrite()
    {
        // A publish whose write LOST to a newer one must broadcast the newer state, so the push stream converges
        // no matter which order two rapid transitions reach the hub.
        var exerciseId = Guid.NewGuid();
        var harness = new Harness(tier: PauseTier.Freeze);

        // Simulate a newer write (a Resume) that already landed with a higher ticket than this publish will take.
        harness.OverlayState.Apply(exerciseId, "none", "in-fiction", sequence: 1_000);

        await harness.Publisher.PublishAsync(Transition(exerciseId, PauseTier.Running, PauseTier.Freeze));

        harness.PushesTo($"exercise:{exerciseId}")[0].State.Should().Be(
            "none", "the pushed payload is the store's post-write snapshot, so a losing write never pushes stale state");
        harness.OverlayState.Get(exerciseId).State.Should().Be("none");
    }

    // ---- WR-004: a broken push can never undo an applied freeze ---------------------------------

    [Fact]
    public async Task PublishAsync_WhenTheHubThrows_SwallowsTheFailure_SoTheFreezeStands()
    {
        var exerciseId = Guid.NewGuid();
        var harness = new Harness(tier: PauseTier.Freeze, hubThrows: true);

        var act = async () => await harness.Publisher.PublishAsync(
            Transition(exerciseId, PauseTier.Running, PauseTier.Freeze));

        await act.Should().NotThrowAsync(
            "the interface documents that implementations swallow their own transport failures — a 500 here would "
            + "make the console revert to RUNNING over a world whose clock is genuinely frozen");
        harness.OverlayState.Get(exerciseId).State.Should().Be(
            "pause", "the store is written BEFORE the push, so a reconnecting participant still recovers the truth");
    }

    [Fact]
    public async Task PublishAsync_NullTransition_Throws()
    {
        var harness = new Harness(tier: PauseTier.Freeze);

        var act = async () => await harness.Publisher.PublishAsync(null!);

        await act.Should().ThrowAsync<ArgumentNullException>();
    }

    // ---- AC7 (XC-004): no competing/duplicate telemetry from the overlay write path ------------

    [Fact]
    public void PauseOverlayWritePath_TakesNoTelemetryOrPersistenceDependency()
    {
        var dependencies = typeof(PauseOverlayPublisher).GetConstructors()
            .SelectMany(constructor => constructor.GetParameters())
            .Select(parameter => parameter.ParameterType.Name)
            .Concat(typeof(OverlayStateService).GetConstructors()
                .SelectMany(constructor => constructor.GetParameters())
                .Select(parameter => parameter.ParameterType.Name))
            .ToList();

        dependencies.Should().NotContain(
            name => name.Contains("Telemetry", StringComparison.Ordinal),
            "AC7: the tier-change steering_action (story 03/07, console-side) is the ONE event per transition — the "
            + "overlay write path must emit no competing/duplicate event");
        dependencies.Should().NotContain(
            name => name.Contains("DbContext", StringComparison.Ordinal),
            "there is no unit of work here at all, so no event could be persisted alongside a mutation");
    }

    private static PauseTierTransition Transition(Guid exerciseId, PauseTier from, PauseTier to) =>
        new(exerciseId, from, to, StaffActingHumanId);

    /// <summary>
    /// The publisher under test wired over a recording <see cref="IHubContext{THub}"/> (which group each payload
    /// went to) plus a mutable authoritative-tier reader.
    /// </summary>
    private sealed class Harness
    {
        private readonly List<(string Group, object? Payload)> _sends = [];

        public Harness(PauseTier tier, bool hubThrows = false)
        {
            Tier = tier;

            var clients = new Mock<IHubClients>();
            clients.Setup(hubClients => hubClients.Group(It.IsAny<string>())).Returns((string group) =>
            {
                var proxy = new Mock<IClientProxy>();
                proxy
                    .Setup(clientProxy => clientProxy.SendCoreAsync(
                        It.IsAny<string>(), It.IsAny<object?[]>(), It.IsAny<CancellationToken>()))
                    .Returns((string method, object?[] args, CancellationToken _) =>
                    {
                        if (hubThrows)
                        {
                            throw new InvalidOperationException("SignalR fan-out failed");
                        }

                        method.Should().Be(
                            "OverlayStateChanged",
                            "the frozen client event name the participant shell's live overlayState branch subscribes to");
                        _sends.Add((group, args.Length == 1 ? args[0] : null));
                        return Task.CompletedTask;
                    });
                return proxy.Object;
            });

            var hubContext = new Mock<IHubContext<ExerciseRealtimeHub>>();
            hubContext.SetupGet(context => context.Clients).Returns(clients.Object);

            OverlayState = new OverlayStateService();
            Publisher = new PauseOverlayPublisher(
                hubContext.Object,
                OverlayState,
                exerciseId => Tier,
                NullLogger<PauseOverlayPublisher>.Instance);
        }

        public PauseTier Tier { get; set; }

        public OverlayStateService OverlayState { get; }

        public PauseOverlayPublisher Publisher { get; }

        public IReadOnlyList<string> GroupsPushed => _sends.Select(send => send.Group).ToList();

        public IReadOnlyList<object?> RawPayloads => _sends.Select(send => send.Payload).ToList();

        public IReadOnlyList<ParticipantOverlayStateDto> PushesTo(string group) => _sends
            .Where(send => send.Group == group)
            .Select(send => (ParticipantOverlayStateDto)send.Payload!)
            .ToList();
    }
}
