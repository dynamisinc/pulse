namespace Pulse.WebApi.Features.ExerciseConfiguration;

using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ParticipantShell;

/// <summary>
/// The shipped Phase-1 participant-shell config constants, lifted verbatim out of
/// <c>ParticipantShellEndpoints</c> when story 01b converted the six handlers from
/// <c>static readonly</c> constants onto per-exercise data. They are now the FALLBACK an un-configured
/// column resolves to (<c>null</c> on the <see cref="Exercise"/> row means "not configured"), so an
/// exercise nobody has edited serves byte-for-byte what it served before the refactor.
/// </summary>
/// <remarks>
/// Do not "tidy" a value here: each one is asserted verbatim by the participant-shell contract tests and,
/// more importantly, is what the frozen frontend shell seams' runtime type-guards have been screened
/// against (contrast-checked brand colors, the exact hyphenated <c>in-fiction</c> literal, the compliance
/// banner copy). Changing one is a participant-world change, not a refactor.
/// </remarks>
public static class ParticipantShellDefaults
{
    /// <summary>The Phase-1 <c>GET /api/shell-state</c> variant — the interactive shell.</summary>
    public const string ShellVariant = "full";

    /// <summary>The Phase-1 <c>GET /api/chrome-config</c> top banner copy.</summary>
    public const string ChromeTopText = "UNCLASSIFIED // EXERCISE · EXERCISE · EXERCISE — ALL CONTENT SIMULATED";

    /// <summary>The Phase-1 <c>GET /api/chrome-config</c> bottom banner copy.</summary>
    public const string ChromeBottomText = "PULSE TRAINING ENVIRONMENT — SIMULATED INFORMATION SPACE — NOT REAL NEWS";

    /// <summary>The Phase-1 compliance-banner foreground color (both banners).</summary>
    public const string ChromeBannerFg = "#eaf5e6";

    /// <summary>The Phase-1 compliance-banner background color (both banners).</summary>
    public const string ChromeBannerBg = "#2e6b2e";

    /// <summary>The Phase-1 brand name — the screened, neutral demo brand.</summary>
    public const string BrandName = "Sample Exercise Network";

    /// <summary>The Phase-1 brand primary color.</summary>
    public const string BrandPrimary = "#2b5f75";

    /// <summary>The Phase-1 brand accent color.</summary>
    public const string BrandAccent = "#d97706";

    /// <summary>The Phase-1 brand surface color.</summary>
    public const string BrandSurface = "#ffffff";

    /// <summary>The Phase-1 brand on-surface (foreground) color.</summary>
    public const string BrandOnSurface = "#1c1c1c";

    /// <summary>The Phase-1 <c>GET /api/overlay-state</c> state kind — no overlay active.</summary>
    public const string OverlayState = "none";

    /// <summary>The Phase-1 <c>GET /api/overlay-state</c> register — the exact hyphenated wire literal.</summary>
    public const string OverlayRegister = "in-fiction";

    /// <summary>
    /// The Phase-1 <c>hideWhenSingleChannel</c> flag: <c>false</c> keeps the (degenerate) nav strip visible.
    /// No per-exercise column carries this yet, so it stays constant.
    /// </summary>
    public const bool HideWhenSingleChannel = false;
}

/// <summary>One entry of the fixed participant channel catalog: its id, its label, and its closed icon id.</summary>
/// <param name="Id">The channel id (the token stored in <see cref="Exercise.EnabledChannels"/>).</param>
/// <param name="Label">The nav label. Non-empty — the frontend guard rejects an empty label.</param>
/// <param name="Icon">The closed channel-icon identifier the frontend maps to a FontAwesome icon.</param>
public sealed record ChannelCatalogEntry(string Id, string Label, string Icon);

