namespace Pulse.WebApi.Tests.Features.Identity.Enrollments;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.ExerciseLifecycleAdmin;
using Pulse.WebApi.Features.Identity.Enrollments;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// Real-SQL seeding and service construction for the identity-auth-roles/16 enrollment suites. Fresh GUIDs per call;
/// every row is written through the real write guards.
/// </summary>
public sealed class EnrollmentTestKit
{
    private readonly MsSqlContainerFixture _fixture;

    public EnrollmentTestKit(MsSqlContainerFixture fixture) => _fixture = fixture;

    public RecordingSwampedModeSwitch Swamped { get; } = new();

    public RecordingConnectionRevoker Revoker { get; } = new();

    public async Task<Guid> SeedOrganizationAsync()
    {
        var id = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Organizations.Add(new Organization
        {
            Id = id,
            Name = $"Enrollment Org {id:N}",
            Slug = $"org-{id:N}",
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
        return id;
    }

    public async Task<Guid> SeedExerciseAsync(Guid organizationId)
    {
        var id = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            Id = id,
            OrganizationId = organizationId,
            Name = $"Enrollment Exercise {id:N}",
            Hostname = $"enr-{id:N}.example.com",
            TimeZone = "UTC",
            Status = "live",
        });
        await seed.SaveChangesAsync();
        return id;
    }

    /// <summary>Seeds a person + staff facet, and (when <paramref name="exerciseId"/> is set) a staff enrollment.</summary>
    public async Task<(Guid PersonId, Guid EnrollmentId)> SeedStaffAsync(
        Guid organizationId,
        Guid? exerciseId,
        string role = "controller",
        bool isLead = false,
        string? orgRole = null,
        DateTimeOffset? createdAt = null)
    {
        var personId = Guid.NewGuid();
        var enrollmentId = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        var staffUser = StaffTenantSeed.StaffUserFor(personId, organizationId);
        staffUser.Person!.OrgRole = orgRole;
        seed.StaffUsers.Add(staffUser);
        if (exerciseId is { } exercise)
        {
            seed.Enrollments.Add(new Enrollment
            {
                Id = enrollmentId,
                ExerciseId = exercise,
                PersonId = personId,
                Role = role,
                IsLead = isLead,
                CreatedAt = createdAt ?? DateTimeOffset.UtcNow,
            });
        }

        await seed.SaveChangesAsync();
        return (personId, enrollmentId);
    }

    public async Task<Guid> SeedEnrollmentAsync(Guid exerciseId, Guid personId, string role, bool isLead = false)
    {
        var id = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Enrollments.Add(new Enrollment
        {
            Id = id,
            ExerciseId = exerciseId,
            PersonId = personId,
            Role = role,
            IsLead = isLead,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
        return id;
    }

    /// <summary>Seeds a live staff session (with refresh material) for <paramref name="personId"/>; <c>null</c> exercise = org scope.</summary>
    public async Task<(Guid SessionId, string Token)> SeedStaffSessionAsync(Guid personId, Guid? exerciseId, string role)
    {
        var token = $"enr-{Guid.NewGuid():N}";
        var session = new Session
        {
            Id = Guid.NewGuid(),
            TokenHash = SessionTokens.Hash(token),
            RefreshTokenHash = SessionTokens.Hash(token + "-refresh"),
            Kind = "staff",
            ExerciseId = exerciseId,
            PrincipalId = personId.ToString(),
            StaffUserId = personId,
            PersonId = personId,
            Role = role,
            ActingHumanId = personId.ToString(),
            IssuedAt = DateTimeOffset.UtcNow.AddMinutes(-5),
            ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
            RefreshExpiresAt = DateTimeOffset.UtcNow.AddHours(8),
        };

        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(session);
        await seed.SaveChangesAsync();
        return (session.Id, token);
    }

    /// <summary>
    /// Builds the service exactly as a request would see it: the caller's own session, the server-resolved tenant, and
    /// a DbContext captured under the caller's exercise scope (null for an org-scope caller).
    /// </summary>
    public (EnrollmentService Service, PulseDbContext Context) ServiceFor(
        Guid? callerSessionId,
        Guid callerPersonId,
        Guid organizationId,
        Guid? exerciseScope,
        ISessionConnectionRevoker? revoker = null)
    {
        var exerciseContext = new ExerciseContext { CurrentExerciseId = exerciseScope };
        var organizationContext = new OrganizationContext { CurrentOrganizationId = organizationId };
        var context = _fixture.CreateContext(exerciseContext, organizationContext);
        var accessor = new FixedStaffSessionAccessor(callerSessionId, callerPersonId);
        var caller = new StaffCallerContext(context, accessor, organizationContext);
        var service = new EnrollmentService(context, caller, exerciseContext, TimeProvider.System, Swamped, revoker ?? Revoker);
        return (service, context);
    }

    public PulseDbContext ReadContext() => _fixture.CreateContext();

    /// <summary>A fixed staff-session accessor (the caller's own session).</summary>
    private sealed class FixedStaffSessionAccessor : ICurrentStaffSessionAccessor
    {
        private readonly Guid? _sessionId;
        private readonly Guid _staffUserId;

        public FixedStaffSessionAccessor(Guid? sessionId, Guid staffUserId)
        {
            _sessionId = sessionId;
            _staffUserId = staffUserId;
        }

        public Task<CurrentStaffSession?> GetCurrentStaffSessionAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(_sessionId is { } id ? new CurrentStaffSession { SessionId = id, StaffUserId = _staffUserId } : null);
    }
}

/// <summary>Records every swamped-mode OFF the service requests; reports the configured "was on" value.</summary>
public sealed class RecordingSwampedModeSwitch : ISwampedModeSwitch
{
    public ConcurrentQueue<(Guid ExerciseId, string Actor)> Calls { get; } = new();

    public bool WasOn { get; set; } = true;

    public int FailuresBeforeSuccess { get; set; }

    /// <summary>Runs inside TurnOff (before the call is recorded) — lets a test observe what had committed by then.</summary>
    public Action<Guid>? OnTurnOff { get; set; }

    public bool IsOn(Guid exerciseId) => WasOn;

    public bool TurnOff(Guid exerciseId, string actingHumanId)
    {
        if (FailuresBeforeSuccess > 0)
        {
            FailuresBeforeSuccess--;
            throw new InvalidOperationException("simulated swamped-mode flip failure");
        }

        OnTurnOff?.Invoke(exerciseId);
        Calls.Enqueue((exerciseId, actingHumanId));
        return WasOn;
    }
}

/// <summary>Records the session ids whose hub connections the service asked to cut.</summary>
public sealed class RecordingConnectionRevoker : ISessionConnectionRevoker
{
    public ConcurrentQueue<Guid> Revoked { get; } = new();

    public Task RevokeAsync(IEnumerable<Guid> sessionIds, CancellationToken cancellationToken = default)
    {
        foreach (var id in sessionIds.ToList())
        {
            Revoked.Enqueue(id);
        }

        return Task.CompletedTask;
    }
}
