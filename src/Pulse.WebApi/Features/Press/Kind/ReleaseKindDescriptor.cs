namespace Pulse.WebApi.Features.Press.Kind;

using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Press.Contracts;

/// <summary>
/// The <c>release</c> kind (press-room story 01, #738; PRS-010, PRS-001, FC-7) on channel <c>press</c>: a news release
/// issued as an organization persona. The body is F04's built-in <c>rich-tables</c> profile (press FU-5 resolved); it
/// may attach images and the download-only PDF (<c>document</c>, story 02).
/// </summary>
/// <remarks>
/// <para>
/// <b>Validation</b> (PC-1) runs for every caller, participant or staff: <c>orgPersonaId</c> must be a persona of the
/// resolved exercise, <c>document.mediaId</c> an exercise-owned <c>document</c> asset, and the contact/dateline/
/// boilerplate/cross-post text length-capped plain text. Every lookup goes through the central exercise filter, so
/// another exercise's id answers exactly like an unknown one (XC-001).
/// </para>
/// <para>
/// <b>Normalization.</b> A valid payload is rewritten IN PLACE: text cleaned, unknown keys dropped, <c>inputPath</c>
/// defaulted, the document's <c>fileName</c>/<c>sizeBytes</c> re-read from the asset, and the server-derived
/// <c>org { name, outletId }</c> (the org newsroom, else the persona's display name) stamped, so the synchronous
/// <see cref="ProjectPayload"/> can name the org without a database read. A client-sent <c>org</c> is overwritten.
/// </para>
/// <para>
/// <b>Projection</b> emits exactly <c>org</c>, <c>contact</c>, <c>dateline</c> and <c>document</c>: never
/// <c>crossPost</c>, <c>approval</c>, <c>inputPath</c> or <c>boilerplate</c> (XC-002).
/// </para>
/// <para>
/// <b>Not an authorization check.</b> The descriptor proves only that the persona and media belong to the exercise. WHO
/// may release as which org is decided by the calling endpoint: story 04 through <see cref="IReleaseOrgResolver"/> for a
/// participant, the staff role for a controller (who may release as any org, PRS-020).
/// </para>
/// <para>
/// <b>Server-owned fields.</b> <c>approval</c> is never taken from the write: an edit keeps the stored value, a create
/// stores none (story 06 owns approval routing). <c>org</c> is a SNAPSHOT taken at write time, as a printed letterhead
/// is: a newsroom renamed later shows its new name on releases written after the rename. The org ref is the press
/// newsroom paired with the persona that is ENABLED and a child of The Wire Room.
/// </para>
/// <para>
/// <b>R-P1 handoff.</b> The summary's <c>outlet.name</c> comes from <c>ContentItem.OutletId</c>, which this seam cannot
/// see. The writers (story 04's author service, story 13's console editor) must file a release under its org newsroom
/// (<c>payload.org.outletId</c>), never under The Wire Room; story 15 asserts it.
/// </para>
/// </remarks>
public sealed class ReleaseKindDescriptor : IContentKindDescriptor
{
    private static readonly IReadOnlySet<string> AllowedKinds =
        new HashSet<string>(StringComparer.Ordinal) { ChannelVocabulary.MediaKindImage, ChannelVocabulary.MediaKindDocument };

    /// <inheritdoc />
    public string Kind => ChannelVocabulary.KindRelease;

    /// <inheritdoc />
    public string ChannelId => ChannelVocabulary.Press;

    /// <inheritdoc />
    public string BodyPolicy => ISanitizerProfileRegistry.RichTables;

    /// <inheritdoc />
    public IReadOnlySet<string> AllowedMediaKinds => AllowedKinds;

    /// <inheritdoc />
    public PublishAlertOptions? DefaultAlertMapping => null;

