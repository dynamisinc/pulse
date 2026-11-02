namespace Pulse.WebApi.Features.Press.Outlets;

using System.Text;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Channels.Outlets;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Press.Contracts;

/// <summary>
/// One newsroom per publishing organization (press-room story 01; PRS-012, foundation Q2): a child press
/// <see cref="Outlet"/> of The Wire Room, paired with the org persona, with the persona's avatar as its logo and the Wire
/// Room's skin key (the skin is inherited). Scoped, writing through the request's <see cref="PulseDbContext"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Who is a publishing org.</b> In December one org per person (Q-18): every persona bound to a <c>pio</c>
/// enrollment. <see cref="IOrgNewsroomProvisioner.EnsureForPersonaAsync"/> covers a single grant.
/// </para>
/// <para>
/// <b>Idempotent.</b> A persona that already has ANY press outlet paired with it, live or soft-deleted, is left alone: a
/// newsroom staff deleted or moved is not silently recreated, and a second run creates nothing. Slugs are unique per
/// (exercise, channel) against the unfiltered index, so a new newsroom never takes a deleted outlet's slug either.
/// </para>
/// <para>
/// <b>Isolation (XC-001).</b> Every read goes through the central exercise filter (soft-deleted reads re-apply it), so
/// another exercise's persona, Wire Room or logo is simply not found. The row is stamped with the resolved exercise
/// and the write guard checks it.
/// </para>
/// <para>
/// <b>Telemetry.</b> One F03 <c>outlet_action</c> create event per newsroom (<c>payload.source = org-newsroom</c>), in
/// the same <c>SaveChanges</c>; the actor is the staff user behind the request, or none for a participant-session grant.
/// </para>
/// <para>
/// Written straight through <see cref="PulseDbContext"/> rather than <see cref="OutletService.CreateAsync"/>, because
/// that path requires a staff session and a grant can happen in a participant one; the rows it writes satisfy every
/// rule <c>OutletService</c> enforces (slug shape and uniqueness, same-exercise parent/persona/image logo).
/// </para>
/// </remarks>
public sealed partial class OrgNewsroomProvisioner : IOrgNewsroomProvisioner
{
    /// <summary>The <c>payload.source</c> of the outlet events this writes.</summary>
    public const string TelemetrySource = "org-newsroom";

    private const string FallbackSlug = "newsroom";
    private const string FallbackTimeZone = "UTC";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentStaffSessionAccessor _staffSession;
    private readonly IExerciseClock _exerciseClock;
    private readonly ExerciseFactsReader _exerciseFacts;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<OrgNewsroomProvisioner> _logger;

    /// <summary>Creates the provisioner.</summary>
    /// <param name="dbContext">The exercise-scoped persistence context.</param>
    /// <param name="exerciseContext">The server-authoritative exercise scope (COR-001).</param>
    /// <param name="staffSession">The staff session, if any (the telemetry actor).</param>
    /// <param name="exerciseClock">The native per-exercise scenario clock (COR-053).</param>
    /// <param name="exerciseFacts">The one exercise-row read (time zone, stored scenario instant).</param>
    /// <param name="timeProvider">The server wall clock.</param>
    /// <param name="logger">Diagnostics logger.</param>
    public OrgNewsroomProvisioner(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ICurrentStaffSessionAccessor staffSession,
        IExerciseClock exerciseClock,
        ExerciseFactsReader exerciseFacts,
        TimeProvider timeProvider,
        ILogger<OrgNewsroomProvisioner> logger)
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

    /// <inheritdoc />
    public async Task<OrgNewsroomProvisionResult> ProvisionAsync(CancellationToken cancellationToken = default)
    {
        if (!HasResolvedScope(out var exerciseId))
        {
            return OrgNewsroomProvisionResult.Nothing(OrgNewsroomProvisionStatus.ScopeUnresolved);
        }

        var orgIds = await _dbContext.Enrollments
            .AsNoTracking()
            .Where(e => e.Role == EnrollmentRoles.Pio && e.PersonaId != null)
            .Select(e => e.PersonaId!.Value)
            .Distinct()
            .ToListAsync(cancellationToken);

        return await RunAsync(exerciseId, orgIds, cancellationToken);
    }

