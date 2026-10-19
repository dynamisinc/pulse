namespace Pulse.WebApi.Tests.Features.Realtime;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Pulse.WebApi.Tests.Helpers;
using SignalRHttpContextFeature = Microsoft.AspNetCore.Http.Connections.Features.IHttpContextFeature;

/// <summary>
/// The staff-verification half of <see cref="ExerciseRealtimeHub"/>'s role-scoped group rule (demo-polish B5,
/// home story social-api/05; XC-002, COR-001, COR-005) over REAL SQL Server. Each test drives
/// <c>OnConnectedAsync</c> directly — the connection request's server-resolved principal on a
/// <see cref="DefaultHttpContext"/>, exactly as <c>SessionAuthenticationMiddleware</c> leaves it — against a hub
/// built over a context with NO exercise scope (the hub's own SignalR DI scope never carries one), and records
/// the exact set of groups the connection joins.
/// </summary>
/// <remarks>
/// Proves the decision is the persisted session + assignment, not the principal's say-so: a staff principal
/// whose session row is revoked, expired, missing or names a different staff user, or whose staff user is not
/// assigned to the host-resolved exercise (or is assigned only across a tenant boundary), joins ONLY
/// <c>exercise:{id}</c>. The Docker-free non-staff cases live in <see cref="ExerciseRealtimeHubTests"/>; the
/// over-the-wire proof lives in <see cref="ExerciseRealtimeHubRoleIsolationTests"/>.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class ExerciseRealtimeHubStaffGroupTests
{
    private const string ConnectionId = "staff-group-connection";

    private readonly MsSqlContainerFixture _fixture;

    public ExerciseRealtimeHubStaffGroupTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task LiveStaffSession_AssignedToTheHostResolvedExercise_JoinsTheExerciseGroupAndItsStaffGroup()
    {
        // B5 AC2: a verified staff connection joins exercise:{id} AND exercise:{id}:staff — same exercise id.
        var exerciseA = await SeedExerciseAsync();
        var staff = await SeedStaffAsync(assignedTo: [exerciseA]);

        var joined = await ConnectAsync(exerciseA, staff.Principal);

        joined.Should().Equal(
            new[] { $"exercise:{exerciseA}", $"exercise:{exerciseA}:staff" },
            "a live staff session enrolled in its session's exercise joins that exercise's group and its staff group");
    }

    [RequiresDockerFact]
    public async Task StaffSession_OnTheConsoleHost_JoinsItsSessionsExercise()
    {
        // identity-auth-roles/15 AC (realtime scope on the console host): the shared console host resolves NO
        // exercise; a staff connection is scoped from its session's ExerciseId, verified against a live enrollment.
        var exerciseA = await SeedExerciseAsync();
        var staff = await SeedStaffAsync(assignedTo: [exerciseA]);

        var (joined, aborted) = await ConnectWithAbortAsync(hostResolvedExerciseId: null, staff.Principal);

        aborted.Should().BeFalse("a verified staff session needs no host-resolved exercise");
        joined.Should().Equal(new[] { $"exercise:{exerciseA}", $"exercise:{exerciseA}:staff" });
    }

    [RequiresDockerFact]
    public async Task StaffAssignedToTwoExercises_JoinsOnlyItsSessionsExercise_NeverTheHostsOrTheOther()
    {
        // identity-auth-roles/15 (supersedes B5's host-derived staff group): the session is ACTIVE ON B
        // (SeedStaffAsync binds the session to the first assignment) while the connection arrives on A's host. The
        // session wins (session > host, as for REST): B's groups only, never A's.
        var exerciseA = await SeedExerciseAsync();
        var exerciseB = await SeedExerciseAsync();
        var staff = await SeedStaffAsync(assignedTo: [exerciseB, exerciseA]);

        var joined = await ConnectAsync(exerciseA, staff.Principal);

        joined.Should().Equal(new[] { $"exercise:{exerciseB}", $"exercise:{exerciseB}:staff" });
        joined.Should().NotContain(
            group => group.Contains(exerciseA.ToString(), StringComparison.OrdinalIgnoreCase),
            "a staff connection joins its session's exercise only — the host never adds a second exercise");
    }

    [RequiresDockerFact]
    public async Task StaffSession_BoundToAnExerciseWithoutALiveStaffEnrollment_IsAborted()
    {
        // The session names exercise A but the staff user is enrolled only in B: unverifiable → refused (fail closed).
        var exerciseA = await SeedExerciseAsync();
        var exerciseB = await SeedExerciseAsync();
        var staff = await SeedStaffAsync(assignedTo: [exerciseB], configure: s => s.ExerciseId = exerciseA);

        var (joined, aborted) = await ConnectWithAbortAsync(exerciseA, staff.Principal);

        aborted.Should().BeTrue();
        joined.Should().BeEmpty("no live staff enrollment on the session's exercise — no group at all");
    }

    [RequiresDockerFact]
    public async Task OrgScopeSession_IsRefusedByTheHub()
    {
        // identity-auth-roles/15 AC: an org-scope session (ExerciseId null) has no exercise to be scoped to.
        var exerciseA = await SeedExerciseAsync();
        var staff = await SeedStaffAsync(assignedTo: [exerciseA], configure: s => { s.ExerciseId = null; s.Role = "orgAdmin"; });

        var (joined, aborted) = await ConnectWithAbortAsync(hostResolvedExerciseId: null, staff.Principal);
        var (joinedOnHost, abortedOnHost) = await ConnectWithAbortAsync(exerciseA, staff.Principal);

        aborted.Should().BeTrue();
        joined.Should().BeEmpty();
        abortedOnHost.Should().BeTrue("an exercise host never lends an org-scope session an exercise");
        joinedOnHost.Should().BeEmpty();
    }

    [RequiresDockerTheory]
    [InlineData("revoked")]
    [InlineData("expired")]
    [InlineData("participant-kind-row")]
    public async Task UnverifiableStaffSessionRow_IsAborted_JoinsNoGroup(string defect)
    {
        // B5 AC6: the persisted row is re-verified — a revoked / expired / non-staff row is never staff, and
        // (identity-auth-roles/15) a staff-kind principal never falls back to the host's exercise group.
        var exerciseA = await SeedExerciseAsync();
        Action<Session> configure = defect switch
        {
            "revoked" => s => s.RevokedAt = DateTimeOffset.UtcNow.AddSeconds(-1),
            "expired" => s => s.ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1),
            _ => s => s.Kind = "participant",
        };
        var staff = await SeedStaffAsync(assignedTo: [exerciseA], configure: configure);

        var (joined, aborted) = await ConnectWithAbortAsync(exerciseA, staff.Principal);

        aborted.Should().BeTrue();
        joined.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task StaffPrincipal_WithNoPersistedSession_IsAborted()
    {
        // A staff-shaped principal naming a session id that does not exist — the decision is the persisted session.
        var exerciseA = await SeedExerciseAsync();
        var staff = await SeedStaffAsync(assignedTo: [exerciseA]);
        var phantom = SessionPrincipal.Create(new AuthenticatedSession
        {
            SessionId = Guid.NewGuid(),
            ExerciseId = exerciseA,
            Kind = "staff",
            StaffUserId = staff.StaffUserId,
            PrincipalId = staff.StaffUserId.ToString(),
            ActingHumanId = $"human-{Guid.NewGuid():N}",
        });

        var (joined, aborted) = await ConnectWithAbortAsync(exerciseA, phantom);

        aborted.Should().BeTrue();
        joined.Should().BeEmpty("a principal with no persisted live session is never staff");
    }

    [RequiresDockerFact]
    public async Task StaffPrincipal_NamingADifferentStaffUserThanItsSession_IsAborted()
    {
        var exerciseA = await SeedExerciseAsync();
        var staff = await SeedStaffAsync(assignedTo: [exerciseA]);
        var otherStaff = await SeedStaffAsync(assignedTo: [exerciseA]);
        var mismatched = SessionPrincipal.Create(new AuthenticatedSession
        {
            SessionId = staff.SessionId,
            ExerciseId = exerciseA,
            Kind = "staff",
            StaffUserId = otherStaff.StaffUserId,
            PrincipalId = otherStaff.StaffUserId.ToString(),
            ActingHumanId = $"human-{Guid.NewGuid():N}",
        });

        var (joined, aborted) = await ConnectWithAbortAsync(exerciseA, mismatched);

        aborted.Should().BeTrue();
        joined.Should().BeEmpty("a principal/session staff-user mismatch fails closed");
    }

    [RequiresDockerFact]
    public async Task StaffAssignedAcrossATenantBoundary_IsAborted()
    {
        // COR-010: the reused StaffAssignmentService bounds enrollments by the staff user's OWN organization, so a
        // (mis-provisioned) enrollment in another customer's exercise never verifies a connection there.
        var otherOrganizationId = Guid.NewGuid();
        await using (var seed = _fixture.CreateContext())
        {
            seed.Organizations.Add(new Organization
            {
                Id = otherOrganizationId,
                Name = $"Other customer {otherOrganizationId:N}",
                CreatedAt = DateTimeOffset.UtcNow,
                Slug = $"org-{Guid.NewGuid():N}",
            });
            await seed.SaveChangesAsync();
        }

        var otherTenantsExercise = await SeedExerciseAsync(otherOrganizationId);
        var staff = await SeedStaffAsync(assignedTo: [otherTenantsExercise]);

        var (joined, aborted) = await ConnectWithAbortAsync(otherTenantsExercise, staff.Principal);

        aborted.Should().BeTrue();
        joined.Should().BeEmpty("a staff user never gains another customer's exercise, even with an enrollment row there");
    }

    [RequiresDockerFact]
    public async Task ActiveExerciseSwitch_MovesTheConnection_OutOfTheOldGroups_AndTheReconnectJoinsTheNewExercise()
    {
        // identity-auth-roles/15 AC: switching exercise moves the connection's group — the server drops the old
        // group membership (and closes the connection), and the client's reconnect joins the new exercise.
        var exerciseA = await SeedExerciseAsync();
        var exerciseB = await SeedExerciseAsync();
        var staff = await SeedStaffAsync(assignedTo: [exerciseA, exerciseB]);
        var registry = new SessionConnectionRegistry();

        var (first, _) = await ConnectWithAbortAsync(null, staff.Principal, registry, "before-switch");
        first.Should().Equal(new[] { $"exercise:{exerciseA}", $"exercise:{exerciseA}:staff" });

        var removed = new List<(string ConnectionId, string Group)>();
        var hubGroups = new Mock<IGroupManager>();
        hubGroups
            .Setup(g => g.RemoveFromGroupAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Callback<string, string, CancellationToken>((id, group, _) => removed.Add((id, group)))
            .Returns(Task.CompletedTask);
        var hubContext = new Mock<IHubContext<ExerciseRealtimeHub>>();
        hubContext.SetupGet(h => h.Groups).Returns(hubGroups.Object);

        await using (var context = _fixture.CreateContext())
        {
            var service = new StaffAssignmentService(
                context,
                new StubCurrentStaffSessionAccessor(new CurrentStaffSession { SessionId = staff.SessionId, StaffUserId = staff.StaffUserId }),
                new SessionConnectionRevoker(registry, hubContext.Object));

            var switched = await service.SetActiveExerciseAsync(exerciseB);
            switched.Outcome.Should().Be(SetActiveExerciseOutcome.Ok);
        }

        removed.Should().BeEquivalentTo(
            new[] { ("before-switch", $"exercise:{exerciseA}:staff"), ("before-switch", $"exercise:{exerciseA}") },
            "the server drops the old exercise's group membership the moment the switch is committed");

        var (reconnected, aborted) = await ConnectWithAbortAsync(null, staff.Principal, registry, "after-switch");
        aborted.Should().BeFalse();
        reconnected.Should().Equal(
            new[] { $"exercise:{exerciseB}", $"exercise:{exerciseB}:staff" },
            "the reconnect is scoped from the session row the switch persisted");
    }

    [RequiresDockerFact]
    public async Task StaffConnection_RegisteredAfterTheRevokeTookItsSession_IsCutByTheReCheck()
    {
        // #602 L-2: the connect-time check passes, THEN the session is revoked and the revoker's Take runs (finding
        // nothing yet), THEN the hub registers the connection. Without the post-registration re-check the connection
        // would survive the revocation in both staff groups. The revocation is injected deterministically at the last
        // group join — strictly after verification and strictly before registration.
        var exerciseA = await SeedExerciseAsync();
        var staff = await SeedStaffAsync(assignedTo: [exerciseA]);
        var registry = new SessionConnectionRegistry();
        var revoker = new SessionConnectionRevoker(registry);

        var outcome = await ConnectWithRaceAsync(
            hostResolvedExerciseId: null,
            staff.Principal,
            registry,
            revokeOnJoining: $"exercise:{exerciseA}:staff",
            revoke: () => RevokeAsync(staff.SessionId, revoker));

        outcome.Aborted.Should().BeTrue("a connection whose session was revoked before it registered must be cut");
        outcome.Removed.Should().BeEquivalentTo(
            new[] { $"exercise:{exerciseA}:staff", $"exercise:{exerciseA}" },
            "it is taken back out of every group it joined, so not one more broadcast reaches it");
        registry.Take(staff.SessionId).Should().BeEmpty("the cut connection is no longer registered under the revoked session");
    }

    [RequiresDockerFact]
    public async Task ParticipantConnection_RegisteredAfterTheRevokeTookItsSession_IsCutByTheReCheck()
    {
        // #602 L-2, the host-bound (participant) path: same race, same guarantee.
        var exerciseA = await SeedExerciseAsync();
        var session = TestSessions.NewSession($"participant-race-{Guid.NewGuid():N}", exerciseA);
        await using (var seed = _fixture.CreateContext())
        {
            seed.Sessions.Add(session);
            await seed.SaveChangesAsync();
        }

        var principal = SessionPrincipal.Create(new AuthenticatedSession
        {
            SessionId = session.Id,
            ExerciseId = exerciseA,
            Kind = "participant",
            PrincipalId = session.PrincipalId,
            ActingHumanId = session.ActingHumanId,
        });
        var registry = new SessionConnectionRegistry();
        var revoker = new SessionConnectionRevoker(registry);

        var outcome = await ConnectWithRaceAsync(
            exerciseA,
            principal,
            registry,
            revokeOnJoining: $"exercise:{exerciseA}",
            revoke: () => RevokeAsync(session.Id, revoker));

        outcome.Aborted.Should().BeTrue();
        outcome.Removed.Should().Equal($"exercise:{exerciseA}");
        registry.Take(session.Id).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task StaffConnection_WhoseSessionStaysLive_RemainsRegistered_AndIsCutByALaterRevoke()
    {
        // The control: no revocation in the window — the re-check keeps the connection, and a later revoke's Take finds it.
        var exerciseA = await SeedExerciseAsync();
        var staff = await SeedStaffAsync(assignedTo: [exerciseA]);
        var registry = new SessionConnectionRegistry();

        var outcome = await ConnectWithRaceAsync(null, staff.Principal, registry, revokeOnJoining: null, revoke: null);

        outcome.Aborted.Should().BeFalse();
        outcome.Removed.Should().BeEmpty();
        registry.Take(staff.SessionId).Should().ContainSingle("a live connection stays registered for a later revoke to cut");
    }

    private async Task RevokeAsync(Guid sessionId, SessionConnectionRevoker revoker)
    {
        // As the grant-revoke rule does: commit the revocation, THEN cut the registered connections.
        await using (var context = _fixture.CreateContext())
        {
            await context.Sessions
                .Where(s => s.Id == sessionId)
                .ExecuteUpdateAsync(set => set.SetProperty(s => s.RevokedAt, DateTimeOffset.UtcNow));
        }

        await revoker.RevokeAsync([sessionId]);
    }

    /// <summary>
    /// Runs <c>OnConnectedAsync</c> with a registry, running <paramref name="revoke"/> when the connection joins
    /// <paramref name="revokeOnJoining"/> (i.e. after verification, before registration). Returns whether the hub aborted
    /// the connection and the groups it was removed from.
    /// </summary>
    private async Task<(bool Aborted, IReadOnlyList<string> Removed)> ConnectWithRaceAsync(
        Guid? hostResolvedExerciseId,
        System.Security.Claims.ClaimsPrincipal principal,
        SessionConnectionRegistry registry,
        string? revokeOnJoining,
        Func<Task>? revoke)
    {
        var httpContext = new DefaultHttpContext { User = principal };
        if (hostResolvedExerciseId is { } host)
        {
            httpContext.SetHostResolvedExerciseId(host);
        }

        var httpContextFeature = new Mock<SignalRHttpContextFeature>();
        httpContextFeature.SetupGet(f => f.HttpContext).Returns(httpContext);
        var features = new FeatureCollection();
        features.Set<SignalRHttpContextFeature>(httpContextFeature.Object);

        var aborted = false;
        var callerContext = new Mock<HubCallerContext>();
        callerContext.SetupGet(c => c.ConnectionId).Returns(ConnectionId);
        callerContext.SetupGet(c => c.Features).Returns(features);
        callerContext.SetupGet(c => c.Items).Returns(new Dictionary<object, object?>());
        callerContext.Setup(c => c.Abort()).Callback(() => aborted = true);

        var removed = new List<string>();
        var groups = new Mock<IGroupManager>();
        groups
            .Setup(g => g.AddToGroupAsync(ConnectionId, It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns<string, string, CancellationToken>((_, group, _) =>
                revoke is not null && string.Equals(group, revokeOnJoining, StringComparison.Ordinal) ? revoke() : Task.CompletedTask);
        groups
            .Setup(g => g.RemoveFromGroupAsync(ConnectionId, It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Callback<string, string, CancellationToken>((_, group, _) => removed.Add(group))
            .Returns(Task.CompletedTask);

        await using var dbContext = _fixture.CreateContext();
        var hub = new ExerciseRealtimeHub(dbContext, NullLogger<ExerciseRealtimeHub>.Instance, registry)
        {
            Context = callerContext.Object,
            Groups = groups.Object,
        };

        await hub.OnConnectedAsync();

        return (aborted, removed);
    }

    /// <summary>Runs <c>OnConnectedAsync</c> for one connection and returns the groups it joined, in order.</summary>
    private async Task<IReadOnlyList<string>> ConnectAsync(Guid? hostResolvedExerciseId, System.Security.Claims.ClaimsPrincipal principal)
    {
        var (joined, _) = await ConnectWithAbortAsync(hostResolvedExerciseId, principal);
        return joined;
    }

    /// <summary>Runs <c>OnConnectedAsync</c>; returns the joined groups and whether the hub aborted the connection.</summary>
    private async Task<(IReadOnlyList<string> Joined, bool Aborted)> ConnectWithAbortAsync(
        Guid? hostResolvedExerciseId,
        System.Security.Claims.ClaimsPrincipal principal,
        SessionConnectionRegistry? registry = null,
        string connectionId = ConnectionId)
    {
        var httpContext = new DefaultHttpContext { User = principal };
        if (hostResolvedExerciseId is { } host)
        {
            httpContext.SetHostResolvedExerciseId(host);
        }

        var httpContextFeature = new Mock<SignalRHttpContextFeature>();
        httpContextFeature.SetupGet(f => f.HttpContext).Returns(httpContext);
        var features = new FeatureCollection();
        features.Set<SignalRHttpContextFeature>(httpContextFeature.Object);

        var aborted = false;
        var callerContext = new Mock<HubCallerContext>();
        callerContext.SetupGet(c => c.ConnectionId).Returns(connectionId);
        callerContext.SetupGet(c => c.Features).Returns(features);
        callerContext.SetupGet(c => c.Items).Returns(new Dictionary<object, object?>());
        callerContext.Setup(c => c.Abort()).Callback(() => aborted = true);

        var joined = new List<string>();
        var groups = new Mock<IGroupManager>();
        groups
            .Setup(g => g.AddToGroupAsync(connectionId, It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Callback<string, string, CancellationToken>((_, group, _) => joined.Add(group))
            .Returns(Task.CompletedTask);

        // No exercise scope: the hub's SignalR DI scope never carries the request's IExerciseContext.
        await using var dbContext = _fixture.CreateContext();
        var hub = new ExerciseRealtimeHub(dbContext, NullLogger<ExerciseRealtimeHub>.Instance, registry)
        {
            Context = callerContext.Object,
            Groups = groups.Object,
        };

        await hub.OnConnectedAsync();

        return (joined, aborted);
    }

    private async Task<Guid> SeedExerciseAsync(Guid? organizationId = null)
    {
        var exerciseId = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            OrganizationId = organizationId ?? Organization.DefaultOrganizationId,
            Id = exerciseId,
            Name = $"Realtime staff group {exerciseId:N}",
            Hostname = $"rt-staff-{exerciseId:N}.example.com",
            TimeZone = "UTC",
            Status = "live",
        });
        await seed.SaveChangesAsync();
        return exerciseId;
    }

    /// <summary>
    /// Seeds a staff user (default tenant), one assignment per exercise in <paramref name="assignedTo"/>, and a
    /// live staff session row bound to them; returns the principal the session middleware would build for it.
    /// </summary>
    private async Task<SeededStaff> SeedStaffAsync(Guid[] assignedTo, Action<Session>? configure = null)
    {
        var staffUserId = Guid.NewGuid();
        var session = TestSessions.NewSession($"staff-group-{Guid.NewGuid():N}", assignedTo[0], kind: "staff");
        session.StaffUserId = staffUserId;
        session.PrincipalId = staffUserId.ToString();
        configure?.Invoke(session);

        await using (var seed = _fixture.CreateContext())
        {
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
        }

        // The principal is built from the session's facts as the middleware would have at connect time (before
        // any revocation/expiry configured above) — the hub must not take it on trust.
        var principal = SessionPrincipal.Create(new AuthenticatedSession
        {
            SessionId = session.Id,
            ExerciseId = session.ExerciseId,
            Kind = "staff",
            StaffUserId = staffUserId,
            PrincipalId = session.PrincipalId,
            ActingHumanId = session.ActingHumanId,
        });

        return new SeededStaff(staffUserId, session.Id, principal);
    }

    private sealed record SeededStaff(Guid StaffUserId, Guid SessionId, System.Security.Claims.ClaimsPrincipal Principal);
}
