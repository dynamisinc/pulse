namespace Pulse.LoadTest;

using System.Text;

/// <summary>
/// The refusal rule (AC, PDF-D4): the harness never runs against the demo exercise. The target is what the API host
/// itself resolves (GET /api/exercise-context), never a value the operator typed, so a wrong host cannot slip through.
/// </summary>
internal static class TargetGuard
{
    /// <summary>Returns the reason to refuse, or <c>null</c> when the target is a load-test exercise that is not the demo.</summary>
    public static string? Check(string? targetExerciseId, string? targetName, string? demoExerciseId)
    {
        if (!Guid.TryParse(demoExerciseId, out var demo) || demo == Guid.Empty)
        {
            return "no demo exercise id is configured (demoExerciseId), so the harness cannot prove it is not targeting the demo.";
        }

        if (!Guid.TryParse(targetExerciseId, out var target) || target == Guid.Empty)
        {
            return "the API host did not resolve to an exercise (GET /api/exercise-context gave no exercise id).";
        }

        if (target == demo)
        {
            return $"the target exercise {target} IS the demo exercise. The harness never runs against it.";
        }

        var name = targetName?.Trim() ?? string.Empty;
        if (!name.StartsWith(LoadTestConfig.RequiredNamePrefix, StringComparison.Ordinal))
        {
            return $"the target exercise '{Printable(name)}' ({target}) is not named '{LoadTestConfig.RequiredNamePrefix} …'. "
                + "Only exercises made by New-LoadTestExercise.ps1 are targeted.";
        }

        return null;
    }

    /// <summary>Checks a joined session belongs to the target (a join token from another exercise must never be used).</summary>
    public static string? CheckSession(string? sessionExerciseId, Guid target) =>
        Guid.TryParse(sessionExerciseId, out var id) && id == target
            ? null
            : "a join returned a session for another exercise; the join-URL file does not belong to the target.";

    /// <summary>Server text made safe for the console (control and format characters dropped, cut to 80).</summary>
    public static string Printable(string? value)
    {
        var builder = new StringBuilder();
        foreach (var c in value ?? string.Empty)
        {
            var category = char.GetUnicodeCategory(c);
            if (category is System.Globalization.UnicodeCategory.Control or System.Globalization.UnicodeCategory.Format)
            {
                continue;
            }

            builder.Append(c);
            if (builder.Length >= 80)
            {
                builder.Append('…');
                break;
            }
        }

        return builder.ToString();
    }
}

/// <summary>
/// Paces joins under the server's limit: at most <c>perMinute</c> starts in any 60-second window AND an even spacing of
/// 60/perMinute seconds, so a fixed-window limiter on the server side can never see a burst at a window edge.
/// </summary>
internal sealed class JoinPacer
{
    private readonly int _perMinute;
    private readonly TimeSpan _spacing;
    private readonly Queue<DateTimeOffset> _recent = new();
    private DateTimeOffset? _last;

    public JoinPacer(int perMinute)
    {
        if (perMinute is < 1 or > LoadTestConfig.MaxJoinsPerMinute)
        {
            throw new ArgumentOutOfRangeException(nameof(perMinute), $"perMinute must be between 1 and {LoadTestConfig.MaxJoinsPerMinute}.");
        }

        _perMinute = perMinute;
        _spacing = TimeSpan.FromSeconds(60.0 / perMinute);
    }

    /// <summary>The even spacing between joins.</summary>
    public TimeSpan Spacing => _spacing;

    /// <summary>How long to wait at <paramref name="now"/> before the next join may start (zero: go now).</summary>
    public TimeSpan DelayUntilNext(DateTimeOffset now)
    {
        while (_recent.Count > 0 && now - _recent.Peek() >= TimeSpan.FromMinutes(1))
        {
            _recent.Dequeue();
        }

        var wait = TimeSpan.Zero;
        if (_last is { } last && now - last < _spacing)
        {
            wait = _spacing - (now - last);
        }

        if (_recent.Count >= _perMinute)
        {
            var windowWait = _recent.Peek() + TimeSpan.FromMinutes(1) - now;
            if (windowWait > wait)
            {
                wait = windowWait;
            }
        }

        return wait < TimeSpan.Zero ? TimeSpan.Zero : wait;
    }

    /// <summary>Records that a join started at <paramref name="at"/>.</summary>
    public void Record(DateTimeOffset at)
    {
        _recent.Enqueue(at);
        _last = at;
    }
}

/// <summary>
/// M1: stops the ramp after <c>limit</c> failed joins in a row (any non-2xx, a 429 included, or no answer). One success
/// resets the count. A UAT that collapses mid-ramp then stops the run by itself.
/// </summary>
internal sealed class JoinFailureGuard
{
    public const int DefaultLimit = 10;

