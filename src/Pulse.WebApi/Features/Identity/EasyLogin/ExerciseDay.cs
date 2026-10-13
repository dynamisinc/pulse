namespace Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// Time-of-day maths for the "exercise day" (EL-9, EL-10): the REAL calendar date in the exercise time zone, which
/// rolls over at local midnight plus a configurable rollover hour (<see cref="EasyLoginOptions.DayRolloverHour"/>).
/// Scenario time is never involved: it is for the fiction, and "today's word" and "signed in for the day" are
/// about the room the participants sit in.
/// </summary>
/// <remarks>
/// <para>
/// <b>Day D</b> runs from local <c>D hh:00</c> to local <c>D+1 hh:00</c>, where <c>hh</c> is the rollover hour.
/// <see cref="EndOfDayUtc(string?, DateOnly, int)"/> is the one definition of that boundary, and <see cref="Today"/> is
/// DERIVED from it, so the two agree by construction: <c>Today(now)</c> is the D with
/// <c>EndOfDayUtc(D - 1) &lt;= now &lt; EndOfDayUtc(D)</c>, it never goes backwards as <c>now</c> increases, and
/// <c>EndOfDayUtc(now)</c> is always in the future. (Reading the local time of day instead is NOT equivalent: inside a
/// fall-back overlap the second occurrence of the rollover hour would flip the day back; review W-1.)
/// </para>
/// <para>
/// <b>Daylight saving.</b> The boundary is a LOCAL wall-clock time, so a 23- or 25-hour day is handled by the zone
/// rules, never by adding 24 hours. When the boundary's local time does not exist (it falls in a spring-forward gap,
/// including zones whose clocks skip local midnight), the next valid instant is used: the moment the clocks jump.
/// When it occurs twice (a fall-back overlap), the earlier occurrence is used, which is also the instant at which
/// <see cref="Today"/> first reads the new date.
/// </para>
/// <para>
/// <b>Unknown zones fall back to UTC.</b> A blank or unrecognised zone id resolves to UTC (never throws), so a bad
/// stored value degrades to a UTC day instead of failing a sign-in. <see cref="TryResolveTimeZone"/> tells a caller
/// that wants to warn about it that the fallback happened.
/// </para>
/// </remarks>
public static class ExerciseDay
{
    /// <summary>The largest rollover hour the maths accepts (configuration narrows it to <see cref="EasyLoginOptions.MaxDayRolloverHour"/>).</summary>
    public const int MaxRolloverHour = 23;

    /// <summary>The zone id the platform defaults an exercise to, and the fallback for a blank or unknown id.</summary>
    public const string UtcZoneId = "UTC";

    /// <summary>The upper bound on how far forward a spring-forward gap is searched (no real gap is longer than a day).</summary>
    private static readonly TimeSpan MaxGapSearch = TimeSpan.FromHours(48);

    /// <summary>Resolves a zone id to a <see cref="TimeZoneInfo"/>; a blank or unknown id resolves to UTC.</summary>
    /// <param name="timeZone">The stored zone id (IANA, e.g. <c>America/New_York</c>), or <c>null</c>.</param>
    /// <returns>The zone, or <see cref="TimeZoneInfo.Utc"/>.</returns>
    public static TimeZoneInfo ResolveTimeZone(string? timeZone)
    {
        TryResolveTimeZone(timeZone, out var zone);
        return zone;
    }

    /// <summary>
    /// Resolves a zone id, reporting whether it was recognised. <paramref name="zone"/> is always usable: UTC when the
    /// id is blank or unknown. A literal <c>UTC</c> counts as recognised.
    /// </summary>
    /// <param name="timeZone">The stored zone id, or <c>null</c>.</param>
    /// <param name="zone">The resolved zone, or <see cref="TimeZoneInfo.Utc"/> on fallback.</param>
    /// <returns><c>true</c> when the id resolved; <c>false</c> when UTC was substituted.</returns>
    public static bool TryResolveTimeZone(string? timeZone, out TimeZoneInfo zone)
    {
        var id = timeZone?.Trim();
        if (string.IsNullOrEmpty(id))
        {
            zone = TimeZoneInfo.Utc;
            return false;
        }

        if (string.Equals(id, UtcZoneId, StringComparison.OrdinalIgnoreCase))
        {
            zone = TimeZoneInfo.Utc;
            return true;
        }

        if (TimeZoneInfo.TryFindSystemTimeZoneById(id, out var found))
        {
            zone = found;
            return true;
        }

        zone = TimeZoneInfo.Utc;
        return false;
    }

