namespace Pulse.WebApi.Features.ExerciseConfiguration;

using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Social;

/// <summary>
/// Ingest validation + normalization for the COR-030 per-exercise settings write — the settings analogue of
/// <c>Features/Identity/Accounts/AccountFieldRules.cs</c>, whose length-bounded, fail-closed-with-400 shape
/// this mirrors.
/// </summary>
/// <remarks>
/// <para>
/// <b>NFR-004: strip, never entity-encode.</b> Free text that can reach a participant surface (world name,
/// brand name, outlet names) goes through the SHIPPED <see cref="PostSanitizer"/> — the same function the
/// post ingest path uses. Nothing here hand-rolls a sanitizer and nothing reaches for <c>HtmlEncoder</c>:
/// the participant render path is a React text node that already escapes <c>&amp; &lt; &gt; " '</c>, so
/// encoding server-side would double-encode ordinary text and break the fiction.
/// </para>
/// <para>
/// <b>Bounds are the schema's bounds.</b> Each maximum below matches the column width configured in
/// <c>PulseDbContext.OnModelCreating</c>, so a value that validates always fits and a write can never fail
/// late with a truncation error. <c>Exercise.Name</c> is the one column with no configured width; the API
/// bounds it anyway (a DoS/UI guard).
/// </para>
/// </remarks>
public static partial class ExerciseSettingsFieldRules
{
    /// <summary>Maximum internal (staff-facing) exercise name length.</summary>
    public const int MaxNameLength = 200;

    /// <summary>Maximum participant-visible world-name length (matches the column width).</summary>
    public const int MaxWorldNameLength = 200;

    /// <summary>Maximum BCP-47 locale-tag length (matches the column width).</summary>
    public const int MaxLocaleLength = 35;

    /// <summary>Maximum participant-visible brand-name length (matches the column width).</summary>
    public const int MaxBrandNameLength = 200;

    /// <summary>Maximum CSS color length (matches the column width; the hex grammar is far shorter).</summary>
    public const int MaxColorLength = 32;

    /// <summary>Maximum IANA time-zone id length (mirrors <c>BootstrapService</c>'s bound).</summary>
    public const int MaxTimeZoneLength = 128;

    /// <summary>Maximum number of outlet-name entries accepted on a write.</summary>
    public const int MaxOutletNameEntries = 32;

    /// <summary>Maximum outlet-name key (outlet/channel id) length.</summary>
    public const int MaxOutletKeyLength = 64;

    /// <summary>Maximum outlet display-name length.</summary>
    public const int MaxOutletNameLength = 120;

    /// <summary>A CSS hex color — <c>#rgb</c> or <c>#rrggbb</c>, the two forms every channel skin consumes.</summary>
    [GeneratedRegex("^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$", RegexOptions.CultureInvariant)]
    private static partial Regex HexColorRegex();

    /// <summary>A BCP-47 language tag in its common subtag form (e.g. <c>en</c>, <c>en-US</c>, <c>sr-Latn-RS</c>).</summary>
    [GeneratedRegex("^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$", RegexOptions.CultureInvariant)]
    private static partial Regex Bcp47Regex();

    /// <summary>Trims, strips markup and length-checks the REQUIRED staff-facing exercise name.</summary>
    /// <param name="raw">The raw name from the request body.</param>
    /// <param name="name">The sanitized name on success.</param>
    /// <param name="error">A human-readable reason on failure.</param>
    /// <returns><c>true</c> when the name is valid.</returns>
    public static bool TryNormalizeName(string? raw, [NotNullWhen(true)] out string? name, [NotNullWhen(false)] out string? error) =>
        TryNormalizeRequiredText(raw, "name", MaxNameLength, out name, out error);

    /// <summary>
    /// Trims, strips markup and length-checks the OPTIONAL participant-visible world name. An absent/blank
    /// value clears the setting (<c>null</c>); a value that is entirely markup is rejected rather than stored
    /// as an empty world name.
    /// </summary>
    /// <param name="raw">The raw world name from the request body.</param>
    /// <param name="worldName">The sanitized world name, or <c>null</c> to clear it.</param>
    /// <param name="error">A human-readable reason on failure.</param>
    /// <returns><c>true</c> when the world name is valid or absent.</returns>
    public static bool TryNormalizeWorldName(string? raw, out string? worldName, [NotNullWhen(false)] out string? error) =>
        TryNormalizeOptionalText(raw, "worldName", MaxWorldNameLength, out worldName, out error);

