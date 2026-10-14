namespace Pulse.WebApi.Features.Identity.EasyLogin;

using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;

/// <summary>
/// Builds every XC-004 event the easy-login feature emits (the telemetry table in <c>implementation.md</c>), against
/// the locked v0 envelope, so stories 02 to 05 and 13 never hand-roll one (gotcha 6). The caller adds the event to the
/// SAME <c>SaveChanges</c> as the mutation it describes. Modelled on
/// <c>SharedCredentialLifecycleService.BuildLifecycleTelemetry</c> (staff actions) and
/// <c>ParticipantLoginService.BuildLoginTelemetry</c> (sign-ins).
/// </summary>
/// <remarks>
/// <para>
/// <b>Envelope.</b> Every event is <c>channel: system</c>, <c>schemaVersion: v0</c>, server wall clock plus the
/// exercise's scenario time and zone (<see cref="EasyLoginEventTime"/>). A sign-in success is
/// <c>actor { kind: participant, participantId: account id }</c>; an identity-less failure is
/// <c>actor { kind: system }</c> with no identity (the #356 trap: <c>participant</c> without a <c>participantId</c> is
/// refused by <c>TelemetryEnvelopeRules</c> and the write guard). A staff action is
/// <c>actor { kind: system, role, actingHumanId: staff user id }</c>. Empty off-envelope strings are omitted, never
/// written as <c>""</c>.
/// </para>
/// <para>
/// <b>No secret can be carried (gotcha 8).</b> Payloads are built from typed values only (an outcome or method
/// literal, counts, ids, a date, booleans): no parameter accepts a token, a word, a join URL or an email address. The
/// one free-text value, the attempted sign-in name on a failed word sign-in, passes through
/// <see cref="RedactAttemptedName"/>, which drops anything shaped like an email, a URL, a link token, a generated day
/// word or a phrase. A caller that also holds the attempted word must pass <c>null</c> when the name equals it (a
/// word typed into the name box).
/// </para>
/// </remarks>
public static partial class EasyLoginTelemetry
{
    /// <summary>The XC-004 schema version.</summary>
    public const string SchemaVersion = "v0";

    /// <summary>The channel of every easy-login event.</summary>
    public const string Channel = "system";

    /// <summary>The actor kind of a sign-in success.</summary>
    public const string ParticipantActorKind = "participant";

    /// <summary>The actor kind of an identity-less sign-in failure and of every staff action.</summary>
    public const string SystemActorKind = "system";

    /// <summary>Event type: a link or word sign-in, success or failure.</summary>
    public const string LoginEventType = "login";

    /// <summary>Event type: a participant's first link was issued.</summary>
    public const string LinkIssuedEventType = "participant.link.issued";

    /// <summary>Event type: a participant's link was reissued (new token).</summary>
    public const string LinkReissuedEventType = "participant.link.reissued";

    /// <summary>Event type: a participant's link was revoked.</summary>
    public const string LinkRevokedEventType = "participant.link.revoked";

    /// <summary>Event type: a participant was disabled.</summary>
    public const string ParticipantDisabledEventType = "participant.disabled";

    /// <summary>Event type: a participant was re-enabled.</summary>
    public const string ParticipantEnabledEventType = "participant.enabled";

    /// <summary>Event type: a (non-dry-run) roster import ran.</summary>
    public const string RosterImportedEventType = "roster.imported";

    /// <summary>Event type: the card sheet was generated.</summary>
    public const string RosterCardsGeneratedEventType = "roster.cards.generated";

    /// <summary>Event type: a day word was set or replaced.</summary>
    public const string CredentialRotatedEventType = "credential.rotated";

    /// <summary>Event type: a day word was cleared.</summary>
    public const string CredentialRevokedEventType = "credential.revoked";

    /// <summary>Event type: a join link was emailed (story 13).</summary>
    public const string LinkEmailedEventType = "participant.link.emailed";

    /// <summary>Target entity type: a <c>ParticipantLink</c> row.</summary>
    public const string ParticipantLinkEntityType = "participantLink";

    /// <summary>Target entity type: an <c>Account</c> row.</summary>
    public const string AccountEntityType = "account";

    /// <summary>Target entity type: an <c>ExerciseDayWord</c> row.</summary>
    public const string DayWordEntityType = "dayWord";

