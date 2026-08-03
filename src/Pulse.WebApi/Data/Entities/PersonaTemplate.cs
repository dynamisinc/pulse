namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// A reusable persona authoring-library record, SHARED across many exercise runs (XC-005) — the telemetry
/// schema's note that persona templates are shared across runs, "never a reusable template id". Because it
/// is not owned by any single run it is deliberately NOT <see cref="IExerciseScoped"/>. Instantiating a
/// template into a run's <see cref="Persona"/> cast (COR-021) is a later content-authoring story; this row
/// is just the library asset.
/// </summary>
/// <remarks>
/// <para>
/// <b>Org-scoped as of exercise-isolation/11 (COR-010) — this closes story 11's "gap 2".</b> "Shared across
/// runs" was only ever meant to be shared across <i>one customer's</i> runs. With no tenant tier, an
/// unfiltered library table meant one customer's authored templates would be visible to every other
/// customer the moment a second one existed — a latent cross-CUSTOMER leak. This entity therefore
/// implements <see cref="IOrganizationScoped"/>: the <see cref="PulseDbContext"/> applies a central
/// read-side global query filter on <see cref="OrganizationId"/>, and the write-guard refuses an empty one.
/// </para>
/// <para>
/// <b>XC-005 is preserved exactly, one tier in.</b> The filter is on the ORGANIZATION, not the exercise, so
/// a template remains fully shared across every exercise run of its owning organization — which is the
/// reuse XC-005 exists to allow. Nothing about cross-EXERCISE sharing changed; only cross-CUSTOMER sharing
/// was removed. Do not "fix" this by adding an <c>ExerciseId</c>: binding a library asset to a single run
/// would break the very reuse it exists for.
/// </para>
/// </remarks>
public sealed class PersonaTemplate : IOrganizationScoped
{
    /// <summary>Primary key. Stable across runs — a run's <see cref="Persona"/> may point back at it.</summary>
    public Guid Id { get; set; }

    /// <summary>
    /// The owning customer tenant (COR-010). Non-nullable and centrally filtered
    /// (<see cref="IOrganizationScoped"/>): a template is shared across ALL of this organization's exercise
    /// runs and visible to NO other organization. Server-stamped from the resolved tenant, never a client body.
    /// </summary>
    public Guid OrganizationId { get; set; }

    /// <summary>Display name of the templated character.</summary>
    public required string DisplayName { get; set; }

    /// <summary>Social handle of the templated character (handle-uniqueness policy is out of scope here).</summary>
    public required string Handle { get; set; }
}
