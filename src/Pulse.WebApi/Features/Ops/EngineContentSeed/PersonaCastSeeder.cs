namespace Pulse.WebApi.Features.Ops.EngineContentSeed;

using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pulse.Core.Features.Generation.Models;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social;

/// <summary>
/// The engine's minimum-viable persona-cast write path (feature engine-content-seed, story 01). It ensures a
/// fixed, idempotent starter cast of nine <see cref="Persona"/> rows exists for one already-bootstrapped
/// exercise, so the publish path (<c>EngineReviewService.ResolvePersonaHandlesAsync</c> →
/// <c>EnginePublishService</c>) can resolve each drafted post's handle to a real persona instance rather than
/// failing closed on an empty cast. Each persisted row is paired with a real
/// <see cref="PersonaDossier"/> from an internal catalog so the built diversity gate
/// (<c>BurstAcceptancePolicy</c>) has genuine per-persona voice/style material, and a future live-provider
/// swap has real voice notes to work with.
/// </summary>
/// <remarks>
/// <para>
/// <b>Narrow, engine-scoped stopgap — NOT COR-020/021.</b> This is a hardcoded, fixed cast with no template
/// library and no authoring UI; <c>persona-management</c> remains the real templates/cast-authoring feature
/// (see <c>feature.md</c> "Naming disambiguation"). The nine handles/names/kind/verified values mirror the
/// shipped frontend org-library mock (<c>personaTemplates.ts</c>) handle-for-handle so
/// <c>GET /api/personas</c> and this seed never disagree.
/// </para>
/// <para>
/// <b>The SOC-052 impersonation pair is now seeded (<c>profiles-social-graph/06</c>, AC4) — superseding
/// <c>engine-content-seed/feature.md</c>'s "bad-actor / impersonator personas — excluded this pass" note.</b>
/// <c>@FairhavenWaterUpd</c> (unverified lookalike of the verified <c>@FairhavenWater</c>) and
/// <c>@TheScoopHQ</c> now ship, because a live exercise with no lookalike account has nothing to train
/// impersonation-spotting against. Matching the platform's own rule (D1-008) the seeder never marks or flags
/// the lookalike in ANY field — no "suspected"/"unverified reason"/"impersonator" column exists; the ABSENT
/// <see cref="Persona.Verified"/> seal is the only signal, exactly as for every other unverified persona.
/// </para>
/// <para>
/// <b>…but the ENGINE cannot voice them: <see cref="Persona.Castable"/> is the gate.</b> The old exclusion
/// note's real concern was seeding a troll voice the platform has no way to turn off. Both accounts therefore
/// ship <c>Castable = false</c>: the ROWS exist (so a participant can browse the lookalike's profile and a
/// controller can see it in the cast), while <see cref="SeededPersona.Castable"/> keeps them OUT of the
/// eligible-cast set <c>EngineContentSeedService</c> hands the reaction loop — the engine literally cannot
/// generate as them until a scenario opts in by flipping the column. A real gate, not a priority ordering.
/// The flag is server-side only and is never projected onto a participant DTO (it would be another
/// machine-readable lookalike tell).
/// </para>
/// <para>
/// <b>Isolation (always-Critical, COR-001).</b> Every created/reused row is confined to the caller-resolved
/// <paramref name="exerciseId"/> — never <see cref="System.Guid.Empty"/>, never another exercise's id. This
/// ops seam has no per-request <see cref="IExerciseContext"/> (mirroring <c>BootstrapService</c>'s documented
/// stopgap — there is no session to resolve one from), so the idempotency read uses
/// <c>IgnoreQueryFilters()</c> PLUS an explicit <see cref="Persona.ExerciseId"/> predicate rather than relying
/// on the fail-closed-to-empty global query filter (which would see zero rows and duplicate on every call).
/// </para>
/// <para>
/// <b>Unit of work.</b> <see cref="SeedAsync"/> ADDS the new rows to the tracked context but does NOT
/// <c>SaveChanges</c> — the composing caller (story 03's <c>EngineContentSeedService</c>) commits the persona
/// writes and its single XC-004 audit event together in ONE unit of work. Every stored free-text field runs
/// through the shared <see cref="PostSanitizer"/> funnel (NFR-004) even though these are developer-authored
/// constants today, so a value can never carry an executable payload regardless of its origin.
/// </para>
/// </remarks>
public sealed class PersonaCastSeeder
{
    /// <summary>Frontend <c>PersonaKind</c> union value for an institutional actor (utility / county / outlet).</summary>
    private const string OrgKind = "org";

