namespace Pulse.Core.Features.Generation.Services;

using System.ClientModel;
using System.ClientModel.Primitives;
using System.Diagnostics;
using System.Text.Json;
using Azure.AI.OpenAI;
using Azure.Core;
using Microsoft.Extensions.Options;
using OpenAI.Chat;
using Pulse.Core.Features.Generation.Models;

/// <summary>
/// Tenant-bounded Azure OpenAI (Foundry) adapter behind <see cref="IGenerationProvider"/>, on the
/// official <c>Azure.AI.OpenAI</c> SDK. Auth is keyless — an Entra token from the injected
/// <see cref="TokenCredential"/> (managed identity in prod, az-cli login in dev), scoped to Cognitive
/// Services, matching the account's <c>disableLocalAuth</c> posture (NFR-005, no keys to leak). Output is
/// forced through the <c>emit_posts</c> function tool (structured per-post), and the untrusted world feed
/// rides only in the user turn (ADP-024).
///
/// The SDK's transport is our own resilient <see cref="HttpClient"/> (the typed-client Polly pipeline —
/// retry + circuit breaker + per-attempt timeout — from <c>AddEngineGeneration</c>), so degraded-mode
/// (NFR-003 / ADP-042) trips identically to the sibling Claude adapter; the SDK's built-in retry is
/// disabled so Polly owns resilience (no double-retry). A failed call surfaces a clear
/// <see cref="GenerationProviderException"/> so the breaker and the caller see a consistent error.
/// </summary>
public sealed class AzureOpenAIGenerationProvider : IGenerationProvider
{
    private readonly AzureOpenAIClient _client;
    private readonly GenerationOptions _options;

    public AzureOpenAIGenerationProvider(
        HttpClient http,
        TokenCredential credential,
        IOptions<GenerationOptions> options,
        GenerationGovernance governance)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(http);
        ArgumentNullException.ThrowIfNull(credential);
        _options = options.Value;
        Governance = governance ?? throw new ArgumentNullException(nameof(governance));

        if (string.IsNullOrWhiteSpace(_options.Endpoint))
        {
            throw new GenerationConfigurationException("Generation:Endpoint is required for provider 'AzureOpenAI'.");
        }

        // gpt-5.x needs a recent preview data-plane version (max_completion_tokens + reasoning + tools);
        // that ServiceVersion only exists on the Azure.AI.OpenAI beta line. Generation:ApiVersion is
        // honored when it maps to a supported version (so an operator can bump it via config), defaulting
        // to the latest the SDK exposes. Route through our HttpClient so the Polly pipeline governs
        // resilience, and disable the SDK's own retry to avoid double-retry.
        var clientOptions = new AzureOpenAIClientOptions(ResolveServiceVersion(_options.ApiVersion))
        {
            Transport = new HttpClientPipelineTransport(http),
            RetryPolicy = new ClientRetryPolicy(maxRetries: 0),
        };

