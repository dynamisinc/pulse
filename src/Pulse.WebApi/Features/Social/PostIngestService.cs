namespace Pulse.WebApi.Features.Social;

using System.Globalization;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Realtime;

/// <summary>
/// The server-side realization of <c>createPost</c>'s "blessed ingest path" (<c>postService.ts:12-19</c>):
/// the single funnel EVERY new post flows through — a participant's compose action, a controller operating a
/// persona, a fired MSEL inject, or the future adaptive engine. It sanitizes (NFR-004), stamps the isolation
/// scope + wall-clock server-side (never client input), persists the post, emits exactly one XC-004 <c>post</c>
/// telemetry event, and hands a participant-safe payload to the real-time fan-out. Scoped lifetime, matching
/// the <see cref="PulseDbContext"/> unit of work it writes through.
/// </summary>
/// <remarks>
/// <para>
/// <b>Scope is server-authoritative (COR-001).</b> The owning exercise is read ONLY from the injected
/// <see cref="IExerciseContext"/> — never from anything in the request body. An <c>exerciseId</c> present in
/// the body is ignored for scoping; the resolved scope is stamped unconditionally. If no scope is resolved
/// (per-request population is Phase B2), ingest FAILS CLOSED with
/// <see cref="PostIngestOutcome.ScopeUnresolved"/> and nothing is written.
/// </para>
/// <para>
/// Accepts the full <c>PostOrigin</c> union (<c>participant</c> / <c>controller-as-persona</c> / <c>engine</c>
/// / <c>inject</c>) even though only the first two have a real caller this phase — Phase B3's engine and Phase
/// 4's inject-fire are documented to reuse this funnel verbatim, so the accepted values are NOT narrowed.
/// </para>
/// </remarks>
public sealed class PostIngestService
{
    /// <summary>The <c>PostOrigin</c> union — the only accepted <c>origin</c> values (full union, not narrowed).</summary>
    private static readonly HashSet<string> AllowedOrigins = new(StringComparer.Ordinal)
    {
        "participant",
        "controller-as-persona",
        "engine",
        "inject",
    };

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly IFeedBroadcaster _broadcaster;

    /// <summary>Creates the ingest service with its persistence, scope, and broadcast collaborators.</summary>
    /// <param name="dbContext">The persistence context the post and its telemetry event are written through.</param>
    /// <param name="exerciseContext">The server-authoritative exercise scope (COR-001) — the sole scoping source.</param>
    /// <param name="broadcaster">The contract-first real-time fan-out seam (story 03 owns the implementation).</param>
    public PostIngestService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        IFeedBroadcaster broadcaster)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(broadcaster);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _broadcaster = broadcaster;
    }

    /// <summary>
    /// Ingests one post: validates the request, sanitizes the body, stamps the resolved scope and the server
    /// wall-clock, persists the post together with its single XC-004 telemetry event in ONE unit of work, then
    /// broadcasts the participant-safe projection. Returns a result the endpoint maps to an HTTP status.
    /// </summary>
    /// <param name="request">The create-post request. Any <c>exerciseId</c> it carries is ignored for scoping.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>
    /// <see cref="PostIngestOutcome.ScopeUnresolved"/> when no exercise scope is resolved (fail closed),
    /// <see cref="PostIngestOutcome.Invalid"/> when the request fails validation, or
    /// <see cref="PostIngestOutcome.Created"/> carrying the persisted post.
    /// </returns>
    public async Task<PostIngestResult> IngestAsync(CreatePostRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        // 1. Scope comes ONLY from IExerciseContext (COR-001). Fail closed on an unresolved scope: a null (or
        //    empty-sentinel) scope is a closed door — 401/403 at the endpoint, never a default/unscoped write.
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return PostIngestResult.ScopeUnresolved();
        }

        var exerciseId = scope.Value;

        // 2. Validate (400 on any failure). origin ∈ union; authorPersonaId parses to Guid; conditional
        //    attribution (COR-018) and inject id; scenarioTime parses as ISO; the envelope's required fields.
        if (request.Origin is null || !AllowedOrigins.Contains(request.Origin))
        {
            return PostIngestResult.Invalid("origin must be one of participant, controller-as-persona, engine, inject.");
        }

        var origin = request.Origin;

        if (!Guid.TryParse(request.AuthorPersonaId, out var authorPersonaId) || authorPersonaId == Guid.Empty)
        {
            return PostIngestResult.Invalid("authorPersonaId must be a non-empty GUID.");
        }

        if (request.Text is null)
        {
            return PostIngestResult.Invalid("text is required.");
        }

        if (string.IsNullOrEmpty(request.TimeZone))
        {
            return PostIngestResult.Invalid("timeZone is required.");
        }

        if (string.Equals(origin, "controller-as-persona", StringComparison.Ordinal)
            && string.IsNullOrEmpty(request.ActingHumanId))
        {
            // COR-018: the operating controller behind the shared persona MUST be attributed.
            return PostIngestResult.Invalid("actingHumanId is required when origin is 'controller-as-persona' (COR-018).");
        }

        if (string.Equals(origin, "inject", StringComparison.Ordinal)
            && string.IsNullOrEmpty(request.InjectId))
        {
            return PostIngestResult.Invalid("injectId is required when origin is 'inject'.");
        }

        if (!DateTimeOffset.TryParse(
                request.ScenarioTime,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal,
                out var scenarioTime))
        {
            return PostIngestResult.Invalid("scenarioTime must be an ISO-8601 instant.");
        }

        // 3. Sanitize server-side (NFR-004) — strip, never encode.
        var body = PostSanitizer.Sanitize(request.Text);

        // actingHumanId is stored for every origin (the Post column is NOT NULL — COR-018 telemetry/staff-only).
        var actingHumanId = request.ActingHumanId ?? string.Empty;
        var injectId = string.IsNullOrEmpty(request.InjectId) ? null : request.InjectId;

        // One server clock read shared by the persisted ingest instant and the telemetry timestamps.
        var now = DateTimeOffset.UtcNow;

        // 4. Build the post. ExerciseId is STAMPED from the resolved scope (never the client body); CreatedWallClock
        //    is the SERVER clock (never client). CreatedScenarioTime is client-supplied this phase (COR-050 backend
        //    clock is B3). Provenance columns are staff/telemetry-only — never projected onto a participant response.
        var post = new Post
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            AuthorPersonaId = authorPersonaId,
            Body = body,
            CreatedScenarioTime = scenarioTime,
            CreatedWallClock = now,
            Origin = origin,
            ActingHumanId = actingHumanId,
            InjectId = injectId,
        };

        // 5. Exactly ONE XC-004 'post' event, server-side, against the locked v0 envelope. actor.kind is always
        //    'persona' — even an engine-/inject-origin post is attributed to the persona it was posted AS; `origin`
        //    (on the envelope) carries the provenance distinction. Correlation/causation/sequence/source are v0-reserved.
        var telemetryEvent = new TelemetryEvent
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = "v0",
            ExerciseId = exerciseId,
            EventType = "post",
            Channel = "social",
            Actor = new TelemetryActor
            {
                Kind = "persona",
                PersonaId = authorPersonaId.ToString(),
                ActingHumanId = actingHumanId,
            },
            Origin = origin,
            InjectId = injectId,
            WallClockTime = now,
            ScenarioTime = scenarioTime,
            TimeZone = request.TimeZone,
            Target = new TelemetryTarget
            {
                EntityType = "post",
                EntityId = post.Id.ToString(),
            },
            EmittedAt = now,
        };

        // Add the post AND its telemetry event, then persist ONCE — one unit of work. The write-guard validates
        // ExerciseId != Guid.Empty on both scoped rows (COR-001), so exactly one telemetry row lands per post.
        _dbContext.Posts.Add(post);
        _dbContext.TelemetryEvents.Add(telemetryEvent);
        await _dbContext.SaveChangesAsync(cancellationToken);

        // 6. Fan out the participant-safe projection only (XC-002 — the broadcast never carries provenance).
        await _broadcaster.BroadcastPostAsync(exerciseId, ParticipantPostDto.FromPost(post), cancellationToken);

        // 7. Hand the full post back to the endpoint, which shapes the response by caller role.
        return PostIngestResult.Created(post);
    }
}

