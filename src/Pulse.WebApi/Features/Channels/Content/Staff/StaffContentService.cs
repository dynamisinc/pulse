namespace Pulse.WebApi.Features.Channels.Content.Staff;

using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// The staff content API's logic (channels-foundation story 07): the reads (list, one, preview-as-participant) and the
/// writes, each a thin call into the funnel (<see cref="IContentPublishService"/>, <see cref="IContentFeaturing"/>), which
/// owns the state machine, validation, scoping, telemetry and broadcast. Scoped, like the funnel it calls.
/// </summary>
/// <remarks>
/// <para>
/// <b>Identity (COR-018).</b> Every write is made as <c>{ origin: controller, actingHumanId: the staff user }</c>, read
/// from <see cref="ICurrentStaffSessionAccessor"/>; no request field names either. No staff session, or no resolved
/// scope, is <see cref="StaffContentOutcome.Unauthorized"/> (fail closed), even though the route filter refuses it first.
/// </para>
/// <para>
/// <b>Isolation (COR-001).</b> The exercise is only <see cref="IExerciseContext"/>; every read goes through the central
/// exercise + soft-delete filter and restates the predicate, so another exercise's id is the same 404 as an unknown one.
/// </para>
/// </remarks>
public sealed class StaffContentService
{
    /// <summary>
    /// The list's default page size. Each row is the funnel's full staff projection (outlet, media and revisions: a few
    /// small indexed reads per row), so the console polls a modest page and filters by channel/status.
    /// </summary>
    public const int DefaultListLimit = 50;

    /// <summary>The list's largest page size.</summary>
    public const int MaxListLimit = 200;

    /// <summary>The refusal for a schedule instant already past in scenario time.</summary>
    public const string SchedulePastMessage = "scenarioTime must not be in the past (scenario time).";

    private const string BodyRequiredMessage = "A request body is required.";

    private readonly PulseDbContext _db;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentStaffSessionAccessor _staffSession;
    private readonly IContentPublishService _funnel;
    private readonly IContentFeaturing _featuring;
    private readonly ContentProjector _projector;
    private readonly TimeProvider _time;
    private readonly IScenarioNow? _scenarioNow;
    private readonly IReadOnlyList<IContentKindDescriptor> _descriptors;

    /// <summary>Creates the service.</summary>
    /// <param name="db">The exercise-scoped persistence context (reads only; writes go through the funnel).</param>
    /// <param name="exerciseContext">The server-resolved exercise scope.</param>
    /// <param name="staffSession">The staff session: the only source of the acting human.</param>
    /// <param name="funnel">The publish funnel.</param>
    /// <param name="featuring">The funnel's featured-slot half.</param>
    /// <param name="projector">The funnel's staff projection.</param>
    /// <param name="time">The wall clock.</param>
    /// <param name="scenarioNow">
    /// The exercise's scenario now (engine-runtime/08, CLK-2: the running clock, else the latest post, else now; COR-053).
    /// Absent = the wall clock.
    /// </param>
    /// <param name="descriptors">The registered content kinds (the preview's participant payload projection).</param>
    public StaffContentService(
        PulseDbContext db,
        IExerciseContext exerciseContext,
        ICurrentStaffSessionAccessor staffSession,
        IContentPublishService funnel,
        IContentFeaturing featuring,
        ContentProjector projector,
        TimeProvider time,
        IScenarioNow? scenarioNow = null,
        IEnumerable<IContentKindDescriptor>? descriptors = null)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(staffSession);
        ArgumentNullException.ThrowIfNull(funnel);
        ArgumentNullException.ThrowIfNull(featuring);
        ArgumentNullException.ThrowIfNull(projector);
        ArgumentNullException.ThrowIfNull(time);

