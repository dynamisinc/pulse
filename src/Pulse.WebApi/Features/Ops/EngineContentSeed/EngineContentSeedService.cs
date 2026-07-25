namespace Pulse.WebApi.Features.Ops.EngineContentSeed;

using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Pulse.Core.Features.Storylines.Models;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Features.Ops.Bootstrap;

/// <summary>
/// The guarded ops service behind <c>POST /api/ops/seed-engine-content</c> (feature engine-content-seed, story
/// 03) — the previously-missing production call to <see cref="IReactionLoopRegistry.Register"/> that issue
/// #324 traced. For an already-bootstrapped exercise it composes story 01's persona cast and story 02's canned
/// storyline, builds one <see cref="ReactionLoopRegistration"/>, and registers it — after which the unmodified
/// <see cref="ReactionLoopHost"/> begins ticking that exercise on its next heartbeat, driving the offline
/// <c>Fake</c> provider's canned bursts into the review queue. Scoped lifetime, matching the
/// <see cref="PulseDbContext"/> unit of work it writes through.
/// </summary>
/// <remarks>
/// <para>
/// <b>Secret-gated + fail closed (NFR-009).</b> Gated by <see cref="BootstrapSecretGate"/> on the REUSED
/// <c>Authentication:Bootstrap:Secret</c> (<see cref="BootstrapOptions"/>, presented via the same
/// <c>X-Bootstrap-Secret</c> header — user decision 2026-07-24, no new secret/infra). An unconfigured (empty)
/// secret disables the endpoint entirely and a mismatch is rejected — both surface as a 404 (the endpoint does
/// not confirm its own existence to an unauthorized caller). The comparison is constant-time and the secret is
/// never logged. No session / exercise-scope middleware fronts this endpoint — the header secret is the only
/// gate by design (mirroring <c>BootstrapService</c>).
/// </para>
/// <para>
/// <b>The shared-instance correctness point (load-bearing, AC3).</b> The registration's
/// <see cref="ReactionLoopRegistration.Autonomy"/> is resolved from
/// <see cref="EngineAutonomyRegistry.GetOrCreate"/> — the SAME per-exercise singleton instance
/// <c>EngineReviewService</c> / <c>EngineReviewTickHost</c> read and mutate for auto-HOLD, kill-switch, and
/// swamped mode — NEVER a fresh, detached <c>EngineAutonomyState.Create(...)</c>. A detached instance would
/// silently desynchronize the loop's routing from the cockpit's safety controls (a kill switch flipped in the
/// console would never actually stop the loop, because the loop would read a different object).
/// </para>
/// <para>
/// <b>Isolation (always-Critical, COR-001).</b> This endpoint has no resolved request scope, so the injected
/// <see cref="PulseDbContext"/> is bound to the fail-closed <see cref="System.Guid.Empty"/> filter. The
/// persona seed (story 01) reads with <c>IgnoreQueryFilters()</c> + an explicit predicate and every row it
/// writes is stamped with the RESOLVED exercise's own id; the single XC-004 event is likewise stamped with
/// that id, so the write-guard is satisfied. The registration and every write are confined to the ops-resolved
/// exercise only.
/// </para>
/// </remarks>
public sealed partial class EngineContentSeedService
{
    /// <summary>The XC-004 audit event type emitted on a successful seed (additive open vocab, mirroring <c>exercise.bootstrapped</c>).</summary>
    private const string ContentSeededEventType = "engine.content_seeded";

    private const string SchemaVersion = "v0";
    private const string SystemActorKind = "system";
    private const string SystemChannel = "system";
    private const string SeedActorId = "engine-content-seed";
    private const string ExerciseEntityType = "exercise";

    /// <summary>
    /// The canned Fairhaven scenario brief this story owns (paired with story 02's storyline at registration
    /// time): trusted engine context for the generation prompt's system-prompt strata (§3.3/§3.4). Never
    /// participant-visible, never mixed with untrusted content.
    /// </summary>
    private const string ExerciseBrief =
        "Fairhaven is a mid-size municipality responding to a suspected water-main contamination event near "
        + "its treatment plant; the exercise plays out on the Pulse social channel.";

