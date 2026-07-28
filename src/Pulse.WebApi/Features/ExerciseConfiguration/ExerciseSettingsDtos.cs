namespace Pulse.WebApi.Features.ExerciseConfiguration;

using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json.Serialization;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// One channel-catalog row as the staff settings editor sees it: the catalogued channel plus whether THIS
/// exercise has it enabled (COR-030). The catalog is closed — the editor may toggle <see cref="Enabled"/>,
/// it can never add a channel — so rendering the checkbox list from this array keeps the client from
/// inventing an id the strict server-side parser would reject with a 400.
/// </summary>
public sealed class ExerciseChannelOptionDto
{
    /// <summary>The channel id (the token a settings write sends back in <c>enabledChannels</c>).</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The channel's display label.</summary>
    [JsonPropertyName("label")]
    public required string Label { get; init; }

    /// <summary>Whether this exercise currently has the channel enabled (the EFFECTIVE value — see <see cref="ExerciseSettingsDto.Channels"/>).</summary>
    [JsonPropertyName("enabled")]
    public required bool Enabled { get; init; }
}

/// <summary>
/// <c>GET/PUT /api/staff/exercise-settings</c> response body — the COR-030 per-exercise settings of the
/// exercise the SERVER resolved for the caller. A staff-world shape (XC-002): it is only ever returned to an
/// authenticated staff caller assigned to that exercise, and it carries no participant content.
/// </summary>
/// <remarks>
/// <para>
/// <b>The exercise is never a parameter.</b> <see cref="ExerciseId"/> is echoed for display/query-keying
/// only — it is the scope the server already resolved, not something the client chose, and nothing in this
/// feature accepts an exercise id from a caller (COR-001).
/// </para>
/// <para>
/// A <c>null</c> optional field means "not configured": the participant projection keeps serving the shipped
/// Phase-1 constant for it. That is why the editor must show an empty box rather than pre-filling the
/// constant — writing the constant back would turn a fallback into stored configuration.
/// </para>
/// <para>
/// Every property carries an explicit camelCase <see cref="JsonPropertyNameAttribute"/> so the wire shape is
/// fixed independent of host serializer config, matching the house DTO style.
/// </para>
/// </remarks>
public sealed class ExerciseSettingsDto
{
    /// <summary>The server-resolved exercise's id (echo only — never an input).</summary>
    [JsonPropertyName("exerciseId")]
    public required string ExerciseId { get; init; }

    /// <summary>The staff-facing internal name of the run.</summary>
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    /// <summary>The participant-visible world name, or <c>null</c> when not configured.</summary>
    [JsonPropertyName("worldName")]
    public string? WorldName { get; init; }

    /// <summary>The participant-visible BCP-47 locale (e.g. <c>en-US</c>), or <c>null</c> when not configured.</summary>
    [JsonPropertyName("locale")]
    public string? Locale { get; init; }

    /// <summary>The exercise's single IANA time zone (XC-008) — always present.</summary>
    [JsonPropertyName("timeZone")]
    public required string TimeZone { get; init; }

    /// <summary>The scheduled window start as a round-trip (<c>O</c>) ISO-8601 instant, or <c>null</c> when unscheduled.</summary>
    [JsonPropertyName("scheduledStartAt")]
    public string? ScheduledStartAt { get; init; }

    /// <summary>The scheduled window end as a round-trip (<c>O</c>) ISO-8601 instant, or <c>null</c> when unscheduled.</summary>
    [JsonPropertyName("scheduledEndAt")]
    public string? ScheduledEndAt { get; init; }

    /// <summary>
    /// The full closed channel catalog with this exercise's EFFECTIVE enabled flags — i.e. the configured
    /// set, or the platform default (Social only) when the exercise has never configured one. Send the ids
    /// whose <see cref="ExerciseChannelOptionDto.Enabled"/> is <c>true</c> back in
    /// <see cref="UpdateExerciseSettingsRequest.EnabledChannels"/> to persist the selection.
    /// </summary>
    [JsonPropertyName("channels")]
    public required IReadOnlyList<ExerciseChannelOptionDto> Channels { get; init; }

