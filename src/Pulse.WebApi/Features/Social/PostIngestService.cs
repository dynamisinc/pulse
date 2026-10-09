namespace Pulse.WebApi.Features.Social;

using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social.Threads;

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
/// the body is ignored for scoping; the resolved scope is stamped unconditionally. If no scope is resolved,
/// ingest FAILS CLOSED with <see cref="PostIngestOutcome.ScopeUnresolved"/> and nothing is written.
/// </para>
/// <para>
/// <b>Attribution is server-authoritative too (COR-018, <c>identity-auth-roles/12</c>).</b> Scope was already;
/// as of that story <c>authorPersonaId</c>, <c>origin</c> and <c>actingHumanId</c> are as well. They arrive as a
/// <see cref="PostAttribution"/> parameter and are NEVER read from <see cref="CreatePostRequest"/> — the DTO's
/// corresponding fields are inert on this path. Each caller answers "who is really posting" before calling:
/// the HTTP boundary derives it from the caller's persisted session
/// (<see cref="PostAttributionResolver"/>), and the engine's in-process publish funnel states it directly
/// (<c>EnginePublishService.cs:116</c> — there is no HTTP session behind the reaction loop). This service
/// therefore does NOT require a session: doing so would break the engine and the review-cockpit paths that
/// funnel through it. What it still does is re-validate the stated attribution, which is the defense-in-depth
/// that keeps an in-process caller honest.
/// </para>
/// <para>
/// Accepts the full <c>PostOrigin</c> union (<c>participant</c> / <c>controller-as-persona</c> / <c>engine</c>
/// / <c>inject</c>) because all four have a real caller: the first two over HTTP, <c>engine</c> from the
/// reaction loop, and <c>inject</c> from Phase 4's MSEL fire, which reuses this funnel verbatim. Which of them
/// an HTTP caller may CLAIM is a narrower question, answered upstream by
/// <see cref="PostAttributionResolver"/> (only <c>participant</c> and <c>controller-as-persona</c> are
/// reachable over HTTP at all).
/// </para>
/// <para>
/// <b>Media, replies and the engagement baseline (demo-polish BP).</b> Attachments are validated against the
/// caller's exercise (and, for a participant, against the caller's own uploads) and written as
/// <see cref="PostMediaItem"/> rows in the SAME unit of work as the post and its event. A reply parent is
/// resolved through the <see cref="IReplyParentResolver"/> seam (DP-8). The seeded engagement baseline is honoured
/// only for a staff <c>controller-as-persona</c> write. The broadcast carries the participant projection
/// (<see cref="IParticipantPostProjector"/>), without viewer state.
/// </para>
/// </remarks>
public sealed partial class PostIngestService
{
    /// <summary>The <c>PostOrigin</c> union — the only accepted <c>origin</c> values (full union, not narrowed).</summary>
    private static readonly HashSet<string> AllowedOrigins = new(StringComparer.Ordinal)
    {
        "participant",
        "controller-as-persona",
        "engine",
        "inject",
    };

    /// <summary>The <c>origin</c> of a participant writing as their own bound persona.</summary>
    private const string ParticipantOrigin = "participant";

    /// <summary>The <c>origin</c> of a staff console operating a persona — the only one that may seed a baseline.</summary>
    private const string ControllerAsPersonaOrigin = "controller-as-persona";

    /// <summary>The most images one post may carry.</summary>
    private const int MaxImagesPerPost = 4;

    /// <summary>The largest seeded engagement baseline a staff write may set, per count.</summary>
    private const int MaxEngagementBaseline = 1_000_000;

    /// <summary>
    /// The longest SANITIZED post text, in UTF-16 code units (Wave 1b Gate-2 L-3): about seven times the
    /// 280-character composer default (the participant composer, the staff persona composer, the run-sheet and the
    /// seed pack all cap post text at 280 code points; the engine is prompted for short posts). Longer is a 400. It
    /// also sizes <see cref="MaxRawTextLength"/> and the <c>POST /api/posts</c> body limit.
    /// </summary>
    public const int TextLengthCeiling = 2_000;

    /// <summary>
    /// The longest RAW <c>text</c> accepted (4 × <see cref="TextLengthCeiling"/>). Anything longer is a 400 BEFORE
    /// the sanitizer runs (Wave 1b DoS fix): the bound applies to every caller, the in-process engine publish
    /// included, which the HTTP body limit never sees.
    /// </summary>
    public const int MaxRawTextLength = 4 * TextLengthCeiling;

