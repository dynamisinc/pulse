// FROZEN — demo-polish implementation.md §1.4. Change via the orchestrator only.
namespace Pulse.WebApi.Features.Social;

using Pulse.WebApi.Data.Entities;

/// <summary>Options for <see cref="IParticipantPostProjector.ProjectAsync"/>.</summary>
/// <param name="ViewerPersonaId">The viewing persona, if any.</param>
/// <param name="IncludeViewerState">Whether to populate <c>viewer</c> (only honoured with a viewer persona).</param>
public sealed record PostProjectionOptions(Guid? ViewerPersonaId = null, bool IncludeViewerState = false);

/// <summary>
/// The participant read-projection seam (demo-polish B1 freezes it; BP implements it as
/// <c>ParticipantPostProjector</c>). Interface only — no behaviour and no DI registration here.
/// </summary>
public interface IParticipantPostProjector
{
    /// <summary>
    /// Projects <paramref name="posts"/> to the participant-safe shape (XC-002), in the same order. Counts =
    /// baseline + real (via <see cref="Engagement.IPostEngagementReader"/>); media / poster URLs via
    /// <c>IMediaUrlSigner</c>; <c>inReplyTo</c> resolved in scope; <c>viewer</c> only when
    /// <see cref="PostProjectionOptions.IncludeViewerState"/> and <see cref="PostProjectionOptions.ViewerPersonaId"/>
    /// is not null. Soft-deleted posts are the caller's concern (callers filter before projecting, except the
    /// thread tombstone path).
    /// </summary>
    /// <param name="posts">The posts to project.</param>
    /// <param name="options">Viewer options.</param>
    /// <param name="cancellationToken">Cancels the projection.</param>
    /// <returns>One participant DTO per post, in input order.</returns>
    Task<IReadOnlyList<ParticipantPostDto>> ProjectAsync(
        IReadOnlyCollection<Post> posts, PostProjectionOptions options, CancellationToken cancellationToken);
}
