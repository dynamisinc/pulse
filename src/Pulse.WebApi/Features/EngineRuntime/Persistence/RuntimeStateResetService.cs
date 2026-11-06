namespace Pulse.WebApi.Features.EngineRuntime.Persistence;

using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// The controller's runtime reset for the resolved exercise (demo-feedback story 18, DF-28): tier Running, clock
/// unstarted, overlay <c>none</c> published with the next sequence, the <c>ExerciseRuntimeStates</c> row deleted and
/// ONE <c>steering.runtime_reset</c> event. The demo reset calls it instead of an App Service restart, which no
/// longer clears anything.
/// </summary>
/// <remarks>
/// <para>
/// <b>Exercise-scoped (COR-001).</b> The exercise comes ONLY from <see cref="IExerciseContext"/>; there is no request
/// body. Every effect is keyed by that one id, so a reset of A never touches B.
/// </para>
/// <para>
/// <b>Idempotent.</b> A second reset finds Running, no clock and no row, publishes <c>none</c> again with a higher
/// sequence (harmless: every client converges on no holding page) and records its own event.
/// </para>
/// <para>
/// <b>The delete is a deliberate hard delete</b> of machine state (17 Gate-1 L-2; see
/// <see cref="IExerciseRuntimeStateStore.DeleteAsync"/>); the event commits in the same unit of work. As with a tier
/// change, the in-memory reset stands even if the delete fails, and the response then says <c>persisted: false</c>.
/// </para>
/// </remarks>
public sealed class RuntimeStateResetService
{
    /// <summary>The XC-004 event type the reset emits (once per reset).</summary>
    public const string RuntimeResetEventType = "steering.runtime_reset";

    private const string SystemChannel = "system";
    private const string SystemActorKind = "system";
    private const string ControllerRole = "controller";
    private const string FallbackTimeZone = "UTC";

    private readonly PauseTierRegistry _pauseTiers;
    private readonly IExerciseRuntimeStatePersister _persister;
    private readonly IExerciseClock _clock;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentStaffSessionAccessor _staffSession;
    private readonly ExerciseFactsReader _exerciseFacts;
    private readonly IScenarioNow _scenarioNow;
    private readonly TimeProvider _timeProvider;

    /// <summary>Creates the reset service.</summary>
    /// <param name="pauseTiers">The pause-tier registry (the in-memory half of the reset).</param>
    /// <param name="persister">Deletes the row and commits the event.</param>
    /// <param name="clock">Read for the scenario time the event is stamped with, before the clock is cleared.</param>
    /// <param name="exerciseContext">The server-resolved scope (COR-001).</param>
    /// <param name="staffSession">The calling staff human (event attribution, staff-side only).</param>
    /// <param name="exerciseFacts">The exercise's time zone.</param>
    /// <param name="scenarioNow">The scenario-now fallback when no clock was running (latest post, else now; CLK-2).</param>
    /// <param name="timeProvider">The server wall clock.</param>
    public RuntimeStateResetService(
        PauseTierRegistry pauseTiers,
        IExerciseRuntimeStatePersister persister,
        IExerciseClock clock,
        IExerciseContext exerciseContext,
        ICurrentStaffSessionAccessor staffSession,
        ExerciseFactsReader exerciseFacts,
        IScenarioNow scenarioNow,
        TimeProvider timeProvider)
    {
        ArgumentNullException.ThrowIfNull(pauseTiers);
        ArgumentNullException.ThrowIfNull(persister);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(staffSession);
        ArgumentNullException.ThrowIfNull(exerciseFacts);
        ArgumentNullException.ThrowIfNull(scenarioNow);
        ArgumentNullException.ThrowIfNull(timeProvider);

        _pauseTiers = pauseTiers;
        _persister = persister;
        _clock = clock;
        _exerciseContext = exerciseContext;
        _staffSession = staffSession;
        _exerciseFacts = exerciseFacts;
        _scenarioNow = scenarioNow;
        _timeProvider = timeProvider;
    }

    /// <summary>Resets the resolved exercise's runtime state.</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The resulting state, or <c>null</c> when the scope is unresolved (fail closed, the caller 401s).</returns>
    public async Task<PauseTierStateDto?> ResetAsync(CancellationToken cancellationToken = default)
    {
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return null;
        }

        var exerciseId = scope.Value;

