namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// Integration tests for <c>POST /api/posts</c> (story <c>social-api/02-post-write-api</c>, #271).
/// Boots the real host via <see cref="WebApplicationFactory{TEntryPoint}"/> against the shared,
/// migrated Testcontainers SQL Server (<see cref="MsSqlContainerFixture"/>), reusing
/// <c>Telemetry/TelemetryIngestTests</c>'s HTTP-drive pattern (env-var-fed connection string; a
/// separate <see cref="PulseDbContext"/> for DB assertions so nothing is proven by an in-memory change
/// tracker alone).
/// </summary>
/// <remarks>
/// <para>
/// <b>Program.cs owns the endpoint wiring.</b> The orchestrator's composition-root edit has landed:
/// <c>Program.cs</c> calls <c>AddSocialPostWrite()</c> and maps <c>MapSocialPostEndpoints()</c> itself, so
/// the booted <c>WebApplicationFactory&lt;Program&gt;</c> host already serves <c>POST /api/posts</c> over
/// real HTTP against the real database, exercising the exact production endpoint/service/sanitizer code.
/// <see cref="PostWriteWebApplicationFactory"/> therefore no longer self-maps the endpoint (doing so would
/// DOUBLE-MAP the route and raise an <c>AmbiguousMatchException</c> at request time); it only overrides the
/// request's exercise scope and swaps in a <see cref="FakeFeedBroadcaster"/> so tests can assert the 03
/// real-time seam without a live hub.
/// </para>
/// <para>
/// Every test is <see cref="RequiresDockerFactAttribute"/> (Gate-1 W-001): a real <c>Skipped</c> on a
/// Docker-less machine, never a silent <c>Passed</c>.
/// </para>
/// </remarks>
[Collection(MsSqlCollection.Name)]
public class PostWriteEndpointTests
{
    private static readonly Uri PostsUri = new("/api/posts", UriKind.Relative);

    private readonly MsSqlContainerFixture _fixture;

    public PostWriteEndpointTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task HappyPath_ParticipantOrigin_Returns201_AndStampsServerScope_EvenWithDifferentBodyExerciseId()
    {
        var exerciseA = Guid.NewGuid();
        var foreignExerciseId = Guid.NewGuid();
        var authorPersonaId = Guid.NewGuid();

        await using var factory = CreateFactory(exerciseA);
        using var client = factory.CreateClient();

        var before = DateTimeOffset.UtcNow;

        var body = ValidRequestBody(authorPersonaId, "participant", text: "Hello exercise");
        // A manipulated/naive client attempts to inject its own exerciseId and a stale createdWallClock.
        // CreatePostRequest binds neither field, so both are structurally ignored — the server's
        // resolved scope and its own clock reading win unconditionally.
        body["exerciseId"] = foreignExerciseId.ToString();
        body["createdWallClock"] = "2000-01-01T00:00:00Z";

        var response = await client.PostAsync(PostsUri, JsonContent(body));
        var after = DateTimeOffset.UtcNow;

        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var postId = await ReadPostIdAsync(response);

        await using var readContext = _fixture.CreateContext();
        var stored = await readContext.Posts.IgnoreQueryFilters().SingleAsync(p => p.Id == postId);

        stored.ExerciseId.Should().Be(exerciseA, "the server's resolved scope must win, never a client-supplied exerciseId");
        stored.ExerciseId.Should().NotBe(foreignExerciseId);
        stored.Body.Should().Be("Hello exercise");
        stored.CreatedWallClock.Should().BeOnOrAfter(before.AddSeconds(-1))
            .And.BeOnOrBefore(after.AddSeconds(1), "createdWallClock must be the server's own clock, never client input");
        stored.Origin.Should().Be("participant");
    }

    [RequiresDockerFact]
    public async Task ContentSecurity_ScriptAndImgOnErrorPayload_IsSanitizedOnIngest_StoredBodyHasNoExecutableMarkup()
    {
        // NFR-004 stored-XSS, end to end: post a classic payload, then read the PERSISTED row back
        // through a separate PulseDbContext (not the response) — the standing stored-XSS suite
        // (exercise-isolation/07, COR-007/NFR-004) this AC is added to.
        var exerciseA = Guid.NewGuid();
        var authorPersonaId = Guid.NewGuid();

        await using var factory = CreateFactory(exerciseA);
        using var client = factory.CreateClient();

        const string payload = "<script>alert(document.cookie)</script>Shelter in place <img src=x onerror=alert(2)> now.";
        var body = ValidRequestBody(authorPersonaId, "participant", text: payload);

        var response = await client.PostAsync(PostsUri, JsonContent(body));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var postId = await ReadPostIdAsync(response);

        await using var readContext = _fixture.CreateContext();
        var stored = await readContext.Posts.IgnoreQueryFilters().SingleAsync(p => p.Id == postId);

        stored.Body.Should().NotContain("<script", "a stored script must never be able to execute in another session");
        stored.Body.Should().NotContain("onerror");
        stored.Body.Should().NotContain("<img");
        stored.Body.Should().NotContain("<").And.NotContain(">");
        stored.Body.Should().Contain("Shelter in place").And.Contain("now.", "the author's literal text survives sanitization");
    }

