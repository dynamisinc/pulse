namespace Pulse.WebApi.Features.Social.Moderation;

/// <summary>What a takedown attempt did. <see cref="ModerationEndpoints"/> maps each value to an HTTP status.</summary>
public enum PostTakedownOutcome
{
    /// <summary>The post was live and this call soft-deleted it (and broadcast <c>PostRemoved</c>). 204.</summary>
    Removed,

    /// <summary>The post was already taken down. Nothing changed and nothing was broadcast. 204 (idempotent).</summary>
    AlreadyRemoved,

    /// <summary>
    /// No post with that id exists in the caller's exercise. The response is the same whether the id is
    /// unknown or belongs to another exercise (COR-001). 404.
    /// </summary>
    NotFound,

    /// <summary>The request's exercise scope is unresolved. Fails closed. 401.</summary>
    ScopeUnresolved,
}

/// <summary>The result of <see cref="PostTakedownService.TakeDownAsync"/>.</summary>
/// <param name="Outcome">What the call did.</param>
/// <param name="DeletedAt">
/// The scenario instant stamped on <c>Post.DeletedAt</c>. Set only for <see cref="PostTakedownOutcome.Removed"/>.
/// </param>
public sealed record PostTakedownResult(PostTakedownOutcome Outcome, DateTimeOffset? DeletedAt = null)
{
    /// <summary>This call took the post down at <paramref name="deletedAt"/> (scenario time).</summary>
    /// <param name="deletedAt">The scenario instant written to <c>Post.DeletedAt</c>.</param>
    /// <returns>A <see cref="PostTakedownOutcome.Removed"/> result.</returns>
    public static PostTakedownResult Removed(DateTimeOffset deletedAt) => new(PostTakedownOutcome.Removed, deletedAt);

    /// <summary>The post was already down. Idempotent no-op.</summary>
    /// <returns>An <see cref="PostTakedownOutcome.AlreadyRemoved"/> result.</returns>
    public static PostTakedownResult AlreadyRemoved() => new(PostTakedownOutcome.AlreadyRemoved);

    /// <summary>The id did not resolve in the caller's exercise.</summary>
    /// <returns>A <see cref="PostTakedownOutcome.NotFound"/> result.</returns>
    public static PostTakedownResult NotFound() => new(PostTakedownOutcome.NotFound);

    /// <summary>The request has no resolved exercise scope.</summary>
    /// <returns>A <see cref="PostTakedownOutcome.ScopeUnresolved"/> result.</returns>
    public static PostTakedownResult ScopeUnresolved() => new(PostTakedownOutcome.ScopeUnresolved);
}
