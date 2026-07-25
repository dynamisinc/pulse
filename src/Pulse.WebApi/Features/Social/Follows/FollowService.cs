namespace Pulse.WebApi.Features.Social.Follows;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;

/// <summary>
/// The write + read seam of the REAL follow graph (SOC-051): creates/removes <see cref="Follow"/> edges for
/// the caller's session-bound persona, serves the per-persona edge counts the displayed follower/following
/// figures compose from (SOC-054), and serves the followed-persona set the Following feed and the
/// "who to follow" suggestion module read. Scoped lifetime, matching the <see cref="PulseDbContext"/> unit of
/// work it writes through.
/// </summary>
/// <remarks>
/// <para>
/// <b>Nothing about identity or scope is client-supplied (COR-001).</b> The exercise comes ONLY from the
/// injected <see cref="IExerciseContext"/>; the FOLLOWER comes ONLY from the caller's session-bound persona
/// (<see cref="ICurrentSessionPersonaAccessor"/>). The single value a caller does supply — the followee id —
/// is resolved through the exercise-scoped <c>Personas</c> set, so an id belonging to ANOTHER exercise does
/// not resolve and the request is REJECTED (<see cref="FollowOutcome.UnknownFollowee"/> → 404), never
/// silently accepted as a no-op that looks like success.
/// </para>
/// <para>
/// <b>Idempotent by design, and by constraint.</b> Following an already-followed persona and unfollowing a
/// persona that is not followed both succeed without writing a second row or erroring. Because a no-op is not
/// a meaningful action, it emits NO telemetry: exactly one XC-004 event accompanies exactly one state change,
/// in the SAME unit of work as the edge itself. The unique index
/// <c>(ExerciseId, FollowerPersonaId, FolloweePersonaId)</c> is the backstop for a concurrent double-submit
/// that beats the existence check — the resulting unique-violation is folded back into the same idempotent
/// success rather than surfacing as a 500.
/// </para>
/// <para>
/// <b>Scenario time is server-side (COR-053).</b> The edge's and the event's scenario instant come from the
/// native per-exercise clock (COR-050) when the exercise's clock is running, falling back to the exercise's
/// persisted <c>CurrentScenarioTime</c> and finally to the server wall clock — mirroring what the identity and
/// ops slices already do. It is never read from the request body.
/// </para>
/// </remarks>
public sealed class FollowService
{
    /// <summary>XC-004 <c>eventType</c> for a newly created edge — the Phase-1 known vocabulary's <c>follow</c>.</summary>
    private const string FollowEventType = "follow";

    /// <summary>
    /// XC-004 <c>eventType</c> for a removed edge. The v0 envelope types <c>eventType</c> as an OPEN string
    /// (<c>schema.ts</c>: "documentation only … later features extend the vocabulary additively with no
    /// envelope migration"), so the inverse of <c>follow</c> is its own event type rather than a
    /// payload-encoded variant an analyst would have to parse out of the opaque payload column.
    /// </summary>
    private const string UnfollowEventType = "unfollow";

    private const string SocialChannel = "social";
    private const string PersonaActorKind = "persona";
    private const string ParticipantOrigin = "participant";
    private const string PersonaEntityType = "persona";
    private const string FallbackTimeZone = "UTC";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentSessionPersonaAccessor _sessionPersonaAccessor;
    private readonly IExerciseClock _exerciseClock;

