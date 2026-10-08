namespace Pulse.WebApi.Features.Social.Moderation;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Realtime;

/// <summary>
/// Controller takedown (demo-polish B6; CTL-025, XC-010, COR-001, XC-002). Soft-deletes one post in the
/// caller's exercise by stamping <c>Post.DeletedAt</c> in scenario time, then tells the exercise's subscribers
/// to drop it (<c>PostRemoved</c>). Scoped lifetime, matching the <see cref="PulseDbContext"/> unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>Soft delete only (XC-010).</b> The only write is <c>UPDATE Posts SET DeletedAt = …</c>. The post row,
/// its <c>PostMediaItem</c> rows and their blobs all stay, for the staff record. The participant read paths key
/// off <c>DeletedAt</c>: they omit the post (a taken-down reply shows as a tombstone in its parent thread).
/// </para>
/// <para>
/// <b>Isolation (COR-001, DP-16).</b> The exercise comes only from <see cref="IExerciseContext"/>. The post is
/// looked up and updated through the scoped <see cref="PulseDbContext.Posts"/> set, so the central query filter
/// applies to both the read and the <c>ExecuteUpdate</c>. Another exercise's post id therefore does not
/// resolve: the caller gets <see cref="PostTakedownOutcome.NotFound"/>, the same as for an unknown id, and that
/// post is never touched.
/// </para>
/// <para>
/// <b>Idempotent, including under a race.</b> The update is conditional (<c>WHERE DeletedAt IS NULL</c>) and
/// atomic, so only the first takedown stamps the row and broadcasts. A repeat, or a concurrent duplicate that
/// lost the race, changes nothing, does not move <c>DeletedAt</c>, and does not broadcast again. The update
/// writes only <c>DeletedAt</c>, never <c>ExerciseId</c>, so the <c>SaveChanges</c> scope guard has nothing to
/// check here.
/// </para>
/// <para>
/// <b>Scenario time (COR-053), never the wall clock.</b> <c>DeletedAt</c> follows the <c>FollowService</c>
/// pattern: the running exercise clock (<see cref="IExerciseClock"/>, COR-050), then the exercise's stored
/// <c>CurrentScenarioTime</c>. Where <c>FollowService</c> would fall back to the server clock, this falls back to
/// the post's own <c>CreatedScenarioTime</c> (a takedown cannot precede its post). So the value is always a
/// scenario instant, never <c>DateTimeOffset.UtcNow</c>.
/// </para>
/// <para>
/// <b>No telemetry (DP-9).</b> The console emits the one <c>steering_action</c> event, carrying the takedown
/// category. A server event here would double-count the action.
/// </para>
/// </remarks>
public sealed class PostTakedownService
{
    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly IOrganizationContext _organizationContext;
    private readonly IExerciseClock _exerciseClock;
    private readonly IFeedBroadcaster _feedBroadcaster;

