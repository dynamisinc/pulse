namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Diagnostics;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using static Pulse.WebApi.Tests.Features.Social.PostMediaSeed;

/// <summary>
/// The Wave 1b DoS fix for <c>POST /api/posts</c>, reachable by any participant session. The sanitizer used to be
/// quadratic on nested tags, and the route had no body limit beyond Kestrel's ~30 MB. Now there are three bounds:
/// <list type="number">
/// <item>the raw text and alt lengths are capped BEFORE the sanitizer runs, in the ingest funnel itself, so the
/// in-process engine publish is bounded too;</item>
/// <item>the route carries a 64 KiB request-body limit, enforced by the real server while the body is read;</item>
/// <item>the sanitizer is linear (its timing guard is in <c>PostSanitizerTests</c>).</item>
/// </list>
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PostWriteDosGuardTests
{
    private readonly MsSqlContainerFixture _fixture;

    public PostWriteDosGuardTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [Fact]
    public void TheCaps_AreGenerousMultiplesOfTheirBounds_AndTheBodyLimitFitsTheLargestLegitimatePost()
    {
        PostIngestService.MaxRawTextLength.Should().Be(4 * PostIngestService.TextLengthCeiling);
        PostIngestService.MaxRawAltLength.Should().Be(4 * PostMediaItem.MaxAltLength);
        PostWriteEndpoints.MaxRequestBodyBytes.Should().Be(64 * 1024);

        // The largest LEGITIMATE body: the text ceiling, four 1,000-character alts and generous JSON overhead.
        var largestLegitimate = PostIngestService.TextLengthCeiling + (4 * (PostMediaItem.MaxAltLength + 200)) + 2_000;
        largestLegitimate.Should().BeLessThan((int)PostWriteEndpoints.MaxRequestBodyBytes);
    }

    [Fact]
    public void ProgramCs_MapsPostApiPosts_WithThe64KiBRequestSizeLimit()
    {
        using var factory = new DummyDatabaseFactory();
        var endpoint = factory.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>()
            .Single(e => string.Equals(e.RoutePattern.RawText, "/api/posts", StringComparison.OrdinalIgnoreCase)
                && (e.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains("POST") ?? false));

        endpoint.Metadata.GetMetadata<IRequestSizeLimitMetadata>()?.MaxRequestBodySize.Should().Be(
            PostWriteEndpoints.MaxRequestBodyBytes, "endpoint routing applies it to the server's body-size feature");
    }

    [RequiresDockerFact]
    public async Task RawTextOverTheCap_Is400BeforeSanitizing_AndWritesNothing_WhileTextAtTheCapIsAccepted()
    {
        var world = await SeedWorldAsync(_fixture);
        await using var factory = new PostMediaWebApplicationFactory(_fixture.ConnectionString!);
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        using var over = await client.PostAsync(PostsUri, Json(Body(text: new string('a', PostIngestService.MaxRawTextLength + 1))));
        over.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await over.Content.ReadAsStringAsync()).Should().Contain($"text must be at most {PostIngestService.MaxRawTextLength} characters.");
        await using (var read = _fixture.CreateContext())
        {
            (await read.Posts.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == world.Exercise)).Should().Be(0);
        }

        using var atCap = await client.PostAsync(PostsUri, Json(Body(text: new string('a', PostIngestService.MaxRawTextLength))));
        atCap.StatusCode.Should().Be(HttpStatusCode.Created, "the cap is inclusive and generous — no legitimate post is refused");
    }

    [RequiresDockerFact]
    public async Task AdversarialNestingAtTheRawCap_IsSanitizedQuickly_AndStoredInert()
    {
        var world = await SeedWorldAsync(_fixture);
        await using var factory = new PostMediaWebApplicationFactory(_fixture.ConnectionString!);
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);
        var depth = (PostIngestService.MaxRawTextLength - 40) / 3;
        var text = "Hi " + new string('<', depth) + string.Concat(Enumerable.Repeat("b>", depth - 1)) + "img src=x onerror=alert(1)> there";
        text.Length.Should().BeLessThanOrEqualTo(PostIngestService.MaxRawTextLength);

        var stopwatch = Stopwatch.StartNew();
        using var created = await client.PostAsync(PostsUri, Json(Body(text: text)));
        stopwatch.Stop();

        created.StatusCode.Should().Be(HttpStatusCode.Created);
        stopwatch.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(5), "the whole request, sanitizer included, stays cheap");
        await using var read = _fixture.CreateContext();
        (await read.Posts.IgnoreQueryFilters().SingleAsync(p => p.ExerciseId == world.Exercise)).Body.Should().Be("Hi  there");
    }

    [RequiresDockerFact]
    public async Task RawAltOverTheCap_Is400WithTheAltLengthMessage_AndWritesNothing()
    {
        var world = await SeedWorldAsync(_fixture);
        var image = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, world.ParticipantHuman);
        await using var factory = new PostMediaWebApplicationFactory(_fixture.ConnectionString!);
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        using var rawOver = await client.PostAsync(PostsUri, Json(Body(media: new[] { Item(image.Id, alt: new string('<', PostIngestService.MaxRawAltLength + 1)) })));
        using var sanitizedOver = await client.PostAsync(PostsUri, Json(Body(media: new[] { Item(image.Id, alt: new string('a', PostMediaItem.MaxAltLength + 1)) })));

        rawOver.StatusCode.Should().Be(HttpStatusCode.BadRequest, "an oversized raw alt is refused before the sanitizer sees it");
        var message = await rawOver.Content.ReadAsStringAsync();
        message.Should().Contain("alt text must be at most 1000 characters.");
        sanitizedOver.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await sanitizedOver.Content.ReadAsStringAsync()).Should().Be(message, "one message for raw and sanitized overlength");

        await using var read = _fixture.CreateContext();
        (await read.Posts.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == world.Exercise)).Should().Be(0);
        (await read.PostMediaItems.IgnoreQueryFilters().CountAsync(i => i.ExerciseId == world.Exercise)).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task TheInProcessEnginePath_IsCappedToo_ItNeverCrossesTheHttpBodyLimit()
    {
        var exerciseId = Guid.NewGuid();
        var scope = new ExerciseContext { CurrentExerciseId = exerciseId };
        await using var context = _fixture.CreateContext(scope);
        var service = new PostIngestService(context, scope, new FakeFeedBroadcaster());

        var result = await service.IngestAsync(
            new CreatePostRequest
            {
                Text = new string('x', PostIngestService.MaxRawTextLength + 1),
                ScenarioTime = "2033-06-14T09:00:00-05:00",
                TimeZone = "America/Chicago",
            },
            new PostAttribution { AuthorPersonaId = Guid.NewGuid(), Origin = "engine", ActingHumanId = string.Empty });

        result.Outcome.Should().Be(PostIngestOutcome.Invalid);
        result.ValidationError.Should().Be($"text must be at most {PostIngestService.MaxRawTextLength} characters.");
    }

    [RequiresDockerFact]
    public async Task ABodyOverTheRouteLimit_IsRefusedByTheRealServer_WithA413_AndWritesNothing()
    {
        // TestServer does not enforce body-size limits; Kestrel does. So this boots the real host on Kestrel.
        var world = await SeedWorldAsync(_fixture);
        await using var factory = new PostMediaWebApplicationFactory(_fixture.ConnectionString!);
        factory.UseKestrel(0);
        factory.StartServer();
        var address = factory.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First();

        using var client = new HttpClient { BaseAddress = new Uri(address) };
        client.DefaultRequestHeaders.Host = world.Host;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", world.ParticipantToken);

        using var underLimit = await client.PostAsync(PostsUri, Json(Body(text: "a normal post over real Kestrel")));
        underLimit.StatusCode.Should().Be(HttpStatusCode.Created, "precondition: the session and host resolve over Kestrel");

        var oversized = new string('a', (int)PostWriteEndpoints.MaxRequestBodyBytes + 1024);
        using var content = new StringContent($"{{\"text\":\"{oversized}\",\"timeZone\":\"UTC\"}}", Encoding.UTF8, "application/json");
        using var over = await client.PostAsync(PostsUri, content);

        over.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge, "the body is refused while it is read, before binding or sanitizing");
        await using var read = _fixture.CreateContext();
        (await read.Posts.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == world.Exercise)).Should().Be(1, "only the normal post");
    }

    /// <summary>The real host on a never-connecting database, for endpoint metadata only.</summary>
    private sealed class DummyDatabaseFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

        public DummyDatabaseFactory() =>
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, "Server=nonexistent;Database=pulse;Trusted_Connection=False;");

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}
