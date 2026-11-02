namespace Pulse.WebApi.Features.Weather.Zones;

using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// The weather zone model (weather-source story 02, WX-004, D4-009): the participant zone list and the staff create, edit
/// and soft delete over F01's <see cref="WeatherZone"/> (M1). Zones are named labels, not geometry. Scoped, matching the
/// <see cref="PulseDbContext"/> unit of work it writes through. Mirrors <c>OutletService</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Scope and identity are server-authoritative (COR-001, COR-018).</b> The exercise comes only from
/// <see cref="IExerciseContext"/> and the acting human only from <see cref="ICurrentStaffSessionAccessor"/>. Every read goes
/// through the central exercise + soft-delete filter, so another exercise's zone is simply not found: a cross-exercise id
/// answers exactly like an unknown one. Nothing auto-creates a zone (Q6/Q-28): an exercise starts with none.
/// </para>
/// <para>
/// <b>Slugs</b> are FC-1, unique per exercise on F01's UNFILTERED unique index (a deleted zone keeps its slug so historic
/// products keep resolving it, XC-010), and immutable once created.
/// </para>
/// <para>
/// <b>Exactly one default.</b> The first zone created is the default; making another zone the default clears the old one
/// in the same save; deleting the default promotes the first remaining zone (display order); un-defaulting the default is
/// refused. There is no database constraint for this (no migration in this story), so the reads also NORMALIZE: the
/// effective default is the first flagged zone in display order, else the first zone. A list therefore always names exactly
/// one default, even after a lost race between two concurrent "first" creates.
/// </para>
/// <para>
/// <b>Concurrency.</b> Every write bumps <see cref="WeatherZone.Version"/> (an EF concurrency token), including a zone whose
/// default flag moved as a side effect. A stale <c>version</c>, or a race lost at the save, is a <c>409</c>.
/// </para>
/// <para>
/// <b>Telemetry (XC-004).</b> Exactly one <c>weather_zone_changed</c> event per create, edit and delete, in the same
/// <c>SaveChanges</c> as the change (<see cref="WeatherZoneTelemetry"/>).
/// </para>
/// </remarks>
public sealed partial class WeatherZoneService
{
    /// <summary>The readable refusal for a stale <c>version</c>.</summary>
    public const string StaleVersionMessage = "Changed by someone else. Refresh to see the latest version.";

    /// <summary>The readable refusal when the zone was deleted between the read and the write.</summary>
    public const string DeletedMessage = "This weather zone was deleted by someone else.";

    /// <summary>The refusal to clear the default flag of the default zone.</summary>
    public const string DefaultRequiredMessage =
        "isDefault cannot be cleared: there is always exactly one default zone. Make another zone the default instead.";

    /// <summary>The readable refusal when another zone changed during a write that also moved the default.</summary>
    public const string ZonesChangedMessage = "The weather zones changed while you were saving. Refresh and try again.";

    private const string FallbackTimeZone = "UTC";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentStaffSessionAccessor _staffSession;
    private readonly IExerciseClock _exerciseClock;
    private readonly ExerciseFactsReader _exerciseFacts;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<WeatherZoneService> _logger;

