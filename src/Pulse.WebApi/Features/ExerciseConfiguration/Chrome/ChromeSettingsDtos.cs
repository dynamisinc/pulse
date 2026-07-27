namespace Pulse.WebApi.Features.ExerciseConfiguration.Chrome;

using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social;

/// <summary>
/// Ingest validation + normalization for the COR-031 compliance-chrome write — the chrome analogue of
/// <see cref="ExerciseSettingsFieldRules"/>, whose length-bounded, fail-closed-with-400 shape this mirrors and
/// whose colour rule it REUSES rather than restating.
/// </summary>
/// <remarks>
/// <para>
/// <b>NFR-004: strip, never entity-encode.</b> Banner text renders on EVERY participant channel, so it goes
/// through the SHIPPED <see cref="PostSanitizer"/> — the same function the post ingest path uses. Nothing here
/// hand-rolls a sanitizer and nothing reaches for <c>HtmlEncoder</c>: the render path is a React text node, so
/// entity-encoding server-side would ship a banner reading <c>UNCLASSIFIED &amp;#47;&amp;#47; EXERCISE</c> on
/// every channel. Stripping keeps the author's literal <c>/ &amp; ' "</c> while removing anything that could
/// parse as executable markup in a non-React consumer too.
/// </para>
/// <para>
/// <b>Bounds are the schema's bounds.</b> <see cref="MaxBannerTextLength"/> matches the
/// <c>ChromeTopText</c> / <c>ChromeBottomText</c> column width configured in
/// <c>PulseDbContext.OnModelCreating</c>, so a value that validates always fits and a write can never fail
/// late with a truncation error. Colours reuse <see cref="ExerciseSettingsFieldRules.TryNormalizeColor"/>,
/// which carries the same guarantee for the 32-char colour columns.
/// </para>
/// </remarks>
public static class ChromeFieldRules
{
    /// <summary>Maximum compliance-banner text length (matches the <c>ChromeTopText</c>/<c>ChromeBottomText</c> column width).</summary>
    public const int MaxBannerTextLength = 512;

    /// <summary>
    /// Trims, strips markup (NFR-004) and length-checks an OPTIONAL compliance-banner text. An absent/blank
    /// value CLEARS the setting (<c>null</c>), so the participant projection falls back to the shipped Phase-1
    /// banner copy; a value that is entirely markup is rejected rather than stored as a blank classification
    /// banner, which would be a marking that says nothing.
    /// </summary>
    /// <param name="raw">The raw banner text from the request body.</param>
    /// <param name="field">The wire field name, used in the failure message.</param>
    /// <param name="text">The sanitized banner text, or <c>null</c> to clear it.</param>
    /// <param name="error">A human-readable reason on failure.</param>
    /// <returns><c>true</c> when the banner text is valid or absent.</returns>
    public static bool TryNormalizeBannerText(
        string? raw,
        string field,
        out string? text,
        [NotNullWhen(false)] out string? error)
    {
        ArgumentNullException.ThrowIfNull(field);

        text = null;
        error = null;

        var trimmed = raw?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return true;
        }

        var sanitized = PostSanitizer.Sanitize(trimmed).Trim();
        if (sanitized.Length == 0)
        {
            error = $"{field} contained only markup, which is stripped on ingest — send a real value or omit the field.";
            return false;
        }

        if (sanitized.Length > MaxBannerTextLength)
        {
            error = $"{field} must be at most {MaxBannerTextLength} characters.";
            return false;
        }

        text = sanitized;
        return true;
    }
}

/// <summary>
/// <c>GET/PUT /api/staff/chrome-settings</c> response body — the COR-031 compliance-chrome configuration of
/// the exercise the SERVER resolved for the caller, plus the NFR-008 watermark switch the mutual guard is
/// evaluated against. A staff-world shape (XC-002): it is only ever returned to an authenticated staff caller
/// assigned to that exercise.
/// </summary>
/// <remarks>
/// <para>
/// <b>Not the participant shape.</b> The participant-facing chrome contract is the FROZEN
/// <c>ChromeConfigResponse</c> (<c>{ enabled, top{…}, bottom{…} }</c>) served by
/// <c>GET /api/chrome-config</c>; it is filled by <see cref="ChromeConfigProjection"/> and is never reshaped.
/// THIS type is the staff editor's own shape — flat, nullable, and carrying <c>watermarkEnabled</c>, which no
/// participant response may ever contain.
/// </para>
/// <para>
/// <b>The exercise is never a parameter.</b> <see cref="ExerciseId"/> is echoed for display/query-keying only
/// — it is the scope the server already resolved, not something the client chose (COR-001).
/// </para>
/// <para>
/// A <c>null</c> banner field means "not configured": the participant projection keeps serving the shipped
/// Phase-1 constant for it. The editor must therefore show an EMPTY box rather than pre-filling the constant —
/// writing the constant back would turn a fallback into stored configuration.
/// </para>
/// </remarks>
public sealed class ChromeSettingsDto
{
    /// <summary>The server-resolved exercise's id (echo only — never an input).</summary>
    [JsonPropertyName("exerciseId")]
    public required string ExerciseId { get; init; }

    /// <summary>Whether compliance chrome is on for this exercise (COR-031). Chrome-off is legal (D7-008).</summary>
    [JsonPropertyName("chromeEnabled")]
    public required bool ChromeEnabled { get; init; }

