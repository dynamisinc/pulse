namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Publishing;
using Pulse.WebApi.Features.EngineRuntime.Review;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// The SAFETY-CRITICAL service suite for story 02 (E8 §8.2). Against a REAL SQL Server (Testcontainers) it
/// proves the wire between the frozen review queue and the built autonomy/safety domain: the queue
/// projection, the terminal actions (publish through story 01's mocked <see cref="IEnginePublishService"/>
/// seam), the exactly-one <c>engine.reviewed</c> per DECISION (XC-004, same unit of work), COR-001 isolation,
/// and — the release gate — the auto-HOLD invariants: silence NEVER auto-sends; swamped mode is the ONLY
/// auto-send path; a kill switch / degraded clamp suspends in-flight countdowns (HOLD, never send). Each
/// safety test proves the NEGATIVE (nothing published). Every test is <see cref="RequiresDockerFactAttribute"/>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class EngineReviewServiceTests
{
    private static readonly DateTimeOffset ScenarioStart = new(2033, 6, 14, 9, 0, 0, TimeSpan.Zero);

    private readonly MsSqlContainerFixture _fixture;

    public EngineReviewServiceTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // ---- Queue projection + isolation -----------------------------------------------------------

    [RequiresDockerFact]
    public async Task GetQueue_ServesQueuedCountingDownHeld_ExcludingResolved()
    {
        var exerciseId = Guid.NewGuid();
        var queued = Guid.NewGuid();
        var counting = Guid.NewGuid();
        var held = Guid.NewGuid();
        var published = Guid.NewGuid();
        var vetoed = Guid.NewGuid();

        await SeedAsync(
            Suggest(queued, exerciseId, DraftDisposition.Queued),
            DelayedAuto(counting, exerciseId, DraftDisposition.CountingDown),
            DelayedAuto(held, exerciseId, DraftDisposition.Held),
            Suggest(published, exerciseId, DraftDisposition.Published),
            DelayedAuto(vetoed, exerciseId, DraftDisposition.Vetoed));

        await using var harness = Build(exerciseId);
        var result = await harness.Service.GetQueueAsync();

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        result.Items.Select(i => i.DraftId).Should().BeEquivalentTo(
            new[] { queued.ToString(), counting.ToString(), held.ToString() },
            "the served QUEUE is queued Suggest + counting-down Delayed-auto + auto-HELD; resolved (published/vetoed) items are excluded");
    }

    [RequiresDockerFact]
    public async Task GetQueue_InExerciseA_NeverSeesExerciseB()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var draftA = Guid.NewGuid();
        var draftB = Guid.NewGuid();

        await SeedAsync(Suggest(draftA, exerciseA, DraftDisposition.Queued), Suggest(draftB, exerciseB, DraftDisposition.Queued));

        await using var harness = Build(exerciseA);
        var result = await harness.Service.GetQueueAsync();

        result.Items.Should().ContainSingle().Which.DraftId.Should().Be(
            draftA.ToString(), "a queue read in exercise A must never surface exercise B's review item (COR-001)");
    }

    [RequiresDockerFact]
    public async Task GetQueue_UnresolvedScope_FailsClosed()
    {
        var exerciseId = Guid.NewGuid();
        await SeedAsync(Suggest(Guid.NewGuid(), exerciseId, DraftDisposition.Queued));

        // No scope resolved (per-request population is Phase B2) → fail closed, never all exercises.
        await using var harness = Build(currentExerciseId: null);
        var result = await harness.Service.GetQueueAsync();

        result.Outcome.Should().Be(EngineReviewOutcome.ScopeUnresolved);
        result.Items.Should().BeEmpty();
    }

    // ---- Terminal actions + telemetry -----------------------------------------------------------

    [RequiresDockerFact]
    public async Task Approve_PublishesThroughSeam_MarksPublished_EmitsExactlyOneReviewed()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await SeedAsync(DelayedAuto(draftId, exerciseId, DraftDisposition.CountingDown));

        await using var harness = Build(exerciseId);
        var result = await harness.Service.ApproveAsync(draftId, Input("controller-7"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        harness.PublishedBursts.Should().ContainSingle("approve publishes through story 01's single funnel, one decision per burst");
        harness.PublishedBursts[0].DraftId.Should().Be(draftId);
        harness.PublishedBursts[0].ExerciseId.Should().Be(exerciseId);

        await AssertDispositionAsync(draftId, DraftDisposition.Published);
        var reviewed = await ReadReviewedEventsAsync(draftId);
        reviewed.Should().ContainSingle("exactly one engine.reviewed per DECISION");
        PayloadAction(reviewed[0]).Should().Be("approve");
        reviewed[0].Actor.ActingHumanId.Should().Be("controller-7", "COR-018: the human behind the shared controller account is captured");
        reviewed[0].Origin.Should().Be("engine");
    }

    [RequiresDockerFact]
    public async Task Approve_MultiPostBurst_EmitsExactlyOneReviewed_NotPerPost()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        var item = DelayedAuto(draftId, exerciseId, DraftDisposition.CountingDown);
        item.Posts = new List<EngineReviewDraftPost>
        {
            Post("@a", "first"),
            Post("@b", "second"),
            Post("@c", "third"),
        };
        await SeedAsync(item);

        await using var harness = Build(exerciseId);
        await harness.Service.ApproveAsync(draftId, Input("controller-7"));

        var reviewed = await ReadReviewedEventsAsync(draftId);
        reviewed.Should().ContainSingle("one burst = one review decision, never one per post (CTL-034)");
    }

    [RequiresDockerFact]
    public async Task Approve_ResolvesPersonaHandle_ToScopedInstanceId()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        var personaId = Guid.NewGuid();

        var item = DelayedAuto(draftId, exerciseId, DraftDisposition.CountingDown);
        item.Posts = new List<EngineReviewDraftPost> { Post("@mvega_fh", "hi") };
        await SeedAsync(item);
        await SeedPersonaAsync(personaId, exerciseId, "mvega_fh");

        await using var harness = Build(exerciseId);
        await harness.Service.ApproveAsync(draftId, Input("controller-7"));

        harness.PublishedBursts.Should().ContainSingle();
        harness.PublishedBursts[0].Posts.Should().ContainSingle().Which.PersonaId.Should().Be(
            personaId, "the '@'-prefixed draft handle resolves to the scoped persona INSTANCE id for the publish funnel");
    }

    [RequiresDockerFact]
    public async Task Edit_SanitizesNewText_BeforePublish_ThroughSameSeam()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await SeedAsync(DelayedAuto(draftId, exerciseId, DraftDisposition.CountingDown));

        await using var harness = Build(exerciseId);
        const string payload = "<script>alert(1)</script>Boil water in Zone 4 <img src=x onerror=alert(2)> now.";
        var result = await harness.Service.EditAsync(draftId, payload, Input("controller-9"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        var leadText = harness.PublishedBursts.Should().ContainSingle().Subject.Posts[0].Text;
        leadText.Should().NotContain("<script").And.NotContain("onerror").And.NotContain("<img").And.NotContain("<").And.NotContain(">");
        leadText.Should().Contain("Boil water in Zone 4").And.Contain("now.", "NFR-004: the author's literal text survives; only markup is stripped");

        var reviewed = await ReadReviewedEventsAsync(draftId);
        reviewed.Should().ContainSingle();
        PayloadAction(reviewed[0]).Should().Be("edit", "the approve/edit distinction is telemetry-only (same 'engine' publish origin)");
    }

    [RequiresDockerFact]
    public async Task Veto_MarksVetoed_NothingPublishes_EmitsOneReviewed()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await SeedAsync(DelayedAuto(draftId, exerciseId, DraftDisposition.CountingDown));

        await using var harness = Build(exerciseId);
        var result = await harness.Service.VetoAsync(draftId, Input("controller-3"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        harness.PublishedBursts.Should().BeEmpty("a veto never publishes");
        await AssertDispositionAsync(draftId, DraftDisposition.Vetoed);
        var reviewed = await ReadReviewedEventsAsync(draftId);
        reviewed.Should().ContainSingle();
        PayloadAction(reviewed[0]).Should().Be("veto");
    }

    [RequiresDockerFact]
    public async Task ReRoll_DelayedAuto_ReturnsToReview_ResetsCountdown_NothingPublishes()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        var item = DelayedAuto(draftId, exerciseId, DraftDisposition.CountingDown);
        item.CountdownStartedScenarioMinute = 0;
        item.CountdownMinutes = 3;
        await SeedAsync(item);

        await using var harness = Build(exerciseId);
        harness.Time.Advance(TimeSpan.FromMinutes(2)); // scenario minute is now 2

        var result = await harness.Service.ReRollAsync(draftId, Input("controller-5"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        harness.PublishedBursts.Should().BeEmpty("a re-roll never publishes");

        await using var verify = _fixture.CreateContext();
        var reloaded = await verify.EngineReviewItems.IgnoreQueryFilters().SingleAsync(i => i.DraftId == draftId);
        reloaded.Disposition.Should().Be(DraftDisposition.CountingDown, "a re-rolled Delayed-auto burst returns to review");
        reloaded.CountdownStartedScenarioMinute.Should().Be(2, "the fresh countdown restarts from the current scenario minute");
        reloaded.CountdownDecision.Should().Be(ControllerDecision.None);

        var reviewed = await ReadReviewedEventsAsync(draftId);
        reviewed.Should().ContainSingle();
        PayloadAction(reviewed[0]).Should().Be("re-roll");
    }

    [RequiresDockerFact]
    public async Task BatchApprove_PublishesEachUnresolved_SkipsResolved_OneDecisionPerBurst()
    {
        var exerciseId = Guid.NewGuid();
        var open1 = Guid.NewGuid();
        var open2 = Guid.NewGuid();
        var alreadyVetoed = Guid.NewGuid();

        await SeedAsync(
            Suggest(open1, exerciseId, DraftDisposition.Queued),
            Suggest(open2, exerciseId, DraftDisposition.Queued),
            Suggest(alreadyVetoed, exerciseId, DraftDisposition.Vetoed));

        await using var harness = Build(exerciseId);
        var result = await harness.Service.BatchApproveAsync(new[] { open1, open2, alreadyVetoed }, Input("lead-1"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        result.Outcomes.Single(o => o.DraftId == open1.ToString()).Outcome.Should().Be(EngineBatchApproveItem.Published);
        result.Outcomes.Single(o => o.DraftId == open2.ToString()).Outcome.Should().Be(EngineBatchApproveItem.Published);
        result.Outcomes.Single(o => o.DraftId == alreadyVetoed.ToString()).Outcome.Should().Be(EngineBatchApproveItem.Skipped);

        harness.PublishedBursts.Should().HaveCount(2, "a resolved burst is never re-published");
        (await ReadReviewedEventsAsync(open1)).Should().ContainSingle();
        (await ReadReviewedEventsAsync(open2)).Should().ContainSingle();
        (await ReadReviewedEventsAsync(alreadyVetoed)).Should().BeEmpty("no decision is logged for a skipped, already-resolved burst");
    }

    // ---- Isolation / validation (fail closed) ---------------------------------------------------

    [RequiresDockerFact]
    public async Task Approve_ForeignDraftId_FromExerciseAScope_ReturnsNotFound_AndNeverPublishes()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var draftB = Guid.NewGuid();
        await SeedAsync(DelayedAuto(draftB, exerciseB, DraftDisposition.CountingDown));

        await using var harness = Build(exerciseA);
        var result = await harness.Service.ApproveAsync(draftB, Input("controller-7"));

        result.Outcome.Should().Be(EngineReviewOutcome.NotFound, "an IDOR by exercise B's draft id from exercise A's scope must fail closed");
        harness.PublishedBursts.Should().BeEmpty();

        await using var verify = _fixture.CreateContext();
        var b = await verify.EngineReviewItems.IgnoreQueryFilters().SingleAsync(i => i.DraftId == draftB);
        b.Disposition.Should().Be(DraftDisposition.CountingDown, "exercise B's item must be untouched by an exercise-A caller");
    }

    [RequiresDockerFact]
    public async Task Approve_MissingActingHumanId_ReturnsInvalid_AndNeverPublishes()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await SeedAsync(DelayedAuto(draftId, exerciseId, DraftDisposition.CountingDown));

        await using var harness = Build(exerciseId);
        var result = await harness.Service.ApproveAsync(draftId, new EngineReviewActionInput(ActingHumanId: null, TimeZone: "UTC"));

        result.Outcome.Should().Be(EngineReviewOutcome.Invalid, "COR-018 requires the acting human behind the shared account");
        harness.PublishedBursts.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task Approve_UnresolvedScope_FailsClosed_AndNeverPublishes()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await SeedAsync(DelayedAuto(draftId, exerciseId, DraftDisposition.CountingDown));

        await using var harness = Build(currentExerciseId: null);
        var result = await harness.Service.ApproveAsync(draftId, Input("controller-7"));

        result.Outcome.Should().Be(EngineReviewOutcome.ScopeUnresolved);
        harness.PublishedBursts.Should().BeEmpty();
    }

    // ---- Publish-failure gate (WR-002 / SG-001 — a false Published is never recorded) ------------

    [RequiresDockerFact]
    public async Task Approve_PublishReturnsInvalidPost_NotMarkedPublished_NoReviewed_SurfacesFailure()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await SeedAsync(DelayedAuto(draftId, exerciseId, DraftDisposition.CountingDown));

        // The publish funnel reports an Invalid post (this also models SG-001 — an unresolved persona handle).
        await using var harness = Build(exerciseId, burst => FailingPublish(burst, EnginePublishOutcome.Invalid));
        var result = await harness.Service.ApproveAsync(draftId, Input("controller-7"));

        result.Outcome.Should().Be(EngineReviewOutcome.PublishFailed, "a burst that did not fully reach the feed must never be recorded Published (WR-002/SG-001)");
        harness.PublishedBursts.Should().ContainSingle("the publish was attempted through the single funnel");
        await AssertDispositionAsync(draftId, DraftDisposition.CountingDown, "the item stays actionable in the queue when its publish fails");
        (await ReadReviewedEventsAsync(draftId)).Should().BeEmpty("no success engine.reviewed is emitted when the burst did not publish");
    }

    [RequiresDockerFact]
    public async Task Edit_PublishReturnsScopeUnresolvedPost_NotMarkedPublished_NoReviewed_SurfacesFailure()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await SeedAsync(DelayedAuto(draftId, exerciseId, DraftDisposition.CountingDown));

        await using var harness = Build(exerciseId, burst => FailingPublish(burst, EnginePublishOutcome.ScopeUnresolved));
        var result = await harness.Service.EditAsync(draftId, "Boil water in Zone 4 now.", Input("controller-9"));

        result.Outcome.Should().Be(EngineReviewOutcome.PublishFailed, "a ScopeUnresolved post means nothing reached the feed — never mark Published (WR-002)");
        await AssertDispositionAsync(draftId, DraftDisposition.CountingDown, "the edited item stays actionable when publish fails");
        (await ReadReviewedEventsAsync(draftId)).Should().BeEmpty("no success engine.reviewed for a failed publish");
    }

    [RequiresDockerFact]
    public async Task BatchApprove_OneFailingBurst_PublishesSucceeding_ReportsPerItemFailure()
    {
        var exerciseId = Guid.NewGuid();
        var ok1 = Guid.NewGuid();
        var failing = Guid.NewGuid();
        var ok2 = Guid.NewGuid();

        await SeedAsync(
            Suggest(ok1, exerciseId, DraftDisposition.Queued),
            Suggest(failing, exerciseId, DraftDisposition.Queued),
            Suggest(ok2, exerciseId, DraftDisposition.Queued));

        await using var harness = Build(exerciseId, burst => burst.DraftId == failing
            ? FailingPublish(burst, EnginePublishOutcome.Invalid)
            : AllPublished(burst));
        var result = await harness.Service.BatchApproveAsync(new[] { ok1, failing, ok2 }, Input("lead-1"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok, "batch approve is best-effort per-item, not transactional (by design)");
        result.Outcomes.Single(o => o.DraftId == ok1.ToString()).Outcome.Should().Be(EngineBatchApproveItem.Published);
        result.Outcomes.Single(o => o.DraftId == ok2.ToString()).Outcome.Should().Be(EngineBatchApproveItem.Published);
        result.Outcomes.Single(o => o.DraftId == failing.ToString()).Outcome.Should().Be(
            EngineBatchApproveItem.Failed, "the burst whose publish did not fully reach the feed is reported failed, not published (WR-002)");

        await AssertDispositionAsync(ok1, DraftDisposition.Published);
        await AssertDispositionAsync(ok2, DraftDisposition.Published);
        await AssertDispositionAsync(failing, DraftDisposition.Queued, "the failing burst stays actionable and is never marked Published");
        (await ReadReviewedEventsAsync(ok1)).Should().ContainSingle();
        (await ReadReviewedEventsAsync(ok2)).Should().ContainSingle();
        (await ReadReviewedEventsAsync(failing)).Should().BeEmpty("no success engine.reviewed for the failing burst");
    }

    // ---- Terminal re-action guard (WR-001 — a resolved item can never be re-published) -----------

    [RequiresDockerFact]
    public async Task Approve_AlreadyPublishedItem_Rejected_AndNeverRepublishes()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await SeedAsync(DelayedAuto(draftId, exerciseId, DraftDisposition.Published));

        await using var harness = Build(exerciseId);
        var result = await harness.Service.ApproveAsync(draftId, Input("controller-7"));

        result.Outcome.Should().Be(EngineReviewOutcome.AlreadyResolved, "a terminal (already Published) item must be rejected — never re-approved into a double-publish (WR-001)");
        harness.PublishedBursts.Should().BeEmpty("an already-published burst is never re-sent to the feed");
        await AssertDispositionAsync(draftId, DraftDisposition.Published);
    }

    [RequiresDockerFact]
    public async Task Edit_AlreadyVetoedItem_Rejected_AndNeverPublishes()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await SeedAsync(DelayedAuto(draftId, exerciseId, DraftDisposition.Vetoed));

        await using var harness = Build(exerciseId);
        var result = await harness.Service.EditAsync(draftId, "new text", Input("controller-9"));

        result.Outcome.Should().Be(EngineReviewOutcome.AlreadyResolved, "a terminal (vetoed) item must be rejected — never published (WR-001)");
        harness.PublishedBursts.Should().BeEmpty("a vetoed burst is never published by a later edit");
        await AssertDispositionAsync(draftId, DraftDisposition.Vetoed);
    }

    // ---- SAFETY INVARIANTS (E8 §8.2 — each proves the NEGATIVE) ----------------------------------

    [RequiresDockerFact]
    public async Task AutoHold_CountdownExpiresWithNoDecision_HoldsNeverSends_EmitsHoldOnExpiry()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await SeedAsync(Countdown(draftId, exerciseId, started: 0, minutes: 3));

        await using var harness = Build(exerciseId);
        harness.Time.Advance(TimeSpan.FromMinutes(4)); // past the scenario-minute deadline (3)

        await harness.Service.EvaluateAutoHoldAsync();

        harness.PublishedBursts.Should().BeEmpty("silence is NEVER approval — an expired countdown must never auto-send (D5-014/1.1)");
        await AssertDispositionAsync(draftId, DraftDisposition.Held);
        var reviewed = await ReadReviewedEventsAsync(draftId);
        reviewed.Should().ContainSingle();
        PayloadAction(reviewed[0]).Should().Be("hold-on-expiry");
        reviewed[0].Actor.ActingHumanId.Should().BeNull("the auto-HOLD is silence, not a human decision — no acting human");
    }

    [RequiresDockerFact]
    public async Task AutoHold_NotYetExpired_LeavesCountingDown_NothingHappens()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        await SeedAsync(Countdown(draftId, exerciseId, started: 0, minutes: 5));

        await using var harness = Build(exerciseId);
        harness.Time.Advance(TimeSpan.FromMinutes(2)); // still before the deadline (5)

        await harness.Service.EvaluateAutoHoldAsync();

        harness.PublishedBursts.Should().BeEmpty();
        await AssertDispositionAsync(draftId, DraftDisposition.CountingDown);
        (await ReadReviewedEventsAsync(draftId)).Should().BeEmpty("a still-running countdown is not a decision");
    }

    [RequiresDockerFact]
    public async Task AutoHold_SwampedModeAndEffectiveDelayedAuto_AutoSends_EmitsAutoSend()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        var item = Countdown(draftId, exerciseId, started: 0, minutes: 3);
        await SeedAsync(item);

        await using var harness = Build(exerciseId);
        // The ONLY auto-send path: an explicit lead swamped-mode toggle AND the draft still effectively Delayed-auto.
        var state = harness.Registry.GetOrCreate(exerciseId);
        state.SetStorylineOverride(item.StorylineId, AutonomyLevel.DelayedAuto, "lead-1", 0);
        state.SetSwampedMode(enabled: true, "lead-1", 0);
        harness.Time.Advance(TimeSpan.FromMinutes(4));

        await harness.Service.EvaluateAutoHoldAsync();

        harness.PublishedBursts.Should().ContainSingle("swamped mode is the ONLY timeout auto-send path (#36)");
        await AssertDispositionAsync(draftId, DraftDisposition.Published);
        PayloadAction((await ReadReviewedEventsAsync(draftId)).Should().ContainSingle().Subject).Should().Be("auto-send");
    }

    [RequiresDockerFact]
    public async Task AutoHold_KillSwitchSuspendsCountdown_HoldsEvenUnderSwampedMode()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        var item = Countdown(draftId, exerciseId, started: 0, minutes: 3);
        await SeedAsync(item);

        await using var harness = Build(exerciseId);
        var state = harness.Registry.GetOrCreate(exerciseId);
        state.SetStorylineOverride(item.StorylineId, AutonomyLevel.DelayedAuto, "lead-1", 0);
        state.SetSwampedMode(enabled: true, "lead-1", 0);
        // The kill switch clamps effective autonomy below Delayed-auto → the in-flight countdown suspends.
        state.EngageKillSwitch(KillSwitchMode.DropToSuggest, "lead-1", 0);
        harness.Time.Advance(TimeSpan.FromMinutes(4));

        await harness.Service.EvaluateAutoHoldAsync();

        harness.PublishedBursts.Should().BeEmpty("a kill switch suspends in-flight countdowns — they HOLD, not send, even under swamped mode");
        await AssertDispositionAsync(draftId, DraftDisposition.Held);
        PayloadAction((await ReadReviewedEventsAsync(draftId)).Should().ContainSingle().Subject).Should().Be("hold-on-expiry");
    }

    [RequiresDockerFact]
    public async Task AutoHold_DegradedModeSuspendsCountdown_HoldsEvenUnderSwampedMode()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();
        var item = Countdown(draftId, exerciseId, started: 0, minutes: 3);
        await SeedAsync(item);

        await using var harness = Build(exerciseId);
        var state = harness.Registry.GetOrCreate(exerciseId);
        state.SetStorylineOverride(item.StorylineId, AutonomyLevel.DelayedAuto, "lead-1", 0);
        state.SetSwampedMode(enabled: true, "lead-1", 0);
        // The automatic degraded-mode fallback drives the SAME clamp as the kill switch (§3.5).
        state.DegradeToSuggest("generation provider circuit opened", 0);
        harness.Time.Advance(TimeSpan.FromMinutes(4));

        await harness.Service.EvaluateAutoHoldAsync();

        harness.PublishedBursts.Should().BeEmpty("degraded mode lowers autonomy and suspends countdowns — HOLD, not send");
        await AssertDispositionAsync(draftId, DraftDisposition.Held);
    }

    [RequiresDockerFact]
    public async Task KillSwitch_OnlyLowersAutonomy_AndDoesNotAutoRecover()
    {
        var exerciseId = Guid.NewGuid();
        var storylineId = Guid.NewGuid();

        await using var harness = Build(exerciseId);
        var state = harness.Registry.GetOrCreate(exerciseId);
        state.SetExerciseDefault(AutonomyLevel.DelayedAuto, "lead-1", 0);

        var result = await harness.Service.EngageKillSwitchAsync(KillSwitchMode.DropToSuggest, Input("lead-1"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        state.ResolveEffective(storylineId).Level.Should().Be(AutonomyLevel.Suggest, "the kill switch only ever LOWERS autonomy (§8.2)");
        state.SafetyClampActive.Should().BeTrue("the clamp persists — it never auto-recovers; a human restores explicitly");
    }

    [RequiresDockerFact]
    public async Task SwampedMode_TogglingOn_DoesNotRaiseAutonomy()
    {
        var exerciseId = Guid.NewGuid();
        var storylineId = Guid.NewGuid();

        await using var harness = Build(exerciseId);
        var state = harness.Registry.GetOrCreate(exerciseId);
        var before = state.ResolveEffective(storylineId).Level;

        var result = await harness.Service.SetSwampedModeAsync(enabled: true, Input("lead-1"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        result.State!.SwampedMode.Should().BeTrue();
        state.ResolveEffective(storylineId).Level.Should().Be(before, "swamped mode never raises the autonomy level — automation never self-escalates (§8.2)");
    }

    // ---- Restore-from-safety (the kill-switch UNDO — §8.2 human-only raise) ----------------------

    [RequiresDockerFact]
    public async Task RestoreFromSafety_AfterFullStopKillSwitch_ResumesEngine_PersistsNoTelemetry()
    {
        var exerciseId = Guid.NewGuid();
        var storylineId = Guid.NewGuid();

        await using var harness = Build(exerciseId);
        var state = harness.Registry.GetOrCreate(exerciseId);
        state.SetExerciseDefault(AutonomyLevel.DelayedAuto, "lead-1", 0);
        state.EngageKillSwitch(KillSwitchMode.FullStop, "lead-1", 0);
        state.ResolveEffective(storylineId).GenerationStopped.Should().BeTrue("precondition: the full-stop kill switch stopped the engine");

        // The restore acts on the SAME shared per-exercise state instance the loop reads.
        var result = await harness.Service.RestoreFromSafetyAsync(Input("lead-1"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        result.State!.GenerationStopped.Should().BeFalse();
        result.State.SafetyClampActive.Should().BeFalse();
        state.ResolveEffective(storylineId).GenerationStopped.Should().BeFalse(
            "restore lifts the full stop so the engine resumes — the kill-switch undo (§8.2 human-only raise)");
        state.ResolveEffective(storylineId).Level.Should().Be(AutonomyLevel.DelayedAuto,
            "the base level is preserved underneath the clamp and resumes on restore (§8.2)");
        (await CountTelemetryAsync(exerciseId)).Should().Be(0,
            "restore mirrors the kill switch — an autonomy control persists no telemetry (the autonomy→XC-004 mapping is engine-telemetry-tuning's job, not built yet)");
    }

    [RequiresDockerFact]
    public async Task RestoreFromSafety_NothingClamped_ReturnsOk_ChangesNothing_PersistsNoTelemetry()
    {
        var exerciseId = Guid.NewGuid();
        var storylineId = Guid.NewGuid();

        await using var harness = Build(exerciseId);
        var state = harness.Registry.GetOrCreate(exerciseId);
        var before = state.ResolveEffective(storylineId);

        var result = await harness.Service.RestoreFromSafetyAsync(Input("lead-1"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok,
            "restoring an already-running engine is an idempotent no-op SUCCESS, not an error");
        result.State!.SafetyClampActive.Should().BeFalse();
        state.ResolveEffective(storylineId).Should().Be(before, "a no-op restore leaves the running engine untouched");
        (await CountTelemetryAsync(exerciseId)).Should().Be(0, "an idempotent no-op restore persists no telemetry");
    }

    [RequiresDockerFact]
    public async Task RestoreFromSafety_UnresolvedScope_FailsClosed_AndDoesNotMutate()
    {
        var exerciseId = Guid.NewGuid();

        // The scope is unresolved (per-request binding is Phase B2). Pre-clamp the same-registry state so we can
        // prove the fail-closed restore returns BEFORE it ever touches the autonomy state.
        await using var harness = Build(currentExerciseId: null);
        var state = harness.Registry.GetOrCreate(exerciseId);
        state.EngageKillSwitch(KillSwitchMode.FullStop, "lead-1", 0);

        var result = await harness.Service.RestoreFromSafetyAsync(Input("lead-1"));

        result.Outcome.Should().Be(EngineReviewOutcome.ScopeUnresolved,
            "an unresolved scope fails closed — a restore never runs without a resolved exercise (COR-001)");
        state.SafetyClampActive.Should().BeTrue("the clamp is untouched when the restore fails closed");
        state.IsGenerationStopped.Should().BeTrue("the full stop remains — nothing was lifted");
    }

    [RequiresDockerFact]
    public async Task RestoreFromSafety_MissingActingHumanId_ReturnsInvalid()
    {
        var exerciseId = Guid.NewGuid();

        await using var harness = Build(exerciseId);
        var result = await harness.Service.RestoreFromSafetyAsync(new EngineReviewActionInput(ActingHumanId: null, TimeZone: "UTC"));

        result.Outcome.Should().Be(EngineReviewOutcome.Invalid,
            "COR-018 requires the acting human behind the shared controller account");
    }

    // ---- helpers --------------------------------------------------------------------------------

    private static EngineReviewActionInput Input(string actingHumanId) => new(actingHumanId, "America/Chicago");

    private Harness Build(Guid? currentExerciseId, Func<EngineBurst, EngineBurstPublishResult>? publishOutcome = null)
    {
        var context = new ExerciseContext { CurrentExerciseId = currentExerciseId };
        var db = _fixture.CreateContext(context);
        var time = new ManualTimeProvider(ScenarioStart);
        var clock = new ExerciseClockService(time);
        if (currentExerciseId is { } id && id != Guid.Empty)
        {
            clock.Start(id, ScenarioStart, TimeZoneInfo.Utc);
        }

        // Default: every post publishes successfully. A test can inject failing outcomes per burst (WR-002).
        publishOutcome ??= burst => new EngineBurstPublishResult
        {
            Posts = burst.Posts
                .Select(p => new EnginePublishedPost
                {
                    PersonaHandle = p.PersonaHandle,
                    PostId = Guid.NewGuid(),
                    Outcome = EnginePublishOutcome.Published,
                })
                .ToList(),
        };

        var publisher = new Mock<IEnginePublishService>();
        var published = new List<EngineBurst>();
        publisher
            .Setup(p => p.PublishBurstAsync(It.IsAny<EngineBurst>(), It.IsAny<CancellationToken>()))
            .Callback<EngineBurst, CancellationToken>((burst, _) => published.Add(burst))
            .ReturnsAsync((EngineBurst burst, CancellationToken _) => publishOutcome(burst));

        var broadcaster = new Mock<IEngineReviewBroadcaster>();
        var registry = new EngineAutonomyRegistry();
        var service = new EngineReviewService(
            new EngineReviewStore(db),
            db,
            context,
            clock,
            new EngineTelemetryEmitter(),
            publisher.Object,
            broadcaster.Object,
            registry,
            new EngineTierPolicyRegistry(),
            new FakeGenerationProvider(),
            Options.Create(new GenerationOptions()),
            new GenerationProviderCutRegistry(),
            NullLogger<EngineReviewService>.Instance);

        return new Harness(service, db, published, registry, time);
    }

    private async Task SeedAsync(params EngineReviewItemEntity[] items)
    {
        await using var seed = _fixture.CreateContext();
        seed.EngineReviewItems.AddRange(items);
        await seed.SaveChangesAsync();
    }

    private async Task SeedPersonaAsync(Guid personaId, Guid exerciseId, string handle)
    {
        await using var seed = _fixture.CreateContext();
        seed.Personas.Add(new Persona
        {
            Id = personaId,
            ExerciseId = exerciseId,
            DisplayName = handle,
            Handle = handle,
            Kind = "human",
            Verified = false,
        });
        await seed.SaveChangesAsync();
    }

    private async Task AssertDispositionAsync(Guid draftId, DraftDisposition expected, string because = "")
    {
        await using var verify = _fixture.CreateContext();
        var reloaded = await verify.EngineReviewItems.IgnoreQueryFilters().SingleAsync(i => i.DraftId == draftId);
        reloaded.Disposition.Should().Be(expected, because);
    }

    /// <summary>A publish result where every post reached the feed (the default success outcome).</summary>
    private static EngineBurstPublishResult AllPublished(EngineBurst burst) => new()
    {
        Posts = burst.Posts
            .Select(p => new EnginePublishedPost
            {
                PersonaHandle = p.PersonaHandle,
                PostId = Guid.NewGuid(),
                Outcome = EnginePublishOutcome.Published,
            })
            .ToList(),
    };

    /// <summary>A publish result where the FIRST post fails with <paramref name="failure"/> (Invalid — incl. an unresolved persona handle, SG-001 — or ScopeUnresolved) and the rest succeed: a partial publish that must NOT mark the burst Published (WR-002).</summary>
    private static EngineBurstPublishResult FailingPublish(EngineBurst burst, EnginePublishOutcome failure) => new()
    {
        Posts = burst.Posts
            .Select((p, index) => new EnginePublishedPost
            {
                PersonaHandle = p.PersonaHandle,
                PostId = index == 0 ? null : Guid.NewGuid(),
                Outcome = index == 0 ? failure : EnginePublishOutcome.Published,
                Error = index == 0 && failure == EnginePublishOutcome.Invalid ? "unresolved persona handle" : null,
            })
            .ToList(),
    };

    private async Task<List<TelemetryEvent>> ReadReviewedEventsAsync(Guid draftId)
    {
        await using var verify = _fixture.CreateContext();
        return await verify.TelemetryEvents
            .IgnoreQueryFilters()
            .Where(e => e.EventType == "engine.reviewed"
                && e.Target != null && e.Target.EntityId == draftId.ToString())
            .ToListAsync();
    }

    /// <summary>Counts every telemetry row persisted for an exercise — used to prove an autonomy control (kill switch / restore) writes NONE.</summary>
    private async Task<int> CountTelemetryAsync(Guid exerciseId)
    {
        await using var verify = _fixture.CreateContext();
        return await verify.TelemetryEvents
            .IgnoreQueryFilters()
            .CountAsync(e => e.ExerciseId == exerciseId);
    }

    private static string? PayloadAction(TelemetryEvent telemetryEvent)
    {
        using var doc = JsonDocument.Parse(telemetryEvent.Payload!);
        return doc.RootElement.GetProperty("action").GetString();
    }

    private static EngineReviewItemEntity Suggest(Guid draftId, Guid exerciseId, DraftDisposition disposition) => new()
    {
        DraftId = draftId,
        ExerciseId = exerciseId,
        StorylineId = Guid.NewGuid(),
        RoutedAtLevel = AutonomyLevel.Suggest,
        Disposition = disposition,
        StorylineTag = "#WaterIssues",
        StorylineBrief = "Rising frustration about the water outage.",
        ActionLabel = "reply → @mvega_fh",
        Posts = new List<EngineReviewDraftPost> { Post("@mvega_fh", "Water pressure is dropping.") },
    };

    private static EngineReviewItemEntity DelayedAuto(Guid draftId, Guid exerciseId, DraftDisposition disposition)
    {
        var item = Suggest(draftId, exerciseId, disposition);
        item.RoutedAtLevel = AutonomyLevel.DelayedAuto;
        item.CountdownStartedScenarioMinute = 0;
        item.CountdownMinutes = 5;
        item.CountdownDecision = ControllerDecision.None;
        return item;
    }

    private static EngineReviewItemEntity Countdown(Guid draftId, Guid exerciseId, int started, int minutes)
    {
        var item = DelayedAuto(draftId, exerciseId, DraftDisposition.CountingDown);
        item.CountdownStartedScenarioMinute = started;
        item.CountdownMinutes = minutes;
        return item;
    }

    private static EngineReviewDraftPost Post(string handle, string text) => new()
    {
        PersonaHandle = handle,
        Text = text,
        Sentiment = -0.3,
        Hashtags = new List<string> { "#WaterIssues" },
    };

    private sealed class Harness : IAsyncDisposable
    {
        private readonly PulseDbContext _db;

        public Harness(
            EngineReviewService service,
            PulseDbContext db,
            IReadOnlyList<EngineBurst> publishedBursts,
            EngineAutonomyRegistry registry,
            ManualTimeProvider time)
        {
            Service = service;
            _db = db;
            PublishedBursts = publishedBursts;
            Registry = registry;
            Time = time;
        }

        public EngineReviewService Service { get; }

        public IReadOnlyList<EngineBurst> PublishedBursts { get; }

        public EngineAutonomyRegistry Registry { get; }

        public ManualTimeProvider Time { get; }

        public async ValueTask DisposeAsync() => await _db.DisposeAsync();
    }
}