    private static readonly JsonSerializerOptions PayloadSerializerOptions =
        new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private readonly PulseDbContext _dbContext;
    private readonly BootstrapOptions _options;
    private readonly PersonaCastSeeder _personaSeeder;
    private readonly IReactionLoopRegistry _registry;
    private readonly EngineAutonomyRegistry _autonomyRegistry;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<EngineContentSeedService> _logger;

    /// <summary>Creates the seed service over its collaborators.</summary>
    /// <param name="dbContext">The persistence context the persona rows + the single audit event commit through (one unit of work).</param>
    /// <param name="options">The bound options carrying the REUSED bootstrap secret (the fail-closed gate).</param>
    /// <param name="personaSeeder">Story 01's idempotent persona-cast seeder (shares <paramref name="dbContext"/>).</param>
    /// <param name="registry">The in-memory reaction-loop registry this service populates (the #324 gap).</param>
    /// <param name="autonomyRegistry">The per-exercise autonomy-state registry the cockpit reads/writes — the SHARED instance the registration must use (AC3).</param>
    /// <param name="timeProvider">The server wall-clock source (never client input) for <c>ScenarioStart</c> + the telemetry envelope.</param>
    /// <param name="logger">Diagnostics logger — records the seeder's mutations to EXISTING rows (Gate-1 S-B); never logs a secret.</param>
    public EngineContentSeedService(
        PulseDbContext dbContext,
        IOptions<BootstrapOptions> options,
        PersonaCastSeeder personaSeeder,
        IReactionLoopRegistry registry,
        EngineAutonomyRegistry autonomyRegistry,
        TimeProvider timeProvider,
        ILogger<EngineContentSeedService> logger)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(personaSeeder);
        ArgumentNullException.ThrowIfNull(registry);
        ArgumentNullException.ThrowIfNull(autonomyRegistry);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(logger);

