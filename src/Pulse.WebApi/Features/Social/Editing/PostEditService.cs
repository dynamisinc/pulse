namespace Pulse.WebApi.Features.Social.Editing;

using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social.Follows;

/// <summary>
/// Edit own post (demo-feedback story 19, DF-29..DF-33): a participant replaces the text of their own post or reply
/// within 15 minutes of posting, at most 5 times, and anyone in the exercise can read every version. Scoped lifetime,
/// matching the <see cref="PulseDbContext"/> unit of work it writes through.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (COR-001).</b> The exercise comes ONLY from <see cref="IExerciseContext"/>; the post is loaded through
/// the central exercise filter (plus an explicit predicate), so another exercise's post is indistinguishable from one
/// that does not exist (404). The new <see cref="PostEdit"/> row's <see cref="PostEdit.ExerciseId"/> is copied from
/// that loaded, filtered <see cref="Post"/> — never from the request (17 Gate-1 L-1: the database does not tie the two).
/// </para>
/// <para>
/// <b>Who may edit (DF-29, DF-32).</b> Only a live <c>participant</c>-kind session whose bound persona authored the
/// post, and only a <c>participant</c>-origin post. A staff session is refused first (403) even when it carries a
/// persona binding, exactly as <see cref="PostAttributionResolver"/> checks staff before the participant arm.
/// </para>
/// <para>
/// <b>When (DF-30).</b> The window is 15 minutes of SERVER wall clock from <see cref="Post.CreatedWallClock"/>
/// (<see cref="TimeProvider"/>); an edit is also refused while posting is refused — pause tier Freeze, a frozen
/// scenario clock, or a lifecycle that does not accept participant writes (paused or ended). The window keeps running
/// meanwhile.
/// </para>
/// <para>
/// <b>An edit is not a new post (DF-33).</b> One transaction writes the <see cref="PostEdit"/>, the post's new text and
/// edit summary, and ONE XC-004 <c>post.edited</c> event (no text). After commit, ONE <c>PostEdited</c> push goes to
/// the exercise group; there is no <c>PostReceived</c>, no mention notification, no engagement change. An identical
/// sanitized text writes and pushes nothing.
/// </para>
/// </remarks>
public sealed partial class PostEditService
{
    /// <summary>The XC-004 event type of an applied edit.</summary>
    public const string EditedEventType = "post.edited";

    private const string ParticipantSessionKind = "participant";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentSessionPersonaAccessor _sessionPersonaAccessor;
    private readonly ICurrentStaffSessionAccessor _staffSessionAccessor;
    private readonly ExerciseFactsReader _exerciseFacts;
    private readonly IFeedBroadcaster _broadcaster;
    private readonly IParticipantPostProjector _projector;
    private readonly TimeProvider _timeProvider;
    private readonly IExerciseClock? _exerciseClock;
    private readonly PauseTierRegistry? _pauseTiers;
    private readonly ILogger<PostEditService> _logger;
    private readonly IScenarioNow _scenarioNow;

