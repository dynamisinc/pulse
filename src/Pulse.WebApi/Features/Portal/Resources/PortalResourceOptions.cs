namespace Pulse.WebApi.Features.Portal.Resources;

/// <summary>
/// The Resources shelf's tunables (exercise-portal story 04), bound from <see cref="SectionName"/>. Every default is the
/// shipped behaviour, so an absent section changes nothing.
/// </summary>
public sealed class PortalResourceOptions
{
    /// <summary>The configuration section.</summary>
    public const string SectionName = "Portal:Resources";

    /// <summary>
    /// Whether a resource may attach a <c>document</c> (PDF) media asset, the download-only kind press 02 added
    /// (Q-03, Tom 10/29). Default false: until it is turned on, only an image is accepted and a document is a <c>400</c>.
    /// </summary>
    public bool DocumentAttachmentsEnabled { get; set; }
}
