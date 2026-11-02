namespace Pulse.WebApi.Features.Portal.Config;

using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Channels.Enablement;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Features.Portal.Contracts;
using Pulse.WebApi.Features.Portal.Data;

/// <summary>
/// The portal config (exercise-portal story 03; PRT-002, PRT-003, COR-030, COR-066): the participant projection behind
/// <c>GET /api/portal</c> and the staff read/write behind <c>GET|PUT /api/portal/config</c>. Scoped, matching the
/// <see cref="PulseDbContext"/> unit of work it writes through.
/// </summary>
/// <remarks>
/// <para>
/// <b>Scope is server-authoritative (XC-001).</b> Every read goes through the central exercise filter
/// (<see cref="PortalDataQueries.FindPortalConfigAsync"/>), and a write's row is stamped with
/// <see cref="IExerciseContext.CurrentExerciseId"/> and checked by <see cref="PortalWriteScope"/>; no member takes an
/// exercise id. Another exercise's logo is "not usable", worded exactly as an unknown one.
/// </para>
/// <para>
/// <b>Absent row = defaults.</b> No read writes a row; the first successful <c>PUT</c> (with <c>version: 0</c>) creates
/// it. A <c>PUT</c> that changes nothing writes nothing and emits nothing.
/// </para>
/// <para>
/// <b>Clean hiding (PRT-003, D2-005).</b> The participant module list is the stored order, filtered to modules enabled
/// in config AND whose source channel <see cref="IChannelEnablement"/> reports enabled. A hidden module is absent, never
/// flagged.
/// </para>
/// <para>
/// <b>Concurrency.</b> <see cref="PortalConfig.Version"/> is an EF concurrency token and the row is unique per exercise.
/// A stale <c>version</c>, a lost update race, or a lost first-create race is <see cref="PortalWriteOutcome.Conflict"/>.
/// </para>
/// </remarks>
public sealed partial class PortalConfigService : IPortalConfigService
{
    /// <summary>The readable refusal for a stale <c>version</c>.</summary>
    public const string StaleVersionMessage = "Changed by someone else. Refresh to see the latest version.";

    private const string FallbackTimeZone = "UTC";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly IChannelEnablement _channelEnablement;
    private readonly ISkinOverridesValidator _skinValidator;
    private readonly IMediaUrlSigner _mediaUrlSigner;
    private readonly IExerciseClock _exerciseClock;
    private readonly ExerciseFactsReader _exerciseFacts;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<PortalConfigService> _logger;

