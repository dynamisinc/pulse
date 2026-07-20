namespace Pulse.WebApi.Tests.Features.Realtime;

using System;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Extensions;
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
/// maps <see cref="RealtimeExtensions.MapSocialRealtimeHub"/> at <c>/hubs/exercise</c> itself. These tests
/// therefore boot the real host via <see cref="WebApplicationFactory{TEntryPoint}"/> over the in-memory
/// <see cref="TestServer"/> transport and connect to Program.cs's OWN hub mapping — a live proof the hub is
/// reachable through the composition root, not a test-only stand-in. They stay Docker-free: the host is fed
/// a dummy, never-connecting connection string so it merely BUILDS (<see cref="ExerciseRealtimeHub"/>
/// depends only on <see cref="IExerciseContext"/> — no <c>PulseDbContext</c> access on the hub path, so the
/// database is never opened), and each test overrides the scoped <see cref="IExerciseContext"/> via
/// <c>ConfigureTestServices</c>. Every test here is a plain <see cref="FactAttribute"/> and runs locally
/// without a container.
/// </para>
/// <para>
/// <b>Why a single connection per host, not two simultaneous connections in different exercises.</b>
/// Per-request <see cref="IExerciseContext"/> resolution (host/session-token auth) is Phase B2 and
/// doesn't exist yet; ASP.NET Core SignalR also does not expose the connecting request's
/// <c>HttpContext</c> to a Hub's constructor-injected DI-scoped services (only to Hub methods, via
/// <c>Context.GetHttpContext()</c>, after construction) — confirmed empirically against this exact
/// harness. So a single fixed <c>ConfigureTestServices</c> override of <see cref="IExerciseContext"/>
/// (the pattern the DB-backed integration tests use) is the only reliable way to resolve a scope for a
/// hub connection in this test host today, and it can only give ONE fixed scope per host instance. Each
/// test below therefore fixes ONE host to ONE exercise's scope and proves BOTH directions with a single
/// connection: its own exercise's broadcast IS delivered, and a DIFFERENT exercise's broadcast is NOT —
/// a real, live proof that <c>Clients.Group(...)</c> delivery is exercise-scoped, not exercise-A-vs-B
/// process isolation by accident. <see cref="ExerciseRealtimeHubTests"/> covers the complementary
/// "two different resolved scopes always join two different groups" property directly, without needing
/// two live connections at once.
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
        // The real production default: AddExerciseScoping() registers IExerciseContext starting UNSET
        // (CurrentExerciseId null) — no test double at all, this IS the shipped fail-closed behaviour.
        using var server = CreateTestServer(services => services.AddExerciseScoping());

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

        // Fixed for the whole host, exactly the ConfigureTestServices override pattern the DB-backed
        // integration tests use — a plain factory closure with NO HttpContext dependency, so it resolves
        // identically regardless of which DI scope (request or hub-connection) asks for it.
        using var server = CreateTestServer(services =>
            services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = exerciseA }));

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
        using var server = CreateTestServer(services =>
            services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = exerciseId }));

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
    /// transport, replacing the registered <see cref="IExerciseContext"/> with whatever
    /// <paramref name="configureExerciseContext"/> supplies. No Docker: a dummy, never-connecting connection
    /// string lets the host build, and the hub path touches no database.
    /// </summary>
    private static RealtimeHostFactory CreateTestServer(Action<IServiceCollection> configureExerciseContext)
        => new(configureExerciseContext);

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
    /// hub wiring (<c>AddSocialRealtimeHub()</c> + <c>MapSocialRealtimeHub()</c>); this factory only feeds a
    /// dummy (never-connecting) connection string so the host BUILDS — the hub path reads only
    /// <see cref="IExerciseContext"/> and never opens the database — and overrides that scoped
    /// <see cref="IExerciseContext"/> per test via <c>ConfigureTestServices</c> (which runs last and
    /// reliably wins over Program.cs's default registration).
    /// </summary>
    private sealed class RealtimeHostFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

        // Syntactically valid but non-connecting: enough for the host to BUILD and register PulseDbContext;
        // the hub connection path never opens it.
        private const string DummyConnectionString =
            "Server=nonexistent;Database=pulse;Trusted_Connection=False;";

        private readonly Action<IServiceCollection> _configureExerciseContext;

        public RealtimeHostFactory(Action<IServiceCollection> configureExerciseContext)
        {
            _configureExerciseContext = configureExerciseContext;
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, DummyConnectionString);
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            ArgumentNullException.ThrowIfNull(builder);

            builder.ConfigureTestServices(services =>
            {
                // Drop Program.cs's default IExerciseContext registration, then let the test's own
                // configurator install the scope it wants (a fixed exercise, or the fail-closed default).
                services.RemoveAll<IExerciseContext>();
                _configureExerciseContext(services);
            });
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}
