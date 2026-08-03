namespace Pulse.WebApi.Data;

using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The first durable state in Pulse (COR-001, XC-004) — EF Core on Azure SQL. Beyond the original
/// walking-skeleton entities, the Phase-B2 identity tier now lives here too: <c>Account</c> and
/// <c>SharedCredential</c> (exercise-scoped) alongside the cross-exercise <c>StaffUser</c>,
/// <c>StaffAssignment</c>, and <c>Session</c> records (deliberately NOT <see cref="IExerciseScoped"/> —
/// each carries a plain <c>ExerciseId</c> and documents its exemption in its own remarks).
/// <c>Organization</c> — the CUSTOMER tenant tier above the exercise (exercise-isolation/11, COR-010) — now
/// lives here too, as a SECOND, independent scoping axis over <see cref="IOrganizationScoped"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Create-then-extend seam.</b> This class is CREATED here; <c>exercise-isolation/01</c> (#44) EXTENDS
/// it next by adding the read-side global query filter (<c>HasQueryFilter</c>) in
/// <see cref="OnModelCreating"/>. A future builder must not stand up a second <see cref="DbContext"/>.
/// </para>
/// <para>
/// <b>Isolation is only half-done here.</b> This story delivers the SCHEMA half (non-nullable
/// <c>ExerciseId</c> enforced <c>NOT NULL</c> by the migration) and the WRITE-TIME half (the
/// <see cref="SaveChanges()"/> / <see cref="SaveChangesAsync(CancellationToken)"/> guard below). The
/// READ-side global query filter is <c>exercise-isolation/01</c>'s job — do not describe this as
/// "isolation is done".
/// </para>
/// <para>
/// <b>TWO independent scoping axes (exercise-isolation/11).</b> The always-Critical EXERCISE axis
/// (<see cref="IExerciseScoped"/>) is unchanged and untouched by the tenant work. A second, additive
/// ORGANIZATION axis (<see cref="IOrganizationScoped"/>) covers the org-owned shared-library assets the
/// exercise axis deliberately does not cover. The two are separately-keyed EF global filters that AND
/// together on any entity carrying both markers, and they fail closed independently — an unresolved tenant
/// can never widen an exercise scope, because the axes cover disjoint entity sets. Read
/// <see cref="IOrganizationScoped"/> for the full mechanism decision.
/// </para>
/// </remarks>
public class PulseDbContext : DbContext
{
    /// <summary>
    /// The EF Core filter KEY the organization (customer tenant) global query filter is registered under.
    /// Distinct from the exercise axis's anonymous (null) key so the two axes coexist and AND together
    /// instead of one silently replacing the other — see <see cref="ApplyOrganizationScopeFilter{TEntity}"/>.
    /// Public so the isolation tests can assert each axis by name.
    /// </summary>
    public const string OrganizationScopeFilterKey = "OrganizationScope";

    /// <summary>
    /// Open generic handle to <see cref="ApplyExerciseScopeFilter{TEntity}"/>, resolved once and closed
    /// per <see cref="IExerciseScoped"/> CLR type in <see cref="OnModelCreating"/>.
    /// </summary>
    private static readonly MethodInfo ApplyExerciseScopeFilterMethod =
        typeof(PulseDbContext).GetMethod(
            nameof(ApplyExerciseScopeFilter),
            BindingFlags.Instance | BindingFlags.NonPublic)
        ?? throw new InvalidOperationException(
            $"Could not reflect {nameof(ApplyExerciseScopeFilter)} — the read-side exercise scope filter is unwired.");

    /// <summary>
    /// Open generic handle to <see cref="ApplyOrganizationScopeFilter{TEntity}"/>, resolved once and closed
    /// per <see cref="IOrganizationScoped"/> CLR type in <see cref="OnModelCreating"/>.
    /// </summary>
    private static readonly MethodInfo ApplyOrganizationScopeFilterMethod =
        typeof(PulseDbContext).GetMethod(
            nameof(ApplyOrganizationScopeFilter),
            BindingFlags.Instance | BindingFlags.NonPublic)
        ?? throw new InvalidOperationException(
            $"Could not reflect {nameof(ApplyOrganizationScopeFilter)} — the read-side organization scope filter is unwired.");

    /// <summary>
    /// The exercise scope for the read-side global query filter, captured ONCE at construction. Fails
    /// closed to <see cref="Guid.Empty"/> when no scope is resolved (see the constructor).
    /// </summary>
    private readonly Guid _currentExerciseId;

