namespace Pulse.WebApi.Tests.Features.Channels;

using System;
using System.Linq;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels;
using Xunit;

/// <summary>
/// Composition-root guard for channels-foundation story 01 (FC-9.10; plain <see cref="FactAttribute"/>s, no Docker): boots
/// the REAL <c>Program</c> host with no override and proves the M1 schema reaches the request-scoped
/// <see cref="PulseDbContext"/> that <c>Program.cs</c> registers — every channel entity in the model, under the central
/// exercise filter — and that the <c>AddChannels()</c> seam later stories fill is safe to compose.
/// </summary>
/// <remarks>
/// Story 01 registers no service of its own (schema only), so there is no route or service to find yet; stories 03+ extend
/// this file as they fill <c>AddChannels()</c>. Resolving the context only needs the host to BUILD, so it is fed a dummy,
/// never-connecting connection string.
/// </remarks>
public sealed class ChannelsCompositionRootWiringTests
{
    [Fact]
    public void ProgramCs_ResolvesTheScopedContext_WithEveryM1EntityUnderTheExerciseFilter()
    {
        using var factory = new WiringProbeFactory();
        using var scope = factory.Services.CreateScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = Guid.NewGuid();

        var context = scope.ServiceProvider.GetRequiredService<PulseDbContext>();

        foreach (var type in new[]
                 {
                     typeof(Outlet), typeof(ContentItem), typeof(ContentItemRevision), typeof(ContentItemMedia),
                     typeof(ChannelAlert), typeof(PortalConfig), typeof(PortalResource), typeof(WeatherZone),
                 })
        {
            var entity = context.Model.FindEntityType(type);
            entity.Should().NotBeNull("{0} is part of the context Program.cs registers", type.Name);
            entity!.FindDeclaredQueryFilter(null).Should().NotBeNull("{0} is covered by the central exercise filter", type.Name);
        }

        context.Model.FindEntityType(typeof(InjectItem))!.FindProperty(nameof(InjectItem.ContentItemId))
            .Should().NotBeNull("the folded inject column is mapped");
        context.Database.HasPendingModelChanges().Should().BeFalse("the deployed migrations describe the registered model");
    }

    [Fact]
    public void AddChannels_IsIdempotentAndRegistersNothingYet()
    {
        var services = new ServiceCollection();

        services.AddChannels().AddChannels().Should().BeSameAs(services);
        services.Should().BeEmpty("story 01 is schema only; stories 03+ add their registrations to this seam");
    }

    /// <summary>Boots the real <c>Program</c> host with a dummy, never-connecting connection string. Overrides nothing else.</summary>
    private sealed class WiringProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";
        private const string DummyConnectionString =
            "Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;";

        public WiringProbeFactory()
        {
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, DummyConnectionString);
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}
