namespace Pulse.Core.Features.Generation.Services;

using System.Diagnostics;
using System.Text.Json;
using Anthropic.Exceptions;
using Anthropic.Foundry;
using Anthropic.Models.Messages;
using Azure.Core;
using Microsoft.Extensions.Options;
using Pulse.Core.Features.Generation.Models;

/// <summary>
/// Tenant-bounded Claude-on-Azure-AI-Foundry adapter behind <see cref="IGenerationProvider"/>, on the
/// official Anthropic .NET SDK (<c>Anthropic.Foundry</c>) — the quality-preferred alternative to
/// <see cref="AzureOpenAIGenerationProvider"/> (architecture §3.1), selected per deployment by the eval
/// harness on measured voice fidelity, never from preference.
///
/// It speaks the Anthropic Messages API (Foundry's <c>/anthropic/v1/messages</c> passthrough, which the
/// SDK targets automatically from the resource name): the trusted engine context is the top-level
/// <c>system</c> field, the untrusted world feed rides only in the user turn (ADP-024), and structured
/// output is forced via a Messages-API <c>tool_use</c> (<c>tool_choice</c> = the <c>emit_posts</c> tool)
/// so Claude returns the burst as a tool_use block — the same <c>emit_posts</c> contract the OpenAI
/// adapter uses, so the content guard + voice metrics inspect identical shapes.
///
/// Auth is keyless — an Entra token from the injected <see cref="TokenCredential"/> via
/// <see cref="AnthropicFoundryIdentityTokenCredentials"/> (scope <c>https://ai.azure.com/.default</c>,
/// data-plane role <c>Cognitive Services User</c>), matching the account's <c>disableLocalAuth</c> posture
/// (NFR-005). The SDK's transport is our resilient <see cref="HttpClient"/> (the shared Polly pipeline),
/// so degraded-mode (NFR-003 / ADP-042) trips identically to the OpenAI adapter; the SDK's own retry is
/// disabled so Polly owns resilience. The <c>anthropic-version</c> header is set by the SDK.
/// </summary>
public sealed class ClaudeFoundryGenerationProvider : IGenerationProvider, IDisposable
{
    // Floor for the required max_tokens when the request leaves it unset. A burst is small (measured
    // ~200 output tokens for 4 posts), but the ceiling is scaled by post count so a large cast never
    // truncates the tool_use block mid-JSON (a truncated burst fails the emit_posts parse below).
    private const int MinOutputTokens = 1024;
    private const int OutputTokensPerPost = 200;

    private readonly AnthropicFoundryClient _client;
    private readonly GenerationOptions _options;

    public ClaudeFoundryGenerationProvider(
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
            throw new GenerationConfigurationException("Generation:Endpoint is required for provider 'ClaudeFoundry'.");
        }

