namespace Pulse.WebApi.Features.Channels.Outlets;

/// <summary>The outcome kind of an <see cref="OutletService"/> call; the endpoint maps each to one status.</summary>
public enum OutletOutcome
{
    /// <summary>Success with a body (<c>200</c>).</summary>
    Ok,

    /// <summary>An outlet was created (<c>201</c>).</summary>
    Created,

    /// <summary>An outlet was soft-deleted (<c>204</c>).</summary>
    Deleted,

    /// <summary>
    /// No such outlet: identical for an unknown, disabled, soft-deleted or other-exercise outlet and for a disabled or
    /// unknown channel (<c>404</c>, XC-001).
    /// </summary>
    NotFound,

    /// <summary>The request failed validation (<c>400</c>, readable message).</summary>
    Invalid,

    /// <summary>A stale version or a taken slug (<c>409</c>; the current outlet attached when there is one).</summary>
    Conflict,

    /// <summary>No exercise scope (or, on a staff route, no staff session): fail closed (<c>401</c>).</summary>
    ScopeUnresolved,
}

/// <summary>The result of an <see cref="OutletService"/> call.</summary>
/// <typeparam name="TValue">The success body type.</typeparam>
public sealed class OutletResult<TValue>
    where TValue : class
{
    internal OutletResult(OutletOutcome outcome, TValue? value, string? message, OutletStaffDto? currentItem)
    {
        Outcome = outcome;
        Value = value;
        Message = message;
        CurrentItem = currentItem;
    }

    /// <summary>Which outcome occurred.</summary>
    public OutletOutcome Outcome { get; }

    /// <summary>The success body (for <see cref="OutletOutcome.Ok"/> / <see cref="OutletOutcome.Created"/>).</summary>
    public TValue? Value { get; }

    /// <summary>The readable message (for 400 / 404 / 409).</summary>
    public string? Message { get; }

    /// <summary>The outlet as it is now, on a <see cref="OutletOutcome.Conflict"/> where it exists.</summary>
    public OutletStaffDto? CurrentItem { get; }
}

/// <summary>Factories for <see cref="OutletResult{TValue}"/>.</summary>
public static class OutletResult
{
    /// <summary>
    /// The ONE 404 message, for every "not found" on every outlet route, so an unknown, disabled, deleted or
    /// other-exercise outlet (and a disabled channel) cannot be told apart (XC-001).
    /// </summary>
    public const string NotFoundMessage = "No such outlet.";

    /// <summary>A <c>200</c> result.</summary>
    /// <typeparam name="TValue">The body type.</typeparam>
    /// <param name="value">The body.</param>
    /// <returns>The result.</returns>
    public static OutletResult<TValue> Ok<TValue>(TValue value)
        where TValue : class => new(OutletOutcome.Ok, value, null, null);

    /// <summary>A <c>201</c> result.</summary>
    /// <typeparam name="TValue">The body type.</typeparam>
    /// <param name="value">The body.</param>
    /// <returns>The result.</returns>
    public static OutletResult<TValue> Created<TValue>(TValue value)
        where TValue : class => new(OutletOutcome.Created, value, null, null);

    /// <summary>A <c>204</c> result.</summary>
    /// <typeparam name="TValue">The (absent) body type.</typeparam>
    /// <returns>The result.</returns>
    public static OutletResult<TValue> Deleted<TValue>()
        where TValue : class => new(OutletOutcome.Deleted, null, null, null);

    /// <summary>The one <c>404</c> result (<see cref="NotFoundMessage"/>).</summary>
    /// <typeparam name="TValue">The body type.</typeparam>
    /// <returns>The result.</returns>
    public static OutletResult<TValue> NotFound<TValue>()
        where TValue : class => new(OutletOutcome.NotFound, null, NotFoundMessage, null);

    /// <summary>A <c>400</c> result.</summary>
    /// <typeparam name="TValue">The body type.</typeparam>
    /// <param name="message">The readable reason.</param>
    /// <returns>The result.</returns>
    public static OutletResult<TValue> Invalid<TValue>(string message)
        where TValue : class => new(OutletOutcome.Invalid, null, message, null);

    /// <summary>A <c>409</c> result, carrying the outlet's current state when it exists.</summary>
    /// <typeparam name="TValue">The body type.</typeparam>
    /// <param name="message">The readable reason.</param>
    /// <param name="currentItem">The outlet as it is now, or null.</param>
    /// <returns>The result.</returns>
    public static OutletResult<TValue> Conflict<TValue>(string message, OutletStaffDto? currentItem)
        where TValue : class => new(OutletOutcome.Conflict, null, message, currentItem);

    /// <summary>A <c>401</c> fail-closed result.</summary>
    /// <typeparam name="TValue">The body type.</typeparam>
    /// <returns>The result.</returns>
    public static OutletResult<TValue> ScopeUnresolved<TValue>()
        where TValue : class => new(OutletOutcome.ScopeUnresolved, null, null, null);
}