    /// <summary>Creates the portal config service.</summary>
    /// <param name="dbContext">The exercise-scoped persistence context.</param>
    /// <param name="exerciseContext">The server-authoritative exercise scope (COR-001).</param>
    /// <param name="channelEnablement">The F08 channel gate: which module sources are enabled.</param>
    /// <param name="skinValidator">F03's public FC-3b skin-overrides validator.</param>
    /// <param name="mediaUrlSigner">Signs the logo read URL.</param>
    /// <param name="exerciseClock">The native per-exercise scenario clock (COR-053).</param>
    /// <param name="exerciseFacts">The one exercise-row read (time zone, stored scenario instant).</param>
    /// <param name="timeProvider">The server wall clock.</param>
    /// <param name="logger">Diagnostics logger.</param>
    public PortalConfigService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        IChannelEnablement channelEnablement,
        ISkinOverridesValidator skinValidator,
        IMediaUrlSigner mediaUrlSigner,
        IExerciseClock exerciseClock,
        ExerciseFactsReader exerciseFacts,
        TimeProvider timeProvider,
        ILogger<PortalConfigService> logger)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(channelEnablement);
        ArgumentNullException.ThrowIfNull(skinValidator);
        ArgumentNullException.ThrowIfNull(mediaUrlSigner);
        ArgumentNullException.ThrowIfNull(exerciseClock);
        ArgumentNullException.ThrowIfNull(exerciseFacts);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(logger);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _channelEnablement = channelEnablement;
        _skinValidator = skinValidator;
        _mediaUrlSigner = mediaUrlSigner;
        _exerciseClock = exerciseClock;
        _exerciseFacts = exerciseFacts;
        _timeProvider = timeProvider;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<PortalDto> GetParticipantPortalAsync(CancellationToken cancellationToken = default)
    {
        var row = await _dbContext.FindPortalConfigAsync(cancellationToken);
        var name = PortalConfigWriteValidator.ResolveName(row?.PortalName, row?.CityName);

        var modules = new List<PortalModuleDto>();
        var enabledChannels = new Dictionary<string, bool>(StringComparer.Ordinal);
        foreach (var setting in PortalModuleSettings.Read(row?.ModulesJson))
        {
            if (!setting.Enabled)
            {
                continue;
            }

            var channelId = PortalVocabulary.ModuleChannelIds[setting.Id];
            if (!enabledChannels.TryGetValue(channelId, out var enabled))
            {
                enabled = await _channelEnablement.IsEnabledAsync(channelId, cancellationToken);
                enabledChannels[channelId] = enabled;
            }

            if (enabled)
            {
                modules.Add(new PortalModuleDto { Id = setting.Id, ChannelId = channelId });
            }
        }

        var hasResources = await _dbContext.LivePortalResources().AnyAsync(resource => resource.Visible, cancellationToken);

        return new PortalDto
        {
            Masthead = new PortalMastheadDto
            {
                Name = name,
                Tagline = row?.Tagline,
                Logo = await SignLogoAsync(row?.LogoMediaId, name, cancellationToken),
            },
            LayoutKey = ReadLayoutKey(row),
            Modules = modules,
            SkinOverrides = ReadSkinOverrides(row?.SkinOverridesJson),
            HasResources = hasResources,
        };
    }

    /// <inheritdoc />
    public async Task<PortalConfigStaffDto> GetStaffConfigAsync(CancellationToken cancellationToken = default) =>
        await ProjectStaffAsync(await _dbContext.FindPortalConfigAsync(cancellationToken), cancellationToken);

    /// <inheritdoc />
    public async Task<PortalWriteResult<PortalConfigStaffDto>> UpdateConfigAsync(
        PortalConfigWriteRequest request,
        PortalStaffCaller caller,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(caller);
        var exerciseId = _exerciseContext.CurrentExerciseId ?? Guid.Empty;
        if (exerciseId == Guid.Empty)
        {
            throw new ExerciseScopeViolationException("Refusing a portal config write with no resolved exercise (COR-001/XC-001).");
        }

        var parse = PortalConfigWriteValidator.Parse(request, _skinValidator);
        if (parse.Draft is not { } draft)
        {
            return Invalid(parse.Errors);
        }

        var row = await _dbContext.PortalConfigs.SingleOrDefaultAsync(cancellationToken);
        if (request.Version != (row?.Version ?? 0))
        {
            return Conflict();
        }

        // Through the central filter, so another exercise's asset is "not found", with the unknown-id message (COR-001).
        if (draft.LogoMediaId is { } logoId
            && !await _dbContext.MediaAssets.AsNoTracking()
                .AnyAsync(asset => asset.Id == logoId && asset.Kind == MediaKinds.Image, cancellationToken))
        {
            return Invalid([PortalConfigWriteValidator.LogoNotUsableMessage]);
        }

        var fields = ChangedFields(row, draft);
        if (fields.Count == 0)
        {
            return new PortalWriteResult<PortalConfigStaffDto>
            {
                Outcome = PortalWriteOutcome.Ok,
                Value = await ProjectStaffAsync(row, cancellationToken),
            };
        }

        var creating = row is null;
        row ??= new PortalConfig
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            LayoutKey = PortalVocabulary.DefaultLayoutKey,
            Version = 0,
        };
        PortalWriteScope.EnsureInScope(_exerciseContext, row);

        row.PortalName = draft.PortalName;
        row.CityName = draft.CityName;
        row.Tagline = draft.Tagline;
        row.LogoMediaId = draft.LogoMediaId;
        row.LayoutKey = draft.LayoutKey;
        row.ModulesJson = draft.ModulesJson;
        row.SkinOverridesJson = draft.SkinOverridesJson;
        row.Version++;
        if (creating)
        {
            _dbContext.PortalConfigs.Add(row);
        }

        var time = await TimeForAsync(exerciseId, cancellationToken);
        _dbContext.TelemetryEvents.Add(PortalConfigTelemetry.ForChange(row, fields, caller.ActingHumanId, time));

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            _dbContext.ChangeTracker.Clear();
            LogLostRace(creating ? "create" : "update");
            return Conflict();
        }
        catch (DbUpdateException ex) when (creating && IsUniqueViolation(ex))
        {
            _dbContext.ChangeTracker.Clear();
            LogLostRace("create");
            return Conflict();
        }
        catch (DbUpdateException ex) when (draft.LogoMediaId is not null && IsLogoForeignKeyViolation(ex))
        {
            // The logo was removed between the check above and the save: the composite (ExerciseId, LogoMediaId) key
            // refuses it, and the caller gets the same "not usable" 400 as any other unusable logo.
            _dbContext.ChangeTracker.Clear();
            return Invalid([PortalConfigWriteValidator.LogoNotUsableMessage]);
        }

        return new PortalWriteResult<PortalConfigStaffDto>
        {
            Outcome = PortalWriteOutcome.Ok,
            Value = await ProjectStaffAsync(row, cancellationToken),
        };
    }

    /// <summary>
    /// The changed field names, in wire casing, comparing against the row or (no row) against the defaults. Names only:
    /// the event never carries a value (PC-6).
    /// </summary>
    private static List<string> ChangedFields(PortalConfig? row, PortalConfigDraft draft)
    {
        var fields = new List<string>();
        AddIfChanged(fields, "portalName", row?.PortalName, draft.PortalName);
        AddIfChanged(fields, "cityName", row?.CityName, draft.CityName);
        AddIfChanged(fields, "tagline", row?.Tagline, draft.Tagline);
        AddIfChanged(fields, "logoMediaId", row?.LogoMediaId?.ToString(), draft.LogoMediaId?.ToString());
        AddIfChanged(fields, "layoutKey", row?.LayoutKey ?? PortalVocabulary.DefaultLayoutKey, draft.LayoutKey);
        AddIfChanged(
            fields,
            "modules",
            PortalModuleSettings.Serialize(PortalModuleSettings.Read(row?.ModulesJson)),
            draft.ModulesJson);
        AddIfChanged(fields, "skinOverrides", row?.SkinOverridesJson, draft.SkinOverridesJson);
        return fields;
    }

    private static void AddIfChanged(List<string> fields, string name, string? before, string? after)
    {
        if (!string.Equals(before, after, StringComparison.Ordinal))
        {
            fields.Add(name);
        }
    }

    private async Task<PortalConfigStaffDto> ProjectStaffAsync(PortalConfig? row, CancellationToken cancellationToken)
    {
        var name = PortalConfigWriteValidator.ResolveName(row?.PortalName, row?.CityName);
        return new PortalConfigStaffDto
        {
            PortalName = row?.PortalName,
            CityName = row?.CityName,
            Tagline = row?.Tagline,
            Logo = await SignLogoAsync(row?.LogoMediaId, name, cancellationToken),
            LayoutKey = ReadLayoutKey(row),
            Modules = PortalModuleSettings.Complete(PortalModuleSettings.Read(row?.ModulesJson)),
            SkinOverrides = ReadSkinOverrides(row?.SkinOverridesJson),
            ResolvedName = name,
            Version = row?.Version ?? 0,
        };
    }

    /// <summary>A stored layout outside the PC-1 allowlist (a hand-edited row) reads as the default.</summary>
    private static string ReadLayoutKey(PortalConfig? row) =>
        row is not null && PortalVocabulary.IsLayoutKey(row.LayoutKey) ? row.LayoutKey : PortalVocabulary.DefaultLayoutKey;

    /// <summary>The stored overrides; an unreadable value reads as none (the portal renders its registered skin).</summary>
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
    /// Signs the logo through the existing media seam (one scoped asset read, one signer call). A missing or non-image
    /// asset, or a storage fault (logged), reads as no logo, never a failed read; cancellation and an
    /// <see cref="ExerciseScopeViolationException"/> (an isolation signal) are not absorbed.
    /// </summary>
    private async Task<ContentMediaDto?> SignLogoAsync(Guid? mediaId, string alt, CancellationToken cancellationToken)
    {
        if (mediaId is not { } id)
        {
            return null;
        }

        var asset = await _dbContext.MediaAssets
            .AsNoTracking()
            .FirstOrDefaultAsync(row => row.Id == id && row.Kind == MediaKinds.Image, cancellationToken);
        if (asset is null)
        {
            return null;
        }

        IReadOnlyDictionary<Guid, string> urls;
        try
        {
            urls = await _mediaUrlSigner.GetReadUrlsAsync([asset], cancellationToken);
        }
#pragma warning disable CA1031 // A storage fault must degrade the read to a logo-less masthead, never fail it.
        catch (Exception ex) when (ex is not OperationCanceledException and not ExerciseScopeViolationException)
        {
            LogLogoSigningFailed(ex);
            return null;
        }
#pragma warning restore CA1031

        return urls.TryGetValue(id, out var url)
            ? new ContentMediaDto
            {
                Id = asset.Id.ToString(),
                Kind = asset.Kind,
                Role = ChannelVocabulary.MediaRoleInline,
                Url = url,
                ContentType = asset.ContentType,
                Width = asset.Width,
                Height = asset.Height,
                DurationSec = asset.DurationSec,
                Alt = alt,
            }
            : null;
    }

    /// <summary>
    /// The one clock read for a write: the server wall clock, plus scenario time from the native exercise clock, falling
    /// back to the persisted scenario instant and finally the wall clock (the <c>OutletService</c> pattern).
    /// </summary>
    private async Task<PortalEventTime> TimeForAsync(Guid exerciseId, CancellationToken cancellationToken)
    {
        var facts = await _exerciseFacts.GetAsync(exerciseId, cancellationToken);
        var now = _timeProvider.GetUtcNow();
        var scenario = _exerciseClock.CurrentScenarioTime(exerciseId) ?? facts?.StoredScenarioTime ?? now;
        var timeZone = facts?.TimeZone is { } zone && !string.IsNullOrWhiteSpace(zone) ? zone : FallbackTimeZone;
        return new PortalEventTime(now, scenario, timeZone);
    }

    private static PortalWriteResult<PortalConfigStaffDto> Invalid(IReadOnlyList<string> errors) =>
        new() { Outcome = PortalWriteOutcome.Invalid, Errors = errors };

    private static PortalWriteResult<PortalConfigStaffDto> Conflict() =>
        new() { Outcome = PortalWriteOutcome.Conflict, Errors = [StaleVersionMessage] };

    /// <summary>Whether a save failed on a unique index (SQL Server 2601 duplicate key, 2627 unique constraint).</summary>
    private static bool IsUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is SqlException { Number: 2601 or 2627 };

    /// <summary>The F01 M1 composite key from a portal config's logo to its media asset.</summary>
    private const string LogoForeignKeyName = "FK_PortalConfigs_MediaAssets_ExerciseId_LogoMediaId";

    /// <summary>Whether a save failed on the LOGO foreign key (SQL Server 547 naming that constraint), and no other.</summary>
    private static bool IsLogoForeignKeyViolation(DbUpdateException exception) =>
        exception.InnerException is SqlException { Number: 547 } sql
        && sql.Message.Contains(LogoForeignKeyName, StringComparison.Ordinal);

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Signing the portal logo failed; the masthead is served without a logo.")]
    private partial void LogLogoSigningFailed(Exception exception);

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Warning,
        Message = "A portal config {Action} lost a race to a concurrent writer; answered 409.")]
    private partial void LogLostRace(string action);
}
