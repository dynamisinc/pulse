namespace Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;

using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Serialization;
using Pulse.WebApi.Features.ExerciseConfiguration.Readiness;

/// <summary>
/// The <c>409</c> body of a stage (build → staged) refused by the readiness gate (exercise-build-golive/04):
/// <c>{ "error": "readiness-blocking", "message": "...", "blocking": ReadinessItem[] }</c>. A STAFF-world shape
/// (XC-002) carrying only fixed labels and counts, never participant content.
/// </summary>
/// <remarks>
/// Distinct from the state machine's plain-string <c>409</c>, which is unchanged. <c>blocking</c> reuses
/// <see cref="ReadinessItemDto"/>, the exact item shape <c>GET /api/staff/readiness</c> returns, and holds only the
/// blocking items that are <c>open</c>.
/// </remarks>
public sealed class ReadinessBlockedResponse
{
    /// <summary>The stable machine-readable error code.</summary>
    public const string ErrorCode = "readiness-blocking";

    /// <summary>Always <see cref="ErrorCode"/>.</summary>
    [JsonPropertyName("error")]
    public required string Error { get; init; }

    /// <summary>A short human-readable sentence.</summary>
    [JsonPropertyName("message")]
    public required string Message { get; init; }

    /// <summary>The open blocking items, in the checklist's fixed order.</summary>
    [JsonPropertyName("blocking")]
    public required IReadOnlyList<ReadinessItemDto> Blocking { get; init; }

    /// <summary>Builds the body from the refusal.</summary>
    /// <param name="message">The short human-readable sentence.</param>
    /// <param name="openBlocking">The open blocking items.</param>
    /// <returns>The response body.</returns>
    public static ReadinessBlockedResponse From(string message, IReadOnlyList<ReadinessItem> openBlocking)
    {
        ArgumentNullException.ThrowIfNull(message);
        ArgumentNullException.ThrowIfNull(openBlocking);

        return new ReadinessBlockedResponse
        {
            Error = ErrorCode,
            Message = message,
            Blocking = openBlocking.Select(ReadinessItemDto.FromItem).ToList(),
        };
    }
}
