namespace Pulse.WebApi.Features.Injects.Import;

using System.Collections.Generic;
using System.Globalization;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Turns an <see cref="ImportCandidate"/> into the ordinary <see cref="InjectItemWriteRequest"/> a console create or edit
/// sends, so an imported row is judged by <see cref="InjectItemValidator"/> exactly as typed input is, and says what an
/// update would change (DF-10). The alt text and engagement baseline of story 16 (DF-21) travel in the request's own
/// <c>media[].alt</c> and <c>engagementBaseline</c>, so an imported item and a seeded item with the same values are
/// stored identically.
/// </summary>
public static class ImportRequests
{
    /// <summary>The create body for a candidate: one <c>post</c> item with one child, keyed by its <c>Inject #</c>.</summary>
    /// <param name="candidate">The candidate.</param>
    /// <returns>The write request.</returns>
    public static InjectItemWriteRequest ForCreate(ImportCandidate candidate)
    {
        ArgumentNullException.ThrowIfNull(candidate);

        return Build(candidate, candidate.AssigneeId, childId: null, replyTo: null, Baseline(candidate));
    }

    /// <summary>
    /// The edit body for a candidate whose item exists: the MSEL-owned fields from the file (alt text included); the
    /// child's identity and its reply target kept as they are (the MSEL has no column for them); the engagement baseline
    /// from the file when it has any engagement column (story 16: then a blank cell is "not set"), else kept as it is (a
    /// plain Cadence export must not wipe console-set numbers); and, unless the file's <c>Responsible Controller</c>
    /// matched someone, the item's current assignee kept too (blank or unmatched alike).
    /// </summary>
    /// <param name="candidate">The candidate.</param>
    /// <param name="item">The existing item, with its children loaded.</param>
    /// <returns>The write request.</returns>
    public static InjectItemWriteRequest ForUpdate(ImportCandidate candidate, InjectItem item)
    {
        ArgumentNullException.ThrowIfNull(candidate);
        ArgumentNullException.ThrowIfNull(item);

        var children = InjectTransitions.LiveChildren(item);
        var child = children.Count > 0 ? children[0] : null;
        var replyTo = child switch
        {
            { ReplyToInjectPostId: { } injectPostId } => new InjectReplyToWriteRequest { InjectPostId = injectPostId.ToString() },
            { ReplyToPostId: { } postId } => new InjectReplyToWriteRequest { PostId = postId.ToString() },
            _ => null,
        };
        var baseline = candidate.EngagementInFile ? Baseline(candidate) : KeptBaseline(child);

        var assignee = candidate.KeepExistingAssignee ? item.AssigneeId : candidate.AssigneeId;
        return Build(candidate, assignee, child?.Id, replyTo, baseline);
    }

    /// <summary>
    /// What applying <paramref name="draft"/> would change on <paramref name="item"/>, as readable field names (empty
    /// when the item already matches the file).
    /// </summary>
    /// <param name="item">The existing item, with its children loaded.</param>
    /// <param name="draft">The validated draft for the row.</param>
    /// <returns>The changed fields, in a fixed order.</returns>
    public static IReadOnlyList<string> Differences(InjectItem item, InjectItemDraft draft)
    {
        ArgumentNullException.ThrowIfNull(item);
        ArgumentNullException.ThrowIfNull(draft);

        var changes = new List<string>();
        if (!string.Equals(item.Title, draft.Title, StringComparison.Ordinal))
        {
            changes.Add("title");
        }

        if (!string.Equals(item.Notes, draft.Notes, StringComparison.Ordinal))
        {
            changes.Add("notes");
        }

        if (item.PlannedMinute != draft.PlannedMinute)
        {
            changes.Add("planned minute");
        }

        if (item.AssigneeId != draft.AssigneeId)
        {
            changes.Add("assignee");
        }

        var children = InjectTransitions.LiveChildren(item);
        if (item.Kind != draft.Kind || children.Count != draft.Posts.Count)
        {
            changes.Add("kind");
            return changes;
        }

        var child = children[0];
        var post = draft.Posts[0];
        if (child.PersonaId != post.PersonaId)
        {
            changes.Add("persona");
        }

        if (!string.Equals(child.Text, post.Text, StringComparison.Ordinal))
        {
            changes.Add("text");
        }

        var sameFiles = child.Media.Count == post.Media.Count
            && child.Media.Zip(post.Media).All(pair =>
                Guid.TryParse(pair.First.MediaId, out var mediaId) && mediaId == pair.Second.AssetId);
        if (!sameFiles)
        {
            changes.Add("media");
        }
        else if (!child.Media.Zip(post.Media).All(pair => string.Equals(pair.First.Alt, pair.Second.Alt, StringComparison.Ordinal)))
        {
            changes.Add("alt text");
        }

        // Story 16: "not set" IS zero (the participant count is baseline + real), so null and 0 are the same value here
        // and a console-set 0 against a blank cell is not a change.
        if ((child.BaselineLike ?? 0) != (post.BaselineLike ?? 0)
            || (child.BaselineRepost ?? 0) != (post.BaselineRepost ?? 0)
            || (child.BaselineReply ?? 0) != (post.BaselineReply ?? 0))
        {
            changes.Add("engagement");
        }

        return changes;
    }

    /// <summary>The candidate's engagement baseline as the write body carries it; <c>null</c> when no column is set.</summary>
    private static InjectEngagementBaselineWriteRequest? Baseline(ImportCandidate candidate) =>
        candidate.BaselineLike is null && candidate.BaselineRepost is null && candidate.BaselineReply is null
            ? null
            : new InjectEngagementBaselineWriteRequest
            {
                Like = candidate.BaselineLike,
                Repost = candidate.BaselineRepost,
                Reply = candidate.BaselineReply,
            };

    /// <summary>The child's own baseline, echoed unchanged (the pre-story-16 update body).</summary>
    private static InjectEngagementBaselineWriteRequest? KeptBaseline(InjectItemPost? child) =>
        child is null || (child.BaselineLike is null && child.BaselineRepost is null && child.BaselineReply is null)
            ? null
            : new InjectEngagementBaselineWriteRequest
            {
                Like = child.BaselineLike,
                Repost = child.BaselineRepost,
                Reply = child.BaselineReply,
            };

    private static InjectItemWriteRequest Build(
        ImportCandidate candidate,
        Guid? assigneeId,
        Guid? childId,
        InjectReplyToWriteRequest? replyTo,
        InjectEngagementBaselineWriteRequest? baseline) => new()
        {
            Kind = InjectKinds.Post,
            Title = candidate.Title,
            Notes = candidate.Notes,
            PlannedMinute = candidate.PlannedMinute,
            AssigneeId = assigneeId?.ToString(),
            ExternalRef = candidate.ExternalRef,
            Posts =
            [
                new InjectPostWriteRequest
                {
                    Id = childId?.ToString(),
                    PersonaId = candidate.PersonaId.ToString(),
                    Text = candidate.Text,
                    Media = candidate.Media
                        .Select(media => (InjectMediaWriteRequest?)new InjectMediaWriteRequest
                        {
                            MediaId = media.AssetId.ToString("D", CultureInfo.InvariantCulture),
                            Alt = media.Alt,
                        })
                        .ToList(),
                    ReplyTo = replyTo,
                    EngagementBaseline = baseline,
                },
            ],
        };
}