    /// <summary>Creates the service.</summary>
    /// <param name="dbContext">The request's persistence context.</param>
    /// <param name="exerciseContext">The server-resolved exercise scope — the only source of "which exercise".</param>
    /// <param name="sessionPersonaAccessor">The caller's session-bound persona (the participant arm).</param>
    /// <param name="staffSessionAccessor">The caller's live staff session, if any (refused, DF-32).</param>
    /// <param name="exerciseFacts">The exercise's lifecycle status and time zone.</param>
    /// <param name="broadcaster">The exercise-group fan-out (<c>PostEdited</c>).</param>
    /// <param name="projector">The participant projection of the edited post (the 200 body).</param>
    /// <param name="timeProvider">The server wall clock (window, <see cref="PostEdit.EditedAt"/>, telemetry).</param>
    /// <param name="scenarioNow">The exercise's scenario now for telemetry (engine-runtime/08, CLK-2: clock, else latest post, else now).</param>
    /// <param name="exerciseClock">The live scenario clock, when the host runs one.</param>
    /// <param name="pauseTiers">The pause-tier registry, when the host runs one (Freeze refuses an edit).</param>
    /// <param name="logger">Diagnostics (a failed push after commit); optional.</param>
    public PostEditService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ICurrentSessionPersonaAccessor sessionPersonaAccessor,
        ICurrentStaffSessionAccessor staffSessionAccessor,
        ExerciseFactsReader exerciseFacts,
        IFeedBroadcaster broadcaster,
        IParticipantPostProjector projector,
        TimeProvider timeProvider,
        IScenarioNow scenarioNow,
        IExerciseClock? exerciseClock = null,
        PauseTierRegistry? pauseTiers = null,
        ILogger<PostEditService>? logger = null)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(sessionPersonaAccessor);
        ArgumentNullException.ThrowIfNull(staffSessionAccessor);
        ArgumentNullException.ThrowIfNull(exerciseFacts);
        ArgumentNullException.ThrowIfNull(broadcaster);
        ArgumentNullException.ThrowIfNull(projector);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(scenarioNow);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _sessionPersonaAccessor = sessionPersonaAccessor;
        _staffSessionAccessor = staffSessionAccessor;
        _exerciseFacts = exerciseFacts;
        _broadcaster = broadcaster;
        _projector = projector;
        _timeProvider = timeProvider;
        _exerciseClock = exerciseClock;
        _pauseTiers = pauseTiers;
        _logger = logger ?? NullLogger<PostEditService>.Instance;
        _scenarioNow = scenarioNow;
    }

    /// <summary>Applies one edit of the caller's own post, or refuses it.</summary>
    /// <param name="postId">The post to edit (route value).</param>
    /// <param name="request">The new text.</param>
    /// <param name="cancellationToken">The request-aborted token (not used after commit).</param>
    /// <returns>The result the endpoint maps to a status.</returns>
    public async Task<PostEditResult> EditAsync(
        Guid postId, EditPostRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        // 1. Scope (COR-001), fail closed.
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return PostEditResult.ScopeUnresolved();
        }

        var exerciseId = scope.Value;

        // 2. Identity. Staff first (DF-32): a staff session never edits, even one bound to a persona.
        if (await _staffSessionAccessor.GetCurrentStaffSessionAsync(cancellationToken) is not null)
        {
            return PostEditResult.Forbidden();
        }

        var session = await _sessionPersonaAccessor.GetCurrentSessionPersonaAsync(cancellationToken);
        if (session is null
            || !string.Equals(session.Kind, ParticipantSessionKind, StringComparison.Ordinal)
            || session.ExerciseId != exerciseId
            || session.PersonaId == Guid.Empty)
        {
            return PostEditResult.Forbidden();
        }

        // 3. The post, through the central filter AND an explicit predicate. Another exercise's post and a taken-down
        //    post are both 404 (never confirming the id exists elsewhere).
        // Untracked: the write below is a conditional UPDATE, never a tracked save of this snapshot.
        var post = await _dbContext.Posts
            .AsNoTracking()
            .SingleOrDefaultAsync(p => p.Id == postId && p.ExerciseId == exerciseId, cancellationToken);
        if (post is null || post.DeletedAt is not null)
        {
            return PostEditResult.NotFound();
        }

        // 4. Ownership and origin (DF-29): the caller's own participant-origin post only.
        if (!PostEditRules.IsViewersOwnEditablePost(post, session.PersonaId))
        {
            return PostEditResult.Forbidden();
        }

        // 5. The text: the same rules as create (raw cap before sanitizing, sanitize, sanitized cap), plus not empty.
        if (request.Text is null)
        {
            return PostEditResult.Invalid("text is required.");
        }

        if (request.Text.Length > PostIngestService.MaxRawTextLength)
        {
            return PostEditResult.Invalid(PostIngestService.TextTooLongMessage);
        }

        var body = PostSanitizer.Sanitize(request.Text);
        if (body.Length > PostIngestService.TextLengthCeiling)
        {
            return PostEditResult.Invalid(PostIngestService.TextTooLongMessage);
        }

        if (string.IsNullOrWhiteSpace(body)
            && !await _dbContext.PostMediaItems.AnyAsync(item => item.PostId == post.Id, cancellationToken))
        {
            return PostEditResult.Invalid("text must not be empty.");
        }

        // 6. Window, limit, and "posting is refused" (DF-30). One wall-clock read for the whole operation.
        var now = _timeProvider.GetUtcNow();
        if (PostEditRules.IsWindowClosed(post, now))
        {
            return PostEditResult.Refused(PostEditRefusalReasons.WindowClosed);
        }

        if (PostEditRules.IsAtLimit(post))
        {
            return PostEditResult.Refused(PostEditRefusalReasons.EditLimit);
        }

        var facts = await _exerciseFacts.GetAsync(exerciseId, cancellationToken);
        if (IsPostingRefused(exerciseId, facts))
        {
            return PostEditResult.Refused(PostEditRefusalReasons.Frozen);
        }

        // 7. Identical text: nothing written, nothing pushed (DF-33).
        if (string.Equals(body, post.Body, StringComparison.Ordinal))
        {
            return PostEditResult.Unchanged(post, await ProjectAsync(post, session.PersonaId));
        }

        // 8. The edit, in ONE unit of work. EditNumber stays within 1..MaxEdits (L-3; the limit check above already
        //    guarantees it, this is the in-code backstop the database's unique index sits behind).
        var editNumber = post.EditCount + 1;
        if (editNumber is < 1 or > PostEditRules.MaxEdits)
        {
            return PostEditResult.Refused(PostEditRefusalReasons.EditLimit);
        }

        // Scenario time only (COR-053): the exercise's scenario now (engine-runtime/08: the live clock, else its latest
        // post), else the post's own creation scenario time — NEVER the wall clock (Gate-1 L-2).
        var scenarioTime = await _scenarioNow.FindAsync(exerciseId, cancellationToken)
            ?? post.CreatedScenarioTime;

        var edit = new PostEdit
        {
            Id = Guid.NewGuid(),

            // 17 Gate-1 L-1: copied from the loaded, exercise-filtered post — never from the request.
            ExerciseId = post.ExerciseId,
            PostId = post.Id,
            EditNumber = editNumber,
            PreviousBody = post.Body,
            EditedAt = now,
            EditedScenarioTime = scenarioTime,
            ActingHumanId = string.IsNullOrEmpty(session.ActingHumanId) ? null : session.ActingHumanId,
        };

        // One transaction (Gate-1 L-3/L-5). The post row is changed by a CONDITIONAL update that re-checks, inside the
        // transaction, that the post is still live (a takedown since the read is a 404) and still at the edit count
        // this request read (a concurrent edit already took this edit number: a bodiless 409). SQL Server's update
        // lock serializes two racers on the row, so the loser sees zero rows and nothing of it is written; the
        // (PostId, EditNumber) unique index stays the last word behind it.
        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        var expectedCount = post.EditCount;
        var updated = await _dbContext.Posts
            .Where(p => p.Id == post.Id
                && p.ExerciseId == exerciseId
                && p.DeletedAt == null
                && p.EditCount == expectedCount)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(p => p.Body, body)
                    .SetProperty(p => p.EditCount, editNumber)
                    .SetProperty(p => p.LastEditedAt, (DateTimeOffset?)now)
                    .SetProperty(p => p.LastEditedScenarioTime, (DateTimeOffset?)scenarioTime),
                cancellationToken);

        if (updated == 0)
        {
            await transaction.RollbackAsync(cancellationToken);
            var takenDown = await _dbContext.Posts
                .AsNoTracking()
                .Where(p => p.Id == post.Id && p.ExerciseId == exerciseId)
                .Select(p => p.DeletedAt != null)
                .FirstOrDefaultAsync(cancellationToken);
            if (takenDown)
            {
                return PostEditResult.NotFound();
            }

            LogConcurrentEdit(post.Id, editNumber);
            return PostEditResult.Conflict();
        }

        post.Body = body;
        post.EditCount = editNumber;
        post.LastEditedAt = now;
        post.LastEditedScenarioTime = scenarioTime;

        _dbContext.PostEdits.Add(edit);
        _dbContext.TelemetryEvents.Add(BuildEditedEvent(post, edit, session, facts));

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // Backstop: the unique index refused a duplicate edit number. The transaction rolls back on dispose, so
            // the post row's update above is undone too and nothing of this attempt is written.
            LogConcurrentEdit(post.Id, editNumber);
            return PostEditResult.Conflict();
        }

        // 9. After commit: ONE exercise-group push. A failure is logged and swallowed — the edit has committed, and
        //    connected clients pick the new text up on their next read. The request token is not passed from here on.
        var summary = PostEditRules.SummaryOf(post)!;
        try
        {
            await _broadcaster.BroadcastPostEditedAsync(
                exerciseId,
                new PostEditedDto { PostId = post.Id.ToString(), Text = post.Body, Edited = summary, Version = summary.Count },
                CancellationToken.None);
        }