    /// <summary>Creates the service over its persistence, scope, session-identity, and scenario-clock collaborators.</summary>
    /// <param name="dbContext">The persistence context the edge and its telemetry event are written through.</param>
    /// <param name="exerciseContext">The server-authoritative exercise scope (COR-001) — the sole scoping source.</param>
    /// <param name="sessionPersonaAccessor">Resolves the caller's session-bound persona (the follower).</param>
    /// <param name="exerciseClock">The native per-exercise scenario clock (COR-050).</param>
    public FollowService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ICurrentSessionPersonaAccessor sessionPersonaAccessor,
        IExerciseClock exerciseClock)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(sessionPersonaAccessor);
        ArgumentNullException.ThrowIfNull(exerciseClock);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _sessionPersonaAccessor = sessionPersonaAccessor;
        _exerciseClock = exerciseClock;
    }

    /// <summary>
    /// Creates the edge "caller's session persona → <paramref name="followeePersonaId"/>", or succeeds as a
    /// no-op when it already exists. Emits exactly one XC-004 <c>follow</c> event in the same unit of work as
    /// a newly created edge (and none for a no-op repeat).
    /// </summary>
    /// <param name="followeePersonaId">The persona to follow. Resolved through the exercise-scoped persona set.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome the endpoint maps to an HTTP status.</returns>
    public Task<FollowResult> FollowAsync(Guid followeePersonaId, CancellationToken cancellationToken = default) =>
        MutateAsync(followeePersonaId, follow: true, cancellationToken);

    /// <summary>
    /// Removes the edge "caller's session persona → <paramref name="followeePersonaId"/>", or succeeds as a
    /// no-op when it does not exist. Emits exactly one XC-004 <c>unfollow</c> event in the same unit of work
    /// as an actually-removed edge (and none for a no-op repeat).
    /// </summary>
    /// <param name="followeePersonaId">The persona to unfollow. Resolved through the exercise-scoped persona set.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome the endpoint maps to an HTTP status.</returns>
    public Task<FollowResult> UnfollowAsync(Guid followeePersonaId, CancellationToken cancellationToken = default) =>
        MutateAsync(followeePersonaId, follow: false, cancellationToken);

    /// <summary>
    /// The persona ids <paramref name="followerPersonaId"/> follows, inside the resolved exercise scope. Serves
    /// the "who to follow" exclusion set and the Following feed's author filter; an unresolved scope or a
    /// persona from another exercise yields an EMPTY set (the central query filter closes the door), never
    /// another exercise's graph.
    /// </summary>
    /// <param name="followerPersonaId">The persona whose outbound edges to read.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The followed persona ids, ordered by scenario time (newest edge first).</returns>
    public async Task<IReadOnlyList<Guid>> GetFollowingAsync(Guid followerPersonaId, CancellationToken cancellationToken = default)
    {
        if (!TryGetScope(out _))
        {
            return Array.Empty<Guid>();
        }

        return await _dbContext.Follows
            .AsNoTracking()
            .Where(edge => edge.FollowerPersonaId == followerPersonaId)
            .OrderByDescending(edge => edge.CreatedScenarioTime)
            .Select(edge => edge.FolloweePersonaId)
            .ToListAsync(cancellationToken);
    }

    /// <summary>
    /// The persona ids that really follow <paramref name="followeePersonaId"/> inside the resolved exercise
    /// scope — the REAL edges a follower list renders, disjoint from the SOC-054 magnitude it renders
    /// alongside them.
    /// </summary>
    /// <param name="followeePersonaId">The persona whose inbound edges to read.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The follower persona ids, ordered by scenario time (newest edge first).</returns>
    public async Task<IReadOnlyList<Guid>> GetFollowersAsync(Guid followeePersonaId, CancellationToken cancellationToken = default)
    {
        if (!TryGetScope(out _))
        {
            return Array.Empty<Guid>();
        }

        return await _dbContext.Follows
            .AsNoTracking()
            .Where(edge => edge.FolloweePersonaId == followeePersonaId)
            .OrderByDescending(edge => edge.CreatedScenarioTime)
            .Select(edge => edge.FollowerPersonaId)
            .ToListAsync(cancellationToken);
    }

    /// <summary>
    /// The whole in-scope graph's edge counts in ONE query, keyed by persona id — the shape the persona read
    /// composes its displayed counts from without an N+1 per persona. A persona with no edges in a direction
    /// is simply absent from that direction's map (the caller reads zero).
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Inbound (follower) and outbound (following) edge counts for every persona with at least one edge.</returns>
    public async Task<FollowEdgeCounts> GetEdgeCountsAsync(CancellationToken cancellationToken = default)
    {
        if (!TryGetScope(out _))
        {
            return FollowEdgeCounts.Empty;
        }

        // Two grouped aggregates over the SAME scoped set (the central query filter supplies the exercise
        // predicate, COR-001) — never a count over an unfiltered table, so no aggregate can leak another
        // exercise's graph size.
        var inbound = await _dbContext.Follows
            .AsNoTracking()
            .GroupBy(edge => edge.FolloweePersonaId)
            .Select(group => new { PersonaId = group.Key, Count = group.Count() })
            .ToListAsync(cancellationToken);

        var outbound = await _dbContext.Follows
            .AsNoTracking()
            .GroupBy(edge => edge.FollowerPersonaId)
            .Select(group => new { PersonaId = group.Key, Count = group.Count() })
            .ToListAsync(cancellationToken);

        return new FollowEdgeCounts(
            inbound.ToDictionary(row => row.PersonaId, row => row.Count),
            outbound.ToDictionary(row => row.PersonaId, row => row.Count));
    }

    /// <summary>The one write path both <see cref="FollowAsync"/> and <see cref="UnfollowAsync"/> share.</summary>
    /// <param name="followeePersonaId">The persona being followed/unfollowed.</param>
    /// <param name="follow"><c>true</c> to create the edge, <c>false</c> to remove it.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome the endpoint maps to an HTTP status.</returns>
    private async Task<FollowResult> MutateAsync(Guid followeePersonaId, bool follow, CancellationToken cancellationToken)
    {
        // 1. Scope comes ONLY from IExerciseContext (COR-001). Fail closed on an unresolved scope.
        if (!TryGetScope(out var exerciseId))
        {
            return FollowResult.ScopeUnresolved();
        }

        // 2. The FOLLOWER is the caller's session-bound persona, never a request field. No session persona →
        //    there is no one to follow AS; fail closed (403) rather than guess.
        var sessionPersona = await _sessionPersonaAccessor.GetCurrentSessionPersonaAsync(cancellationToken);
        if (sessionPersona is null)
        {
            return FollowResult.NoSessionPersona();
        }

        // 3. Defense in depth (COR-001): a session bound to a DIFFERENT exercise than the one resolved for this
        //    request must never write into this scope. SessionAuthenticationMiddleware already enforces the
        //    binding for participant sessions; a disagreement here is resolved by refusing, never by writing.
        if (sessionPersona.ExerciseId != exerciseId)
        {
            return FollowResult.NoSessionPersona();
        }

        if (followeePersonaId == Guid.Empty)
        {
            return FollowResult.Invalid("A non-empty followee persona id is required.");
        }

        if (followeePersonaId == sessionPersona.PersonaId)
        {
            // A self-edge would inflate the persona's own displayed follower count with itself; there is no
            // participant-meaningful "follow yourself".
            return FollowResult.Invalid("A persona cannot follow itself.");
        }

        // 4. Resolve BOTH personas through the exercise-scoped set. This is where the cross-exercise attempt
        //    dies: an id naming another exercise's persona does not resolve under this scope's query filter, so
        //    the request is rejected with UnknownFollowee (404) — indistinguishable from an unknown id, and
        //    never a quiet success.
        var followerExists = await _dbContext.Personas
            .AsNoTracking()
            .AnyAsync(persona => persona.Id == sessionPersona.PersonaId, cancellationToken);
        if (!followerExists)
        {
            return FollowResult.NoSessionPersona();
        }

        var followeeExists = await _dbContext.Personas
            .AsNoTracking()
            .AnyAsync(persona => persona.Id == followeePersonaId, cancellationToken);
        if (!followeeExists)
        {
            return FollowResult.UnknownFollowee();
        }

        var existing = await _dbContext.Follows
            .FirstOrDefaultAsync(
                edge => edge.FollowerPersonaId == sessionPersona.PersonaId
                    && edge.FolloweePersonaId == followeePersonaId,
                cancellationToken);

        if (follow && existing is not null)
        {
            // Idempotent repeat: the edge already exists. No second row, no error, no telemetry.
            return FollowResult.Unchanged(following: true);
        }

        if (!follow && existing is null)
        {
            // Idempotent repeat: there was nothing to remove.
            return FollowResult.Unchanged(following: false);
        }

        // 5. One server clock read shared by the edge and its telemetry event; the scenario instant is
        //    resolved server-side (COR-053), never from client input.
        var now = DateTimeOffset.UtcNow;
        var exercise = await _dbContext.Exercises
            .AsNoTracking()
            .FirstOrDefaultAsync(candidate => candidate.Id == exerciseId, cancellationToken);
        var scenarioTime = _exerciseClock.CurrentScenarioTime(exerciseId)
            ?? exercise?.CurrentScenarioTime
            ?? now;
        var timeZone = string.IsNullOrWhiteSpace(exercise?.TimeZone) ? FallbackTimeZone : exercise.TimeZone;

        Guid edgeId;
        if (follow)
        {
            var edge = new Follow
            {
                Id = Guid.NewGuid(),
                ExerciseId = exerciseId,
                FollowerPersonaId = sessionPersona.PersonaId,
                FolloweePersonaId = followeePersonaId,
                CreatedScenarioTime = scenarioTime,
                CreatedWallClock = now,
            };

            edgeId = edge.Id;
            _dbContext.Follows.Add(edge);
        }
        else
        {
            edgeId = existing!.Id;
            _dbContext.Follows.Remove(existing);
        }

        _dbContext.TelemetryEvents.Add(BuildTelemetryEvent(
            follow, exerciseId, sessionPersona, followeePersonaId, scenarioTime, timeZone, now));

        try
        {
            // One SaveChanges — the edge and its single XC-004 event land together (or not at all). The
            // write-guard validates ExerciseId != Guid.Empty on both scoped rows (COR-001).
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException) when (follow)
        {
            // The unique index caught a concurrent double-submit that beat the existence check above. The
            // caller's intent ("I follow this persona") holds either way, so fold it into the same idempotent
            // success — but drop THIS unit of work's telemetry event with it, since the winning request
            // already emitted the one event for the one state change.
            _dbContext.ChangeTracker.Clear();

            var raced = await _dbContext.Follows
                .AsNoTracking()
                .AnyAsync(
                    edge => edge.FollowerPersonaId == sessionPersona.PersonaId
                        && edge.FolloweePersonaId == followeePersonaId,
                    cancellationToken);

            if (!raced)
            {
                throw;
            }

            return FollowResult.Unchanged(following: true);
        }

        return FollowResult.Changed(follow, edgeId, scenarioTime);
    }

    /// <summary>
    /// Builds the single XC-004 event for one follow/unfollow state change, against the locked v0 envelope.
    /// Every attribution field is stamped SERVER-side: the exercise from the resolved scope, the actor persona
    /// and <c>actingHumanId</c> from the persisted session, the scenario/wall instants from the server. A
    /// client cannot supply, override, or spoof any of them.
    /// </summary>
    private static TelemetryEvent BuildTelemetryEvent(
        bool follow,
        Guid exerciseId,
        CurrentSessionPersona sessionPersona,
        Guid followeePersonaId,
        DateTimeOffset scenarioTime,
        string timeZone,
        DateTimeOffset now) => new()
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = "v0",
            ExerciseId = exerciseId,
            EventType = follow ? FollowEventType : UnfollowEventType,
            Channel = SocialChannel,
            Actor = new TelemetryActor
            {
                Kind = PersonaActorKind,
                PersonaId = sessionPersona.PersonaId.ToString(),
                // Off-envelope empty strings are null-omitted: the v0 schema types actor.actingHumanId as
                // z.string().min(1).optional().
                ActingHumanId = string.IsNullOrEmpty(sessionPersona.ActingHumanId) ? null : sessionPersona.ActingHumanId,
                SessionId = sessionPersona.SessionId.ToString(),
            },
            Origin = ParticipantOrigin,
            WallClockTime = now,
            ScenarioTime = scenarioTime,
            TimeZone = timeZone,
            Target = new TelemetryTarget
            {
                EntityType = PersonaEntityType,
                EntityId = followeePersonaId.ToString(),
            },
            EmittedAt = now,
        };

    /// <summary>
    /// Reads the request's resolved exercise scope, treating an unset scope AND the <see cref="Guid.Empty"/>
    /// fail-closed sentinel alike as "no scope" (COR-001).
    /// </summary>
    /// <param name="exerciseId">The resolved scope when this returns <c>true</c>.</param>
    /// <returns><c>true</c> when a real exercise scope is resolved.</returns>
    private bool TryGetScope(out Guid exerciseId)
    {
        var scope = _exerciseContext.CurrentExerciseId;
        exerciseId = scope ?? Guid.Empty;
        return scope is not null && exerciseId != Guid.Empty;
    }
}