        _client = new AzureOpenAIClient(new Uri(_options.Endpoint, UriKind.Absolute), credential, clientOptions);
    }

    public string Name => "AzureOpenAI";

    public GenerationGovernance Governance { get; }

    public async Task<GenerationResult> GenerateAsync(GenerationRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var tierKey = request.Tier.ToString();
        if (!_options.Tiers.TryGetValue(tierKey, out var tier) || string.IsNullOrWhiteSpace(tier.Deployment))
        {
            throw new GenerationConfigurationException(
                $"No deployment configured for tier '{tierKey}' (set Generation:Tiers:{tierKey}:Deployment).");
        }

        var userContent = string.IsNullOrWhiteSpace(request.WorldFeed) ? WorldFeedFence.Empty : request.WorldFeed;

        // Trusted engine context in the system message; the untrusted world feed in the user turn only (ADP-024).
        ChatMessage[] messages =
        [
            new SystemChatMessage(request.SystemPrompt),
            new UserChatMessage(userContent),
        ];

        var chatOptions = new ChatCompletionOptions
        {
            Tools = { EmitPostsTool },
            ToolChoice = ChatToolChoice.CreateFunctionChoice("emit_posts"),
            // No Temperature/TopP — gpt-5.x rejects non-default sampling params. Reasoning effort is left
            // at the service default (parity with the measured baseline).
        };
        if (request.MaxOutputTokens is int max)
        {
            chatOptions.MaxOutputTokenCount = max;
        }

        var chat = _client.GetChatClient(tier.Deployment);

        var stopwatch = Stopwatch.StartNew();
        ChatCompletion completion;
        try
        {
            completion = await chat.CompleteChatAsync(messages, chatOptions, cancellationToken).ConfigureAwait(false);
        }
        catch (ClientResultException ex)
        {
            throw new GenerationProviderException(
                $"Azure OpenAI returned {ex.Status} for deployment '{tier.Deployment}': {Truncate(ex.Message, 600)}", ex);
        }

        stopwatch.Stop();
        return Parse(completion, stopwatch.Elapsed, tier);
    }

    private static GenerationResult Parse(ChatCompletion completion, TimeSpan latency, TierModelOptions tier)
    {
        if (completion.FinishReason != ChatFinishReason.ToolCalls || completion.ToolCalls.Count == 0)
        {
            throw new GenerationProviderException(
                $"Model did not call emit_posts (finish_reason={completion.FinishReason}). Content guard cannot run on a non-burst response.");
        }

        var posts = ParsePosts(completion.ToolCalls[0].FunctionArguments.ToString());
        var usage = ParseUsage(completion.Usage);
        var model = string.IsNullOrEmpty(completion.Model) ? tier.Model : completion.Model;

        return new GenerationResult(posts, usage, latency, "AzureOpenAI", model);
    }

    private static List<GeneratedPost> ParsePosts(string argumentsJson)
    {
        var posts = new List<GeneratedPost>();
        using var argsDoc = JsonDocument.Parse(argumentsJson);

        if (!argsDoc.RootElement.TryGetProperty("posts", out var postsEl) || postsEl.ValueKind != JsonValueKind.Array)
        {
            return posts;
        }

        foreach (var element in postsEl.EnumerateArray())
        {
            var handle = element.TryGetProperty("personaHandle", out var h) ? h.GetString() ?? string.Empty : string.Empty;
            var text = element.TryGetProperty("text", out var t) ? t.GetString() ?? string.Empty : string.Empty;
            var sentiment = element.TryGetProperty("sentiment", out var s) && s.TryGetDouble(out var sv) ? sv : 0.0;

            var hashtags = new List<string>();
            if (element.TryGetProperty("hashtags", out var tagsEl) && tagsEl.ValueKind == JsonValueKind.Array)
            {
                foreach (var tag in tagsEl.EnumerateArray())
                {
                    var value = tag.GetString();
                    if (!string.IsNullOrEmpty(value))
                    {
                        hashtags.Add(value);
                    }
                }
            }

            posts.Add(new GeneratedPost(handle, text, sentiment, hashtags));
        }

        return posts;
    }

    private static GenerationUsage ParseUsage(ChatTokenUsage? usage)
    {
        if (usage is null)
        {
            return new GenerationUsage(0, 0);
        }

        // Azure OpenAI's InputTokenCount INCLUDES cached tokens (cache read is a subset); there is no
        // separate cache-creation charge. The cost model accounts for these semantics per provider.
        return new GenerationUsage(
            InputTokens: usage.InputTokenCount,
            OutputTokens: usage.OutputTokenCount,
            CacheReadInputTokens: usage.InputTokenDetails?.CachedTokenCount ?? 0);
    }

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : string.Concat(value.AsSpan(0, max), "…");

    // Map the configured Generation:ApiVersion to a supported SDK ServiceVersion. Unset/unknown values
    // fall back to the latest the SDK exposes (required for gpt-5.x). The enum only exists on the beta line.
    private static AzureOpenAIClientOptions.ServiceVersion ResolveServiceVersion(string? apiVersion) => apiVersion switch
    {
        "2024-10-21" => AzureOpenAIClientOptions.ServiceVersion.V2024_10_21,
        "2024-12-01-preview" => AzureOpenAIClientOptions.ServiceVersion.V2024_12_01_Preview,
        "2025-01-01-preview" => AzureOpenAIClientOptions.ServiceVersion.V2025_01_01_Preview,
        "2025-03-01-preview" => AzureOpenAIClientOptions.ServiceVersion.V2025_03_01_Preview,
        "2025-04-01-preview" => AzureOpenAIClientOptions.ServiceVersion.V2025_04_01_Preview,
        _ => AzureOpenAIClientOptions.ServiceVersion.V2025_04_01_Preview,
    };

    // Same emit_posts contract (one post per persona) as the Claude adapter, so the content guard + voice
    // metrics inspect identical shapes across providers. For this SDK the tool schema is the bare
    // parameters object (not wrapped in a "function" envelope).
    private static readonly ChatTool EmitPostsTool = ChatTool.CreateFunctionTool(
        "emit_posts",
        "Emit the generated social-media posts — exactly one per requested persona.",
        BinaryData.FromString(EmitPostsParameters));

    private const string EmitPostsParameters = """
    {
      "type": "object",
      "properties": {
        "posts": {
          "type": "array",
          "description": "One post per persona, each written in that persona's own voice.",
          "items": {
            "type": "object",
            "properties": {
              "personaHandle": { "type": "string", "description": "The @handle of the persona authoring this post." },
              "text": { "type": "string", "description": "The post body — in-world, in the persona's voice." },
              "sentiment": { "type": "number", "description": "Sentiment from -1.0 (very negative) to 1.0 (very positive)." },
              "hashtags": { "type": "array", "items": { "type": "string" }, "description": "Hashtags used, including the leading #." }
            },
            "required": ["personaHandle", "text", "sentiment", "hashtags"],
            "additionalProperties": false
          }
        }
      },
      "required": ["posts"],
      "additionalProperties": false
    }
    """;
}

/// <summary>
/// Thrown when a generation provider fails at runtime (transport error, non-success status, or an
/// unusable response). Distinct from <see cref="GenerationConfigurationException"/> (a startup/config
/// fault) — this is what the degraded-mode circuit breaker (story 05) watches to trip to Suggest.
/// </summary>
public sealed class GenerationProviderException : Exception
{
    public GenerationProviderException()
    {
    }

    public GenerationProviderException(string message)
        : base(message)
    {
    }

    public GenerationProviderException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