        // Read BEFORE the clear (in memory): the event is stamped with the scenario instant the reset happened at.
        var now = _timeProvider.GetUtcNow();
        var clockWasStarted = _clock.IsRunning(exerciseId) || _clock.IsFrozen(exerciseId);
        var clockWasFrozen = _clock.IsFrozen(exerciseId);
        var clockScenarioTime = _clock.CurrentScenarioTime(exerciseId);

        // Gate-1 L-3: nothing that needs SQL may block the reset. The staff session was already resolved by the
        // route's filters (so this read is normally cached), but it is best-effort all the same.
        var staff = await TryAsync(() => _staffSession.GetCurrentStaffSessionAsync(cancellationToken)).ConfigureAwait(false);
        var actingHumanId = staff?.StaffUserId.ToString() ?? "unknown-staff";

        // The in-memory reset FIRST (tier, clock, overlay publish).
        var previousTier = await _pauseTiers.ResetAsync(exerciseId, actingHumanId, cancellationToken).ConfigureAwait(false);

        // Best-effort facts for the event, with the existing fallbacks (scenario time, then UTC).
        // M-A: CancellationToken.None — after the in-memory reset nothing may be skipped by a request abort.
        var facts = await TryAsync(() => _exerciseFacts.GetAsync(exerciseId, CancellationToken.None)).ConfigureAwait(false);
        // The clock was read BEFORE the clear; when none was running, the exercise's latest post (CLK-2), best-effort.
        var scenarioTime = clockScenarioTime
            ?? await TryReadAsync(() => _scenarioNow.FindAsync(exerciseId, CancellationToken.None)).ConfigureAwait(false)
            ?? now;

        var auditEvent = new TelemetryEvent
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = "v0",
            ExerciseId = exerciseId,
            EventType = RuntimeResetEventType,
            Channel = SystemChannel,
            Actor = new TelemetryActor
            {
                Kind = SystemActorKind,

                // Off-envelope empty strings are null-omitted (actingHumanId is an optional NON-EMPTY string).
                ActingHumanId = staff?.StaffUserId.ToString(),
                SessionId = staff?.SessionId.ToString(),
                Role = ControllerRole,
            },
            WallClockTime = now,
            ScenarioTime = scenarioTime,
            TimeZone = string.IsNullOrWhiteSpace(facts?.TimeZone) ? FallbackTimeZone : facts.TimeZone,
            Target = new TelemetryTarget { EntityType = "exercise", EntityId = exerciseId.ToString() },
            Payload = JsonSerializer.Serialize(new RuntimeResetPayload
            {
                PreviousTier = PauseTierWire.ToWire(previousTier),
                ClockWasStarted = clockWasStarted,
                ClockWasFrozen = clockWasFrozen,
            }),
            EmittedAt = now,
        };

        // Gate-1 M-1: CancellationToken.None — the in-memory reset is already applied, so a disconnecting client must
        // not leave the row (and a later restart) behind it.
        var persisted = await _persister.DeleteAsync(exerciseId, auditEvent, CancellationToken.None).ConfigureAwait(false);

        return PauseTierStateDto.From(_pauseTiers, exerciseId, persisted);
    }

    /// <summary>The value-type twin of <see cref="TryAsync{T}"/>: <c>null</c> when the read throws (Gate-1 L-3).</summary>
    private static async Task<T?> TryReadAsync<T>(Func<Task<T?>> read)
        where T : struct
    {
        try
        {
            return await read().ConfigureAwait(false);
        }
#pragma warning disable CA1031 // Best-effort by design (Gate-1 L-3): SQL being down must not block a reset.
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return null;
        }
#pragma warning restore CA1031
    }

    /// <summary>Runs a best-effort read: any failure but cancellation yields <c>null</c> (the caller has a fallback).</summary>
    private static async Task<T?> TryAsync<T>(Func<Task<T?>> read)
        where T : class
    {
        try
        {
            return await read().ConfigureAwait(false);
        }
#pragma warning disable CA1031 // Best-effort by design (Gate-1 L-3): SQL being down must not block a reset.
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return null;
        }
#pragma warning restore CA1031
    }

    /// <summary>The <c>steering.runtime_reset</c> payload: what the reset cleared (flags only, no text, no names).</summary>
    private sealed class RuntimeResetPayload
    {
        [JsonPropertyName("previousTier")]
        public required string PreviousTier { get; init; }

        [JsonPropertyName("clockWasStarted")]
        public required bool ClockWasStarted { get; init; }

        [JsonPropertyName("clockWasFrozen")]
        public required bool ClockWasFrozen { get; init; }
    }
}
