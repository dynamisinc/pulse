namespace Pulse.WebApi.Features.Identity.LinkCards;

using System.Text.Json;
using System.Text.Json.Serialization;

/// <summary>
/// The <c>POST /api/staff/roster/cards</c> body (EL-20): EXACTLY one of <c>{ "participantIds": [ … ] }</c> (1 to
/// <c>MaxCardsPerRequest</c> account ids) or <c>{ "all": true }</c>. Lives with the card slice rather than in the frozen
/// <c>EasyLoginDtos.cs</c> (story 01's file) so this story stays file-disjoint; the shape is the one
/// <c>implementation.md</c>'s route table freezes.
/// </summary>
/// <remarks>
/// <para>
/// <b>Strict on the wire.</b> The endpoint deserializes it with <see cref="StrictJson"/>: an unknown property, a
/// property in any other casing, a repeated property, a wrong JSON type, comments or trailing commas all fail the
/// request with a 400, never a silent default. Why it matters: the GET this replaced bound <c>?id[]=</c> and
/// <c>?ids=</c> to an EMPTY list, which meant "everyone". Here "everyone" is only ever the explicit <c>all: true</c>.
/// </para>
/// <para>
/// Members are nullable so "absent" is visible to the service, which enforces "exactly one of the two" and answers a
/// readable 400 (<see cref="LinkCardService.GenerateAsync"/>). No exercise id: the scope is server-resolved (COR-001).
/// </para>
/// </remarks>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class RosterCardsRequestBody
{
    /// <summary>
    /// The serializer settings the endpoint reads this body with: unknown members, case-insensitive matches, repeated
    /// properties, quoted numbers, comments and trailing commas are all refused.
    /// </summary>
    public static readonly JsonSerializerOptions StrictJson = new()
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        PropertyNameCaseInsensitive = false,
        AllowDuplicateProperties = false,
        NumberHandling = JsonNumberHandling.Strict,
        ReadCommentHandling = JsonCommentHandling.Disallow,
        AllowTrailingCommas = false,
        MaxDepth = 8,
    };

    /// <summary>
    /// The accounts to print, as sent (1 to <c>MaxCardsPerRequest</c>). De-duplicated by the service (a GUID in any
    /// casing is one account); a blank or malformed value is a <c>notFound</c> skip echoed back as sent. <c>null</c>
    /// when absent.
    /// </summary>
    [JsonPropertyName("participantIds")]
    public IReadOnlyList<string?>? ParticipantIds { get; init; }

    /// <summary><c>true</c> to print every participant in the exercise; must be <c>true</c> when present. <c>null</c> when absent.</summary>
    [JsonPropertyName("all")]
    public bool? All { get; init; }
}
