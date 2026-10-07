namespace Pulse.WebApi.Features.EngineRuntime.Addressing;

using System;
using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social;

/// <summary>
/// Feeds the engine's <see cref="IAddressingInbox"/> from the social write path (engine-runtime/06). A committed
/// post whose origin is <c>participant</c> becomes an official-post addressing candidate for the next tick. In
/// pilot mode the participants ARE the responders (a PIO posting as their agency), and their social posts are
/// the qualifying responses (master PRD, Phases 1–2). Engine, controller-as-persona and inject posts are the
/// world talking, never a response, so they are ignored.
/// </summary>
public sealed class EngineAddressingObserver : IPostPublishedObserver
{
    private const string ParticipantOrigin = "participant";

    private readonly IAddressingInbox _inbox;

    /// <summary>Creates the observer over the engine's addressing inbox.</summary>
    /// <param name="inbox">The inbox the reaction loop drains each tick.</param>
    public EngineAddressingObserver(IAddressingInbox inbox)
    {
        ArgumentNullException.ThrowIfNull(inbox);
        _inbox = inbox;
    }

    /// <inheritdoc />
    public void OnPostPublished(Guid exerciseId, Post post)
    {
        ArgumentNullException.ThrowIfNull(post);

        if (!string.Equals(post.Origin, ParticipantOrigin, StringComparison.Ordinal))
        {
            return;
        }

        _inbox.Enqueue(
            exerciseId,
            new AddressingObservation(AddressingSource.OfficialPost, post.Id.ToString(), post.Body));
    }
}
