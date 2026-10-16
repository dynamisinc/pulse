namespace Pulse.WebApi.Features.EngineRuntime;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Pulse.Core.Features.Ambient.Models;
using Pulse.Core.Features.Ambient.Services;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Autonomy.Services;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;
using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Publishing;
using Pulse.WebApi.Features.EngineRuntime.Review;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;

/// <summary>
/// The ambient-chatter branch of the reaction loop (ambient-chatter story 01, AC4-AC9): the quiet-floor decide policy,
/// the ordinary <see cref="GenerateStage"/> path, and then EITHER the existing review queue (<c>review</c> mode) OR a
/// gated autonomous publish through the one <see cref="IEnginePublishService"/> (<c>autonomous</c> mode).
/// </summary>
/// <remarks>
/// <para>
/// <b>Only <c>Trigger == AmbientFloor</c> AND policy <c>autonomous</c> ever publishes without a controller click
/// (AC8).</b> That pair exists only here: every storyline intent (Inaction, OfficialResponse, Amplification) is decided
/// and enqueued by <see cref="RunTickAsync"/> exactly as before, and this method never sees one. An ambient draft that
/// goes to the queue is routed at Suggest, never Delayed-auto, so no countdown expiry can publish it.
/// </para>
/// <para>
/// <b>The last boundary before each publish (AC5/AC6), mirroring PR #571's <c>AutoSendOnTickAsync</c>.</b> Each post is
/// published on its own; before each, the lifecycle gate is refreshed (the one await), and then — with NO await
/// between the check and the publisher call — the kill switch (either mode, via <c>SafetyClampActive</c>), a degraded
/// clamp, the cut to Fake, the policy still being autonomous and authorised, and the lifecycle / Freeze / Pause-engine
/// gate are re-read. Anything closed discards the rest of the burst and records why (<c>heldReason</c>). A safety hold
/// also LOWERS the policy to off, so restoring the engine never re-raises ambient autonomy. Residual: a single post
/// already handed to the publisher completes (the funnel observes only its cancellation token).
/// </para>
/// <para>
/// <b>Isolation (COR-001).</b> Everything here runs inside the tick's own exercise scope; the publish funnel builds its
/// own scope from the burst's server-derived exercise id. No participant surface ever sees a draft: an autonomous
/// post reaches participants only as an ordinary published post through the funnel; a review-mode draft stays in the
/// staff review queue.
/// </para>
/// </remarks>
public sealed partial class ReactionLoopDriver
{
    private readonly ConcurrentDictionary<Guid, AmbientWindow> _ambientWindows = new();