    [RequiresDockerFact]
    public async Task SuccessfulIngest_EmitsExactlyOneTelemetryEvent_MatchingV0Envelope()
    {
        var exerciseA = Guid.NewGuid();
        var authorPersonaId = Guid.NewGuid();
        const string actingHumanId = "controller-42";

        await using var factory = CreateFactory(exerciseA);
        using var client = factory.CreateClient();

        var body = ValidRequestBody(authorPersonaId, "controller-as-persona", actingHumanId: actingHumanId);

        var response = await client.PostAsync(PostsUri, JsonContent(body));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var postId = await ReadPostIdAsync(response);

        await using var readContext = _fixture.CreateContext();
        var events = await readContext.TelemetryEvents.IgnoreQueryFilters()
            .Where(e => e.Target != null && e.Target.EntityId == postId.ToString())
            .ToListAsync();

        events.Should().ContainSingle("exactly one 'post' telemetry event must be emitted per successful post, never zero or double-counted");

        var telemetryEvent = events[0];
        telemetryEvent.ExerciseId.Should().Be(exerciseA);
        telemetryEvent.EventType.Should().Be("post");
        telemetryEvent.Channel.Should().Be("social");
        telemetryEvent.Actor.Kind.Should().Be("persona");
        telemetryEvent.Actor.PersonaId.Should().Be(authorPersonaId.ToString());
        telemetryEvent.Actor.ActingHumanId.Should().Be(actingHumanId);
        telemetryEvent.Origin.Should().Be("controller-as-persona");
        telemetryEvent.Target.Should().NotBeNull();
        telemetryEvent.Target!.EntityType.Should().Be("post");
        telemetryEvent.Target.EntityId.Should().Be(postId.ToString());
    }

    [RequiresDockerFact]
    public async Task TelemetryActor_ActingHumanId_IsNullForParticipant_AndNonNullForControllerAsPersona()
    {
        // The locked v0 envelope types actor.actingHumanId as z.string().min(1).optional(): an empty
        // string is OFF-ENVELOPE. A participant post that omits actingHumanId must null-omit it on the
        // telemetry actor (never persist ""); a controller-as-persona post must keep it non-null (COR-018).
        var exerciseA = Guid.NewGuid();
        var participantPersonaId = Guid.NewGuid();
        var controllerPersonaId = Guid.NewGuid();
        const string actingHumanId = "controller-77";

        await using var factory = CreateFactory(exerciseA);
        using var client = factory.CreateClient();

        // Participant post: actingHumanId omitted from the request body entirely.
        var participantBody = ValidRequestBody(participantPersonaId, "participant", actingHumanId: null);
        var participantResponse = await client.PostAsync(PostsUri, JsonContent(participantBody));
        participantResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var participantPostId = await ReadPostIdAsync(participantResponse);

        // Controller-as-persona post: actingHumanId supplied (required by COR-018).
        var controllerBody = ValidRequestBody(controllerPersonaId, "controller-as-persona", actingHumanId: actingHumanId);
        var controllerResponse = await client.PostAsync(PostsUri, JsonContent(controllerBody));
        controllerResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var controllerPostId = await ReadPostIdAsync(controllerResponse);

        await using var readContext = _fixture.CreateContext();

        var participantEvent = await readContext.TelemetryEvents.IgnoreQueryFilters()
            .SingleAsync(e => e.Target != null && e.Target.EntityId == participantPostId.ToString());
        participantEvent.Actor.ActingHumanId.Should().BeNull(
            "a participant post that omits actingHumanId must null-omit it on the telemetry actor — "
            + "an empty string is off the locked v0 envelope (z.string().min(1).optional())");

        var controllerEvent = await readContext.TelemetryEvents.IgnoreQueryFilters()
            .SingleAsync(e => e.Target != null && e.Target.EntityId == controllerPostId.ToString());
        controllerEvent.Actor.ActingHumanId.Should().Be(actingHumanId,
            "a controller-as-persona post must keep actingHumanId non-null on the telemetry actor (COR-018)");
    }