    /// <summary>Target entity type: the attempted sign-in name of a failed word sign-in.</summary>
    public const string AttemptedHandleEntityType = "accountHandle";

    /// <summary>The longest attempted sign-in name kept as a failure target.</summary>
    public const int MaxAttemptedNameLength = 64;

    private const string SuccessOutcome = "success";
    private const string FailureOutcome = "failure";
    private const string SentOutcome = "sent";
    private const string FailedOutcome = "failed";

    private static readonly JsonSerializerOptions PayloadOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>A successful link or word sign-in: the participant is the actor. No target.</summary>
    /// <param name="exerciseId">The host-resolved exercise.</param>
    /// <param name="accountId">The signed-in account (becomes <c>actor.participantId</c>).</param>
    /// <param name="method">How they signed in.</param>
    /// <param name="time">The one clock read shared with the mutation.</param>
    /// <returns>The event to add to the same unit of work.</returns>
    public static TelemetryEvent LoginSucceeded(Guid exerciseId, Guid accountId, EasyLoginMethod method, EasyLoginEventTime time)
    {
        RequireId(accountId, nameof(accountId));

        return Build(
            exerciseId,
            LoginEventType,
            new TelemetryActor { Kind = ParticipantActorKind, ParticipantId = accountId.ToString() },
            target: null,
            Serialize(new LoginPayload(SuccessOutcome, MethodLiteral(method))),
            time);
    }

    /// <summary>A failed link sign-in: an identity-less <c>system</c> actor and NO target (never the token).</summary>
    /// <param name="exerciseId">The host-resolved exercise.</param>
    /// <param name="time">The one clock read for the attempt.</param>
    /// <returns>The event to persist.</returns>
    public static TelemetryEvent LinkLoginFailed(Guid exerciseId, EasyLoginEventTime time) =>
        Build(
            exerciseId,
            LoginEventType,
            new TelemetryActor { Kind = SystemActorKind },
            target: null,
            Serialize(new LoginPayload(FailureOutcome, MethodLiteral(EasyLoginMethod.Link))),
            time);

    /// <summary>
    /// A failed word sign-in: an identity-less <c>system</c> actor, and the attempted sign-in name as the target when
    /// <see cref="RedactAttemptedName"/> keeps it. Never the word.
    /// </summary>
    /// <param name="exerciseId">The host-resolved exercise.</param>
    /// <param name="attemptedSignInName">The sanitized, trimmed name as typed; <c>null</c> when unknown or when it equals the attempted word.</param>
    /// <param name="time">The one clock read for the attempt.</param>
    /// <returns>The event to persist.</returns>
    public static TelemetryEvent WordLoginFailed(Guid exerciseId, string? attemptedSignInName, EasyLoginEventTime time)
    {
        var name = RedactAttemptedName(attemptedSignInName);

        return Build(
            exerciseId,
            LoginEventType,
            new TelemetryActor { Kind = SystemActorKind },
            name is null ? null : new TelemetryTarget { EntityType = AttemptedHandleEntityType, EntityId = name },
            Serialize(new LoginPayload(FailureOutcome, MethodLiteral(EasyLoginMethod.Word))),
            time);
    }

    /// <summary>A participant's first link was issued (staff action or provisioning).</summary>
    /// <param name="exerciseId">The resolved exercise.</param>
    /// <param name="staff">The acting staff user and role.</param>
    /// <param name="linkId">The <c>ParticipantLink</c> id (the target).</param>
    /// <param name="accountId">The participant's account id (payload).</param>
    /// <param name="time">The one clock read shared with the mutation.</param>
    /// <returns>The event to add to the same unit of work.</returns>
    public static TelemetryEvent LinkIssued(Guid exerciseId, EasyLoginStaffActor staff, Guid linkId, Guid accountId, EasyLoginEventTime time) =>
        LinkEvent(LinkIssuedEventType, exerciseId, staff, linkId, accountId, sessionsEnded: 0, time);

