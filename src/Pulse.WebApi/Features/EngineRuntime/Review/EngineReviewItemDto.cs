namespace Pulse.WebApi.Features.EngineRuntime.Review;

using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Serialization;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime;

/// <summary>
/// The FROZEN wire shape story 02 serves to the shipped controller cockpit — the field-for-field mirror of
/// <c>features/controller/engine/models/reviewContracts.ts</c>'s <c>EngineReviewItem</c>. Serializes to JSON
/// that deserializes into that TS shape with NO change to it (the frozen client wins). Every property carries
/// an explicit <see cref="JsonPropertyNameAttribute"/> so the camelCase wire shape is fixed independent of
/// host serializer config, and each PascalCase C# enum serializes to its lowercase-kebab literal via an
/// explicit converter (a schema mistake here is a cross-phase migration).
/// </summary>
/// <remarks>
/// <b>Seam decision (documented).</b> Unlike the frozen <c>Pulse.Core</c> <c>EngineReviewItem</c> record
/// (which carries only <c>PostCount</c>), this wire DTO carries the full <see cref="Posts"/> (draft text):
/// <c>reviewContracts.ts</c> REQUIRES <c>posts</c> — it derives <c>postCount</c>, <c>previewText</c>, and
/// <c>leadPersonaHandle</c> from it — and showing the controller the draft is the whole point of the cockpit.
/// Draft text is STAFF-ONLY (COBRA); XC-002 hides engine PROVENANCE from PARTICIPANTS, so this is not a
/// breach. Staff-only; every countdown value is scenario time (COR-050/051).
/// </remarks>
public sealed class EngineReviewItemDto
{
    /// <summary>The exercise (COR-001), as a GUID string.</summary>
    [JsonPropertyName("exerciseId")]
    public required string ExerciseId { get; init; }

    /// <summary>The storyline the burst voices, as a GUID string.</summary>
    [JsonPropertyName("storylineId")]
    public required string StorylineId { get; init; }

    /// <summary>The stable draft/burst identity, as a GUID string.</summary>
    [JsonPropertyName("draftId")]
    public required string DraftId { get; init; }

    /// <summary>The effective autonomy level the burst was routed at (<c>suggest</c> / <c>delayed-auto</c> / <c>auto</c>).</summary>
    [JsonPropertyName("routedAtLevel")]
    [JsonConverter(typeof(AutonomyLevelJsonConverter))]
    public required AutonomyLevel RoutedAtLevel { get; init; }

    /// <summary>The current disposition (<c>queued</c> / <c>counting-down</c> / <c>held</c> / <c>published</c> / <c>vetoed</c>).</summary>
    [JsonPropertyName("disposition")]
    [JsonConverter(typeof(DraftDispositionJsonConverter))]
    public required DraftDisposition Disposition { get; init; }

    /// <summary>The Delayed-auto countdown snapshot, or <c>null</c> for a Suggest (queued) burst.</summary>
    [JsonPropertyName("countdown")]
    public DelayedAutoCountdownDto? Countdown { get; init; }

    /// <summary>The burst's draft posts (staff-only). Required by the frozen contract — the card derives its preview/count from it.</summary>
    [JsonPropertyName("posts")]
    public required IReadOnlyList<GeneratedPostDto> Posts { get; init; }

    /// <summary>The storyline hashtag/tag shown on the card (e.g. <c>#WaterIssues</c>).</summary>
    [JsonPropertyName("storylineTag")]
    public required string StorylineTag { get; init; }

    /// <summary>A short storyline "brief" for the card's context line.</summary>
    [JsonPropertyName("storylineBrief")]
    public required string StorylineBrief { get; init; }

    /// <summary>The human-readable action label (e.g. <c>reply → @mvega_fh</c>).</summary>
    [JsonPropertyName("actionLabel")]
    public required string ActionLabel { get; init; }