    /// <summary>
    /// Runs the ambient branch for one tick. Never throws for an ambient fault (it is logged and ambient is skipped
    /// for the tick, fail closed), so storyline review items already decided this tick are always persisted.
    /// </summary>
    /// <returns>How many ambient posts the autonomous path published.</returns>
    private async Task<int> RunAmbientAsync(
        AmbientTickInputs tick,
        List<TelemetryEvent> pendingEvents,
        List<EngineReviewItemEntity> reviewItems,
        CancellationToken cancellationToken)
    {
        var registry = tick.ScopedServices.GetService<EngineAmbientPolicyRegistry>();
        if (registry is null || registry.Get(tick.Registration.ExerciseId).Mode == AmbientPolicyMode.Off)
        {
            return 0;
        }

        try
        {
            return await RunAmbientCoreAsync(tick, registry, pendingEvents, reviewItems, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
#pragma warning disable CA1031 // An ambient fault must never cost the tick its storyline review items.
        catch (Exception ex)
        {
            LogAmbientFailed(ex, tick.Registration.ExerciseId);
            return 0;
        }
#pragma warning restore CA1031
    }

    private async Task<int> RunAmbientCoreAsync(
        AmbientTickInputs tick,
        EngineAmbientPolicyRegistry registry,
        List<TelemetryEvent> pendingEvents,
        List<EngineReviewItemEntity> reviewItems,
        CancellationToken cancellationToken)
    {
        var registration = tick.Registration;
        var exerciseId = registration.ExerciseId;
        var policy = registry.Get(exerciseId);
        var autonomous = policy.Mode == AmbientPolicyMode.Autonomous;
        var window = _ambientWindows.GetOrAdd(exerciseId, _ => new AmbientWindow());
        var ambientContext = tick.Context with
        {
            Actor = new EngineTelemetryActor { Kind = "engine", ActingHumanId = policy.SetBy },
        };

        // A safety clamp (kill switch either mode, degraded mode, cut to Fake) or a revoked governance flag LOWERS an
        // autonomous policy to off: it pauses ambient, never drops it into the review queue, and a restore can never
        // re-raise it (AC6). The request-path levers already demoted it; this is the backstop (e.g. degraded mode).
        if (autonomous && (SafetyHeld(tick.ScopedServices, registration) || !registry.AutonomyAuthorized))
        {
            DemoteAndRecord(registry, exerciseId, ambientContext, tick.ScenarioMinute, pendingEvents);
            return 0;
        }

        var worldPosts = await CountWorldPostsAsync(tick.DbContext, tick.ScenarioInstant, cancellationToken).ConfigureAwait(false);
        var now = _timeProvider.GetUtcNow();
        var intent = AmbientBehavior.Decide(new AmbientDecideInput
        {
            ExerciseId = exerciseId,
            Policy = policy,
            Autonomy = registration.Autonomy.ResolveEffective(Guid.Empty),
            Cast = registration.PersonasByHandle.Values
                .Select(persona => new AmbientCastMember(persona.InstanceId, persona.Dossier))
                .ToList(),
            RateConfig = registration.RateConfig,
            EnginePostsThisMinute = tick.TickState.PostsThisMinute,
            WorldPostsThisMinute = worldPosts,
            AmbientPostsLastMinute = window.CountSince(now - TimeSpan.FromMinutes(1)),
            AmbientPostsLastHour = window.CountSince(now - TimeSpan.FromHours(1)),
            StorylineIntentsThisTick = tick.StorylineIntents,
            ScenarioMinute = tick.ScenarioMinute,
        });
        if (intent is null)
        {
            return 0;
        }

        // A review-mode ambient draft is one more demanded decision (CTL-034): it respects the same budget.
        if (!autonomous
            && tick.TickState.DemandMeter.DemandInWindow(tick.ScenarioMinute) >= WorkloadDemandMeter.BudgetPerMinute)
        {
            return 0;
        }

        var publishPath = autonomous ? EngineEventPayloads.PublishPathAmbientAutonomous : null;

        // AC5: nothing is generated for a world that is not live / frozen / engine-paused — the burst is "due" but held,
        // recorded once per hold (not every 5 s tick) so a long EndEx does not flood the log.
        var gate = tick.ScopedServices.GetRequiredService<IEngineLifecyclePublishGate>();
        await gate.RefreshAsync(exerciseId, cancellationToken).ConfigureAwait(false);
        if (!gate.CanPublish(exerciseId))
        {
            if (window.TryMarkHeld(EngineEventPayloads.HeldLifecycle))
            {
                pendingEvents.Add(BuildAmbientDecidedEvent(
                    ambientContext, intent, tick.TickState.PostsThisMinute, publishPath, EngineEventPayloads.HeldLifecycle));
            }

            return 0;
        }

        window.ClearHeld();
        pendingEvents.Add(BuildAmbientDecidedEvent(ambientContext, intent, tick.TickState.PostsThisMinute, publishPath, heldReason: null));

        // The per-minute / per-hour budget is spent at GENERATION (a call costs money whether or not it publishes), on
        // the server wall clock, so a scenario time-jump can never reset the spend window.
        window.Record(now, intent.Count);

        var draftId = Guid.NewGuid();
        var tier = _tierPolicy.ResolveTier(exerciseId, intent.Tier);
        var generated = await _generateStage
            .GenerateAsync(BuildAmbientGenerateRequest(registration, intent, tier), cancellationToken)
            .ConfigureAwait(false);

        // AC7: a guard (or diversity) failure publishes NOTHING; the engine.generated drop event is the count.
        if (generated.Disposition != GenerateDisposition.Accepted)
        {
            pendingEvents.Add(BuildAmbientGeneratedEvent(ambientContext, draftId, generated, publishPath, heldReason: null));
            return 0;
        }

        if (!autonomous)
        {
            var item = BuildAmbientReviewItem(exerciseId, intent, generated.Posts, draftId);
            reviewItems.Add(item);
            tick.TickState.DemandMeter.Record(DemandEventKind.QueueFire, tick.ScenarioMinute);
            tick.TickState.PostsThisMinute += item.Posts.Count;
            pendingEvents.Add(BuildAmbientGeneratedEvent(ambientContext, draftId, generated, publishPath: null, heldReason: null));
            return 0;
        }

        var (published, held) = await PublishAmbientAsync(
            tick, registry, gate, policy, intent, generated.Posts, draftId, ambientContext, pendingEvents, cancellationToken)
            .ConfigureAwait(false);

        tick.TickState.PostsThisMinute += published;
        pendingEvents.Add(BuildAmbientGeneratedEvent(ambientContext, draftId, generated, publishPath, held));
        return published;
    }

    /// <summary>
    /// Publishes an accepted autonomous ambient burst one post at a time, re-deciding at the last boundary before each
    /// publisher call (no await between the re-check and the call). Returns the published count and, if the rest of
    /// the burst was discarded, why.
    /// </summary>
    private async Task<(int Published, string? HeldReason)> PublishAmbientAsync(
        AmbientTickInputs tick,
        EngineAmbientPolicyRegistry registry,
        IEngineLifecyclePublishGate gate,
        AmbientTierPolicy policy,
        GenerationIntent intent,
        IReadOnlyList<GeneratedPost> posts,
        Guid draftId,
        EngineTelemetryContext ambientContext,
        List<TelemetryEvent> pendingEvents,
        CancellationToken cancellationToken)
    {
        var registration = tick.Registration;
        var exerciseId = registration.ExerciseId;
        var publisher = tick.ScopedServices.GetRequiredService<IEnginePublishService>();
        var burstPosts = BuildAmbientBurstPosts(registration, intent, posts);
        var published = 0;

        foreach (var post in burstPosts)
        {
            // The ONE await before the re-check: the durable half of the lifecycle gate (Exercise.Status).
            await gate.RefreshAsync(exerciseId, cancellationToken).ConfigureAwait(false);

            // ---- NO await from here to the publisher call ----------------------------------------------------
            var held = PublishHold(tick.ScopedServices, registration, registry, gate);
            if (held is not null)
            {
                if (held == EngineEventPayloads.HeldSafety)
                {
                    DemoteAndRecord(registry, exerciseId, ambientContext, tick.ScenarioMinute, pendingEvents);
                }

                return (published, held);
            }

            var burst = new EngineBurst
            {
                ExerciseId = exerciseId,
                StorylineId = Guid.Empty,
                DraftId = draftId,
                TimeZone = registration.TimeZone,
                Posts = [post with { ScenarioTime = CurrentScenarioTime(registration) }],
                Trigger = EngineEventPayloads.AmbientFloorTrigger,
                PublishPath = EngineEventPayloads.PublishPathAmbientAutonomous,
                AuthorizedBy = policy.SetBy,
            };
            var result = await publisher.PublishBurstAsync(burst, cancellationToken).ConfigureAwait(false);
            published += result.Posts.Count(outcome => outcome.Outcome == EnginePublishOutcome.Published);
        }

        return (published, null);
    }

    /// <summary>
    /// The synchronous last-boundary re-check (AC5/AC6/AC8). Safety first (so a kill switch is reported as such even
    /// though its request path also demoted the policy), then the policy, then the lifecycle gate. <c>null</c> = publish.
    /// </summary>
    private static string? PublishHold(
        IServiceProvider scopedServices,
        ReactionLoopRegistration registration,
        EngineAmbientPolicyRegistry registry,
        IEngineLifecyclePublishGate gate)
    {
        if (SafetyHeld(scopedServices, registration))
        {
            return EngineEventPayloads.HeldSafety;
        }

        if (registry.Get(registration.ExerciseId).Mode != AmbientPolicyMode.Autonomous || !registry.AutonomyAuthorized)
        {
            return EngineEventPayloads.HeldPolicy;
        }

        return gate.CanPublish(registration.ExerciseId) ? null : EngineEventPayloads.HeldLifecycle;
    }

    /// <summary>
    /// Whether ANY safety control is active: the kill switch in either mode (<c>SafetyClampActive</c> covers
    /// DropToSuggest; <c>IsGenerationStopped</c> FullStop), a degraded-mode clamp, or the cut to Fake. Reads the loop's
    /// own autonomy state AND the shared registry's (the same instance when seeded; both are checked defensively).
    /// </summary>
    private static bool SafetyHeld(IServiceProvider scopedServices, ReactionLoopRegistration registration)
    {
        var exerciseId = registration.ExerciseId;
        if (registration.Autonomy.SafetyClampActive || registration.Autonomy.IsGenerationStopped)
        {
            return true;
        }

        if (scopedServices.GetService<EngineAutonomyRegistry>() is { } autonomy
            && autonomy.GetOrCreate(exerciseId) is { } shared
            && (shared.SafetyClampActive || shared.IsGenerationStopped))
        {
            return true;
        }

        return scopedServices.GetService<IGenerationProviderCutRegistry>()?.IsCutToFake(exerciseId) ?? false;
    }

    /// <summary>Lowers an autonomous policy to off and records it once (actor: the engine), as the request levers do.</summary>
    private void DemoteAndRecord(
        EngineAmbientPolicyRegistry registry,
        Guid exerciseId,
        EngineTelemetryContext context,
        int scenarioMinute,
        List<TelemetryEvent> pendingEvents)
    {
        if (!registry.DemoteAutonomous(exerciseId, out var demoted))
        {
            return;
        }

        var payload = new EngineEventPayloads.AmbientPolicyChanged
        {
            FromMode = AmbientPolicyModes.ToLiteral(demoted.Mode),
            ToMode = AmbientPolicyModes.ToLiteral(AmbientPolicyMode.Off),
            MaxPerMinute = demoted.MaxPerMinute,
            MaxPerHour = demoted.MaxPerHour,
            TopicAllowList = demoted.TopicAllowList.ToList(),
            PersonaAllowList = demoted.PersonaAllowList.Select(id => id.ToString()).ToList(),
            Reason = EngineEventPayloads.AmbientPolicyChanged.ReasonSafetyClamp,
            ScenarioMinute = scenarioMinute,
        };

        // The engine lowered it, not a human: no acting human on this record.
        pendingEvents.Add(_telemetryEmitter.BuildEvent(
            EngineEventTypes.TierPolicyChanged, context with { Actor = new EngineTelemetryActor { Kind = "engine" } }, payload));
    }

    /// <summary>
    /// Non-engine posts (participants, injects, controller-as-persona, WHITE NOISE) in the trailing scenario minute —
    /// the "world" half of the quiet-floor activity measure. Counting white noise here is how ambient chatter and the
    /// authored white-noise pool avoid double-filling the floor. Confined to the tick's exercise by the central filter.
    /// </summary>
    private static Task<int> CountWorldPostsAsync(PulseDbContext dbContext, DateTimeOffset scenarioInstant, CancellationToken cancellationToken)
    {
        var since = scenarioInstant - TimeSpan.FromMinutes(1);
        return dbContext.Posts
            .AsNoTracking()
            .CountAsync(
                post => post.Origin != EngineOriginLiteral
                    && post.DeletedAt == null
                    && post.CreatedScenarioTime > since
                    && post.CreatedScenarioTime <= scenarioInstant,
                cancellationToken);
    }

    private const string EngineOriginLiteral = "engine";

    /// <summary>
    /// The generate request for an ambient burst: the ordinary <see cref="GenerateStage"/> input with a server-authored
    /// "storyline" brief built ONLY from the allow-listed topic seed (never free text), framed as everyday background
    /// life with no incident, no officials and zero intensity.
    /// </summary>
    private static GenerateStageRequest BuildAmbientGenerateRequest(
        ReactionLoopRegistration registration,
        GenerationIntent intent,
        GenerationTier tier)
    {
        var topic = intent.AmbientTopicSeed is { } seed && AmbientTopics.IsKnown(seed)
            ? AmbientTopics.SeedPhrase(seed)
            : throw new InvalidOperationException("An ambient intent must carry a topic seed from the vocabulary.");

        return new GenerateStageRequest
        {
            ExerciseId = registration.ExerciseId,
            ExerciseBrief = registration.ExerciseBrief,
            Storyline = new StorylineBrief
            {
                Title = $"Everyday background chatter about {topic} (not about any incident)",
                Expectation = "Nothing: this is ordinary daily life. Do not mention the incident, officials, emergencies or any storyline.",
                MinutesSinceLastOfficialResponse = 0,
                Intensity = 0,
                Phase = "AMBIENT",
                ToneMix = intent.ToneMix,
            },
            Personas = intent.Personas,
            Tier = tier,
        };
    }

    /// <summary>
    /// The review item for a <c>review</c>-mode ambient draft: always QUEUED at Suggest (never a countdown, so silence
    /// can never publish it — AC8), stamped with the tick's resolved scope (COR-001), no storyline.
    /// </summary>
    private static EngineReviewItemEntity BuildAmbientReviewItem(
        Guid exerciseId,
        GenerationIntent intent,
        IReadOnlyList<GeneratedPost> posts,
        Guid draftId)
    {
        var topic = intent.AmbientTopicSeed ?? "ambient";
        var draftPosts = new List<EngineReviewDraftPost>();
        var count = Math.Min(posts.Count, intent.Personas.Count);
        for (var i = 0; i < count; i++)
        {
            draftPosts.Add(new EngineReviewDraftPost
            {
                PersonaHandle = intent.Personas[i].Handle,
                Text = EngineDraftText.FitToCeiling(posts[i].Text),
                Sentiment = posts[i].Sentiment,
                Hashtags = posts[i].Hashtags.ToList(),
            });
        }

        return new EngineReviewItemEntity
        {
            DraftId = draftId,
            ExerciseId = exerciseId,
            StorylineId = Guid.Empty,
            RoutedAtLevel = AutonomyLevel.Suggest,
            Disposition = DraftDisposition.Queued,
            CountdownStartedScenarioMinute = null,
            CountdownMinutes = null,
            CountdownDecision = null,
            StorylineTag = "#ambient",
            StorylineBrief = $"Ambient chatter · {topic}",
            ActionLabel = $"ambient · {topic}",
            Posts = draftPosts,
        };
    }

    /// <summary>One publishable post per generated post, attributed by position to the allow-listed persona instance.</summary>
    private static List<EngineBurstPost> BuildAmbientBurstPosts(
        ReactionLoopRegistration registration,
        GenerationIntent intent,
        IReadOnlyList<GeneratedPost> posts)
    {
        var burstPosts = new List<EngineBurstPost>();
        var count = Math.Min(posts.Count, intent.Personas.Count);
        for (var i = 0; i < count; i++)
        {
            var handle = intent.Personas[i].Handle;
            if (!registration.PersonasByHandle.TryGetValue(handle, out var persona))
            {
                continue; // never attribute to a persona outside the loop's cast
            }

            burstPosts.Add(new EngineBurstPost
            {
                PersonaId = persona.InstanceId,
                PersonaHandle = handle,
                Text = EngineDraftText.FitToCeiling(posts[i].Text),
                Sentiment = posts[i].Sentiment,
                Hashtags = posts[i].Hashtags.ToList(),
                ScenarioTime = string.Empty, // stamped at the publish boundary (scenario time, COR-053)
            });
        }

        return burstPosts;
    }

    /// <summary>The exercise's current scenario instant, round-trip formatted (COR-053; never the wall clock).</summary>
    private string CurrentScenarioTime(ReactionLoopRegistration registration) =>
        (_exerciseClock.CurrentScenarioTime(registration.ExerciseId) ?? registration.ScenarioStart)
            .ToString("O", System.Globalization.CultureInfo.InvariantCulture);

    private TelemetryEvent BuildAmbientDecidedEvent(
        EngineTelemetryContext context,
        GenerationIntent intent,
        int postsThisMinute,
        string? publishPath,
        string? heldReason)
    {
        var payload = new EngineEventPayloads.Decided
        {
            Storyline = Guid.Empty.ToString(),
            Personas = intent.Personas.Select(persona => persona.Handle).ToList(),
            ToneMix = "ambient",
            Count = intent.Count,
            AutonomyLevel = intent.AutonomyLevel,
            RateCapState = postsThisMinute > 0 ? "in-window" : "ok",
            Trigger = EngineEventPayloads.AmbientFloorTrigger,
            PublishPath = publishPath,
            HeldReason = heldReason,
        };

        return _telemetryEmitter.BuildEvent(EngineEventTypes.Decided, context, payload);
    }

    private TelemetryEvent BuildAmbientGeneratedEvent(
        EngineTelemetryContext context,
        Guid draftId,
        GenerateStageResult result,
        string? publishPath,
        string? heldReason)
    {
        var generation = result.Generation;
        var usage = generation?.Usage ?? new GenerationUsage(0, 0);
        var payload = new EngineEventPayloads.Generated
        {
            Storyline = Guid.Empty.ToString(),
            DraftId = draftId.ToString(),
            Provider = generation?.ProviderName ?? "unknown",
            Model = generation?.Model ?? "unknown",
            TokenUsage = new EngineEventPayloads.TokenUsage
            {
                InputTokens = usage.InputTokens,
                OutputTokens = usage.OutputTokens,
                CacheReadInputTokens = usage.CacheReadInputTokens,
                CacheCreationInputTokens = usage.CacheCreationInputTokens,
            },
            LatencyMs = generation?.Latency.TotalMilliseconds ?? 0.0,
            GuardResult = result.GuardResult,
            Trigger = EngineEventPayloads.AmbientFloorTrigger,
            PublishPath = publishPath,
            HeldReason = heldReason,
        };

        return _telemetryEmitter.BuildEvent(EngineEventTypes.Generated, context, payload);
    }

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Error,
        Message = "Ambient chatter skipped this tick for exercise {ExerciseId} after a fault; nothing was published by the failed step.")]
    private partial void LogAmbientFailed(Exception exception, Guid exerciseId);

