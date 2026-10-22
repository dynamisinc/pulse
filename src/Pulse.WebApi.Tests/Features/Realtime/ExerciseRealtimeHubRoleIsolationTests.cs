namespace Pulse.WebApi.Tests.Features.Realtime;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Review;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// The over-the-wire proof of the role-scoped realtime groups (demo-polish B5, home story social-api/05; XC-002,
/// COR-001, SOC-052) and the role-dimension extension of the standing cross-exercise isolation suite
/// (<c>exercise-isolation/07</c>). Boots the REAL <c>Program</c> composition root over REAL SQL Server with NO
/// stubs: the connection's exercise comes from real host → exercise resolution (each exercise has its own
/// provisioned hostname), its identity from a real persisted session token run through the real session
/// middleware and default-deny gate, and every push from the real broadcasters
/// (<see cref="IEngineReviewBroadcaster"/>, <see cref="IFeedBroadcaster"/>) to real SignalR client connections.
/// </summary>
/// <remarks>
/// <para>
/// <b>"Never receives" is asserted on the wire, with an ordering barrier rather than a hopeful sleep.</b> Every
/// negative case sends the staff-only <c>ReviewItemChanged</c> FIRST and a participant-safe
/// <c>PostReceived</c> to the same exercise SECOND. SignalR delivers one connection's messages in send order,
/// so once a connection has received the second frame, any first frame addressed to it would already have
/// arrived. The client registers a <c>ReviewItemChanged</c> handler on the PARTICIPANT connection too, so a
/// frame that reached it would be recorded — the assertion is that the server never sent it, not that the
/// client chose to ignore it.
/// </para>
/// <para>
/// <b>Readiness before broadcasting.</b> SignalR completes the client handshake BEFORE the hub's
/// <c>OnConnectedAsync</c> runs, and the staff decision (a session/assignment check) runs AFTER the
/// exercise-wide join, so a push sent the instant <c>StartAsync</c> returns can precede either join. Every
/// connection therefore first clears an exact <c>OnConnectedAsync</c>-completed barrier: SignalR dispatches a
/// connection's client invocations only after <c>OnConnectedAsync</c> returns, so the error completion of an
/// invocation of a method the hub does not have proves every group decision — staff or not — has been made.
/// Without it a NEGATIVE assertion ("never receives ReviewItemChanged") could pass vacuously against a hub that
/// joined the staff group late. Each test then also confirms the group under test by a nonce probe sent to it by
/// name (outside the recorded frames): the staff group for a connection expected to be staff — itself a positive
/// proof — and the exercise-wide group otherwise.
/// </para>
/// <para>
/// Long polling is the only transport <c>TestServer</c> supports end to end; the browser's WebSocket path
/// (token in <c>?access_token=</c>) is reproduced by placing the token in the URL instead of the header.
/// </para>
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class ExerciseRealtimeHubRoleIsolationTests
{
    private const string ReviewItemChanged = "ReviewItemChanged";
    private const string PostReceived = "PostReceived";

    private static readonly TimeSpan DeliveryTimeout = TimeSpan.FromSeconds(10);

    private readonly MsSqlContainerFixture _fixture;

    public ExerciseRealtimeHubRoleIsolationTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task ReviewItemChanged_ReachesTheStaffConnection_NeverTheParticipantConnection_WhilePostReceivedReachesBoth()
    {
        // B5 AC2 + AC3 + AC4 on one live host: a participant and a verified staff connection in the same exercise.
        var exercise = await SeedExerciseAsync();
        var participantToken = await SeedParticipantSessionAsync(exercise.Id);
        var staffToken = await SeedStaffSessionAsync(activeExerciseId: exercise.Id, assignedTo: [exercise.Id]);

        using var host = new RealtimeRoleHost(_fixture.ConnectionString!);
        await using var participant = await ConnectAsync(host, exercise.Hostname, participantToken);
        await using var staff = await ConnectAsync(host, exercise.Hostname, staffToken);
        await participant.WaitUntilInGroupAsync(host, $"exercise:{exercise.Id}");
        await staff.WaitUntilInGroupAsync(host, $"exercise:{exercise.Id}:staff");

        var draftId = await BroadcastReviewItemAsync(host, exercise.Id);
        var postId = await BroadcastPostAsync(host, exercise.Id);

        await staff.WaitForAsync(PostReceived, postId);
        await participant.WaitForAsync(PostReceived, postId);

        staff.Frames.Should().Equal(
            new[] { (ReviewItemChanged, draftId), (PostReceived, postId) },
            "a verified staff connection receives the staff-only push AND the participant-safe push, in order");
        participant.Frames.Should().Equal(
            new[] { (PostReceived, postId) },
            "a participant connection must NEVER receive ReviewItemChanged on the wire (XC-002) — yet still "
            + "receives PostReceived, which stays on the exercise-wide group");
    }

    [RequiresDockerFact]
    public async Task StaffConnection_PresentingItsTokenAsAccessTokenQueryParameter_StillJoinsTheStaffGroup()
    {
        // B5 AC1: staff is read from the connection's server-resolved session, so the browser WebSocket path
        // (token in ?access_token=, no Authorization header) is recognised as staff. A header-only staff lookup
        // would silently drop every real console out of the staff group.
        var exercise = await SeedExerciseAsync();
        var staffToken = await SeedStaffSessionAsync(activeExerciseId: exercise.Id, assignedTo: [exercise.Id]);

        using var host = new RealtimeRoleHost(_fixture.ConnectionString!);
        await using var staff = await ConnectAsync(host, exercise.Hostname, staffToken, tokenInQuery: true);
        await staff.WaitUntilInGroupAsync(host, $"exercise:{exercise.Id}:staff");

        var draftId = await BroadcastReviewItemAsync(host, exercise.Id);

        await staff.WaitForAsync(ReviewItemChanged, draftId);
        staff.Frames.Should().Contain((ReviewItemChanged, draftId));
    }

    [RequiresDockerFact]
    public async Task StaffConnection_IsScopedFromItsSession_NeverFromTheHost()
    {
        // identity-auth-roles/15 (ADMIN-IDENTITY-MODEL §1.2, supersedes B5's host-derived staff group): the staff user
        // is enrolled in BOTH exercises and the session is ACTIVE ON B, while the connection arrives on A's host. A
        // staff connection is scoped from its SESSION (session > host, as for REST), so it receives B's staff and
        // participant events and never A's.
        var exerciseA = await SeedExerciseAsync();
        var exerciseB = await SeedExerciseAsync();
        var staffToken = await SeedStaffSessionAsync(activeExerciseId: exerciseB.Id, assignedTo: [exerciseA.Id, exerciseB.Id]);

        using var host = new RealtimeRoleHost(_fixture.ConnectionString!);
        await using var staffOnAHost = await ConnectAsync(host, exerciseA.Hostname, staffToken);
        await staffOnAHost.WaitUntilInGroupAsync(host, $"exercise:{exerciseB.Id}:staff");

        // A's events first, then B's — B's PostReceived is the ordering barrier for everything before it.
        await BroadcastReviewItemAsync(host, exerciseA.Id);
        await BroadcastPostAsync(host, exerciseA.Id);
        var draftB = await BroadcastReviewItemAsync(host, exerciseB.Id);
        var postB = await BroadcastPostAsync(host, exerciseB.Id);

        await staffOnAHost.WaitForAsync(PostReceived, postB);

        staffOnAHost.Frames.Should().Equal(
            new[] { (ReviewItemChanged, draftB), (PostReceived, postB) },
            "a staff connection receives only its session's exercise's events — never the host's other exercise");
    }

    [RequiresDockerFact]
    public async Task StaffSessionNotEnrolledInItsSessionsExercise_IsRefused_NeverReceivesAnything()
    {
        // identity-auth-roles/15: the session names exercise A but the staff user is enrolled only in B — unverifiable,
        // so the hub refuses the connection (it never falls back to the host's exercise group).
        var exerciseA = await SeedExerciseAsync();
        var exerciseB = await SeedExerciseAsync();
        var staffToken = await SeedStaffSessionAsync(activeExerciseId: exerciseA.Id, assignedTo: [exerciseB.Id]);

        using var host = new RealtimeRoleHost(_fixture.ConnectionString!);
        await AssertRefusedAsync(host, exerciseA.Hostname, staffToken);
    }

    [RequiresDockerFact]
    public async Task RevokingTheGrant_CutsAStaffConnectionOpenedBeforeIt_SoItReceivesNoFurtherStaffBroadcast()
    {
        // identity-auth-roles/16 (Copilot review fold A): staff membership is checked only at connect, so the
        // grant-revoke rule must also cut the live connection. A controller connects, a planner removes the
        // controller's enrollment, and the controller's connection is aborted and out of the staff group.
        var kit = new Pulse.WebApi.Tests.Features.Identity.Enrollments.EnrollmentTestKit(_fixture);
        var exercise = await SeedExerciseAsync();
        var org = Organization.DefaultOrganizationId;
        var (planner, _) = await kit.SeedStaffAsync(org, exercise.Id, "planner");
        var (controller, controllerEnrollment) = await kit.SeedStaffAsync(org, exercise.Id, "controller");
        var (plannerSession, _) = await kit.SeedStaffSessionAsync(planner, exercise.Id, "planner");
        var (_, controllerToken) = await kit.SeedStaffSessionAsync(controller, exercise.Id, "controller");

        using var host = new RealtimeRoleHost(_fixture.ConnectionString!);
        await using var staff = await ConnectAsync(host, exercise.Hostname, controllerToken);
        await staff.WaitUntilInGroupAsync(host, $"exercise:{exercise.Id}:staff");
        var before = await BroadcastReviewItemAsync(host, exercise.Id);
        await staff.WaitForAsync(ReviewItemChanged, before);

        var closed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        staff.Connection.Closed += _ =>
        {
            closed.TrySetResult();
            return Task.CompletedTask;
        };

        var revoker = host.Services.GetRequiredService<ISessionConnectionRevoker>();
        var (service, context) = kit.ServiceFor(plannerSession, planner, org, exercise.Id, revoker);
        await using (context)
        {
            (await service.RevokeAsync(controllerEnrollment)).Outcome.Should().Be(
                Pulse.WebApi.Features.Identity.Enrollments.EnrollmentOutcome.Ok);
        }

        (await Task.WhenAny(closed.Task, Task.Delay(DeliveryTimeout))).Should().Be(
            closed.Task, "the revoked session's live hub connection is aborted");

        var after = await BroadcastReviewItemAsync(host, exercise.Id);
        await Task.Delay(250);
        staff.Frames.Should().NotContain((ReviewItemChanged, after), "a revoked grant receives no further staff broadcast");
    }

    [RequiresDockerFact]
    public async Task SelfRevokeOverHttp_CutsThePlannersOwnOpenHubConnection_UnderTheRevokedSession()
    {
        // #575a self-revoke: a planner (not the last) DELETEs their OWN enrollment over the real HTTP route with the SAME
        // session their hub connection was opened under. The grant-revoke rule revokes that session, and the post-commit
        // connection cut aborts the planner's own live connection, so the console stops receiving staff pushes.
        var kit = new Pulse.WebApi.Tests.Features.Identity.Enrollments.EnrollmentTestKit(_fixture);
        var exercise = await SeedExerciseAsync();
        var org = Organization.DefaultOrganizationId;
        var (planner, plannerEnrollment) = await kit.SeedStaffAsync(org, exercise.Id, "planner");
        await kit.SeedStaffAsync(org, exercise.Id, "planner");
        var (_, plannerToken) = await kit.SeedStaffSessionAsync(planner, exercise.Id, "planner");

        using var host = new RealtimeRoleHost(_fixture.ConnectionString!);
        await using var console = await ConnectAsync(host, exercise.Hostname, plannerToken);
        await console.WaitUntilInGroupAsync(host, $"exercise:{exercise.Id}:staff");
        var before = await BroadcastReviewItemAsync(host, exercise.Id);
        await console.WaitForAsync(ReviewItemChanged, before);

        var closed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        console.Connection.Closed += _ =>
        {
            closed.TrySetResult();
            return Task.CompletedTask;
        };

        using (var client = host.CreateClient())
        {
            client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", plannerToken);
            using var removed = await client.DeleteAsync(new Uri($"/api/staff/enrollments/{plannerEnrollment}", UriKind.Relative));
            removed.StatusCode.Should().Be(System.Net.HttpStatusCode.OK, "a planner who is not the last may remove themselves");
        }

        (await Task.WhenAny(closed.Task, Task.Delay(DeliveryTimeout))).Should().Be(
            closed.Task, "the caller's own revoked session's hub connection is aborted");
        console.Connection.State.Should().Be(HubConnectionState.Disconnected);

        var after = await BroadcastReviewItemAsync(host, exercise.Id);
        await Task.Delay(250);
        console.Frames.Should().NotContain((ReviewItemChanged, after), "a self-revoked planner receives no further staff broadcast");
    }

    [RequiresDockerFact]
    public async Task ExpiredStaffToken_IsRejected_NeverConnects()
    {
        // B5 AC6: an invalid/expired token yields a participant-or-rejected connection, never staff. Here the
        // default-deny gate rejects it outright.
        var exercise = await SeedExerciseAsync();
        var expiredStaffToken = await SeedStaffSessionAsync(
            activeExerciseId: exercise.Id,
            assignedTo: [exercise.Id],
            configure: s => s.ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1));

        using var host = new RealtimeRoleHost(_fixture.ConnectionString!);
        await using var connection = BuildConnection(host, exercise.Hostname, expiredStaffToken, tokenInQuery: false);

        var start = async () => await connection.StartAsync();

        await start.Should().ThrowAsync<Exception>("an expired staff token authenticates nothing, so the hub is refused");
        connection.State.Should().Be(HubConnectionState.Disconnected);
    }

    [RequiresDockerFact]
    public async Task StaffSession_OnTheConsoleHost_ConnectsAndReceivesItsSessionsExerciseEvents()
    {
        // identity-auth-roles/15 AC (realtime scope on the shared console host): the console host resolves NO
        // exercise. A staff connection there is scoped from its session's exercise, verified against a live staff
        // enrollment, and receives that exercise's staff and participant pushes.
        var exercise = await SeedExerciseAsync();
        var staffToken = await SeedStaffSessionAsync(activeExerciseId: exercise.Id, assignedTo: [exercise.Id]);

        using var host = new RealtimeRoleHost(_fixture.ConnectionString!);
        await using var console = await ConnectAsync(host, $"console-{Guid.NewGuid():N}.example.com", staffToken);
        await console.WaitUntilInGroupAsync(host, $"exercise:{exercise.Id}:staff");

        var draft = await BroadcastReviewItemAsync(host, exercise.Id);
        var post = await BroadcastPostAsync(host, exercise.Id);
        await console.WaitForAsync(PostReceived, post);

        console.Frames.Should().Equal(new[] { (ReviewItemChanged, draft), (PostReceived, post) });
    }

    private static async Task AssertRefusedAsync(RealtimeRoleHost host, string hostname, string token)
    {
        await using var connection = BuildConnection(host, hostname, token, tokenInQuery: false);

        var closed = new TaskCompletionSource<Exception?>(TaskCreationOptions.RunContinuationsAsynchronously);
        connection.Closed += ex =>
        {
            closed.TrySetResult(ex);
            return Task.CompletedTask;
        };

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
            var completed = await Task.WhenAny(closed.Task, Task.Delay(DeliveryTimeout));
            completed.Should().Be(closed.Task, "a refused connection must be aborted, not left open");
        }

        connection.State.Should().NotBe(HubConnectionState.Connected);
    }

    private static async Task<RecordingConnection> ConnectAsync(
        RealtimeRoleHost host, string hostname, string token, bool tokenInQuery = false)
    {
        var connection = BuildConnection(host, hostname, token, tokenInQuery);
        var recording = new RecordingConnection(connection);
        await connection.StartAsync();
        connection.State.Should().Be(HubConnectionState.Connected, "a live session on a provisioned host connects");
        await recording.WaitUntilOnConnectedCompletedAsync();
        return recording;
    }

    /// <summary>
    /// A client connection to <paramref name="hostname"/>'s hub over the in-memory TestServer. The request host
    /// drives the REAL host → exercise resolution. The token travels in the <c>Authorization</c> header (as the
    /// client does for negotiate/long polling) or, with <paramref name="tokenInQuery"/>, ONLY as
    /// <c>?access_token=</c> (as a browser WebSocket upgrade must).
    /// </summary>
    private static HubConnection BuildConnection(RealtimeRoleHost host, string hostname, string token, bool tokenInQuery)
    {
        var url = tokenInQuery
            ? new Uri($"http://{hostname}/hubs/exercise?access_token={Uri.EscapeDataString(token)}")
            : new Uri($"http://{hostname}/hubs/exercise");

        return new HubConnectionBuilder()
            .WithUrl(url, options =>
            {
                options.HttpMessageHandlerFactory = _ => host.Server.CreateHandler();
                options.Transports = HttpTransportType.LongPolling;
                if (!tokenInQuery)
                {
                    options.AccessTokenProvider = () => Task.FromResult<string?>(token);
                }
            })
            .Build();
    }

    /// <summary>Pushes a review item through the real <see cref="IEngineReviewBroadcaster"/>; returns its draft id.</summary>
    private static async Task<string> BroadcastReviewItemAsync(RealtimeRoleHost host, Guid exerciseId)
    {
        var item = new EngineReviewItemDto
        {
            ExerciseId = exerciseId.ToString(),
            StorylineId = Guid.NewGuid().ToString(),
            DraftId = Guid.NewGuid().ToString(),
            RoutedAtLevel = AutonomyLevel.Suggest,
            Disposition = DraftDisposition.Held,
            Posts = Array.Empty<GeneratedPostDto>(),
            StorylineTag = "#WaterIssues",
            StorylineBrief = "Unpublished engine draft — staff only.",
            ActionLabel = "reply → @mvega_fh",
        };

        await using var scope = host.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<IEngineReviewBroadcaster>()
            .BroadcastReviewItemChangedAsync(exerciseId, item);
        return item.DraftId;
    }

    /// <summary>Pushes a post through the real <see cref="IFeedBroadcaster"/>; returns its id.</summary>
    private static async Task<string> BroadcastPostAsync(RealtimeRoleHost host, Guid exerciseId)
    {
        var post = new ParticipantPostDto
        {
            Id = Guid.NewGuid().ToString(),
            AuthorPersonaId = Guid.NewGuid().ToString(),
            Text = "Boil-water advisory lifted for the Riverside district.",
            ScenarioTime = new DateTimeOffset(2033, 9, 4, 14, 5, 0, TimeSpan.Zero).ToString("O"),
            Counts = new ParticipantPostCounts(0, 0, 0),
        };

        await using var scope = host.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<IFeedBroadcaster>().BroadcastPostAsync(exerciseId, post);
        return post.Id;
    }

    private async Task<(Guid Id, string Hostname)> SeedExerciseAsync()
    {
        var exerciseId = Guid.NewGuid();
        var hostname = $"rt-role-{exerciseId:N}.example.com";

        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = exerciseId,
            Name = $"Realtime role {exerciseId:N}",
            Hostname = hostname,
            TimeZone = "UTC",
            Status = "live",
        });
        await seed.SaveChangesAsync();
        return (exerciseId, hostname);
    }

    private async Task<string> SeedParticipantSessionAsync(Guid exerciseId)
    {
        var token = $"rt-participant-{Guid.NewGuid():N}";
        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(TestSessions.NewSession(token, exerciseId));
        await seed.SaveChangesAsync();
        return token;
    }

    /// <summary>A live staff session (active on <paramref name="activeExerciseId"/>) for a staff user assigned to <paramref name="assignedTo"/>.</summary>
    private async Task<string> SeedStaffSessionAsync(Guid activeExerciseId, Guid[] assignedTo, Action<Session>? configure = null)
    {
        var token = $"rt-staff-{Guid.NewGuid():N}";
        var staffUserId = Guid.NewGuid();
        var session = TestSessions.NewSession(token, activeExerciseId, kind: "staff");
        session.StaffUserId = staffUserId;
        session.PrincipalId = staffUserId.ToString();
        configure?.Invoke(session);

        await using var seed = _fixture.CreateContext();
        seed.StaffUsers.Add(StaffTenantSeed.StaffUserFor(staffUserId));
        foreach (var exerciseId in assignedTo)
        {
            seed.Enrollments.Add(new Enrollment
            {
                Id = Guid.NewGuid(),
                PersonId = staffUserId,
                ExerciseId = exerciseId,
                Role = "controller",
                CreatedAt = DateTimeOffset.UtcNow,
            });
        }

        seed.Sessions.Add(session);
        await seed.SaveChangesAsync();
        return token;
    }

    /// <summary>
    /// A started client connection that records every <c>ReviewItemChanged</c> / <c>PostReceived</c> frame it
    /// receives, in arrival order, as (event, id) pairs.
    /// </summary>
    private sealed class RecordingConnection : IAsyncDisposable
    {
        /// <summary>Test-only readiness event; never recorded in <see cref="Frames"/>.</summary>
        private const string ReadinessProbe = "B5ReadinessProbe";

        /// <summary>A hub method name that does not exist — invoked only as the OnConnectedAsync barrier.</summary>
        private const string OnConnectedBarrierMethod = "B5OnConnectedBarrierNoSuchMethod";

        private readonly HubConnection _connection;
        private readonly List<(string Event, string Id)> _frames = new();
        private readonly ConcurrentDictionary<string, byte> _probesReceived = new(StringComparer.Ordinal);

        public RecordingConnection(HubConnection connection)
        {
            _connection = connection;
            _connection.On<JsonElement>(ReviewItemChanged, payload => Record(ReviewItemChanged, payload, "draftId"));
            _connection.On<JsonElement>(PostReceived, payload => Record(PostReceived, payload, "id"));
            _connection.On<string>(ReadinessProbe, nonce => _probesReceived.TryAdd(nonce, 0));
        }

        /// <summary>
        /// Waits until the hub's <c>OnConnectedAsync</c> has RETURNED for this connection — i.e. every group join
        /// (exercise-wide and, if verified, staff) has been decided and made. SignalR reads a connection's
        /// invocations only after <c>OnConnectedAsync</c> completes, so the server's error completion for a
        /// method the hub does not expose cannot arrive earlier. The connection stays open afterwards.
        /// </summary>
        public async Task WaitUntilOnConnectedCompletedAsync()
        {
            var barrier = async () => await _connection.InvokeAsync(OnConnectedBarrierMethod);

            (await barrier.Should().ThrowAsync<HubException>(
                    "the hub exposes no client-invocable method, so the barrier invocation completes with an error"))
                .WithMessage("*Method does not exist*");
            _connection.State.Should().Be(HubConnectionState.Connected, "a failed invocation does not close the connection");
        }

        /// <summary>
        /// Waits until this connection has joined <paramref name="groupName"/>: repeatedly sends a nonce probe to
        /// that group until this connection receives it. Fails if it never does within the delivery timeout.
        /// </summary>
        public async Task WaitUntilInGroupAsync(RealtimeRoleHost host, string groupName)
        {
            var hubContext = host.Services.GetRequiredService<IHubContext<ExerciseRealtimeHub>>();
            var nonce = Guid.NewGuid().ToString();
            var deadline = DateTime.UtcNow + DeliveryTimeout;
            while (DateTime.UtcNow < deadline)
            {
                await hubContext.Clients.Group(groupName).SendAsync(ReadinessProbe, nonce);
                for (var i = 0; i < 4; i++)
                {
                    if (_probesReceived.ContainsKey(nonce))
                    {
                        return;
                    }

                    await Task.Delay(25);
                }
            }

            _probesReceived.ContainsKey(nonce).Should().BeTrue($"the connection should have joined {groupName} within {DeliveryTimeout}");
        }

        public IReadOnlyList<(string Event, string Id)> Frames
        {
            get
            {
                lock (_frames)
                {
                    return _frames.ToList();
                }
            }
        }

        public async Task WaitForAsync(string eventName, string id)
        {
            var deadline = DateTime.UtcNow + DeliveryTimeout;
            while (DateTime.UtcNow < deadline)
            {
                if (Frames.Contains((eventName, id)))
                {
                    return;
                }

                await Task.Delay(25);
            }

            Frames.Should().Contain((eventName, id), $"{eventName} {id} should have been delivered within {DeliveryTimeout}");
        }

        public HubConnection Connection => _connection;

        public ValueTask DisposeAsync() => _connection.DisposeAsync();

        private void Record(string eventName, JsonElement payload, string idProperty)
        {
            var id = payload.TryGetProperty(idProperty, out var value) ? value.GetString() ?? string.Empty : string.Empty;
            lock (_frames)
            {
                _frames.Add((eventName, id));
            }
        }
    }

    /// <summary>
    /// The real <c>Program</c> host pointed at the fixture's migrated database — no service overrides, so host
    /// resolution, session authentication, the default-deny gate and the hub all run exactly as in production.
    /// </summary>
    private sealed class RealtimeRoleHost : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

        public RealtimeRoleHost(string connectionString)
            => Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}
