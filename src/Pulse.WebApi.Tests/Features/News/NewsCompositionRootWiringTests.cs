namespace Pulse.WebApi.Tests.Features.News;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.News;
using Xunit;

/// <summary>
/// Composition-root guard for the news channel (FC-9.10; plain <see cref="FactAttribute"/>s, no Docker): boots the REAL
/// <c>Program</c> host and proves <c>AddNewsChannel()</c> is wired. Story 01: the <c>article</c> descriptor resolves (once,
/// scoped), the <c>article-rich</c> profile is in the foundation registry, the startup check accepts both, and the REAL
/// funnel dispatches <c>kind: "article"</c> to the news descriptor while an unregistered kind is still refused.
/// </summary>
/// <remarks>
/// The probe never reaches a database (dummy connection string): the funnel's kind lookup happens before any read, and the
/// article write is stopped at outlet resolution by a non-GUID <c>outletId</c>, whose message names the descriptor's
/// channel. The full HTTP round trip on real SQL rides foundation story 07's <c>POST /api/content-items</c>.
/// </remarks>
public sealed class NewsCompositionRootWiringTests
{
    [Fact]
    public void ProgramCs_ResolvesTheArticleDescriptor_OnceAndScoped()
    {
        using var factory = new WiringProbeFactory();
        using var scopeA = factory.Services.CreateScope();
        using var scopeB = factory.Services.CreateScope();

        var descriptors = scopeA.ServiceProvider.GetServices<IContentKindDescriptor>().ToList();

        descriptors.Should().ContainSingle(d => d.Kind == "article")
            .Which.Should().BeOfType<ArticleKindDescriptor>()
            .Which.ChannelId.Should().Be("news");
        descriptors.GroupBy(d => d.Kind).Should().OnlyContain(g => g.Count() == 1, "a kind is registered once");
        scopeA.ServiceProvider.GetServices<IContentKindDescriptor>().OfType<ArticleKindDescriptor>().Single()
            .Should().BeSameAs(descriptors.OfType<ArticleKindDescriptor>().Single(), "descriptors are scoped");
        scopeB.ServiceProvider.GetServices<IContentKindDescriptor>().OfType<ArticleKindDescriptor>().Single()
            .Should().NotBeSameAs(descriptors.OfType<ArticleKindDescriptor>().Single());
    }

    [Fact]
    public void ProgramCs_RegistersTheArticleRichProfile_AndTheStartupCheckAcceptsIt()
    {
        using var factory = new WiringProbeFactory();

        // factory.Services starts the host, which runs ContentKindStartupCheck: an unregistered BodyPolicy would throw here.
        factory.Services.GetRequiredService<ISanitizerProfileRegistry>().Contains("article-rich").Should().BeTrue();
        factory.Services.GetServices<IHostedService>().OfType<ContentKindStartupCheck>().Should().ContainSingle();
    }

    [Fact]
    public async Task TheRealFunnel_DispatchesAnArticle_AndStillRefusesAnUnregisteredKind()
    {
        using var factory = new WiringProbeFactory();
        using var scope = factory.Services.CreateScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = Guid.NewGuid();
        var funnel = scope.ServiceProvider.GetRequiredService<IContentPublishService>();
        var caller = new ContentCaller { Origin = "controller", ActingHumanId = "human-ctl" };

        var article = await funnel.CreateDraftAsync(
            new ContentWriteRequest { Kind = "article", OutletId = "not-a-guid", Headline = "x" }, caller);
        var sonnet = await funnel.CreateDraftAsync(
            new ContentWriteRequest { Kind = "sonnet", OutletId = "not-a-guid", Headline = "x" }, caller);

        article.Outcome.Should().Be(ContentPublishOutcome.Invalid);
        article.Errors.Should().ContainSingle().Which.Should().Contain("news outlet", "the funnel found the article kind and its channel");
        sonnet.Outcome.Should().Be(ContentPublishOutcome.Invalid);
        sonnet.Errors.Should().ContainSingle().Which.Should().Contain("sonnet");
    }

    [Fact]
    public void AddNewsChannel_IsIdempotent()
    {
        var services = new ServiceCollection();

        services.AddNewsChannel().AddNewsChannel().Should().BeSameAs(services);

        services.Where(d => d.ServiceType == typeof(IContentKindDescriptor)).Should().ContainSingle()
            .Which.ImplementationType.Should().Be<ArticleKindDescriptor>();
        services.Count(d => d.ImplementationInstance is SanitizerProfileRegistration { Name: "article-rich" })
            .Should().Be(1, "the registry refuses a duplicate profile name at host start");
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