/// <summary>The outcome kind of a <see cref="PostIngestService.IngestAsync"/> call.</summary>
public enum PostIngestOutcome
{
    /// <summary>The post was sanitized, stamped, persisted, telemetered, and broadcast.</summary>
    Created,

    /// <summary>No exercise scope was resolved for the request — fail closed (the endpoint returns 401/403).</summary>
    ScopeUnresolved,

    /// <summary>The request failed validation (the endpoint returns 400).</summary>
    Invalid,
}

/// <summary>
/// The result of an ingest attempt. Exactly one of the three outcomes applies:
/// <see cref="PostIngestOutcome.Created"/> carries the persisted <see cref="Post"/>;
/// <see cref="PostIngestOutcome.Invalid"/> carries a human-readable <see cref="ValidationError"/>;
/// <see cref="PostIngestOutcome.ScopeUnresolved"/> carries neither (the fail-closed door).
/// </summary>
public sealed class PostIngestResult
{
    private PostIngestResult(PostIngestOutcome outcome, Post? post, string? validationError)
    {
        Outcome = outcome;
        Post = post;
        ValidationError = validationError;
    }

    /// <summary>Which outcome occurred.</summary>
    public PostIngestOutcome Outcome { get; }

    /// <summary>The persisted post — non-null only when <see cref="Outcome"/> is <see cref="PostIngestOutcome.Created"/>.</summary>
    public Post? Post { get; }

    /// <summary>The validation message — non-null only when <see cref="Outcome"/> is <see cref="PostIngestOutcome.Invalid"/>.</summary>
    public string? ValidationError { get; }

    /// <summary>The fail-closed result for an unresolved exercise scope.</summary>
    /// <returns>A <see cref="PostIngestOutcome.ScopeUnresolved"/> result.</returns>
    public static PostIngestResult ScopeUnresolved() =>
        new(PostIngestOutcome.ScopeUnresolved, null, null);

    /// <summary>A rejected request.</summary>
    /// <param name="validationError">The human-readable reason.</param>
    /// <returns>A <see cref="PostIngestOutcome.Invalid"/> result.</returns>
    public static PostIngestResult Invalid(string validationError) =>
        new(PostIngestOutcome.Invalid, null, validationError);

    /// <summary>A successful ingest.</summary>
    /// <param name="post">The persisted post.</param>
    /// <returns>A <see cref="PostIngestOutcome.Created"/> result.</returns>
    public static PostIngestResult Created(Post post)
    {
        ArgumentNullException.ThrowIfNull(post);
        return new PostIngestResult(PostIngestOutcome.Created, post, null);
    }
}