    /// <summary>
    /// Trims, strips markup and length-checks the OPTIONAL participant-visible brand name. Rejecting an
    /// all-markup value matters here: the frontend brand guard rejects an empty <c>name</c> outright, which
    /// would drop the whole brand-tokens response and un-skin the participant world.
    /// </summary>
    /// <param name="raw">The raw brand name from the request body.</param>
    /// <param name="brandName">The sanitized brand name, or <c>null</c> to clear it.</param>
    /// <param name="error">A human-readable reason on failure.</param>
    /// <returns><c>true</c> when the brand name is valid or absent.</returns>
    public static bool TryNormalizeBrandName(string? raw, out string? brandName, [NotNullWhen(false)] out string? error) =>
        TryNormalizeOptionalText(raw, "brandName", MaxBrandNameLength, out brandName, out error);

    /// <summary>Validates the OPTIONAL BCP-47 locale tag; an absent/blank value clears the setting.</summary>
    /// <param name="raw">The raw locale from the request body.</param>
    /// <param name="locale">The normalized locale, or <c>null</c> to clear it.</param>
    /// <param name="error">A human-readable reason on failure.</param>
    /// <returns><c>true</c> when the locale is valid or absent.</returns>
    public static bool TryNormalizeLocale(string? raw, out string? locale, [NotNullWhen(false)] out string? error)
    {
        locale = null;
        error = null;

        var trimmed = raw?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return true;
        }

        if (trimmed.Length > MaxLocaleLength)
        {
            error = $"locale must be at most {MaxLocaleLength} characters.";
            return false;
        }

        if (!Bcp47Regex().IsMatch(trimmed))
        {
            error = "locale must be a BCP-47 language tag (e.g. 'en-US').";
            return false;
        }

