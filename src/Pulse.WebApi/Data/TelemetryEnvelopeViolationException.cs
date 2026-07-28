namespace Pulse.WebApi.Data;

/// <summary>
/// Thrown by the <see cref="PulseDbContext"/> write-guard when a tracked
/// <see cref="Entities.TelemetryEvent"/> is about to be persisted in violation of the LOCKED v0 envelope's
/// conditional-requiredness rules (XC-004 / COR-018 / COR-015) — e.g. <c>actor.kind: 'participant'</c> with
/// no <c>actor.participantId</c>. The row never reaches the database.
/// </summary>
/// <remarks>
/// This closes the gap behind #356: <c>POST /api/telemetry</c> re-enforced every conditional rule server-side,
/// but a service adding a <see cref="Entities.TelemetryEvent"/> directly to the context bypassed all of it, so
/// an internal emitter could persist a row the public endpoint would have rejected with a 400. Derives from
/// <see cref="InvalidOperationException"/> so existing catch sites that expect an invalid-state failure still
/// handle it — matching <see cref="ExerciseScopeViolationException"/>'s choice.
/// </remarks>
public sealed class TelemetryEnvelopeViolationException : InvalidOperationException
{
    /// <summary>Creates the exception with a default message.</summary>
    public TelemetryEnvelopeViolationException()
        : base("A telemetry event was saved in violation of the v0 envelope's conditional-requiredness rules; the write was blocked (XC-004).")
    {
    }

    /// <summary>Creates the exception with a caller-supplied message.</summary>
    public TelemetryEnvelopeViolationException(string message)
        : base(message)
    {
    }

    /// <summary>Creates the exception with a caller-supplied message and inner exception.</summary>
    public TelemetryEnvelopeViolationException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
