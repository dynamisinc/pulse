namespace Pulse.WebApi.Features.Injects;

using Pulse.WebApi.Features.Social;

/// <summary>
/// The queue's single publish call (IQ-2). Production is <see cref="FunnelInjectPostPublisher"/>, which IS
/// <see cref="PostIngestService.IngestAsync"/>; the seam exists so the failure path ("the funnel refused this post")
/// can be exercised before demo-polish BP adds the media/reply refusals that make it reachable with real data.
/// The composition-root test pins that the real host resolves the funnel publisher, never a substitute.
/// </summary>
public interface IInjectPostPublisher
{
    /// <summary>Publishes one scripted post through the ingest funnel.</summary>
    /// <param name="request">The funnel input built by <see cref="InjectPostRequestFactory"/>.</param>
    /// <param name="attribution">The trusted, server-stated attribution (<c>origin: inject</c>).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The funnel's result.</returns>
    Task<PostIngestResult> PublishAsync(
        CreatePostRequest request,
        PostAttribution attribution,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The production <see cref="IInjectPostPublisher"/>: a direct, in-process call to the ONE ingest funnel, so a
/// scripted post is sanitized, persisted with its own telemetry, broadcast participant-safe and seen by the post
/// observers exactly like a live persona post. Scoped, sharing the request's <c>PulseDbContext</c> unit of work.
/// </summary>
public sealed class FunnelInjectPostPublisher : IInjectPostPublisher
{
    private readonly PostIngestService _ingest;

    /// <summary>Creates the publisher over the funnel.</summary>
    /// <param name="ingest">The ingest funnel.</param>
    public FunnelInjectPostPublisher(PostIngestService ingest)
    {
        ArgumentNullException.ThrowIfNull(ingest);
        _ingest = ingest;
    }

    /// <inheritdoc />
    public Task<PostIngestResult> PublishAsync(
        CreatePostRequest request,
        PostAttribution attribution,
        CancellationToken cancellationToken = default) =>
        _ingest.IngestAsync(request, attribution, cancellationToken);
}
