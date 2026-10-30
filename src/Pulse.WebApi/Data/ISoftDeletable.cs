namespace Pulse.WebApi.Data;

/// <summary>
/// Marks an entity whose rows are never hard-deleted (XC-010): removing one through <see cref="PulseDbContext"/> keeps
/// the row and stamps <see cref="DeletedAt"/>, and the entity's global query filter hides it from default reads
/// (channels-foundation story 01).
/// </summary>
/// <remarks>
/// <para>
/// <b>Opt-in, not a model-wide convention.</b> The entities that predate this marker (<c>Post</c>, <c>InjectItem</c>,
/// <c>PostReaction</c> ...) keep their own <c>DeletedAt</c> column and exclude deleted rows by hand, exactly as before;
/// only the channel entities (story 01's M1) implement it. Converting an older entity is a behaviour change for its
/// readers and needs its own story.
/// </para>
/// <para>
/// <b>Composed with the exercise axis, never instead of it.</b> EF Core 10 allows one anonymous filter per entity, so an
/// implementer's filter is the always-Critical exercise predicate AND <c>DeletedAt IS NULL</c>; an implementer must
/// therefore also be <see cref="IExerciseScoped"/> (model build fails otherwise). A reader that must see deleted rows
/// (a zone name on a historic forecast, an audit export) uses <see cref="PulseDbContext.IncludingSoftDeleted{TEntity}"/>,
/// which keeps the exercise scope — never a bare <c>IgnoreQueryFilters()</c>.
/// </para>
/// </remarks>
public interface ISoftDeletable
{
    /// <summary>Server wall-clock instant the row was deleted (staff-only); <c>null</c> while the row is live.</summary>
    DateTimeOffset? DeletedAt { get; set; }
}
