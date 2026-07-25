namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// The aggregate root of one exercise RUN — the isolation scope everything else hangs off (COR-001).
/// Its own <see cref="Id"/> IS the scope, so it deliberately does NOT implement <see cref="IExerciseScoped"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>B2 Wave-0 additions (story 08 / exercise-isolation).</b> <c>GET /api/exercise-context</c> serves the
/// frozen <c>ExerciseScope</c> shape (<c>exerciseId</c>, <c>exerciseName</c>, <c>timeZone</c>, <c>status</c>)
/// from these columns, and <c>UseExerciseResolution()</c> maps a request's <c>Host</c> header to an exercise
/// via <see cref="Hostname"/> / <see cref="BrandedDomain"/>. New columns are kept nullable where a value may
/// be absent; <see cref="TimeZone"/> / <see cref="Status"/> are required with sensible non-null defaults so
/// the migration can add them to the existing table and the frozen wire fields are never null.
/// </para>
/// <para>
/// <see cref="CurrentScenarioTime"/> is a DOCUMENTED PLACEHOLDER (mirroring B1's approach): B2 auth telemetry
/// stamps <c>scenarioTime</c> from it until the native backend scenario clock (COR-050) lands in Phase B3.
/// </para>
/// <para>
/// <b>Exercise-configuration story 01a (the feature's ONE migration).</b> The COR-030 settings, the COR-031
/// compliance-chrome config, the NFR-008 watermark flag and the COR-033 practice flag are ALL authored here,
/// once, so stories 01b/02/03/04 layer BEHAVIOUR onto columns that already exist and author no further
/// migration. Every added settings column is either NULLABLE — where <c>null</c> means "not configured; the
/// projection falls back to the shipped Phase-1 constant in <c>ParticipantShellEndpoints</c>", which is what
/// makes story 01b's constant-preserving defaults truthful for existing rows — or non-nullable with a safe
/// default (the two chrome/watermark switches default ON, the practice flag defaults OFF).
/// </para>
/// </remarks>
public sealed class Exercise
{
    /// <summary>Primary key and the isolation scope every scoped entity's <c>ExerciseId</c> references.</summary>
    public Guid Id { get; set; }

    /// <summary>Human-readable name for the run (staff-facing) — projects onto the frozen <c>ExerciseScope.exerciseName</c>.</summary>
    public required string Name { get; set; }

    /// <summary>
    /// The provisioned per-exercise host (subdomain, e.g. <c>atl-cie.{platform-domain}.com</c>) the story-08
    /// middleware maps a request's <c>Host</c> header to (COR-008). Unique across exercises (filtered unique
    /// index — multiple exercises may be un-provisioned/<c>null</c>). Nullable until the exercise is provisioned.
    /// </summary>
    public string? Hostname { get; set; }

    /// <summary>
    /// An optional customer-branded domain (the Looking Glass pattern, COR-008) that also resolves to this
    /// exercise. Unique across exercises (filtered unique index). <c>null</c> when the exercise uses only its
    /// default <see cref="Hostname"/>.
    /// </summary>
    public string? BrandedDomain { get; set; }

    /// <summary>
    /// The exercise's IANA time zone (XC-008, e.g. <c>America/New_York</c>) — projects onto the frozen
    /// <c>ExerciseScope.timeZone</c>. Required; defaults to <c>UTC</c> so existing rows and un-configured
    /// exercises carry a valid non-null value.
    /// </summary>
    public string TimeZone { get; set; } = "UTC";