/// <summary>Per-persona real follow-edge counts for one exercise scope.</summary>
/// <param name="Inbound">Edges pointing AT a persona (its real followers), keyed by persona id.</param>
/// <param name="Outbound">Edges pointing FROM a persona (the accounts it follows), keyed by persona id.</param>
public sealed record FollowEdgeCounts(
    IReadOnlyDictionary<Guid, int> Inbound,
    IReadOnlyDictionary<Guid, int> Outbound)
{
    /// <summary>The empty graph — what a fail-closed / unresolved scope reads.</summary>
    public static FollowEdgeCounts Empty { get; } = new(
        new Dictionary<Guid, int>(),
        new Dictionary<Guid, int>());

    /// <summary>Real inbound (follower) edges for <paramref name="personaId"/>; zero when it has none.</summary>
    /// <param name="personaId">The persona to read.</param>
    /// <returns>The inbound edge count.</returns>
    public int InboundFor(Guid personaId) => Inbound.TryGetValue(personaId, out var count) ? count : 0;

    /// <summary>Real outbound (following) edges for <paramref name="personaId"/>; zero when it has none.</summary>
    /// <param name="personaId">The persona to read.</param>
    /// <returns>The outbound edge count.</returns>
    public int OutboundFor(Guid personaId) => Outbound.TryGetValue(personaId, out var count) ? count : 0;
}