        _dbContext = dbContext;
        _options = options.Value ?? new BootstrapOptions();
        _personaSeeder = personaSeeder;
        _registry = registry;
        _autonomyRegistry = autonomyRegistry;
        _timeProvider = timeProvider;
        _logger = logger;
    }

    /// <summary>
    /// Seeds engine content for the exercise resolved by <paramref name="request"/>'s hostname and registers
    /// its reaction loop. Fails closed: an unauthorized secret → <see cref="EngineContentSeedOutcome.Rejected"/>
    /// (404); an invalid body → <see cref="EngineContentSeedOutcome.Invalid"/> (400); an unknown hostname →
    /// <see cref="EngineContentSeedOutcome.HostNotFound"/> (404, without creating an exercise). On success,
    /// emits exactly one XC-004 <c>engine.content_seeded</c> event in the same unit of work as the persona
    /// writes, then registers (or replaces) the loop.
    /// </summary>
    /// <param name="request">The seed request (may be <c>null</c> — a missing body is a 400).</param>
    /// <param name="presentedSecret">The secret from the <c>X-Bootstrap-Secret</c> header (never logged).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A result the endpoint maps to a status.</returns>
    public async Task<EngineContentSeedResult> SeedAsync(
        EngineContentSeedRequest? request,
        string? presentedSecret,
        CancellationToken cancellationToken = default)
    {
        // 1. The gate runs FIRST, before any body inspection: an unauthorized caller learns nothing (404).
        if (!BootstrapSecretGate.IsAuthorized(_options.Secret, presentedSecret))
        {
            return EngineContentSeedResult.Rejected();
        }

        if (request is null)
        {
            return EngineContentSeedResult.Invalid("A JSON seed body is required.");
        }

        // 2. Validate the host via the SAME normalizer the resolution path uses (COR-008 / NFR-004).
        if (!ExerciseHostName.TryNormalize(request.Hostname, out var host))
        {
            return EngineContentSeedResult.Invalid("hostname is required and must be a valid DNS hostname.");
        }

        // 3. RESOLVE (never create) the exercise for this host. Exercise is unscoped → this by-host read is
        //    unfiltered; it is never written. A host that resolves to nothing is a 404, not a create.
        var exercise = await _dbContext.Exercises
            .AsNoTracking()
            .FirstOrDefaultAsync(e => e.Hostname == host, cancellationToken);
        if (exercise is null)
        {
            return EngineContentSeedResult.HostNotFound();
        }

        var exerciseId = exercise.Id;

        // One wall-clock read stamps ScenarioStart + the telemetry envelope (server-authoritative, COR-053).
        var now = _timeProvider.GetUtcNow();

        // 4a. Seed the persona cast (story 01) — ADDED to the tracked context, committed below with the event.
        var seeded = await _personaSeeder.SeedAsync(exerciseId, cancellationToken);
        var personasCreated = seeded.Count(persona => persona.Created);
        var personasReused = seeded.Count - personasCreated;

        // The two mutations the seeder is allowed to make to an EXISTING row are reported separately from the
        // reuse count (Gate-1 S-B). "6 reused" hid the fact that six rows had five columns rewritten; a
        // re-seed now says "6 reused, 6 backfilled", and a gate closed on an existing row — which changes what
        // the ENGINE may do — is never silent.
        var personasBackfilled = seeded.Count(persona => persona.PresentationBackfilled);
        var personasCastableClosed = seeded.Count(persona => persona.CastableClosed);
        if (personasBackfilled > 0 || personasCastableClosed > 0)
        {
            LogExistingRowsMutated(personasBackfilled, personasCastableClosed, exerciseId);
        }

        // 4b. Build the canned starter storyline (story 02) from the seeded handles — CASTABLE ones only.
        // profiles-social-graph/06: the SOC-052 lookalike and the low-credibility outlet are seeded as ROWS
        // (so participants can browse the impersonator's profile and learn to spot it) but ship
        // Castable = false, so the engine can never voice them until a scenario opts in by flipping the
        // column. This is the real gate behind engine-content-seed's "no way to turn a troll voice off"
        // concern — the eligible cast is filtered here, not merely ordered.
        var castable = seeded.Where(persona => persona.Castable).ToList();
        var handles = castable.Select(persona => persona.Dossier.Handle).ToList();
        var storyline = StarterStorylineFactory.Build(
            exerciseId,
            handles,
            new StarterStorylineOptions { ResponseWindowMinutes = request.ResponseWindowMinutes });

        // 4c. Resolve Autonomy from the SHARED per-exercise singleton (AC3, the load-bearing correctness point)
        //     — the exact instance the cockpit's kill-switch/swamped-mode/auto-HOLD read and mutate. Never a
        //     fresh, detached EngineAutonomyState.Create(...).
        var autonomy = _autonomyRegistry.GetOrCreate(exerciseId);

        // 4d. Build the eligible cast keyed by handle (handle → dossier + persona instance id).
        // OrdinalIgnoreCase to match the storyline factory's ordering comparer and the DB's
        // case-insensitive handle collation — so a future variable-casing cast input (decision (b))
        // can never silently drop a persona from the eligible set on a case mismatch.
        var personasByHandle = castable.ToDictionary(
            persona => persona.Dossier.Handle,
            persona => new EnginePersona(persona.InstanceId, persona.Dossier),
            StringComparer.OrdinalIgnoreCase);

        var registration = new ReactionLoopRegistration
        {
            ExerciseId = exerciseId,
            ExerciseBrief = ExerciseBrief,
            TimeZone = exercise.TimeZone,
            ScenarioStart = now,
            TimeZoneInfo = ResolveTimeZone(exercise.TimeZone),
            Storylines = [storyline],
            PersonasByHandle = personasByHandle,
            RateConfig = RateGovernanceConfig.Default,
            Autonomy = autonomy,
            ControllerDeskId = Guid.NewGuid(),
        };

        // 5. Exactly one XC-004 audit event (COR-001-stamped with the exercise's own id) in the SAME unit of
        //    work as story 01's persona writes (AC7).
        _dbContext.TelemetryEvents.Add(BuildSeededTelemetry(
            exercise, now, new PersonaSeedCounts(
                personasCreated, personasReused, personasBackfilled, personasCastableClosed), storyline));

        // One SaveChanges — the write-guard runs here; every scoped row carries the non-empty exercise id.
        await _dbContext.SaveChangesAsync(cancellationToken);

        // 6. Register (or REPLACE) the loop AFTER a successful commit, so a persist failure never leaves a loop
        //    registered against un-persisted personas. Register overwrites by exerciseId — never duplicated.
        _registry.Register(registration);

        return EngineContentSeedResult.Provisioned(
            exerciseId,
            host,
            new PersonaSeedCounts(personasCreated, personasReused, personasBackfilled, personasCastableClosed),
            storyline.Id,
            storyline.Title,
            storyline.ResponseWindowMin);
    }

    /// <summary>
    /// Records the seeder's mutations to EXISTING rows (Gate-1 S-B). Emitted only when at least one occurred,
    /// so an ordinary idempotent re-seed stays quiet, and a re-seed that rewrote presentation columns or
    /// closed an engine-casting gate always says so. No secret material is ever logged.
    /// </summary>
    /// <param name="personasBackfilled">How many existing rows had their presentation columns backfilled.</param>
    /// <param name="personasCastableClosed">How many existing rows had their engine-casting gate closed.</param>
    /// <param name="exerciseId">The exercise whose rows were mutated.</param>
    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Information,
        Message = "Engine content seed mutated EXISTING persona rows for exercise {ExerciseId}: {PersonasBackfilled} presentation-backfilled (rows carrying only the migration defaults), {PersonasCastableClosed} engine-casting gate(s) closed to match the catalog.")]
    private partial void LogExistingRowsMutated(int personasBackfilled, int personasCastableClosed, Guid exerciseId);

    /// <summary>
    /// Turns the exercise's IANA time-zone string into a <see cref="TimeZoneInfo"/> for the scenario clock,
    /// falling back to <see cref="TimeZoneInfo.Utc"/> on an unrecognized/invalid id. The first place in the
    /// codebase that needs this conversion — a small, local helper, not worth a shared utility for one caller.
    /// </summary>
    private static TimeZoneInfo ResolveTimeZone(string timeZone)
    {
        if (string.IsNullOrWhiteSpace(timeZone))
        {
            return TimeZoneInfo.Utc;
        }

        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(timeZone);
        }
        catch (TimeZoneNotFoundException)
        {
            return TimeZoneInfo.Utc;
        }
        catch (InvalidTimeZoneException)
        {
            return TimeZoneInfo.Utc;
        }
    }

    /// <summary>
    /// Builds the single XC-004 <c>engine.content_seeded</c> event: <c>actor.kind: 'system'</c> with the fixed
    /// <c>engine-content-seed</c> acting-human id, <c>channel: 'system'</c>, target = the exercise. The opaque
    /// payload records the persona created/reused counts + the storyline id/title (audit trail, never parsed
    /// server-side).
    /// </summary>
    private static TelemetryEvent BuildSeededTelemetry(
        Exercise exercise,
        DateTimeOffset now,
        PersonaSeedCounts counts,
        Storyline storyline)
    {
        var payload = JsonSerializer.Serialize(
            new
            {
                personasCreated = counts.Created,
                personasReused = counts.Reused,

                // Gate-1 S-B: the mutations to EXISTING rows are part of the durable audit trail, not just
                // the response an operator happens to be looking at when they run the seed.
                personasBackfilled = counts.PresentationBackfilled,
                personasCastableClosed = counts.CastableClosed,
                storylineId = storyline.Id.ToString(),
                storylineTitle = storyline.Title,
                responseWindowMinutes = storyline.ResponseWindowMin,
            },
            PayloadSerializerOptions);

        return new TelemetryEvent
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = SchemaVersion,
            ExerciseId = exercise.Id,
            EventType = ContentSeededEventType,
            Channel = SystemChannel,
            Actor = new TelemetryActor
            {
                Kind = SystemActorKind,
                ActingHumanId = SeedActorId,
            },
            WallClockTime = now,
            ScenarioTime = exercise.CurrentScenarioTime ?? now,
            TimeZone = string.IsNullOrWhiteSpace(exercise.TimeZone) ? "UTC" : exercise.TimeZone,
            Target = new TelemetryTarget { EntityType = ExerciseEntityType, EntityId = exercise.Id.ToString() },
            Payload = payload,
            EmittedAt = now,
        };
    }
}

