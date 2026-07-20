namespace Pulse.WebApi.Tests.Features.Realtime;

using System;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
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
/// <b>Docker-free by design.</b> <see cref="ExerciseRealtimeHub"/> depends on nothing but
/// <see cref="IExerciseContext"/> — no <c>PulseDbContext</c>, no SQL Server — so these tests build a
/// small, self-contained <see cref="TestServer"/> wiring only the production
/// <see cref="RealtimeExtensions.AddSocialRealtimeHub"/> / <see cref="RealtimeExtensions.MapSocialRealtimeHub"/>
/// seam (the exact extension methods <c>Program.cs</c> will call once the orchestrator wires them in —
/// that wiring is this story's explicitly out-of-scope, orchestrator-owned line, per
/// <c>03-signalr-feed-host.md</c>'s Technical Notes) rather than <c>WebApplicationFactory&lt;Program&gt;</c>,
/// because the shipped <c>Program.cs</c> does not map <c>/hubs/exercise</c> yet. Every test here is a
/// plain <see cref="FactAttribute"/> and runs locally without a container.
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
    /// Builds a minimal, self-contained host wiring only the production
    /// <see cref="RealtimeExtensions.AddSocialRealtimeHub"/> / <see cref="RealtimeExtensions.MapSocialRealtimeHub"/>
    /// seam plus whatever <see cref="IExerciseContext"/> registration <paramref name="configureExerciseContext"/>
    /// supplies. No controllers, no persistence, no Docker — this is the story's own hub/broadcaster code
    /// and nothing else.
    /// </summary>
    private static TestServer CreateTestServer(Action<IServiceCollection> configureExerciseContext)
    {
        var hostBuilder = new HostBuilder()
            .ConfigureWebHost(webHost =>
            {
                webHost.UseTestServer();
                webHost.ConfigureServices(services =>
                {
                    services.AddRouting();
                    services.AddSocialRealtimeHub();
                    configureExerciseContext(services);
                });
                webHost.Configure(app =>
                {
                    app.UseRouting();
                    app.UseEndpoints(endpoints => endpoints.MapSocialRealtimeHub());
                });
            });

        var host = hostBuilder.Start();
        return host.GetTestServer();
    }

    /// <summary>
    /// Builds a client <see cref="HubConnection"/> against <paramref name="server"/>'s in-memory
    /// transport, over long polling (the only transport <see cref="TestServer"/> supports end to end).
    /// </summary>
    private static HubConnection BuildConnection(TestServer server)
    {
        return new HubConnectionBuilder()
            .WithUrl(new Uri("http://localhost/hubs/exercise"), options =>
            {
                options.HttpMessageHandlerFactory = _ => server.CreateHandler();
                options.Transports = Microsoft.AspNetCore.Http.Connections.HttpTransportType.LongPolling;
            })
            .Build();
    }
}