    /// <summary>A participant's link was reissued; <paramref name="sessionsEnded"/> of their sessions were ended.</summary>
    /// <param name="exerciseId">The resolved exercise.</param>
    /// <param name="staff">The acting staff user and role.</param>
    /// <param name="linkId">The <c>ParticipantLink</c> id (the target).</param>
    /// <param name="accountId">The participant's account id (payload).</param>
    /// <param name="sessionsEnded">How many live sessions the reissue ended.</param>
    /// <param name="time">The one clock read shared with the mutation.</param>
    /// <returns>The event to add to the same unit of work.</returns>
    public static TelemetryEvent LinkReissued(Guid exerciseId, EasyLoginStaffActor staff, Guid linkId, Guid accountId, int sessionsEnded, EasyLoginEventTime time) =>
        LinkEvent(LinkReissuedEventType, exerciseId, staff, linkId, accountId, sessionsEnded, time);

    /// <summary>A participant's link was revoked; <paramref name="sessionsEnded"/> of their sessions were ended.</summary>
    /// <param name="exerciseId">The resolved exercise.</param>
    /// <param name="staff">The acting staff user and role.</param>
    /// <param name="linkId">The <c>ParticipantLink</c> id (the target).</param>
    /// <param name="accountId">The participant's account id (payload).</param>
    /// <param name="sessionsEnded">How many live sessions the revoke ended.</param>
    /// <param name="time">The one clock read shared with the mutation.</param>
    /// <returns>The event to add to the same unit of work.</returns>
    public static TelemetryEvent LinkRevoked(Guid exerciseId, EasyLoginStaffActor staff, Guid linkId, Guid accountId, int sessionsEnded, EasyLoginEventTime time) =>
        LinkEvent(LinkRevokedEventType, exerciseId, staff, linkId, accountId, sessionsEnded, time);

    /// <summary>A participant was disabled; <paramref name="sessionsEnded"/> of their sessions were ended.</summary>
    /// <param name="exerciseId">The resolved exercise.</param>
    /// <param name="staff">The acting staff user and role.</param>
    /// <param name="accountId">The account id (the target).</param>
    /// <param name="sessionsEnded">How many live sessions the disable ended.</param>
    /// <param name="time">The one clock read shared with the mutation.</param>
    /// <returns>The event to add to the same unit of work.</returns>
    public static TelemetryEvent ParticipantDisabled(Guid exerciseId, EasyLoginStaffActor staff, Guid accountId, int sessionsEnded, EasyLoginEventTime time) =>
        AccountEvent(ParticipantDisabledEventType, exerciseId, staff, accountId, sessionsEnded, time);

    /// <summary>A participant was re-enabled (<paramref name="sessionsEnded"/> is normally 0).</summary>
    /// <param name="exerciseId">The resolved exercise.</param>
    /// <param name="staff">The acting staff user and role.</param>
    /// <param name="accountId">The account id (the target).</param>
    /// <param name="sessionsEnded">How many sessions the action ended.</param>
    /// <param name="time">The one clock read shared with the mutation.</param>
    /// <returns>The event to add to the same unit of work.</returns>
    public static TelemetryEvent ParticipantEnabled(Guid exerciseId, EasyLoginStaffActor staff, Guid accountId, int sessionsEnded, EasyLoginEventTime time) =>
        AccountEvent(ParticipantEnabledEventType, exerciseId, staff, accountId, sessionsEnded, time);

    /// <summary>A non-dry-run roster import: the four row counts, nothing else. No target.</summary>
    /// <param name="exerciseId">The resolved exercise.</param>
    /// <param name="staff">The acting staff user and role.</param>
    /// <param name="created">Rows created.</param>
    /// <param name="updated">Rows updated.</param>
    /// <param name="unchanged">Rows unchanged.</param>
    /// <param name="failed">Rows failed.</param>
    /// <param name="time">The one clock read shared with the mutation.</param>
    /// <returns>The event to add to the same unit of work.</returns>
    public static TelemetryEvent RosterImported(
        Guid exerciseId,
        EasyLoginStaffActor staff,
        int created,
        int updated,
        int unchanged,
        int failed,
        EasyLoginEventTime time) =>
        Build(
            exerciseId,
            RosterImportedEventType,
            StaffActor(staff),
            target: null,
            Serialize(new RosterImportedPayload(created, updated, unchanged, failed)),
            time);