/// <summary>The outcome kind of an <see cref="EngineContentSeedService.SeedAsync"/> call.</summary>
public enum EngineContentSeedOutcome
{
    /// <summary>The content was seeded and the loop registered — the endpoint returns 200 with the result.</summary>
    Provisioned,

    /// <summary>The request failed validation — the endpoint returns 400.</summary>
    Invalid,

    /// <summary>The secret was unconfigured or wrong — the endpoint returns 404 (fail closed, no existence hint).</summary>
    Rejected,

    /// <summary>No exercise resolves to the requested hostname — the endpoint returns 404 (never creating one).</summary>
    HostNotFound,
}

/// <summary>
/// The result of a seed attempt. <see cref="EngineContentSeedOutcome.Provisioned"/> carries the resolved
/// exercise id/host + the persona counts + the storyline id/title; <see cref="EngineContentSeedOutcome.Invalid"/>
/// carries a reason; <see cref="EngineContentSeedOutcome.Rejected"/> / <see cref="EngineContentSeedOutcome.HostNotFound"/>
/// carry neither (an unauthorized caller, or an unknown host, learns nothing beyond the 404).
/// </summary>
public sealed class EngineContentSeedResult
{
    private EngineContentSeedResult(
        EngineContentSeedOutcome outcome,
        string? error,
        Guid? exerciseId,
        string? hostname,
        PersonaSeedCounts personas,
        Guid? storylineId,
        string? storylineTitle,
        int responseWindowMinutes)
    {
        Outcome = outcome;
        Error = error;
        ExerciseId = exerciseId;
        Hostname = hostname;
        Personas = personas;
        StorylineId = storylineId;
        StorylineTitle = storylineTitle;
        ResponseWindowMinutes = responseWindowMinutes;
    }

