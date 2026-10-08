namespace Pulse.WebApi.Tests.Features.Realtime;

using System;
using System.Collections.Generic;
using System.Data.Common;
using System.Linq;
using System.Reflection;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Realtime;
// The feature key HubCallerContext.GetHttpContext() looks up is SignalR's connection-layer
// IHttpContextFeature (Microsoft.AspNetCore.Http.Connections.Features), NOT the plain HTTP one — aliased to
// keep it unambiguous alongside Microsoft.AspNetCore.Http.Features (FeatureCollection).
using SignalRHttpContextFeature = Microsoft.AspNetCore.Http.Connections.Features.IHttpContextFeature;

/// <summary>
/// Fast, Docker-free unit tests of <see cref="ExerciseRealtimeHub"/>'s group-membership logic — story
/// <c>social-api/03</c> (#272)'s <b>[Tier-2 — always-Critical isolation class]</b> AC, and part of the
/// standing cross-exercise isolation suite (<c>exercise-isolation/07</c>, COR-007; cross-references
/// <c>Data/QueryFilterIsolationTests.cs</c>, the same guarantee's read-side proof).
/// </summary>
/// <remarks>
/// The hub resolves its exercise from the connection's host-resolved <c>HttpContext</c>
/// (<c>Context.GetHttpContext()?.GetHostResolvedExerciseId()</c>), NOT an injected scoped
/// <see cref="IExerciseContext"/> — because SignalR dispatches <c>OnConnectedAsync</c> in its own DI scope
/// where that injected context would always be unset. These tests therefore mock the base <see cref="Hub"/>'s
/// <c>Context</c> (a <see cref="HubCallerContext"/>) and expose a <see cref="DefaultHttpContext"/> through its
/// <c>Features</c> (the <see cref="IHttpContextFeature"/> that backs <c>Context.GetHttpContext()</c>), stamping
/// the host-resolved exercise id on it exactly as <c>ExerciseResolutionMiddleware</c> does — no TestServer, no
/// network, no SignalR client, no container. Combined with <see cref="SignalRFeedBroadcasterTests"/> (the
/// broadcaster targets EXACTLY <c>exercise:{exerciseId}</c> and no other group) and
/// <see cref="ExerciseRealtimeHubIsolationTests.Hub_ExposesNoClientInvocableMethod_ThatAcceptsAGroupOrExerciseId"/>
/// (no client-invocable method exists to request a different group), these three pieces together prove
/// the full isolation chain: a connection joins EXACTLY the group its server-resolved scope derives,
/// deterministically and injectively per exercise, a broadcast targets EXACTLY that same derivation for
/// its own exercise, and no client input can influence either side.
/// <para>
/// <b>Role dimension (demo-polish B5, home story social-api/05).</b> The role tests below prove the
/// Docker-free half of the staff-group rule: a participant, shared read-only, anonymous, staff-without-a-staff-user
/// or client-ASSERTED "staff" connection joins ONLY <c>exercise:{id}</c>, and does so without any database
/// work — every hub here is built over <see cref="NoDatabaseContext"/>, whose connection interceptor throws if
/// a query is ever attempted, so a role decision that leaked into the database on a non-staff path would fail
/// loudly. The positive staff path (a verified, assigned staff session) needs the persisted session and
/// assignment rows and is proven over real SQL in <see cref="ExerciseRealtimeHubStaffGroupTests"/> and,
/// end-to-end, in <see cref="ExerciseRealtimeHubRoleIsolationTests"/>.
/// </para>
/// </remarks>
public class ExerciseRealtimeHubTests
{
    private const string ConnectionId = "test-connection-1";

    [Fact]
    public async Task OnConnectedAsync_ResolvedScope_JoinsExactlyTheExercisesGroup_AndDoesNotAbort()
    {
        var exerciseId = Guid.NewGuid();
        var context = BuildHubContext(hostResolvedExerciseId: exerciseId);
        var groups = new Mock<IGroupManager>();

        var hub = new ExerciseRealtimeHub(NoDatabaseContext())
        {
            Context = context.Object,
            Groups = groups.Object,
        };

        await hub.OnConnectedAsync();

        groups.Verify(
            g => g.AddToGroupAsync(ConnectionId, $"exercise:{exerciseId}", It.IsAny<CancellationToken>()),
            Times.Once,
            "the connection must join exactly the group derived from its host-resolved exercise scope");
        context.Verify(c => c.Abort(), Times.Never, "a resolved scope must never abort the connection");
    }

