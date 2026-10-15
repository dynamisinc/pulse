namespace Pulse.WebApi.Features.Social.Reactions;

using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social.Engagement;
using Pulse.WebApi.Features.Social.Follows;

/// <summary>
/// The write side of persisted reactions (demo-polish B3, SOC-030 like, SOC-020 repost as a toggle): makes the
/// caller's session-bound persona hold, or stop holding, an ACTIVE <see cref="PostReaction"/> of one kind on one
/// post, and reports the post's displayed counts afterwards. Scoped lifetime, matching the
/// <see cref="PulseDbContext"/> unit of work it writes through. Modelled on <see cref="FollowService"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Personal pin (demo-feedback DF-6).</b> <see cref="ReactionKinds.Pin"/> rides this same write path: same
/// participant-only allowlist, same visibility check, same soft delete and filtered unique index. It differs only in
/// what it reports and emits: it never moves a displayed count (the engagement reader counts <c>like</c> and
/// <c>repost</c> explicitly), its state is <see cref="PostViewerStateDto.Pinned"/>, and its XC-004 event is
/// <c>post.pinned</c> / <c>post.unpinned</c> with <c>{"scope":"personal"}</c>.
/// </para>
/// <para>
/// <b>Live engagement (demo-feedback DF-17 / DF-18).</b> After a like or repost add or remove that CHANGED state has
/// committed, the service pushes <c>PostEngagementChanged { postId, counts, version }</c> to the exercise group
/// through <see cref="IFeedBroadcaster"/>: the same shown counts this call returns (read through the one engagement
/// reader, never a second counting query) and the database-derived version from <see cref="PostEngagementVersion"/>,
/// read BEFORE the counts. Never for a <c>pin</c>, never for a no-op or a lost race, and the payload never carries
/// <c>viewer</c>, <c>active</c>, the actor or a baseline / real split. The write has committed by then, so a failed
/// version read or broadcast is logged and swallowed: it never fails the request (whose retry would be a no-op that
/// pushes nothing), and connected participants pick the numbers up on their next read.
/// </para>
/// </remarks>
/// <remarks>
/// <para>
/// <b>Nothing about identity or scope is client-supplied (COR-001).</b> The exercise comes ONLY from
/// <see cref="IExerciseContext"/>, the reacting persona ONLY from the caller's session
/// (<see cref="ICurrentSessionPersonaAccessor"/>). The one value a caller supplies, the post id, is resolved through
/// the exercise-scoped <c>Posts</c> set with a LINQ predicate, so another exercise's real post id does not resolve:
/// it gets the same 404 as an unknown id and nothing is written (DP-16). The reacting persona is resolved through
/// the scoped <c>Personas</c> set too, so a session bound to another exercise's persona cannot react (403).
/// </para>
/// <para>
/// <b>Participant-only, by a POSITIVE allowlist on the session kind (DP-10).</b> Only a <c>participant</c>-kind
/// session with a bound persona may react, exactly as <c>PostAttributionResolver</c> matches the participant arm. A
/// staff session can carry a persona binding too (E7 persona operation), and so could any future kind, so "not
/// staff" would be the wrong test. Everything else is a 403.
/// </para>
/// <para>
/// <b>Soft delete only (DP-15, XC-010).</b> Un-liking or un-reposting stamps <see cref="PostReaction.DeletedAt"/>;
/// no reaction row is ever deleted. Re-liking inserts a NEW active row, so the inactive rows are the like/unlike
/// history. The filtered unique index <c>IX_PostReactions_PostId_PersonaId_Kind</c> (<c>DeletedAt IS NULL</c>)
/// keeps at most one active row per (post, persona, kind).
/// </para>
/// <para>
/// <b>Idempotent, one XC-004 event per state change.</b> A repeat that changes nothing writes nothing and emits
/// nothing. A concurrent double-submit is folded into the same idempotent success in both directions:
/// <list type="bullet">
///   <item><description>Activate: the loser's insert hits the filtered unique index (SQL error 2601/2627 naming
///   <c>IX_PostReactions_PostId_PersonaId_Kind</c>; nothing else is folded); the tracker is cleared (which discards
///   its pending event), the database is re-read, and the call folds to "unchanged" only when an active row really
///   exists. Any other persistence failure is rethrown, never hidden behind a 200.</description></item>
///   <item><description>Deactivate: a soft delete is an UPDATE, which a racing request cannot make fail, so the
///   service makes the race visible instead. Inside ONE database transaction it runs a conditional
///   <c>UPDATE … SET DeletedAt WHERE Id = @activeRow AND DeletedAt IS NULL</c> and then saves the event. The loser's UPDATE
///   affects zero rows, so it rolls back and emits nothing. The transaction keeps the row change and its event a
///   single unit of work.</description></item>
/// </list>
/// </para>
/// <para>
/// <b>Scenario time (COR-053).</b> The new row's <see cref="PostReaction.CreatedScenarioTime"/>, the soft delete's
/// <see cref="PostReaction.DeletedAt"/> and the event's scenario instant are ONE value, resolved server-side (the
/// order the takedown uses):
/// <list type="number">
///   <item><description>A RUNNING exercise clock is authoritative and is used as-is, never clamped:
///   <see cref="Post.CreatedScenarioTime"/> can still be client-supplied this phase, so a post stamped ahead of the
///   clock must not drag every other participant's reaction time forward.</description></item>
///   <item><description>Otherwise the exercise's persisted <c>CurrentScenarioTime</c>, else the post's own
///   <see cref="Post.CreatedScenarioTime"/> (always a scenario instant), CLAMPED to be no earlier than the post's
///   instant: the stored value is written only by the seed and can be stale.</description></item>
///   <item><description>An un-like is additionally never earlier than the active row's own
///   <see cref="PostReaction.CreatedScenarioTime"/>, so the history never shows an un-like before its like (e.g. a
///   like stamped by a running clock that a host restart has since lost).</description></item>
/// </list>
/// The wall clock is NEVER stamped into scenario time (DP-15); it is used only for the telemetry envelope's
/// <c>wallClockTime</c> / <c>emittedAt</c>.
/// </para>
/// </remarks>
public sealed partial class ReactionService
{
    /// <summary>XC-004 <c>eventType</c> for a like / unlike (the shape the frontend already emits).</summary>
    private const string LikeEventType = "reaction";