#pragma warning disable CA1031 // A push fault must never turn a committed edit into a failed request.
        catch (Exception ex)
        {
            LogBroadcastFailed(ex, exerciseId, post.Id);
        }
#pragma warning restore CA1031

        return PostEditResult.Edited(post, await ProjectAsync(post, session.PersonaId));
    }

    /// <summary>
    /// Reads every version of a post, newest first (DF-31): the current text as <c>editNumber = EditCount</c>, then each
    /// earlier version down to the original (<c>editNumber 0</c>). Any session in the exercise; scenario times only.
    /// </summary>
    /// <param name="postId">The post (route value).</param>
    /// <param name="cancellationToken">The request-aborted token.</param>
    /// <returns>The history, or a fail-closed / not-found result.</returns>
    public async Task<PostEditHistoryResult> GetHistoryAsync(Guid postId, CancellationToken cancellationToken = default)
    {
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return PostEditHistoryResult.ScopeUnresolved();
        }

        var exerciseId = scope.Value;

        var post = await _dbContext.Posts
            .AsNoTracking()
            .Where(p => p.Id == postId && p.ExerciseId == exerciseId)
            .Select(p => new { p.Id, p.Body, p.EditCount, p.CreatedScenarioTime, p.LastEditedScenarioTime, p.DeletedAt })
            .SingleOrDefaultAsync(cancellationToken);
        if (post is null || post.DeletedAt is not null)
        {
            return PostEditHistoryResult.NotFound();
        }

        var edits = post.EditCount == 0
            ? []
            : await _dbContext.PostEdits
                .AsNoTracking()
                .Where(edit => edit.PostId == post.Id && edit.ExerciseId == exerciseId)
                .Select(edit => new { edit.EditNumber, edit.PreviousBody, edit.EditedScenarioTime })
                .ToListAsync(cancellationToken);

        var byNumber = edits.ToDictionary(edit => edit.EditNumber);
        var versions = new List<PostEditVersionDto>(post.EditCount + 1);

        for (var number = post.EditCount; number >= 0; number--)
        {
            // Version n's text is edit n+1's PreviousBody (the text that edit replaced), or the current body for the
            // last version. Its time is edit n's scenario time, or the post's creation time for the original.
            var text = number == post.EditCount
                ? post.Body
                : byNumber.TryGetValue(number + 1, out var next) ? next.PreviousBody : string.Empty;

            DateTimeOffset time;
            if (number == 0)
            {
                time = post.CreatedScenarioTime;
            }
            else if (byNumber.TryGetValue(number, out var edit))
            {
                time = edit.EditedScenarioTime;
            }
            else
            {
                time = post.LastEditedScenarioTime ?? post.CreatedScenarioTime;
            }

            versions.Add(new PostEditVersionDto { EditNumber = number, Text = text, ScenarioTime = time.ToString("O") });
        }

        return PostEditHistoryResult.Ok(new PostEditHistoryDto { PostId = post.Id.ToString(), Versions = versions });
    }

    /// <summary>
    /// Whether posting is refused in the exercise right now (DF-30, amended 10/15): pause tier Freeze, a frozen
    /// scenario clock, or a lifecycle state that does not accept participant writes
    /// (<see cref="ExerciseLifecycleBehaviour.ParticipantWritesAccepted"/>: paused, completed, archived, build). An
    /// unreadable exercise row is refused too (fail closed).
    /// </summary>
    private bool IsPostingRefused(Guid exerciseId, ExerciseFacts? facts)
    {
        if (_pauseTiers?.GetTier(exerciseId) == PauseTier.Freeze)
        {
            return true;
        }

        if (_exerciseClock?.IsFrozen(exerciseId) == true)
        {
            return true;
        }

        return !ExerciseLifecycleStates.BehaviourOf(facts?.Status).ParticipantWritesAccepted;
    }

    /// <summary>
    /// The participant view of the post for the 200 body, with the caller's viewer state (so
    /// <c>viewer.editableForSeconds</c> is present on their own post). A projection fault falls back to
    /// <see cref="ParticipantPostDto.FromPost"/> — never a failed request after a committed edit.
    /// </summary>
    private async Task<ParticipantPostDto> ProjectAsync(Post post, Guid viewerPersonaId)
    {
        try
        {
            var projected = await _projector.ProjectAsync(
                [post], new PostProjectionOptions(viewerPersonaId, IncludeViewerState: true), CancellationToken.None);
            return projected[0];
        }
#pragma warning disable CA1031 // A projection fault must never fail an edit that has already committed.
        catch (Exception ex)
        {
            LogProjectionFailed(ex, post.Id);
            return ParticipantPostDto.FromPost(post);
        }
#pragma warning restore CA1031
    }

    /// <summary>
    /// The ONE XC-004 <c>post.edited</c> event: post id, edit number, wall + scenario time and the actor's session kind.
    /// Never the text (old or new).
    /// </summary>
    private static TelemetryEvent BuildEditedEvent(Post post, PostEdit edit, CurrentSessionPersona session, ExerciseFacts? facts) =>
        new()
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = "v0",
            ExerciseId = post.ExerciseId,
            EventType = EditedEventType,
            Channel = "social",
            Actor = new TelemetryActor
            {
                Kind = "persona",
                PersonaId = post.AuthorPersonaId.ToString(),

                // Off-envelope empty strings are null-omitted (v0 types these as optional non-empty strings).
                ActingHumanId = edit.ActingHumanId,
                SessionId = session.SessionId == Guid.Empty ? null : session.SessionId.ToString(),
            },
            Origin = post.Origin,
            WallClockTime = edit.EditedAt,
            ScenarioTime = edit.EditedScenarioTime,
            TimeZone = string.IsNullOrWhiteSpace(facts?.TimeZone) ? ExerciseDay.UtcZoneId : facts.TimeZone,
            Target = new TelemetryTarget { EntityType = "post", EntityId = post.Id.ToString() },
            Payload = JsonSerializer.Serialize(new EditedPayload
            {
                PostId = post.Id.ToString(),
                EditNumber = edit.EditNumber,
                SessionKind = session.Kind,
            }),
            EmittedAt = edit.EditedAt,
        };

    private static bool IsUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is SqlException { Number: 2601 or 2627 };

    [LoggerMessage(EventId = 1, Level = LogLevel.Warning, Message = "The PostEdited push in exercise {ExerciseId} for post {PostId} failed after the edit committed; clients pick it up on their next read.")]
    private partial void LogBroadcastFailed(Exception exception, Guid exerciseId, Guid postId);

    [LoggerMessage(EventId = 2, Level = LogLevel.Warning, Message = "Projecting edited post {PostId} failed; answering with the narrow participant view.")]
    private partial void LogProjectionFailed(Exception exception, Guid postId);

    [LoggerMessage(EventId = 3, Level = LogLevel.Information, Message = "A concurrent edit of post {PostId} already wrote edit {EditNumber}; this attempt wrote nothing.")]
    private partial void LogConcurrentEdit(Guid postId, int editNumber);

    /// <summary>The opaque <c>post.edited</c> payload: ids, the edit number and the session kind — never text.</summary>
    private sealed class EditedPayload
    {
        [JsonPropertyName("postId")]
        public required string PostId { get; init; }

        [JsonPropertyName("editNumber")]
        public required int EditNumber { get; init; }

        [JsonPropertyName("sessionKind")]
        public required string SessionKind { get; init; }
    }
}

