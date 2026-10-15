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
    private readonly TimeProvider _timeProvider;

    /// <summary>Creates the reset service.</summary>
    /// <param name="pauseTiers">The pause-tier registry (the in-memory half of the reset).</param>
    /// <param name="persister">Deletes the row and commits the event.</param>
    /// <param name="clock">Read for the scenario time the event is stamped with, before the clock is cleared.</param>
    /// <param name="exerciseContext">The server-resolved scope (COR-001).</param>
    /// <param name="staffSession">The calling staff human (event attribution, staff-side only).</param>
    /// <param name="exerciseFacts">The exercise's time zone and stored scenario instant.</param>
    /// <param name="timeProvider">The server wall clock.</param>
    public RuntimeStateResetService(
        PauseTierRegistry pauseTiers,
        IExerciseRuntimeStatePersister persister,
        IExerciseClock clock,
        IExerciseContext exerciseContext,
        ICurrentStaffSessionAccessor staffSession,
        ExerciseFactsReader exerciseFacts,
        TimeProvider timeProvider)
    {
        ArgumentNullException.ThrowIfNull(pauseTiers);
        ArgumentNullException.ThrowIfNull(persister);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(staffSession);
        ArgumentNullException.ThrowIfNull(exerciseFacts);
        ArgumentNullException.ThrowIfNull(timeProvider);

        _pauseTiers = pauseTiers;
        _persister = persister;
        _clock = clock;
        _exerciseContext = exerciseContext;
        _staffSession = staffSession;
        _exerciseFacts = exerciseFacts;
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
        var staff = await _staffSession.GetCurrentStaffSessionAsync(cancellationToken).ConfigureAwait(false);
        var facts = await _exerciseFacts.GetAsync(exerciseId, cancellationToken).ConfigureAwait(false);

        // Read BEFORE the clear: the event is stamped with the scenario instant the reset happened at (COR-053).
        var now = _timeProvider.GetUtcNow();
        var clockWasStarted = _clock.IsRunning(exerciseId) || _clock.IsFrozen(exerciseId);
        var clockWasFrozen = _clock.IsFrozen(exerciseId);
        var scenarioTime = _clock.CurrentScenarioTime(exerciseId) ?? facts?.StoredScenarioTime ?? now;

        var actingHumanId = staff?.StaffUserId.ToString() ?? "unknown-staff";
        var previousTier = await _pauseTiers.ResetAsync(exerciseId, actingHumanId, cancellationToken).ConfigureAwait(false);

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

        var persisted = await _persister.DeleteAsync(exerciseId, auditEvent, cancellationToken).ConfigureAwait(false);

        return PauseTierStateDto.From(_pauseTiers, exerciseId, persisted);
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
