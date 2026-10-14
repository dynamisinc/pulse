namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// One pre-written "white noise" post in an exercise's pool (demo-feedback DF-12): background chatter a persona
/// posts at a controller-chosen rate so the feed never feels empty. Belongs to exactly one exercise run, so it is
/// <see cref="IExerciseScoped"/> and inherits <see cref="PulseDbContext"/>'s central read filter and write guard
/// (COR-001) — no query scopes it by hand, and no request ever carries an exercise id.
/// </summary>
/// <remarks>
/// <para>
/// <b>Staff world only (XC-002).</b> This row is controller tooling: the pool, its order and its usage counters. Only
/// the posts the pacer publishes reach a participant, through <c>PostIngestService</c> with origin <c>noise</c> and
/// its participant-safe projection.
/// </para>
/// <para>
/// <b><see cref="PersonaId"/> is a logical reference</b> (house style, see <see cref="Follow"/>): no foreign key and no
/// navigation; every read resolves it through the exercise-scoped <c>Personas</c> set, so a cross-exercise id does not
/// resolve.
/// </para>
/// <para>
/// <b>Schema only (demo-feedback story 01).</b> The pool endpoints and the pacer are story 05. The pacer picks the
/// least-posted entry first (DF-13), which <c>IX_NoisePosts_ExerciseId_PostedCount_Order</c> serves.
/// </para>
/// </remarks>
public sealed class NoisePost : IExerciseScoped
{
    /// <summary>The schema bound of <see cref="Text"/>.</summary>
    public const int MaxTextLength = 280;

    /// <summary>Primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>The owning exercise run (COR-001). Non-nullable; the write-guard rejects <see cref="Guid.Empty"/>.</summary>
    public Guid ExerciseId { get; set; }

    /// <summary>The <see cref="Persona"/> that posts this text — a logical reference resolved through the scoped <c>Personas</c> set.</summary>
    public Guid PersonaId { get; set; }

    /// <summary>The post text, at most <see cref="MaxTextLength"/> characters.</summary>
    public required string Text { get; set; }

    /// <summary>The entry's position in the pool; the tie-break after <see cref="PostedCount"/>.</summary>
    public int Order { get; set; }

    /// <summary>How many times the pacer has published this entry. <c>NOT NULL DEFAULT 0</c>.</summary>
    public int PostedCount { get; set; }

    /// <summary>Server wall-clock instant of this entry's last publish (staff-only); <c>null</c> until first posted.</summary>
    public DateTimeOffset? LastPostedWallClock { get; set; }

    /// <summary>Server wall-clock instant the entry was added to the pool (staff-only).</summary>
    public DateTimeOffset CreatedWallClock { get; set; }
}
