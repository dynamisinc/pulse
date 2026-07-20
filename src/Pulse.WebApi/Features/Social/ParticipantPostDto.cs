namespace Pulse.WebApi.Features.Social;

using System.Text.Json.Serialization;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The FROZEN participant-safe post shape — the server-side mirror of the frontend
/// <c>ParticipantPostView</c> (<c>features/social/types/post.ts</c>). It is the ONLY post shape a
/// participant surface may ever receive: it structurally has NO provenance fields
/// (<c>origin</c>/<c>actingHumanId</c>/<c>createdWallClock</c>/<c>injectId</c>), so a participant
/// response cannot even carry them (XC-002).
/// </summary>
/// <remarks>
/// Story 01 produces this from reads; story 02's participant-caller branch and story 03's broadcast
/// payload reuse it rather than re-deriving. Serialized as camelCase JSON so the wire shape satisfies the
/// frozen <c>feedService.ts</c> <c>isPost</c> guard (<c>id</c>, <c>authorPersonaId</c>, <c>text</c>,
/// <c>scenarioTime</c>, <c>counts.{reply,repost,like}</c>); every property carries an explicit
/// <see cref="JsonPropertyNameAttribute"/> so the shape is self-evident and independent of host serializer
/// config. <c>media</c>/<c>linkPreview</c> are OMITTED this phase — they are optional in the frozen
/// contract and there is no media storage in B1; feeds-discovery adds them later (absent optional fields
/// are contract-valid).
/// </remarks>
public sealed class ParticipantPostDto
{
    /// <summary>The post id.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The authoring <c>Persona</c> instance id — never the acting human (COR-018 is staff-only).</summary>
    [JsonPropertyName("authorPersonaId")]
    public required string AuthorPersonaId { get; init; }

    /// <summary>The post body text.</summary>
    [JsonPropertyName("text")]
    public required string Text { get; init; }

    /// <summary>Engagement counts, in the product-wide order reply · repost · like (R-002).</summary>
    [JsonPropertyName("counts")]
    public required ParticipantPostCounts Counts { get; init; }

    /// <summary>
    /// The scenario ISO-8601 instant (COR-053) — the ONLY participant-visible time. Emitted as the persisted
    /// instant exactly, never re-derived from the server clock.
    /// </summary>
    [JsonPropertyName("scenarioTime")]
    public required string ScenarioTime { get; init; }

    /// <summary>
    /// The single server-side XC-002 narrowing — the server-side mirror of the frontend
    /// <c>toParticipantView</c> (retiring finding S2-2). Maps only participant-safe fields; it MUST NOT read
    /// or include <see cref="Post.Origin"/>, <see cref="Post.ActingHumanId"/>,
    /// <see cref="Post.CreatedWallClock"/>, or <see cref="Post.InjectId"/>. <see cref="ScenarioTime"/> is the
    /// persisted <see cref="Post.CreatedScenarioTime"/> emitted round-trip ISO-8601 — never re-derived from
    /// the server clock (COR-053). Counts seed to zero for a freshly-read post.
    /// </summary>
    /// <param name="post">The full post entity to narrow to the participant-safe shape.</param>
    /// <returns>The participant-safe projection of <paramref name="post"/>.</returns>
    public static ParticipantPostDto FromPost(Post post)
    {
        ArgumentNullException.ThrowIfNull(post);

        return new ParticipantPostDto
        {
            Id = post.Id.ToString(),
            AuthorPersonaId = post.AuthorPersonaId.ToString(),
            Text = post.Body,
            ScenarioTime = post.CreatedScenarioTime.ToString("O"),
            Counts = new ParticipantPostCounts(0, 0, 0),
        };
    }
}

/// <summary>
/// Engagement counts on a <see cref="ParticipantPostDto"/> — the frozen <c>PostCounts</c> subset the
/// <c>isPost</c> guard requires, in the product-wide order reply · repost · like (R-002).
/// </summary>
/// <param name="Reply">Reply count.</param>
/// <param name="Repost">Repost count.</param>
/// <param name="Like">Like count.</param>
public sealed record ParticipantPostCounts(
    [property: JsonPropertyName("reply")] int Reply,
    [property: JsonPropertyName("repost")] int Repost,
    [property: JsonPropertyName("like")] int Like);
