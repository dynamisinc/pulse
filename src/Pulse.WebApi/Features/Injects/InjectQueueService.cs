namespace Pulse.WebApi.Features.Injects;

using System.Collections.Generic;
using System.Linq;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Social;

/// <summary>
/// The server-side scripted-post queue (inject-queue story 06; CTL-010 lite, CTL-011, CTL-014 lite): authoring,
/// reading, the controller state machine, and publishing through the ONE ingest funnel. Scoped, matching the
/// <see cref="PulseDbContext"/> unit of work it writes through; the background <see cref="InjectBurstRunner"/>
/// resolves it inside a per-exercise scope it creates itself.
/// </summary>
/// <remarks>
/// <para>
/// <b>Scope and identity are server-authoritative (COR-001, COR-018).</b> The exercise comes only from
/// <see cref="IExerciseContext"/> and the acting human only from <see cref="ICurrentStaffSessionAccessor"/>; no
/// request carries either, and every read and write goes through the central exercise filter and write guard. An id
/// from another exercise therefore reads exactly like an unknown id.
/// </para>
/// <para>
/// <b>Exactly once (IQ-9).</b> Every state change bumps <see cref="InjectItem.Version"/> (an EF concurrency token) in
/// the same <c>SaveChanges</c>. Publishing is claim → ingest → record: the claim is SAVED before the funnel is called,
/// so a concurrent second fire loses at the claim (<c>409</c>) and never reaches the funnel; the outcome is recorded
/// afterwards, retrying on a concurrency conflict so a controller's hold mid-publish can never erase a post that went
/// out. A claim that outlives <see cref="InjectBurstPlanner.ClaimLease"/> (a crash between claim and record) is
/// reconciled against the posts table before anything is published again, so a restart never double-posts.
/// </para>
/// <para>
/// <b>Nothing is marked fired that the funnel did not create.</b> A refusal records <c>failed</c> with the funnel's
/// message; an exception records <c>failed</c> unless the post provably exists.
/// </para>
/// <para>
/// <b>Telemetry (IQ-8).</b> Exactly one <c>inject_action</c> event per controller action, in the same
/// <c>SaveChanges</c> as the state change it describes (for a fire, the save that records the outcome). The posts the
/// queue publishes get their own <c>post</c> event from the funnel. Runner-paced posts emit no action event: they are
/// not a controller action, and their own <c>post</c> event (with <c>origin: inject</c> + <c>injectId</c>) records them.
/// </para>
/// </remarks>
public sealed partial class InjectQueueService
{
    /// <summary>The readable refusal for fire/retry under FREEZE (IQ-5).</summary>
    public const string FrozenMessage = "The world is frozen. Resume the exercise before firing.";

    /// <summary>The readable refusal for a stale <c>version</c>.</summary>
    public const string StaleVersionMessage = "Changed by someone else. Refresh to see the latest version.";

    private const string FallbackTimeZone = "UTC";
    private const int MaxRecordAttempts = 5;
    private const int MaxErrorLength = 1000;

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentStaffSessionAccessor _staffSession;
    private readonly IExerciseClock _exerciseClock;
    private readonly PauseTierRegistry _pauseTiers;
    private readonly IInjectPostPublisher _publisher;
    private readonly IBurstJitterSource _jitter;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<InjectQueueService> _logger;

