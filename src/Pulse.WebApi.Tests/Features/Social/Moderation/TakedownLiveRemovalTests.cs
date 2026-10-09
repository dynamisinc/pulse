namespace Pulse.WebApi.Tests.Features.Social.Moderation;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// The over-the-wire proof of live removal (demo-polish B6, story 09 AC "Live removal"; XC-002, COR-001). A real
/// controller takedown over HTTP, through the REAL <c>SignalRFeedBroadcaster</c> and <c>ExerciseRealtimeHub</c>,
/// reaches a participant connection in the same exercise as <c>PostRemoved { postId }</c>. A staff connection in
/// that exercise gets it exactly once (not again via the staff group), and a participant in another exercise
/// never receives it.
/// </summary>
/// <remarks>
/// "Never receives" uses an ordering barrier, not a sleep. After the takedown, a probe is sent to each
/// connection's exercise-wide group and the test waits until it arrives. SignalR delivers one connection's
/// messages in send order, so any <c>PostRemoved</c> addressed to that connection would have arrived before its
/// probe. Long polling is the only transport <c>TestServer</c> supports end to end.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class TakedownLiveRemovalTests
{
    private const string PostRemoved = "PostRemoved";
    private const string Probe = "B6TakedownProbe";

    private static readonly TimeSpan DeliveryTimeout = TimeSpan.FromSeconds(10);

    private readonly ModerationSeeder _seed;

    public TakedownLiveRemovalTests(MsSqlContainerFixture fixture) => _seed = new ModerationSeeder(fixture);

    [RequiresDockerFact]
    public async Task Takedown_PushesPostRemovedWithOnlyThePostId_ToItsExercise_NeverAnotherExercise_AndOnceToStaff()
    {
        var exerciseA = await _seed.SeedExerciseAsync();
        var exerciseB = await _seed.SeedExerciseAsync();
        var postA = await _seed.SeedPostAsync(exerciseA.Id);
        var participantAToken = await _seed.SeedParticipantSessionAsync(exerciseA.Id);
        var participantBToken = await _seed.SeedParticipantSessionAsync(exerciseB.Id);
        var controllerA = await _seed.SeedControllerSessionAsync(exerciseA.Id);

        using var factory = new ModerationWebApplicationFactory(_seed.ConnectionString, useRealBroadcaster: true);
        await using var participantA = await ConnectAsync(factory, exerciseA.Host, participantAToken);
        await using var participantB = await ConnectAsync(factory, exerciseB.Host, participantBToken);
        await using var staffA = await ConnectAsync(factory, exerciseA.Host, controllerA);

        await participantA.WaitUntilInGroupAsync(factory, $"exercise:{exerciseA.Id}");
        await participantB.WaitUntilInGroupAsync(factory, $"exercise:{exerciseB.Id}");
        await staffA.WaitUntilInGroupAsync(factory, $"exercise:{exerciseA.Id}:staff");

        using var client = factory.CreateClientFor(exerciseA.Host, controllerA);
        var response = await client.DeleteAsync(new Uri($"/api/staff/posts/{postA}?category=pii", UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.NoContent);

        await participantA.WaitForRemovalAsync(postA.ToString());

        // Ordering barriers: anything addressed to these connections before now has already arrived.
        await participantA.WaitUntilInGroupAsync(factory, $"exercise:{exerciseA.Id}");
        await participantB.WaitUntilInGroupAsync(factory, $"exercise:{exerciseB.Id}");
        await staffA.WaitUntilInGroupAsync(factory, $"exercise:{exerciseA.Id}");

        participantA.Payloads.Should().ContainSingle("the participant feed in the same exercise drops the post live");
        using (var payload = JsonDocument.Parse(participantA.Payloads[0]))
        {
            payload.RootElement.EnumerateObject().Select(p => p.Name).Should().Equal(
                new[] { "postId" }, "on the wire PostRemoved carries the post id and nothing else (XC-002)");
            payload.RootElement.GetProperty("postId").GetString().Should().Be(postA.ToString());
        }

        staffA.Payloads.Should().ContainSingle(
            "a staff connection is in both groups but PostRemoved goes to the exercise-wide group only, so it arrives once");
        participantB.Payloads.Should().BeEmpty("a takedown in exercise A never reaches exercise B (COR-001)");
    }

    private static async Task<RecordingConnection> ConnectAsync(
        ModerationWebApplicationFactory factory, string hostname, string token)
    {
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri($"http://{hostname}/hubs/exercise"), options =>
            {
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
                options.Transports = HttpTransportType.LongPolling;
                options.AccessTokenProvider = () => Task.FromResult<string?>(token);
            })
            .Build();

        var recording = new RecordingConnection(connection);
        await connection.StartAsync();
        connection.State.Should().Be(HubConnectionState.Connected, "a live session on a provisioned host connects");
        return recording;
    }

    /// <summary>A started hub connection that records every raw <c>PostRemoved</c> payload in arrival order.</summary>
    private sealed class RecordingConnection : IAsyncDisposable
    {
        private readonly HubConnection _connection;
        private readonly List<string> _payloads = new();
        private readonly ConcurrentDictionary<string, byte> _probes = new(StringComparer.Ordinal);

        public RecordingConnection(HubConnection connection)
        {
            _connection = connection;
            _connection.On<JsonElement>(PostRemoved, payload =>
            {
                lock (_payloads)
                {
                    _payloads.Add(payload.GetRawText());
                }
            });
            _connection.On<string>(Probe, nonce => _probes.TryAdd(nonce, 0));
        }

        public IReadOnlyList<string> Payloads
        {
            get
            {
                lock (_payloads)
                {
                    return _payloads.ToList();
                }
            }
        }

        /// <summary>Sends a nonce probe to <paramref name="groupName"/> until this connection receives it.</summary>
        public async Task WaitUntilInGroupAsync(ModerationWebApplicationFactory factory, string groupName)
        {
            var hubContext = factory.Services.GetRequiredService<IHubContext<ExerciseRealtimeHub>>();
            var nonce = Guid.NewGuid().ToString();
            var deadline = DateTime.UtcNow + DeliveryTimeout;
            while (DateTime.UtcNow < deadline)
            {
                await hubContext.Clients.Group(groupName).SendAsync(Probe, nonce);
                for (var i = 0; i < 4; i++)
                {
                    if (_probes.ContainsKey(nonce))
                    {
                        return;
                    }

                    await Task.Delay(25);
                }
            }

            _probes.ContainsKey(nonce).Should().BeTrue($"the connection should be in {groupName} within {DeliveryTimeout}");
        }

        /// <summary>Waits until a <c>PostRemoved</c> naming <paramref name="postId"/> has arrived.</summary>
        public async Task WaitForRemovalAsync(string postId)
        {
            var deadline = DateTime.UtcNow + DeliveryTimeout;
            while (DateTime.UtcNow < deadline)
            {
                if (Payloads.Any(p => p.Contains(postId, StringComparison.Ordinal)))
                {
                    return;
                }

                await Task.Delay(25);
            }

            Payloads.Should().Contain(p => p.Contains(postId, StringComparison.Ordinal), $"PostRemoved {postId} should arrive within {DeliveryTimeout}");
        }

        public ValueTask DisposeAsync() => _connection.DisposeAsync();
    }
}