    /// <summary>Creates the service over its persistence, scope, clock and fan-out collaborators.</summary>
    /// <param name="dbContext">The persistence context. Its central exercise filter scopes every post read and update.</param>
    /// <param name="exerciseContext">The server-resolved exercise scope (COR-001), the only scope source.</param>
    /// <param name="organizationContext">The server-resolved customer tenant, which bounds the one <c>Exercises</c> read.</param>
    /// <param name="exerciseClock">The native per-exercise scenario clock (COR-050).</param>
    /// <param name="feedBroadcaster">The real-time fan-out that carries <c>PostRemoved</c>.</param>
    public PostTakedownService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        IOrganizationContext organizationContext,
        IExerciseClock exerciseClock,
        IFeedBroadcaster feedBroadcaster)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(organizationContext);
        ArgumentNullException.ThrowIfNull(exerciseClock);
        ArgumentNullException.ThrowIfNull(feedBroadcaster);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _organizationContext = organizationContext;
        _exerciseClock = exerciseClock;
        _feedBroadcaster = feedBroadcaster;
    }

    /// <summary>
    /// Takes down <paramref name="postId"/> in the caller's exercise. Live: stamp <c>DeletedAt</c> (scenario
    /// time) and broadcast <c>PostRemoved</c>. Already down: no-op. Unknown or another exercise's: not found.
    /// </summary>
    /// <param name="postId">The post to take down. Resolved only through the exercise-scoped post set.</param>
    /// <param name="cancellationToken">Cancellation token for the lookup and the update.</param>
    /// <returns>The outcome the endpoint maps to an HTTP status.</returns>
    public async Task<PostTakedownResult> TakeDownAsync(Guid postId, CancellationToken cancellationToken = default)
    {
        // 1. Scope comes only from IExerciseContext (COR-001). Fail closed when it is unresolved.
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return PostTakedownResult.ScopeUnresolved();
        }

        var exerciseId = scope.Value;

        // 2. Resolve through the scoped set with a LINQ predicate. Another exercise's id does not match under the
        //    central filter, so it is indistinguishable from an unknown id (DP-16).
        var post = await _dbContext.Posts
            .AsNoTracking()
            .Where(candidate => candidate.Id == postId)
            .Select(candidate => new { candidate.DeletedAt, candidate.CreatedScenarioTime })
            .FirstOrDefaultAsync(cancellationToken);
        if (post is null)
        {
            return PostTakedownResult.NotFound();
        }

        if (post.DeletedAt is not null)
        {
            // Idempotent repeat: already down. Leave DeletedAt where it is and do not broadcast again.
            return PostTakedownResult.AlreadyRemoved();
        }

        // 3. Scenario time (COR-053), resolved server-side, never from the request and never the wall clock.
        var deletedAt = await ResolveScenarioTimeAsync(exerciseId, post.CreatedScenarioTime, cancellationToken);

        // 4. Soft delete (XC-010): an atomic, conditional UPDATE through the scoped set, never a DELETE. If a
        //    concurrent takedown stamped the row after step 2, this matches zero rows and the call becomes the
        //    same idempotent no-op as a repeat, so DeletedAt never moves and only one PostRemoved goes out.
        var stamped = await _dbContext.Posts
            .Where(candidate => candidate.Id == postId && candidate.DeletedAt == null)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(candidate => candidate.DeletedAt, (DateTimeOffset?)deletedAt),
                cancellationToken);
        if (stamped == 0)
        {
            return PostTakedownResult.AlreadyRemoved();
        }

        // 5. Tell participants to drop it live: the post id only (XC-002), to this exercise's group only. The
        //    takedown has committed by now, so the request's token is NOT passed. A client that disconnects here
        //    must not cancel the broadcast, because its retry is an idempotent no-op that would never re-send it.
        await _feedBroadcaster.BroadcastPostRemovedAsync(exerciseId, postId, CancellationToken.None);

        return PostTakedownResult.Removed(deletedAt);
    }

    /// <summary>
    /// The current scenario instant for <paramref name="exerciseId"/>, from the first available of: the running
    /// exercise clock, the exercise's stored <c>CurrentScenarioTime</c>, or <paramref name="postScenarioTime"/>.
    /// Never the wall clock (COR-053).
    /// </summary>
    /// <param name="exerciseId">The resolved exercise scope.</param>
    /// <param name="postScenarioTime">The post's own creation instant (scenario time), the final fallback.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The scenario instant to stamp on <c>Post.DeletedAt</c>.</returns>
    private async Task<DateTimeOffset> ResolveScenarioTimeAsync(
        Guid exerciseId,
        DateTimeOffset postScenarioTime,
        CancellationToken cancellationToken)
    {
        var clockTime = _exerciseClock.CurrentScenarioTime(exerciseId);
        if (clockTime is not null)
        {
            return clockTime.Value;
        }

        // Exercise is not IExerciseScoped (it IS the scope), so the central filter does not cover it. The id
        // comes from IExerciseContext, and the read is also bounded to the caller's resolved tenant. An
        // unresolved tenant matches nothing, which falls through to the post's own scenario time.
        var storedScenarioTime = await _dbContext.Exercises
            .AsNoTracking()
            .InOrganization(_organizationContext.CurrentOrganizationId)
            .Where(exercise => exercise.Id == exerciseId)
            .Select(exercise => exercise.CurrentScenarioTime)
            .FirstOrDefaultAsync(cancellationToken);

        return storedScenarioTime ?? postScenarioTime;
    }
}
