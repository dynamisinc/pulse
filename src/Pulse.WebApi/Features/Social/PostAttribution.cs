namespace Pulse.WebApi.Features.Social;

/// <summary>
/// The server-derived answer to <b>who is really posting</b> — the one thing <see cref="PostIngestService"/>
/// will not accept from a request body. Scope has been server-authoritative since B1 (COR-001); as of
/// <c>identity-auth-roles/12</c> attribution is too, and this type is how that becomes visible in the
/// signature rather than a convention someone has to remember.
/// </summary>
/// <remarks>
/// <para>
/// <b>Who builds one.</b> On the HTTP path, <see cref="PostAttributionResolver"/> derives it from the caller's
/// persisted session (never from <see cref="CreatePostRequest"/>). On an in-process path — the engine reaction
/// loop's publish funnel (<c>EnginePublishService</c>), and Phase 4's MSEL inject fire — the trusted caller
/// states it directly, because there is no HTTP session to derive anything from. Making it a REQUIRED parameter
/// of <see cref="PostIngestService.IngestAsync"/> means neither caller can forget to answer the question, and a
/// future third caller has to decide consciously.
/// </para>
/// <para>
/// <b>Not a DTO.</b> Nothing here is ever serialized to a client. <see cref="ActingHumanId"/> in particular is
/// staff/telemetry-only attribution (COR-018) and is never projected onto a participant-facing response
/// (XC-002).
/// </para>
/// </remarks>
public sealed class PostAttribution
{
    /// <summary>
    /// The persona the post is authored AS. For a participant this is the session's own bound persona; for a
    /// staff console operating a persona it is the operator's persona CHOICE, validated to exist inside the
    /// resolved exercise (COR-001); for the engine it is the cast persona the burst names.
    /// </summary>
    public required Guid AuthorPersonaId { get; init; }

    /// <summary>
    /// The <c>PostOrigin</c> union value — the provenance of the write, derived from WHO the caller really is
    /// (session kind / in-process caller), never echoed from the body.
    /// </summary>
    public required string Origin { get; init; }

    /// <summary>
    /// The individual human behind the write (COR-018) — the participant's session identity, or the operating
    /// staff user's id. <see cref="string.Empty"/> ONLY for a non-human origin (<c>engine</c> / <c>inject</c>),
    /// where there is no human to attribute: the empty string is off the locked v0 telemetry envelope
    /// (<c>actor.actingHumanId</c> is <c>z.string().min(1).optional()</c>), so ingest null-omits it on the
    /// event rather than emitting <c>""</c>. Every HTTP-reachable origin requires a non-empty value.
    /// </summary>
    public required string ActingHumanId { get; init; }
}