        locale = trimmed;
        return true;
    }

    /// <summary>
    /// Validates the REQUIRED single IANA time zone (XC-008). Deliberately rejects a Windows time-zone id
    /// (e.g. <c>Eastern Standard Time</c>), which resolves on a Windows host but is not the platform's
    /// vocabulary — the value flows onto the frozen <c>ExerciseScope.timeZone</c> and every participant-visible
    /// timestamp (COR-053), where a client must be able to read it as IANA.
    /// </summary>
    /// <param name="raw">The raw time zone from the request body.</param>
    /// <param name="timeZone">The validated IANA zone id on success.</param>
    /// <param name="error">A human-readable reason on failure.</param>
    /// <returns><c>true</c> when the zone is a resolvable IANA zone.</returns>
    public static bool TryNormalizeTimeZone(string? raw, [NotNullWhen(true)] out string? timeZone, [NotNullWhen(false)] out string? error)
    {
        timeZone = null;

        var trimmed = raw?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            error = "timeZone is required (one IANA zone per exercise, XC-008).";
            return false;
        }

        if (trimmed.Length > MaxTimeZoneLength)
        {
            error = $"timeZone must be at most {MaxTimeZoneLength} characters.";
            return false;
        }

        // 'UTC' is the platform default and is accepted verbatim; every other value must be a recognized IANA
        // id (the conversion probe is what rejects a Windows id) AND resolve on this host.
        var isIana = string.Equals(trimmed, "UTC", StringComparison.Ordinal)
            || TimeZoneInfo.TryConvertIanaIdToWindowsId(trimmed, out _);

        if (!isIana || !TimeZoneInfo.TryFindSystemTimeZoneById(trimmed, out _))
        {
            error = $"'{trimmed}' is not a recognized IANA time zone (e.g. 'America/New_York').";
            return false;
        }

        timeZone = trimmed;
        error = null;
        return true;
    }

    /// <summary>Validates an OPTIONAL CSS hex color; an absent/blank value clears the setting.</summary>
    /// <param name="raw">The raw color from the request body.</param>
    /// <param name="field">The wire field name, used in the failure message.</param>
    /// <param name="color">The normalized color, or <c>null</c> to clear it.</param>
    /// <param name="error">A human-readable reason on failure.</param>
    /// <returns><c>true</c> when the color is valid or absent.</returns>
    public static bool TryNormalizeColor(string? raw, string field, out string? color, [NotNullWhen(false)] out string? error)
    {
        ArgumentNullException.ThrowIfNull(field);

        color = null;
        error = null;

        var trimmed = raw?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return true;
        }

        if (trimmed.Length > MaxColorLength || !HexColorRegex().IsMatch(trimmed))
        {
            error = $"{field} must be a CSS hex color such as '#2b5f75'.";
            return false;
        }

        color = trimmed;
        return true;
    }

    /// <summary>
    /// Validates, sanitizes and bounds the OPTIONAL per-outlet display names. Keys and values are both
    /// stripped through <see cref="PostSanitizer"/> (NFR-004) because both can reach a channel skin; an
    /// absent/empty map clears the setting.
    /// </summary>
    /// <param name="raw">The raw outlet-name map from the request body.</param>
    /// <param name="outletNames">The sanitized map, or <c>null</c> to clear it.</param>
    /// <param name="error">A human-readable reason on failure.</param>
    /// <returns><c>true</c> when the map is valid or absent.</returns>
    public static bool TryNormalizeOutletNames(
        IReadOnlyDictionary<string, string>? raw,
        out IReadOnlyDictionary<string, string>? outletNames,
        [NotNullWhen(false)] out string? error)
    {
        outletNames = null;
        error = null;

        if (raw is null || raw.Count == 0)
        {
            return true;
        }

        if (raw.Count > MaxOutletNameEntries)
        {
            error = $"outletNames must contain at most {MaxOutletNameEntries} entries.";
            return false;
        }

        var sanitized = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (key, value) in raw)
        {
            var outletKey = PostSanitizer.Sanitize(key ?? string.Empty).Trim();
            if (outletKey.Length == 0 || outletKey.Length > MaxOutletKeyLength)
            {
                error = $"each outletNames key must be 1-{MaxOutletKeyLength} characters of non-markup text.";
                return false;
            }

            var outletName = PostSanitizer.Sanitize(value ?? string.Empty).Trim();
            if (outletName.Length == 0 || outletName.Length > MaxOutletNameLength)
            {
                error = $"each outletNames value must be 1-{MaxOutletNameLength} characters of non-markup text.";
                return false;
            }

            sanitized[outletKey] = outletName;
        }

        outletNames = sanitized;
        return true;
    }

    /// <summary>Parses an OPTIONAL ISO-8601 instant; an absent/blank value clears the setting.</summary>
    /// <param name="raw">The raw instant from the request body.</param>
    /// <param name="field">The wire field name, used in the failure message.</param>
    /// <param name="instant">The parsed instant, normalized to UTC, or <c>null</c> to clear it.</param>
    /// <param name="error">A human-readable reason on failure.</param>
    /// <returns><c>true</c> when the instant is valid or absent.</returns>
    /// <remarks>
    /// <para>
    /// <b>An offsetless instant is UTC, never the host's local zone (WR-004).</b> The parse style is
    /// <see cref="DateTimeStyles.AssumeUniversal"/> | <see cref="DateTimeStyles.AdjustToUniversal"/>:
    /// <c>"2026-03-01T13:00:00"</c> — an ISO-8601 string carrying no <c>Z</c> and no offset — is read as
    /// 13:00 UTC. With the previous <c>RoundtripKind</c> style it bound to whatever zone the SERVER happened
    /// to run in, so the same request stored a different instant on a non-UTC host than on a UTC one. The
    /// shipped editor always appends <c>Z</c> and App Service runs UTC, so the divergence was unreachable
    /// from the UI — but any other API client could hit it, and <c>ScheduledStartAt</c> is consumed by
    /// <c>exercise-clock</c> and story 03's lifecycle gating, where a silently shifted instant is a
    /// scenario-time defect rather than a display quirk.
    /// </para>
    /// <para>
    /// An instant that DOES carry an offset keeps its meaning exactly and is merely normalized to the
    /// equivalent UTC instant (<c>AdjustToUniversal</c>), so the column stores one canonical representation.
    /// </para>
    /// </remarks>
    public static bool TryNormalizeInstant(string? raw, string field, out DateTimeOffset? instant, [NotNullWhen(false)] out string? error)
    {
        ArgumentNullException.ThrowIfNull(field);

        instant = null;
        error = null;

        var trimmed = raw?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return true;
        }

        if (!DateTimeOffset.TryParse(
                trimmed,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var parsed))
        {
            error = $"{field} must be an ISO-8601 instant (e.g. '2026-03-01T13:00:00Z').";
            return false;
        }

        instant = parsed;
        return true;
    }

    private static bool TryNormalizeRequiredText(
        string? raw,
        string field,
        int maxLength,
        [NotNullWhen(true)] out string? value,
        [NotNullWhen(false)] out string? error)
    {
        value = null;

        var trimmed = raw?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            error = $"{field} is required.";
            return false;
        }

        var sanitized = PostSanitizer.Sanitize(trimmed).Trim();
        if (sanitized.Length == 0)
        {
            error = $"{field} is required (it contained only markup, which is stripped on ingest).";
            return false;
        }

        if (sanitized.Length > maxLength)
        {
            error = $"{field} must be at most {maxLength} characters.";
            return false;
        }

        value = sanitized;
        error = null;
        return true;
    }

    private static bool TryNormalizeOptionalText(
        string? raw,
        string field,
        int maxLength,
        out string? value,
        [NotNullWhen(false)] out string? error)
    {
        value = null;
        error = null;

        var trimmed = raw?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return true;
        }

        var sanitized = PostSanitizer.Sanitize(trimmed).Trim();
        if (sanitized.Length == 0)
        {
            error = $"{field} contained only markup, which is stripped on ingest — send a real value or omit the field.";
            return false;
        }

        if (sanitized.Length > maxLength)
        {
            error = $"{field} must be at most {maxLength} characters.";
            return false;
        }

        value = sanitized;
        return true;
    }
}