    /// <summary>Creates the zone service.</summary>
    /// <param name="dbContext">The exercise-scoped persistence context.</param>
    /// <param name="exerciseContext">The server-authoritative exercise scope (COR-001).</param>
    /// <param name="staffSession">The server-side staff session: the only source of the acting human (COR-018).</param>
    /// <param name="exerciseClock">The native per-exercise scenario clock (COR-053).</param>
    /// <param name="exerciseFacts">The one exercise-row read (time zone, stored scenario instant).</param>
    /// <param name="timeProvider">The server wall clock.</param>
    /// <param name="logger">Diagnostics logger.</param>
    public WeatherZoneService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ICurrentStaffSessionAccessor staffSession,
        IExerciseClock exerciseClock,
        ExerciseFactsReader exerciseFacts,
        TimeProvider timeProvider,
        ILogger<WeatherZoneService> logger)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(staffSession);
        ArgumentNullException.ThrowIfNull(exerciseClock);
        ArgumentNullException.ThrowIfNull(exerciseFacts);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(logger);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _staffSession = staffSession;
        _exerciseClock = exerciseClock;
        _exerciseFacts = exerciseFacts;
        _timeProvider = timeProvider;
        _logger = logger;
    }

    // ---- participant read ----------------------------------------------------------------------------

    /// <summary>
    /// <c>GET /api/weather/zones</c>: the live zones in display order as <c>{ slug, name, kind, isDefault }</c>. The weather
    /// channel gate is the endpoint's (<c>RequireChannelEnabled("weather")</c>).
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The zones, or the fail-closed 401.</returns>
    public async Task<WeatherZoneResult<IReadOnlyList<WeatherZoneDto>>> ListAsync(CancellationToken cancellationToken = default)
    {
        if (!HasResolvedScope(out _))
        {
            return WeatherZoneResult.ScopeUnresolved<IReadOnlyList<WeatherZoneDto>>();
        }

        var zones = await ReadLiveAsync(tracked: false, cancellationToken);
        var defaultId = EffectiveDefault(zones)?.Id;
        return WeatherZoneResult.Ok<IReadOnlyList<WeatherZoneDto>>(
            zones.Select(zone => new WeatherZoneDto
            {
                Slug = zone.Slug,
                Name = zone.Name,
                Kind = zone.Kind,
                IsDefault = zone.Id == defaultId,
            }).ToList());
    }

    // ---- staff read ----------------------------------------------------------------------------------

    /// <summary>
    /// <c>GET /api/weather/zones/staff</c>: every live zone as the staff DTO plus whether weather can be authored yet
    /// (<see cref="WeatherZoneStaffListDto.NoZones"/> when not). Not gated by channel enablement.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The zones and authoring state, or the fail-closed 401.</returns>
    public async Task<WeatherZoneResult<WeatherZoneStaffListDto>> ListStaffAsync(CancellationToken cancellationToken = default)
    {
        if (await ResolveCallerAsync(cancellationToken) is null)
        {
            return WeatherZoneResult.ScopeUnresolved<WeatherZoneStaffListDto>();
        }

        var zones = await ReadLiveAsync(tracked: false, cancellationToken);
        return WeatherZoneResult.Ok(new WeatherZoneStaffListDto
        {
            Zones = ToStaffList(zones),
            CanAuthor = zones.Count > 0,
            AuthoringBlockedReason = zones.Count > 0 ? null : WeatherZoneStaffListDto.NoZones,
        });
    }

    // ---- staff writes --------------------------------------------------------------------------------

    /// <summary>
    /// <c>POST /api/weather/zones</c>: validates and creates a zone (last by default). The exercise's first zone is the
    /// default whatever <c>isDefault</c> says; <c>isDefault: true</c> on a later zone moves the default to it.
    /// </summary>
    /// <param name="request">The untrusted write body.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The created zone (201), a 400, a 409 for a taken slug, or the fail-closed 401.</returns>
    public async Task<WeatherZoneResult<WeatherZoneStaffDto>> CreateAsync(
        WeatherZoneWriteRequest? request,
        CancellationToken cancellationToken = default)
    {
        var caller = await ResolveCallerAsync(cancellationToken);
        if (caller is null)
        {
            return WeatherZoneResult.ScopeUnresolved<WeatherZoneStaffDto>();
        }

        var parse = WeatherZoneWriteValidator.Parse(request, existing: null);
        if (parse.Draft is not { } draft)
        {
            return WeatherZoneResult.Invalid<WeatherZoneStaffDto>(parse.Error!);
        }

        if (await SlugConflictAsync(draft.Slug, cancellationToken) is { } slugConflict)
        {
            return WeatherZoneResult.Conflict<WeatherZoneStaffDto>(slugConflict, null);
        }

        var live = await ReadLiveAsync(tracked: true, cancellationToken);
        var time = await TimeForAsync(caller.ExerciseId, cancellationToken);
        var zone = new WeatherZone
        {
            Id = Guid.NewGuid(),
            ExerciseId = caller.ExerciseId,
            Slug = draft.Slug,
            Name = draft.Name,
            Kind = draft.Kind,
            Description = draft.Description,
            SortOrder = draft.SortOrder ?? (live.Count == 0 ? 1 : live.Max(row => row.SortOrder) + 1),
            IsDefault = live.Count == 0 || draft.IsDefault == true,
            Version = 1,
        };
        if (zone.IsDefault)
        {
            ClearOtherDefaults(live, zone);
        }

        _dbContext.WeatherZones.Add(zone);
        var defaultSlug = zone.IsDefault ? zone.Slug : EffectiveDefault(live)?.Slug;
        _dbContext.TelemetryEvents.Add(
            WeatherZoneTelemetry.ForZone(zone, WeatherZoneTelemetry.ActionCreate, defaultSlug, caller.StaffUserId, time));

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException ex)
        {
            // Only a cleared default can race here: the old default changed or was deleted since the read.
            _dbContext.ChangeTracker.Clear();
            LogLostRace(ex, WeatherZoneTelemetry.ActionCreate);
            return WeatherZoneResult.Conflict<WeatherZoneStaffDto>(ZonesChangedMessage, null);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            _dbContext.ChangeTracker.Clear();
            if (await SlugConflictAsync(draft.Slug, cancellationToken) is { } raced)
            {
                LogLostRace(ex, WeatherZoneTelemetry.ActionCreate);
                return WeatherZoneResult.Conflict<WeatherZoneStaffDto>(raced, null);
            }

            throw;
        }

        return WeatherZoneResult.Created(ToStaffDto(zone, zone.IsDefault));
    }

    /// <summary>
    /// <c>PUT /api/weather/zones/{id}</c>: replaces a zone's name, kind and description, and optionally its order and default
    /// flag (see <see cref="WeatherZoneWriteRequest"/>). The body's <c>version</c> must match; the slug cannot change.
    /// </summary>
    /// <param name="zoneId">The zone id.</param>
    /// <param name="request">The untrusted write body, including <c>version</c>.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The edited zone, the 404, a 400, a stale 409, or the fail-closed 401.</returns>
    public async Task<WeatherZoneResult<WeatherZoneStaffDto>> UpdateAsync(
        Guid zoneId,
        WeatherZoneWriteRequest? request,
        CancellationToken cancellationToken = default)
    {
        var caller = await ResolveCallerAsync(cancellationToken);
        if (caller is null)
        {
            return WeatherZoneResult.ScopeUnresolved<WeatherZoneStaffDto>();
        }

        var live = await ReadLiveAsync(tracked: true, cancellationToken);
        var zone = live.FirstOrDefault(row => row.Id == zoneId);
        if (zone is null)
        {
            return WeatherZoneResult.NotFound<WeatherZoneStaffDto>();
        }

        var parse = WeatherZoneWriteValidator.Parse(request, zone);
        if (parse.Draft is not { } draft)
        {
            return WeatherZoneResult.Invalid<WeatherZoneStaffDto>(parse.Error!);
        }

        var wasDefault = EffectiveDefault(live) == zone;
        if (request!.Version != zone.Version)
        {
            return WeatherZoneResult.Conflict<WeatherZoneStaffDto>(StaleVersionMessage, ToStaffDto(zone, wasDefault));
        }

        if (draft.IsDefault == false && wasDefault)
        {
            return WeatherZoneResult.Invalid<WeatherZoneStaffDto>(DefaultRequiredMessage);
        }

        var time = await TimeForAsync(caller.ExerciseId, cancellationToken);
        zone.Name = draft.Name;
        zone.Kind = draft.Kind;
        zone.Description = draft.Description;
        zone.SortOrder = draft.SortOrder ?? zone.SortOrder;
        if (draft.IsDefault == true)
        {
            zone.IsDefault = true;
            ClearOtherDefaults(live, zone);
        }

        zone.Version++;
        var defaultZone = EffectiveDefault(SortForDisplay(live));
        _dbContext.TelemetryEvents.Add(WeatherZoneTelemetry.ForZone(
            zone, WeatherZoneTelemetry.ActionEdit, defaultZone?.Slug, caller.StaffUserId, time));

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException ex)
        {
            _dbContext.ChangeTracker.Clear();
            LogLostRace(ex, WeatherZoneTelemetry.ActionEdit);
            return await ConflictWithCurrentAsync(zoneId, cancellationToken);
        }

        return WeatherZoneResult.Ok(ToStaffDto(zone, defaultZone == zone));
    }

    /// <summary>
    /// <c>DELETE /api/weather/zones/{id}?version=n</c>: soft-deletes the zone (XC-010, the F01 <see cref="ISoftDeletable"/>
    /// plumbing). Its slug stays reserved and still resolves for historic products
    /// (<see cref="WeatherZoneCatalog.ResolveAsync"/> with <c>includeDeleted</c>). Deleting the default promotes the first
    /// remaining zone.
    /// </summary>
    /// <param name="zoneId">The zone id.</param>
    /// <param name="version">The version the caller last read (required).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>204, the 404, a 400 without a version, a stale 409, or the fail-closed 401.</returns>
    public async Task<WeatherZoneResult<WeatherZoneStaffDto>> DeleteAsync(
        Guid zoneId,
        int? version,
        CancellationToken cancellationToken = default)
    {
        var caller = await ResolveCallerAsync(cancellationToken);
        if (caller is null)
        {
            return WeatherZoneResult.ScopeUnresolved<WeatherZoneStaffDto>();
        }

        if (version is null)
        {
            return WeatherZoneResult.Invalid<WeatherZoneStaffDto>("version is required.");
        }

        var live = await ReadLiveAsync(tracked: true, cancellationToken);
        var zone = live.FirstOrDefault(row => row.Id == zoneId);
        if (zone is null)
        {
            return WeatherZoneResult.NotFound<WeatherZoneStaffDto>();
        }

        var wasDefault = EffectiveDefault(live) == zone;
        if (version.Value != zone.Version)
        {
            return WeatherZoneResult.Conflict<WeatherZoneStaffDto>(StaleVersionMessage, ToStaffDto(zone, wasDefault));
        }

        var remaining = live.Where(row => row != zone).ToList();
        if (wasDefault && remaining.Count > 0)
        {
            // Promote the first remaining zone (display order); bump it so a concurrent edit of it is a 409, not a lost flag.
            var promoted = remaining[0];
            promoted.IsDefault = true;
            promoted.Version++;
            ClearOtherDefaults(remaining, promoted);
        }

        var time = await TimeForAsync(caller.ExerciseId, cancellationToken);
        zone.IsDefault = false;
        zone.Version++;

        // One clock read: PulseDbContext's soft-delete conversion only stamps DeletedAt when it is unset (??=), so this
        // value, shared with the telemetry event, is the one persisted.
        zone.DeletedAt = time.WallClock;
        _dbContext.WeatherZones.Remove(zone); // converted to a soft delete by PulseDbContext (XC-010)
        _dbContext.TelemetryEvents.Add(WeatherZoneTelemetry.ForZone(
            zone, WeatherZoneTelemetry.ActionDelete, EffectiveDefault(remaining)?.Slug, caller.StaffUserId, time));

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException ex)
        {
            _dbContext.ChangeTracker.Clear();
            LogLostRace(ex, WeatherZoneTelemetry.ActionDelete);
            return await ConflictWithCurrentAsync(zoneId, cancellationToken);
        }

        return WeatherZoneResult.Deleted<WeatherZoneStaffDto>();
    }

    // ---- plumbing ------------------------------------------------------------------------------------

    /// <summary>
    /// The effective default of <paramref name="zones"/> (already in display order): the first flagged zone, else the first
    /// zone, else null. The reads use it so a list names exactly one default even if storage holds zero or two.
    /// </summary>
    private static WeatherZone? EffectiveDefault(IReadOnlyList<WeatherZone> zones) =>
        zones.FirstOrDefault(zone => zone.IsDefault) ?? (zones.Count > 0 ? zones[0] : null);

    /// <summary>Clears the default flag of every zone but <paramref name="keep"/>, bumping each one it changes.</summary>
    private static void ClearOtherDefaults(IEnumerable<WeatherZone> zones, WeatherZone keep)
    {
        foreach (var other in zones.Where(row => row != keep && row.IsDefault))
        {
            other.IsDefault = false;
            other.Version++;
        }
    }

    /// <summary>Display order: <c>sortOrder</c>, then name (case-insensitive), then slug.</summary>
    private static List<WeatherZone> SortForDisplay(IEnumerable<WeatherZone> zones) =>
        zones
            .OrderBy(zone => zone.SortOrder)
            .ThenBy(zone => zone.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(zone => zone.Slug, StringComparer.Ordinal)
            .ToList();

    /// <summary>The resolved exercise's live zones in display order (the central filter drops deleted and foreign rows).</summary>
    private async Task<List<WeatherZone>> ReadLiveAsync(bool tracked, CancellationToken cancellationToken)
    {
        var query = tracked ? _dbContext.WeatherZones : _dbContext.WeatherZones.AsNoTracking();
        return SortForDisplay(await query.ToListAsync(cancellationToken));
    }

    private static List<WeatherZoneStaffDto> ToStaffList(IReadOnlyList<WeatherZone> zones)
    {
        var defaultId = EffectiveDefault(zones)?.Id;
        return zones.Select(zone => ToStaffDto(zone, zone.Id == defaultId)).ToList();
    }

    private static WeatherZoneStaffDto ToStaffDto(WeatherZone zone, bool isDefault) => new()
    {
        Id = zone.Id.ToString(),
        Slug = zone.Slug,
        Name = zone.Name,
        Kind = zone.Kind,
        Description = zone.Description,
        SortOrder = zone.SortOrder,
        IsDefault = isDefault,
        Version = zone.Version,
    };

    /// <summary>
    /// The 409 message when <paramref name="slug"/> is taken by a zone of THIS exercise, live or soft-deleted (F01's unique
    /// index is unfiltered, so a deleted zone keeps its slug and historic products keep naming it); else null.
    /// </summary>
    private async Task<string?> SlugConflictAsync(string slug, CancellationToken cancellationToken)
    {
        var holder = await _dbContext.IncludingSoftDeleted<WeatherZone>()
            .AsNoTracking()
            .Where(zone => zone.Slug == slug)
            .Select(zone => new { zone.DeletedAt })
            .FirstOrDefaultAsync(cancellationToken);

        if (holder is null)
        {
            return null;
        }

        return holder.DeletedAt is null
            ? $"slug '{slug}' is already used by another weather zone in this exercise."
            : $"slug '{slug}' belongs to a deleted weather zone and stays reserved (historic products still name it).";
    }

    private async Task<WeatherZoneResult<WeatherZoneStaffDto>> ConflictWithCurrentAsync(Guid zoneId, CancellationToken cancellationToken)
    {
        var live = await ReadLiveAsync(tracked: false, cancellationToken);
        var current = live.FirstOrDefault(row => row.Id == zoneId);
        return current is null
            ? WeatherZoneResult.Conflict<WeatherZoneStaffDto>(DeletedMessage, null)
            : WeatherZoneResult.Conflict<WeatherZoneStaffDto>(StaleVersionMessage, ToStaffDto(current, EffectiveDefault(live) == current));
    }

    /// <summary>
    /// The one clock read for an operation: the server wall clock, plus scenario time from the native exercise clock,
    /// falling back to the persisted scenario instant and finally the wall clock (the OutletService pattern).
    /// </summary>
    private async Task<WeatherZoneEventTime> TimeForAsync(Guid exerciseId, CancellationToken cancellationToken)
    {
        var facts = await _exerciseFacts.GetAsync(exerciseId, cancellationToken);
        var now = _timeProvider.GetUtcNow();
        var scenario = _exerciseClock.CurrentScenarioTime(exerciseId) ?? facts?.StoredScenarioTime ?? now;
        var timeZone = facts?.TimeZone is { } zone && !string.IsNullOrWhiteSpace(zone) ? zone : FallbackTimeZone;
        return new WeatherZoneEventTime(now, scenario, timeZone);
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
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "The weather zone {Action} lost a race to a concurrent writer; answered 409.")]
    private partial void LogLostRace(Exception exception, string action);

    /// <summary>The resolved scope and the server-side staff user behind a request.</summary>
    private sealed record Caller(Guid ExerciseId, Guid StaffUserId);
}
