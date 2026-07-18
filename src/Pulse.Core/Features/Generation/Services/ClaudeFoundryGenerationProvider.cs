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
/// Tenant-bounded Claude-on-Azure-AI-Foundry adapter behind <see cref="IGenerationProvider"/> — the
/// quality-preferred alternative to <see cref="AzureOpenAIGenerationProvider"/> (architecture §3.1),
/// selected per deployment by the eval harness on measured voice fidelity, never from preference.
///
/// It speaks the **native Anthropic Messages API** (Foundry's <c>/anthropic/v1/messages</c> passthrough),
/// which differs from Azure OpenAI's chat-completions shape in every way that matters here:
/// <list type="bullet">
///   <item>the trusted engine context is the top-level <c>system</c> field, not a <c>system</c> message;</item>
///   <item>the untrusted world feed still rides only in the user turn (ADP-024), unchanged;</item>
///   <item>structured output is forced via Messages-API <c>tools</c> + <c>tool_use</c>
///   (<c>tool_choice: {type:"tool", name:"emit_posts"}</c>, tool schema under <c>input_schema</c>) —
///   Claude returns the burst as a <c>tool_use</c> content block, not OpenAI's <c>tool_calls</c>;</item>
///   <item><c>max_tokens</c> is <b>required</b> by the Messages API (Azure OpenAI's cap is optional).</item>
/// </list>
///
/// Auth is keyless — an Entra token from the injected <see cref="TokenCredential"/> (managed identity in
/// prod, az-cli login in dev), matching the account's <c>disableLocalAuth</c> posture (NFR-005, no keys
/// to leak). NOTE the Foundry Anthropic surface takes a <b>different token scope</b> than the Azure OpenAI
/// surface — <c>https://ai.azure.com/.default</c>, not <c>cognitiveservices.azure.com</c> (a wrong scope
/// is a 401). The data-plane RBAC role is <c>Cognitive Services User</c>. On failure it surfaces a clear
/// <see cref="GenerationProviderException"/> so the shared circuit breaker (story 05) trips identically.
/// </summary>
public sealed class ClaudeFoundryGenerationProvider : IGenerationProvider
{
    // The Foundry AI-services data-plane scope for the /anthropic passthrough — distinct from the Azure
    // OpenAI adapter's cognitiveservices scope. Confirmed against the MS "use Claude in Foundry" docs.
    private static readonly string[] Scopes = ["https://ai.azure.com/.default"];

    // Stable Anthropic Messages API version (a request header, distinct from Azure's api-version query
    // param). Pinned here rather than in config: it is the wire contract this adapter is written against.
    private const string AnthropicVersion = "2023-06-01";

    // Floor for the required max_tokens when the request leaves it unset. A burst is small (measured
    // ~200 output tokens for 4 posts), but the ceiling is scaled by post count so a large cast never
    // truncates the tool_use block mid-JSON (a truncated burst fails the emit_posts parse below).
    private const int MinOutputTokens = 1024;
    private const int OutputTokensPerPost = 200;

    private readonly HttpClient _http;
    private readonly TokenCredential _credential;
    private readonly GenerationOptions _options;