    /// <summary>Frontend <c>PersonaKind</c> union value for an individual actor (a resident).</summary>
    private const string HumanKind = "human";

    /// <summary>Frontend <c>PersonaType</c> union value for an official agency voice.</summary>
    private const string AgencyProfileType = "agency";

    /// <summary>Frontend <c>PersonaType</c> union value for a news outlet.</summary>
    private const string NewsOutletProfileType = "news-outlet";

    /// <summary>Frontend <c>PersonaType</c> union value for a low-credibility engagement-driven account.</summary>
    private const string InfluencerProfileType = "influencer";

    /// <summary>Frontend <c>PersonaType</c> union value for an ordinary resident.</summary>
    private const string CitizenProfileType = "citizen";

    /// <summary>
    /// Frontend <c>PersonaType</c> union value for a deliberately deceptive account (SOC-052). An AUTHORING
    /// archetype only: it drives this seeder's recent-join backdating and the engine's voice, and is NEVER a
    /// participant-visible flag — the platform never marks a lookalike (D1-008).
    /// </summary>
    public const string BadActorProfileType = "bad-actor";

    /// <summary>Frontend <c>AudienceBand</c> union value — the smallest audience.</summary>
    private const string NanoBand = "nano";

    /// <summary>Frontend <c>AudienceBand</c> union value — a small local audience.</summary>
    private const string MicroBand = "micro";

    /// <summary>Frontend <c>AudienceBand</c> union value — a regionally significant audience.</summary>
    private const string MidBand = "mid";

    /// <summary>Frontend <c>AudienceBand</c> union value — a large market audience.</summary>
    private const string LargeBand = "large";

    /// <summary>Frontend <c>AudienceBand</c> union value — a national/mass audience.</summary>
    private const string MegaBand = "mega";

    /// <summary>
    /// The approximate follower floor per audience-magnitude band (SOC-054) — a verbatim mirror of the
    /// frontend mock's <c>BAND_BASE</c> table (<c>features/personas/seedCast.ts</c>), so a live-seeded
    /// exercise and the mock agree on believable numbers for the same handle/band pairing.
    /// </summary>
    /// <remarks>
    /// ORDINAL, deliberately — the same case discipline <see cref="DeriveJoinedAt"/> applies to the
    /// archetype comparison. Both vocabularies are closed, developer-authored, lower-case union values, so a
    /// stray <c>"Mid"</c> is an authoring bug that must fail loudly here rather than be silently folded by one
    /// lookup and missed by the other (a case-insensitive band lookup beside a case-sensitive
    /// <c>bad-actor</c> check would mean <c>"Bad-Actor"</c> quietly produced an established join date for an
    /// impersonator — SOC-052 backwards).
    /// </remarks>
    private static readonly Dictionary<string, int> AudienceBandFloors =
        new(StringComparer.Ordinal)
        {
            [NanoBand] = 450,
            [MicroBand] = 4800,
            [MidBand] = 46000,
            [LargeBand] = 220000,
            [MegaBand] = 1500000,
        };

