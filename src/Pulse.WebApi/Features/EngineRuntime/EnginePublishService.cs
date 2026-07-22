namespace Pulse.WebApi.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Publishing;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Pulse.WebApi.Features.Social;

/// <summary>
/// The single publish funnel for engine content (E8 architecture §3.6, SOC-003) — the Wave-0
/// <see cref="IEnginePublishService"/> seam story 01 owns and story 02's approve/edit/batch/auto-send paths
/// also call. Every post is routed through B1's blessed <see cref="PostIngestService.IngestAsync"/> with
/// <c>origin:'engine'</c>, so an engine post is indistinguishable from any other ordinary post on read
/// (XC-002). There is exactly ONE publish path, not a second one per surface.
/// </summary>
/// <remarks>
/// <para>
/// <b>Server-authoritative scope for a non-request-bound caller (COR-001, Tier-2 — the load-bearing 01
/// concern).</b> <see cref="PostIngestService"/> reads its scope <i>only</i> from a scoped
/// <see cref="IExerciseContext"/> and fails closed when unresolved — but the reaction loop has no HTTP
/// request, so this funnel establishes the scope itself: it creates a per-exercise
/// <see cref="IServiceScope"/>, sets <see cref="ExerciseContext.CurrentExerciseId"/> to the burst's trusted
/// <see cref="EngineBurst.ExerciseId"/> BEFORE resolving <see cref="PostIngestService"/> in that scope, then
/// ingests. The scope is taken from the burst (server-authoritative), never from a client body, and is
/// established fresh for every publish unit of work — independent of B2, so a request-bound caller (story 02)
/// gets the same isolation guarantee. A burst for exercise A can only ever write into exercise A; a
/// <see cref="Guid.Empty"/> scope collapses to <see cref="EnginePublishOutcome.ScopeUnresolved"/> (fail
/// closed), writing nothing.
/// </para>
/// <para>
/// Registered as a SINGLETON: it holds no per-request state and it always builds its own scope, so both the
/// background loop and a request-bound approve call resolve the same instance and get the same behaviour.
/// </para>
/// </remarks>
public sealed class EnginePublishService : IEnginePublishService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IEngineTelemetryEmitter _telemetryEmitter;
    private readonly TimeProvider _timeProvider;

    /// <summary>Creates the publish funnel over the scope factory, telemetry emitter, and server clock.</summary>
    /// <param name="scopeFactory">Creates the per-exercise <see cref="IServiceScope"/> each publish unit of work runs in.</param>
    /// <param name="telemetryEmitter">Builds the XC-004 <c>engine.published</c> events.</param>
    /// <param name="timeProvider">The server wall-clock source (never client input) for the telemetry envelope.</param>
    public EnginePublishService(
        IServiceScopeFactory scopeFactory,
        IEngineTelemetryEmitter telemetryEmitter,
        TimeProvider timeProvider)
    {
        ArgumentNullException.ThrowIfNull(scopeFactory);
        ArgumentNullException.ThrowIfNull(telemetryEmitter);
        ArgumentNullException.ThrowIfNull(timeProvider);

        _scopeFactory = scopeFactory;
        _telemetryEmitter = telemetryEmitter;
        _timeProvider = timeProvider;
    }

    /// <inheritdoc />
    public async Task<EngineBurstPublishResult> PublishBurstAsync(
        EngineBurst burst,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(burst);

        var outcomes = new List<EnginePublishedPost>(burst.Posts.Count);
        if (burst.Posts.Count == 0)
        {
            return new EngineBurstPublishResult { Posts = outcomes };
        }

        // One server clock read shared across every telemetry event this publish unit of work emits.
        var now = _timeProvider.GetUtcNow();

        // Establish the trusted, server-authoritative exercise scope BEFORE anything scoped is resolved.
        // Create the scope, set the exercise on the scoped ExerciseContext, and only THEN resolve the
        // PostIngestService + PulseDbContext so the context captures the resolved scope at construction.
        using var scope = _scopeFactory.CreateScope();
        var services = scope.ServiceProvider;

        var exerciseContext = services.GetRequiredService<IExerciseContext>();
        if (exerciseContext is ExerciseContext settable)
        {
            settable.CurrentExerciseId = burst.ExerciseId;
        }
        else
        {
            throw new InvalidOperationException(
                "The registered IExerciseContext is not settable; the engine publish funnel cannot establish " +
                "its server-authoritative scope (COR-001).");
        }

        var ingestService = services.GetRequiredService<PostIngestService>();
        var dbContext = services.GetRequiredService<PulseDbContext>();

        var publishedEvents = new List<TelemetryEvent>();

        foreach (var post in burst.Posts)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var request = new CreatePostRequest
            {
                AuthorPersonaId = post.PersonaId.ToString(),
                Text = post.Text,
                ScenarioTime = post.ScenarioTime,
                TimeZone = burst.TimeZone,
                Origin = "engine",
            };

            var result = await ingestService.IngestAsync(request, cancellationToken);

            switch (result.Outcome)
            {
                case PostIngestOutcome.Created when result.Post is { } created:
                    outcomes.Add(new EnginePublishedPost
                    {
                        PersonaHandle = post.PersonaHandle,
                        PostId = created.Id,
                        Outcome = EnginePublishOutcome.Published,
                    });
                    publishedEvents.Add(BuildPublishedEvent(burst, created, now));
                    break;

                case PostIngestOutcome.ScopeUnresolved:
                    // Fail closed — an empty/unresolved burst scope must never publish (COR-001).
                    outcomes.Add(new EnginePublishedPost
                    {
                        PersonaHandle = post.PersonaHandle,
                        Outcome = EnginePublishOutcome.ScopeUnresolved,
                    });
                    break;

                default:
                    outcomes.Add(new EnginePublishedPost
                    {
                        PersonaHandle = post.PersonaHandle,
                        Outcome = EnginePublishOutcome.Invalid,
                        Error = result.ValidationError,
                    });
                    break;
            }
        }

        // Emit exactly one engine.published event per published post, in the SAME scoped unit of work; the
        // write-guard validates ExerciseId != Guid.Empty on each (the burst scope is already resolved).
        if (publishedEvents.Count > 0)
        {
            dbContext.TelemetryEvents.AddRange(publishedEvents);
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        return new EngineBurstPublishResult { Posts = outcomes };
    }

    /// <summary>
    /// Builds the XC-004 <c>engine.published</c> event for one published post — post ref, <c>origin</c>, and
    /// storyline (E8 §11) — against the locked v0 envelope. Scenario time is the persisted post's scenario
    /// instant, round-tripped (never re-derived from the wall clock).
    /// </summary>
    private TelemetryEvent BuildPublishedEvent(EngineBurst burst, Post post, DateTimeOffset wallClock)
    {
        var context = new EngineTelemetryContext
        {
            ExerciseId = burst.ExerciseId,
            WallClockTime = wallClock,
            ScenarioTime = post.CreatedScenarioTime,
            TimeZone = burst.TimeZone,
            Channel = "social",
            Origin = "engine",
            Target = new EngineTelemetryTarget
            {
                EntityType = "post",
                EntityId = post.Id.ToString(),
            },
        };

        var payload = new EngineEventPayloads.Published
        {
            PostRef = post.Id.ToString(),
            Origin = "engine",
            Storyline = burst.StorylineId.ToString(),
        };

        return _telemetryEmitter.BuildEvent(EngineEventTypes.Published, context, payload);
    }
}