    /// <summary>
    /// The 400 for text that is too long, raw or sanitized (the same message for both, like alt text). Public so
    /// the engine review edit path answers an over-long staff edit with the very same text.
    /// </summary>
    public static readonly string TextTooLongMessage = $"text must be at most {TextLengthCeiling} characters.";

    /// <summary>The longest RAW media <c>alt</c> accepted (4 × <see cref="PostMediaItem.MaxAltLength"/>), checked before sanitizing.</summary>
    public const int MaxRawAltLength = 4 * PostMediaItem.MaxAltLength;

    /// <summary>The 400 for alt text that is too long, raw or sanitized (the same message for both).</summary>
    private const string AltTooLongMessage = "alt text must be at most 1000 characters.";

    /// <summary>
    /// The ONE message for any attachment id that does not resolve to a usable asset: unparseable, unknown, in
    /// another exercise, or (for a participant) uploaded by someone else. Identical text, so the response never
    /// confirms that another exercise's or another participant's asset exists (COR-001, DP-16).
    /// </summary>
    private const string MediaNotFoundMessage = "One or more media items could not be found.";

    /// <summary>
    /// The ONE message for a reply parent that does not resolve: unparseable, unknown, in another exercise, or
    /// soft-deleted (COR-001, DP-16). Also the answer when no resolver is available.
    /// </summary>
    private const string ParentNotFoundMessage = "parentPostId does not name a post in this exercise.";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly IFeedBroadcaster _broadcaster;
    private readonly IReadOnlyList<IPostPublishedObserver> _observers;
    private readonly ILogger<PostIngestService> _logger;
    private readonly IReplyParentResolver? _replyParentResolver;
    private readonly IParticipantPostProjector? _projector;