/// <summary>
/// Serialization for <c>Exercise.OutletNamesJson</c> — the opaque, JSON-object-shaped outlet-name blob
/// (COR-030 theming). Kept in one place so the write path and the staff read path agree on the encoding.
/// </summary>
/// <remarks>
/// The read is deliberately forgiving: a malformed or hand-edited blob deserializes to an EMPTY map rather
/// than throwing, so one bad row cannot 500 the settings screen. Values are sanitized on the way in, never
/// on the way out.
/// </remarks>
public static class OutletNameMap
{
    /// <summary>Serializes a sanitized outlet-name map, or returns <c>null</c> when it is empty/absent.</summary>
    /// <param name="outletNames">The sanitized map.</param>
    /// <returns>The JSON blob to store, or <c>null</c> for "not configured".</returns>
    public static string? Serialize(IReadOnlyDictionary<string, string>? outletNames) =>
        outletNames is null || outletNames.Count == 0
            ? null
            : JsonSerializer.Serialize(outletNames.ToDictionary(e => e.Key, e => e.Value, StringComparer.Ordinal));

    /// <summary>Deserializes the stored blob; a null/blank/malformed value yields an empty map.</summary>
    /// <param name="json">The stored JSON blob.</param>
    /// <returns>The outlet-name map (never <c>null</c>).</returns>
    public static IReadOnlyDictionary<string, string> Deserialize(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return new Dictionary<string, string>(StringComparer.Ordinal);
        }

        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, string>>(json)
                ?? new Dictionary<string, string>(StringComparer.Ordinal);
        }
        catch (JsonException)
        {
            // A hand-edited/legacy blob must not break the staff settings read.
            return new Dictionary<string, string>(StringComparer.Ordinal);
        }
    }
}

/// <summary>The outcome kind of an <see cref="ExerciseSettingsService"/> call.</summary>
public enum ExerciseSettingsOutcome
{
    /// <summary>The settings were read or written — the endpoint returns 200 with the settings body.</summary>
    Ok,

    /// <summary>The request failed validation — the endpoint returns 400 and NOTHING was written.</summary>
    Invalid,

    /// <summary>No exercise scope was resolved — the endpoint returns 401 (fail closed).</summary>
    ScopeUnresolved,

    /// <summary>The resolved scope has no <c>Exercise</c> row — the endpoint returns 404.</summary>
    NotFound,
}

/// <summary>
/// The result of an <see cref="ExerciseSettingsService"/> call. <see cref="ExerciseSettingsOutcome.Ok"/>
/// carries the settings; <see cref="ExerciseSettingsOutcome.Invalid"/> carries a reason; the fail-closed
/// outcomes carry neither.
/// </summary>
public sealed class ExerciseSettingsResult
{
    private ExerciseSettingsResult(ExerciseSettingsOutcome outcome, ExerciseSettingsDto? settings, string? validationError)
    {
        Outcome = outcome;
        Settings = settings;
        ValidationError = validationError;
    }