/// <summary>
/// The fixed participant channel catalog (COR-030 "enabled channels") plus the STRICT parser/formatter for
/// <see cref="Exercise.EnabledChannels"/> — the comma-separated column that has no DB-level integrity, so
/// this type is the only thing standing between a typo and a broken participant nav.
/// </summary>
/// <remarks>
/// <para>
/// <b>The catalog itself is closed and constant.</b> Ids, labels and icons are the shipped Phase-1 values;
/// <c>icon</c> in particular must stay inside <c>channelNavConfig.ts</c>'s <c>ChannelIconId</c> union or the
/// frontend's runtime guard rejects the whole response and the shell falls back to its default. A settings
/// write may only turn a catalogued channel ON or OFF — it can never add a channel.
/// </para>
/// <para>
/// <b>Write path is strict, read path is forgiving — deliberately.</b>
/// <see cref="TryNormalize"/> rejects an unknown id with a 400 (the story AC), so nothing unknown can be
/// stored through the API. <see cref="ParseStored"/>, which runs on every participant read, instead IGNORES
/// an unrecognized token and treats a value that yields no known channel as "not configured" — a hand-edited
/// row must not 500 a participant read or blank the shell; it degrades to the Phase-1 default (Social on).
/// </para>
/// </remarks>
public static class ChannelCatalog
{
    /// <summary>The channel id that is enabled in the Phase-1 default (E3–E6 are catalogued-but-off).</summary>
    public const string SocialChannelId = "social";

    /// <summary>Maximum number of ids accepted on a write (the catalog is smaller; this is a parser bound).</summary>
    public const int MaxEnabledChannels = 16;

    /// <summary>
    /// The full catalog, in wire order. Every <c>GET /api/channel-nav-config</c> response carries ALL of
    /// these — the frontend filters to enabled-only itself, so the catalog is stable as E3–E6 land.
    /// </summary>
    public static IReadOnlyList<ChannelCatalogEntry> All { get; } =
    [
        new ChannelCatalogEntry(SocialChannelId, "Social", "social"),
        new ChannelCatalogEntry("portal", "Portal", "portal"),
        new ChannelCatalogEntry("news", "News", "news"),
        new ChannelCatalogEntry("press", "Press Room", "press"),
        new ChannelCatalogEntry("weather", "Weather", "weather"),
    ];

    /// <summary>
    /// The Phase-1 default enabled set, used when <see cref="Exercise.EnabledChannels"/> is not configured:
    /// Social only, matching the shipped constant exactly.
    /// </summary>
    public static IReadOnlySet<string> DefaultEnabledIds { get; } =
        new HashSet<string>(StringComparer.Ordinal) { SocialChannelId };

    /// <summary>
    /// Validates and canonicalizes a client-supplied channel-id list for STORAGE. Ids are matched
    /// case-insensitively and normalized to their canonical catalog casing; duplicates collapse; the result
    /// is emitted in catalog order. Fails (400) on an unknown id, an empty/blank id, an empty list, or an
    /// over-long list.
    /// </summary>
    /// <param name="raw">The requested channel ids.</param>
    /// <param name="canonical">The canonical, catalog-ordered set on success.</param>
    /// <param name="error">A human-readable reason on failure.</param>
    /// <returns><c>true</c> when every id is catalogued and the list is usable.</returns>
    public static bool TryNormalize(
        IEnumerable<string?>? raw,
        [NotNullWhen(true)] out IReadOnlyList<string>? canonical,
        [NotNullWhen(false)] out string? error)
    {
        canonical = null;
        error = null;

        if (raw is null)
        {
            error = "enabledChannels must be a list of channel ids.";
            return false;
        }

        var requested = raw.ToList();
        if (requested.Count > MaxEnabledChannels)
        {
            error = $"enabledChannels must contain at most {MaxEnabledChannels} ids.";
            return false;
        }

        var accepted = new HashSet<string>(StringComparer.Ordinal);
        foreach (var candidate in requested)
        {
            var trimmed = candidate?.Trim();
            if (string.IsNullOrEmpty(trimmed))
            {
                error = "enabledChannels must not contain an empty channel id.";
                return false;
            }

            var entry = All.FirstOrDefault(c => string.Equals(c.Id, trimmed, StringComparison.OrdinalIgnoreCase));
            if (entry is null)
            {
                error = $"'{trimmed}' is not a known channel id. Known ids: {string.Join(", ", All.Select(c => c.Id))}.";
                return false;
            }

            accepted.Add(entry.Id);
        }

        if (accepted.Count == 0)
        {
            // A world with no channel serves a participant nothing at all. Refuse rather than silently
            // blanking the participant shell; "not configured" is expressed by OMITTING the field.
            error = "enabledChannels must enable at least one channel (omit the field to fall back to the platform default).";
            return false;
        }

        canonical = All.Where(c => accepted.Contains(c.Id)).Select(c => c.Id).ToList();
        return true;
    }