    /// <summary>Creates the ingest service with its persistence, scope, and broadcast collaborators.</summary>
    /// <param name="dbContext">The persistence context the post and its telemetry event are written through.</param>
    /// <param name="exerciseContext">The server-authoritative exercise scope (COR-001) — the sole scoping source.</param>
    /// <param name="broadcaster">The contract-first real-time fan-out seam (story 03 owns the implementation).</param>
    /// <param name="observers">
    /// In-process observers told about each committed post (e.g. the engine's response-reaction inbox,
    /// engine-runtime/06). Optional: DI supplies every registered observer, possibly none.
    /// </param>
    /// <param name="logger">Diagnostics logger for an observer that throws; optional.</param>
    /// <param name="replyParentResolver">
    /// Resolves a reply's <c>parentPostId</c> inside the scope (DP-8). Optional: when absent, a non-empty
    /// <c>parentPostId</c> is refused with a 400 — never written as a silent top-level post.
    /// </param>
    /// <param name="projector">
    /// Builds the participant projection for the broadcast and the response. Optional: when absent, the baseline
    /// view is used — <see cref="ParticipantPostDto.FromPost"/>'s fields with the seeded baseline counts, which is
    /// byte-identical to the pre-demo shape for every caller that sets no baseline and no parent.
    /// </param>
    public PostIngestService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        IFeedBroadcaster broadcaster,
        IEnumerable<IPostPublishedObserver>? observers = null,
        ILogger<PostIngestService>? logger = null,
        IReplyParentResolver? replyParentResolver = null,
        IParticipantPostProjector? projector = null)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(broadcaster);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _broadcaster = broadcaster;
        _observers = observers?.ToList() ?? [];
        _logger = logger ?? NullLogger<PostIngestService>.Instance;
        _replyParentResolver = replyParentResolver;
        _projector = projector;
    }

    /// <summary>
    /// Ingests one post: validates the request, sanitizes the body, stamps the resolved scope and the server
    /// wall-clock, persists the post together with its single XC-004 telemetry event in ONE unit of work, then
    /// broadcasts the participant-safe projection. Returns a result the endpoint maps to an HTTP status.
    /// </summary>
    /// <param name="request">
    /// The create-post request — read ONLY for <c>text</c> / <c>scenarioTime</c> / <c>timeZone</c> /
    /// <c>injectId</c> / <c>media</c> / <c>parentPostId</c> / <c>engagementBaseline</c>. Any <c>exerciseId</c> it
    /// carries is ignored for scoping, and its
    /// <c>authorPersonaId</c> / <c>origin</c> / <c>actingHumanId</c> are ignored entirely in favour of
    /// <paramref name="attribution"/>.
    /// </param>
    /// <param name="attribution">
    /// Who is really posting, established by the caller (COR-018): session-derived at the HTTP boundary,
    /// stated directly by a trusted in-process caller. Never body-derived.
    /// </param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>
    /// <see cref="PostIngestOutcome.ScopeUnresolved"/> when no exercise scope is resolved (fail closed),
    /// <see cref="PostIngestOutcome.Invalid"/> when the request fails validation, or
    /// <see cref="PostIngestOutcome.Created"/> carrying the persisted post.
    /// </returns>
    public async Task<PostIngestResult> IngestAsync(
        CreatePostRequest request,
        PostAttribution attribution,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(attribution);

        // 1. Scope comes ONLY from IExerciseContext (COR-001). Fail closed on an unresolved scope: a null (or
        //    empty-sentinel) scope is a closed door — 401/403 at the endpoint, never a default/unscoped write.
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return PostIngestResult.ScopeUnresolved();
        }

        var exerciseId = scope.Value;

        // 2. Validate (400 on any failure). The three attribution facts are validated against the SERVER-derived
        //    PostAttribution, not the body — for an HTTP caller PostAttributionResolver has already refused
        //    anything worse, so these checks are the defense-in-depth that keeps an IN-PROCESS caller (the
        //    engine burst, Phase 4's inject fire) from writing an unattributed or off-union row.
        if (!AllowedOrigins.Contains(attribution.Origin))
        {
            return PostIngestResult.Invalid("origin must be one of participant, controller-as-persona, engine, inject.");
        }

        var origin = attribution.Origin;
        var authorPersonaId = attribution.AuthorPersonaId;

        if (authorPersonaId == Guid.Empty)
        {
            return PostIngestResult.Invalid("authorPersonaId must be a non-empty GUID.");
        }

        if (request.Text is null)
        {
            return PostIngestResult.Invalid("text is required.");
        }

        // DoS guard: the sanitizer's cost grows with its input, so an oversized raw body is refused before it runs.
        if (request.Text.Length > MaxRawTextLength)
        {
            return PostIngestResult.Invalid(TextTooLongMessage);
        }

        if (string.IsNullOrEmpty(request.TimeZone))
        {
            return PostIngestResult.Invalid("timeZone is required.");
        }

        if (string.Equals(origin, "controller-as-persona", StringComparison.Ordinal)
            && string.IsNullOrEmpty(attribution.ActingHumanId))
        {
            // COR-018: the operating controller behind the shared persona MUST be attributed. Unreachable from
            // HTTP (the resolver stamps the staff user's own id, so it is never empty) — this now guards an
            // in-process caller that states a human-bearing origin without naming the human.
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

        // 2b. demo-polish BP: the engagement baseline (staff only), the attachments and the reply parent. All of
        //     them are settled BEFORE anything is added to the unit of work, so a refusal writes nothing.
        var baseline = ValidateBaseline(request.EngagementBaseline, origin);
        if (baseline.Error is { } baselineError)
        {
            return PostIngestResult.Invalid(baselineError);
        }

        var media = await ResolveMediaAsync(request.Media, exerciseId, origin, attribution.ActingHumanId, cancellationToken);
        if (media.Error is { } mediaError)
        {
            return PostIngestResult.Invalid(mediaError);
        }

        // The parent's author handle is resolved now, with the parent, so the post-commit fallback projection can
        // still carry inReplyTo without another read.
        ResolvedParent? parent = null;
        if (!string.IsNullOrEmpty(request.ParentPostId))
        {
            parent = await ResolveParentAsync(request.ParentPostId, exerciseId, cancellationToken);
            if (parent is null)
            {
                return PostIngestResult.Invalid(ParentNotFoundMessage);
            }
        }

        var parentPostId = parent?.Id;
        var inReplyTo = parent?.InReplyTo;

        // 3. Sanitize server-side (NFR-004) — strip, never encode — then bound what would be stored (L-3). Nothing has
        //    been added to the unit of work yet, so a refusal writes nothing.
        var body = PostSanitizer.Sanitize(request.Text);
        if (body.Length > TextLengthCeiling)
        {
            return PostIngestResult.Invalid(TextTooLongMessage);
        }

        // ONE source of truth for the acting human: the server-derived attribution. The persisted column and the
        // telemetry actor below are both projected from this single local — never from two independently-trusted
        // paths — which is what makes "the post and its event agree" a property of the code rather than a habit.
        // It is stored for every origin (the Post column is NOT NULL — COR-018 telemetry/staff-only).
        var actingHumanId = attribution.ActingHumanId;
        // The telemetry actor's actingHumanId is null-omitted when absent: the locked v0 envelope types
        // actor.actingHumanId as z.string().min(1).optional() — an empty string is OFF-ENVELOPE (rejected by
        // the telemetry/02 sink and the E10 v0 validators). Only a non-human origin (engine / inject) reaches
        // this branch now; every HTTP origin carries a real human. Null-omit exactly the way injectId is below.
        var telemetryActingHumanId = string.IsNullOrEmpty(actingHumanId) ? null : actingHumanId;
        var injectId = string.IsNullOrEmpty(request.InjectId) ? null : request.InjectId;

        // One server clock read shared by the persisted ingest instant and the telemetry timestamps.
        var now = DateTimeOffset.UtcNow;

        // 4. Build the post. ExerciseId is STAMPED from the resolved scope (never the client body); CreatedWallClock
        //    is the SERVER clock (never client); the three provenance columns come from the server-derived
        //    attribution (never the client body). CreatedScenarioTime is client-supplied this phase (COR-050 backend
        //    clock is B3). Provenance is staff/telemetry-only — never projected onto a participant response.
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
            ParentPostId = parentPostId,
            BaselineLikeCount = baseline.Like,
            BaselineRepostCount = baseline.Repost,
            BaselineReplyCount = baseline.Reply,
        };

        // 4b. One PostMediaItem per attachment, in request order, stamped with the SAME scope as the post (DP-2).
        var mediaItems = media.Items
            .Select((item, order) => new PostMediaItem
            {
                Id = Guid.NewGuid(),
                ExerciseId = exerciseId,
                PostId = post.Id,
                MediaAssetId = item.AssetId,
                PosterMediaAssetId = item.PosterId,
                Alt = item.Alt,
                Order = order,
            })
            .ToList();

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
                ActingHumanId = telemetryActingHumanId,
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

        // A reply is the same single event, typed 'reply' and naming its parent (implementation.md §1.8).
        if (parentPostId is { } parentId)
        {
            telemetryEvent.EventType = "reply";
            telemetryEvent.Payload = JsonSerializer.Serialize(new ReplyTelemetryPayload(parentId.ToString()));
        }

        // Add the post, its media items AND its telemetry event, then persist ONCE — one unit of work. The
        // write-guard validates ExerciseId != Guid.Empty on every scoped row (COR-001), so exactly one telemetry
        // row lands per post, and the items land with it or not at all.
        _dbContext.Posts.Add(post);
        _dbContext.PostMediaItems.AddRange(mediaItems);
        _dbContext.TelemetryEvents.Add(telemetryEvent);
        await _dbContext.SaveChangesAsync(cancellationToken);

        // 6. Tell in-process observers (the engine's response-reaction inbox, engine-runtime/06) the moment the
        //    post is committed: never before, so nothing reacts to a post that failed to persist, and before the
        //    projection and broadcast, so nothing slow or failing there can delay or strand a committed answer
        //    outside the engine.
        NotifyObservers(exerciseId, post);

        // 7. Fan out the participant-safe projection only (XC-002 — the broadcast never carries provenance or a
        //    baseline). No viewer state: one payload goes to every member of the exercise group. The request's token
        //    is NOT passed from here on (as B6's takedown does): the post has committed, so a client that disconnects
        //    now must not cancel the projection or the broadcast — its retry would DUPLICATE the post, never re-send
        //    the push (Wave 1b Gate-2 L-1). A broadcast failure is logged, never surfaced (as B6's takedown does):
        //    the post has committed, so a throw here would answer 500 (whose retry duplicates the post) and abort an
        //    engine burst mid-loop. Connected participants pick the post up on their next feed read.
        var participantView = await ProjectCommittedPostAsync(post, mediaItems.Count > 0, inReplyTo, CancellationToken.None);
        try
        {
            await _broadcaster.BroadcastPostAsync(exerciseId, participantView, CancellationToken.None);
        }