/// <summary>The outcome kind of a <see cref="FollowService"/> mutation.</summary>
public enum FollowOutcome
{
    /// <summary>The edge was created or removed, and exactly one XC-004 event was persisted with it.</summary>
    Changed,

    /// <summary>The request was already satisfied (an idempotent repeat): nothing was written, nothing emitted.</summary>
    Unchanged,

    /// <summary>No exercise scope was resolved for the request — fail closed (the endpoint returns 401).</summary>
    ScopeUnresolved,

    /// <summary>The caller has no session-bound persona in this exercise to act as (the endpoint returns 403).</summary>
    NoSessionPersona,

    /// <summary>
    /// The named followee does not exist IN THIS EXERCISE — including the always-Critical case of an id that
    /// belongs to another exercise (the endpoint returns 404, a rejection, never a quiet success).
    /// </summary>
    UnknownFollowee,

    /// <summary>The request failed validation (the endpoint returns 400).</summary>
    Invalid,
}

/// <summary>
/// The result of a follow/unfollow attempt. <see cref="Following"/> is the caller-observable state AFTER the
/// call for both <see cref="FollowOutcome.Changed"/> and <see cref="FollowOutcome.Unchanged"/>, which is what
/// makes the endpoint idempotent from a client's point of view: the same request twice yields the same
/// response body.
/// </summary>
public sealed class FollowResult
{
    private FollowResult(FollowOutcome outcome, bool following, bool stateChanged, Guid? edgeId, DateTimeOffset? scenarioTime, string? validationError)
    {
        Outcome = outcome;
        Following = following;
        StateChanged = stateChanged;
        EdgeId = edgeId;
        ScenarioTime = scenarioTime;
        ValidationError = validationError;
    }

