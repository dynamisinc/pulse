namespace Pulse.Core.Tests.Features.Generation;

using System.Net;
using System.Text;
using System.Text.Json;
using Azure.Core;
using FluentAssertions;
using Microsoft.Extensions.Options;
using Moq;
using Moq.Protected;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;

public class AzureOpenAIGenerationProviderTests
{
    private sealed class FakeCredential : TokenCredential
    {
        public string[]? RequestedScopes { get; private set; }

        public override AccessToken GetToken(TokenRequestContext requestContext, CancellationToken cancellationToken)
        {
            RequestedScopes = requestContext.Scopes;
            return new AccessToken("fake-token", DateTimeOffset.MaxValue);
        }

        public override ValueTask<AccessToken> GetTokenAsync(TokenRequestContext requestContext, CancellationToken cancellationToken)
        {
            RequestedScopes = requestContext.Scopes;
            return ValueTask.FromResult(new AccessToken("fake-token", DateTimeOffset.MaxValue));
        }
    }

    private static GenerationOptions OptionsWithStandard()
    {
        var options = new GenerationOptions
        {
            Provider = "AzureOpenAI",
            Endpoint = "https://test.example/",
            ApiVersion = "2025-04-01-preview",
        };
        options.Tiers["Standard"] = new TierModelOptions { Deployment = "standard", Model = "gpt-5.4" };
        return options;
    }

    private static GenerationRequest Request() => new()
    {
        ExerciseId = Guid.NewGuid(),
        Tier = GenerationTier.Standard,
        PostCount = 2,
        SystemPrompt = "SYSTEM_PROMPT_MARKER",
        WorldFeed = "<world_feed>\n<post author=\"@x\">WORLD_FEED_MARKER</post>\n</world_feed>",
    };

    private static string ToolCallResponse()
    {
        var arguments = JsonSerializer.Serialize(new
        {
            posts = new[]
            {
                new { personaHandle = "@ana", text = "water smells weird #WaterIssues", sentiment = -0.4, hashtags = new[] { "#WaterIssues" } },
                new { personaHandle = "@ben", text = "why is the county silent??", sentiment = -0.6, hashtags = Array.Empty<string>() },
            },
        });

        return JsonSerializer.Serialize(new
        {
            model = "gpt-5.4-2026-03-05",
            choices = new[]
            {
                new
                {
                    finish_reason = "tool_calls",
                    message = new
                    {
                        role = "assistant",
                        tool_calls = new[]
                        {
                            new { id = "call_1", type = "function", function = new { name = "emit_posts", arguments } },
                        },
                    },
                },
            },
            usage = new { prompt_tokens = 700, completion_tokens = 60, prompt_tokens_details = new { cached_tokens = 500 } },
        });
    }

    private static (AzureOpenAIGenerationProvider Provider, Func<string?> CapturedBody, FakeCredential Credential) BuildProvider(
        HttpStatusCode status, string responseBody, GenerationOptions? options = null)
    {
        var handler = new Mock<HttpMessageHandler>();
        string? capturedBody = null;
        handler.Protected()
            .Setup<Task<HttpResponseMessage>>("SendAsync", ItExpr.IsAny<HttpRequestMessage>(), ItExpr.IsAny<CancellationToken>())
            .Callback<HttpRequestMessage, CancellationToken>((req, _) =>
                capturedBody = req.Content!.ReadAsStringAsync().GetAwaiter().GetResult())
            .ReturnsAsync(() => new HttpResponseMessage(status)
            {
                Content = new StringContent(responseBody, Encoding.UTF8, "application/json"),
            });

        var http = new HttpClient(handler.Object) { BaseAddress = new Uri("https://test.example/") };
        var credential = new FakeCredential();
        var provider = new AzureOpenAIGenerationProvider(
            http, credential, Options.Create(options ?? OptionsWithStandard()), GenerationGovernance.InProcess);

        return (provider, () => capturedBody, credential);
    }

