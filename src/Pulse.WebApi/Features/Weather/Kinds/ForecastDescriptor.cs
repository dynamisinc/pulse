namespace Pulse.WebApi.Features.Weather.Kinds;

using System.Text.Json.Nodes;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Weather.Contracts;

/// <summary>
/// The <c>forecast</c> kind (weather-source story 01, #752; WX-001/003, WX-013): one zone's current conditions and 1..14
/// periods on channel <c>weather</c>. Staff-authored only (WX-002).
/// </summary>
/// <remarks>
/// Same rules as <see cref="WeatherProductDescriptor"/>: plain-text strings, closed condition codes, zone existence in the
/// resolved exercise (a zone soft-deleted after publish never invalidates the item), and in-place normalization of a valid
/// payload. A later forecast for the same zone may say something different (WX-003); nothing here forbids it. A forecast has
/// no delivery block, so it resolves no publish options (the interface default) and suggests no alert.
/// </remarks>
public sealed class ForecastDescriptor : IContentKindDescriptor
{
    /// <inheritdoc />
    public string Kind => ChannelVocabulary.KindForecast;

    /// <inheritdoc />
    public string ChannelId => ChannelVocabulary.Weather;

    /// <inheritdoc />
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
        var forecast = WeatherPayloadReader.ReadForecast(payload, errors);
        if (forecast is null)
        {
            return PayloadValidationResult.Invalid(errors[0], [.. errors.Skip(1)]);
        }

        var stored = await WeatherKindSupport.StoredPayloadAsync(context, Kind, cancellationToken);
        await WeatherKindSupport.CheckZonesAsync(
            [(forecast.ZoneSlug, "payload.zoneSlug")],
            WeatherKindSupport.StoredZoneSlugs(stored),
            context,
            errors,
            cancellationToken);
        if (errors.Count > 0)
        {
            return PayloadValidationResult.Invalid(errors[0], [.. errors.Skip(1)]);
        }

        WeatherKindSupport.ReplaceContent(payload, WeatherKindSupport.ToJsonObject(forecast));
        return PayloadValidationResult.Valid;
    }

    /// <inheritdoc />
    /// <remarks>
    /// The forecast has nothing staff-only, so the projection is the normalized record: exactly the
    /// <see cref="ForecastPayload"/> keys, unknown keys dropped; an unreadable stored payload projects to an empty object.
    /// </remarks>
    public JsonObject ProjectPayload(JsonObject payload)
    {
        ArgumentNullException.ThrowIfNull(payload);

        var forecast = WeatherPayloadReader.ReadForecast(payload, []);
        return forecast is null ? [] : WeatherKindSupport.ToJsonObject(forecast);
    }
}
