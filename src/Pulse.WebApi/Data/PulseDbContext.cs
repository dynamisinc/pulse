namespace Pulse.WebApi.Data;

using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The first durable state in Pulse (COR-001, XC-004) — EF Core on Azure SQL. Exposes exactly the
/// walking-skeleton entity set; the rest of E1's domain (<c>Organization</c>, <c>ParticipantAccount</c>,
/// <c>StaffAssignment</c>, <c>Cast</c>) is deferred to the identity phase and is intentionally NOT here.
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

    /// <summary>The engine review-queue store — one row per generated burst awaiting/resolved review (E8 §8).</summary>
    public DbSet<EngineReviewItemEntity> EngineReviewItems => Set<EngineReviewItemEntity>();

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

        modelBuilder.Entity<EngineReviewItemEntity>(entity =>
        {
            // DraftId is the stable burst identity → primary key (one burst = one review item, ADP-040).
            entity.HasKey(e => e.DraftId);
            entity.Property(e => e.ExerciseId).IsRequired();
            entity.HasIndex(e => e.ExerciseId);

            // The draft posts persist as an owned JSON collection — one nvarchar(max) column, no child table.
            entity.OwnsMany(e => e.Posts, posts => posts.ToJson());
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
