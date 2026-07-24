namespace Pulse.WebApi.Tests.Features.Realtime;

using System;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;

/// <summary>
/// The real-time-transport, end-to-end extension of the standing cross-exercise isolation suite
/// (<c>exercise-isolation/07</c>, COR-007) — story <c>social-api/03</c> (#272)'s
/// <b>[Tier-2 — always-Critical isolation class]</b> AC, driven over a REAL (in-memory) SignalR
/// connection rather than mocks, complementing <see cref="ExerciseRealtimeHubTests"/>'s direct
/// <c>OnConnectedAsync</c> unit tests and <see cref="SignalRFeedBroadcasterTests"/>'s broadcaster unit
/// tests. Cross-references <c>Data/QueryFilterIsolationTests.cs</c>, the same guarantee's read-side/HTTP
/// proof.
/// </summary>
/// <remarks>
/// <para>
/// <b>Docker-free by design, booting the real <c>Program.cs</c>.</b> The orchestrator's composition-root
/// edit has landed: <c>Program.cs</c> now calls <see cref="RealtimeExtensions.AddSocialRealtimeHub"/> and
/// maps <see cref="RealtimeExtensions.MapSocialRealtimeHub"/> at <c>/hubs/exercise</c> itself, behind the
/// real <c>UseExerciseResolution</c> middleware. These tests therefore boot the real host via
/// <see cref="WebApplicationFactory{TEntryPoint}"/> over the in-memory <see cref="TestServer"/> transport and
/// connect to Program.cs's OWN hub mapping — a live proof the hub is reachable, and correctly scoped,
/// through the composition root, not a test-only stand-in. They stay Docker-free: the host is fed a dummy,
/// never-connecting connection string so it merely BUILDS (no <c>PulseDbContext</c> access on the hub path,
/// so the database is never opened), and each test replaces the DB-backed
/// <see cref="IHostExerciseResolver"/> with a deterministic stub via <c>ConfigureTestServices</c> so the real
/// middleware stamps the desired host-resolved exercise onto the connection request's
/// <c>HttpContext.Items</c> — the exact source <see cref="ExerciseRealtimeHub"/> now reads. Every test here
/// is a plain <see cref="FactAttribute"/> and runs locally without a container.
/// </para>
/// <para>
/// <b>Why a single connection per host, not two simultaneous connections in different exercises.</b>
/// <see cref="ExerciseRealtimeHub"/> resolves its group from the connection's host-resolved
/// <c>HttpContext</c> (<c>Context.GetHttpContext()?.GetHostResolvedExerciseId()</c>) — which the real
/// <c>UseExerciseResolution</c> middleware populates per connection request from the (stubbed) host resolver.
/// A single fixed stub resolver gives ONE host → ONE exercise per host instance. Each test below therefore
/// fixes ONE host to ONE exercise's scope and proves BOTH directions with a single connection: its own
/// exercise's broadcast IS delivered, and a DIFFERENT exercise's broadcast is NOT — a real, live proof that
/// <c>Clients.Group(...)</c> delivery is exercise-scoped, not exercise-A-vs-B process isolation by accident.
/// <see cref="ExerciseRealtimeHubTests"/> covers the complementary "two different resolved scopes always join
/// two different groups" property directly, without needing two live connections at once.
/// </para>
/// </remarks>
public class ExerciseRealtimeHubIsolationTests
{
    [Fact]
    public void Hub_ExposesNoClientInvocableMethod_ThatAcceptsAGroupOrExerciseId()
    {
        // The always-Critical structural guarantee: a client cannot invoke ANY hub method to join, or
        // request, another exercise's group — because no such method exists at all. Public methods
        // declared directly on the hub (excluding the inherited Hub base type's own members) are exactly
        // the set SignalR's hub-method dispatcher would allow a client to invoke by name.
        var clientInvocableMethods = typeof(ExerciseRealtimeHub)
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => !m.IsSpecialName)
            // OnConnectedAsync/OnDisconnectedAsync are Hub LIFECYCLE overrides the SignalR pipeline calls
            // itself; they are not exposed to clients as invocable RPCs by the hub protocol.
            .Where(m => m.Name is not (nameof(Hub.OnConnectedAsync) or nameof(Hub.OnDisconnectedAsync)))
            .ToList();

