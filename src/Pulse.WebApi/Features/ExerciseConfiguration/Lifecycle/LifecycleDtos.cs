namespace Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;

using System.Collections.Generic;
using System.Text.Json.Serialization;

/// <summary>
/// <c>GET /api/staff/exercise-lifecycle</c> / the transition response body — the resolved exercise's COR-032
/// lifecycle state, the transitions currently allowed from it, and the behaviour hooks that state implies.
/// A STAFF-world shape (XC-002): it is only ever returned to an authenticated staff caller assigned to the
/// resolved exercise, and it carries no participant content.
/// </summary>
/// <remarks>
/// <para>
/// <b>The exercise is never a parameter.</b> <see cref="ExerciseId"/> is echoed for display/query-keying only
/// — it is the scope the server already resolved, never something the client chose (COR-001).
/// </para>
/// <para>
/// Every property carries an explicit camelCase <see cref="JsonPropertyNameAttribute"/> so the wire shape is
/// fixed independent of host serializer config, matching the house DTO style.
/// </para>
/// </remarks>
public sealed class ExerciseLifecycleDto
{
    /// <summary>The server-resolved exercise's id (echo only — never an input).</summary>
    [JsonPropertyName("exerciseId")]
    public required string ExerciseId { get; init; }

    /// <summary>
    /// The CANONICAL COR-032 state literal (<c>build|staged|live|paused|completed|archived</c>). A row still
    /// carrying a legacy literal is reported here as its mapped canonical equivalent, so a staff console never
    /// has to know the legacy vocabulary.
    /// </summary>
    [JsonPropertyName("state")]
    public required string State { get; init; }

    /// <summary>The raw stored <c>Exercise.Status</c> value, so a legacy row is diagnosable from the console.</summary>
    [JsonPropertyName("storedStatus")]
    public required string StoredStatus { get; init; }

    /// <summary>The states reachable from <see cref="State"/>; empty for the terminal <c>archived</c>.</summary>
    [JsonPropertyName("allowedTransitions")]
    public required IReadOnlyList<string> AllowedTransitions { get; init; }

    /// <summary>The behaviour hooks this state implies (AC7).</summary>
    [JsonPropertyName("behaviour")]
    public required ExerciseLifecycleBehaviourDto Behaviour { get; init; }

    /// <summary>Projects the service's snapshot onto the wire shape.</summary>
    /// <param name="snapshot">The resolved lifecycle snapshot.</param>
    /// <returns>The DTO.</returns>
    public static ExerciseLifecycleDto FromSnapshot(ExerciseLifecycleSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);

        return new ExerciseLifecycleDto
        {
            ExerciseId = snapshot.ExerciseId.ToString(),
            State = snapshot.State,
            StoredStatus = snapshot.StoredStatus,
            AllowedTransitions = snapshot.AllowedTransitions,
            Behaviour = ExerciseLifecycleBehaviourDto.From(snapshot.Behaviour),
        };
    }
}

/// <summary>The wire projection of <see cref="ExerciseLifecycleBehaviour"/> (AC7's documented hooks).</summary>
public sealed class ExerciseLifecycleBehaviourDto
{
    /// <summary>Whether a participant may be served this exercise at all.</summary>
    [JsonPropertyName("participantAccessOpen")]
    public required bool ParticipantAccessOpen { get; init; }

    /// <summary>Whether participant sim writes are meaningful in this state.</summary>
    [JsonPropertyName("participantWritesAccepted")]
    public required bool ParticipantWritesAccepted { get; init; }

    /// <summary>Whether the ambient world runs.</summary>
    [JsonPropertyName("ambientWorldRuns")]
    public required bool AmbientWorldRuns { get; init; }

    /// <summary>Whether the exercise clock advances (COR-050).</summary>
    [JsonPropertyName("clockRuns")]
    public required bool ClockRuns { get; init; }

    /// <summary>Whether scheduled scenario content fires, or is held.</summary>
    [JsonPropertyName("scenarioContentFires")]
    public required bool ScenarioContentFires { get; init; }

    /// <summary>Whether the state is terminal.</summary>
    [JsonPropertyName("isTerminal")]
    public required bool IsTerminal { get; init; }

    /// <summary>Projects the behaviour record onto the wire shape.</summary>
    /// <param name="behaviour">The behaviour hooks.</param>
    /// <returns>The DTO.</returns>
    public static ExerciseLifecycleBehaviourDto From(ExerciseLifecycleBehaviour behaviour)
    {
        ArgumentNullException.ThrowIfNull(behaviour);

        return new ExerciseLifecycleBehaviourDto
        {
            ParticipantAccessOpen = behaviour.ParticipantAccessOpen,
            ParticipantWritesAccepted = behaviour.ParticipantWritesAccepted,
            AmbientWorldRuns = behaviour.AmbientWorldRuns,
            ClockRuns = behaviour.ClockRuns,
            ScenarioContentFires = behaviour.ScenarioContentFires,
            IsTerminal = behaviour.IsTerminal,
        };
    }
}

/// <summary>
/// <c>POST /api/staff/exercise-lifecycle/transition</c> request body — the requested TARGET state and nothing
/// else. The scalar is nullable so a missing field is a validation <c>400</c>, never a deserialization
/// failure, matching the house request-DTO rule.
/// </summary>
/// <remarks>
/// <b>There is deliberately no exercise id on this body (COR-001).</b> The exercise a transition applies to is
/// the server-resolved scope; a client-supplied id would be exactly the cross-exercise vector XC-001/XC-002
/// forbid. There is also no "from" state: the machine reads the CURRENT stored state itself rather than
/// trusting the caller's idea of it.
/// </remarks>
public sealed class ExerciseLifecycleTransitionRequest
{
    /// <summary>The requested target state — a COR-032 literal.</summary>
    [JsonPropertyName("to")]
    public string? To { get; init; }
}