    /// <summary>
    /// The CUSTOMER tenant scope for the second read-side global query filter, captured ONCE at
    /// construction. Fails closed to <see cref="Guid.Empty"/> when no organization is resolved.
    /// </summary>
    private readonly Guid _currentOrganizationId;

    /// <summary>Creates the context with externally-supplied options (DI / design-time / tests).</summary>
    /// <param name="options">The EF Core options (provider, connection string).</param>
    /// <param name="exerciseContext">
    /// The current exercise scope for the read-side global query filter. OPTIONAL/nullable so the
    /// design-time <see cref="PulseDbContextFactory"/> (which calls <c>new PulseDbContext(options)</c>) and
    /// tests that don't care about scoping still compile and work; at runtime <c>AddDbContext</c> injects
    /// the registered <see cref="IExerciseContext"/>. A <c>null</c> accessor — or a null
    /// <see cref="IExerciseContext.CurrentExerciseId"/> — means "no scope resolved" and fails closed.
    /// </param>
    /// <param name="organizationContext">
    /// The current CUSTOMER tenant for the second read-side global query filter (exercise-isolation/11).
    /// OPTIONAL/nullable for the same reasons, and with the same fail-closed collapse: a null accessor — or
    /// a null <see cref="IOrganizationContext.CurrentOrganizationId"/> — matches ZERO
    /// <see cref="IOrganizationScoped"/> rows, never all tenants. It CANNOT affect the exercise axis: the
    /// two axes cover disjoint entity sets.
    /// </param>
    public PulseDbContext(
        DbContextOptions<PulseDbContext> options,
        IExerciseContext? exerciseContext = null,
        IOrganizationContext? organizationContext = null)
        : base(options)
    {
        // Fail-closed capture (the always-Critical property): an unset scope collapses to Guid.Empty,
        // which the write-guard guarantees no scoped row ever carries — so the query filter matches zero
        // rows, never all exercises. Read the reasoning in full in OnModelCreating.
        _currentExerciseId = exerciseContext?.CurrentExerciseId ?? Guid.Empty;

        // The same fail-closed capture, one tier out (COR-010). Independent of the line above by design.
        _currentOrganizationId = organizationContext?.CurrentOrganizationId ?? Guid.Empty;
    }

    /// <summary>The customer tenants (COR-010) — the aggregate root of the OUTER isolation tier.</summary>
    public DbSet<Organization> Organizations => Set<Organization>();

    /// <summary>The exercise runs — the aggregate root / isolation scope.</summary>
    public DbSet<Exercise> Exercises => Set<Exercise>();

    /// <summary>The persona authoring library, shared across an ORGANIZATION's runs (XC-005 within the tenant).</summary>
    public DbSet<PersonaTemplate> PersonaTemplates => Set<PersonaTemplate>();

    /// <summary>Personas instantiated within a single exercise run.</summary>
    public DbSet<Persona> Personas => Set<Persona>();

    /// <summary>Posts authored within a single exercise run.</summary>
    public DbSet<Post> Posts => Set<Post>();

    /// <summary>The REAL follow graph — directed persona→persona edges within a single exercise run (SOC-051).</summary>
    public DbSet<Follow> Follows => Set<Follow>();

    /// <summary>The durable telemetry event store (XC-004).</summary>
    public DbSet<TelemetryEvent> TelemetryEvents => Set<TelemetryEvent>();

    /// <summary>The engine review-queue store — one row per generated burst awaiting/resolved review (E8 §8).</summary>
    public DbSet<EngineReviewItemEntity> EngineReviewItems => Set<EngineReviewItemEntity>();

    /// <summary>Provisioned, named participant accounts (COR-011). Exercise-scoped (<see cref="IExerciseScoped"/>).</summary>
    public DbSet<Account> Accounts => Set<Account>();

    /// <summary>Per-exercise shared view-only credentials (COR-015/COR-016). Exercise-scoped (<see cref="IExerciseScoped"/>).</summary>
    public DbSet<SharedCredential> SharedCredentials => Set<SharedCredential>();

    /// <summary>Staff human identities (COR-005/COR-014). NOT exercise-scoped — a staff human spans exercises.</summary>
    public DbSet<StaffUser> StaffUsers => Set<StaffUser>();

    /// <summary>Staff role-on-one-exercise assignments (COR-005). NOT exercise-scoped — cross-exercise by design.</summary>
    public DbSet<StaffAssignment> StaffAssignments => Set<StaffAssignment>();

    /// <summary>Persisted server-side sessions (COR-012). NOT exercise-scoped — looked up by opaque token pre-scope-resolution.</summary>
    public DbSet<Session> Sessions => Set<Session>();

    /// <inheritdoc />
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ArgumentNullException.ThrowIfNull(modelBuilder);
        base.OnModelCreating(modelBuilder);

