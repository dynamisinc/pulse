namespace Pulse.WebApi.Features.Social;

using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Features.Social.Engagement;
using Pulse.WebApi.Features.Social.Threads;

/// <summary>
/// The fail-safe stand-ins for the three frozen seams the post read/write path CONSUMES but does not own
/// (demo-polish BP, <c>implementation.md</c> §1.4): <see cref="IPostEngagementReader"/> (B3),
/// <see cref="IMediaUrlSigner"/> (BM) and <see cref="IReplyParentResolver"/> (B2). They keep the Social slice
/// runnable on its own while those slices build in parallel, and they keep a host that never wires them
/// fail-closed rather than broken.
/// </summary>
/// <remarks>
/// <para>
/// <b>The real implementations always win.</b> Every fallback is registered with <c>TryAdd*</c>. A real
/// implementation registered with a plain <c>Add*</c> wins whichever order the two calls run in: called first,
/// it makes the <c>TryAdd</c> a no-op; called later, it is the last registration, which is the one the
/// container resolves. (A real implementation registered with <c>TryAdd*</c> would only win when it runs
/// first — so the real slices use a plain <c>Add*</c>.)
/// </para>
/// <para>
/// Each fallback fails CLOSED: no engagement is invented, no URL is minted, and no reply parent ever resolves.
/// The signer fallback is BM's own <see cref="UnconfiguredMediaUrlSigner"/> (the one <c>AddMedia</c> selects
/// for provider <c>None</c>), so there is exactly one unconfigured-signer type: it answers an empty batch with
/// an empty map, refuses an out-of-scope asset, and otherwise throws <see cref="MediaStoreUnavailableException"/>.
/// It is Scoped because it reads the request's <c>IExerciseContext</c>, the same lifetime as BM's real signers.
/// </para>
/// </remarks>
internal static class PostSeamFallbacks
{
    /// <summary>
    /// <c>TryAdd</c>s the three seam fallbacks and the participant projector. Idempotent, so each Social
    /// registration method (<c>AddSocialFeedRead</c>, <c>AddSocialPostWrite</c>, <c>AddSocialPersonaRead</c>,
    /// <c>AddSocialThreads</c>) can call it and none of them depends on another having run first.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    internal static IServiceCollection TryAddPostSeamFallbacks(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.TryAddSingleton<IPostEngagementReader, ZeroPostEngagementReader>();
        services.TryAddScoped<IMediaUrlSigner, UnconfiguredMediaUrlSigner>();
        services.TryAddSingleton<IReplyParentResolver, UnavailableReplyParentResolver>();
        services.TryAddScoped<IParticipantPostProjector, ParticipantPostProjector>();

        return services;
    }
}

/// <summary>
/// The <see cref="IPostEngagementReader"/> used until the reactions slice (B3) registers the real one: every
/// post has zero real engagement and the viewer has reacted to nothing. Projected counts therefore equal the
/// stored baseline alone.
/// </summary>
public sealed class ZeroPostEngagementReader : IPostEngagementReader
{
    private static readonly IReadOnlyDictionary<Guid, PostEngagement> Empty = new Dictionary<Guid, PostEngagement>();

    /// <inheritdoc />
    public Task<IReadOnlyDictionary<Guid, PostEngagement>> GetAsync(
        IReadOnlyCollection<Guid> postIds, Guid? viewerPersonaId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(postIds);

        // An absent id reads as zero engagement (the projector's contract), so an empty map is "all zero".
        return Task.FromResult(Empty);
    }
}

/// <summary>
/// The <see cref="IReplyParentResolver"/> used until the threads slice (B2) registers the real one. A null or
/// empty <c>parentPostId</c> is <see cref="ReplyParentOutcome.None"/> (a top-level post); ANY other value is
/// <see cref="ReplyParentOutcome.NotFound"/>, so replies are refused with a 400 rather than silently written as
/// top-level posts.
/// </summary>
public sealed class UnavailableReplyParentResolver : IReplyParentResolver
{
    private static readonly ReplyParentResult NoParent = new(ReplyParentOutcome.None, null);

    private static readonly ReplyParentResult NotFound = new(ReplyParentOutcome.NotFound, null);

    /// <inheritdoc />
    public Task<ReplyParentResult> ResolveAsync(string? parentPostId, CancellationToken cancellationToken) =>
        Task.FromResult(string.IsNullOrEmpty(parentPostId) ? NoParent : NotFound);
}
