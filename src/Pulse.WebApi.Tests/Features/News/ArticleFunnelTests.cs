namespace Pulse.WebApi.Tests.Features.News;

using System;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Content.Read;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.News;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Channels.Publish;
using Xunit;

/// <summary>
/// News story 01 (#718) through the REAL publish funnel (F04) with the REAL article descriptor registered by
/// <c>AddNewsChannel()</c> (EF in-memory, Docker-free): the funnel accepts <c>article</c>, an unregistered kind still fails,
/// the payload is refused field-level, the body is sanitized with <c>article-rich</c> and nothing script-capable reaches a
/// participant read (NFR-004), the media rules (image/video only, one hero, a video hero has a poster), and engine drafts
/// (NWS-022).
/// </summary>
public sealed class ArticleFunnelTests
{
    [Fact]
    public async Task TheFunnel_AcceptsAnArticle_AndStillRefusesAnUnregisteredKind()
    {
        using var harness = NewsHarness();
        using var scope = harness.InA();

        var article = await scope.Funnel.CreateDraftAsync(Article(harness), FunnelHarness.Controller);
        var sonnet = await scope.Funnel.CreateDraftAsync(Article(harness) with { Kind = "sonnet" }, FunnelHarness.Controller);

        article.Outcome.Should().Be(ContentPublishOutcome.Ok, string.Join("; ", article.Errors));
        article.Item!.Kind.Should().Be("article");
        article.Item.ChannelId.Should().Be("news");
        sonnet.Outcome.Should().Be(ContentPublishOutcome.Invalid, "an unregistered kind is still a 400 (no regression)");
    }

    [Fact]
    public async Task AValidPayload_IsStoredNormalized_AndProjectedWithoutStoryType()
    {
        using var harness = NewsHarness();
        using var scope = harness.InA();
        var payload = new JsonObject
        {
            ["breaking"] = new JsonObject { ["text"] = " Bridge closed " },
            ["dateline"] = new JsonObject { ["place"] = "RIVERTON" },
            ["storyType"] = "breaking_hard_news",
        };

        var result = await scope.Funnel.CreateDraftAsync(Article(harness) with { Payload = payload }, FunnelHarness.Controller);

        result.Outcome.Should().Be(ContentPublishOutcome.Ok, string.Join("; ", result.Errors));
        var stored = await harness.ItemAsync(result.Item!.Id);
        stored.PayloadJson.Should().Be("""{"breaking":{"text":"Bridge closed"},"dateline":{"place":"RIVERTON"},"storyType":"breaking_hard_news"}""");
        payload["breaking"]!["text"]!.GetValue<string>().Should().Be(" Bridge closed ", "the funnel validates a private copy");

        (await scope.Funnel.PublishAsync(Guid.Parse(result.Item.Id), null, FunnelHarness.Controller)).Outcome
            .Should().Be(ContentPublishOutcome.Ok);
        var read = await ReadAsParticipantAsync(harness, await harness.ItemAsync(result.Item.Id));
        read.Payload.ToJsonString().Should().Be("""{"breaking":{"text":"Bridge closed"},"dateline":{"place":"RIVERTON"},"slugCode":null}""");
    }

