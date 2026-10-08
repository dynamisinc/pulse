namespace Pulse.WebApi.Features.Injects;

using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Pulse.WebApi.Features.Social;

/// <summary>
/// The pure validation core for an <see cref="InjectItemWriteRequest"/> (inject-queue story 06). Two phases, so the
/// rules are unit-testable with no database:
/// <list type="number">
///   <item><see cref="Parse"/> — shape, ranges and lengths, producing a sanitized <see cref="InjectItemDraft"/>;</item>
///   <item><see cref="CheckReferences"/> — the ids the draft names, against facts the service read IN SCOPE.</item>
/// </list>
/// Every failure is one readable message the endpoint returns as a <c>400</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Lengths are code points (runes), not UTF-16 units</b>, so an emoji counts once — what a controller sees.
/// </para>
/// <para>
/// <b>Free text is sanitized on write (NFR-004 — strip, never encode)</b> with the funnel's own
/// <see cref="PostSanitizer"/>, and the limits apply to the sanitized text. The funnel sanitizes again at fire (an
/// idempotent no-op), so what the console shows is exactly what participants will see.
/// </para>
/// <para>
/// <b>Cross-exercise ids are indistinguishable from unknown ones (COR-001).</b> The reference facts only ever contain
/// ids the service found inside the resolved scope, so an id from another exercise fails with the SAME message as an
/// id that does not exist.
/// </para>
/// </remarks>
public static class InjectItemValidator
{
    /// <summary>The maximum title length in code points.</summary>
    public const int MaxTitleLength = 120;

    /// <summary>The maximum notes length in code points.</summary>
    public const int MaxNotesLength = 500;

    /// <summary>The maximum post text length in code points.</summary>
    public const int MaxTextLength = 280;

    /// <summary>The maximum alt-text length in code points.</summary>
    public const int MaxAltLength = 1000;

    /// <summary>The maximum media attachments per post.</summary>
    public const int MaxMedia = 4;

    /// <summary>The maximum media id length (a GUID string fits comfortably).</summary>
    public const int MaxMediaIdLength = 64;

    /// <summary>The smallest burst.</summary>
    public const int MinBurstPosts = 2;

    /// <summary>The largest burst.</summary>
    public const int MaxBurstPosts = 20;

    /// <summary>The shortest burst window in seconds.</summary>
    public const int MinBurstWindowSeconds = 30;

    /// <summary>The longest burst window in seconds.</summary>
    public const int MaxBurstWindowSeconds = 600;

    /// <summary>The burst window used when none is given.</summary>
    public const int DefaultBurstWindowSeconds = 90;

    /// <summary>The largest seeded engagement count.</summary>
    public const int MaxBaseline = 1_000_000;

