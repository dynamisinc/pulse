namespace Pulse.WebApi.Tests.Features.Realtime;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// The over-the-wire proof of the EndEx send gate (#375; COR-032, COR-054): once an exercise leaves the
/// participant-accessible states, a participant tab STILL CONNECTED to <c>/hubs/exercise</c> receives no further
/// feed frame, while a staff console on the same exercise keeps its live view. Boots the REAL <c>Program</c>
/// composition root over REAL SQL Server (real host resolution, real sessions, real staff verification) with ONE
/// override: the <see cref="ExerciseLifecycleStatusReader"/> is a mutable stub, so the test can flip
/// <c>live → completed</c> between two broadcasts without racing a transition endpoint.
/// </summary>
/// <remarks>
/// <b>"Receives nothing" is asserted with an ordering barrier, not a hopeful sleep</b> (same technique as
/// <see cref="ExerciseRealtimeHubRoleIsolationTests"/>): after the suppressed broadcast, a nonce probe is sent by
/// name to the exercise-wide group. SignalR delivers one connection's messages in send order, so once the
/// participant has received the probe, any <c>PostReceived</c> addressed to it before the probe would already have
/// arrived.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class ExerciseRealtimeHubLifecycleTests
{
    private const string PostReceived = "PostReceived";
    private const string ReadinessProbe = "LifecycleReadinessProbe";
    private const string OnConnectedBarrierMethod = "LifecycleOnConnectedBarrierNoSuchMethod";

    private static readonly TimeSpan DeliveryTimeout = TimeSpan.FromSeconds(10);

    private readonly MsSqlContainerFixture _fixture;

    public ExerciseRealtimeHubLifecycleTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task AfterEndEx_AConnectedParticipantReceivesNoFurtherPost_WhileAStaffConsoleOnTheSameExerciseDoes()
    {
        var exercise = await SeedExerciseAsync();
        var participantToken = await SeedParticipantSessionAsync(exercise.Id);
        var staffToken = await SeedStaffSessionAsync(exercise.Id);
        var status = new MutableLifecycleStatusReader("live");

        using var host = new LifecycleHost(_fixture.ConnectionString!, status);
        await using var participant = await ConnectAsync(host, exercise.Hostname, participantToken);
        await using var staff = await ConnectAsync(host, exercise.Hostname, staffToken);
        await participant.WaitUntilProbeAsync(host, $"exercise:{exercise.Id}");
        await staff.WaitUntilProbeAsync(host, $"exercise:{exercise.Id}:staff");

        // While live: the participant is served the post (proof the connection is genuinely live).
        var whileLive = await BroadcastPostAsync(host, exercise.Id);
        await participant.WaitForPostAsync(whileLive);
        await staff.WaitForPostAsync(whileLive);

        // EndEx.
        status.Status = "completed";

        var afterEndEx = await BroadcastPostAsync(host, exercise.Id);
        await staff.WaitForPostAsync(afterEndEx);

        // Ordering barrier: the probe goes to the exercise-wide group AFTER the suppressed post, so once it arrives
        // any PostReceived addressed to the participant would already have been delivered.
        await participant.WaitUntilProbeAsync(host, $"exercise:{exercise.Id}");

        participant.Posts.Should().Equal(
            new[] { whileLive },
            "after EndEx a still-connected participant must receive nothing further on the hub (#375)");
        staff.Posts.Should().Equal(
            new[] { whileLive, afterEndEx },
            "a staff console keeps its live view of a completed exercise, exactly once per post");
    }

    private static async Task<string> BroadcastPostAsync(LifecycleHost host, Guid exerciseId)
    {
        var post = new ParticipantPostDto
        {
            Id = Guid.NewGuid().ToString(),
            AuthorPersonaId = Guid.NewGuid().ToString(),
            Text = "Officials confirm the water main repair is complete.",
            ScenarioTime = new DateTimeOffset(2033, 9, 4, 16, 0, 0, TimeSpan.Zero).ToString("O"),
            Counts = new ParticipantPostCounts(0, 0, 0),
        };

        await using var scope = host.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<IFeedBroadcaster>().BroadcastPostAsync(exerciseId, post);
        return post.Id;
    }

    private static async Task<RecordingConnection> ConnectAsync(LifecycleHost host, string hostname, string token)
    {
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri($"http://{hostname}/hubs/exercise"), options =>
            {
                options.HttpMessageHandlerFactory = _ => host.Server.CreateHandler();
                options.Transports = HttpTransportType.LongPolling;
                options.AccessTokenProvider = () => Task.FromResult<string?>(token);
            })
            .Build();
        var recording = new RecordingConnection(connection);
        await connection.StartAsync();
        connection.State.Should().Be(HubConnectionState.Connected);

        // OnConnectedAsync-completed barrier: invocations are dispatched only after it returns (see the role suite).
        var barrier = async () => await connection.InvokeAsync(OnConnectedBarrierMethod);
        await barrier.Should().ThrowAsync<HubException>();
        return recording;
    }

    private async Task<(Guid Id, string Hostname)> SeedExerciseAsync()
    {
        var exerciseId = Guid.NewGuid();
        var hostname = $"rt-lifecycle-{exerciseId:N}.example.com";

        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = exerciseId,
            Name = $"Realtime lifecycle {exerciseId:N}",
            Hostname = hostname,
            TimeZone = "UTC",
            Status = "live",
        });
        await seed.SaveChangesAsync();
        return (exerciseId, hostname);
    }

    private async Task<string> SeedParticipantSessionAsync(Guid exerciseId)
    {
        var token = $"rt-lc-participant-{Guid.NewGuid():N}";
        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(TestSessions.NewSession(token, exerciseId));
        await seed.SaveChangesAsync();
        return token;
    }

    private async Task<string> SeedStaffSessionAsync(Guid exerciseId)
    {
        var token = $"rt-lc-staff-{Guid.NewGuid():N}";
        var staffUserId = Guid.NewGuid();
        var session = TestSessions.NewSession(token, exerciseId, kind: "staff");
        session.StaffUserId = staffUserId;
        session.PrincipalId = staffUserId.ToString();

        await using var seed = _fixture.CreateContext();
        seed.StaffUsers.Add(StaffTenantSeed.StaffUserFor(staffUserId));
        seed.Enrollments.Add(new Enrollment
        {
            Id = Guid.NewGuid(),
            PersonId = staffUserId,
            ExerciseId = exerciseId,
            Role = "controller",
            CreatedAt = DateTimeOffset.UtcNow,
        });
        seed.Sessions.Add(session);
        await seed.SaveChangesAsync();
        return token;
    }

    /// <summary>Records every <c>PostReceived</c> id and readiness-probe nonce a client connection receives.</summary>
    private sealed class RecordingConnection : IAsyncDisposable
    {
        private readonly HubConnection _connection;
        private readonly List<string> _posts = new();
        private readonly ConcurrentDictionary<string, byte> _probes = new(StringComparer.Ordinal);

        public RecordingConnection(HubConnection connection)
        {
            _connection = connection;
            _connection.On<JsonElement>(PostReceived, payload =>
            {
                lock (_posts)
                {
                    _posts.Add(payload.GetProperty("id").GetString() ?? string.Empty);
                }
            });
            _connection.On<string>(ReadinessProbe, nonce => _probes.TryAdd(nonce, 0));
        }

        public IReadOnlyList<string> Posts
        {
            get
            {
                lock (_posts)
                {
                    return _posts.ToList();
                }
            }
        }

        /// <summary>Sends nonce probes to <paramref name="groupName"/> by name until this connection receives one.</summary>
        public async Task WaitUntilProbeAsync(LifecycleHost host, string groupName)
        {
            var hubContext = host.Services.GetRequiredService<IHubContext<ExerciseRealtimeHub>>();
            var nonce = Guid.NewGuid().ToString();
            var deadline = DateTime.UtcNow + DeliveryTimeout;
            while (DateTime.UtcNow < deadline)
            {
                await hubContext.Clients.Group(groupName).SendAsync(ReadinessProbe, nonce);
                for (var i = 0; i < 4; i++)
                {
                    if (_probes.ContainsKey(nonce))
                    {
                        return;
                    }

                    await Task.Delay(25);
                }
            }

            _probes.ContainsKey(nonce).Should().BeTrue($"the connection should receive a probe on {groupName} within {DeliveryTimeout}");
        }

        public async Task WaitForPostAsync(string id)
        {
            var deadline = DateTime.UtcNow + DeliveryTimeout;
            while (DateTime.UtcNow < deadline)
            {
                if (Posts.Contains(id))
                {
                    return;
                }

                await Task.Delay(25);
            }

            Posts.Should().Contain(id, $"post {id} should have been delivered within {DeliveryTimeout}");
        }

        public ValueTask DisposeAsync() => _connection.DisposeAsync();
    }

    /// <summary>
    /// The real <c>Program</c> host over the fixture's database, with the lifecycle status reader replaced by
    /// <paramref name="status"/> (ConfigureTestServices runs last, so it wins over the production registration).
    /// </summary>
    private sealed class LifecycleHost : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

        private readonly MutableLifecycleStatusReader _status;

        public LifecycleHost(string connectionString, MutableLifecycleStatusReader status)
        {
            _status = status;
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            ArgumentNullException.ThrowIfNull(builder);
            builder.ConfigureTestServices(services =>
                services.Replace(ServiceDescriptor.Singleton<ExerciseLifecycleStatusReader>(_status.ReadAsync)));
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}
