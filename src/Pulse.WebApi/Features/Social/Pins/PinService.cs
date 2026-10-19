namespace Pulse.WebApi.Features.Social.Pins;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Realtime;

/// <summary>
/// The controller's EXERCISE pin (demo-feedback DF-7, story 04): pins one post for every participant by stamping
/// <see cref="Post.PinnedForAllAt"/> (scenario time) and <see cref="Post.PinnedForAllByHumanId"/> (the staff user), or
/// clears both, then pushes <c>PostPinChanged</c> to the exercise group. Scoped lifetime, matching the
/// <see cref="PulseDbContext"/> unit of work. Modelled on <c>PostTakedownService</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (COR-001, DP-16).</b> The exercise comes only from <see cref="IExerciseContext"/>. The post is read
/// and updated through the scoped <see cref="PulseDbContext.Posts"/> set (plus an explicit <c>ExerciseId</c>
/// predicate), so another exercise's post id resolves exactly like an unknown id: <see cref="PinOutcome.NotFound"/>,
/// nothing written, nothing pushed.
/// </para>
/// <para>
/// <b>Visibility.</b> Pinning needs a live post: a taken-down post is <see cref="PinOutcome.NotFound"/>. Clearing a pin
/// on a taken-down post is still allowed (the story's Takedown AC), so a controller can tidy up after a takedown.
/// </para>
/// <para>
/// <b>Idempotent, one event and one push per real change.</b> Both writes are conditional, atomic
/// <c>UPDATE</c>s (<c>WHERE PinnedForAllAt IS NULL</c> to pin, <c>IS NOT NULL</c> to clear) run inside one
/// transaction with the XC-004 event. A repeat, or a concurrent duplicate that lost the race, matches zero rows,
/// rolls back, and neither emits nor pushes. The update never writes <c>ExerciseId</c>, so the scope write-guard
/// (which <c>ExecuteUpdate</c> bypasses) has nothing to check.
/// </para>
/// <para>
/// <b>Scenario time (COR-053), never the wall clock.</b> A RUNNING exercise clock is authoritative and used as is.
/// Otherwise the exercise's latest post (<see cref="IScenarioNow"/>), else the post's own <c>CreatedScenarioTime</c>, clamped
/// to be no earlier than the post (the same order the takedown uses). Clearing a pin is additionally never stamped
/// earlier than the pin it ends. The wall clock is used only for the telemetry envelope.
/// </para>
/// <para>
/// <b>A failed push never fails the request.</b> After the commit the pin has happened; a <c>PostPinChanged</c> send
/// failure is logged as a warning and the caller still gets success (204), exactly as the takedown's
/// <c>PostRemoved</c>. Clients that missed it see the change on their next Pinned/feed read.
/// </para>
/// <para>
/// <b>Telemetry (XC-004).</b> One <c>post.pinned</c> / <c>post.unpinned</c> event with <c>{"scope":"exercise"}</c> per
/// real change, in the same unit of work. The actor is the staff human (<c>actingHumanId</c> = staff user id, the
/// session id, role <c>controller</c>) on a <c>system</c> actor, as the other staff-action events do.
/// </para>
/// </remarks>
public sealed partial class PinService
{
    private const string PinnedEventType = "post.pinned";
    private const string UnpinnedEventType = "post.unpinned";
    private const string ExercisePinPayload = "{\"scope\":\"exercise\"}";
    private const string SocialChannel = "social";
    private const string SystemActorKind = "system";
    private const string ControllerRole = "controller";
    private const string PostEntityType = "post";
    private const string FallbackTimeZone = "UTC";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly IOrganizationContext _organizationContext;
    private readonly IExerciseClock _exerciseClock;
    private readonly IFeedBroadcaster _feedBroadcaster;
    private readonly ILogger<PinService> _logger;
    private readonly IScenarioNow _scenarioNow;

