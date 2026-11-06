namespace Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// FC-7, <b>the one funnel</b> for content state (implemented by channels-foundation story 04). Every
/// publisher (the staff API, inject fire, the scheduled runner, a participant composer, the engine) calls
/// it; nothing writes <c>ContentItem</c> rows directly.
/// </summary>
/// <remarks>
/// <para>
/// The funnel owns the FC-1 state machine (an illegal transition is <see cref="ContentPublishOutcome.Conflict"/>),
/// body sanitization by the kind's named <c>BodyPolicy</c>, payload validation
/// (<see cref="IContentKindDescriptor.ValidatePayloadAsync"/>), exercise scoping, scenario-time stamping from
/// <c>IExerciseClock</c>, revisions, telemetry (<see cref="ChannelTelemetryEventTypes"/>), the
/// <see cref="IContentPublishGate"/>, the broadcast (<c>IFeedBroadcaster</c>), observers, and the FC-7a
/// publish-options resolution. Authorization stays with the calling endpoint.
/// </para>
/// <para>
/// The exercise scope is the ambient, server-resolved one (<c>IExerciseContext</c>, or
/// <c>ExerciseContext.CurrentExerciseId</c> in a background scope); no member takes an exercise id. An item in
/// another exercise is <see cref="ContentPublishOutcome.NotFound"/>, identical to an unknown id.
/// </para>
/// </remarks>
public interface IContentPublishService
{
    /// <summary>Creates a <c>draft</c> (an <c>engine</c> caller ALWAYS lands as draft, NWS-022).</summary>
    /// <param name="request">The item's fields; <c>version</c> is ignored on create.</param>
    /// <param name="caller">The authenticated caller.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome and, on success, the staff view of the new item.</returns>
    Task<ContentPublishResult> CreateDraftAsync(
        ContentWriteRequest request, ContentCaller caller, CancellationToken cancellationToken = default);

    /// <summary>Updates a draft or scheduled item in place, writing an <c>edit</c> revision (PRS-004).</summary>
    /// <param name="id">The content item id.</param>
    /// <param name="request">The new fields; a stale <c>version</c> is a conflict.</param>
    /// <param name="caller">The authenticated caller.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome and, on success, the updated staff view.</returns>
    Task<ContentPublishResult> UpdateDraftAsync(
        Guid id, ContentWriteRequest request, ContentCaller caller, CancellationToken cancellationToken = default);

    /// <summary>
    /// Publishes now (draft or scheduled → published). <paramref name="options"/> null means "resolve them"
    /// (FC-7a: persisted options, then the descriptor's), which is how the runner and inject fire call it.
    /// </summary>
    /// <param name="id">The content item id.</param>
    /// <param name="options">Explicit options, or null to resolve.</param>
    /// <param name="caller">The authenticated caller.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome (including <see cref="ContentPublishOutcome.Held"/> from a gate) and the item.</returns>
    Task<ContentPublishResult> PublishAsync(
        Guid id, PublishOptions? options, ContentCaller caller, CancellationToken cancellationToken = default);

    /// <summary>
    /// Schedules a draft for <paramref name="scenarioTime"/> and PERSISTS <paramref name="options"/> as
    /// <c>PublishOptionsJson</c>, so the runner replays them (FC-7a).
    /// </summary>
    /// <param name="id">The content item id.</param>
    /// <param name="scenarioTime">The scenario-time publish instant, as an ISO string.</param>
    /// <param name="options">The options to persist, or null.</param>
    /// <param name="caller">The authenticated caller.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome and the item.</returns>
    Task<ContentPublishResult> ScheduleAsync(
        Guid id, string scenarioTime, PublishOptions? options, ContentCaller caller, CancellationToken cancellationToken = default);

    /// <summary>Unschedules (scheduled → draft).</summary>
    /// <param name="id">The content item id.</param>
    /// <param name="caller">The authenticated caller.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome and the item.</returns>
    Task<ContentPublishResult> UnscheduleAsync(Guid id, ContentCaller caller, CancellationToken cancellationToken = default);

    /// <summary>Retracts (published → retracted); participants then read the tombstone.</summary>
    /// <param name="id">The content item id.</param>
    /// <param name="caller">The authenticated caller.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome and the item.</returns>
    Task<ContentPublishResult> RetractAsync(Guid id, ContentCaller caller, CancellationToken cancellationToken = default);

    /// <summary>Restores (retracted → published); broadcasts <c>ContentPublished</c> again.</summary>
    /// <param name="id">The content item id.</param>
    /// <param name="caller">The authenticated caller.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome and the item.</returns>
    Task<ContentPublishResult> RestoreAsync(Guid id, ContentCaller caller, CancellationToken cancellationToken = default);

    /// <summary>
    /// Revises a published item; it stays <c>published</c>. The Updated stamp rule (FC-1) and
    /// <see cref="ReviseOptions.TouchUpdatedStamp"/> decide what participants see move.
    /// </summary>
    /// <param name="id">The content item id.</param>
    /// <param name="options">The revision.</param>
    /// <param name="caller">The authenticated caller.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome and the item.</returns>
    Task<ContentPublishResult> ReviseAsync(
        Guid id, ReviseOptions options, ContentCaller caller, CancellationToken cancellationToken = default);

    /// <summary>
    /// Soft-deletes (<c>DeletedAt</c>, XC-010), orthogonal to status. A published item also broadcasts
    /// <c>ContentRetracted</c>.
    /// </summary>
    /// <param name="id">The content item id.</param>
    /// <param name="caller">The authenticated caller.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome.</returns>
    Task<ContentPublishResult> SoftDeleteAsync(Guid id, ContentCaller caller, CancellationToken cancellationToken = default);
}

/// <summary>A funnel call's outcome. Server-internal (the endpoint maps it to a status code), never on the wire.</summary>
public enum ContentPublishOutcome
{
    /// <summary>The change committed.</summary>
    Ok,

    /// <summary>Unknown, cross-exercise or soft-deleted id (404, identical for all three).</summary>
    NotFound,

    /// <summary>Illegal transition or stale <c>version</c> (409).</summary>
    Conflict,

    /// <summary>Field or payload validation failed (400); see <see cref="ContentPublishResult.Errors"/>.</summary>
    Invalid,

    /// <summary>An <see cref="IContentPublishGate"/> held the publish (409 <c>held</c>); state unchanged.</summary>
    Held,
}

/// <summary>The result of an <see cref="IContentPublishService"/> call.</summary>
public sealed record ContentPublishResult
{
    /// <summary>The outcome.</summary>
    public required ContentPublishOutcome Outcome { get; init; }

    /// <summary>The staff view of the item after the call, when it exists.</summary>
    public ChannelContentStaffDto? Item { get; init; }

    /// <summary>Validation messages (<see cref="ContentPublishOutcome.Invalid"/>), the gate's hold reason, or a conflict reason.</summary>
    public IReadOnlyList<string> Errors { get; init; } = [];

    /// <summary>
    /// A side effect that failed WITHOUT blocking the publish (a paired post or alert that could not be
    /// made), reported to the caller; null when none failed.
    /// </summary>
    public IReadOnlyList<string>? SideEffectWarnings { get; init; }
}
