namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using static Pulse.WebApi.Tests.Features.Social.PostMediaSeed;

/// <summary>
/// demo-polish BP AC "Personas": both persona shapes gain <c>avatarUrl?</c>, <c>bannerUrl?</c> and
/// <c>location?</c> (signed, omitted when null), the participant shape still never carries
/// <c>personaType</c>/<c>castable</c> (SOC-052/D1-008), and <see cref="PersonaReadService.GetStaffPersonaAsync"/>
/// reads one in-scope persona for the edit endpoint.
/// </summary>
[Collection(MsSqlCollection.Name)]
public class PostMediaPersonaTests
{
    private static readonly Uri PersonasUri = new("/api/personas", UriKind.Relative);

    private readonly MsSqlContainerFixture _fixture;

    public PostMediaPersonaTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task ParticipantRead_SignsAvatarAndBanner_CarriesLocation_AndStillOmitsPersonaTypeAndCastable()
    {
        var world = await SeedWorldAsync(_fixture);
        var (avatar, banner) = await GiveStaffPersonaImagesAsync(world);

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        var personas = await GetPersonasAsync(client);
        var withImages = personas.Single(p => p.GetProperty("id").GetString() == world.StaffPersona.ToString());
        withImages.GetProperty("avatarUrl").GetString().Should().Be(FakeMediaUrlSigner.UrlFor(avatar.Id));
        withImages.GetProperty("bannerUrl").GetString().Should().Be(FakeMediaUrlSigner.UrlFor(banner.Id));
        withImages.GetProperty("location").GetString().Should().Be("Fairhaven, OH");
        withImages.TryGetProperty("personaType", out _).Should().BeFalse("SOC-052/D1-008: never on the participant shape");
        withImages.TryGetProperty("castable", out _).Should().BeFalse();

        var plain = personas.Single(p => p.GetProperty("id").GetString() == world.ParticipantPersona.ToString());
        plain.TryGetProperty("avatarUrl", out _).Should().BeFalse("omitted when null, never emitted as null");
        plain.TryGetProperty("bannerUrl", out _).Should().BeFalse();
        plain.TryGetProperty("location", out _).Should().BeFalse();

        factory.Signer.Calls.Should().ContainSingle("one batched signer call for the whole roster");
    }

    [RequiresDockerFact]
    public async Task StaffRead_CarriesTheSameImagesAndLocation_PlusPersonaType()
    {
        var world = await SeedWorldAsync(_fixture);
        var (avatar, _) = await GiveStaffPersonaImagesAsync(world);

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.StaffToken);

        var persona = (await GetPersonasAsync(client)).Single(p => p.GetProperty("id").GetString() == world.StaffPersona.ToString());
        persona.GetProperty("personaType").GetString().Should().Be("citizen", "the staff shape keeps the archetype");
        persona.GetProperty("avatarUrl").GetString().Should().Be(FakeMediaUrlSigner.UrlFor(avatar.Id));
        persona.GetProperty("location").GetString().Should().Be("Fairhaven, OH");
        persona.TryGetProperty("castable", out _).Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task GetStaffPersonaAsync_ReadsOneInScopePersona_AndReturnsNullForUnknownOrCrossExercise()
    {
        var a = await SeedWorldAsync(_fixture);
        var b = await SeedWorldAsync(_fixture);
        var (avatar, banner) = await GiveStaffPersonaImagesAsync(a);

        await using var factory = CreateFactory();
        using var scope = factory.Services.CreateScope();
        var exerciseContext = (ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>();
        exerciseContext.CurrentExerciseId = a.Exercise;
        var service = scope.ServiceProvider.GetRequiredService<PersonaReadService>();

        var found = await service.GetStaffPersonaAsync(a.StaffPersona, default);
        found.Should().NotBeNull();
        found!.Id.Should().Be(a.StaffPersona.ToString());
        found.AvatarUrl.Should().Be(FakeMediaUrlSigner.UrlFor(avatar.Id));
        found.BannerUrl.Should().Be(FakeMediaUrlSigner.UrlFor(banner.Id));
        found.Location.Should().Be("Fairhaven, OH");
        found.PersonaType.Should().Be("citizen");

        (await service.GetStaffPersonaAsync(b.StaffPersona, default)).Should().BeNull(
            "another exercise's persona is indistinguishable from an unknown id (COR-001)");
        (await service.GetStaffPersonaAsync(Guid.NewGuid(), default)).Should().BeNull();
    }

    private async Task<(MediaAsset Avatar, MediaAsset Banner)> GiveStaffPersonaImagesAsync(MediaWorld world)
    {
        var avatar = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, "staff-uploader");
        var banner = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, "staff-uploader");

        await using var seed = _fixture.CreateContext();
        var persona = await seed.Personas.IgnoreQueryFilters().SingleAsync(p => p.Id == world.StaffPersona);
        persona.AvatarMediaId = avatar.Id;
        persona.BannerMediaId = banner.Id;
        persona.Location = "Fairhaven, OH";
        await seed.SaveChangesAsync();
        return (avatar, banner);
    }

    private static async Task<JsonElement[]> GetPersonasAsync(System.Net.Http.HttpClient client)
    {
        var response = await client.GetAsync(PersonasUri);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.EnumerateArray().Select(e => e.Clone()).ToArray();
    }

    private PostMediaWebApplicationFactory CreateFactory()
    {
        _fixture.ConnectionString.Should().NotBeNull();
        return new PostMediaWebApplicationFactory(_fixture.ConnectionString!);
    }
}
