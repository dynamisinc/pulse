namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration;

using System;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Helpers;
using Xunit;

/// <summary>
/// <b>The pipeline-ORDER guard for <c>app.UseExerciseLifecycleGating()</c> (exercise-configuration story 03)
/// — the one wave-3 mis-wire nothing else in the suite can see.</b> It drives a real HTTP request, over the
/// real <c>Program</c> pipeline, against real SQL, and asserts that an <c>archived</c> exercise's
/// <c>/api/feed</c> is refused with <c>403</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why the ordinary tests are blind to this.</b> The gate reads the request's RESOLVED exercise scope, which
/// <c>UseExerciseResolution()</c> (host → exercise) and then <c>UseSessionAuthentication()</c> (session scope,
/// higher precedence) write earlier in the pipeline. Wire <c>UseExerciseLifecycleGating()</c> above either of
/// them and it sees an UNSET scope on every request, finds no lifecycle to check, and passes everything
/// through — a silent, total no-op. Nothing raises; the middleware is registered, the routes are mapped, DI
/// resolves, every unit test of the state machine and every slice-composed integration test still passes,
/// because those hosts (e.g. <c>ExerciseLifecycleTestHost</c>) FIX the scope with a stubbed
/// <c>IExerciseContext</c> before the pipeline runs and therefore cannot express an ordering at all. The only
/// observable difference is the status code a participant gets from a closed world, which is what this asserts.
/// </para>
/// <para>
/// <b>The three outcomes are distinguishable, which is what makes the assertion bite:</b> correctly ordered →
/// <c>403</c> (the gate saw <c>archived</c>); gate wired BEFORE resolution → <c>200</c> with the seeded post,
/// because resolution then still runs and the endpoint happily serves an archived world's content — the exact
/// failure COR-032 AC3 forbids; scope never resolved at all, or no live session presented → <c>401</c>
/// (identity-auth-roles/11 added the second of those causes: the default-deny gate now answers before the
/// lifecycle gate, so an anonymous caller never learns an exercise's lifecycle state — which is why these
/// tests present a real session token). A companion test pins the <c>live</c> case at <c>200</c> so a
/// blanket-refusing pipeline (or a resolution break) cannot make the <c>403</c> pass for the wrong reason.
/// </para>
/// <para>
/// <b>Its own class, inside <see cref="MsSqlCollection"/>, every test <c>[RequiresDockerFact]</c>.</b> The
/// pure-DI and route-map halves of the wave-3 wiring guard stay in <see cref="CompositionRootWiringTests"/>,
/// deliberately OUTSIDE this collection: a plain <see cref="FactAttribute"/> in a SQL-collection class
/// constructs the container fixture regardless and turns a Docker-less run red (a standing Gate-2 finding).
/// </para>
/// <para>
/// The host is the REAL <c>Program</c> with no <c>ConfigureTestServices</c> override of any kind — an override
/// of the exercise context or the pipeline would defeat the entire point of the file.
/// </para>
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class LifecycleGatingPipelineOrderTests
{
    private readonly MsSqlContainerFixture _fixture;

    public LifecycleGatingPipelineOrderTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>
    /// The guard: an <c>archived</c> exercise, reached by its provisioned host, refuses <c>/api/feed</c> with
    /// <c>403</c> through the real composition root.
    /// </summary>
    [RequiresDockerFact]
    public async Task ArchivedExercise_RefusesTheParticipantFeedWith403_ThroughTheRealProgramPipeline()
    {
        var seeded = await SeedExerciseAsync("archived", withPost: true);

        await using var factory = new LifecycleGatingProbeFactory(_fixture.ConnectionString!);
        using var client = CreateClientFor(factory, seeded.Host, seeded.Token);

        var response = await client.GetAsync(new Uri("/api/feed", UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.Forbidden,
            "COR-032 AC3: an archived world's participant surface must not be served. A 200 here means "
            + "app.UseExerciseLifecycleGating() is wired ABOVE app.UseExerciseResolution()/"
            + "app.UseSessionAuthentication() in Program.cs, so the gate read an unset scope and passed the "
            + "request through — a gate that looks wired and enforces nothing, while /api/feed hands a "
            + "participant an archived world's posts. A 401 means either the host never resolved to an exercise "
            + "or the seeded session was not honored (identity-auth-roles/11's gate answering first). NOTE: "
            + "since this test presents a participant session, a BROKEN host resolution now yields the session "
            + "middleware's host-binding 403 — the same code the lifecycle gate produces — so this assertion "
            + "alone could pass for the wrong reason. The PAIR is the guard: its live-exercise companion would "
            + "then see 403 instead of 200. Never delete one without the other");
    }

    /// <summary>
    /// The other side of the same coin — a <c>live</c> exercise on the identical wiring serves <c>200</c>. Without
    /// this, a pipeline that refused everything (or a resolution break) would let the <c>403</c> above pass
    /// while the gate was broken in the opposite direction.
    /// </summary>
    [RequiresDockerFact]
    public async Task LiveExercise_StillServesTheParticipantFeed_SoThe403IsTheGateAndNotABlanketRefusal()
    {
        var seeded = await SeedExerciseAsync("live", withPost: true);

        await using var factory = new LifecycleGatingProbeFactory(_fixture.ConnectionString!);
        using var client = CreateClientFor(factory, seeded.Host, seeded.Token);

        var response = await client.GetAsync(new Uri("/api/feed", UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.OK,
            "a live exercise is participant-accessible, so the same pipeline that refuses the archived one must "
            + "serve this one — proving the 403 is COR-032's lifecycle decision and not an unresolved scope, a "
            + "missing registration or a blanket refusal");
    }

    /// <summary>
    /// Seeds a fresh exercise in <paramref name="status"/> with a unique provisioned hostname (so the real
    /// <c>UseExerciseResolution()</c> can map a request to it), a LIVE participant session bound to it, and,
    /// optionally, one visible post — so a wrongly-served feed is provably non-empty rather than an
    /// empty-but-200.
    /// </summary>
    /// <returns>The provisioned hostname to address the exercise by, and the session token to present.</returns>
    private async Task<(string Host, string Token)> SeedExerciseAsync(string status, bool withPost)
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");

        var exerciseId = Guid.NewGuid();
        var host = $"ec-wiring-{exerciseId:N}.pulse.test";
        var token = $"ec-wiring-token-{Guid.NewGuid():N}";

        await using var context = _fixture.CreateContext();
        context.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = exerciseId,
            Name = "Wave-3 wiring probe",
            Hostname = host,
            TimeZone = "UTC",
            Status = status,
        });

        // identity-auth-roles/11: /api/feed now requires a live session. A participant session bound to THIS
        // exercise is what a real participant presents, and it leaves the ordering this file exists to prove
        // fully observable — host resolution still runs (the participant host-binding check depends on it) and
        // the lifecycle gate still decides from the same resolved scope.
        context.Sessions.Add(TestSessions.NewSession(token, exerciseId, personaId: Guid.NewGuid()));

        if (withPost)
        {
            context.Posts.Add(new Post
            {
                Id = Guid.NewGuid(),
                ExerciseId = exerciseId,
                AuthorPersonaId = Guid.NewGuid(),
                Body = "A closed world's content must never reach a participant.",
                CreatedScenarioTime = new DateTimeOffset(2033, 3, 1, 12, 0, 0, TimeSpan.Zero),
                CreatedWallClock = DateTimeOffset.UtcNow,
                Origin = "participant",
                ActingHumanId = "human-1",
            });
        }

        await context.SaveChangesAsync();

        return (host, token);
    }

    /// <summary>
    /// A client on the booted host whose <see cref="HttpClient.BaseAddress"/> host is what
    /// <c>UseExerciseResolution()</c> maps to the seeded exercise — the same "address the exercise by its
    /// provisioned host" idiom the exercise-resolution suites use, and the only way the REAL resolution
    /// middleware (rather than a stub) decides the request's scope.
    /// </summary>
    private static HttpClient CreateClientFor(WebApplicationFactory<Program> factory, string host, string token)
    {
        var client = factory.CreateClient();
        client.BaseAddress = new Uri($"http://{host}");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    /// <summary>
    /// The real <c>Program</c> host with <c>ConnectionStrings__DefaultConnection</c> pointed at the shared
    /// migrated database (set in the constructor, before the host captures its configuration — the same
    /// approach <c>TelemetryWebApplicationFactory</c> documents). It overrides NOTHING else: an override of the
    /// pipeline or the exercise context would make the ordering it exists to prove unobservable. That still
    /// holds under identity-auth-roles/11 — the session is presented as a real seeded row and a real bearer
    /// token, never as a DI or middleware override.
    /// </summary>
    private sealed class LifecycleGatingProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

        public LifecycleGatingProbeFactory(string connectionString)
            => Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}
