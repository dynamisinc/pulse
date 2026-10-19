namespace Pulse.WebApi.Tests.Data;

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using FluentAssertions;
using Pulse.WebApi.Data;
using Xunit;

/// <summary>
/// identity-auth-roles/21 (XC-010) — the MECHANICAL guard that makes "I forgot to exclude revoked enrollments"
/// impossible to ship silently. A revoked enrollment keeps its row (<c>Enrollment.DeletedAt</c>), and the exclusion is
/// the explicit, shared <see cref="ActiveEnrollments.Active"/> predicate rather than an EF global filter (which every
/// cross-exercise <c>IgnoreQueryFilters()</c> read would silently drop — see <see cref="ActiveEnrollments"/>). So every
/// read of <c>PulseDbContext.Enrollments</c> in the production source must carry <c>.Active()</c> in its expression
/// chain. Model-only (no host, no SQL): it runs on every machine and in every CI job.
/// </summary>
/// <remarks>
/// Same shape as <c>OrganizationScopeSweepTests</c> (and the same stated limits: a local alias of the DbSet, raw SQL or
/// <c>Set&lt;Enrollment&gt;()</c> would not be seen — <see cref="NoProductionCodeReachesEnrollmentsThroughSetOrRawSql"/>
/// covers the last two). Navigation reads through <c>Account.Enrollment</c> are covered by the database instead:
/// <c>CK_Enrollments_DeletedAt_StaffOnly</c> means an account's (participant-world) enrollment can never be revoked.
/// </remarks>
public sealed class ActiveEnrollmentSweepTests
{
    private const string Constraint = ".Active()";

    /// <summary>Writes, which need no read predicate (a revoked row is only ever reached by a read first).</summary>
    private static readonly string[] WriteOperations = [".Add(", ".AddRange(", ".Remove(", ".RemoveRange(", ".Update(", ".Attach("];

    /// <summary>
    /// A <c>.Enrollments</c> member access. The <c>Features.Identity.Enrollments</c> namespace (a fully qualified type such as
    /// <c>Pulse.WebApi.Features.Identity.Enrollments.StaffChangeActor</c>) is excluded: it names the namespace, not the DbSet.
    /// </summary>
    private static readonly Regex EnrollmentsRead = new(@"(?<!\bIdentity)\.Enrollments\b", RegexOptions.CultureInvariant);

    /// <summary>Where one read's own segment ends: the next <c>.Enrollments</c> or a query-syntax <c>join</c>.</summary>
    private static readonly Regex SegmentEnd = new(@"(?<!\bIdentity)\.Enrollments\b|\bjoin\b", RegexOptions.CultureInvariant);

    [Fact]
    public void EveryEnrollmentsRead_ExcludesRevokedRows_ThroughActive()
    {
        var sites = SweepCallSites();

        // Anti-vacuity: the sweep must actually be finding the reads (sign-in, switcher, role gate, lead gate, exports…).
        sites.Should().HaveCountGreaterThan(
            20, "a near-empty sweep means the regex or the source walk has rotted, and the guard would pass on anything");
        sites.Should().Contain(site => site.IsConstrained, "the pattern-rot anchor: the constrained form must be visible");

        var offenders = sites.Where(site => !site.IsConstrained).Select(site => $"{site.Location}: {site.Snippet}").ToList();
        offenders.Should().BeEmpty(
            "a revoked (soft-deleted, XC-010) enrollment must never grant anything: every read of PulseDbContext.Enrollments "
            + $"must include `{Constraint}` (Pulse.WebApi.Data.ActiveEnrollments) in its query chain. Offending site(s): "
            + string.Join(" | ", offenders));
    }

    [Theory]
    [InlineData("public Pulse.WebApi.Features.Identity.Enrollments.StaffChangeActor? Session { get; init; }", 0)]
    [InlineData("var x = new Pulse.WebApi.Features.Identity.Enrollments.EnrollmentService(db);", 0)]
    [InlineData("_dbContext.Enrollments.IgnoreQueryFilters().Active()", 1)]
    [InlineData("from e in dbContext.Enrollments.Active() join x in _db.Enrollments on a equals b", 2)]
    public void TheReadPattern_MatchesDbSetAccess_NotTheIdentityEnrollmentsNamespace(string code, int reads) =>
        EnrollmentsRead.Matches(code).Count.Should().Be(reads);

    [Theory]
    [InlineData(".IgnoreQueryFilters().Active().Where(x) join e in _db.Exercises on a equals b", true)]
    [InlineData(".IgnoreQueryFilters() join x in _db.Enrollments.Active() on a equals b", false)]
    [InlineData(".AsNoTracking().Any(e => _db.Enrollments.Active().Any())", false)]
    [InlineData(".Active() on a equals b select x", true)]
    public void TheOwnSegment_StopsAtTheNextReadOrJoin_SoAnotherReadsActiveCannotCoverThisOne(string chain, bool covered) =>
        OwnSegment(chain).Contains(Constraint, StringComparison.Ordinal).Should().Be(covered);

