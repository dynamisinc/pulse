namespace Pulse.WebApi.Features.Weather.Contracts;

using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// Turns a product's stored <see cref="WeatherDelivery"/> block into the funnel's <see cref="PublishOptions"/> (FC-7a step 3).
/// Story 01 owns the seam and calls it from <c>WeatherProductDescriptor.ResolvePublishOptions</c>; story 04 implements it
/// (<c>WeatherDeliveryPlanner</c>), because the alert severity is derived from the product type in exactly one place,
/// story 04's <c>WeatherAlertSeverityMap</c>, and the stale-on-jump guard needs the exercise clock.
/// </summary>
/// <remarks>
/// A scoped service. Until story 04 registers one, the descriptor resolves no options, so a weather publish raises no alert
/// and makes no post (it never guesses a severity).
/// </remarks>
public interface IWeatherDeliveryPlanner
{
    /// <summary>Plans the publish side effects of one product.</summary>
    /// <param name="item">The product being published.</param>
    /// <param name="payload">Its parsed, already-validated payload (carries <see cref="WeatherProductPayload.Delivery"/>).</param>
    /// <returns>The options, or null for none.</returns>
    PublishOptions? Plan(ContentItem item, WeatherProductPayload payload);
}
