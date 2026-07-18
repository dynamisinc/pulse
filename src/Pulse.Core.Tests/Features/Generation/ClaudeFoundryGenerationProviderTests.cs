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

/// <summary>
/// Hermetic wire-shape tests for the Claude-on-Foundry adapter — the sibling of
/// <see cref="AzureOpenAIGenerationProviderTests"/>, asserting the parts that differ from the OpenAI
/// shape: the top-level <c>system</c> field (not a system message), the forced Messages-API
/// <c>tool_use</c> path, both Anthropic cache-token fields, and the <c>anthropic-version</c> header +
/// Foundry <c>anthropic/v1/messages</c> path. No network: the transport is a mocked handler.
/// </summary>
public class ClaudeFoundryGenerationProviderTests
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
            Provider = "ClaudeFoundry",
            Endpoint = "https://test.example/",
        };
        options.Tiers["Standard"] = new TierModelOptions { Deployment = "claude-sonnet-5", Model = "claude-sonnet-5" };
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

    private static string ToolUseResponse()
    {
        var input = new
        {
            posts = new[]
            {
                new { personaHandle = "@ana", text = "water smells weird #WaterIssues", sentiment = -0.4, hashtags = new[] { "#WaterIssues" } },
                new { personaHandle = "@ben", text = "why is the county silent??", sentiment = -0.6, hashtags = Array.Empty<string>() },
            },
        };

        return JsonSerializer.Serialize(new
        {
            id = "msg_1",
            type = "message",
            model = "claude-sonnet-5",
            role = "assistant",
            stop_reason = "tool_use",
            content = new object[]
            {
                new { type = "tool_use", id = "toolu_1", name = "emit_posts", input },
            },
            usage = new { input_tokens = 700, output_tokens = 60, cache_read_input_tokens = 500, cache_creation_input_tokens = 40 },
        });
    }

    private sealed record Captured(string? Body, Uri? Uri, bool HasAnthropicVersion);

    private static (ClaudeFoundryGenerationProvider Provider, Func<Captured> Captured, FakeCredential Credential) BuildProvider(
        HttpStatusCode status, string responseBody, GenerationOptions? options = null)
    {
        var handler = new Mock<HttpMessageHandler>();
        Captured captured = new(null, null, false);
        handler.Protected()
            .Setup<Task<HttpResponseMessage>>("SendAsync", ItExpr.IsAny<HttpRequestMessage>(), ItExpr.IsAny<CancellationToken>())
            .Callback<HttpRequestMessage, CancellationToken>((req, _) =>
                captured = new Captured(
                    req.Content!.ReadAsStringAsync().GetAwaiter().GetResult(),
                    req.RequestUri,
                    req.Headers.Contains("anthropic-version")))
            .ReturnsAsync(() => new HttpResponseMessage(status)
            {
                Content = new StringContent(responseBody, Encoding.UTF8, "application/json"),
            });

        var http = new HttpClient(handler.Object) { BaseAddress = new Uri("https://test.example/") };
        var credential = new FakeCredential();
        var provider = new ClaudeFoundryGenerationProvider(
            http, credential, Options.Create(options ?? OptionsWithStandard()), GenerationGovernance.InProcess);

        return (provider, () => captured, credential);
    }

    [Fact]
    public async Task GenerateAsync_ParsesToolUseIntoPostsAndUsage()
    {
        var (provider, _, _) = BuildProvider(HttpStatusCode.OK, ToolUseResponse());

        var result = await provider.GenerateAsync(Request());

        result.Posts.Should().HaveCount(2);
        result.Posts[0].PersonaHandle.Should().Be("@ana");
        result.Posts[0].Hashtags.Should().Contain("#WaterIssues");
        result.Posts[1].Sentiment.Should().BeApproximately(-0.6, 0.001);
        result.Model.Should().Be("claude-sonnet-5");
        result.Usage.InputTokens.Should().Be(700);
        result.Usage.OutputTokens.Should().Be(60);
        result.Usage.CacheReadInputTokens.Should().Be(500);
        result.Usage.CacheCreationInputTokens.Should().Be(40);
        result.ProviderName.Should().Be("ClaudeFoundry");
    }

    [Fact]
    public async Task GenerateAsync_UsesAnthropicShape_SystemTopLevel_WorldFeedInUserTurnOnly()
    {
        var (provider, captured, _) = BuildProvider(HttpStatusCode.OK, ToolUseResponse());

        await provider.GenerateAsync(Request());

        var sent = captured();
        sent.Body.Should().NotBeNull();
        sent.HasAnthropicVersion.Should().BeTrue("the Messages API requires an anthropic-version header");
        sent.Uri!.AbsolutePath.Should().Be("/anthropic/v1/messages");
        // Header-versioned (anthropic-version), NOT Azure api-version — the /anthropic path takes no query.
        sent.Uri.Query.Should().BeEmpty();

        using var doc = JsonDocument.Parse(sent.Body!);
        var root = doc.RootElement;

        // Anthropic tool_choice is {type:"tool", name:...} — NOT wrapped in a "function" object.
        root.GetProperty("tool_choice").GetProperty("name").GetString().Should().Be("emit_posts");
        root.GetProperty("tools")[0].GetProperty("name").GetString().Should().Be("emit_posts");
        root.GetProperty("tools")[0].TryGetProperty("input_schema", out _).Should().BeTrue();

        // max_tokens is required by the Messages API — the adapter always sends it.
        root.GetProperty("max_tokens").GetInt32().Should().BeGreaterThan(0);

        // Trusted engine context is the top-level system field, and the untrusted world feed rides ONLY
        // in the user turn (ADP-024) — the isolation boundary holds identically to the OpenAI adapter.
        var system = root.GetProperty("system").GetString();
        system.Should().Contain("SYSTEM_PROMPT_MARKER").And.NotContain("WORLD_FEED_MARKER");

        var messages = root.GetProperty("messages");
        messages.GetArrayLength().Should().Be(1);
        var user = messages[0];
        user.GetProperty("role").GetString().Should().Be("user");
        user.GetProperty("content").GetString().Should().Contain("WORLD_FEED_MARKER");
    }

    [Fact]
    public async Task GenerateAsync_RequestsTheFoundryAiAzureScope()
    {
        var (provider, _, credential) = BuildProvider(HttpStatusCode.OK, ToolUseResponse());

        await provider.GenerateAsync(Request());

        // Keyless Entra must target the Foundry data-plane scope, NOT the OpenAI cognitiveservices scope
        // — a wrong scope is a live 401 that no other hermetic test would catch.
        credential.RequestedScopes.Should().ContainSingle().Which.Should().Be("https://ai.azure.com/.default");
    }

    [Fact]
    public async Task GenerateAsync_NonSuccessStatus_ThrowsProviderException()
    {
        // A well-formed Anthropic error envelope (the SDK's error factory parses error.type/message).
        var (provider, _, _) = BuildProvider(
            HttpStatusCode.TooManyRequests,
            "{\"type\":\"error\",\"error\":{\"type\":\"rate_limit_error\",\"message\":\"rate limited\"}}");

        var act = () => provider.GenerateAsync(Request());

        await act.Should().ThrowAsync<GenerationProviderException>().WithMessage("*Claude on Foundry*");
    }

    [Fact]
    public async Task GenerateAsync_NoToolUse_ThrowsProviderException()
    {
        var noTool = JsonSerializer.Serialize(new
        {
            id = "msg_2",
            type = "message",
            model = "claude-sonnet-5",
            role = "assistant",
            stop_reason = "end_turn",
            content = new object[] { new { type = "text", text = "I refuse." } },
            usage = new { input_tokens = 10, output_tokens = 3 },
        });
        var (provider, _, _) = BuildProvider(HttpStatusCode.OK, noTool);

        var act = () => provider.GenerateAsync(Request());

        await act.Should().ThrowAsync<GenerationProviderException>().WithMessage("*emit_posts*");
    }

    [Fact]
    public async Task GenerateAsync_MissingDeploymentForTier_ThrowsConfigException()
    {
        var options = new GenerationOptions { Provider = "ClaudeFoundry", Endpoint = "https://test.example/" };
        var (provider, _, _) = BuildProvider(HttpStatusCode.OK, ToolUseResponse(), options);

        var act = () => provider.GenerateAsync(Request());

        await act.Should().ThrowAsync<GenerationConfigurationException>();
    }
}
