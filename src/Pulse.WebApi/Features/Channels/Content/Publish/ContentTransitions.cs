namespace Pulse.WebApi.Features.Channels.Content.Publish;

using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// The pure FC-1 content state machine (channels-foundation story 04): which funnel action is allowed from which
/// <c>ContentItem.Status</c>, and the status it lands in. No database, no clock — the funnel loads the item, asks this
/// class, bumps the version and saves, so every allowed and refused transition is unit-testable (the
/// <c>InjectTransitions</c> pattern).
/// </summary>
/// <remarks>
/// <para><b>The frozen table</b> (anything else is a <c>409</c> carrying the item's current state):</para>
/// <list type="bullet">
///   <item><c>schedule</c>: <c>draft → scheduled</c>.</item>
///   <item><c>publish</c>: <c>draft → published</c>, <c>scheduled → published</c> (the runner or publish-now).</item>
///   <item><c>unschedule</c>: <c>scheduled → draft</c>.</item>
///   <item><c>retract</c>: <c>published → retracted</c>.</item>
///   <item><c>restore</c>: <c>retracted → published</c>.</item>
///   <item><c>revise</c>: <c>published → published</c> (an item stays published across a revise).</item>
///   <item><c>edit</c>: <c>draft|scheduled</c> in place (pre-publish history, PRS-004).</item>
/// </list>
/// <para>Soft delete is orthogonal to status (XC-010) and is not in the table: any live item may be deleted.</para>
/// </remarks>
public static class ContentTransitions
{
    /// <summary>The <c>publish</c> action.</summary>
    public const string Publish = "publish";

    /// <summary>The <c>schedule</c> action.</summary>
    public const string Schedule = "schedule";

    /// <summary>The <c>unschedule</c> action.</summary>
    public const string Unschedule = "unschedule";

    /// <summary>The <c>retract</c> action.</summary>
    public const string Retract = "retract";

    /// <summary>The <c>restore</c> action.</summary>
    public const string Restore = "restore";

    /// <summary>The <c>revise</c> action (published items only).</summary>
    public const string Revise = "revise";

    /// <summary>The <c>edit</c> action (draft/scheduled items only).</summary>
    public const string Edit = "edit";

    private static readonly Dictionary<string, Dictionary<string, string>> Table = new(StringComparer.Ordinal)
    {
        [Schedule] = new(StringComparer.Ordinal) { [ChannelVocabulary.StatusDraft] = ChannelVocabulary.StatusScheduled },
        [Publish] = new(StringComparer.Ordinal)
        {
            [ChannelVocabulary.StatusDraft] = ChannelVocabulary.StatusPublished,
            [ChannelVocabulary.StatusScheduled] = ChannelVocabulary.StatusPublished,
        },
        [Unschedule] = new(StringComparer.Ordinal) { [ChannelVocabulary.StatusScheduled] = ChannelVocabulary.StatusDraft },
        [Retract] = new(StringComparer.Ordinal) { [ChannelVocabulary.StatusPublished] = ChannelVocabulary.StatusRetracted },
        [Restore] = new(StringComparer.Ordinal) { [ChannelVocabulary.StatusRetracted] = ChannelVocabulary.StatusPublished },
        [Revise] = new(StringComparer.Ordinal) { [ChannelVocabulary.StatusPublished] = ChannelVocabulary.StatusPublished },
        [Edit] = new(StringComparer.Ordinal)
        {
            [ChannelVocabulary.StatusDraft] = ChannelVocabulary.StatusDraft,
            [ChannelVocabulary.StatusScheduled] = ChannelVocabulary.StatusScheduled,
        },
    };

    /// <summary>Every action in the table.</summary>
    public static IReadOnlyCollection<string> Actions => Table.Keys;

    /// <summary>The status <paramref name="action"/> moves an item in <paramref name="status"/> to, or <c>null</c> when refused.</summary>
    /// <param name="action">The funnel action.</param>
    /// <param name="status">The item's current status.</param>
    /// <returns>The target status, or <c>null</c> for an illegal transition.</returns>
    public static string? TargetOf(string action, string status)
    {
        ArgumentNullException.ThrowIfNull(action);
        ArgumentNullException.ThrowIfNull(status);

        return Table.TryGetValue(action, out var from) && from.TryGetValue(status, out var target) ? target : null;
    }

    /// <summary>The readable 409 for an illegal transition.</summary>
    /// <param name="action">The refused action.</param>
    /// <param name="status">The item's current status.</param>
    /// <returns>The message.</returns>
    public static string IllegalMessage(string action, string status) =>
        $"Cannot {action} an item that is {status}.";
}
