namespace Pulse.WebApi.Features.Exports;

using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Social.Engagement;

/// <summary>The outcome kind of a <see cref="PostExportService"/> call.</summary>
public enum PostExportOutcome
{
    /// <summary>The workbook was built; the endpoint returns 200 with it.</summary>
    Ok,

    /// <summary>No exercise scope was resolved; the endpoint returns 401 (fail closed).</summary>
    ScopeUnresolved,

    /// <summary>The resolved scope has no exercise row; the endpoint returns 404.</summary>
    NotFound,

    /// <summary>The exercise has more posts than <see cref="PostExportService.MaxRows"/>; the endpoint returns 413.</summary>
    TooManyRows,
}

/// <summary>The result of <see cref="PostExportService.ExportAsync"/>.</summary>
public sealed class PostExportResult
{
    private PostExportResult(PostExportOutcome outcome, MemoryStream? content, string? fileName, int rowCount, string? reason)
    {
        Outcome = outcome;
        Content = content;
        FileName = fileName;
        RowCount = rowCount;
        Reason = reason;
    }

    /// <summary>Which outcome occurred.</summary>
    public PostExportOutcome Outcome { get; }

    /// <summary>
    /// The <c>.xlsx</c>, positioned at 0; non-null only for <see cref="PostExportOutcome.Ok"/>. The caller owns it and
    /// disposes it (the endpoint hands it to <c>Results.File</c>, which disposes it after writing the response).
    /// </summary>
    public MemoryStream? Content { get; }

    /// <summary>The download file name; non-null only for <see cref="PostExportOutcome.Ok"/>.</summary>
    public string? FileName { get; }

    /// <summary>The data rows written (0 unless <see cref="PostExportOutcome.Ok"/>).</summary>
    public int RowCount { get; }

    /// <summary>The readable reason for <see cref="PostExportOutcome.TooManyRows"/>.</summary>
    public string? Reason { get; }

    /// <summary>A built workbook.</summary>
    /// <param name="content">The file, positioned at 0.</param>
    /// <param name="fileName">The download file name.</param>
    /// <param name="rowCount">The data rows written.</param>
    /// <returns>An OK result.</returns>
    public static PostExportResult Ok(MemoryStream content, string fileName, int rowCount) =>
        new(PostExportOutcome.Ok, content, fileName, rowCount, null);

    /// <summary>The fail-closed result for an unresolved scope.</summary>
    /// <returns>A scope-unresolved result.</returns>
    public static PostExportResult ScopeUnresolved() => new(PostExportOutcome.ScopeUnresolved, null, null, 0, null);

    /// <summary>A resolved scope with no exercise row.</summary>
    /// <returns>A not-found result.</returns>
    public static PostExportResult NotFound() => new(PostExportOutcome.NotFound, null, null, 0, null);

    /// <summary>The exercise is over the row limit; nothing was built.</summary>
    /// <param name="reason">The readable reason.</param>
    /// <returns>A too-many-rows result.</returns>
    public static PostExportResult TooManyRows(string reason) => new(PostExportOutcome.TooManyRows, null, null, 0, reason);
}