    /// <summary>
    /// The fixed nine-persona starter cast (E8 arch §5), matching the shipped frontend org-library mock
    /// (<c>personaTemplates.ts</c>) handle-for-handle — the official voices (utility, county EM), a broadcast
    /// outlet, a sensational low-credibility outlet, the SOC-052 unverified lookalike of the utility, and four
    /// residents. Presentation fields (bio / persona type / audience band) are authored here; the concrete
    /// magnitude and join instant are DERIVED per handle (see <see cref="DeriveAudienceMagnitude"/> /
    /// <see cref="DeriveJoinedAt"/>).
    /// </summary>
    private static readonly IReadOnlyList<PersonaSeedSpec> Catalog =
    [
        new PersonaSeedSpec(
            Handle: "FairhavenWater",
            DisplayName: "Fairhaven Water Utility",
            Kind: OrgKind,
            Verified: true,
            ProfileType: AgencyProfileType,
            Band: MidBand,
            Bio: "Official account of the Fairhaven municipal water utility. Service updates & advisories.",
            Type: PersonaType.Agency,
            VoiceNotes: "Measured, factual, procedural. Leads with what is confirmed vs. pending; never "
                + "speculates and defers to the county on advisories.",
            Style: new PersonaStyle { AvgLength = 180, EmojiRate = 0.0, HashtagRate = 0.2, CapsConvention = "normal" },
            DossierAudience: 5000,
            Castable: true),
        new PersonaSeedSpec(
            // SOC-052 impersonation pair: an UNVERIFIED near-identical lockup of the verified utility above.
            // Nothing here flags it as fake — the missing verified seal is the only participant-visible tell
            // (D1-008), reinforced by the recent join date DeriveJoinedAt gives a bad-actor archetype.
            Handle: "FairhavenWaterUpd",
            DisplayName: "Fairhaven Water Update",
            Kind: OrgKind,
            Verified: false,
            ProfileType: BadActorProfileType,
            Band: NanoBand,
            Bio: "Real-time Fairhaven water updates. Stay informed.",
            Type: PersonaType.Troll,
            VoiceNotes: "Impersonates the real utility (SOC-052). Urgent, authoritative-sounding, subtly "
                + "wrong; overstates contamination to drive shares. Near-identical lockup to "
                + "@FairhavenWater — the missing verified mark is the only signal.",
            Style: new PersonaStyle { AvgLength = 120, EmojiRate = 0.1, HashtagRate = 0.6, CapsConvention = "normal" },
            DossierAudience: 300,
            Castable: false),
        new PersonaSeedSpec(
            Handle: "FulcoEM",
            DisplayName: "Fulton County EM",
            Kind: OrgKind,
            Verified: true,
            ProfileType: AgencyProfileType,
            Band: MidBand,
            Bio: "Official emergency management for Fulton County. Preparedness · Response · Recovery.",
            Type: PersonaType.Agency,
            VoiceNotes: "Authoritative but calm. Issues plain-language advisories with zones and actions; "
                + "coordinates with and gently corrects other voices.",
            Style: new PersonaStyle { AvgLength = 200, EmojiRate = 0.0, HashtagRate = 0.3, CapsConvention = "normal" },
            DossierAudience: 8000,
            Castable: true),
        new PersonaSeedSpec(
            Handle: "Newsline7",
            DisplayName: "Newsline 7",
            Kind: OrgKind,
            Verified: true,
            ProfileType: NewsOutletProfileType,
            Band: LargeBand,
            Bio: "Fairhaven’s breaking-news source. Newsline 7 — on your side.",
            Type: PersonaType.Outlet,
            VoiceNotes: "Broadcast-news cadence, headline first. Attributes claims to officials; reports "
                + "developments without editorializing.",
            Style: new PersonaStyle { AvgLength = 140, EmojiRate = 0.0, HashtagRate = 0.5, CapsConvention = "normal" },
            DossierAudience: 20000,
            Castable: true),
        new PersonaSeedSpec(
            Handle: "TheScoopHQ",
            DisplayName: "The Scoop",
            Kind: OrgKind,
            Verified: false,
            ProfileType: InfluencerProfileType,
            Band: MidBand,
            Bio: "The stories they don’t want you to see. 👀 #Fairhaven",
            Type: PersonaType.Outlet,
            VoiceNotes: "Sensational, engagement-baiting, low credibility by design. Amplifies rumor over "
                + "fact and leans on the lookalike account's claims; a deliberate contrast to the verified "
                + "voices.",
            Style: new PersonaStyle { AvgLength = 100, EmojiRate = 0.4, HashtagRate = 0.7, CapsConvention = "normal" },
            DossierAudience: 12000,
            Castable: false),
        new PersonaSeedSpec(
            Handle: "mvega_fh",
            DisplayName: "Marisol Vega",
            Kind: HumanKind,
            Verified: false,
            ProfileType: CitizenProfileType,
            Band: MicroBand,
            Bio: "Fairhaven east side. Mom, nurse, neighbor.",
            Type: PersonaType.Resident,
            VoiceNotes: "Concerned resident who asks practical questions (is the water safe for my kids?). "
                + "Shares official posts; occasionally rattled by the rumor mill.",
            Style: new PersonaStyle { AvgLength = 90, EmojiRate = 0.3, HashtagRate = 0.4, CapsConvention = "normal" },
            DossierAudience: 400,
            Castable: true),
        new PersonaSeedSpec(
            Handle: "tbrandt41",
            DisplayName: "Tom Brandt",
            Kind: HumanKind,
            Verified: false,
            ProfileType: CitizenProfileType,
            Band: NanoBand,
            Bio: "Small business owner. Coffee, dogs, local sports.",
            Type: PersonaType.Resident,
            VoiceNotes: "Skeptical, a little cynical. Complains about mixed messaging; sometimes reposts a "
                + "sensational take before thinking twice.",
            Style: new PersonaStyle { AvgLength = 70, EmojiRate = 0.1, HashtagRate = 0.1, CapsConvention = "lower" },
            DossierAudience: 80,
            Castable: true),
        new PersonaSeedSpec(
            Handle: "kwardFH",
            DisplayName: "Keisha Ward",
            Kind: HumanKind,
            Verified: false,
            ProfileType: CitizenProfileType,
            Band: MicroBand,
            Bio: "Community organizer. Fairhaven strong. 💧",
            Type: PersonaType.Resident,
            VoiceNotes: "Level-headed, community-minded. Steers neighbors to the verified utility and county "
                + "accounts; keeps a calm, organizing tone.",
            Style: new PersonaStyle { AvgLength = 110, EmojiRate = 0.2, HashtagRate = 0.3, CapsConvention = "normal" },
            DossierAudience: 350,
            Castable: true),
        new PersonaSeedSpec(
            Handle: "dreyes_fh",
            DisplayName: "Dana Reyes",
            Kind: HumanKind,
            Verified: false,
            ProfileType: CitizenProfileType,
            Band: NanoBand,
            Bio: "Fairhaven resident. Just trying to keep up.",
            Type: PersonaType.Resident,
            VoiceNotes: "Reads more than they post. Occasional questions and reposts; the ordinary "
                + "logged-in resident's voice.",
            Style: new PersonaStyle { AvgLength = 80, EmojiRate = 0.2, HashtagRate = 0.2, CapsConvention = "normal" },
            DossierAudience: 120,
            Castable: true),
    ];

