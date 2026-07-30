namespace Pulse.Core.Tests.Features.Generation;

using System.Net;
using System.Text;
using System.Text.Json;
using Azure.Core;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Moq;
using Moq.Protected;
using Pulse.Core.Core.Extensions;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;

public class GenerationResilienceTests
{
    private sealed class FakeCredential : TokenCredential
    {
        public override AccessToken GetToken(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
            new("t", DateTimeOffset.MaxValue);

        public override ValueTask<AccessToken> GetTokenAsync(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
            ValueTask.FromResult(new AccessToken("t", DateTimeOffset.MaxValue));
    }

    private sealed class RecordingHealthListener : IProviderHealthListener
    {
        private int _degraded;

        public int Degraded => Volatile.Read(ref _degraded);

        public ValueTask OnDegradedAsync(string reason, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _degraded);
            return ValueTask.CompletedTask;
        }

        public ValueTask OnRecoveredAsync(CancellationToken cancellationToken = default) => ValueTask.CompletedTask;
    }

    private static readonly (string, string?)[] BaseAzureConfig =
    [
        ("Generation:Provider", "AzureOpenAI"),
        ("Generation:Endpoint", "https://test.example/"),
        ("Generation:Governance:TenantBounded", "true"),
        ("Generation:Governance:NoTrainingAttested", "true"),
        ("Generation:Governance:Residency", "centralus"),
        ("Generation:Governance:Retention", "Retained"),
        ("Generation:Tiers:Standard:Deployment", "standard"),
        ("Generation:Tiers:Standard:Model", "gpt-5.4"),
    ];

    private static IConfiguration Config(params (string Key, string? Value)[] values) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(values.Select(v => new KeyValuePair<string, string?>(v.Key, v.Value)))
            .Build();

    private static ServiceProvider BuildProvider(
        HttpMessageHandler handler, (string, string?)[] extraConfig, RecordingHealthListener? listener = null)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddEngineGeneration(Config([.. BaseAzureConfig, .. extraConfig]));

        // Override the credential (no real token fetch) and inject the mock transport under the resilience pipeline.
        services.AddSingleton<TokenCredential>(new FakeCredential());
        if (listener is not null)
        {
            services.AddSingleton<IProviderHealthListener>(listener);
        }

        // Inject the mock transport into the SAME named typed client AddEngineGeneration configured. Since
        // autonomy-safety story 07 that client is keyed on the CONCRETE adapter type (IGenerationProvider is
        // now the cut-aware selector over it), so this must name the concrete type too — naming the interface
        // would create a second, pipeline-less client and silently stop testing the resilience handler.
        services.AddHttpClient<AzureOpenAIGenerationProvider>()
            .ConfigurePrimaryHttpMessageHandler(() => handler);

        return services.BuildServiceProvider();
    }

    private static GenerationRequest Request() => new()
    {
        ExerciseId = Guid.NewGuid(),
        Tier = GenerationTier.Standard,
        PostCount = 1,
        SystemPrompt = "sys",
        WorldFeed = "<world_feed>\n<post author=\"@x\">hi</post>\n</world_feed>",
    };

    private static HttpResponseMessage Resp(HttpStatusCode code, string body) =>
        new(code) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private static string ToolCallResponse()
    {
        var arguments = JsonSerializer.Serialize(new
        {
            posts = new[] { new { personaHandle = "@a", text = "hi #x", sentiment = 0.0, hashtags = new[] { "#x" } } },
        });
        return JsonSerializer.Serialize(new
        {
            model = "gpt-5.4",
            choices = new[]
            {
                new
                {
                    finish_reason = "tool_calls",
                    message = new
                    {
                        role = "assistant",
                        tool_calls = new[] { new { id = "c1", type = "function", function = new { name = "emit_posts", arguments } } },
                    },
                },
            },
            usage = new { prompt_tokens = 10, completion_tokens = 5 },
        });
    }

    [Fact]
    public async Task Retry_RecoversFromTransientFailure()
    {
        var handler = new Mock<HttpMessageHandler>();
        handler.Protected()
            .SetupSequence<Task<HttpResponseMessage>>("SendAsync", ItExpr.IsAny<HttpRequestMessage>(), ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(Resp(HttpStatusCode.ServiceUnavailable, "busy"))
            .ReturnsAsync(Resp(HttpStatusCode.OK, ToolCallResponse()));

        await using var sp = BuildProvider(handler.Object, [("Generation:Resilience:MaxRetries", "2")]);
        var provider = sp.GetRequiredService<IGenerationProvider>();

        var result = await provider.GenerateAsync(Request());

        result.Posts.Should().HaveCount(1);
    }

    [Fact]
    public async Task CircuitBreaker_OpensUnderSustainedFailure_AndSignalsDegraded()
    {
        var handler = new Mock<HttpMessageHandler>();
        handler.Protected()
            .Setup<Task<HttpResponseMessage>>("SendAsync", ItExpr.IsAny<HttpRequestMessage>(), ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(() => Resp(HttpStatusCode.InternalServerError, "boom"));

        var listener = new RecordingHealthListener();
        await using var sp = BuildProvider(
            handler.Object,
            [
                ("Generation:Resilience:MaxRetries", "0"),
                ("Generation:Resilience:CircuitBreakerMinimumThroughput", "2"),
                ("Generation:Resilience:CircuitBreakerSamplingSeconds", "10"),
                ("Generation:Resilience:CircuitBreakerFailureRatio", "0.5"),
                ("Generation:Resilience:CircuitBreakerBreakSeconds", "30"),
            ],
            listener);
        var provider = sp.GetRequiredService<IGenerationProvider>();

        for (var i = 0; i < 6; i++)
        {
            try
            {
                await provider.GenerateAsync(Request());
            }
            catch
            {
                // Expected: a provider error while closed, then a broken-circuit error once open.
            }
        }

        // The breaker tripped and raised the degraded-mode signal (NFR-003 / ADP-042)...
        listener.Degraded.Should().BeGreaterThan(0);

        // ...and further calls now fail fast rather than reaching the transport.
        var act = () => provider.GenerateAsync(Request());
        await act.Should().ThrowAsync<Exception>();
    }
}
