namespace Pulse.WebApi.Features.Identity.EasyLogin;

using System.Globalization;

/// <summary>
/// The two wire formats of the frozen easy-login contract, in one place: an instant is ISO-8601 round-trip
/// (<c>"O"</c>) and a date is <c>yyyy-MM-dd</c>, both formatted with the INVARIANT culture. A culture-sensitive format
/// is not merely cosmetic here: under <c>ar-SA</c> the current culture's calendar is Umm al-Qura, so a plain
/// <c>date.ToString("yyyy-MM-dd")</c> would put a Hijri year on the wire. Every easy-login DTO and telemetry payload
/// formats through these.
/// </summary>
public static class EasyLoginWire
{
    /// <summary>The <c>date</c> wire format.</summary>
    public const string DateFormat = "yyyy-MM-dd";

    /// <summary>An instant on the wire: ISO-8601 round-trip (<c>"O"</c>), invariant culture, offset preserved.</summary>
    /// <param name="instant">The instant.</param>
    /// <returns>For example <c>2026-10-20T13:45:00.0000000+00:00</c>.</returns>
    public static string Instant(DateTimeOffset instant) => instant.ToString("O", CultureInfo.InvariantCulture);

    /// <summary>A calendar date on the wire: <c>yyyy-MM-dd</c>, Gregorian, invariant culture.</summary>
    /// <param name="date">The date.</param>
    /// <returns>For example <c>2026-10-20</c>.</returns>
    public static string Date(DateOnly date) => date.ToString(DateFormat, CultureInfo.InvariantCulture);
}
