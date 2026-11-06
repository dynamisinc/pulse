namespace Pulse.WebApi.Features.Channels.Content.Publish;

using System.Text.Json;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// FC-7a publish-options resolution (weather FU-2, press FU-3): <b>first non-null wins, no merging</b> — (1) the options
/// on the call, (2) the persisted <see cref="ContentItem.PublishOptionsJson"/>, (3) the kind's
/// <see cref="IContentKindDescriptor.ResolvePublishOptions"/>, (4) none.
/// </summary>
/// <remarks>
/// <see cref="IContentKindDescriptor.DefaultAlertMapping"/> is deliberately NOT a step: it only pre-fills the staff
/// dialog, and the funnel never raises an alert from it (E4-Q8). The persisted JSON is the <see cref="PublishOptions"/>
/// camelCase shape, so the keys written by <see cref="Serialize"/> are a stored contract.
/// </remarks>
public static class PublishOptionsResolver
{
    /// <summary>Where the winning options came from.</summary>
    public enum Source
    {
        /// <summary>No step supplied options.</summary>
        None,

        /// <summary>The options passed on the call.</summary>
        Call,

        /// <summary>The item's persisted <c>PublishOptionsJson</c>.</summary>
        Persisted,

        /// <summary>The kind descriptor's <c>ResolvePublishOptions</c>.</summary>
        Descriptor,
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>Resolves the options for a publish.</summary>
    /// <param name="callOptions">The options on the call, or null.</param>
    /// <param name="item">The item being published.</param>
    /// <param name="descriptor">The item's kind descriptor.</param>
    /// <returns>The winning options (null for none) and where they came from.</returns>
    public static (PublishOptions? Options, Source From) Resolve(
        PublishOptions? callOptions, ContentItem item, IContentKindDescriptor descriptor)
    {
        ArgumentNullException.ThrowIfNull(item);
        ArgumentNullException.ThrowIfNull(descriptor);

        if (callOptions is not null)
        {
            return (callOptions, Source.Call);
        }

        if (Deserialize(item.PublishOptionsJson) is { } persisted)
        {
            return (persisted, Source.Persisted);
        }

        // Called through the interface type so a descriptor that keeps the default member still answers.
        if (descriptor.ResolvePublishOptions(item) is { } derived)
        {
            return (derived, Source.Descriptor);
        }

        return (null, Source.None);
    }

    /// <summary>The stored form of <paramref name="options"/>, or null for none.</summary>
    /// <param name="options">The options.</param>
    /// <returns>The JSON, or null.</returns>
    public static string? Serialize(PublishOptions? options) =>
        options is null ? null : JsonSerializer.Serialize(options, JsonOptions);

    /// <summary>Reads stored options; a null, empty or unreadable value is "none" (never a failed publish).</summary>
    /// <param name="json">The stored JSON.</param>
    /// <returns>The options, or null.</returns>
    public static PublishOptions? Deserialize(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<PublishOptions>(json, JsonOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