    /// <summary>
    /// Phase 1: validates shape, ranges and lengths, and returns the sanitized draft — or the first readable error.
    /// </summary>
    /// <param name="request">The untrusted write body (may be <c>null</c>).</param>
    /// <returns>The parse result.</returns>
    public static InjectDraftParse Parse(InjectItemWriteRequest? request)
    {
        if (request is null)
        {
            return InjectDraftParse.Fail("A JSON body is required.");
        }

        if (request.Kind is not (InjectKinds.Post or InjectKinds.Burst))
        {
            return InjectDraftParse.Fail("kind must be 'post' or 'burst'.");
        }

        var title = Clean(request.Title);
        if (title is null || CodePoints(title) is < 1 or > MaxTitleLength)
        {
            return InjectDraftParse.Fail($"title must be between 1 and {MaxTitleLength} characters.");
        }

        var notes = Clean(request.Notes);
        if (notes is not null && CodePoints(notes) > MaxNotesLength)
        {
            return InjectDraftParse.Fail($"notes must be at most {MaxNotesLength} characters.");
        }

        if (request.PlannedMinute is < 0)
        {
            return InjectDraftParse.Fail("plannedMinute must be a whole number of minutes, 0 or more.");
        }

        Guid? assigneeId = null;
        if (!string.IsNullOrWhiteSpace(request.AssigneeId))
        {
            if (!Guid.TryParse(request.AssigneeId, out var parsedAssignee) || parsedAssignee == Guid.Empty)
            {
                return InjectDraftParse.Fail(UnknownAssigneeMessage);
            }

            assigneeId = parsedAssignee;
        }

        var posts = request.Posts;
        if (posts is null || posts.Count == 0)
        {
            return InjectDraftParse.Fail("posts is required.");
        }

        int? window = null;
        if (request.Kind == InjectKinds.Post)
        {
            if (posts.Count != 1)
            {
                return InjectDraftParse.Fail("A 'post' item must have exactly 1 post.");
            }
        }
        else
        {
            if (posts.Count is < MinBurstPosts or > MaxBurstPosts)
            {
                return InjectDraftParse.Fail($"A 'burst' must have between {MinBurstPosts} and {MaxBurstPosts} posts.");
            }

            window = request.BurstWindowSeconds ?? DefaultBurstWindowSeconds;
            if (window is < MinBurstWindowSeconds or > MaxBurstWindowSeconds)
            {
                return InjectDraftParse.Fail(
                    $"burstWindowSeconds must be between {MinBurstWindowSeconds} and {MaxBurstWindowSeconds}.");
            }

            // IQ-4's pacing guarantee (no gap under 3 s) is only satisfiable if the window can hold every gap.
            var needed = InjectBurstPacing.MinimumWindowSeconds(posts.Count);
            if (window < needed)
            {
                return InjectDraftParse.Fail(
                    $"A burst of {posts.Count} posts needs a window of at least {needed} seconds "
                    + $"({InjectBurstPacing.MinGapSeconds} s between posts).");
            }
        }

        var drafts = new List<InjectPostDraft>(posts.Count);
        for (var index = 0; index < posts.Count; index++)
        {
            var parsed = ParsePost(posts[index], index + 1);
            if (parsed.Error is not null)
            {
                return InjectDraftParse.Fail(parsed.Error);
            }

            drafts.Add(parsed.Draft!);
        }

        return InjectDraftParse.Ok(new InjectItemDraft(
            request.Kind, title, notes, request.PlannedMinute, assigneeId, window, drafts));
    }

    /// <summary>
    /// Phase 2: checks every id the draft names against facts read inside the resolved exercise scope. Returns the
    /// first readable error, or <c>null</c> when every reference resolves.
    /// </summary>
    /// <param name="draft">The parsed draft.</param>
    /// <param name="facts">The in-scope reference facts.</param>
    /// <returns>An error message, or <c>null</c>.</returns>
    public static string? CheckReferences(InjectItemDraft draft, InjectReferenceFacts facts)
    {
        ArgumentNullException.ThrowIfNull(draft);
        ArgumentNullException.ThrowIfNull(facts);

        if (draft.AssigneeId is { } assignee && !facts.Roster.Contains(assignee))
        {
            return UnknownAssigneeMessage;
        }

        for (var index = 0; index < draft.Posts.Count; index++)
        {
            var post = draft.Posts[index];
            var label = Label(index + 1);

            if (!facts.PersonasInScope.Contains(post.PersonaId))
            {
                return $"{label}: personaId does not name a persona in this exercise.";
            }

            if (post.ReplyToInjectPostId is not { } target)
            {
                continue;
            }

            var siblingPosition = IndexOf(facts.EditedItemChildIds, target);
            if (siblingPosition >= 0)
            {
                if (siblingPosition >= index)
                {
                    return $"{label}: replyTo.injectPostId must name an earlier post when it is in the same item.";
                }

                continue;
            }

            // A reference into ANOTHER live item. A child of the item being edited that is not at a live position
            // (a soft-deleted position) is not a valid target either, so the owning item must differ.
            if (!facts.ReplyTargetsInScope.TryGetValue(target, out var owningItem)
                || (facts.EditedItemId is { } edited && owningItem == edited))
            {
                return $"{label}: replyTo.injectPostId does not name a scripted post in this exercise.";
            }
        }

        return null;
    }

