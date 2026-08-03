namespace Pulse.WebApi.Features.ExerciseConfiguration.Chrome;

using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>The outcome kind of a <see cref="ChromeSettingsService"/> call.</summary>
public enum ChromeSettingsOutcome
{
    /// <summary>The chrome config was read or written — the endpoint returns 200 with the settings body.</summary>
    Ok,

    /// <summary>The request failed validation (including the NFR-008 guard) — 400, and NOTHING was written.</summary>
    Invalid,

    /// <summary>No exercise scope was resolved — the endpoint returns 401 (fail closed).</summary>
    ScopeUnresolved,

    /// <summary>The resolved scope has no <c>Exercise</c> row — the endpoint returns 404.</summary>
    NotFound,
}

/// <summary>
/// The result of a <see cref="ChromeSettingsService"/> call. <see cref="ChromeSettingsOutcome.Ok"/> carries the
/// settings; <see cref="ChromeSettingsOutcome.Invalid"/> carries a reason; the fail-closed outcomes carry
/// neither.
/// </summary>
public sealed class ChromeSettingsResult
{
    private ChromeSettingsResult(ChromeSettingsOutcome outcome, ChromeSettingsDto? settings, string? validationError)
    {
        Outcome = outcome;
        Settings = settings;
        ValidationError = validationError;
    }

    /// <summary>Which outcome occurred.</summary>
    public ChromeSettingsOutcome Outcome { get; }

    /// <summary>The chrome settings — non-null only when <see cref="Outcome"/> is <see cref="ChromeSettingsOutcome.Ok"/>.</summary>
    public ChromeSettingsDto? Settings { get; }

    /// <summary>The validation message — non-null only when <see cref="Outcome"/> is <see cref="ChromeSettingsOutcome.Invalid"/>.</summary>
    public string? ValidationError { get; }

    /// <summary>A successful read or write.</summary>
    /// <param name="settings">The current chrome settings.</param>
    /// <returns>An OK result.</returns>
    public static ChromeSettingsResult Ok(ChromeSettingsDto settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        return new ChromeSettingsResult(ChromeSettingsOutcome.Ok, settings, null);
    }

    /// <summary>A rejected write — nothing was persisted.</summary>
    /// <param name="validationError">The human-readable reason.</param>
    /// <returns>An invalid result.</returns>
    public static ChromeSettingsResult Invalid(string validationError) =>
        new(ChromeSettingsOutcome.Invalid, null, validationError);

    /// <summary>The fail-closed result for an unresolved exercise scope.</summary>
    /// <returns>A scope-unresolved result.</returns>
    public static ChromeSettingsResult ScopeUnresolved() =>
        new(ChromeSettingsOutcome.ScopeUnresolved, null, null);

    /// <summary>The result for a resolved scope with no backing exercise row.</summary>
    /// <returns>A not-found result.</returns>
    public static ChromeSettingsResult NotFound() =>
        new(ChromeSettingsOutcome.NotFound, null, null);
}

/// <summary>
/// Staff read/write of the COR-031 per-exercise compliance-chrome configuration behind
/// <c>GET/PUT /api/staff/chrome-settings</c> — the write path that turns the shipped chrome CONSTANT into
/// per-exercise, staff-editable, persisted configuration. Scoped lifetime, matching the request-scoped
/// <see cref="PulseDbContext"/> unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (always-Critical, COR-001/XC-002).</b> <see cref="Exercise"/> is the SCOPE, not an
/// <see cref="IExerciseScoped"/> entity, so <c>PulseDbContext</c>'s central query filter does NOT cover the
/// <c>Exercises</c> table — an unguarded lookup here would return another exercise's chrome. The exercise is
/// therefore taken ONLY from <see cref="IExerciseContext"/>, which for a staff caller is the server-persisted
/// active-exercise selection applied by the session middleware. The request body carries no exercise id at
/// all, so there is nothing to ignore: a cross-exercise chrome write is structurally impossible rather than
/// merely rejected.
/// </para>
/// <para>
/// <b>NFR-008, once, before anything is applied.</b> The chrome↔watermark mutual guard is
/// <see cref="ComplianceChromeGuard"/> and is evaluated on the REQUESTED pair inside
/// <see cref="TryValidate"/> — so a rejected write leaves the stored config untouched, and the rule holds
/// regardless of what the client sends. This is the only writer of either column (01b's settings write touches
/// neither), so there is no path around it.
/// </para>
/// <para>
/// <b>XC-004.</b> A write that actually changes something emits exactly ONE <c>exercise.chrome.updated</c>
/// telemetry event in the SAME unit of work as the mutation (one <c>SaveChangesAsync</c>), stamped from a
/// single server clock read. A write that changes nothing persists nothing and emits nothing.
/// </para>
/// </remarks>
public sealed class ChromeSettingsService
{
    private const string ChromeUpdatedEventType = "exercise.chrome.updated";
    private const string SystemActorKind = "system";
    private const string SystemChannel = "system";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentStaffSessionAccessor _currentStaffSession;

