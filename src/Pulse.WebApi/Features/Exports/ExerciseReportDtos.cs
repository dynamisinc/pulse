namespace Pulse.WebApi.Features.Exports;

using System.Collections.Generic;
using System.Text.Json.Serialization;

/// <summary>
/// The response of <c>GET /api/staff/exports/report</c> (demo-feedback story 29): the frozen <c>ExerciseReport</c>
/// contract, field for field. STAFF world only (XC-002): it carries provenance (source, posted by, inject ref) that
/// never reaches a participant. Every time is an exercise-zone scenario time preformatted by the server
/// (<c>yyyy-MM-dd HH:mm</c> or <c>HH:mm</c>); <see cref="ReportExerciseDto.PreparedAt"/> is the one wall clock, also shown
/// in the exercise's zone so a US evening print does not read as tomorrow.
/// </summary>
public sealed class ExerciseReportDto
{
    /// <summary>The exercise header.</summary>
    [JsonPropertyName("exercise")]
    public required ReportExerciseDto Exercise { get; init; }

    /// <summary>The At a glance metrics.</summary>
    [JsonPropertyName("summary")]
    public required ReportSummaryDto Summary { get; init; }

    /// <summary>The activity chart.</summary>
    [JsonPropertyName("activity")]
    public required ReportActivityDto Activity { get; init; }

    /// <summary>One row per delivered inject (DF-42).</summary>
    [JsonPropertyName("injectResponses")]
    public required IReadOnlyList<ReportInjectResponseDto> InjectResponses { get; init; }

    /// <summary>Verified vs. lookalike pairs.</summary>
    [JsonPropertyName("lookalikes")]
    public required IReadOnlyList<ReportLookalikeDto> Lookalikes { get; init; }

    /// <summary>The post record, in scenario order.</summary>
    [JsonPropertyName("posts")]
    public required IReadOnlyList<ReportPostDto> Posts { get; init; }

    /// <summary>Noise posts left out of <see cref="Posts"/>; 0 when noise is included.</summary>
    [JsonPropertyName("omittedNoiseCount")]
    public required int OmittedNoiseCount { get; init; }
}

/// <summary>The report header.</summary>
public sealed class ReportExerciseDto
{
    /// <summary>The exercise display name.</summary>
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    /// <summary>The exercise's IANA zone (<c>UTC</c> when unset).</summary>
    [JsonPropertyName("timeZone")]
    public required string TimeZone { get; init; }

    /// <summary>The first post's scenario time, <c>yyyy-MM-dd HH:mm</c>; <c>null</c> when there are no posts.</summary>
    [JsonPropertyName("scenarioStart")]
    public required string? ScenarioStart { get; init; }

    /// <summary>The last post's scenario time, <c>yyyy-MM-dd HH:mm</c>; <c>null</c> when there are no posts.</summary>
    [JsonPropertyName("scenarioEnd")]
    public required string? ScenarioEnd { get; init; }

    /// <summary>The <c>yyyy-MM-dd</c> of <see cref="ScenarioStart"/>.</summary>
    [JsonPropertyName("conductedDate")]
    public required string? ConductedDate { get; init; }

    /// <summary>The server's wall clock when the report was built, in the exercise's zone, <c>yyyy-MM-dd HH:mm</c>.</summary>
    [JsonPropertyName("preparedAt")]
    public required string PreparedAt { get; init; }
}

/// <summary>The At a glance metrics. Noise always counts (DF-41), whatever the list shows.</summary>
public sealed class ReportSummaryDto
{
    /// <summary>Participant accounts that signed in at least once.</summary>
    [JsonPropertyName("participants")]
    public required int Participants { get; init; }

    /// <summary>Top-level posts and replies, all sources, taken-down included.</summary>
    [JsonPropertyName("posts")]
    public required int Posts { get; init; }