    /// <summary>The card sheet was generated: the card count only. No target.</summary>
    /// <param name="exerciseId">The resolved exercise.</param>
    /// <param name="staff">The acting staff user and role.</param>
    /// <param name="count">How many cards were returned.</param>
    /// <param name="time">The one clock read for the request.</param>
    /// <returns>The event to persist.</returns>
    public static TelemetryEvent RosterCardsGenerated(Guid exerciseId, EasyLoginStaffActor staff, int count, EasyLoginEventTime time) =>
        Build(
            exerciseId,
            RosterCardsGeneratedEventType,
            StaffActor(staff),
            target: null,
            Serialize(new CountPayload(count)),
            time);

    /// <summary>A day word was set (<paramref name="first"/>) or replaced for <paramref name="date"/>. Never the word.</summary>
    /// <param name="exerciseId">The resolved exercise.</param>
    /// <param name="staff">The acting staff user and role.</param>
    /// <param name="dayWordId">The <c>ExerciseDayWord</c> id (the target).</param>
    /// <param name="date">The exercise date the word is for.</param>
    /// <param name="first">Whether this is the first word set for that date (false = a replacement).</param>
    /// <param name="generated">Whether the server generated the word.</param>
    /// <param name="time">The one clock read shared with the mutation.</param>
    /// <returns>The event to add to the same unit of work.</returns>
    public static TelemetryEvent DayWordSet(
        Guid exerciseId,
        EasyLoginStaffActor staff,
        Guid dayWordId,
        DateOnly date,
        bool first,
        bool generated,
        EasyLoginEventTime time) =>
        Build(
            exerciseId,
            CredentialRotatedEventType,
            StaffActor(staff),
            Target(DayWordEntityType, dayWordId, nameof(dayWordId)),
            Serialize(new DayWordSetPayload(FormatDate(date), first, generated)),
            time);

    /// <summary>The day word for <paramref name="date"/> was cleared.</summary>
    /// <param name="exerciseId">The resolved exercise.</param>
    /// <param name="staff">The acting staff user and role.</param>
    /// <param name="dayWordId">The cleared <c>ExerciseDayWord</c> id (the target).</param>
    /// <param name="date">The exercise date that lost its word.</param>
    /// <param name="time">The one clock read shared with the mutation.</param>
    /// <returns>The event to add to the same unit of work.</returns>
    public static TelemetryEvent DayWordCleared(Guid exerciseId, EasyLoginStaffActor staff, Guid dayWordId, DateOnly date, EasyLoginEventTime time) =>
        Build(
            exerciseId,
            CredentialRevokedEventType,
            StaffActor(staff),
            Target(DayWordEntityType, dayWordId, nameof(dayWordId)),
            Serialize(new DatePayload(FormatDate(date))),
            time);

    /// <summary>One emailed join link (story 13): the outcome only. Never the address or the URL.</summary>
    /// <param name="exerciseId">The resolved exercise.</param>
    /// <param name="staff">The acting staff user and role.</param>
    /// <param name="linkId">The <c>ParticipantLink</c> id (the target).</param>
    /// <param name="sent">Whether the send succeeded.</param>
    /// <param name="time">The one clock read for the send.</param>
    /// <returns>The event to persist.</returns>
    public static TelemetryEvent LinkEmailed(Guid exerciseId, EasyLoginStaffActor staff, Guid linkId, bool sent, EasyLoginEventTime time) =>
        Build(
            exerciseId,
            LinkEmailedEventType,
            StaffActor(staff),
            Target(ParticipantLinkEntityType, linkId, nameof(linkId)),
            Serialize(new OutcomePayload(sent ? SentOutcome : FailedOutcome)),
            time);

    /// <summary>
    /// Returns the attempted sign-in name when it is safe to record as a failure target, or <c>null</c>. Dropped: a
    /// blank value, anything over <see cref="MaxAttemptedNameLength"/> characters, anything with whitespace or a
    /// control character (a phrase, such as a spoken day word), an email address (<c>@</c>), a URL (<c>:</c>,
    /// <c>/</c> or <c>\</c>), a value shaped like a link token (22 base64url characters) and one shaped like a
    /// generated day word (<c>adjective-noun-NN</c>, separators optional, so <c>mapleharbor42</c> too; a name such as
    /// <c>jsmith42</c> is dropped as well, which is accepted over-redaction).
    /// </summary>
    /// <param name="attemptedSignInName">The sanitized name as typed.</param>
    /// <returns>The trimmed name, or <c>null</c>.</returns>
    public static string? RedactAttemptedName(string? attemptedSignInName)
    {
        var name = attemptedSignInName?.Trim();
        if (string.IsNullOrEmpty(name) || name.Length > MaxAttemptedNameLength)
        {
            return null;
        }

        foreach (var c in name)
        {
            if (char.IsWhiteSpace(c) || char.IsControl(c) || c is '@' or ':' or '/' or '\\')
            {
                return null;
            }
        }

        if (TokenShape().IsMatch(name) || GeneratedWordShape().IsMatch(name))
        {
            return null;
        }

        return name;
    }