    /// <summary>Formats a canonical id set into the stored comma-separated column value.</summary>
    /// <param name="ids">The canonical ids.</param>
    /// <returns>The comma-separated storage form.</returns>
    public static string Format(IEnumerable<string> ids)
    {
        ArgumentNullException.ThrowIfNull(ids);
        return string.Join(',', ids);
    }

    /// <summary>
    /// Parses the stored <see cref="Exercise.EnabledChannels"/> column on the participant READ path. Returns
    /// <c>null</c> for "not configured" — which includes a stored value that yields no catalogued channel, so
    /// a hand-edited or legacy row degrades to the Phase-1 default rather than blanking the shell.
    /// </summary>
    /// <param name="stored">The raw column value.</param>
    /// <returns>The enabled id set, or <c>null</c> when not configured.</returns>
    public static IReadOnlySet<string>? ParseStored(string? stored)
    {
        if (string.IsNullOrWhiteSpace(stored))
        {
            return null;
        }

        var parsed = new HashSet<string>(StringComparer.Ordinal);
        foreach (var token in stored.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var entry = All.FirstOrDefault(c => string.Equals(c.Id, token, StringComparison.OrdinalIgnoreCase));
            if (entry is not null)
            {
                parsed.Add(entry.Id);
            }
        }

        return parsed.Count == 0 ? null : parsed;
    }
}

/// <summary>
/// The read model every participant-shell projection sees: the resolved exercise's configuration columns,
/// already parsed. Built ONCE per request by <see cref="ParticipantShellConfigService"/> from the exercise
/// the server resolved (<see cref="IExerciseContext"/>), never from a client-supplied id.
/// </summary>
/// <remarks>
/// <para>
/// <b>XC-002 — what is deliberately ABSENT.</b> This record feeds participant-facing responses, so it
/// carries no staff-world state: not the internal <see cref="Exercise.Name"/>, not the schedule, not the
/// hostnames, and above all not <see cref="Exercise.IsPracticeMode"/> (COR-033 is staff-only and must never
/// reach a participant surface). A projection cannot leak what it was never handed.
/// </para>
/// <para>
/// It is a plain value object with no DB access: a projection implementation that needs more than this
/// should inject its own scoped services rather than widening this type, so wave-3 contributors stay in
/// their own files.
/// </para>
/// </remarks>
public sealed class ExerciseShellConfigSource
{
    /// <summary>The server-resolved exercise this config belongs to (COR-001).</summary>
    public required Guid ExerciseId { get; init; }

    /// <summary>The participant-visible world name (COR-030), or <c>null</c> when not configured.</summary>
    public string? WorldName { get; init; }

    /// <summary>The participant-visible BCP-47 locale, or <c>null</c> when not configured.</summary>
    public string? Locale { get; init; }

    /// <summary>The exercise's single IANA time zone (XC-008) — always present.</summary>
    public required string TimeZone { get; init; }

    /// <summary>The lifecycle status literal (COR-032 vocabulary) — story 03's shell-variant/overlay input.</summary>
    public required string Status { get; init; }

    /// <summary>The configured enabled-channel ids, or <c>null</c> when not configured (Phase-1 default applies).</summary>
    public IReadOnlySet<string>? EnabledChannelIds { get; init; }

    /// <summary>The configured brand name, or <c>null</c> → <see cref="ParticipantShellDefaults.BrandName"/>.</summary>
    public string? BrandName { get; init; }

    /// <summary>The configured brand primary color, or <c>null</c> → the shipped default.</summary>
    public string? BrandPrimary { get; init; }

    /// <summary>The configured brand accent color, or <c>null</c> → the shipped default.</summary>
    public string? BrandAccent { get; init; }

    /// <summary>The configured brand surface color, or <c>null</c> → the shipped default.</summary>
    public string? BrandSurface { get; init; }

    /// <summary>The configured brand on-surface color, or <c>null</c> → the shipped default.</summary>
    public string? BrandOnSurface { get; init; }

    /// <summary>Whether compliance chrome is on for this exercise (COR-031). Story 02's projection input.</summary>
    public bool ComplianceChromeEnabled { get; init; }

