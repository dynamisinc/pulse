namespace Pulse.WebApi.Features.Identity.Accounts;

using System.Collections.Generic;

/// <summary>
/// A minimal, dependency-free CSV parser for the bulk account import (story 02). It reads a header row (column
/// names matched case-insensitively) and yields one <see cref="RawAccountRow"/> per non-blank data line — the
/// raw, un-validated field strings; per-field validation is <see cref="AccountFieldRules"/>'s job at the service
/// layer. A pure function (no I/O, no DI) so it is unit-testable in isolation.
/// </summary>
/// <remarks>
/// <para>
/// <b>Supported shape.</b> Comma-separated fields with optional double-quote wrapping; inside a quoted field a
/// literal comma is preserved and <c>""</c> is an escaped quote. Required header columns: <c>username</c>,
/// <c>displayName</c>, <c>role</c>; optional: <c>password</c>. Rows are numbered 1-based over non-blank data
/// lines (the header is not counted). Deliberately line-oriented: a newline embedded inside a quoted field is
/// NOT supported (an account display name never contains one) — documented limitation, not a silent
/// mis-parse. Oversized input (too many rows) fails closed as a malformed result the endpoint maps to 400.
/// </para>
/// </remarks>
public static class AccountCsvParser
{
    /// <summary>The maximum number of data rows accepted in one import (a DoS / accidental-huge-file guard).</summary>
    public const int MaxRows = 5000;

    private const string UsernameHeader = "username";
    private const string DisplayNameHeader = "displayname";
    private const string RoleHeader = "role";
    private const string PasswordHeader = "password";

    /// <summary>Parses raw CSV text into a header-validated set of rows, or a malformed result with a reason.</summary>
    /// <param name="content">The raw CSV text (already size-bounded by the endpoint before this is called).</param>
    /// <returns>The parse result — <see cref="ParsedAccountCsv.IsValid"/> is <c>false</c> with an <see cref="ParsedAccountCsv.Error"/> when the header is missing/incomplete or the row cap is exceeded.</returns>
    public static ParsedAccountCsv Parse(string content)
    {
        ArgumentNullException.ThrowIfNull(content);

        var lines = SplitLines(content);

        // The first NON-blank line is the header.
        var headerIndex = -1;
        for (var i = 0; i < lines.Count; i++)
        {
            if (!string.IsNullOrWhiteSpace(lines[i]))
            {
                headerIndex = i;
                break;
            }
        }

        if (headerIndex < 0)
        {
            return ParsedAccountCsv.Malformed("the CSV is empty — a header row (username, displayName, role) is required.");
        }

        var headerFields = ParseLine(lines[headerIndex]);
        var columns = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < headerFields.Count; i++)
        {
            var name = headerFields[i].Trim();
            if (name.Length > 0 && !columns.ContainsKey(name))
            {
                columns[name] = i;
            }
        }

        if (!columns.TryGetValue(UsernameHeader, out var usernameCol) ||
            !columns.TryGetValue(DisplayNameHeader, out var displayNameCol) ||
            !columns.TryGetValue(RoleHeader, out var roleCol))
        {
            return ParsedAccountCsv.Malformed("the CSV header must include columns: username, displayName, role (password is optional).");
        }

        columns.TryGetValue(PasswordHeader, out var passwordCol);
        var hasPasswordColumn = columns.ContainsKey(PasswordHeader);

        var rows = new List<RawAccountRow>();
        var rowNumber = 0;
        for (var i = headerIndex + 1; i < lines.Count; i++)
        {
            if (string.IsNullOrWhiteSpace(lines[i]))
            {
                continue; // Skip blank lines entirely — they are not counted as rows.
            }

            rowNumber++;
            if (rowNumber > MaxRows)
            {
                return ParsedAccountCsv.Malformed($"the CSV exceeds the maximum of {MaxRows} data rows.");
            }

            var fields = ParseLine(lines[i]);
            rows.Add(new RawAccountRow(
                rowNumber,
                FieldAt(fields, usernameCol),
                FieldAt(fields, displayNameCol),
                FieldAt(fields, roleCol),
                hasPasswordColumn ? FieldAt(fields, passwordCol) : null));
        }