    [Fact]
    public void NoProductionCodeReachesEnrollmentsThroughSetOrRawSql()
    {
        var pattern = new Regex(@"\bSet\s*<\s*(?:[\w.]+\.)?Enrollment\s*>|\bFromSql(?:Raw|Interpolated)\b|\bSqlQuery(?:Raw)?\b", RegexOptions.CultureInvariant);
        var offenders = new List<string>();
        foreach (var (relativePath, lines) in ProductionSourceFiles())
        {
            if (relativePath.EndsWith("PulseDbContext.cs", StringComparison.OrdinalIgnoreCase))
            {
                continue; // the DbSet property itself is declared as Set<Enrollment>().
            }

            for (var i = 0; i < lines.Length; i++)
            {
                var code = StripLineComment(lines[i]);
                if (pattern.IsMatch(code))
                {
                    offenders.Add($"{relativePath}:{i + 1}: {code.Trim()}");
                }
            }
        }

        offenders.Should().BeEmpty(
            "reaching enrollments through Set<Enrollment>() or raw SQL bypasses this sweep, so a revoked row read there "
            + "would be invisible to every guard. Offending site(s): " + string.Join(" | ", offenders));
    }

    private static List<CallSite> SweepCallSites()
    {
        var sites = new List<CallSite>();
        foreach (var (relativePath, lines) in ProductionSourceFiles())
        {
            for (var i = 0; i < lines.Length; i++)
            {
                var code = StripLineComment(lines[i]);
                if (code.TrimStart().StartsWith("using ", StringComparison.Ordinal)
                    || code.TrimStart().StartsWith("namespace ", StringComparison.Ordinal))
                {
                    continue; // `using Pulse.WebApi.Features.Identity.Enrollments;` names the namespace, not the DbSet.
                }

                foreach (Match match in EnrollmentsRead.Matches(code))
                {
                    var chain = ReadExpressionChain(lines, i, match.Index + match.Length);
                    if (WriteOperations.Any(op => chain.StartsWith(op, StringComparison.Ordinal)))
                    {
                        continue;
                    }

                    sites.Add(new CallSite($"{relativePath}:{i + 1}", code.Trim(), OwnSegment(chain).Contains(Constraint, StringComparison.Ordinal)));
                }
            }
        }

        return sites;
    }

    /// <summary>
    /// The part of <paramref name="chain"/> that belongs to THIS <c>.Enrollments</c> read (Gate-1 S-004): up to the next
    /// <c>.Enrollments</c>, the next query-syntax <c>join</c>, or the statement's end (the chain already stops at
    /// <c>;</c>). So in one statement holding two reads, the second read's <c>.Active()</c> can never cover the first.
    /// </summary>
    internal static string OwnSegment(string chain)
    {
        ArgumentNullException.ThrowIfNull(chain);
        var end = SegmentEnd.Match(chain);
        return end.Success ? chain[..end.Index] : chain;
    }

    /// <summary>The rest of the statement after the DbSet name, across wrapped lines, up to its terminating <c>;</c>.</summary>
    private static string ReadExpressionChain(string[] lines, int startLine, int startColumn)
    {
        var chain = new StringBuilder();
        for (var i = startLine; i < lines.Length; i++)
        {
            var code = StripLineComment(lines[i]);
            var segment = i == startLine ? code[Math.Min(startColumn, code.Length)..] : code;
            var terminator = segment.IndexOf(';', StringComparison.Ordinal);
            if (terminator >= 0)
            {
                chain.Append(segment[..terminator]);
                break;
            }

            chain.Append(segment).Append(' ');
        }

        return chain.ToString().Trim();
    }

    private static List<(string RelativePath, string[] Lines)> ProductionSourceFiles()
    {
        var root = FindRepositoryRoot();
        var tree = Path.Combine(root, "src", "Pulse.WebApi");
        var files = Directory.EnumerateFiles(tree, "*.cs", SearchOption.AllDirectories)
            .Select(path => (RelativePath: Path.GetRelativePath(root, path), Path: path))
            .Where(file => !file.RelativePath.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                .Any(segment => segment is "obj" or "bin" or "Migrations"))
            .Select(file => (file.RelativePath, Lines: File.ReadAllLines(file.Path)))
            .ToList();

        files.Should().HaveCountGreaterThan(50, "the sweep found almost no production source, which would make it vacuous");
        return files;
    }

    private static string StripLineComment(string line)
    {
        var index = line.IndexOf("//", StringComparison.Ordinal);
        return index >= 0 ? line[..index] : line;
    }

    private static string FindRepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "pulse.slnx")))
            {
                return directory.FullName;
            }

            directory = directory.Parent;
        }

        throw new InvalidOperationException("Could not locate pulse.slnx: the active-enrollment sweep has no source to read.");
    }

    private sealed record CallSite(string Location, string Snippet, bool IsConstrained);
}
