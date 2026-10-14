namespace Pulse.WebApi.Features.WhiteNoise;

using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Injects;
using Pulse.WebApi.Features.Social;

/// <summary>
/// White noise (demo-feedback story 05, DF-12/DF-13): the level knob, the pool, and the one-post publish step the
/// <see cref="WhiteNoisePacer"/> calls. Scoped, matching the <see cref="PulseDbContext"/> unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (COR-001).</b> The exercise is read ONLY from <see cref="IExerciseContext"/>. <see cref="NoisePost"/>
/// is <see cref="IExerciseScoped"/>, so every pool read and write is confined by the central filter and write guard;
/// a persona is resolved through the scoped <c>Personas</c> set, so another exercise's persona id or handle never
/// resolves. The exercise row itself (the persisted <see cref="Exercise.NoiseLevel"/>) is read through
/// <see cref="ExerciseFactsReader"/> for its tenant and then with <c>.InOrganization(...)</c>.
/// </para>
/// <para>
/// <b>Two worlds (XC-002).</b> The state, the pool and the pushes are staff-only. Participants see only the posts the
/// pacer publishes, through <see cref="PostIngestService"/> with origin <c>noise</c> and its participant projection.
/// </para>
/// <para>
/// <b>Noise is not an inject.</b> Nothing here touches the run sheet; the posts carry origin <c>noise</c> and no
/// <c>injectId</c>, and the pause tier <c>injects</c> does not stop them (DF-13).
/// </para>
/// </remarks>
public sealed partial class WhiteNoiseService
{
    /// <summary>The most entries one <c>PUT /api/staff/noise/pool</c> may carry.</summary>
    public const int MaxPoolEntriesPerCall = 1_000;

    /// <summary>Pool mode: the request's entries become the whole pool.</summary>
    public const string ReplaceMode = "replace";

    /// <summary>Pool mode: the request's entries are added after the existing ones.</summary>
    public const string AppendMode = "append";

    /// <summary>The XC-004 event for a level change.</summary>
    public const string LevelChangedEventType = "noise.level.changed";

    /// <summary>The XC-004 event for a pool replace.</summary>
    public const string PoolReplacedEventType = "noise.pool.replaced";

    /// <summary>The 400 for an unknown level.</summary>
    public const string InvalidLevelMessage = "level must be one of off, low, medium, high.";

    /// <summary>The rejection reason for text that is empty or too long once sanitized.</summary>
    public const string TextLengthReason = "text must be 1 to 280 characters after sanitising.";

    /// <summary>The rejection reason for a persona that does not resolve in this exercise.</summary>
    public const string PersonaNotFoundReason = "persona does not name a persona in this exercise.";

    private const string FallbackTimeZone = "UTC";
    private const string TelemetryChannel = "system";
    private const string TelemetryActorKind = "system";
    private const string ExerciseEntityType = "exercise";

    /// <summary>
    /// The longest pool text, in CODE POINTS (runes) counted as <see cref="InjectItemValidator.CodePoints"/> counts
    /// them, so an emoji counts once — the composer's 280 (contract amendment 2026-10-14; the column is wider).
    /// </summary>
    public const int MaxTextCodePoints = 280;

    /// <summary>
    /// Raw text longer than this many UTF-16 units is refused before the sanitizer runs (a DoS bound, as the ingest
    /// funnel has): eight units per allowed code point leaves room for surrogate pairs and stripped markup.
    /// </summary>
    private const int MaxRawTextLength = 8 * MaxTextCodePoints;

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ExerciseFactsReader _exerciseFacts;
    private readonly ICurrentStaffSessionAccessor _staffSession;
    private readonly PauseTierRegistry _pauseTiers;
    private readonly IExerciseClock _clock;
    private readonly INoiseBroadcaster _broadcaster;
    private readonly NoiseStateThrottle _throttle;
    private readonly PostIngestService _ingest;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<WhiteNoiseService> _logger;