    /// <summary>Which outcome occurred.</summary>
    public EngineContentSeedOutcome Outcome { get; }

    /// <summary>The validation message — non-null only when <see cref="Outcome"/> is <see cref="EngineContentSeedOutcome.Invalid"/>.</summary>
    public string? Error { get; }

    /// <summary>The resolved exercise id — non-null only on <see cref="EngineContentSeedOutcome.Provisioned"/>.</summary>
    public Guid? ExerciseId { get; }

    /// <summary>The host the exercise is bound to — non-null only on <see cref="EngineContentSeedOutcome.Provisioned"/>.</summary>
    public string? Hostname { get; }

    /// <summary>What the persona seed did — created/reused, plus the mutations it made to EXISTING rows.</summary>
    public PersonaSeedCounts Personas { get; }

    /// <summary>How many persona rows this call created.</summary>
    public int PersonasCreated => Personas.Created;

    /// <summary>How many persona rows this call reused.</summary>
    public int PersonasReused => Personas.Reused;

    /// <summary>
    /// How many REUSED rows had their presentation columns backfilled because they carried only the
    /// migration's defaults (the CR-001 sentinel backfill). Reported separately from
    /// <see cref="PersonasReused"/> so the one mutation the seeder may make to an existing row is never
    /// invisible in the seed's own output (Gate-1 S-B).
    /// </summary>
    public int PersonasBackfilled => Personas.PresentationBackfilled;