    /// <inheritdoc />
    public async Task<OrgNewsroomProvisionResult> EnsureForPersonaAsync(Guid personaId, CancellationToken cancellationToken = default)
    {
        if (!HasResolvedScope(out var exerciseId))
        {
            return OrgNewsroomProvisionResult.Nothing(OrgNewsroomProvisionStatus.ScopeUnresolved);
        }

        if (personaId == Guid.Empty
            || !await _dbContext.Personas.AsNoTracking().AnyAsync(p => p.Id == personaId, cancellationToken))
        {
            return OrgNewsroomProvisionResult.Nothing(OrgNewsroomProvisionStatus.PersonaNotFound);
        }

        return await RunAsync(exerciseId, [personaId], cancellationToken);
    }

    /// <summary>
    /// A slug for <paramref name="handle"/> (else <paramref name="displayName"/>): lowercase <c>[a-z0-9-]</c>, at most
    /// <see cref="Outlet.MaxSlugLength"/> characters, and not in <paramref name="taken"/> (a <c>-2</c>, <c>-3</c>, ...
    /// suffix when it is).
    /// </summary>
    /// <param name="handle">The persona handle (with or without <c>@</c>).</param>
    /// <param name="displayName">The persona display name.</param>
    /// <param name="taken">The channel's slugs, live and deleted.</param>
    /// <returns>A free, valid slug.</returns>
    internal static string UniqueSlug(string? handle, string? displayName, IReadOnlySet<string> taken)
    {
        var stem = Slugify(handle);
        if (stem.Length == 0)
        {
            stem = Slugify(displayName);
        }

        if (stem.Length == 0)
        {
            stem = FallbackSlug;
        }

        if (!taken.Contains(stem))
        {
            return stem;
        }

        for (var n = 2; ; n++)
        {
            var suffix = $"-{n}";
            var candidate = stem[..Math.Min(stem.Length, Outlet.MaxSlugLength - suffix.Length)].TrimEnd('-') + suffix;
            if (!taken.Contains(candidate))
            {
                return candidate;
            }
        }
    }

    private static string Slugify(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        var builder = new StringBuilder(value.Length);
        foreach (var c in value.Trim().TrimStart('@').ToLowerInvariant())
        {
            if (c is >= 'a' and <= 'z' or >= '0' and <= '9')
            {
                builder.Append(c);
            }
            else if (builder.Length > 0 && builder[^1] != '-')
            {
                builder.Append('-');
            }
        }

        var slug = builder.ToString().Trim('-');
        return slug.Length <= Outlet.MaxSlugLength ? slug : slug[..Outlet.MaxSlugLength].TrimEnd('-');
    }

    private async Task<OrgNewsroomProvisionResult> RunAsync(
        Guid exerciseId, IReadOnlyCollection<Guid> orgIds, CancellationToken cancellationToken)
    {
        try
        {
            return await ProvisionOnceAsync(exerciseId, orgIds, cancellationToken);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // Best effort: there is no unique index on (exercise, channel, paired persona), so two concurrent runs are
            // kept from both creating a newsroom only because they derive the SAME slug for the same persona, and the
            // slug index refuses the second. A second lost race propagates.
            // A concurrent run (or an outlet create) took a slug first. Nothing of this attempt was saved; the retry
            // re-reads, so a newsroom the other run created now counts as existing.
            _dbContext.ChangeTracker.Clear();
            LogLostRace(ex);
            return await ProvisionOnceAsync(exerciseId, orgIds, cancellationToken);
        }
    }

