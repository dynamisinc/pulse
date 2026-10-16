namespace Pulse.WebApi.Features.EngineRuntime.Clock;

/// <summary>
/// The persistable anchor of one exercise's scenario clock (demo-feedback DF-25): everything needed to rebuild the
/// clock in a NEW process. Scenario elapsed time is <see cref="ElapsedAtAnchor"/> plus the wall time since
/// <see cref="WallAnchorUtc"/> while running, and exactly <see cref="ElapsedAtAnchor"/> while
/// <see cref="Frozen"/>.
/// </summary>
/// <remarks>
/// <b>The wall anchor is a UTC instant, never a monotonic timestamp.</b> The live clock advances against
/// <c>TimeProvider.GetTimestamp()</c>, which is meaningless in another process; this record carries the matching
/// <c>TimeProvider.GetUtcNow()</c> reading taken at the same anchor, so a restored running clock keeps advancing
/// through the downtime (<c>elapsed = elapsedAtAnchor + (utcNow - wallAnchorUtc)</c>).
/// <para>The record is the clock-column rule in code (17 Gate-1 L-3): a clock is either wholly absent (no anchor)
/// or every field is set — there is no half-started clock to persist.</para>
/// </remarks>
/// <param name="ScenarioStart">The scenario instant the clock reads as scenario minute 0.</param>
/// <param name="TimeZone">The exercise time zone the scenario instant is expressed in.</param>
/// <param name="ElapsedAtAnchor">The elapsed scenario time banked at the anchor; never negative.</param>
/// <param name="WallAnchorUtc">The server wall-clock instant (UTC) the anchor was taken at.</param>
/// <param name="Frozen">Whether the clock is frozen at the anchor.</param>
public sealed record ExerciseClockAnchor(
    DateTimeOffset ScenarioStart,
    TimeZoneInfo TimeZone,
    TimeSpan ElapsedAtAnchor,
    DateTimeOffset WallAnchorUtc,
    bool Frozen);
