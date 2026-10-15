namespace Pulse.WebApi.Features.Injects.Import;

using System.Collections.Generic;
using System.Text.Json.Serialization;

/// <summary>
/// The <c>POST /api/injects/import</c> response — the frozen <c>InjectImportResultDto</c> (demo-feedback story 03): the
/// per-row report of a Cadence MSEL import, identical for a dry run and a real one.
/// </summary>
/// <remarks>
/// <b>STAFF-ONLY (XC-002).</b> Served only behind the staff cockpit gate and the controller-role gate; it names personas
/// and run-sheet titles, never anything a participant sees.
/// </remarks>
public sealed class InjectImportResultDto
{
    /// <summary>Whether this was a dry run (nothing written).</summary>
    [JsonPropertyName("dryRun")]
    public required bool DryRun { get; init; }

    /// <summary>The non-blank data rows in the file (the header is not counted).</summary>
    [JsonPropertyName("totalRows")]
    public required int TotalRows { get; init; }

    /// <summary>The rows whose <c>Delivery Method</c> is social (DF-9) — the import candidates.</summary>
    [JsonPropertyName("socialRows")]
    public required int SocialRows { get; init; }

    /// <summary>Rows that created (or, in a dry run, would create) a run-sheet item.</summary>
    [JsonPropertyName("createdCount")]
    public required int CreatedCount { get; init; }

    /// <summary>Rows that updated (or would update) an unfired item imported earlier.</summary>
    [JsonPropertyName("updatedCount")]
    public required int UpdatedCount { get; init; }

    /// <summary>Rows whose item already matches the file, or has already fired.</summary>
    [JsonPropertyName("unchangedCount")]
    public required int UnchangedCount { get; init; }

    /// <summary>Rows that are not social-media injects.</summary>
    [JsonPropertyName("skippedCount")]
    public required int SkippedCount { get; init; }

    /// <summary>Social rows that could not be imported (nothing written for them).</summary>
    [JsonPropertyName("failedCount")]
    public required int FailedCount { get; init; }

    /// <summary>One entry per non-blank data row, in file order.</summary>
    [JsonPropertyName("rows")]
    public required IReadOnlyList<InjectImportRowDto> Rows { get; init; }

    /// <summary>Builds the result from the row reports, counting each status.</summary>
    /// <param name="dryRun">Whether this was a dry run.</param>
    /// <param name="socialRows">How many rows were social candidates.</param>
    /// <param name="rows">The row reports, in file order.</param>
    /// <returns>The result DTO.</returns>
    public static InjectImportResultDto From(bool dryRun, int socialRows, IReadOnlyList<InjectImportRowDto> rows)
    {
        ArgumentNullException.ThrowIfNull(rows);

        return new InjectImportResultDto
        {
            DryRun = dryRun,
            TotalRows = rows.Count,
            SocialRows = socialRows,
            CreatedCount = rows.Count(row => row.Status == InjectImportRowStatuses.Created),
            UpdatedCount = rows.Count(row => row.Status == InjectImportRowStatuses.Updated),
            UnchangedCount = rows.Count(row => row.Status == InjectImportRowStatuses.Unchanged),
            SkippedCount = rows.Count(row => row.Status == InjectImportRowStatuses.Skipped),
            FailedCount = rows.Count(row => row.Status == InjectImportRowStatuses.Failed),
            Rows = rows,
        };
    }
}

/// <summary>One row of an <see cref="InjectImportResultDto"/> — the frozen <c>InjectImportRowDto</c>. Null members are omitted.</summary>
public sealed class InjectImportRowDto
{
    /// <summary>
    /// The row's number as the spreadsheet shows it (the header is row 1 when it is the first line), so a controller can
    /// find it in Excel. For a CSV, every record counts, blank ones included, as Excel numbers them on opening the file.
    /// </summary>
    [JsonPropertyName("rowNumber")]
    public required int RowNumber { get; init; }

    /// <summary>The MSEL <c>Inject #</c>, when the cell has one.</summary>
    [JsonPropertyName("injectNumber")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? InjectNumber { get; init; }

    /// <summary>The run-sheet title the row maps to (sanitized), when there is one.</summary>
    [JsonPropertyName("title")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Title { get; init; }

    /// <summary>The persona's handle when it resolved, else the <c>From / Source</c> cell as read (sanitized).</summary>
    [JsonPropertyName("personaHandle")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? PersonaHandle { get; init; }

    /// <summary>The planned minute (DF-11), when the row has one.</summary>
    [JsonPropertyName("plannedMinute")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? PlannedMinute { get; init; }

    /// <summary>One of <see cref="InjectImportRowStatuses"/>.</summary>
    [JsonPropertyName("status")]
    public required string Status { get; init; }

    /// <summary>The reason for <c>skipped</c>/<c>failed</c>; warnings or what changed for the rest.</summary>
    [JsonPropertyName("message")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Message { get; init; }
}

/// <summary>The <see cref="InjectImportRowDto.Status"/> wire literals.</summary>
public static class InjectImportRowStatuses
{
    /// <summary>A new run-sheet item.</summary>
    public const string Created = "created";

    /// <summary>An unfired item imported earlier, changed to match the file.</summary>
    public const string Updated = "updated";

    /// <summary>An item that already matches the file, or that has fired and is left alone.</summary>
    public const string Unchanged = "unchanged";

    /// <summary>Not a social-media inject.</summary>
    public const string Skipped = "skipped";

    /// <summary>A social row that could not be imported.</summary>
    public const string Failed = "failed";
}
