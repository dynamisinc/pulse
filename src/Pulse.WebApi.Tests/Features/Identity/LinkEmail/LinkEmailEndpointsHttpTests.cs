namespace Pulse.WebApi.Tests.Features.Identity.LinkEmail;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.LinkEmail;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// easy-login/13 over HTTP: <c>POST /api/staff/roster/email-links</c> through the real filters and the real token-backed
/// staff-session accessor (<see cref="LinkEmailTestHost"/>). <c>200</c> in the frozen <c>RosterEmailResultDto</c> shape;
/// <c>400</c> ProblemDetails for every other body shape and over the cap; <c>401</c> with no staff session (a participant
/// session included); <c>403</c> for an evaluator or an unassigned staff user; <c>503</c> ProblemDetails ("Email delivery
/// is not configured") when dark, before the body is read; and <c>Cache-Control: no-store</c> on every answer, the
/// staff gate's 401/403 included. Plus the composition proof on the real <c>Program</c> host.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class LinkEmailEndpointsHttpTests
{
    private const string NeverConnects = "Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;";

    private readonly LinkEmailTestWorld _world;

    public LinkEmailEndpointsHttpTests(MsSqlContainerFixture fixture) => _world = new LinkEmailTestWorld(fixture);

    [RequiresDockerFact]
    public async Task AController_Gets200_InTheFrozenShape_WithNoStore()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        var jane = await _world.SeedParticipantAsync(exercise, "Jane Smith");
        var noEmail = await _world.SeedParticipantAsync(exercise, "No Email", email: string.Empty);
        var mailer = new FakeParticipantLinkMailer().Answer(jane.Email!, LinkMailSendOutcome.Sent);

        await using var host = await StartHostAsync(exercise, mailer);
        using var client = host.Client(await LinkEmailTestHost.SeedStaffSessionAsync(_world, staff, exercise));

        using var response = await LinkEmailTestHost.PostAsync(client, LinkEmailTestHost.EveryoneJson);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Headers.CacheControl!.NoStore.Should().BeTrue();
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/json");

        var text = await response.Content.ReadAsStringAsync();
        using var body = JsonDocument.Parse(text);
        body.RootElement.EnumerateObject().Select(p => p.Name).Should().Equal(["results"]);
        var results = body.RootElement.GetProperty("results").EnumerateArray().ToList();
        results.Should().HaveCount(2);

        results[0].EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
            ["participantId", "status"], "a sent result has no reason: an absent optional field is omitted, never null");
        results[0].GetProperty("participantId").GetString().Should().Be(jane.AccountId.ToString());
        results[0].GetProperty("status").GetString().Should().Be("sent");

        results[1].EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(["participantId", "status", "reason"]);
        results[1].GetProperty("participantId").GetString().Should().Be(noEmail.AccountId.ToString());
        results[1].GetProperty("status").GetString().Should().Be("skipped");
        results[1].GetProperty("reason").GetString().Should().Be("noEmail");

        text.Should().NotContain(jane.Email!).And.NotContain("/join/").And.NotContain("Jane Smith",
            "the response names ids and fixed reasons only");
    }

    [RequiresDockerFact]
    public async Task APlanner_Gets200_ForSelectedIds()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "planner"));
        var jane = await _world.SeedParticipantAsync(exercise, "Jane Smith");
        var mailer = new FakeParticipantLinkMailer();

        await using var host = await StartHostAsync(exercise, mailer);
        using var client = host.Client(await LinkEmailTestHost.SeedStaffSessionAsync(_world, staff, exercise));

        using var response = await LinkEmailTestHost.PostAsync(client, LinkEmailTestHost.IdsJson(jane.AccountId));

        response.StatusCode.Should().Be(HttpStatusCode.OK, "planners provision participants too (EL-13)");
        mailer.Messages.Should().ContainSingle();
    }

    [RequiresDockerFact]
    public async Task EveryOtherBodyShape_Is400ProblemDetails_WithNoStore_AndSendsNothing()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        var jane = await _world.SeedParticipantAsync(exercise, "Jane Smith");
        var mailer = new FakeParticipantLinkMailer();

        await using var host = await StartHostAsync(exercise, mailer);
        using var client = host.Client(await LinkEmailTestHost.SeedStaffSessionAsync(_world, staff, exercise));

        var tooMany = LinkEmailTestHost.IdsJson(Enumerable.Range(0, 101).Select(_ => (object)Guid.NewGuid()).ToArray());
        var bodies = new List<(string Body, string ContentType)>
        {
            ("not json", "text/plain"),
            ("{", "application/json"),
            ("null", "application/json"),
            ("{\"participantIds\":null}", "application/json"),
            ("{\"participantIds\":[]}", "application/json"),
            ("{\"participantIds\":[null]}", "application/json"),
            ("{\"participantIds\":[1]}", "application/json"),
            ("{\"participantIds\":\"" + jane.AccountId + "\"}", "application/json"),
            ("{\"ParticipantIds\":[\"" + jane.AccountId + "\"]}", "application/json"),
            ("{\"all\":true}", "application/json"),
            ("{\"participantIds\":[\"" + jane.AccountId + "\"],\"participantIds\":[]}", "application/json"),
            (tooMany, "application/json"),
        };

        foreach (var (body, contentType) in bodies)
        {
            using var response = await LinkEmailTestHost.PostAsync(client, body, contentType);

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "body {0} must be refused", body);
            response.Headers.CacheControl!.NoStore.Should().BeTrue();
            response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
            (await ProblemDetailAsync(response)).Should().NotBeNullOrWhiteSpace();
        }

        mailer.Messages.Should().BeEmpty("no refused body ever widens to everyone");
        (await _world.EmailEventsAsync(exercise)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task Unconfigured_Is503ProblemDetails_BeforeTheBodyIsRead_WithNoStore()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        await _world.SeedParticipantAsync(exercise, "Jane Smith");

        // No mailer supplied and no Email:* configuration: the host composes the REAL fail-closed null mailer.
        await using var host = await LinkEmailTestHost.StartAsync(
            _world.Fixture.ConnectionString!, _world.KeyRing, mailer: null, emailConfigured: false);
        host.ScopeTo(exercise);
        using var client = host.Client(await LinkEmailTestHost.SeedStaffSessionAsync(_world, staff, exercise));

        using var valid = await LinkEmailTestHost.PostAsync(client, LinkEmailTestHost.EveryoneJson);
        using var garbage = await LinkEmailTestHost.PostAsync(client, "not json", "text/plain");

        foreach (var response in new[] { valid, garbage })
        {
            response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
            response.Headers.CacheControl!.NoStore.Should().BeTrue();
            response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
            (await ProblemDetailAsync(response)).Should().Be("Email delivery is not configured");
        }

        host.Services.GetRequiredService<IParticipantLinkMailer>().Should().BeOfType<NullParticipantLinkMailer>();
        (await _world.EmailEventsAsync(exercise)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task AnEvaluator_Is403_BeforeTheBodyIsRead_AndLearnsNothing()
    {
        var exercise = await _world.SeedExerciseAsync();
        var evaluator = await _world.SeedStaffAsync((exercise, "evaluator"));
        await _world.SeedParticipantAsync(exercise, "Jane Smith");
        var mailer = new FakeParticipantLinkMailer();

        await using var host = await StartHostAsync(exercise, mailer);
        using var client = host.Client(await LinkEmailTestHost.SeedStaffSessionAsync(_world, evaluator, exercise));

        using var response = await LinkEmailTestHost.PostAsync(client, LinkEmailTestHost.EveryoneJson);
        using var garbage = await LinkEmailTestHost.PostAsync(client, "not json", "text/plain");

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden, "evaluators observe; they do not hand out credentials");
        garbage.StatusCode.Should().Be(HttpStatusCode.Forbidden, "the role gate runs before the body is read");
        foreach (var refusal in new[] { response, garbage })
        {
            (refusal.Headers.CacheControl?.NoStore).Should().BeTrue(
                "no-store runs FIRST, so the role gate's 403 is no-store too (Copilot review on #487)");
        }

        mailer.Messages.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task AStaffUserNotAssignedToTheExercise_Is403()
    {
        var exercise = await _world.SeedExerciseAsync();
        var other = await _world.SeedExerciseAsync();
        var elsewhere = await _world.SeedStaffAsync((other, "controller"));

        await using var host = await StartHostAsync(exercise, new FakeParticipantLinkMailer());
        using var client = host.Client(await LinkEmailTestHost.SeedStaffSessionAsync(_world, elsewhere, exercise));

        using var response = await LinkEmailTestHost.PostAsync(client, LinkEmailTestHost.EveryoneJson);

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (response.Headers.CacheControl?.NoStore).Should().BeTrue("the staff gate's 403 is no-store too");
    }

    [RequiresDockerFact]
    public async Task AParticipantSession_NeverReachesIt_401()
    {
        var exercise = await _world.SeedExerciseAsync();
        await _world.SeedParticipantAsync(exercise, "Someone");
        var mailer = new FakeParticipantLinkMailer();

        await using var host = await StartHostAsync(exercise, mailer);
        using var client = host.Client(await LinkEmailTestHost.SeedParticipantSessionAsync(_world, exercise));

        using var response = await LinkEmailTestHost.PostAsync(client, LinkEmailTestHost.EveryoneJson);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "a participant's live session is not a staff session");
        (response.Headers.CacheControl?.NoStore).Should().BeTrue("the staff gate's 401 is no-store too");
        mailer.Messages.Should().BeEmpty();
    }

    [Fact]
    public async Task NoCredential_Is401_WithNoStore_BeforeTheBodyTheMailerOrTheDatabaseIsTouched()
    {
        var mailer = new FakeParticipantLinkMailer();
        await using var host = await LinkEmailTestHost.StartAsync(NeverConnects, new EphemeralDataProtectionProvider(), mailer);
        host.ScopeTo(Guid.NewGuid());
        using var client = host.Client(bearerToken: null);

        using var valid = await LinkEmailTestHost.PostAsync(client, LinkEmailTestHost.EveryoneJson);
        using var garbage = await LinkEmailTestHost.PostAsync(client, "not json", "text/plain");

        valid.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        garbage.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "the gate runs before the body is read");
        foreach (var refusal in new[] { valid, garbage })
        {
            // Copilot review on #487: NoStoreEndpointFilter is the FIRST filter (as on the card and roster routes), so a
            // refusal the staff gate writes before the handler runs is no-store too.
            (refusal.Headers.CacheControl?.NoStore).Should().BeTrue("every answer of this route is no-store, the gate's 401 included");
        }

        mailer.Messages.Should().BeEmpty();
    }

    [Fact]
    public async Task NoCredential_OnAnUnconfiguredHost_Is401_NotA503()
    {
        // An anonymous caller must not even learn whether email is configured.
        await using var host = await LinkEmailTestHost.StartAsync(
            NeverConnects, new EphemeralDataProtectionProvider(), mailer: null, emailConfigured: false);
        host.ScopeTo(Guid.NewGuid());
        using var client = host.Client(bearerToken: null);

        using var response = await LinkEmailTestHost.PostAsync(client, LinkEmailTestHost.EveryoneJson);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (response.Headers.CacheControl?.NoStore).Should().BeTrue("the gate's 401 is no-store too");
    }

    [Fact]
    public async Task OnlyPost_IsMapped()
    {
        await using var host = await LinkEmailTestHost.StartAsync(NeverConnects, new EphemeralDataProtectionProvider(), mailer: null);
        using var client = host.Client(bearerToken: null);

        using var response = await client.GetAsync(LinkEmailEndpoints.EmailLinksRoute);

        response.StatusCode.Should().Be(HttpStatusCode.MethodNotAllowed);
    }

    [Fact]
    public async Task ComposedIntoTheRealProgramHost_AddLinkEmailAlone_ResolvesTheService_AndStaysDarkWithoutConfig()
    {
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                [JoinUrlBuilder.FrontendBaseUrlKey] = LinkEmailTestWorld.FrontendBase,
            }));
            builder.ConfigureTestServices(services => services.AddLinkEmail());
        });

        using var scope = factory.Services.CreateScope();

        scope.ServiceProvider.GetRequiredService<LinkEmailService>().Should().NotBeNull(
            "every collaborator the seam commit relies on (staff identity, clock, scoping, kernel) is in the real host");
        factory.Services.GetRequiredService<IParticipantLinkMailer>().Should().BeOfType<NullParticipantLinkMailer>(
            "with no Email:Endpoint the host is dark");
    }

    [Fact]
    public async Task ComposedIntoTheRealProgramHost_WithEmailConfigured_TheMailerIsTheKeylessAcsOne()
    {
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                [LinkEmailSettings.EndpointKey] = LinkEmailTestWorld.AcsEndpoint,
                [LinkEmailSettings.SenderAddressKey] = LinkEmailTestWorld.Sender,
            }));
            builder.ConfigureTestServices(services => services.AddLinkEmail());
        });

        factory.Services.GetRequiredService<IParticipantLinkMailer>().Should().BeOfType<AcsParticipantLinkMailer>();
        factory.Services.GetRequiredService<LinkEmailClientSettings>().Credential.GetType().Name.Should().BeOneOf(
            ["ManagedIdentityCredential", "DefaultAzureCredential"], "the media slice's keyless credential selection, never a key");
    }

    [Fact]
    public async Task TheRoute_CarriesItsBodyLimit_AndIsNotAnonymous()
    {
        await using var host = await LinkEmailTestHost.StartAsync(NeverConnects, new EphemeralDataProtectionProvider(), mailer: null);
        var endpoint = host.Services.GetRequiredService<EndpointDataSource>().Endpoints
            .OfType<RouteEndpoint>()
            .Single(e => e.RoutePattern.RawText == LinkEmailEndpoints.EmailLinksRoute);

        endpoint.Metadata.GetMetadata<IRequestSizeLimitMetadata>()!.MaxRequestBodySize.Should().Be(LinkEmailEndpoints.MaxRequestBodyBytes);
        endpoint.Metadata.GetMetadata<Microsoft.AspNetCore.Authorization.IAllowAnonymous>().Should().BeNull();
    }

    private async Task<LinkEmailTestHost> StartHostAsync(Guid? scope, IParticipantLinkMailer mailer)
    {
        var host = await LinkEmailTestHost.StartAsync(_world.Fixture.ConnectionString!, _world.KeyRing, mailer);
        host.ScopeTo(scope);
        return host;
    }

    private static async Task<string> ProblemDetailAsync(HttpResponseMessage response)
    {
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.GetProperty("detail").GetString()!;
    }
}