    /// <summary>Which outcome occurred.</summary>
    public ExerciseSettingsOutcome Outcome { get; }

    /// <summary>The settings — non-null only when <see cref="Outcome"/> is <see cref="ExerciseSettingsOutcome.Ok"/>.</summary>
    public ExerciseSettingsDto? Settings { get; }

    /// <summary>The validation message — non-null only when <see cref="Outcome"/> is <see cref="ExerciseSettingsOutcome.Invalid"/>.</summary>
    public string? ValidationError { get; }

    /// <summary>A successful read or write.</summary>
    /// <param name="settings">The current settings.</param>
    /// <returns>An OK result.</returns>
    public static ExerciseSettingsResult Ok(ExerciseSettingsDto settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        return new ExerciseSettingsResult(ExerciseSettingsOutcome.Ok, settings, null);
    }

    /// <summary>A rejected write — nothing was persisted.</summary>
    /// <param name="validationError">The human-readable reason.</param>
    /// <returns>An invalid result.</returns>
    public static ExerciseSettingsResult Invalid(string validationError) =>
        new(ExerciseSettingsOutcome.Invalid, null, validationError);

    /// <summary>The fail-closed result for an unresolved exercise scope.</summary>
    /// <returns>A scope-unresolved result.</returns>
    public static ExerciseSettingsResult ScopeUnresolved() =>
        new(ExerciseSettingsOutcome.ScopeUnresolved, null, null);

    /// <summary>The result for a resolved scope with no backing exercise row.</summary>
    /// <returns>A not-found result.</returns>
    public static ExerciseSettingsResult NotFound() =>
        new(ExerciseSettingsOutcome.NotFound, null, null);
}

/// <summary>
/// Staff read/write of the COR-030 per-exercise settings behind
/// <c>GET/PUT /api/staff/exercise-settings</c>. Scoped lifetime, matching the request-scoped
/// <see cref="PulseDbContext"/> unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (always-Critical, COR-001/XC-002).</b> <see cref="Exercise"/> is the SCOPE, not an
/// <see cref="IExerciseScoped"/> entity, so <c>PulseDbContext</c>'s central query filter does NOT cover the
/// <c>Exercises</c> table — an unguarded lookup here would return another exercise's settings. The exercise
/// is therefore taken ONLY from <see cref="IExerciseContext"/>, which for a staff caller is the
/// server-persisted active-exercise selection applied by the session middleware. The request body carries no
/// exercise id at all, so there is nothing to ignore: a cross-exercise settings write is structurally
/// impossible rather than merely rejected.
/// </para>
/// <para>
/// <b>XC-004.</b> A write that actually changes something emits exactly ONE
/// <c>exercise.settings.updated</c> telemetry event in the SAME unit of work as the mutation (one
/// <c>SaveChangesAsync</c>), stamped from a single server clock read. A write that changes nothing persists
/// nothing and emits nothing.
/// </para>
/// </remarks>
public sealed class ExerciseSettingsService
{
    private const string SettingsUpdatedEventType = "exercise.settings.updated";
    private const string SystemActorKind = "system";
    private const string SystemChannel = "system";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentStaffSessionAccessor _currentStaffSession;

