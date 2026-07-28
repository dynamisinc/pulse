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
/// Integration tests for <c>POST /api/telemetry</c> (story <c>telemetry/02</c>, #274). Boots the real host
/// via <see cref="WebApplicationFactory{TEntryPoint}"/> (reusing <c>backend-host/01</c>'s test-host pattern)
/// pointed at the shared, migrated Testcontainers SQL Server (<see cref="MsSqlContainerFixture"/>), then
/// drives the endpoint over HTTP and asserts DB state through a SEPARATE <see cref="Data.PulseDbContext"/>
/// so nothing is proven by an in-memory change tracker alone. Covers: fully-populated round-trip, 400 on
/// schema-invalid / oversized bodies (with non-persistence), and <c>eventId</c> dedup idempotency.
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

        await using var factory = CreateFactory();
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
        stored.Actor.ParticipantId.Should().Be("participant-42");
        stored.Actor.PersonaId.Should().BeNull();
        stored.Actor.ActingHumanId.Should().BeNull();
        stored.Actor.SessionId.Should().Be("session-abc");
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
        var envelope = ValidEnvelope(eventId, Guid.NewGuid().ToString());
        envelope.Remove("exerciseId");

        await using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsync(TelemetryUri, JsonContent(envelope));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        await AssertNotPersisted(eventId);
    }

    [RequiresDockerFact]
    public async Task WrongSchemaVersion_Returns400_AndPersistsNothing()
    {
        var eventId = Guid.NewGuid().ToString();
        var envelope = ValidEnvelope(eventId, Guid.NewGuid().ToString());
        envelope["schemaVersion"] = "v1";

        await using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsync(TelemetryUri, JsonContent(envelope));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        await AssertNotPersisted(eventId);
    }

    [RequiresDockerFact]
    public async Task UnknownTopLevelKey_Returns400_AndPersistsNothing()
    {
        var eventId = Guid.NewGuid().ToString();
        var envelope = ValidEnvelope(eventId, Guid.NewGuid().ToString());
        envelope["unexpected"] = "nope";

        await using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsync(TelemetryUri, JsonContent(envelope));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        await AssertNotPersisted(eventId);
    }

    [RequiresDockerFact]
    public async Task ConditionalRuleViolation_ParticipantWithoutParticipantId_Returns400_AndPersistsNothing()
    {
        var eventId = Guid.NewGuid().ToString();
        var envelope = ValidEnvelope(eventId, Guid.NewGuid().ToString());
        // actor.kind participant but no participantId — superRefine violation the server must catch itself.
        envelope["actor"] = new Dictionary<string, object?> { ["kind"] = "participant", ["sessionId"] = "session-1" };

        await using var factory = CreateFactory();
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

        await using var factory = CreateFactory();
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
        var envelope = ValidEnvelope(eventId, Guid.NewGuid().ToString());
        // Inflate the (opaque) payload past the 64 KiB body cap (NFR-004).
        envelope["payload"] = new Dictionary<string, object?> { ["blob"] = new string('x', 70 * 1024) };

        await using var factory = CreateFactory();
        using var client = factory.CreateClient();

        var response = await client.PostAsync(TelemetryUri, JsonContent(envelope));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        await AssertNotPersisted(eventId);
    }

    private TelemetryWebApplicationFactory CreateFactory()
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");
        return new TelemetryWebApplicationFactory(_fixture.ConnectionString!);
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
public sealed class TelemetryWebApplicationFactory : WebApplicationFactory<Program>
{
    private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

    public TelemetryWebApplicationFactory(string connectionString)
    {
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        // identity-auth-roles/11: POST /api/telemetry is an MVC controller and now inherits the default-deny
        // fallback policy — an unauthenticated caller could previously store an event against ANY exercise id
        // it named, including one that does not exist (#362). These tests are about envelope validation, dedup
        // and persistence, so they present a live session. The session's exercise is deliberately unrelated to
        // the body's `exerciseId` here: story 13 (#362) is what makes the server stamp the scope from the
        // session and reject a disagreeing body value, and it will tighten these tests accordingly.
        builder.UseFakeAuthenticatedSession(Guid.NewGuid());
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
    }
}