    /// <summary>Counts the code points (runes) in <paramref name="value"/>.</summary>
    /// <param name="value">The text.</param>
    /// <returns>The code-point count.</returns>
    public static int CodePoints(string value)
    {
        ArgumentNullException.ThrowIfNull(value);

        var count = 0;
        foreach (var _ in value.EnumerateRunes())
        {
            count++;
        }

        return count;
    }

    private const string UnknownAssigneeMessage =
        "assigneeId does not name a staff member assigned to this exercise.";

    private static (InjectPostDraft? Draft, string? Error) ParsePost(InjectPostWriteRequest? post, int position)
    {
        var label = Label(position);
        if (post is null)
        {
            return (null, $"{label}: a post object is required.");
        }

        if (!Guid.TryParse(post.PersonaId, out var personaId) || personaId == Guid.Empty)
        {
            return (null, $"{label}: personaId does not name a persona in this exercise.");
        }

        var text = Clean(post.Text);
        if (text is null || CodePoints(text) is < 1 or > MaxTextLength)
        {
            return (null, $"{label}: text must be between 1 and {MaxTextLength} characters.");
        }

        var media = new List<InjectMediaDraft>();
        if (post.Media is { Count: > 0 } requested)
        {
            if (requested.Count > MaxMedia)
            {
                return (null, $"{label}: at most {MaxMedia} media items may be attached.");
            }

            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var item in requested)
            {
                var mediaId = item?.MediaId?.Trim();
                if (string.IsNullOrEmpty(mediaId) || mediaId.Length > MaxMediaIdLength)
                {
                    return (null, $"{label}: every media item needs a mediaId.");
                }

                if (!seen.Add(mediaId))
                {
                    return (null, $"{label}: the same media item is attached twice.");
                }

                var alt = Clean(item!.Alt);
                if (alt is null || CodePoints(alt) is < 1 or > MaxAltLength)
                {
                    return (null, $"{label}: every media item needs alt text of 1 to {MaxAltLength} characters.");
                }

                media.Add(new InjectMediaDraft(mediaId, alt));
            }
        }

        Guid? replyToInjectPostId = null;
        Guid? replyToPostId = null;
        if (post.ReplyTo is { } replyTo)
        {
            var hasInject = !string.IsNullOrWhiteSpace(replyTo.InjectPostId);
            var hasPost = !string.IsNullOrWhiteSpace(replyTo.PostId);
            if (hasInject == hasPost)
            {
                return (null, $"{label}: replyTo must name exactly one of injectPostId or postId.");
            }

            if (hasInject)
            {
                if (!Guid.TryParse(replyTo.InjectPostId, out var parsed) || parsed == Guid.Empty)
                {
                    return (null, $"{label}: replyTo.injectPostId does not name a scripted post in this exercise.");
                }

                replyToInjectPostId = parsed;
            }
            else
            {
                if (!Guid.TryParse(replyTo.PostId, out var parsed) || parsed == Guid.Empty)
                {
                    return (null, $"{label}: replyTo.postId must be a post id.");
                }

                replyToPostId = parsed;
            }
        }

        var baseline = post.EngagementBaseline;
        if (baseline is not null
            && (OutOfRange(baseline.Like) || OutOfRange(baseline.Repost) || OutOfRange(baseline.Reply)))
        {
            return (null, $"{label}: engagementBaseline counts must be between 0 and {MaxBaseline:N0}.");
        }

        return (new InjectPostDraft(
            personaId,
            text,
            media,
            replyToInjectPostId,
            replyToPostId,
            baseline?.Like,
            baseline?.Repost,
            baseline?.Reply), null);
    }

    private static bool OutOfRange(int? value) => value is < 0 or > MaxBaseline;

    private static string Label(int position) => string.Create(CultureInfo.InvariantCulture, $"Post {position}");

    private static int IndexOf(IReadOnlyList<Guid> ids, Guid target)
    {
        for (var index = 0; index < ids.Count; index++)
        {
            if (ids[index] == target)
            {
                return index;
            }
        }

        return -1;
    }

    /// <summary>Sanitizes (NFR-004) and trims free text; <c>null</c> when nothing is left.</summary>
    private static string? Clean(string? value)
    {
        if (value is null)
        {
            return null;
        }

        var cleaned = PostSanitizer.Sanitize(value).Trim();
        return cleaned.Length == 0 ? null : cleaned;
    }
}