/// <summary>
/// Builds the post activity export (demo-feedback story 02, DF-8): every post and reply in the resolved exercise,
/// taken-down ones included, one row each, oldest first by scenario time (ties by wall clock, then id). Staff world
/// only; the endpoint's staff gate admits any role assigned to the exercise. Scoped lifetime, matching the request's
/// <see cref="PulseDbContext"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (COR-001, XC-001).</b> The exercise comes only from <see cref="IExerciseContext"/>; an unresolved
/// scope fails closed before any read. Posts, personas, accounts, media, reactions and inject items are all
/// <see cref="IExerciseScoped"/>, so the central query filter confines every read to the exercise. The two unscoped
/// tables are bounded explicitly: <see cref="Enrollment"/> by the exercise id, and <see cref="StaffUser"/> by the
/// exercise's own tenant (<c>InOrganization</c>), the same join <c>InjectQueueService</c> uses. A <c>Posted by</c> or
/// <c>Inject #</c> that does not resolve inside the exercise stays blank, so no name or id from another exercise can
/// appear.
/// </para>
/// <para>
/// <b>Paged reads.</b> The ordered post ids are read first (at most <see cref="MaxRows"/> + 1, so an oversize
/// exercise is refused without reading further); the rows are then read and written <see cref="PageSize"/> at a time,
/// each page with batched engagement, media and parent reads, so the post table is never held in memory at once.
/// Reading the id list up front also pins the export to one consistent set of posts while new ones keep arriving.
/// </para>
/// <para>
/// <b>Counts.</b> Real counts come from <see cref="PostEngagementReader"/>, which counts <c>like</c> and <c>repost</c>
/// explicitly, so a <c>pin</c> reaction is never counted. The concrete reader is used rather than
/// <see cref="IPostEngagementReader"/> because that interface has a zero-count fallback registration
/// (<c>PostSeamFallbacks</c>) that would silently export zeros in a host where the reaction slice is not wired.
/// The <c>Shown</c> columns add the seeded baseline exactly as <c>ParticipantPostProjector</c> does.
/// </para>
/// <para>
/// <b>Edits (demo-feedback story 19, DF-31/DF-39).</b> Each page also reads its edited posts' <see cref="PostEdit"/> rows
/// (one batched read through the scoped set) for the three <c>Posts</c> edit columns and the <c>Edit history</c> sheet:
/// one row per version of every edited post, in export order then edit number. Never-edited posts add no history rows.
/// </para>
/// <para>
/// <b>Telemetry (XC-004).</b> One <c>export.posts.downloaded</c> event per built workbook, actor the staff human, and
/// a payload of <c>{ rows }</c> only: no text, no names.
/// </para>
/// </remarks>
public sealed class PostExportService
{
    /// <summary>The most rows one export writes; above it the request is refused with 413.</summary>
    public const int MaxRows = 50_000;

    /// <summary>Posts read and written per page.</summary>
    public const int PageSize = 500;

    /// <summary>The XC-004 event type.</summary>
    public const string DownloadedEventType = "export.posts.downloaded";

    private const string SystemActorKind = "system";
    private const string SystemChannel = "system";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly PostEngagementReader _engagementReader;
    private readonly ExerciseFactsReader _exerciseFacts;
    private readonly ICurrentStaffSessionAccessor _currentStaffSession;
    private readonly TimeProvider _timeProvider;
    private readonly IScenarioNow _scenarioNow;

