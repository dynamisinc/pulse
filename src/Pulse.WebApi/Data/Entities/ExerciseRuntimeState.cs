namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// One row per exercise holding the steering runtime state that must survive an App Service restart (demo-feedback
/// Wave 4, DF-24..DF-27): the pause tier, the scenario-clock anchor and the participant holding page (overlay). Written
/// through on every applied change and read back by a startup rehydrator (story 18) before any hosted service ticks.
/// </summary>
/// <remarks>
/// <para>
/// <b>Keyed by its exercise.</b> <see cref="ExerciseId"/> is the primary key and a foreign key to <c>Exercises</c>
/// (<c>Restrict</c>, XC-010: exercises are never hard-deleted), so there is at most one row per exercise. <see cref="IExerciseScoped"/>, so it inherits the
/// central read filter and write guard; it carries no participant-visible content of its own.
/// </para>
/// <para>
/// <b>Clock columns are all-or-nothing.</b> <see cref="ClockScenarioStart"/>, <see cref="ClockTimeZone"/>,
/// <see cref="ClockElapsedAtAnchorTicks"/> and <see cref="ClockWallAnchorUtc"/> are either ALL null (the clock has not
/// started) or ALL set. The wall anchor is a UTC <see cref="DateTimeOffset"/>, never a monotonic
/// <c>TimeProvider.GetTimestamp()</c> value, which cannot be persisted across a process (DF-25). On restore the elapsed
/// scenario time is <c>elapsedAtAnchor + (utcNow - wallAnchorUtc)</c> when running and <c>elapsedAtAnchor</c> when
/// <see cref="ClockFrozen"/>.
/// </para>
/// <para>
/// Not on <see cref="Exercise"/> deliberately: keeping it off the entity keeps exercise duplicate (story 22) from
/// copying a Freeze. Schema only here (story 17); the write-through and rehydrator are story 18.
/// </para>
/// </remarks>
public sealed class ExerciseRuntimeState : IExerciseScoped
{
    /// <summary>The schema bound of <see cref="PauseTier"/>.</summary>
    public const int MaxPauseTierLength = 16;

    /// <summary>The schema bound of <see cref="ClockTimeZone"/>.</summary>
    public const int MaxClockTimeZoneLength = 64;

    /// <summary>The schema bound of <see cref="OverlayState"/>.</summary>
    public const int MaxOverlayStateLength = 16;

    /// <summary>The schema bound of <see cref="OverlayRegister"/>.</summary>
    public const int MaxOverlayRegisterLength = 16;

    /// <summary>The schema bound of <see cref="OverlayMessage"/>.</summary>
    public const int MaxOverlayMessageLength = 500;

    /// <summary>The <see cref="PauseTier"/> a new row starts with (and the column default): the world is running.</summary>
    public const string DefaultPauseTier = "running";

    /// <summary>The <see cref="OverlayState"/> a new row starts with (and the column default): no holding page.</summary>
    public const string DefaultOverlayState = "none";

    /// <summary>The owning exercise (COR-001) — also the primary key and a <c>Restrict</c> foreign key to <c>Exercises</c>.</summary>
    public Guid ExerciseId { get; set; }

    /// <summary>The pause tier's wire literal (<c>running</c> / <c>injects</c> / <c>engine</c> / <c>freeze</c>). Defaults to <c>running</c>.</summary>
    public string PauseTier { get; set; } = DefaultPauseTier;

    /// <summary>The scenario instant the clock started at; null when the clock is unstarted (see the clock-column rule in the remarks).</summary>
    public DateTimeOffset? ClockScenarioStart { get; set; }

    /// <summary>The clock's IANA/Windows time-zone id; null when the clock is unstarted.</summary>
    public string? ClockTimeZone { get; set; }

    /// <summary>The elapsed scenario time at the anchor, in ticks; null when the clock is unstarted.</summary>
    public long? ClockElapsedAtAnchorTicks { get; set; }

    /// <summary>The wall-clock anchor, in UTC (never a monotonic timestamp); null when the clock is unstarted.</summary>
    public DateTimeOffset? ClockWallAnchorUtc { get; set; }

    /// <summary>Whether the scenario clock is frozen at the anchor. Defaults to <c>false</c>.</summary>
    public bool ClockFrozen { get; set; }

    /// <summary>The participant holding page's state literal (<c>none</c> / <c>pause</c> / ...). Defaults to <c>none</c>.</summary>
    public string OverlayState { get; set; } = DefaultOverlayState;

    /// <summary>The holding page's register (<c>in-fiction</c> / <c>out-of-fiction</c>); null when none was set.</summary>
    public string? OverlayRegister { get; set; }

    /// <summary>The holding page's message, at most <see cref="MaxOverlayMessageLength"/> characters; null when none.</summary>
    public string? OverlayMessage { get; set; }

    /// <summary>The last overlay sequence published; monotonic across restarts (DF-27). Defaults to 0.</summary>
    public long OverlaySequence { get; set; }

    /// <summary>When this row was last written (server wall clock, UTC).</summary>
    public DateTimeOffset UpdatedAt { get; set; }
}