/// <summary>The outcome of <see cref="InjectItemValidator.Parse"/>: a draft, or a readable error.</summary>
/// <param name="Draft">The sanitized draft when valid.</param>
/// <param name="Error">The first validation error when invalid.</param>
public sealed record InjectDraftParse(InjectItemDraft? Draft, string? Error)
{
    /// <summary>A valid parse.</summary>
    /// <param name="draft">The draft.</param>
    /// <returns>The result.</returns>
    public static InjectDraftParse Ok(InjectItemDraft draft) => new(draft, null);

    /// <summary>An invalid parse.</summary>
    /// <param name="error">The readable error.</param>
    /// <returns>The result.</returns>
    public static InjectDraftParse Fail(string error) => new(null, error);
}

/// <summary>A validated, sanitized item write.</summary>
/// <param name="Kind">The kind literal.</param>
/// <param name="Title">The sanitized title.</param>
/// <param name="Notes">The sanitized notes, or <c>null</c>.</param>
/// <param name="PlannedMinute">The planned minute, or <c>null</c>.</param>
/// <param name="AssigneeId">The assignee, or <c>null</c>.</param>
/// <param name="BurstWindowSeconds">The burst window (bursts only).</param>
/// <param name="Posts">The child drafts in order.</param>
public sealed record InjectItemDraft(
    string Kind,
    string Title,
    string? Notes,
    int? PlannedMinute,
    Guid? AssigneeId,
    int? BurstWindowSeconds,
    IReadOnlyList<InjectPostDraft> Posts);

/// <summary>A validated, sanitized child post write.</summary>
/// <param name="PersonaId">The persona id.</param>
/// <param name="Text">The sanitized text.</param>
/// <param name="Media">The media references.</param>
/// <param name="ReplyToInjectPostId">The scripted reply target, or <c>null</c>.</param>
/// <param name="ReplyToPostId">The existing-post reply target, or <c>null</c>.</param>
/// <param name="BaselineLike">Seeded likes, or <c>null</c>.</param>
/// <param name="BaselineRepost">Seeded reposts, or <c>null</c>.</param>
/// <param name="BaselineReply">Seeded replies, or <c>null</c>.</param>
public sealed record InjectPostDraft(
    Guid PersonaId,
    string Text,
    IReadOnlyList<InjectMediaDraft> Media,
    Guid? ReplyToInjectPostId,
    Guid? ReplyToPostId,
    int? BaselineLike,
    int? BaselineRepost,
    int? BaselineReply);

/// <summary>A validated media reference.</summary>
/// <param name="MediaId">The asset id.</param>
/// <param name="Alt">The sanitized alt text.</param>
public sealed record InjectMediaDraft(string MediaId, string Alt);

/// <summary>
/// The in-scope facts <see cref="InjectItemValidator.CheckReferences"/> checks a draft against. Every set holds only
/// ids the service found INSIDE the resolved exercise, which is what makes a cross-exercise id read as unknown.
/// </summary>
/// <param name="PersonasInScope">The draft's persona ids that exist in this exercise.</param>
/// <param name="Roster">The staff user ids assigned to this exercise.</param>
/// <param name="ReplyTargetsInScope">The draft's scripted reply targets that exist in a live item of this exercise, mapped to their item.</param>
/// <param name="EditedItemId">The item being edited, or <c>null</c> on create.</param>
/// <param name="EditedItemChildIds">The edited item's live child ids by position (index 0 = sequence 1); empty on create.</param>
public sealed record InjectReferenceFacts(
    IReadOnlySet<Guid> PersonasInScope,
    IReadOnlySet<Guid> Roster,
    IReadOnlyDictionary<Guid, Guid> ReplyTargetsInScope,
    Guid? EditedItemId,
    IReadOnlyList<Guid> EditedItemChildIds);
