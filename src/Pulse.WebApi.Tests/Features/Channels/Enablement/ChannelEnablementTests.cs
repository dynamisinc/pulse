namespace Pulse.WebApi.Tests.Features.Channels.Enablement;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Enablement;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Xunit;

/// <summary>
/// Channels-foundation 08 (#704), the service half: <see cref="ChannelEnablement"/> reads ONLY the server-resolved
/// exercise's <c>EnabledChannels</c> (null → <see cref="ChannelCatalog.DefaultEnabledIds"/>), fails closed on an unresolved
/// scope or an uncatalogued id, never leaks one exercise's setting into another (XC-001), sees a toggle on the next
/// request, and agrees with <c>GET /api/channel-nav-config</c> for every stored value. In-memory provider, no Docker; the
/// real-host route tests live in <see cref="ChannelEnablementGateHostTests"/>.
/// </summary>
public sealed class ChannelEnablementTests : IDisposable
{
    private static readonly string[] GatedChannels = ["portal", "news", "press", "weather"];

    private readonly string _dbName = $"channel-enablement-{Guid.NewGuid():N}";
    private readonly PulseDbContext _seed;

    public ChannelEnablementTests() => _seed = NewContext(exerciseId: null);

    public void Dispose() => _seed.Dispose();

    [Fact]
    public async Task Unconfigured_IsSocialOnly_ThePilotDefault()
    {
        var exerciseId = await SeedExerciseAsync(enabledChannels: null);
        var enablement = NewEnablement(exerciseId);

        (await enablement.IsEnabledAsync("social")).Should().BeTrue();
        foreach (var channel in GatedChannels)
        {
            (await enablement.IsEnabledAsync(channel)).Should().BeFalse("{0} is catalogued but off by default", channel);
        }
    }

    [Fact]
    public async Task Configured_ReadsTheStoredSet()
    {
        var exerciseId = await SeedExerciseAsync("social,news,weather");
        var enablement = NewEnablement(exerciseId);

        (await enablement.IsEnabledAsync("news")).Should().BeTrue();
        (await enablement.IsEnabledAsync("weather")).Should().BeTrue();
        (await enablement.IsEnabledAsync("press")).Should().BeFalse();
        (await enablement.IsEnabledAsync("portal")).Should().BeFalse();
    }