    private static TelemetryEvent LinkEvent(
        string eventType,
        Guid exerciseId,
        EasyLoginStaffActor staff,
        Guid linkId,
        Guid accountId,
        int sessionsEnded,
        EasyLoginEventTime time)
    {
        RequireId(accountId, nameof(accountId));

        return Build(
            exerciseId,
            eventType,
            StaffActor(staff),
            Target(ParticipantLinkEntityType, linkId, nameof(linkId)),
            Serialize(new LinkPayload(accountId.ToString(), RequireCount(sessionsEnded, nameof(sessionsEnded)))),
            time);
    }

    private static TelemetryEvent AccountEvent(
        string eventType,
        Guid exerciseId,
        EasyLoginStaffActor staff,
        Guid accountId,
        int sessionsEnded,
        EasyLoginEventTime time) =>
        Build(
            exerciseId,
            eventType,
            StaffActor(staff),
            Target(AccountEntityType, accountId, nameof(accountId)),
            Serialize(new SessionsEndedPayload(RequireCount(sessionsEnded, nameof(sessionsEnded)))),
            time);

    private static TelemetryEvent Build(
        Guid exerciseId,
        string eventType,
        TelemetryActor actor,
        TelemetryTarget? target,
        string payload,
        EasyLoginEventTime time)
    {
        RequireId(exerciseId, nameof(exerciseId));
        ArgumentNullException.ThrowIfNull(time);

        return new TelemetryEvent
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = SchemaVersion,
            ExerciseId = exerciseId,
            EventType = eventType,
            Channel = Channel,
            Actor = actor,
            WallClockTime = time.WallClock,
            ScenarioTime = time.ScenarioTime,
            TimeZone = time.TimeZone,
            Target = target,
            Payload = payload,
            EmittedAt = time.WallClock,
        };
    }

    private static TelemetryActor StaffActor(EasyLoginStaffActor staff)
    {
        ArgumentNullException.ThrowIfNull(staff);

        return new TelemetryActor
        {
            Kind = SystemActorKind,
            Role = string.IsNullOrWhiteSpace(staff.Role) ? null : staff.Role,
            ActingHumanId = staff.StaffUserId is { } id && id != Guid.Empty ? id.ToString() : null,
        };
    }

    private static TelemetryTarget Target(string entityType, Guid id, string parameterName)
    {
        RequireId(id, parameterName);
        return new TelemetryTarget { EntityType = entityType, EntityId = id.ToString() };
    }

    private static string MethodLiteral(EasyLoginMethod method) => method switch
    {
        EasyLoginMethod.Link => "link",
        EasyLoginMethod.Word => "word",
        _ => throw new ArgumentOutOfRangeException(nameof(method), method, "Unknown sign-in method."),
    };

    private static string FormatDate(DateOnly date) => EasyLoginWire.Date(date);

    private static string Serialize<T>(T payload) => JsonSerializer.Serialize(payload, PayloadOptions);

    private static void RequireId(Guid id, string parameterName)
    {
        if (id == Guid.Empty)
        {
            throw new ArgumentException("An empty id cannot be recorded.", parameterName);
        }
    }

    private static int RequireCount(int count, string parameterName)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(count, parameterName);
        return count;
    }

    /// <summary>22 base64url characters: the shape of a raw link token (<see cref="ParticipantLinkTokens.TokenLength"/>).</summary>
    [GeneratedRegex("^[A-Za-z0-9_-]{22}$", RegexOptions.CultureInvariant)]
    private static partial Regex TokenShape();

    /// <summary>
    /// The generated day word's read-aloud shape, <c>adjective-noun-NN</c> (story 05), with or without its separators
    /// (<c>-</c>, <c>_</c> or <c>.</c>): <c>maple-harbor-42</c>, <c>mapleharbor42</c>. Review W-3: this deliberately
    /// over-redacts a sign-in name that ends in two digits (<c>jsmith42</c>), which costs only an audit target.
    /// </summary>
    [GeneratedRegex("^[A-Za-z]+[-_.]?[A-Za-z]+[-_.]?[0-9]{2}$", RegexOptions.CultureInvariant)]
    private static partial Regex GeneratedWordShape();

    private sealed record LoginPayload(
        [property: JsonPropertyName("outcome")] string Outcome,
        [property: JsonPropertyName("method")] string Method);

    private sealed record LinkPayload(
        [property: JsonPropertyName("accountId")] string AccountId,
        [property: JsonPropertyName("sessionsEnded")] int SessionsEnded);

    private sealed record SessionsEndedPayload(
        [property: JsonPropertyName("sessionsEnded")] int SessionsEnded);

    private sealed record RosterImportedPayload(
        [property: JsonPropertyName("created")] int Created,
        [property: JsonPropertyName("updated")] int Updated,
        [property: JsonPropertyName("unchanged")] int Unchanged,
        [property: JsonPropertyName("failed")] int Failed);

    private sealed record CountPayload(
        [property: JsonPropertyName("count")] int Count);

    private sealed record DayWordSetPayload(
        [property: JsonPropertyName("date")] string Date,
        [property: JsonPropertyName("first")] bool First,
        [property: JsonPropertyName("generated")] bool Generated);

    private sealed record DatePayload(
        [property: JsonPropertyName("date")] string Date);

    private sealed record OutcomePayload(
        [property: JsonPropertyName("outcome")] string Outcome);
}

