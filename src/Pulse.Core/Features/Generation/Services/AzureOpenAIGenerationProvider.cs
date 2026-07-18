namespace Pulse.Core.Features.Generation.Services;

using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Azure.Core;
using Microsoft.Extensions.Options;
using Pulse.Core.Features.Generation.Models;

/// <summary>
/// Tenant-bounded Azure OpenAI (Foundry) adapter behind <see cref="IGenerationProvider"/>. Auth is
/// keyless — an Entra token from the injected <see cref="TokenCredential"/> (managed identity in
/// prod, az-cli login in dev), scoped to Cognitive Services — matching the account's
/// <c>disableLocalAuth</c> posture (NFR-005, no keys to leak). Output is forced through the
/// <c>emit_posts</c> tool (structured per-post), and the untrusted world feed rides only in the user
/// turn (ADP-024). Resilience/circuit-breaker is layered on in story 05; this adapter surfaces a clear
/// <see cref="GenerationProviderException"/> on failure so the breaker can trip.
/// </summary>
public sealed class AzureOpenAIGenerationProvider : IGenerationProvider
{
    private static readonly string[] Scopes = ["https://cognitiveservices.azure.com/.default"];

    private readonly HttpClient _http;
    private readonly TokenCredential _credential;
    private readonly GenerationOptions _options;

    public AzureOpenAIGenerationProvider(
        HttpClient http,
        TokenCredential credential,
        IOptions<GenerationOptions> options,
        GenerationGovernance governance)
    {
        ArgumentNullException.ThrowIfNull(options);
        _http = http ?? throw new ArgumentNullException(nameof(http));
        _credential = credential ?? throw new ArgumentNullException(nameof(credential));
        _options = options.Value;
        Governance = governance ?? throw new ArgumentNullException(nameof(governance));
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

        var body = BuildRequestBody(request);
        var accessToken = await _credential
            .GetTokenAsync(new TokenRequestContext(Scopes), cancellationToken)
            .ConfigureAwait(false);

        var path = new Uri(
            $"openai/deployments/{tier.Deployment}/chat/completions?api-version={_options.ApiVersion}",
            UriKind.Relative);

        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json"),
        };
        httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken.Token);

        var stopwatch = Stopwatch.StartNew();
        using var response = await _http.SendAsync(httpRequest, cancellationToken).ConfigureAwait(false);
        var payload = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        stopwatch.Stop();

        if (!response.IsSuccessStatusCode)
        {
            throw new GenerationProviderException(
                $"Azure OpenAI returned {(int)response.StatusCode} for deployment '{tier.Deployment}': {Truncate(payload, 600)}");
        }

        return Parse(payload, stopwatch.Elapsed, tier);
    }

    private static JsonObject BuildRequestBody(GenerationRequest request)
    {
        var userContent = string.IsNullOrWhiteSpace(request.WorldFeed) ? WorldFeedFence.Empty : request.WorldFeed;

        var body = new JsonObject
        {
            ["messages"] = new JsonArray(
                new JsonObject { ["role"] = "system", ["content"] = request.SystemPrompt },
                new JsonObject { ["role"] = "user", ["content"] = userContent }),
            ["tools"] = new JsonArray(JsonNode.Parse(EmitPostsTool)!),
            ["tool_choice"] = new JsonObject
            {
                ["type"] = "function",
                ["function"] = new JsonObject { ["name"] = "emit_posts" },
            },
        };

        if (request.MaxOutputTokens is int max)
        {
            body["max_completion_tokens"] = max;
        }

        return body;
    }

    private static GenerationResult Parse(string payload, TimeSpan latency, TierModelOptions tier)
    {
        using var doc = JsonDocument.Parse(payload);
        var root = doc.RootElement;

        var model = root.TryGetProperty("model", out var modelEl)
            ? modelEl.GetString() ?? tier.Model
            : tier.Model;

        var choice = root.GetProperty("choices")[0];
        var message = choice.GetProperty("message");

        if (!message.TryGetProperty("tool_calls", out var toolCalls) || toolCalls.GetArrayLength() == 0)
        {
            var finish = choice.TryGetProperty("finish_reason", out var fr) ? fr.GetString() : "unknown";
            throw new GenerationProviderException(
                $"Model did not call emit_posts (finish_reason={finish}). Content guard cannot run on a non-burst response.");
        }

        var argumentsJson = toolCalls[0].GetProperty("function").GetProperty("arguments").GetString() ?? "{}";
        var posts = ParsePosts(argumentsJson);
        var usage = ParseUsage(root);

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

    private static GenerationUsage ParseUsage(JsonElement root)
    {
        if (!root.TryGetProperty("usage", out var usage))
        {
            return new GenerationUsage(0, 0);
        }

        var cachedTokens = 0;
        if (usage.TryGetProperty("prompt_tokens_details", out var details)
            && details.TryGetProperty("cached_tokens", out var cached)
            && cached.TryGetInt32(out var cachedValue))
        {
            cachedTokens = cachedValue;
        }

        return new GenerationUsage(
            InputTokens: ReadInt(usage, "prompt_tokens"),
            OutputTokens: ReadInt(usage, "completion_tokens"),
            CacheReadInputTokens: cachedTokens);
    }

    private static int ReadInt(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.TryGetInt32(out var result) ? result : 0;

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : string.Concat(value.AsSpan(0, max), "…");

    private const string EmitPostsTool = """
    {
      "type": "function",
      "function": {
        "name": "emit_posts",
        "description": "Emit the generated social-media posts — exactly one per requested persona.",
        "parameters": {
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
      }
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
