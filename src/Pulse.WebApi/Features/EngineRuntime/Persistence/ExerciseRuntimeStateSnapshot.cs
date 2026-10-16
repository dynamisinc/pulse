namespace Pulse.WebApi.Features.EngineRuntime.Persistence;

using System.Diagnostics.CodeAnalysis;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;

/// <summary>
/// One exercise's full steering runtime state in memory — the pause tier, the scenario-clock anchor and the
/// participant overlay — as written to (and read back from) its <see cref="ExerciseRuntimeState"/> row
/// (demo-feedback story 18, DF-24..DF-27). The store always writes the WHOLE row from one of these, so the row is
/// never a mix of two moments.
/// </summary>
/// <param name="ExerciseId">The exercise the state belongs to (COR-001); never <see cref="Guid.Empty"/>.</param>
/// <param name="Tier">The pause tier.</param>
/// <param name="Clock">The clock anchor, or <c>null</c> when the clock is unstarted (all four clock columns null).</param>
/// <param name="Overlay">The participant overlay snapshot, including its sequence.</param>
public sealed record ExerciseRuntimeStateSnapshot(
    Guid ExerciseId,
    PauseTier Tier,
    ExerciseClockAnchor? Clock,
    OverlayStateSnapshot Overlay);

/// <summary>
/// The one translation between <see cref="ExerciseRuntimeStateSnapshot"/> and the <see cref="ExerciseRuntimeState"/>
/// row, in both directions — and the place the row's invariants are enforced in code (17 Gate-1 L-3): the four clock
/// columns are written all-null or all-set, and a row that breaks that rule (or any other) is refused on the way back
/// in rather than half-restored.
/// </summary>
public static class ExerciseRuntimeStateMapping
{
    /// <summary>
    /// Copies <paramref name="snapshot"/> onto <paramref name="row"/> (every column but the key), stamping
    /// <see cref="ExerciseRuntimeState.UpdatedAt"/> with the server wall clock.
    /// </summary>
    /// <param name="snapshot">The in-memory state to persist.</param>
    /// <param name="row">The tracked row to overwrite.</param>
    /// <param name="updatedAt">The server wall-clock instant of the write.</param>
    /// <exception cref="ArgumentException">When a value cannot be stored within the schema bounds.</exception>
    public static void CopyTo(ExerciseRuntimeStateSnapshot snapshot, ExerciseRuntimeState row, DateTimeOffset updatedAt)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(row);
        ArgumentNullException.ThrowIfNull(snapshot.Overlay);

        if (snapshot.ExerciseId == Guid.Empty || row.ExerciseId != snapshot.ExerciseId)
        {
            throw new ArgumentException("A runtime-state write must name its own exercise (COR-001).", nameof(snapshot));
        }

        row.PauseTier = PauseTierWire.ToWire(snapshot.Tier);

        // L-3: all four clock columns together, or none.
        if (snapshot.Clock is { } clock)
        {
            var timeZoneId = clock.TimeZone.Id;
            if (timeZoneId.Length > ExerciseRuntimeState.MaxClockTimeZoneLength)
            {
                throw new ArgumentException(
                    $"The clock time-zone id exceeds {ExerciseRuntimeState.MaxClockTimeZoneLength} characters.", nameof(snapshot));
            }

            row.ClockScenarioStart = clock.ScenarioStart;
            row.ClockTimeZone = timeZoneId;
            row.ClockElapsedAtAnchorTicks = clock.ElapsedAtAnchor.Ticks;
            row.ClockWallAnchorUtc = clock.WallAnchorUtc.ToUniversalTime();
            row.ClockFrozen = clock.Frozen;
        }
        else
        {
            row.ClockScenarioStart = null;
            row.ClockTimeZone = null;
            row.ClockElapsedAtAnchorTicks = null;
            row.ClockWallAnchorUtc = null;
            row.ClockFrozen = false;
        }

        var message = snapshot.Overlay.Message ?? string.Empty;
        if (message.Length > ExerciseRuntimeState.MaxOverlayMessageLength)
        {
            throw new ArgumentException(
                $"The overlay message exceeds {ExerciseRuntimeState.MaxOverlayMessageLength} characters.", nameof(snapshot));
        }

