namespace Pulse.WebApi.Tests.Telemetry;

using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// Integration tests for <c>POST /api/telemetry</c> (story <c>telemetry/02</c>, #274; extended by
/// <c>identity-auth-roles/13</c>, #362). Boots the real host via
/// <see cref="WebApplicationFactory{TEntryPoint}"/> (reusing <c>backend-host/01</c>'s test-host pattern)
/// pointed at the shared, migrated Testcontainers SQL Server (<see cref="MsSqlContainerFixture"/>), then
/// drives the endpoint over HTTP and asserts DB state through a SEPARATE <see cref="Data.PulseDbContext"/>
/// so nothing is proven by an in-memory change tracker alone. Covers: fully-populated round-trip, 400 on
/// schema-invalid / oversized bodies (with non-persistence), <c>eventId</c> dedup idempotency, and — as of
/// story 13 — that the PERSISTED scope and actor identity are the session's rather than the envelope's.
/// </summary>
/// <remarks>
/// Every test is <see cref="RequiresDockerFactAttribute"/> (Gate-1 W-001): a real <c>Skipped</c> on a
/// Docker-less machine, never a silent <c>Passed</c>. The factory feeds the container connection string to
/// the host via the <c>ConnectionStrings__DefaultConnection</c> process env var set in its constructor —
/// the same "set it before <c>builder.Build()</c> captures config" approach <c>CorsTests</c> documents,
/// because <c>Program.cs</c>'s <c>AddPulsePersistence(builder.Configuration)</c> reads the connection string
/// eagerly at top-level. The assembly already disables cross-class parallelization (see AssemblyInfo.cs), so
/// this process-wide env var can't race another class's host build, and the factory clears it on dispose.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public class TelemetryIngestTests
{
    private static readonly Uri TelemetryUri = new("/api/telemetry", UriKind.Relative);

    private readonly MsSqlContainerFixture _fixture;

    public TelemetryIngestTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task ValidEnvelope_IsAccepted_AndRoundTripsUnchanged()
    {
        var eventId = Guid.NewGuid().ToString();
        var exerciseId = Guid.NewGuid();
        var envelope = ValidEnvelope(eventId, exerciseId.ToString());

        await using var factory = CreateFactory(exerciseId);
        using var client = factory.CreateClient();

        var response = await client.PostAsync(TelemetryUri, JsonContent(envelope));

        response.StatusCode.Should().Be(HttpStatusCode.Accepted);

        await using var readContext = _fixture.CreateContext();
        var stored = await readContext.TelemetryEvents.IgnoreQueryFilters().SingleAsync(e => e.EventId == eventId);

        stored.EventId.Should().Be(eventId);
        stored.SchemaVersion.Should().Be("v0");
        stored.ExerciseId.Should().Be(exerciseId);
        stored.EventType.Should().Be("post");
        stored.Channel.Should().Be("social");
        stored.Actor.Kind.Should().Be("participant");
        stored.Actor.PersonaId.Should().BeNull();

        // identity-auth-roles/13: these three are STAMPED from the presented session, not carried from the body
        // (which sent "participant-42" / "session-abc" / nothing). Everything else round-trips verbatim.
        stored.Actor.ParticipantId.Should().Be(TelemetryWebApplicationFactory.PrincipalId);
        stored.Actor.SessionId.Should().Be(TelemetryWebApplicationFactory.SessionId.ToString());
        stored.Actor.ActingHumanId.Should().Be(TelemetryWebApplicationFactory.ActingHumanId);

        stored.Actor.Role.Should().Be("evaluator");
        stored.Origin.Should().Be("participant");
        stored.InjectId.Should().BeNull();
        stored.CorrelationId.Should().Be("corr-1");
        stored.CausationId.Should().Be("cause-1");
        stored.Sequence.Should().Be(7);
        stored.Source.Should().Be("social-feed");
        stored.WallClockTime.Should().Be(new DateTimeOffset(2033, 6, 14, 15, 0, 0, TimeSpan.Zero));
        stored.ScenarioTime.Should().Be(new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5)));
        stored.TimeZone.Should().Be("America/Chicago");
        stored.Target.Should().NotBeNull();
        stored.Target!.EntityType.Should().Be("post");
        stored.Target.EntityId.Should().Be("post-99");
        stored.Payload.Should().NotBeNull();
        stored.Payload.Should().Contain("hello");
        stored.EmittedAt.Should().Be(new DateTimeOffset(2033, 6, 14, 15, 0, 1, TimeSpan.Zero));
    }

    [RequiresDockerFact]
    public async Task MissingExerciseId_Returns400_AndPersistsNothing()
    {
        var eventId = Guid.NewGuid().ToString();
        var exerciseId = Guid.NewGuid();
        var envelope = ValidEnvelope(eventId, exerciseId.ToString());
        envelope.Remove("exerciseId");

        await using var factory = CreateFactory(exerciseId);
        using var client = factory.CreateClient();

        var response = await client.PostAsync(TelemetryUri, JsonContent(envelope));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        await AssertNotPersisted(eventId);
    }

    [RequiresDockerFact]
    public async Task WrongSchemaVersion_Returns400_AndPersistsNothing()
    {
        var eventId = Guid.NewGuid().ToString();
        var exerciseId = Guid.NewGuid();
        var envelope = ValidEnvelope(eventId, exerciseId.ToString());
        envelope["schemaVersion"] = "v1";

        await using var factory = CreateFactory(exerciseId);
        using var client = factory.CreateClient();

        var response = await client.PostAsync(TelemetryUri, JsonContent(envelope));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        await AssertNotPersisted(eventId);
    }

    [RequiresDockerFact]
    public async Task UnknownTopLevelKey_Returns400_AndPersistsNothing()
    {
        var eventId = Guid.NewGuid().ToString();
        var exerciseId = Guid.NewGuid();
        var envelope = ValidEnvelope(eventId, exerciseId.ToString());
        envelope["unexpected"] = "nope";

        await using var factory = CreateFactory(exerciseId);
        using var client = factory.CreateClient();

        var response = await client.PostAsync(TelemetryUri, JsonContent(envelope));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        await AssertNotPersisted(eventId);
    }

    [RequiresDockerFact]
    public async Task ParticipantActorWithoutParticipantId_IsCompletedServerSide_NotRejected()
    {
        // BEHAVIOUR CHANGE, identity-auth-roles/13 (#362). This case used to be a 400: actor.kind 'participant'
        // with no participantId violates the v0 conditional rule (superRefine), and the endpoint enforced it. Now
        // the server STAMPS the participant's own account id from the presented session before validating, so the
        // rule is satisfied rather than violated — the envelope that reaches the database is complete and
        // correctly attributed, which is strictly better than rejecting a caller for omitting a field the server
        // is the authority on anyway. The rule itself is still enforced where the server cannot complete it — see
        // ConditionalRuleViolation_InjectWithoutInjectId_Returns400_AndPersistsNothing.
        var eventId = Guid.NewGuid().ToString();
        var exerciseId = Guid.NewGuid();
        var envelope = ValidEnvelope(eventId, exerciseId.ToString());
        envelope["actor"] = new Dictionary<string, object?> { ["kind"] = "participant", ["sessionId"] = "session-1" };

        await using var factory = CreateFactory(exerciseId);
        using var client = factory.CreateClient();

        var response = await client.PostAsync(TelemetryUri, JsonContent(envelope));

        response.StatusCode.Should().Be(HttpStatusCode.Accepted);

        await using var readContext = _fixture.CreateContext();
        var stored = await readContext.TelemetryEvents.IgnoreQueryFilters().SingleAsync(e => e.EventId == eventId);

        stored.Actor.ParticipantId.Should().Be(
            TelemetryWebApplicationFactory.PrincipalId, "the participant id is the session's, not the body's");
        stored.Actor.SessionId.Should().Be(
            TelemetryWebApplicationFactory.SessionId.ToString(), "and the body's 'session-1' claim is overwritten");
    }

    [RequiresDockerFact]
    public async Task ConditionalRuleViolation_InjectWithoutInjectId_Returns400_AndPersistsNothing()
    {
        // The v0 conditional-requiredness rules are still enforced server-side (defense in depth, #356) for every
        // field the server is NOT the authority on: injectId is the MSEL inject's own identity, which no session
        // can supply, so an origin of 'inject' without one stays a 400.
        var eventId = Guid.NewGuid().ToString();
        var exerciseId = Guid.NewGuid();
        var envelope = ValidEnvelope(eventId, exerciseId.ToString());
        envelope["origin"] = "inject";

        await using var factory = CreateFactory(exerciseId);
        using var client = factory.CreateClient();

        var response = await client.PostAsync(TelemetryUri, JsonContent(envelope));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        await AssertNotPersisted(eventId);
    }

    [RequiresDockerFact]
    public async Task DuplicateEventId_IsDeduped_NoDuplicateRow_NoError()
    {
        var eventId = Guid.NewGuid().ToString();
        var exerciseId = Guid.NewGuid();

        await using var factory = CreateFactory(exerciseId);
        using var client = factory.CreateClient();

        var first = await client.PostAsync(TelemetryUri, JsonContent(ValidEnvelope(eventId, exerciseId.ToString())));
        var second = await client.PostAsync(TelemetryUri, JsonContent(ValidEnvelope(eventId, exerciseId.ToString())));

        first.StatusCode.Should().Be(HttpStatusCode.Accepted);
        second.StatusCode.Should().Be(HttpStatusCode.Accepted, "a retry of a swallowed-failure POST must not surface an error");

        await using var readContext = _fixture.CreateContext();
        var count = await readContext.TelemetryEvents.IgnoreQueryFilters().CountAsync(e => e.EventId == eventId);
        count.Should().Be(1, "the same eventId must never create a duplicate row");
    }

    [RequiresDockerFact]
    public async Task OversizedBody_Returns400_AndPersistsNothing()
    {
        var eventId = Guid.NewGuid().ToString();
        var exerciseId = Guid.NewGuid();
        var envelope = ValidEnvelope(eventId, exerciseId.ToString());
        // Inflate the (opaque) payload past the 64 KiB body cap (NFR-004).
        envelope["payload"] = new Dictionary<string, object?> { ["blob"] = new string('x', 70 * 1024) };

        await using var factory = CreateFactory(exerciseId);
        using var client = factory.CreateClient();

        var response = await client.PostAsync(TelemetryUri, JsonContent(envelope));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        await AssertNotPersisted(eventId);
    }

    // ==========================================================================================
    // identity-auth-roles/13 (#362) — scope and actor identity are the SESSION's, over HTTP, end to end.
    // ==========================================================================================

    [RequiresDockerFact]
    public async Task EnvelopeNamingAnotherExercise_Returns400_AndPersistsNothing()
    {
        // ENDPOINT-AUTH-AUDIT.md finding 2, the cross-exercise half: the caller's session is bound to one
        // exercise and its envelope names a different one. Rejected, never silently rewritten (the story's settled
        // decision) — a silent correction would hide a misconfigured client.
        var eventId = Guid.NewGuid().ToString();
        var sessionExercise = Guid.NewGuid();
        var envelope = ValidEnvelope(eventId, Guid.NewGuid().ToString());

        await using var factory = CreateFactory(sessionExercise);
        using var client = factory.CreateClient();

        var response = await client.PostAsync(TelemetryUri, JsonContent(envelope));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        await AssertNotPersisted(eventId);
    }

    [RequiresDockerFact]
    public async Task EnvelopeNamingANonexistentExercise_Returns400_AndPersistsNothing()
    {
        // The audit's literal payload. There is no FK on TelemetryEvent.ExerciseId — no IExerciseScoped entity in
        // this model has one — so before this story the orphan row was storable, not merely rejected-but-logged.
        var eventId = Guid.NewGuid().ToString();
        var envelope = ValidEnvelope(eventId, "deadbeef-0000-4000-8000-000000000001");

        await using var factory = CreateFactory(Guid.NewGuid());
        using var client = factory.CreateClient();

        var response = await client.PostAsync(TelemetryUri, JsonContent(envelope));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        await AssertNotPersisted(eventId);
    }

    [RequiresDockerFact]
    public async Task ForgedActingHumanId_IsReplacedByTheSessionsOwn_NotBelieved()
    {
        // The other half of the audit's exploit: a fabricated actingHumanId. COR-018 attribution is what AAR and
        // evaluator scoring read to attribute an action to an individual human behind a shared org handle, so a
        // believed claim here is fabricated evaluation data.
        var eventId = Guid.NewGuid().ToString();
        var exerciseId = Guid.NewGuid();
        var envelope = ValidEnvelope(eventId, exerciseId.ToString());
        envelope["actor"] = new Dictionary<string, object?>
        {
            ["kind"] = "participant",
            ["participantId"] = "account-of-another-trainee",
            ["actingHumanId"] = "human-somebody-else-entirely",
        };

        await using var factory = CreateFactory(exerciseId);
        using var client = factory.CreateClient();

        var response = await client.PostAsync(TelemetryUri, JsonContent(envelope));

        response.StatusCode.Should().Be(HttpStatusCode.Accepted);

        await using var readContext = _fixture.CreateContext();
        var stored = await readContext.TelemetryEvents.IgnoreQueryFilters().SingleAsync(e => e.EventId == eventId);

        stored.ExerciseId.Should().Be(exerciseId);
        stored.Actor.ActingHumanId.Should().Be(TelemetryWebApplicationFactory.ActingHumanId);
        stored.Actor.ParticipantId.Should().Be(TelemetryWebApplicationFactory.PrincipalId);
    }

    [RequiresDockerFact]
    public async Task ForgedParticipantActorKind_FromAStaffSession_Returns403_AndPersistsNothing()
    {
        // A staff console claiming to be a trainee acting as themselves. Refused rather than corrected: there is
        // no participant to substitute, and an operator's event that reads as a trainee's IS the COR-018 harm.
        var eventId = Guid.NewGuid().ToString();
        var exerciseId = Guid.NewGuid();
        var envelope = ValidEnvelope(eventId, exerciseId.ToString());

        await using var factory = CreateFactory(exerciseId, kind: "staff");
        using var client = factory.CreateClient();

        var response = await client.PostAsync(TelemetryUri, JsonContent(envelope));

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        await AssertNotPersisted(eventId);
    }

    [RequiresDockerFact]
    public async Task PersonaActorNamingAnotherPersona_FromAParticipantSession_Returns403_AndPersistsNothing()
    {
        var eventId = Guid.NewGuid().ToString();
        var exerciseId = Guid.NewGuid();
        var envelope = ValidEnvelope(eventId, exerciseId.ToString());
        envelope["actor"] = new Dictionary<string, object?>
        {
            ["kind"] = "persona",
            ["personaId"] = Guid.NewGuid().ToString(),
        };

        await using var factory = CreateFactory(exerciseId, personaId: Guid.NewGuid());
        using var client = factory.CreateClient();

        var response = await client.PostAsync(TelemetryUri, JsonContent(envelope));

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        await AssertNotPersisted(eventId);
    }

    [RequiresDockerFact]
    public async Task PersonaActorNamingItsOwnBoundPersona_IsAccepted()
    {
        // The real participant-reaction shape (useReaction.ts): kind 'persona' + the session's own bound persona.
        var eventId = Guid.NewGuid().ToString();
        var exerciseId = Guid.NewGuid();
        var personaId = Guid.NewGuid();
        var envelope = ValidEnvelope(eventId, exerciseId.ToString());
        envelope["actor"] = new Dictionary<string, object?>
        {
            ["kind"] = "persona",
            ["personaId"] = personaId.ToString(),
        };

        await using var factory = CreateFactory(exerciseId, personaId: personaId);
        using var client = factory.CreateClient();

        var response = await client.PostAsync(TelemetryUri, JsonContent(envelope));

        response.StatusCode.Should().Be(HttpStatusCode.Accepted);

        await using var readContext = _fixture.CreateContext();
        var stored = await readContext.TelemetryEvents.IgnoreQueryFilters().SingleAsync(e => e.EventId == eventId);

        stored.Actor.PersonaId.Should().Be(personaId.ToString());
        stored.Actor.ActingHumanId.Should().Be(TelemetryWebApplicationFactory.ActingHumanId);
    }

    /// <param name="sessionExercise">The exercise the presented session is bound to — the ONLY scope this host will stamp.</param>
    /// <param name="kind">The presented session's kind.</param>
    /// <param name="personaId">The presented session's persona binding, or <c>null</c> for none.</param>
    private TelemetryWebApplicationFactory CreateFactory(
        Guid sessionExercise,
        string kind = "participant",
        Guid? personaId = null)
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");
        return new TelemetryWebApplicationFactory(_fixture.ConnectionString!, sessionExercise, kind, personaId);
    }

    private async Task AssertNotPersisted(string eventId)
    {
        await using var readContext = _fixture.CreateContext();
        var count = await readContext.TelemetryEvents.IgnoreQueryFilters().CountAsync(e => e.EventId == eventId);
        count.Should().Be(0, "a rejected envelope must never reach the database");
    }

    private static StringContent JsonContent(object body)
        => new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    private static Dictionary<string, object?> ValidEnvelope(string eventId, string exerciseId) => new()
    {
        ["schemaVersion"] = "v0",
        ["eventId"] = eventId,
        ["exerciseId"] = exerciseId,
        ["eventType"] = "post",
        ["channel"] = "social",
        ["actor"] = new Dictionary<string, object?>
        {
            ["kind"] = "participant",
            ["participantId"] = "participant-42",
            ["sessionId"] = "session-abc",
            ["role"] = "evaluator",
        },
        ["origin"] = "participant",
        ["correlationId"] = "corr-1",
        ["causationId"] = "cause-1",
        ["sequence"] = 7,
        ["source"] = "social-feed",
        ["wallClockTime"] = "2033-06-14T15:00:00+00:00",
        ["scenarioTime"] = "2033-06-14T09:00:00-05:00",
        ["timeZone"] = "America/Chicago",
        ["target"] = new Dictionary<string, object?> { ["entityType"] = "post", ["entityId"] = "post-99" },
        ["payload"] = new Dictionary<string, object?> { ["text"] = "hello" },
        ["emittedAt"] = "2033-06-14T15:00:01+00:00",
    };
}

