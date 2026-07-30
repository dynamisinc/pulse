namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using FluentAssertions;
using Pulse.Core.Features.Generation.Services;
using Pulse.WebApi.Features.EngineRuntime;
using Xunit;

/// <summary>
/// autonomy-safety story 07 — the architecture guard that makes "the selector is the only way in" MECHANICAL
/// rather than conventional. <c>AddEngineGeneration</c> registers the concrete adapters as their own typed
/// clients (so the selector can be the resolved <see cref="IGenerationProvider"/>), which means
/// <c>AzureOpenAIGenerationProvider</c> / <c>ClaudeFoundryGenerationProvider</c> are now directly resolvable
/// concrete services. This test asserts no production type takes that shortcut.
/// </summary>
/// <remarks>
/// Model-only (no host, no SQL), so it runs on every machine and in every CI job.
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
}
