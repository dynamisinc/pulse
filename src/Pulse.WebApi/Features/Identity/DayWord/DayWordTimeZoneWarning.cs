namespace Pulse.WebApi.Features.Identity.DayWord;

using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// The day word's time-zone fallback warning (Gate-1 S-6), modelled on story 06's <c>ParticipantSessionCap</c>: when an
/// exercise's stored zone is blank or unrecognised, <see cref="ExerciseDay"/> quietly uses UTC, so "today's word" turns
/// over at UTC midnight instead of the room's. That is never a failure, but staff should hear about it, so it is logged
/// as a warning ONCE per exercise per process (not per request), naming only the exercise id and the stored zone id:
/// never a word, a hash, a sign-in name or anything a participant typed.
/// </summary>
public static partial class DayWordTimeZoneWarning
{
    /// <summary>Exercises whose fallback has already been logged in this process.</summary>
    private static readonly ConcurrentDictionary<Guid, byte> Logged = new();

    /// <summary>Logs the fallback once for <paramref name="exerciseId"/> when <paramref name="timeZone"/> does not resolve.</summary>
    /// <param name="logger">Where the warning goes.</param>
    /// <param name="exerciseId">The server-resolved exercise.</param>
    /// <param name="timeZone">The exercise's stored zone id, verbatim.</param>
    /// <returns><c>true</c> when the zone fell back to UTC (whether or not this call logged it).</returns>
    public static bool WarnIfFallback(ILogger logger, Guid exerciseId, string? timeZone)
    {
        ArgumentNullException.ThrowIfNull(logger);

        if (ExerciseDay.TryResolveTimeZone(timeZone, out _))
        {
            return false;
        }

        if (Logged.TryAdd(exerciseId, 0))
        {
            LogTimeZoneFallback(logger, exerciseId, string.IsNullOrWhiteSpace(timeZone) ? "(blank)" : timeZone);
        }

        return true;
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Day word: exercise {ExerciseId} has an unrecognised time zone '{TimeZone}', so its day word turns over at the end of the UTC day instead of the exercise's local day. Set a valid IANA time zone on the exercise to fix this. Logged once per exercise per process.")]
    private static partial void LogTimeZoneFallback(ILogger logger, Guid exerciseId, string timeZone);
}
