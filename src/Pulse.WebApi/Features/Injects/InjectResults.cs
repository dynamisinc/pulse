namespace Pulse.WebApi.Features.Injects;

/// <summary>The outcome kind of an <see cref="InjectQueueService"/> call — the endpoint maps each to one status.</summary>
public enum InjectOutcome
{
    /// <summary>Success with a body (<c>200</c>).</summary>
    Ok,

    /// <summary>An item was created (<c>201</c>).</summary>
    Created,

    /// <summary>An item was soft-deleted (<c>204</c>).</summary>
    Deleted,

    /// <summary>No such live item in this exercise — identical for an unknown and a cross-exercise id (<c>404</c>).</summary>
    NotFound,

    /// <summary>The request failed validation (<c>400</c>, readable message).</summary>
    Invalid,

    /// <summary>The request conflicts with the item's current state or version (<c>409</c>, current item attached).</summary>
    Conflict,

    /// <summary>No exercise scope or no staff session — fail closed (<c>401</c>).</summary>
    ScopeUnresolved,
}

/// <summary>The result of an <see cref="InjectQueueService"/> call.</summary>
/// <typeparam name="TValue">The success body type.</typeparam>
public sealed class InjectResult<TValue>
    where TValue : class
{
    internal InjectResult(InjectOutcome outcome, TValue? value, string? message, InjectItemDto? currentItem)
    {
        Outcome = outcome;
        Value = value;
        Message = message;
        CurrentItem = currentItem;
    }

    /// <summary>Which outcome occurred.</summary>
    public InjectOutcome Outcome { get; }

    /// <summary>The success body (for <see cref="InjectOutcome.Ok"/> / <see cref="InjectOutcome.Created"/>).</summary>
    public TValue? Value { get; }

    /// <summary>The readable message (for <see cref="InjectOutcome.Invalid"/> / <see cref="InjectOutcome.Conflict"/> / <see cref="InjectOutcome.NotFound"/>).</summary>
    public string? Message { get; }

    /// <summary>The item's current state on a <see cref="InjectOutcome.Conflict"/>, so the console can refresh the row.</summary>
    public InjectItemDto? CurrentItem { get; }
}

/// <summary>Factories for <see cref="InjectResult{TValue}"/>.</summary>
public static class InjectResult
{
    /// <summary>A <c>200</c> result.</summary>
    /// <typeparam name="TValue">The body type.</typeparam>
    /// <param name="value">The body.</param>
    /// <returns>The result.</returns>
    public static InjectResult<TValue> Ok<TValue>(TValue value)
        where TValue : class => new(InjectOutcome.Ok, value, null, null);

    /// <summary>A <c>201</c> result.</summary>
    /// <typeparam name="TValue">The body type.</typeparam>
    /// <param name="value">The body.</param>
    /// <returns>The result.</returns>
    public static InjectResult<TValue> Created<TValue>(TValue value)
        where TValue : class => new(InjectOutcome.Created, value, null, null);

    /// <summary>A <c>204</c> result.</summary>
    /// <typeparam name="TValue">The (absent) body type.</typeparam>
    /// <returns>The result.</returns>
    public static InjectResult<TValue> Deleted<TValue>()
        where TValue : class => new(InjectOutcome.Deleted, null, null, null);

    /// <summary>A <c>404</c> result.</summary>
    /// <typeparam name="TValue">The body type.</typeparam>
    /// <returns>The result.</returns>
    public static InjectResult<TValue> NotFound<TValue>()
        where TValue : class => new(InjectOutcome.NotFound, null, "No such item in this exercise.", null);

    /// <summary>A <c>400</c> result.</summary>
    /// <typeparam name="TValue">The body type.</typeparam>
    /// <param name="message">The readable reason.</param>
    /// <returns>The result.</returns>
    public static InjectResult<TValue> Invalid<TValue>(string message)
        where TValue : class => new(InjectOutcome.Invalid, null, message, null);

    /// <summary>A <c>409</c> result carrying the item's current state.</summary>
    /// <typeparam name="TValue">The body type.</typeparam>
    /// <param name="message">The readable reason.</param>
    /// <param name="currentItem">The item as it is now, when it exists.</param>
    /// <returns>The result.</returns>
    public static InjectResult<TValue> Conflict<TValue>(string message, InjectItemDto? currentItem)
        where TValue : class => new(InjectOutcome.Conflict, null, message, currentItem);

    /// <summary>A <c>401</c> fail-closed result.</summary>
    /// <typeparam name="TValue">The body type.</typeparam>
    /// <returns>The result.</returns>
    public static InjectResult<TValue> ScopeUnresolved<TValue>()
        where TValue : class => new(InjectOutcome.ScopeUnresolved, null, null, null);
}