    /// <inheritdoc />
    public async Task<PayloadValidationResult> ValidatePayloadAsync(
        JsonObject payload, PayloadValidationContext context, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(payload);
        ArgumentNullException.ThrowIfNull(context);

        var errors = new List<string>();
        var release = ReleasePayloadReader.Read(payload, fromStore: false, errors);
        if (release is null)
        {
            return PayloadValidationResult.Invalid(errors[0], [.. errors.Skip(1)]);
        }

        var persona = await context.Db.Personas
            .AsNoTracking()
            .Where(p => p.Id == release.OrgPersonaId)
            .Select(p => new { p.DisplayName })
            .FirstOrDefaultAsync(cancellationToken);
        if (persona is null)
        {
            errors.Add(ReleasePayloadReader.OrgPersonaNotFound);
        }

        var newsroom = persona is null
            ? null
            : await context.Db.Outlets
                .AsNoTracking()
                .Where(o => o.ChannelId == ChannelVocabulary.Press
                    && o.Enabled
                    && o.PairedPersonaId == release.OrgPersonaId
                    && context.Db.Outlets.Any(w => w.Id == o.ParentOutletId
                        && w.ChannelId == ChannelVocabulary.Press
                        && w.Slug == PressVocabulary.WireRoomSlug))
                .OrderBy(o => o.SortOrder)
                .ThenBy(o => o.Id)
                .Select(o => new { o.Id, o.Name })
                .FirstOrDefaultAsync(cancellationToken);

        if (release.DocumentMediaId is { } documentId)
        {
            var asset = await context.Db.MediaAssets
                .AsNoTracking()
                .Where(m => m.Id == documentId && m.Kind == MediaKinds.Document)
                .Select(m => new { m.OriginalFileName, m.Bytes })
                .FirstOrDefaultAsync(cancellationToken);
            if (asset is null)
            {
                errors.Add(ReleasePayloadReader.DocumentNotFound);
            }
            else
            {
                release = release with
                {
                    DocumentFileName = PressPlainText.Clean(asset.OriginalFileName, multiline: false) is { Length: > 0 } name
                        ? name
                        : "document.pdf",
                    DocumentSizeBytes = asset.Bytes,
                };
            }
        }

        if (errors.Count > 0)
        {
            return PayloadValidationResult.Invalid(errors[0], [.. errors.Skip(1)]);
        }

        release = release with
        {
            ApprovalRequired = await StoredApprovalAsync(context, cancellationToken),
            OrgName = newsroom?.Name ?? persona!.DisplayName,
            OrgOutletId = newsroom?.Id,
        };
        ReplaceContent(payload, ReleasePayloadReader.ToStored(release));
        return PayloadValidationResult.Valid;
    }

    /// <inheritdoc />
    /// <remarks>
    /// A stored payload that no longer reads as a release (no org) projects to an empty object, which the client guard
    /// rejects (fail closed); text is cleaned again regardless (defense in depth).
    /// </remarks>
    public JsonObject ProjectPayload(JsonObject payload)
    {
        ArgumentNullException.ThrowIfNull(payload);

        var release = ReleasePayloadReader.Read(payload, fromStore: true, []);
        return release is null ? [] : ReleasePayloadReader.ToParticipant(release);
    }

    /// <summary>The <c>approval.required</c> the edited item already stores, or null on a create.</summary>
    private async Task<bool?> StoredApprovalAsync(PayloadValidationContext context, CancellationToken cancellationToken)
    {
        if (context.ContentItemId is not { } id)
        {
            return null;
        }

        var stored = await context.Db.ContentItems
            .AsNoTracking()
            .Where(item => item.Id == id && item.Kind == Kind)
            .Select(item => item.PayloadJson)
            .FirstOrDefaultAsync(cancellationToken);
        return ReleasePayloadReader.StoredApproval(ReleasePayloadReader.TryParseObject(stored));
    }

    /// <summary>Replaces <paramref name="payload"/>'s content with <paramref name="normalized"/>'s, in place.</summary>
    private static void ReplaceContent(JsonObject payload, JsonObject normalized)
    {
        payload.Clear();
        foreach (var key in normalized.Select(p => p.Key).ToList())
        {
            var value = normalized[key];
            normalized.Remove(key);
            payload[key] = value;
        }
    }
}