        // Azure SQL fidelity — match infrastructure/modules/database.bicep's collation so the migration
        // target and the provisioned database sort/compare identically (the MSSQL container default already matches).
        modelBuilder.UseCollation("SQL_Latin1_General_CP1_CI_AS");

        // ==========================================================================================
        // ORGANIZATION TENANT TIER (exercise-isolation/11, COR-010) — the customer boundary ABOVE the
        // exercise. Create-then-extend: a new DbSet + config + one migration, never a second DbContext.
        // ==========================================================================================
        modelBuilder.Entity<Organization>(entity =>
        {
            entity.HasKey(e => e.Id);

            // Bounded (index-key eligible) display name; unique so two tenants cannot share a name and be
            // confused for one another on a staff/platform surface.
            entity.Property(e => e.Name).IsRequired().HasMaxLength(200);
            entity.HasIndex(e => e.Name).IsUnique();

            // NOT IOrganizationOwned / IOrganizationScoped: Organization IS the tenant scope, exactly as
            // Exercise is the exercise scope. It carries no filter of its own.
        });

        modelBuilder.Entity<Exercise>(entity =>
        {
            entity.HasKey(e => e.Id);

            // IOrganizationOwned (exercise-isolation/11): an exercise belongs to exactly one customer.
            // Required + indexed — the index serves the "list this organization's exercises" read that a
            // future POST/GET /api/staff/exercises performs through OrganizationScope.InOrganization(...).
            // NO global query filter here, deliberately: Exercise is the resolution root (see the property's
            // XML doc and IOrganizationScoped's remarks).
            entity.Property(e => e.OrganizationId).IsRequired();
            entity.HasIndex(e => e.OrganizationId);

            // B2 story 08: host → exercise map. Bounded lengths (index-key eligible) + FILTERED unique
            // indexes so many exercises may share a NULL host without colliding, yet a provisioned host is
            // unique. 253 = max DNS name length.
            entity.Property(e => e.Hostname).HasMaxLength(253);
            entity.HasIndex(e => e.Hostname).IsUnique().HasFilter("[Hostname] IS NOT NULL");
            entity.Property(e => e.BrandedDomain).HasMaxLength(253);
            entity.HasIndex(e => e.BrandedDomain).IsUnique().HasFilter("[BrandedDomain] IS NOT NULL");

            // Required-with-default so the migration adds them NOT NULL to the existing table and the frozen
            // ExerciseScope wire fields are never null.
            entity.Property(e => e.TimeZone).IsRequired().HasDefaultValue("UTC");

            // COR-032 vocabulary (Option B, Tier-2 signed off — exercise-configuration story 01a): the
            // authoritative literals are build | staged | live | paused | completed | archived. The default
            // moves scheduled → build ("created and never configured" is staff-only content development).
            // NO CHECK constraint: the legacy four (scheduled | active | complete | archived) stay VALID
            // through the transition on purpose — the frontend guard accepts the transitional superset, which
            // is what makes UAT's independent frontend/backend deploys safe (isExerciseStatus fails closed).
            entity.Property(e => e.Status).IsRequired().HasDefaultValue("build");
            // CurrentScenarioTime is nullable by its C# type (B2 placeholder) — no extra config.

            // ---------------------------------------------------------------------------------------
            // Exercise-configuration story 01a — the feature's ONE migration. COR-030 settings, the COR-031
            // chrome config, the NFR-008 watermark switch and the COR-033 practice flag are all authored
            // here so stories 01b/02/03/04 add behaviour only. Every free-text/color column is bounded
            // (nvarchar(n), not nvarchar(max)) — the schema half of the NFR-004 length bound story 01b
            // enforces on write; the opaque OutletNamesJson blob is the one deliberate exception.
            // NULLABLE by design: null = "not configured", so the projection keeps serving the shipped
            // Phase-1 constant and no existing row changes behaviour when the migration lands.
            //
            // ISOLATION WARNING (always-Critical, COR-001/XC-002). Exercise is the SCOPE, not an
            // IExerciseScoped entity, so the central read-side query filter applied at the bottom of this
            // method DOES NOT COVER THIS TABLE — a settings query here is unfiltered and can return another
            // exercise's row. Take the exercise from IExerciseContext (or the server-held staff
            // active-exercise selection), NEVER from a client-supplied id/body/route/query value.
            // ---------------------------------------------------------------------------------------
            entity.Property(e => e.WorldName).HasMaxLength(200);
            entity.Property(e => e.Locale).HasMaxLength(35);           // BCP-47 tags are far shorter in practice.
            entity.Property(e => e.EnabledChannels).HasMaxLength(256); // comma-separated channel-catalog ids.
            entity.Property(e => e.BrandName).HasMaxLength(200);
            entity.Property(e => e.BrandPrimary).HasMaxLength(32);
            entity.Property(e => e.BrandAccent).HasMaxLength(32);
            entity.Property(e => e.BrandSurface).HasMaxLength(32);
            entity.Property(e => e.BrandOnSurface).HasMaxLength(32);
            entity.Property(e => e.OutletNamesJson).HasColumnType("nvarchar(max)");

            entity.Property(e => e.ChromeTopText).HasMaxLength(512);
            entity.Property(e => e.ChromeTopFg).HasMaxLength(32);
            entity.Property(e => e.ChromeTopBg).HasMaxLength(32);
            entity.Property(e => e.ChromeBottomText).HasMaxLength(512);
            entity.Property(e => e.ChromeBottomFg).HasMaxLength(32);
            entity.Property(e => e.ChromeBottomBg).HasMaxLength(32);

            // Non-nullable switches with SAFE defaults: chrome + watermark ON (NFR-008 is never both-off,
            // and this matches the shipped chrome constant), practice OFF (never-flagged = real conduct).
            entity.Property(e => e.ComplianceChromeEnabled).IsRequired().HasDefaultValue(true);
            entity.Property(e => e.WatermarkEnabled).IsRequired().HasDefaultValue(true);
            entity.Property(e => e.IsPracticeMode).IsRequired().HasDefaultValue(false);
        });

