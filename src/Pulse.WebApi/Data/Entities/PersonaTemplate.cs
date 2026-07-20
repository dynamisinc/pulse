namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// A reusable persona authoring-library record, SHARED across many exercise runs (XC-005) — the telemetry
/// schema's note that persona templates are shared across runs, "never a reusable template id". Because it
/// is not owned by any single run it is deliberately NOT <see cref="IExerciseScoped"/>. Instantiating a
/// template into a run's <see cref="Persona"/> cast (COR-021) is a later content-authoring story; this row
/// is just the library asset.
/// </summary>
public sealed class PersonaTemplate
{
    /// <summary>Primary key. Stable across runs — a run's <see cref="Persona"/> may point back at it.</summary>
    public Guid Id { get; set; }

    /// <summary>Display name of the templated character.</summary>
    public required string DisplayName { get; set; }

    /// <summary>Social handle of the templated character (handle-uniqueness policy is out of scope here).</summary>
    public required string Handle { get; set; }
}
