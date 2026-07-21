namespace Pulse.WebApi.Data.Entities;

using System.Collections.Generic;
using Pulse.Core.Features.Autonomy.Models;

/// <summary>
/// The durable store row for one engine review item — a single generated burst awaiting (or resolved from) a
/// controller review decision (E8 architecture §8, ADP-040). It is the persistence seam story 01 WRITES (one
/// review item per burst as it is decided) and story 02 READS / serves / mutates the disposition of. Belongs
/// to exactly one exercise run, so it is <see cref="IExerciseScoped"/> with a non-nullable
/// <see cref="ExerciseId"/> — the central <c>PulseDbContext</c> read filter + write guard cover it
/// automatically (COR-001).
/// </summary>
/// <remarks>
/// <para>
/// This carries everything needed to SERVE the shipped cockpit's <c>reviewContracts.ts</c> card, which is
/// more than the frozen <c>Pulse.Core</c> <c>EngineReviewItem</c> record (that record carries only a
/// <c>PostCount</c>, since the backend holds the drafts): the full draft <see cref="Posts"/>, and the
/// storyline context the card renders (<see cref="StorylineTag"/> / <see cref="StorylineBrief"/> /
/// <see cref="ActionLabel"/>). Draft text is STAFF-ONLY (COBRA surface); XC-002 hides engine provenance from
/// PARTICIPANTS only, so persisting + serving drafts here is not a breach.
/// </para>
/// <para>
/// The countdown is a Delayed-auto concern: <see cref="CountdownStartedScenarioMinute"/> /
/// <see cref="CountdownMinutes"/> / <see cref="CountdownDecision"/> are nullable and set together only for a
/// Delayed-auto burst (they map to a <see cref="DelayedAutoCountdown"/>); a Suggest burst leaves them null.
/// </para>
/// </remarks>
public sealed class EngineReviewItemEntity : IExerciseScoped
{
    /// <summary>The stable draft/burst identity — the primary key (one burst = one review item, ADP-040).</summary>
    public Guid DraftId { get; set; }

    /// <summary>The owning exercise run (COR-001). Non-nullable; the write-guard rejects <see cref="Guid.Empty"/>.</summary>
    public Guid ExerciseId { get; set; }

    /// <summary>The storyline the burst voices — the cockpit shows per-item storyline context.</summary>
    public Guid StorylineId { get; set; }

    /// <summary>The effective autonomy level the burst was routed at (Suggest / Delayed-auto).</summary>
    public AutonomyLevel RoutedAtLevel { get; set; }

    /// <summary>The current disposition in the review flow.</summary>
    public DraftDisposition Disposition { get; set; }

    /// <summary>The scenario minute the Delayed-auto countdown began — null unless this is a Delayed-auto burst.</summary>
    public int? CountdownStartedScenarioMinute { get; set; }

    /// <summary>The Delayed-auto countdown length in scenario minutes — null unless this is a Delayed-auto burst.</summary>
    public int? CountdownMinutes { get; set; }

    /// <summary>The controller's decision on the Delayed-auto countdown — null unless this is a Delayed-auto burst.</summary>
    public ControllerDecision? CountdownDecision { get; set; }

    /// <summary>The storyline hashtag/tag shown on the card (e.g. <c>#WaterIssues</c>).</summary>
    public required string StorylineTag { get; set; }

    /// <summary>A short storyline "brief" for the card's context line.</summary>
    public required string StorylineBrief { get; set; }

    /// <summary>The human-readable action label (e.g. <c>reply → @mvega_fh</c>).</summary>
    public required string ActionLabel { get; set; }

    /// <summary>The burst's draft posts — persisted as an owned JSON collection (one <c>nvarchar(max)</c> column).</summary>
    public IList<EngineReviewDraftPost> Posts { get; set; } = new List<EngineReviewDraftPost>();
}

/// <summary>
/// One draft post within an <see cref="EngineReviewItemEntity"/> — persisted as an owned JSON element (not a
/// child table). Mirrors the frozen <c>reviewContracts.ts</c> <c>GeneratedPost</c> the cockpit renders.
/// </summary>
public sealed class EngineReviewDraftPost
{
    /// <summary>The persona handle the draft is attributed to.</summary>
    public required string PersonaHandle { get; set; }

    /// <summary>The draft post text (staff-only; the cockpit shows it to the controller).</summary>
    public required string Text { get; set; }

    /// <summary>The generated sentiment for the draft.</summary>
    public double Sentiment { get; set; }

    /// <summary>The draft's hashtags.</summary>
    public IList<string> Hashtags { get; set; } = new List<string>();
}