/// <summary>
/// Boots the real <c>Program</c> host with <c>ConnectionStrings__DefaultConnection</c> set (in the
/// constructor, before the host's config is captured) to the shared Testcontainers database, so the
/// endpoint's injected <see cref="Data.PulseDbContext"/> writes to the same migrated schema the tests read
/// back through. Clears the env var on dispose so it never leaks into another test class's host.
/// </summary>
/// <remarks>
/// <b>The presented session is now load-bearing (identity-auth-roles/11 + /13).</b> Story 11 made
/// <c>POST /api/telemetry</c> inherit the default-deny fallback policy, so a session must be presented at all;
/// story 13 made its identity the SOURCE of the persisted scope and actor attribution, so the session's exercise
/// is what every assertion about a stored <c>ExerciseId</c> compares against — and the constants below are what
/// the stamped actor fields must equal. They are fixed rather than random precisely so a test asserting
/// attribution cannot pass by comparing a value to itself.
/// </remarks>
public sealed class TelemetryWebApplicationFactory : WebApplicationFactory<Program>
{
    /// <summary>The presented session's id — the value <c>actor.sessionId</c> is stamped with (COR-015).</summary>
    internal static readonly Guid SessionId = Guid.Parse("5e551011-0000-4000-8000-00000000005e");