    private async Task<OrgNewsroomProvisionResult> ProvisionOnceAsync(
        Guid exerciseId, IReadOnlyCollection<Guid> orgIds, CancellationToken cancellationToken)
    {
        var wireRoom = await _dbContext.Outlets
            .AsNoTracking()
            .Where(o => o.ChannelId == ChannelVocabulary.Press && o.Slug == PressVocabulary.WireRoomSlug && o.ParentOutletId == null)
            .Select(o => new { o.Id, o.SkinKey })
            .FirstOrDefaultAsync(cancellationToken);
        if (wireRoom is null)
        {
            return OrgNewsroomProvisionResult.Nothing(OrgNewsroomProvisionStatus.NoWireRoom);
        }

        if (orgIds.Count == 0)
        {
            return new OrgNewsroomProvisionResult(OrgNewsroomProvisionStatus.Ok, [], []);
        }

        var personas = await _dbContext.Personas
            .AsNoTracking()
            .Where(p => orgIds.Contains(p.Id))
            .OrderBy(p => p.DisplayName)
            .ThenBy(p => p.Id)
            .Select(p => new { p.Id, p.DisplayName, p.Handle, p.AvatarMediaId })
            .ToListAsync(cancellationToken);
        var personaIds = personas.Select(p => p.Id).ToList();

        var paired = (await _dbContext.IncludingSoftDeleted<Outlet>()
                .Where(o => o.ChannelId == ChannelVocabulary.Press && o.PairedPersonaId != null
                    && personaIds.Contains(o.PairedPersonaId.Value))
                .Select(o => o.PairedPersonaId!.Value)
                .ToListAsync(cancellationToken))
            .ToHashSet();
        var taken = (await _dbContext.IncludingSoftDeleted<Outlet>()
                .Where(o => o.ChannelId == ChannelVocabulary.Press)
                .Select(o => o.Slug)
                .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.Ordinal);
        var avatarIds = personas.Where(p => p.AvatarMediaId is not null).Select(p => p.AvatarMediaId!.Value).ToList();
        var imageLogos = (await _dbContext.MediaAssets
                .AsNoTracking()
                .Where(m => avatarIds.Contains(m.Id) && m.Kind == MediaKinds.Image)
                .Select(m => m.Id)
                .ToListAsync(cancellationToken))
            .ToHashSet();
        var nextOrder = (await _dbContext.Outlets
            .Where(o => o.ChannelId == ChannelVocabulary.Press)
            .MaxAsync(o => (int?)o.SortOrder, cancellationToken) ?? -1) + 1;

        var created = new List<Outlet>();
        var existing = new List<Guid>();
        OutletEventTime? time = null;
        Guid? staffUserId = null;
        foreach (var persona in personas)
        {
            if (paired.Contains(persona.Id))
            {
                existing.Add(persona.Id);
                continue;
            }

            if (time is null)
            {
                time = await TimeForAsync(exerciseId, cancellationToken);
                staffUserId = (await _staffSession.GetCurrentStaffSessionAsync(cancellationToken))?.StaffUserId;
            }

            var slug = UniqueSlug(persona.Handle, persona.DisplayName, taken);
            taken.Add(slug);
            var name = persona.DisplayName.Trim();
            var outlet = new Outlet
            {
                Id = Guid.NewGuid(),
                ExerciseId = exerciseId,
                ChannelId = ChannelVocabulary.Press,
                Slug = slug,
                Name = Truncate(name, Outlet.MaxNameLength),
                ParentOutletId = wireRoom.Id,
                PairedPersonaId = persona.Id,
                LogoMediaId = persona.AvatarMediaId is { } avatar && imageLogos.Contains(avatar) ? avatar : null,
                SkinKey = wireRoom.SkinKey,
                SkinOverridesJson = null,
                SortOrder = nextOrder++,
                Enabled = true,
                Version = 1,
            };
            created.Add(outlet);
            _dbContext.Outlets.Add(outlet);

            var telemetry = OutletTelemetry.ForOutlet(
                outlet, OutletTelemetry.ActionCreate, staffUserId ?? Guid.Empty, time, TelemetrySource);
            telemetry.Actor.ActingHumanId = staffUserId?.ToString();
            _dbContext.TelemetryEvents.Add(telemetry);
        }

        if (created.Count > 0)
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        return new OrgNewsroomProvisionResult(OrgNewsroomProvisionStatus.Ok, [.. created.Select(o => o.Id)], existing);
    }

    /// <summary>The one clock read for a run (the <c>OutletService</c> rule: native clock, stored instant, wall clock).</summary>
    private async Task<OutletEventTime> TimeForAsync(Guid exerciseId, CancellationToken cancellationToken)
    {
        var facts = await _exerciseFacts.GetAsync(exerciseId, cancellationToken);
        var now = _timeProvider.GetUtcNow();
        var scenario = _exerciseClock.CurrentScenarioTime(exerciseId) ?? facts?.StoredScenarioTime ?? now;
        var timeZone = facts?.TimeZone is { } zone && !string.IsNullOrWhiteSpace(zone) ? zone : FallbackTimeZone;
        return new OutletEventTime(now, scenario, timeZone);
    }

    /// <summary>Cuts to <paramref name="maxLength"/> UTF-16 units (the column bound) without splitting a surrogate pair.</summary>
    private static string Truncate(string value, int maxLength)
    {
        if (value.Length <= maxLength)
        {
            return value;
        }

        var cut = char.IsHighSurrogate(value[maxLength - 1]) ? maxLength - 1 : maxLength;
        return value[..cut].TrimEnd();
    }

    private bool HasResolvedScope(out Guid exerciseId)
    {
        exerciseId = _exerciseContext.CurrentExerciseId ?? Guid.Empty;
        return exerciseId != Guid.Empty;
    }

    private static bool IsUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is SqlException { Number: 2601 or 2627 };

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Org newsroom provisioning lost a slug race to a concurrent writer; retrying once.")]
    private partial void LogLostRace(Exception exception);
}