    /// <summary>Creates the service over persistence, the resolved scope, and the staff-session seam.</summary>
    /// <param name="dbContext">The persistence context chrome config is read and written through.</param>
    /// <param name="exerciseContext">The server-resolved exercise scope — the ONLY source of "which exercise".</param>
    /// <param name="currentStaffSession">Identifies the acting staff human for the XC-004 event.</param>
    public ChromeSettingsService(
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

    /// <summary>Reads the resolved exercise's chrome configuration. Fails closed on an unresolved scope.</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A result the endpoint maps to a status.</returns>
    public async Task<ChromeSettingsResult> GetAsync(CancellationToken cancellationToken = default)
    {
        if (!TryResolveScope(out var exerciseId))
        {
            return ChromeSettingsResult.ScopeUnresolved();
        }

        // org-scope-exempt(ResolvedScope): exerciseId comes from TryResolveScope (IExerciseContext), never a
        // request body, so the row read is the caller's own exercise and therefore their own organization.
        var exercise = await _dbContext.Exercises
            .AsNoTracking()
            .FirstOrDefaultAsync(e => e.Id == exerciseId, cancellationToken);

        return exercise is null
            ? ChromeSettingsResult.NotFound()
            : ChromeSettingsResult.Ok(ChromeSettingsDto.FromExercise(exercise));
    }

    /// <summary>
    /// Replaces the resolved exercise's compliance-chrome block. Validation — including the NFR-008 mutual
    /// guard — runs BEFORE anything is applied, so a rejected write leaves the stored config untouched.
    /// </summary>
    /// <param name="request">The full chrome block.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A result the endpoint maps to a status.</returns>
    public async Task<ChromeSettingsResult> UpdateAsync(
        UpdateChromeSettingsRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (!TryResolveScope(out var exerciseId))
        {
            return ChromeSettingsResult.ScopeUnresolved();
        }

        if (!TryValidate(request, out var validated, out var validationError))
        {
            return ChromeSettingsResult.Invalid(validationError);
        }

        // org-scope-exempt(ResolvedScope): exerciseId comes from TryResolveScope (IExerciseContext), never the
        // request body, so this write targets the caller's own exercise within their own organization.
        var exercise = await _dbContext.Exercises
            .FirstOrDefaultAsync(e => e.Id == exerciseId, cancellationToken);

        if (exercise is null)
        {
            return ChromeSettingsResult.NotFound();
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
                EventType = ChromeUpdatedEventType,
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
                Payload = JsonSerializer.Serialize(new ChromeUpdatedPayload { Changed = changed }),
                EmittedAt = now,
            });

            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        return ChromeSettingsResult.Ok(ChromeSettingsDto.FromExercise(exercise));
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
    /// reported (the house convention). The NFR-008 mutual guard runs FIRST: whether the exercise keeps a
    /// marking at all outranks whether a colour parses.
    /// </summary>
    private static bool TryValidate(
        UpdateChromeSettingsRequest request,
        [NotNullWhen(true)] out ValidatedChromeSettings? validated,
        [NotNullWhen(false)] out string? error)
    {
        validated = null;

        if (request.ChromeEnabled is not { } chromeEnabled)
        {
            error = "chromeEnabled is required (send the whole chrome block, not a patch).";
            return false;
        }

        if (request.WatermarkEnabled is not { } watermarkEnabled)
        {
            error = "watermarkEnabled is required (send the whole chrome block, not a patch).";
            return false;
        }

        // NFR-008 / COR-031 / XC-003 — the one place the mutual guard is enforced, before anything is applied.
        if (!ComplianceChromeGuard.TryValidate(chromeEnabled, watermarkEnabled, out error))
        {
            return false;
        }

        if (!ChromeFieldRules.TryNormalizeBannerText(request.TopText, "topText", out var topText, out error) ||
            !ExerciseSettingsFieldRules.TryNormalizeColor(request.TopFg, "topFg", out var topFg, out error) ||
            !ExerciseSettingsFieldRules.TryNormalizeColor(request.TopBg, "topBg", out var topBg, out error) ||
            !ChromeFieldRules.TryNormalizeBannerText(request.BottomText, "bottomText", out var bottomText, out error) ||
            !ExerciseSettingsFieldRules.TryNormalizeColor(request.BottomFg, "bottomFg", out var bottomFg, out error) ||
            !ExerciseSettingsFieldRules.TryNormalizeColor(request.BottomBg, "bottomBg", out var bottomBg, out error))
        {
            return false;
        }

        validated = new ValidatedChromeSettings
        {
            ChromeEnabled = chromeEnabled,
            WatermarkEnabled = watermarkEnabled,
            TopText = topText,
            TopFg = topFg,
            TopBg = topBg,
            BottomText = bottomText,
            BottomFg = bottomFg,
            BottomBg = bottomBg,
        };

        error = null;
        return true;
    }

    /// <summary>Applies the validated block to the tracked entity (full replace — an absent field clears).</summary>
    private static void Apply(ValidatedChromeSettings validated, Exercise exercise)
    {
        exercise.ComplianceChromeEnabled = validated.ChromeEnabled;
        exercise.WatermarkEnabled = validated.WatermarkEnabled;
        exercise.ChromeTopText = validated.TopText;
        exercise.ChromeTopFg = validated.TopFg;
        exercise.ChromeTopBg = validated.TopBg;
        exercise.ChromeBottomText = validated.BottomText;
        exercise.ChromeBottomFg = validated.BottomFg;
        exercise.ChromeBottomBg = validated.BottomBg;
    }

    /// <summary>The normalized, storage-ready chrome block a validated request produces.</summary>
    private sealed class ValidatedChromeSettings
    {
        public required bool ChromeEnabled { get; init; }

        public required bool WatermarkEnabled { get; init; }

        public string? TopText { get; init; }

        public string? TopFg { get; init; }

        public string? TopBg { get; init; }

        public string? BottomText { get; init; }

        public string? BottomFg { get; init; }

        public string? BottomBg { get; init; }
    }

    /// <summary>The opaque XC-004 payload: which chrome columns the write actually changed.</summary>
    private sealed class ChromeUpdatedPayload
    {
        [JsonPropertyName("changed")]
        public required IReadOnlyList<string> Changed { get; init; }
    }
}