    /// <summary>The presented session's <c>PrincipalId</c> — the value <c>actor.participantId</c> is stamped with.</summary>
    internal const string PrincipalId = "telemetry-host-principal";

    /// <summary>The presented session's acting human — the value <c>actor.actingHumanId</c> is stamped with (COR-018).</summary>
    internal const string ActingHumanId = "telemetry-host-human";

    private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

    private readonly Guid _sessionExercise;
    private readonly string _kind;
    private readonly Guid? _personaId;

    /// <param name="connectionString">The shared Testcontainers/LocalDB connection string.</param>
    /// <param name="sessionExercise">The exercise the presented session is bound to.</param>
    /// <param name="kind">The presented session's kind — <c>participant</c> / <c>staff</c> / <c>readonly</c>.</param>
    /// <param name="personaId">The presented session's persona binding, or <c>null</c> for none.</param>
    public TelemetryWebApplicationFactory(
        string connectionString,
        Guid sessionExercise,
        string kind = "participant",
        Guid? personaId = null)
    {
        _sessionExercise = sessionExercise;
        _kind = kind;
        _personaId = personaId;
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.UseFakeAuthenticatedSession(
            _sessionExercise,
            _kind,
            sessionId: SessionId,
            principalId: PrincipalId,
            actingHumanId: ActingHumanId,
            personaId: _personaId);
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
    }
}