    /// <summary>Creates the service.</summary>
    /// <param name="dbContext">The request's persistence context.</param>
    /// <param name="exerciseContext">The server-resolved exercise scope, the only source of "which exercise".</param>
    /// <param name="engagementReader">The real like/repost/reply counts.</param>
    /// <param name="exerciseFacts">The exercise's name, time zone and tenant.</param>
    /// <param name="currentStaffSession">The acting staff human, for the telemetry actor.</param>
    /// <param name="timeProvider">The server clock (file name and telemetry wall clock).</param>
    /// <param name="scenarioNow">The telemetry scenario time (engine-runtime/08, CLK-2: clock, else latest post, else now).</param>
    public PostExportService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        PostEngagementReader engagementReader,
        ExerciseFactsReader exerciseFacts,
        ICurrentStaffSessionAccessor currentStaffSession,
        TimeProvider timeProvider,
        IScenarioNow scenarioNow)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(engagementReader);
        ArgumentNullException.ThrowIfNull(exerciseFacts);
        ArgumentNullException.ThrowIfNull(currentStaffSession);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(scenarioNow);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _engagementReader = engagementReader;
        _exerciseFacts = exerciseFacts;
        _currentStaffSession = currentStaffSession;
        _timeProvider = timeProvider;
        _scenarioNow = scenarioNow;
    }

    /// <summary>Builds the workbook for the resolved exercise and records one download event.</summary>
    /// <param name="cancellationToken">The request-aborted token.</param>
    /// <returns>The result the endpoint maps to a status.</returns>
    public async Task<PostExportResult> ExportAsync(CancellationToken cancellationToken = default)
    {
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return PostExportResult.ScopeUnresolved();
        }

        var exerciseId = scope.Value;
        var facts = await _exerciseFacts.GetAsync(exerciseId, cancellationToken);
        if (facts is null)
        {
            return PostExportResult.NotFound();
        }

        // 1. The ordered id list, capped one past the limit so an oversize exercise is refused without reading on.
        var orderedIds = await _dbContext.Posts
            .AsNoTracking()
            .OrderBy(post => post.CreatedScenarioTime)
            .ThenBy(post => post.CreatedWallClock)
            .ThenBy(post => post.Id)
            .Select(post => post.Id)
            .Take(MaxRows + 1)
            .ToListAsync(cancellationToken);

        if (orderedIds.Count > MaxRows)
        {
            return PostExportResult.TooManyRows(
                "This exercise has more than 50,000 posts, which is more than one export can hold. "
                + "Nothing was exported.");
        }

        // 2. The small per-exercise lookups, read once.
        var lookups = await ReadLookupsAsync(exerciseId, facts.OrganizationId, cancellationToken);
        var zone = ExerciseDay.ResolveTimeZone(facts.TimeZone);

        // 3. The rows, a page at a time.
        using var workbook = new PostExportWorkbook();
        foreach (var page in orderedIds.Chunk(PageSize))
        {
            var (rows, historyRows) = await ReadPageAsync(page, lookups, zone, cancellationToken);
            workbook.AddRows(rows);
            workbook.AddEditHistoryRows(historyRows);
        }

        // One buffer, handed to the response as-is: no second full copy of the file (Gate-1 M1).
        var content = new MemoryStream();
        try
        {
            workbook.SaveTo(content);
            content.Position = 0;

            // 4. One XC-004 event, stamped from one clock read.
            var now = _timeProvider.GetUtcNow();
            var staff = await _currentStaffSession.GetCurrentStaffSessionAsync(cancellationToken);
            var scenarioTime = await _scenarioNow.GetAsync(exerciseId, now, cancellationToken);
            _dbContext.TelemetryEvents.Add(
                BuildDownloadedEvent(exerciseId, facts, staff, lookups, workbook.RowCount, now, scenarioTime));
            await _dbContext.SaveChangesAsync(cancellationToken);

            return PostExportResult.Ok(content, PostExportLabels.FileName(facts.Name, now), workbook.RowCount);
        }
        catch
        {
            await content.DisposeAsync();
            throw;
        }
    }

    private async Task<ExportLookups> ReadLookupsAsync(Guid exerciseId, Guid organizationId, CancellationToken cancellationToken)
    {
        var personas = await _dbContext.Personas
            .AsNoTracking()
            .Select(persona => new { persona.Id, persona.Handle, persona.DisplayName })
            .ToDictionaryAsync(persona => persona.Id, persona => new PersonaLabel(persona.Handle, persona.DisplayName), cancellationToken);

        // identity-auth-roles/16: the exercise's STAFF enrollments (Enrollment is IExerciseScoped, so the central filter
        // confines it to the resolved exercise; the predicate is explicit too); StaffUser is bounded by the exercise's
        // own tenant. Same join as InjectQueueService.ReadRosterAsync.
        var staff = await (
            from assignment in _dbContext.Enrollments.AsNoTracking().Where(EnrollmentRoles.IsStaffEnrollment)
            where assignment.ExerciseId == exerciseId
            join staffUser in _dbContext.StaffUsers.AsNoTracking().InOrganization(organizationId)
                on assignment.PersonId equals (Guid?)staffUser.Id
            select new { staffUser.Id, staffUser.DisplayName, assignment.Role }).ToListAsync(cancellationToken);

        var accounts = await _dbContext.Accounts
            .AsNoTracking()
            .Select(account => new { account.Id, account.ActingHumanId, account.DisplayName })
            .ToListAsync(cancellationToken);

        // Acting-human ids are strings: a staff user's id, or a participant account's ActingHumanId (falling back to
        // its id). Only humans inside this exercise are keyed, so an id from anywhere else resolves to blank.
        var humans = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var account in accounts)
        {
            humans.TryAdd(account.Id.ToString(), account.DisplayName);
            if (!string.IsNullOrWhiteSpace(account.ActingHumanId))
            {
                humans.TryAdd(account.ActingHumanId, account.DisplayName);
            }
        }

        var staffRoles = new Dictionary<Guid, string>();
        foreach (var member in staff)
        {
            // A staff id wins over an account keyed by the same string (they are distinct GUIDs in practice).
            humans[member.Id.ToString()] = member.DisplayName;
            staffRoles.TryAdd(member.Id, member.Role);
        }

        // Deleted inject items are included: a post an item published outlives the item. The MSEL Inject # (DF-10)
        // wins over the title when the item has one.
        var injects = await _dbContext.InjectItems
            .AsNoTracking()
            .Select(item => new { item.Id, item.Title, item.ExternalRef })
            .ToDictionaryAsync(
                item => item.Id,
                item => string.IsNullOrWhiteSpace(item.ExternalRef) ? item.Title : item.ExternalRef,
                cancellationToken);

        return new ExportLookups(personas, humans, staffRoles, injects);
    }

    private async Task<(List<PostExportRow> Rows, List<PostEditHistoryExportRow> HistoryRows)> ReadPageAsync(
        Guid[] page,
        ExportLookups lookups,
        TimeZoneInfo zone,
        CancellationToken cancellationToken)
    {
        var posts = await _dbContext.Posts
            .AsNoTracking()
            .Where(post => page.Contains(post.Id))
            .Select(post => new PageRow(
                post.Id,
                post.AuthorPersonaId,
                post.Body,
                post.CreatedScenarioTime,
                post.CreatedWallClock,
                post.Origin,
                post.ActingHumanId,
                post.InjectId,
                post.ParentPostId,
                post.DeletedAt,
                post.BaselineLikeCount,
                post.BaselineRepostCount,
                post.BaselineReplyCount,
                post.PinnedForAllAt,
                post.EditCount,
                post.LastEditedScenarioTime))
            .ToDictionaryAsync(post => post.Id, cancellationToken);

        // demo-feedback story 19: every PostEdit of this page's edited posts, in one read through the scoped set.
        var editedIds = posts.Values.Where(post => post.EditCount > 0).Select(post => post.Id).ToArray();
        var editRows = editedIds.Length == 0
            ? []
            : await _dbContext.PostEdits
                .AsNoTracking()
                .Where(edit => editedIds.Contains(edit.PostId))
                .Select(edit => new EditRow(edit.PostId, edit.EditNumber, edit.PreviousBody, edit.EditedAt, edit.EditedScenarioTime))
                .ToListAsync(cancellationToken);
        var editsByPost = editRows.ToLookup(edit => edit.PostId);

        var engagement = await _engagementReader.GetAsync(page, viewerPersonaId: null, cancellationToken);

        var mediaRows = await (
            from item in _dbContext.PostMediaItems.AsNoTracking()
            where page.Contains(item.PostId)
            join asset in _dbContext.MediaAssets.AsNoTracking() on item.MediaAssetId equals asset.Id
            select new { item.PostId, asset.Kind }).ToListAsync(cancellationToken);
        var media = mediaRows
            .GroupBy(row => row.PostId)
            .ToDictionary(
                group => group.Key,
                group => PostExportLabels.Media(
                    group.Count(row => string.Equals(row.Kind, MediaKinds.Image, StringComparison.Ordinal)),
                    group.Count(row => string.Equals(row.Kind, MediaKinds.Video, StringComparison.Ordinal))));

        var parentIds = posts.Values
            .Where(post => post.ParentPostId is not null)
            .Select(post => post.ParentPostId!.Value)
            .Distinct()
            .ToArray();
        var parentAuthors = parentIds.Length == 0
            ? new Dictionary<Guid, Guid>()
            : await _dbContext.Posts
                .AsNoTracking()
                .Where(post => parentIds.Contains(post.Id))
                .Select(post => new { post.Id, post.AuthorPersonaId })
                .ToDictionaryAsync(post => post.Id, post => post.AuthorPersonaId, cancellationToken);

        var rows = new List<PostExportRow>(page.Length);
        var historyRows = new List<PostEditHistoryExportRow>();
        foreach (var id in page)
        {
            // A post that vanished between the id read and this page cannot happen (nothing is hard-deleted, XC-010),
            // but skipping is the safe answer if it ever did.
            if (!posts.TryGetValue(id, out var post))
            {
                continue;
            }

            lookups.Personas.TryGetValue(post.AuthorPersonaId, out var author);
            var real = engagement.GetValueOrDefault(post.Id);
            var realLike = real?.RealLike ?? 0;
            var realRepost = real?.RealRepost ?? 0;
            var realReply = real?.RealReply ?? 0;

            // Reply to names the parent only when the parent resolved INSIDE this exercise (parentAuthors is read
            // through the scoped Posts set); a parent id pointing anywhere else is not printed (Gate-1 L2).
            Guid? resolvedParentId = null;
            string? parentHandle = null;
            if (post.ParentPostId is { } parentId && parentAuthors.TryGetValue(parentId, out var parentAuthorId))
            {
                resolvedParentId = parentId;
                if (lookups.Personas.TryGetValue(parentAuthorId, out var parentAuthor))
                {
                    parentHandle = parentAuthor.Handle;
                }
            }

            rows.Add(new PostExportRow
            {
                ScenarioTime = PostExportLabels.ScenarioTime(post.CreatedScenarioTime, zone),
                WallClockUtc = post.CreatedWallClock.UtcDateTime,
                AuthorHandle = PostExportLabels.Handle(author?.Handle),
                AuthorName = author?.DisplayName ?? string.Empty,
                AuthorType = PostExportLabels.AuthorType(post.Origin),
                PostedBy = ResolvePostedBy(post, lookups),
                InjectRef = ResolveInjectRef(post.InjectId, lookups),
                PostId = post.Id.ToString(),
                ReplyTo = PostExportLabels.ReplyTo(parentHandle, resolvedParentId),
                Text = post.Body,
                Media = media.GetValueOrDefault(post.Id) ?? string.Empty,
                Likes = realLike,
                Reposts = realRepost,
                Replies = realReply,
                ShownLikes = post.BaselineLikeCount + realLike,
                ShownReposts = post.BaselineRepostCount + realRepost,
                ShownReplies = post.BaselineReplyCount + realReply,
                PinnedForAll = post.PinnedForAllAt is null ? string.Empty : PostExportLabels.Yes,
                Status = post.DeletedAt is null ? PostExportLabels.Live : PostExportLabels.TakenDown,
                TakenDownAt = PostExportLabels.ScenarioTime(post.DeletedAt, zone),
                Edits = post.EditCount,
                LastEditedAt = post.EditCount > 0 ? PostExportLabels.ScenarioTime(post.LastEditedScenarioTime, zone) : string.Empty,
                OriginalText = post.EditCount > 0
                    ? editsByPost[post.Id].FirstOrDefault(edit => edit.EditNumber == 1)?.PreviousBody ?? string.Empty
                    : string.Empty,
            });

            if (post.EditCount > 0)
            {
                historyRows.AddRange(EditHistoryRows(post, editsByPost[post.Id], zone));
            }
        }

        return (rows, historyRows);
    }

    /// <summary>
    /// The <c>Edit history</c> rows of one edited post (DF-39), edit number ascending: version 0 at the post's creation
    /// times, version n at <c>PostEdit</c> n's times; version n's text is <c>PostEdit</c> n+1's <c>PreviousBody</c>, or
    /// the current body for the last version, which alone is <c>Current = yes</c>.
    /// </summary>
    private static IEnumerable<PostEditHistoryExportRow> EditHistoryRows(PageRow post, IEnumerable<EditRow> edits, TimeZoneInfo zone)
    {
        var byNumber = edits.ToDictionary(edit => edit.EditNumber);
        for (var number = 0; number <= post.EditCount; number++)
        {
            var isCurrent = number == post.EditCount;
            var text = isCurrent
                ? post.Body
                : byNumber.TryGetValue(number + 1, out var next) ? next.PreviousBody : string.Empty;

            DateTimeOffset scenario;
            DateTimeOffset wall;
            if (number == 0)
            {
                scenario = post.CreatedScenarioTime;
                wall = post.CreatedWallClock;
            }
            else if (byNumber.TryGetValue(number, out var edit))
            {
                scenario = edit.EditedScenarioTime;
                wall = edit.EditedAt;
            }
            else
            {
                // A missing edit row cannot happen (the edit and the count are written in one transaction); the post's
                // own last-edit time is the safest stand-in if it ever did.
                scenario = post.LastEditedScenarioTime ?? post.CreatedScenarioTime;
                wall = post.CreatedWallClock;
            }

            yield return new PostEditHistoryExportRow
            {
                PostId = post.Id.ToString(),
                EditNumber = number,
                ScenarioTime = PostExportLabels.ScenarioTime(scenario, zone),
                WallClockUtc = wall.UtcDateTime,
                Text = text,
                Current = isCurrent ? PostExportLabels.CurrentYes : PostExportLabels.CurrentNo,
            };
        }
    }

    private static string ResolvePostedBy(PageRow post, ExportLookups lookups)
    {
        if (PostExportLabels.HasNoActingHuman(post.Origin) || string.IsNullOrWhiteSpace(post.ActingHumanId))
        {
            return string.Empty;
        }

        return lookups.Humans.GetValueOrDefault(post.ActingHumanId) ?? string.Empty;
    }

    /// <summary>
    /// The <c>Inject #</c> cell. A GUID names an inject item: its reference when the item is in this exercise, else
    /// blank (an item id from another exercise is never resolved). A non-GUID inject id is not a reference into any
    /// table, so it is written raw (Gate-1 L4).
    /// </summary>
    private static string ResolveInjectRef(string? injectId, ExportLookups lookups)
    {
        if (string.IsNullOrWhiteSpace(injectId))
        {
            return string.Empty;
        }

        if (!Guid.TryParse(injectId, out var itemId))
        {
            return injectId;
        }

        return lookups.Injects.GetValueOrDefault(itemId) ?? string.Empty;
    }

    private static TelemetryEvent BuildDownloadedEvent(
        Guid exerciseId,
        ExerciseFacts facts,
        CurrentStaffSession? staff,
        ExportLookups lookups,
        int rows,
        DateTimeOffset now,
        DateTimeOffset scenarioTime)
    {
        string? role = null;
        if (staff is not null)
        {
            lookups.StaffRoles.TryGetValue(staff.StaffUserId, out role);
        }

        return new TelemetryEvent
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = "v0",
            ExerciseId = exerciseId,
            EventType = DownloadedEventType,
            Channel = SystemChannel,
            Actor = new TelemetryActor
            {
                Kind = SystemActorKind,

                // Off-envelope empty strings are null-omitted (the v0 schema types these as optional non-empty).
                ActingHumanId = staff?.StaffUserId.ToString(),
                SessionId = staff?.SessionId.ToString(),
                Role = string.IsNullOrWhiteSpace(role) ? null : role,
            },
            WallClockTime = now,
            ScenarioTime = scenarioTime,
            TimeZone = string.IsNullOrWhiteSpace(facts.TimeZone) ? ExerciseDay.UtcZoneId : facts.TimeZone,
            Target = new TelemetryTarget { EntityType = "exercise", EntityId = exerciseId.ToString() },
            Payload = JsonSerializer.Serialize(new DownloadedPayload { Rows = rows }),
            EmittedAt = now,
        };
    }

    /// <summary>A persona's handle and display name.</summary>
    private sealed record PersonaLabel(string Handle, string DisplayName);

    /// <summary>The per-exercise lookups read once per export.</summary>
    private sealed record ExportLookups(
        IReadOnlyDictionary<Guid, PersonaLabel> Personas,
        IReadOnlyDictionary<string, string> Humans,
        IReadOnlyDictionary<Guid, string> StaffRoles,
        IReadOnlyDictionary<Guid, string> Injects);

    /// <summary>The post columns one page reads.</summary>
    private sealed record PageRow(
        Guid Id,
        Guid AuthorPersonaId,
        string Body,
        DateTimeOffset CreatedScenarioTime,
        DateTimeOffset CreatedWallClock,
        string Origin,
        string ActingHumanId,
        string? InjectId,
        Guid? ParentPostId,
        DateTimeOffset? DeletedAt,
        int BaselineLikeCount,
        int BaselineRepostCount,
        int BaselineReplyCount,
        DateTimeOffset? PinnedForAllAt,
        int EditCount,
        DateTimeOffset? LastEditedScenarioTime);

    /// <summary>One <c>PostEdit</c> the export reads (story 19).</summary>
    private sealed record EditRow(
        Guid PostId,
        int EditNumber,
        string PreviousBody,
        DateTimeOffset EditedAt,
        DateTimeOffset EditedScenarioTime);

    /// <summary>The opaque XC-004 payload: the row count only.</summary>
    private sealed class DownloadedPayload
    {
        [JsonPropertyName("rows")]
        public required int Rows { get; init; }
    }
}
