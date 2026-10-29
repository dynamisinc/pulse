namespace Pulse.WebApi.Features.Channels.Outlets;

using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Media;

/// <summary>
/// The outlet registry (channels-foundation story 03; NWS-001/002/004, PRS-010/012, WX-001/020, COR-030/066): the
/// participant reads, the staff writes, reorder and "add default outlets". Scoped, matching the
/// <see cref="PulseDbContext"/> unit of work it writes through.
/// </summary>
/// <remarks>
/// <para>
/// <b>Scope and identity are server-authoritative (COR-001, COR-018).</b> The exercise comes only from
/// <see cref="IExerciseContext"/> and the acting human only from <see cref="ICurrentStaffSessionAccessor"/>; no request
/// carries either. Every read goes through the central exercise + soft-delete filter, so another exercise's outlet,
/// persona, parent or logo is simply not found: a cross-exercise id answers exactly like an unknown one.
/// </para>
/// <para>
/// <b>Participant reads</b> serve only ENABLED, non-deleted outlets on a channel the exercise has enabled
/// (<see cref="OutletChannelGate"/>). Everything else, including an unknown or non-content channel, is the one
/// <see cref="OutletResult.NotFoundMessage"/> 404.
/// </para>
/// <para>
/// <b>Slugs</b> keep content permalinks stable (NWS-011) in two ways: a slug is IMMUTABLE once the outlet is created (a
/// PUT that changes it is a <c>400</c>), and it is unique per <c>(exercise, channel)</c> on F01's UNFILTERED unique
/// index, so a soft-deleted outlet keeps its slug reserved too. A taken slug, live or deleted, is a <c>409</c> on
/// create; a concurrent writer that wins the race on the index gets the same <c>409</c>.
/// </para>
/// <para>
/// <b>Concurrency.</b> Every write bumps <see cref="Outlet.Version"/> (an EF concurrency token). A PUT or DELETE whose
/// <c>version</c> is stale, or that loses a race at the save, is a <c>409</c> carrying the outlet as it is now.
/// </para>
/// <para>
/// <b>Telemetry (XC-004).</b> Exactly one <c>outlet_action</c> event per create, edit, delete and reorder (and one per
/// defaults-created outlet), in the same <c>SaveChanges</c> as the change (<see cref="OutletTelemetry"/>).
/// </para>
/// </remarks>
public sealed partial class OutletService
{
    /// <summary>The readable refusal for a stale <c>version</c>.</summary>
    public const string StaleVersionMessage = "Changed by someone else. Refresh to see the latest version.";

    /// <summary>The readable refusal when the outlet was deleted between the read and the write.</summary>
    public const string DeletedMessage = "This outlet was deleted by someone else.";

    /// <summary>The ONE message for an unknown or other-exercise persona (COR-001).</summary>
    public const string PersonaNotFoundMessage = "pairedPersonaId does not name a persona in this exercise.";

    /// <summary>The ONE message for an unknown, deleted, non-press or other-exercise parent (COR-001).</summary>
    public const string ParentNotFoundMessage = "parentOutletId does not name a press outlet in this exercise.";

    /// <summary>The refusal for an outlet naming itself (or a descendant) as its parent.</summary>
    public const string ParentCycleMessage = "parentOutletId cannot be the outlet itself or one of its children.";

    /// <summary>The ONE message for an unknown, non-image or other-exercise logo (COR-001).</summary>
    public const string LogoNotFoundMessage = "logoMediaId does not name an image in this exercise.";

    /// <summary>The refusal to delete an outlet that still has live child outlets.</summary>
    public const string HasChildrenMessage = "outlet has child outlets; delete or re-parent them first.";

    /// <summary>The readable refusal for a reorder that does not name the channel's outlets exactly.</summary>
    public const string ReorderListMessage = "ids must list every outlet of the channel exactly once.";

    private const string FallbackTimeZone = "UTC";
    private const int MaxParentDepth = 16;

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentStaffSessionAccessor _staffSession;
    private readonly IExerciseClock _exerciseClock;
    private readonly ExerciseFactsReader _exerciseFacts;
    private readonly OutletChannelGate _channelGate;
    private readonly ISkinOverridesValidator _skinValidator;
    private readonly OutletDefaultsCatalog _defaults;
    private readonly IMediaUrlSigner _mediaUrlSigner;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<OutletService> _logger;

