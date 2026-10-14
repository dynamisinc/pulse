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
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
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

    /// <summary>The 400 for a replace whose entries were all rejected (the pool is left unchanged).</summary>
    public const string NoUsableEntriesMessage =
        "No entry could be used, so the pool was left unchanged. Send an empty posts list to clear the pool.";

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
    /// Whether noise is stopped for <paramref name="exerciseId"/> right now (DF-13, amended after Gate-1): the pause
    /// tier is <see cref="PauseTier.Freeze"/>, the exercise clock is frozen or not running, or the lifecycle is not
    /// <c>staged</c> or <c>live</c> (EndEx, a lifecycle pause). <c>Pause injects</c> and <c>Engine paused</c> do not
    /// stop noise.
    /// </summary>
    /// <param name="pauseTiers">The pause tiers.</param>
    /// <param name="clock">The exercise clock.</param>
    /// <param name="exerciseId">The exercise.</param>
    /// <param name="lifecycleStatus">The stored lifecycle status (canonical or legacy literal).</param>
    /// <returns><c>true</c> when nothing may post.</returns>
    public static bool IsStopped(PauseTierRegistry pauseTiers, IExerciseClock clock, Guid exerciseId, string? lifecycleStatus) =>
        IsTierOrClockStopped(pauseTiers, clock, exerciseId) || !IsLifecycleMakingNoise(lifecycleStatus);

    /// <summary>
    /// Whether the lifecycle lets noise run: <c>staged</c> or <c>live</c>, legacy literals folded through
    /// <see cref="ExerciseLifecycleStates.TryParse"/> (so <c>active</c> counts as <c>live</c>).
    /// </summary>
    /// <param name="lifecycleStatus">The stored lifecycle status.</param>
    /// <returns><c>true</c> for <c>staged</c> and <c>live</c>.</returns>
    public static bool IsLifecycleMakingNoise(string? lifecycleStatus) =>
        ExerciseLifecycleStates.TryParse(lifecycleStatus, out var state)
        && state is ExerciseLifecycleStates.Staged or ExerciseLifecycleStates.Live;

    /// <summary>
    /// The in-memory half of <see cref="IsStopped"/>: the Freeze tier, or a frozen or stopped clock. The pacer checks
    /// it before any database work.
    /// </summary>
    /// <param name="pauseTiers">The pause tiers.</param>
    /// <param name="clock">The exercise clock.</param>
    /// <param name="exerciseId">The exercise.</param>
    /// <returns><c>true</c> when nothing may post.</returns>
    public static bool IsTierOrClockStopped(PauseTierRegistry pauseTiers, IExerciseClock clock, Guid exerciseId)
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
            return WhiteNoiseResult.ScopeUnresolved<NoiseStateDto>();
        }

        var facts = await _exerciseFacts.GetAsync(exerciseId, cancellationToken);
        if (facts is null)
        {
            return WhiteNoiseResult.ScopeUnresolved<NoiseStateDto>();
        }

        var level = await ReadLevelAsync(exerciseId, facts, cancellationToken);
        if (level is null)
        {
            return WhiteNoiseResult.ScopeUnresolved<NoiseStateDto>();
        }

        return WhiteNoiseResult.Ok(await BuildStateAsync(exerciseId, level, facts.Status, cancellationToken));
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
            return WhiteNoiseResult.ScopeUnresolved<NoiseStateDto>();
        }

        var to = request?.Level;
        if (!NoiseRates.IsLevel(to))
        {
            return WhiteNoiseResult.Invalid<NoiseStateDto>(InvalidLevelMessage);
        }

        var staff = await _staffSession.GetCurrentStaffSessionAsync(cancellationToken);
        var facts = staff is null ? null : await _exerciseFacts.GetAsync(exerciseId, cancellationToken);
        if (staff is null || facts is null)
        {
            return WhiteNoiseResult.ScopeUnresolved<NoiseStateDto>();
        }

        var exercise = await _dbContext.Exercises
            .InOrganization(facts.OrganizationId)
            .Where(row => row.Id == exerciseId)
            .FirstOrDefaultAsync(cancellationToken);
        if (exercise is null)
        {
            return WhiteNoiseResult.ScopeUnresolved<NoiseStateDto>();
        }

        var from = exercise.NoiseLevel;
        if (string.Equals(from, to, StringComparison.Ordinal))
        {
            return WhiteNoiseResult.Ok(await BuildStateAsync(exerciseId, to!, facts.Status, cancellationToken));
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

        var state = await BuildStateAsync(exerciseId, to!, facts.Status, CancellationToken.None);

        // The level has committed: a failed push must not turn it into a failed request. The console re-reads on
        // its next mount, and the next noise post pushes again.
        await PushAsync(exerciseId, state);

        return WhiteNoiseResult.Ok(state);
    }

    /// <summary>
    /// Replaces or appends to the pool (<c>PUT /api/staff/noise/pool</c>). Each entry's persona resolves by handle
    /// (leading <c>@</c> ignored, case-insensitive) or id in this exercise; its text is sanitized and must be 1 to
    /// 280 code points. Bad entries are reported with their index and reason; the rest apply, in one
    /// <c>SaveChanges</c>. A replace emits <c>noise.pool.replaced</c> and starts the new pool's counts at zero.
    /// </summary>
    /// <param name="request">The body.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The pool size and the rejections, after which <c>NoiseStateChanged</c> is pushed once;
    /// <see cref="WhiteNoiseOutcome.Invalid"/> (400) for a bad mode, a missing <c>posts</c>, more than
    /// <see cref="MaxPoolEntriesPerCall"/> entries, or a replace with entries none of which could be used (the pool is
    /// left unchanged and the 400 carries the rejections).</returns>
    public async Task<WhiteNoiseResult<NoisePoolResultDto>> ReplacePoolAsync(
        NoisePoolRequest? request,
        CancellationToken cancellationToken = default)
    {
        if (ResolveScope() is not { } exerciseId)
        {
            return WhiteNoiseResult.ScopeUnresolved<NoisePoolResultDto>();
        }

        var mode = request?.Mode;
        if (mode is not (ReplaceMode or AppendMode))
        {
            return WhiteNoiseResult.Invalid<NoisePoolResultDto>("mode must be replace or append.");
        }

        if (request!.Posts is not { } posts)
        {
            return WhiteNoiseResult.Invalid<NoisePoolResultDto>("posts is required.");
        }

        if (posts.Count > MaxPoolEntriesPerCall)
        {
            return WhiteNoiseResult.Invalid<NoisePoolResultDto>(
                $"posts may hold at most {MaxPoolEntriesPerCall} entries per call.");
        }

        var staff = await _staffSession.GetCurrentStaffSessionAsync(cancellationToken);
        var facts = staff is null ? null : await _exerciseFacts.GetAsync(exerciseId, cancellationToken);
        if (staff is null || facts is null)
        {
            return WhiteNoiseResult.ScopeUnresolved<NoisePoolResultDto>();
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

        // A replace that names entries but has none usable would silently empty the pool (a mistyped seed); refuse it
        // and leave the pool as it is. An explicit empty list still clears the pool.
        if (replace && posts.Count > 0 && accepted.Count == 0)
        {
            var current = await _dbContext.NoisePosts.CountAsync(cancellationToken);
            return WhiteNoiseResult.Invalid(
                new NoisePoolResultDto { PoolSize = current, Rejected = rejected },
                NoUsableEntriesMessage);
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

        // The pool size the knob shows has changed: one push (no throttle), after the commit.
        var level = await ReadLevelAsync(exerciseId, facts, CancellationToken.None);
        if (level is not null)
        {
            await PushAsync(exerciseId, await BuildStateAsync(exerciseId, level, facts.Status, CancellationToken.None));
        }

        return WhiteNoiseResult.Ok(new NoisePoolResultDto { PoolSize = poolSize, Rejected = rejected });
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
        if (facts is null || NoiseRates.PerMinute(level) <= 0 || IsStopped(_pauseTiers, _clock, exerciseId, facts.Status))
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

        PostIngestResult result;
        try
        {
            result = await _ingest.IngestAsync(request, attribution, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Nothing committed. Skip the entry in its own save so the rotation moves on, then let the pacer log it.
            await SkipEntryAsync(exerciseId, item.Id);
            throw;
        }

        if (result.Outcome != PostIngestOutcome.Created)
        {
            LogPublishRefused(exerciseId, item.Id, result.ValidationError ?? result.Outcome.ToString());
            await SkipEntryAsync(exerciseId, item.Id);
            return NoisePublishOutcome.Refused;
        }

        if (_throttle.TryAcquire(exerciseId, now))
        {
            var state = await BuildStateAsync(exerciseId, level!, facts.Status, CancellationToken.None);
            await PushAsync(exerciseId, state);
        }

        return NoisePublishOutcome.Posted;
    }

    /// <summary>
    /// Reads what the pacer needs about the scoped exercise: its persisted level and whether its lifecycle lets noise
    /// run; <c>null</c> when the exercise cannot be resolved.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The pacing facts.</returns>
    public async Task<NoisePacingFacts?> ReadPacingFactsAsync(CancellationToken cancellationToken = default)
    {
        if (ResolveScope() is not { } exerciseId)
        {
            return null;
        }

        var facts = await _exerciseFacts.GetAsync(exerciseId, cancellationToken);
        var level = facts is null ? null : await ReadLevelAsync(exerciseId, facts, cancellationToken);
        return level is null ? null : new NoisePacingFacts(level, IsLifecycleMakingNoise(facts!.Status));
    }

    /// <summary>
    /// Counts an entry that could not be published (the funnel refused it, or threw) in its own statement, so
    /// least-posted-first moves on to another entry at the next due time instead of retrying this one forever. It
    /// is not a published post: the state's <c>postedCount</c> counts posts, not pool counters.
    /// </summary>
    private async Task SkipEntryAsync(Guid exerciseId, Guid entryId)
    {
        _dbContext.ChangeTracker.Clear();
        try
        {
            await _dbContext.NoisePosts
                .Where(entry => entry.Id == entryId)
                .ExecuteUpdateAsync(set => set.SetProperty(entry => entry.PostedCount, entry => entry.PostedCount + 1));
        }
#pragma warning disable CA1031 // The skip is best effort; the original failure is what gets reported.
        catch (Exception ex)
        {
            LogSkipFailed(ex, exerciseId, entryId);
        }
#pragma warning restore CA1031
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

    private async Task<NoiseStateDto> BuildStateAsync(
        Guid exerciseId,
        string level,
        string? lifecycleStatus,
        CancellationToken cancellationToken)
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
            Running = NoiseRates.PerMinute(level) > 0
                && poolSize > 0
                && !IsStopped(_pauseTiers, _clock, exerciseId, lifecycleStatus),
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

    [LoggerMessage(
        EventId = 3,
        Level = LogLevel.Warning,
        Message = "White noise: could not skip pool entry {EntryId} of exercise {ExerciseId} after a failed publish; it may be picked again.")]
    private partial void LogSkipFailed(Exception exception, Guid exerciseId, Guid entryId);

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

/// <summary>What the pacer reads about an exercise before deciding whether a post is due.</summary>
/// <param name="Level">The persisted level.</param>
/// <param name="LifecycleMakingNoise">Whether the lifecycle is <c>staged</c> or <c>live</c>.</param>
public sealed record NoisePacingFacts(string Level, bool LifecycleMakingNoise);

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
    internal WhiteNoiseResult(WhiteNoiseOutcome outcome, TValue? value, string? message)
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
}

/// <summary>Factories for <see cref="WhiteNoiseResult{TValue}"/>.</summary>
public static class WhiteNoiseResult
{
    /// <summary>A success.</summary>
    /// <typeparam name="TValue">The value type.</typeparam>
    /// <param name="value">The value.</param>
    /// <returns>The result.</returns>
    public static WhiteNoiseResult<TValue> Ok<TValue>(TValue value)
        where TValue : class => new(WhiteNoiseOutcome.Ok, value, null);

    /// <summary>A validation failure that still carries a value (e.g. the rejections of a refused pool replace).</summary>
    /// <typeparam name="TValue">The value type.</typeparam>
    /// <param name="value">The value.</param>
    /// <param name="message">The detail.</param>
    /// <returns>The result.</returns>
    public static WhiteNoiseResult<TValue> Invalid<TValue>(TValue value, string message)
        where TValue : class => new(WhiteNoiseOutcome.Invalid, value, message);

    /// <summary>A validation failure.</summary>
    /// <typeparam name="TValue">The value type.</typeparam>
    /// <param name="message">The detail.</param>
    /// <returns>The result.</returns>
    public static WhiteNoiseResult<TValue> Invalid<TValue>(string message)
        where TValue : class => new(WhiteNoiseOutcome.Invalid, null, message);

    /// <summary>No scope or staff session.</summary>
    /// <typeparam name="TValue">The value type.</typeparam>
    /// <returns>The result.</returns>
    public static WhiteNoiseResult<TValue> ScopeUnresolved<TValue>()
        where TValue : class => new(WhiteNoiseOutcome.ScopeUnresolved, null, null);
}