    /// <summary>Creates the service.</summary>
    /// <param name="dbContext">The unit of work.</param>
    /// <param name="exerciseContext">The server-resolved exercise scope (the only scope source).</param>
    /// <param name="exerciseFacts">The one read of the exercise row's facts (tenant, time zone, stored scenario time).</param>
    /// <param name="staffSession">The acting staff user, for telemetry (server-side session, COR-018).</param>
    /// <param name="pauseTiers">The in-memory pause tiers (Freeze stops noise).</param>
    /// <param name="clock">The exercise clock (frozen or not running stops noise; scenario time for posts).</param>
    /// <param name="broadcaster">The staff-group push.</param>
    /// <param name="throttle">Limits post-driven pushes to one per 2 s per exercise.</param>
    /// <param name="ingest">The one post funnel.</param>
    /// <param name="timeProvider">The server clock.</param>
    /// <param name="logger">Diagnostics.</param>
    public WhiteNoiseService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ExerciseFactsReader exerciseFacts,
        ICurrentStaffSessionAccessor staffSession,
        PauseTierRegistry pauseTiers,
        IExerciseClock clock,
        INoiseBroadcaster broadcaster,
        NoiseStateThrottle throttle,
        PostIngestService ingest,
        TimeProvider timeProvider,
        ILogger<WhiteNoiseService> logger)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(exerciseFacts);
        ArgumentNullException.ThrowIfNull(staffSession);
        ArgumentNullException.ThrowIfNull(pauseTiers);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(broadcaster);
        ArgumentNullException.ThrowIfNull(throttle);
        ArgumentNullException.ThrowIfNull(ingest);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(logger);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _exerciseFacts = exerciseFacts;
        _staffSession = staffSession;
        _pauseTiers = pauseTiers;
        _clock = clock;
        _broadcaster = broadcaster;
        _throttle = throttle;
        _ingest = ingest;
        _timeProvider = timeProvider;
        _logger = logger;
    }

    /// <summary>
    /// Whether noise is stopped for <paramref name="exerciseId"/> right now (DF-13): the pause tier is
    /// <see cref="PauseTier.Freeze"/>, or the exercise clock is frozen or not running. <c>Pause injects</c> and
    /// <c>Engine paused</c> do not stop noise.
    /// </summary>
    /// <param name="pauseTiers">The pause tiers.</param>
    /// <param name="clock">The exercise clock.</param>
    /// <param name="exerciseId">The exercise.</param>
    /// <returns><c>true</c> when nothing may post.</returns>
    public static bool IsStopped(PauseTierRegistry pauseTiers, IExerciseClock clock, Guid exerciseId)
    {
        ArgumentNullException.ThrowIfNull(pauseTiers);
        ArgumentNullException.ThrowIfNull(clock);

        return pauseTiers.GetTier(exerciseId) == PauseTier.Freeze
            || clock.IsFrozen(exerciseId)
            || !clock.IsRunning(exerciseId);
    }

    /// <summary>The exercise's noise state (<c>GET /api/staff/noise</c>).</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The state, or <see cref="WhiteNoiseOutcome.ScopeUnresolved"/> (401).</returns>
    public async Task<WhiteNoiseResult<NoiseStateDto>> GetStateAsync(CancellationToken cancellationToken = default)
    {
        if (ResolveScope() is not { } exerciseId)
        {
            return WhiteNoiseResult<NoiseStateDto>.ScopeUnresolved();
        }

        var facts = await _exerciseFacts.GetAsync(exerciseId, cancellationToken);
        if (facts is null)
        {
            return WhiteNoiseResult<NoiseStateDto>.ScopeUnresolved();
        }

        var level = await ReadLevelAsync(exerciseId, facts, cancellationToken);
        if (level is null)
        {
            return WhiteNoiseResult<NoiseStateDto>.ScopeUnresolved();
        }

        return WhiteNoiseResult<NoiseStateDto>.Ok(await BuildStateAsync(exerciseId, level, cancellationToken));
    }

    /// <summary>
    /// Sets the level (<c>PUT /api/staff/noise</c>): persists <see cref="Exercise.NoiseLevel"/> with one
    /// <c>noise.level.changed</c> event in the same unit of work, then pushes <c>NoiseStateChanged</c> to the staff
    /// group. Setting the current level again changes nothing, pushes nothing and emits nothing.
    /// </summary>
    /// <param name="request">The body.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The new state; <see cref="WhiteNoiseOutcome.Invalid"/> (400) for an unknown level.</returns>
    public async Task<WhiteNoiseResult<NoiseStateDto>> SetLevelAsync(
        NoiseLevelRequest? request,
        CancellationToken cancellationToken = default)
    {
        if (ResolveScope() is not { } exerciseId)
        {
            return WhiteNoiseResult<NoiseStateDto>.ScopeUnresolved();
        }

        var to = request?.Level;
        if (!NoiseRates.IsLevel(to))
        {
            return WhiteNoiseResult<NoiseStateDto>.Invalid(InvalidLevelMessage);
        }

        var staff = await _staffSession.GetCurrentStaffSessionAsync(cancellationToken);
        var facts = staff is null ? null : await _exerciseFacts.GetAsync(exerciseId, cancellationToken);
        if (staff is null || facts is null)
        {
            return WhiteNoiseResult<NoiseStateDto>.ScopeUnresolved();
        }

        var exercise = await _dbContext.Exercises
            .InOrganization(facts.OrganizationId)
            .Where(row => row.Id == exerciseId)
            .FirstOrDefaultAsync(cancellationToken);
        if (exercise is null)
        {
            return WhiteNoiseResult<NoiseStateDto>.ScopeUnresolved();
        }

        var from = exercise.NoiseLevel;
        if (string.Equals(from, to, StringComparison.Ordinal))
        {
            return WhiteNoiseResult<NoiseStateDto>.Ok(await BuildStateAsync(exerciseId, to!, cancellationToken));
        }

        exercise.NoiseLevel = to!;

        var now = _timeProvider.GetUtcNow();
        _dbContext.TelemetryEvents.Add(BuildEvent(
            exerciseId,
            LevelChangedEventType,
            staff.StaffUserId,
            now,
            ScenarioNow(exerciseId, facts, now),
            TimeZoneOf(facts),
            JsonSerializer.Serialize(new LevelChangedPayload(from, to!))));
        await _dbContext.SaveChangesAsync(cancellationToken);

        var state = await BuildStateAsync(exerciseId, to!, CancellationToken.None);

        // The level has committed: a failed push must not turn it into a failed request. The console re-reads on
        // its next mount, and the next noise post pushes again.
        await PushAsync(exerciseId, state);

        return WhiteNoiseResult<NoiseStateDto>.Ok(state);
    }

    /// <summary>
    /// Replaces or appends to the pool (<c>PUT /api/staff/noise/pool</c>). Each entry's persona resolves by handle
    /// (leading <c>@</c> ignored, case-insensitive) or id in this exercise; its text is sanitized and must be 1 to
    /// 280 code points. Bad entries are reported with their index and reason; the rest apply, in one
    /// <c>SaveChanges</c>. A replace emits <c>noise.pool.replaced</c> and starts the new pool's counts at zero.
    /// </summary>
    /// <param name="request">The body.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The pool size and the rejections; <see cref="WhiteNoiseOutcome.Invalid"/> (400) for a bad mode, a
    /// missing <c>posts</c>, or more than <see cref="MaxPoolEntriesPerCall"/> entries.</returns>
    public async Task<WhiteNoiseResult<NoisePoolResultDto>> ReplacePoolAsync(
        NoisePoolRequest? request,
        CancellationToken cancellationToken = default)
    {
        if (ResolveScope() is not { } exerciseId)
        {
            return WhiteNoiseResult<NoisePoolResultDto>.ScopeUnresolved();
        }

        var mode = request?.Mode;
        if (mode is not (ReplaceMode or AppendMode))
        {
            return WhiteNoiseResult<NoisePoolResultDto>.Invalid("mode must be replace or append.");
        }

        if (request!.Posts is not { } posts)
        {
            return WhiteNoiseResult<NoisePoolResultDto>.Invalid("posts is required.");
        }

        if (posts.Count > MaxPoolEntriesPerCall)
        {
            return WhiteNoiseResult<NoisePoolResultDto>.Invalid(
                $"posts may hold at most {MaxPoolEntriesPerCall} entries per call.");
        }

        var staff = await _staffSession.GetCurrentStaffSessionAsync(cancellationToken);
        var facts = staff is null ? null : await _exerciseFacts.GetAsync(exerciseId, cancellationToken);
        if (staff is null || facts is null)
        {
            return WhiteNoiseResult<NoisePoolResultDto>.ScopeUnresolved();
        }

        var personas = await LoadPersonaLookupAsync(cancellationToken);
        var replace = mode == ReplaceMode;

        var nextOrder = replace
            ? 0
            : (await _dbContext.NoisePosts.MaxAsync(entry => (int?)entry.Order, cancellationToken) ?? -1) + 1;

        var now = _timeProvider.GetUtcNow();
        var rejected = new List<NoisePoolRejectionDto>();
        var accepted = new List<NoisePost>();

        for (var index = 0; index < posts.Count; index++)
        {
            var reason = TryBuildEntry(posts[index], personas, out var personaId, out var text);
            if (reason is not null)
            {
                rejected.Add(new NoisePoolRejectionDto { Index = index, Reason = reason });
                continue;
            }

            accepted.Add(new NoisePost
            {
                Id = Guid.NewGuid(),
                ExerciseId = exerciseId,
                PersonaId = personaId,
                Text = text!,
                Order = nextOrder++,
                PostedCount = 0,
                LastPostedWallClock = null,
                CreatedWallClock = now,
            });
        }

        if (replace)
        {
            var existing = await _dbContext.NoisePosts.ToListAsync(cancellationToken);
            _dbContext.NoisePosts.RemoveRange(existing);

            _dbContext.TelemetryEvents.Add(BuildEvent(
                exerciseId,
                PoolReplacedEventType,
                staff.StaffUserId,
                now,
                ScenarioNow(exerciseId, facts, now),
                TimeZoneOf(facts),
                JsonSerializer.Serialize(new PoolReplacedPayload(accepted.Count))));
        }

        _dbContext.NoisePosts.AddRange(accepted);
        await _dbContext.SaveChangesAsync(cancellationToken);

        var poolSize = await _dbContext.NoisePosts.CountAsync(CancellationToken.None);
        return WhiteNoiseResult<NoisePoolResultDto>.Ok(new NoisePoolResultDto { PoolSize = poolSize, Rejected = rejected });
    }

    /// <summary>
    /// Publishes the next noise post for the scoped exercise, if it is making noise and not stopped (the pacer's
    /// step). Picks per <see cref="NoiseSelection.Pick"/>, publishes through <see cref="PostIngestService"/> with
    /// origin <c>noise</c>, the entry's persona, no acting human and the current scenario time, and counts the entry
    /// in the funnel's own <c>SaveChanges</c>. Then pushes <c>NoiseStateChanged</c>, at most once per 2 s.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>What happened.</returns>
    public async Task<NoisePublishOutcome> PublishNextAsync(CancellationToken cancellationToken = default)
    {
        if (ResolveScope() is not { } exerciseId)
        {
            return NoisePublishOutcome.Refused;
        }

        var facts = await _exerciseFacts.GetAsync(exerciseId, cancellationToken);
        var level = facts is null ? null : await ReadLevelAsync(exerciseId, facts, cancellationToken);
        if (facts is null || NoiseRates.PerMinute(level) <= 0 || IsStopped(_pauseTiers, _clock, exerciseId))
        {
            return NoisePublishOutcome.Stopped;
        }

        var candidates = await _dbContext.NoisePosts
            .AsNoTracking()
            .OrderBy(entry => entry.PostedCount)
            .ThenBy(entry => entry.Order)
            .ThenBy(entry => entry.Id)
            .Select(entry => new NoiseCandidate(entry.Id, entry.PersonaId))
            .ToListAsync(cancellationToken);
        if (candidates.Count == 0)
        {
            return NoisePublishOutcome.NothingToPost;
        }

        var lastPersonaId = await NoisePosts()
            .OrderByDescending(post => post.CreatedWallClock)
            .ThenByDescending(post => post.Id)
            .Select(post => (Guid?)post.AuthorPersonaId)
            .FirstOrDefaultAsync(cancellationToken);

        var picked = NoiseSelection.Pick(candidates, lastPersonaId);
        var item = await _dbContext.NoisePosts.FirstAsync(entry => entry.Id == picked.Id, cancellationToken);

        var now = _timeProvider.GetUtcNow();

        // Counted on the tracked entry BEFORE the funnel runs, so the funnel's one SaveChanges commits the post, its
        // telemetry and this count together — or none of them.
        item.PostedCount++;
        item.LastPostedWallClock = now;

        var request = new CreatePostRequest
        {
            Text = item.Text,
            ScenarioTime = ScenarioNow(exerciseId, facts, now).ToString("O", CultureInfo.InvariantCulture),
            TimeZone = TimeZoneOf(facts),
        };
        var attribution = new PostAttribution
        {
            AuthorPersonaId = item.PersonaId,
            Origin = NoiseRates.NoiseOrigin,
            ActingHumanId = string.Empty,
        };

        var result = await _ingest.IngestAsync(request, attribution, cancellationToken);
        if (result.Outcome != PostIngestOutcome.Created)
        {
            // Nothing was written; drop the uncommitted count so it can never ride along on a later save.
            _dbContext.ChangeTracker.Clear();
            LogPublishRefused(exerciseId, item.Id, result.ValidationError ?? result.Outcome.ToString());
            return NoisePublishOutcome.Refused;
        }

        if (_throttle.TryAcquire(exerciseId, now))
        {
            var state = await BuildStateAsync(exerciseId, level!, CancellationToken.None);
            await PushAsync(exerciseId, state);
        }

        return NoisePublishOutcome.Posted;
    }

    /// <summary>
    /// Reads the scoped exercise's persisted level for the pacer's sweep step, or <c>null</c> when the exercise
    /// cannot be resolved.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The level.</returns>
    public async Task<string?> ReadCurrentLevelAsync(CancellationToken cancellationToken = default)
    {
        if (ResolveScope() is not { } exerciseId)
        {
            return null;
        }

        var facts = await _exerciseFacts.GetAsync(exerciseId, cancellationToken);
        return facts is null ? null : await ReadLevelAsync(exerciseId, facts, cancellationToken);
    }

    private Guid? ResolveScope()
    {
        var scope = _exerciseContext.CurrentExerciseId;
        return scope is { } id && id != Guid.Empty ? id : null;
    }

    private async Task<string?> ReadLevelAsync(Guid exerciseId, ExerciseFacts facts, CancellationToken cancellationToken) =>
        await _dbContext.Exercises
            .InOrganization(facts.OrganizationId)
            .Where(row => row.Id == exerciseId)
            .Select(row => row.NoiseLevel)
            .FirstOrDefaultAsync(cancellationToken);

    /// <summary>The noise posts of the scoped exercise (the central filter confines the read).</summary>
    private IQueryable<Post> NoisePosts() =>
        _dbContext.Posts.Where(post => post.Origin == NoiseRates.NoiseOrigin);

    private async Task<NoiseStateDto> BuildStateAsync(Guid exerciseId, string level, CancellationToken cancellationToken)
    {
        var poolSize = await _dbContext.NoisePosts.CountAsync(cancellationToken);
        var postedCount = await NoisePosts().CountAsync(cancellationToken);
        var lastPostedAt = await NoisePosts().MaxAsync(post => (DateTimeOffset?)post.CreatedScenarioTime, cancellationToken);

        return new NoiseStateDto
        {
            Level = level,
            RatePerMinute = NoiseRates.PerMinute(level),
            PoolSize = poolSize,
            PostedCount = postedCount,
            LastPostedAt = lastPostedAt?.ToString("O", CultureInfo.InvariantCulture),
            Running = NoiseRates.PerMinute(level) > 0 && poolSize > 0 && !IsStopped(_pauseTiers, _clock, exerciseId),
        };
    }

    private async Task PushAsync(Guid exerciseId, NoiseStateDto state)
    {
        try
        {
            await _broadcaster.BroadcastStateAsync(exerciseId, state, CancellationToken.None);
        }
#pragma warning disable CA1031 // A push failure must never undo or fail a committed change.
        catch (Exception ex)
        {
            LogPushFailed(ex, exerciseId);
        }
#pragma warning restore CA1031
    }

    private async Task<PersonaLookup> LoadPersonaLookupAsync(CancellationToken cancellationToken)
    {
        var personas = await _dbContext.Personas
            .AsNoTracking()
            .OrderBy(persona => persona.Handle)
            .ThenBy(persona => persona.Id)
            .Select(persona => new { persona.Id, persona.Handle })
            .ToListAsync(cancellationToken);

        var byHandle = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
        foreach (var persona in personas)
        {
            byHandle.TryAdd(HandleKey(persona.Handle), persona.Id);
        }

        return new PersonaLookup(personas.Select(persona => persona.Id).ToHashSet(), byHandle);
    }

    private static string? TryBuildEntry(
        NoisePoolEntryRequest? entry,
        PersonaLookup personas,
        out Guid personaId,
        out string? text)
    {
        personaId = Guid.Empty;
        text = null;

        if (entry is null)
        {
            return "entry is required.";
        }

        var persona = entry.Persona?.Trim();
        if (string.IsNullOrEmpty(persona))
        {
            return "persona is required.";
        }

        if (Guid.TryParse(persona, out var id) && personas.Ids.Contains(id))
        {
            personaId = id;
        }
        else if (personas.ByHandle.TryGetValue(HandleKey(persona), out var byHandle))
        {
            personaId = byHandle;
        }
        else
        {
            return PersonaNotFoundReason;
        }

        if (entry.Text is null)
        {
            return "text is required.";
        }

        if (entry.Text.Length > MaxRawTextLength)
        {
            return TextLengthReason;
        }

        var sanitized = PostSanitizer.Sanitize(entry.Text).Trim();
        if (sanitized.Length == 0 || InjectItemValidator.CodePoints(sanitized) > MaxTextCodePoints)
        {
            return TextLengthReason;
        }

        text = sanitized;
        return null;
    }

    private static string HandleKey(string handle) => handle.Trim().TrimStart('@');

    private DateTimeOffset ScenarioNow(Guid exerciseId, ExerciseFacts facts, DateTimeOffset now) =>
        _clock.CurrentScenarioTime(exerciseId) ?? facts.StoredScenarioTime ?? now;

    private static string TimeZoneOf(ExerciseFacts facts) =>
        string.IsNullOrWhiteSpace(facts.TimeZone) ? FallbackTimeZone : facts.TimeZone;

    private static TelemetryEvent BuildEvent(
        Guid exerciseId,
        string eventType,
        Guid staffUserId,
        DateTimeOffset now,
        DateTimeOffset scenarioTime,
        string timeZone,
        string payload) => new()
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = "v0",
            ExerciseId = exerciseId,
            EventType = eventType,
            Channel = TelemetryChannel,
            Actor = new TelemetryActor
            {
                Kind = TelemetryActorKind,
                ActingHumanId = staffUserId.ToString(),
            },
            WallClockTime = now,
            ScenarioTime = scenarioTime,
            TimeZone = timeZone,
            Target = new TelemetryTarget
            {
                EntityType = ExerciseEntityType,
                EntityId = exerciseId.ToString(),
            },
            Payload = payload,
            EmittedAt = now,
        };

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "White noise: the post funnel refused pool entry {EntryId} of exercise {ExerciseId}: {Reason}")]
    private partial void LogPublishRefused(Guid exerciseId, Guid entryId, string reason);

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Warning,
        Message = "White noise: the NoiseStateChanged push for exercise {ExerciseId} failed; the change itself is committed.")]
    private partial void LogPushFailed(Exception exception, Guid exerciseId);

    private sealed record PersonaLookup(HashSet<Guid> Ids, Dictionary<string, Guid> ByHandle);

    /// <summary><c>noise.level.changed</c> payload: counts and literals only (XC-004).</summary>
    private sealed record LevelChangedPayload(
        [property: JsonPropertyName("from")] string From,
        [property: JsonPropertyName("to")] string To);

    /// <summary><c>noise.pool.replaced</c> payload: counts only (XC-004).</summary>
    private sealed record PoolReplacedPayload(
        [property: JsonPropertyName("poolSize")] int PoolSize);
}