    /// <summary>The configured top banner copy, or <c>null</c> → the shipped constant. Story 02's input.</summary>
    public string? ChromeTopText { get; init; }

    /// <summary>The configured top banner foreground color, or <c>null</c> → the shipped constant.</summary>
    public string? ChromeTopFg { get; init; }

    /// <summary>The configured top banner background color, or <c>null</c> → the shipped constant.</summary>
    public string? ChromeTopBg { get; init; }

    /// <summary>The configured bottom banner copy, or <c>null</c> → the shipped constant. Story 02's input.</summary>
    public string? ChromeBottomText { get; init; }

    /// <summary>The configured bottom banner foreground color, or <c>null</c> → the shipped constant.</summary>
    public string? ChromeBottomFg { get; init; }

    /// <summary>The configured bottom banner background color, or <c>null</c> → the shipped constant.</summary>
    public string? ChromeBottomBg { get; init; }

    /// <summary>Whether the in-content "EXERCISE" watermark is on (NFR-008). Story 02's mutual-guard input.</summary>
    public bool WatermarkEnabled { get; init; }

    /// <summary>Projects a persisted <see cref="Exercise"/> row onto the participant-safe read model.</summary>
    /// <param name="exercise">The resolved exercise row.</param>
    /// <returns>The read model.</returns>
    public static ExerciseShellConfigSource FromExercise(Exercise exercise)
    {
        ArgumentNullException.ThrowIfNull(exercise);

        return new ExerciseShellConfigSource
        {
            ExerciseId = exercise.Id,
            WorldName = exercise.WorldName,
            Locale = exercise.Locale,
            TimeZone = exercise.TimeZone,
            Status = exercise.Status,
            EnabledChannelIds = ChannelCatalog.ParseStored(exercise.EnabledChannels),
            BrandName = exercise.BrandName,
            BrandPrimary = exercise.BrandPrimary,
            BrandAccent = exercise.BrandAccent,
            BrandSurface = exercise.BrandSurface,
            BrandOnSurface = exercise.BrandOnSurface,
            ComplianceChromeEnabled = exercise.ComplianceChromeEnabled,
            ChromeTopText = exercise.ChromeTopText,
            ChromeTopFg = exercise.ChromeTopFg,
            ChromeTopBg = exercise.ChromeTopBg,
            ChromeBottomText = exercise.ChromeBottomText,
            ChromeBottomFg = exercise.ChromeBottomFg,
            ChromeBottomBg = exercise.ChromeBottomBg,
            WatermarkEnabled = exercise.WatermarkEnabled,
        };
    }

    /// <summary>
    /// The "resolved scope, but no <see cref="Exercise"/> row" read model: every settings column absent, the
    /// two switches at their safe defaults. Every projection therefore serves the shipped Phase-1 constants,
    /// exactly as the pre-refactor handlers did. This is NOT the unresolved-scope case — that fails closed
    /// with a 401 before a source is ever built.
    /// </summary>
    /// <param name="exerciseId">The resolved scope.</param>
    /// <returns>An un-configured read model.</returns>
    public static ExerciseShellConfigSource Unconfigured(Guid exerciseId) => new()
    {
        ExerciseId = exerciseId,
        TimeZone = "UTC",
        Status = "build",
        ComplianceChromeEnabled = true,
        WatermarkEnabled = true,
    };
}

