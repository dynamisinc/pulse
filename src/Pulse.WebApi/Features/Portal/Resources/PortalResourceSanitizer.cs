namespace Pulse.WebApi.Features.Portal.Resources;

using System.Collections.Frozen;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// The sanitizer profile a resource's <c>bodyHtml</c> passes through once at write (exercise-portal story 04, NFR-004),
/// registered on F04's <see cref="ISanitizerProfileRegistry"/> through <c>AddSanitizerProfile</c>, never a fork of the
/// sanitizer.
/// </summary>
/// <remarks>
/// It is F04's rich-body element set (<see cref="BuiltInProfiles.RichBasic"/>) with NO absolute URL scheme allowed, so a
/// link survives only as a host-relative path or a <c>#fragment</c> (FC-9.3, Q-E3-8): an external <c>https://</c> link
/// loses its <c>href</c>. Scripts, handlers, <c>javascript:</c> URLs, forms and iframes go as they do for every profile.
/// </remarks>
public static class PortalResourceSanitizer
{
    /// <summary>The registered profile name.</summary>
    public const string ProfileName = "portal-resource";

    /// <summary>The profile.</summary>
    public static SanitizerProfile Profile { get; } = BuiltInProfiles.RichBasic with
    {
        AllowedUrlSchemes = FrozenSet<string>.Empty,
    };
}