    [RequiresDockerFact]
    public async Task ControllerAsPersona_ActingHumanIdIsStored_AndStaffResponseIncludesOriginAndActingHumanId()
    {
        var exerciseA = Guid.NewGuid();
        var authorPersonaId = Guid.NewGuid();
        const string actingHumanId = "controller-operating-shared-account";

        await using var factory = CreateFactory(exerciseA);
        using var client = factory.CreateClient();

        var body = ValidRequestBody(authorPersonaId, "controller-as-persona", actingHumanId: actingHumanId);

        var response = await client.PostAsync(PostsUri, JsonContent(body));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var json = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(json);

        // Role-conditional exception to XC-002 (this feature's one deliberate carve-out): the
        // controller console's originConsoleLabel(lastPublished) reads these off its OWN write.
        document.RootElement.TryGetProperty("origin", out var originProp).Should().BeTrue(
            "a staff/controller caller's own write response must carry origin (PersonaComposer.tsx:150-157)");
        originProp.GetString().Should().Be("controller-as-persona");

        document.RootElement.TryGetProperty("actingHumanId", out var actingHumanIdProp).Should().BeTrue();
        actingHumanIdProp.GetString().Should().Be(actingHumanId);

        var postId = await ReadPostIdAsync(response);

        await using var readContext = _fixture.CreateContext();
        var stored = await readContext.Posts.IgnoreQueryFilters().SingleAsync(p => p.Id == postId);
        stored.ActingHumanId.Should().Be(actingHumanId, "COR-018: the operating controller behind the shared persona must be attributed");
    }

    [RequiresDockerFact]
    public async Task ControllerAsPersona_WithoutActingHumanId_Returns400_AndPersistsNothing()
    {
        var exerciseA = Guid.NewGuid();
        var authorPersonaId = Guid.NewGuid();

        await using var factory = CreateFactory(exerciseA);
        using var client = factory.CreateClient();

        var body = ValidRequestBody(authorPersonaId, "controller-as-persona", actingHumanId: null);

        var response = await client.PostAsync(PostsUri, JsonContent(body));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "COR-018 requires actingHumanId when origin is controller-as-persona");
        factory.Broadcaster.Calls.Should().BeEmpty("a rejected request must never reach the broadcast fan-out");
    }

    [RequiresDockerFact]
    public async Task Participant_ResponseCarriesNoProvenanceKeys_AtTheWireLevel()
    {
        var exerciseA = Guid.NewGuid();
        var authorPersonaId = Guid.NewGuid();

        await using var factory = CreateFactory(exerciseA);
        using var client = factory.CreateClient();

        var body = ValidRequestBody(authorPersonaId, "participant");

        var response = await client.PostAsync(PostsUri, JsonContent(body));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        // XC-002 at the WIRE level: parse the raw JSON and assert the provenance keys are ABSENT —
        // not merely unread by a strongly-typed client — identical to 01's read-path guarantee.
        var json = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(json);

        document.RootElement.TryGetProperty("origin", out _).Should().BeFalse("a participant response must never carry origin");
        document.RootElement.TryGetProperty("actingHumanId", out _).Should().BeFalse("a participant response must never carry actingHumanId");
        document.RootElement.TryGetProperty("createdWallClock", out _).Should().BeFalse("a participant response must never carry createdWallClock");
        document.RootElement.TryGetProperty("injectId", out _).Should().BeFalse("a participant response must never carry injectId");
    }

    [RequiresDockerFact]
    public async Task Broadcaster_IsInvokedExactlyOnce_WithTheParticipantSafePayload()
    {
        var exerciseA = Guid.NewGuid();
        var authorPersonaId = Guid.NewGuid();

        await using var factory = CreateFactory(exerciseA);
        using var client = factory.CreateClient();

        var body = ValidRequestBody(authorPersonaId, "controller-as-persona", actingHumanId: "controller-1", text: "Broadcast me");

        var response = await client.PostAsync(PostsUri, JsonContent(body));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var postId = await ReadPostIdAsync(response);

        factory.Broadcaster.Calls.Should().ContainSingle("the real-time fan-out must be called exactly once per persisted post");
        var call = factory.Broadcaster.Calls[0];
        call.ExerciseId.Should().Be(exerciseA);
        call.Post.Id.Should().Be(postId.ToString());
        call.Post.AuthorPersonaId.Should().Be(authorPersonaId.ToString());
        call.Post.Text.Should().Be("Broadcast me");

        // ParticipantPostDto is the frozen participant-safe shape — it structurally has no origin/
        // actingHumanId/createdWallClock/injectId property, so the broadcast payload cannot carry
        // provenance even for a controller-as-persona-origin post (XC-002 is unconditional on this seam).
        var broadcastJson = JsonSerializer.Serialize(call.Post);
        using var document = JsonDocument.Parse(broadcastJson);
        document.RootElement.TryGetProperty("origin", out _).Should().BeFalse();
        document.RootElement.TryGetProperty("actingHumanId", out _).Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task UnresolvedExerciseScope_FailsClosed_Returns401_AndNeverPersistsOrBroadcasts()
    {
        var authorPersonaId = Guid.NewGuid();

        // No exercise resolved for this request — the fail-closed door (COR-001 hygiene).
        await using var factory = CreateFactory(currentExerciseId: null);
        using var client = factory.CreateClient();

        var body = ValidRequestBody(authorPersonaId, "participant");

        var response = await client.PostAsync(PostsUri, JsonContent(body));

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        factory.Broadcaster.Calls.Should().BeEmpty();
    }

    private PostWriteWebApplicationFactory CreateFactory(Guid exerciseId) => CreateFactory((Guid?)exerciseId);

    private PostWriteWebApplicationFactory CreateFactory(Guid? currentExerciseId)
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");
        return new PostWriteWebApplicationFactory(_fixture.ConnectionString!, currentExerciseId);
    }

    private static async Task<Guid> ReadPostIdAsync(HttpResponseMessage response)
    {
        var json = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(json);
        return Guid.Parse(document.RootElement.GetProperty("id").GetString()!);
    }

    private static StringContent JsonContent(object body)
        => new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    private static Dictionary<string, object?> ValidRequestBody(
        Guid authorPersonaId,
        string origin,
        string? actingHumanId = null,
        string? injectId = null,
        string text = "Hello exercise") => new()
    {
        ["authorPersonaId"] = authorPersonaId.ToString(),
        ["actingHumanId"] = actingHumanId,
        ["text"] = text,
        ["scenarioTime"] = "2033-06-14T09:00:00-05:00",
        ["timeZone"] = "America/Chicago",
        ["origin"] = origin,
        ["injectId"] = injectId,
    };
}