/// <summary>
/// Projects the resolved exercise's config onto the frozen <c>GET /api/chrome-config</c> body (COR-031).
/// Story 01b ships a constant-preserving default; <b>story 02 contributes the real per-exercise projection
/// plus the NFR-008 chrome↔watermark mutual guard.</b>
/// </summary>
/// <remarks>
/// <para>
/// <b>The projection-override contract (read this before contributing an implementation).</b> Story 01b
/// registers its default with <c>services.TryAddScoped&lt;IChromeConfigProjection, ConstantChromeConfigProjection&gt;()</c>
/// — a fail-safe FLOOR that is present only if nobody has contributed a real one. A contributing story MUST
/// register its implementation with
/// <c>services.Replace(ServiceDescriptor.Scoped&lt;IChromeConfigProjection, RealChromeConfigProjection&gt;())</c>
/// from its OWN <c>Add*()</c> extension. <c>Replace</c> is mandatory because it is order-independent AND
/// leaves a single descriptor, so <c>IEnumerable&lt;T&gt;</c> resolution never sees a stale default beside
/// the real implementation.
/// </para>
/// <para>
/// <b>The failure this prevents ships green — and it is NOT the obvious one.</b> A bare <c>AddScoped</c>
/// would in fact still win (it appends a descriptor and <c>GetRequiredService</c> returns the LAST). The
/// real trap is a contributor that copies 01b's own <c>TryAddScoped</c> idiom: the default is already
/// registered, the <c>TryAdd</c> is a silent no-op, nothing raises, and <c>/api/chrome-config</c> keeps
/// serving identical banners for every exercise while the contributor's own unit tests pass (they exercise
/// the projection class directly). Testing the projection class in isolation CANNOT catch this — the
/// contributing story must resolve this interface from a fully composed service provider and assert the
/// CONTRIBUTED implementation comes back and produces per-exercise output end to end. Pinned by
/// <c>ExerciseConfigurationProjectionRegistrationTests.ContributedProjection_RegisteredWithTryAdd_IsSilentlyIgnored_WhichIsWhyReplaceIsMandatory</c>.
/// </para>
/// <para>
/// The response body is a FROZEN wire shape (<c>ParticipantShellDtos.cs</c>): fill it, never reshape it.
/// </para>
/// </remarks>
public interface IChromeConfigProjection
{
    /// <summary>Projects the exercise's config onto the frozen chrome-config body.</summary>
    /// <param name="source">The resolved exercise's participant-safe config read model.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The chrome config to serve.</returns>
    Task<ChromeConfigResponse> ProjectAsync(ExerciseShellConfigSource source, CancellationToken cancellationToken = default);
}

/// <summary>
/// Projects the resolved exercise's config onto the frozen <c>GET /api/shell-state</c> body. Story 01b ships
/// a constant-preserving default (<c>full</c>); <b>story 03 (lifecycle) contributes the real projection.</b>
/// </summary>
/// <remarks>
/// <para>
/// Registration follows the projection-override contract documented on
/// <see cref="IChromeConfigProjection"/>: 01b's default is <c>TryAddScoped</c>, a contributor uses
/// <c>services.Replace(ServiceDescriptor.Scoped&lt;IShellVariantProjection, RealX&gt;())</c> and proves it
/// with a DI-resolution test over a fully composed provider.
/// </para>
/// <para>
/// <b>A projection cannot fail closed.</b> This interface only changes <c>ShellStateResponse.variant</c>, so
/// it can never be the mechanism that REFUSES to serve a participant surface for a Build/Completed/Archived
/// exercise — returning <c>readOnly</c> here still leaves <c>/api/feed</c> serving posts. Refusing service is
/// a pipeline concern and belongs to story 03's <c>UseExerciseLifecycleGating()</c> middleware.
/// </para>
/// </remarks>
public interface IShellVariantProjection
{
    /// <summary>Projects the exercise's config onto the frozen shell-state body.</summary>
    /// <param name="source">The resolved exercise's participant-safe config read model.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The shell state to serve.</returns>
    Task<ShellStateResponse> ProjectAsync(ExerciseShellConfigSource source, CancellationToken cancellationToken = default);
}

/// <summary>
/// Projects the resolved exercise's config onto the frozen <c>GET /api/overlay-state</c> body (COR-065).
/// Story 01b ships a constant-preserving default (no overlay); <b>story 03 contributes the real projection,
/// including COR-032's Paused holding page.</b>
/// </summary>
/// <remarks>
/// <para>
/// Registration follows the projection-override contract documented on
/// <see cref="IChromeConfigProjection"/>: 01b's default is <c>TryAddScoped</c>, a contributor uses
/// <c>services.Replace(ServiceDescriptor.Scoped&lt;IOverlayStateProjection, RealX&gt;())</c> and proves it
/// with a DI-resolution test over a fully composed provider.
/// </para>
/// <para>
/// <b>Merge hazard for the contributor.</b> <c>feature/world-steering-wave2</c> rewrites the overlay-state
/// handler into a real write path with SignalR push (CTL-023 Freeze). COR-032's Paused holding page targets
/// the same surface and register: compose ONE overlay state routed through that write path — do not add a
/// second, parallel pause mechanism beside it.
/// </para>
/// </remarks>
public interface IOverlayStateProjection
{
    /// <summary>Projects the exercise's config onto the frozen overlay-state body.</summary>
    /// <param name="source">The resolved exercise's participant-safe config read model.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The overlay state to serve.</returns>
    Task<OverlayStateResponse> ProjectAsync(ExerciseShellConfigSource source, CancellationToken cancellationToken = default);
}