        clientInvocableMethods.Should().BeEmpty(
            "the hub must expose NO client-invocable method a client could use to join or read another " +
            "exercise's group — group membership is derived from the server-side IExerciseContext only");
    }

    [Fact]
    public async Task Connection_WithNoExerciseScopeResolved_IsAborted_NeverJoinsAnyGroup()
    {
        // The host does not resolve to any exercise (stub resolver returns null) — the middleware stamps
        // nothing on HttpContext.Items, so the hub reads no scope. This IS the shipped fail-closed behaviour.
        using var server = CreateTestServer(hostResolvedExerciseId: null);

        await using var connection = BuildConnection(server);
        var closed = new TaskCompletionSource<Exception?>(TaskCreationOptions.RunContinuationsAsynchronously);
        connection.Closed += ex =>
        {
            closed.TrySetResult(ex);
            return Task.CompletedTask;
        };

        // The abort may surface as StartAsync itself failing, or as a Closed event shortly after a
        // successful handshake, depending on transport timing — either is the same fail-closed outcome
        // the hub's OnConnectedAsync remark documents ("never join a group with an ambient/empty
        // exercise — abort instead"), so both are accepted here.
        Exception? startException = null;
        try
        {
            await connection.StartAsync();
        }
        catch (Exception ex)
        {
            startException = ex;
        }

        if (startException is null)
        {
            var completed = await Task.WhenAny(closed.Task, Task.Delay(TimeSpan.FromSeconds(5)));
            completed.Should().Be(closed.Task, "an unresolved-scope connection must be aborted, not left open");
        }

        connection.State.Should().NotBe(
            HubConnectionState.Connected, "an unresolved-scope connection must never remain connected");
    }

    [Fact]
    public async Task Connection_ScopedToExerciseA_ReceivesItsOwnExercisesBroadcast_ButNeverAnotherExercises()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();

        // The whole host resolves to exercise A: the stub resolver returns A for any host, so the real
        // middleware stamps A on every connection request's HttpContext.Items and the hub joins A's group.
        using var server = CreateTestServer(hostResolvedExerciseId: exerciseA);

        await using var connection = BuildConnection(server);
        var received = new System.Collections.Generic.List<ParticipantPostDto>();
        var firstReceived = new TaskCompletionSource<ParticipantPostDto>(TaskCreationOptions.RunContinuationsAsynchronously);
        connection.On<ParticipantPostDto>("PostReceived", post =>
        {
            lock (received) received.Add(post);
            firstReceived.TrySetResult(post);
        });

        await connection.StartAsync();
        connection.State.Should().Be(HubConnectionState.Connected, "a resolved scope must join, not abort");

        var postForA = SamplePost();
        var postForB = SamplePost();

        await using (var scope = server.Services.CreateAsyncScope())
        {
            var broadcaster = scope.ServiceProvider.GetRequiredService<IFeedBroadcaster>();
            // Own exercise first, so the positive proof-of-life arrives before the negative wait below.
            await broadcaster.BroadcastPostAsync(exerciseA, postForA);
            await broadcaster.BroadcastPostAsync(exerciseB, postForB);
        }

        var deliveredFirst = await WaitOrTimeoutAsync(firstReceived.Task, "exercise A's own broadcast");
        deliveredFirst.Id.Should().Be(postForA.Id, "the connection's own exercise broadcast must be delivered");

        // A short bounded grace period so a wrongly cross-delivered exercise-B message — the failure mode
        // under test — has a real chance to arrive before the negative assertion below.
        await Task.Delay(TimeSpan.FromMilliseconds(250));

        lock (received)
        {
            received.Select(p => p.Id).Should().Equal(
                new[] { postForA.Id },
                "a connection scoped to exercise A must receive ONLY exercise A's broadcasts — " +
                "exercise B's broadcast, sent on the same live host, must never arrive");
        }
    }

    [Fact]
    public async Task Broadcast_WireJson_NeverCarriesProvenanceKeys_UnconditionalXc002()
    {
        var exerciseId = Guid.NewGuid();
        using var server = CreateTestServer(hostResolvedExerciseId: exerciseId);

        await using var connection = BuildConnection(server);
        var receivedRaw = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        // Binding the handler's parameter to JsonElement (rather than ParticipantPostDto) captures the
        // ACTUAL wire JSON the JSON Hub Protocol serialized — proving absence at the wire, not merely
        // that our own DTO type happens not to expose these properties.
        connection.On<JsonElement>("PostReceived", element => receivedRaw.TrySetResult(element.Clone()));

        await connection.StartAsync();

        await using (var scope = server.Services.CreateAsyncScope())
        {
            var broadcaster = scope.ServiceProvider.GetRequiredService<IFeedBroadcaster>();
            await broadcaster.BroadcastPostAsync(exerciseId, SamplePost());
        }

        var raw = await WaitOrTimeoutAsync(receivedRaw.Task, "the broadcast's raw wire JSON");

        raw.TryGetProperty("origin", out _).Should().BeFalse("XC-002: a broadcast must never carry origin");
        raw.TryGetProperty("actingHumanId", out _).Should().BeFalse("XC-002: a broadcast must never carry actingHumanId");
        raw.TryGetProperty("createdWallClock", out _).Should().BeFalse("XC-002: a broadcast must never carry createdWallClock");
        raw.TryGetProperty("injectId", out _).Should().BeFalse("XC-002: a broadcast must never carry injectId");

        // Sanity: the payload is still the expected participant-safe shape, not an empty/broken object.
        raw.TryGetProperty("id", out _).Should().BeTrue();
        raw.TryGetProperty("authorPersonaId", out _).Should().BeTrue();
        raw.TryGetProperty("scenarioTime", out _).Should().BeTrue();
    }

    private static async Task<T> WaitOrTimeoutAsync<T>(Task<T> task, string what)
    {
        var completed = await Task.WhenAny(task, Task.Delay(TimeSpan.FromSeconds(10)));
        completed.Should().Be(task, $"{what} should have been delivered within the wait window");
        return await task;
    }

    private static ParticipantPostDto SamplePost() => new()
    {
        Id = Guid.NewGuid().ToString(),
        AuthorPersonaId = Guid.NewGuid().ToString(),
        Text = "Shelter-in-place lifted for the Riverside district.",
        ScenarioTime = new DateTimeOffset(2033, 9, 4, 14, 5, 0, TimeSpan.Zero).ToString("O"),
        Counts = new ParticipantPostCounts(0, 0, 0),
    };

    /// <summary>
    /// Boots the real <c>Program</c> host (which now owns <see cref="RealtimeExtensions.AddSocialRealtimeHub"/>
    /// / <see cref="RealtimeExtensions.MapSocialRealtimeHub"/>) over the in-memory <see cref="TestServer"/>
    /// transport, replacing the DB-backed <see cref="IHostExerciseResolver"/> with a stub that resolves every
    /// host to <paramref name="hostResolvedExerciseId"/> (or nothing, when <c>null</c>). No Docker: a dummy,
    /// never-connecting connection string lets the host build, and the hub path touches no database.
    /// </summary>
    private static RealtimeHostFactory CreateTestServer(Guid? hostResolvedExerciseId)
        => new(hostResolvedExerciseId);

    /// <summary>
    /// Builds a client <see cref="HubConnection"/> against <paramref name="factory"/>'s in-memory
    /// <see cref="TestServer"/> transport, over long polling (the only transport <see cref="TestServer"/>
    /// supports end to end).
    /// </summary>
    private static HubConnection BuildConnection(RealtimeHostFactory factory)
    {
        return new HubConnectionBuilder()
            .WithUrl(new Uri("http://localhost/hubs/exercise"), options =>
            {
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
                options.Transports = Microsoft.AspNetCore.Http.Connections.HttpTransportType.LongPolling;
            })
            .Build();
    }

    /// <summary>
    /// Boots the real <c>Program</c> host to exercise Program.cs's OWN SignalR hub mapping over the
    /// in-memory <see cref="TestServer"/> transport — no Docker, no live database. Program.cs now owns the
    /// hub wiring (<c>AddSocialRealtimeHub()</c> + <c>MapSocialRealtimeHub()</c>) behind the real
    /// <c>UseExerciseResolution</c> middleware; this factory only feeds a dummy (never-connecting) connection
    /// string so the host BUILDS — the hub path never opens the database — and replaces the DB-backed
    /// <see cref="IHostExerciseResolver"/> per test via <c>ConfigureTestServices</c> (which runs last and
    /// reliably wins over Program.cs's default registration) so the middleware stamps a deterministic
    /// host-resolved exercise on each connection request's <c>HttpContext.Items</c> — the source the hub reads.
    /// </summary>
    private sealed class RealtimeHostFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

        // Syntactically valid but non-connecting: enough for the host to BUILD and register PulseDbContext;
        // the hub connection path never opens it.
        private const string DummyConnectionString =
            "Server=nonexistent;Database=pulse;Trusted_Connection=False;";

        private readonly Guid? _hostResolvedExerciseId;

        public RealtimeHostFactory(Guid? hostResolvedExerciseId)
        {
            _hostResolvedExerciseId = hostResolvedExerciseId;
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, DummyConnectionString);
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            ArgumentNullException.ThrowIfNull(builder);

            builder.ConfigureTestServices(services =>
            {
                // Re-point the host→exercise resolver to a deterministic stub so the REAL
                // UseExerciseResolution middleware stamps the desired host-resolved exercise on each
                // connection request's HttpContext.Items — exactly the source the hub's OnConnectedAsync now
                // reads (Context.GetHttpContext()?.GetHostResolvedExerciseId()). No DB is touched.
                services.RemoveAll<IHostExerciseResolver>();
                services.AddSingleton<IHostExerciseResolver>(new StubHostExerciseResolver(_hostResolvedExerciseId));
            });
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }

    /// <summary>
    /// Deterministic <see cref="IHostExerciseResolver"/> test double: resolves EVERY host to the fixed
    /// <c>resolvedExerciseId</c> (or to <c>null</c> — an unresolved host — when that is <c>null</c>), with no
    /// database access, so the real middleware's host-resolution write is exercised without a live DB.
    /// </summary>
    private sealed class StubHostExerciseResolver : IHostExerciseResolver
    {
        private readonly Guid? _resolvedExerciseId;

        public StubHostExerciseResolver(Guid? resolvedExerciseId) => _resolvedExerciseId = resolvedExerciseId;

        public Task<Guid?> ResolveExerciseIdAsync(string? rawHost, CancellationToken cancellationToken)
            => Task.FromResult(_resolvedExerciseId);
    }
}
