namespace Pulse.WebApi.Features.Portal.Contracts;

/// <summary>The authenticated staff caller of a portal write (the telemetry actor, COR-018).</summary>
public sealed record PortalStaffCaller
{
    /// <summary>The acting staff human. Server-resolved from the session, never from a request body.</summary>
    public required string ActingHumanId { get; init; }
}

/// <summary>A portal write's outcome. Server-internal (the endpoint maps it to a status code), never on the wire.</summary>
public enum PortalWriteOutcome
{
    /// <summary>The change committed.</summary>
    Ok,

    /// <summary>Unknown, cross-exercise or soft-deleted id (404, identical for all three).</summary>
    NotFound,

    /// <summary>Stale <c>version</c> (409).</summary>
    Conflict,

    /// <summary>Validation failed (400): a limit, an unknown vocabulary value, a refused media asset or skin override.</summary>
    Invalid,
}

/// <summary>The result of an <see cref="IPortalConfigService"/> or <see cref="IPortalResourceService"/> write.</summary>
/// <typeparam name="T">The staff view returned on success.</typeparam>
public sealed record PortalWriteResult<T>
    where T : class
{
    /// <summary>The outcome.</summary>
    public required PortalWriteOutcome Outcome { get; init; }

    /// <summary>The staff view after the write, when it succeeded.</summary>
    public T? Value { get; init; }

    /// <summary>
    /// Readable reasons for <see cref="PortalWriteOutcome.Invalid"/> or <see cref="PortalWriteOutcome.Conflict"/>.
    /// A refused media id says "not usable", never whether it exists in another exercise.
    /// </summary>
    public IReadOnlyList<string> Errors { get; init; } = [];
}