/// <summary>A pool entry as the selection sees it: its id and persona only.</summary>
/// <param name="Id">The <see cref="NoisePost"/> id.</param>
/// <param name="PersonaId">The persona that posts it.</param>
public sealed record NoiseCandidate(Guid Id, Guid PersonaId);

/// <summary>The pacer's pick (DF-13).</summary>
public static class NoiseSelection
{
    /// <summary>
    /// The first candidate, in least-posted-then-pool order, whose persona is not <paramref name="lastPersonaId"/>;
    /// the first candidate when every entry has that persona (no other persona is available).
    /// </summary>
    /// <param name="ordered">The pool, already ordered by posted count, then pool order, then id. Not empty.</param>
    /// <param name="lastPersonaId">The persona of the exercise's latest noise post, if any.</param>
    /// <returns>The entry to publish.</returns>
    public static NoiseCandidate Pick(IReadOnlyList<NoiseCandidate> ordered, Guid? lastPersonaId)
    {
        ArgumentNullException.ThrowIfNull(ordered);
        if (ordered.Count == 0)
        {
            throw new ArgumentException("The pool is empty.", nameof(ordered));
        }

        if (lastPersonaId is { } last)
        {
            foreach (var candidate in ordered)
            {
                if (candidate.PersonaId != last)
                {
                    return candidate;
                }
            }
        }

        return ordered[0];
    }
}

