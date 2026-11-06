namespace Pulse.WebApi.Features.Channels.Contracts;

using System.Text.Json.Nodes;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// FC-7, what a content kind contributes (the interface is channels-foundation story 02's; the
/// implementations are E4 news, E5 press and E6 weather). A channel adds a kind by registering one of these
/// in DI, never by editing the <c>ContentItem</c> entity (FC-1 additive registry).
/// </summary>
/// <remarks>
/// Descriptors are <b>scoped</b> DI services, so validation can read the exercise's own data (zone existence,
/// supersession) through <see cref="PayloadValidationContext"/>. Validation is async-only: no synchronous
/// payload validation is offered (weather FU-3).
/// </remarks>
public interface IContentKindDescriptor
{
    /// <summary>The kind this descriptor owns (<see cref="ChannelVocabulary.ContentKinds"/>).</summary>
    string Kind { get; }

    /// <summary>The channel the kind belongs to (<see cref="ChannelVocabulary.ContentChannelIds"/>).</summary>
    string ChannelId { get; }

    /// <summary>
    /// The NAMED sanitizer profile for the body (<see cref="ISanitizerProfileRegistry"/>). An unregistered name
    /// is a startup failure.
    /// </summary>
    string BodyPolicy { get; }

    /// <summary>The media kinds an item of this kind may attach (<see cref="ChannelVocabulary.ContentMediaKinds"/>).</summary>
    IReadOnlySet<string> AllowedMediaKinds { get; }

    /// <summary>
    /// The alert the staff publish dialog PRE-FILLS for this kind, or null. A suggestion only: the funnel never
    /// raises an alert from it (FC-7a, E4-Q8).
    /// </summary>
    PublishAlertOptions? DefaultAlertMapping { get; }

    /// <summary>Validates the kind-specific payload against the item being written.</summary>
    /// <param name="payload">The untrusted payload from the write request.</param>
    /// <param name="context">The resolved exercise scope and scoped services.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The result; any error fails the write with a 400.</returns>
    Task<PayloadValidationResult> ValidatePayloadAsync(
        JsonObject payload, PayloadValidationContext context, CancellationToken cancellationToken = default);

    /// <summary>
    /// Projects the stored payload to its participant-safe form (the <c>payload</c> on
    /// <see cref="ChannelContentDto"/>). Drops anything staff-only (XC-002).
    /// </summary>
    /// <param name="payload">The stored payload.</param>
    /// <returns>The participant-safe projection.</returns>
    JsonObject ProjectPayload(JsonObject payload);

    /// <summary>
    /// Step (3) of FC-7a: publish options derived from the item itself (e.g. weather reads its payload
    /// <c>delivery</c> block), used only when neither the call nor the persisted options supply any.
    /// </summary>
    /// <param name="item">The item being published.</param>
    /// <returns>The options, or null (the default) for none.</returns>
    /// <remarks>A default interface member: the funnel calls it through <see cref="IContentKindDescriptor"/>.</remarks>
    PublishOptions? ResolvePublishOptions(ContentItem item) => null;

    /// <summary>
    /// The alert suggestion for ONE item: what the staff publish dialog pre-fills when it opens on <paramref name="item"/>.
    /// Defaults to <see cref="DefaultAlertMapping"/>; a kind whose suggestion depends on the item (news suggests an
    /// <c>advisory</c> only for a breaking article, NWS-012) overrides it. Like <see cref="DefaultAlertMapping"/> it is a
    /// suggestion only: the funnel never raises an alert from it (FC-7a).
    /// </summary>
    /// <param name="item">The item the dialog is publishing.</param>
    /// <returns>The suggestion, or null for none.</returns>
    /// <remarks>Additive default interface member (news story 01). Dialogs should call this rather than read the property.</remarks>
    PublishAlertOptions? SuggestAlert(ContentItem item) => DefaultAlertMapping;
}

/// <summary>What <see cref="IContentKindDescriptor.ValidatePayloadAsync"/> may read.</summary>
public sealed record PayloadValidationContext
{
    /// <summary>The server-resolved exercise (never client-supplied).</summary>
    public required Guid ExerciseId { get; init; }

    /// <summary>The scoped context, already filtered to <see cref="ExerciseId"/> by the central query filter.</summary>
    public required PulseDbContext Db { get; init; }

    /// <summary>The request's scoped services.</summary>
    public required IServiceProvider Services { get; init; }

    /// <summary>The item being written, or null on create.</summary>
    public Guid? ContentItemId { get; init; }

    /// <summary>The target status of the write (<see cref="ChannelVocabulary.ContentStatuses"/>).</summary>
    public required string TargetStatus { get; init; }

    /// <summary>
    /// The write's media list as the funnel resolved it: every entry names an in-scope asset the kind's
    /// <see cref="IContentKindDescriptor.AllowedMediaKinds"/> allows (or the write already failed). Empty when the write
    /// carries none. Lets a kind add media rules of its own (news: one hero, a video hero needs a poster).
    /// </summary>
    public IReadOnlyList<PayloadMediaRef> Media { get; init; } = [];

    /// <summary>The write's <c>heroMediaId</c> as the funnel resolved it, or null.</summary>
    public Guid? HeroMediaId { get; init; }
}

/// <summary>One media entry of the write, as passed to <see cref="PayloadValidationContext.Media"/>.</summary>
/// <param name="MediaId">The in-scope media asset id.</param>
/// <param name="Role">The role (<see cref="ChannelVocabulary.MediaRoles"/>).</param>
public sealed record PayloadMediaRef(Guid MediaId, string Role);

/// <summary>The result of <see cref="IContentKindDescriptor.ValidatePayloadAsync"/>.</summary>
/// <param name="Errors">One message per problem, keyed by payload path where useful; empty when valid.</param>
public sealed record PayloadValidationResult(IReadOnlyList<string> Errors)
{
    /// <summary>A valid result.</summary>
    public static PayloadValidationResult Valid { get; } = new([]);

    /// <summary>Whether the payload is acceptable.</summary>
    public bool IsValid => Errors.Count == 0;

    /// <summary>An invalid result. At least one error is required, so an "invalid" result can never read as valid.</summary>
    /// <param name="error">The first problem.</param>
    /// <param name="more">Any further problems.</param>
    /// <returns>The result.</returns>
    public static PayloadValidationResult Invalid(string error, params string[] more) => new([error, .. more]);
}