    /// <summary>Whether the in-content EXERCISE watermark is on (NFR-008). Never both off with chrome.</summary>
    [JsonPropertyName("watermarkEnabled")]
    public required bool WatermarkEnabled { get; init; }

    /// <summary>The top banner copy, or <c>null</c> when not configured (the shipped constant serves).</summary>
    [JsonPropertyName("topText")]
    public string? TopText { get; init; }

    /// <summary>The top banner foreground colour as a CSS hex string, or <c>null</c> when not configured.</summary>
    [JsonPropertyName("topFg")]
    public string? TopFg { get; init; }

    /// <summary>The top banner background colour as a CSS hex string, or <c>null</c> when not configured.</summary>
    [JsonPropertyName("topBg")]
    public string? TopBg { get; init; }

    /// <summary>The bottom banner copy, or <c>null</c> when not configured (the shipped constant serves).</summary>
    [JsonPropertyName("bottomText")]
    public string? BottomText { get; init; }

    /// <summary>The bottom banner foreground colour as a CSS hex string, or <c>null</c> when not configured.</summary>
    [JsonPropertyName("bottomFg")]
    public string? BottomFg { get; init; }

    /// <summary>The bottom banner background colour as a CSS hex string, or <c>null</c> when not configured.</summary>
    [JsonPropertyName("bottomBg")]
    public string? BottomBg { get; init; }

    /// <summary>Projects a persisted <see cref="Exercise"/> row onto the staff chrome-settings shape.</summary>
    /// <param name="exercise">The exercise row the server resolved for the caller.</param>
    /// <returns>The chrome-settings response body.</returns>
    public static ChromeSettingsDto FromExercise(Exercise exercise)
    {
        ArgumentNullException.ThrowIfNull(exercise);

        return new ChromeSettingsDto
        {
            ExerciseId = exercise.Id.ToString(),
            ChromeEnabled = exercise.ComplianceChromeEnabled,
            WatermarkEnabled = exercise.WatermarkEnabled,
            TopText = exercise.ChromeTopText,
            TopFg = exercise.ChromeTopFg,
            TopBg = exercise.ChromeTopBg,
            BottomText = exercise.ChromeBottomText,
            BottomFg = exercise.ChromeBottomFg,
            BottomBg = exercise.ChromeBottomBg,
        };
    }
}

/// <summary>
/// <c>PUT /api/staff/chrome-settings</c> request body — a FULL REPLACE of the COR-031 compliance-chrome block
/// (plus the NFR-008 watermark switch) for the exercise the server resolved.
/// </summary>
/// <remarks>
/// <para>
/// <b>There is deliberately no exercise id on this body.</b> The target comes only from the server-resolved
/// scope, so a caller cannot aim a chrome write at another exercise even by trying — the cross-exercise write
/// vector COR-001/XC-002 forbid is structurally absent, not merely ignored.
/// </para>
/// <para>
/// <b>Both switches travel together, on purpose.</b> <see cref="ChromeEnabled"/> and
/// <see cref="WatermarkEnabled"/> are the two halves of the NFR-008 invariant, so accepting them on one body
/// lets <see cref="ComplianceChromeGuard"/> evaluate the pair the caller actually wants BEFORE anything is
/// applied. Both are required (a missing one is a <c>400</c>, never a silent default) precisely because
/// defaulting a switch is how an exercise would quietly lose its last marking.
/// </para>
/// <para>
/// <b>Replace semantics.</b> Every banner field is optional and <c>null</c>/absent CLEARS it back to "not
/// configured", so the participant projection returns to the shipped Phase-1 constant. Send the whole block,
/// not a patch. Every scalar is nullable so a missing field is a validation concern (a clean 400 with a
/// reason), never a deserialization failure.
/// </para>
/// </remarks>
public sealed class UpdateChromeSettingsRequest
{
    /// <summary>Whether compliance chrome is on. REQUIRED; never both off with <see cref="WatermarkEnabled"/>.</summary>
    [JsonPropertyName("chromeEnabled")]
    public bool? ChromeEnabled { get; init; }

    /// <summary>Whether the in-content EXERCISE watermark is on. REQUIRED; never both off with <see cref="ChromeEnabled"/>.</summary>
    [JsonPropertyName("watermarkEnabled")]
    public bool? WatermarkEnabled { get; init; }

    /// <summary>The top banner copy. Optional; <c>null</c> clears it. Sanitized + length-bounded (NFR-004).</summary>
    [JsonPropertyName("topText")]
    public string? TopText { get; init; }

    /// <summary>The top banner foreground colour as a CSS hex string. Optional; malformed is a 400.</summary>
    [JsonPropertyName("topFg")]
    public string? TopFg { get; init; }

    /// <summary>The top banner background colour as a CSS hex string. Optional; malformed is a 400.</summary>
    [JsonPropertyName("topBg")]
    public string? TopBg { get; init; }

    /// <summary>The bottom banner copy. Optional; <c>null</c> clears it. Sanitized + length-bounded (NFR-004).</summary>
    [JsonPropertyName("bottomText")]
    public string? BottomText { get; init; }

    /// <summary>The bottom banner foreground colour as a CSS hex string. Optional; malformed is a 400.</summary>
    [JsonPropertyName("bottomFg")]
    public string? BottomFg { get; init; }

    /// <summary>The bottom banner background colour as a CSS hex string. Optional; malformed is a 400.</summary>
    [JsonPropertyName("bottomBg")]
    public string? BottomBg { get; init; }
}