        return ParsedAccountCsv.Valid(rows);
    }

    /// <summary>Returns the field at <paramref name="index"/>, or <c>null</c> when the row has too few fields.</summary>
    private static string? FieldAt(List<string> fields, int index) =>
        index >= 0 && index < fields.Count ? fields[index] : null;

    /// <summary>Splits text into lines on <c>\n</c>, tolerating <c>\r\n</c> and lone <c>\r</c> endings.</summary>
    private static List<string> SplitLines(string content)
    {
        var normalized = content.Replace("\r\n", "\n", StringComparison.Ordinal)
                                .Replace('\r', '\n');
        return [.. normalized.Split('\n')];
    }

    /// <summary>Parses one CSV line into fields, honoring double-quote wrapping and <c>""</c> escapes.</summary>
    private static List<string> ParseLine(string line)
    {
        var fields = new List<string>();
        var current = new System.Text.StringBuilder();
        var inQuotes = false;

        for (var i = 0; i < line.Length; i++)
        {
            var c = line[i];
            if (inQuotes)
            {
                if (c == '"')
                {
                    if (i + 1 < line.Length && line[i + 1] == '"')
                    {
                        current.Append('"');
                        i++; // Consume the escaped quote.
                    }
                    else
                    {
                        inQuotes = false;
                    }
                }
                else
                {
                    current.Append(c);
                }
            }
            else if (c == '"')
            {
                inQuotes = true;
            }
            else if (c == ',')
            {
                fields.Add(current.ToString());
                current.Clear();
            }
            else
            {
                current.Append(c);
            }
        }

        fields.Add(current.ToString());
        return fields;
    }
}

/// <summary>One raw, un-validated CSV data row — the field strings exactly as parsed (whitespace preserved).</summary>
/// <param name="RowNumber">1-based data-row index (the header is not counted).</param>
/// <param name="Username">The raw username cell, or <c>null</c> when the row had too few fields.</param>
/// <param name="DisplayName">The raw display-name cell, or <c>null</c>.</param>
/// <param name="Role">The raw role cell, or <c>null</c>.</param>
/// <param name="Password">The raw password cell, or <c>null</c> when absent / no password column.</param>
public sealed record RawAccountRow(int RowNumber, string? Username, string? DisplayName, string? Role, string? Password);

/// <summary>The result of <see cref="AccountCsvParser.Parse"/>: either header-valid rows, or a malformed reason.</summary>
public sealed class ParsedAccountCsv
{
    private ParsedAccountCsv(bool isValid, string? error, IReadOnlyList<RawAccountRow> rows)
    {
        IsValid = isValid;
        Error = error;
        Rows = rows;
    }

    /// <summary>Whether the header was well-formed and the row cap was respected.</summary>
    public bool IsValid { get; }

    /// <summary>The malformed reason when <see cref="IsValid"/> is <c>false</c>; otherwise <c>null</c>.</summary>
    public string? Error { get; }

    /// <summary>The parsed data rows (empty for a header-only CSV).</summary>
    public IReadOnlyList<RawAccountRow> Rows { get; }

    /// <summary>A successful parse carrying the data rows.</summary>
    /// <param name="rows">The parsed rows.</param>
    /// <returns>A valid result.</returns>
    public static ParsedAccountCsv Valid(IReadOnlyList<RawAccountRow> rows) => new(true, null, rows);

    /// <summary>A malformed parse carrying the reason (the endpoint maps it to 400).</summary>
    /// <param name="error">The human-readable reason.</param>
    /// <returns>A malformed result.</returns>
    public static ParsedAccountCsv Malformed(string error) => new(false, error, []);
}