    /// <summary>The per-tick inputs the ambient branch reads (all server-derived; COR-001).</summary>
    private sealed record AmbientTickInputs(
        ReactionLoopRegistration Registration,
        IServiceProvider ScopedServices,
        PulseDbContext DbContext,
        EngineTelemetryContext Context,
        ExerciseTickState TickState,
        int ScenarioMinute,
        DateTimeOffset ScenarioInstant,
        int StorylineIntents);

    /// <summary>
    /// Per-exercise ambient runtime state: the rolling wall-clock spend window (posts generated, per AC4's per-minute
    /// and per-hour caps) and the last recorded hold, so a hold is recorded once per episode, not every tick.
    /// Process memory, like the policy itself.
    /// </summary>
    private sealed class AmbientWindow
    {
        private readonly Queue<(DateTimeOffset At, int Count)> _generated = new();
        private readonly Lock _gate = new();
        private string? _lastHeld;

        public void Record(DateTimeOffset at, int count)
        {
            lock (_gate)
            {
                _generated.Enqueue((at, count));
                while (_generated.Count > 0 && _generated.Peek().At < at - TimeSpan.FromHours(1))
                {
                    _generated.Dequeue();
                }
            }
        }

        public int CountSince(DateTimeOffset since)
        {
            lock (_gate)
            {
                return _generated.Where(entry => entry.At > since).Sum(entry => entry.Count);
            }
        }

        public bool TryMarkHeld(string reason)
        {
            lock (_gate)
            {
                if (string.Equals(_lastHeld, reason, StringComparison.Ordinal))
                {
                    return false;
                }

                _lastHeld = reason;
                return true;
            }
        }

        public void ClearHeld()
        {
            lock (_gate)
            {
                _lastHeld = null;
            }
        }
    }
}