    /// <summary>Replies (posts with a parent).</summary>
    [JsonPropertyName("replies")]
    public required int Replies { get; init; }

    /// <summary>Delivered injects (fired, not deleted, with at least one post).</summary>
    [JsonPropertyName("injectsDelivered")]
    public required int InjectsDelivered { get; init; }

    /// <summary>The median response minutes over responded injects; <c>null</c> when none responded.</summary>
    [JsonPropertyName("medianResponseMinutes")]
    public required double? MedianResponseMinutes { get; init; }

    /// <summary>The busiest 5-minute bin; <c>null</c> when there are no posts.</summary>
    [JsonPropertyName("busiestWindow")]
    public required ReportBusiestWindowDto? BusiestWindow { get; init; }

    /// <summary>Posts edited at least once, taken-down posts included.</summary>
    [JsonPropertyName("postsEdited")]
    public required int? PostsEdited { get; init; }

    /// <summary>Taken-down posts.</summary>
    [JsonPropertyName("postsTakenDown")]
    public required int PostsTakenDown { get; init; }

    /// <summary>Posts per chart series.</summary>
    [JsonPropertyName("bySource")]
    public required ReportSourceCountsDto BySource { get; init; }
}

/// <summary>The busiest 5-minute window.</summary>
public sealed class ReportBusiestWindowDto
{
    /// <summary>The bin start, <c>yyyy-MM-dd HH:mm</c>.</summary>
    [JsonPropertyName("start")]
    public required string Start { get; init; }

    /// <summary>Posts in the bin, all sources.</summary>
    [JsonPropertyName("posts")]
    public required int Posts { get; init; }
}

/// <summary>Posts per chart series.</summary>
public sealed class ReportSourceCountsDto
{
    /// <summary>Participant and controller-as-persona posts.</summary>
    [JsonPropertyName("participant")]
    public required int Participant { get; init; }

    /// <summary>Scripted inject posts.</summary>
    [JsonPropertyName("scripted")]
    public required int Scripted { get; init; }

    /// <summary>Engine posts.</summary>
    [JsonPropertyName("engine")]
    public required int Engine { get; init; }

    /// <summary>White-noise posts.</summary>
    [JsonPropertyName("noise")]
    public required int Noise { get; init; }
}

/// <summary>The activity chart.</summary>
public sealed class ReportActivityDto
{
    /// <summary>Always <see cref="ExerciseReportBuilder.BinMinutes"/>.</summary>
    [JsonPropertyName("binMinutes")]
    public required int BinMinutes { get; init; }

    /// <summary>The bins, in time order.</summary>
    [JsonPropertyName("bins")]
    public required IReadOnlyList<ReportActivityBinDto> Bins { get; init; }

    /// <summary>One marker per delivered inject.</summary>
    [JsonPropertyName("injectMarkers")]
    public required IReadOnlyList<ReportInjectMarkerDto> InjectMarkers { get; init; }
}

/// <summary>One 5-minute bin.</summary>
public sealed class ReportActivityBinDto
{
    /// <summary>The bin start, <c>yyyy-MM-dd HH:mm</c>.</summary>
    [JsonPropertyName("start")]
    public required string Start { get; init; }

    /// <summary>Participant and controller-as-persona posts.</summary>
    [JsonPropertyName("participant")]
    public required int Participant { get; init; }

    /// <summary>Scripted inject posts.</summary>
    [JsonPropertyName("scripted")]
    public required int Scripted { get; init; }

    /// <summary>Engine posts.</summary>
    [JsonPropertyName("engine")]
    public required int Engine { get; init; }

    /// <summary>White-noise posts.</summary>
    [JsonPropertyName("noise")]
    public required int Noise { get; init; }
}

/// <summary>A delivered inject on the activity chart.</summary>
public sealed class ReportInjectMarkerDto
{
    /// <summary>The MSEL Inject # (DF-10), else the item title.</summary>
    [JsonPropertyName("ref")]
    public required string Ref { get; init; }

