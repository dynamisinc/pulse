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
/// <b>An explicit JSON <c>null</c> is refused, never read as "absent".</b> EL-20 types the members as
/// <c>participantIds: string[]</c> and <c>all: true</c>, neither nullable, so <c>{"participantIds":null,"all":true}</c>,
/// <c>{"participantIds":[…],"all":null}</c> and <c>{"all":null}</c> are each a 400: both members carry a converter that
/// is handed the <c>null</c> token and throws. A <c>null</c> member on this type therefore always means the member was
/// ABSENT, which the service turns into "exactly one of the two" (a readable 400 otherwise,
/// <see cref="LinkCardService.GenerateAsync"/>). No exercise id: the scope is server-resolved (COR-001).
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
    /// casing is one account); a blank or malformed value is a <c>notFound</c> skip echoed back (bounded in length).
    /// <c>null</c> only when absent: an explicit JSON <c>null</c> is refused.
    /// </summary>
    [JsonPropertyName("participantIds")]
    [JsonConverter(typeof(NonNullStringListConverter))]
    public IReadOnlyList<string?>? ParticipantIds { get; init; }

    /// <summary>
    /// <c>true</c> to print every participant in the exercise; must be <c>true</c> when present. <c>null</c> only when
    /// absent: an explicit JSON <c>null</c> is refused.
    /// </summary>
    [JsonPropertyName("all")]
    [JsonConverter(typeof(NonNullBooleanConverter))]
    public bool? All { get; init; }

    /// <summary>
    /// Reads <c>participantIds</c>: a JSON array of strings (a <c>null</c> ELEMENT is kept for the service to refuse
    /// with a readable 400). A <c>null</c> token for the whole member, or any other token, throws.
    /// </summary>
    private sealed class NonNullStringListConverter : JsonConverter<IReadOnlyList<string?>?>
    {
        public override bool HandleNull => true;

        public override IReadOnlyList<string?>? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType != JsonTokenType.StartArray)
            {
                throw new JsonException("participantIds must be an array of strings.");
            }

            var ids = new List<string?>();
            while (reader.Read())
            {
                switch (reader.TokenType)
                {
                    case JsonTokenType.EndArray:
                        return ids;
                    case JsonTokenType.String:
                        ids.Add(reader.GetString());
                        break;
                    case JsonTokenType.Null:
                        ids.Add(null);
                        break;
                    default:
                        throw new JsonException("participantIds must be an array of strings.");
                }
            }

            throw new JsonException("participantIds is not a complete array.");
        }

        public override void Write(Utf8JsonWriter writer, IReadOnlyList<string?>? value, JsonSerializerOptions options)
        {
            ArgumentNullException.ThrowIfNull(writer);
            if (value is null)
            {
                writer.WriteNullValue();
                return;
            }

            writer.WriteStartArray();
            foreach (var id in value)
            {
                writer.WriteStringValue(id);
            }

            writer.WriteEndArray();
        }
    }

    /// <summary>Reads <c>all</c>: a JSON <c>true</c> or <c>false</c> only. A <c>null</c> token, or any other token, throws.</summary>
    private sealed class NonNullBooleanConverter : JsonConverter<bool?>
    {
        public override bool HandleNull => true;

        public override bool? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
            reader.TokenType switch
            {
                JsonTokenType.True => true,
                JsonTokenType.False => false,
                _ => throw new JsonException("all must be the JSON literal true."),
            };

        public override void Write(Utf8JsonWriter writer, bool? value, JsonSerializerOptions options)
        {
            ArgumentNullException.ThrowIfNull(writer);
            if (value is { } flag)
            {
                writer.WriteBooleanValue(flag);
            }
            else
            {
                writer.WriteNullValue();
            }
        }
    }
}
