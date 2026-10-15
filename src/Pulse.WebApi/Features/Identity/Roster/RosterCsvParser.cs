namespace Pulse.WebApi.Features.Identity.Roster;

using Pulse.WebApi.Features.Identity.Accounts;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// Parses a roster CSV (the frozen "Roster CSV" section of <c>docs/features/easy-login/implementation.md</c>) into one
/// raw <see cref="RosterRowWrite"/> per data row. A pure function (no I/O, no DI); per-field sanitizing and validation
/// are <see cref="RosterRowRules"/>'s job, so a CSV row and a <c>POST /api/staff/roster</c> body are judged by the same
/// code.
/// </summary>
/// <remarks>
/// <para>
/// <b>Shape.</b> Comma-separated, optional double-quote wrapping (a quoted comma is kept, <c>""</c> is a quote), one
/// header row whose names are matched case-insensitively. A leading BOM is tolerated, unknown columns are ignored, and
/// blank lines (including a line of nothing but commas, which spreadsheet exports leave behind) are skipped and not
/// counted. Rows are numbered 1-based over the data rows that remain (the header is not counted). The line splitting
/// and field parsing are the legacy account import's own (<see cref="AccountCsvParser"/>), so the two imports read a
/// file identically; like it, a newline inside a quoted field is not supported (a person's name has none).
/// </para>
/// <para>
/// <b>Columns.</b> <c>name</c> (required; alias <c>displayName</c>), <c>agency</c>, <c>role</c> (a free-text job
/// label, EL-1), <c>email</c>, <c>personaHandle</c> (alias <c>persona</c>), <c>signInName</c> (alias <c>username</c>).
/// When a column appears twice (say <c>name</c> and <c>displayName</c>) the first one wins.
/// </para>
/// <para>
/// <b>Fails closed</b> (the endpoint answers 400 and nothing is written): no header row, a header without a
/// <c>name</c> column, or more than <see cref="MaxRows"/> data rows. A header-only file is a valid, empty import.
/// </para>
/// </remarks>
public static class RosterCsvParser
{
    /// <summary>The most data rows one import may carry (the frozen contract's 5000).</summary>
    public const int MaxRows = 5000;

    /// <summary>The reason given for a file with no header row.</summary>
    public const string NoHeaderError = "the CSV has no header row.";

    /// <summary>The reason given for a header without a name column.</summary>
    public const string NoNameColumnError = "the CSV header must include a \"name\" column (or its alias \"displayName\").";

    private const char ByteOrderMark = '﻿';

    /// <summary>Header names (lower-case) to the field they fill.</summary>
    private static readonly Dictionary<string, RosterColumn> HeaderAliases = new(StringComparer.Ordinal)
    {
        ["name"] = RosterColumn.Name,
        ["displayname"] = RosterColumn.Name,
        ["agency"] = RosterColumn.Agency,
        ["role"] = RosterColumn.Role,
        ["email"] = RosterColumn.Email,
        ["personahandle"] = RosterColumn.PersonaHandle,
        ["persona"] = RosterColumn.PersonaHandle,
        ["signinname"] = RosterColumn.SignInName,
        ["username"] = RosterColumn.SignInName,
    };

    private enum RosterColumn
    {
        Name,
        Agency,
        Role,
        Email,
        PersonaHandle,
        SignInName,
    }

    /// <summary>Parses raw CSV text (already size-bounded by the endpoint).</summary>
    /// <param name="content">The decoded file text.</param>
    /// <returns>The data rows, or a malformed result with a readable reason.</returns>
    public static ParsedRosterCsv Parse(string content)
    {
        ArgumentNullException.ThrowIfNull(content);

        var lines = AccountCsvParser.SplitLines(content.TrimStart(ByteOrderMark));

        Dictionary<RosterColumn, int>? columns = null;
        var rows = new List<RosterCsvRow>();

        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            var fields = AccountCsvParser.ParseLine(line);
            if (fields.TrueForAll(string.IsNullOrWhiteSpace))
            {
                continue; // ",,,," is a blank row too.
            }

            if (columns is null)
            {
                columns = ReadHeader(fields);
                if (!columns.ContainsKey(RosterColumn.Name))
                {
                    return ParsedRosterCsv.Malformed(NoNameColumnError);
                }

                continue;
            }

            if (rows.Count == MaxRows)
            {
                return ParsedRosterCsv.Malformed($"the CSV exceeds the maximum of {MaxRows} data rows.");
            }

            rows.Add(new RosterCsvRow(
                rows.Count + 1,
                new RosterRowWrite
                {
                    Name = FieldAt(fields, columns, RosterColumn.Name),
                    Agency = FieldAt(fields, columns, RosterColumn.Agency),
                    Role = FieldAt(fields, columns, RosterColumn.Role),
                    Email = FieldAt(fields, columns, RosterColumn.Email),
                    PersonaHandle = FieldAt(fields, columns, RosterColumn.PersonaHandle),
                    SignInName = FieldAt(fields, columns, RosterColumn.SignInName),
                }));
        }

        return columns is null ? ParsedRosterCsv.Malformed(NoHeaderError) : ParsedRosterCsv.Valid(rows);
    }

    private static Dictionary<RosterColumn, int> ReadHeader(List<string> fields)
    {
        var columns = new Dictionary<RosterColumn, int>();
        for (var i = 0; i < fields.Count; i++)
        {
            var header = fields[i].Trim().TrimStart(ByteOrderMark).Trim().ToLowerInvariant();
            if (HeaderAliases.TryGetValue(header, out var column))
            {
                columns.TryAdd(column, i);
            }
        }

        return columns;
    }

    /// <summary>The cell for <paramref name="column"/>, or <c>null</c> when the file has no such column or the row is short.</summary>
    private static string? FieldAt(List<string> fields, Dictionary<RosterColumn, int> columns, RosterColumn column) =>
        columns.TryGetValue(column, out var index) && index < fields.Count ? fields[index] : null;
}

/// <summary>One data row of a roster CSV, exactly as read: the raw cells, before any sanitizing or validation.</summary>
/// <param name="RowNumber">1-based data-row number (blank rows and the header are not counted).</param>
/// <param name="Fields">The row's cells, in the shape of a <c>POST /api/staff/roster</c> body.</param>
public sealed record RosterCsvRow(int RowNumber, RosterRowWrite Fields);

/// <summary>The result of <see cref="RosterCsvParser.Parse"/>: the data rows, or a malformed reason.</summary>
public sealed class ParsedRosterCsv
{
    private ParsedRosterCsv(string? error, IReadOnlyList<RosterCsvRow> rows)
    {
        Error = error;
        Rows = rows;
    }

    /// <summary>Whether the file had a usable header and stayed within the row cap.</summary>
    public bool IsValid => Error is null;

    /// <summary>The readable reason the file was refused, or <c>null</c> when it is valid.</summary>
    public string? Error { get; }

    /// <summary>The data rows (empty for a header-only file, or when malformed).</summary>
    public IReadOnlyList<RosterCsvRow> Rows { get; }

    /// <summary>A parsed file.</summary>
    /// <param name="rows">The data rows.</param>
    /// <returns>A valid result.</returns>
    public static ParsedRosterCsv Valid(IReadOnlyList<RosterCsvRow> rows) => new(null, rows);

    /// <summary>A refused file.</summary>
    /// <param name="error">The readable reason.</param>
    /// <returns>A malformed result.</returns>
    public static ParsedRosterCsv Malformed(string error) => new(error, []);
}