    [Fact]
    public async Task AnInvalidPayload_IsAFieldLevel400_AndNothingIsStored()
    {
        using var harness = NewsHarness();
        using var scope = harness.InA();

        var result = await scope.Funnel.CreateDraftAsync(
            Article(harness) with
            {
                Payload = new JsonObject { ["kicker"] = "WEATHER", ["breaking"] = new JsonObject { ["text"] = "<b>x</b>" } },
            },
            FunnelHarness.Controller);

        result.Outcome.Should().Be(ContentPublishOutcome.Invalid);
        result.Errors.Should().Contain(error => error.StartsWith("payload.kicker", StringComparison.Ordinal));
        result.Errors.Should().Contain(error => error.StartsWith("payload.breaking.text", StringComparison.Ordinal));
        (await scope.Db.ContentItems.CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task AStoredScriptOrHandler_NeverSurvivesToAParticipantRead()
    {
        using var harness = NewsHarness();
        string id;
        using (var scope = harness.InA())
        {
            var created = await scope.Funnel.CreateDraftAsync(
                Article(harness) with
                {
                    BodyHtml = "<p>Water rising.</p><script>steal()</script><img src=x onerror=\"steal()\">"
                        + "<p onmouseover=\"steal()\" style=\"color:red\">Stay home.</p>"
                        + "<a href=\"javascript:steal()\">more</a><iframe src=\"https://evil.example\"></iframe>"
                        + "<blockquote class=\"pull-quote\">We are ready.</blockquote>",
                },
                FunnelHarness.Controller);
            created.Outcome.Should().Be(ContentPublishOutcome.Ok, string.Join("; ", created.Errors));
            id = created.Item!.Id;
            (await scope.Funnel.PublishAsync(Guid.Parse(id), null, FunnelHarness.Controller)).Outcome.Should().Be(ContentPublishOutcome.Ok);
        }

        var read = await ReadAsParticipantAsync(harness, await harness.ItemAsync(id));

        read.BodyHtml.Should().Be(
            "<p>Water rising.</p><p>Stay home.</p><a rel=\"noopener noreferrer nofollow\">more</a>"
            + "<blockquote class=\"pull-quote\">We are ready.</blockquote>");
        read.BodyHtml.Should().NotContainAny("script", "onerror", "onmouseover", "javascript:", "iframe", "style=");
    }

    [Fact]
    public async Task ADocument_IsRefusedForAnArticle()
    {
        using var harness = NewsHarness();
        var pdf = await SeedAsync(harness, MediaKinds.Document);
        using var scope = harness.InA();

        var result = await scope.Funnel.CreateDraftAsync(
            Article(harness) with { Media = [Media(pdf, ChannelVocabulary.MediaRoleAttachment)] }, FunnelHarness.Controller);

        result.Outcome.Should().Be(ContentPublishOutcome.Invalid);
        result.Errors.Should().ContainSingle().Which.Should().Contain("cannot attach document");
    }

    [Fact]
    public async Task AtMostOneHero_IsAllowed()
    {
        using var harness = NewsHarness();
        var first = await SeedAsync(harness, MediaKinds.Image);
        var second = await SeedAsync(harness, MediaKinds.Image);
        using var scope = harness.InA();

        var twoHeroRoles = await scope.Funnel.CreateDraftAsync(
            Article(harness) with { Media = [Media(first, "hero"), Media(second, "hero")] }, FunnelHarness.Controller);
        var heroIdDisagrees = await scope.Funnel.CreateDraftAsync(
            Article(harness) with { HeroMediaId = first.ToString(), Media = [Media(first, "inline"), Media(second, "hero")] },
            FunnelHarness.Controller);
        var roleOnly = await scope.Funnel.CreateDraftAsync(
            Article(harness) with { Media = [Media(first, "hero")] }, FunnelHarness.Controller);
        var oneHero = await scope.Funnel.CreateDraftAsync(
            Article(harness) with { HeroMediaId = first.ToString(), Media = [Media(first, "hero"), Media(second, "inline")] },
            FunnelHarness.Controller);

        twoHeroRoles.Errors.Should().Equal(ArticleKindDescriptor.OneHeroMessage);
        roleOnly.Errors.Should().Equal(ArticleKindDescriptor.HeroRoleNeedsHeroIdMessage);
        heroIdDisagrees.Errors.Should().Equal(ArticleKindDescriptor.OneHeroMessage);
        oneHero.Outcome.Should().Be(ContentPublishOutcome.Ok, string.Join("; ", oneHero.Errors));
    }

    [Fact]
    public async Task AVideoHero_NeedsAPosterFrame()
    {
        using var harness = NewsHarness();
        var poster = await SeedAsync(harness, MediaKinds.Image);
        var bare = await SeedAsync(harness, MediaKinds.Video);
        var withPoster = await SeedAsync(harness, MediaKinds.Video, poster);
        using var scope = harness.InA();

        var refused = await scope.Funnel.CreateDraftAsync(
            Article(harness) with { HeroMediaId = bare.ToString(), Media = [Media(bare, "hero")] }, FunnelHarness.Controller);
        var inlineVideo = await scope.Funnel.CreateDraftAsync(
            Article(harness) with { Media = [Media(bare, "inline")] }, FunnelHarness.Controller);
        var ok = await scope.Funnel.CreateDraftAsync(
            Article(harness) with { HeroMediaId = withPoster.ToString(), Media = [Media(withPoster, "hero")] }, FunnelHarness.Controller);

        refused.Errors.Should().Equal(ArticleKindDescriptor.VideoHeroPosterMessage);
        inlineVideo.Outcome.Should().Be(ContentPublishOutcome.Ok, "only a HERO video needs a poster");
        ok.Outcome.Should().Be(ContentPublishOutcome.Ok, string.Join("; ", ok.Errors));
    }

    [Fact]
    public async Task AnEngineArticle_IsValidatedTheSameWay_AndLandsAsADraft()
    {
        using var harness = NewsHarness();
        using var scope = harness.InA();

        var drafted = await scope.Funnel.CreateDraftAsync(
            Article(harness) with { Payload = new JsonObject { ["slugCode"] = "ENGINE-1" } }, FunnelHarness.Engine);
        var malformed = await scope.Funnel.CreateDraftAsync(
            Article(harness) with { Payload = new JsonObject { ["breaking"] = new JsonObject { ["text"] = new string('x', 121) } } },
            FunnelHarness.Engine);

        drafted.Outcome.Should().Be(ContentPublishOutcome.Ok, string.Join("; ", drafted.Errors));
        drafted.Item!.Status.Should().Be("draft");
        drafted.Item.Origin.Should().Be("engine");
        malformed.Outcome.Should().Be(ContentPublishOutcome.Invalid, "a malformed engine payload is refused, never repaired");
        malformed.Errors.Should().ContainSingle(error => error.StartsWith("payload.breaking.text", StringComparison.Ordinal));
    }

    [Fact]
    public async Task ABreakingArticle_SuggestsButNeverRaisesAnAlert()
    {
        using var harness = NewsHarness();
        string id;
        using (var scope = harness.InA())
        {
            var created = await scope.Funnel.CreateDraftAsync(
                Article(harness) with { Payload = new JsonObject { ["breaking"] = new JsonObject { ["text"] = "BREAKING" } } },
                FunnelHarness.Controller);
            id = created.Item!.Id;
            (await scope.Funnel.PublishAsync(Guid.Parse(id), null, FunnelHarness.Controller)).Outcome.Should().Be(ContentPublishOutcome.Ok);
        }

        harness.AlertRaiser.Should().NotBeNull("the funnel resolved a raiser, so 'none raised' is meaningful");
        harness.AlertRaiser!.Raised.Should().BeEmpty("a breaking banner does not imply an alert-bar entry (NWS-012)");
        using var read = harness.InA();
        var descriptor = read.Services.GetServices<IContentKindDescriptor>().Single(d => d.Kind == "article");
        descriptor.SuggestAlert(await harness.ItemAsync(id))!.Severity.Should().Be("advisory");
    }

    private static FunnelHarness NewsHarness() => FunnelHarness.Create(services =>
    {
        // The real article kind replaces the harness's test kinds.
        services.RemoveAll<IContentKindDescriptor>();
        services.AddNewsChannel();
    });

    private static ContentWriteRequest Article(FunnelHarness harness) => new()
    {
        Kind = "article",
        OutletId = harness.OutletId.ToString(),
        Headline = "Route 9 bridge closed after overnight flooding",
        BodyHtml = "<p>The <strong>Route 9</strong> bridge is closed.</p>",
    };

    private static ContentMediaWriteRequest Media(Guid id, string role) => new() { MediaId = id.ToString(), Role = role, Alt = "Alt text" };

    private static async Task<Guid> SeedAsync(FunnelHarness harness, string kind, Guid? poster = null)
    {
        using var seed = harness.InA();
        var asset = ChannelRows.MediaAsset(harness.ExerciseId);
        asset.Kind = kind;
        asset.PosterMediaAssetId = poster;
        seed.Db.MediaAssets.Add(asset);
        await seed.Db.SaveChangesAsync();
        return asset.Id;
    }

    private static async Task<ChannelContentDto> ReadAsParticipantAsync(FunnelHarness harness, ContentItem item)
    {
        using var scope = harness.InA();
        var outlet = await scope.Db.Outlets.AsNoTracking().SingleAsync(o => o.Id == item.OutletId);
        var projector = new ParticipantContentProjector(scope.Db, scope.Services.GetServices<IContentKindDescriptor>());
        return await projector.ToContentAsync(item, outlet);
    }
}