/// <summary>
/// Captures every <see cref="IFeedBroadcaster.BroadcastPostAsync"/> call so tests can assert the
/// real-time fan-out seam (03's contract) is invoked exactly once, with a participant-safe payload,
/// without a real SignalR host (03 owns that implementation; this story only calls the interface).
/// </summary>
public sealed class FakeFeedBroadcaster : IFeedBroadcaster
{
    public List<(Guid ExerciseId, ParticipantPostDto Post)> Calls { get; } = new();

    public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default)
    {
        Calls.Add((exerciseId, post));
        return Task.CompletedTask;
    }
}

/// <summary>
/// Boots the real <c>Program</c> host against the shared Testcontainers database (env-var-fed
/// connection string, exactly as <c>TelemetryWebApplicationFactory</c> does). <c>Program.cs</c> now owns
/// the post-write composition root (it calls <c>AddSocialPostWrite()</c> and maps
/// <c>MapSocialPostEndpoints()</c> itself), so this factory no longer wires the endpoint. It only
/// overrides <see cref="IExerciseContext"/> to a fixed exercise scope (or an unset one, for the
/// fail-closed test) and swaps in a <see cref="FakeFeedBroadcaster"/> so tests can assert the 03
/// real-time seam without a real hub. Both overrides run in <c>ConfigureTestServices</c>, which executes
/// last and reliably wins over <c>Program.cs</c>'s real <c>SignalRFeedBroadcaster</c> registration.
/// </summary>
public sealed class PostWriteWebApplicationFactory : WebApplicationFactory<Program>
{
    private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

    private readonly Guid? _currentExerciseId;

    public FakeFeedBroadcaster Broadcaster { get; } = new();

    public PostWriteWebApplicationFactory(string connectionString, Guid? currentExerciseId)
    {
        _currentExerciseId = currentExerciseId;
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // ConfigureTestServices runs after Program.cs's own registrations, so these RemoveAll+Add
        // overrides reliably win — in particular the FakeFeedBroadcaster replaces Program's real
        // SignalRFeedBroadcaster so tests can assert the broadcast fan-out without a live SignalR hub.
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IExerciseContext>();
            services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = _currentExerciseId });

            services.RemoveAll<IFeedBroadcaster>();
            services.AddSingleton<IFeedBroadcaster>(Broadcaster);
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
    }
}