        _db = db;
        _exerciseContext = exerciseContext;
        _staffSession = staffSession;
        _funnel = funnel;
        _featuring = featuring;
        _projector = projector;
        _time = time;
        _scenarioNow = scenarioNow;
        _descriptors = descriptors?.ToList() ?? [];
    }

    /// <summary>
    /// <c>GET /api/content-items</c>: items in every status (drafts, scheduled, published, retracted), newest created
    /// first, optionally filtered. Soft-deleted items are not listed.
    /// </summary>
    /// <param name="channel">A channel id filter.</param>
    /// <param name="status">A status filter (<see cref="ChannelVocabulary.ContentStatuses"/>).</param>
    /// <param name="outlet">An outlet id filter.</param>
    /// <param name="kind">A content kind filter.</param>
    /// <param name="limit">The page size (default <see cref="DefaultListLimit"/>, at most <see cref="MaxListLimit"/>).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The staff rows.</returns>
    public async Task<StaffContentResult> ListAsync(
        string? channel, string? status, string? outlet, string? kind, int? limit, CancellationToken cancellationToken = default)
    {
        if (await CallerAsync(cancellationToken) is not { } caller)
        {
            return StaffContentResult.Unauthorized;
        }

        // An empty filter (?status=) means "no filter", the same for every parameter.
        channel = string.IsNullOrWhiteSpace(channel) ? null : channel;
        status = string.IsNullOrWhiteSpace(status) ? null : status;
        outlet = string.IsNullOrWhiteSpace(outlet) ? null : outlet;
        kind = string.IsNullOrWhiteSpace(kind) ? null : kind;

        if (status is not null && !ChannelVocabulary.ContentStatuses.Contains(status, StringComparer.Ordinal))
        {
            return StaffContentResult.Invalid($"status must be one of {string.Join(", ", ChannelVocabulary.ContentStatuses)}.");
        }

        Guid? outletId = null;
        if (outlet is not null)
        {
            if (!Guid.TryParse(outlet, out var parsed))
            {
                return StaffContentResult.Invalid("outlet must be an outlet id.");
            }

            outletId = parsed;
        }

        if (limit is < 1 or > MaxListLimit)
        {
            return StaffContentResult.Invalid($"limit must be between 1 and {MaxListLimit}.");
        }

        var exerciseId = caller.ExerciseId;
        var query = _db.ContentItems.AsNoTracking().Where(item => item.ExerciseId == exerciseId);
        if (channel is not null)
        {
            query = query.Where(item => item.ChannelId == channel);
        }

        if (status is not null)
        {
            query = query.Where(item => item.Status == status);
        }

        if (outletId is { } outletFilter)
        {
            query = query.Where(item => item.OutletId == outletFilter);
        }

        if (kind is not null)
        {
            query = query.Where(item => item.Kind == kind);
        }

        var rows = await query
            .OrderByDescending(item => item.CreatedWallClock)
            .ThenByDescending(item => item.Id)
            .Take(limit ?? DefaultListLimit)
            .ToListAsync(cancellationToken);

        var items = new List<ChannelContentStaffDto>(rows.Count);
        foreach (var row in rows)
        {
            items.Add(await _projector.ToStaffAsync(row, cancellationToken));
        }

        return StaffContentResult.Ok(items);
    }

    /// <summary><c>GET /api/content-items/{id}</c>: one item in any status.</summary>
    /// <param name="id">The content item id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The staff view, or not found.</returns>
    public async Task<StaffContentResult> GetAsync(Guid id, CancellationToken cancellationToken = default)
    {
        if (await CallerAsync(cancellationToken) is not { } caller)
        {
            return StaffContentResult.Unauthorized;
        }

        var item = await _db.ContentItems.AsNoTracking()
            .FirstOrDefaultAsync(candidate => candidate.Id == id && candidate.ExerciseId == caller.ExerciseId, cancellationToken);
        return item is null
            ? StaffContentResult.NotFound
            : StaffContentResult.Ok(await _projector.ToStaffAsync(item, cancellationToken));
    }

    /// <summary>
    /// <c>GET /api/content-items/{id}/preview</c>: the PARTICIPANT view of an item in any status, drafts included
    /// (COR-041); see <see cref="ContentPreviewMapper"/>.
    /// </summary>
    /// <param name="id">The content item id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The participant DTO, or not found.</returns>
    public async Task<StaffContentResult> PreviewAsync(Guid id, CancellationToken cancellationToken = default)
    {
        if (await CallerAsync(cancellationToken) is not { } caller)
        {
            return StaffContentResult.Unauthorized;
        }

        var item = await _db.ContentItems.AsNoTracking()
            .FirstOrDefaultAsync(candidate => candidate.Id == id && candidate.ExerciseId == caller.ExerciseId, cancellationToken);
        if (item is null)
        {
            return StaffContentResult.NotFound;
        }

        var staff = await _projector.ToStaffAsync(item, cancellationToken);
        var now = await ScenarioNowAsync(caller.ExerciseId, cancellationToken);
        var descriptor = _descriptors.FirstOrDefault(candidate => string.Equals(candidate.Kind, item.Kind, StringComparison.Ordinal));
        return StaffContentResult.Ok(ContentPreviewMapper.ToParticipant(item, staff, now, descriptor));
    }

    /// <summary><c>POST /api/content-items</c>: creates a draft.</summary>
    /// <param name="request">The fields.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The created item (201) or the funnel's refusal.</returns>
    public Task<StaffContentResult> CreateAsync(ContentWriteRequest? request, CancellationToken cancellationToken = default) =>
        request is null
            ? Task.FromResult(StaffContentResult.Invalid(BodyRequiredMessage))
            : RunAsync(
                caller => _funnel.CreateDraftAsync(request, caller.Content, cancellationToken),
                created: true,
                cancellationToken);

    /// <summary>
    /// <c>PUT /api/content-items/{id}</c>: edits a draft or scheduled item (stale <c>version</c> → 409). Fields are
    /// PUT-replace (the funnel's rule), including <c>featuredRank</c>, which on an unpublished item is a preset for when it
    /// goes live; once published, the rank changes only through feature / reorder.
    /// </summary>
    /// <param name="id">The content item id.</param>
    /// <param name="request">The fields, with the version being edited.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The updated item or the funnel's refusal.</returns>
    public Task<StaffContentResult> UpdateAsync(Guid id, ContentWriteRequest? request, CancellationToken cancellationToken = default) =>
        request is null
            ? Task.FromResult(StaffContentResult.Invalid(BodyRequiredMessage))
            : RunAsync(caller => _funnel.UpdateDraftAsync(id, request, caller.Content, cancellationToken), cancellationToken: cancellationToken);

    /// <summary><c>DELETE /api/content-items/{id}</c>: soft-deletes (a published item also fires <c>ContentRetracted</c>).</summary>
    /// <param name="id">The content item id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Deleted (204) or the funnel's refusal.</returns>
    public async Task<StaffContentResult> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var result = await RunAsync(caller => _funnel.SoftDeleteAsync(id, caller.Content, cancellationToken), cancellationToken: cancellationToken);
        return result.Outcome == StaffContentOutcome.Ok ? StaffContentResult.Deleted : result;
    }

    /// <summary><c>POST /api/content-items/{id}/publish</c>, with optional explicit <see cref="PublishOptions"/>.</summary>
    /// <param name="id">The content item id.</param>
    /// <param name="options">The side effects, or null to resolve them (FC-7a).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A <see cref="ContentPublishResponse"/> or the funnel's refusal.</returns>
    public async Task<StaffContentResult> PublishAsync(Guid id, PublishOptions? options, CancellationToken cancellationToken = default)
    {
        if (await CallerAsync(cancellationToken) is not { } caller)
        {
            return StaffContentResult.Unauthorized;
        }

        var result = await _funnel.PublishAsync(id, options, caller.Content, cancellationToken);
        if (result is { Outcome: ContentPublishOutcome.Ok, Item: { } item })
        {
            return StaffContentResult.Ok(new ContentPublishResponse
            {
                Item = item,
                SideEffectWarnings = result.SideEffectWarnings ?? [],
            });
        }

        return StaffContentResult.From(result, created: false);
    }

    /// <summary>
    /// <c>POST /api/content-items/{id}/schedule</c>: the instant must not be past in scenario time; the options are
    /// persisted for the runner's replay (FC-7a).
    /// </summary>
    /// <param name="id">The content item id.</param>
    /// <param name="request">The instant and options.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The scheduled item or a refusal.</returns>
    public async Task<StaffContentResult> ScheduleAsync(Guid id, ContentScheduleRequest? request, CancellationToken cancellationToken = default)
    {
        if (await CallerAsync(cancellationToken) is not { } caller)
        {
            return StaffContentResult.Unauthorized;
        }

        if (request is null || string.IsNullOrWhiteSpace(request.ScenarioTime))
        {
            return StaffContentResult.Invalid("scenarioTime is required.");
        }

        // The funnel owns the strict ISO parse (an unparseable value is its 400); this only adds "not in the past".
        if (DateTimeOffset.TryParse(request.ScenarioTime, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var at)
            && at < await ScenarioNowAsync(caller.ExerciseId, cancellationToken))
        {
            return StaffContentResult.Invalid(SchedulePastMessage);
        }

        return StaffContentResult.From(
            await _funnel.ScheduleAsync(id, request.ScenarioTime, request.Options, caller.Content, cancellationToken),
            created: false);
    }

    /// <summary><c>POST /api/content-items/{id}/unschedule</c>.</summary>
    /// <param name="id">The content item id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The item or the funnel's refusal.</returns>
    public Task<StaffContentResult> UnscheduleAsync(Guid id, CancellationToken cancellationToken = default) =>
        RunAsync(caller => _funnel.UnscheduleAsync(id, caller.Content, cancellationToken), cancellationToken: cancellationToken);

    /// <summary><c>POST /api/content-items/{id}/retract</c>.</summary>
    /// <param name="id">The content item id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The item or the funnel's refusal.</returns>
    public Task<StaffContentResult> RetractAsync(Guid id, CancellationToken cancellationToken = default) =>
        RunAsync(caller => _funnel.RetractAsync(id, caller.Content, cancellationToken), cancellationToken: cancellationToken);

    /// <summary><c>POST /api/content-items/{id}/restore</c>.</summary>
    /// <param name="id">The content item id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The item or the funnel's refusal.</returns>
    public Task<StaffContentResult> RestoreAsync(Guid id, CancellationToken cancellationToken = default) =>
        RunAsync(caller => _funnel.RestoreAsync(id, caller.Content, cancellationToken), cancellationToken: cancellationToken);

    /// <summary><c>POST /api/content-items/{id}/revise</c>: revises a published item (<c>touchUpdatedStamp</c> defaults to true).</summary>
    /// <param name="id">The content item id.</param>
    /// <param name="request">The revision.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The item or a refusal.</returns>
    public Task<StaffContentResult> ReviseAsync(Guid id, ContentReviseRequest? request, CancellationToken cancellationToken = default)
    {
        if (request?.Fields is null || string.IsNullOrWhiteSpace(request.Kind))
        {
            return Task.FromResult(StaffContentResult.Invalid("kind and fields are required."));
        }

        return RunAsync(
            async caller =>
            {
                // A published item's featured rank belongs to feature / feature/reorder (one event each, PRT-004): the
                // revise keeps the stored rank whatever `fields.featuredRank` says, so an editor form that does not
                // round-trip it can never silently unfeature the item.
                var storedRank = await _db.ContentItems.AsNoTracking()
                    .Where(item => item.Id == id && item.ExerciseId == caller.ExerciseId)
                    .Select(item => item.FeaturedRank)
                    .FirstOrDefaultAsync(cancellationToken);
                var options = new ReviseOptions
                {
                    Kind = request.Kind,
                    Note = request.Note,
                    Fields = request.Fields with { FeaturedRank = storedRank },
                    TouchUpdatedStamp = request.TouchUpdatedStamp ?? true,
                };
                return await _funnel.ReviseAsync(id, options, caller.Content, cancellationToken);
            },
            cancellationToken: cancellationToken);
    }

    /// <summary><c>POST /api/content-items/{id}/feature</c>: <c>{ rank }</c> features, <c>{ rank: null }</c> unfeatures.</summary>
    /// <param name="id">The content item id.</param>
    /// <param name="request">The rank.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The item or a refusal.</returns>
    public Task<StaffContentResult> FeatureAsync(Guid id, ContentFeatureRequest? request, CancellationToken cancellationToken = default) =>
        request is null
            ? Task.FromResult(StaffContentResult.Invalid(BodyRequiredMessage))
            : RunAsync(caller => _featuring.FeatureAsync(id, request.Rank, caller.Content, cancellationToken), cancellationToken: cancellationToken);

    /// <summary><c>POST /api/content-items/feature/reorder</c>: the channel's whole featured order, atomically.</summary>
    /// <param name="request">The ordered ids (and the channel when clearing).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The listed items in order, or a refusal with nothing applied.</returns>
    public async Task<StaffContentResult> ReorderFeaturedAsync(
        ContentFeatureReorderRequest? request, CancellationToken cancellationToken = default)
    {
        if (await CallerAsync(cancellationToken) is not { } caller)
        {
            return StaffContentResult.Unauthorized;
        }

        if (request?.Ids is null)
        {
            return StaffContentResult.Invalid("ids is required.");
        }

        var result = await _featuring.ReorderFeaturedAsync(request.Ids, request.Channel, caller.Content, cancellationToken);
        return result.Outcome == ContentPublishOutcome.Ok
            ? StaffContentResult.Ok(result.Items)
            : StaffContentResult.Refused(result.Outcome, result.Errors, result.ConflictItem);
    }

    private async Task<StaffContentResult> RunAsync(
        Func<StaffCaller, Task<ContentPublishResult>> call, bool created = false, CancellationToken cancellationToken = default)
    {
        if (await CallerAsync(cancellationToken) is not { } caller)
        {
            return StaffContentResult.Unauthorized;
        }

        return StaffContentResult.From(await call(caller), created);
    }

    /// <summary>The resolved scope and the staff user behind the request, or null (fail closed).</summary>
    private async Task<StaffCaller?> CallerAsync(CancellationToken cancellationToken)
    {
        if (_exerciseContext.CurrentExerciseId is not { } exerciseId || exerciseId == Guid.Empty)
        {
            return null;
        }

        var staff = await _staffSession.GetCurrentStaffSessionAsync(cancellationToken);
        return staff is null
            ? null
            : new StaffCaller(
                exerciseId,
                new ContentCaller { Origin = ChannelVocabulary.OriginController, ActingHumanId = staff.StaffUserId.ToString() });
    }

    /// <summary>
    /// The funnel's clock read: the exercise's scenario now (<see cref="IScenarioNow"/>: the running clock, else the
    /// latest post, else the wall clock; engine-runtime/08, COR-053). The wall clock when no resolver is composed.
    /// </summary>
    private async Task<DateTimeOffset> ScenarioNowAsync(Guid exerciseId, CancellationToken cancellationToken)
    {
        var now = _time.GetUtcNow();
        return _scenarioNow is null ? now : await _scenarioNow.GetAsync(exerciseId, now, cancellationToken);
    }

    private sealed record StaffCaller(Guid ExerciseId, ContentCaller Content);
}

