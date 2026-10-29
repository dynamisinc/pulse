namespace Pulse.WebApi.Features.Channels.Content.Publish;

using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Realtime;

/// <summary>
/// <b>The one funnel</b> for channel content (FC-7 <see cref="IContentPublishService"/>, channels-foundation story 04):
/// every publisher — the staff API, inject fire, the scheduled runner, a participant composer, the engine — calls it,
/// and nothing else writes <see cref="ContentItem"/> rows. It owns the FC-1 state machine, sanitization, payload
/// validation, scenario-time stamping, revisions, telemetry, the publish gates, the broadcast, the observers and the
/// FC-7a publish options, so no channel re-implements them. Scoped, like the <see cref="PulseDbContext"/> it writes
/// through. It mirrors <c>PostIngestService</c>'s shape and <c>InjectQueueService</c>'s concurrency approach.
/// </summary>
/// <remarks>
/// <para>
/// <b>Scope and identity are server-authoritative (COR-001, COR-018).</b> The exercise comes only from
/// <see cref="IExerciseContext"/> (fail closed: no scope is <see cref="ContentPublishOutcome.NotFound"/>, nothing
/// written); <c>origin</c>, the acting human and the inject id come only from the <see cref="ContentCaller"/> the calling
/// endpoint built from its authenticated session — no request field is read for them. Authorization is the endpoint's.
/// Every read and write goes through the central exercise filter and write guard, and every id lookup restates the
/// exercise predicate, so another exercise's item reads exactly like an unknown id.
/// </para>
/// <para>
/// <b>Exactly once.</b> Every state change bumps <see cref="ContentItem.Version"/>, an EF concurrency token, in the same
/// <c>SaveChanges</c> as its revision and its ONE telemetry event. Two racing publishes of one item therefore commit
/// once: the loser's save fails on the token and answers <see cref="ContentPublishOutcome.Conflict"/> with the item as it
/// is now, before any broadcast, observer or side effect ran. A write request carrying a stale <c>version</c> is a
/// conflict too.
/// </para>
/// <para>
/// <b>After commit, nothing fails the call.</b> The broadcast (<see cref="IFeedBroadcaster"/>, participant-safe
/// projection only; lifecycle routing such as "no live push after EndEx" is the broadcaster's, exactly as for
/// <c>PostIngestService</c>), the <see cref="IContentPublishedObserver"/>s and the optional side effects
/// (<see cref="IAlertRaiser"/>, <see cref="IPairedSocialPoster"/>) run after the state change committed, without the
/// request's token, and a failure in any of them is logged (and, for a side effect, reported in
/// <see cref="ContentPublishResult.SideEffectWarnings"/>), never rolled back.
/// </para>
/// <para>
/// <b>Engine drafts (NWS-022).</b> An <c>engine</c> caller may only create and edit drafts, and an engine-origin item
/// is published or scheduled only by a staff-attributed (<c>controller</c> or <c>inject</c>) call.
/// </para>
/// </remarks>
public sealed partial class ContentPublishService : IContentPublishService
{
    /// <summary>The soft-delete action literal (telemetry <c>payload.action</c>); delete is outside the FC-1 table.</summary>
    public const string DeleteAction = "delete";

    /// <summary>The readable 409 for a stale <c>version</c>.</summary>
    public const string StaleVersionMessage = "Changed by someone else. Refresh to see the latest version.";

    /// <summary>The 404 message (unknown, cross-exercise, soft-deleted, or no scope: identical).</summary>
    public const string NotFoundMessage = "Content item not found.";

    /// <summary>The refusal for an engine caller acting beyond drafts (NWS-022).</summary>
    public const string EngineDraftOnlyMessage = "The engine may only create and edit drafts; a staff member publishes them.";

    /// <summary>The refusal for publishing an engine draft from a non-staff call (NWS-022).</summary>
    public const string EngineItemNeedsStaffMessage = "An engine draft can only be published or scheduled by staff.";