    /// <summary>Which outcome occurred.</summary>
    public FollowOutcome Outcome { get; }

    /// <summary>Whether the caller's persona follows the target AFTER this call (meaningful on success only).</summary>
    public bool Following { get; }

    /// <summary>Whether this call actually changed state (and therefore emitted exactly one XC-004 event).</summary>
    public bool StateChanged { get; }

    /// <summary>The affected edge's id when this call changed state; otherwise <c>null</c>.</summary>
    public Guid? EdgeId { get; }

    /// <summary>The server-resolved scenario instant of the change (COR-053); <c>null</c> when nothing changed.</summary>
    public DateTimeOffset? ScenarioTime { get; }

    /// <summary>The validation message — non-null only for <see cref="FollowOutcome.Invalid"/>.</summary>
    public string? ValidationError { get; }

    /// <summary>A state-changing success.</summary>
    /// <param name="following">Whether the edge now exists.</param>
    /// <param name="edgeId">The created/removed edge id.</param>
    /// <param name="scenarioTime">The server-resolved scenario instant of the change.</param>
    /// <returns>A <see cref="FollowOutcome.Changed"/> result.</returns>
    public static FollowResult Changed(bool following, Guid edgeId, DateTimeOffset scenarioTime) =>
        new(FollowOutcome.Changed, following, stateChanged: true, edgeId, scenarioTime, null);

    /// <summary>An idempotent no-op success.</summary>
    /// <param name="following">Whether the edge exists (unchanged by this call).</param>
    /// <returns>An <see cref="FollowOutcome.Unchanged"/> result.</returns>
    public static FollowResult Unchanged(bool following) =>
        new(FollowOutcome.Unchanged, following, stateChanged: false, null, null, null);

    /// <summary>The fail-closed result for an unresolved exercise scope.</summary>
    /// <returns>A <see cref="FollowOutcome.ScopeUnresolved"/> result.</returns>
    public static FollowResult ScopeUnresolved() =>
        new(FollowOutcome.ScopeUnresolved, following: false, stateChanged: false, null, null, null);

    /// <summary>The fail-closed result for a caller with no session-bound persona in this scope.</summary>
    /// <returns>A <see cref="FollowOutcome.NoSessionPersona"/> result.</returns>
    public static FollowResult NoSessionPersona() =>
        new(FollowOutcome.NoSessionPersona, following: false, stateChanged: false, null, null, null);

    /// <summary>The rejection for a followee that does not exist in this exercise (incl. a cross-exercise id).</summary>
    /// <returns>An <see cref="FollowOutcome.UnknownFollowee"/> result.</returns>
    public static FollowResult UnknownFollowee() =>
        new(FollowOutcome.UnknownFollowee, following: false, stateChanged: false, null, null, null);

    /// <summary>A rejected request.</summary>
    /// <param name="validationError">The human-readable reason.</param>
    /// <returns>An <see cref="FollowOutcome.Invalid"/> result.</returns>
    public static FollowResult Invalid(string validationError) =>
        new(FollowOutcome.Invalid, following: false, stateChanged: false, null, null, validationError);
}