    /// <summary>Creates the service over its persistence, scope, clock, fan-out and logging collaborators.</summary>
    /// <param name="dbContext">The persistence context. Its central exercise filter scopes every post read and update.</param>
    /// <param name="exerciseContext">The server-resolved exercise scope (COR-001), the only scope source.</param>
    /// <param name="organizationContext">The server-resolved tenant, which bounds the one <c>Exercises</c> read.</param>
    /// <param name="exerciseClock">The native per-exercise scenario clock (COR-050).</param>
    /// <param name="feedBroadcaster">The real-time fan-out that carries <c>PostPinChanged</c>.</param>
    /// <param name="logger">Operational log (the pin record and push failures).</param>
    /// <param name="scenarioNow">The exercise's scenario now for telemetry (engine-runtime/08, CLK-2: clock, else latest post, else now).</param>
    public PinService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        IOrganizationContext organizationContext,
        IExerciseClock exerciseClock,
        IFeedBroadcaster feedBroadcaster,
        ILogger<PinService> logger,
        IScenarioNow scenarioNow)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(organizationContext);
        ArgumentNullException.ThrowIfNull(exerciseClock);
        ArgumentNullException.ThrowIfNull(feedBroadcaster);
        ArgumentNullException.ThrowIfNull(logger);
        ArgumentNullException.ThrowIfNull(scenarioNow);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _organizationContext = organizationContext;
        _exerciseClock = exerciseClock;
        _feedBroadcaster = feedBroadcaster;
        _logger = logger;
        _scenarioNow = scenarioNow;
    }

    /// <summary>
    /// Pins <paramref name="postId"/> for everyone in the caller's exercise, or succeeds as a no-op when it already is.
    /// </summary>
    /// <param name="postId">The post. Resolved only through the exercise-scoped post set; must not be taken down.</param>
    /// <param name="staffUserId">The acting staff user, from the server-resolved session principal.</param>
    /// <param name="sessionId">The acting staff session, for the telemetry actor.</param>
    /// <param name="cancellationToken">Cancellation token for the reads and the write.</param>
    /// <returns>The outcome the endpoint maps to an HTTP status.</returns>
    public Task<PinOutcome> PinForAllAsync(
        Guid postId, Guid staffUserId, Guid sessionId, CancellationToken cancellationToken = default) =>
        MutateAsync(postId, pin: true, staffUserId, sessionId, cancellationToken);

    /// <summary>
    /// Clears the exercise pin on <paramref name="postId"/>, or succeeds as a no-op when it is not pinned. Allowed on a
    /// taken-down post.
    /// </summary>
    /// <param name="postId">The post. Resolved only through the exercise-scoped post set.</param>
    /// <param name="staffUserId">The acting staff user, from the server-resolved session principal.</param>
    /// <param name="sessionId">The acting staff session, for the telemetry actor.</param>
    /// <param name="cancellationToken">Cancellation token for the reads and the write.</param>
    /// <returns>The outcome the endpoint maps to an HTTP status.</returns>
    public Task<PinOutcome> UnpinForAllAsync(
        Guid postId, Guid staffUserId, Guid sessionId, CancellationToken cancellationToken = default) =>
        MutateAsync(postId, pin: false, staffUserId, sessionId, cancellationToken);

    /// <summary>The one write path both directions share.</summary>
    private async Task<PinOutcome> MutateAsync(
        Guid postId, bool pin, Guid staffUserId, Guid sessionId, CancellationToken cancellationToken)
    {
        // 1. Scope comes only from IExerciseContext (COR-001). Fail closed when it is unresolved.
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return PinOutcome.ScopeUnresolved;
        }

        var exerciseId = scope.Value;

        // 2. Resolve through the scoped set with a LINQ predicate (never Find). Another exercise's id does not match,
        //    so it is indistinguishable from an unknown id (DP-16).
        var post = await _dbContext.Posts
            .AsNoTracking()
            .Where(candidate => candidate.Id == postId && candidate.ExerciseId == exerciseId)
            .Select(candidate => new { candidate.DeletedAt, candidate.PinnedForAllAt, candidate.CreatedScenarioTime })
            .FirstOrDefaultAsync(cancellationToken);
        if (post is null || (pin && post.DeletedAt is not null))
        {
            return PinOutcome.NotFound;
        }

        // 3. Idempotent repeat: the world already holds what the caller asked for. No write, no event, no push.
        if ((post.PinnedForAllAt is not null) == pin)
        {
            return PinOutcome.Unchanged;
        }

        // 4. One wall-clock read (telemetry only) and one scenario instant shared by the row and its event.
        var now = DateTimeOffset.UtcNow;
        var exercise = await ReadExerciseAsync(exerciseId, cancellationToken);
        // A running clock is used as is; otherwise the exercise's latest post (IScenarioNow, engine-runtime/08), clamped.
        var scenarioTime = _exerciseClock.CurrentScenarioTime(exerciseId)
            ?? Later(
                await _scenarioNow.FindAsync(exerciseId, cancellationToken) ?? post.CreatedScenarioTime,
                post.CreatedScenarioTime);
        if (!pin && post.PinnedForAllAt is { } pinnedAt)
        {
            scenarioTime = Later(scenarioTime, pinnedAt);
        }

        var timeZone = string.IsNullOrWhiteSpace(exercise?.TimeZone) ? FallbackTimeZone : exercise.TimeZone;

        // 5. The conditional update and its single event, in one transaction.
        await using (var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken))
        {
            var affected = pin
                ? await SetPinAsync(exerciseId, postId, scenarioTime, staffUserId, cancellationToken)
                : await ClearPinAsync(exerciseId, postId, cancellationToken);

            if (affected == 0)
            {
                // A concurrent request changed the row after step 2: it was pinned/cleared already (the same
                // idempotent no-op), or it was taken down in between (a pin then answers 404, like step 2 would).
                await transaction.RollbackAsync(cancellationToken);
                return pin && await IsTakenDownAsync(exerciseId, postId, cancellationToken)
                    ? PinOutcome.NotFound
                    : PinOutcome.Unchanged;
            }

            _dbContext.TelemetryEvents.Add(
                BuildTelemetryEvent(pin, exerciseId, postId, staffUserId, sessionId, scenarioTime, timeZone, now));
            await _dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }

        // 6. Committed: record it, then tell every connected client. The request's token is NOT passed: a client
        //    that disconnects now must not cancel the push, because its retry is an idempotent no-op that would never
        //    re-send it. A failure is logged, never surfaced.
        LogPinChanged(exerciseId, postId, staffUserId, pin);
        try
        {
            await _feedBroadcaster.BroadcastPostPinChangedAsync(exerciseId, postId, pin, CancellationToken.None);
        }
