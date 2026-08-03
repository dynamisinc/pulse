namespace Pulse.WebApi.Tests.Data;

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Xunit;

/// <summary>
/// exercise-isolation/11 — the MECHANICAL guard that makes "I forgot the tenant bound" impossible to ship
/// silently. The customer-tenant axis is enforced two ways, and only one of them is central:
/// <list type="bullet">
///   <item><description><b>Central, unforgettable</b> — <see cref="IOrganizationScoped"/> entities
///   (<c>PersonaTemplate</c>) get a <see cref="PulseDbContext"/> global query filter applied by reflection
///   over the model. Nobody can forget it, and <c>QueryFilterModelTests</c> proves nobody has.</description></item>
///   <item><description><b>Opt-in, forgettable</b> — the RESOLUTION ROOTS (<c>Exercise</c>, <c>StaffUser</c>)
///   carry <see cref="IOrganizationOwned"/> WITHOUT a global filter, because filtering the rows that answer
///   "which tenant is this?" by "which tenant is this?" is a deadlock (see
///   <see cref="IOrganizationScoped"/>'s remarks). Their bound is the explicit, fail-closed
///   <see cref="OrganizationScope.InOrganization{TEntity}"/>. Which means a future author writing
///   <c>_dbContext.Exercises.Where(...)</c> and forgetting it gets a silent CROSS-CUSTOMER read and no
///   failing test — exactly the class of defect story 11 exists to prevent.</description></item>
/// </list>
/// <b>This sweep closes that second gap.</b> Every read of an unfiltered org-owned DbSet in the production
/// source must either be constrained with <c>.InOrganization(</c> or carry an explicit, reasoned exemption
/// marker at the call site. A new unconstrained, unmarked query fails this test loudly.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why a source sweep and not a repository/gateway type.</b> The three candidate mechanisms were: (a) hide
/// the raw <c>DbSet</c> behind a query-gateway so the unconstrained form is unreachable, (b) a Roslyn
/// analyzer, (c) this sweep. (a) is the strongest but would rewrite ~30 call sites across nine feature slices
/// that this story has no other reason to touch — a scope explosion, and one that would collide with the
/// wave's file-disjointness. (b) needs a new analyzer project + packaging for a two-entity surface. (c) has
/// the same shape as the existing, accepted architecture guard
/// <c>GenerationProviderInjectionArchitectureTests</c>, costs one test file, and — critically — its failure
/// message lands in the offending author's own test run.
/// </para>
/// <para>
/// <b>Why a marker COMMENT and not a central allow-list.</b> The safety of an unconstrained read depends
/// entirely on the PROVENANCE of the id it filters by, which is invisible to any pattern: the SAME shape
/// (<c>Exercises.FirstOrDefaultAsync(e =&gt; e.Id == exerciseId)</c>) is safe when <c>exerciseId</c> came from
/// <c>IExerciseContext</c> and is a cross-tenant hole when it came from a request body — and Pulse contains
/// both. So the exemption must be a human attestation of provenance, and it belongs at the call site where
/// the reviewer reads the code, not in a distant list keyed by line numbers that drift.
/// </para>
/// <para>
/// <b>What this does NOT cover</b>, stated rather than papered over: a query built through a local alias
/// (<c>var q = db.Exercises; ... q.Where(...)</c>), raw SQL (<c>FromSqlRaw</c>), or <c>Set&lt;Exercise&gt;()</c>
/// instead of the DbSet property. <see cref="NoProductionCodeReachesAnOrgOwnedEntityThroughSetOrRawSql"/>
/// closes the second and third; the local-alias form is not used anywhere in the tree today and would be
/// caught by review. Model-only (no host, no SQL), so it runs on every machine and in every CI job.
/// </para>
/// </remarks>
public sealed class OrganizationScopeSweepTests
{
    /// <summary>
    /// The vocabulary of accepted exemption reasons. Each names a PROVENANCE that makes an unconstrained read
    /// safe; an author must pick one and justify it in prose. A reason not on this list is rejected, so the
    /// marker cannot degrade into "// it's fine".
    /// </summary>
    private static readonly IReadOnlyDictionary<string, string> ExemptionReasons = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["ResolvedScope"] =
            "the id is the SERVER-resolved exercise scope (IExerciseContext, or a server-issued Session's "
            + "bound ExerciseId). An exercise belongs to exactly one organization, so a caller already "
            + "confined to that exercise is already confined to its tenant.",
        ["ResolutionRoot"] =
            "this read IS the resolution — a host header to an exercise, an IdP subject to a staff human — "
            + "performed BEFORE any tenant is known. A tenant bound here is a deadlock, not a guard.",
        ["OwnIdentity"] =
            "the read is of the CALLER'S OWN row, by the id their server-issued session carries. It is how "
            + "the caller's tenant gets resolved in the first place and cannot reach another tenant's row.",
        ["TenantChecked"] =
            "the query is deliberately unbounded, but an EXPLICIT OrganizationId comparison in the same "
            + "method refuses a cross-tenant row before anything is returned, persisted or disclosed.",
        ["TenantRoot"] =
            "the read is of the TENANT ROOT table itself (Organization), by a FIXED well-known id — there is "
            + "no outer scope to bound it by, because this table IS the outermost scope. Only a by-known-id "
            + "lookup qualifies: ENUMERATING the customer roster is precisely what must never be unmarked.",
    };

    /// <summary>The marker an exempt call site must carry, e.g. <c>// org-scope-exempt(ResolvedScope): ...</c>.</summary>
    private static readonly Regex ExemptionMarker = new(
        @"//.*\borg-scope-exempt\(\s*(?<reason>\w+)\s*\)\s*:\s*(?<justification>\S.*)$",
        RegexOptions.CultureInvariant);

    /// <summary>Matches a line that is nothing but a <c>//</c> comment (leading whitespace allowed).</summary>
    private static readonly Regex CommentOnlyLine = new(@"^\s*//", RegexOptions.CultureInvariant);

    /// <summary>The constraint that satisfies the sweep outright.</summary>
    private const string Constraint = ".InOrganization(";

    /// <summary>
    /// Write operations. These are covered by the CENTRAL write-time guard
    /// (<c>PulseDbContext.GuardOrganizationScope</c>), which refuses any added/modified
    /// <see cref="IOrganizationOwned"/> row carrying an empty <c>OrganizationId</c> — so they need no
    /// per-call-site constraint and are not swept.
    /// </summary>
    private static readonly string[] WriteOperations =
        [".Add(", ".AddRange(", ".Remove(", ".RemoveRange(", ".Update(", ".UpdateRange(", ".Attach("];

    /// <summary>
    /// The EXPECTED exemption inventory — a deliberate ratchet, not bookkeeping. Every entry here is a read
    /// that reaches an unfiltered org-owned table without a tenant bound; the count is pinned so that ADDING
    /// one cannot happen without editing this test, which puts the tenant decision in front of a reviewer
    /// even if they only skim the feature diff. Bump a number only together with the reasoned marker at the
    /// new call site.
    /// </summary>
    private static readonly IReadOnlyDictionary<string, int> ExpectedExemptionCounts = new Dictionary<string, int>(StringComparer.Ordinal)
    {
        ["ResolvedScope"] = 20,

        // orgAdmin startup seeder: +1 for OrgAdminSeedService, which resolves the seeded staff human by their
        // configured IdP ExternalSubject — the SAME resolve-by-subject read StaffLoginService and
        // BootstrapService already claim this reason for, and for the same reason: that row is what CARRIES
        // the OrganizationId every later read in the method is bounded by, so it cannot itself be
        // tenant-bounded. (The seeder's other two reads — the org's exercises and the org's staff humans — do
        // carry .InOrganization(...) and are therefore not exemptions at all.)
        ["ResolutionRoot"] = 8,

        // exercise-lifecycle-admin: +1 for OrganizationResolutionMiddleware, the production writer of
        // IOrganizationContext. It reads the authenticated caller's OWN StaffUser row (by the id their
        // server-issued session carries on the principal) in order to DISCOVER their tenant — the one read
        // that cannot be tenant-bound without a chicken-and-egg deadlock, and the same provenance the two
        // StaffAssignmentService sites already claim.
        ["OwnIdentity"] = 3,

        ["TenantChecked"] = 2,

        // exercise-lifecycle-admin (review finding WR-008): the tenant ROOT table joined the swept set, so
        // its one existing reader — BootstrapService.ResolveDefaultOrganizationAsync, a lookup by the FIXED
        // Organization.DefaultOrganizationId — now needs a marker. A count going above 1 means somebody
        // added a second unbounded read of the customer roster: check that it is still a by-known-id lookup
        // and not an enumeration before bumping this.
        ["TenantRoot"] = 1,
    };

    [Fact]
    public void EveryUnfilteredOrgOwnedRead_IsEitherTenantBoundedOrExplicitlyExempted()
    {
        var sites = SweepCallSites();

        // Anti-vacuity: a sweep that found nothing would pass on any source at all.
        sites.Should().HaveCountGreaterThan(
            20, "the sweep must actually be finding the org-owned reads — a near-empty result means the "
            + "DbSet-name reflection or the regex has rotted, and the guard would pass on a leaking tree");

        sites.Should().Contain(
            site => site.IsConstrained,
            "at least one call site must satisfy the sweep via {0} — that is the pattern-rot anchor: if the "
            + "extraction can no longer SEE the constrained form, 'everything is exempt' would look clean",
            Constraint);

        var offenders = sites
            .Where(site => !site.IsConstrained && site.ExemptionReason is null)
            .Select(site => $"{site.Location}: {site.Snippet}")
            .ToList();

        offenders.Should().BeEmpty(
            "a read of an org-owned entity that carries NO global query filter (Exercise / StaffUser are the "
            + "resolution roots — see IOrganizationScoped) is a CROSS-CUSTOMER read unless it is bounded. "
            + $"Either constrain it with `{Constraint}serverResolvedOrganizationId)` — which fails closed to "
            + "zero rows on an unresolved tenant — or, if the id's provenance already confines it, mark the "
            + "call site with `// org-scope-exempt(<Reason>): <why>` where <Reason> is one of ["
            + string.Join(", ", ExemptionReasons.Keys)
            + "] AND bump ExpectedExemptionCounts in this test. Unconstrained, unmarked site(s): "
            + string.Join(" | ", offenders));

        var badReasons = sites
            .Where(site => site.ExemptionReason is not null && !ExemptionReasons.ContainsKey(site.ExemptionReason))
            .Select(site => $"{site.Location}: org-scope-exempt({site.ExemptionReason})")
            .ToList();

        badReasons.Should().BeEmpty(
            "an exemption must name a reason from the fixed vocabulary ["
            + string.Join(", ", ExemptionReasons.Keys)
            + "], so the marker cannot degrade into an unreviewable '// it's fine'. Offending marker(s): "
            + string.Join(" | ", badReasons));
    }

    [Fact]
    public void TheExemptionInventory_IsPinned_SoANewUnboundedReadCannotSlipInSilently()
    {
        var actual = SweepCallSites()
            .Where(site => site.ExemptionReason is not null)
            .GroupBy(site => site.ExemptionReason!, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.Count(), StringComparer.Ordinal);

        actual.Should().BeEquivalentTo(
            ExpectedExemptionCounts,
            "the set of reads that reach an unfiltered org-owned table WITHOUT a tenant bound is a pinned, "
            + "reviewed inventory. A count going UP means a new unbounded read landed — re-read its marker "
            + "and confirm the provenance claim before bumping the number. A count going DOWN is good news "
            + "(a read got constrained or deleted): bump it down so the ratchet keeps holding at the new "
            + "level. Never 'fix' this by widening the vocabulary.");
    }

    [Fact]
    public void EveryExemptionMarker_CarriesAWrittenJustification_NotJustAReasonCode()
    {
        var unjustified = SweepCallSites()
            .Where(site => site.ExemptionReason is not null)
            .Where(site => (site.Justification?.Trim().Length ?? 0) < 20)
            .Select(site => site.Location)
            .ToList();

        unjustified.Should().BeEmpty(
            "a reason code alone is a rubber stamp; the marker must say WHY this particular id cannot reach "
            + "another customer's row, because that is the claim a reviewer has to check. Site(s) with a "
            + "missing or too-short justification: " + string.Join(" | ", unjustified));
    }

    [Fact]
    public void NoProductionCodeReachesAnOrgOwnedEntityThroughSetOrRawSql()
    {
        // The two ways to reach the same table without naming the DbSet property, which the main sweep
        // therefore cannot see. Neither is used today; this keeps it that way rather than discovering it
        // after the fact.
        var entityNames = UnfilteredOrgOwnedEntityNames();
        var pattern = new Regex(
            @"\bSet\s*<\s*(?:[\w.]+\.)?(?:" + string.Join("|", entityNames.Select(Regex.Escape)) + @")\s*>"
            + @"|\bFromSql(?:Raw|Interpolated)\b",
            RegexOptions.CultureInvariant);

        var offenders = new List<string>();
        foreach (var (relativePath, lines) in ProductionSourceFiles())
        {
            for (var i = 0; i < lines.Length; i++)
            {
                var code = StripLineComment(lines[i]);

                // PulseDbContext IS the seam: its DbSet properties are declared as Set<TEntity>(), which is
                // the definition of the accessor, not a way around it.
                if (relativePath.EndsWith("PulseDbContext.cs", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (pattern.IsMatch(code))
                {
                    offenders.Add($"{relativePath}:{i + 1}: {code.Trim()}");
                }
            }
        }

        offenders.Should().BeEmpty(
            "reaching an org-owned entity through Set<T>() or raw SQL bypasses the DbSet-property sweep that "
            + "enforces the customer-tenant bound, so a cross-tenant read there would be invisible to every "
            + "guard in this file. Use the DbSet property (and .InOrganization(...) or a reasoned exemption). "
            + "Offending site(s): " + string.Join(" | ", offenders));
    }

    [Fact]
    public void TheSweptEntitySet_IsTheUnfilteredOrgOwnedOne_SoTheGuardCannotQuietlyCoverNothing()
    {
        var swept = UnfilteredOrgOwnedEntityNames();

        // If somebody drops IOrganizationOwned off Exercise, every other assertion in this file would sweep
        // an empty set and pass. This is the assertion that notices.
        swept.Should().BeEquivalentTo(
            ["Exercise", "Organization", "StaffUser"],
            "these are exactly the tables a tenant filter does NOT cover, and therefore exactly the ones "
            + "whose bound is opt-in and forgettable: the two org-owned RESOLUTION ROOTS (Exercise, "
            + "StaffUser) plus the TENANT ROOT itself (Organization — review finding WR-008). A new name "
            + "here needs its reads swept too; a MISSING name means an entity lost IOrganizationOwned (now "
            + "unownable by any customer) or gained IOrganizationScoped (now centrally filtered) — either "
            + "way this guard's coverage just changed and must be re-reasoned, not re-baselined.");
    }

    /// <summary>
    /// Every entity whose reads this file sweeps: the org-owned types that carry NO central global query
    /// filter, PLUS the tenant root itself.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The first group (<c>Exercise</c>, <c>StaffUser</c>) is discovered by reflection over the EF model, so a
    /// third such entity is swept automatically instead of needing a hardcoded name added here.
    /// </para>
    /// <para>
    /// <b><c>Organization</c> is added explicitly, and it is the only name that has to be (review finding
    /// WR-008).</b> The tenant root implements NEITHER marker — correctly, because its own <c>Id</c> IS the
    /// scope, exactly as <c>Exercise.Id</c> is the exercise scope — so reflection over
    /// <see cref="IOrganizationOwned"/> could never find it. That left the <c>Organizations</c> table with no
    /// query filter AND no sweep coverage: the one reader today
    /// (<c>BootstrapService.ResolveDefaultOrganizationAsync</c>, a by-fixed-id lookup) is fine, but a future
    /// org-admin "list organizations" read would have disclosed the entire customer roster with nothing going
    /// red anywhere. Sweeping it means such a read must carry a reasoned
    /// <c>org-scope-exempt(TenantRoot)</c> marker and bump the pinned inventory — which puts it in front of a
    /// reviewer.
    /// </para>
    /// </remarks>
    private static List<string> UnfilteredOrgOwnedEntityNames()
    {
        using var context = BuildModelOnlyContext();

        var names = context.Model.GetEntityTypes()
            .Where(type => typeof(IOrganizationOwned).IsAssignableFrom(type.ClrType))
            .Where(type => !typeof(IOrganizationScoped).IsAssignableFrom(type.ClrType))
            .Select(type => type.ClrType.Name)
            .ToList();

        var tenantRoot = context.Model.FindEntityType(typeof(Organization))
            ?? throw new InvalidOperationException(
                "The Organization entity is not in the EF model, so the tenant root cannot be swept. Failing "
                + "loudly is deliberate: silently sweeping one fewer unfiltered table is how WR-008 happened.");

        names.Add(tenantRoot.ClrType.Name);

        return names
            .Distinct(StringComparer.Ordinal)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>
    /// The <see cref="PulseDbContext"/> DbSet PROPERTY names for those entities (<c>Exercises</c>,
    /// <c>StaffUsers</c>) — reflected off the context rather than pluralized by hand, so a renamed property
    /// keeps being swept.
    /// </summary>
    private static List<string> SweptDbSetPropertyNames()
    {
        var entityTypes = UnfilteredOrgOwnedEntityNames().ToHashSet(StringComparer.Ordinal);

        return typeof(PulseDbContext)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Where(property => property.PropertyType.IsGenericType
                && property.PropertyType.GetGenericTypeDefinition() == typeof(DbSet<>)
                && entityTypes.Contains(property.PropertyType.GetGenericArguments()[0].Name))
            .Select(property => property.Name)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>Finds every read of a swept DbSet in the production source and classifies it.</summary>
    private static List<CallSite> SweepCallSites()
    {
        var dbSetNames = SweptDbSetPropertyNames();

        dbSetNames.Should().NotBeEmpty(
            "the sweep pattern is built from these property names — an empty set would sweep for nothing "
            + "and pass on any source at all");

        var pattern = new Regex(
            @"\.(?<dbSet>" + string.Join("|", dbSetNames.Select(Regex.Escape)) + @")\b",
            RegexOptions.CultureInvariant);

        var sites = new List<CallSite>();
        foreach (var (relativePath, lines) in ProductionSourceFiles())
        {
            for (var i = 0; i < lines.Length; i++)
            {
                var code = StripLineComment(lines[i]);
                foreach (Match match in pattern.Matches(code))
                {
                    var chain = ReadExpressionChain(lines, i, match.Index + match.Length);

                    // Writes are covered centrally by GuardOrganizationScope — see WriteOperations.
                    if (WriteOperations.Any(op => chain.StartsWith(op, StringComparison.Ordinal)))
                    {
                        continue;
                    }

                    var (reason, justification) = FindExemption(lines, i);

                    sites.Add(new CallSite(
                        Location: $"{relativePath}:{i + 1}",
                        Snippet: code.Trim(),
                        IsConstrained: chain.Contains(Constraint, StringComparison.Ordinal),
                        ExemptionReason: reason,
                        Justification: justification));
                }
            }
        }

        return sites;
    }

    /// <summary>
    /// Reads the rest of the LINQ expression chain — from just after the DbSet name to the statement's
    /// terminating <c>;</c>, across however many lines the chain is wrapped over — so
    /// <c>.InOrganization(...)</c> counts wherever in the chain it appears.
    /// </summary>
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

    /// <summary>
    /// Looks for an exemption marker on the call site's own line, or inside the CONTIGUOUS comment block
    /// directly above it — the block ends at the first line that is not a <c>//</c> comment.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Contiguity is the fix for review finding S-004.</b> The original rule scanned a fixed eight-line
    /// LOOKBACK, which meant a marker written for query A could silently exempt an unrelated, unmarked query B
    /// up to eight lines below it — and the pinned inventory would not notice, because B was simply attributed
    /// to A's reason. Requiring the marker to sit in the comment block immediately above its own statement
    /// makes that impossible: any intervening line of CODE ends the block, so a marker can only ever speak for
    /// the one statement it is attached to.
    /// </para>
    /// <para>
    /// It is strictly stronger than the rule it replaces (every site it accepts, the lookback also accepted),
    /// and the pinned inventory is unchanged by the tightening — i.e. every pre-existing marker was already
    /// adjacent to its own statement, which is what makes this a hardening rather than a re-baselining. Blank
    /// lines are deliberately NOT part of a comment block: a marker separated from its statement by an empty
    /// line is no longer visually attached to it either.
    /// </para>
    /// </remarks>
    private static (string? Reason, string? Justification) FindExemption(string[] lines, int line)
    {
        for (var i = line; i >= 0; i--)
        {
            // Anything above the call site must be an unbroken run of comment lines; the first non-comment
            // line (code, a blank line, a closing brace) terminates the block and the search.
            if (i != line && !CommentOnlyLine.IsMatch(lines[i]))
            {
                break;
            }

            var match = ExemptionMarker.Match(lines[i]);
            if (match.Success)
            {
                return (match.Groups["reason"].Value, match.Groups["justification"].Value);
            }
        }

        return (null, null);
    }

    /// <summary>
    /// Every hand-written production source file under <c>src/Pulse.WebApi</c>. Build output and the
    /// EF-generated migrations are excluded — they are not hand-written and their historical snapshots must
    /// not be edited to satisfy a guard.
    /// </summary>
    private static List<(string RelativePath, string[] Lines)> ProductionSourceFiles()
    {
        var repositoryRoot = FindRepositoryRoot();
        var tree = Path.Combine(repositoryRoot, "src", "Pulse.WebApi");

        var files = Directory.EnumerateFiles(tree, "*.cs", SearchOption.AllDirectories)
            .Select(path => (RelativePath: Path.GetRelativePath(repositoryRoot, path), Path: path))
            .Where(file => !file.RelativePath.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                .Any(segment => segment is "obj" or "bin" or "Migrations"))
            .Select(file => (file.RelativePath, Lines: File.ReadAllLines(file.Path)))
            .ToList();

        files.Should().HaveCountGreaterThan(
            50, "the sweep found almost no production source, which would make every guard in this file "
            + "vacuous rather than clean");

        return files;
    }

    /// <summary>
    /// Removes a trailing <c>//</c> comment so prose mentioning <c>.Exercises</c> is not swept as code. Naive
    /// about <c>//</c> inside a string literal; no production line in this tree has that shape, and a false
    /// NEGATIVE here can only make the guard sweep MORE, never less.
    /// </summary>
    private static string StripLineComment(string line)
    {
        var index = line.IndexOf("//", StringComparison.Ordinal);
        return index >= 0 ? line[..index] : line;
    }

    /// <summary>
    /// Builds a model-only context purely to reflect over the EF model. A provider is required to build the
    /// model but NO connection is ever opened — same idiom, and same unreachable connection string, as
    /// <c>QueryFilterModelTests.BuildModelOnlyContext</c>, so this guard runs on every machine and in CI.
    /// </summary>
    private static PulseDbContext BuildModelOnlyContext()
    {
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer("Server=model-only;Database=none;")
            .Options;

        return new PulseDbContext(options);
    }

    /// <summary>
    /// Walks up from the test binary to the directory holding <c>pulse.slnx</c>. Throws rather than falling
    /// back: a guard that cannot find the source it sweeps must fail loudly, never pass by sweeping nothing.
    /// </summary>
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

        throw new InvalidOperationException(
            $"Could not locate pulse.slnx above '{AppContext.BaseDirectory}' — the organization-scope sweep "
            + "has no source tree to read. Failing loudly is deliberate: a silently-skipped isolation guard "
            + "is worse than none.");
    }

    /// <summary>One swept read of an unfiltered org-owned DbSet.</summary>
    private sealed record CallSite(
        string Location,
        string Snippet,
        bool IsConstrained,
        string? ExemptionReason,
        string? Justification);
}
