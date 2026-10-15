namespace Pulse.WebApi.Features.WhiteNoise;

using System.Collections.Generic;
using System.Text.Json.Serialization;

/// <summary>
/// The white-noise state the console knob reads (frozen contract, <c>implementation.md</c> §Types, story 05). Staff
/// world only (XC-002): it goes to <c>GET/PUT /api/staff/noise</c> and the staff-group <c>NoiseStateChanged</c> push,
/// never to a participant.
/// </summary>
public sealed class NoiseStateDto
{
    /// <summary><c>off</c> | <c>low</c> | <c>medium</c> | <c>high</c>.</summary>
    [JsonPropertyName("level")]
    public required string Level { get; init; }

    /// <summary>0 / 2 / 6 / 15.</summary>
    [JsonPropertyName("ratePerMinute")]
    public required int RatePerMinute { get; init; }

    /// <summary>How many entries the pool holds.</summary>
    [JsonPropertyName("poolSize")]
    public required int PoolSize { get; init; }

    /// <summary>Total noise posts published in this exercise.</summary>
    [JsonPropertyName("postedCount")]
    public required int PostedCount { get; init; }

    /// <summary>Scenario time of the latest noise post (ISO-8601 round-trip); omitted before the first.</summary>
    [JsonPropertyName("lastPostedAt")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? LastPostedAt { get; init; }

    /// <summary>
    /// Whether noise is actually being released: <c>false</c> while the level is off, the pool is empty, the world is
    /// frozen, or the exercise clock is frozen or not running.
    /// </summary>
    [JsonPropertyName("running")]
    public required bool Running { get; init; }
}

/// <summary>The body of <c>PUT /api/staff/noise</c>. Nullable so a missing field is a validation 400.</summary>
public sealed class NoiseLevelRequest
{
    /// <summary>The level to set.</summary>
    [JsonPropertyName("level")]
    public string? Level { get; init; }
}

/// <summary>The body of <c>PUT /api/staff/noise/pool</c>.</summary>
public sealed class NoisePoolRequest
{
    /// <summary><c>replace</c> | <c>append</c>.</summary>
    [JsonPropertyName("mode")]
    public string? Mode { get; init; }

    /// <summary>The entries, at most <see cref="WhiteNoiseService.MaxPoolEntriesPerCall"/>.</summary>
    [JsonPropertyName("posts")]
    public IReadOnlyList<NoisePoolEntryRequest?>? Posts { get; init; }
}

/// <summary>One pool entry in <see cref="NoisePoolRequest"/>.</summary>
public sealed class NoisePoolEntryRequest
{
    /// <summary>The persona's handle (a leading <c>@</c> is ignored) or id, in this exercise.</summary>
    [JsonPropertyName("persona")]
    public string? Persona { get; init; }

    /// <summary>The post text; sanitized, then 1 to 280 characters.</summary>
    [JsonPropertyName("text")]
    public string? Text { get; init; }
}

/// <summary>The answer to <c>PUT /api/staff/noise/pool</c>.</summary>
public sealed class NoisePoolResultDto
{
    /// <summary>How many entries the pool holds after the call.</summary>
    [JsonPropertyName("poolSize")]
    public required int PoolSize { get; init; }

    /// <summary>The entries that were not applied, by request index.</summary>
    [JsonPropertyName("rejected")]
    public required IReadOnlyList<NoisePoolRejectionDto> Rejected { get; init; }
}

/// <summary>One refused pool entry.</summary>
public sealed class NoisePoolRejectionDto
{
    /// <summary>The entry's zero-based index in the request's <c>posts</c>.</summary>
    [JsonPropertyName("index")]
    public required int Index { get; init; }

    /// <summary>Why it was refused, in words.</summary>
    [JsonPropertyName("reason")]
    public required string Reason { get; init; }
}
