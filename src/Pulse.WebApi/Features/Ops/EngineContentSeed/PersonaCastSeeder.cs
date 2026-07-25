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
/// fixed, idempotent starter cast of six <see cref="Persona"/> rows exists for one already-bootstrapped
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
/// (see <c>feature.md</c> "Naming disambiguation"). The six handles/names/kind/verified values mirror the
/// shipped frontend org-library mock (<c>personaTemplates.ts</c>) so <c>GET /api/personas</c> and this seed
/// never disagree; the SOC-052 impersonator and the influencer/troll personas are deliberately EXCLUDED (see
/// <c>feature.md</c> Design notes — there is no scenario "enable bad actors" toggle to turn them off).
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

    /// <summary>
    /// The fixed six-persona starter cast (E8 arch §5), matching the shipped frontend org-library mock exactly
    /// — the official voices (utility, county EM), a broadcast outlet, and three concerned citizens. Bad-actor
    /// / impersonator / influencer personas are excluded this pass (see class remarks).
    /// </summary>
    private static readonly IReadOnlyList<PersonaSeedSpec> Catalog =
    [
        new PersonaSeedSpec(
            Handle: "FairhavenWater",
            DisplayName: "Fairhaven Water Utility",
            Kind: OrgKind,
            Verified: true,
            Type: PersonaType.Agency,
            VoiceNotes: "Measured, factual, procedural. Leads with what is confirmed vs. pending; never "
                + "speculates and defers to the county on advisories.",
            Style: new PersonaStyle { AvgLength = 180, EmojiRate = 0.0, HashtagRate = 0.2, CapsConvention = "normal" },
            AudienceBand: 5000),
        new PersonaSeedSpec(
            Handle: "FulcoEM",
            DisplayName: "Fulton County EM",
            Kind: OrgKind,
            Verified: true,
            Type: PersonaType.Agency,
            VoiceNotes: "Authoritative but calm. Issues plain-language advisories with zones and actions; "
                + "coordinates with and gently corrects other voices.",
            Style: new PersonaStyle { AvgLength = 200, EmojiRate = 0.0, HashtagRate = 0.3, CapsConvention = "normal" },
            AudienceBand: 8000),
        new PersonaSeedSpec(
            Handle: "Newsline7",
            DisplayName: "Newsline 7",
            Kind: OrgKind,
            Verified: true,
            Type: PersonaType.Outlet,
            VoiceNotes: "Broadcast-news cadence, headline first. Attributes claims to officials; reports "
                + "developments without editorializing.",
            Style: new PersonaStyle { AvgLength = 140, EmojiRate = 0.0, HashtagRate = 0.5, CapsConvention = "normal" },
            AudienceBand: 20000),
        new PersonaSeedSpec(
            Handle: "mvega_fh",
            DisplayName: "Marisol Vega",
            Kind: HumanKind,
            Verified: false,
            Type: PersonaType.Resident,
            VoiceNotes: "Concerned resident who asks practical questions (is the water safe for my kids?). "
                + "Shares official posts; occasionally rattled by the rumor mill.",
            Style: new PersonaStyle { AvgLength = 90, EmojiRate = 0.3, HashtagRate = 0.4, CapsConvention = "normal" },
            AudienceBand: 400),
        new PersonaSeedSpec(
            Handle: "tbrandt41",
            DisplayName: "Tom Brandt",
            Kind: HumanKind,
            Verified: false,
            Type: PersonaType.Resident,
            VoiceNotes: "Skeptical, a little cynical. Complains about mixed messaging; sometimes reposts a "
                + "sensational take before thinking twice.",
            Style: new PersonaStyle { AvgLength = 70, EmojiRate = 0.1, HashtagRate = 0.1, CapsConvention = "lower" },
            AudienceBand: 80),
        new PersonaSeedSpec(
            Handle: "kwardFH",
            DisplayName: "Keisha Ward",
            Kind: HumanKind,
            Verified: false,
            Type: PersonaType.Resident,
            VoiceNotes: "Level-headed, community-minded. Steers neighbors to the verified utility and county "
                + "accounts; keeps a calm, organizing tone.",
            Style: new PersonaStyle { AvgLength = 110, EmojiRate = 0.2, HashtagRate = 0.3, CapsConvention = "normal" },
            AudienceBand: 350),
    ];

    private readonly PulseDbContext _dbContext;

    /// <summary>Creates the seeder over the persistence context it writes the cast through.</summary>
    /// <param name="dbContext">The persistence context (shared with the composing caller for one unit of work).</param>
    public PersonaCastSeeder(PulseDbContext dbContext)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        _dbContext = dbContext;
    }

    /// <summary>
    /// Ensures the fixed six-persona starter cast exists for <paramref name="exerciseId"/>, reusing any row
    /// that already matches by <c>(ExerciseId, Handle)</c> and adding the rest to the tracked context (the
    /// caller commits). Idempotent and non-clobbering — a re-run reuses existing rows and never duplicates or
    /// overwrites them (the same contract <c>BootstrapService</c> uses for its own rows).
    /// </summary>
    /// <param name="exerciseId">The caller-resolved exercise the cast is scoped to (COR-001); must not be empty.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The six seeded personas — each pairing the persisted <see cref="Persona.Id"/> with its real dossier.</returns>
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

            var dossier = new PersonaDossier
            {
                Handle = handle,
                DisplayName = displayName,
                Type = spec.Type,
                VoiceNotes = voiceNotes,
                Style = spec.Style,
                AudienceBand = spec.AudienceBand,
            };

            if (existingByHandle.TryGetValue(spec.Handle, out var row))
            {
                // Idempotent re-run: reuse the existing row's id, never overwrite it.
                seeded.Add(new SeededPersona(row.Id, dossier, Created: false));
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
            };
            _dbContext.Personas.Add(persona);
            seeded.Add(new SeededPersona(persona.Id, dossier, Created: true));
        }

        return seeded;
    }

    /// <summary>The developer-authored spec for one starter-cast persona (handle → kind/verified → dossier material).</summary>
    private sealed record PersonaSeedSpec(
        string Handle,
        string DisplayName,
        string Kind,
        bool Verified,
        PersonaType Type,
        string VoiceNotes,
        PersonaStyle Style,
        int AudienceBand);
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
public sealed record SeededPersona(Guid InstanceId, PersonaDossier Dossier, bool Created);
