namespace Pulse.WebApi.Tests.Features.Channels.Read;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// Channels-foundation 06 (#702) against the REAL <c>Program</c> pipeline and real SQL: the participant list, featured
/// ordering, permalink read, retracted tombstone, the ONE indistinguishable 404, the XC-002 projection (no staff column
/// ever on the wire), the channel gate, the in-sim link resolver, and that a GET writes nothing.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ContentReadApiTests
{
    /// <summary>The exact FC-3 key set of a <c>ChannelContentDto</c>.</summary>
    private static readonly string[] ContentKeys =
    [
        "id", "channelId", "kind", "outlet", "slug", "permalink", "state", "headline", "dek", "kicker", "category", "hero",
        "publishedScenarioTime", "updatedScenarioTime", "featured", "byline", "bodyHtml", "media", "revisions",
        "pairedPostId", "alertId", "payload",
    ];

    private static readonly string[] SummaryKeys =
    [
        "id", "channelId", "kind", "outlet", "slug", "permalink", "state", "headline", "dek", "kicker", "category", "hero",
        "publishedScenarioTime", "updatedScenarioTime", "featured",
    ];

    private static readonly string[] TombstoneKeys =
        ["id", "channelId", "kind", "outlet", "slug", "permalink", "state", "retractedScenarioTime"];

    private static readonly string[] LinkPreviewKeys = ["title", "description", "image", "sourceName", "permalink"];

    /// <summary>Strings that exist only in staff-only columns of the seeded rows; none may reach a participant.</summary>
    private static readonly string[] StaffSentinels =
    [
        "SENTINEL-ACTING-HUMAN", "SENTINEL-EXTREF", "SENTINEL-OPTIONS", "SENTINEL-LAST-ERROR", "SENTINEL-STAFF-NOTE",
        "SENTINEL-OLD-HEADLINE", "cadence", "\"inject\"", "2026-11-02", "\"version\"", "\"status\"", "\"background\"",
        "\"featuredRank\"", "\"origin\"", "\"actingHumanId\"", "\"injectId\"", "\"externalRef\"", "\"externalSource\"",
        "\"revisionLog\"", "\"publishedWallClock\"", "\"scheduledScenarioTime\"",
    ];

    private readonly ContentReadSeeder _seed;

    public ContentReadApiTests(MsSqlContainerFixture fixture)
    {
        _seed = new ContentReadSeeder(fixture);
    }

    [RequiresDockerFact]
    public async Task List_ReturnsPublishedItemsOnly_NewestFirst_InScenarioTime()
    {
        var (exercise, token) = await _seed.ExerciseAsync();
        var outlet = await _seed.OutletAsync(exercise.Id, "news", "newsline-7");
        var t = ContentReadSeeder.BaseTime;
        await _seed.ItemAsync(outlet, "older", published: t.AddHours(-2));
        await _seed.ItemAsync(outlet, "newest", published: t);
        await _seed.ItemAsync(outlet, "middle", published: t.AddHours(-1));
        await _seed.ItemAsync(outlet, "a-draft", status: ChannelVocabulary.StatusDraft);
        await _seed.ItemAsync(outlet, "a-scheduled", status: ChannelVocabulary.StatusScheduled);
        await _seed.ItemAsync(outlet, "a-retracted", status: ChannelVocabulary.StatusRetracted);
        await _seed.ItemAsync(outlet, "a-deleted", deleted: true);

        using var factory = new ContentReadFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exercise.Host, token);

        using var list = await GetJsonAsync(client, "/api/channels/news/content");

        var items = list.RootElement.GetProperty("items").EnumerateArray().ToList();
        items.Select(i => i.GetProperty("slug").GetString()).Should().Equal("newest", "middle", "older");
        items[0].GetProperty("publishedScenarioTime").GetString().Should().Be(ProjectorIso(t));
        items[0].GetProperty("permalink").GetString().Should().Be("/news/newsline-7/newest");
        items.Should().AllSatisfy(i => Keys(i).Should().BeEquivalentTo(SummaryKeys));
        list.RootElement.GetProperty("nextCursor").ValueKind.Should().Be(JsonValueKind.Null);
        AssertNoStaffData(list.RootElement.GetRawText());
    }

    [RequiresDockerFact]
    public async Task List_PagesThroughAFrozenClockTie_WithNoDuplicateOrSkip()
    {
        var (exercise, token) = await _seed.ExerciseAsync();
        var outlet = await _seed.OutletAsync(exercise.Id, "news", "newsline-7");
        var t = ContentReadSeeder.BaseTime;
        var expected = new List<string>();
        for (var i = 0; i < 5; i++)
        {
            await _seed.ItemAsync(outlet, $"tie-{i}", published: t);
        }

        await _seed.ItemAsync(outlet, "older-1", published: t.AddMinutes(-1));
        await _seed.ItemAsync(outlet, "older-2", published: t.AddMinutes(-2));

        using var factory = new ContentReadFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exercise.Host, token);

        var slugs = await DrainAsync(client, "/api/channels/news/content?limit=2");

        slugs.Should().HaveCount(7).And.OnlyHaveUniqueItems();
        slugs.Take(5).Should().BeEquivalentTo(Enumerable.Range(0, 5).Select(i => $"tie-{i}"));
        slugs.Skip(5).Should().Equal("older-1", "older-2");
    }

    [RequiresDockerFact]
    public async Task List_LimitDefaultsTo20_IsCappedAt50_AndRefusesZero()
    {
        var (exercise, token) = await _seed.ExerciseAsync();
        var outlet = await _seed.OutletAsync(exercise.Id, "weather", "weather-desk");
        for (var i = 0; i < 55; i++)
        {
            await _seed.ItemAsync(outlet, $"bulletin-{i}", published: ContentReadSeeder.BaseTime.AddMinutes(-i));
        }

        using var factory = new ContentReadFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exercise.Host, token);

        using (var page = await GetJsonAsync(client, "/api/channels/weather/content"))
        {
            page.RootElement.GetProperty("items").GetArrayLength().Should().Be(20);
            page.RootElement.GetProperty("nextCursor").GetString().Should().NotBeNullOrEmpty();
        }

        using (var capped = await GetJsonAsync(client, "/api/channels/weather/content?limit=500"))
        {
            capped.RootElement.GetProperty("items").GetArrayLength().Should().Be(50);
        }

        (await client.GetAsync("/api/channels/weather/content?limit=0")).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await client.GetAsync("/api/channels/weather/content?cursor=not-a-cursor")).StatusCode
            .Should().Be(HttpStatusCode.BadRequest);
    }

    [RequiresDockerFact]
    public async Task List_OutletFilter_TheWireIncludesItsOrgNewsrooms_ANewsroomShowsOnlyItsOwn()
    {
        var (exercise, token) = await _seed.ExerciseAsync();
        var wire = await _seed.OutletAsync(exercise.Id, "press", "wire-room");
        var county = await _seed.OutletAsync(exercise.Id, "press", "county-em", parentOutletId: wire.Id);
        var water = await _seed.OutletAsync(exercise.Id, "press", "water-utility", parentOutletId: wire.Id);
        var hidden = await _seed.OutletAsync(exercise.Id, "press", "hidden-org", enabled: false, parentOutletId: wire.Id);
        var t = ContentReadSeeder.BaseTime;
        await _seed.ItemAsync(wire, "wire-note", published: t);
        await _seed.ItemAsync(county, "county-release", published: t.AddMinutes(-1));
        await _seed.ItemAsync(water, "boil-notice", published: t.AddMinutes(-2));
        await _seed.ItemAsync(hidden, "hidden-release", published: t.AddMinutes(-3));

        using var factory = new ContentReadFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exercise.Host, token);

        (await SlugsAsync(client, "/api/channels/press/content?outlet=wire-room"))
            .Should().Equal("wire-note", "county-release", "boil-notice");
        (await SlugsAsync(client, "/api/channels/press/content?outlet=county-em")).Should().Equal("county-release");
        (await SlugsAsync(client, "/api/channels/press/content"))
            .Should().Equal("wire-note", "county-release", "boil-notice");

        var unknown = await client.GetAsync("/api/channels/press/content?outlet=no-such-org");
        var disabled = await client.GetAsync("/api/channels/press/content?outlet=hidden-org");
        unknown.StatusCode.Should().Be(HttpStatusCode.NotFound);
        await AssertSameResponseAsync(disabled, unknown);
    }

    [RequiresDockerFact]
    public async Task List_CategoryFilter_KeepsOnlyThatCategory()
    {
        var (exercise, token) = await _seed.ExerciseAsync();
        var outlet = await _seed.OutletAsync(exercise.Id, "news", "newsline-7");
        await _seed.ItemAsync(outlet, "local-story", category: "Local");
        await _seed.ItemAsync(outlet, "weather-story", category: "Weather", published: ContentReadSeeder.BaseTime.AddMinutes(-1));

        using var factory = new ContentReadFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exercise.Host, token);

        (await SlugsAsync(client, "/api/channels/news/content?category=Local")).Should().Equal("local-story");
        (await SlugsAsync(client, "/api/channels/news/content?category=Weather")).Should().Equal("weather-story");
        (await SlugsAsync(client, "/api/channels/news/content?category=Sports")).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task List_Featured_PutsFeaturedFirstByRank_ThenTheRestByRecency_AcrossPages()
    {
        var (exercise, token) = await _seed.ExerciseAsync();
        var outlet = await _seed.OutletAsync(exercise.Id, "news", "newsline-7");
        var t = ContentReadSeeder.BaseTime;
        await _seed.ItemAsync(outlet, "rank-2", published: t.AddHours(-5), featuredRank: 2);
        await _seed.ItemAsync(outlet, "rank-1", published: t.AddHours(-9), featuredRank: 1);
        await _seed.ItemAsync(outlet, "rank-3", published: t, featuredRank: 3);
        await _seed.ItemAsync(outlet, "plain-newest", published: t.AddMinutes(-1));
        await _seed.ItemAsync(outlet, "plain-mid", published: t.AddHours(-2));
        await _seed.ItemAsync(outlet, "plain-old", published: t.AddHours(-20));

        using var factory = new ContentReadFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exercise.Host, token);

        (await DrainAsync(client, "/api/channels/news/content?featured=true&limit=2"))
            .Should().Equal("rank-1", "rank-2", "rank-3", "plain-newest", "plain-mid", "plain-old");
        (await DrainAsync(client, "/api/channels/news/content?featured=true&limit=4"))
            .Should().Equal("rank-1", "rank-2", "rank-3", "plain-newest", "plain-mid", "plain-old");
        (await DrainAsync(client, "/api/channels/news/content?limit=2"))
            .Should().Equal("rank-3", "plain-newest", "plain-mid", "rank-2", "rank-1", "plain-old");

        using var featured = await GetJsonAsync(client, "/api/channels/news/content?featured=true&limit=1");
        featured.RootElement.GetProperty("items")[0].GetProperty("featured").GetBoolean().Should().BeTrue();
        var featuredCursor = featured.RootElement.GetProperty("nextCursor").GetString();
        (await client.GetAsync($"/api/channels/news/content?limit=1&cursor={featuredCursor}")).StatusCode
            .Should().Be(HttpStatusCode.BadRequest, "a featured-order cursor cannot resume the plain order");
    }

    [RequiresDockerFact]
    public async Task Permalink_Published_IsTheParticipantShape_WithVisibleRevisionsOnly_AndTheProjectedPayload()
    {
        var (exercise, token) = await _seed.ExerciseAsync();
        var outlet = await _seed.OutletAsync(exercise.Id, "news", "newsline-7", name: "Newsline 7");
        var updated = ContentReadSeeder.BaseTime.AddMinutes(45);
        var item = await _seed.ItemAsync(outlet, "emergency-call-delays", featuredRank: 4, configure: i =>
        {
            i.Kicker = "Developing";
            i.BylineName = "Dana Reyes";
            i.UpdatedScenarioTime = updated;
        });
        await _seed.RevisionAsync(item, 1, ChannelVocabulary.RevisionEdit, visible: false);
        await _seed.RevisionAsync(item, 2, ChannelVocabulary.RevisionUpdate, visible: true, note: "Adds the county's statement.");
        await _seed.RevisionAsync(item, 3, ChannelVocabulary.RevisionSilentRewrite, visible: false);
        await _seed.RevisionAsync(item, 4, ChannelVocabulary.RevisionCorrection, visible: true, note: "Corrects the hotline number.");
        await _seed.RevisionAsync(item, 5, ChannelVocabulary.RevisionSilentRewrite, visible: true);
        var hero = await _seed.MediaAsync(item, ChannelVocabulary.MediaRoleHero, 0, "Dispatch floor", asHero: true);
        var inline = await _seed.MediaAsync(item, ChannelVocabulary.MediaRoleInline, 1, "Call volume chart");

        using var factory = new ContentReadFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exercise.Host, token);

        var response = await client.GetAsync("/api/channels/news/content/newsline-7/emergency-call-delays");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var raw = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(raw);
        var root = doc.RootElement;

        Keys(root).Should().BeEquivalentTo(ContentKeys, "the permalink is exactly the FC-3 ChannelContentDto");
        root.GetProperty("state").GetString().Should().Be("published");
        root.GetProperty("headline").GetString().Should().Be("Headline emergency-call-delays");
        root.GetProperty("bodyHtml").GetString().Should().Be("<p>Body emergency-call-delays</p>");
        root.GetProperty("featured").GetBoolean().Should().BeTrue();
        root.GetProperty("updatedScenarioTime").GetString().Should().Be(ProjectorIso(updated));
        root.GetProperty("byline").GetProperty("name").GetString().Should().Be("Dana Reyes");
        root.GetProperty("outlet").GetProperty("name").GetString().Should().Be("Newsline 7");
        root.GetProperty("permalink").GetString().Should().Be("/news/newsline-7/emergency-call-delays");

        root.GetProperty("revisions").EnumerateArray()
            .Select(r => (r.GetProperty("number").GetInt32(), r.GetProperty("kind").GetString()))
            .Should().Equal((2, "update"), (4, "correction"));

        root.GetProperty("hero").GetProperty("url").GetString().Should().Be(PathMediaUrlSigner.UrlFor(hero));
        root.GetProperty("hero").GetProperty("alt").GetString().Should().Be("Dispatch floor");
        root.GetProperty("media").EnumerateArray().Select(m => m.GetProperty("id").GetString())
            .Should().Equal(inline.ToString());
        root.GetProperty("media")[0].GetProperty("url").GetString().Should().Be(PathMediaUrlSigner.UrlFor(inline));

        Keys(root.GetProperty("payload")).Should().Equal("zone");
        AssertNoStaffData(raw);
    }

    [RequiresDockerFact]
    public async Task Permalink_SilentlyRewritten_ShowsOnlyTheCurrentContentAndTheMovedUpdatedStamp()
    {
        var (exercise, token) = await _seed.ExerciseAsync();
        var outlet = await _seed.OutletAsync(exercise.Id, "news", "newsline-7");
        var updated = ContentReadSeeder.BaseTime.AddMinutes(20);
        var item = await _seed.ItemAsync(outlet, "rewritten", configure: i =>
        {
            i.Headline = "The current headline";
            i.UpdatedScenarioTime = updated;
        });
        await _seed.RevisionAsync(item, 1, ChannelVocabulary.RevisionSilentRewrite, visible: false);

        using var factory = new ContentReadFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exercise.Host, token);

        var raw = await (await client.GetAsync("/api/channels/news/content/newsline-7/rewritten")).Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(raw);

        doc.RootElement.GetProperty("headline").GetString().Should().Be("The current headline");
        doc.RootElement.GetProperty("updatedScenarioTime").GetString().Should().Be(ProjectorIso(updated));
        doc.RootElement.GetProperty("revisions").GetArrayLength().Should().Be(0);
        raw.Should().NotContain("SENTINEL-OLD-HEADLINE");
    }

    [RequiresDockerFact]
    public async Task Permalink_Retracted_IsTheTombstone_WithNoHeadlineOrBody()
    {
        var (exercise, token) = await _seed.ExerciseAsync();
        var outlet = await _seed.OutletAsync(exercise.Id, "press", "county-em");
        await _seed.ItemAsync(outlet, "pulled-release", status: ChannelVocabulary.StatusRetracted);

        using var factory = new ContentReadFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exercise.Host, token);

        var response = await client.GetAsync("/api/channels/press/content/county-em/pulled-release");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var raw = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(raw);

        Keys(doc.RootElement).Should().BeEquivalentTo(TombstoneKeys);
        doc.RootElement.GetProperty("state").GetString().Should().Be("retracted");
        doc.RootElement.GetProperty("retractedScenarioTime").GetString()
            .Should().Be(ProjectorIso(ContentReadSeeder.BaseTime.AddMinutes(30)));
        doc.RootElement.GetProperty("outlet").GetProperty("skinKey").GetString().Should().Be("newsline7");
        raw.Should().NotContain("Headline pulled-release").And.NotContain("Body pulled-release");
        AssertNoStaffData(raw);
    }

    [RequiresDockerFact]
    public async Task NotFound_DraftScheduledDeletedDisabledOutletAndCrossExercise_AreByteIdenticalToAnUnknownSlug()
    {
        var (exercise, token) = await _seed.ExerciseAsync();
        var (other, _) = await _seed.ExerciseAsync();
        var outlet = await _seed.OutletAsync(exercise.Id, "news", "newsline-7");
        var disabledOutlet = await _seed.OutletAsync(exercise.Id, "news", "closed-desk", enabled: false);
        var deletedOutlet = await _seed.OutletAsync(exercise.Id, "news", "gone-desk", deleted: true);
        var foreignOutlet = await _seed.OutletAsync(other.Id, "news", "newsline-7");
        await _seed.ItemAsync(outlet, "a-draft", status: ChannelVocabulary.StatusDraft);
        await _seed.ItemAsync(outlet, "a-scheduled", status: ChannelVocabulary.StatusScheduled);
        await _seed.ItemAsync(outlet, "a-deleted", deleted: true);
        await _seed.ItemAsync(outlet, "a-deleted-retraction", status: ChannelVocabulary.StatusRetracted, deleted: true);
        await _seed.ItemAsync(disabledOutlet, "on-a-disabled-outlet");
        await _seed.ItemAsync(deletedOutlet, "on-a-deleted-outlet");
        await _seed.ItemAsync(foreignOutlet, "other-exercise-story");

        using var factory = new ContentReadFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exercise.Host, token);

        var unknown = await client.GetAsync("/api/channels/news/content/newsline-7/never-existed");
        unknown.StatusCode.Should().Be(HttpStatusCode.NotFound);

        foreach (var path in new[]
                 {
                     "/api/channels/news/content/newsline-7/a-draft",
                     "/api/channels/news/content/newsline-7/a-scheduled",
                     "/api/channels/news/content/newsline-7/a-deleted",
                     "/api/channels/news/content/newsline-7/a-deleted-retraction",
                     "/api/channels/news/content/closed-desk/on-a-disabled-outlet",
                     "/api/channels/news/content/gone-desk/on-a-deleted-outlet",
                     "/api/channels/news/content/newsline-7/other-exercise-story",
                     "/api/channels/news/content/NEWSLINE-7/a-draft",
                     "/api/channels/portal/content/newsline-7/a-draft",
                 })
        {
            await AssertSameResponseAsync(await client.GetAsync(path), unknown, path);
        }

        await _seed.SetEnabledChannelsAsync(exercise.Id, "social,press");
        var disabledChannel = await client.GetAsync("/api/channels/news/content/newsline-7/never-existed");
        await AssertSameResponseAsync(disabledChannel, unknown, "a disabled channel");
        await AssertSameResponseAsync(await client.GetAsync("/api/channels/news/content"), unknown, "a disabled channel's list");
    }

    [RequiresDockerFact]
    public async Task CrossExercise_AListNeverShowsAnotherExercisesItems()
    {
        var (exercise, token) = await _seed.ExerciseAsync();
        var (other, otherToken) = await _seed.ExerciseAsync();
        await _seed.ItemAsync(await _seed.OutletAsync(exercise.Id, "news", "newsline-7"), "ours");
        await _seed.ItemAsync(await _seed.OutletAsync(other.Id, "news", "newsline-7"), "theirs");

        using var factory = new ContentReadFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exercise.Host, token);
        using var otherClient = factory.CreateClientFor(other.Host, otherToken);

        (await SlugsAsync(client, "/api/channels/news/content")).Should().Equal("ours");
        (await SlugsAsync(client, "/api/channels/news/content?outlet=newsline-7")).Should().Equal("ours");
        (await SlugsAsync(otherClient, "/api/channels/news/content")).Should().Equal("theirs");

        // A session for exercise B presented on exercise A's host is not a session here.
        using var mismatched = factory.CreateClientFor(exercise.Host, otherToken);
        (await mismatched.GetAsync("/api/channels/news/content")).StatusCode.Should().Be(
            HttpStatusCode.Forbidden, "the host refuses a session bound to another exercise before any read");
    }

    [RequiresDockerFact]
    public async Task Anonymous_IsRefused()
    {
        var (exercise, _) = await _seed.ExerciseAsync();

        using var factory = new ContentReadFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exercise.Host, bearerToken: null);

        (await client.GetAsync("/api/channels/news/content")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await client.GetAsync("/api/link-previews?path=/news/a/b")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [RequiresDockerFact]
    public async Task LinkPreview_ResolvesAPublishedInScopeItem_AndIsOne404ForEverythingElse()
    {
        var (exercise, token) = await _seed.ExerciseAsync();
        var (other, _) = await _seed.ExerciseAsync();
        var outlet = await _seed.OutletAsync(exercise.Id, "news", "newsline-7", name: "Newsline 7");
        var item = await _seed.ItemAsync(outlet, "emergency-call-delays");
        var hero = await _seed.MediaAsync(item, ChannelVocabulary.MediaRoleHero, 0, "Dispatch floor", asHero: true);
        await _seed.ItemAsync(outlet, "a-draft", status: ChannelVocabulary.StatusDraft);
        await _seed.ItemAsync(outlet, "a-retracted", status: ChannelVocabulary.StatusRetracted);
        await _seed.ItemAsync(await _seed.OutletAsync(other.Id, "news", "newsline-7"), "other-exercise-story");
        await _seed.ItemAsync(await _seed.OutletAsync(exercise.Id, "weather", "weather-desk"), "storm-watch");

        using var factory = new ContentReadFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exercise.Host, token);

        var response = await client.GetAsync("/api/link-previews?path=/news/newsline-7/emergency-call-delays");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var raw = await response.Content.ReadAsStringAsync();
        using (var doc = JsonDocument.Parse(raw))
        {
            Keys(doc.RootElement).Should().BeEquivalentTo(LinkPreviewKeys);
            doc.RootElement.GetProperty("title").GetString().Should().Be("Headline emergency-call-delays");
            doc.RootElement.GetProperty("description").GetString().Should().Be("Dek emergency-call-delays");
            doc.RootElement.GetProperty("sourceName").GetString().Should().Be("Newsline 7");
            doc.RootElement.GetProperty("permalink").GetString().Should().Be("/news/newsline-7/emergency-call-delays");
            doc.RootElement.GetProperty("image").GetProperty("url").GetString().Should().Be(PathMediaUrlSigner.UrlFor(hero));
        }

        AssertNoStaffData(raw);

        var unknown = await client.GetAsync("/api/link-previews?path=/news/newsline-7/never-existed");
        unknown.StatusCode.Should().Be(HttpStatusCode.NotFound);

        foreach (var path in new[]
                 {
                     "https://example.com/news/newsline-7/emergency-call-delays",
                     "//example.com/news/newsline-7/emergency-call-delays",
                     "/news/newsline-7/emergency-call-delays?x=1",
                     "/news/newsline-7/emergency-call-delays/",
                     "/news/newsline-7/../newsline-7/emergency-call-delays",
                     "/news/newsline-7/a-draft",
                     "/news/newsline-7/a-retracted",
                     "/news/newsline-7/other-exercise-story",
                     "/api/outlets",
                     "/social/post/123",
                     "/portal/newsline-7/emergency-call-delays",
                     "/news/newsline-7",
                     string.Empty,
                 })
        {
            await AssertSameResponseAsync(
                await client.GetAsync($"/api/link-previews?path={Uri.EscapeDataString(path)}"), unknown, path);
        }

        await AssertSameResponseAsync(await client.GetAsync("/api/link-previews"), unknown, "no path");

        (await client.GetAsync("/api/link-previews?path=/weather/weather-desk/storm-watch")).StatusCode
            .Should().Be(HttpStatusCode.OK);
        await _seed.SetEnabledChannelsAsync(exercise.Id, "social,news");
        await AssertSameResponseAsync(
            await client.GetAsync("/api/link-previews?path=/weather/weather-desk/storm-watch"), unknown, "a disabled channel");
    }

    [RequiresDockerFact]
    public async Task Reads_WriteNothing_AndEmitNoTelemetry()
    {
        var (exercise, token) = await _seed.ExerciseAsync();
        var outlet = await _seed.OutletAsync(exercise.Id, "news", "newsline-7");
        await _seed.ItemAsync(outlet, "a-story");
        await _seed.ItemAsync(outlet, "a-retracted", status: ChannelVocabulary.StatusRetracted);
        var before = await _seed.TelemetryCountAsync(exercise.Id);

        using var factory = new ContentReadFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exercise.Host, token);

        foreach (var path in new[]
                 {
                     "/api/channels/news/content",
                     "/api/channels/news/content?featured=true",
                     "/api/channels/news/content/newsline-7/a-story",
                     "/api/channels/news/content/newsline-7/a-retracted",
                     "/api/channels/news/content/newsline-7/never-existed",
                     "/api/link-previews?path=/news/newsline-7/a-story",
                 })
        {
            (await client.GetAsync(path)).StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.NotFound);
        }

        (await _seed.TelemetryCountAsync(exercise.Id)).Should().Be(before, "views are client-reported (story 15)");
    }

    private static string ProjectorIso(DateTimeOffset value) =>
        Pulse.WebApi.Features.Channels.Content.Publish.ContentProjector.Iso(value);

    private static IEnumerable<string> Keys(JsonElement element) => element.EnumerateObject().Select(p => p.Name);

    private static void AssertNoStaffData(string raw)
    {
        foreach (var sentinel in StaffSentinels)
        {
            raw.Should().NotContain(sentinel, "XC-002: staff-only data never reaches a participant");
        }
    }

    private static async Task AssertSameResponseAsync(HttpResponseMessage actual, HttpResponseMessage expected, string? because = null)
    {
        actual.StatusCode.Should().Be(expected.StatusCode, because);
        (await actual.Content.ReadAsByteArrayAsync()).Should().Equal(await expected.Content.ReadAsByteArrayAsync(), because);
        actual.Content.Headers.ContentType.Should().Be(expected.Content.Headers.ContentType, because);
        actual.Content.Headers.ContentLength.Should().Be(expected.Content.Headers.ContentLength, because);
    }

    private static async Task<JsonDocument> GetJsonAsync(HttpClient client, string path)
    {
        var response = await client.GetAsync(path);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        return JsonDocument.Parse(body);
    }

    private static async Task<List<string>> SlugsAsync(HttpClient client, string path)
    {
        using var doc = await GetJsonAsync(client, path);
        return doc.RootElement.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("slug").GetString()!).ToList();
    }

    private static async Task<List<string>> DrainAsync(HttpClient client, string firstPage)
    {
        var slugs = new List<string>();
        string? cursor = null;
        for (var pages = 0; pages < 20; pages++)
        {
            var path = cursor is null ? firstPage : $"{firstPage}&cursor={Uri.EscapeDataString(cursor)}";
            using var doc = await GetJsonAsync(client, path);
            slugs.AddRange(doc.RootElement.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("slug").GetString()!));
            var next = doc.RootElement.GetProperty("nextCursor");
            if (next.ValueKind == JsonValueKind.Null)
            {
                return slugs;
            }

            cursor = next.GetString();
        }

        throw new InvalidOperationException("the list never ended");
    }
}