    /// <summary>
    /// Projects a persisted <see cref="EngineReviewItemEntity"/> to the frozen wire shape. The countdown is
    /// emitted only when the entity's Delayed-auto countdown fields are set (a Suggest burst yields
    /// <c>null</c>).
    /// </summary>
    /// <param name="entity">The persisted review item.</param>
    /// <returns>The wire projection of <paramref name="entity"/>.</returns>
    public static EngineReviewItemDto FromEntity(EngineReviewItemEntity entity)
    {
        System.ArgumentNullException.ThrowIfNull(entity);

        return new EngineReviewItemDto
        {
            ExerciseId = entity.ExerciseId.ToString(),
            StorylineId = entity.StorylineId.ToString(),
            DraftId = entity.DraftId.ToString(),
            RoutedAtLevel = entity.RoutedAtLevel,
            Disposition = entity.Disposition,
            Countdown = entity.CountdownStartedScenarioMinute is { } started && entity.CountdownMinutes is { } minutes
                ? new DelayedAutoCountdownDto
                {
                    ExerciseId = entity.ExerciseId.ToString(),
                    StorylineId = entity.StorylineId.ToString(),
                    DraftId = entity.DraftId.ToString(),
                    StartedScenarioMinute = started,
                    CountdownMinutes = minutes,
                    Decision = entity.CountdownDecision ?? ControllerDecision.None,
                }
                : null,
            Posts = entity.Posts
                .Select(post => new GeneratedPostDto
                {
                    PersonaHandle = post.PersonaHandle,
                    Text = post.Text,
                    Sentiment = post.Sentiment,
                    Hashtags = post.Hashtags.ToList(),
                })
                .ToList(),
            StorylineTag = entity.StorylineTag,
            StorylineBrief = entity.StorylineBrief,
            ActionLabel = entity.ActionLabel,
        };
    }
}

/// <summary>
/// The wire shape for a Delayed-auto countdown — the field-for-field mirror of <c>reviewContracts.ts</c>'s
/// <c>DelayedAutoCountdown</c> constructor params. All minute values are SCENARIO minutes (COR-050/051).
/// </summary>
public sealed class DelayedAutoCountdownDto
{
    /// <summary>The exercise (COR-001), as a GUID string.</summary>
    [JsonPropertyName("exerciseId")]
    public required string ExerciseId { get; init; }

    /// <summary>The storyline, as a GUID string.</summary>
    [JsonPropertyName("storylineId")]
    public required string StorylineId { get; init; }

    /// <summary>The draft/burst id, as a GUID string.</summary>
    [JsonPropertyName("draftId")]
    public required string DraftId { get; init; }

    /// <summary>The scenario minute the countdown began.</summary>
    [JsonPropertyName("startedScenarioMinute")]
    public required int StartedScenarioMinute { get; init; }

    /// <summary>The countdown length in scenario minutes.</summary>
    [JsonPropertyName("countdownMinutes")]
    public required int CountdownMinutes { get; init; }

    /// <summary>The controller's decision so far (<c>none</c> / <c>approved</c> / <c>vetoed</c>).</summary>
    [JsonPropertyName("decision")]
    [JsonConverter(typeof(ControllerDecisionJsonConverter))]
    public required ControllerDecision Decision { get; init; }
}

/// <summary>
/// The wire shape for one generated draft post — the field-for-field mirror of <c>reviewContracts.ts</c>'s
/// <c>GeneratedPost</c>. Staff-only (the cockpit renders it); never a participant surface (XC-002).
/// </summary>
public sealed class GeneratedPostDto
{
    /// <summary>The persona handle the draft is attributed to.</summary>
    [JsonPropertyName("personaHandle")]
    public required string PersonaHandle { get; init; }

    /// <summary>The draft post text.</summary>
    [JsonPropertyName("text")]
    public required string Text { get; init; }

    /// <summary>The generated sentiment for the draft.</summary>
    [JsonPropertyName("sentiment")]
    public required double Sentiment { get; init; }

    /// <summary>The draft's hashtags.</summary>
    [JsonPropertyName("hashtags")]
    public required IReadOnlyList<string> Hashtags { get; init; }
}