    /// <summary>
    /// Authoring-time guard: validates the developer-authored <see cref="Catalog"/> the moment this type is
    /// first touched, so a mistake surfaces on the FIRST test/boot that uses the seeder rather than as an
    /// opaque truncation error at <c>SaveChangesAsync</c> (or, worse, a silently over-long value that only
    /// fails against a real SQL Server in CI). Checks every bio against the <see cref="Persona.MaxBioLength"/>
    /// column bound and every band against the closed SOC-054 vocabulary.
    /// </summary>
    /// <exception cref="InvalidOperationException">A catalog bio exceeds the stored column's bound.</exception>
    static PersonaCastSeeder()
    {
        foreach (var spec in Catalog)
        {
            if (spec.Bio.Length > Persona.MaxBioLength)
            {
                throw new InvalidOperationException(
                    $"Persona catalog entry '{spec.Handle}' has a {spec.Bio.Length}-character bio, exceeding the "
                    + $"stored column bound of {Persona.MaxBioLength}. Shorten the authored bio.");
            }

            // Throws ArgumentOutOfRangeException on an unknown band — an authored band typo fails here too.
            _ = DeriveAudienceMagnitude(spec.Band, spec.Handle);
        }
    }

    private readonly PulseDbContext _dbContext;

    /// <summary>Creates the seeder over the persistence context it writes the cast through.</summary>
    /// <param name="dbContext">The persistence context (shared with the composing caller for one unit of work).</param>
    public PersonaCastSeeder(PulseDbContext dbContext)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        _dbContext = dbContext;
    }

    /// <summary>
    /// Ensures the fixed nine-persona starter cast exists for <paramref name="exerciseId"/>, reusing any row
    /// that already matches by <c>(ExerciseId, Handle)</c> and adding the rest to the tracked context (the
    /// caller commits). Idempotent and non-clobbering — a re-run reuses existing rows and never duplicates or
    /// overwrites them (the same contract <c>BootstrapService</c> uses for its own rows), so re-seeding an
    /// exercise that predates a catalog entry ADDS the missing handle exactly once and leaves the rows that
    /// already exist (and their presentation fields) untouched.
    /// </summary>
    /// <param name="exerciseId">The caller-resolved exercise the cast is scoped to (COR-001); must not be empty.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The nine seeded personas — each pairing the persisted <see cref="Persona.Id"/> with its real dossier.</returns>
    public async Task<IReadOnlyList<SeededPersona>> SeedAsync(Guid exerciseId, CancellationToken cancellationToken = default)
    {
        if (exerciseId == Guid.Empty)
        {
            throw new ArgumentException("The persona cast is exercise-scoped (COR-001).", nameof(exerciseId));
        }

        var handles = Catalog.Select(spec => spec.Handle).ToList();

        // Idempotency read: the ops seam has no resolved request scope, so bypass the fail-closed-to-empty
        // global filter and confine the read with an EXPLICIT ExerciseId predicate (still one exercise only).
        // The CI collation makes the handle IN-match case-insensitive, matching the (ExerciseId, Handle)
        // uniqueness contract now enforced by IX_Personas_ExerciseId_Handle (backend-host/03) — so this read
        // returns at most ONE row per catalog handle and the idempotency below is sound, not best-effort.
        var existing = await _dbContext.Personas
            .IgnoreQueryFilters()
            .Where(persona => persona.ExerciseId == exerciseId && handles.Contains(persona.Handle))
            .ToListAsync(cancellationToken);

        // The GroupBy stays now that the unique index exists: it is what keeps the ToDictionary from THROWING on
        // a same-handle pair, and it costs one pass over six rows. Under the index that pair is unreachable, so
        // this is a deliberate belt-and-braces layer, not a live code path — dropping it would trade a
        // constraint-guaranteed no-op for a crash if the index were ever dropped or the read widened.
        var existingByHandle = existing
            .GroupBy(persona => persona.Handle, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

        var seeded = new List<SeededPersona>(Catalog.Count);
        foreach (var spec in Catalog)
        {
            // Sanitize every stored free-text field through the SAME strip-not-encode funnel post ingest uses
            // (NFR-004), so the stored value can never carry an executable payload regardless of its origin.
            var displayName = PostSanitizer.Sanitize(spec.DisplayName);
            var handle = PostSanitizer.Sanitize(spec.Handle);
            var voiceNotes = PostSanitizer.Sanitize(spec.VoiceNotes);
            var bio = PostSanitizer.Sanitize(spec.Bio);

            var dossier = new PersonaDossier
            {
                Handle = handle,
                DisplayName = displayName,
                Type = spec.Type,
                VoiceNotes = voiceNotes,
                Style = spec.Style,
                AudienceBand = spec.DossierAudience,
            };

            var magnitude = DeriveAudienceMagnitude(spec.Band, handle);
            var joinedAt = DeriveJoinedAt(spec.ProfileType, handle);

            if (existingByHandle.TryGetValue(spec.Handle, out var row))
            {
                // Idempotent re-run: reuse the existing row's id, never overwrite an AUTHORED value.
                BackfillSentinelPresentationFields(row, spec, bio, magnitude, joinedAt);
                seeded.Add(new SeededPersona(row.Id, dossier, Created: false, Castable: row.Castable));
                continue;
            }

            var persona = new Persona
            {
                Id = Guid.NewGuid(),
                ExerciseId = exerciseId,
                DisplayName = displayName,
                Handle = handle,
                Kind = spec.Kind,
                Verified = spec.Verified,
                PersonaTemplateId = null,
                Bio = bio,
                PersonaType = spec.ProfileType,
                AudienceBand = spec.Band,
                // Derived from the AUTHORED band + the stored handle (COR-021/SOC-054) — varied but
                // deterministic, and never a wall-clock read for the join instant (COR-053/COR-023).
                AudienceMagnitude = magnitude,
                JoinedAt = joinedAt,
                Castable = spec.Castable,
            };
            _dbContext.Personas.Add(persona);
            seeded.Add(new SeededPersona(persona.Id, dossier, Created: true, Castable: spec.Castable));
        }

        return seeded;
    }

    /// <summary>
    /// Backfills the presentation fields of a row that predates them — and ONLY such a row (the bounded
    /// exception to "a re-run never overwrites an existing row", <c>profiles-social-graph/06</c> AC6 as
    /// amended).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Why this is safe.</b> The sentinel is <c>AudienceMagnitude == 0 AND JoinedAt == SeedEpoch</c> — a
    /// pair NO authored row can hold: <see cref="DeriveAudienceMagnitude"/> never returns less than the
    /// smallest band floor (450), and <see cref="DeriveJoinedAt"/> always subtracts at least three days, so a
    /// seeded row is always strictly before the epoch. That combination therefore means exactly one thing:
    /// the row was written before these columns existed and is carrying the migration's column DEFAULTS.
    /// </para>
    /// <para>
    /// <b>Why it is required (SOC-052).</b> Left alone, the six pre-existing personas would read as joining
    /// ON the epoch (2026-06-15) while the newly seeded lookalike derives 2026-06-09 — INVERTING the "joined
    /// this week" tell and making the impersonator look like the OLDER, more established account: the exact
    /// signal this story exists to create, backwards. <c>Bio</c> is filled only when absent
    /// (<c>??=</c>), so an authored bio is never clobbered.
    /// </para>
    /// </remarks>
    /// <param name="row">The existing row being reused.</param>
    /// <param name="spec">The catalog spec for this handle.</param>
    /// <param name="bio">The sanitized catalog bio.</param>
    /// <param name="magnitude">The derived SOC-054 magnitude for this handle/band.</param>
    /// <param name="joinedAt">The derived backdated scenario join instant for this handle.</param>
    private static void BackfillSentinelPresentationFields(
        Persona row,
        PersonaSeedSpec spec,
        string bio,
        int magnitude,
        DateTimeOffset joinedAt)
    {
        var carriesOnlyColumnDefaults = row.AudienceMagnitude == 0 && row.JoinedAt == SeedEpoch;
        if (!carriesOnlyColumnDefaults)
        {
            return;
        }

        row.Bio ??= bio;
        row.PersonaType = spec.ProfileType;
        row.AudienceBand = spec.Band;
        row.AudienceMagnitude = magnitude;
        row.JoinedAt = joinedAt;
    }

    /// <summary>
    /// The fixed pre-exercise SCENARIO epoch every seeded join instant precedes — the same constant the
    /// frontend mock counts back from (<c>seedCast.ts</c>'s <c>SEED_EPOCH_MS</c>,
    /// <c>2026-06-15T12:00:00Z</c>), shared with <see cref="Persona.DefaultJoinedAt"/> so exactly one epoch
    /// exists. A hardcoded scenario constant, NEVER a wall-clock read (COR-053).
    /// </summary>
    public static DateTimeOffset SeedEpoch => Persona.DefaultJoinedAt;

    /// <summary>
    /// Derives the SOC-054 audience magnitude for a persona from its authored band plus a deterministic
    /// per-handle spread — the C# mirror of the frontend mock's <c>deriveFollowerCount</c>
    /// (<c>features/personas/seedCast.ts</c>): the band floor plus up to +40% of that floor, selected by a
    /// stable FNV-1a-style hash of the handle. Deterministic (no randomness), so re-deriving for the same
    /// handle/band always yields the same number and the mock and the live seed agree.
    /// </summary>
    /// <param name="audienceBand">The authored <c>AudienceBand</c> union value (<c>nano</c>…<c>mega</c>).</param>
    /// <param name="handle">The persona's stored handle (without a leading <c>@</c>).</param>
    /// <returns>The derived magnitude: at least the band floor, and below the floor + 40%.</returns>
    /// <exception cref="ArgumentOutOfRangeException">The band is outside the closed SOC-054 vocabulary.</exception>
    public static int DeriveAudienceMagnitude(string audienceBand, string handle)
    {
        ArgumentNullException.ThrowIfNull(audienceBand);
        ArgumentNullException.ThrowIfNull(handle);

        if (!AudienceBandFloors.TryGetValue(audienceBand, out var floor))
        {
            throw new ArgumentOutOfRangeException(
                nameof(audienceBand),
                audienceBand,
                "Unknown audience band — the SOC-054 vocabulary is nano/micro/mid/large/mega.");
        }

        // Mirrors seedCast.ts verbatim: Math.floor((stableHash(handle) % 400) / 1000 * base).
        var spread = (int)Math.Floor(StableHash(handle) % 400 / 1000.0 * floor);
        return floor + spread;
    }

    /// <summary>
    /// Derives a persona's join instant as a deterministic, BACKDATED scenario instant: a fixed per-handle
    /// offset before <see cref="SeedEpoch"/> (COR-021 "join dates predating the exercise", COR-023). The C#
    /// mirror of the frontend mock's <c>deriveJoinedAt</c> — a <see cref="BadActorProfileType"/> persona
    /// joins RECENTLY (3-6 days before the epoch; the lookalike "joined this week" tell), every other
    /// archetype joins well before the exercise (~3 months to ~2 years). Never reads the server clock.
    /// </summary>
    /// <param name="personaProfileType">The authored frontend <c>PersonaType</c> union value.</param>
    /// <param name="handle">The persona's stored handle (without a leading <c>@</c>).</param>
    /// <returns>The derived scenario join instant, always strictly before <see cref="SeedEpoch"/>.</returns>
    public static DateTimeOffset DeriveJoinedAt(string personaProfileType, string handle)
    {
        ArgumentNullException.ThrowIfNull(personaProfileType);
        ArgumentNullException.ThrowIfNull(handle);

        var hash = StableHash(handle);
        var offsetDays = string.Equals(personaProfileType, BadActorProfileType, StringComparison.Ordinal)
            ? 3 + (int)(hash % 4)
            : 90 + (int)(hash % 640);

        return SeedEpoch.AddDays(-offsetDays);
    }

    /// <summary>
    /// A small, stable, non-negative string hash (FNV-1a) — the exact bit-for-bit mirror of
    /// <c>seedCast.ts</c>'s <c>stableHash</c> (whose <c>Math.imul</c> + <c>&gt;&gt;&gt; 0</c> is unsigned
    /// 32-bit arithmetic). The determinism source for both derivations above; never a random seed.
    /// </summary>
    /// <param name="input">The string to hash (a persona handle).</param>
    /// <returns>The unsigned 32-bit hash.</returns>
    private static uint StableHash(string input)
    {
        var hash = 2166136261u;
        foreach (var c in input)
        {
            unchecked
            {
                hash ^= c;
                hash *= 16777619u;
            }
        }

        return hash;
    }

    /// <summary>The developer-authored spec for one starter-cast persona (handle → kind/verified → presentation fields → dossier material).</summary>
    /// <param name="Handle">The stored handle, without a leading <c>@</c>.</param>
    /// <param name="DisplayName">The participant-visible display name.</param>
    /// <param name="Kind">The frontend <c>PersonaKind</c> union value (<c>human</c>/<c>org</c>).</param>
    /// <param name="Verified">The SOC-052 seal — the ONLY trust signal a participant sees.</param>
    /// <param name="ProfileType">The frontend <c>PersonaType</c> union value persisted on the entity.</param>
    /// <param name="Band">The frontend <c>AudienceBand</c> union value the magnitude is derived from.</param>
    /// <param name="Bio">The participant-visible profile bio (sanitized before it is stored).</param>
    /// <param name="Type">The ENGINE-facing dossier archetype (<see cref="PersonaType"/>), distinct from <paramref name="ProfileType"/>.</param>
    /// <param name="VoiceNotes">The generation-facing voice material.</param>
    /// <param name="Style">The generation-facing style parameters.</param>
    /// <param name="DossierAudience">The engine dossier's numeric audience input (prompt material — NOT the persisted SOC-054 magnitude).</param>
    /// <param name="Castable">Whether the ENGINE may voice this persona (<see cref="Persona.Castable"/>); server-side only.</param>
    private sealed record PersonaSeedSpec(
        string Handle,
        string DisplayName,
        string Kind,
        bool Verified,
        string ProfileType,
        string Band,
        string Bio,
        PersonaType Type,
        string VoiceNotes,
        PersonaStyle Style,
        int DossierAudience,
        bool Castable);
}

