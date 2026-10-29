namespace Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// FC-7, resolves an in-sim path to link-card data (implemented by channels-foundation story 06; backs
/// <c>GET /api/link-previews</c>, SOC-004, NWS-015). Content permalinks only, in the ambient exercise scope:
/// any other path, or a draft, scheduled, retracted, unknown or cross-exercise item, resolves to null (one 404).
/// </summary>
public interface IInSimLinkResolver
{
    /// <summary>Resolves a host-relative path.</summary>
    /// <param name="path">A host-relative path such as <c>/news/newsline-7/emergency-call-delays</c>.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The preview, or null.</returns>
    Task<LinkPreviewDto?> ResolveAsync(string path, CancellationToken cancellationToken = default);
}