/// <summary>What one pacer step did.</summary>
public enum NoisePublishOutcome
{
    /// <summary>A noise post was published.</summary>
    Posted = 0,

    /// <summary>The pool is empty.</summary>
    NothingToPost = 1,

    /// <summary>The level is off, or noise is stopped (Freeze, frozen or stopped clock).</summary>
    Stopped = 2,

    /// <summary>No scope, or the post funnel refused the post; nothing was written.</summary>
    Refused = 3,
}

/// <summary>The outcome of a white-noise request; the endpoint maps it to a status.</summary>
public enum WhiteNoiseOutcome
{
    /// <summary>200 with the value.</summary>
    Ok = 0,

    /// <summary>400 with the message.</summary>
    Invalid = 1,

    /// <summary>401: no resolved scope or staff session (fail closed).</summary>
    ScopeUnresolved = 2,
}

/// <summary>A white-noise request's result.</summary>
/// <typeparam name="TValue">The success value.</typeparam>
public sealed class WhiteNoiseResult<TValue>
    where TValue : class
{
    private WhiteNoiseResult(WhiteNoiseOutcome outcome, TValue? value, string? message)
    {
        Outcome = outcome;
        Value = value;
        Message = message;
    }

    /// <summary>The outcome.</summary>
    public WhiteNoiseOutcome Outcome { get; }

    /// <summary>The value on <see cref="WhiteNoiseOutcome.Ok"/>.</summary>
    public TValue? Value { get; }

    /// <summary>The 400 detail on <see cref="WhiteNoiseOutcome.Invalid"/>.</summary>
    public string? Message { get; }

    /// <summary>A success.</summary>
    /// <param name="value">The value.</param>
    /// <returns>The result.</returns>
    public static WhiteNoiseResult<TValue> Ok(TValue value) => new(WhiteNoiseOutcome.Ok, value, null);

    /// <summary>A validation failure.</summary>
    /// <param name="message">The detail.</param>
    /// <returns>The result.</returns>
    public static WhiteNoiseResult<TValue> Invalid(string message) => new(WhiteNoiseOutcome.Invalid, null, message);

    /// <summary>No scope or staff session.</summary>
    /// <returns>The result.</returns>
    public static WhiteNoiseResult<TValue> ScopeUnresolved() => new(WhiteNoiseOutcome.ScopeUnresolved, null, null);
}