/// <summary>
/// Story 01b's constant-preserving <see cref="IChromeConfigProjection"/> default: it ignores the exercise's
/// chrome columns and returns the shipped Phase-1 banners, so behaviour is UNCHANGED until story 02
/// contributes the real per-exercise projection (and the NFR-008 mutual guard) via <c>Replace</c>.
/// </summary>
public sealed class ConstantChromeConfigProjection : IChromeConfigProjection
{
    private static readonly ChromeConfigResponse Constant = new()
    {
        Enabled = true,
        Top = new ChromeBannerConfig
        {
            Text = ParticipantShellDefaults.ChromeTopText,
            Fg = ParticipantShellDefaults.ChromeBannerFg,
            Bg = ParticipantShellDefaults.ChromeBannerBg,
        },
        Bottom = new ChromeBannerConfig
        {
            Text = ParticipantShellDefaults.ChromeBottomText,
            Fg = ParticipantShellDefaults.ChromeBannerFg,
            Bg = ParticipantShellDefaults.ChromeBannerBg,
        },
    };

    /// <inheritdoc />
    public Task<ChromeConfigResponse> ProjectAsync(ExerciseShellConfigSource source, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);
        return Task.FromResult(Constant);
    }
}

/// <summary>
/// Story 01b's constant-preserving <see cref="IShellVariantProjection"/> default: always the interactive
/// <c>full</c> variant, so behaviour is UNCHANGED until story 03 contributes the lifecycle-aware projection
/// via <c>Replace</c>.
/// </summary>
public sealed class ConstantShellVariantProjection : IShellVariantProjection
{
    private static readonly ShellStateResponse Constant = new() { Variant = ParticipantShellDefaults.ShellVariant };

    /// <inheritdoc />
    public Task<ShellStateResponse> ProjectAsync(ExerciseShellConfigSource source, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);
        return Task.FromResult(Constant);
    }
}

/// <summary>
/// Story 01b's constant-preserving <see cref="IOverlayStateProjection"/> default: no overlay active, so
/// behaviour is UNCHANGED until story 03 contributes the lifecycle/pause projection via <c>Replace</c>.
/// </summary>
public sealed class ConstantOverlayStateProjection : IOverlayStateProjection
{
    private static readonly OverlayStateResponse Constant = new()
    {
        State = ParticipantShellDefaults.OverlayState,
        Register = ParticipantShellDefaults.OverlayRegister,
        Message = string.Empty,
    };

    /// <inheritdoc />
    public Task<OverlayStateResponse> ProjectAsync(ExerciseShellConfigSource source, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);
        return Task.FromResult(Constant);
    }
}

/// <summary>
/// Serves the six participant-shell config reads from PER-EXERCISE data (COR-030) behind the unchanged
/// frozen wire shapes. This is the seam story 01b introduced when it converted
/// <c>ParticipantShellEndpoints</c>'s <c>static readonly</c> constants into a service: brand tokens and the
/// channel catalog are projected here from the <see cref="Exercise"/> row, while chrome, shell variant and
/// overlay state are delegated to the three per-concern projections stories 02/03 contribute.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (always-Critical, COR-001/XC-001).</b> <see cref="Exercise"/> is the SCOPE, not an
/// <see cref="IExerciseScoped"/> entity, so <c>PulseDbContext</c>'s central read-side query filter is a
/// NO-OP on the <c>Exercises</c> table — a lookup here is unfiltered and would happily return another
/// exercise's settings. The exercise id therefore comes ONLY from <see cref="IExerciseContext"/>, which the
/// server resolves per request; there is no code path in this service that accepts an id from a caller.
/// </para>
/// <para>
/// <b>Fail closed, exactly as before the refactor.</b> Every method returns <c>null</c> when the scope is
/// unresolved (<c>null</c> or <see cref="Guid.Empty"/>), which the endpoints map to <c>401</c> — never a
/// default/empty-but-200 config. A RESOLVED scope whose <see cref="Exercise"/> row is missing is a different
/// case: it is not a leak and not an auth failure, so it serves the un-configured read model (the shipped
/// Phase-1 constants) rather than 401-ing a participant out of a world the resolver just vouched for.
/// </para>
/// <para>
/// Scoped lifetime, matching the request-scoped <see cref="PulseDbContext"/> / <see cref="IExerciseContext"/>
/// unit of work it reads through.
/// </para>
/// </remarks>
public sealed class ParticipantShellConfigService
{
    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly IChromeConfigProjection _chromeProjection;
    private readonly IShellVariantProjection _shellVariantProjection;
    private readonly IOverlayStateProjection _overlayStateProjection;

