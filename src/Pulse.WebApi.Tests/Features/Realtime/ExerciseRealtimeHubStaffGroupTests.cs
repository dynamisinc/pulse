namespace Pulse.WebApi.Tests.Features.Realtime;

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.SignalR;
using Moq;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Tests.Data;
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
            "a live staff session assigned to the host-resolved exercise joins that exercise's group and its staff group");
    }

    [RequiresDockerFact]
    public async Task LiveStaffSession_AssignedOnlyToAnotherExercise_GetsNoStaffGroup()
    {
        // B5 AC5: a staff session whose assignment does not include the resolved exercise gets no staff group.
        var exerciseA = await SeedExerciseAsync();
        var exerciseB = await SeedExerciseAsync();
        var staff = await SeedStaffAsync(assignedTo: [exerciseB]);

        var joined = await ConnectAsync(exerciseA, staff.Principal);

        joined.Should().Equal(
            new[] { $"exercise:{exerciseA}" },
            "a staff user who is not assigned to the host-resolved exercise is not staff for that exercise");
    }

    [RequiresDockerFact]
    public async Task StaffAssignedToTwoExercises_JoinsOnlyTheHostResolvedExercisesGroups_NeverTheOther()
    {
        // B5 AC5 / COR-001: the staff group derives from the HOST-RESOLVED exercise, never from the assignment
        // set — a staff user assigned to both A and B, connecting on A, never joins any of B's groups.
        var exerciseA = await SeedExerciseAsync();
        var exerciseB = await SeedExerciseAsync();
        var staff = await SeedStaffAsync(assignedTo: [exerciseA, exerciseB]);

        var joined = await ConnectAsync(exerciseA, staff.Principal);

        joined.Should().Equal(new[] { $"exercise:{exerciseA}", $"exercise:{exerciseA}:staff" });
        joined.Should().NotContain(
            group => group.Contains(exerciseB.ToString(), StringComparison.OrdinalIgnoreCase),
            "a connection on exercise A's host never joins exercise B's participant or staff group");
    }

    [RequiresDockerFact]
    public async Task RevokedStaffSession_GetsNoStaffGroup_EvenThoughThePrincipalStillSaysStaff()
    {
        // B5 AC6: the persisted row is re-verified — a revoked session is never staff.
        var exerciseA = await SeedExerciseAsync();
        var staff = await SeedStaffAsync(assignedTo: [exerciseA], configure: s => s.RevokedAt = DateTimeOffset.UtcNow.AddSeconds(-1));

        var joined = await ConnectAsync(exerciseA, staff.Principal);

        joined.Should().Equal(new[] { $"exercise:{exerciseA}" }, "a revoked staff session is never admitted to the staff group");
    }

    [RequiresDockerFact]
    public async Task ExpiredStaffSession_GetsNoStaffGroup()
    {
        // B5 AC6: an expired session is never staff.
        var exerciseA = await SeedExerciseAsync();
        var staff = await SeedStaffAsync(assignedTo: [exerciseA], configure: s => s.ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1));

        var joined = await ConnectAsync(exerciseA, staff.Principal);

        joined.Should().Equal(new[] { $"exercise:{exerciseA}" }, "an expired staff session is never admitted to the staff group");
    }

    [RequiresDockerFact]
    public async Task StaffPrincipal_WithNoPersistedSession_GetsNoStaffGroup()
    {
        // A staff-shaped principal naming a session id that does not exist (never issued, or deleted) — the
        // decision is the persisted session, not the claims.
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

        var joined = await ConnectAsync(exerciseA, phantom);

        joined.Should().Equal(new[] { $"exercise:{exerciseA}" }, "a principal with no persisted live session is never staff");
    }

    [RequiresDockerFact]
    public async Task StaffPrincipal_NamingADifferentStaffUserThanItsSession_GetsNoStaffGroup()
    {
        // The principal's staff user must be the one the persisted session is bound to.
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

        var joined = await ConnectAsync(exerciseA, mismatched);

        joined.Should().Equal(new[] { $"exercise:{exerciseA}" }, "a principal/session staff-user mismatch fails closed");
    }

    [RequiresDockerFact]
    public async Task ParticipantKindSessionRow_ForAStaffUser_GetsNoStaffGroup()
    {
        // The persisted row's kind is re-checked too: a participant-kind row is never staff, whatever the
        // principal claims.
        var exerciseA = await SeedExerciseAsync();
        var staff = await SeedStaffAsync(assignedTo: [exerciseA], configure: s => s.Kind = "participant");

        var joined = await ConnectAsync(exerciseA, staff.Principal);

        joined.Should().Equal(new[] { $"exercise:{exerciseA}" }, "only a staff-kind persisted session is staff");
    }

    [RequiresDockerFact]
    public async Task StaffAssignedAcrossATenantBoundary_GetsNoStaffGroup()
    {
        // COR-010: the reused StaffAssignmentService bounds assignments by the staff user's OWN organization, so a
        // (mis-provisioned) assignment to another customer's exercise never yields that exercise's staff group.
        var otherOrganizationId = Guid.NewGuid();
        await using (var seed = _fixture.CreateContext())
        {
            seed.Organizations.Add(new Organization
            {
                Id = otherOrganizationId,
                Name = $"Other customer {otherOrganizationId:N}",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await seed.SaveChangesAsync();
        }

        var otherTenantsExercise = await SeedExerciseAsync(otherOrganizationId);
        var staff = await SeedStaffAsync(assignedTo: [otherTenantsExercise]);

        var joined = await ConnectAsync(otherTenantsExercise, staff.Principal);

        joined.Should().Equal(
            new[] { $"exercise:{otherTenantsExercise}" },
            "a staff user never gains another customer's staff group, even with an assignment row pointing there");
    }

    /// <summary>Runs <c>OnConnectedAsync</c> for one connection and returns the groups it joined, in order.</summary>
    private async Task<IReadOnlyList<string>> ConnectAsync(Guid hostResolvedExerciseId, System.Security.Claims.ClaimsPrincipal principal)
    {
        var httpContext = new DefaultHttpContext { User = principal };
        httpContext.SetHostResolvedExerciseId(hostResolvedExerciseId);

        var httpContextFeature = new Mock<SignalRHttpContextFeature>();
        httpContextFeature.SetupGet(f => f.HttpContext).Returns(httpContext);
        var features = new FeatureCollection();
        features.Set<SignalRHttpContextFeature>(httpContextFeature.Object);

        var callerContext = new Mock<HubCallerContext>();
        callerContext.SetupGet(c => c.ConnectionId).Returns(ConnectionId);
        callerContext.SetupGet(c => c.Features).Returns(features);

        var joined = new List<string>();
        var groups = new Mock<IGroupManager>();
        groups
            .Setup(g => g.AddToGroupAsync(ConnectionId, It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Callback<string, string, CancellationToken>((_, group, _) => joined.Add(group))
            .Returns(Task.CompletedTask);

        // No exercise scope: the hub's SignalR DI scope never carries the request's IExerciseContext.
        await using var dbContext = _fixture.CreateContext();
        var hub = new ExerciseRealtimeHub(dbContext) { Context = callerContext.Object, Groups = groups.Object };

        await hub.OnConnectedAsync();

        callerContext.Verify(c => c.Abort(), Times.Never, "a resolved host never aborts, staff or not");
        return joined;
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
                seed.StaffAssignments.Add(new StaffAssignment
                {
                    Id = Guid.NewGuid(),
                    StaffUserId = staffUserId,
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