    /// <summary>The participant-visible brand name, or <c>null</c> when not configured.</summary>
    [JsonPropertyName("brandName")]
    public string? BrandName { get; init; }

    /// <summary>The brand primary color as a CSS hex string, or <c>null</c> when not configured.</summary>
    [JsonPropertyName("brandPrimary")]
    public string? BrandPrimary { get; init; }

    /// <summary>The brand accent color as a CSS hex string, or <c>null</c> when not configured.</summary>
    [JsonPropertyName("brandAccent")]
    public string? BrandAccent { get; init; }

    /// <summary>The brand surface color as a CSS hex string, or <c>null</c> when not configured.</summary>
    [JsonPropertyName("brandSurface")]
    public string? BrandSurface { get; init; }

    /// <summary>The brand on-surface (foreground) color as a CSS hex string, or <c>null</c> when not configured.</summary>
    [JsonPropertyName("brandOnSurface")]
    public string? BrandOnSurface { get; init; }

    /// <summary>
    /// The per-outlet display names keyed by outlet/channel id (COR-030 theming). Always present; empty when
    /// not configured. Stored as an opaque JSON object the channel epics (E3–E6) read — no participant
    /// surface renders it yet, but the values are sanitized on write regardless (NFR-004).
    /// </summary>
    [JsonPropertyName("outletNames")]
    public required IReadOnlyDictionary<string, string> OutletNames { get; init; }

    /// <summary>
    /// Projects a persisted <see cref="Exercise"/> row onto the staff settings shape, resolving the effective
    /// channel catalog and deserializing the stored outlet-name blob.
    /// </summary>
    /// <param name="exercise">The exercise row the server resolved for the caller.</param>
    /// <returns>The settings response body.</returns>
    public static ExerciseSettingsDto FromExercise(Exercise exercise)
    {
        ArgumentNullException.ThrowIfNull(exercise);

        var enabled = ChannelCatalog.ParseStored(exercise.EnabledChannels) ?? ChannelCatalog.DefaultEnabledIds;

        return new ExerciseSettingsDto
        {
            ExerciseId = exercise.Id.ToString(),
            Name = exercise.Name,
            WorldName = exercise.WorldName,
            Locale = exercise.Locale,
            TimeZone = exercise.TimeZone,
            ScheduledStartAt = ToRoundTrip(exercise.ScheduledStartAt),
            ScheduledEndAt = ToRoundTrip(exercise.ScheduledEndAt),
            Channels = ChannelCatalog.All
                .Select(entry => new ExerciseChannelOptionDto
                {
                    Id = entry.Id,
                    Label = entry.Label,
                    Enabled = enabled.Contains(entry.Id),
                })
                .ToList(),
            BrandName = exercise.BrandName,
            BrandPrimary = exercise.BrandPrimary,
            BrandAccent = exercise.BrandAccent,
            BrandSurface = exercise.BrandSurface,
            BrandOnSurface = exercise.BrandOnSurface,
            OutletNames = OutletNameMap.Deserialize(exercise.OutletNamesJson),
        };
    }

    private static string? ToRoundTrip(DateTimeOffset? instant) =>
        instant?.ToString("O", CultureInfo.InvariantCulture);
}