    /// <summary>Creates the service over persistence, the resolved scope, and the three projections.</summary>
    /// <param name="dbContext">The persistence context the exercise row is read through.</param>
    /// <param name="exerciseContext">The server-resolved exercise scope — the ONLY source of "which exercise".</param>
    /// <param name="chromeProjection">The chrome-config projection (01b default; story 02 replaces it).</param>
    /// <param name="shellVariantProjection">The shell-variant projection (01b default; story 03 replaces it).</param>
    /// <param name="overlayStateProjection">The overlay-state projection (01b default; story 03 replaces it).</param>
    public ParticipantShellConfigService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        IChromeConfigProjection chromeProjection,
        IShellVariantProjection shellVariantProjection,
        IOverlayStateProjection overlayStateProjection)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(chromeProjection);
        ArgumentNullException.ThrowIfNull(shellVariantProjection);
        ArgumentNullException.ThrowIfNull(overlayStateProjection);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _chromeProjection = chromeProjection;
        _shellVariantProjection = shellVariantProjection;
        _overlayStateProjection = overlayStateProjection;
    }

    /// <summary><c>GET /api/shell-state</c> — <c>null</c> when the scope is unresolved (the endpoint 401s).</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The shell state, or <c>null</c> to fail closed.</returns>
    public async Task<ShellStateResponse?> GetShellStateAsync(CancellationToken cancellationToken = default)
    {
        var source = await ResolveSourceAsync(cancellationToken);
        return source is null ? null : await _shellVariantProjection.ProjectAsync(source, cancellationToken);
    }

    /// <summary><c>GET /api/chrome-config</c> — <c>null</c> when the scope is unresolved (the endpoint 401s).</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The chrome config, or <c>null</c> to fail closed.</returns>
    public async Task<ChromeConfigResponse?> GetChromeConfigAsync(CancellationToken cancellationToken = default)
    {
        var source = await ResolveSourceAsync(cancellationToken);
        return source is null ? null : await _chromeProjection.ProjectAsync(source, cancellationToken);
    }

    /// <summary>
    /// <c>GET /api/brand-tokens</c> — the exercise's configured brand (COR-030 theming) on the frozen
    /// <c>BrandTokensResponse</c> shape; each unconfigured field falls back to its shipped constant, and the
    /// optional <c>logo</c> slot stays structurally absent. <c>null</c> when the scope is unresolved.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The brand tokens, or <c>null</c> to fail closed.</returns>
    public async Task<BrandTokensResponse?> GetBrandTokensAsync(CancellationToken cancellationToken = default)
    {
        var source = await ResolveSourceAsync(cancellationToken);
        if (source is null)
        {
            return null;
        }

        return new BrandTokensResponse
        {
            // The frontend guard rejects an empty brand name, so a blank column is treated as unconfigured.
            Name = Fallback(source.BrandName, ParticipantShellDefaults.BrandName),
            Colors = new BrandColors
            {
                Primary = Fallback(source.BrandPrimary, ParticipantShellDefaults.BrandPrimary),
                Accent = Fallback(source.BrandAccent, ParticipantShellDefaults.BrandAccent),
                Surface = Fallback(source.BrandSurface, ParticipantShellDefaults.BrandSurface),
                OnSurface = Fallback(source.BrandOnSurface, ParticipantShellDefaults.BrandOnSurface),
            },
        };
    }

    /// <summary>
    /// <c>GET /api/channel-nav-config</c> — the FULL catalog with this exercise's per-channel
    /// <c>enabled</c> flags (COR-030/061/062) on the frozen <c>ChannelNavConfigResponse</c> shape. A channel
    /// the exercise has not enabled is reported <c>enabled: false</c> and the frontend filters it out, so no
    /// participant route serves it. <c>null</c> when the scope is unresolved.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The channel-nav config, or <c>null</c> to fail closed.</returns>
    public async Task<ChannelNavConfigResponse?> GetChannelNavConfigAsync(CancellationToken cancellationToken = default)
    {
        var source = await ResolveSourceAsync(cancellationToken);
        if (source is null)
        {
            return null;
        }

        var enabled = source.EnabledChannelIds ?? ChannelCatalog.DefaultEnabledIds;

        var channels = ChannelCatalog.All
            .Select(entry => new ChannelNavChannel
            {
                Id = entry.Id,
                Label = entry.Label,
                Icon = entry.Icon,
                Enabled = enabled.Contains(entry.Id),
            })
            .ToList();

        // The channel to select on mount must itself be enabled, else the frontend falls back to the first
        // enabled channel anyway. Pick the first enabled entry in catalog order; keep the shipped 'social'
        // literal as the last resort so the field is never empty.
        var currentChannelId = channels.FirstOrDefault(c => c.Enabled)?.Id ?? ChannelCatalog.SocialChannelId;

        return new ChannelNavConfigResponse
        {
            Channels = channels,
            CurrentChannelId = currentChannelId,
            HideWhenSingleChannel = ParticipantShellDefaults.HideWhenSingleChannel,
        };
    }

    /// <summary>
    /// <c>GET /api/alerts</c> — Phase-1 has no controller-driven alert publish (that is Phase 3), so this is
    /// still the empty-but-present alert list. It keeps the scope check, and only the scope check, so it
    /// fails closed identically to the other five without a pointless database round trip.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The alerts body, or <c>null</c> to fail closed.</returns>
    public Task<AlertsResponse?> GetAlertsAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        return Task.FromResult(HasResolvedScope(out _) ? new AlertsResponse { Alerts = [] } : null);
    }

    /// <summary><c>GET /api/overlay-state</c> — <c>null</c> when the scope is unresolved (the endpoint 401s).</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The overlay state, or <c>null</c> to fail closed.</returns>
    public async Task<OverlayStateResponse?> GetOverlayStateAsync(CancellationToken cancellationToken = default)
    {
        var source = await ResolveSourceAsync(cancellationToken);
        return source is null ? null : await _overlayStateProjection.ProjectAsync(source, cancellationToken);
    }

    /// <summary>
    /// Loads the read model for the SERVER-RESOLVED exercise, or <c>null</c> when no scope is resolved
    /// (fail closed). The lookup is keyed on <see cref="IExerciseContext.CurrentExerciseId"/> and nothing
    /// else — this is the one place the exercise identity enters the participant read path.
    /// </summary>
    private async Task<ExerciseShellConfigSource?> ResolveSourceAsync(CancellationToken cancellationToken)
    {
        if (!HasResolvedScope(out var exerciseId))
        {
            return null;
        }

        // org-scope-exempt(ResolvedScope): exerciseId comes from HasResolvedScope (IExerciseContext), never a
        // client value, so this participant-facing read cannot reach another exercise or another customer.
        var exercise = await _dbContext.Exercises
            .AsNoTracking()
            .FirstOrDefaultAsync(e => e.Id == exerciseId, cancellationToken);

        return exercise is null
            ? ExerciseShellConfigSource.Unconfigured(exerciseId)
            : ExerciseShellConfigSource.FromExercise(exercise);
    }

    /// <summary>The fail-closed scope check: an unset scope collapses to <see cref="Guid.Empty"/> and is refused.</summary>
    private bool HasResolvedScope(out Guid exerciseId)
    {
        var scope = _exerciseContext.CurrentExerciseId;
        exerciseId = scope ?? Guid.Empty;
        return exerciseId != Guid.Empty;
    }

    /// <summary>Returns the configured value, or the shipped constant when it is absent or blank.</summary>
    private static string Fallback(string? configured, string shipped) =>
        string.IsNullOrWhiteSpace(configured) ? shipped : configured;
}