    [Fact]
    public async Task GenerateAsync_ParsesToolCallIntoPostsAndUsage()
    {
        var (provider, _, _) = BuildProvider(HttpStatusCode.OK, ToolCallResponse());

        var result = await provider.GenerateAsync(Request());

        result.Posts.Should().HaveCount(2);
        result.Posts[0].PersonaHandle.Should().Be("@ana");
        result.Posts[0].Hashtags.Should().Contain("#WaterIssues");
        result.Posts[1].Sentiment.Should().BeApproximately(-0.6, 0.001);
        result.Model.Should().Be("gpt-5.4-2026-03-05");
        result.Usage.InputTokens.Should().Be(700);
        result.Usage.OutputTokens.Should().Be(60);
        result.Usage.CacheReadInputTokens.Should().Be(500);
        result.ProviderName.Should().Be("AzureOpenAI");
    }

    [Fact]
    public async Task GenerateAsync_ForcesEmitPostsTool_AndKeepsWorldFeedInUserTurnOnly()
    {
        var (provider, capturedBody, _) = BuildProvider(HttpStatusCode.OK, ToolCallResponse());

        await provider.GenerateAsync(Request());

        var sent = capturedBody();
        sent.Should().NotBeNull();

        using var doc = JsonDocument.Parse(sent!);
        var root = doc.RootElement;

        root.GetProperty("tool_choice").GetProperty("function").GetProperty("name").GetString()
            .Should().Be("emit_posts");

        var messages = root.GetProperty("messages");
        var system = messages[0];
        var user = messages[1];

        system.GetProperty("role").GetString().Should().Be("system");
        system.GetProperty("content").GetString().Should().Contain("SYSTEM_PROMPT_MARKER").And.NotContain("WORLD_FEED_MARKER");

        user.GetProperty("role").GetString().Should().Be("user");
        user.GetProperty("content").GetString().Should().Contain("WORLD_FEED_MARKER");
    }

    [Fact]
    public async Task GenerateAsync_RequestsTheCognitiveServicesScope()
    {
        var (provider, _, credential) = BuildProvider(HttpStatusCode.OK, ToolCallResponse());

        await provider.GenerateAsync(Request());

        // The Azure OpenAI surface uses the cognitiveservices scope — distinct from the Claude/Foundry
        // adapter's ai.azure.com scope. A wrong scope is a live 401 no other hermetic test would catch.
        credential.RequestedScopes.Should().ContainSingle().Which.Should().Be("https://cognitiveservices.azure.com/.default");
    }

    [Fact]
    public async Task GenerateAsync_NonSuccessStatus_ThrowsProviderException()
    {
        var (provider, _, _) = BuildProvider(HttpStatusCode.TooManyRequests, "{\"error\":\"rate limited\"}");

        var act = () => provider.GenerateAsync(Request());

        await act.Should().ThrowAsync<GenerationProviderException>().WithMessage("*429*");
    }

    [Fact]
    public async Task GenerateAsync_NoToolCall_ThrowsProviderException()
    {
        var noTool = JsonSerializer.Serialize(new
        {
            model = "gpt-5.4",
            choices = new[] { new { finish_reason = "stop", message = new { role = "assistant", content = "I refuse." } } },
            usage = new { prompt_tokens = 10, completion_tokens = 3 },
        });
        var (provider, _, _) = BuildProvider(HttpStatusCode.OK, noTool);

        var act = () => provider.GenerateAsync(Request());

        await act.Should().ThrowAsync<GenerationProviderException>().WithMessage("*emit_posts*");
    }

    [Fact]
    public async Task GenerateAsync_MissingDeploymentForTier_ThrowsConfigException()
    {
        var options = new GenerationOptions { Provider = "AzureOpenAI", Endpoint = "https://test.example/" };
        var (provider, _, _) = BuildProvider(HttpStatusCode.OK, ToolCallResponse(), options);

        var act = () => provider.GenerateAsync(Request());

        await act.Should().ThrowAsync<GenerationConfigurationException>();
    }
}
