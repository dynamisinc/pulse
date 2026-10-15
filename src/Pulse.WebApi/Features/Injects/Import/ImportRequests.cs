namespace Pulse.WebApi.Features.Injects.Import;

using System.Collections.Generic;
using System.Globalization;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Turns an <see cref="ImportCandidate"/> into the ordinary <see cref="InjectItemWriteRequest"/> a console create or edit
/// sends, so an imported row is judged by <see cref="InjectItemValidator"/> exactly as typed input is, and says what an
/// update would change (DF-10).
/// </summary>
public static class ImportRequests
{
    /// <summary>The create body for a candidate: one <c>post</c> item with one child, keyed by its <c>Inject #</c>.</summary>
    /// <param name="candidate">The candidate.</param>
    /// <returns>The write request.</returns>
    public static InjectItemWriteRequest ForCreate(ImportCandidate candidate)
    {
        ArgumentNullException.ThrowIfNull(candidate);

        return Build(candidate, candidate.AssigneeId, childId: null, replyTo: null, baseline: null);
    }

    /// <summary>
    /// The edit body for a candidate whose item exists: the MSEL-owned fields from the file; the child's identity, its
    /// reply target and its seeded engagement kept as they are (the MSEL has no columns for them); and, unless the file's
    /// <c>Responsible Controller</c> matched someone, the item's current assignee kept too (blank or unmatched alike).
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
        var baseline = child is null || (child.BaselineLike is null && child.BaselineRepost is null && child.BaselineReply is null)
            ? null
            : new InjectEngagementBaselineWriteRequest
            {
                Like = child.BaselineLike,
                Repost = child.BaselineRepost,
                Reply = child.BaselineReply,
            };

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

        var sameMedia = child.Media.Count == post.Media.Count
            && child.Media.Zip(post.Media).All(pair =>
                Guid.TryParse(pair.First.MediaId, out var mediaId)
                && mediaId == pair.Second.AssetId
                && string.Equals(pair.First.Alt, pair.Second.Alt, StringComparison.Ordinal));
        if (!sameMedia)
        {
            changes.Add("media");
        }

        return changes;
    }

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
