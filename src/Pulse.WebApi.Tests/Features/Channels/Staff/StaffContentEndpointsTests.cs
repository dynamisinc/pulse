namespace Pulse.WebApi.Tests.Features.Channels.Staff;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Pulse.WebApi.Features.Channels;
using Pulse.WebApi.Features.Channels.Alerts;
using Pulse.WebApi.Features.Channels.Content.Staff;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Channels.Publish;
using Pulse.WebApi.Tests.Features.Injects;
using Xunit;

/// <summary>
/// Channels-foundation story 07 (#703) over HTTP on real SQL Server: <c>/api/content-items*</c> behind the SHIPPED staff +
/// controller-role filters, the shared <c>content-publish</c> bucket, and the always-Critical isolation (another
/// exercise's id is exactly the unknown-id 404). Proves the list, reorder and preview queries translate.
/// </summary>
/// <remarks>
/// Rides <see cref="InjectTestHost"/> (persistence, scoping, staff identity, the principal the rate limiter partitions on,
/// and <c>UseRateLimiter()</c>) with <c>AddChannels()</c> + <c>MapChannels()</c> and one test <c>article</c> kind.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class StaffContentEndpointsTests
{
    private const int OverTheLimit = ContentPublishRateLimiterPolicy.TokenLimit + 10;

    private readonly MsSqlContainerFixture _fixture;

    public StaffContentEndpointsTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task EveryRoute_IsStaffOnly_AndMutationsControllerOnly()
    {
        await using var host = await StartAsync();
        var exercise = await host.SeedExerciseAsync();
        var outletId = await SeedOutletAsync(host, exercise.ExerciseId);
        var evaluator = await host.AddStaffAsync(exercise.ExerciseId, "evaluator", "Eve Evaluator");
        var stranger = (await host.SeedExerciseAsync()).StaffUserId; // staff, but assigned elsewhere
        host.ActAs(exercise.ExerciseId, exercise.StaffUserId);
        var id = await CreateOkAsync(host, outletId);

        host.ActAs(exercise.ExerciseId, staffUserId: null); // a participant: scope, no staff session
        (await host.Client.GetAsync(Uri("/api/content-items"))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await host.Client.GetAsync(Uri($"/api/content-items/{id}/preview"))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await host.Client.PostAsJsonAsync("/api/content-items", Article(outletId))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await PostAsync(host, $"/api/content-items/{id}/publish")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        host.ActAs(exerciseId: null, staffUserId: null); // anonymous
        (await host.Client.GetAsync(Uri("/api/content-items"))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await host.Client.DeleteAsync(Uri($"/api/content-items/{id}"))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        host.ActAs(exercise.ExerciseId, evaluator);
        (await host.Client.GetAsync(Uri("/api/content-items"))).StatusCode.Should().Be(HttpStatusCode.OK, "any assigned staff role reads");
        (await host.Client.GetAsync(Uri($"/api/content-items/{id}/preview"))).StatusCode.Should().Be(HttpStatusCode.OK);
        (await PostAsync(host, $"/api/content-items/{id}/publish")).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await host.Client.PostAsJsonAsync("/api/content-items/feature/reorder", new { ids = new[] { id } }))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);

        host.ActAs(exercise.ExerciseId, stranger);
        (await host.Client.GetAsync(Uri("/api/content-items"))).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        host.ActAs(exercise.ExerciseId, exercise.StaffUserId);
        (await GetItemAsync(host, id)).GetProperty("status").GetString().Should().Be("draft", "no refused call changed anything");
    }

    [RequiresDockerFact]
    public async Task TheStaffLifecycle_RoundTripsOnRealSql()
    {
        await using var host = await StartAsync();
        var exercise = await host.SeedExerciseAsync();
        var outletId = await SeedOutletAsync(host, exercise.ExerciseId);
        host.ActAs(exercise.ExerciseId, exercise.StaffUserId);

        // origin / actingHumanId / exerciseId in a body are not request fields: identity and scope are the session's.
        var spoof = await host.Client.PostAsJsonAsync("/api/content-items", new
        {
            kind = "article",
            outletId,
            headline = "Spoofed attribution",
            bodyHtml = "<p>x</p>",
            origin = "participant",
            actingHumanId = "someone-else",
            exerciseId = Guid.NewGuid(),
        });
        spoof.StatusCode.Should().Be(HttpStatusCode.Created);
        var spoofed = await spoof.Content.ReadFromJsonAsync<JsonElement>();
        spoofed.GetProperty("origin").GetString().Should().Be("controller");
        spoofed.GetProperty("actingHumanId").GetString().Should().Be(exercise.StaffUserId.ToString());
        (await host.Client.DeleteAsync(Uri($"/api/content-items/{spoofed.GetProperty("id").GetString()}")))
            .StatusCode.Should().Be(HttpStatusCode.NoContent);

        var first = await CreateOkAsync(host, outletId, "Water main break on Elm");
        host.Time.Advance(TimeSpan.FromSeconds(5));
        var second = await CreateOkAsync(host, outletId, "Boil-water notice issued");

        var list = await host.Client.GetFromJsonAsync<JsonElement>("/api/content-items?channel=news&status=draft");
        list.EnumerateArray().Select(i => i.GetProperty("id").GetString()).Should().Equal(second, first);
        list[0].GetProperty("actingHumanId").GetString().Should().Be(exercise.StaffUserId.ToString());
        list[0].GetProperty("origin").GetString().Should().Be("controller");

        // A stale version is a 409 carrying the current item; a bad kind is a readable 400.
        var stale = await host.Client.PutAsJsonAsync($"/api/content-items/{first}", Article(outletId, "Stale", version: 99));
        stale.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await stale.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("item").GetProperty("version").GetInt32().Should().Be(1);
        var invalid = await host.Client.PostAsJsonAsync("/api/content-items", new { kind = "sonnet", outletId, headline = "x" });
        invalid.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await invalid.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("detail").GetString().Should().Contain("sonnet");

        var published = await PostAsync(host, $"/api/content-items/{first}/publish", new { });
        published.StatusCode.Should().Be(HttpStatusCode.OK, await published.Content.ReadAsStringAsync());
        var body = await published.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("item").GetProperty("status").GetString().Should().Be("published");
        body.GetProperty("sideEffectWarnings").GetArrayLength().Should().Be(0);
        (await PostAsync(host, $"/api/content-items/{second}/publish")).StatusCode.Should().Be(HttpStatusCode.OK);

        var reorder = await host.Client.PostAsJsonAsync("/api/content-items/feature/reorder", new { ids = new[] { second, first } });
        reorder.StatusCode.Should().Be(HttpStatusCode.OK, await reorder.Content.ReadAsStringAsync());
        (await reorder.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray()
            .Select(i => i.GetProperty("featuredRank").GetInt32()).Should().Equal(1, 2);

        var preview = await host.Client.GetFromJsonAsync<JsonElement>($"/api/content-items/{first}/preview");
        preview.GetProperty("state").GetString().Should().Be("published");
        preview.GetProperty("featured").GetBoolean().Should().BeTrue();
        foreach (var staffOnly in new[] { "status", "origin", "actingHumanId", "version", "featuredRank", "publishedWallClock" })
        {
            preview.TryGetProperty(staffOnly, out _).Should().BeFalse("{0} is staff-only (XC-002)", staffOnly);
        }

        (await PostAsync(host, $"/api/content-items/{first}/retract")).StatusCode.Should().Be(HttpStatusCode.OK);
        (await PostAsync(host, $"/api/content-items/{first}/retract")).StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await host.Client.GetFromJsonAsync<JsonElement>($"/api/content-items/{first}/preview"))
            .GetProperty("state").GetString().Should().Be("retracted", "a retracted item previews as the tombstone");

        (await host.Client.DeleteAsync(Uri($"/api/content-items/{second}"))).StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await host.Client.GetAsync(Uri($"/api/content-items/{second}"))).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [RequiresDockerFact]
    public async Task AnotherExercisesItem_IsIndistinguishableFromAnUnknownId()
    {
        await using var host = await StartAsync();
        var a = await host.SeedExerciseAsync();
        var b = await host.SeedExerciseAsync();
        var bOutlet = await SeedOutletAsync(host, b.ExerciseId);
        host.ActAs(b.ExerciseId, b.StaffUserId);
        var theirs = await CreateOkAsync(host, bOutlet);

        host.ActAs(a.ExerciseId, a.StaffUserId);
        var unknown = Guid.NewGuid().ToString();
        foreach (var path in new[] { "/api/content-items/{0}", "/api/content-items/{0}/preview" })
        {
            var cross = await host.Client.GetAsync(Uri(path.Replace("{0}", theirs, StringComparison.Ordinal)));
            var none = await host.Client.GetAsync(Uri(path.Replace("{0}", unknown, StringComparison.Ordinal)));
            cross.StatusCode.Should().Be(HttpStatusCode.NotFound);
            (await cross.Content.ReadAsStringAsync()).Should().Be(await none.Content.ReadAsStringAsync());
        }

        (await PostAsync(host, $"/api/content-items/{theirs}/publish")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await host.Client.PostAsJsonAsync("/api/content-items/feature/reorder", new { ids = new[] { theirs } }))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await host.Client.GetFromJsonAsync<JsonElement>("/api/content-items")).GetArrayLength().Should().Be(0);

        host.ActAs(b.ExerciseId, b.StaffUserId);
        (await GetItemAsync(host, theirs)).GetProperty("status").GetString().Should().Be("draft");
    }

    [RequiresDockerFact]
    public async Task PublishScheduleReviseRetract_ShareOneBucket_WhileReadsAndEditsAreUnlimited()
    {
        await using var host = await StartAsync();
        var exercise = await host.SeedExerciseAsync();
        var outletId = await SeedOutletAsync(host, exercise.ExerciseId);
        host.ActAs(exercise.ExerciseId, exercise.StaffUserId);
        var id = await CreateOkAsync(host, outletId);
        (await host.Client.GetAsync(Uri("/api/content-items"))).StatusCode.Should().Be(HttpStatusCode.OK); // warm the host

        var responses = await Task.WhenAll(Enumerable.Range(0, OverTheLimit)
            .Select(_ => PostAsync(host, $"/api/content-items/{Guid.NewGuid()}/publish")));

        var limited = responses.Where(r => r.StatusCode == HttpStatusCode.TooManyRequests).ToList();
        limited.Should().NotBeEmpty("one staff user past the bucket is refused");
        responses.Count(r => r.StatusCode != HttpStatusCode.TooManyRequests).Should().BeInRange(
            ContentPublishRateLimiterPolicy.TokenLimit,
            ContentPublishRateLimiterPolicy.TokenLimit + 5,
            "the bucket admits {0} back to back (plus a few refill ticks on a slow runner)",
            ContentPublishRateLimiterPolicy.TokenLimit);
        var problem = await limited[0].Content.ReadFromJsonAsync<JsonElement>();
        problem.GetProperty("status").GetInt32().Should().Be(429);
        problem.GetProperty("detail").GetString().Should().Be(ContentPublishRateLimiterPolicy.RateLimitedMessage);
        limited[0].Headers.RetryAfter.Should().NotBeNull();

        // A refill tick may admit one, so each action sends a small concurrent run: most must meet the spent bucket.
        foreach (var action in new[] { "schedule", "revise", "retract" })
        {
            var run = await Task.WhenAll(Enumerable.Range(0, 5)
                .Select(_ => PostAsync(host, $"/api/content-items/{id}/{action}", new { })));
            run.Count(r => r.StatusCode == HttpStatusCode.TooManyRequests)
                .Should().BeGreaterThanOrEqualTo(3, "{0} draws on the same bucket as publish", action);
        }

        var reads = await Task.WhenAll(Enumerable.Range(0, OverTheLimit)
            .Select(_ => host.Client.GetAsync(Uri($"/api/content-items/{id}"))));
        reads.Should().OnlyContain(r => r.StatusCode == HttpStatusCode.OK, "reads are not rate-limited");
        (await host.Client.PutAsJsonAsync($"/api/content-items/{id}", Article(outletId, "Edited", version: 1)))
            .StatusCode.Should().Be(HttpStatusCode.OK, "draft edits are not rate-limited");
    }

    private static Uri Uri(string path) => new(path, UriKind.Relative);

    private static object Article(Guid outletId, string headline = "Water main break on Elm", int version = 0) => new
    {
        kind = "article",
        outletId,
        headline,
        bodyHtml = "<p>Crews are on scene.</p>",
        version,
    };

    private static async Task<string> CreateOkAsync(InjectTestHost host, Guid outletId, string headline = "Water main break on Elm")
    {
        var response = await host.Client.PostAsJsonAsync("/api/content-items", Article(outletId, headline));
        response.StatusCode.Should().Be(HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
    }

    private static Task<JsonElement> GetItemAsync(InjectTestHost host, string id) =>
        host.Client.GetFromJsonAsync<JsonElement>($"/api/content-items/{id}");

    private static Task<HttpResponseMessage> PostAsync(InjectTestHost host, string path, object? body = null) =>
        host.Client.PostAsJsonAsync(path, body ?? new { });

    private static async Task<Guid> SeedOutletAsync(InjectTestHost host, Guid exerciseId)
    {
        await using var db = host.Db(exerciseId);
        var outlet = ChannelRows.Outlet(exerciseId);
        db.Outlets.Add(outlet);
        await db.SaveChangesAsync();
        return outlet.Id;
    }

    private Task<InjectTestHost> StartAsync() => InjectTestHost.StartAsync(
        _fixture.ConnectionString!,
        configureServices: services =>
        {
            services.AddExerciseConfiguration();
            services.AddChannels();
            services.AddScoped<IContentKindDescriptor>(_ => new TestKindDescriptor("article", "news", ISanitizerProfileRegistry.RichBasic));
            var sweeper = services.Single(d =>
                d.ServiceType == typeof(IHostedService) && d.ImplementationType == typeof(AlertExpirySweeper));
            services.Remove(sweeper);
        },
        mapEndpoints: app => app.MapChannels());
}