    /// <summary>
    /// Lifecycle status — the <c>ExerciseStatus</c> union value as a string, stored verbatim as the frontend
    /// vocabulary (<c>exerciseContextResolver.ts</c>) and projecting onto the frozen
    /// <c>ExerciseScope.status</c>. Required; defaults to <c>build</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>COR-032 vocabulary (Option B — Tier-2 sign-off given; exercise-configuration story 01a).</b> The
    /// authoritative literals are, verbatim: <c>build</c> | <c>staged</c> | <c>live</c> | <c>paused</c> |
    /// <c>completed</c> | <c>archived</c>. Lowercase single tokens, and <c>completed</c> — NOT the legacy
    /// <c>complete</c>. Do not coin <c>Build</c>, <c>in_progress</c>, <c>ended</c> or any other variant.
    /// </para>
    /// <para>
    /// <b>The legacy four remain VALID through the transition, deliberately.</b> The pre-COR-032 placeholder
    /// vocabulary (<c>scheduled</c> | <c>active</c> | <c>complete</c> | <c>archived</c>) is still accepted —
    /// by this column (there is no CHECK constraint) and by the widened frontend guard, which accepts the
    /// transitional SUPERSET of both vocabularies. That is what makes the split-deploy safe: UAT's Azure SWA
    /// frontend and App Service backend deploy independently and <c>isExerciseStatus</c> FAILS CLOSED on an
    /// unknown value (a blank participant world, not a type error), so the client widening is additive and
    /// ships no later than the backend. Retiring the legacy four is a documented follow-up, taken once no
    /// deployed client or database row carries them — it is NOT part of this story, so do not "clean them up".
    /// </para>
    /// <para>
    /// Story 01a's migration maps existing rows: <c>scheduled</c> → <c>build</c>, <c>active</c> →
    /// <c>live</c>, <c>complete</c> → <c>completed</c>, <c>archived</c> unchanged. The lifecycle STATE
    /// MACHINE (allowed transitions, participant gating, the Paused holding page) is story 03 — this column
    /// carries the vocabulary only.
    /// </para>
    /// </remarks>
    public string Status { get; set; } = "build";

    /// <summary>
    /// B2 PLACEHOLDER (COR-050 follow-up): the exercise's stored scenario-time instant that auth telemetry
    /// stamps as <c>scenarioTime</c> until the native backend scenario clock lands in Phase B3. Nullable —
    /// absent until configured. NOT a participant-visible field on any wire shape frozen this wave.
    /// </summary>
    public DateTimeOffset? CurrentScenarioTime { get; set; }

    // ============================================================================================
    // COR-030 per-exercise settings (exercise-configuration story 01). Story 01b's settings API and
    // shell-config projection read/write these; a NULL means "not configured" and the projection keeps
    // serving the shipped Phase-1 constant, so no existing row changes behaviour when this migration lands.
    // ============================================================================================

    /// <summary>
    /// The participant-visible world name (COR-030) — the in-fiction name of the simulated environment, as
    /// distinct from <see cref="Name"/>, which is the staff-facing internal name. Nullable: unconfigured
    /// exercises fall back to the shipped Phase-1 constant. Free text — sanitized + length-bounded on write
    /// by story 01b (NFR-004).
    /// </summary>
    public string? WorldName { get; set; }

    /// <summary>
    /// The participant-visible locale (COR-030) as a BCP-47 tag, e.g. <c>en-US</c>. Nullable — unset means
    /// the platform default. Distinct from <see cref="TimeZone"/>, which stays the single IANA zone per
    /// exercise (XC-008).
    /// </summary>
    public string? Locale { get; set; }

    /// <summary>
    /// The scheduled start of the exercise window (COR-030 schedule). Nullable — unscheduled until a planner
    /// sets it. A staff-world planning value: it does NOT start the clock and is NOT the lifecycle (story 03
    /// owns transitions; COR-050 owns the clock).
    /// </summary>
    public DateTimeOffset? ScheduledStartAt { get; set; }

    /// <summary>
    /// The scheduled end of the exercise window (COR-030 schedule). Nullable — see
    /// <see cref="ScheduledStartAt"/>; it does not trigger EndEx.
    /// </summary>
    public DateTimeOffset? ScheduledEndAt { get; set; }

    /// <summary>
    /// The enabled channel ids (COR-030), stored as a comma-separated list of the channel-catalog ids
    /// (<c>social,portal,news,press,weather</c>). Nullable — <c>null</c> means "not configured", and the
    /// projection serves the Phase-1 catalog default (Social enabled, E3–E6 catalogued-but-off). Story 01b
    /// owns parsing/validation and reporting <c>enabled: false</c> on the frozen
    /// <c>ChannelNavConfigResponse</c>.
    /// </summary>
    public string? EnabledChannels { get; set; }

    /// <summary>
    /// The participant-visible brand name (COR-030 theming) projected onto the frozen
    /// <c>BrandTokensResponse.name</c>. Nullable — falls back to the shipped constant. Free text, sanitized
    /// on write (NFR-004).
    /// </summary>
    public string? BrandName { get; set; }