/// <summary>
/// One seeded persona: the persisted <see cref="Persona"/> instance id (<see cref="InstanceId"/>, the
/// <c>authorPersonaId</c> a published post is attributed to) paired with its generation-facing
/// <see cref="PersonaDossier"/>. Directly assignable into the reaction loop's
/// <c>EnginePersona(InstanceId, Dossier)</c> at story 03's registration seam.
/// </summary>
/// <param name="InstanceId">The exercise-scoped persona instance id.</param>
/// <param name="Dossier">The persona's voice/style dossier (the same shape the generate stage consumes).</param>
/// <param name="Created">
/// <c>true</c> when this call created the row; <c>false</c> when an existing same-handle row was reused
/// (drives story 03's created-vs-reused audit counts).
/// </param>
/// <param name="Castable">
/// Whether the ENGINE may voice this persona (<see cref="Persona.Castable"/>, read from the persisted row on
/// a reuse). The composing caller MUST filter on this when it builds the reaction loop's eligible cast: a
/// non-castable persona (the SOC-052 lookalike, the low-credibility outlet) exists as a row and is returned
/// here, but must never be handed to the engine as a voice until a scenario opts in. Server-side only —
/// never projected onto a participant-facing DTO.
/// </param>
public sealed record SeededPersona(Guid InstanceId, PersonaDossier Dossier, bool Created, bool Castable);