    /// <summary>XC-004 <c>eventType</c> for a repost / undo.</summary>
    private const string RepostEventType = "repost";

    private const string LikedPayload = "{\"reaction\":\"like\",\"liked\":true}";
    private const string UnlikedPayload = "{\"reaction\":\"like\",\"liked\":false}";
    private const string RepostedPayload = "{\"reposted\":true}";
    private const string UnrepostedPayload = "{\"reposted\":false}";

    /// <summary>XC-004 <c>eventType</c> for a personal pin (demo-feedback telemetry, story 04).</summary>
    private const string PinnedEventType = "post.pinned";

    /// <summary>XC-004 <c>eventType</c> for removing a personal pin.</summary>
    private const string UnpinnedEventType = "post.unpinned";

    /// <summary>The pin/unpin payload: counts-only telemetry carries the pin's scope and nothing else.</summary>
    private const string PersonalPinPayload = "{\"scope\":\"personal\"}";

    private const string SocialChannel = "social";
    private const string PersonaActorKind = "persona";
    private const string PostEntityType = "post";
    private const string FallbackTimeZone = "UTC";

    /// <summary>The filtered unique index that holds at most one ACTIVE reaction per (post, persona, kind) (DP-15).</summary>
    private const string ActiveReactionIndexName = "IX_PostReactions_PostId_PersonaId_Kind";

    /// <summary>SQL Server: "Cannot insert duplicate key row in object … with unique index …".</summary>
    private const int DuplicateKeyErrorNumber = 2601;

    /// <summary>SQL Server: "Violation of … constraint …".</summary>
    private const int UniqueConstraintErrorNumber = 2627;

    /// <summary>The <c>PostOrigin</c> value for a participant acting as their own account (the only caller allowed).</summary>
    private const string ParticipantOrigin = "participant";

    /// <summary>
    /// The <c>Session.Kind</c> allowed to react. A positive allowlist (DP-10): <c>Session.Kind</c> is a free string,
    /// so classifying by "not staff" would admit any future kind that carries a persona binding.
    /// </summary>
    private const string ParticipantSessionKind = "participant";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentSessionPersonaAccessor _sessionPersonaAccessor;
    private readonly IExerciseClock _exerciseClock;
    private readonly IPostEngagementReader _engagementReader;
    private readonly IFeedBroadcaster _feedBroadcaster;
    private readonly ILogger<ReactionService> _logger;