    private const string FallbackTimeZone = "UTC";

    private readonly PulseDbContext _db;
    private readonly IExerciseContext _exerciseContext;
    private readonly IFeedBroadcaster _broadcaster;
    private readonly ISanitizerProfileRegistry _profiles;
    private readonly ContentProjector _projector;
    private readonly IServiceProvider _services;
    private readonly IReadOnlyList<IContentKindDescriptor> _descriptors;
    private readonly IReadOnlyList<IContentPublishGate> _gates;
    private readonly IReadOnlyList<IContentPublishedObserver> _observers;
    private readonly IAlertRaiser? _alertRaiser;
    private readonly IPairedSocialPoster? _pairedPoster;
    private readonly IExerciseClock? _clock;
    private readonly TimeProvider _time;
    private readonly ILogger<ContentPublishService> _logger;

    /// <summary>Creates the funnel.</summary>
    /// <param name="db">The scoped unit of work.</param>
    /// <param name="exerciseContext">The server-resolved exercise scope (the sole scoping source).</param>
    /// <param name="broadcaster">The real-time fan-out (story 09 implements the content methods).</param>
    /// <param name="profiles">The named body sanitizer profiles.</param>
    /// <param name="projector">Builds the staff result and the participant-safe frames.</param>
    /// <param name="services">The request's scoped services, handed to payload validation.</param>
    /// <param name="descriptors">The registered content kinds (E4/E5/E6); an unregistered kind is a 400.</param>
    /// <param name="gates">Publish gates, in registration order; none = pass-through.</param>
    /// <param name="observers">Observers told about committed publishes, revises and retracts; possibly none.</param>
    /// <param name="alertRaiser">The alert source (story 10); absent = an alert option is reported, not raised.</param>
    /// <param name="pairedPoster">The paired Social poster (story 18); absent = reported, not posted.</param>
    /// <param name="clock">The native exercise clock (COR-053).</param>
    /// <param name="timeProvider">The wall clock; <see cref="TimeProvider.System"/> when absent.</param>
    /// <param name="logger">Diagnostics for post-commit failures.</param>
    public ContentPublishService(
        PulseDbContext db,
        IExerciseContext exerciseContext,
        IFeedBroadcaster broadcaster,
        ISanitizerProfileRegistry profiles,
        ContentProjector projector,
        IServiceProvider services,
        IEnumerable<IContentKindDescriptor>? descriptors = null,
        IEnumerable<IContentPublishGate>? gates = null,
        IEnumerable<IContentPublishedObserver>? observers = null,
        IAlertRaiser? alertRaiser = null,
        IPairedSocialPoster? pairedPoster = null,
        IExerciseClock? clock = null,
        TimeProvider? timeProvider = null,
        ILogger<ContentPublishService>? logger = null)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(broadcaster);
        ArgumentNullException.ThrowIfNull(profiles);
        ArgumentNullException.ThrowIfNull(projector);
        ArgumentNullException.ThrowIfNull(services);