/// <summary>The <c>reason</c> values of a 409 edit refusal (WAVE-4 "Routes").</summary>
public static class PostEditRefusalReasons
{
    /// <summary>More than 15 minutes of wall clock since the post was created.</summary>
    public const string WindowClosed = "window-closed";

    /// <summary>The post already has the maximum number of edits.</summary>
    public const string EditLimit = "edit-limit";

    /// <summary>Posting is refused right now (Freeze, a frozen clock, or a paused/ended lifecycle).</summary>
    public const string Frozen = "frozen";
}

/// <summary>The outcome kind of <see cref="PostEditService.EditAsync"/>.</summary>
public enum PostEditOutcome
{
    /// <summary>The edit was applied; 200 with the post.</summary>
    Edited,

    /// <summary>The sanitized text was identical; 200 with the post, nothing written or pushed.</summary>
    Unchanged,

    /// <summary>No exercise scope; 401.</summary>
    ScopeUnresolved,

    /// <summary>Not the caller's own participant-origin post, or not a participant session; 403.</summary>
    Forbidden,

    /// <summary>No such post in the exercise, or taken down; 404.</summary>
    NotFound,

    /// <summary>The text failed validation; 400.</summary>
    Invalid,

    /// <summary>Window closed, edit limit, or posting refused; 409 with a reason.</summary>
    Refused,