/// <summary>A staff content call's outcome; the endpoint maps it to exactly one status.</summary>
public enum StaffContentOutcome
{
    /// <summary>200 with <see cref="StaffContentResult.Value"/>.</summary>
    Ok,

    /// <summary>201 with <see cref="StaffContentResult.Value"/>.</summary>
    Created,

    /// <summary>204.</summary>
    Deleted,

    /// <summary>401: no staff session or no resolved scope.</summary>
    Unauthorized,

    /// <summary>404: unknown, other-exercise or deleted (identical).</summary>
    NotFound,

    /// <summary>400 with readable <see cref="StaffContentResult.Errors"/>.</summary>
    Invalid,

    /// <summary>409 with the item's current state when it exists.</summary>
    Conflict,

    /// <summary>409: a publish gate held the publish.</summary>
    Held,
}

/// <summary>The result of a <see cref="StaffContentService"/> call.</summary>
/// <param name="Outcome">The outcome.</param>
/// <param name="Value">The response body on success.</param>
/// <param name="Errors">Readable refusal messages.</param>
/// <param name="Current">On a conflict or hold, the item as it is now.</param>
public sealed record StaffContentResult(
    StaffContentOutcome Outcome,
    object? Value = null,
    IReadOnlyList<string>? Errors = null,
    ChannelContentStaffDto? Current = null)
{
    /// <summary>The fail-closed 401.</summary>
    public static StaffContentResult Unauthorized { get; } = new(StaffContentOutcome.Unauthorized);

    /// <summary>The one 404.</summary>
    public static StaffContentResult NotFound { get; } =
        new(StaffContentOutcome.NotFound, Errors: [ContentPublishService.NotFoundMessage]);

    /// <summary>The 204.</summary>
    public static StaffContentResult Deleted { get; } = new(StaffContentOutcome.Deleted);

    /// <summary>A 200.</summary>
    /// <param name="value">The body.</param>
    /// <returns>The result.</returns>
    public static StaffContentResult Ok(object value) => new(StaffContentOutcome.Ok, value);

    /// <summary>A 400.</summary>
    /// <param name="message">The readable reason.</param>
    /// <returns>The result.</returns>
    public static StaffContentResult Invalid(string message) => new(StaffContentOutcome.Invalid, Errors: [message]);

    /// <summary>Maps a funnel result.</summary>
    /// <param name="result">The funnel's result.</param>
    /// <param name="created">Whether success is a 201.</param>
    /// <returns>The result.</returns>
    public static StaffContentResult From(ContentPublishResult result, bool created)
    {
        ArgumentNullException.ThrowIfNull(result);
        return result.Outcome == ContentPublishOutcome.Ok
            ? new(created ? StaffContentOutcome.Created : StaffContentOutcome.Ok, result.Item)
            : Refused(result.Outcome, result.Errors, result.Item);
    }

    /// <summary>Maps a funnel refusal.</summary>
    /// <param name="outcome">The funnel outcome (not <see cref="ContentPublishOutcome.Ok"/>).</param>
    /// <param name="errors">The funnel's messages.</param>
    /// <param name="current">The item as it is now, for a conflict or hold.</param>
    /// <returns>The result.</returns>
    public static StaffContentResult Refused(
        ContentPublishOutcome outcome, IReadOnlyList<string> errors, ChannelContentStaffDto? current) =>
        outcome switch
        {
            ContentPublishOutcome.NotFound => NotFound,
            ContentPublishOutcome.Invalid => new(StaffContentOutcome.Invalid, Errors: errors),
            ContentPublishOutcome.Conflict => new(StaffContentOutcome.Conflict, Errors: errors, Current: current),
            ContentPublishOutcome.Held => new(StaffContentOutcome.Held, Errors: errors, Current: current),
            _ => throw new ArgumentOutOfRangeException(nameof(outcome), outcome, "Not a refusal."),
        };
}