/// <summary>How a participant signed in without a password (the <c>method</c> in a <c>login</c> payload).</summary>
public enum EasyLoginMethod
{
    /// <summary>The personal join link or its QR code (<c>"link"</c>).</summary>
    Link,

    /// <summary>Sign-in name plus the day word (<c>"word"</c>).</summary>
    Word,
}

/// <summary>The staff caller behind a staff action: <c>actor.actingHumanId</c> and <c>actor.role</c>.</summary>
/// <param name="StaffUserId">The server-resolved staff user id, or <c>null</c> (omitted from the actor).</param>
/// <param name="Role">The staff role on this exercise (<c>controller</c> / <c>planner</c>), or <c>null</c> (omitted).</param>
public sealed record EasyLoginStaffActor(Guid? StaffUserId, string? Role);

/// <summary>
/// The ONE clock read an operation shares between its mutation and its event: server wall clock, the exercise's
/// scenario time (COR-053) and its zone.
/// </summary>
/// <param name="WallClock">The server wall clock (also <c>emittedAt</c>).</param>
/// <param name="ScenarioTime">The exercise's current scenario instant.</param>
/// <param name="TimeZone">The exercise's IANA zone id (never blank).</param>
public sealed record EasyLoginEventTime(DateTimeOffset WallClock, DateTimeOffset ScenarioTime, string TimeZone)
{
    /// <summary>
    /// Builds the event time as <c>InjectQueueService</c> does: scenario time is the live exercise clock, else the
    /// persisted scenario instant, else the wall clock; a blank zone becomes <c>UTC</c>.
    /// </summary>
    /// <param name="exerciseId">The resolved exercise (for the live clock).</param>
    /// <param name="facts">The exercise facts from <see cref="ExerciseFactsReader"/>, or <c>null</c>.</param>
    /// <param name="clock">The native exercise clock, or <c>null</c> when none is available.</param>
    /// <param name="now">The server wall clock, read once by the caller.</param>
    /// <returns>The event time.</returns>
    public static EasyLoginEventTime For(Guid exerciseId, ExerciseFacts? facts, IExerciseClock? clock, DateTimeOffset now)
    {
        var scenario = clock?.CurrentScenarioTime(exerciseId) ?? facts?.StoredScenarioTime ?? now;
        var zone = string.IsNullOrWhiteSpace(facts?.TimeZone) ? ExerciseDay.UtcZoneId : facts.TimeZone;
        return new EasyLoginEventTime(now, scenario, zone);
    }
}