    /// <summary>The item title.</summary>
    [JsonPropertyName("title")]
    public required string Title { get; init; }

    /// <summary>The inject's first post, <c>yyyy-MM-dd HH:mm</c>.</summary>
    [JsonPropertyName("at")]
    public required string At { get; init; }

    /// <summary>The bin holding the inject's first post.</summary>
    [JsonPropertyName("binIndex")]
    public required int BinIndex { get; init; }
}

/// <summary>One delivered inject and its first participant response (DF-42).</summary>
public sealed class ReportInjectResponseDto
{
    /// <summary>The MSEL Inject # (DF-10), else the item title.</summary>
    [JsonPropertyName("ref")]
    public required string Ref { get; init; }

    /// <summary>The item title.</summary>
    [JsonPropertyName("title")]
    public required string Title { get; init; }

    /// <summary>The inject's first post, <c>yyyy-MM-dd HH:mm</c>.</summary>
    [JsonPropertyName("deliveredAt")]
    public required string DeliveredAt { get; init; }

    /// <summary>The first response, <c>yyyy-MM-dd HH:mm</c>; <c>null</c> when nobody responded.</summary>
    [JsonPropertyName("firstResponseAt")]
    public required string? FirstResponseAt { get; init; }

    /// <summary>Minutes from delivery to the first response (one decimal); <c>null</c> when nobody responded.</summary>
    [JsonPropertyName("responseMinutes")]
    public required double? ResponseMinutes { get; init; }

    /// <summary>The responding persona's <c>@handle</c>; <c>null</c> when nobody responded.</summary>
    [JsonPropertyName("respondedAsHandle")]
    public required string? RespondedAsHandle { get; init; }
}

/// <summary>A verified persona and its lookalike.</summary>
public sealed class ReportLookalikeDto
{
    /// <summary>The verified account.</summary>
    [JsonPropertyName("verified")]
    public required ReportAccountDto Verified { get; init; }

    /// <summary>The unverified lookalike.</summary>
    [JsonPropertyName("lookalike")]
    public required ReportAccountDto Lookalike { get; init; }
}

/// <summary>A persona with its summed shown engagement.</summary>
public sealed class ReportAccountDto
{
    /// <summary>The <c>@handle</c>.</summary>
    [JsonPropertyName("handle")]
    public required string Handle { get; init; }

    /// <summary>The display name.</summary>
    [JsonPropertyName("displayName")]
    public required string DisplayName { get; init; }

    /// <summary>Whether the persona is verified.</summary>
    [JsonPropertyName("verified")]
    public required bool Verified { get; init; }

    /// <summary>Shown likes summed over the persona's posts (64-bit: the sum can pass <see cref="int.MaxValue"/>).</summary>
    [JsonPropertyName("likes")]
    public required long Likes { get; init; }

    /// <summary>Shown reposts summed over the persona's posts (64-bit).</summary>
    [JsonPropertyName("reposts")]
    public required long Reposts { get; init; }
}

/// <summary>One post in the record.</summary>
public sealed class ReportPostDto
{
    /// <summary>The post id.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The scenario time, <c>yyyy-MM-dd HH:mm</c>.</summary>
    [JsonPropertyName("scenarioAt")]
    public required string ScenarioAt { get; init; }

    /// <summary>The scenario time, <c>HH:mm</c>.</summary>
    [JsonPropertyName("scenarioTime")]
    public required string ScenarioTime { get; init; }

    /// <summary>The authoring persona.</summary>
    [JsonPropertyName("author")]
    public required ReportAuthorDto Author { get; init; }

    /// <summary>The <c>ReportSource</c> (<see cref="ExerciseReportBuilder.Source"/>).</summary>
    [JsonPropertyName("source")]
    public required string Source { get; init; }

