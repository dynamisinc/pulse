namespace Pulse.WebApi.Features.Injects;

/// <summary>
/// The item kind wire literals (the frozen 06 ↔ 07 contract: <c>InjectKind = 'post' | 'burst'</c>). Stored verbatim
/// on <see cref="Data.Entities.InjectItem.Kind"/>, so the database and the wire can never disagree.
/// </summary>
public static class InjectKinds
{
    /// <summary>A single scripted post (exactly one child).</summary>
    public const string Post = "post";

    /// <summary>A paced pile-on (2..20 children across a window).</summary>
    public const string Burst = "burst";
}

/// <summary>
/// The item status wire literals (<c>InjectStatus</c>). Stored verbatim on
/// <see cref="Data.Entities.InjectItem.Status"/>.
/// </summary>
public static class InjectStatuses
{
    /// <summary>Authored and waiting for a controller.</summary>
    public const string Pending = "pending";

    /// <summary>Held by a controller — a burst that had started is suspended.</summary>
    public const string Held = "held";

    /// <summary>Released and publishing (a burst mid-window, or a single post in flight).</summary>
    public const string Firing = "firing";

    /// <summary>Every child fired or skipped — terminal.</summary>
    public const string Fired = "fired";

    /// <summary>Skipped by a controller (remaining children skipped).</summary>
    public const string Skipped = "skipped";

    /// <summary>At least one child was refused by the funnel; retry re-fires the failed children.</summary>
    public const string Failed = "failed";
}

/// <summary>The child status wire literals (<c>InjectPostStatus</c>).</summary>
public static class InjectPostStatuses
{
    /// <summary>Not yet published (possibly claimed and in flight).</summary>
    public const string Pending = "pending";

    /// <summary>Published through the funnel; <c>FiredPostId</c> names the post.</summary>
    public const string Fired = "fired";

    /// <summary>Skipped with its item.</summary>
    public const string Skipped = "skipped";

    /// <summary>Refused by the funnel (or its reply parent was never published).</summary>
    public const string Failed = "failed";
}

/// <summary>The <c>payload.action</c> literals of the XC-004 <c>inject_action</c> event (IQ-8).</summary>
public static class InjectActions
{
    /// <summary>An item was created.</summary>
    public const string Create = "create";

    /// <summary>An item was edited.</summary>
    public const string Edit = "edit";

    /// <summary>An item was soft-deleted.</summary>
    public const string Delete = "delete";

    /// <summary>The queue was reordered.</summary>
    public const string Reorder = "reorder";

    /// <summary>An item was held.</summary>
    public const string Hold = "hold";

    /// <summary>A held item was released.</summary>
    public const string Release = "release";

    /// <summary>An item was skipped.</summary>
    public const string Skip = "skip";

    /// <summary>A skipped item was restored.</summary>
    public const string Unskip = "unskip";

    /// <summary>An item was fired.</summary>
    public const string Fire = "fire";

    /// <summary>A failed item's failed posts were re-fired.</summary>
    public const string Retry = "retry";
}
