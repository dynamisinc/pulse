namespace Pulse.WebApi.Features.Identity.Sessions;

using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// The participant day cap (easy-login story 06, EL-10): the ONE place that decides which sessions are capped at the
/// end of the exercise day and what their access and refresh windows are, so <see cref="SessionIssuer"/> (issue) and
/// <see cref="SessionService.RefreshAsync"/> (refresh) cannot disagree.
/// </summary>
/// <remarks>
/// <para>
/// <b>Who is capped.</b> Only <c>participant</c>-kind sessions, and only while
/// <see cref="SessionOptions.ParticipantDayLong"/> is on, whichever login method issued them (password, link, word).
/// Staff and shared read-only (<c>readonly</c>-kind) sessions keep the sliding windows they had before.
/// </para>
/// <para>
/// <b>The windows.</b> Capped: the refresh window ends at the end of the exercise day and the access token expires at
/// <c>min(now + SessionLifetime, end of day)</c>, so COR-012's short-lived access token is unchanged and nothing runs
/// past the day. Uncapped: <c>now + SessionLifetime</c> and <c>now + RefreshLifetime</c>, exactly as before.
/// </para>
/// <para>
/// <b>The day.</b> Real time in the exercise time zone, never scenario time, through <see cref="ExerciseDay"/> with
/// <see cref="EasyLoginOptions.DayRolloverHour"/> (bounded 0 to <see cref="EasyLoginOptions.MaxDayRolloverHour"/>). A
/// blank or unknown zone falls back to UTC (the cap still applies) and is logged as a warning once per exercise per
/// process, not per request.
/// </para>
/// </remarks>
public static partial class ParticipantSessionCap
{
    /// <summary>The session kind the cap applies to (matches <c>Session.Kind</c>).</summary>
    public const string ParticipantKind = "participant";

    /// <summary>Exercises whose time-zone fallback has already been logged in this process.</summary>
    private static readonly ConcurrentDictionary<Guid, byte> TimeZoneFallbackLogged = new();

    /// <summary>Whether a session of <paramref name="kind"/> is capped at the end of the exercise day.</summary>
    /// <param name="kind">The session kind (<c>participant</c> / <c>staff</c> / <c>readonly</c>).</param>
    /// <param name="options">The session options carrying <see cref="SessionOptions.ParticipantDayLong"/>.</param>
    /// <returns><c>true</c> only for a <c>participant</c>-kind session with the option on.</returns>
    public static bool AppliesTo(string? kind, SessionOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        return options.ParticipantDayLong && string.Equals(kind, ParticipantKind, StringComparison.Ordinal);
    }

    /// <summary>
    /// The instant the exercise day containing <paramref name="asOf"/> ends, in the exercise's own time zone. A blank or
    /// unknown zone falls back to UTC and is logged once for <paramref name="exerciseId"/>.
    /// </summary>
    /// <param name="exerciseId">The session's own bound exercise (used only to log the fallback once).</param>
    /// <param name="timeZone">That exercise's stored zone id, or <c>null</c> when it could not be read.</param>
    /// <param name="asOf">An instant inside the day.</param>
    /// <param name="rolloverHour">The configured rollover hour; clamped to 0 to <see cref="EasyLoginOptions.MaxDayRolloverHour"/>.</param>
    /// <param name="logger">Where the one-time fallback warning goes.</param>
    /// <returns>The end-of-day instant (UTC), always later than <paramref name="asOf"/>.</returns>
    public static DateTimeOffset EndOfExerciseDay(
        Guid exerciseId,
        string? timeZone,
        DateTimeOffset asOf,
        int rolloverHour,
        ILogger logger)
    {
        ArgumentNullException.ThrowIfNull(logger);

        if (!ExerciseDay.TryResolveTimeZone(timeZone, out _) && TimeZoneFallbackLogged.TryAdd(exerciseId, 0))
        {
            LogTimeZoneFallback(logger, exerciseId);
        }

        // EasyLoginOptions is validated to 0..6 at startup; the clamp keeps the boundary inside the documented range
        // even on a host that never ran that validation.
        var boundedRolloverHour = Math.Clamp(rolloverHour, 0, EasyLoginOptions.MaxDayRolloverHour);

        return ExerciseDay.EndOfDayUtc(timeZone, asOf, boundedRolloverHour);
    }

    /// <summary>The access-token expiry and refresh-window end to stamp at <paramref name="now"/>.</summary>
    /// <param name="now">The server wall-clock instant of the issue or refresh.</param>
    /// <param name="endOfExerciseDay">The cap for a capped session, or <c>null</c> for an uncapped one.</param>
    /// <param name="options">The configured lifetimes.</param>
    /// <returns>The two windows.</returns>
    public static SessionWindows Windows(DateTimeOffset now, DateTimeOffset? endOfExerciseDay, SessionOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        var accessEnd = now + options.SessionLifetime;
        if (endOfExerciseDay is not { } dayEnd)
        {
            return new SessionWindows(accessEnd, now + options.RefreshLifetime);
        }

        return new SessionWindows(accessEnd < dayEnd ? accessEnd : dayEnd, dayEnd);
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Exercise {ExerciseId} has a blank or unrecognised time zone; participant sessions are capped at the end of the UTC day instead. Logged once per exercise per process.")]
    private static partial void LogTimeZoneFallback(ILogger logger, Guid exerciseId);
}

/// <summary>The access-token expiry and refresh-window end stamped on a session at issue or refresh.</summary>
/// <param name="ExpiresAt">When the access token stops authenticating.</param>
/// <param name="RefreshExpiresAt">When the refresh token stops renewing the session (a full sign-in is needed).</param>
public readonly record struct SessionWindows(DateTimeOffset ExpiresAt, DateTimeOffset RefreshExpiresAt);
