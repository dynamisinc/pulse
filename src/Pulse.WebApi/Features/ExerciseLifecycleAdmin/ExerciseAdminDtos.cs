namespace Pulse.WebApi.Features.ExerciseLifecycleAdmin;

using System.Text.Json.Serialization;

/// <summary>
/// The <c>POST /api/org/exercises</c> request body (COR-074). Every field is a nullable scalar so a missing
/// one is a validation concern (a <c>400</c>), never a deserialization failure.
/// </summary>
/// <remarks>
/// <para>
/// <b>What is deliberately ABSENT is the contract.</b> There is no organization field, and there never may be:
/// the owning tenant is stamped from the caller's own server-resolved organization, so a client that wanted to
/// create an exercise under a different customer has no field to say it in — the cross-CUSTOMER analogue of
/// the client-supplied <c>exerciseId</c> COR-001 forbids on the inner axis. There is likewise no
/// <c>status</c>, <c>exerciseId</c> or <c>createdAt</c>: the lifecycle state is always <c>build</c> (COR-032),
/// and the id and creation instant are server-generated. <c>OrganizationIsNotWireVisibleTests</c> enforces the
/// first of those mechanically over every DTO in the assembly.
/// </para>
/// </remarks>
public sealed class CreateExerciseRequest
{
    /// <summary>
    /// The staff-facing internal name of the run (COR-030's <c>Exercise.Name</c>) — the only required field.
    /// Sanitized on ingest (NFR-004: markup is STRIPPED, not encoded) and length-bounded.
    /// </summary>
    [JsonPropertyName("name")]
    public string? Name { get; init; }

    /// <summary>
    /// An OPTIONAL proposed host for the exercise (COR-008). When present it is normalized and must be a
    /// well-formed DNS hostname that no other exercise already holds; when absent the server allocates a
    /// unique one. Either way uniqueness is GLOBAL, across every organization.
    /// </summary>
    [JsonPropertyName("hostname")]
    public string? Hostname { get; init; }
}

/// <summary>
/// One exercise row on an organization-administration surface (COR-075) — the minimum a planner or org-admin
/// needs to tell two runs apart without opening either: name, lifecycle status, host and creation date.
/// </summary>
/// <remarks>
/// Staff/platform world only (XC-002). It carries NO tenant id: the caller can only ever see their own
/// organization's exercises, so naming the organization on the wire would disclose a concept no surface needs
/// and invite a client to start sending one back.
/// </remarks>
public sealed class OrgExerciseDto
{
    /// <summary>The exercise's id (lowercase GUID string, matching every other endpoint's casing).</summary>
    [JsonPropertyName("exerciseId")]
    public required string ExerciseId { get; init; }

    /// <summary>The staff-facing internal name.</summary>
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    /// <summary>
    /// The COR-032 lifecycle literal, canonicalized (a legacy <c>scheduled</c>/<c>active</c>/<c>complete</c>
    /// row is folded onto its canonical equivalent) so the frozen client guard never sees a retired spelling.
    /// A value the state machine does not recognise at all is emitted verbatim, so the client's own
    /// fail-closed guard can refuse it rather than being handed a fabricated state.
    /// </summary>
    [JsonPropertyName("status")]
    public required string Status { get; init; }

    /// <summary>The provisioned host (COR-008), or <c>null</c> for an exercise with none.</summary>
    [JsonPropertyName("hostname")]
    public string? Hostname { get; init; }

    /// <summary>
    /// The server wall-clock instant the exercise was created (ISO-8601 round-trip), or <c>null</c> when it
    /// is genuinely unknown — a row that predates the column. Never a fabricated stand-in date.
    /// </summary>
    [JsonPropertyName("createdAt")]
    public string? CreatedAt { get; init; }
}

/// <summary>The <c>POST /api/org/exercises</c> success body (COR-074): the new exercise plus the assignment it minted for its creator.</summary>
public sealed class CreateExerciseResponseDto
{
    /// <summary>The newly created exercise, in the same shape the list surface renders.</summary>
    [JsonPropertyName("exercise")]
    public required OrgExerciseDto Exercise { get; init; }

    /// <summary>
    /// The role of the <c>StaffAssignment</c> auto-created for the creator (COR-074 AC3) — their own role,
    /// <c>planner</c> or <c>orgAdmin</c> — so they can reach the run through the exercise switcher immediately.
    /// </summary>
    [JsonPropertyName("assignedRole")]
    public required string AssignedRole { get; init; }
}

/// <summary>
/// One staff assignment within the caller's organization (COR-076) — which staff human holds which role on
/// which of the organization's exercises. The Phase-1 org-admin surface's second read.
/// </summary>
/// <remarks>
/// Staff/platform world only (XC-002), and org-bounded on BOTH joins: the exercise and the staff human must
/// each belong to the caller's own tenant, so an assignment that straddles a customer boundary is invisible
/// here rather than half-rendered.
/// </remarks>
public sealed class OrgStaffAssignmentDto
{
    /// <summary>The assigned exercise's id.</summary>
    [JsonPropertyName("exerciseId")]
    public required string ExerciseId { get; init; }

    /// <summary>The assigned exercise's staff-facing name.</summary>
    [JsonPropertyName("exerciseName")]
    public required string ExerciseName { get; init; }

    /// <summary>The assigned staff human's id.</summary>
    [JsonPropertyName("staffUserId")]
    public required string StaffUserId { get; init; }

    /// <summary>The assigned staff human's display name (staff surfaces only).</summary>
    [JsonPropertyName("displayName")]
    public required string DisplayName { get; init; }

    /// <summary>The role held on that exercise — the frozen <c>ExerciseRole</c> vocabulary, verbatim.</summary>
    [JsonPropertyName("role")]
    public required string Role { get; init; }

    /// <summary>The server wall-clock instant the assignment was created (ISO-8601 round-trip).</summary>
    [JsonPropertyName("assignedAt")]
    public required string AssignedAt { get; init; }
}
