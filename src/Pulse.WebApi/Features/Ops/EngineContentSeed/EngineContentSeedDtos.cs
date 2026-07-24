namespace Pulse.WebApi.Features.Ops.EngineContentSeed;

using System.Text.Json.Serialization;

/// <summary>
/// The <c>POST /api/ops/seed-engine-content</c> request body (camelCase JSON, feature engine-content-seed
/// story 03). Every scalar is nullable so a missing field is a validation concern (a 400), never a
/// deserialization failure. No <c>exerciseId</c> is accepted — the target exercise is resolved by
/// <see cref="Hostname"/> (never created), and every child row is stamped with that exercise's OWN id
/// (COR-001); this endpoint never attaches data to an arbitrary exercise by a client-supplied id.
/// </summary>
public sealed class EngineContentSeedRequest
{
    /// <summary>
    /// The per-exercise host (COR-008, e.g. <c>pulse-uat.cobrasoftware.com</c>) the already-bootstrapped
    /// exercise is bound to. Required; format-validated + lower-cased by the same host normalizer the
    /// resolution path uses. A host that resolves to no exercise returns 404 WITHOUT creating one (this
    /// endpoint never creates an exercise — only <c>POST /api/ops/bootstrap-exercise</c> does).
    /// </summary>
    [JsonPropertyName("hostname")]
    public string? Hostname { get; init; }

    /// <summary>
    /// Optional silence window in scenario minutes before the storyline escalates. Omit for the demo-tuned
    /// default (3). Clamped to a documented sane bound (1–180) regardless of the value supplied. A slower,
    /// more "realistic" run can pass a larger value here.
    /// </summary>
    [JsonPropertyName("responseWindowMinutes")]
    public int? ResponseWindowMinutes { get; init; }
}

/// <summary>
/// The <c>POST /api/ops/seed-engine-content</c> success response (story 03). An OPS/staff-world response (no
/// participant surface here), so it may carry ids and counts. Every property has an explicit camelCase
/// <see cref="JsonPropertyNameAttribute"/>. The <see cref="Note"/> field documents the idempotent-re-run
/// limitation (the storyline is rebuilt fresh, resetting accrued intensity/phase progress) so a re-seed is
/// not a silent reset (AC4).
/// </summary>
public sealed class EngineContentSeedResponseDto
{
    /// <summary>The resolved (never created) exercise id the loop was registered for.</summary>
    [JsonPropertyName("exerciseId")]
    public required string ExerciseId { get; init; }

    /// <summary>The host the exercise is bound to (normalized/lower-cased).</summary>
    [JsonPropertyName("hostname")]
    public required string Hostname { get; init; }

    /// <summary>How many persona rows this call created.</summary>
    [JsonPropertyName("personasCreated")]
    public required int PersonasCreated { get; init; }

    /// <summary>How many persona rows this call reused (already present from a prior seed).</summary>
    [JsonPropertyName("personasReused")]
    public required int PersonasReused { get; init; }

    /// <summary>The freshly-built starter storyline's id (in-memory only — not persisted this phase).</summary>
    [JsonPropertyName("storylineId")]
    public required string StorylineId { get; init; }

    /// <summary>The starter storyline's title.</summary>
    [JsonPropertyName("storylineTitle")]
    public required string StorylineTitle { get; init; }

    /// <summary>The silence window (scenario minutes) the storyline was armed with (after clamping).</summary>
    [JsonPropertyName("responseWindowMinutes")]
    public required int ResponseWindowMinutes { get; init; }

    /// <summary>
    /// A human-readable note documenting the idempotent-re-run limitation — the loop registration is replaced
    /// (never duplicated) and the storyline is rebuilt fresh at minute 0, so any intensity/phase progress
    /// accrued since a prior seed is reset (AC4).
    /// </summary>
    [JsonPropertyName("note")]
    public required string Note { get; init; }

    /// <summary>Builds the response from a provisioned service result.</summary>
    /// <param name="result">The seed result (must be a provisioned outcome).</param>
    /// <returns>The response DTO.</returns>
    public static EngineContentSeedResponseDto From(EngineContentSeedResult result)
    {
        ArgumentNullException.ThrowIfNull(result);

        return new EngineContentSeedResponseDto
        {
            ExerciseId = (result.ExerciseId ?? throw new InvalidOperationException(
                "A provisioned seed result must carry an exercise id.")).ToString(),
            Hostname = result.Hostname ?? throw new InvalidOperationException(
                "A provisioned seed result must carry a hostname."),
            PersonasCreated = result.PersonasCreated,
            PersonasReused = result.PersonasReused,
            StorylineId = (result.StorylineId ?? throw new InvalidOperationException(
                "A provisioned seed result must carry a storyline id.")).ToString(),
            StorylineTitle = result.StorylineTitle ?? string.Empty,
            ResponseWindowMinutes = result.ResponseWindowMinutes,
            Note = "The reaction loop was registered (or its registration replaced). The starter storyline is "
                + "in-memory and rebuilt fresh at scenario minute 0 on every seed, so a re-run resets any "
                + "intensity/phase progress accrued since the last seed; persona rows are reused, never "
                + "duplicated. Re-call this endpoint after a host restart (the in-memory registry is emptied).",
        };
    }
}
