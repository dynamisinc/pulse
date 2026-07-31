namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;
using FluentAssertions;
using Pulse.Core.Features.Generation.Services;
using Pulse.WebApi.Features.EngineRuntime;
using Xunit;

/// <summary>
/// autonomy-safety story 07 — the architecture guards over "the selector is the only way in".
/// <c>AddEngineGeneration</c> registers the concrete adapters as their own typed clients (so the selector can be
/// the resolved <see cref="IGenerationProvider"/>), which means <c>AzureOpenAIGenerationProvider</c> /
/// <c>ClaudeFoundryGenerationProvider</c> are now directly resolvable concrete services. These tests close the
/// two ways production code could reach one of them without passing through
/// <see cref="GenerationProviderSelector"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Exactly what is covered</b> (Gate-2 WR-G2-004 — this claim was previously wider than the reflection
/// behind it):
/// </para>
/// <list type="bullet">
/// <item><b>Constructor injection</b> —
/// <see cref="NoProductionTypeOtherThanTheSelector_InjectsAConcreteGenerationProvider"/> reflects over every
/// production type's constructor parameters, so no production type can <i>take</i> a concrete adapter as a
/// dependency. This is mechanical for that shape and that shape only.</item>
/// <item><b>Direct service location</b> —
/// <see cref="NoProductionSourceOutsideTheCompositionRoot_ServiceLocatesAConcreteGenerationProvider"/> sweeps
/// the production <i>source</i> for <c>GetRequiredService&lt;TAdapter&gt;()</c> / <c>GetService&lt;TAdapter&gt;()</c>
/// (and the keyed variants), which constructor reflection cannot see at all.</item>
/// </list>
/// <para>
/// <b>What is NOT covered</b>, so nobody reads more into these guards than they prove: resolution or
/// construction that is not visible as either a constructor parameter type or a literal generic type argument in
/// source — i.e. reflection-based or otherwise dynamically-typed resolution
/// (<c>GetRequiredService(someType)</c>, <c>ActivatorUtilities</c>, an open generic helper), and a direct
/// <c>new AzureOpenAIGenerationProvider(...)</c>. An IL sweep would catch those, and would be the rigorous
/// answer; it is disproportionate here (a Mono.Cecil/metadata-reader dependency and a bytecode matcher for a
/// three-adapter surface), so the second guard is deliberately a source sweep and the residual gap is stated
/// rather than papered over.
/// </para>
/// <para>Model-only (no host, no SQL), so both guards run on every machine and in every CI job.</para>
/// </remarks>
public sealed class GenerationProviderInjectionArchitectureTests
{
    /// <summary>
    /// The production assemblies. Test assemblies are deliberately out of scope: a test legitimately constructs
    /// an adapter directly (that is how the adapters themselves are covered).
    /// </summary>
    private static readonly Assembly[] ProductionAssemblies =
    [
        typeof(IGenerationProvider).Assembly,      // Pulse.Core
        typeof(EngineReviewService).Assembly,      // Pulse.WebApi
    ];

    /// <summary>
    /// The production source trees the service-location sweep reads, relative to the repository root — the same
    /// two projects <see cref="ProductionAssemblies"/> covers.
    /// </summary>
    private static readonly string[] ProductionSourceTrees =
    [
        Path.Combine("src", "Pulse.Core"),
        Path.Combine("src", "Pulse.WebApi"),
    ];

    /// <summary>
    /// The ONE file allowed to service-locate a concrete adapter: <c>AddEngineGeneration</c>'s selector factory.
    /// That file IS the composition root that builds the selector out of the two registered providers, so
    /// resolving them there is how the lever gets assembled — not a way around it. Exempted by full relative
    /// path, not by file name, so a second file called <c>ServiceCollectionExtensions.cs</c> elsewhere would
    /// still be swept.
    /// </summary>
    private static readonly string CompositionRootFile =
        Path.Combine("src", "Pulse.Core", "Core", "Extensions", "ServiceCollectionExtensions.cs");

    [Fact]
    public void NoProductionTypeOtherThanTheSelector_InjectsAConcreteGenerationProvider()
    {
        var concreteProviders = ProductionAssemblies
            .SelectMany(assembly => assembly.GetTypes())
            .Where(type => type is { IsClass: true, IsAbstract: false }
                && typeof(IGenerationProvider).IsAssignableFrom(type))
            .ToHashSet();

        concreteProviders.Should().NotBeEmpty(
            "the guard is worthless if the reflection found no adapters at all — that would make it vacuous");

        var offenders = new List<string>();
        foreach (var type in ProductionAssemblies.SelectMany(assembly => assembly.GetTypes()))
        {
            // The selector is the ONE type allowed to hold the concrete adapters (today it takes them as
            // IGenerationProvider, so this allowance is precautionary rather than currently used).
            if (type == typeof(GenerationProviderSelector))
            {
                continue;
            }

            offenders.AddRange(
                from constructor in type.GetConstructors(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance)
                from parameter in constructor.GetParameters()
                where concreteProviders.Contains(parameter.ParameterType)
                select $"{type.FullName}(.., {parameter.ParameterType.Name} {parameter.Name}, ..)");
        }

        offenders.Should().BeEmpty(
            "a type that injects a CONCRETE generation provider bypasses GenerationProviderSelector, and the "
            + "cut registry can only reach generation THROUGH the selector — so an exercise cut to Fake would "
            + "keep egressing on that path while the safety brake reported success (NFR-005 / ADP-042). Depend "
            + "on IGenerationProvider instead; DI resolves the selector, which honours the cut per exercise. "
            + $"Offending constructor parameter(s): {string.Join(", ", offenders)}");
    }