    [Fact]
    public async Task OnConnectedAsync_NoHostResolved_Aborts_NeverJoinsAnyGroup()
    {
        // The host did not resolve to an exercise: the middleware stamped nothing on HttpContext.Items, so
        // GetHostResolvedExerciseId() returns null — the shipped fail-closed default.
        var context = BuildHubContext(hostResolvedExerciseId: null);
        var groups = new Mock<IGroupManager>();

        var hub = new ExerciseRealtimeHub(NoDatabaseContext())
        {
            Context = context.Object,
            Groups = groups.Object,
        };

        await hub.OnConnectedAsync();

        context.Verify(c => c.Abort(), Times.Once, "an unresolved (null) host scope must abort the connection — fail closed");
        groups.Verify(
            g => g.AddToGroupAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Never,
            "an aborted connection must never be added to any group, ambient or otherwise");
    }

    [Fact]
    public async Task OnConnectedAsync_NoHttpContext_Aborts_NeverJoinsAnyGroup()
    {
        // Context.GetHttpContext() itself yields null (no IHttpContextFeature) — the null-conditional read
        // must still fail closed, never join an ambient group.
        var context = new Mock<HubCallerContext>();
        context.SetupGet(c => c.ConnectionId).Returns(ConnectionId);
        context.SetupGet(c => c.Features).Returns(new FeatureCollection());
        var groups = new Mock<IGroupManager>();

        var hub = new ExerciseRealtimeHub(NoDatabaseContext())
        {
            Context = context.Object,
            Groups = groups.Object,
        };

        await hub.OnConnectedAsync();

        context.Verify(c => c.Abort(), Times.Once, "a connection with no HttpContext must abort — fail closed");
        groups.Verify(
            g => g.AddToGroupAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task OnConnectedAsync_ExplicitGuidEmptyScope_Aborts_NeverJoinsAnyGroup()
    {
        // A distinct fail-closed shape from "no host resolved" (mirrors QueryFilterIsolationTests' own
        // coverage of this same distinction on the read-side filter) — guards against a future refactor of
        // the hub's null-check silently admitting Guid.Empty as if it were a valid scope.
        var context = BuildHubContext(hostResolvedExerciseId: Guid.Empty);
        var groups = new Mock<IGroupManager>();

        var hub = new ExerciseRealtimeHub(NoDatabaseContext())
        {
            Context = context.Object,
            Groups = groups.Object,
        };

        await hub.OnConnectedAsync();

        context.Verify(c => c.Abort(), Times.Once, "an explicit Guid.Empty scope must abort — fail closed, never an ambient/default group");
        groups.Verify(
            g => g.AddToGroupAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task OnConnectedAsync_DistinctExerciseScopes_JoinDistinctGroups_NeverTheSameGroup()
    {
        // The injectivity property the whole isolation chain leans on: two different exercises must
        // never collide onto the same group name.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();

        async Task<string?> JoinAndCaptureGroupAsync(Guid exerciseId)
        {
            var context = BuildHubContext(hostResolvedExerciseId: exerciseId);

            string? capturedGroup = null;
            var groups = new Mock<IGroupManager>();
            groups
                .Setup(g => g.AddToGroupAsync(ConnectionId, It.IsAny<string>(), It.IsAny<CancellationToken>()))
                .Callback<string, string, CancellationToken>((_, groupName, _) => capturedGroup = groupName)
                .Returns(Task.CompletedTask);

            var hub = new ExerciseRealtimeHub(NoDatabaseContext()) { Context = context.Object, Groups = groups.Object };
            await hub.OnConnectedAsync();
            return capturedGroup;
        }

        var groupJoinedByA = await JoinAndCaptureGroupAsync(exerciseA);
        var groupJoinedByB = await JoinAndCaptureGroupAsync(exerciseB);

        groupJoinedByA.Should().NotBeNullOrEmpty();
        groupJoinedByB.Should().NotBeNullOrEmpty();
        groupJoinedByA.Should().NotBe(groupJoinedByB, "two different exercises must never resolve to the same group");
    }

    [Fact]
    public void Hub_ExposesNoClientInvocableMethod_ThatAcceptsAGroupOrExerciseId()
    {
        // Duplicated (deliberately) alongside ExerciseRealtimeHubIsolationTests' copy of this same
        // assertion: it is cheap, structural, and belongs next to the OnConnectedAsync behavioural proof
        // above just as much as next to the E2E suite below.
        var clientInvocableMethods = typeof(ExerciseRealtimeHub)
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => !m.IsSpecialName)
            .Where(m => m.Name is not (nameof(Hub.OnConnectedAsync) or nameof(Hub.OnDisconnectedAsync)))
            .ToList();

        clientInvocableMethods.Should().BeEmpty(
            "the hub must expose NO client-invocable method a client could use to join or read another " +
            "exercise's group — group membership is derived from the server-side host-resolved HttpContext only");
    }

    [Theory]
    [InlineData("participant")]
    [InlineData("readonly")]
    public async Task OnConnectedAsync_NonStaffSession_JoinsOnlyTheExerciseGroup_NeverTheStaffGroup(string kind)
    {
        // B5 AC2: participant and shared read-only sessions join ONLY exercise:{id}. Built over a context that
        // throws on any query, so this also proves a non-staff connection costs no database work.
        var exerciseId = Guid.NewGuid();
        var context = BuildHubContext(exerciseId, http => http.User = SessionPrincipal.Create(Session(exerciseId, kind)));
        var groups = new RecordingGroupManager();

        var hub = new ExerciseRealtimeHub(NoDatabaseContext()) { Context = context.Object, Groups = groups };
        await hub.OnConnectedAsync();

        groups.Joined.Should().Equal(
            new[] { $"exercise:{exerciseId}" },
            $"a {kind} session joins only its exercise-wide group — never exercise:{{id}}:staff");
        context.Verify(c => c.Abort(), Times.Never);
    }

    [Fact]
    public async Task OnConnectedAsync_AnonymousConnection_JoinsOnlyTheExerciseGroup_NeverTheStaffGroup()
    {
        // No principal at all. The default-deny gate refuses this upstream (identity-auth-roles/11, out of scope
        // here); the hub's own contribution is that an unidentified connection is never staff.
        var exerciseId = Guid.NewGuid();
        var context = BuildHubContext(hostResolvedExerciseId: exerciseId);
        var groups = new RecordingGroupManager();

        var hub = new ExerciseRealtimeHub(NoDatabaseContext()) { Context = context.Object, Groups = groups };
        await hub.OnConnectedAsync();

        groups.Joined.Should().Equal(new[] { $"exercise:{exerciseId}" }, "an anonymous connection is never staff");
    }

    [Fact]
    public async Task OnConnectedAsync_ClientAssertedStaffRole_InQueryHeaderOrClaims_NeverJoinsTheStaffGroup()
    {
        // B5 AC1: "staff" comes ONLY from the server-resolved session. A participant session that also sends
        // every client-controllable staff hint — query values, headers, and a SECOND identity carrying staff
        // claims that the session middleware never issued — still joins only the exercise-wide group.
        var exerciseId = Guid.NewGuid();
        var context = BuildHubContext(exerciseId, http =>
        {
            http.Request.QueryString = new QueryString(
                $"?role=staff&kind=staff&staff=true&group=exercise:{exerciseId}:staff&exerciseId={exerciseId}");
            http.Request.Headers["X-Pulse-Role"] = "staff";
            http.Request.Headers["X-Pulse-Session-Kind"] = "staff";

            var principal = SessionPrincipal.Create(Session(exerciseId, "participant"));
            principal.AddIdentity(new ClaimsIdentity(
                new[]
                {
                    new Claim(SessionPrincipal.SessionKindClaimType, "staff"),
                    new Claim(SessionPrincipal.StaffUserIdClaimType, Guid.NewGuid().ToString()),
                },
                authenticationType: "ClientAsserted"));
            http.User = principal;
        });
        var groups = new RecordingGroupManager();

        var hub = new ExerciseRealtimeHub(NoDatabaseContext()) { Context = context.Object, Groups = groups };
        await hub.OnConnectedAsync();

        groups.Joined.Should().Equal(
            new[] { $"exercise:{exerciseId}" },
            "no query value, header or non-session identity can make a connection staff");
    }

    [Fact]
    public async Task OnConnectedAsync_StaffClaimsOnANonSessionIdentity_NeverJoinsTheStaffGroup()
    {
        // A principal that LOOKS like a staff session (every claim present) but was not issued by the session
        // middleware (wrong authentication type) is not a session at all — SessionPrincipal.Read refuses it.
        var exerciseId = Guid.NewGuid();
        var forged = new ClaimsPrincipal(new ClaimsIdentity(
            SessionPrincipal.Create(Session(exerciseId, "staff", staffUserId: Guid.NewGuid())).Claims,
            authenticationType: "Forged"));
        var context = BuildHubContext(exerciseId, http => http.User = forged);
        var groups = new RecordingGroupManager();

        var hub = new ExerciseRealtimeHub(NoDatabaseContext()) { Context = context.Object, Groups = groups };
        await hub.OnConnectedAsync();

        groups.Joined.Should().Equal(new[] { $"exercise:{exerciseId}" }, "a non-session identity is never staff");
    }

    [Fact]
    public async Task OnConnectedAsync_StaffKindSessionWithNoStaffUser_NeverJoinsTheStaffGroup()
    {
        // A staff-kind session must be bound to a StaffUser (the CurrentStaffSessionAccessor rule). Without one
        // there is nobody whose assignments could be checked — fail closed, before any database work.
        var exerciseId = Guid.NewGuid();
        var context = BuildHubContext(exerciseId, http => http.User = SessionPrincipal.Create(Session(exerciseId, "staff")));
        var groups = new RecordingGroupManager();

        var hub = new ExerciseRealtimeHub(NoDatabaseContext()) { Context = context.Object, Groups = groups };
        await hub.OnConnectedAsync();

        groups.Joined.Should().Equal(new[] { $"exercise:{exerciseId}" }, "a staff session with no staff user is never staff");
    }

    [Fact]
    public async Task OnConnectedAsync_UnresolvedHost_WithAStaffSession_StillAborts_NeverJoinsAnyGroup()
    {
        // B5 AC6: the role dimension does not weaken the scope rule — no host-resolved exercise, no group, even
        // for a staff session (staff sessions are not host-bound for REST, but the hub's groups are).
        var context = BuildHubContext(
            hostResolvedExerciseId: null,
            http => http.User = SessionPrincipal.Create(Session(Guid.NewGuid(), "staff", staffUserId: Guid.NewGuid())));
        var groups = new RecordingGroupManager();

        var hub = new ExerciseRealtimeHub(NoDatabaseContext()) { Context = context.Object, Groups = groups };
        await hub.OnConnectedAsync();

        context.Verify(c => c.Abort(), Times.Once, "an unresolved host must abort the connection — fail closed");
        groups.Joined.Should().BeEmpty("an aborted connection joins neither the exercise group nor the staff group");
    }

    [Fact]
    public async Task OnConnectedAsync_StaffCheckFails_JoinsTheExerciseGroupFirst_NeverTheStaffGroup_AndPropagates()
    {
        // Ordering (Gate-1 L-5): the exercise-wide join happens BEFORE the staff check, so PostReceived timing is
        // never held up by it. A staff-kind principal sends the check to the database, which here throws on open.
        // The check must fail CLOSED: the error propagates out of OnConnectedAsync (SignalR then closes the
        // connection and removes it from every group) and the staff join is never reached.
        var exerciseId = Guid.NewGuid();
        var context = BuildHubContext(
            exerciseId,
            http => http.User = SessionPrincipal.Create(Session(exerciseId, "staff", staffUserId: Guid.NewGuid())));
        var groups = new RecordingGroupManager();

        var hub = new ExerciseRealtimeHub(NoDatabaseContext()) { Context = context.Object, Groups = groups };
        var connect = async () => await hub.OnConnectedAsync();

        await connect.Should().ThrowAsync<InvalidOperationException>(
            "a staff check that cannot complete must propagate, never be treated as verified");
        groups.Joined.Should().Equal(
            new[] { $"exercise:{exerciseId}" },
            "the exercise-wide join precedes the check; a failed check never joins exercise:{id}:staff");
    }

    [Fact]
    public void Constructor_NullDbContext_Throws()
    {
        var act = () => new ExerciseRealtimeHub(null!);

        act.Should().Throw<ArgumentNullException>();
    }

    /// <summary>A live session's resolved facts, as <see cref="SessionAuthenticationMiddleware"/> would project them.</summary>
    private static AuthenticatedSession Session(Guid exerciseId, string kind, Guid? staffUserId = null) => new()
    {
        SessionId = Guid.NewGuid(),
        ExerciseId = exerciseId,
        Kind = kind,
        StaffUserId = staffUserId,
        PrincipalId = $"principal-{Guid.NewGuid():N}",
        ActingHumanId = $"human-{Guid.NewGuid():N}",
    };

    /// <summary>
    /// A <see cref="PulseDbContext"/> that can be CONSTRUCTED (the hub requires one) but never queried: any
    /// attempt to open its connection throws. A non-staff connection must decide its groups without the
    /// database, so these Docker-free tests fail loudly if that ever stops being true.
    /// </summary>
    private static PulseDbContext NoDatabaseContext()
    {
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer("Server=hub-unit-tests-never-connect;Database=pulse;")
            .AddInterceptors(new ThrowOnOpenConnectionInterceptor())
            .Options;

        return new PulseDbContext(options);
    }

    /// <summary>
    /// Builds a mocked <see cref="HubCallerContext"/> that exposes a <see cref="DefaultHttpContext"/> through
    /// its <c>Features</c> (an <see cref="IHttpContextFeature"/>), so <c>Context.GetHttpContext()</c> returns
    /// it. When <paramref name="hostResolvedExerciseId"/> is supplied it is stamped on the HttpContext exactly
    /// as <c>ExerciseResolutionMiddleware</c> does; when <c>null</c>, nothing is stamped (an unresolved host).
    /// <paramref name="configure"/> may then set the connection request's principal, query and headers.
    /// </summary>
    private static Mock<HubCallerContext> BuildHubContext(Guid? hostResolvedExerciseId, Action<DefaultHttpContext>? configure = null)
    {
        var httpContext = new DefaultHttpContext();
        if (hostResolvedExerciseId is { } exerciseId)
        {
            httpContext.SetHostResolvedExerciseId(exerciseId);
        }

        configure?.Invoke(httpContext);

        // Back Context.GetHttpContext() (which reads Features.Get<IHttpContextFeature>()?.HttpContext) with a
        // feature exposing our DefaultHttpContext — exactly what the SignalR connection layer does live.
        var httpContextFeature = new Mock<SignalRHttpContextFeature>();
        httpContextFeature.SetupGet(f => f.HttpContext).Returns(httpContext);

        var features = new FeatureCollection();
        features.Set<SignalRHttpContextFeature>(httpContextFeature.Object);

        var context = new Mock<HubCallerContext>();
        context.SetupGet(c => c.ConnectionId).Returns(ConnectionId);
        context.SetupGet(c => c.Features).Returns(features);
        return context;
    }

    /// <summary>Records every group the hub adds the connection to, in order.</summary>
    private sealed class RecordingGroupManager : IGroupManager
    {
        public List<string> Joined { get; } = new();

        public Task AddToGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default)
        {
            connectionId.Should().Be(ConnectionId);
            Joined.Add(groupName);
            return Task.CompletedTask;
        }

        public Task RemoveFromGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default)
            => Task.CompletedTask;
    }

    /// <summary>Fails any attempt to open a database connection (see <see cref="NoDatabaseContext"/>).</summary>
    private sealed class ThrowOnOpenConnectionInterceptor : DbConnectionInterceptor
    {
        public override InterceptionResult ConnectionOpening(
            DbConnection connection, ConnectionEventData eventData, InterceptionResult result)
            => throw new InvalidOperationException("This hub path must not touch the database.");

        public override ValueTask<InterceptionResult> ConnectionOpeningAsync(
            DbConnection connection,
            ConnectionEventData eventData,
            InterceptionResult result,
            CancellationToken cancellationToken = default)
            => throw new InvalidOperationException("This hub path must not touch the database.");
    }
}
