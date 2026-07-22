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
    /// Lifecycle status — the <c>ExerciseStatus</c> union value as a string (<c>scheduled</c> / <c>active</c>
    /// / <c>complete</c> / <c>archived</c>), stored verbatim as the frozen frontend vocabulary
    /// (<c>exerciseContextResolver.ts</c>) and projecting onto the frozen <c>ExerciseScope.status</c>.
    /// Required; defaults to <c>scheduled</c>.
    /// </summary>
    public string Status { get; set; } = "scheduled";

    /// <summary>
    /// B2 PLACEHOLDER (COR-050 follow-up): the exercise's stored scenario-time instant that auth telemetry
    /// stamps as <c>scenarioTime</c> until the native backend scenario clock lands in Phase B3. Nullable —
    /// absent until configured. NOT a participant-visible field on any wire shape frozen this wave.
    /// </summary>
    public DateTimeOffset? CurrentScenarioTime { get; set; }
}