    /// <summary>Creates the service over persistence, the resolved scope, and the staff-session seam.</summary>
    /// <param name="dbContext">The persistence context settings are read and written through.</param>
    /// <param name="exerciseContext">The server-resolved exercise scope — the ONLY source of "which exercise".</param>
    /// <param name="currentStaffSession">Identifies the acting staff human for the XC-004 event.</param>
    public ExerciseSettingsService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ICurrentStaffSessionAccessor currentStaffSession)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(currentStaffSession);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _currentStaffSession = currentStaffSession;
    }

    /// <summary>Reads the resolved exercise's COR-030 settings. Fails closed on an unresolved scope.</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A result the endpoint maps to a status.</returns>
    public async Task<ExerciseSettingsResult> GetAsync(CancellationToken cancellationToken = default)
    {
        if (!TryResolveScope(out var exerciseId))
        {
            return ExerciseSettingsResult.ScopeUnresolved();
        }

        // org-scope-exempt(ResolvedScope): exerciseId comes from TryResolveScope (IExerciseContext), never a
        // request body, so the row read is the caller's own exercise and therefore their own organization.
        var exercise = await _dbContext.Exercises
            .AsNoTracking()
            .FirstOrDefaultAsync(e => e.Id == exerciseId, cancellationToken);

        return exercise is null
            ? ExerciseSettingsResult.NotFound()
            : ExerciseSettingsResult.Ok(ExerciseSettingsDto.FromExercise(exercise));
    }

    /// <summary>
    /// Replaces the resolved exercise's COR-030 settings block. Validation runs BEFORE anything is applied,
    /// so a rejected write leaves the stored config untouched (the story's fail-closed-400 AC).
    /// </summary>
    /// <param name="request">The full settings block.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A result the endpoint maps to a status.</returns>
    public async Task<ExerciseSettingsResult> UpdateAsync(
        UpdateExerciseSettingsRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (!TryResolveScope(out var exerciseId))
        {
            return ExerciseSettingsResult.ScopeUnresolved();
        }

        if (!TryValidate(request, out var validated, out var validationError))
        {
            return ExerciseSettingsResult.Invalid(validationError);
        }

        // org-scope-exempt(ResolvedScope): exerciseId comes from TryResolveScope (IExerciseContext), never the
        // request body, so this write targets the caller's own exercise within their own organization.
        var exercise = await _dbContext.Exercises
            .FirstOrDefaultAsync(e => e.Id == exerciseId, cancellationToken);

        if (exercise is null)
        {
            return ExerciseSettingsResult.NotFound();
        }

        Apply(validated, exercise);

        // EF's change tracker is the source of truth for "did this write actually change anything" — it also
        // yields the exact field list the audit event carries, with no parallel bookkeeping to drift.
        var changed = _dbContext.Entry(exercise).Properties
            .Where(p => p.IsModified)
            .Select(p => p.Metadata.Name)
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToList();

        if (changed.Count > 0)
        {
            var now = DateTimeOffset.UtcNow;
            var staff = await _currentStaffSession.GetCurrentStaffSessionAsync(cancellationToken);

            _dbContext.TelemetryEvents.Add(new TelemetryEvent
            {
                EventId = Guid.NewGuid().ToString(),
                SchemaVersion = "v0",
                ExerciseId = exerciseId,
                EventType = SettingsUpdatedEventType,
                Channel = SystemChannel,
                Actor = new TelemetryActor
                {
                    Kind = SystemActorKind,

                    // Off-envelope empty strings are null-omitted: the v0 schema types actingHumanId as an
                    // optional non-empty string, so an unknown staff id is null, never "".
                    ActingHumanId = staff?.StaffUserId.ToString(),
                    SessionId = staff?.SessionId.ToString(),
                },
                WallClockTime = now,
                ScenarioTime = exercise.CurrentScenarioTime ?? now,
                TimeZone = exercise.TimeZone,
                Target = new TelemetryTarget { EntityType = "exercise", EntityId = exerciseId.ToString() },
                Payload = JsonSerializer.Serialize(new ExerciseSettingsUpdatedPayload { Changed = changed }),
                EmittedAt = now,
            });

            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        return ExerciseSettingsResult.Ok(ExerciseSettingsDto.FromExercise(exercise));
    }

    /// <summary>The fail-closed scope check: an unset scope collapses to <see cref="Guid.Empty"/> and is refused.</summary>
    private bool TryResolveScope(out Guid exerciseId)
    {
        var scope = _exerciseContext.CurrentExerciseId;
        exerciseId = scope ?? Guid.Empty;
        return exerciseId != Guid.Empty;
    }

    /// <summary>
    /// Validates and normalizes the whole request. Fields are checked in wire order and the FIRST failure is
    /// reported (the house convention — <c>AccountFieldRules</c> / <c>StaffAuthEndpoints</c> both return one
    /// human-readable reason).
    /// </summary>
    private static bool TryValidate(
        UpdateExerciseSettingsRequest request,
        [NotNullWhen(true)] out ValidatedExerciseSettings? validated,
        [NotNullWhen(false)] out string? error)
    {
        validated = null;

        if (!ExerciseSettingsFieldRules.TryNormalizeName(request.Name, out var name, out error) ||
            !ExerciseSettingsFieldRules.TryNormalizeWorldName(request.WorldName, out var worldName, out error) ||
            !ExerciseSettingsFieldRules.TryNormalizeLocale(request.Locale, out var locale, out error) ||
            !ExerciseSettingsFieldRules.TryNormalizeTimeZone(request.TimeZone, out var timeZone, out error) ||
            !ExerciseSettingsFieldRules.TryNormalizeInstant(request.ScheduledStartAt, "scheduledStartAt", out var startAt, out error) ||
            !ExerciseSettingsFieldRules.TryNormalizeInstant(request.ScheduledEndAt, "scheduledEndAt", out var endAt, out error) ||
            !ExerciseSettingsFieldRules.TryNormalizeBrandName(request.BrandName, out var brandName, out error) ||
            !ExerciseSettingsFieldRules.TryNormalizeColor(request.BrandPrimary, "brandPrimary", out var brandPrimary, out error) ||
            !ExerciseSettingsFieldRules.TryNormalizeColor(request.BrandAccent, "brandAccent", out var brandAccent, out error) ||
            !ExerciseSettingsFieldRules.TryNormalizeColor(request.BrandSurface, "brandSurface", out var brandSurface, out error) ||
            !ExerciseSettingsFieldRules.TryNormalizeColor(request.BrandOnSurface, "brandOnSurface", out var brandOnSurface, out error) ||
            !ExerciseSettingsFieldRules.TryNormalizeOutletNames(request.OutletNames, out var outletNames, out error))
        {
            return false;
        }

        if (startAt is { } start && endAt is { } end && end < start)
        {
            error = "scheduledEndAt must not precede scheduledStartAt.";
            return false;
        }

        // An absent enabledChannels clears the setting (back to the platform default); a PRESENT one must be
        // a non-empty list of catalogued ids (the strict parser, since the column has no DB-level integrity).
        string? enabledChannels = null;
        if (request.EnabledChannels is not null)
        {
            if (!ChannelCatalog.TryNormalize(request.EnabledChannels, out var canonical, out error))
            {
                return false;
            }

            enabledChannels = ChannelCatalog.Format(canonical);
        }

        validated = new ValidatedExerciseSettings
        {
            Name = name,
            WorldName = worldName,
            Locale = locale,
            TimeZone = timeZone,
            ScheduledStartAt = startAt,
            ScheduledEndAt = endAt,
            EnabledChannels = enabledChannels,
            BrandName = brandName,
            BrandPrimary = brandPrimary,
            BrandAccent = brandAccent,
            BrandSurface = brandSurface,
            BrandOnSurface = brandOnSurface,
            OutletNamesJson = OutletNameMap.Serialize(outletNames),
        };

        error = null;
        return true;
    }

    /// <summary>Applies the validated block to the tracked entity (full replace — an absent field clears).</summary>
    private static void Apply(ValidatedExerciseSettings validated, Exercise exercise)
    {
        exercise.Name = validated.Name;
        exercise.WorldName = validated.WorldName;
        exercise.Locale = validated.Locale;
        exercise.TimeZone = validated.TimeZone;
        exercise.ScheduledStartAt = validated.ScheduledStartAt;
        exercise.ScheduledEndAt = validated.ScheduledEndAt;
        exercise.EnabledChannels = validated.EnabledChannels;
        exercise.BrandName = validated.BrandName;
        exercise.BrandPrimary = validated.BrandPrimary;
        exercise.BrandAccent = validated.BrandAccent;
        exercise.BrandSurface = validated.BrandSurface;
        exercise.BrandOnSurface = validated.BrandOnSurface;
        exercise.OutletNamesJson = validated.OutletNamesJson;
    }

    /// <summary>The normalized, storage-ready settings block a validated request produces.</summary>
    private sealed class ValidatedExerciseSettings
    {
        public required string Name { get; init; }

        public string? WorldName { get; init; }

        public string? Locale { get; init; }

        public required string TimeZone { get; init; }

        public DateTimeOffset? ScheduledStartAt { get; init; }

        public DateTimeOffset? ScheduledEndAt { get; init; }

        public string? EnabledChannels { get; init; }

        public string? BrandName { get; init; }

        public string? BrandPrimary { get; init; }

        public string? BrandAccent { get; init; }

        public string? BrandSurface { get; init; }

        public string? BrandOnSurface { get; init; }

        public string? OutletNamesJson { get; init; }
    }

    /// <summary>The opaque XC-004 payload: which settings columns the write actually changed.</summary>
    private sealed class ExerciseSettingsUpdatedPayload
    {
        [JsonPropertyName("changed")]
        public required IReadOnlyList<string> Changed { get; init; }
    }
}
