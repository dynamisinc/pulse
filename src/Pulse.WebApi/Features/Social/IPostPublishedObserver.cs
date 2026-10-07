namespace Pulse.WebApi.Features.Social;

using System;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// An in-process observer told about every post the moment it commits, before the real-time fan-out
/// (<see cref="PostIngestService"/> step 6), so a failed or cancelled broadcast can never keep a committed post from
/// its observers. The seam lets another feature react to what was published without
/// the social write path depending on it. The first observer is the engine's response-reaction wiring
/// (engine-runtime/06): a participant's post is a candidate official response.
/// </summary>
/// <remarks>
/// Called synchronously on the request path, so an observer must be cheap and must not block. A throwing
/// observer is logged and skipped; it can never fail a post that has already been committed.
/// </remarks>
public interface IPostPublishedObserver
{
    /// <summary>Called once per committed post.</summary>
    /// <param name="exerciseId">The server-resolved exercise the post was written under (COR-001).</param>
    /// <param name="post">The committed post, including its staff-only provenance (origin).</param>
    void OnPostPublished(Guid exerciseId, Post post);
}