        // The Foundry client takes a RESOURCE NAME (it builds https://{name}.services.ai.azure.com/anthropic
        // itself), not a URL — derive it from the configured endpoint host's first label. Our resilient
        // HttpClient is the transport (Polly owns retries + the breaker); disable the SDK's own retry.
        var resourceName = ResourceNameFrom(_options.Endpoint);
        var credentials = new AnthropicFoundryIdentityTokenCredentials(credential, resourceName);
        _client = new AnthropicFoundryClient(credentials)
        {
            HttpClient = http,
            MaxRetries = 0,
        };
    }

    public string Name => "ClaudeFoundry";

    public GenerationGovernance Governance { get; }

    /// <summary>Disposes the SDK client. The injected HttpClient is owned by IHttpClientFactory, not this
    /// client, so it is not disposed here.</summary>
    public void Dispose() => _client.Dispose();

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
        var maxTokens = request.MaxOutputTokens ?? Math.Max(MinOutputTokens, request.PostCount * OutputTokensPerPost);

        var parameters = new MessageCreateParams
        {
            Model = tier.Deployment,
            MaxTokens = maxTokens,

            // Trusted engine context is the top-level system field; the untrusted world feed rides in the
            // user turn only (ADP-024), identical to the OpenAI adapter.
            System = request.SystemPrompt,
            Messages = [new() { Role = Role.User, Content = userContent }],

            Tools = [EmitPostsTool],
            ToolChoice = new ToolChoiceTool { Name = "emit_posts" },
        };

        var stopwatch = Stopwatch.StartNew();
        Message response;
        try
        {
            response = await _client.Messages.Create(parameters, cancellationToken).ConfigureAwait(false);
        }
        catch (AnthropicApiException ex)
        {
            throw new GenerationProviderException(
                $"Claude on Foundry failed for model '{tier.Deployment}': {Truncate(ex.Message, 600)}", ex);
        }

        stopwatch.Stop();
        return Parse(response, stopwatch.Elapsed, tier);
    }

    private static GenerationResult Parse(Message response, TimeSpan latency, TierModelOptions tier)
    {
        ToolUseBlock? emit = null;
        foreach (var block in response.Content)
        {
            if (block.TryPickToolUse(out var toolUse) && toolUse.Name == "emit_posts")
            {
                emit = toolUse;
                break;
            }
        }

        if (emit is null)
        {
            throw new GenerationProviderException(
                $"Model did not call emit_posts (stop_reason={response.StopReason}). Content guard cannot run on a non-burst response.");
        }

        var posts = emit.Input.TryGetValue("posts", out var postsEl) ? ParsePosts(postsEl) : [];
        var usage = ParseUsage(response.Usage);

        // response.Model is an ApiEnum<string, Model>; take its string value, falling back to the config.
        string model = response.Model;
        if (string.IsNullOrEmpty(model))
        {
            model = tier.Model;
        }

        return new GenerationResult(posts, usage, latency, "ClaudeFoundry", model);
    }

    private static List<GeneratedPost> ParsePosts(JsonElement postsEl)
    {
        var posts = new List<GeneratedPost>();
        if (postsEl.ValueKind != JsonValueKind.Array)
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

    private static GenerationUsage ParseUsage(Usage usage)
    {
        // Anthropic's InputTokens EXCLUDES cache tokens (cache read + creation are reported separately);
        // the cost model accounts for these semantics per provider.
        return new GenerationUsage(
            InputTokens: (int)usage.InputTokens,
            OutputTokens: (int)usage.OutputTokens,
            CacheReadInputTokens: (int)(usage.CacheReadInputTokens ?? 0),
            CacheCreationInputTokens: (int)(usage.CacheCreationInputTokens ?? 0));
    }

    private static string ResourceNameFrom(string endpoint)
    {
        var host = new Uri(endpoint, UriKind.Absolute).Host;
        var label = host.Split('.', 2)[0];
        if (string.IsNullOrWhiteSpace(label))
        {
            throw new GenerationConfigurationException(
                $"Could not derive a Foundry resource name from Generation:Endpoint '{endpoint}'.");
        }

        return label;
    }

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : string.Concat(value.AsSpan(0, max), "…");

    // Anthropic tool definition: flat {name, description, input_schema}. Same emit_posts contract (one
    // post per persona) as the OpenAI adapter so the guard + voice metrics inspect identical shapes.
    // Built once (static) — it is an immutable request parameter reused across bursts.
    private static readonly Tool EmitPostsTool = new()
    {
        Name = "emit_posts",
        Description = "Emit the generated social-media posts — exactly one per requested persona.",
        InputSchema = new()
        {
            Properties = new Dictionary<string, JsonElement>
            {
                ["posts"] = JsonSerializer.SerializeToElement(new
                {
                    type = "array",
                    description = "One post per persona, each written in that persona's own voice.",
                    items = new
                    {
                        type = "object",
                        properties = new
                        {
                            personaHandle = new { type = "string", description = "The @handle of the persona authoring this post." },
                            text = new { type = "string", description = "The post body — in-world, in the persona's voice." },
                            sentiment = new { type = "number", description = "Sentiment from -1.0 (very negative) to 1.0 (very positive)." },
                            hashtags = new { type = "array", items = new { type = "string" }, description = "Hashtags used, including the leading #." },
                        },
                        required = new[] { "personaHandle", "text", "sentiment", "hashtags" },
                        additionalProperties = false,
                    },
                }),
            },
            Required = ["posts"],
        },
    };
}