/// <summary>
/// <c>PUT /api/staff/exercise-settings</c> request body — a FULL REPLACE of the COR-030 settings block for
/// the exercise the server resolved.
/// </summary>
/// <remarks>
/// <para>
/// <b>There is deliberately no exercise id on this body.</b> The target exercise comes only from the
/// server-resolved scope (<c>IExerciseContext</c> / the staff active-exercise selection), so a caller cannot
/// aim a settings write at another exercise even by trying — the cross-exercise write vector COR-001/XC-002
/// forbid is structurally absent, not merely ignored.
/// </para>
/// <para>
/// <b>Replace semantics.</b> <see cref="Name"/> and <see cref="TimeZone"/> are required (they back
/// non-nullable columns and the frozen <c>ExerciseScope</c> fields). Every other field is optional and
/// <c>null</c>/absent CLEARS it back to "not configured", so the participant projection returns to the
/// shipped Phase-1 constant. Send the whole block, not a patch.
/// </para>
/// <para>
/// Every scalar is nullable so a missing field is a validation concern (a clean 400 with a reason), never a
/// deserialization failure; the two schedule instants are strings for the same reason — a malformed date
/// yields the same 400 shape as any other invalid setting.
/// </para>
/// </remarks>
public sealed class UpdateExerciseSettingsRequest
{
    /// <summary>The staff-facing internal name. Required; sanitized and length-bounded on write.</summary>
    [JsonPropertyName("name")]
    public string? Name { get; init; }

    /// <summary>The participant-visible world name. Optional; <c>null</c> clears it. Sanitized (NFR-004).</summary>
    [JsonPropertyName("worldName")]
    public string? WorldName { get; init; }

    /// <summary>The participant-visible BCP-47 locale tag. Optional; <c>null</c> clears it.</summary>
    [JsonPropertyName("locale")]
    public string? Locale { get; init; }

    /// <summary>The exercise's IANA time zone (XC-008). Required; a non-IANA value is a 400.</summary>
    [JsonPropertyName("timeZone")]
    public string? TimeZone { get; init; }

    /// <summary>The scheduled window start as an ISO-8601 instant. Optional; <c>null</c> clears it.</summary>
    [JsonPropertyName("scheduledStartAt")]
    public string? ScheduledStartAt { get; init; }

    /// <summary>The scheduled window end as an ISO-8601 instant. Optional; <c>null</c> clears it. Must not precede the start.</summary>
    [JsonPropertyName("scheduledEndAt")]
    public string? ScheduledEndAt { get; init; }

    /// <summary>
    /// The channel ids to enable. Optional; <c>null</c>/absent clears the setting back to the platform
    /// default. An unknown id, or an empty list, is a 400 (see <see cref="ChannelCatalog.TryNormalize"/>).
    /// </summary>
    [JsonPropertyName("enabledChannels")]
    public IReadOnlyList<string>? EnabledChannels { get; init; }

    /// <summary>The participant-visible brand name. Optional; <c>null</c> clears it. Sanitized (NFR-004).</summary>
    [JsonPropertyName("brandName")]
    public string? BrandName { get; init; }

    /// <summary>The brand primary color as a CSS hex string (<c>#rgb</c> / <c>#rrggbb</c>). Optional; malformed is a 400.</summary>
    [JsonPropertyName("brandPrimary")]
    public string? BrandPrimary { get; init; }

    /// <summary>The brand accent color as a CSS hex string. Optional; malformed is a 400.</summary>
    [JsonPropertyName("brandAccent")]
    public string? BrandAccent { get; init; }

    /// <summary>The brand surface color as a CSS hex string. Optional; malformed is a 400.</summary>
    [JsonPropertyName("brandSurface")]
    public string? BrandSurface { get; init; }

    /// <summary>The brand on-surface color as a CSS hex string. Optional; malformed is a 400.</summary>
    [JsonPropertyName("brandOnSurface")]
    public string? BrandOnSurface { get; init; }

    /// <summary>
    /// Per-outlet display names keyed by outlet/channel id. Optional; <c>null</c>/absent clears them. Keys
    /// and values are sanitized and length-bounded (NFR-004); the map is stored as opaque JSON.
    /// </summary>
    [JsonPropertyName("outletNames")]
    public IReadOnlyDictionary<string, string>? OutletNames { get; init; }
}