        row.OverlayState = snapshot.Overlay.State;
        row.OverlayRegister = snapshot.Overlay.Register;
        row.OverlayMessage = message.Length == 0 ? null : message;
        row.OverlaySequence = snapshot.Overlay.Sequence;
        row.UpdatedAt = updatedAt;
    }

    /// <summary>
    /// Parses a persisted <paramref name="row"/> back into a snapshot, refusing — with a log-ready
    /// <paramref name="reason"/> — anything that cannot be restored faithfully: an unknown tier, a partial or
    /// unparseable clock (L-3), a frozen flag without a clock, an unknown overlay state or register, or a negative
    /// sequence. Never throws for bad data.
    /// </summary>
    /// <param name="row">The persisted row.</param>
    /// <param name="snapshot">The parsed snapshot when the row is valid.</param>
    /// <param name="reason">Why the row was refused, when it was.</param>
    /// <returns><c>true</c> when the row parsed.</returns>
    public static bool TryParse(
        ExerciseRuntimeState row,
        [NotNullWhen(true)] out ExerciseRuntimeStateSnapshot? snapshot,
        [NotNullWhen(false)] out string? reason)
    {
        ArgumentNullException.ThrowIfNull(row);
        snapshot = null;

        if (row.ExerciseId == Guid.Empty)
        {
            reason = "the row names no exercise";
            return false;
        }

        if (!PauseTierWire.TryParse(row.PauseTier, out var tier))
        {
            reason = $"unknown pause tier '{row.PauseTier}'";
            return false;
        }

        if (!TryParseClock(row, out var clock, out reason))
        {
            return false;
        }

        if (row.OverlayState is not (OverlayStateWire.None or OverlayStateWire.Pause))
        {
            reason = $"unknown overlay state '{row.OverlayState}'";
            return false;
        }

        var register = row.OverlayRegister ?? OverlayStateWire.InFiction;
        if (register is not (OverlayStateWire.InFiction or OverlayStateWire.OutOfFiction))
        {
            reason = $"unknown overlay register '{row.OverlayRegister}'";
            return false;
        }

        if (row.OverlaySequence < 0)
        {
            reason = "negative overlay sequence";
            return false;
        }

        snapshot = new ExerciseRuntimeStateSnapshot(
            row.ExerciseId,
            tier,
            clock,
            new OverlayStateSnapshot(row.OverlayState, register, row.OverlayMessage ?? string.Empty, row.OverlaySequence));
        reason = null;
        return true;
    }

    private static bool TryParseClock(
        ExerciseRuntimeState row, out ExerciseClockAnchor? clock, [NotNullWhen(false)] out string? reason)
    {
        clock = null;
        reason = null;

        var setCount = (row.ClockScenarioStart.HasValue ? 1 : 0)
            + (row.ClockTimeZone is not null ? 1 : 0)
            + (row.ClockElapsedAtAnchorTicks.HasValue ? 1 : 0)
            + (row.ClockWallAnchorUtc.HasValue ? 1 : 0);

        if (setCount == 0)
        {
            if (row.ClockFrozen)
            {
                reason = "the clock is marked frozen but has no anchor";
                return false;
            }

            return true;
        }

        if (setCount != 4)
        {
            reason = "the clock columns are partly set (they must be all null or all set)";
            return false;
        }

        if (row.ClockElapsedAtAnchorTicks!.Value < 0)
        {
            reason = "negative elapsed scenario time at the anchor";
            return false;
        }

        TimeZoneInfo timeZone;
        try
        {
            timeZone = TimeZoneInfo.FindSystemTimeZoneById(row.ClockTimeZone!);
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            reason = $"unknown clock time zone '{row.ClockTimeZone}'";
            return false;
        }

        clock = new ExerciseClockAnchor(
            row.ClockScenarioStart!.Value,
            timeZone,
            TimeSpan.FromTicks(row.ClockElapsedAtAnchorTicks.Value),
            row.ClockWallAnchorUtc!.Value,
            row.ClockFrozen);
        return true;
    }
}
