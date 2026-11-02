namespace Pulse.WebApi.Features.Press.Kind;

using System.Text.Json;
using System.Text.Json.Nodes;
using Pulse.WebApi.Features.Press.Contracts;

/// <summary>
/// Reads a PC-1 release payload into <see cref="ReleasePayload"/> and writes its normalized stored form. STRICT for a
/// write (every problem is an error naming its payload path) and LENIENT for the store (a malformed optional block is
/// dropped, so a projection never blanks; only a missing org fails closed).
/// </summary>
internal static class ReleasePayloadReader
{
    /// <summary>The one message for an unknown, malformed or other-exercise org persona (COR-001).</summary>
    public const string OrgPersonaNotFound = "payload.orgPersonaId: must name a persona in this exercise";

    /// <summary>The one message for an unknown, non-document or other-exercise attachment (COR-001).</summary>
    public const string DocumentNotFound = "payload.document.mediaId: must name a document in this exercise";

    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);

    /// <summary>Reads <paramref name="payload"/>.</summary>
    /// <param name="payload">The payload object.</param>
    /// <param name="fromStore">True for a stored payload (lenient), false for a write (strict).</param>
    /// <param name="errors">Receives every problem (write only).</param>
    /// <returns>The payload, or null when it is unusable.</returns>
    public static ReleasePayload? Read(JsonObject payload, bool fromStore, List<string> errors)
    {
        var start = errors.Count;
        var orgPersonaId = ReadGuid(payload, "orgPersonaId") ?? Guid.Empty;
        if (orgPersonaId == Guid.Empty)
        {
            errors.Add(payload.ContainsKey("orgPersonaId") ? OrgPersonaNotFound : "payload.orgPersonaId: is required");
        }

        var inputPath = PressVocabulary.InputPathRich;
        if (payload["inputPath"] is { } inputPathNode)
        {
            var value = inputPathNode.GetValueKind() == JsonValueKind.String ? inputPathNode.GetValue<string>() : null;
            if (PressVocabulary.IsInputPath(value))
            {
                inputPath = value!;
            }
            else if (!fromStore)
            {
                errors.Add($"payload.inputPath: must be one of {string.Join(", ", PressVocabulary.InputPaths)}");
            }
        }

        var contact = ReadContact(payload["contact"], fromStore, errors);
        var dateline = ReadText(payload, "dateline", PressVocabulary.DatelineMaxLength, multiline: false, fromStore, errors);
        var documentId = ReadDocument(payload["document"], fromStore, errors, out var fileName, out var sizeBytes);
        var boilerplate = ReadText(payload, "boilerplate", PressVocabulary.BoilerplateMaxLength, multiline: true, fromStore, errors);
        var crossPost = ReadCrossPost(payload["crossPost"], fromStore, errors);
        var approvalRequired = ReadApproval(payload["approval"], fromStore, errors);

        string? orgName = null;
        Guid? orgOutletId = null;
        if (fromStore)
        {
            if (payload["org"] is JsonObject org && ReadString(org, "name") is { Length: > 0 } name)
            {
                orgName = PressPlainText.Clean(name, multiline: false);
                orgOutletId = ReadGuid(org, "outletId");
            }

            if (string.IsNullOrEmpty(orgName) || orgPersonaId == Guid.Empty)
            {
                return null;
            }
        }
        else if (errors.Count > start)
        {
            return null;
        }

        return new ReleasePayload
        {
            OrgPersonaId = orgPersonaId,
            InputPath = inputPath,
            Contact = contact,
            Dateline = dateline,
            DocumentMediaId = documentId,
            DocumentFileName = fileName,
            DocumentSizeBytes = sizeBytes,
            Boilerplate = boilerplate,
            CrossPost = crossPost,
            ApprovalRequired = approvalRequired,
            OrgName = orgName,
            OrgOutletId = orgOutletId,
        };
    }

    /// <summary>The normalized stored form, in a fixed key order.</summary>
    /// <param name="payload">The payload, with the server-derived org and document facts filled in.</param>
    /// <returns>The object to persist.</returns>
    public static JsonObject ToStored(ReleasePayload payload) => new()
    {
        ["orgPersonaId"] = payload.OrgPersonaId.ToString(),
        ["inputPath"] = payload.InputPath,
        ["contact"] = payload.Contact is null ? null : ToJson(payload.Contact),
        ["dateline"] = payload.Dateline,
        ["document"] = Document(payload) is { } document ? ToJson(document) : null,
        ["boilerplate"] = payload.Boilerplate,
        ["crossPost"] = payload.CrossPost is null ? null : ToJson(payload.CrossPost),
        ["approval"] = payload.ApprovalRequired is { } required ? new JsonObject { ["required"] = required } : null,
        ["org"] = new JsonObject
        {
            ["name"] = payload.OrgName,
            ["outletId"] = payload.OrgOutletId?.ToString(),
        },
    };

    /// <summary>The participant-safe projection (exactly <see cref="PressVocabulary.ParticipantPayloadKeys"/>).</summary>
    /// <param name="payload">A payload read from the store.</param>
    /// <returns>The projection.</returns>
    public static JsonObject ToParticipant(ReleasePayload payload) => ToJson(new ReleaseParticipantPayloadDto
    {
        Org = new ReleaseOrgRefDto { Name = payload.OrgName!, OutletId = payload.OrgOutletId?.ToString() },
        Contact = payload.Contact,
        Dateline = payload.Dateline,
        Document = Document(payload),
    });

    /// <summary>The author projection (story 04's <c>ReleaseAuthorDto.payload</c>): everything but <c>approval</c> and <c>org</c>.</summary>
    /// <param name="payload">A payload read from the store.</param>
    /// <returns>The projection.</returns>
    public static ReleaseAuthorPayloadDto ToAuthor(ReleasePayload payload) => new()
    {
        OrgPersonaId = payload.OrgPersonaId.ToString(),
        InputPath = payload.InputPath,
        Contact = payload.Contact,
        Dateline = payload.Dateline,
        Document = Document(payload),
        Boilerplate = payload.Boilerplate,
        CrossPost = payload.CrossPost,
    };

    /// <summary>Parses a stored payload string, or null when it is not a JSON object.</summary>
    /// <param name="json">The stored JSON.</param>
    /// <returns>The object, or null.</returns>
    public static JsonObject? TryParseObject(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            return JsonNode.Parse(json) as JsonObject;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static ReleaseDocumentDto? Document(ReleasePayload payload) =>
        payload.DocumentMediaId is { } id && payload.DocumentFileName is { } name && payload.DocumentSizeBytes is { } size
            ? new ReleaseDocumentDto { MediaId = id.ToString(), FileName = name, SizeBytes = size }
            : null;

    private static JsonObject ToJson<T>(T value) =>
        JsonSerializer.SerializeToNode(value, SerializerOptions)!.AsObject();

    private static ReleaseContactDto? ReadContact(JsonNode? node, bool fromStore, List<string> errors)
    {
        if (node is null)
        {
            return null;
        }

        if (node is not JsonObject contact)
        {
            Fail(fromStore, errors, "payload.contact: must be an object");
            return null;
        }

        var before = errors.Count;
        var name = ReadText(contact, "name", PressVocabulary.ContactNameMaxLength, multiline: false, fromStore, errors, "payload.contact.");
        var nameRefused = errors.Count > before;
        var title = ReadText(contact, "title", PressVocabulary.ContactTitleMaxLength, multiline: false, fromStore, errors, "payload.contact.");
        var phone = ReadText(contact, "phone", PressVocabulary.ContactPhoneMaxLength, multiline: false, fromStore, errors, "payload.contact.");
        var email = ReadText(contact, "email", PressVocabulary.ContactEmailMaxLength, multiline: false, fromStore, errors, "payload.contact.");
        if (name is null && !nameRefused)
        {
            Fail(fromStore, errors, "payload.contact.name: is required when a contact is given");
        }

        if (errors.Count > before || name is null)
        {
            return null;
        }

        return new ReleaseContactDto { Name = name, Title = title, Phone = phone, Email = email };
    }

    private static Guid? ReadDocument(
        JsonNode? node, bool fromStore, List<string> errors, out string? fileName, out long? sizeBytes)
    {
        fileName = null;
        sizeBytes = null;
        if (node is null)
        {
            return null;
        }

        if (node is not JsonObject document)
        {
            Fail(fromStore, errors, "payload.document: must be an object");
            return null;
        }

        var id = ReadGuid(document, "mediaId");
        if (id is null)
        {
            Fail(fromStore, errors, DocumentNotFound);
            return null;
        }

        // On a write the file name and size are re-read from the media asset by the descriptor; only the store keeps them.
        if (fromStore)
        {
            fileName = ReadString(document, "fileName") is { Length: > 0 } name ? PressPlainText.Clean(name, multiline: false) : null;
            sizeBytes = document["sizeBytes"] is { } size && size.GetValueKind() == JsonValueKind.Number
                && size.AsValue().TryGetValue<long>(out var bytes) && bytes >= 0
                    ? bytes
                    : null;
            if (string.IsNullOrEmpty(fileName) || sizeBytes is null)
            {
                return null;
            }
        }

        return id;
    }

    private static ReleaseCrossPostDto? ReadCrossPost(JsonNode? node, bool fromStore, List<string> errors)
    {
        if (node is null)
        {
            return null;
        }

        if (node is not JsonObject crossPost)
        {
            Fail(fromStore, errors, "payload.crossPost: must be an object or null");
            return null;
        }

        var before = errors.Count;
        var text = ReadText(
            crossPost, "text", PressVocabulary.CrossPostTextMaxLength, multiline: true, fromStore, errors, "payload.crossPost.");
        return errors.Count > before ? null : new ReleaseCrossPostDto { Text = text };
    }

    private static bool? ReadApproval(JsonNode? node, bool fromStore, List<string> errors)
    {
        if (node is null)
        {
            return null;
        }

        if (node is JsonObject approval && approval["required"] is { } required
            && required.GetValueKind() is JsonValueKind.True or JsonValueKind.False)
        {
            return required.GetValue<bool>();
        }

        Fail(fromStore, errors, "payload.approval: must be { required: boolean } or null");
        return null;
    }

    private static string? ReadText(
        JsonObject parent,
        string key,
        int maxLength,
        bool multiline,
        bool fromStore,
        List<string> errors,
        string prefix = "payload.")
    {
        var node = parent[key];
        if (node is null)
        {
            return null;
        }

        if (node.GetValueKind() != JsonValueKind.String)
        {
            Fail(fromStore, errors, $"{prefix}{key}: must be a string or null");
            return null;
        }

        var cleaned = PressPlainText.Clean(node.GetValue<string>(), multiline);
        if (cleaned.Length == 0)
        {
            return null;
        }

        if (PressPlainText.CodePointLength(cleaned) > maxLength)
        {
            if (fromStore)
            {
                // A stored value over the cap (a cap tightened later) is cut rather than dropped.
                return new string([.. cleaned.EnumerateRunes().Take(maxLength).SelectMany(r => r.ToString())]);
            }

            errors.Add($"{prefix}{key}: must be at most {maxLength} characters");
            return null;
        }

        return cleaned;
    }

    private static string? ReadString(JsonObject parent, string key) =>
        parent[key] is { } node && node.GetValueKind() == JsonValueKind.String ? node.GetValue<string>() : null;

    private static Guid? ReadGuid(JsonObject parent, string key) =>
        ReadString(parent, key) is { } text && Guid.TryParse(text, out var id) && id != Guid.Empty ? id : null;

    private static void Fail(bool fromStore, List<string> errors, string message)
    {
        if (!fromStore)
        {
            errors.Add(message);
        }
    }
}

/// <summary>A release payload as read (PC-1), plus the server-derived org and document facts.</summary>
internal sealed record ReleasePayload
{
    public required Guid OrgPersonaId { get; init; }

    public required string InputPath { get; init; }

    public ReleaseContactDto? Contact { get; init; }

    public string? Dateline { get; init; }

    public Guid? DocumentMediaId { get; init; }

    public string? DocumentFileName { get; init; }

    public long? DocumentSizeBytes { get; init; }

    public string? Boilerplate { get; init; }

    public ReleaseCrossPostDto? CrossPost { get; init; }

    public bool? ApprovalRequired { get; init; }

    /// <summary>The org's name; server-derived at write, read back from the store.</summary>
    public string? OrgName { get; init; }

    /// <summary>The org newsroom outlet; server-derived at write, read back from the store.</summary>
    public Guid? OrgOutletId { get; init; }
}
