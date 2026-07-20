namespace Pulse.WebApi.Data;

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
    /// <summary>Creates the context with externally-supplied options (DI / design-time / tests).</summary>
    public PulseDbContext(DbContextOptions<PulseDbContext> options)
        : base(options)
    {
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

        // ------------------------------------------------------------------------------------------
        // EXTENSION POINT — exercise-isolation/01 (#44) ADDS the read-side global query filter HERE:
        //   modelBuilder.Entity<Persona>().HasQueryFilter(...); (and Post, TelemetryEvent)
        // Do NOT add HasQueryFilter in THIS story — it is exercise-isolation/01's diff. Adding it here
        // is scope creep and would collide with that story. This story delivers only the schema +
        // write-time halves of isolation (see the class remarks); the read-side filter completes it.
        // ------------------------------------------------------------------------------------------
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
