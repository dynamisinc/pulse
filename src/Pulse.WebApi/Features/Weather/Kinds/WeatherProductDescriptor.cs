namespace Pulse.WebApi.Features.Weather.Kinds;

using System.Text.Json.Nodes;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Weather.Contracts;

/// <summary>
/// The <c>weather_product</c> kind (weather-source story 01, #752; WX-010, WX-002, WX-013): watches, warnings and advisories
/// on channel <c>weather</c>. Staff-authored only (WX-002); the authorization is the calling endpoint's.
/// </summary>
/// <remarks>
/// <para>
/// <b>Validation</b> runs for every caller, including a raw API call: the closed vocabularies and bounds
/// (<see cref="WeatherPayloadReader"/>), zone existence in the resolved exercise (<see cref="IWeatherZoneCatalog"/>), and
/// supersession — an <c>update</c>/<c>upgrade</c>/<c>cancel</c> must name a PUBLISHED weather product of the same exercise.
/// </para>
/// <para>
/// <b>Normalization.</b> A valid payload is rewritten IN PLACE to its normalized form: strings cleaned by
/// <see cref="WeatherPlainText"/>, unknown keys dropped, defaults filled, and the superseded product's permalink stamped
/// server-side as <c>supersedesPermalink</c>. The funnel persists the object it validated, so the store never holds a raw
/// payload; <see cref="ProjectPayload"/> cleans again regardless (defense in depth).
/// </para>
/// <para>
/// <b>Delivery.</b> Publish options come from the payload's staff-only <c>delivery</c> block through story 04's
/// <see cref="IWeatherDeliveryPlanner"/> (FC-7a step 3); there is no <see cref="DefaultAlertMapping"/>, because the weather
/// editor owns its delivery options (FC-8 <c>ownsDeliveryOptions</c>) and the severity depends on each item's product type.
/// </para>
/// </remarks>
/// <param name="planner">Story 04's delivery planner, when registered; without it no publish options are resolved.</param>
public sealed class WeatherProductDescriptor(IWeatherDeliveryPlanner? planner = null) : IContentKindDescriptor
{
    /// <inheritdoc />
    public string Kind => ChannelVocabulary.KindWeatherProduct;

    /// <inheritdoc />
    public string ChannelId => ChannelVocabulary.Weather;

    /// <inheritdoc />
    /// <remarks>The narrative is plain text (NFR-004): every tag stripped.</remarks>
    public string BodyPolicy => ISanitizerProfileRegistry.Plain;

    /// <inheritdoc />
    public IReadOnlySet<string> AllowedMediaKinds => WeatherKindSupport.AllowedMediaKinds;

    /// <inheritdoc />
    public PublishAlertOptions? DefaultAlertMapping => null;

    /// <inheritdoc />
    public async Task<PayloadValidationResult> ValidatePayloadAsync(
        JsonObject payload, PayloadValidationContext context, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(payload);
        ArgumentNullException.ThrowIfNull(context);

        var errors = new List<string>();
        var product = WeatherPayloadReader.ReadProduct(payload, fromStore: false, errors);
        if (product is null)
        {
            return PayloadValidationResult.Invalid(errors[0], [.. errors.Skip(1)]);
        }

        var stored = await WeatherKindSupport.StoredPayloadAsync(context, Kind, cancellationToken);
        await WeatherKindSupport.CheckZonesAsync(
            [.. product.ZoneSlugs.Select((slug, i) => (slug, $"payload.zoneSlugs[{i}]"))],
            WeatherKindSupport.StoredZoneSlugs(stored),
            context,
            errors,
            cancellationToken);

        string? supersedesPermalink = null;
        if (product.SupersedesContentId is { } supersedes)
        {
            supersedesPermalink = await ResolveSupersededAsync(supersedes, stored, context, errors, cancellationToken);
        }

        if (errors.Count > 0)
        {
            return PayloadValidationResult.Invalid(errors[0], [.. errors.Skip(1)]);
        }

        WeatherKindSupport.ReplaceContent(
            payload, WeatherKindSupport.ToJsonObject(product with { SupersedesPermalink = supersedesPermalink }));
        return PayloadValidationResult.Valid;
    }

    /// <inheritdoc />
    /// <remarks>
    /// Emits exactly the <see cref="WeatherProductProjection"/> keys: never <c>delivery</c>, <c>supersedesContentId</c> or any
    /// key the stored payload might carry beyond the contract. A stored payload that no longer reads as a valid product
    /// projects to an empty object, which the client guard rejects (fail closed).
    /// </remarks>
    public JsonObject ProjectPayload(JsonObject payload)
    {
        ArgumentNullException.ThrowIfNull(payload);

        var product = WeatherPayloadReader.ReadProduct(payload, fromStore: true, []);
        if (product is null)
        {
            return [];
        }

        return WeatherKindSupport.ToJsonObject(new WeatherProductProjection
        {
            ProductType = product.ProductType,
            Hazard = product.Hazard,
            Action = product.Action,
            SupersedesPermalink = product.SupersedesPermalink,
            ZoneSlugs = product.ZoneSlugs,
            EffectiveScenarioTime = product.EffectiveScenarioTime,
            ExpiresScenarioTime = product.ExpiresScenarioTime,
            Ibw = product.Ibw,
            Actions = product.Actions,
        });
    }

    /// <inheritdoc />
    /// <remarks>
    /// Reads the stored <c>delivery</c> block (FC-7a step 3, weather FU-2) and hands it to story 04's planner, which owns the
    /// severity map and the stale-on-jump guard. Null when no planner is registered or the stored payload does not read.
    /// </remarks>
    public PublishOptions? ResolvePublishOptions(ContentItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        if (planner is null || item.Kind != Kind || WeatherKindSupport.TryParseObject(item.PayloadJson) is not { } stored)
        {
            return null;
        }

        var product = WeatherPayloadReader.ReadProduct(stored, fromStore: true, []);
        if (product is null)
        {
            return null;
        }

        // The stored read is lenient (projection must never blank), so the "a warning always raises its alert" guarantee is
        // re-asserted here, where it matters: a non-cancel warning publishes with its alert, whatever the row says.
        if (product.ProductType == WeatherVocabulary.ProductWarning && product.Action != WeatherVocabulary.ActionCancel
            && !product.Delivery.RaiseAlert)
        {
            product = product with { Delivery = product.Delivery with { RaiseAlert = true } };
        }

        return planner.Plan(item, product);
    }

    private static async Task<string?> ResolveSupersededAsync(
        Guid supersedes,
        JsonObject? stored,
        PayloadValidationContext context,
        List<string> errors,
        CancellationToken cancellationToken)
    {
        const string Path = "payload.supersedesContentId";
        if (supersedes == context.ContentItemId)
        {
            errors.Add($"{Path}: a product cannot supersede itself");
            return null;
        }

        var permalink = await WeatherKindSupport.PublishedProductPermalinkAsync(context, supersedes, cancellationToken);
        if (permalink is not null)
        {
            return permalink;
        }

        // An edit that keeps the link it was published with stays valid even if that product was retracted since (the same
        // grandfathering as a deleted zone): the stored permalink is kept.
        if (stored is not null
            && WeatherPayloadReader.ReadProduct(stored, fromStore: true, []) is { } previous
            && previous.SupersedesContentId == supersedes)
        {
            return previous.SupersedesPermalink;
        }

        errors.Add($"{Path}: must name a published weather product in this exercise");
        return null;
    }
}
