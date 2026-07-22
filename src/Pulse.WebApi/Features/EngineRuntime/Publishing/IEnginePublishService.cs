namespace Pulse.WebApi.Features.EngineRuntime.Publishing;

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

/// <summary>
/// The SINGLE publish funnel for engine content (E8 architecture §3.6, SOC-003). Story 01 owns the
/// implementation, which routes every post through B1's <c>PostIngestService.IngestAsync</c> with
/// <c>origin:'engine'</c> so an engine post is indistinguishable from any other ordinary post on read
/// (XC-002). Story 02's approve / edit / batch-approve / auto-send paths call this SAME method — there is
/// exactly one publish path, not a second one per surface (implementation.md open question (c), decided).
/// </summary>
/// <remarks>
/// This is a contract-first seam frozen in Wave 0: interface + input/result types only, NO implementation
/// and NO DI registration (story 01 provides both). Publish scope is server-authoritative: the burst's
/// <see cref="EngineBurst.ExerciseId"/> is the trusted, non-request-bound scope the loop establishes for the
/// ingest unit of work (implementation.md open question (b)); it is never client-derived.
/// </remarks>
public interface IEnginePublishService
{
    /// <summary>
    /// Publishes an engine burst — a set of generated posts for one exercise + storyline + draft — as
    /// ordinary posts. Each post is routed through the blessed ingest funnel; the result reports the outcome
    /// per post.
    /// </summary>
    /// <param name="burst">The burst to publish (exercise, storyline, draft, and its generated posts).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The per-post publish outcome for the burst.</returns>
    Task<EngineBurstPublishResult> PublishBurstAsync(EngineBurst burst, CancellationToken cancellationToken = default);
}

/// <summary>
/// One engine burst to publish — the input to <see cref="IEnginePublishService.PublishBurstAsync"/>. Carries
/// the trusted, server-authoritative scope (<see cref="ExerciseId"/>) and the storyline/draft identity the
/// telemetry + review item reference, plus the generated posts to ingest.
/// </summary>
public sealed record EngineBurst
{
    /// <summary>The owning exercise run (COR-001) — the server-authoritative publish scope, never client-derived.</summary>
    public required Guid ExerciseId { get; init; }

    /// <summary>The storyline the burst voices.</summary>
    public required Guid StorylineId { get; init; }

    /// <summary>The stable draft/burst identity (matches the review item's draft id and the telemetry <c>draftId</c>).</summary>
    public required Guid DraftId { get; init; }

    /// <summary>
    /// The exercise IANA time zone (XC-008) used to build each post's XC-004 envelope. One zone per exercise,
    /// so it is a burst-level field rather than per-post.
    /// </summary>
    public required string TimeZone { get; init; }

    /// <summary>The generated posts to publish, in order.</summary>
    public required IReadOnlyList<EngineBurstPost> Posts { get; init; }
}

/// <summary>
/// One generated post within an <see cref="EngineBurst"/> — everything needed to build a
/// <c>CreatePostRequest</c> for the ingest funnel. The engine attributes each post to a persona INSTANCE
/// (<see cref="PersonaId"/>); <see cref="PersonaHandle"/> is carried for telemetry/diagnostics and to
/// resolve the instance where a caller starts from the generated handle.
/// </summary>
public sealed record EngineBurstPost
{
    /// <summary>The persona instance id the post is authored as (the <c>authorPersonaId</c> ingest field).</summary>
    public required Guid PersonaId { get; init; }

    /// <summary>The persona handle the draft was generated for (telemetry/diagnostics; resolves to <see cref="PersonaId"/>).</summary>
    public required string PersonaHandle { get; init; }

    /// <summary>The (already guard-filtered) post text; re-sanitized on the ingest path (NFR-004).</summary>
    public required string Text { get; init; }

    /// <summary>The generated sentiment for the post (telemetry/measure input).</summary>
    public required double Sentiment { get; init; }

    /// <summary>The post's hashtags.</summary>
    public required IReadOnlyList<string> Hashtags { get; init; }

    /// <summary>The scenario ISO-8601 instant (COR-053) to stamp the post at.</summary>
    public required string ScenarioTime { get; init; }

    /// <summary>The channel the post publishes to (the v1 engine drives <c>social</c>).</summary>
    public string Channel { get; init; } = "social";
}

/// <summary>The outcome of publishing an <see cref="EngineBurst"/> — one <see cref="EnginePublishedPost"/> per burst post.</summary>
public sealed record EngineBurstPublishResult
{
    /// <summary>The per-post outcomes, in burst order.</summary>
    public required IReadOnlyList<EnginePublishedPost> Posts { get; init; }
}

/// <summary>The publish outcome for a single burst post.</summary>
public sealed record EnginePublishedPost
{
    /// <summary>The persona handle the post was generated for (correlates back to the burst post).</summary>
    public required string PersonaHandle { get; init; }

    /// <summary>The published post's id — non-null only when <see cref="Outcome"/> is <see cref="EnginePublishOutcome.Published"/>.</summary>
    public Guid? PostId { get; init; }

    /// <summary>Which outcome occurred for this post.</summary>
    public required EnginePublishOutcome Outcome { get; init; }

    /// <summary>A human-readable reason — non-null only when <see cref="Outcome"/> is <see cref="EnginePublishOutcome.Invalid"/>.</summary>
    public string? Error { get; init; }
}

/// <summary>The outcome kind for one published burst post — mirrors <c>PostIngestOutcome</c> at the burst granularity.</summary>
public enum EnginePublishOutcome
{
    /// <summary>The post was ingested and published as an ordinary post.</summary>
    Published,

    /// <summary>The post failed ingest validation (400-equivalent).</summary>
    Invalid,

    /// <summary>No exercise scope was resolved for the publish unit of work — fail closed (COR-001).</summary>
    ScopeUnresolved,
}