    /// <summary>Creates the queue service over its persistence, scope, identity, clock, pause and funnel collaborators.</summary>
    /// <param name="dbContext">The exercise-scoped persistence context.</param>
    /// <param name="exerciseContext">The server-authoritative exercise scope (COR-001).</param>
    /// <param name="staffSession">The server-side staff session — the only source of the acting human (COR-018).</param>
    /// <param name="exerciseClock">The native per-exercise scenario clock (COR-050/053).</param>
    /// <param name="pauseTiers">The in-memory tiered-pause state (IQ-5).</param>
    /// <param name="publisher">The one post ingest funnel (IQ-2), behind its publish seam.</param>
    /// <param name="jitter">The burst jitter source (IQ-4).</param>
    /// <param name="timeProvider">The server wall clock.</param>
    /// <param name="logger">Diagnostics logger.</param>
    public InjectQueueService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ICurrentStaffSessionAccessor staffSession,
        IExerciseClock exerciseClock,
        PauseTierRegistry pauseTiers,
        IInjectPostPublisher publisher,
        IBurstJitterSource jitter,
        TimeProvider timeProvider,
        ILogger<InjectQueueService> logger)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(staffSession);
        ArgumentNullException.ThrowIfNull(exerciseClock);
        ArgumentNullException.ThrowIfNull(pauseTiers);
        ArgumentNullException.ThrowIfNull(publisher);
        ArgumentNullException.ThrowIfNull(jitter);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(logger);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _staffSession = staffSession;
        _exerciseClock = exerciseClock;
        _pauseTiers = pauseTiers;
        _publisher = publisher;
        _jitter = jitter;
        _timeProvider = timeProvider;
        _logger = logger;
    }

    // ---- reads ---------------------------------------------------------------------------------------

    /// <summary><c>GET /api/injects</c>: the live items in queue order, with every child's status, plus the pause tier.</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The queue, or the fail-closed result.</returns>
    public async Task<InjectResult<InjectQueueDto>> GetQueueAsync(CancellationToken cancellationToken = default)
    {
        var caller = await ResolveCallerAsync(cancellationToken);
        if (caller is null)
        {
            return InjectResult.ScopeUnresolved<InjectQueueDto>();
        }

        return InjectResult.Ok(await BuildQueueAsync(caller.ExerciseId, cancellationToken));
    }

    /// <summary><c>GET /api/injects/assignees</c>: the staff assigned to the active exercise, plus the caller's id.</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The roster, or the fail-closed result.</returns>
    public async Task<InjectResult<InjectAssigneesDto>> GetAssigneesAsync(CancellationToken cancellationToken = default)
    {
        var caller = await ResolveCallerAsync(cancellationToken);
        if (caller is null)
        {
            return InjectResult.ScopeUnresolved<InjectAssigneesDto>();
        }

        var facts = await ReadExerciseFactsAsync(caller.ExerciseId, cancellationToken);
        var roster = await ReadRosterAsync(caller.ExerciseId, facts.OrganizationId, cancellationToken);

        return InjectResult.Ok(new InjectAssigneesDto
        {
            Me = caller.StaffUserId.ToString(),
            Assignees = roster
                .Select(entry => new InjectAssigneeDto
                {
                    Id = entry.StaffUserId.ToString(),
                    DisplayName = entry.DisplayName,
                    Role = entry.Role,
                })
                .ToList(),
        });
    }

    // ---- authoring -----------------------------------------------------------------------------------

    /// <summary><c>POST /api/injects</c>: validates and creates a <c>pending</c> item at the end of the queue.</summary>
    /// <param name="request">The untrusted write body.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The created item, a validation failure, or the fail-closed result.</returns>
    public async Task<InjectResult<InjectItemDto>> CreateAsync(
        InjectItemWriteRequest? request,
        CancellationToken cancellationToken = default)
    {
        var caller = await ResolveCallerAsync(cancellationToken);
        if (caller is null)
        {
            return InjectResult.ScopeUnresolved<InjectItemDto>();
        }

        var parse = InjectItemValidator.Parse(request);
        if (parse.Draft is not { } draft)
        {
            return InjectResult.Invalid<InjectItemDto>(parse.Error!);
        }

        var facts = await ReadExerciseFactsAsync(caller.ExerciseId, cancellationToken);
        var referenceError = await CheckReferencesAsync(draft, caller.ExerciseId, facts, editedItem: null, cancellationToken);
        if (referenceError is not null)
        {
            return InjectResult.Invalid<InjectItemDto>(referenceError);
        }

        var time = TimeFor(caller.ExerciseId, facts);
        var lastOrder = await LiveItems(caller.ExerciseId).MaxAsync(item => (int?)item.Order, cancellationToken) ?? 0;

        var item = new InjectItem
        {
            Id = Guid.NewGuid(),
            ExerciseId = caller.ExerciseId,
            Kind = draft.Kind,
            Title = draft.Title,
            Status = InjectStatuses.Pending,
            Order = lastOrder + 1,
            Version = 1,
            CreatedByHumanId = caller.StaffUserId,
            CreatedAt = time.WallClock,
            UpdatedAt = time.WallClock,
        };
        ApplyItemFields(item, draft);
        ApplyChildren(item, draft, time.WallClock);

        _dbContext.InjectItems.Add(item);
        _dbContext.TelemetryEvents.Add(InjectTelemetry.ForItem(item, InjectActions.Create, caller.StaffUserId, time));
        await _dbContext.SaveChangesAsync(cancellationToken);

        return InjectResult.Created(await ProjectAsync(item, facts, cancellationToken));
    }

    /// <summary>
    /// <c>PUT /api/injects/{id}</c>: replaces an item's content while it is <c>pending</c>, <c>held</c> or <c>failed</c>
    /// and no post is in flight. The body's <c>version</c> must match (IQ-9). A child that echoes the <c>id</c> of an
    /// existing child keeps its identity (id, status, published post, and the replies pointing at it); a child without
    /// an <c>id</c> is new; an existing child not echoed is removed (soft-deleted). Posts that already went out must be
    /// echoed unchanged — a published post is corrected with a takedown, never by rewriting the record (<c>409</c>).
    /// </summary>
    /// <param name="itemId">The item id.</param>
    /// <param name="request">The untrusted write body, including <c>version</c>.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The edited item, or the refusal.</returns>
    public async Task<InjectResult<InjectItemDto>> UpdateAsync(
        Guid itemId,
        InjectItemWriteRequest? request,
        CancellationToken cancellationToken = default)
    {
        var caller = await ResolveCallerAsync(cancellationToken);
        if (caller is null)
        {
            return InjectResult.ScopeUnresolved<InjectItemDto>();
        }

        var item = await LoadItemAsync(itemId, caller.ExerciseId, cancellationToken);
        if (item is null)
        {
            return InjectResult.NotFound<InjectItemDto>();
        }

        var parse = InjectItemValidator.Parse(request);
        if (parse.Draft is not { } draft)
        {
            return InjectResult.Invalid<InjectItemDto>(parse.Error!);
        }

        if (request!.Version is not { } version)
        {
            return InjectResult.Invalid<InjectItemDto>("version is required.");
        }

        var facts = await ReadExerciseFactsAsync(caller.ExerciseId, cancellationToken);
        if (version != item.Version)
        {
            return InjectResult.Conflict<InjectItemDto>(StaleVersionMessage, await ProjectAsync(item, facts, cancellationToken));
        }

        if (InjectTransitions.WhyNotEditable(item) is { } notEditable)
        {
            return InjectResult.Conflict<InjectItemDto>(notEditable, await ProjectAsync(item, facts, cancellationToken));
        }

        var referenceError = await CheckReferencesAsync(draft, caller.ExerciseId, facts, item, cancellationToken);
        if (referenceError is not null)
        {
            return InjectResult.Invalid<InjectItemDto>(referenceError);
        }

        if (InjectTransitions.WhyEditWouldRewriteHistory(item, draft) is { } rewritesHistory)
        {
            return InjectResult.Conflict<InjectItemDto>(rewritesHistory, await ProjectAsync(item, facts, cancellationToken));
        }

        var time = TimeFor(caller.ExerciseId, facts);
        ApplyItemFields(item, draft);
        ApplyChildren(item, draft, time.WallClock);

        return await SaveActionAsync(item, InjectActions.Edit, caller, facts, time, cancellationToken);
    }

    /// <summary>
    /// <c>DELETE /api/injects/{id}?version=n</c>: soft-deletes (XC-010) an item that is <c>pending</c>, <c>held</c>,
    /// <c>skipped</c> or <c>failed</c>. A <c>firing</c> or <c>fired</c> item cannot be deleted.
    /// </summary>
    /// <param name="itemId">The item id.</param>
    /// <param name="version">The version the caller last read.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The deleted result, or the refusal.</returns>
    public async Task<InjectResult<InjectItemDto>> DeleteAsync(
        Guid itemId,
        int? version,
        CancellationToken cancellationToken = default)
    {
        var caller = await ResolveCallerAsync(cancellationToken);
        if (caller is null)
        {
            return InjectResult.ScopeUnresolved<InjectItemDto>();
        }

        if (version is null)
        {
            return InjectResult.Invalid<InjectItemDto>("version is required.");
        }

        var item = await LoadItemAsync(itemId, caller.ExerciseId, cancellationToken);
        if (item is null)
        {
            return InjectResult.NotFound<InjectItemDto>();
        }

        var facts = await ReadExerciseFactsAsync(caller.ExerciseId, cancellationToken);
        if (version != item.Version)
        {
            return InjectResult.Conflict<InjectItemDto>(StaleVersionMessage, await ProjectAsync(item, facts, cancellationToken));
        }

        if (InjectTransitions.WhyNotDeletable(item) is { } notDeletable)
        {
            return InjectResult.Conflict<InjectItemDto>(notDeletable, await ProjectAsync(item, facts, cancellationToken));
        }

        var time = TimeFor(caller.ExerciseId, facts);
        item.DeletedAt = time.WallClock;

        return await TrySaveAsync(item, InjectActions.Delete, caller.StaffUserId, time, cancellationToken)
            ? InjectResult.Deleted<InjectItemDto>()
            : await ConflictWithCurrentAsync(itemId, caller.ExerciseId, facts, cancellationToken);
    }

    /// <summary>
    /// <c>POST /api/injects/reorder</c>: sets the queue order. <c>ids</c> must name every live item exactly once.
    /// Order is presentation, not item state, so it does not bump any item's version (an editor's version stays valid).
    /// </summary>
    /// <param name="request">The untrusted reorder body.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The reordered queue, or the refusal.</returns>
    public async Task<InjectResult<InjectQueueDto>> ReorderAsync(
        InjectReorderRequest? request,
        CancellationToken cancellationToken = default)
    {
        var caller = await ResolveCallerAsync(cancellationToken);
        if (caller is null)
        {
            return InjectResult.ScopeUnresolved<InjectQueueDto>();
        }

        const string FullListMessage = "ids must list every item in the queue exactly once.";
        if (request?.Ids is not { } rawIds)
        {
            return InjectResult.Invalid<InjectQueueDto>(FullListMessage);
        }

        var ids = new List<Guid>(rawIds.Count);
        foreach (var raw in rawIds)
        {
            if (!Guid.TryParse(raw, out var id))
            {
                return InjectResult.Invalid<InjectQueueDto>(FullListMessage);
            }

            ids.Add(id);
        }

        var items = await LiveItems(caller.ExerciseId).ToListAsync(cancellationToken);
        var byId = items.ToDictionary(item => item.Id);
        if (ids.Count != items.Count || ids.Distinct().Count() != ids.Count || ids.Any(id => !byId.ContainsKey(id)))
        {
            return InjectResult.Invalid<InjectQueueDto>(FullListMessage);
        }

        for (var index = 0; index < ids.Count; index++)
        {
            byId[ids[index]].Order = index + 1;
        }

        var facts = await ReadExerciseFactsAsync(caller.ExerciseId, cancellationToken);
        var time = TimeFor(caller.ExerciseId, facts);
        _dbContext.TelemetryEvents.Add(InjectTelemetry.ForReorder(caller.ExerciseId, caller.StaffUserId, time));

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            _dbContext.ChangeTracker.Clear();
            return InjectResult.Conflict<InjectQueueDto>(
                "The queue changed while you were reordering. Refresh and try again.", null);
        }

        return InjectResult.Ok(await BuildQueueAsync(caller.ExerciseId, cancellationToken));
    }

    // ---- the controller state machine ----------------------------------------------------------------

    /// <summary><c>POST /api/injects/{id}/hold</c>: <c>pending → held</c>, or <c>firing → held</c> for a burst.</summary>
    /// <param name="itemId">The item id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The item, or the refusal.</returns>
    public Task<InjectResult<InjectItemDto>> HoldAsync(Guid itemId, CancellationToken cancellationToken = default) =>
        TransitionAsync(itemId, InjectActions.Hold, (item, _) => InjectTransitions.Hold(item), cancellationToken);

    /// <summary><c>POST /api/injects/{id}/release</c>: <c>held → pending</c>, or <c>held → firing</c> for a started burst.</summary>
    /// <param name="itemId">The item id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The item, or the refusal.</returns>
    public Task<InjectResult<InjectItemDto>> ReleaseAsync(Guid itemId, CancellationToken cancellationToken = default) =>
        TransitionAsync(
            itemId,
            InjectActions.Release,
            (item, caller) => InjectTransitions.Release(item, caller.StaffUserId),
            cancellationToken);

    /// <summary><c>POST /api/injects/{id}/skip</c>: <c>pending|held → skipped</c>; remaining posts are skipped.</summary>
    /// <param name="itemId">The item id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The item, or the refusal.</returns>
    public Task<InjectResult<InjectItemDto>> SkipAsync(Guid itemId, CancellationToken cancellationToken = default) =>
        TransitionAsync(itemId, InjectActions.Skip, (item, _) => InjectTransitions.Skip(item), cancellationToken);

    /// <summary><c>POST /api/injects/{id}/unskip</c>: <c>skipped → pending</c>, or <c>→ held</c> when anything went out.</summary>
    /// <param name="itemId">The item id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The item, or the refusal.</returns>
    public Task<InjectResult<InjectItemDto>> UnskipAsync(Guid itemId, CancellationToken cancellationToken = default) =>
        TransitionAsync(itemId, InjectActions.Unskip, (item, _) => InjectTransitions.Unskip(item), cancellationToken);

    /// <summary>
    /// <c>POST /api/injects/{id}/fire</c>: publishes through the funnel. A <c>post</c> publishes now and moves to
    /// <c>fired</c> (or <c>failed</c>, with the funnel's message). A fresh <c>burst</c> computes its jittered pacing,
    /// publishes its first post now and moves to <c>firing</c>; the runner publishes the rest. A held burst that had
    /// already started is released with its next post due now. Refused under FREEZE (IQ-5) — but not under PAUSE
    /// INJECTS, which only suspends the runner.
    /// </summary>
    /// <param name="itemId">The item id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The item after the fire, or the refusal.</returns>
    public async Task<InjectResult<InjectItemDto>> FireAsync(Guid itemId, CancellationToken cancellationToken = default)
    {
        var caller = await ResolveCallerAsync(cancellationToken);
        if (caller is null)
        {
            return InjectResult.ScopeUnresolved<InjectItemDto>();
        }

        var item = await LoadItemAsync(itemId, caller.ExerciseId, cancellationToken);
        if (item is null)
        {
            return InjectResult.NotFound<InjectItemDto>();
        }

        var facts = await ReadExerciseFactsAsync(caller.ExerciseId, cancellationToken);
        var refusal = IsFrozen(caller.ExerciseId) ? FrozenMessage : InjectTransitions.WhyNotFireable(item);
        if (refusal is not null)
        {
            return InjectResult.Conflict<InjectItemDto>(refusal, await ProjectAsync(item, facts, cancellationToken));
        }

        var parents = await ReadExternalParentsAsync(item, cancellationToken);
        if (item.Kind == InjectKinds.Post && ParentRefusal(item, parents) is { } parentRefusal)
        {
            return InjectResult.Conflict<InjectItemDto>(parentRefusal, await ProjectAsync(item, facts, cancellationToken));
        }

        var time = TimeFor(caller.ExerciseId, facts);
        var children = InjectTransitions.LiveChildren(item);

        if (!InjectTransitions.HasStarted(item))
        {
            // First release: anchor the pacing, record who pressed Fire, and lay out the jittered offsets (IQ-4).
            item.ReleasedAt = time.WallClock;
            item.ShiftSeconds = 0;
            item.FiredByHumanId = caller.StaffUserId;
            item.FiredScenarioTime = time.ScenarioTime;

            var offsets = item.Kind == InjectKinds.Burst
                ? InjectBurstPacing.ComputeOffsets(
                    children.Count,
                    item.BurstWindowSeconds ?? InjectItemValidator.DefaultBurstWindowSeconds,
                    _jitter)
                : Enumerable.Repeat(0, children.Count).ToList();
            for (var index = 0; index < children.Count; index++)
            {
                children[index].DueOffsetSeconds = offsets[index];
            }
        }
        else if (children.FirstOrDefault(post => post.Status == InjectPostStatuses.Pending) is { } next)
        {
            // A held burst that had started: Fire is "release, and go now" — the next post is due immediately and
            // the rest keep their spacing behind it.
            item.ShiftSeconds = InjectBurstPlanner.ShiftToMakeDueNow(item, next, time.WallClock);
        }

        item.Status = InjectStatuses.Firing;
        item.DriverHumanId = caller.StaffUserId;

        return await StepForCallerAsync(item, caller, facts, time, parents, InjectActions.Fire, cancellationToken);
    }

    /// <summary>
    /// <c>POST /api/injects/{id}/retry</c>: re-fires a <c>failed</c> item's failed posts. A <c>post</c> publishes now;
    /// a <c>burst</c> returns its failed posts to pending and goes back to <c>firing</c> for the runner. Refused under
    /// FREEZE (IQ-5).
    /// </summary>
    /// <param name="itemId">The item id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The item after the retry, or the refusal.</returns>
    public async Task<InjectResult<InjectItemDto>> RetryAsync(Guid itemId, CancellationToken cancellationToken = default)
    {
        var caller = await ResolveCallerAsync(cancellationToken);
        if (caller is null)
        {
            return InjectResult.ScopeUnresolved<InjectItemDto>();
        }

        var item = await LoadItemAsync(itemId, caller.ExerciseId, cancellationToken);
        if (item is null)
        {
            return InjectResult.NotFound<InjectItemDto>();
        }

        var facts = await ReadExerciseFactsAsync(caller.ExerciseId, cancellationToken);
        var refusal = IsFrozen(caller.ExerciseId) ? FrozenMessage : InjectTransitions.WhyNotRetryable(item);
        if (refusal is not null)
        {
            return InjectResult.Conflict<InjectItemDto>(refusal, await ProjectAsync(item, facts, cancellationToken));
        }

        var parents = await ReadExternalParentsAsync(item, cancellationToken);
        if (item.Kind == InjectKinds.Post && ParentRefusal(item, parents) is { } parentRefusal)
        {
            return InjectResult.Conflict<InjectItemDto>(parentRefusal, await ProjectAsync(item, facts, cancellationToken));
        }

        var time = TimeFor(caller.ExerciseId, facts);
        var failed = InjectTransitions.LiveChildren(item)
            .Where(post => post.Status == InjectPostStatuses.Failed)
            .ToList();
        foreach (var post in failed)
        {
            post.Status = InjectPostStatuses.Pending;
            post.Error = null;
            post.ClaimedAt = null;
        }

        item.Error = null;
        item.Status = InjectStatuses.Firing;
        item.DriverHumanId = caller.StaffUserId;
        item.ReleasedAt ??= time.WallClock;

        if (item.Kind == InjectKinds.Burst)
        {
            // The runner re-publishes the failed posts in order, one per tick, via the lateness rule.
            return await SaveActionAsync(item, InjectActions.Retry, caller, facts, time, cancellationToken);
        }

        if (failed.FirstOrDefault() is { } retried)
        {
            item.ShiftSeconds = InjectBurstPlanner.ShiftToMakeDueNow(item, retried, time.WallClock);
        }

        return await StepForCallerAsync(item, caller, facts, time, parents, InjectActions.Retry, cancellationToken);
    }

    // ---- the runner's entry point --------------------------------------------------------------------

    /// <summary>
    /// The <see cref="InjectBurstRunner"/>'s per-item step: publishes at most ONE due post of a <c>firing</c> item in
    /// the resolved scope. Does nothing under PAUSE INJECTS or FREEZE, for a held/settled item, or when the next post
    /// is not due — the lateness rule (IQ-4) then keeps the remainder's spacing when it resumes. A concurrent writer
    /// winning the claim simply means this tick does nothing.
    /// </summary>
    /// <param name="itemId">The firing item to advance.</param>
    /// <param name="cancellationToken">Cancellation token (honoured only before a claim is saved).</param>
    /// <returns>A task that completes when the step is done.</returns>
    public async Task AdvanceAsync(Guid itemId, CancellationToken cancellationToken = default)
    {
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return;
        }

        var exerciseId = scope.Value;
        if (_pauseTiers.GetTier(exerciseId) is PauseTier.Injects or PauseTier.Freeze)
        {
            return;
        }

        var item = await LoadItemAsync(itemId, exerciseId, cancellationToken);
        if (item is null || item.Status != InjectStatuses.Firing)
        {
            return;
        }

        var facts = await ReadExerciseFactsAsync(exerciseId, cancellationToken);
        var time = TimeFor(exerciseId, facts);
        var parents = await ReadExternalParentsAsync(item, cancellationToken);
        var driver = item.DriverHumanId ?? item.FiredByHumanId ?? item.CreatedByHumanId;

        await StepAsync(item, driver, time, parents, action: null, hasPendingChanges: false, cancellationToken);
    }

    // ---- publishing internals ------------------------------------------------------------------------

    /// <summary>Runs one step for a controller action and maps the outcome to the response.</summary>
    private async Task<InjectResult<InjectItemDto>> StepForCallerAsync(
        InjectItem item,
        Caller caller,
        ExerciseFacts facts,
        InjectEventTime time,
        IReadOnlyDictionary<Guid, Guid?> parents,
        string action,
        CancellationToken cancellationToken)
    {
        var settled = await StepAsync(
            item, caller.StaffUserId, time, parents, action, hasPendingChanges: true, cancellationToken);

        if (settled is null)
        {
            return await ConflictWithCurrentAsync(item.Id, caller.ExerciseId, facts, cancellationToken);
        }

        return InjectResult.Ok(await ProjectAsync(settled, facts, cancellationToken));
    }

    /// <summary>
    /// Runs ONE planner step on a tracked item and persists it. Returns the item as finally saved, or <c>null</c> when
    /// a concurrent writer won (the caller maps that to a <c>409</c>, or the runner skips the tick).
    /// </summary>
    /// <param name="item">The tracked item, possibly carrying unsaved mutations from the caller.</param>
    /// <param name="attributedHuman">The staff user a published post is attributed to (COR-018).</param>
    /// <param name="time">The one clock read for this step.</param>
    /// <param name="parents">The publish state of reply parents in other items.</param>
    /// <param name="action">The controller action to record (<c>null</c> for a runner step).</param>
    /// <param name="hasPendingChanges">Whether the caller mutated the item, so even a waiting step must be saved.</param>
    /// <param name="cancellationToken">Cancellation token — honoured only up to the claim.</param>
    private async Task<InjectItem?> StepAsync(
        InjectItem item,
        Guid attributedHuman,
        InjectEventTime time,
        IReadOnlyDictionary<Guid, Guid?> parents,
        string? action,
        bool hasPendingChanges,
        CancellationToken cancellationToken)
    {
        var step = InjectBurstPlanner.Next(item, time.WallClock, parents);

        switch (step.Kind)
        {
            case InjectStepKind.Wait when !hasPendingChanges:
                return item;

            case InjectStepKind.Wait:
                return await TrySaveAsync(item, action, attributedHuman, time, cancellationToken) ? item : null;

            case InjectStepKind.Complete:
                InjectTransitions.Settle(item);
                return await TrySaveAsync(item, action, attributedHuman, time, cancellationToken) ? item : null;

            case InjectStepKind.Fail:
                var failed = step.Child!;
                failed.Status = InjectPostStatuses.Failed;
                failed.Error = Truncate(step.Error);
                item.ShiftSeconds += step.LatenessSeconds;
                InjectTransitions.Settle(item);
                return await TrySaveAsync(item, action, attributedHuman, time, cancellationToken) ? item : null;

            case InjectStepKind.Reconcile:
                return await ReconcileAsync(item, step.Child!, action, attributedHuman, time, cancellationToken);

            case InjectStepKind.Publish:
                // Claim BEFORE calling the funnel: the claim and the lateness shift are saved under the item's
                // version, so a concurrent fire (or a second runner instance) loses here and never publishes.
                var claimed = step.Child!;
                claimed.ClaimedAt = time.WallClock;
                item.ShiftSeconds += step.LatenessSeconds;
                if (!await TrySaveAsync(item, action: null, attributedHuman, time, cancellationToken))
                {
                    return null;
                }

                return await PublishClaimedAsync(item, claimed, step.ParentPostId, attributedHuman, time, action);

            default:
                return item;
        }
    }

    /// <summary>
    /// Calls the funnel for a claimed child and records the outcome. Runs to completion regardless of request
    /// cancellation: once claimed, abandoning the record step would strand a published post outside the queue.
    /// </summary>
    private async Task<InjectItem?> PublishClaimedAsync(
        InjectItem item,
        InjectItemPost child,
        Guid? parentPostId,
        Guid attributedHuman,
        InjectEventTime time,
        string? action)
    {
        var (request, attribution) = InjectPostRequestFactory.Build(item, child, parentPostId, attributedHuman, time);
        var itemId = item.Id;
        var exerciseId = item.ExerciseId;
        var childId = child.Id;

        ChildOutcome outcome;
        try
        {
            var result = await _publisher.PublishAsync(request, attribution, CancellationToken.None);
            outcome = result is { Outcome: PostIngestOutcome.Created, Post: { } post }
                ? ChildOutcome.Published(post, attributedHuman)
                : ChildOutcome.Refused(result.ValidationError ?? "The post could not be published in this exercise.");
        }
#pragma warning disable CA1031 // A funnel fault must be RECORDED (never a silent claim, never a false "fired").
        catch (Exception ex)
        {
            LogPublishFailed(ex, itemId, childId);

            // The failed unit of work may still hold the funnel's unsaved post/telemetry rows: drop them, then ask
            // the database whether the post committed before the fault (e.g. the broadcast threw after the save).
            _dbContext.ChangeTracker.Clear();
            var orphan = await FindUnrecordedPostAsync(itemId, exerciseId, CancellationToken.None);
            outcome = orphan is not null
                ? ChildOutcome.Published(orphan, attributedHuman)
                : ChildOutcome.Refused("Publishing failed unexpectedly. Retry to try again.");
        }
#pragma warning restore CA1031

        return await RecordAsync(itemId, exerciseId, childId, outcome, action, attributedHuman, time);
    }

    /// <summary>
    /// Records a claimed child's outcome and settles the item, retrying on a concurrency conflict (a controller may
    /// hold or skip the item while the post is in flight; the post went out regardless and must be recorded).
    /// </summary>
    private async Task<InjectItem?> RecordAsync(
        Guid itemId,
        Guid exerciseId,
        Guid childId,
        ChildOutcome outcome,
        string? action,
        Guid actingHumanId,
        InjectEventTime time)
    {
        for (var attempt = 1; ; attempt++)
        {
            var item = await LoadItemAsync(itemId, exerciseId, CancellationToken.None);
            var child = item?.Posts.FirstOrDefault(post => post.Id == childId);
            if (item is null || child is null)
            {
                return item;
            }

            outcome.ApplyTo(child);
            child.ClaimedAt = null;
            if (outcome.IsPublished)
            {
                item.LastPublishedAt = time.WallClock;
            }

            InjectTransitions.Settle(item);

            if (await TrySaveAsync(item, action, actingHumanId, time, CancellationToken.None))
            {
                return item;
            }

            if (attempt >= MaxRecordAttempts)
            {
                // Leave the claim in place: once the lease expires the runner reconciles it against the posts table.
                LogRecordAbandoned(itemId, childId);
                return null;
            }
        }
    }

    /// <summary>
    /// Resolves a claim that outlived its lease: if the funnel did create the post, record it as fired; otherwise
    /// drop the claim so the child is published normally on a later step. Never publishes in the same step.
    /// </summary>
    private async Task<InjectItem?> ReconcileAsync(
        InjectItem item,
        InjectItemPost child,
        string? action,
        Guid attributedHuman,
        InjectEventTime time,
        CancellationToken cancellationToken)
    {
        var orphan = await FindUnrecordedPostAsync(item.Id, item.ExerciseId, cancellationToken);
        if (orphan is not null)
        {
            var actor = Guid.TryParse(orphan.ActingHumanId, out var human) ? human : attributedHuman;
            ChildOutcome.Published(orphan, actor).ApplyTo(child);
            item.LastPublishedAt = time.WallClock;
            LogClaimReconciled(item.Id, child.Id, orphan.Id);
        }

        child.ClaimedAt = null;
        InjectTransitions.Settle(item);
        return await TrySaveAsync(item, action, attributedHuman, time, cancellationToken) ? item : null;
    }

    /// <summary>
    /// A post the funnel created for this item that no child has recorded yet — the trace a crash between ingest and
    /// record leaves behind. At most one can exist, because the item's version serializes claims.
    /// </summary>
    private async Task<Post?> FindUnrecordedPostAsync(Guid itemId, Guid exerciseId, CancellationToken cancellationToken)
    {
        var injectId = itemId.ToString();
        var recorded = await _dbContext.InjectItemPosts
            .AsNoTracking()
            .Where(post => post.InjectItemId == itemId && post.ExerciseId == exerciseId && post.FiredPostId != null)
            .Select(post => post.FiredPostId!.Value)
            .ToListAsync(cancellationToken);

        return await _dbContext.Posts
            .AsNoTracking()
            .Where(post => post.ExerciseId == exerciseId && post.InjectId == injectId && !recorded.Contains(post.Id))
            .OrderBy(post => post.CreatedWallClock)
            .FirstOrDefaultAsync(cancellationToken);
    }

    /// <summary>
    /// Bumps the version, stamps the change, attaches the action's event (when there is one) and saves. Returns
    /// <c>false</c> — with the change tracker cleared — when a concurrent writer won.
    /// </summary>
    private async Task<bool> TrySaveAsync(
        InjectItem item,
        string? action,
        Guid actingHumanId,
        InjectEventTime time,
        CancellationToken cancellationToken)
    {
        item.Version++;
        item.UpdatedAt = time.WallClock;
        if (action is not null)
        {
            _dbContext.TelemetryEvents.Add(InjectTelemetry.ForItem(item, action, actingHumanId, time));
        }

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateConcurrencyException)
        {
            _dbContext.ChangeTracker.Clear();
            return false;
        }
    }

    // ---- action plumbing -----------------------------------------------------------------------------

    /// <summary>Loads, applies one pure transition, and saves with its event — or returns the 409/404.</summary>
    private async Task<InjectResult<InjectItemDto>> TransitionAsync(
        Guid itemId,
        string action,
        Func<InjectItem, Caller, string?> apply,
        CancellationToken cancellationToken)
    {
        var caller = await ResolveCallerAsync(cancellationToken);
        if (caller is null)
        {
            return InjectResult.ScopeUnresolved<InjectItemDto>();
        }

        var item = await LoadItemAsync(itemId, caller.ExerciseId, cancellationToken);
        if (item is null)
        {
            return InjectResult.NotFound<InjectItemDto>();
        }

        var facts = await ReadExerciseFactsAsync(caller.ExerciseId, cancellationToken);
        if (apply(item, caller) is { } refusal)
        {
            return InjectResult.Conflict<InjectItemDto>(refusal, await ProjectAsync(item, facts, cancellationToken));
        }

        return await SaveActionAsync(item, action, caller, facts, TimeFor(caller.ExerciseId, facts), cancellationToken);
    }

    /// <summary>Saves a mutated item with its one action event; a lost race is a 409 carrying the current item.</summary>
    private async Task<InjectResult<InjectItemDto>> SaveActionAsync(
        InjectItem item,
        string action,
        Caller caller,
        ExerciseFacts facts,
        InjectEventTime time,
        CancellationToken cancellationToken)
    {
        if (!await TrySaveAsync(item, action, caller.StaffUserId, time, cancellationToken))
        {
            return await ConflictWithCurrentAsync(item.Id, caller.ExerciseId, facts, cancellationToken);
        }

        return InjectResult.Ok(await ProjectAsync(item, facts, cancellationToken));
    }

    /// <summary>The 409 for a lost race: the item as it is now, with the most specific readable reason.</summary>
    private async Task<InjectResult<InjectItemDto>> ConflictWithCurrentAsync(
        Guid itemId,
        Guid exerciseId,
        ExerciseFacts facts,
        CancellationToken cancellationToken)
    {
        _dbContext.ChangeTracker.Clear();
        var current = await LoadItemAsync(itemId, exerciseId, cancellationToken);
        if (current is null)
        {
            return InjectResult.Conflict<InjectItemDto>("This item was deleted by someone else.", null);
        }

        var message = current.Status is InjectStatuses.Firing or InjectStatuses.Fired
            ? InjectTransitions.WhyNotFireable(current)!
            : StaleVersionMessage;
        return InjectResult.Conflict<InjectItemDto>(message, await ProjectAsync(current, facts, cancellationToken));
    }

    /// <summary>
    /// For a single post whose reply parent is another scripted post: the refusal when that parent has not been
    /// published yet ("Fire the parent first"), else <c>null</c>.
    /// </summary>
    private static string? ParentRefusal(InjectItem item, IReadOnlyDictionary<Guid, Guid?> parents)
    {
        var children = InjectTransitions.LiveChildren(item);
        if (children.Count == 0 || children[0].ReplyToInjectPostId is not { } target)
        {
            return null;
        }

        return parents.TryGetValue(target, out var published) && published is not null
            ? null
            : InjectBurstPlanner.ParentNotFiredMessage;
    }

    // ---- reads and projections -----------------------------------------------------------------------

    /// <summary>The live items of the exercise, in queue order (the explicit scope predicate is defense in depth).</summary>
    private IQueryable<InjectItem> LiveItems(Guid exerciseId) =>
        _dbContext.InjectItems
            .Where(item => item.ExerciseId == exerciseId && item.DeletedAt == null)
            .OrderBy(item => item.Order)
            .ThenBy(item => item.CreatedAt)
            .ThenBy(item => item.Id);

    /// <summary>Loads one live item, tracked, with all its children. Another exercise's id reads as missing.</summary>
    private Task<InjectItem?> LoadItemAsync(Guid itemId, Guid exerciseId, CancellationToken cancellationToken) =>
        _dbContext.InjectItems
            .Include(item => item.Posts)
            .Where(item => item.Id == itemId && item.ExerciseId == exerciseId && item.DeletedAt == null)
            .FirstOrDefaultAsync(cancellationToken);

    private async Task<InjectQueueDto> BuildQueueAsync(Guid exerciseId, CancellationToken cancellationToken)
    {
        var items = await LiveItems(exerciseId)
            .AsNoTracking()
            .Include(item => item.Posts)
            .ToListAsync(cancellationToken);

        var facts = await ReadExerciseFactsAsync(exerciseId, cancellationToken);
        var names = await ReadAssigneeNamesAsync(exerciseId, facts, cancellationToken);

        var dtos = items.Select((item, index) => InjectItemDto.From(item, index + 1, names)).ToList();
        return InjectQueueDto.From(dtos, _pauseTiers.GetTier(exerciseId));
    }

    private async Task<InjectItemDto> ProjectAsync(InjectItem item, ExerciseFacts facts, CancellationToken cancellationToken)
    {
        var orderedIds = await LiveItems(item.ExerciseId)
            .AsNoTracking()
            .Select(candidate => candidate.Id)
            .ToListAsync(cancellationToken);
        var position = orderedIds.IndexOf(item.Id);

        var names = await ReadAssigneeNamesAsync(item.ExerciseId, facts, cancellationToken);
        return InjectItemDto.From(item, position >= 0 ? position + 1 : orderedIds.Count + 1, names);
    }

    private async Task<IReadOnlyDictionary<Guid, string>> ReadAssigneeNamesAsync(
        Guid exerciseId,
        ExerciseFacts facts,
        CancellationToken cancellationToken)
    {
        var roster = await ReadRosterAsync(exerciseId, facts.OrganizationId, cancellationToken);
        return roster.ToDictionary(entry => entry.StaffUserId, entry => entry.DisplayName);
    }

    /// <summary>
    /// The staff assigned to the exercise. <see cref="StaffAssignment"/> is deliberately unscoped (a staff human spans
    /// exercises), so the exercise predicate is explicit; the staff rows are bounded by the exercise's own customer
    /// tenant — the same <c>InOrganization</c> bound <c>OrgStaffDirectoryService</c> uses (COR-010).
    /// </summary>
    private async Task<List<RosterEntry>> ReadRosterAsync(
        Guid exerciseId,
        Guid? organizationId,
        CancellationToken cancellationToken)
    {
        var rows = await (
            from assignment in _dbContext.StaffAssignments.AsNoTracking()
            where assignment.ExerciseId == exerciseId
            join staffUser in _dbContext.StaffUsers.AsNoTracking().InOrganization(organizationId)
                on assignment.StaffUserId equals staffUser.Id
            orderby staffUser.DisplayName
            select new RosterEntry(staffUser.Id, staffUser.DisplayName, assignment.Role)).ToListAsync(cancellationToken);

        return rows;
    }

    /// <summary>Resolves every id a draft names, inside the scope, then runs the pure reference checks.</summary>
    private async Task<string?> CheckReferencesAsync(
        InjectItemDraft draft,
        Guid exerciseId,
        ExerciseFacts facts,
        InjectItem? editedItem,
        CancellationToken cancellationToken)
    {
        var personaIds = draft.Posts.Select(post => post.PersonaId).Distinct().ToList();

        // The central filter already confines this read to the resolved scope; the explicit predicate keeps the
        // isolation visible at the call site (the PostAttributionResolver idiom). Another exercise's persona is
        // therefore indistinguishable from one that does not exist.
        var personasInScope = await _dbContext.Personas
            .AsNoTracking()
            .Where(persona => personaIds.Contains(persona.Id) && persona.ExerciseId == exerciseId)
            .Select(persona => persona.Id)
            .ToListAsync(cancellationToken);

        List<RosterEntry> roster = draft.AssigneeId is null
            ? []
            : await ReadRosterAsync(exerciseId, facts.OrganizationId, cancellationToken);

        var targets = draft.Posts
            .Select(post => post.ReplyToInjectPostId)
            .OfType<Guid>()
            .Distinct()
            .ToList();
        var replyTargets = targets.Count == 0
            ? new Dictionary<Guid, Guid>()
            : await (
                from post in _dbContext.InjectItemPosts.AsNoTracking()
                join item in _dbContext.InjectItems.AsNoTracking() on post.InjectItemId equals item.Id
                where targets.Contains(post.Id)
                    && post.ExerciseId == exerciseId
                    && post.DeletedAt == null
                    && item.DeletedAt == null
                select new { post.Id, post.InjectItemId }).ToDictionaryAsync(
                    row => row.Id, row => row.InjectItemId, cancellationToken);

        var referenceFacts = new InjectReferenceFacts(
            personasInScope.ToHashSet(),
            roster.Select(entry => entry.StaffUserId).ToHashSet(),
            replyTargets,
            editedItem?.Id,
            editedItem is null ? [] : InjectTransitions.LiveChildren(editedItem).Select(post => post.Id).ToHashSet());

        return InjectItemValidator.CheckReferences(draft, referenceFacts);
    }

    /// <summary>
    /// For each pending child's scripted reply target in ANOTHER item: its published post id, or <c>null</c> when it
    /// has not fired. Read in scope, so a target in another exercise is simply absent (unpublished).
    /// </summary>
    private async Task<IReadOnlyDictionary<Guid, Guid?>> ReadExternalParentsAsync(
        InjectItem item,
        CancellationToken cancellationToken)
    {
        var siblings = item.Posts.Select(post => post.Id).ToHashSet();
        var targets = InjectTransitions.LiveChildren(item)
            .Where(post => post.Status is InjectPostStatuses.Pending or InjectPostStatuses.Failed)
            .Select(post => post.ReplyToInjectPostId)
            .OfType<Guid>()
            .Where(target => !siblings.Contains(target))
            .Distinct()
            .ToList();

        if (targets.Count == 0)
        {
            return new Dictionary<Guid, Guid?>();
        }

        return await _dbContext.InjectItemPosts
            .AsNoTracking()
            .Where(post => targets.Contains(post.Id) && post.ExerciseId == item.ExerciseId)
            .Select(post => new { post.Id, post.FiredPostId })
            .ToDictionaryAsync(row => row.Id, row => row.FiredPostId, cancellationToken);
    }

    /// <summary>
    /// The exercise row facts this slice needs: the tenant (to bound the staff roster), the time zone (XC-008) and
    /// the persisted scenario fallback (COR-053). ONE read site for the whole slice.
    /// </summary>
    private async Task<ExerciseFacts> ReadExerciseFactsAsync(Guid exerciseId, CancellationToken cancellationToken)
    {
        // org-scope-exempt(ResolvedScope): exerciseId is the server-resolved scope (IExerciseContext, set by the
        // request pipeline or by the runner from its own scoped sweep) and never a request field, so this read of
        // the exercise's own row cannot cross an exercise or a customer tenant.
        var row = await _dbContext.Exercises
            .AsNoTracking()
            .Where(exercise => exercise.Id == exerciseId)
            .Select(exercise => new { exercise.OrganizationId, exercise.TimeZone, exercise.CurrentScenarioTime })
            .FirstOrDefaultAsync(cancellationToken);

        var timeZone = string.IsNullOrWhiteSpace(row?.TimeZone) ? FallbackTimeZone : row.TimeZone;
        return new ExerciseFacts(row?.OrganizationId, timeZone, row?.CurrentScenarioTime);
    }

    /// <summary>
    /// The one clock read for an operation: server wall clock, plus scenario time from the native exercise clock,
    /// falling back to the persisted scenario instant and finally the wall clock (the FollowService pattern, COR-053).
    /// </summary>
    private InjectEventTime TimeFor(Guid exerciseId, ExerciseFacts facts)
    {
        var now = _timeProvider.GetUtcNow();
        var scenario = _exerciseClock.CurrentScenarioTime(exerciseId) ?? facts.StoredScenarioTime ?? now;
        return new InjectEventTime(now, scenario, facts.TimeZone);
    }

    private bool IsFrozen(Guid exerciseId) => _pauseTiers.GetTier(exerciseId) == PauseTier.Freeze;

    /// <summary>The resolved scope + the server-side staff user, or <c>null</c> (fail closed → 401).</summary>
    private async Task<Caller?> ResolveCallerAsync(CancellationToken cancellationToken)
    {
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return null;
        }

        var staff = await _staffSession.GetCurrentStaffSessionAsync(cancellationToken);
        return staff is null ? null : new Caller(scope.Value, staff.StaffUserId);
    }

    private static void ApplyItemFields(InjectItem item, InjectItemDraft draft)
    {
        item.Kind = draft.Kind;
        item.Title = draft.Title;
        item.Notes = draft.Notes;
        item.PlannedMinute = draft.PlannedMinute;
        item.AssigneeId = draft.AssigneeId;
        item.BurstWindowSeconds = draft.Kind == InjectKinds.Burst ? draft.BurstWindowSeconds : null;
    }

    /// <summary>
    /// Writes the draft's posts onto the item. A post echoing an existing child's <c>id</c> keeps that child (its
    /// identity, status and published post); a post without one becomes a new child; an existing child not echoed is
    /// soft-deleted (XC-010). Sequence is array position. <c>replyTo.sequence</c> is normalised to the sibling's id
    /// here, so the stored (and returned) form is always <c>injectPostId</c>. Published children are left untouched —
    /// <see cref="InjectTransitions.WhyEditWouldRewriteHistory"/> has already proven the draft does not change them.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A new child on an ALREADY-TRACKED item is added to the context explicitly: discovered only through the
    /// navigation, a child whose Guid key is preset would be taken for an existing row and UPDATEd (0 rows → a
    /// spurious concurrency conflict). On create the item is not tracked yet, and adding it adds the whole graph.
    /// </para>
    /// <para>
    /// A new child of an item that has ALREADY fired is scheduled after the existing pacing (3 s apart); before the
    /// first fire, offsets are laid out by Fire itself.
    /// </para>
    /// </remarks>
    private void ApplyChildren(InjectItem item, InjectItemDraft draft, DateTimeOffset now)
    {
        var tracked = _dbContext.Entry(item).State != EntityState.Detached;
        var live = InjectTransitions.LiveChildren(item).ToDictionary(post => post.Id);
        var started = InjectTransitions.HasStarted(item);
        var nextOffset = (live.Values.Max(post => post.DueOffsetSeconds) ?? 0) + InjectBurstPacing.MinGapSeconds;

        // Pass 1: resolve every position to its child (kept or new), so a {sequence} reply can name a new sibling.
        var children = new InjectItemPost[draft.Posts.Count];
        for (var index = 0; index < draft.Posts.Count; index++)
        {
            if (draft.Posts[index].Id is { } keptId)
            {
                children[index] = live[keptId];
                continue;
            }

            var child = new InjectItemPost
            {
                Id = Guid.NewGuid(),
                ExerciseId = item.ExerciseId,
                InjectItemId = item.Id,
                Text = draft.Posts[index].Text,
                Status = InjectPostStatuses.Pending,
            };
            if (started)
            {
                child.DueOffsetSeconds = nextOffset;
                nextOffset += InjectBurstPacing.MinGapSeconds;
            }

            item.Posts.Add(child);
            if (tracked)
            {
                _dbContext.InjectItemPosts.Add(child);
            }

            children[index] = child;
        }

        // Pass 2: content and order.
        for (var index = 0; index < draft.Posts.Count; index++)
        {
            var source = draft.Posts[index];
            var child = children[index];
            child.Sequence = index + 1;
            if (child.Status == InjectPostStatuses.Fired)
            {
                continue;
            }

            child.PersonaId = source.PersonaId;
            child.Text = source.Text;
            child.Media = source.Media.Select(media => new InjectMediaRef { MediaId = media.MediaId, Alt = media.Alt }).ToList();
            child.ReplyToInjectPostId = source.ReplyToInjectPostId
                ?? (source.ReplyToSequence is { } sequence ? children[sequence - 1].Id : null);
            child.ReplyToPostId = source.ReplyToPostId;
            child.BaselineLike = source.BaselineLike;
            child.BaselineRepost = source.BaselineRepost;
            child.BaselineReply = source.BaselineReply;
        }

        foreach (var removed in live.Values.Where(post => !children.Contains(post)))
        {
            removed.DeletedAt = now;
        }
    }

    private static string? Truncate(string? message) =>
        message is { Length: > MaxErrorLength } ? message[..MaxErrorLength] : message;

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Error,
        Message = "Publishing scripted post {ChildId} of inject item {ItemId} threw; the outcome was recorded from the posts table.")]
    private partial void LogPublishFailed(Exception exception, Guid itemId, Guid childId);

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Warning,
        Message = "Could not record the outcome of scripted post {ChildId} of inject item {ItemId} after repeated conflicts; its claim will be reconciled when the lease expires.")]
    private partial void LogRecordAbandoned(Guid itemId, Guid childId);

    [LoggerMessage(
        EventId = 3,
        Level = LogLevel.Warning,
        Message = "Reconciled an abandoned claim on scripted post {ChildId} of inject item {ItemId}: post {PostId} had already been published.")]
    private partial void LogClaimReconciled(Guid itemId, Guid childId, Guid postId);

    /// <summary>The resolved scope and the server-side staff user behind a request.</summary>
    private sealed record Caller(Guid ExerciseId, Guid StaffUserId);

    /// <summary>The exercise-row facts the slice reads once per operation.</summary>
    private sealed record ExerciseFacts(Guid? OrganizationId, string TimeZone, DateTimeOffset? StoredScenarioTime);

    /// <summary>One staff user on the exercise roster.</summary>
    private sealed record RosterEntry(Guid StaffUserId, string DisplayName, string Role);

    /// <summary>A claimed child's recorded outcome: the post the funnel created, or the funnel's refusal.</summary>
    private sealed class ChildOutcome
    {
        private readonly Post? _post;
        private readonly Guid _attributedHuman;
        private readonly string? _error;

        private ChildOutcome(Post? post, Guid attributedHuman, string? error)
        {
            _post = post;
            _attributedHuman = attributedHuman;
            _error = error;
        }

        public static ChildOutcome Published(Post post, Guid attributedHuman) => new(post, attributedHuman, null);

        public static ChildOutcome Refused(string error) => new(null, Guid.Empty, error);

        public bool IsPublished => _post is not null;

        public void ApplyTo(InjectItemPost child)
        {
            if (_post is { } post)
            {
                child.Status = InjectPostStatuses.Fired;
                child.FiredPostId = post.Id;
                child.FiredScenarioTime = post.CreatedScenarioTime;
                child.FiredWallClock = post.CreatedWallClock;
                child.FiredByHumanId = _attributedHuman;
                child.Error = null;
            }
            else
            {
                child.Status = InjectPostStatuses.Failed;
                child.Error = Truncate(_error);
            }
        }
    }
}