    /// <summary>The exercise day an instant falls in: its local date, minus one day before the local rollover hour.</summary>
    /// <param name="timeZone">The exercise zone id (blank or unknown means UTC).</param>
    /// <param name="nowUtc">The instant (any offset; it is compared as an instant).</param>
    /// <param name="rolloverHour">The local rollover hour, 0 to <see cref="MaxRolloverHour"/>.</param>
    /// <returns>The exercise day's date.</returns>
    public static DateOnly Today(string? timeZone, DateTimeOffset nowUtc, int rolloverHour)
    {
        ValidateRolloverHour(rolloverHour);

        var zone = ResolveTimeZone(timeZone);

        // Start from the local calendar date, then let the boundaries decide (review W-1): the day is the one whose
        // end has not yet come and whose predecessor's end has. One step either way suffices: verified for rollover 0
        // to 6 across every transition of every system zone, 2024 to 2030.
        var date = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(nowUtc, zone).DateTime);
        if (nowUtc < EndOfDayUtc(zone, date.AddDays(-1), rolloverHour))
        {
            return date.AddDays(-1);
        }

        return nowUtc >= EndOfDayUtc(zone, date, rolloverHour) ? date.AddDays(1) : date;
    }

    /// <summary>
    /// The instant exercise day <paramref name="day"/> ends: local <c>day + 1</c> at the rollover hour, in UTC. A
    /// non-existent local time resolves to the next valid instant; an ambiguous one to its earlier occurrence.
    /// </summary>
    /// <param name="timeZone">The exercise zone id (blank or unknown means UTC).</param>
    /// <param name="day">The exercise day.</param>
    /// <param name="rolloverHour">The local rollover hour, 0 to <see cref="MaxRolloverHour"/>.</param>
    /// <returns>The end-of-day instant, with a zero offset.</returns>
    public static DateTimeOffset EndOfDayUtc(string? timeZone, DateOnly day, int rolloverHour)
    {
        ValidateRolloverHour(rolloverHour);
        return EndOfDayUtc(ResolveTimeZone(timeZone), day, rolloverHour);
    }

    /// <summary>The instant the exercise day containing <paramref name="nowUtc"/> ends (always later than <paramref name="nowUtc"/>).</summary>
    /// <param name="timeZone">The exercise zone id (blank or unknown means UTC).</param>
    /// <param name="nowUtc">The instant.</param>
    /// <param name="rolloverHour">The local rollover hour, 0 to <see cref="MaxRolloverHour"/>.</param>
    /// <returns>The end-of-day instant, with a zero offset.</returns>
    public static DateTimeOffset EndOfDayUtc(string? timeZone, DateTimeOffset nowUtc, int rolloverHour) =>
        EndOfDayUtc(timeZone, Today(timeZone, nowUtc, rolloverHour), rolloverHour);

    /// <summary>The single definition of the day boundary: local <c>day + 1</c> at the rollover hour, as a UTC instant.</summary>
    private static DateTimeOffset EndOfDayUtc(TimeZoneInfo zone, DateOnly day, int rolloverHour)
    {
        var boundary = day.AddDays(1).ToDateTime(new TimeOnly(rolloverHour, 0), DateTimeKind.Unspecified);
        return LocalToUtc(boundary, zone);
    }

    /// <summary>Converts a local wall-clock time in <paramref name="zone"/> to the UTC instant it names.</summary>
    private static DateTimeOffset LocalToUtc(DateTime local, TimeZoneInfo zone)
    {
        if (zone.IsInvalidTime(local))
        {
            // Spring-forward gap: walk forward to the first local minute that exists, which is the instant the clocks
            // jump (every real transition falls on a whole minute).
            var candidate = local;
            var limit = local + MaxGapSearch;
            do
            {
                candidate = candidate.AddMinutes(1);
            }
            while (zone.IsInvalidTime(candidate) && candidate < limit);

            local = candidate;
        }

        if (zone.IsAmbiguousTime(local))
        {
            // Fall-back overlap: the earlier occurrence carries the larger (pre-transition) offset.
            var offset = zone.GetAmbiguousTimeOffsets(local).Max();
            return new DateTimeOffset(local, offset).ToUniversalTime();
        }

        return new DateTimeOffset(local, zone.GetUtcOffset(local)).ToUniversalTime();
    }

    private static void ValidateRolloverHour(int rolloverHour)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(rolloverHour);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(rolloverHour, MaxRolloverHour);
    }
}
