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
/// <c>Organization</c> / <c>Cast</c> remain deferred (exercise-isolation/11, gated on multi-customer go-live).
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
/// </remarks>
public class PulseDbContext : DbContext
{
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
    /// The exercise scope for the read-side global query filter, captured ONCE at construction. Fails
    /// closed to <see cref="Guid.Empty"/> when no scope is resolved (see the constructor).
    /// </summary>
    private readonly Guid _currentExerciseId;

    /// <summary>Creates the context with externally-supplied options (DI / design-time / tests).</summary>
    /// <param name="options">The EF Core options (provider, connection string).</param>
    /// <param name="exerciseContext">
    /// The current exercise scope for the read-side global query filter. OPTIONAL/nullable so the
    /// design-time <see cref="PulseDbContextFactory"/> (which calls <c>new PulseDbContext(options)</c>) and
    /// tests that don't care about scoping still compile and work; at runtime <c>AddDbContext</c> injects
    /// the registered <see cref="IExerciseContext"/>. A <c>null</c> accessor — or a null
    /// <see cref="IExerciseContext.CurrentExerciseId"/> — means "no scope resolved" and fails closed.
    /// </param>
    public PulseDbContext(DbContextOptions<PulseDbContext> options, IExerciseContext? exerciseContext = null)
        : base(options)
    {
        // Fail-closed capture (the always-Critical property): an unset scope collapses to Guid.Empty,
        // which the write-guard guarantees no scoped row ever carries — so the query filter matches zero
        // rows, never all exercises. Read the reasoning in full in OnModelCreating.
        _currentExerciseId = exerciseContext?.CurrentExerciseId ?? Guid.Empty;
    }

    /// <summary>The exercise runs — the aggregate root / isolation scope.</summary>
    public DbSet<Exercise> Exercises => Set<Exercise>();

    /// <summary>The shared, cross-run persona authoring library (XC-005).</summary>
    public DbSet<PersonaTemplate> PersonaTemplates => Set<PersonaTemplate>();

    /// <summary>Personas instantiated within a single exercise run.</summary>
    public DbSet<Persona> Personas => Set<Persona>();

    /// <summary>Posts authored within a single exercise run.</summary>
    public DbSet<Post> Posts => Set<Post>();

    /// <summary>The durable telemetry event store (XC-004).</summary>
    public DbSet<TelemetryEvent> TelemetryEvents => Set<TelemetryEvent>();

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

        modelBuilder.Entity<Exercise>(entity =>
        {
            entity.HasKey(e => e.Id);

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
            entity.Property(e => e.Status).IsRequired().HasDefaultValue("scheduled");
            // CurrentScenarioTime is nullable by its C# type (B2 placeholder) — no extra config.
        });

        modelBuilder.Entity<PersonaTemplate>(entity =>
        {
            entity.HasKey(e => e.Id);
            // NOT IExerciseScoped: a shared library asset, no ExerciseId (XC-005).
        });

        modelBuilder.Entity<Persona>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ExerciseId).IsRequired();
            entity.HasIndex(e => e.ExerciseId);
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

    /// <inheritdoc />
    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        GuardExerciseScope();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    /// <inheritdoc />
    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        GuardExerciseScope();
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
}
