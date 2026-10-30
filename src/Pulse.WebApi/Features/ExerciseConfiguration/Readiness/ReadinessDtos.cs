namespace Pulse.WebApi.Features.ExerciseConfiguration.Readiness;

using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Serialization;

/// <summary>
/// <c>GET /api/staff/readiness</c> response body: the resolved exercise's go-live checklist (ADMIN-IDENTITY-MODEL §5.3).
/// A STAFF-world shape (XC-002) carrying only counts and fixed labels, never participant content.
/// </summary>
/// <remarks>
/// Every property carries an explicit camelCase <see cref="JsonPropertyNameAttribute"/> so the wire shape is fixed
/// independent of host serializer config. This is a new contract, not a frozen shared type.
/// </remarks>
public sealed class ExerciseReadinessDto
{
    /// <summary>Whether no blocking item is <c>open</c>.</summary>
    [JsonPropertyName("ready")]
    public required bool Ready { get; init; }

    /// <summary>The canonical COR-032 lifecycle state of the resolved exercise.</summary>
    [JsonPropertyName("lifecycleState")]
    public required string LifecycleState { get; init; }

    /// <summary>The blocking items, in their fixed order.</summary>
    [JsonPropertyName("blocking")]
    public required IReadOnlyList<ReadinessItemDto> Blocking { get; init; }

    /// <summary>The warnings, in their fixed order.</summary>
    [JsonPropertyName("warnings")]
    public required IReadOnlyList<ReadinessItemDto> Warnings { get; init; }

    /// <summary>Projects the service's report onto the wire shape.</summary>
    /// <param name="report">The checklist.</param>
    /// <returns>The DTO.</returns>
    public static ExerciseReadinessDto FromReport(ExerciseReadinessReport report)
    {
        ArgumentNullException.ThrowIfNull(report);

        return new ExerciseReadinessDto
        {
            Ready = report.Ready,
            LifecycleState = report.LifecycleState,
            Blocking = report.Blocking.Select(ReadinessItemDto.FromItem).ToList(),
            Warnings = report.Warnings.Select(ReadinessItemDto.FromItem).ToList(),
        };
    }
}

/// <summary>One checklist item on the wire.</summary>
public sealed class ReadinessItemDto
{
    /// <summary>The stable kebab-case key.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The short staff-facing label.</summary>
    [JsonPropertyName("label")]
    public required string Label { get; init; }

    /// <summary><c>ok</c> | <c>open</c> | <c>notChecked</c>.</summary>
    [JsonPropertyName("status")]
    public required string Status { get; init; }

    /// <summary>A short sentence explaining an open or not-checked item; <c>null</c> when ok.</summary>
    [JsonPropertyName("detail")]
    public required string? Detail { get; init; }

    /// <summary>Projects one item.</summary>
    /// <param name="item">The item.</param>
    /// <returns>The DTO.</returns>
    public static ReadinessItemDto FromItem(ReadinessItem item)
    {
        ArgumentNullException.ThrowIfNull(item);

        return new ReadinessItemDto { Id = item.Id, Label = item.Label, Status = item.Status, Detail = item.Detail };
    }
}