        _db = db;
        _exerciseContext = exerciseContext;
        _broadcaster = broadcaster;
        _profiles = profiles;
        _projector = projector;
        _services = services;
        _descriptors = descriptors?.ToList() ?? [];
        _gates = gates?.ToList() ?? [];
        _observers = observers?.ToList() ?? [];
        _alertRaiser = alertRaiser;
        _pairedPoster = pairedPoster;
        _clock = clock;
        _time = timeProvider ?? TimeProvider.System;
        _logger = logger ?? NullLogger<ContentPublishService>.Instance;
    }

    /// <inheritdoc />
    public async Task<ContentPublishResult> CreateDraftAsync(
        ContentWriteRequest request, ContentCaller caller, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        caller = NormalizeCaller(caller);

        if (Scope() is not { } exerciseId)
        {
            return NotFound();
        }

        if (WhyCallerInvalid(caller) is { } callerError)
        {
            return Invalid(callerError);
        }

        if (Descriptor(request.Kind) is not { } descriptor)
        {
            return Invalid(UnknownKindMessage(request.Kind));
        }

        var outlet = await ResolveOutletAsync(request.OutletId, descriptor, cancellationToken);
        if (outlet is null)
        {
            return Invalid(OutletMessage(descriptor));
        }

        var prepared = await PrepareAsync(
            request, descriptor, caller, existing: null, ChannelVocabulary.StatusDraft, exerciseId, cancellationToken);
        if (prepared.Errors.Count > 0)
        {
            return Invalid([.. prepared.Errors]);
        }

        var time = await ClockAsync(exerciseId, cancellationToken);
        var item = new ContentItem
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            ChannelId = descriptor.ChannelId,
            Kind = descriptor.Kind,
            OutletId = outlet.Id,
            Slug = await UniqueSlugAsync(outlet.Id, prepared.Fields!.Headline, excludeId: null, cancellationToken),
            Status = ChannelVocabulary.StatusDraft,
            Headline = prepared.Fields.Headline,
            CreatedScenarioTime = time.ScenarioTime,
            CreatedWallClock = time.WallClock,
            Origin = caller.Origin,
            ActingHumanId = caller.ActingHumanId,
            InjectId = caller.InjectId,
            Version = 1,
        };

        ApplyFields(item, prepared.Fields);
        _db.ContentItems.Add(item);
        AddMediaRows(item, prepared.Fields);

        if (await TrySaveAsync(item.Id, cancellationToken) is { } conflict)
        {
            return conflict;
        }

        return await OkAsync(item, warnings: null);
    }

    /// <inheritdoc />
    public async Task<ContentPublishResult> UpdateDraftAsync(
        Guid id, ContentWriteRequest request, ContentCaller caller, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        caller = NormalizeCaller(caller);

        var load = await LoadForActionAsync(id, ContentTransitions.Edit, caller, cancellationToken);
        if (load.Refusal is { } refusal)
        {
            return refusal;
        }

        var (item, descriptor, exerciseId) = (load.Item!, load.Descriptor!, load.ExerciseId);

        if (request.Version != item.Version)
        {
            return await ConflictAsync(item, StaleVersionMessage);
        }

        if (!string.IsNullOrEmpty(request.Kind) && !string.Equals(request.Kind, item.Kind, StringComparison.Ordinal))
        {
            return Invalid("kind cannot change after an item is created.");
        }

        var outletId = item.OutletId;
        if (!string.IsNullOrEmpty(request.OutletId))
        {
            var outlet = await ResolveOutletAsync(request.OutletId, descriptor, cancellationToken);
            if (outlet is null)
            {
                return Invalid(OutletMessage(descriptor));
            }

            outletId = outlet.Id;
        }

        var prepared = await PrepareAsync(request, descriptor, caller, item, item.Status, exerciseId, cancellationToken);
        if (prepared.Errors.Count > 0)
        {
            return Invalid([.. prepared.Errors]);
        }

        var time = await ClockAsync(exerciseId, cancellationToken);
        await AddRevisionAsync(item, ChannelVocabulary.RevisionEdit, note: null, visible: false, caller, time, cancellationToken);

        // The permalink is free to move until the item is first published (FC-1: immutable once published).
        if (item.PublishedScenarioTime is null
            && (outletId != item.OutletId || !string.Equals(prepared.Fields!.Headline, item.Headline, StringComparison.Ordinal)))
        {
            item.Slug = await UniqueSlugAsync(outletId, prepared.Fields!.Headline, item.Id, cancellationToken);
        }

        item.OutletId = outletId;
        await ReplaceMediaAsync(item, prepared.Fields!, time, cancellationToken);
        ApplyFields(item, prepared.Fields!);
        item.Version++;

        if (await TrySaveAsync(item.Id, cancellationToken) is { } conflict)
        {
            return conflict;
        }

        return await OkAsync(item, warnings: null);
    }

    /// <inheritdoc />
    public async Task<ContentPublishResult> PublishAsync(
        Guid id, PublishOptions? options, ContentCaller caller, CancellationToken cancellationToken = default)
    {
        caller = NormalizeCaller(caller);

        var load = await LoadForActionAsync(id, ContentTransitions.Publish, caller, cancellationToken);
        if (load.Refusal is { } refusal)
        {
            return refusal;
        }

        var (item, descriptor, exerciseId) = (load.Item!, load.Descriptor!, load.ExerciseId);

        var gate = await EvaluateGatesAsync(item, PublishContext.Publish, caller, cancellationToken);
        if (gate.Held is { } held)
        {
            return held;
        }

        // FC-7a: decided BEFORE the state change, from the item as it stands (the runner and inject fire pass null).
        var (resolved, _) = PublishOptionsResolver.Resolve(options, item, descriptor);

        var time = await ClockAsync(exerciseId, cancellationToken);
        item.Status = ChannelVocabulary.StatusPublished;
        item.PublishedScenarioTime = time.ScenarioTime;
        item.PublishedWallClock = time.WallClock;
        item.LastError = null;
        if (caller.InjectId is { } injectId)
        {
            item.InjectId = injectId;
        }

        item.Version++;
        _db.TelemetryEvents.Add(ContentTelemetry.Build(ContentTransitions.Publish, item, caller, time, gateNote: gate.Note));

        if (await TrySaveAsync(item.Id, cancellationToken) is { } conflict)
        {
            return conflict;
        }

        await BroadcastPublishedAsync(item);
        await NotifyAsync(item, ObserverEvent.Published);
        var warnings = await RunSideEffectsAsync(item, resolved, caller);

        return await OkAsync(item, warnings);
    }

    /// <inheritdoc />
    public async Task<ContentPublishResult> ScheduleAsync(
        Guid id, string scenarioTime, PublishOptions? options, ContentCaller caller, CancellationToken cancellationToken = default)
    {
        caller = NormalizeCaller(caller);

        var load = await LoadForActionAsync(id, ContentTransitions.Schedule, caller, cancellationToken);
        if (load.Refusal is { } refusal)
        {
            return refusal;
        }

        var (item, _, exerciseId) = (load.Item!, load.Descriptor!, load.ExerciseId);

        if (!DateTimeOffset.TryParse(
                scenarioTime, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var scheduledAt))
        {
            return Invalid("scenarioTime must be an ISO-8601 instant.");
        }

        var gate = await EvaluateGatesAsync(item, PublishContext.Schedule, caller, cancellationToken);
        if (gate.Held is { } held)
        {
            return held;
        }

        var time = await ClockAsync(exerciseId, cancellationToken);
        item.Status = ChannelVocabulary.StatusScheduled;
        item.ScheduledScenarioTime = scheduledAt;

        // FC-7a: what the caller chose is what the runner replays — null clears a previously persisted choice.
        item.PublishOptionsJson = PublishOptionsResolver.Serialize(options);
        item.LastError = null;
        item.Version++;
        _db.TelemetryEvents.Add(ContentTelemetry.Build(ContentTransitions.Schedule, item, caller, time));

        if (await TrySaveAsync(item.Id, cancellationToken) is { } conflict)
        {
            return conflict;
        }

        return await OkAsync(item, warnings: null);
    }

    /// <inheritdoc />
    public async Task<ContentPublishResult> UnscheduleAsync(
        Guid id, ContentCaller caller, CancellationToken cancellationToken = default)
    {
        caller = NormalizeCaller(caller);

        var load = await LoadForActionAsync(id, ContentTransitions.Unschedule, caller, cancellationToken);
        if (load.Refusal is { } refusal)
        {
            return refusal;
        }

        var item = load.Item!;
        var time = await ClockAsync(load.ExerciseId, cancellationToken);
        item.Status = ChannelVocabulary.StatusDraft;
        item.ScheduledScenarioTime = null;
        item.Version++;
        _db.TelemetryEvents.Add(ContentTelemetry.Build(ContentTransitions.Unschedule, item, caller, time));

        if (await TrySaveAsync(item.Id, cancellationToken) is { } conflict)
        {
            return conflict;
        }

        return await OkAsync(item, warnings: null);
    }

    /// <inheritdoc />
    public async Task<ContentPublishResult> RetractAsync(Guid id, ContentCaller caller, CancellationToken cancellationToken = default)
    {
        caller = NormalizeCaller(caller);

        var load = await LoadForActionAsync(id, ContentTransitions.Retract, caller, cancellationToken);
        if (load.Refusal is { } refusal)
        {
            return refusal;
        }

        var item = load.Item!;
        var time = await ClockAsync(load.ExerciseId, cancellationToken);
        item.Status = ChannelVocabulary.StatusRetracted;
        item.RetractedScenarioTime = time.ScenarioTime;
        item.Version++;
        _db.TelemetryEvents.Add(ContentTelemetry.Build(ContentTransitions.Retract, item, caller, time));

        if (await TrySaveAsync(item.Id, cancellationToken) is { } conflict)
        {
            return conflict;
        }

        await BroadcastRetractedAsync(item, time.ScenarioTime);
        await NotifyAsync(item, ObserverEvent.Retracted);
        return await OkAsync(item, warnings: null);
    }

    /// <inheritdoc />
    public async Task<ContentPublishResult> RestoreAsync(Guid id, ContentCaller caller, CancellationToken cancellationToken = default)
    {
        caller = NormalizeCaller(caller);

        var load = await LoadForActionAsync(id, ContentTransitions.Restore, caller, cancellationToken);
        if (load.Refusal is { } refusal)
        {
            return refusal;
        }

        // A restore puts back what was already published: PublishedScenarioTime keeps the FIRST publish (FC-2), and
        // the publish options and gates (a decision about first publication) are not replayed.
        var item = load.Item!;
        var time = await ClockAsync(load.ExerciseId, cancellationToken);
        item.Status = ChannelVocabulary.StatusPublished;
        item.Version++;
        _db.TelemetryEvents.Add(ContentTelemetry.Build(ContentTransitions.Restore, item, caller, time));

        if (await TrySaveAsync(item.Id, cancellationToken) is { } conflict)
        {
            return conflict;
        }

        await BroadcastPublishedAsync(item);
        await NotifyAsync(item, ObserverEvent.Published);
        return await OkAsync(item, warnings: null);
    }

    /// <inheritdoc />
    public async Task<ContentPublishResult> ReviseAsync(
        Guid id, ReviseOptions options, ContentCaller caller, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(options.Fields);
        caller = NormalizeCaller(caller);

        var load = await LoadForActionAsync(id, ContentTransitions.Revise, caller, cancellationToken);
        if (load.Refusal is { } refusal)
        {
            return refusal;
        }

        var (item, descriptor, exerciseId) = (load.Item!, load.Descriptor!, load.ExerciseId);

        if (!ChannelVocabulary.StampMovingRevisionKinds.Contains(options.Kind, StringComparer.Ordinal))
        {
            return Invalid("A published item is revised as update, correction or silent_rewrite; edit is for drafts.");
        }

        if (options.Fields.Version != item.Version)
        {
            return await ConflictAsync(item, StaleVersionMessage);
        }

        if (!string.IsNullOrEmpty(options.Fields.Kind) && !string.Equals(options.Fields.Kind, item.Kind, StringComparison.Ordinal))
        {
            return Invalid("kind cannot change after an item is created.");
        }

        if (!string.IsNullOrEmpty(options.Fields.OutletId)
            && !(Guid.TryParse(options.Fields.OutletId, out var outletId) && outletId == item.OutletId))
        {
            return Invalid("A published item cannot move to another outlet (its permalink is fixed).");
        }

        var silent = options.Kind == ChannelVocabulary.RevisionSilentRewrite;
        string? note = null;
        if (!silent && WhyNoteInvalid(options.Note, out note) is { } noteError)
        {
            return Invalid(noteError);
        }

        var prepared = await PrepareAsync(
            options.Fields, descriptor, caller, item, ChannelVocabulary.StatusPublished, exerciseId, cancellationToken);
        if (prepared.Errors.Count > 0)
        {
            return Invalid([.. prepared.Errors]);
        }

        var time = await ClockAsync(exerciseId, cancellationToken);

        // update/correction add the participant-visible marker; silent_rewrite never does (NWS-013, D3-P4); and a
        // payload-only revise (touchUpdatedStamp: false, news FU-2) moves nothing participant-visible at all.
        var visible = !silent && options.TouchUpdatedStamp;
        await AddRevisionAsync(item, options.Kind, note, visible, caller, time, cancellationToken);
        if (options.TouchUpdatedStamp)
        {
            item.UpdatedScenarioTime = time.ScenarioTime;
        }

        await ReplaceMediaAsync(item, prepared.Fields!, time, cancellationToken);
        ApplyFields(item, prepared.Fields!);
        item.Version++;
        _db.TelemetryEvents.Add(ContentTelemetry.Build(ContentTransitions.Revise, item, caller, time, revisionKind: options.Kind));

        if (await TrySaveAsync(item.Id, cancellationToken) is { } conflict)
        {
            return conflict;
        }

        await BroadcastRevisedAsync(item);
        await NotifyAsync(item, ObserverEvent.Revised);
        return await OkAsync(item, warnings: null);
    }

    /// <inheritdoc />
    public async Task<ContentPublishResult> SoftDeleteAsync(Guid id, ContentCaller caller, CancellationToken cancellationToken = default)
    {
        caller = NormalizeCaller(caller);

        var load = await LoadForActionAsync(id, DeleteAction, caller, cancellationToken);
        if (load.Refusal is { } refusal)
        {
            return refusal;
        }

        var item = load.Item!;
        var wasPublished = item.Status == ChannelVocabulary.StatusPublished;
        var time = await ClockAsync(load.ExerciseId, cancellationToken);

        // XC-010: a soft delete only stamps DeletedAt; the revisions (and the status) are kept.
        item.DeletedAt = time.WallClock;
        item.Version++;
        _db.TelemetryEvents.Add(ContentTelemetry.Build(DeleteAction, item, caller, time));

        if (await TrySaveAsync(item.Id, cancellationToken) is { } conflict)
        {
            return conflict;
        }

        if (wasPublished)
        {
            await BroadcastRetractedAsync(item, time.ScenarioTime);
            await NotifyAsync(item, ObserverEvent.Retracted);
        }

        return await OkAsync(item, warnings: null);
    }

    /// <summary>The server-resolved scope, or null (fail closed).</summary>
    private Guid? Scope() =>
        _exerciseContext.CurrentExerciseId is { } scope && scope != Guid.Empty ? scope : null;

    /// <summary>Only an inject caller carries an inject id.</summary>
    private static ContentCaller NormalizeCaller(ContentCaller caller)
    {
        ArgumentNullException.ThrowIfNull(caller);
        return caller.Origin == ChannelVocabulary.OriginInject || caller.InjectId is null ? caller : caller with { InjectId = null };
    }

    private static string? WhyCallerInvalid(ContentCaller caller)
    {
        if (!ChannelVocabulary.ContentOrigins.Contains(caller.Origin, StringComparer.Ordinal))
        {
            return "origin must be one of controller, participant, engine, inject.";
        }

        if (string.IsNullOrWhiteSpace(caller.ActingHumanId) || caller.ActingHumanId.Length > ContentItem.MaxActingHumanIdLength)
        {
            return "The caller's acting human is required (COR-018).";
        }

        if (caller.Origin == ChannelVocabulary.OriginInject && (caller.InjectId is null || caller.InjectId == Guid.Empty))
        {
            return "injectId is required when origin is 'inject'.";
        }

        return null;
    }

    private IContentKindDescriptor? Descriptor(string? kind) =>
        _descriptors.FirstOrDefault(descriptor => string.Equals(descriptor.Kind, kind, StringComparison.Ordinal));

    private static string UnknownKindMessage(string? kind) => $"'{kind}' is not a registered content kind.";

    /// <summary>
    /// Loads the item for <paramref name="action"/> and applies every refusal that needs no field validation: scope,
    /// caller, existence (identical 404 for unknown / cross-exercise / deleted), the engine rules, the FC-1 table and
    /// the kind's registration.
    /// </summary>
    private async Task<LoadResult> LoadForActionAsync(
        Guid id, string action, ContentCaller caller, CancellationToken cancellationToken)
    {
        if (Scope() is not { } exerciseId)
        {
            return new LoadResult(NotFound());
        }

        if (WhyCallerInvalid(caller) is { } callerError)
        {
            return new LoadResult(Invalid(callerError));
        }

        // The central filter already scopes this read; the explicit predicate restates it at the call site.
        var item = await _db.ContentItems
            .FirstOrDefaultAsync(candidate => candidate.Id == id && candidate.ExerciseId == exerciseId, cancellationToken);
        if (item is null)
        {
            return new LoadResult(NotFound());
        }

        // NWS-022: the engine only drafts; an engine draft goes live only through a staff-attributed call.
        if (caller.Origin == ChannelVocabulary.OriginEngine && action is not ContentTransitions.Edit)
        {
            return new LoadResult(Invalid(EngineDraftOnlyMessage));
        }

        if (item.Origin == ChannelVocabulary.OriginEngine
            && action is ContentTransitions.Publish or ContentTransitions.Schedule or ContentTransitions.Restore
            && caller.Origin is not (ChannelVocabulary.OriginController or ChannelVocabulary.OriginInject))
        {
            return new LoadResult(Invalid(EngineItemNeedsStaffMessage));
        }

        if (action != DeleteAction && ContentTransitions.TargetOf(action, item.Status) is null)
        {
            return new LoadResult(await ConflictAsync(item, ContentTransitions.IllegalMessage(action, item.Status)));
        }

        var descriptor = Descriptor(item.Kind);
        if (descriptor is null
            && action is ContentTransitions.Edit or ContentTransitions.Publish or ContentTransitions.Schedule or ContentTransitions.Revise)
        {
            return new LoadResult(Invalid(UnknownKindMessage(item.Kind)));
        }

        return new LoadResult(null, item, descriptor, exerciseId);
    }

    /// <summary>The one clock read an action shares: <c>IExerciseClock ?? exercise.CurrentScenarioTime ?? now</c> (COR-053).</summary>
    private async Task<ContentEventTime> ClockAsync(Guid exerciseId, CancellationToken cancellationToken)
    {
        var now = _time.GetUtcNow();

        // org-scope-exempt(ResolvedScope): exerciseId comes from IExerciseContext (Scope()) and is never a request field;
        // it only supplies the scenario-time fallback and the telemetry time zone.
        var exercise = await _db.Exercises
            .AsNoTracking()
            .Where(candidate => candidate.Id == exerciseId)
            .Select(candidate => new { candidate.CurrentScenarioTime, candidate.TimeZone })
            .FirstOrDefaultAsync(cancellationToken);

        var scenarioTime = _clock?.CurrentScenarioTime(exerciseId) ?? exercise?.CurrentScenarioTime ?? now;
        var timeZone = string.IsNullOrWhiteSpace(exercise?.TimeZone) ? FallbackTimeZone : exercise.TimeZone;
        return new ContentEventTime(now, scenarioTime, timeZone);
    }

    /// <summary>
    /// Runs every gate in registration order; the first <c>Hold</c> wins and nothing changes (409 <c>held</c>). When all
    /// allow, their audit notes are joined, in order, for <c>payload.gateNote</c>.
    /// </summary>
    private async Task<(ContentPublishResult? Held, string? Note)> EvaluateGatesAsync(
        ContentItem item, string action, ContentCaller caller, CancellationToken cancellationToken)
    {
        var context = new PublishContext { Action = action, Origin = caller.Origin, ActingHumanId = caller.ActingHumanId };
        var notes = new List<string>();
        foreach (var gate in _gates)
        {
            var decision = await gate.EvaluateAsync(item, context, cancellationToken);
            if (!decision.Allowed)
            {
                return (new ContentPublishResult
                {
                    Outcome = ContentPublishOutcome.Held,
                    Item = await _projector.ToStaffAsync(item, cancellationToken),
                    Errors = [decision.Reason ?? "The publish is held."],
                }, null);
            }

            if (!string.IsNullOrWhiteSpace(decision.AuditNote))
            {
                notes.Add(decision.AuditNote);
            }
        }

        return (null, notes.Count == 0 ? null : string.Join("; ", notes));
    }

    /// <summary>
    /// Saves; on a lost race (the version token, or a unique index such as the slug) clears the unit of work and answers
    /// the 409 with the item as it is now. Null when the save committed.
    /// </summary>
    private async Task<ContentPublishResult?> TrySaveAsync(Guid itemId, CancellationToken cancellationToken)
    {
        try
        {
            await _db.SaveChangesAsync(cancellationToken);
            return null;
        }
        catch (DbUpdateConcurrencyException)
        {
            return await ConflictAfterLostRaceAsync(itemId, StaleVersionMessage, cancellationToken);
        }
        catch (DbUpdateException)
        {
            return await ConflictAfterLostRaceAsync(
                itemId, "The item conflicts with another (its slug or external reference is taken). Try again.", cancellationToken);
        }
    }

    private async Task<ContentPublishResult> ConflictAfterLostRaceAsync(Guid itemId, string message, CancellationToken cancellationToken)
    {
        _db.ChangeTracker.Clear();
        var current = await _db.ContentItems.AsNoTracking().FirstOrDefaultAsync(item => item.Id == itemId, cancellationToken);
        return new ContentPublishResult
        {
            Outcome = ContentPublishOutcome.Conflict,
            Item = current is null ? null : await _projector.ToStaffAsync(current, cancellationToken),
            Errors = [message],
        };
    }

    private async Task<ContentPublishResult> ConflictAsync(ContentItem item, string message) => new()
    {
        Outcome = ContentPublishOutcome.Conflict,
        Item = await _projector.ToStaffAsync(item, CancellationToken.None),
        Errors = [message],
    };

    private static ContentPublishResult NotFound() =>
        new() { Outcome = ContentPublishOutcome.NotFound, Errors = [NotFoundMessage] };

    private static ContentPublishResult Invalid(params string[] errors) =>
        new() { Outcome = ContentPublishOutcome.Invalid, Errors = errors };

    /// <summary>The committed result. The item has committed, so a projection fault is logged, never surfaced.</summary>
    private async Task<ContentPublishResult> OkAsync(ContentItem item, IReadOnlyList<string>? warnings)
    {
        ChannelContentStaffDto? view = null;
        try
        {
            view = await _projector.ToStaffAsync(item, CancellationToken.None);
        }
#pragma warning disable CA1031 // A projection fault must never turn a committed change into a failed call.
        catch (Exception ex)
        {
            LogProjectionFailed(ex, item.Id);
        }
#pragma warning restore CA1031

        return new ContentPublishResult
        {
            Outcome = ContentPublishOutcome.Ok,
            Item = view,
            SideEffectWarnings = warnings is { Count: > 0 } ? warnings : null,
        };
    }

    private sealed record LoadResult(
        ContentPublishResult? Refusal,
        ContentItem? Item = null,
        IContentKindDescriptor? Descriptor = null,
        Guid ExerciseId = default);
}
