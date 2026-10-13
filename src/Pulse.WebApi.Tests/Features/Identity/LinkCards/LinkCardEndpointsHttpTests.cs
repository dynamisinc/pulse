namespace Pulse.WebApi.Tests.Features.Identity.LinkCards;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.LinkCards;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// easy-login/04 over HTTP: <c>GET /api/staff/roster/cards</c> through the real filters and the real token-backed
/// staff-session accessor (<see cref="LinkCardTestHost"/>). <c>200</c> in the frozen <c>RosterCardsDto</c> shape,
/// <c>400</c> over the id cap, <c>409</c> with no join base, <c>401</c> with no staff session (a participant session
/// included), <c>403</c> for an evaluator or an unassigned staff user, and <c>Cache-Control: no-store</c> on every
/// answer the handler writes. Plus the composition proof on the real <c>Program</c> host.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class LinkCardEndpointsHttpTests
{
    private readonly LinkCardTestWorld _world;

    public LinkCardEndpointsHttpTests(MsSqlContainerFixture fixture) => _world = new LinkCardTestWorld(fixture);

    [RequiresDockerFact]
    public async Task AController_Gets200_InTheFrozenShape_WithNoStore()
    {
        var exercise = await _world.SeedExerciseAsync(name: "Coastal Surge 2026");
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        var jane = await _world.SeedParticipantAsync(exercise, "Jane Smith", agency: "Fulco County EM", jobRole: "EOC Liaison");
        var madonna = await _world.SeedParticipantAsync(exercise, "Madonna");
        var revoked = await _world.SeedParticipantAsync(exercise, "Revoked Rita", SeededLink.Revoked);

        await using var host = await StartHostAsync(exercise);
        using var client = host.Client(await LinkCardTestHost.SeedStaffSessionAsync(_world, staff, exercise));

        using var response = await client.GetAsync(LinkCardEndpoints.CardsRoute);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Headers.CacheControl!.NoStore.Should().BeTrue("the body holds bearer credentials");
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/json");

        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = body.RootElement;
        root.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(["exerciseName", "cards", "skipped"]);
        root.GetProperty("exerciseName").GetString().Should().Be("Coastal Surge 2026");

        var cards = root.GetProperty("cards").EnumerateArray().ToList();
        cards.Select(c => c.GetProperty("name").GetString()).Should().Equal(["Jane Smith", "Madonna"], "ordered by name");

        var janeCard = cards[0];
        janeCard.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
            ["participantId", "name", "agency", "role", "signInName", "joinUrl", "qrSvgDataUri"]);
        janeCard.GetProperty("participantId").GetString().Should().Be(jane.AccountId.ToString());
        janeCard.GetProperty("agency").GetString().Should().Be("Fulco County EM");
        janeCard.GetProperty("role").GetString().Should().Be("EOC Liaison");
        janeCard.GetProperty("signInName").GetString().Should().Be(jane.SignInName);
        janeCard.GetProperty("joinUrl").GetString().Should().Be(jane.JoinUrl);

        var madonnaCard = cards[1];
        madonnaCard.GetProperty("participantId").GetString().Should().Be(madonna.AccountId.ToString());
        madonnaCard.TryGetProperty("agency", out _).Should().BeFalse("an absent optional field is omitted, never null");
        madonnaCard.TryGetProperty("role", out _).Should().BeFalse();

        foreach (var card in cards)
        {
            FrontendQrGate.Admits(card.GetProperty("qrSvgDataUri").GetString()).Should().BeTrue(
                "every QR on the wire passes the card sheet's safeQrDataUri gate");
        }

        var skipped = root.GetProperty("skipped").EnumerateArray().Should().ContainSingle().Subject;
        skipped.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(["participantId", "reason"],
            "a skip names only the id and the reason, never the person");
        skipped.GetProperty("participantId").GetString().Should().Be(revoked.AccountId.ToString());
        skipped.GetProperty("reason").GetString().Should().Be("noActiveLink");
    }

    [RequiresDockerFact]
    public async Task APlanner_Gets200()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "planner"));

        await using var host = await StartHostAsync(exercise);
        using var client = host.Client(await LinkCardTestHost.SeedStaffSessionAsync(_world, staff, exercise));

        using var response = await client.GetAsync(LinkCardEndpoints.CardsRoute);

        response.StatusCode.Should().Be(HttpStatusCode.OK, "planners provision participants too (EL-13)");
    }

    [RequiresDockerFact]
    public async Task RepeatedIdQueryValues_AllBind()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        var one = await _world.SeedParticipantAsync(exercise, "One Person");
        var two = await _world.SeedParticipantAsync(exercise, "Two Person");
        await _world.SeedParticipantAsync(exercise, "Not Requested");

        await using var host = await StartHostAsync(exercise);
        using var client = host.Client(await LinkCardTestHost.SeedStaffSessionAsync(_world, staff, exercise));

        var sheet = await GetSheetAsync(client, $"{LinkCardEndpoints.CardsRoute}?id={one.AccountId}&id={two.AccountId}");

        sheet.Cards.Select(c => c.ParticipantId).Should().BeEquivalentTo([one.AccountId.ToString(), two.AccountId.ToString()],
            "the frontend sends repeated plain id=a&id=b");
    }

    [RequiresDockerFact]
    public async Task AnEmptyIdValue_IsANotFoundSkip_NeverEveryone()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        await _world.SeedParticipantAsync(exercise, "Would Be Everyone");

        await using var host = await StartHostAsync(exercise);
        using var client = host.Client(await LinkCardTestHost.SeedStaffSessionAsync(_world, staff, exercise));

        var sheet = await GetSheetAsync(client, $"{LinkCardEndpoints.CardsRoute}?id=");

        sheet.Cards.Should().BeEmpty("only a request with no id parameter at all means every participant");
        sheet.Skipped.Should().ContainSingle().Which.Reason.Should().Be(RosterCardSkipReasons.NotFound);
    }

    [RequiresDockerFact]
    public async Task MoreThan500Ids_Is400ProblemDetails_WithNoStore()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));

        await using var host = await StartHostAsync(exercise);
        using var client = host.Client(await LinkCardTestHost.SeedStaffSessionAsync(_world, staff, exercise));

        var query = string.Join("&", Enumerable.Range(0, 501).Select(_ => $"id={Guid.NewGuid()}"));
        using var response = await client.GetAsync($"{LinkCardEndpoints.CardsRoute}?{query}");

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        response.Headers.CacheControl!.NoStore.Should().BeTrue();
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
        (await ProblemDetailAsync(response)).Should().Contain("500");
        (await _world.CardEventsAsync(exercise)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task NoJoinBase_Is409ProblemDetails_WithNoStore_AndNoCard()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        await _world.SeedParticipantAsync(exercise, "Would Get A Card");

        await using var host = await StartHostAsync(exercise, frontendBase: null);
        using var client = host.Client(await LinkCardTestHost.SeedStaffSessionAsync(_world, staff, exercise));

        using var response = await client.GetAsync(LinkCardEndpoints.CardsRoute);

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        response.Headers.CacheControl!.NoStore.Should().BeTrue();
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
        (await ProblemDetailAsync(response)).Should().ContainEquivalentOf("join links are not configured");
        (await response.Content.ReadAsStringAsync()).Should().NotContain("/join/", "no card is produced");
    }

    [RequiresDockerFact]
    public async Task AnEvaluator_Is403()
    {
        var exercise = await _world.SeedExerciseAsync();
        var evaluator = await _world.SeedStaffAsync((exercise, "evaluator"));
        await _world.SeedParticipantAsync(exercise, "Someone");

        await using var host = await StartHostAsync(exercise);
        using var client = host.Client(await LinkCardTestHost.SeedStaffSessionAsync(_world, evaluator, exercise));

        using var response = await client.GetAsync(LinkCardEndpoints.CardsRoute);

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden, "evaluators observe; they do not hand out credentials");
        (await response.Content.ReadAsStringAsync()).Should().NotContain("/join/");
    }

    [RequiresDockerFact]
    public async Task AStaffUserNotAssignedToTheExercise_Is403()
    {
        var exercise = await _world.SeedExerciseAsync();
        var other = await _world.SeedExerciseAsync();
        var elsewhere = await _world.SeedStaffAsync((other, "controller"));

        await using var host = await StartHostAsync(exercise);
        using var client = host.Client(await LinkCardTestHost.SeedStaffSessionAsync(_world, elsewhere, exercise));

        using var response = await client.GetAsync(LinkCardEndpoints.CardsRoute);

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [RequiresDockerFact]
    public async Task AParticipantSession_NeverReachesIt_401()
    {
        var exercise = await _world.SeedExerciseAsync();
        await _world.SeedParticipantAsync(exercise, "Someone");

        await using var host = await StartHostAsync(exercise);
        using var client = host.Client(await LinkCardTestHost.SeedParticipantSessionAsync(_world, exercise));

        using var response = await client.GetAsync(LinkCardEndpoints.CardsRoute);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "a participant's live session is not a staff session");
        (await _world.CardEventsAsync(exercise)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task AnUnresolvedScope_Is401()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));

        await using var host = await StartHostAsync(scope: null);
        using var client = host.Client(await LinkCardTestHost.SeedStaffSessionAsync(_world, staff, exercise));

        using var response = await client.GetAsync(LinkCardEndpoints.CardsRoute);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [RequiresDockerFact]
    public async Task ACrossExerciseId_AndAnUnknownId_GiveTheSameStatusAndBody()
    {
        var exerciseA = await _world.SeedExerciseAsync();
        var exerciseB = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exerciseA, "controller"));
        var bob = await _world.SeedParticipantAsync(exerciseB, "Bob In B");
        var unknown = Guid.NewGuid();

        await using var host = await StartHostAsync(exerciseA);
        using var client = host.Client(await LinkCardTestHost.SeedStaffSessionAsync(_world, staff, exerciseA));

        using var cross = await client.GetAsync($"{LinkCardEndpoints.CardsRoute}?id={bob.AccountId}");
        using var missing = await client.GetAsync($"{LinkCardEndpoints.CardsRoute}?id={unknown}");

        cross.StatusCode.Should().Be(HttpStatusCode.OK);
        missing.StatusCode.Should().Be(cross.StatusCode);
        var crossBody = (await cross.Content.ReadAsStringAsync()).Replace(bob.AccountId.ToString(), "<id>", StringComparison.Ordinal);
        var missingBody = (await missing.Content.ReadAsStringAsync()).Replace(unknown.ToString(), "<id>", StringComparison.Ordinal);
        crossBody.Should().Be(missingBody, "another exercise's id is indistinguishable from an id that exists nowhere");
        crossBody.Should().NotContain(bob.Token!).And.NotContain("Bob In B");
    }

    [Fact]
    public async Task NoCredential_Is401_BeforeAnyDatabaseAccess()
    {
        // A never-connecting database: the staff gate refuses before any query runs.
        await using var host = await LinkCardTestHost.StartAsync(
            "Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;", new EphemeralDataProtectionProvider());
        host.ScopeTo(Guid.NewGuid());
        using var client = host.Client(bearerToken: null);

        using var response = await client.GetAsync(LinkCardEndpoints.CardsRoute);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "an anonymous caller never reaches the card sheet");
    }

    [Fact]
    public async Task OnlyGet_IsMapped()
    {
        await using var host = await LinkCardTestHost.StartAsync(
            "Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;", new EphemeralDataProtectionProvider());
        using var client = host.Client(bearerToken: null);

        using var response = await client.PostAsync(LinkCardEndpoints.CardsRoute, content: null);

        response.StatusCode.Should().Be(HttpStatusCode.MethodNotAllowed);
    }

    [Fact]
    public async Task ComposedIntoTheRealProgramHost_TheCardServiceResolves()
    {
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                [JoinUrlBuilder.FrontendBaseUrlKey] = LinkCardTestWorld.FrontendBase,
            }));
            builder.ConfigureTestServices(services =>
            {
                services.AddEasyLoginFoundation();
                services.AddLinkCards();
            });
        });

        using var scope = factory.Services.CreateScope();

        scope.ServiceProvider.GetRequiredService<LinkCardService>().Should().NotBeNull(
            "every collaborator the seam commit relies on (staff identity, clock, scoping, foundation) is in the real host");
        scope.ServiceProvider.GetRequiredService<QrSvgRenderer>().Should().BeSameAs(
            factory.Services.GetRequiredService<QrSvgRenderer>(), "the renderer is a stateless singleton");
    }

    private async Task<LinkCardTestHost> StartHostAsync(Guid? scope, string? frontendBase = LinkCardTestWorld.FrontendBase)
    {
        var host = await LinkCardTestHost.StartAsync(_world.Fixture.ConnectionString!, _world.KeyRing, frontendBase);
        host.ScopeTo(scope);
        return host;
    }

    private static async Task<RosterCardsDto> GetSheetAsync(HttpClient client, string url)
    {
        using var response = await client.GetAsync(url);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Headers.CacheControl!.NoStore.Should().BeTrue();

        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = body.RootElement;
        return new RosterCardsDto
        {
            ExerciseName = root.GetProperty("exerciseName").GetString()!,
            Cards = root.GetProperty("cards").EnumerateArray().Select(c => new RosterCardDto
            {
                ParticipantId = c.GetProperty("participantId").GetString()!,
                Name = c.GetProperty("name").GetString()!,
                SignInName = c.GetProperty("signInName").GetString()!,
                JoinUrl = c.GetProperty("joinUrl").GetString()!,
                QrSvgDataUri = c.GetProperty("qrSvgDataUri").GetString()!,
            }).ToList(),
            Skipped = root.GetProperty("skipped").EnumerateArray().Select(s => new RosterCardSkipDto
            {
                ParticipantId = s.GetProperty("participantId").GetString()!,
                Reason = s.GetProperty("reason").GetString()!,
            }).ToList(),
        };
    }

    private static async Task<string> ProblemDetailAsync(HttpResponseMessage response)
    {
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.GetProperty("detail").GetString()!;
    }
}
