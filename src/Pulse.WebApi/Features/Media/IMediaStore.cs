// FROZEN — demo-polish implementation.md §1.4. Change via the orchestrator only.
namespace Pulse.WebApi.Features.Media;

/// <summary>
/// The blob-storage seam for uploaded media (demo-polish B1 freezes it; BM implements it as
/// <c>AzureBlobMediaStore</c> and the Development-only <c>LocalFileMediaStore</c>). Interface only — no
/// behaviour and no DI registration here.
/// </summary>
public interface IMediaStore
{
    /// <summary>
    /// Whether a backing store is configured. <c>false</c> means <c>POST /api/media</c> answers 503.
    /// </summary>
    bool IsConfigured { get; }

    /// <summary>
    /// Streams <paramref name="content"/> to the PRIVATE container; never buffers the whole body. Enforces
    /// <paramref name="maxBytes"/> while streaming (throws <c>MediaTooLargeException</c>, deleting the partial
    /// blob).
    /// </summary>
    /// <param name="blobName">The target blob name (<c>{ExerciseId:D}/{Id:N}.{ext}</c>).</param>
    /// <param name="contentType">The SNIFFED canonical MIME type to store on the blob.</param>
    /// <param name="content">The upload body, read once, forward-only.</param>
    /// <param name="maxBytes">The per-kind size ceiling enforced while streaming.</param>
    /// <param name="cancellationToken">Cancels the upload.</param>
    /// <returns>The number of bytes written.</returns>
    Task<long> SaveAsync(string blobName, string contentType, Stream content, long maxBytes, CancellationToken cancellationToken);

    /// <summary>Best-effort cleanup of a blob (e.g. after a failed save).</summary>
    /// <param name="blobName">The blob to delete.</param>
    /// <param name="cancellationToken">Cancels the delete.</param>
    /// <returns>A task that completes when the delete attempt has finished.</returns>
    Task DeleteAsync(string blobName, CancellationToken cancellationToken);
}
