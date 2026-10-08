// FROZEN — demo-polish implementation.md §1.4. Change via the orchestrator only.
namespace Pulse.WebApi.Features.Social.Threads;

using Pulse.WebApi.Data.Entities;

/// <summary>The outcome of resolving a reply's parent post id.</summary>
public enum ReplyParentOutcome
{
    /// <summary>No parent requested — <c>parentPostId</c> was null or empty (a top-level post).</summary>
    None,

    /// <summary>The parent resolved inside the current exercise scope.</summary>
    Resolved,

    /// <summary>
    /// Unparseable, unknown, other-exercise OR soft-deleted — deliberately indistinguishable, so a cross-exercise
    /// id never confirms its own existence (COR-001).
    /// </summary>
    NotFound,
}

/// <summary>The result of <see cref="IReplyParentResolver.ResolveAsync"/>.</summary>
/// <param name="Outcome">What happened.</param>
/// <param name="Parent">The in-scope parent post when <paramref name="Outcome"/> is <see cref="ReplyParentOutcome.Resolved"/>; otherwise null.</param>
public sealed record ReplyParentResult(ReplyParentOutcome Outcome, Post? Parent);

/// <summary>
/// The reply-parent resolution seam (DP-8; demo-polish B1 freezes it; B2 implements it as
/// <c>ReplyParentResolver</c>, BP consumes it). Interface only — no behaviour and no DI registration here.
/// </summary>
public interface IReplyParentResolver
{
    /// <summary>Resolves a client-supplied parent post id inside the current exercise scope.</summary>
    /// <param name="parentPostId">The raw <c>parentPostId</c> from the request, or null.</param>
    /// <param name="cancellationToken">Cancels the lookup.</param>
    /// <returns>The resolution result.</returns>
    Task<ReplyParentResult> ResolveAsync(string? parentPostId, CancellationToken cancellationToken);
}
