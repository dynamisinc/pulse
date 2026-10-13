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
/// blank or unknown zone, or an exercise row that could not be read, falls back to UTC (the cap still applies) and is
/// logged as a warning once per exercise per process, not per request. The warning names only the exercise id and the
/// defaults used: never a token, a stored value or anything a participant typed.
/// </para>
/// </remarks>
public static partial class ParticipantSessionCap
{
    /// <summary>Exercises whose time-zone fallback has already been logged in this process.</summary>
    private static readonly ConcurrentDictionary<Guid, byte> TimeZoneFallbackLogged = new();

    /// <summary>Whether a session of <paramref name="kind"/> is capped at the end of the exercise day.</summary>
    /// <param name="kind">The session kind (<c>participant</c> / <c>staff</c> / <c>readonly</c>).</param>
    /// <param name="options">The session options carrying <see cref="SessionOptions.ParticipantDayLong"/>.</param>
    /// <returns><c>true</c> only for a <c>participant</c>-kind session with the option on.</returns>
    public static bool AppliesTo(string? kind, SessionOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        return options.ParticipantDayLong
            && string.Equals(kind, ParticipantSessionRequests.ParticipantSessionKind, StringComparison.Ordinal);
    }

    /// <summary>
    /// The instant the exercise day containing <paramref name="asOf"/> ends, in the exercise's own time zone. A blank or
    /// unknown zone, or a missing exercise row, falls back to UTC and is logged once for <paramref name="exerciseId"/>.
    /// </summary>
    /// <param name="exerciseId">The session's own bound exercise (used only to log the fallback once).</param>
    /// <param name="facts">That exercise's facts from <see cref="ExerciseFactsReader"/>, or <c>null</c> when its row could not be read.</param>
    /// <param name="asOf">An instant inside the day.</param>
    /// <param name="rolloverHour">The configured rollover hour; clamped to 0 to <see cref="EasyLoginOptions.MaxDayRolloverHour"/>.</param>
    /// <param name="logger">Where the one-time fallback warning goes.</param>
    /// <returns>The end-of-day instant (UTC), always later than <paramref name="asOf"/>.</returns>
    public static DateTimeOffset EndOfExerciseDay(
        Guid exerciseId,
        ExerciseFacts? facts,
        DateTimeOffset asOf,
        int rolloverHour,
        ILogger logger)
    {
        ArgumentNullException.ThrowIfNull(logger);

        // EasyLoginOptions is validated to 0..6 at startup; the clamp keeps the boundary inside the documented range
        // even on a host that never ran that validation.
        var boundedRolloverHour = Math.Clamp(rolloverHour, 0, EasyLoginOptions.MaxDayRolloverHour);
        var timeZone = facts?.TimeZone;

        if (!ExerciseDay.TryResolveTimeZone(timeZone, out _) && TimeZoneFallbackLogged.TryAdd(exerciseId, 0))
        {
            if (facts is null)
            {
                LogExerciseNotFound(logger, exerciseId, boundedRolloverHour);
            }
            else
            {
                LogTimeZoneFallback(logger, exerciseId, boundedRolloverHour);
            }
        }

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
        Message = "Participant day cap: exercise {ExerciseId} has a blank or unrecognised time zone, so its participant sessions end at the end of the UTC day (rollover hour {RolloverHour} UTC) instead of the exercise's local day. Set a valid IANA time zone on the exercise to fix this. Logged once per exercise per process.")]
    private static partial void LogTimeZoneFallback(ILogger logger, Guid exerciseId, int rolloverHour);

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Warning,
        Message = "Participant day cap: no exercise row was found for exercise {ExerciseId}, which a participant session is bound to, so its time zone is unknown and the session ends at the end of the UTC day (rollover hour {RolloverHour} UTC). The session is still capped, never left open; check whether the exercise was deleted. Logged once per exercise per process.")]
    private static partial void LogExerciseNotFound(ILogger logger, Guid exerciseId, int rolloverHour);
}

/// <summary>The access-token expiry and refresh-window end stamped on a session at issue or refresh.</summary>
/// <param name="ExpiresAt">When the access token stops authenticating.</param>
/// <param name="RefreshExpiresAt">When the refresh token stops renewing the session (a full sign-in is needed).</param>
public readonly record struct SessionWindows(DateTimeOffset ExpiresAt, DateTimeOffset RefreshExpiresAt);