#pragma warning disable CA1031 // A broadcast fault must never turn a committed post into a failed request.
        catch (Exception ex)
        {
            LogPostBroadcastFailed(ex, exerciseId, post.Id);
        }
#pragma warning restore CA1031

        // 8. Hand the full post (and its projection) back to the endpoint, which shapes the response by caller role.
        return PostIngestResult.Created(post, participantView);
    }

    /// <summary>
    /// Builds the participant projection of a post that has ALREADY COMMITTED, for the broadcast and the 201.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A post with no media and no parent skips the projector (Gate-1 L-1): its projection is exactly the baseline
    /// view built here — a new post has no real engagement, no media to sign and no parent to name — so the
    /// projector's queries would buy nothing. The same view is used when no projector is registered.
    /// </para>
    /// <para>
    /// <b>A projection failure never fails the write (Gate-1 M-1).</b> The post is committed and observers have
    /// been told, so a throw here would leave it unbroadcast, answer the caller 500 (whose retry duplicates the
    /// post) and abort an engine burst mid-loop. Any failure is logged and answered with the baseline view instead:
    /// counts = baseline, the already-resolved <c>inReplyTo</c>, and no media. The caller passes
    /// <see cref="CancellationToken.None"/> (the post has committed), so a cancellation here is never the caller's
    /// and is absorbed like any other failure. An <see cref="ExerciseScopeViolationException"/> keeps the same
    /// fallback (the baseline view is built from this post alone, inside the resolved scope) but is logged at
    /// ERROR: it means the projector saw an out-of-scope row, an isolation signal (Wave 1b Gate-2 L-4).
    /// </para>
    /// </remarks>
    private async Task<ParticipantPostDto> ProjectCommittedPostAsync(
        Post post, bool hasMedia, PostInReplyToDto? inReplyTo, CancellationToken cancellationToken)
    {
        if (_projector is null || (!hasMedia && inReplyTo is null))
        {
            return BaselineView(post, inReplyTo);
        }

        try
        {
            return (await _projector.ProjectAsync([post], new PostProjectionOptions(), cancellationToken))[0];
        }
        catch (ExerciseScopeViolationException ex)
        {
            LogProjectionScopeViolation(ex, post.Id);
            return BaselineView(post, inReplyTo);
        }
#pragma warning disable CA1031 // A projection fault must never fail a post that has already committed.
        catch (Exception ex)
        {
            LogProjectionFailed(ex, post.Id);
            return BaselineView(post, inReplyTo);
        }
#pragma warning restore CA1031
    }

    /// <summary>
    /// The participant view of a just-committed post without the projector: <see cref="ParticipantPostDto.FromPost"/>'s
    /// participant-safe fields, counts = the seeded baseline (a new post has no real engagement), and
    /// <paramref name="inReplyTo"/>. No provenance and no baseline field (XC-002).
    /// </summary>
    private static ParticipantPostDto BaselineView(Post post, PostInReplyToDto? inReplyTo)
    {
        var view = ParticipantPostDto.FromPost(post);
        return new ParticipantPostDto
        {
            Id = view.Id,
            AuthorPersonaId = view.AuthorPersonaId,
            Text = view.Text,
            ScenarioTime = view.ScenarioTime,
            Counts = new ParticipantPostCounts(post.BaselineReplyCount, post.BaselineRepostCount, post.BaselineLikeCount),
            InReplyTo = inReplyTo,
        };
    }

    /// <summary>
    /// Validates the seeded engagement baseline. It is honoured ONLY for a staff <c>controller-as-persona</c>
    /// write (the console seeding the fiction); for every other origin it is ignored entirely, so a participant
    /// can neither set nor probe it. Each supplied value must be 0..1,000,000; an omitted value is 0.
    /// </summary>
    private static BaselineResolution ValidateBaseline(EngagementBaselineRequest? requested, string origin)
    {
        if (requested is null || !string.Equals(origin, ControllerAsPersonaOrigin, StringComparison.Ordinal))
        {
            return BaselineResolution.Zero;
        }

        if (!InBaselineRange(requested.Like) || !InBaselineRange(requested.Repost) || !InBaselineRange(requested.Reply))
        {
            return new BaselineResolution(0, 0, 0, "engagementBaseline values must be between 0 and 1000000.");
        }

        return new BaselineResolution(requested.Like ?? 0, requested.Repost ?? 0, requested.Reply ?? 0, null);
    }

    private static bool InBaselineRange(int? value) => value is null or (>= 0 and <= MaxEngagementBaseline);

    /// <summary>
    /// Validates the requested attachments and resolves them to in-scope assets: at most four images or exactly
    /// one video (never mixed), no duplicate ids, sanitized alt text of 1..1000 characters, and every asset and
    /// poster found in the CALLER's exercise. A participant may attach only assets they uploaded themselves.
    /// </summary>
    /// <remarks>
    /// <b>DP-6 legacy placeholders.</b> The pre-demo frontend sends <c>media: [{kind, alt}]</c> with no
    /// <c>mediaId</c>. When NO entry has a <c>mediaId</c>, the entries are ignored (logged) and the post is
    /// written as text. A mix of entries with and without one is refused.
    /// </remarks>
    private async Task<MediaResolution> ResolveMediaAsync(
        IReadOnlyList<CreatePostMediaRequest?>? requested,
        Guid exerciseId,
        string origin,
        string actingHumanId,
        CancellationToken cancellationToken)
    {
        if (requested is null || requested.Count == 0)
        {
            return MediaResolution.None;
        }

        var withMediaId = requested.Count(entry => !string.IsNullOrEmpty(entry?.MediaId));
        if (withMediaId == 0)
        {
            LogLegacyMediaIgnored(requested.Count, exerciseId);
            return MediaResolution.None;
        }

        if (withMediaId != requested.Count)
        {
            return MediaResolution.Invalid(
                "Every media entry must carry a mediaId; entries without one cannot be mixed with attachments.");
        }

        if (requested.Count > MaxImagesPerPost)
        {
            return MediaResolution.Invalid(MediaCountMessage());
        }

        var items = new List<RequestedMedia>(requested.Count);
        foreach (var entry in requested)
        {
            if (!TryParseId(entry!.MediaId, out var assetId))
            {
                return MediaResolution.Invalid(MediaNotFoundMessage);
            }

            Guid? posterId = null;
            if (!string.IsNullOrEmpty(entry.PosterMediaId))
            {
                if (!TryParseId(entry.PosterMediaId, out var parsedPosterId))
                {
                    return MediaResolution.Invalid(MediaNotFoundMessage);
                }

                posterId = parsedPosterId;
            }

            // DoS guard first (the raw alt is bounded before the sanitizer runs), then NFR-004 strip-not-encode, then
            // NFR-001: alt text is required on every attachment.
            if (entry.Alt is { Length: > MaxRawAltLength })
            {
                return MediaResolution.Invalid(AltTooLongMessage);
            }

            var alt = PostSanitizer.Sanitize(entry.Alt ?? string.Empty).Trim();
            if (alt.Length == 0)
            {
                return MediaResolution.Invalid("alt text is required on every media item.");
            }

            if (alt.Length > PostMediaItem.MaxAltLength)
            {
                return MediaResolution.Invalid(AltTooLongMessage);
            }

            items.Add(new RequestedMedia(assetId, posterId, alt));
        }

        if (items.DistinctBy(item => item.AssetId).Count() != items.Count)
        {
            return MediaResolution.Invalid("The same mediaId cannot be attached twice.");
        }

        // ONE scoped lookup for every attachment and poster. The explicit ExerciseId predicate restates the
        // central filter at the call site (defense in depth, DP-16): another exercise's asset is invisible here,
        // exactly like an unknown id.
        var ids = items
            .Select(item => item.AssetId)
            .Concat(items.Where(item => item.PosterId is not null).Select(item => item.PosterId!.Value))
            .Distinct()
            .ToArray();

        var assets = await _dbContext.MediaAssets
            .AsNoTracking()
            .Where(asset => ids.Contains(asset.Id) && asset.ExerciseId == exerciseId)
            .ToDictionaryAsync(asset => asset.Id, cancellationToken);

        var participantOnly = string.Equals(origin, ParticipantOrigin, StringComparison.Ordinal);
        foreach (var id in ids)
        {
            // A participant may attach only their OWN uploads. Same text as unknown, so another participant's
            // asset id is not confirmed to exist either.
            if (!assets.TryGetValue(id, out var asset)
                || (participantOnly && !string.Equals(asset.UploadedByHumanId, actingHumanId, StringComparison.Ordinal)))
            {
                return MediaResolution.Invalid(MediaNotFoundMessage);
            }
        }

        var videos = items.Count(item => assets[item.AssetId].Kind == MediaKinds.Video);
        var images = items.Count(item => assets[item.AssetId].Kind == MediaKinds.Image);
        if (videos + images != items.Count || (videos > 0 && items.Count != 1))
        {
            return MediaResolution.Invalid(MediaCountMessage());
        }

        foreach (var item in items.Where(item => item.PosterId is not null))
        {
            if (assets[item.AssetId].Kind != MediaKinds.Video || assets[item.PosterId!.Value].Kind != MediaKinds.Image)
            {
                return MediaResolution.Invalid("posterMediaId must name an image and is only valid on a video.");
            }
        }

        return new MediaResolution(items, null);
    }

    private static string MediaCountMessage() =>
        $"A post may carry up to {MaxImagesPerPost} images or exactly 1 video, never both.";

    private static bool TryParseId(string? value, out Guid id) =>
        Guid.TryParse(value, out id) && id != Guid.Empty;

    /// <summary>
    /// Resolves a non-empty <c>parentPostId</c> through the <see cref="IReplyParentResolver"/> seam (DP-8).
    /// Returns the parent's id and <c>inReplyTo</c> (author handle with no leading <c>@</c>), or <c>null</c> for
    /// every refusal: no resolver, not resolved, or a resolved parent that is somehow outside this exercise or
    /// soft-deleted (defense in depth over the resolver, DP-16).
    /// </summary>
    private async Task<ResolvedParent?> ResolveParentAsync(
        string parentPostId, Guid exerciseId, CancellationToken cancellationToken)
    {
        if (_replyParentResolver is null)
        {
            return null;
        }

        var resolution = await _replyParentResolver.ResolveAsync(parentPostId, cancellationToken);
        if (resolution is not { Outcome: ReplyParentOutcome.Resolved, Parent: { } parent }
            || parent.Id == Guid.Empty
            || parent.ExerciseId != exerciseId
            || parent.DeletedAt is not null)
        {
            return null;
        }

        // The author handle, through the central filter (an out-of-scope persona is simply absent). The same
        // rule as the projector: a missing author row yields an empty handle rather than refusing the reply.
        var handle = await _dbContext.Personas
            .AsNoTracking()
            .Where(persona => persona.Id == parent.AuthorPersonaId)
            .Select(persona => persona.Handle)
            .FirstOrDefaultAsync(cancellationToken);

        return new ResolvedParent(
            parent.Id, new PostInReplyToDto(parent.Id.ToString(), (handle ?? string.Empty).TrimStart('@')));
    }

    /// <summary>
    /// Notifies each observer of a committed post. An observer that throws is logged and skipped: the post is
    /// already committed, so an observer failure must never skip the broadcast or turn into a failed request (a
    /// client retrying a 500 would duplicate the post). That includes an <see cref="OperationCanceledException"/>:
    /// observers take no cancellation token, so one thrown here is the observer's own, never this request's.
    /// </summary>
    private void NotifyObservers(Guid exerciseId, Post post)
    {
        foreach (var observer in _observers)
        {
            try
            {
                observer.OnPostPublished(exerciseId, post);
            }
#pragma warning disable CA1031 // An observer fault must never fail a post that has already committed.
            catch (Exception ex)
            {
                LogObserverFailed(ex, observer.GetType().Name, post.Id);
            }
#pragma warning restore CA1031
        }
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Error,
        Message = "Post-published observer {Observer} failed for post {PostId}; the post itself was committed.")]
    private partial void LogObserverFailed(Exception exception, string observer, Guid postId);

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Information,
        Message = "Ignored {Count} legacy media placeholder(s) with no mediaId in exercise {ExerciseId} (DP-6); the post is written as text.")]
    private partial void LogLegacyMediaIgnored(int count, Guid exerciseId);

    [LoggerMessage(
        EventId = 3,
        Level = LogLevel.Warning,
        Message = "Participant projection failed for committed post {PostId}; broadcasting the baseline view instead.")]
    private partial void LogProjectionFailed(Exception exception, Guid postId);

    [LoggerMessage(
        EventId = 4,
        Level = LogLevel.Error,
        Message = "Participant projection of committed post {PostId} hit an exercise-scope violation (COR-001); broadcasting the baseline view instead.")]
    private partial void LogProjectionScopeViolation(Exception exception, Guid postId);

    [LoggerMessage(
        EventId = 5,
        Level = LogLevel.Warning,
        Message = "Post broadcast failed for post {PostId} in exercise {ExerciseId}. The post is committed; connected participants pick it up on their next feed read.")]
    private partial void LogPostBroadcastFailed(Exception exception, Guid exerciseId, Guid postId);

    /// <summary>One validated attachment: the asset, its optional poster override, and the sanitized alt text.</summary>
    private sealed record RequestedMedia(Guid AssetId, Guid? PosterId, string Alt);

    /// <summary>The outcome of attachment validation: the items to write, or the 400 reason.</summary>
    private sealed record MediaResolution(IReadOnlyList<RequestedMedia> Items, string? Error)
    {
        public static MediaResolution None { get; } = new([], null);

        public static MediaResolution Invalid(string error) => new([], error);
    }

    /// <summary>The validated baseline counts, or the 400 reason.</summary>
    private sealed record BaselineResolution(int Like, int Repost, int Reply, string? Error)
    {
        public static BaselineResolution Zero { get; } = new(0, 0, 0, null);
    }

    /// <summary>A resolved, in-scope reply parent and the <c>inReplyTo</c> a reply to it carries.</summary>
    private sealed record ResolvedParent(Guid Id, PostInReplyToDto InReplyTo);

    /// <summary>The opaque XC-004 payload of a <c>reply</c> event.</summary>
    private sealed record ReplyTelemetryPayload([property: JsonPropertyName("parentPostId")] string ParentPostId);
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
    private PostIngestResult(
        PostIngestOutcome outcome, Post? post, string? validationError, ParticipantPostDto? participantView = null)
    {
        Outcome = outcome;
        Post = post;
        ValidationError = validationError;
        ParticipantView = participantView;
    }

    /// <summary>Which outcome occurred.</summary>
    public PostIngestOutcome Outcome { get; }

    /// <summary>The persisted post — non-null only when <see cref="Outcome"/> is <see cref="PostIngestOutcome.Created"/>.</summary>
    public Post? Post { get; }

    /// <summary>The validation message — non-null only when <see cref="Outcome"/> is <see cref="PostIngestOutcome.Invalid"/>.</summary>
    public string? ValidationError { get; }

    /// <summary>
    /// The participant projection that was broadcast (no viewer state) — non-null only when <see cref="Outcome"/>
    /// is <see cref="PostIngestOutcome.Created"/>. The endpoint answers a participant with it and borrows its
    /// <c>media</c>/<c>inReplyTo</c> for the staff shape, so neither is projected twice.
    /// </summary>
    public ParticipantPostDto? ParticipantView { get; }

    /// <summary>The fail-closed result for an unresolved exercise scope.</summary>
    /// <returns>A <see cref="PostIngestOutcome.ScopeUnresolved"/> result.</returns>
    public static PostIngestResult ScopeUnresolved() =>
        new(PostIngestOutcome.ScopeUnresolved, null, null);

    /// <summary>A rejected request.</summary>
    /// <param name="validationError">The human-readable reason.</param>
    /// <returns>A <see cref="PostIngestOutcome.Invalid"/> result.</returns>
    public static PostIngestResult Invalid(string validationError) =>
        new(PostIngestOutcome.Invalid, null, validationError);

    /// <summary>A successful ingest together with the participant projection that was broadcast.</summary>
    /// <param name="post">The persisted post.</param>
    /// <param name="participantView">The participant projection of <paramref name="post"/> (no viewer state).</param>
    /// <returns>A <see cref="PostIngestOutcome.Created"/> result.</returns>
    public static PostIngestResult Created(Post post, ParticipantPostDto participantView)
    {
        ArgumentNullException.ThrowIfNull(post);
        ArgumentNullException.ThrowIfNull(participantView);
        return new PostIngestResult(PostIngestOutcome.Created, post, null, participantView);
    }
}