    /// <summary>
    /// How many REUSED rows had their engine-casting gate CLOSED to match the catalog. This one changes what
    /// the engine may do with an existing persona, so it is always reported.
    /// </summary>
    public int PersonasCastableClosed => Personas.CastableClosed;

    /// <summary>The freshly-built storyline's id — non-null only on <see cref="EngineContentSeedOutcome.Provisioned"/>.</summary>
    public Guid? StorylineId { get; }

    /// <summary>The starter storyline's title — non-null only on <see cref="EngineContentSeedOutcome.Provisioned"/>.</summary>
    public string? StorylineTitle { get; }

    /// <summary>The clamped silence window (scenario minutes) the storyline was armed with.</summary>
    public int ResponseWindowMinutes { get; }

    /// <summary>A successful seed.</summary>
    /// <param name="exerciseId">The resolved exercise id.</param>
    /// <param name="hostname">The bound host.</param>
    /// <param name="personas">What the persona seed did (created/reused/backfilled/gates closed).</param>
    /// <param name="storylineId">The built storyline id.</param>
    /// <param name="storylineTitle">The built storyline title.</param>
    /// <param name="responseWindowMinutes">The clamped silence window.</param>
    /// <returns>A provisioned result.</returns>
    public static EngineContentSeedResult Provisioned(
        Guid exerciseId,
        string hostname,
        PersonaSeedCounts personas,
        Guid storylineId,
        string storylineTitle,
        int responseWindowMinutes)
    {
        ArgumentException.ThrowIfNullOrEmpty(hostname);
        ArgumentNullException.ThrowIfNull(personas);
        return new EngineContentSeedResult(
            EngineContentSeedOutcome.Provisioned, null, exerciseId, hostname,
            personas, storylineId, storylineTitle, responseWindowMinutes);
    }

    /// <summary>A validation failure.</summary>
    /// <param name="error">The human-readable reason.</param>
    /// <returns>An invalid result.</returns>
    public static EngineContentSeedResult Invalid(string error) =>
        new(EngineContentSeedOutcome.Invalid, error, null, null, PersonaSeedCounts.None, null, null, 0);

    /// <summary>The fail-closed result for an unconfigured/wrong secret.</summary>
    /// <returns>A rejected result.</returns>
    public static EngineContentSeedResult Rejected() =>
        new(EngineContentSeedOutcome.Rejected, null, null, null, PersonaSeedCounts.None, null, null, 0);

    /// <summary>The result for a hostname that resolves to no exercise (never creating one).</summary>
    /// <returns>A host-not-found result.</returns>
    public static EngineContentSeedResult HostNotFound() =>
        new(EngineContentSeedOutcome.HostNotFound, null, null, null, PersonaSeedCounts.None, null, null, 0);
}

/// <summary>
/// What one persona-seed pass did: rows created, rows reused, and — reported separately so they are never
/// silent (Gate-1 S-B) — the two mutations the seeder is allowed to make to an EXISTING row.
/// </summary>
/// <param name="Created">Rows this pass created.</param>
/// <param name="Reused">Rows this pass reused (already present from a prior seed).</param>
/// <param name="PresentationBackfilled">
/// Reused rows whose presentation columns were rewritten because the row carried only the migration's
/// defaults (the CR-001 sentinel backfill). A subset of <paramref name="Reused"/>, not an addition to it.
/// </param>
/// <param name="CastableClosed">
/// Reused rows whose engine-casting gate was closed to match the catalog. Also a subset of
/// <paramref name="Reused"/>. This mutation changes what the ENGINE may do with an existing persona, so a
/// non-zero value here is the one an operator should actually read.
/// </param>
public sealed record PersonaSeedCounts(int Created, int Reused, int PresentationBackfilled, int CastableClosed)
{
    /// <summary>The all-zero counts carried by every non-provisioned outcome.</summary>
    public static PersonaSeedCounts None { get; } = new(0, 0, 0, 0);
}