    public ClaudeFoundryGenerationProvider(
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

    public string Name => "ClaudeFoundry";

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

        var body = BuildRequestBody(request, tier);
        var accessToken = await _credential
            .GetTokenAsync(new TokenRequestContext(Scopes), cancellationToken)
            .ConfigureAwait(false);

        // The Foundry Anthropic passthrough is versioned by the anthropic-version HEADER (set below), not
        // by an Azure api-version query param — unlike the /openai/... surface. So no api-version here.
        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, new Uri("anthropic/v1/messages", UriKind.Relative))
        {
            Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json"),
        };
        httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken.Token);
        httpRequest.Headers.TryAddWithoutValidation("anthropic-version", AnthropicVersion);

        var stopwatch = Stopwatch.StartNew();
        using var response = await _http.SendAsync(httpRequest, cancellationToken).ConfigureAwait(false);
        var payload = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        stopwatch.Stop();

        if (!response.IsSuccessStatusCode)
        {
            throw new GenerationProviderException(
                $"Claude on Foundry returned {(int)response.StatusCode} for model '{tier.Deployment}': {Truncate(payload, 600)}");
        }

        return Parse(payload, stopwatch.Elapsed, tier);
    }

    private static JsonObject BuildRequestBody(GenerationRequest request, TierModelOptions tier)
    {
        var userContent = string.IsNullOrWhiteSpace(request.WorldFeed) ? WorldFeedFence.Empty : request.WorldFeed;
        var maxTokens = request.MaxOutputTokens ?? Math.Max(MinOutputTokens, request.PostCount * OutputTokensPerPost);

        return new JsonObject
        {
            ["model"] = tier.Deployment,
            ["max_tokens"] = maxTokens,

            // Trusted engine context is the top-level system field (Messages API) — NOT a system message.
            ["system"] = request.SystemPrompt,

            // Untrusted world feed stays in the user turn only (ADP-024), identical to the OpenAI adapter.
            ["messages"] = new JsonArray(
                new JsonObject { ["role"] = "user", ["content"] = userContent }),

            ["tools"] = new JsonArray(JsonNode.Parse(EmitPostsTool)!),
            ["tool_choice"] = new JsonObject
            {
                ["type"] = "tool",
                ["name"] = "emit_posts",
            },
        };
    }

    private static GenerationResult Parse(string payload, TimeSpan latency, TierModelOptions tier)
    {
        using var doc = JsonDocument.Parse(payload);
        var root = doc.RootElement;

        var model = root.TryGetProperty("model", out var modelEl)
            ? modelEl.GetString() ?? tier.Model
            : tier.Model;

        if (!TryFindEmitPostsTool(root, out var toolUse))
        {
            var stop = root.TryGetProperty("stop_reason", out var sr) ? sr.GetString() : "unknown";
            throw new GenerationProviderException(
                $"Model did not call emit_posts (stop_reason={stop}). Content guard cannot run on a non-burst response.");
        }

        var posts = toolUse.TryGetProperty("input", out var input)
            ? ParsePosts(input)
            : [];
        var usage = ParseUsage(root);

        return new GenerationResult(posts, usage, latency, "ClaudeFoundry", model);
    }

    private static bool TryFindEmitPostsTool(JsonElement root, out JsonElement toolUse)
    {
        toolUse = default;
        if (!root.TryGetProperty("content", out var content) || content.ValueKind != JsonValueKind.Array)
        {
            return false;
        }

        foreach (var block in content.EnumerateArray())
        {
            if (block.TryGetProperty("type", out var type) && type.GetString() == "tool_use"
                && block.TryGetProperty("name", out var name) && name.GetString() == "emit_posts")
            {
                toolUse = block;
                return true;
            }
        }

        return false;
    }

    private static List<GeneratedPost> ParsePosts(JsonElement input)
    {
        var posts = new List<GeneratedPost>();

        if (!input.TryGetProperty("posts", out var postsEl) || postsEl.ValueKind != JsonValueKind.Array)
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

        return new GenerationUsage(
            InputTokens: ReadInt(usage, "input_tokens"),
            OutputTokens: ReadInt(usage, "output_tokens"),
            CacheReadInputTokens: ReadInt(usage, "cache_read_input_tokens"),
            CacheCreationInputTokens: ReadInt(usage, "cache_creation_input_tokens"));
    }

    private static int ReadInt(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.TryGetInt32(out var result) ? result : 0;

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : string.Concat(value.AsSpan(0, max), "…");

    // Anthropic tool definition is flat: {name, description, input_schema} — NOT wrapped in a "function"
    // object like OpenAI. Same emit_posts contract (one post per persona) as the OpenAI adapter so the
    // content guard + voice metrics inspect identical shapes across providers.
    private const string EmitPostsTool = """
    {
      "name": "emit_posts",
      "description": "Emit the generated social-media posts — exactly one per requested persona.",
      "input_schema": {
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
    """;
}
