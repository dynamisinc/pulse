namespace Pulse.WebApi.Tests;

using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.Core.Features.Generation.Services;

/// <summary>
/// Story 01 AC: "Given the host starts, when Program.cs calls
/// builder.Services.AddEngineGeneration(builder.Configuration) ..., then the generation provider,
/// prompt assembler, and tier policy resolve from DI ... zero changes to
/// ServiceCollectionExtensions.cs or any file under Pulse.Core." This asserts only that the seam
/// resolves through the real host's service provider — it does not re-test Pulse.Core's own
/// (already-covered) internals.
/// </summary>
public class EngineGenerationDiTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public EngineGenerationDiTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }

    [Fact]
    public void GenerationProvider_ResolvesFromHostServiceProvider()
    {
        using var scope = _factory.Services.CreateScope();

        var provider = scope.ServiceProvider.GetService<IGenerationProvider>();

        provider.Should().NotBeNull();
    }

    [Fact]
    public void PromptAssembler_ResolvesFromHostServiceProvider()
    {
        using var scope = _factory.Services.CreateScope();

        var assembler = scope.ServiceProvider.GetService<IPromptAssembler>();

        assembler.Should().NotBeNull();
    }

    [Fact]
    public void TierPolicy_ResolvesFromHostServiceProvider()
    {
        using var scope = _factory.Services.CreateScope();

        var tierPolicy = scope.ServiceProvider.GetService<ITierPolicy>();

        tierPolicy.Should().NotBeNull();
    }
}