    private readonly int _limit;
    private int _consecutive;

    public JoinFailureGuard(int limit)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(limit, 1);
        _limit = limit;
    }

    /// <summary>Records one join. Returns the stop reason when the limit is reached, else <c>null</c>.</summary>
    public string? Record(bool success)
    {
        _consecutive = success ? 0 : _consecutive + 1;
        return _consecutive >= _limit ? $"{_consecutive} joins failed in a row" : null;
    }
}

/// <summary>One participant row of the join-URL file.</summary>
internal sealed record JoinEntry(string Name, string SignInName, string Token);

/// <summary>
/// Reads the join-URL file Import-Roster.ps1 wrote (header name,signInName,joinUrl; every cell double-quoted; a cell
/// that began with = + - @ carries a leading '). The token is the last path segment after <c>/join/</c>. NPC rows
/// (name starting with the NPC prefix) are skipped: they exist only to author noise and controller posts.
/// </summary>
internal static partial class JoinUrlFile
{
    public static IReadOnlyList<JoinEntry> Parse(string content, string npcNamePrefix)
    {
        ArgumentNullException.ThrowIfNull(content);
        var lines = content.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n', StringSplitOptions.RemoveEmptyEntries);
        if (lines.Length == 0)
        {
            throw new FormatException("the join-URL file is empty.");
        }

        var header = ParseCsvLine(lines[0]).Select(h => h.Trim().ToLowerInvariant()).ToList();
        var nameIndex = header.IndexOf("name");
        var signInIndex = header.IndexOf("signinname");
        var urlIndex = header.IndexOf("joinurl");
        if (nameIndex < 0 || urlIndex < 0)
        {
            throw new FormatException("the join-URL file needs name and joinUrl columns (Import-Roster.ps1's format).");
        }

        var entries = new List<JoinEntry>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 1; i < lines.Length; i++)
        {
            var cells = ParseCsvLine(lines[i]);
            string Cell(int index) => index >= 0 && index < cells.Count ? Unformula(cells[index]) : string.Empty;
            var name = Cell(nameIndex);
            if (!string.IsNullOrEmpty(npcNamePrefix) && name.StartsWith(npcNamePrefix, StringComparison.Ordinal))
            {
                continue;
            }

            var url = Cell(urlIndex);
            if (string.IsNullOrWhiteSpace(url))
            {
                continue; // no usable link (revoked / needs reissue): Import-Roster leaves it blank
            }

            var token = TokenFrom(url) ?? throw new FormatException($"row {i + 1}: joinUrl is not a /join/<token> link.");
            if (seen.Add(token))
            {
                entries.Add(new JoinEntry(name, Cell(signInIndex), token));
            }
        }

        return entries;
    }

    /// <summary>The token of a join link (https://site/join/{token}), or <c>null</c>.</summary>
    public static string? TokenFrom(string joinUrl)
    {
        if (!Uri.TryCreate(joinUrl.Trim(), UriKind.Absolute, out var uri))
        {
            return null;
        }

        var segments = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length < 2 || !string.Equals(segments[^2], "join", StringComparison.Ordinal))
        {
            return null;
        }

        var token = Uri.UnescapeDataString(segments[^1]);
        return string.IsNullOrWhiteSpace(token) ? null : token;
    }

    /// <summary>Undoes Import-Roster.ps1's ConvertTo-FormulaSafeText: a ' it added before a formula-like cell.</summary>
    internal static string Unformula(string cell) =>
        cell.Length > 1 && cell[0] == '\'' && FormulaLike().IsMatch(cell[1..]) ? cell[1..] : cell;

    [System.Text.RegularExpressions.GeneratedRegex(@"^(?:[\t\r]|[\s\p{Cc}\p{Cf}]*[=+\-@])", System.Text.RegularExpressions.RegexOptions.CultureInvariant)]
    private static partial System.Text.RegularExpressions.Regex FormulaLike();

    internal static List<string> ParseCsvLine(string line)
    {
        var cells = new List<string>();
        var current = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < line.Length; i++)
        {
            var c = line[i];
            if (quoted)
            {
                if (c == '"' && i + 1 < line.Length && line[i + 1] == '"')
                {
                    current.Append('"');
                    i++;
                }
                else if (c == '"')
                {
                    quoted = false;
                }
                else
                {
                    current.Append(c);
                }
            }
            else if (c == '"')
            {
                quoted = true;
            }
            else if (c == ',')
            {
                cells.Add(current.ToString());
                current.Clear();
            }
            else
            {
                current.Append(c);
            }
        }

        cells.Add(current.ToString());
        return cells;
    }
}
