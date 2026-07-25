namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// A persona as it exists WITHIN one exercise run — a fictional actor whose posts populate the world.
/// Belongs to exactly one run, so it is <see cref="IExerciseScoped"/> with a non-nullable
/// <see cref="ExerciseId"/>. May optionally record the shared <see cref="PersonaTemplate"/> it was
/// instantiated from (<see cref="PersonaTemplateId"/>), but the template lives in a cross-run library.
/// </summary>
public sealed class Persona : IExerciseScoped
{
    /// <summary>Primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>The owning exercise run (COR-001). Non-nullable; the write-guard rejects <see cref="Guid.Empty"/>.</summary>
    public Guid ExerciseId { get; set; }

    /// <summary>Display name shown on participant surfaces.</summary>
    public required string DisplayName { get; set; }

    /// <summary>
    /// Social handle shown on participant surfaces. Unique PER EXERCISE and case-insensitively — enforced by
    /// <c>IX_Personas_ExerciseId_Handle</c> (migration <c>PersonaHandleUniqueIndex</c>, <c>backend-host/03</c>)
    /// under the <c>SQL_Latin1_General_CP1_CI_AS</c> collation, so <c>mvega_fh</c> and <c>MVega_FH</c> cannot
    /// coexist in one exercise. NOT unique globally: two exercises may each run a <c>@FulcoEM</c>
    /// (<c>docs/01-platform-core-isolation.md</c> §7 Q3). Stored WITHOUT a leading <c>@</c> by
    /// <c>PersonaCastSeeder</c>; the index treats <c>@x</c> and <c>x</c> as distinct keys, so callers that accept
    /// either spelling normalize it themselves rather than relying on the constraint.
    /// </summary>
    public required string Handle { get; set; }

    /// <summary>
    /// Optional pointer to the shared <see cref="PersonaTemplate"/> this persona was instantiated from.
    /// Nullable — a persona can be authored directly in-run with no template. Not a scoped reference:
    /// templates are shared across runs.
    /// </summary>
    public Guid? PersonaTemplateId { get; set; }

    /// <summary>
    /// The frontend <c>PersonaKind</c> union value — <c>human</c> (individual) or <c>org</c>
    /// (institutional) — as a string. Governs the R-004 avatar treatment (duotone silhouette vs.
    /// monogram); never inferred from a persona type, since a bad-actor persona impersonating an org
    /// is still <c>org</c>.
    /// </summary>
    public required string Kind { get; set; }

    /// <summary>
    /// The SOC-052 trust signal — whether this persona instance carries the platform's verified seal.
    /// A plain per-instance flag, never inferred from <see cref="Kind"/> alone, so an unverified
    /// lookalike account remains visually possible (impersonation training).
    /// </summary>
    public bool Verified { get; set; }

    /// <summary>
    /// Optional participant-visible profile bio (COR-020) — free text. Nullable: a persona may legitimately
    /// have no bio, and the frozen client contract types <c>bio</c> as optional, so a null here is OMITTED
    /// from the wire payload rather than emitted as null.
    /// </summary>
    /// <remarks>
    /// <b>Every write path MUST route this through <c>PostSanitizer.Sanitize</c> (NFR-004).</b> Today the only
    /// writer is <c>PersonaCastSeeder</c>, which does; the guarantee therefore lives at ONE call site, not in
    /// the type. Any future writer (planner template authoring COR-020, mid-exercise persona creation
    /// COR-022, an import) must sanitize at its own ingest boundary — strip, never encode — before assigning
    /// here, exactly as the post ingest funnel does, because a stored bio renders on a participant profile.
    /// Bounded by <see cref="MaxBioLength"/> in the schema, so an over-long value is an authoring bug.
    /// </remarks>
    public string? Bio { get; set; }

    /// <summary>
    /// Whether the ENGINE may voice this persona (cast it into a storyline's eligible set). Server-side
    /// authoring state only — it is NEVER projected onto any participant-facing DTO, because a flag that
    /// singles out the impersonator would be exactly the machine-readable tell SOC-052/D1-008 forbid.
    /// </summary>
    /// <remarks>
    /// Defaults to <c>true</c>: an ordinary persona is castable. The seeded bad-actor / low-credibility
    /// accounts (the SOC-052 lookalike and the sensational outlet) ship <c>false</c>, so they EXIST as rows —
    /// participants can browse the lookalike's profile and learn to spot it — while the engine can never
    /// generate content as them until a scenario explicitly opts in by flipping this column. That honours
    /// <c>engine-content-seed</c>'s standing concern (seeding a troll voice the platform "has no way to turn
    /// off") without withholding the SOC-052 training material.
    /// </remarks>
    public bool Castable { get; set; } = true;