#pragma warning disable CA1031 // A push fault must never turn a committed pin into a failed request.
        catch (Exception ex)
        {
            LogPinChangedBroadcastFailed(ex, exerciseId, postId);
        }
#pragma warning restore CA1031

        return PinOutcome.Changed;
    }

    /// <summary>Stamps the exercise pin on a live, unpinned post; returns the rows affected (0 or 1).</summary>
    private Task<int> SetPinAsync(
        Guid exerciseId, Guid postId, DateTimeOffset scenarioTime, Guid staffUserId, CancellationToken cancellationToken)
    {
        DateTimeOffset? pinnedAt = scenarioTime;
        var pinnedBy = staffUserId.ToString();

        return _dbContext.Posts
            .Where(candidate => candidate.ExerciseId == exerciseId
                && candidate.Id == postId
                && candidate.DeletedAt == null
                && candidate.PinnedForAllAt == null)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(candidate => candidate.PinnedForAllAt, pinnedAt)
                    .SetProperty(candidate => candidate.PinnedForAllByHumanId, pinnedBy),
                cancellationToken);
    }

    /// <summary>Clears the exercise pin (live or taken-down post); returns the rows affected (0 or 1).</summary>
    private Task<int> ClearPinAsync(Guid exerciseId, Guid postId, CancellationToken cancellationToken) =>
        _dbContext.Posts
            .Where(candidate => candidate.ExerciseId == exerciseId
                && candidate.Id == postId
                && candidate.PinnedForAllAt != null)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(candidate => candidate.PinnedForAllAt, (DateTimeOffset?)null)
                    .SetProperty(candidate => candidate.PinnedForAllByHumanId, (string?)null),
                cancellationToken);

    /// <summary>Whether the post is (now) taken down or gone from the caller's exercise.</summary>
    private async Task<bool> IsTakenDownAsync(Guid exerciseId, Guid postId, CancellationToken cancellationToken) =>
        !await _dbContext.Posts
            .AsNoTracking()
            .AnyAsync(
                candidate => candidate.ExerciseId == exerciseId && candidate.Id == postId && candidate.DeletedAt == null,
                cancellationToken);

    /// <summary>
    /// The exercise's time zone, bounded to the caller's resolved tenant. Exercise is not
    /// <see cref="IExerciseScoped"/> (it IS the scope), so the id comes from <see cref="IExerciseContext"/> only.
    /// </summary>
    private Task<ExerciseTime?> ReadExerciseAsync(Guid exerciseId, CancellationToken cancellationToken) =>
        _dbContext.Exercises
            .AsNoTracking()
            .InOrganization(_organizationContext.CurrentOrganizationId)
            .Where(exercise => exercise.Id == exerciseId)
            .Select(exercise => new ExerciseTime(exercise.TimeZone))
            .FirstOrDefaultAsync(cancellationToken);

    /// <summary>The later of two scenario instants.</summary>
    private static DateTimeOffset Later(DateTimeOffset first, DateTimeOffset second) => first >= second ? first : second;

    /// <summary>
    /// The single XC-004 event for one exercise pin change, against the locked v0 envelope. Every field is stamped
    /// server-side; the payload carries the pin's scope only (counts-only telemetry, no text, no names).
    /// </summary>
    private static TelemetryEvent BuildTelemetryEvent(
        bool pin,
        Guid exerciseId,
        Guid postId,
        Guid staffUserId,
        Guid sessionId,
        DateTimeOffset scenarioTime,
        string timeZone,
        DateTimeOffset now) => new()
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = "v0",
            ExerciseId = exerciseId,
            EventType = pin ? PinnedEventType : UnpinnedEventType,
            Channel = SocialChannel,
            Actor = new TelemetryActor
            {
                Kind = SystemActorKind,
                ActingHumanId = staffUserId.ToString(),
                SessionId = sessionId == Guid.Empty ? null : sessionId.ToString(),
                Role = ControllerRole,
            },
            WallClockTime = now,
            ScenarioTime = scenarioTime,
            TimeZone = timeZone,
            Target = new TelemetryTarget { EntityType = PostEntityType, EntityId = postId.ToString() },
            Payload = ExercisePinPayload,
            EmittedAt = now,
        };

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Information,
        Message = "Post {PostId} in exercise {ExerciseId}: pinned for everyone = {PinnedForAll}, by staff user {StaffUserId}.")]
    private partial void LogPinChanged(Guid exerciseId, Guid postId, Guid staffUserId, bool pinnedForAll);

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Warning,
        Message = "PostPinChanged broadcast failed for post {PostId} in exercise {ExerciseId}. The pin is committed; clients see it on their next read.")]
    private partial void LogPinChangedBroadcastFailed(Exception exception, Guid exerciseId, Guid postId);

    /// <summary>The exercise's time zone.</summary>
    private sealed record ExerciseTime(string TimeZone);
}

/// <summary>What an exercise pin call did. <see cref="PinEndpoints"/> maps each value to an HTTP status.</summary>
public enum PinOutcome
{
    /// <summary>The pin was set or cleared, with one XC-004 event and one <c>PostPinChanged</c> push. 204.</summary>
    Changed,

    /// <summary>Already in the requested state (or a lost race): nothing written, emitted or pushed. 204.</summary>
    Unchanged,

    /// <summary>
    /// The post is unknown, in another exercise, or (for a pin) taken down. One indistinguishable 404 (COR-001).
    /// </summary>
    NotFound,

    /// <summary>The request's exercise scope is unresolved. Fails closed. 401.</summary>
    ScopeUnresolved,
}