    /// <summary>Creates the outlet service.</summary>
    /// <param name="dbContext">The exercise-scoped persistence context.</param>
    /// <param name="exerciseContext">The server-authoritative exercise scope (COR-001).</param>
    /// <param name="staffSession">The server-side staff session: the only source of the acting human (COR-018).</param>
    /// <param name="exerciseClock">The native per-exercise scenario clock (COR-053).</param>
    /// <param name="exerciseFacts">The one exercise-row read (time zone, stored scenario instant).</param>
    /// <param name="channelGate">The interim channel-enablement check (story 08 replaces it).</param>
    /// <param name="skinValidator">The FC-3b skin-overrides validator.</param>
    /// <param name="defaults">The "add default outlets" catalog.</param>
    /// <param name="mediaUrlSigner">Signs logo read URLs.</param>
    /// <param name="timeProvider">The server wall clock.</param>
    /// <param name="logger">Diagnostics logger.</param>
    public OutletService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ICurrentStaffSessionAccessor staffSession,
        IExerciseClock exerciseClock,
        ExerciseFactsReader exerciseFacts,
        OutletChannelGate channelGate,
        ISkinOverridesValidator skinValidator,
        OutletDefaultsCatalog defaults,
        IMediaUrlSigner mediaUrlSigner,
        TimeProvider timeProvider,
        ILogger<OutletService> logger)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(staffSession);
        ArgumentNullException.ThrowIfNull(exerciseClock);
        ArgumentNullException.ThrowIfNull(exerciseFacts);
        ArgumentNullException.ThrowIfNull(channelGate);
        ArgumentNullException.ThrowIfNull(skinValidator);
        ArgumentNullException.ThrowIfNull(defaults);
        ArgumentNullException.ThrowIfNull(mediaUrlSigner);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(logger);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _staffSession = staffSession;
        _exerciseClock = exerciseClock;
        _exerciseFacts = exerciseFacts;
        _channelGate = channelGate;
        _skinValidator = skinValidator;
        _defaults = defaults;
        _mediaUrlSigner = mediaUrlSigner;
        _timeProvider = timeProvider;
        _logger = logger;
    }

    // ---- participant reads ---------------------------------------------------------------------------

    /// <summary>
    /// <c>GET /api/outlets?channel={id}</c>: the enabled outlets of an enabled content channel, ordered by
    /// <c>sortOrder</c> then name. A missing, unknown, non-content or disabled channel is the one 404.
    /// </summary>
    /// <param name="channel">The channel id from the query string.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outlets, the 404, or the fail-closed 401.</returns>
    public async Task<OutletResult<IReadOnlyList<OutletDto>>> ListAsync(string? channel, CancellationToken cancellationToken = default)
    {
        if (!HasResolvedScope(out _))
        {
            return OutletResult.ScopeUnresolved<IReadOnlyList<OutletDto>>();
        }

        var channelId = channel?.Trim();
        if (!IsContentChannel(channelId)
            || !await _channelGate.IsEnabledAsync(channelId!, cancellationToken))
        {
            return OutletResult.NotFound<IReadOnlyList<OutletDto>>();
        }

        var outlets = await _dbContext.Outlets
            .AsNoTracking()
            .Where(outlet => outlet.ChannelId == channelId && outlet.Enabled)
            .OrderBy(outlet => outlet.SortOrder)
            .ThenBy(outlet => outlet.Name)
            .ToListAsync(cancellationToken);

        var logos = await SignLogosAsync(outlets, cancellationToken);
        var servedParents = await ServedParentIdsAsync(outlets, cancellationToken);
        return OutletResult.Ok<IReadOnlyList<OutletDto>>(
            outlets.Select(outlet => ToParticipantDto(outlet, logos.GetValueOrDefault(outlet.Id), servedParents)).ToList());
    }

    /// <summary>
    /// <c>GET /api/outlets/{slug}?channel=</c>: one enabled outlet on an enabled channel. A slug is unique per
    /// <c>(exercise, channel)</c>, not per exercise, so <paramref name="channel"/> disambiguates; without it the
    /// enabled match on the FIRST enabled channel in <see cref="ChannelVocabulary.ChannelIds"/> order is served
    /// (news, then press, then weather). Disabled, deleted, other-exercise and unknown outlets, and disabled channels,
    /// are the one identical 404.
    /// </summary>
    /// <param name="slug">The outlet slug.</param>
    /// <param name="channel">The optional channel id from the query string.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outlet, the 404, or the fail-closed 401.</returns>
    public async Task<OutletResult<OutletDto>> GetBySlugAsync(string? slug, string? channel, CancellationToken cancellationToken = default)
    {
        if (!HasResolvedScope(out _))
        {
            return OutletResult.ScopeUnresolved<OutletDto>();
        }

        if (!ChannelVocabulary.IsSlug(slug))
        {
            return OutletResult.NotFound<OutletDto>();
        }

        var channelId = channel?.Trim();
        if (!string.IsNullOrEmpty(channelId) && !IsContentChannel(channelId))
        {
            return OutletResult.NotFound<OutletDto>();
        }

        var channels = new List<string>();
        foreach (var id in ChannelVocabulary.ContentChannelIds)
        {
            if ((string.IsNullOrEmpty(channelId) || id == channelId) && await _channelGate.IsEnabledAsync(id, cancellationToken))
            {
                channels.Add(id);
            }
        }

        if (channels.Count == 0)
        {
            return OutletResult.NotFound<OutletDto>();
        }

        var matches = await _dbContext.Outlets
            .AsNoTracking()
            .Where(outlet => outlet.Slug == slug && outlet.Enabled && channels.Contains(outlet.ChannelId))
            .ToListAsync(cancellationToken);
        var match = matches.OrderBy(outlet => ChannelRank(outlet.ChannelId)).FirstOrDefault();
        if (match is null)
        {
            return OutletResult.NotFound<OutletDto>();
        }

        var logos = await SignLogosAsync([match], cancellationToken);
        var servedParents = await ServedParentIdsAsync([match], cancellationToken);
        return OutletResult.Ok(ToParticipantDto(match, logos.GetValueOrDefault(match.Id), servedParents));
    }

    // ---- staff reads ---------------------------------------------------------------------------------

    /// <summary>
    /// <c>GET /api/outlets/staff?channel=</c>: every non-deleted outlet (enabled or not) as the staff DTO, for one
    /// content channel or, without <paramref name="channel"/>, all of them, in channel then display order. Not gated
    /// by channel enablement.
    /// </summary>
    /// <param name="channel">The optional channel id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outlets, a 400 for a non-content channel, or the fail-closed 401.</returns>
    public async Task<OutletResult<IReadOnlyList<OutletStaffDto>>> ListStaffAsync(string? channel, CancellationToken cancellationToken = default)
    {
        var caller = await ResolveCallerAsync(cancellationToken);
        if (caller is null)
        {
            return OutletResult.ScopeUnresolved<IReadOnlyList<OutletStaffDto>>();
        }

        var channelId = channel?.Trim();
        if (!string.IsNullOrEmpty(channelId) && !IsContentChannel(channelId))
        {
            return OutletResult.Invalid<IReadOnlyList<OutletStaffDto>>(ChannelIdMessage);
        }

        return OutletResult.Ok(await ReadStaffListAsync(string.IsNullOrEmpty(channelId) ? null : channelId, cancellationToken));
    }

    // ---- staff writes --------------------------------------------------------------------------------

    /// <summary><c>POST /api/outlets</c>: validates and creates an outlet (enabled and last by default).</summary>
    /// <param name="request">The untrusted write body.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The created outlet (201), a 400, a 409 for a taken slug, or the fail-closed 401.</returns>
    public async Task<OutletResult<OutletStaffDto>> CreateAsync(OutletWriteRequest? request, CancellationToken cancellationToken = default)
    {
        var caller = await ResolveCallerAsync(cancellationToken);
        if (caller is null)
        {
            return OutletResult.ScopeUnresolved<OutletStaffDto>();
        }

        var parse = OutletWriteValidator.Parse(request, existing: null, _skinValidator);
        if (parse.Draft is not { } draft)
        {
            return OutletResult.Invalid<OutletStaffDto>(parse.Error!);
        }

        if (await CheckReferencesAsync(draft, outletId: null, cancellationToken) is { } referenceError)
        {
            return OutletResult.Invalid<OutletStaffDto>(referenceError);
        }

        if (await SlugConflictAsync(draft.ChannelId, draft.Slug, outletId: null, cancellationToken) is { } slugConflict)
        {
            return OutletResult.Conflict<OutletStaffDto>(slugConflict, null);
        }

        var time = await TimeForAsync(caller.ExerciseId, cancellationToken);
        var outlet = new Outlet
        {
            Id = Guid.NewGuid(),
            ExerciseId = caller.ExerciseId,
            ChannelId = draft.ChannelId,
            Slug = draft.Slug,
            Name = draft.Name,
            SkinKey = draft.SkinKey,
            Enabled = draft.Enabled ?? true,
            SortOrder = draft.SortOrder ?? await NextSortOrderAsync(draft.ChannelId, cancellationToken),
            Version = 1,
        };
        ApplyDraft(outlet, draft);

        _dbContext.Outlets.Add(outlet);
        _dbContext.TelemetryEvents.Add(OutletTelemetry.ForOutlet(outlet, OutletTelemetry.ActionCreate, caller.StaffUserId, time));

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (ex is not DbUpdateConcurrencyException)
        {
            _dbContext.ChangeTracker.Clear();
            if (await SlugConflictAsync(draft.ChannelId, draft.Slug, outletId: null, cancellationToken) is { } raced)
            {
                return OutletResult.Conflict<OutletStaffDto>(raced, null);
            }

            throw;
        }

        return OutletResult.Created(await ProjectStaffAsync(outlet, cancellationToken));
    }

    /// <summary>
    /// <c>PUT /api/outlets/{id}</c>: replaces an outlet's fields (see <see cref="OutletWriteRequest"/>). The body's
    /// <c>version</c> must match; <c>channelId</c> cannot change.
    /// </summary>
    /// <param name="outletId">The outlet id.</param>
    /// <param name="request">The untrusted write body, including <c>version</c>.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The edited outlet, the 404, a 400, a 409 (stale or taken slug), or the fail-closed 401.</returns>
    public async Task<OutletResult<OutletStaffDto>> UpdateAsync(
        Guid outletId,
        OutletWriteRequest? request,
        CancellationToken cancellationToken = default)
    {
        var caller = await ResolveCallerAsync(cancellationToken);
        if (caller is null)
        {
            return OutletResult.ScopeUnresolved<OutletStaffDto>();
        }

        var outlet = await _dbContext.Outlets.FirstOrDefaultAsync(row => row.Id == outletId, cancellationToken);
        if (outlet is null)
        {
            return OutletResult.NotFound<OutletStaffDto>();
        }

        var parse = OutletWriteValidator.Parse(request, outlet, _skinValidator);
        if (parse.Draft is not { } draft)
        {
            return OutletResult.Invalid<OutletStaffDto>(parse.Error!);
        }

        if (request!.Version != outlet.Version)
        {
            return OutletResult.Conflict<OutletStaffDto>(StaleVersionMessage, await ProjectStaffAsync(outlet, cancellationToken));
        }

        if (await CheckReferencesAsync(draft, outlet.Id, cancellationToken) is { } referenceError)
        {
            return OutletResult.Invalid<OutletStaffDto>(referenceError);
        }

        // The slug is immutable (OutletWriteValidator refuses a change), so an edit can never meet the slug index.
        var time = await TimeForAsync(caller.ExerciseId, cancellationToken);
        outlet.Name = draft.Name;
        outlet.SkinKey = draft.SkinKey;
        outlet.Enabled = draft.Enabled ?? outlet.Enabled;
        outlet.SortOrder = draft.SortOrder ?? outlet.SortOrder;
        ApplyDraft(outlet, draft);
        outlet.Version++;
        _dbContext.TelemetryEvents.Add(OutletTelemetry.ForOutlet(outlet, OutletTelemetry.ActionEdit, caller.StaffUserId, time));

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            _dbContext.ChangeTracker.Clear();
            return await ConflictWithCurrentAsync(outletId, cancellationToken);
        }

        return OutletResult.Ok(await ProjectStaffAsync(outlet, cancellationToken));
    }

    /// <summary>
    /// <c>DELETE /api/outlets/{id}?version=n</c>: soft-deletes the outlet (XC-010, the F01 <see cref="ISoftDeletable"/>
    /// plumbing). Its slug stays reserved.
    /// </summary>
    /// <param name="outletId">The outlet id.</param>
    /// <param name="version">The version the caller last read (required).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>204, the 404, a 400 without a version, a stale 409, or the fail-closed 401.</returns>
    public async Task<OutletResult<OutletStaffDto>> DeleteAsync(
        Guid outletId,
        int? version,
        CancellationToken cancellationToken = default)
    {
        var caller = await ResolveCallerAsync(cancellationToken);
        if (caller is null)
        {
            return OutletResult.ScopeUnresolved<OutletStaffDto>();
        }

        if (version is null)
        {
            return OutletResult.Invalid<OutletStaffDto>("version is required.");
        }

        var outlet = await _dbContext.Outlets.FirstOrDefaultAsync(row => row.Id == outletId, cancellationToken);
        if (outlet is null)
        {
            return OutletResult.NotFound<OutletStaffDto>();
        }

        if (version.Value != outlet.Version)
        {
            return OutletResult.Conflict<OutletStaffDto>(StaleVersionMessage, await ProjectStaffAsync(outlet, cancellationToken));
        }

        if (await _dbContext.Outlets.AnyAsync(child => child.ParentOutletId == outletId, cancellationToken))
        {
            return OutletResult.Conflict<OutletStaffDto>(HasChildrenMessage, await ProjectStaffAsync(outlet, cancellationToken));
        }

        var time = await TimeForAsync(caller.ExerciseId, cancellationToken);
        outlet.Version++;

        // One clock read: PulseDbContext's soft-delete conversion only stamps DeletedAt when it is unset (??=), so this
        // value, shared with the telemetry event, is the one persisted.
        outlet.DeletedAt = time.WallClock;
        _dbContext.Outlets.Remove(outlet); // converted to a soft delete by PulseDbContext (XC-010)
        _dbContext.TelemetryEvents.Add(OutletTelemetry.ForOutlet(outlet, OutletTelemetry.ActionDelete, caller.StaffUserId, time));

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            _dbContext.ChangeTracker.Clear();
            return await ConflictWithCurrentAsync(outletId, cancellationToken);
        }

        return OutletResult.Deleted<OutletStaffDto>();
    }

    /// <summary>
    /// <c>POST /api/outlets/reorder</c>: sets one channel's display order. <c>ids</c> must name every non-deleted outlet
    /// of the channel exactly once; <c>sortOrder</c> becomes the 1-based array position. Each outlet whose order changes
    /// gets a version bump. One <c>outlet_action</c> event (see <see cref="OutletTelemetry"/>). A channel with no outlets
    /// and an empty list is a no-op with no event.
    /// </summary>
    /// <param name="request">The untrusted reorder body.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The channel's outlets in the new order, a 400, a 409 on a lost race, or the fail-closed 401.</returns>
    public async Task<OutletResult<IReadOnlyList<OutletStaffDto>>> ReorderAsync(
        OutletReorderRequest? request,
        CancellationToken cancellationToken = default)
    {
        var caller = await ResolveCallerAsync(cancellationToken);
        if (caller is null)
        {
            return OutletResult.ScopeUnresolved<IReadOnlyList<OutletStaffDto>>();
        }

        var channelId = request?.ChannelId?.Trim();
        if (!IsContentChannel(channelId))
        {
            return OutletResult.Invalid<IReadOnlyList<OutletStaffDto>>(ChannelIdMessage);
        }

        if (request!.Ids is not { } rawIds)
        {
            return OutletResult.Invalid<IReadOnlyList<OutletStaffDto>>(ReorderListMessage);
        }

        var ids = new List<Guid>(rawIds.Count);
        foreach (var raw in rawIds)
        {
            if (!Guid.TryParse(raw, out var id))
            {
                return OutletResult.Invalid<IReadOnlyList<OutletStaffDto>>(ReorderListMessage);
            }

            ids.Add(id);
        }

        var outlets = await _dbContext.Outlets.Where(outlet => outlet.ChannelId == channelId).ToListAsync(cancellationToken);
        var byId = outlets.ToDictionary(outlet => outlet.Id);
        if (ids.Count != outlets.Count || ids.Distinct().Count() != ids.Count || ids.Any(id => !byId.ContainsKey(id)))
        {
            return OutletResult.Invalid<IReadOnlyList<OutletStaffDto>>(ReorderListMessage);
        }

        if (ids.Count == 0)
        {
            return OutletResult.Ok<IReadOnlyList<OutletStaffDto>>([]);
        }

        for (var index = 0; index < ids.Count; index++)
        {
            var outlet = byId[ids[index]];
            if (outlet.SortOrder != index + 1)
            {
                outlet.SortOrder = index + 1;
                outlet.Version++;
            }
        }

        var time = await TimeForAsync(caller.ExerciseId, cancellationToken);
        _dbContext.TelemetryEvents.Add(OutletTelemetry.ForReorder(caller.ExerciseId, channelId!, ids, caller.StaffUserId, time));

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException ex)
        {
            // An outlet's version moved since the read (an edit, delete or another reorder). Nothing else is a race.
            _dbContext.ChangeTracker.Clear();
            LogLostRace(ex, OutletTelemetry.ActionReorder, channelId!);
            return OutletResult.Conflict<IReadOnlyList<OutletStaffDto>>(
                "The outlets changed while you were reordering. Refresh and try again.", null);
        }

        return OutletResult.Ok(await ReadStaffListAsync(channelId, cancellationToken));
    }

    /// <summary>
    /// <c>POST /api/outlets/defaults</c>: creates each <see cref="OutletDefaultsCatalog"/> entry of the channel whose slug
    /// is not already taken in the exercise (live or deleted), enabled and after the existing outlets, pairing it with
    /// the cast persona of its handle when that persona exists. Idempotent: a repeat call creates nothing. One
    /// <c>outlet_action</c> create event per created outlet, all in one <c>SaveChanges</c>.
    /// </summary>
    /// <param name="request">The untrusted body.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>What was created, skipped and left unpaired; a 400; a 409 on a lost race; or the fail-closed 401.</returns>
    public async Task<OutletResult<OutletDefaultsResultDto>> AddDefaultsAsync(
        OutletDefaultsRequest? request,
        CancellationToken cancellationToken = default)
    {
        var caller = await ResolveCallerAsync(cancellationToken);
        if (caller is null)
        {
            return OutletResult.ScopeUnresolved<OutletDefaultsResultDto>();
        }

        var channelId = request?.ChannelId?.Trim();
        if (!IsContentChannel(channelId))
        {
            return OutletResult.Invalid<OutletDefaultsResultDto>(ChannelIdMessage);
        }

        var entries = _defaults.ForChannel(channelId!);
        var taken = (await _dbContext.IncludingSoftDeleted<Outlet>()
                .Where(outlet => outlet.ChannelId == channelId)
                .Select(outlet => outlet.Slug)
                .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.Ordinal);
        var personas = await ReadPersonaHandlesAsync(cancellationToken);
        var nextOrder = await NextSortOrderAsync(channelId!, cancellationToken);
        var time = await TimeForAsync(caller.ExerciseId, cancellationToken);

        var created = new List<Outlet>();
        var skipped = new List<string>();
        var unresolved = new List<string>();
        foreach (var entry in entries)
        {
            if (taken.Contains(entry.Slug))
            {
                skipped.Add(entry.Slug);
                continue;
            }

            Guid? personaId = null;
            if (entry.PairedHandle is { } handle)
            {
                if (personas.TryGetValue(NormalizeHandle(handle), out var found))
                {
                    personaId = found;
                }
                else
                {
                    unresolved.Add("@" + handle);
                }
            }

            var outlet = new Outlet
            {
                Id = Guid.NewGuid(),
                ExerciseId = caller.ExerciseId,
                ChannelId = entry.ChannelId,
                Slug = entry.Slug,
                Name = entry.Name,
                Tagline = entry.Tagline,
                PairedPersonaId = personaId,
                CategoriesJson = JsonSerializer.Serialize(entry.Categories),
                SkinKey = entry.SkinKey,
                Enabled = true,
                SortOrder = nextOrder++,
                Version = 1,
            };
            created.Add(outlet);
            _dbContext.Outlets.Add(outlet);
            _dbContext.TelemetryEvents.Add(OutletTelemetry.ForOutlet(
                outlet, OutletTelemetry.ActionCreate, caller.StaffUserId, time, OutletTelemetry.SourceDefaults));
        }

        if (created.Count > 0)
        {
            try
            {
                await _dbContext.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException ex) when (ex is DbUpdateConcurrencyException || IsUniqueViolation(ex))
            {
                // A concurrent "add defaults" (or create) took one of these slugs first: nothing of this call was saved.
                // Anything else is not a race and propagates.
                _dbContext.ChangeTracker.Clear();
                LogLostRace(ex, "defaults", channelId!);
                return OutletResult.Conflict<OutletDefaultsResultDto>(
                    "Outlets were added on this channel at the same time. Refresh and try again.", null);
            }
        }

        var logos = await SignLogosAsync(created, cancellationToken);
        return OutletResult.Ok(new OutletDefaultsResultDto
        {
            Created = created.Select(outlet => ToStaffDto(outlet, logos.GetValueOrDefault(outlet.Id))).ToList(),
            Skipped = skipped,
            UnresolvedHandles = unresolved,
        });
    }

    // ---- plumbing ------------------------------------------------------------------------------------

    private static string ChannelIdMessage =>
        $"channelId must be one of {string.Join(", ", ChannelVocabulary.ContentChannelIds)}.";

    private static bool IsContentChannel(string? channelId) =>
        channelId is not null && ChannelVocabulary.ContentChannelIds.Contains(channelId, StringComparer.Ordinal);

    private static int ChannelRank(string channelId)
    {
        for (var index = 0; index < ChannelVocabulary.ChannelIds.Count; index++)
        {
            if (string.Equals(ChannelVocabulary.ChannelIds[index], channelId, StringComparison.Ordinal))
            {
                return index;
            }
        }

        return int.MaxValue;
    }

    private static void ApplyDraft(Outlet outlet, OutletDraft draft)
    {
        outlet.Tagline = draft.Tagline;
        outlet.ParentOutletId = draft.ParentOutletId;
        outlet.PairedPersonaId = draft.PairedPersonaId;
        outlet.LogoMediaId = draft.LogoMediaId;
        outlet.CategoriesJson = draft.CategoriesJson;
        outlet.SkinOverridesJson = draft.SkinOverridesJson;
    }

    /// <summary>
    /// The scoped reference checks. Each lookup goes through the central filter, so an id from another exercise is
    /// "not found" with exactly the message an unknown id gets (COR-001). All failures are reported together.
    /// </summary>
    private async Task<string?> CheckReferencesAsync(OutletDraft draft, Guid? outletId, CancellationToken cancellationToken)
    {
        var errors = new List<string>();

        if (draft.PairedPersonaId is { } personaId
            && !await _dbContext.Personas.AsNoTracking().AnyAsync(persona => persona.Id == personaId, cancellationToken))
        {
            errors.Add(PersonaNotFoundMessage);
        }

        if (draft.ParentOutletId is { } parentId)
        {
            if (parentId == outletId)
            {
                errors.Add(ParentCycleMessage);
            }
            else
            {
                var parent = await _dbContext.Outlets
                    .AsNoTracking()
                    .Where(outlet => outlet.Id == parentId)
                    .Select(outlet => new { outlet.ChannelId, outlet.ParentOutletId })
                    .FirstOrDefaultAsync(cancellationToken);
                if (parent is null || parent.ChannelId != ChannelVocabulary.Press)
                {
                    errors.Add(ParentNotFoundMessage);
                }
                else if (outletId is { } self && await IsAncestorAsync(self, parent.ParentOutletId, cancellationToken))
                {
                    errors.Add(ParentCycleMessage);
                }
            }
        }

        if (draft.LogoMediaId is { } logoId
            && !await _dbContext.MediaAssets.AsNoTracking()
                .AnyAsync(asset => asset.Id == logoId && asset.Kind == MediaKinds.Image, cancellationToken))
        {
            errors.Add(LogoNotFoundMessage);
        }

        return errors.Count == 0 ? null : string.Join(" ", errors);
    }

    /// <summary>Whether <paramref name="self"/> appears on the parent chain starting at <paramref name="start"/>.</summary>
    private async Task<bool> IsAncestorAsync(Guid self, Guid? start, CancellationToken cancellationToken)
    {
        var current = start;
        for (var depth = 0; current is { } id && depth < MaxParentDepth; depth++)
        {
            if (id == self)
            {
                return true;
            }

            current = await _dbContext.Outlets
                .AsNoTracking()
                .Where(outlet => outlet.Id == id)
                .Select(outlet => outlet.ParentOutletId)
                .FirstOrDefaultAsync(cancellationToken);
        }

        return false;
    }

    /// <summary>
    /// The 409 message when <paramref name="slug"/> is taken on the channel by another outlet of THIS exercise, live or
    /// soft-deleted (F01's unique index is unfiltered, so a deleted outlet keeps its slug, NWS-011); else null.
    /// </summary>
    private async Task<string?> SlugConflictAsync(string channelId, string slug, Guid? outletId, CancellationToken cancellationToken)
    {
        var holder = await _dbContext.IncludingSoftDeleted<Outlet>()
            .AsNoTracking()
            .Where(outlet => outlet.ChannelId == channelId && outlet.Slug == slug && outlet.Id != outletId)
            .Select(outlet => new { outlet.DeletedAt })
            .FirstOrDefaultAsync(cancellationToken);

        if (holder is null)
        {
            return null;
        }

        return holder.DeletedAt is null
            ? $"slug '{slug}' is already used by another {channelId} outlet in this exercise."
            : $"slug '{slug}' belongs to a deleted {channelId} outlet and stays reserved (permalinks are never reused).";
    }

    private async Task<int> NextSortOrderAsync(string channelId, CancellationToken cancellationToken) =>
        (await _dbContext.Outlets
            .Where(outlet => outlet.ChannelId == channelId)
            .MaxAsync(outlet => (int?)outlet.SortOrder, cancellationToken) ?? 0) + 1;

    /// <summary>The exercise's persona handles (normalized: no leading <c>@</c>, case-insensitive) → persona id.</summary>
    private async Task<Dictionary<string, Guid>> ReadPersonaHandlesAsync(CancellationToken cancellationToken)
    {
        var rows = await _dbContext.Personas
            .AsNoTracking()
            .Select(persona => new { persona.Id, persona.Handle })
            .ToListAsync(cancellationToken);

        var byHandle = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in rows)
        {
            byHandle.TryAdd(NormalizeHandle(row.Handle), row.Id);
        }

        return byHandle;
    }

    private static string NormalizeHandle(string handle) => handle.Trim().TrimStart('@');

    private async Task<OutletResult<OutletStaffDto>> ConflictWithCurrentAsync(Guid outletId, CancellationToken cancellationToken)
    {
        var current = await _dbContext.Outlets.AsNoTracking().FirstOrDefaultAsync(row => row.Id == outletId, cancellationToken);
        return current is null
            ? OutletResult.Conflict<OutletStaffDto>(DeletedMessage, null)
            : OutletResult.Conflict<OutletStaffDto>(StaleVersionMessage, await ProjectStaffAsync(current, cancellationToken));
    }

    private async Task<IReadOnlyList<OutletStaffDto>> ReadStaffListAsync(string? channelId, CancellationToken cancellationToken)
    {
        var query = _dbContext.Outlets.AsNoTracking();
        if (channelId is not null)
        {
            query = query.Where(outlet => outlet.ChannelId == channelId);
        }

        var outlets = (await query.ToListAsync(cancellationToken))
            .OrderBy(outlet => ChannelRank(outlet.ChannelId))
            .ThenBy(outlet => outlet.SortOrder)
            .ThenBy(outlet => outlet.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var logos = await SignLogosAsync(outlets, cancellationToken);
        return outlets.Select(outlet => ToStaffDto(outlet, logos.GetValueOrDefault(outlet.Id))).ToList();
    }

    private async Task<OutletStaffDto> ProjectStaffAsync(Outlet outlet, CancellationToken cancellationToken)
    {
        var logos = await SignLogosAsync([outlet], cancellationToken);
        return ToStaffDto(outlet, logos.GetValueOrDefault(outlet.Id));
    }

    /// <summary>
    /// Signs every logo on the page through the existing media seam: one scoped asset query and one signer call, both
    /// skipped when no outlet has a logo. A storage fault degrades to logo-less outlets (logged once), never a failed
    /// read; cancellation and an <see cref="ExerciseScopeViolationException"/> (an isolation signal) are not absorbed.
    /// </summary>
    private async Task<IReadOnlyDictionary<Guid, ContentMediaDto>> SignLogosAsync(
        IReadOnlyCollection<Outlet> outlets,
        CancellationToken cancellationToken)
    {
        var mediaIds = outlets.Select(outlet => outlet.LogoMediaId).OfType<Guid>().Distinct().ToArray();
        if (mediaIds.Length == 0)
        {
            return new Dictionary<Guid, ContentMediaDto>();
        }

        var assets = await _dbContext.MediaAssets
            .AsNoTracking()
            .Where(asset => mediaIds.Contains(asset.Id))
            .ToListAsync(cancellationToken);
        if (assets.Count == 0)
        {
            return new Dictionary<Guid, ContentMediaDto>();
        }

        IReadOnlyDictionary<Guid, string> urls;
        try
        {
            urls = await _mediaUrlSigner.GetReadUrlsAsync(assets, cancellationToken);
        }
#pragma warning disable CA1031 // A storage fault must degrade the read to logo-less outlets, never fail it.
        catch (Exception ex) when (ex is not OperationCanceledException and not ExerciseScopeViolationException)
        {
            LogLogoSigningFailed(ex, assets.Count);
            return new Dictionary<Guid, ContentMediaDto>();
        }
#pragma warning restore CA1031

        var assetsById = assets.ToDictionary(asset => asset.Id);
        var logos = new Dictionary<Guid, ContentMediaDto>();
        foreach (var outlet in outlets)
        {
            if (outlet.LogoMediaId is { } mediaId
                && assetsById.TryGetValue(mediaId, out var asset)
                && urls.TryGetValue(mediaId, out var url))
            {
                logos[outlet.Id] = new ContentMediaDto
                {
                    Id = asset.Id.ToString(),
                    Kind = asset.Kind,
                    Role = ChannelVocabulary.MediaRoleInline,
                    Url = url,
                    ContentType = asset.ContentType,
                    Width = asset.Width,
                    Height = asset.Height,
                    DurationSec = asset.DurationSec,
                    Alt = outlet.Name,
                };
            }
        }

        return logos;
    }

    /// <summary>
    /// The parents of <paramref name="outlets"/> a participant may be pointed at: enabled and not deleted (the central
    /// filter drops deleted and other-exercise rows). A parent is on press, as is its child, so the channel gate that
    /// admitted the child admits it too. A participant DTO never names a parent it would get a 404 for.
    /// </summary>
    private async Task<IReadOnlySet<Guid>> ServedParentIdsAsync(IReadOnlyCollection<Outlet> outlets, CancellationToken cancellationToken)
    {
        var parentIds = outlets.Select(outlet => outlet.ParentOutletId).OfType<Guid>().Distinct().ToList();
        if (parentIds.Count == 0)
        {
            return new HashSet<Guid>();
        }

        var served = await _dbContext.Outlets
            .AsNoTracking()
            .Where(outlet => parentIds.Contains(outlet.Id) && outlet.Enabled)
            .Select(outlet => outlet.Id)
            .ToListAsync(cancellationToken);
        return served.ToHashSet();
    }

    /// <summary>
    /// The PARTICIPANT projection (XC-002): only the frozen <see cref="OutletDto"/> fields, never the exercise id, the
    /// enabled flag, the order, the version or any wall clock.
    /// </summary>
    private static OutletDto ToParticipantDto(Outlet outlet, ContentMediaDto? logo, IReadOnlySet<Guid> servedParents) => new()
    {
        Id = outlet.Id.ToString(),
        ChannelId = outlet.ChannelId,
        Slug = outlet.Slug,
        Name = outlet.Name,
        Tagline = outlet.Tagline,
        ParentOutletId = outlet.ParentOutletId is { } parentId && servedParents.Contains(parentId) ? parentId.ToString() : null,
        PairedPersonaId = outlet.PairedPersonaId?.ToString(),
        Logo = logo,
        Categories = ReadCategories(outlet.CategoriesJson),
        SkinKey = outlet.SkinKey,
        SkinOverrides = ReadSkinOverrides(outlet.SkinOverridesJson),
        HomeRoute = HomeRoute(outlet),
    };

    private static OutletStaffDto ToStaffDto(Outlet outlet, ContentMediaDto? logo) => new()
    {
        Id = outlet.Id.ToString(),
        ChannelId = outlet.ChannelId,
        Slug = outlet.Slug,
        Name = outlet.Name,
        Tagline = outlet.Tagline,
        ParentOutletId = outlet.ParentOutletId?.ToString(),
        PairedPersonaId = outlet.PairedPersonaId?.ToString(),
        Logo = logo,
        Categories = ReadCategories(outlet.CategoriesJson),
        SkinKey = outlet.SkinKey,
        SkinOverrides = ReadSkinOverrides(outlet.SkinOverridesJson),
        HomeRoute = HomeRoute(outlet),
        LogoMediaId = outlet.LogoMediaId?.ToString(),
        Enabled = outlet.Enabled,
        SortOrder = outlet.SortOrder,
        Version = outlet.Version,
    };

    /// <summary>The host-relative home route (FC-9.3): <c>/{channelId}/{slug}</c>, both FC-1 literals.</summary>
    private static string HomeRoute(Outlet outlet) => $"/{outlet.ChannelId}/{outlet.Slug}";

    /// <summary>The stored categories; a hand-edited, unreadable value reads as none rather than failing the read.</summary>
    private static List<string> ReadCategories(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<List<string>>(json)?.Where(category => category is not null).ToList() ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    /// <summary>The stored overrides; an unreadable value reads as none (the outlet renders its registered skin).</summary>
    private static JsonObject? ReadSkinOverrides(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            return JsonNode.Parse(json) as JsonObject;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// The one clock read for an operation: the server wall clock, plus scenario time from the native exercise clock,
    /// falling back to the persisted scenario instant and finally the wall clock (the InjectQueueService pattern).
    /// </summary>
    private async Task<OutletEventTime> TimeForAsync(Guid exerciseId, CancellationToken cancellationToken)
    {
        var facts = await _exerciseFacts.GetAsync(exerciseId, cancellationToken);
        var now = _timeProvider.GetUtcNow();
        var scenario = _exerciseClock.CurrentScenarioTime(exerciseId) ?? facts?.StoredScenarioTime ?? now;
        var timeZone = facts?.TimeZone is { } zone && !string.IsNullOrWhiteSpace(zone) ? zone : FallbackTimeZone;
        return new OutletEventTime(now, scenario, timeZone);
    }

    /// <summary>The fail-closed scope check: an unset or empty scope is refused.</summary>
    private bool HasResolvedScope(out Guid exerciseId)
    {
        exerciseId = _exerciseContext.CurrentExerciseId ?? Guid.Empty;
        return exerciseId != Guid.Empty;
    }

    /// <summary>The resolved scope + the server-side staff user, or <c>null</c> (fail closed → 401).</summary>
    private async Task<Caller?> ResolveCallerAsync(CancellationToken cancellationToken)
    {
        if (!HasResolvedScope(out var exerciseId))
        {
            return null;
        }

        var staff = await _staffSession.GetCurrentStaffSessionAsync(cancellationToken);
        return staff is null ? null : new Caller(exerciseId, staff.StaffUserId);
    }

    /// <summary>Whether a save failed on a unique index (SQL Server 2601 duplicate key, 2627 unique constraint).</summary>
    private static bool IsUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is SqlException { Number: 2601 or 2627 };

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Warning,
        Message = "The outlet {Action} on channel {ChannelId} lost a race to a concurrent writer; answered 409.")]
    private partial void LogLostRace(Exception exception, string action, string channelId);

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Signing {AssetCount} outlet logo asset(s) failed; the outlets are served without a logo.")]
    private partial void LogLogoSigningFailed(Exception exception, int assetCount);

    /// <summary>The resolved scope and the server-side staff user behind a request.</summary>
    private sealed record Caller(Guid ExerciseId, Guid StaffUserId);
}