        modelBuilder.Entity<PersonaTemplate>(entity =>
        {
            entity.HasKey(e => e.Id);
            // NOT IExerciseScoped: a shared library asset, no ExerciseId (XC-005) — a template is reusable
            // across an organization's runs, and binding it to one run would break the reuse it exists for.
            //
            // IS IOrganizationScoped (exercise-isolation/11): "shared across runs" means shared across ONE
            // CUSTOMER's runs. The central org filter applied at the bottom of this method covers it
            // automatically; this is story 11's "gap 2" — the latent cross-customer library leak — closed.
            entity.Property(e => e.OrganizationId).IsRequired();
            entity.HasIndex(e => e.OrganizationId);
        });

        modelBuilder.Entity<Persona>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ExerciseId).IsRequired();
            entity.HasIndex(e => e.ExerciseId);

            // Handle uniqueness PER EXERCISE, never globally (docs/01-platform-core-isolation.md §7 Q3,
            // resolved in favour of the recommended per-exercise scope; see backend-host/03). Two different
            // exercises may each run a "@FulcoEM" — that is the point of an isolated world — but within ONE
            // exercise a handle identifies exactly one persona, which PersonaCastSeeder's idempotency read and
            // every by-handle resolver already assume. Same shape as Account.Username above.
            //
            // Case-insensitivity comes from the model-wide SQL_Latin1_General_CP1_CI_AS collation set above:
            // the index key comparison uses the column's collation, so "mvega_fh" and "MVega_FH" COLLIDE
            // rather than coexisting — consistent with the OrdinalIgnoreCase matching the seeder does in
            // memory and with the CI `==`/`Contains` the resolvers do on the server.
            //
            // The MaxLength is load-bearing, not cosmetic: nvarchar(max) is not index-key eligible in SQL
            // Server, so the migration narrows this column to make the index possible at all.
            entity.Property(e => e.Handle).HasMaxLength(256);
            entity.HasIndex(e => new { e.ExerciseId, e.Handle }).IsUnique();

            // profiles-social-graph/06 presentation fields (COR-020/COR-021/SOC-054). Bounded lengths (the
            // two union-valued columns are short, closed vocabularies); Bio is optional free text.
            entity.Property(e => e.Bio).HasMaxLength(Persona.MaxBioLength);

            // Server-side engine-casting gate (never projected to a participant DTO — see the entity's doc).
            // Required-with-default TRUE so every pre-existing row stays castable exactly as it was.
            //
            // HasSentinel(true) is LOAD-BEARING, not decoration: with a store default configured, EF omits a
            // property from the INSERT when its value equals the sentinel and lets the database default win.
            // The sentinel would otherwise be the CLR default (false) — so seeding a deliberately
            // NON-castable persona (the SOC-052 lookalike) would silently insert Castable = TRUE and hand the
            // engine the very voice this gate exists to withhold. Pinning the sentinel to `true` inverts that:
            // `true` rides the database default, `false` is always written explicitly.
            entity.Property(e => e.Castable).IsRequired().HasDefaultValue(true).HasSentinel(true);

            // Required-WITH-DEFAULT, the same shape Exercise.TimeZone/Status use above: the migration adds
            // these NOT NULL to a table that already holds seeded rows, so the default backfills a
            // contract-VALID value ("citizen"/"nano"/the fixed pre-exercise scenario epoch) instead of an
            // empty string or a 0001-01-01 sentinel that would reach a participant surface.
            entity.Property(e => e.PersonaType).IsRequired().HasMaxLength(32)
                .HasDefaultValue(Persona.DefaultPersonaType);
            entity.Property(e => e.AudienceBand).IsRequired().HasMaxLength(16)
                .HasDefaultValue(Persona.DefaultAudienceBand);
            entity.Property(e => e.AudienceMagnitude).IsRequired().HasDefaultValue(0);
            entity.Property(e => e.JoinedAt).IsRequired().HasDefaultValue(Persona.DefaultJoinedAt);
        });

        modelBuilder.Entity<Post>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ExerciseId).IsRequired();
            entity.HasIndex(e => e.ExerciseId);
            // RumorRef / MutationOf / DeletedAt are reserved nullable columns (E8 rumor model + XC-010
            // soft-delete); left nullable by their C# type — no extra config needed.
            // Provenance columns (Origin / ActingHumanId / CreatedWallClock — NOT NULL; InjectId — NULL)
            // likewise derive their nullability from their C# types (required / value type vs. string?), so
            // they need no explicit config either.
        });

        modelBuilder.Entity<Follow>(entity =>
        {
            entity.HasKey(e => e.Id);

            // IExerciseScoped: required scope + the standard scoped lookup index (house style — Persona/Post).
            entity.Property(e => e.ExerciseId).IsRequired();
            entity.HasIndex(e => e.ExerciseId);

            // ONE edge per (exercise, follower, followee) — the database is the last word on the idempotency
            // POST /api/personas/{id}/follow promises: a duplicate follow can only ever be the same row, even
            // under a concurrent double-submit that beats the service's existence check. Scope leads the key so
            // the same ordered persona pair in two exercises is two distinct, non-colliding edges (COR-001).
            entity.HasIndex(e => new { e.ExerciseId, e.FollowerPersonaId, e.FolloweePersonaId })
                .IsUnique();

            // The inbound direction ("who follows persona X", and the displayed-follower-count aggregate) is
            // the read the profile surface performs per persona; the unique index above only serves the
            // outbound (follower-leading) direction.
            entity.HasIndex(e => new { e.ExerciseId, e.FolloweePersonaId });
        });

        modelBuilder.Entity<TelemetryEvent>(entity =>
        {
            // eventId is the dedup/idempotency key (schema.ts) → primary key, which is a unique index.
            entity.HasKey(e => e.EventId);
            entity.Property(e => e.ExerciseId).IsRequired();
            entity.HasIndex(e => e.ExerciseId);

            // payload is the OPAQUE JSON extension point — stored as nvarchar(max), never parsed here.
            entity.Property(e => e.Payload).HasColumnType("nvarchar(max)");

            // actor is always present; every sub-field becomes a column (table-splitting, not JSON).
            entity.OwnsOne(e => e.Actor, actor =>
            {
                actor.Property(a => a.Kind).IsRequired();
            });
            entity.Navigation(e => e.Actor).IsRequired();

            // target is optional; every sub-field becomes a (nullable) column.
            entity.OwnsOne(e => e.Target);
        });

        modelBuilder.Entity<EngineReviewItemEntity>(entity =>
        {
            // DraftId is the stable burst identity → primary key (one burst = one review item, ADP-040).
            entity.HasKey(e => e.DraftId);
            entity.Property(e => e.ExerciseId).IsRequired();
            entity.HasIndex(e => e.ExerciseId);

            // The draft posts persist as an owned JSON collection — one nvarchar(max) column, no child table.
            entity.OwnsMany(e => e.Posts, posts => posts.ToJson());
        });

        // ==========================================================================================
        // B2 IDENTITY / AUTH SCHEMA (create-then-extend — new DbSets + config only; the central filter
        // loop and GuardExerciseScope below are untouched). Two of these entities are IExerciseScoped
        // (Account, SharedCredential) and inherit the read-filter + write-guard automatically via the loop;
        // three are deliberately UNSCOPED (StaffUser, StaffAssignment, Session — see each entity's XML doc
        // for the always-Critical safety rationale).
        // ==========================================================================================

        modelBuilder.Entity<Account>(entity =>
        {
            entity.HasKey(e => e.Id);

            // IExerciseScoped: required scope + the standard scoped lookup index (house style — Persona/Post).
            entity.Property(e => e.ExerciseId).IsRequired();
            entity.HasIndex(e => e.ExerciseId);

            // Login handle: bounded (index-key eligible) and unique PER EXERCISE, never globally (COR-004).
            entity.Property(e => e.Username).HasMaxLength(256);
            entity.HasIndex(e => new { e.ExerciseId, e.Username }).IsUnique();
        });

        modelBuilder.Entity<SharedCredential>(entity =>
        {
            entity.HasKey(e => e.Id);

            // IExerciseScoped: required scope. Exactly ONE credential per exercise → unique scope index.
            entity.Property(e => e.ExerciseId).IsRequired();
            entity.HasIndex(e => e.ExerciseId).IsUnique();
        });

        modelBuilder.Entity<StaffUser>(entity =>
        {
            entity.HasKey(e => e.Id);

            // Provider-agnostic identity key: bounded (index-key eligible), unique across Pulse.
            entity.Property(e => e.ExternalSubject).HasMaxLength(256);
            entity.HasIndex(e => e.ExternalSubject).IsUnique();
            // NOT IExerciseScoped: staff-world access record, spans exercises (COR-005). No ExerciseId.

            // IOrganizationOwned (exercise-isolation/11): a staff human spans EXERCISES but never CUSTOMERS.
            // Required + indexed for the "this organization's staff" read. NO global query filter: like
            // Exercise, StaffUser is a resolution root (looked up by ExternalSubject pre-session).
            entity.Property(e => e.OrganizationId).IsRequired();
            entity.HasIndex(e => e.OrganizationId);
        });

        modelBuilder.Entity<StaffAssignment>(entity =>
        {
            entity.HasKey(e => e.Id);

            // NOT IExerciseScoped: cross-exercise by design (COR-005). ExerciseId is a PLAIN column.
            // One role per (staff user, exercise); plus a reverse index for "who is assigned to exercise X".
            entity.HasIndex(e => new { e.StaffUserId, e.ExerciseId }).IsUnique();
            entity.HasIndex(e => e.ExerciseId);
        });

        modelBuilder.Entity<Session>(entity =>
        {
            entity.HasKey(e => e.Id);

            // NOT IExerciseScoped: looked up by opaque token pre-scope-resolution (see Session XML doc).
            // Token/refresh hashes: bounded (index-key eligible), unique; refresh is filtered-unique (nullable).
            entity.Property(e => e.TokenHash).HasMaxLength(256);
            entity.HasIndex(e => e.TokenHash).IsUnique();
            entity.Property(e => e.RefreshTokenHash).HasMaxLength(256);
            entity.HasIndex(e => e.RefreshTokenHash)
                .IsUnique()
                .HasFilter("[RefreshTokenHash] IS NOT NULL");

            // Bound exercise is a plain column; indexed for the story-07 revoke-all-by-exercise query.
            entity.HasIndex(e => e.ExerciseId);
        });

        // ------------------------------------------------------------------------------------------
        // READ-SIDE GLOBAL QUERY FILTER — exercise-isolation/01 (#44): the always-Critical read half of
        // the isolation guarantee (COR-001). Applied CENTRALLY to EVERY IExerciseScoped entity by
        // reflecting over the model — not entity-by-entity — so a newly-added scoped entity is covered
        // automatically and a new endpoint cannot accidentally omit the scope (the whole reason this lives
        // here, once, and not on each query).
        //
        // FAIL CLOSED (captured in the ctor): _currentExerciseId is
        //     accessor?.CurrentExerciseId ?? Guid.Empty
        // so an UNSET scope (no IExerciseContext, or CurrentExerciseId == null) is Guid.Empty. The
        // write-time guard below (GuardExerciseScope — deliberately untouched by this story) forbids
        // persisting any scoped row with ExerciseId == Guid.Empty, so the predicate
        // `e.ExerciseId == Guid.Empty` can match NOTHING. An unresolved scope therefore yields ZERO rows,
        // never all exercises — a closed door, not an open one. Do NOT invert this to a "null scope sees
        // everything" default: that would fail OPEN and leak across exercises.
        foreach (var entityType in modelBuilder.Model.GetEntityTypes())
        {
            if (typeof(IExerciseScoped).IsAssignableFrom(entityType.ClrType))
            {
                ApplyExerciseScopeFilterMethod
                    .MakeGenericMethod(entityType.ClrType)
                    .Invoke(this, [modelBuilder]);
            }
        }
        // ------------------------------------------------------------------------------------------

        // ------------------------------------------------------------------------------------------
        // READ-SIDE GLOBAL QUERY FILTER, SECOND AXIS — exercise-isolation/11 (COR-010): the CUSTOMER
        // tenant boundary above the exercise. Applied CENTRALLY over IOrganizationScoped by the same
        // reflect-over-the-model idiom, so a newly-added org-owned library entity is covered automatically.
        //
        // ADDITIVE, NEVER SUBSTITUTIVE. This loop runs AFTER the exercise loop above and uses a DISTINCT
        // filter key (OrganizationScopeFilterKey), so on an entity carrying both markers EF Core 10 keeps
        // BOTH named filters and ANDs them. It cannot overwrite, relax or disable the always-Critical
        // exercise predicate — which is why the exercise loop above is left byte-for-byte unchanged.
        //
        // FAIL CLOSED (captured in the ctor): _currentOrganizationId is
        //     organizationContext?.CurrentOrganizationId ?? Guid.Empty
        // and GuardOrganizationScope below forbids persisting any org-owned row with an empty
        // OrganizationId — so an unresolved tenant matches NOTHING, never every customer's library.
        //
        // AND IT CANNOT WIDEN THE EXERCISE SCOPE. The two axes cover disjoint entity sets today
        // (IOrganizationScoped = PersonaTemplate; IExerciseScoped = the participant content entities), and
        // even where they overlap the predicates conjoin. There is no code path by which an unresolved —
        // or a wrongly-resolved — organization returns MORE IExerciseScoped rows than before this story.
        foreach (var entityType in modelBuilder.Model.GetEntityTypes())
        {
            if (typeof(IOrganizationScoped).IsAssignableFrom(entityType.ClrType))
            {
                ApplyOrganizationScopeFilterMethod
                    .MakeGenericMethod(entityType.ClrType)
                    .Invoke(this, [modelBuilder]);
            }
        }
        // ------------------------------------------------------------------------------------------
    }

    /// <summary>
    /// Adds the read-side global query filter to one <see cref="IExerciseScoped"/> entity. Kept as a
    /// strongly-typed generic (rather than a hand-built <see cref="System.Linq.Expressions.Expression"/>)
    /// so the predicate closes over THIS context instance's <see cref="_currentExerciseId"/> field the way
    /// EF Core recognises: it is re-read as a query parameter on every query, so the single cached model
    /// serves every context instance / scope correctly. Invoked via reflection from
    /// <see cref="OnModelCreating"/> for each scoped entity type.
    /// </summary>
    private void ApplyExerciseScopeFilter<TEntity>(ModelBuilder modelBuilder)
        where TEntity : class, IExerciseScoped
    {
        modelBuilder.Entity<TEntity>().HasQueryFilter(e => e.ExerciseId == _currentExerciseId);
    }

    /// <summary>
    /// Adds the read-side global query filter to one <see cref="IOrganizationScoped"/> entity — the second
    /// (CUSTOMER tenant) axis. Same strongly-typed-generic idiom as
    /// <see cref="ApplyExerciseScopeFilter{TEntity}"/>, invoked by reflection from
    /// <see cref="OnModelCreating"/> for each org-scoped entity type.
    /// </summary>
    /// <remarks>
    /// Registered under the explicit <see cref="OrganizationScopeFilterKey"/> rather than as the anonymous
    /// (null-keyed) filter the exercise axis uses. That key is LOAD-BEARING, not cosmetic: EF Core keys
    /// global filters, and re-using the anonymous key would REPLACE the exercise predicate on any entity
    /// that ever carries both markers — silently deleting the always-Critical per-exercise guarantee while
    /// still looking filtered. A distinct key makes the two axes conjoin instead of compete, and lets the
    /// model tests assert each axis independently.
    /// </remarks>
    private void ApplyOrganizationScopeFilter<TEntity>(ModelBuilder modelBuilder)
        where TEntity : class, IOrganizationScoped
    {
        modelBuilder.Entity<TEntity>()
            .HasQueryFilter(OrganizationScopeFilterKey, e => e.OrganizationId == _currentOrganizationId);
    }

    /// <inheritdoc />
    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        GuardExerciseScope();
        GuardOrganizationScope();
        GuardTelemetryEnvelope();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    /// <inheritdoc />
    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        GuardExerciseScope();
        GuardOrganizationScope();
        GuardTelemetryEnvelope();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    /// <summary>
    /// Fail-closed write-time isolation guard (COR-001 / XC-001, Tier-2). Scans every tracked
    /// <see cref="IExerciseScoped"/> entity being added or modified and THROWS
    /// <see cref="ExerciseScopeViolationException"/> — before <c>base.SaveChanges</c> runs, so nothing
    /// reaches the database — if any carries a default (<see cref="Guid.Empty"/>) <c>ExerciseId</c>. This is
    /// the write half of the isolation guarantee only; the read-side global query filter is
    /// <c>exercise-isolation/01</c>.
    /// </summary>
    private void GuardExerciseScope()
    {
        foreach (var entry in ChangeTracker.Entries<IExerciseScoped>())
        {
            if (entry.State is not (EntityState.Added or EntityState.Modified))
            {
                continue;
            }

            if (entry.Entity.ExerciseId == Guid.Empty)
            {
                throw new ExerciseScopeViolationException(
                    $"Refusing to persist {entry.Entity.GetType().Name} with a default (empty) ExerciseId " +
                    "(COR-001/XC-001 write-time isolation guard).");
            }
        }
    }

    /// <summary>
    /// Fail-closed write-time CUSTOMER-tenant guard (COR-010, exercise-isolation/11, Tier-2). Scans every
    /// tracked <see cref="IOrganizationOwned"/> entity being added or modified and THROWS
    /// <see cref="OrganizationScopeViolationException"/> — before <c>base.SaveChanges</c> runs, so nothing
    /// reaches the database — if any carries a default (<see cref="Guid.Empty"/>) <c>OrganizationId</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This is the twin of <see cref="GuardExerciseScope"/> one tier out, and it is what makes the empty
    /// GUID a usable fail-closed sentinel on BOTH the read filter
    /// (<see cref="ApplyOrganizationScopeFilter{TEntity}"/>) and the resolution constraint
    /// (<see cref="OrganizationScope.InOrganization{TEntity}"/>): if no row can carry it, neither can match.
    /// </para>
    /// <para>
    /// It covers <see cref="IOrganizationOwned"/> — the WIDER marker — not just
    /// <see cref="IOrganizationScoped"/>. That is deliberate: <c>Exercise</c> and <c>StaffUser</c> are not
    /// read-filtered, so this guard is the ONLY structural thing standing between a future creation
    /// endpoint and an orphan exercise that belongs to no customer and that no org-bounded staff surface
    /// could ever reach or administer.
    /// </para>
    /// </remarks>
    private void GuardOrganizationScope()
    {
        foreach (var entry in ChangeTracker.Entries<IOrganizationOwned>())
        {
            if (entry.State is not (EntityState.Added or EntityState.Modified))
            {
                continue;
            }

            if (entry.Entity.OrganizationId == Guid.Empty)
            {
                throw new OrganizationScopeViolationException(
                    $"Refusing to persist {entry.Entity.GetType().Name} with a default (empty) OrganizationId " +
                    "(COR-010 write-time customer-tenant guard, exercise-isolation/11).");
            }
        }
    }

    /// <summary>
    /// Fail-closed write-time telemetry-envelope guard (XC-004, #356). Scans every tracked
    /// <see cref="TelemetryEvent"/> being added or modified against the LOCKED v0 envelope's
    /// conditional-requiredness rules (<see cref="TelemetryEnvelopeRules"/>) and THROWS
    /// <see cref="TelemetryEnvelopeViolationException"/> — before <c>base.SaveChanges</c> runs, so nothing
    /// reaches the database.
    /// </summary>
    /// <remarks>
    /// Applied CENTRALLY here, for the same reason the exercise-scope guard and the read-side query filter
    /// are: <c>POST /api/telemetry</c> already re-enforces every conditional rule server-side, but the
    /// identity/engine services add <see cref="TelemetryEvent"/> rows DIRECTLY to the context, and were on
    /// the honour system for those rules. One of them wasn't honouring them (#356 — a failed participant
    /// login persisted <c>actor.kind: 'participant'</c> with no <c>participantId</c>, a shape the ingest
    /// endpoint rejects with a 400). A guard here makes the class of bug unrepresentable instead of fixing
    /// one instance of it, and a newly-added emitter is covered automatically.
    /// </remarks>
    private void GuardTelemetryEnvelope()
    {
        foreach (var entry in ChangeTracker.Entries<TelemetryEvent>())
        {
            if (entry.State is not (EntityState.Added or EntityState.Modified))
            {
                continue;
            }

            var violations = TelemetryEnvelopeRules.Validate(
                TelemetryAttributionFacts.FromEntity(entry.Entity));

            if (violations.Count > 0)
            {
                throw new TelemetryEnvelopeViolationException(
                    $"Refusing to persist telemetry event '{entry.Entity.EventType}' " +
                    $"(eventId {entry.Entity.EventId}): {string.Join(" ", violations)} " +
                    "(XC-004 write-time envelope guard).");
            }
        }
    }
}