    /// <summary>Brand primary color as a CSS hex string, for the frozen <c>BrandTokensResponse.colors.primary</c>. Nullable → shipped default.</summary>
    public string? BrandPrimary { get; set; }

    /// <summary>Brand accent color as a CSS hex string, for <c>BrandTokensResponse.colors.accent</c>. Nullable → shipped default.</summary>
    public string? BrandAccent { get; set; }

    /// <summary>Brand surface color as a CSS hex string, for <c>BrandTokensResponse.colors.surface</c>. Nullable → shipped default.</summary>
    public string? BrandSurface { get; set; }

    /// <summary>Brand on-surface (foreground) color as a CSS hex string, for <c>BrandTokensResponse.colors.onSurface</c>. Nullable → shipped default.</summary>
    public string? BrandOnSurface { get; set; }

    /// <summary>
    /// The per-outlet display names (COR-030 theming: "portal branding, outlet names") as an opaque JSON
    /// object keyed by outlet/channel id — stored, never parsed by this story. Nullable; the per-surface skin
    /// implementation belongs to the channel epics (E3–E6), which read this column rather than adding one.
    /// </summary>
    public string? OutletNamesJson { get; set; }

    // ============================================================================================
    // COR-031 compliance chrome + the NFR-008 watermark switch (exercise-configuration story 02 reads and
    // guards these; the columns are authored here under the single-migration rule).
    // ============================================================================================

    /// <summary>
    /// Whether compliance chrome is shown for this exercise (COR-031 / XC-003) — the frozen
    /// <c>ChromeConfigResponse.enabled</c>. Required, defaulting to <c>true</c> (chrome ON), matching the
    /// shipped Phase-1 constant so existing rows are unchanged. Chrome-off is a legal state (D7-008) but
    /// NEVER simultaneously with <see cref="WatermarkEnabled"/> off — story 02 owns that server-side mutual
    /// guard; the safe default here is both ON.
    /// </summary>
    public bool ComplianceChromeEnabled { get; set; } = true;

    /// <summary>Top compliance banner text (frozen <c>ChromeConfigResponse.top.text</c>). Nullable → shipped constant. Sanitized on write (NFR-004).</summary>
    public string? ChromeTopText { get; set; }

    /// <summary>Top compliance banner foreground color, CSS hex (frozen <c>top.fg</c>). Nullable → shipped constant.</summary>
    public string? ChromeTopFg { get; set; }

    /// <summary>Top compliance banner background color, CSS hex (frozen <c>top.bg</c>). Nullable → shipped constant.</summary>
    public string? ChromeTopBg { get; set; }

    /// <summary>Bottom compliance banner text (frozen <c>ChromeConfigResponse.bottom.text</c>). Nullable → shipped constant. Sanitized on write (NFR-004).</summary>
    public string? ChromeBottomText { get; set; }

    /// <summary>Bottom compliance banner foreground color, CSS hex (frozen <c>bottom.fg</c>). Nullable → shipped constant.</summary>
    public string? ChromeBottomFg { get; set; }

    /// <summary>Bottom compliance banner background color, CSS hex (frozen <c>bottom.bg</c>). Nullable → shipped constant.</summary>
    public string? ChromeBottomBg { get; set; }

    /// <summary>
    /// Whether the in-content "EXERCISE" watermark is on for this exercise (NFR-008). Required, defaulting
    /// to <c>true</c>. This is REAL per-exercise state — the column story 02's NFR-008 chrome↔watermark
    /// mutual guard reads, so that guard is never evaluated against a constant. The watermark's own
    /// rendering is an NFR-008 fast-follow in participant content; this column only carries its on/off state.
    /// </summary>
    public bool WatermarkEnabled { get; set; } = true;

    // ============================================================================================
    // COR-033 practice / sandbox flag (exercise-configuration story 04 owns the behaviour + the
    // evaluation-eligibility seam; the column is authored here).
    // ============================================================================================

    /// <summary>
    /// Whether this exercise is a practice/sandbox run whose data is excluded from evaluation exports
    /// (COR-033). Required, defaulting to <c>false</c> — an exercise that has never been flagged is real
    /// conduct. STAFF-WORLD ONLY: it is never projected onto a participant surface (XC-002), and setting it
    /// changes no channel, engine or telemetry behaviour (story 04).
    /// </summary>
    public bool IsPracticeMode { get; set; }
}
