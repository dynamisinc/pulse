namespace Pulse.WebApi.Features.Injects;

using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Pulse.WebApi.Data.Entities;
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

    /// <summary>
    /// The ONE message for a media id that does not resolve to a library asset of this exercise — unparseable, unknown
    /// or another exercise's (COR-001). The funnel's own text (PostIngestService), so authoring and fire agree.
    /// </summary>
    public const string MediaNotFoundMessage = "One or more media items could not be found.";

    /// <summary>
    /// The ONE message for a <c>replyTo.postId</c> that is not a live post of this exercise — unparseable, unknown,
    /// another exercise's or taken down — mirroring B2's resolver and the funnel's own wording (COR-001, DP-16).
    /// </summary>
    public const string ReplyPostNotFoundMessage = "replyTo.postId does not name a post in this exercise.";

    /// <summary>The media count/kind rule, in the funnel's own words: up to 4 images or exactly 1 video, never mixed.</summary>
    public const string MediaCountMessage = "A post may carry up to 4 images or exactly 1 video, never both.";

    /// <summary>The longest RAW alt text accepted before sanitizing — the funnel's DoS bound (4 × 1000).</summary>
    private const int MaxRawAltLength = 4 * MaxAltLength;

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

        var duplicate = drafts
            .Select((draft, index) => (draft.Id, Position: index + 1))
            .Where(entry => entry.Id is not null)
            .GroupBy(entry => entry.Id)
            .FirstOrDefault(group => group.Count() > 1);
        if (duplicate is not null)
        {
            return InjectDraftParse.Fail($"{Label(duplicate.Skip(1).First().Position)}: the same post appears twice.");
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

        // A child id names an existing live child of THIS item; on create there is none, so any id is refused. An id
        // of another item's child, or of nothing at all, gets the same message (COR-001).
        var echoed = new List<Guid?>(draft.Posts.Count);
        for (var index = 0; index < draft.Posts.Count; index++)
        {
            var id = draft.Posts[index].Id;
            if (id is { } childId && !facts.EditedItemChildIds.Contains(childId))
            {
                return $"{Label(index + 1)}: id does not name a post of this item.";
            }

            echoed.Add(id);
        }

        for (var index = 0; index < draft.Posts.Count; index++)
        {
            var post = draft.Posts[index];
            var label = Label(index + 1);

            if (!facts.PersonasInScope.Contains(post.PersonaId))
            {
                return $"{label}: personaId does not name a persona in this exercise.";
            }

            // A published child echoed in an edit is history (immutable, checked separately): its media or parent post
            // may since have been taken down, and that must not lock the rest of the item.
            var published = post.Id is { } childId && facts.PublishedChildIds.Contains(childId);

            if (!published && MediaError(post, facts.MediaKindsInScope) is { } mediaError)
            {
                return $"{label}: {mediaError}";
            }

            if (!published && post.ReplyToPostId is { } parentPost && !facts.PostsInScope.Contains(parentPost))
            {
                return $"{label}: {ReplyPostNotFoundMessage}";
            }

            if (post.ReplyToInjectPostId is not { } target)
            {
                continue;
            }

            // A sibling named by id: it must stay in the item AND come earlier in the NEW order.
            var siblingPosition = echoed.IndexOf(target);
            if (siblingPosition >= 0)
            {
                if (siblingPosition >= index)
                {
                    return $"{label}: replyTo.injectPostId must name an earlier post when it is in the same item.";
                }

                continue;
            }

            // Otherwise it must be a post of ANOTHER live item. A child of the edited item that this edit removes (or
            // that was removed earlier) is not a valid target, so the owning item must differ.
            if (facts.EditedItemChildIds.Contains(target)
                || !facts.ReplyTargetsInScope.TryGetValue(target, out var owningItem)
                || (facts.EditedItemId is { } edited && owningItem == edited))
            {
                return $"{label}: replyTo.injectPostId does not name a scripted post in this exercise.";
            }
        }

        return null;
    }

    /// <summary>
    /// The media rules that need the asset table, mirroring the funnel: every id must be a library asset of THIS
    /// exercise (unknown and cross-exercise read the same), and the attachments are up to 4 images or exactly 1 video,
    /// never mixed.
    /// </summary>
    private static string? MediaError(InjectPostDraft post, IReadOnlyDictionary<Guid, string> kindsInScope)
    {
        if (post.Media.Count == 0)
        {
            return null;
        }

        var kinds = new List<string>(post.Media.Count);
        foreach (var media in post.Media)
        {
            if (!kindsInScope.TryGetValue(media.AssetId, out var kind))
            {
                return MediaNotFoundMessage;
            }

            kinds.Add(kind);
        }

        var videos = kinds.Count(kind => kind == MediaKinds.Video);
        var images = kinds.Count(kind => kind == MediaKinds.Image);
        return videos + images != kinds.Count || (videos > 0 && kinds.Count != 1) ? MediaCountMessage : null;
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

        Guid? id = null;
        if (!string.IsNullOrWhiteSpace(post.Id))
        {
            if (!Guid.TryParse(post.Id, out var parsedId) || parsedId == Guid.Empty)
            {
                return (null, $"{label}: id does not name a post of this item.");
            }

            id = parsedId;
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
            // The funnel's own rules and messages (PostIngestService.ResolveMediaAsync), so a script that passes here
            // is not refused at fire for the same reason. Kinds (images vs one video) need the asset table: phase 2.
            if (requested.Count > MaxMedia)
            {
                return (null, $"{label}: {MediaCountMessage}");
            }

            var seen = new HashSet<Guid>();
            foreach (var item in requested)
            {
                if (string.IsNullOrWhiteSpace(item?.MediaId))
                {
                    return (null, $"{label}: every media item needs a mediaId.");
                }

                if (!Guid.TryParse(item.MediaId.Trim(), out var assetId) || assetId == Guid.Empty)
                {
                    return (null, $"{label}: {MediaNotFoundMessage}");
                }

                if (!seen.Add(assetId))
                {
                    return (null, $"{label}: The same mediaId cannot be attached twice.");
                }

                // Alt length is UTF-16 units after sanitizing, exactly as the funnel measures it (NFR-001 + NFR-004).
                if (item.Alt is { Length: > MaxRawAltLength })
                {
                    return (null, $"{label}: alt text must be at most {MaxAltLength} characters.");
                }

                var alt = Clean(item.Alt);
                if (alt is null)
                {
                    return (null, $"{label}: alt text is required on every media item.");
                }

                if (alt.Length > MaxAltLength)
                {
                    return (null, $"{label}: alt text must be at most {MaxAltLength} characters.");
                }

                media.Add(new InjectMediaDraft(assetId, alt));
            }
        }

        Guid? replyToInjectPostId = null;
        Guid? replyToPostId = null;
        int? replyToSequence = null;
        if (post.ReplyTo is { } replyTo)
        {
            var hasInject = !string.IsNullOrWhiteSpace(replyTo.InjectPostId);
            var hasPost = !string.IsNullOrWhiteSpace(replyTo.PostId);
            var hasSequence = replyTo.Sequence is not null;
            if ((hasInject ? 1 : 0) + (hasPost ? 1 : 0) + (hasSequence ? 1 : 0) != 1)
            {
                return (null, $"{label}: replyTo must name exactly one of injectPostId, postId or sequence.");
            }

            if (hasSequence)
            {
                if (replyTo.Sequence is not { } sequence || sequence < 1 || sequence >= position)
                {
                    return (null, $"{label}: replyTo.sequence must name an earlier post in this item.");
                }

                replyToSequence = sequence;
            }
            else if (hasInject)
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
                    return (null, $"{label}: {ReplyPostNotFoundMessage}");
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
            id,
            personaId,
            text,
            media,
            replyToInjectPostId,
            replyToPostId,
            replyToSequence,
            baseline?.Like,
            baseline?.Repost,
            baseline?.Reply), null);
    }

    private static bool OutOfRange(int? value) => value is < 0 or > MaxBaseline;

    private static string Label(int position) => string.Create(CultureInfo.InvariantCulture, $"Post {position}");

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
/// <param name="Id">The existing child this write keeps (PUT), or <c>null</c> for a new child.</param>
/// <param name="PersonaId">The persona id.</param>
/// <param name="Text">The sanitized text.</param>
/// <param name="Media">The media references.</param>
/// <param name="ReplyToInjectPostId">The scripted reply target by id, or <c>null</c>.</param>
/// <param name="ReplyToPostId">The existing-post reply target, or <c>null</c>.</param>
/// <param name="ReplyToSequence">The earlier-sibling reply target by 1-based position, or <c>null</c>.</param>
/// <param name="BaselineLike">Seeded likes, or <c>null</c>.</param>
/// <param name="BaselineRepost">Seeded reposts, or <c>null</c>.</param>
/// <param name="BaselineReply">Seeded replies, or <c>null</c>.</param>
public sealed record InjectPostDraft(
    Guid? Id,
    Guid PersonaId,
    string Text,
    IReadOnlyList<InjectMediaDraft> Media,
    Guid? ReplyToInjectPostId,
    Guid? ReplyToPostId,
    int? ReplyToSequence,
    int? BaselineLike,
    int? BaselineRepost,
    int? BaselineReply);