    /// <summary>
    /// The frontend <c>PersonaType</c> union value — <c>news-outlet</c> / <c>agency</c> /
    /// <c>weather-scientific</c> / <c>citizen</c> / <c>influencer</c> / <c>business</c> / <c>bad-actor</c>
    /// — as a string (COR-020's archetype). Distinct from <see cref="Kind"/>: a <c>bad-actor</c>
    /// impersonating an org is still <c>org</c>. NEVER a trust signal — the platform does not flag a
    /// <c>bad-actor</c> persona anywhere on a participant surface (D1-008); the absent <see cref="Verified"/>
    /// seal is the only signal a participant ever sees, and this field exists for the engine's archetype
    /// behavior and staff-side authoring, not for a badge. Defaults to <see cref="DefaultPersonaType"/> for
    /// a row written without an authored archetype.
    /// </summary>
    public string PersonaType { get; set; } = DefaultPersonaType;

    /// <summary>
    /// The frontend <c>AudienceBand</c> union value (SOC-054) — <c>nano</c> / <c>micro</c> / <c>mid</c> /
    /// <c>large</c> / <c>mega</c> — as a string. The only follower vocabulary a planner authors; the
    /// concrete number is DERIVED from it (<see cref="AudienceMagnitude"/>), never authored directly.
    /// Defaults to <see cref="DefaultAudienceBand"/> (the least presumptive band) for a row written without
    /// an authored band.
    /// </summary>
    public string AudienceBand { get; set; } = DefaultAudienceBand;

    /// <summary>
    /// The SOC-054 audience magnitude derived from <see cref="AudienceBand"/> at seed time — the believable
    /// reach a persona carries independent of any real follow edge. DISTINCT from the eventual displayed
    /// follower count, which <c>profiles-social-graph/05</c> composes at read time as
    /// <c>magnitude + real follow edges</c> (story 07's edge table); nothing combines the two into this
    /// column.
    /// </summary>
    public int AudienceMagnitude { get; set; }

    /// <summary>
    /// The persona's account-creation instant — a SCENARIO instant PREDATING the exercise (COR-021,
    /// COR-053), deterministically derived at seed time from a fixed pre-exercise epoch, never a read of the
    /// server's wall clock. Defaults to <see cref="DefaultJoinedAt"/> (that same epoch) for a row written
    /// without an authored join date, so the column can never hold a wall-clock "now" or a
    /// <c>0001-01-01</c> sentinel.
    /// </summary>
    public DateTimeOffset JoinedAt { get; set; } = DefaultJoinedAt;

    /// <summary>
    /// The archetype a persona row carries when none was authored — the least presumptive of the frontend
    /// <c>PersonaType</c> union values. Also the SQL column default, so rows written before this column
    /// existed read back as a contract-valid value rather than an empty string.
    /// </summary>
    public const string DefaultPersonaType = "citizen";

    /// <summary>The maximum stored <see cref="Bio"/> length — the schema bound, shared with the seeder's authoring-time guard.</summary>
    public const int MaxBioLength = 512;

    /// <summary>
    /// The audience band a persona row carries when none was authored — the smallest of the frontend
    /// <c>AudienceBand</c> union values, pairing honestly with a zero <see cref="AudienceMagnitude"/>. Also
    /// the SQL column default (see <see cref="DefaultPersonaType"/>).
    /// </summary>
    public const string DefaultAudienceBand = "nano";

    /// <summary>
    /// The fixed pre-exercise SCENARIO instant a persona row carries when no join date was authored, and the
    /// SQL column default. A hardcoded constant — never <c>DateTimeOffset.UtcNow</c> (COR-053) — and the same
    /// epoch the seeder's deterministic per-handle backdating counts back from.
    /// </summary>
    public static readonly DateTimeOffset DefaultJoinedAt = new(2026, 6, 15, 12, 0, 0, TimeSpan.Zero);
}