    /// <summary>
    /// Creates the service over its persistence, scope, session-identity, clock, engagement, fan-out and logging
    /// collaborators.
    /// </summary>
    /// <param name="dbContext">The persistence context the reaction and its telemetry event are written through.</param>
    /// <param name="exerciseContext">The server-authoritative exercise scope (COR-001), the sole scoping source.</param>
    /// <param name="sessionPersonaAccessor">Resolves the caller's session-bound persona (the reactor).</param>
    /// <param name="exerciseClock">The native per-exercise scenario clock (COR-050).</param>
    /// <param name="engagementReader">
    /// The engagement read the feed uses too, so the counts this service returns equal what the next feed read shows.
    /// </param>
    /// <param name="feedBroadcaster">The real-time fan-out that carries <c>PostEngagementChanged</c> (DF-17).</param>
    /// <param name="logger">Operational log for a failed push (never telemetry).</param>
    public ReactionService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ICurrentSessionPersonaAccessor sessionPersonaAccessor,
        IExerciseClock exerciseClock,
        IPostEngagementReader engagementReader,
        IFeedBroadcaster feedBroadcaster,
        ILogger<ReactionService> logger)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(sessionPersonaAccessor);
        ArgumentNullException.ThrowIfNull(exerciseClock);
        ArgumentNullException.ThrowIfNull(engagementReader);
        ArgumentNullException.ThrowIfNull(feedBroadcaster);
        ArgumentNullException.ThrowIfNull(logger);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _sessionPersonaAccessor = sessionPersonaAccessor;
        _exerciseClock = exerciseClock;
        _engagementReader = engagementReader;
        _feedBroadcaster = feedBroadcaster;
        _logger = logger;
    }

    /// <summary>
    /// Makes the caller's persona hold an active <paramref name="kind"/> reaction on <paramref name="postId"/>, or
    /// succeeds as a no-op when it already does. Emits exactly one XC-004 event with a real change, none otherwise.
    /// </summary>
    /// <param name="postId">The post to react to. Resolved through the exercise-scoped post set.</param>
    /// <param name="kind">The route's reaction kind; must be exactly <c>like</c>, <c>repost</c> or <c>pin</c>.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome the endpoint maps to an HTTP status.</returns>
    public Task<ReactionResult> ReactAsync(Guid postId, string? kind, CancellationToken cancellationToken = default) =>
        MutateAsync(postId, kind, activate: true, cancellationToken);

    /// <summary>
    /// Soft-deletes the caller's persona's active <paramref name="kind"/> reaction on <paramref name="postId"/>, or
    /// succeeds as a no-op when there is none. Emits exactly one XC-004 event with a real change, none otherwise.
    /// </summary>
    /// <param name="postId">The post to stop reacting to. Resolved through the exercise-scoped post set.</param>
    /// <param name="kind">The route's reaction kind; must be exactly <c>like</c>, <c>repost</c> or <c>pin</c>.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome the endpoint maps to an HTTP status.</returns>
    public Task<ReactionResult> UnreactAsync(Guid postId, string? kind, CancellationToken cancellationToken = default) =>
        MutateAsync(postId, kind, activate: false, cancellationToken);

    /// <summary>The one write path both <see cref="ReactAsync"/> and <see cref="UnreactAsync"/> share.</summary>
    /// <param name="postId">The post being reacted to.</param>
    /// <param name="requestedKind">The route's reaction kind.</param>
    /// <param name="activate"><c>true</c> to hold an active reaction, <c>false</c> to soft-delete it.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome the endpoint maps to an HTTP status.</returns>
    private async Task<ReactionResult> MutateAsync(
        Guid postId, string? requestedKind, bool activate, CancellationToken cancellationToken)
    {
        // 1. Scope comes ONLY from IExerciseContext (COR-001). Fail closed on an unresolved scope.
        if (!TryGetScope(out var exerciseId))
        {
            return ReactionResult.ScopeUnresolved();
        }

        // 2. The reactor is the caller's session-bound persona, and only a PARTICIPANT session may react (DP-10).
        //    Staff, read-only and persona-less sessions, any unknown kind, and a session bound to a different
        //    exercise than the resolved one are all refused rather than written for.
        var sessionPersona = await _sessionPersonaAccessor.GetCurrentSessionPersonaAsync(cancellationToken);
        if (sessionPersona is null
            || !IsParticipantKind(sessionPersona.Kind)
            || sessionPersona.ExerciseId != exerciseId)
        {
            return ReactionResult.Forbidden();
        }

        if (!TryParseKind(requestedKind, out var kind))
        {
            return ReactionResult.Invalid("kind must be 'like', 'repost' or 'pin'.");
        }

        // 3. The reacting persona must exist IN THIS EXERCISE. The central filter already scopes the read; the
        //    explicit predicate keeps the isolation visible at the call site.
        var personaId = sessionPersona.PersonaId;
        var personaInScope = await _dbContext.Personas
            .AsNoTracking()
            .AnyAsync(persona => persona.Id == personaId && persona.ExerciseId == exerciseId, cancellationToken);
        if (!personaInScope)
        {
            return ReactionResult.Forbidden();
        }

        // 4. The post must exist IN THIS EXERCISE and not be taken down. A LINQ predicate over the scoped set (not
        //    Find, which can answer from the tracker) so the central filter is the access check, plus the explicit
        //    ExerciseId predicate as defense in depth. Another exercise's real post id, an unknown id and a
        //    soft-deleted post are indistinguishable: all three are the same 404, before anything is written.
        var baseline = await _dbContext.Posts
            .AsNoTracking()
            .Where(post => post.Id == postId && post.ExerciseId == exerciseId && post.DeletedAt == null)
            .Select(post => new ReactionBaseline(
                post.BaselineReplyCount, post.BaselineRepostCount, post.BaselineLikeCount, post.CreatedScenarioTime))
            .FirstOrDefaultAsync(cancellationToken);
        if (baseline is null)
        {
            return ReactionResult.UnknownPost();
        }

        // 5. Idempotent repeat: the world already holds what the caller asked for. No row, no event.
        var activeReaction = await FindActiveReactionAsync(postId, personaId, kind, cancellationToken);
        if ((activeReaction is not null) == activate)
        {
            return ReactionResult.Unchanged(
                await ReadStateAsync(postId, personaId, kind, baseline, cancellationToken));
        }

        // 6. One wall-clock read for the telemetry envelope ONLY, and ONE scenario instant shared by the row and its
        //    event. Scenario time is never the wall clock (DP-15); see the type remarks for the order.
        var now = DateTimeOffset.UtcNow;
        // org-scope-exempt(ResolvedScope): exerciseId comes from TryGetScope (IExerciseContext) at step 1 and is
        // never a request field; it only supplies the scenario-time fallback and the telemetry time zone.
        var exercise = await _dbContext.Exercises
            .AsNoTracking()
            .Where(candidate => candidate.Id == exerciseId)
            .Select(candidate => new { candidate.CurrentScenarioTime, candidate.TimeZone })
            .FirstOrDefaultAsync(cancellationToken);
        // A RUNNING clock is authoritative and is not clamped (the post's own time may be client-supplied). Only the
        // fallbacks are clamped to the post: the stored CurrentScenarioTime is seed-written and can be stale.
        var scenarioTime = _exerciseClock.CurrentScenarioTime(exerciseId)
            ?? Later(exercise?.CurrentScenarioTime ?? baseline.PostScenarioTime, baseline.PostScenarioTime);

        // An un-like never precedes the like it ends (its row's own scenario instant), whatever the source above.
        if (!activate)
        {
            scenarioTime = Later(scenarioTime, activeReaction!.CreatedScenarioTime);
        }
        var timeZone = string.IsNullOrWhiteSpace(exercise?.TimeZone) ? FallbackTimeZone : exercise.TimeZone;

        var telemetryEvent = BuildTelemetryEvent(
            kind, activate, exerciseId, sessionPersona, postId, scenarioTime, timeZone, now);

        var changed = activate
            ? await ActivateAsync(exerciseId, postId, personaId, kind, scenarioTime, telemetryEvent, cancellationToken)
            : await DeactivateAsync(exerciseId, activeReaction!.Id, scenarioTime, telemetryEvent, cancellationToken);

        // 7. DF-17: a COUNTED kind that really changed state pushes the post's new shown counts. The version is read
        //    FIRST and the counts second (PostEngagementVersion's remarks), and the counts are the very ones this call
        //    returns. A pin, a no-op and a lost race push nothing.
        var version = changed && IsCountedKind(kind)
            ? await TryReadVersionAsync(exerciseId, postId)
            : null;

        // The write has committed; when a push is pending its counts come from this read, so a client that
        // disconnects now must not cancel it (Gate-1 L-1). Without a push the request's token still applies.
        var state = await ReadStateAsync(
            postId, personaId, kind, baseline, version is null ? cancellationToken : CancellationToken.None);

        if (version is { } committedVersion)
        {
            await BroadcastEngagementAsync(
                exerciseId, postId, PostEngagementChangedDto.For(postId, state.Counts, committedVersion));
        }

        return changed ? ReactionResult.Changed(state) : ReactionResult.Unchanged(state);
    }

    /// <summary>Whether <paramref name="kind"/> moves a shown count (like, repost), unlike a personal pin (DF-6).</summary>
    private static bool IsCountedKind(string kind) =>
        string.Equals(kind, ReactionKinds.Like, StringComparison.Ordinal)
        || string.Equals(kind, ReactionKinds.Repost, StringComparison.Ordinal);

    /// <summary>
    /// The post's database-derived version after the committed change, or <c>null</c> (logged) when it cannot be read:
    /// the write has committed, so a failed read only means no push. The request's token is not used: a client that
    /// disconnects now must not cancel the push its write caused.
    /// </summary>
    private async Task<long?> TryReadVersionAsync(Guid exerciseId, Guid postId)
    {
        try
        {
            return await PostEngagementVersion.ReadAsync(_dbContext, postId, CancellationToken.None);
        }
#pragma warning disable CA1031 // A failed post-commit read must never turn a committed reaction into a failed request.
        catch (Exception ex)
        {
            LogEngagementBroadcastFailed(ex, exerciseId, postId);
            return null;
        }
#pragma warning restore CA1031
    }

    /// <summary>
    /// Sends <c>PostEngagementChanged</c> to the exercise group. A failure is logged and swallowed (the reaction has
    /// committed; the same rule as every other broadcast). The request's token is not used, as above.
    /// </summary>
    private async Task BroadcastEngagementAsync(Guid exerciseId, Guid postId, PostEngagementChangedDto change)
    {
        try
        {
            await _feedBroadcaster.BroadcastPostEngagementChangedAsync(exerciseId, change, CancellationToken.None);
        }
#pragma warning disable CA1031 // A broadcast fault must never turn a committed reaction into a failed request.
        catch (Exception ex)
        {
            LogEngagementBroadcastFailed(ex, exerciseId, postId);
        }
#pragma warning restore CA1031
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "PostEngagementChanged push failed for post {PostId} in exercise {ExerciseId}. The reaction is committed; connected participants see the new counts on their next read.")]
    private partial void LogEngagementBroadcastFailed(Exception exception, Guid exerciseId, Guid postId);

    /// <summary>
    /// Inserts a new ACTIVE reaction and its event in one <c>SaveChanges</c>, folding a lost double-submit race on
    /// the filtered unique index into an idempotent no-op.
    /// </summary>
    /// <returns><c>true</c> when this call created the active row; <c>false</c> when a racing request already had.</returns>
    private async Task<bool> ActivateAsync(
        Guid exerciseId,
        Guid postId,
        Guid personaId,
        string kind,
        DateTimeOffset scenarioTime,
        TelemetryEvent telemetryEvent,
        CancellationToken cancellationToken)
    {
        _dbContext.PostReactions.Add(new PostReaction
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            PostId = postId,
            PersonaId = personaId,
            Kind = kind,
            CreatedScenarioTime = scenarioTime,
        });
        _dbContext.TelemetryEvents.Add(telemetryEvent);

        try
        {
            // One SaveChanges: the row and its single XC-004 event land together or not at all. The write guard
            // checks ExerciseId != Guid.Empty on both scoped rows (COR-001).
            await _dbContext.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException exception) when (IsActiveReactionUniqueViolation(exception))
        {
            // A concurrent request with the SAME intent beat this one past the existence check, and the filtered
            // unique index refused the second active row. Clearing the tracker drops this unit of work's event
            // with the row: the winner already emitted the one event for the one state change. Any other failure
            // is not caught at all.
            _dbContext.ChangeTracker.Clear();

            if (await FindActiveReactionAsync(postId, personaId, kind, cancellationToken) is null)
            {
                // The database does NOT hold what the caller asked for, so this was not the race. It is a real
                // persistence failure; surface it instead of claiming a write that never happened.
                throw;
            }

            return false;
        }
    }

    /// <summary>
    /// Soft-deletes the ACTIVE reaction found at step 5 (stamps <see cref="PostReaction.DeletedAt"/> in scenario time;
    /// never a hard delete) and saves its event, inside one transaction. The update targets that exact row, so the
    /// stamp computed from its <see cref="PostReaction.CreatedScenarioTime"/> is the one written to it. The conditional
    /// update is what makes a concurrent double un-like visible: the loser's update affects zero rows, so it rolls
    /// back and emits nothing.
    /// </summary>
    /// <returns><c>true</c> when this call deactivated the row; <c>false</c> when a racing request already had.</returns>
    private async Task<bool> DeactivateAsync(
        Guid exerciseId,
        Guid activeReactionId,
        DateTimeOffset scenarioTime,
        TelemetryEvent telemetryEvent,
        CancellationToken cancellationToken)
    {
        DateTimeOffset? deletedAt = scenarioTime;

        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        // Runs through the scoped set, so the central filter applies to the UPDATE's WHERE as well as the explicit
        // ExerciseId predicate. Only DeletedAt is written; ExerciseId is never touched, so the write guard (which
        // ExecuteUpdate bypasses) has nothing to check here.
        var affected = await _dbContext.PostReactions
            .Where(reaction => reaction.ExerciseId == exerciseId
                && reaction.Id == activeReactionId
                && reaction.DeletedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(reaction => reaction.DeletedAt, deletedAt), cancellationToken);

        if (affected == 0)
        {
            // A concurrent un-like already deactivated it: the world holds what the caller asked for, one tap late.
            await transaction.RollbackAsync(cancellationToken);
            return false;
        }

        _dbContext.TelemetryEvents.Add(telemetryEvent);
        await _dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    /// <summary>
    /// The persona's ACTIVE reaction of <paramref name="kind"/> on the post (scoped read), or <c>null</c> when there is
    /// none. Returns the row's id and its own scenario instant (the floor for an un-like's stamp).
    /// </summary>
    private Task<ActiveReaction?> FindActiveReactionAsync(
        Guid postId, Guid personaId, string kind, CancellationToken cancellationToken) =>
        _dbContext.PostReactions
            .AsNoTracking()
            .Where(reaction => reaction.PostId == postId
                && reaction.PersonaId == personaId
                && reaction.Kind == kind
                && reaction.DeletedAt == null)
            .Select(reaction => new ActiveReaction(reaction.Id, reaction.CreatedScenarioTime))
            .FirstOrDefaultAsync(cancellationToken);

    /// <summary>The later of two scenario instants.</summary>
    private static DateTimeOffset Later(DateTimeOffset first, DateTimeOffset second) => first >= second ? first : second;

    /// <summary>
    /// Whether a failed save is the filtered unique index on ACTIVE reactions refusing a second active row (the
    /// double-submit race), as opposed to any other database error, which must surface.
    /// </summary>
    private static bool IsActiveReactionUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is SqlException { Number: DuplicateKeyErrorNumber or UniqueConstraintErrorNumber } sqlException
        && sqlException.Message.Contains(ActiveReactionIndexName, StringComparison.Ordinal);

    /// <summary>
    /// The caller-observable state after the call: counts = baseline + real, and the viewer flags, both read through
    /// the same <see cref="IPostEngagementReader"/> the feed projection uses.
    /// </summary>
    private async Task<ReactionStateDto> ReadStateAsync(
        Guid postId, Guid personaId, string kind, ReactionBaseline baseline, CancellationToken cancellationToken)
    {
        var engagement = await _engagementReader.GetAsync([postId], personaId, cancellationToken);
        var real = engagement.TryGetValue(postId, out var found)
            ? found
            : new PostEngagement(0, 0, 0, ViewerLiked: false, ViewerReposted: false, ViewerPinned: false);

        var active = kind switch
        {
            ReactionKinds.Like => real.ViewerLiked,
            ReactionKinds.Pin => real.ViewerPinned,
            _ => real.ViewerReposted,
        };

        return new ReactionStateDto(
            postId.ToString(),
            kind,
            active,
            new ParticipantPostCounts(
                Reply: baseline.Reply + real.RealReply,
                Repost: baseline.Repost + real.RealRepost,
                Like: baseline.Like + real.RealLike),
            new PostViewerStateDto(real.ViewerLiked, real.ViewerReposted, real.ViewerPinned));
    }

    /// <summary>
    /// Builds the single XC-004 event for one reaction state change against the locked v0 envelope. Every field is
    /// stamped server-side: exercise from the resolved scope, actor persona, acting human and session from the
    /// persisted session, the instants from the server. Wall-clock is telemetry-only.
    /// </summary>
    private static TelemetryEvent BuildTelemetryEvent(
        string kind,
        bool activate,
        Guid exerciseId,
        CurrentSessionPersona sessionPersona,
        Guid postId,
        DateTimeOffset scenarioTime,
        string timeZone,
        DateTimeOffset now)
    {
        var (eventType, payload) = kind switch
        {
            ReactionKinds.Like => (LikeEventType, activate ? LikedPayload : UnlikedPayload),
            ReactionKinds.Pin => (activate ? PinnedEventType : UnpinnedEventType, PersonalPinPayload),
            _ => (RepostEventType, activate ? RepostedPayload : UnrepostedPayload),
        };

        return new TelemetryEvent
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = "v0",
            ExerciseId = exerciseId,
            EventType = eventType,
            Channel = SocialChannel,
            Actor = new TelemetryActor
            {
                Kind = PersonaActorKind,
                PersonaId = sessionPersona.PersonaId.ToString(),
                // Off-envelope empty strings are null-omitted: v0 types actor.actingHumanId as string().min(1).optional().
                ActingHumanId = string.IsNullOrEmpty(sessionPersona.ActingHumanId) ? null : sessionPersona.ActingHumanId,
                SessionId = sessionPersona.SessionId.ToString(),
            },
            Origin = ParticipantOrigin,
            WallClockTime = now,
            ScenarioTime = scenarioTime,
            TimeZone = timeZone,
            Target = new TelemetryTarget
            {
                EntityType = PostEntityType,
                EntityId = postId.ToString(),
            },
            Payload = payload,
            EmittedAt = now,
        };
    }

    /// <summary>Maps the route's kind onto the closed vocabulary; exact, ordinal match only.</summary>
    private static bool TryParseKind(string? requestedKind, out string kind)
    {
        if (string.Equals(requestedKind, ReactionKinds.Like, StringComparison.Ordinal))
        {
            kind = ReactionKinds.Like;
            return true;
        }

        if (string.Equals(requestedKind, ReactionKinds.Repost, StringComparison.Ordinal))
        {
            kind = ReactionKinds.Repost;
            return true;
        }

        // demo-feedback DF-6: a personal pin is a reaction too, but never a counted one.
        if (string.Equals(requestedKind, ReactionKinds.Pin, StringComparison.Ordinal))
        {
            kind = ReactionKinds.Pin;
            return true;
        }

        kind = string.Empty;
        return false;
    }

    /// <summary>Whether a persisted <c>Session.Kind</c> is exactly the participant kind (positive allowlist).</summary>
    private static bool IsParticipantKind(string sessionKind) =>
        string.Equals(sessionKind, ParticipantSessionKind, StringComparison.Ordinal);

    /// <summary>
    /// Reads the request's resolved exercise scope, treating an unset scope and the <see cref="Guid.Empty"/>
    /// fail-closed sentinel alike as "no scope" (COR-001).
    /// </summary>
    private bool TryGetScope(out Guid exerciseId)
    {
        var scope = _exerciseContext.CurrentExerciseId;
        exerciseId = scope ?? Guid.Empty;
        return scope is not null && exerciseId != Guid.Empty;
    }

    /// <summary>
    /// What the reaction path reads off the post: its seeded engagement baseline (staff-only on the wire; used here only
    /// to add to the real counts) and its own scenario instant (the last scenario-time fallback).
    /// </summary>
    private sealed record ReactionBaseline(int Reply, int Repost, int Like, DateTimeOffset PostScenarioTime);

    /// <summary>The caller's currently active reaction row: its id and its own scenario instant.</summary>
    private sealed record ActiveReaction(Guid Id, DateTimeOffset CreatedScenarioTime);
}

