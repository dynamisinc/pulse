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
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;

/// <summary>
/// easy-login/04 over HTTP: <c>POST /api/staff/roster/cards</c> (EL-20) through the real filters and the real
/// token-backed staff-session accessor (<see cref="LinkCardTestHost"/>). <c>200</c> in the frozen <c>RosterCardsDto</c>
/// shape for <c>{ participantIds }</c> or <c>{ all: true }</c>; <c>400</c> ProblemDetails for every other body shape and
/// over the id cap; <c>413</c> over 64 KiB; <c>409</c> with no join base; <c>401</c> with no staff session (a participant
/// session included); <c>403</c> for an evaluator or an unassigned staff user; and <c>Cache-Control: no-store</c> on
/// every answer the handler writes. The 500-id and 64 KiB tests run on REAL Kestrel, where request limits apply.
/// Plus the composition proof on the real <c>Program</c> host.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class LinkCardEndpointsHttpTests
{
    private const string NeverConnects = "Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;";

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

        using var response = await LinkCardTestHost.PostCardsAsync(client, LinkCardTestHost.AllJson);

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

        using var response = await LinkCardTestHost.PostCardsAsync(client, LinkCardTestHost.AllJson);

        response.StatusCode.Should().Be(HttpStatusCode.OK, "planners provision participants too (EL-13)");
    }

    [RequiresDockerFact]
    public async Task ParticipantIds_LimitTheSheet_DeduplicatedCaseInsensitively()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        var one = await _world.SeedParticipantAsync(exercise, "One Person");
        var two = await _world.SeedParticipantAsync(exercise, "Two Person");
        await _world.SeedParticipantAsync(exercise, "Not Requested");

        await using var host = await StartHostAsync(exercise);
        using var client = host.Client(await LinkCardTestHost.SeedStaffSessionAsync(_world, staff, exercise));

        var sheet = await PostSheetAsync(
            client, LinkCardTestHost.IdsJson(one.AccountId, two.AccountId, one.AccountId.ToString().ToUpperInvariant()));

        sheet.Cards.Select(c => c.ParticipantId).Should().Equal(
            [one.AccountId.ToString(), two.AccountId.ToString()], "only the requested accounts, once each, by name");
        sheet.Skipped.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task ABlankOrMalformedId_IsANotFoundSkip_EchoedBack_NeverEveryone()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        await _world.SeedParticipantAsync(exercise, "Would Be Everyone");

        await using var host = await StartHostAsync(exercise);
        using var client = host.Client(await LinkCardTestHost.SeedStaffSessionAsync(_world, staff, exercise));

        var overLong = new string('x', 300);
        var sheet = await PostSheetAsync(client, LinkCardTestHost.IdsJson(string.Empty, "not-a-guid", overLong));

        sheet.Cards.Should().BeEmpty("only { all: true } means every participant");
        sheet.Skipped.Select(s => (s.ParticipantId, s.Reason)).Should().Equal(
            [
                (string.Empty, RosterCardSkipReasons.NotFound),
                ("not-a-guid", RosterCardSkipReasons.NotFound),
                (overLong[..LinkCardService.MaxEchoedIdLength], RosterCardSkipReasons.NotFound),
            ],
            "an over-long id is still a skip (never a 400 that fails the sheet), echoed cut to 64 characters");
    }

    [RequiresDockerTheory]
    [InlineData("{\"participantIds\":[\"00000000-0000-0000-0000-000000000001\"],\"extra\":1}", "application/json", "an unknown property")]
    [InlineData("{\"participantIds\":[]}", "application/json", "an empty participantIds")]
    [InlineData("{\"participantIds\":[\"00000000-0000-0000-0000-000000000001\"],\"all\":true}", "application/json", "both members")]
    [InlineData("{}", "application/json", "neither member")]
    [InlineData("{\"all\":false}", "application/json", "all other than true")]
    [InlineData("{\"all\":null}", "application/json", "an explicit null all")]
    [InlineData("{\"participantIds\":null,\"all\":true}", "application/json", "an explicit null participantIds beside all")]
    [InlineData("{\"participantIds\":[\"00000000-0000-0000-0000-000000000001\"],\"all\":null}", "application/json", "an explicit null all beside participantIds")]
    [InlineData("{\"participantIds\":null}", "application/json", "an explicit null participantIds")]
    [InlineData("{\"participantIds\":[\"\\uD83D\"]}", "application/json", "an id that is not valid UTF-16")]
    [InlineData("{\"all\":\"true\"}", "application/json", "all as a string")]
    [InlineData("{\"all\":1}", "application/json", "all as a number")]
    [InlineData("{\"participantIds\":\"00000000-0000-0000-0000-000000000001\"}", "application/json", "participantIds as a string")]
    [InlineData("{\"participantIds\":[1]}", "application/json", "a numeric id")]
    [InlineData("{\"participantIds\":[null]}", "application/json", "a null id")]
    [InlineData("{\"ParticipantIds\":[\"00000000-0000-0000-0000-000000000001\"]}", "application/json", "a mis-cased property")]
    [InlineData("{\"All\":true}", "application/json", "a mis-cased all")]
    [InlineData("{\"id\":[\"00000000-0000-0000-0000-000000000001\"]}", "application/json", "the old id spelling")]
    [InlineData("{\"ids\":[\"00000000-0000-0000-0000-000000000001\"]}", "application/json", "an ids spelling")]
    [InlineData("{\"all\":true,\"all\":true}", "application/json", "a repeated property")]
    [InlineData("{\"all\":true,}", "application/json", "a trailing comma")]
    [InlineData("{\"all\":true} {}", "application/json", "trailing content")]
    [InlineData("{/*c*/\"all\":true}", "application/json", "a comment")]
    [InlineData("[{\"all\":true}]", "application/json", "an array root")]
    [InlineData("\"all\"", "application/json", "a string root")]
    [InlineData("null", "application/json", "a JSON null")]
    [InlineData("", "application/json", "an empty body")]
    [InlineData("{\"all\":tru", "application/json", "malformed JSON")]
    [InlineData("{\"all\":true}", "text/plain", "a non-JSON content type")]
    [InlineData("all=true", "application/x-www-form-urlencoded", "a form body")]
    public async Task EveryOtherBodyShape_Is400ProblemDetails_WithNoStore(string body, string contentType, string why)
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        await _world.SeedParticipantAsync(exercise, "Would Get A Card");

        await using var host = await StartHostAsync(exercise);
        using var client = host.Client(await LinkCardTestHost.SeedStaffSessionAsync(_world, staff, exercise));

        using var response = await LinkCardTestHost.PostCardsAsync(client, body, contentType);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "{0} is not exactly { participantIds } or { all: true }", why);
        response.Headers.CacheControl!.NoStore.Should().BeTrue();
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
        (await ProblemDetailAsync(response)).Should().NotBeNullOrWhiteSpace("a 400 says what to send ({0})", why);
        (await response.Content.ReadAsStringAsync()).Should().NotContain("/join/", "no card is produced ({0})", why);
        (await _world.CardEventsAsync(exercise)).Should().BeEmpty("a refused body generates no sheet ({0})", why);
    }

    [RequiresDockerFact]
    public async Task MoreThan500Ids_Is400ProblemDetails_WithNoStore()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));

        await using var host = await StartHostAsync(exercise);
        using var client = host.Client(await LinkCardTestHost.SeedStaffSessionAsync(_world, staff, exercise));

        using var response = await LinkCardTestHost.PostCardsAsync(
            client, LinkCardTestHost.IdsJson(Enumerable.Range(0, 501).Select(_ => (object)Guid.NewGuid()).ToArray()));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        response.Headers.CacheControl!.NoStore.Should().BeTrue();
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
        (await ProblemDetailAsync(response)).Should().Contain("500");
        (await _world.CardEventsAsync(exercise)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task OnRealKestrel_500Ids_Is200()
    {
        // The EL-20 regression: 500 GUIDs (~20 KB) blew Kestrel's 8 KB request line as a query string. In a body they
        // fit the 64 KiB limit with room to spare. TestServer has no request line, so only real Kestrel proves it.
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        var people = new List<SeededParticipant>();
        for (var i = 0; i < 3; i++)
        {
            people.Add(await _world.SeedParticipantAsync(exercise, $"Kestrel Person {i}"));
        }

        var ids = people.Select(p => (object)p.AccountId)
            .Concat(Enumerable.Range(0, 497).Select(_ => (object)Guid.NewGuid()))
            .ToArray();
        ids.Should().HaveCount(500);

        await using var host = await StartHostAsync(exercise, realKestrel: true);
        using var client = host.Client(await LinkCardTestHost.SeedStaffSessionAsync(_world, staff, exercise));

        var sheet = await PostSheetAsync(client, LinkCardTestHost.IdsJson(ids));

        sheet.Cards.Select(c => c.ParticipantId).Should().BeEquivalentTo(people.Select(p => p.AccountId.ToString()));
        sheet.Skipped.Should().HaveCount(497).And.OnlyContain(s => s.Reason == RosterCardSkipReasons.NotFound);
        sheet.Cards.Should().OnlyContain(c => FrontendQrGate.Admits(c.QrSvgDataUri));
    }

    [RequiresDockerFact]
    public async Task OnRealKestrel_ABodyOver64KiB_Is413ProblemDetails_WithNoStore()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));

        await using var host = await StartHostAsync(exercise, realKestrel: true);
        using var client = host.Client(await LinkCardTestHost.SeedStaffSessionAsync(_world, staff, exercise));

        // ~78 KB: over the route's 64 KiB limit (and over 500 ids, but the body limit refuses it while it is read).
        var oversized = LinkCardTestHost.IdsJson(Enumerable.Range(0, 2000).Select(_ => (object)Guid.NewGuid()).ToArray());
        oversized.Length.Should().BeGreaterThan((int)LinkCardEndpoints.MaxRequestBodyBytes);

        using var response = await LinkCardTestHost.PostCardsAsync(client, oversized);

        response.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge, "the route's body is bounded at 64 KiB");
        response.Headers.CacheControl!.NoStore.Should().BeTrue();
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
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

        using var response = await LinkCardTestHost.PostCardsAsync(client, LinkCardTestHost.AllJson);

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

        using var response = await LinkCardTestHost.PostCardsAsync(client, LinkCardTestHost.AllJson);
        using var garbage = await LinkCardTestHost.PostCardsAsync(client, "{\"all\":tru", "text/plain");
        using var oversized = await LinkCardTestHost.PostCardsAsync(
            client, LinkCardTestHost.IdsJson(Enumerable.Range(0, 2000).Select(_ => (object)Guid.NewGuid()).ToArray()));

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden, "evaluators observe; they do not hand out credentials");
        (await response.Content.ReadAsStringAsync()).Should().NotContain("/join/");
        garbage.StatusCode.Should().Be(
            HttpStatusCode.Forbidden, "the role gate runs before the body is read, so a bad body changes nothing for an evaluator");
        oversized.StatusCode.Should().Be(HttpStatusCode.Forbidden, "nor does an oversized one: it is never read");
        (await _world.CardEventsAsync(exercise)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task AStaffUserNotAssignedToTheExercise_Is403()
    {
        var exercise = await _world.SeedExerciseAsync();
        var other = await _world.SeedExerciseAsync();
        var elsewhere = await _world.SeedStaffAsync((other, "controller"));

        await using var host = await StartHostAsync(exercise);
        using var client = host.Client(await LinkCardTestHost.SeedStaffSessionAsync(_world, elsewhere, exercise));

        using var response = await LinkCardTestHost.PostCardsAsync(client, LinkCardTestHost.AllJson);

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [RequiresDockerFact]
    public async Task AParticipantSession_NeverReachesIt_401()
    {
        var exercise = await _world.SeedExerciseAsync();
        await _world.SeedParticipantAsync(exercise, "Someone");

        await using var host = await StartHostAsync(exercise);
        using var client = host.Client(await LinkCardTestHost.SeedParticipantSessionAsync(_world, exercise));

        using var response = await LinkCardTestHost.PostCardsAsync(client, LinkCardTestHost.AllJson);

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

        using var response = await LinkCardTestHost.PostCardsAsync(client, LinkCardTestHost.AllJson);

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

        using var cross = await LinkCardTestHost.PostCardsAsync(client, LinkCardTestHost.IdsJson(bob.AccountId));
        using var missing = await LinkCardTestHost.PostCardsAsync(client, LinkCardTestHost.IdsJson(unknown));

        cross.StatusCode.Should().Be(HttpStatusCode.OK);
        missing.StatusCode.Should().Be(cross.StatusCode);
        var crossBody = (await cross.Content.ReadAsStringAsync()).Replace(bob.AccountId.ToString(), "<id>", StringComparison.Ordinal);
        var missingBody = (await missing.Content.ReadAsStringAsync()).Replace(unknown.ToString(), "<id>", StringComparison.Ordinal);
        crossBody.Should().Be(missingBody, "another exercise's id is indistinguishable from an id that exists nowhere");
        crossBody.Should().NotContain(bob.Token!).And.NotContain("Bob In B");
    }

    [Fact]
    public async Task NoCredential_Is401_BeforeTheBodyOrTheDatabaseIsTouched()
    {
        // A never-connecting database and a body that is not even JSON: the staff gate refuses first, so neither the
        // database nor the body is read (an unauthorized caller learns nothing about the body rules).
        await using var host = await LinkCardTestHost.StartAsync(NeverConnects, new EphemeralDataProtectionProvider());
        host.ScopeTo(Guid.NewGuid());
        using var client = host.Client(bearerToken: null);

        using var valid = await LinkCardTestHost.PostCardsAsync(client, LinkCardTestHost.AllJson);
        using var garbage = await LinkCardTestHost.PostCardsAsync(client, "not json", "text/plain");

        valid.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "an anonymous caller never reaches the card sheet");
        garbage.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "the gate runs before the body is read");
    }

    [Fact]
    public async Task OnlyPost_IsMapped_TheOldGetIsGone()
    {
        await using var host = await LinkCardTestHost.StartAsync(NeverConnects, new EphemeralDataProtectionProvider());
        using var client = host.Client(bearerToken: null);

        using var response = await client.GetAsync($"{LinkCardEndpoints.CardsRoute}?id={Guid.NewGuid()}");

        response.StatusCode.Should().Be(HttpStatusCode.MethodNotAllowed, "EL-20 replaced GET ?id= with a POST body");
    }

    [Fact]
    public async Task ComposedIntoTheRealProgramHost_AddLinkCardsAlone_ResolvesTheService()
    {
        // AddLinkCards() brings the easy-login kernel itself (S-4): no other line is needed for the service to resolve.
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                [JoinUrlBuilder.FrontendBaseUrlKey] = LinkCardTestWorld.FrontendBase,
            }));
            builder.ConfigureTestServices(services => services.AddLinkCards());
        });

        using var scope = factory.Services.CreateScope();

        scope.ServiceProvider.GetRequiredService<LinkCardService>().Should().NotBeNull(
            "every collaborator the seam commit relies on (staff identity, clock, scoping, kernel) is in the real host");
        scope.ServiceProvider.GetRequiredService<QrSvgRenderer>().Should().BeSameAs(
            factory.Services.GetRequiredService<QrSvgRenderer>(), "the renderer is a stateless singleton");
    }

    private async Task<LinkCardTestHost> StartHostAsync(
        Guid? scope,
        string? frontendBase = LinkCardTestWorld.FrontendBase,
        bool realKestrel = false)
    {
        var host = await LinkCardTestHost.StartAsync(_world.Fixture.ConnectionString!, _world.KeyRing, frontendBase, realKestrel);
        host.ScopeTo(scope);
        return host;
    }

    private static async Task<RosterCardsDto> PostSheetAsync(HttpClient client, string json)
    {
        using var response = await LinkCardTestHost.PostCardsAsync(client, json);
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
