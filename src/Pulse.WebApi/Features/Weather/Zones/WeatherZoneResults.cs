namespace Pulse.WebApi.Features.Weather.Zones;

/// <summary>The outcome kind of a <see cref="WeatherZoneService"/> call; the endpoint maps each to one status.</summary>
public enum WeatherZoneOutcome
{
    /// <summary>Success with a body (<c>200</c>).</summary>
    Ok,

    /// <summary>A zone was created (<c>201</c>).</summary>
    Created,

    /// <summary>A zone was soft-deleted (<c>204</c>).</summary>
    Deleted,

    /// <summary>No such zone: identical for an unknown, soft-deleted or other-exercise zone (<c>404</c>, XC-001).</summary>
    NotFound,

    /// <summary>The request failed validation (<c>400</c>, readable message).</summary>
    Invalid,

    /// <summary>A stale version or a taken slug (<c>409</c>; the current zone attached when there is one).</summary>
    Conflict,

    /// <summary>No exercise scope (or, on a staff route, no staff session): fail closed (<c>401</c>).</summary>
    ScopeUnresolved,
}

/// <summary>The result of a <see cref="WeatherZoneService"/> call.</summary>
/// <typeparam name="TValue">The success body type.</typeparam>
public sealed class WeatherZoneResult<TValue>
    where TValue : class
{
    internal WeatherZoneResult(WeatherZoneOutcome outcome, TValue? value, string? message, WeatherZoneStaffDto? currentItem)
    {
        Outcome = outcome;
        Value = value;
        Message = message;
        CurrentItem = currentItem;
    }

    /// <summary>Which outcome occurred.</summary>
    public WeatherZoneOutcome Outcome { get; }

    /// <summary>The success body (for <see cref="WeatherZoneOutcome.Ok"/> / <see cref="WeatherZoneOutcome.Created"/>).</summary>
    public TValue? Value { get; }

    /// <summary>The readable message (for 400 / 404 / 409).</summary>
    public string? Message { get; }

    /// <summary>The zone as it is now, on a <see cref="WeatherZoneOutcome.Conflict"/> where it exists.</summary>
    public WeatherZoneStaffDto? CurrentItem { get; }
}

/// <summary>Factories for <see cref="WeatherZoneResult{TValue}"/>.</summary>
public static class WeatherZoneResult
{
    /// <summary>
    /// The ONE 404 message for every "not found" on every zone route, so an unknown, deleted or other-exercise zone cannot
    /// be told apart (XC-001).
    /// </summary>
    public const string NotFoundMessage = "No such weather zone.";

    /// <summary>A <c>200</c> result.</summary>
    /// <typeparam name="TValue">The body type.</typeparam>
    /// <param name="value">The body.</param>
    /// <returns>The result.</returns>
    public static WeatherZoneResult<TValue> Ok<TValue>(TValue value)
        where TValue : class => new(WeatherZoneOutcome.Ok, value, null, null);

    /// <summary>A <c>201</c> result.</summary>
    /// <typeparam name="TValue">The body type.</typeparam>
    /// <param name="value">The body.</param>
    /// <returns>The result.</returns>
    public static WeatherZoneResult<TValue> Created<TValue>(TValue value)
        where TValue : class => new(WeatherZoneOutcome.Created, value, null, null);

    /// <summary>A <c>204</c> result.</summary>
    /// <typeparam name="TValue">The (absent) body type.</typeparam>
    /// <returns>The result.</returns>
    public static WeatherZoneResult<TValue> Deleted<TValue>()
        where TValue : class => new(WeatherZoneOutcome.Deleted, null, null, null);

    /// <summary>The one <c>404</c> result (<see cref="NotFoundMessage"/>).</summary>
    /// <typeparam name="TValue">The body type.</typeparam>
    /// <returns>The result.</returns>
    public static WeatherZoneResult<TValue> NotFound<TValue>()
        where TValue : class => new(WeatherZoneOutcome.NotFound, null, NotFoundMessage, null);

    /// <summary>A <c>400</c> result.</summary>
    /// <typeparam name="TValue">The body type.</typeparam>
    /// <param name="message">The readable reason.</param>
    /// <returns>The result.</returns>
    public static WeatherZoneResult<TValue> Invalid<TValue>(string message)
        where TValue : class => new(WeatherZoneOutcome.Invalid, null, message, null);

    /// <summary>A <c>409</c> result, carrying the zone's current state when it exists.</summary>
    /// <typeparam name="TValue">The body type.</typeparam>
    /// <param name="message">The readable reason.</param>
    /// <param name="currentItem">The zone as it is now, or null.</param>
    /// <returns>The result.</returns>
    public static WeatherZoneResult<TValue> Conflict<TValue>(string message, WeatherZoneStaffDto? currentItem)
        where TValue : class => new(WeatherZoneOutcome.Conflict, null, message, currentItem);

    /// <summary>A <c>401</c> fail-closed result.</summary>
    /// <typeparam name="TValue">The body type.</typeparam>
    /// <returns>The result.</returns>
    public static WeatherZoneResult<TValue> ScopeUnresolved<TValue>()
        where TValue : class => new(WeatherZoneOutcome.ScopeUnresolved, null, null, null);
}