/// <summary>The outcome kind of a <see cref="ReactionService"/> call.</summary>
public enum ReactionOutcome
{
    /// <summary>The reaction was activated or soft-deleted, and exactly one XC-004 event was persisted with it.</summary>
    Changed,

    /// <summary>The request was already satisfied (an idempotent repeat or a lost race): nothing written, nothing emitted.</summary>
    Unchanged,

    /// <summary>No exercise scope was resolved for the request: fail closed (401).</summary>
    ScopeUnresolved,

    /// <summary>
    /// The caller may not react: not a participant session, no bound persona, or a persona that is not in this
    /// exercise (403, DP-10).
    /// </summary>
    Forbidden,

    /// <summary>
    /// The post does not exist IN THIS EXERCISE or is taken down, including another exercise's real post id
    /// (404, identical for every case, DP-16).
    /// </summary>
    UnknownPost,

    /// <summary>The request failed validation, e.g. an unknown kind (400).</summary>
    Invalid,
}

/// <summary>
/// The result of a reaction call. <see cref="State"/> is the caller-observable state AFTER the call for both
/// <see cref="ReactionOutcome.Changed"/> and <see cref="ReactionOutcome.Unchanged"/>, so a repeat yields the same
/// response body: that is what makes the endpoint idempotent from a client's point of view.
/// </summary>
public sealed class ReactionResult
{
    private ReactionResult(ReactionOutcome outcome, ReactionStateDto? state, string? validationError)
    {
        Outcome = outcome;
        State = state;
        ValidationError = validationError;
    }