/// <summary>A validated media reference.</summary>
/// <param name="AssetId">The library asset id.</param>
/// <param name="Alt">The sanitized alt text.</param>
public sealed record InjectMediaDraft(Guid AssetId, string Alt);

/// <summary>
/// The in-scope facts <see cref="InjectItemValidator.CheckReferences"/> checks a draft against. Every set holds only
/// ids the service found INSIDE the resolved exercise, which is what makes a cross-exercise id read as unknown.
/// </summary>
/// <param name="PersonasInScope">The draft's persona ids that exist in this exercise.</param>
/// <param name="Roster">The staff user ids assigned to this exercise.</param>
/// <param name="ReplyTargetsInScope">The draft's scripted reply targets that exist in a live item of this exercise, mapped to their item.</param>
/// <param name="EditedItemId">The item being edited, or <c>null</c> on create.</param>
/// <param name="EditedItemChildIds">The edited item's live child ids; empty on create.</param>
/// <param name="MediaKindsInScope">The draft's media asset ids found in this exercise's library, mapped to their kind.</param>
/// <param name="PostsInScope">The draft's <c>replyTo.postId</c> targets that are live (not taken down) posts of this exercise.</param>
/// <param name="PublishedChildIds">The edited item's children that already went out (exempt from re-validation); empty on create.</param>
public sealed record InjectReferenceFacts(
    IReadOnlySet<Guid> PersonasInScope,
    IReadOnlySet<Guid> Roster,
    IReadOnlyDictionary<Guid, Guid> ReplyTargetsInScope,
    Guid? EditedItemId,
    IReadOnlySet<Guid> EditedItemChildIds,
    IReadOnlyDictionary<Guid, string> MediaKindsInScope,
    IReadOnlySet<Guid> PostsInScope,
    IReadOnlySet<Guid> PublishedChildIds);