    /// <summary>The acting human's display name; <c>null</c> for engine and noise, or when unresolved.</summary>
    [JsonPropertyName("postedBy")]
    public required string? PostedBy { get; init; }

    /// <summary>The inject reference; <c>null</c> when none or unresolved.</summary>
    [JsonPropertyName("injectRef")]
    public required string? InjectRef { get; init; }

    /// <summary>The parent author's <c>@handle</c> when the parent resolves in the exercise.</summary>
    [JsonPropertyName("replyToHandle")]
    public required string? ReplyToHandle { get; init; }

    /// <summary>The parent id when the parent resolves in the exercise.</summary>
    [JsonPropertyName("parentPostId")]
    public required string? ParentPostId { get; init; }

    /// <summary>The post text.</summary>
    [JsonPropertyName("text")]
    public required string Text { get; init; }

    /// <summary>The media, in slot order.</summary>
    [JsonPropertyName("media")]
    public required IReadOnlyList<ReportMediaDto> Media { get; init; }

    /// <summary>Shown likes (baseline + real).</summary>
    [JsonPropertyName("likes")]
    public required int Likes { get; init; }

    /// <summary>Shown reposts (baseline + real).</summary>
    [JsonPropertyName("reposts")]
    public required int Reposts { get; init; }

    /// <summary>Shown replies (baseline + real).</summary>
    [JsonPropertyName("replies")]
    public required int Replies { get; init; }

    /// <summary>Whether a controller pinned the post for everyone.</summary>
    [JsonPropertyName("pinnedForAll")]
    public required bool PinnedForAll { get; init; }

    /// <summary>The takedown's scenario time, <c>yyyy-MM-dd HH:mm</c>; <c>null</c> for a live post.</summary>
    [JsonPropertyName("takenDownAt")]
    public required string? TakenDownAt { get; init; }

    /// <summary>How many times the author edited the post (<c>Post.EditCount</c>); 0 when never edited.</summary>
    [JsonPropertyName("editCount")]
    public required int? EditCount { get; init; }

    /// <summary>The last edit's scenario time, <c>yyyy-MM-dd HH:mm</c>; <c>null</c> when never edited.</summary>
    [JsonPropertyName("lastEditedAt")]
    public required string? LastEditedAt { get; init; }
}

/// <summary>A post's author.</summary>
public sealed class ReportAuthorDto
{
    /// <summary>The <c>@handle</c>; empty when the persona does not resolve in the exercise.</summary>
    [JsonPropertyName("handle")]
    public required string Handle { get; init; }

    /// <summary>The display name; empty when the persona does not resolve.</summary>
    [JsonPropertyName("displayName")]
    public required string DisplayName { get; init; }

    /// <summary>Whether the persona is verified.</summary>
    [JsonPropertyName("verified")]
    public required bool Verified { get; init; }

    /// <summary>The signed avatar URL, or <c>null</c>.</summary>
    [JsonPropertyName("avatarUrl")]
    public required string? AvatarUrl { get; init; }
}

/// <summary>One media item.</summary>
public sealed class ReportMediaDto
{
    /// <summary><c>image</c> or <c>video</c>.</summary>
    [JsonPropertyName("kind")]
    public required string Kind { get; init; }

    /// <summary>The image's signed URL, or the video's signed poster URL; <c>null</c> when there is none.</summary>
    [JsonPropertyName("url")]
    public required string? Url { get; init; }

    /// <summary>The alt text.</summary>
    [JsonPropertyName("alt")]
    public required string Alt { get; init; }

    /// <summary>The video duration in seconds; <c>null</c> for an image or when unknown.</summary>
    [JsonPropertyName("durationSec")]
    public required double? DurationSec { get; init; }

    /// <summary>The pixel width, when known.</summary>
    [JsonPropertyName("width")]
    public required int? Width { get; init; }

    /// <summary>The pixel height, when known.</summary>
    [JsonPropertyName("height")]
    public required int? Height { get; init; }
}
