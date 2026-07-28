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
/// overlay store, and the two reader delegates.
///
/// <para>Proves: a Freeze writes the pause overlay AND pushes <c>OverlayStateChanged</c> to the OWNING exercise's
/// group only (never another's — the always-Critical property); a Resume clears it; the payload is the
/// participant projection with NO staff field on it; the authoritative tier — not a possibly-stale
/// <c>transition.To</c> — decides what participants see; a hub failure is swallowed so a freeze that already
/// stands is never undone (WR-004); and no telemetry is emitted (story 07's <c>steering_action</c> stays the
/// single audit record).</para>
///
/// <para><b>And (Gate-1 CR-001) that the overlay-precedence ruling gates this PUSH channel, not only the GET.</b>
/// Every suppressed cell asserts the hub received NOTHING — the mirror of the cross-exercise assertion — because a
/// green read-side suite proved nothing about the channel that reaches an already-connected tab with no refresh.
/// The gate is <see cref="SteeringOverlayPrecedence.PauseIsParticipantVisibleIn"/>, the SAME predicate
/// <see cref="SteeringPauseOverlayProjection"/> reads.</para>
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
        stored.Register.Should().Be("out-of-fiction", "the register the transition carried");

        harness.PushesTo($"exercise:{exerciseId}").Should().ContainSingle(
            "AC2: exactly one OverlayStateChanged push per transition, to the exercise's own group");
        harness.PushesTo($"exercise:{exerciseId}")[0].State.Should().Be("pause");
    }

    [Theory]
    [InlineData("in-fiction")]
    [InlineData("out-of-fiction")]
    public async Task PublishAsync_Freeze_UsesTheRegisterTheControllerSelected(string selected)
    {
        var exerciseId = Guid.NewGuid();
        var harness = new Harness(tier: PauseTier.Freeze);

        await harness.Publisher.PublishAsync(
            new PauseTierTransition(
                exerciseId, PauseTier.Running, PauseTier.Freeze, StaffActingHumanId, selected));

        harness.OverlayState.Get(exerciseId).Register.Should().Be(
            selected, "AC1/AC5: the participant sees the register the controller actually chose");
        harness.PushesTo($"exercise:{exerciseId}")[0].Register.Should().Be(selected);
    }

    [Fact]
    public async Task PublishAsync_Freeze_WithANonContractRegister_FallsBackToOutOfFiction()
    {
        // Last line of defence before a PARTICIPANT-visible value: a non-contract literal would be dropped by the
        // client's own guard, which would leave the Freeze invisible — the very bug this story fixes.
        var exerciseId = Guid.NewGuid();
        var harness = new Harness(tier: PauseTier.Freeze);

        await harness.Publisher.PublishAsync(
            new PauseTierTransition(
                exerciseId, PauseTier.Running, PauseTier.Freeze, StaffActingHumanId, "sideways"));

        harness.PushesTo($"exercise:{exerciseId}")[0].Register.Should().Be("out-of-fiction");
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
            new PauseTierTransition(
                Guid.Empty, PauseTier.Running, PauseTier.Freeze, StaffActingHumanId, "out-of-fiction"));

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
            new PauseTierTransition(
                exerciseId, PauseTier.Running, PauseTier.Freeze, "human-director-42", "out-of-fiction"));

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

    // ---- CR-001: the overlay-precedence ruling gates the PUSH channel too ----------------------
    //
    // The mirror of PublishAsync_TargetsOnlyTheOwningExercisesGroup_NeverAnothers: what matters in a suppressed
    // cell is that the hub received NOTHING. Gating only GET /api/overlay-state left this channel wide open — an
    // already-connected tab is never disconnected when an exercise ends, so a Freeze after EndEx pushed the
    // in-fiction holding page onto a permanently ended exercise with no refresh required.

    /// <summary>
    /// <b>ENDEX suppressed.</b> A Freeze in a <c>completed</c> exercise writes nothing and pushes nothing, so no
    /// connected participant can be shown "We'll be right back" over a permanently ended exercise (COR-054).
    /// </summary>
    [Fact]
    public async Task PublishAsync_FreezeAfterEndEx_WritesNothingAndPushesNothing()
    {
        var exerciseId = Guid.NewGuid();
        var harness = new Harness(tier: PauseTier.Freeze, lifecycleStatus: "completed");

        await harness.Publisher.PublishAsync(Transition(exerciseId, PauseTier.Running, PauseTier.Freeze));

        harness.GroupsPushed.Should().BeEmpty(
            "CR-001: nothing may be broadcast into a world that has reached EndEx — a tab joined to "
            + "exercise-{id} before the transition is never disconnected, so a push WOULD render the holding page "
            + "over a finished exercise with no refresh");
        harness.OverlayState.Get(exerciseId).State.Should().Be(
            "none",
            "and the store is left untouched, so the GET and the push cannot disagree about the same state on the "
            + "same screen — writing 'pause' and relying on the read gate would recreate that split");
    }

    /// <summary>
    /// <b>Pre-start suppressed.</b> Worse than ENDEX in one way: in <c>staged</c> participants are legitimately
    /// connected (<c>ParticipantAccessOpen = true</c>), so an ungated push reaches a live audience.
    /// </summary>
    [Theory]
    [InlineData("build")]
    [InlineData("staged")]
    public async Task PublishAsync_FreezeBeforeStartEx_WritesNothingAndPushesNothing(string preStartState)
    {
        var exerciseId = Guid.NewGuid();
        var harness = new Harness(tier: PauseTier.Freeze, lifecycleStatus: preStartState);

        await harness.Publisher.PublishAsync(Transition(exerciseId, PauseTier.Running, PauseTier.Freeze));

        harness.GroupsPushed.Should().BeEmpty(
            "pre-start outranks pause, and in 'staged' participants ARE connected — an ungated push would show a "
            + "holding page while that same tab's re-GET said 'none'");
        harness.OverlayState.Get(exerciseId).State.Should().Be("none");
    }

    /// <summary>
    /// A terminal <c>archived</c> world, and an UNRECOGNIZED / missing status, both fail closed — a typo in the
    /// <c>Status</c> column, or a deleted exercise row, can never broadcast a holding page.
    /// </summary>
    [Theory]
    [InlineData("archived")]
    [InlineData("sideways")]
    [InlineData(null)]
    public async Task PublishAsync_FreezeInATerminalOrUnreadableWorld_PushesNothing_FailingClosed(string? status)
    {
        var exerciseId = Guid.NewGuid();
        var harness = new Harness(tier: PauseTier.Freeze, lifecycleStatus: status!);

        await harness.Publisher.PublishAsync(Transition(exerciseId, PauseTier.Running, PauseTier.Freeze));

        harness.GroupsPushed.Should().BeEmpty(
            "an unknown state (and a missing exercise row, which reads null) is NOT a running world — the "
            + "fail-closed direction never invents a participant overlay");
    }

    /// <summary>
    /// The positive control for all of the above: the SAME publish in a RUNNING world does push, to that
    /// exercise's group alone, carrying the controller's selected register. Without this the suppression tests
    /// could all pass on a publisher that never pushed at all.
    /// </summary>
    [Fact]
    public async Task PublishAsync_FreezeInARunningWorld_StillPushesToThatExercisesGroup_WithTheSelectedRegister()
    {
        var exerciseId = Guid.NewGuid();
        var harness = new Harness(tier: PauseTier.Freeze, lifecycleStatus: "live");

        await harness.Publisher.PublishAsync(
            new PauseTierTransition(exerciseId, PauseTier.Running, PauseTier.Freeze, StaffActingHumanId, "in-fiction"));

        var pushes = harness.PushesTo($"exercise:{exerciseId}");
        pushes.Should().ContainSingle().Which.State.Should().Be(
            "pause", "a live world's Freeze IS participant-visible — this is the cell story 08 exists for");
        pushes[0].Register.Should().Be("in-fiction", "AC5: the controller's selection rides the push");
        harness.OverlayState.Get(exerciseId).State.Should().Be("pause");
    }

    /// <summary>
    /// <b>A CLEAR is never gated.</b> Deliberately asymmetric: a tab that received a legitimate Freeze push while
    /// the exercise was still running, and then saw it end, can ONLY be rescued by the clearing push — so Resume
    /// publishes in every lifecycle state, and does not even consult the lifecycle.
    /// </summary>
    [Theory]
    [InlineData("completed")]
    [InlineData("archived")]
    [InlineData("staged")]
    public async Task PublishAsync_ResumeIsNeverSuppressed_SoAStrandedHoldingPageCanAlwaysBeCleared(string status)
    {
        var exerciseId = Guid.NewGuid();
        var harness = new Harness(tier: PauseTier.Running, lifecycleStatus: status);

        await harness.Publisher.PublishAsync(Transition(exerciseId, PauseTier.Freeze, PauseTier.Running));

        harness.PushesTo($"exercise:{exerciseId}").Should().ContainSingle()
            .Which.State.Should().Be(
                "none",
                "suppressing a clear would STRAND a holding page on a tab that was legitimately frozen before the "
                + "lifecycle moved — the gate withholds only the ADDING of an overlay");
        harness.LifecycleReads.Should().Be(
            0, "and the clear path does not even read the lifecycle — there is no state in which it should not run");
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
        new(exerciseId, from, to, StaffActingHumanId, "out-of-fiction");

    /// <summary>
    /// The publisher under test wired over a recording <see cref="IHubContext{THub}"/> (which group each payload
    /// went to) plus a mutable authoritative-tier reader.
    /// </summary>
    private sealed class Harness
    {
        private readonly List<(string Group, object? Payload)> _sends = [];

        public Harness(PauseTier tier, bool hubThrows = false, string lifecycleStatus = "live")
        {
            Tier = tier;
            LifecycleStatus = lifecycleStatus;

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
                (exerciseId, cancellationToken) =>
                {
                    LifecycleReads++;
                    return Task.FromResult<string?>(LifecycleStatus);
                },
                NullLogger<PauseOverlayPublisher>.Instance);
        }

        public PauseTier Tier { get; set; }

        /// <summary>
        /// The exercise's COR-032 lifecycle state the publisher's precedence gate reads (CR-001). Defaults to
        /// <c>live</c> — a RUNNING world — so every pre-existing test in this suite keeps its original meaning.
        /// </summary>
        public string? LifecycleStatus { get; set; }

        /// <summary>How many times the lifecycle was consulted — proves a CLEAR is never gated on it.</summary>
        public int LifecycleReads { get; private set; }

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
