namespace Pulse.WebApi.Features.Weather.Contracts;

/// <summary>
/// The product state table, server side (story 01): the same rules as the TS <c>productState</c>, pinned to it by the shared
/// <c>productStateCases</c> in <c>weatherContract.json</c>. Story 03 uses it to stamp <c>state</c> on the site read model. Pure.
/// </summary>
/// <remarks>
/// <c>cancelled</c> wins over every time-based state (an explicit cancel is authorial); otherwise <c>pending</c> before
/// effective, <c>expired</c> from expires on, else <c>active</c>. Resolved against SCENARIO time only (COR-053), so a time jump
/// snaps the state without un-publishing anything.
/// </remarks>
public static class WeatherProductStates
{
    /// <summary>Computes a product's state at <paramref name="scenarioNow"/>.</summary>
    /// <param name="effective">The product's effective scenario instant.</param>
    /// <param name="expires">The product's expiry scenario instant.</param>
    /// <param name="scenarioNow">The exercise's current scenario instant.</param>
    /// <param name="cancelledBySupersedingCancel">Whether a published <c>cancel</c> product supersedes this one.</param>
    /// <returns>One of <see cref="WeatherVocabulary.ProductStates"/>.</returns>
    public static string Compute(
        DateTimeOffset effective, DateTimeOffset expires, DateTimeOffset scenarioNow, bool cancelledBySupersedingCancel)
    {
        if (cancelledBySupersedingCancel)
        {
            return WeatherVocabulary.StateCancelled;
        }

        if (scenarioNow < effective)
        {
            return WeatherVocabulary.StatePending;
        }

        return scenarioNow >= expires ? WeatherVocabulary.StateExpired : WeatherVocabulary.StateActive;
    }
}
