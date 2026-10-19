namespace Pulse.WebApi.Features.Identity.Enrollments;

using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The exercise facts a staff-change record needs: the exercise and its organization (the two scopes the record is
/// written to), and the scenario instant + time zone the XC-004 event is stamped with.
/// </summary>
/// <param name="ExerciseId">The exercise the event is scoped to.</param>
/// <param name="OrganizationId">The organization the audit record is scoped to.</param>
/// <param name="ScenarioTime">
/// The exercise's scenario now, already resolved by the caller through <c>IScenarioNow</c> (engine-runtime/08, CLK-2:
/// the clock, else the latest post, else the operation's wall-clock now).
/// </param>
/// <param name="TimeZone">The exercise time zone.</param>
public sealed record StaffChangeExercise(Guid ExerciseId, Guid OrganizationId, DateTimeOffset ScenarioTime, string TimeZone)
{
    /// <summary>Projects the facts from a loaded <see cref="Exercise"/> and its resolved scenario now.</summary>
    /// <param name="exercise">The exercise.</param>
    /// <param name="scenarioTime">The exercise's scenario now (<c>IScenarioNow</c>).</param>
    /// <returns>The facts.</returns>
    public static StaffChangeExercise From(Exercise exercise, DateTimeOffset scenarioTime)
    {
        ArgumentNullException.ThrowIfNull(exercise);
        return new StaffChangeExercise(exercise.Id, exercise.OrganizationId, scenarioTime, exercise.TimeZone);
    }
}

/// <summary>
/// Stages the two records of one staff-world change in the caller's unit of work (ADMIN-IDENTITY-MODEL §7.5): an XC-004
/// <see cref="TelemetryEvent"/> on the exercise (channel <c>system</c>, v0 envelope) and an <see cref="OrgAuditEvent"/>
/// on the organization. Shared by <see cref="EnrollmentService"/> and the role-matrix "no lead ⇒ swamped off" self-heal,
/// so the swamped-mode-off flip is recorded the same way whichever path turned it off (story 17 Gate-1 WR-003).
/// </summary>
public static class StaffChangeRecorder
{
    private const string SchemaVersion = "v0";
    private const string SystemActorKind = "system";
    private const string SystemChannel = "system";
    private const string SuccessOutcome = "success";

    /// <summary>Stages the event and the audit record; the caller saves.</summary>
    /// <param name="dbContext">The unit of work to stage into.</param>
    /// <param name="exercise">The exercise facts.</param>
    /// <param name="actor">
    /// The acting human, their role and session — or <c>null</c> for a system action (no acting human: the
    /// off-envelope fields are null-omitted, and the audit has no actor person).
    /// </param>
    /// <param name="target">The changed entity (type + id).</param>
    /// <param name="subjectPersonId">The person the change is about, if any.</param>
    /// <param name="eventType">The XC-004 event type.</param>
    /// <param name="auditKind">The org-audit kind.</param>
    /// <param name="payload">The opaque JSON payload (shared by both records).</param>
    /// <param name="now">The ONE server wall-clock read of the operation.</param>
    public static void Stage(
        PulseDbContext dbContext,
        StaffChangeExercise exercise,
        StaffChangeActor? actor,
        TelemetryTarget target,
        Guid? subjectPersonId,
        string eventType,
        string auditKind,
        string payload,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exercise);
        ArgumentNullException.ThrowIfNull(target);

        dbContext.TelemetryEvents.Add(new TelemetryEvent
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = SchemaVersion,
            ExerciseId = exercise.ExerciseId,
            EventType = eventType,
            Channel = SystemChannel,
            Actor = new TelemetryActor
            {
                Kind = SystemActorKind,
                Role = actor?.Role,
                ActingHumanId = actor?.PersonId.ToString(),
                SessionId = actor?.SessionId.ToString(),
            },
            WallClockTime = now,

            // COR-053: the exercise's scenario now, resolved by the caller (IScenarioNow), never re-derived here.
            ScenarioTime = exercise.ScenarioTime,
            TimeZone = exercise.TimeZone,
            Target = target,
            Payload = payload,
            EmittedAt = now,
        });

        dbContext.OrgAuditEvents.Add(new OrgAuditEvent
        {
            Id = Guid.NewGuid(),
            OrganizationId = exercise.OrganizationId,
            Kind = auditKind,
            Outcome = SuccessOutcome,
            ActorPersonId = actor?.PersonId,
            SubjectPersonId = subjectPersonId,
            ExerciseId = exercise.ExerciseId,
            Payload = payload,
            OccurredAt = now,
        });
    }
}

/// <summary>The human behind a staff change: their person id, their role and the session they acted through.</summary>
/// <param name="PersonId">The acting person (the staff facet id).</param>
/// <param name="Role">The acting role.</param>
/// <param name="SessionId">The session the change was made through.</param>
public sealed record StaffChangeActor(Guid PersonId, string Role, Guid SessionId);