    /// <summary>A concurrent edit of the same post won the race; 409 without a reason, nothing written.</summary>
    Conflict,
}

/// <summary>The result of <see cref="PostEditService.EditAsync"/>.</summary>
public sealed class PostEditResult
{
    private PostEditResult(PostEditOutcome outcome, ParticipantPostDto? view = null, Post? post = null, string? error = null, string? reason = null)
    {
        Outcome = outcome;
        View = view;
        Post = post;
        ValidationError = error;
        RefusalReason = reason;
    }

    /// <summary>Which outcome occurred.</summary>
    public PostEditOutcome Outcome { get; }

    /// <summary>The participant view of the post (edited or unchanged).</summary>
    public ParticipantPostDto? View { get; }

    /// <summary>The post entity after the operation (edited or unchanged).</summary>
    public Post? Post { get; }

    /// <summary>The 400 message for <see cref="PostEditOutcome.Invalid"/>.</summary>
    public string? ValidationError { get; }

    /// <summary>The 409 reason for <see cref="PostEditOutcome.Refused"/> (<see cref="PostEditRefusalReasons"/>).</summary>
    public string? RefusalReason { get; }

    /// <summary>An applied edit.</summary>
    /// <param name="post">The edited post.</param>
    /// <param name="view">Its participant view.</param>
    /// <returns>The result.</returns>
    public static PostEditResult Edited(Post post, ParticipantPostDto view) => new(PostEditOutcome.Edited, view, post);