    [Fact]
    public async Task UnrecognizedStoredValue_DegradesToTheDefault_LikeTheNavConfig()
    {
        var exerciseId = await SeedExerciseAsync("tv,radio");
        var enablement = NewEnablement(exerciseId);

        (await enablement.IsEnabledAsync("social")).Should().BeTrue();
        (await enablement.IsEnabledAsync("news")).Should().BeFalse();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    public async Task UnresolvedScope_FailsClosed(string? scope)
    {
        await SeedExerciseAsync("social,news,press,weather,portal");
        var enablement = NewEnablement(scope is null ? null : Guid.Parse(scope));

        (await enablement.IsEnabledAsync("news")).Should().BeFalse();
        (await enablement.IsEnabledAsync("social")).Should().BeFalse("no scope means nothing is enabled, not the default");
    }

    [Theory]
    [InlineData("tv")]
    [InlineData("News")]
    [InlineData("")]
    public async Task UncataloguedOrMiscasedId_IsNeverEnabled(string channelId)
    {
        var exerciseId = await SeedExerciseAsync("social,news");

        (await NewEnablement(exerciseId).IsEnabledAsync(channelId)).Should().BeFalse();
    }

    [Fact]
    public async Task ResolvedScopeWithNoRow_ServesTheDefault_MatchingTheNavConfig()
    {
        var enablement = NewEnablement(Guid.NewGuid());

        (await enablement.IsEnabledAsync("social")).Should().BeTrue();
        (await enablement.IsEnabledAsync("news")).Should().BeFalse();
    }

    [Fact]
    public async Task Isolation_AnotherExercisesSetting_NeverApplies()
    {
        var a = await SeedExerciseAsync("social,news,press,weather,portal");
        var b = await SeedExerciseAsync(enabledChannels: null);

        var asB = NewEnablement(b);
        foreach (var channel in GatedChannels)
        {
            (await asB.IsEnabledAsync(channel)).Should().BeFalse("exercise A enabling {0} must not reach exercise B", channel);
        }

        (await NewEnablement(a).IsEnabledAsync("news")).Should().BeTrue();
    }

    [Fact]
    public async Task Toggle_AppliesOnTheNextRequest_WithoutARestart()
    {
        var exerciseId = await SeedExerciseAsync(enabledChannels: null);
        (await NewEnablement(exerciseId).IsEnabledAsync("news")).Should().BeFalse();

        await SetEnabledChannelsAsync(exerciseId, "social,news");
        (await NewEnablement(exerciseId).IsEnabledAsync("news")).Should().BeTrue("a new request reads the new state");

        await SetEnabledChannelsAsync(exerciseId, "social");
        (await NewEnablement(exerciseId).IsEnabledAsync("news")).Should().BeFalse("disabling applies just as live");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("social")]
    [InlineData("news")]
    [InlineData("social,portal,press")]
    [InlineData("social,portal,news,press,weather")]
    [InlineData("bogus")]
    public async Task NavConfig_AndTheGate_AgreeForEveryChannel(string? stored)
    {
        var exerciseId = await SeedExerciseAsync(stored);

        var nav = await NewNavService(exerciseId).GetChannelNavConfigAsync();
        var enablement = NewEnablement(exerciseId);

        nav.Should().NotBeNull();
        foreach (var channel in nav!.Channels)
        {
            (await enablement.IsEnabledAsync(channel.Id)).Should().Be(
                channel.Enabled, "the nav and the gate resolve '{0}' through the same rule", channel.Id);
        }
    }

    [Fact]
    public void RequireChannelEnabled_AcceptsEveryCataloguedId()
    {
        var app = WebApplication.CreateBuilder().Build();

        foreach (var entry in ChannelCatalog.All)
        {
            var act = () => app.MapGet($"/probe/{entry.Id}", () => Results.Ok()).RequireChannelEnabled(entry.Id);
            act.Should().NotThrow();
        }

        var group = () => app.MapGroup("/probe-group").RequireChannelEnabled("news");
        group.Should().NotThrow("a channel story gates its whole route group in one call");
    }

    [Theory]
    [InlineData("tv")]
    [InlineData("News")]
    [InlineData("")]
    public void RequireChannelEnabled_RejectsAnUncataloguedId_AtMappingTime(string channelId)
    {
        var app = WebApplication.CreateBuilder().Build();

        var act = () => app.MapGet("/probe", () => Results.Ok()).RequireChannelEnabled(channelId);

        act.Should().Throw<ArgumentException>().WithParameterName("channelId");
    }

    [Fact]
    public void AddChannelEnablement_RegistersOneScopedService_Idempotently()
    {
        var services = new ServiceCollection();

        services.AddChannelEnablement().AddChannelEnablement();

        services.Where(d => d.ServiceType == typeof(IChannelEnablement)).Should().ContainSingle()
            .Which.Should().Match<ServiceDescriptor>(d =>
                d.Lifetime == ServiceLifetime.Scoped && d.ImplementationType == typeof(ChannelEnablement));
    }

    [Fact]
    public void Catalog_IsCatalogued_IsExactAndCaseSensitive()
    {
        ChannelCatalog.All.Select(c => c.Id).Should().OnlyContain(id => ChannelCatalog.IsCatalogued(id));
        ChannelCatalog.IsCatalogued("NEWS").Should().BeFalse();
        ChannelCatalog.IsCatalogued(null).Should().BeFalse();
        ChannelCatalog.ResolveEnabled(null).Should().BeSameAs(ChannelCatalog.DefaultEnabledIds);
    }

    private ChannelEnablement NewEnablement(Guid? exerciseId) =>
        new(NewContext(exerciseId), new ExerciseContext { CurrentExerciseId = exerciseId });

    private ParticipantShellConfigService NewNavService(Guid exerciseId) =>
        new(
            NewContext(exerciseId),
            new ExerciseContext { CurrentExerciseId = exerciseId },
            new ConstantChromeConfigProjection(),
            new ConstantShellVariantProjection(),
            new ConstantOverlayStateProjection());

    private PulseDbContext NewContext(Guid? exerciseId) =>
        new(
            new DbContextOptionsBuilder<PulseDbContext>().UseInMemoryDatabase(_dbName).Options,
            new ExerciseContext { CurrentExerciseId = exerciseId });

    private async Task<Guid> SeedExerciseAsync(string? enabledChannels)
    {
        var id = Guid.NewGuid();
        _seed.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = id,
            Name = $"Enablement {id:N}",
            Hostname = $"enablement-{id:N}.example.com",
            TimeZone = "UTC",
            Status = "live",
            EnabledChannels = enabledChannels,
        });
        await _seed.SaveChangesAsync();
        return id;
    }

    private async Task SetEnabledChannelsAsync(Guid exerciseId, string? enabledChannels)
    {
        await using var write = NewContext(exerciseId);
        var exercise = await write.Exercises.SingleAsync(e => e.Id == exerciseId);
        exercise.EnabledChannels = enabledChannels;
        await write.SaveChangesAsync();
    }
}