    /// <summary>Which outcome occurred.</summary>
    public ReactionOutcome Outcome { get; }

    /// <summary>The state after the call; non-null only for the two success outcomes.</summary>
    public ReactionStateDto? State { get; }

    /// <summary>The validation message; non-null only for <see cref="ReactionOutcome.Invalid"/>.</summary>
    public string? ValidationError { get; }

    /// <summary>Whether this call changed state (and therefore emitted exactly one XC-004 event).</summary>
    public bool StateChanged => Outcome == ReactionOutcome.Changed;

    /// <summary>A state-changing success.</summary>
    /// <param name="state">The state after the change.</param>
    /// <returns>A <see cref="ReactionOutcome.Changed"/> result.</returns>
    public static ReactionResult Changed(ReactionStateDto state)
    {
        ArgumentNullException.ThrowIfNull(state);
        return new(ReactionOutcome.Changed, state, null);
    }

    /// <summary>An idempotent no-op success.</summary>
    /// <param name="state">The (unchanged) state.</param>
    /// <returns>An <see cref="ReactionOutcome.Unchanged"/> result.</returns>
    public static ReactionResult Unchanged(ReactionStateDto state)
    {
        ArgumentNullException.ThrowIfNull(state);
        return new(ReactionOutcome.Unchanged, state, null);
    }

    /// <summary>The fail-closed result for an unresolved exercise scope.</summary>
    /// <returns>A <see cref="ReactionOutcome.ScopeUnresolved"/> result.</returns>
    public static ReactionResult ScopeUnresolved() => new(ReactionOutcome.ScopeUnresolved, null, null);

    /// <summary>The refusal for a caller that may not react.</summary>
    /// <returns>A <see cref="ReactionOutcome.Forbidden"/> result.</returns>
    public static ReactionResult Forbidden() => new(ReactionOutcome.Forbidden, null, null);

    /// <summary>The rejection for a post that is not in this exercise, unknown, or taken down.</summary>
    /// <returns>An <see cref="ReactionOutcome.UnknownPost"/> result.</returns>
    public static ReactionResult UnknownPost() => new(ReactionOutcome.UnknownPost, null, null);

    /// <summary>A rejected request.</summary>
    /// <param name="validationError">The human-readable reason.</param>
    /// <returns>An <see cref="ReactionOutcome.Invalid"/> result.</returns>
    public static ReactionResult Invalid(string validationError) => new(ReactionOutcome.Invalid, null, validationError);
}