    /// <summary>An identical-text no-op.</summary>
    /// <param name="post">The unchanged post.</param>
    /// <param name="view">Its participant view.</param>
    /// <returns>The result.</returns>
    public static PostEditResult Unchanged(Post post, ParticipantPostDto view) => new(PostEditOutcome.Unchanged, view, post);

    /// <summary>The fail-closed result for an unresolved scope.</summary>
    /// <returns>The result.</returns>
    public static PostEditResult ScopeUnresolved() => new(PostEditOutcome.ScopeUnresolved);

    /// <summary>The caller may not edit this post.</summary>
    /// <returns>The result.</returns>
    public static PostEditResult Forbidden() => new(PostEditOutcome.Forbidden);

    /// <summary>No such live post in the exercise.</summary>
    /// <returns>The result.</returns>
    public static PostEditResult NotFound() => new(PostEditOutcome.NotFound);

    /// <summary>A validation failure.</summary>
    /// <param name="error">The message.</param>
    /// <returns>The result.</returns>
    public static PostEditResult Invalid(string error) => new(PostEditOutcome.Invalid, error: error);

    /// <summary>A refused edit.</summary>
    /// <param name="reason">One of <see cref="PostEditRefusalReasons"/>.</param>
    /// <returns>The result.</returns>
    public static PostEditResult Refused(string reason) => new(PostEditOutcome.Refused, reason: reason);

    /// <summary>A concurrent edit won the race.</summary>
    /// <returns>The result.</returns>
    public static PostEditResult Conflict() => new(PostEditOutcome.Conflict);
}

/// <summary>The outcome kind of <see cref="PostEditService.GetHistoryAsync"/>.</summary>
public enum PostEditHistoryOutcome
{
    /// <summary>200 with the history.</summary>
    Ok,

    /// <summary>No exercise scope; 401.</summary>
    ScopeUnresolved,

    /// <summary>No such live post in the exercise; 404.</summary>
    NotFound,
}

/// <summary>The result of <see cref="PostEditService.GetHistoryAsync"/>.</summary>
public sealed class PostEditHistoryResult
{
    private PostEditHistoryResult(PostEditHistoryOutcome outcome, PostEditHistoryDto? history)
    {
        Outcome = outcome;
        History = history;
    }

    /// <summary>Which outcome occurred.</summary>
    public PostEditHistoryOutcome Outcome { get; }

    /// <summary>The history for <see cref="PostEditHistoryOutcome.Ok"/>.</summary>
    public PostEditHistoryDto? History { get; }

    /// <summary>A history read.</summary>
    /// <param name="history">The versions.</param>
    /// <returns>The result.</returns>
    public static PostEditHistoryResult Ok(PostEditHistoryDto history) => new(PostEditHistoryOutcome.Ok, history);

    /// <summary>The fail-closed result for an unresolved scope.</summary>
    /// <returns>The result.</returns>
    public static PostEditHistoryResult ScopeUnresolved() => new(PostEditHistoryOutcome.ScopeUnresolved, null);

    /// <summary>No such live post in the exercise.</summary>
    /// <returns>The result.</returns>
    public static PostEditHistoryResult NotFound() => new(PostEditHistoryOutcome.NotFound, null);
}
