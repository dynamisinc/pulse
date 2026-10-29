namespace Pulse.WebApi.Features.EngineRuntime.Clock;

using System.Globalization;
using System.Text.Json.Serialization;

/// <summary>
/// The participant-safe scenario-clock state (fix/noise-new-posts-clock): the body of <c>GET /api/clock</c> and the
/// payload of the SignalR <c>ScenarioClockChanged</c> push. Mirrors the frontend <c>ScenarioClockState</c>
/// field-for-field. It carries scenario time and the server wall clock at the same read ONLY: no pause tier, no
/// acting human, no provenance (XC-002), so it is safe for every world.
/// </summary>
/// <remarks>
/// <see cref="ServerTime"/> is the server wall clock, published so a client can compute
/// <c>offset = scenarioTime - serverTime</c> and advance a running clock locally. It is not a participant-visible
/// timestamp: the client renders scenario time only (COR-053).
/// </remarks>
public sealed class ScenarioClockDto
{
    /// <summary>Whether the exercise's clock has been started (it is running or frozen).</summary>
    [JsonPropertyName("started")]
    public required bool Started { get; init; }

    /// <summary>Whether the exercise's clock is frozen (<see cref="IExerciseClock.IsFrozen"/>).</summary>
    [JsonPropertyName("frozen")]
    public required bool Frozen { get; init; }

    /// <summary>
    /// The current scenario instant as an ISO-8601 UTC round-trip string (<c>...Z</c>); <c>null</c> when the clock
    /// has not been started.
    /// </summary>
    [JsonPropertyName("scenarioTime")]
    public required string? ScenarioTime { get; init; }

    /// <summary>The server wall clock at the same read, as an ISO-8601 UTC round-trip string (<c>...Z</c>).</summary>
    [JsonPropertyName("serverTime")]
    public required string ServerTime { get; init; }

    /// <summary>
    /// Reads exercise <paramref name="exerciseId"/>'s clock state now. The scenario instant and the server wall
    /// clock are read back to back, so <c>scenarioTime - serverTime</c> is the clock's current offset.
    /// </summary>
    /// <param name="clock">The native exercise clock.</param>
    /// <param name="timeProvider">The server time source (the same one the clock advances against).</param>
    /// <param name="exerciseId">The server-resolved exercise (COR-001).</param>
    /// <returns>The clock state.</returns>
    public static ScenarioClockDto Read(IExerciseClock clock, TimeProvider timeProvider, Guid exerciseId)
    {
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(timeProvider);

        var scenarioTime = clock.CurrentScenarioTime(exerciseId);
        var serverTime = timeProvider.GetUtcNow();
        var frozen = scenarioTime is not null && clock.IsFrozen(exerciseId);

        return new ScenarioClockDto
        {
            Started = scenarioTime is not null,
            Frozen = frozen,
            ScenarioTime = scenarioTime is { } instant ? FormatUtc(instant) : null,
            ServerTime = FormatUtc(serverTime),
        };
    }

    /// <summary>Formats an instant as an ISO-8601 UTC round-trip string ending in <c>Z</c>.</summary>
    /// <param name="instant">The instant.</param>
    /// <returns>The formatted instant.</returns>
    internal static string FormatUtc(DateTimeOffset instant) =>
        instant.UtcDateTime.ToString("O", CultureInfo.InvariantCulture);
}

/// <summary>
/// The SignalR <c>ScenarioClockChanged</c> frame (fix/noise-new-posts-clock, contract §2 as amended by review W-001):
/// the <see cref="ScenarioClockDto"/> fields PLUS a flat <c>exerciseId</c>, the server-resolved exercise the frame is
/// about, so a client drops a frame for an exercise other than the one its sync is keyed on. Push-only:
/// <c>GET /api/clock</c> never carries the id.
/// </summary>
public sealed class ScenarioClockChangedDto
{
    /// <summary>The server-resolved exercise whose clock changed (COR-001), as a lowercase GUID.</summary>
    [JsonPropertyName("exerciseId")]
    public required string ExerciseId { get; init; }

    /// <inheritdoc cref="ScenarioClockDto.Started"/>
    [JsonPropertyName("started")]
    public required bool Started { get; init; }

    /// <inheritdoc cref="ScenarioClockDto.Frozen"/>
    [JsonPropertyName("frozen")]
    public required bool Frozen { get; init; }

    /// <inheritdoc cref="ScenarioClockDto.ScenarioTime"/>
    [JsonPropertyName("scenarioTime")]
    public required string? ScenarioTime { get; init; }

    /// <inheritdoc cref="ScenarioClockDto.ServerTime"/>
    [JsonPropertyName("serverTime")]
    public required string ServerTime { get; init; }

    /// <summary>Builds the frame for <paramref name="exerciseId"/> from a clock read.</summary>
    /// <param name="exerciseId">The server-resolved exercise.</param>
    /// <param name="clock">The clock state read for that exercise.</param>
    /// <returns>The push frame.</returns>
    public static ScenarioClockChangedDto From(Guid exerciseId, ScenarioClockDto clock)
    {
        ArgumentNullException.ThrowIfNull(clock);

        return new ScenarioClockChangedDto
        {
            ExerciseId = exerciseId.ToString("D", CultureInfo.InvariantCulture),
            Started = clock.Started,
            Frozen = clock.Frozen,
            ScenarioTime = clock.ScenarioTime,
            ServerTime = clock.ServerTime,
        };
    }
}