    [Fact]
    public void NoProductionSourceOutsideTheCompositionRoot_ServiceLocatesAConcreteGenerationProvider()
    {
        // The vector constructor reflection cannot see: `serviceProvider.GetRequiredService<AzureOpenAI...>()`
        // takes a concrete adapter without ever declaring it as a dependency. A source sweep is the pragmatic
        // instrument (see the type remarks for the IL-sweep trade-off and the residual gap).
        var repositoryRoot = FindRepositoryRoot();
        var adapterNames = ConcreteAdapterNames();

        adapterNames.Should().NotBeEmpty(
            "the sweep pattern is built from these names, so an empty set would make this guard vacuous — it "
            + "would sweep for nothing and pass on any source at all");

        var pattern = new Regex(
            @"\bGet(?:Required)?(?:Keyed)?Service\s*<\s*(?:[\w.]+\.)?(?:"
            + string.Join("|", adapterNames.Select(Regex.Escape))
            + @")\s*>",
            RegexOptions.CultureInvariant);

        var sourceFiles = ProductionSourceTrees
            .Select(tree => Path.Combine(repositoryRoot, tree))
            .SelectMany(tree => Directory.EnumerateFiles(tree, "*.cs", SearchOption.AllDirectories))
            .Where(path => !IsGeneratedOrBuildOutput(path, repositoryRoot))
            .ToList();

        sourceFiles.Should().HaveCountGreaterThan(
            50, "the sweep found almost no production source, which would make it vacuous rather than clean");

        // The exemption is only meaningful if the pattern actually MATCHES at the one legitimate site. This
        // pins that: if the composition root stops matching (a refactor, or a broken pattern), the sweep has
        // silently stopped seeing the shape it exists to find. Should AddEngineGeneration one day stop
        // service-locating the adapters, delete the exemption WITH this anchor rather than just this anchor.
        var compositionRootPath = Path.Combine(repositoryRoot, CompositionRootFile);
        File.Exists(compositionRootPath).Should().BeTrue(
            "the exempted composition root must exist at {0}, or the exemption is stale", CompositionRootFile);
        pattern.IsMatch(File.ReadAllText(compositionRootPath)).Should().BeTrue(
            "the sweep pattern must still match the KNOWN service-location site in {0} — otherwise the pattern "
            + "has rotted and the sweep proves nothing about the rest of the tree", CompositionRootFile);

        var offenders = new List<string>();
        foreach (var path in sourceFiles)
        {
            var relativePath = Path.GetRelativePath(repositoryRoot, path);
            if (string.Equals(relativePath, CompositionRootFile, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var lines = File.ReadAllLines(path);
            for (var i = 0; i < lines.Length; i++)
            {
                var match = pattern.Match(lines[i]);
                if (match.Success)
                {
                    offenders.Add($"{relativePath}:{i + 1}: {match.Value}");
                }
            }
        }

        offenders.Should().BeEmpty(
            "resolving a CONCRETE generation provider from the container reaches that adapter directly, so the "
            + "per-exercise cut registry never runs for that call: an exercise cut to Fake would KEEP EGRESSING "
            + "to the live endpoint on that path while the controller's safety brake reported success, and the "
            + "engine.generated telemetry would name the live provider for a burst the controller believes was "
            + "taken offline (NFR-005 / ADP-042). Resolve IGenerationProvider instead — DI hands back "
            + "GenerationProviderSelector, which honours the cut per exercise. The composition root that BUILDS "
            + $"the selector is the only exempt site. Offending call site(s): {string.Join(" | ", offenders)}");
    }

    /// <summary>
    /// The simple names of the concrete <see cref="IGenerationProvider"/> adapters, discovered by reflection so a
    /// fourth adapter is swept automatically rather than needing a hardcoded string added here.
    /// <see cref="GenerationProviderSelector"/> is excluded: it is the lever itself, and resolving it is exactly
    /// what production code is supposed to do.
    /// </summary>
    private static List<string> ConcreteAdapterNames() =>
        ProductionAssemblies
            .SelectMany(assembly => assembly.GetTypes())
            .Where(type => type is { IsClass: true, IsAbstract: false }
                && typeof(IGenerationProvider).IsAssignableFrom(type)
                && type != typeof(GenerationProviderSelector))
            .Select(type => type.Name)
            .Distinct(StringComparer.Ordinal)
            .ToList();

    /// <summary>Build output and generated sources are not hand-written production code, so they are not swept.</summary>
    private static bool IsGeneratedOrBuildOutput(string path, string repositoryRoot)
    {
        var relativePath = Path.GetRelativePath(repositoryRoot, path);
        var segments = relativePath.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        return segments.Any(segment =>
            string.Equals(segment, "obj", StringComparison.OrdinalIgnoreCase)
            || string.Equals(segment, "bin", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Walks up from the test binary to the directory holding <c>pulse.slnx</c>. Throws rather than returning a
    /// fallback: a guard that cannot find the source it sweeps must fail loudly, never pass by sweeping nothing.
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
            $"Could not locate pulse.slnx above '{AppContext.BaseDirectory}' — the service-location sweep has no "
            + "source tree to read. Failing loudly is deliberate: a silently-skipped architecture guard is worse "
            + "than none.");
    }
}
