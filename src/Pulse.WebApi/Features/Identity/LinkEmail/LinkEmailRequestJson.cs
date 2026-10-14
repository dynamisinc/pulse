namespace Pulse.WebApi.Features.Identity.LinkEmail;

using System.Text.Json;
using System.Text.Json.Serialization;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// How the <c>POST /api/staff/roster/email-links</c> body is read: the FROZEN <see cref="RosterEmailLinksBody"/>
/// (<c>{ participantIds?: string[] }</c>) with strict settings, so "everyone" is only ever an explicit omission.
/// </summary>
/// <remarks>
/// The EL-20 lesson (story 04): a body shape the server half-understands must never widen to everyone. So an unknown
/// property, a property in another casing, a repeated property, a wrong JSON type, comments and trailing commas are
/// all a <c>400</c>; and an explicit <c>"participantIds": null</c>, or a <c>null</c> element in the array, is refused
/// rather than read as "absent" (which would mean every eligible participant). Only <c>{}</c> means everyone.
/// </remarks>
public static class LinkEmailRequestJson
{
    /// <summary>The strict serializer settings the endpoint reads the body with.</summary>
    public static readonly JsonSerializerOptions Strict = CreateStrict();

    private static JsonSerializerOptions CreateStrict()
    {
        var options = new JsonSerializerOptions
        {
            UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
            PropertyNameCaseInsensitive = false,
            AllowDuplicateProperties = false,
            NumberHandling = JsonNumberHandling.Strict,
            ReadCommentHandling = JsonCommentHandling.Disallow,
            AllowTrailingCommas = false,
            MaxDepth = 8,
        };
        options.Converters.Add(new NonNullStringListConverter());
        options.MakeReadOnly(populateMissingResolver: true);
        return options;
    }

    /// <summary>
    /// Reads <c>participantIds</c>: a JSON array of strings only. A <c>null</c> token for the member, a <c>null</c>
    /// element, or any other token throws (a <c>400</c> at the endpoint).
    /// </summary>
    private sealed class NonNullStringListConverter : JsonConverter<IReadOnlyList<string>>
    {
        public override bool HandleNull => true;

        public override IReadOnlyList<string> Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType != JsonTokenType.StartArray)
            {
                throw new JsonException("participantIds must be an array of strings.");
            }

            var ids = new List<string>();
            while (reader.Read())
            {
                switch (reader.TokenType)
                {
                    case JsonTokenType.EndArray:
                        return ids;
                    case JsonTokenType.String:
                        ids.Add(reader.GetString()!);
                        break;
                    default:
                        throw new JsonException("participantIds must be an array of strings.");
                }
            }

            throw new JsonException("participantIds is not a complete array.");
        }

        public override void Write(Utf8JsonWriter writer, IReadOnlyList<string> value, JsonSerializerOptions options)
        {
            ArgumentNullException.ThrowIfNull(writer);
            ArgumentNullException.ThrowIfNull(value);

            writer.WriteStartArray();
            foreach (var id in value)
            {
                writer.WriteStringValue(id);
            }

            writer.WriteEndArray();
        }
    }
}
