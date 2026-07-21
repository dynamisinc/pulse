namespace Pulse.WebApi.Tests.Features.Identity.Staff;

using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// A recording <see cref="ISessionIssuer"/> test double standing in for story 03's Wave-2 implementation, so
/// story 05's login endpoint is testable end-to-end now. It records the last request and hands back an
/// in-memory <see cref="Session"/> projected from it plus a fixed raw token (never persisted).
/// </summary>
public sealed class RecordingSessionIssuer : ISessionIssuer
{
    /// <summary>The last request passed to <see cref="IssueAsync"/>, or <c>null</c> if never called.</summary>
    public SessionIssueRequest? LastRequest { get; private set; }

    /// <summary>How many times <see cref="IssueAsync"/> was called.</summary>
    public int IssueCount { get; private set; }

    /// <inheritdoc />
    public Task<SessionIssueResult> IssueAsync(SessionIssueRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        LastRequest = request;
        IssueCount++;

        var session = new Session
        {
            Id = Guid.NewGuid(),
            TokenHash = "test-token-hash",
            Kind = request.Kind,
            ExerciseId = request.ExerciseId,
            PrincipalId = request.PrincipalId,
            AccountId = request.AccountId,
            StaffUserId = request.StaffUserId,
            Role = request.Role,
            PersonaId = request.PersonaId,
            ActingHumanId = request.ActingHumanId,
            IsReadOnly = request.IsReadOnly,
            IssuedAt = DateTimeOffset.UtcNow,
            ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
        };

        return Task.FromResult(new SessionIssueResult
        {
            Session = session,
            SessionToken = "raw-session-token",
            RefreshToken = "raw-refresh-token",
        });
    }
}

/// <summary>
/// A stub <see cref="ICurrentStaffSessionAccessor"/> standing in for story 03's Wave-2 auth-scheme-backed
/// accessor, yielding a fixed <see cref="CurrentStaffSession"/> (or <c>null</c> for the unauthenticated case).
/// </summary>
public sealed class StubCurrentStaffSessionAccessor : ICurrentStaffSessionAccessor
{
    private readonly CurrentStaffSession? _current;

    public StubCurrentStaffSessionAccessor(CurrentStaffSession? current) => _current = current;

    /// <inheritdoc />
    public Task<CurrentStaffSession?> GetCurrentStaffSessionAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult(_current);
}

/// <summary>
/// A stub <see cref="IIdentityProvider"/> for proving story 05's login funnel depends only on the interface —
/// a swapped provider (the AC's future Entra/SSO) needs no call-site change. Returns a canned outcome.
/// </summary>
public sealed class StubIdentityProvider : IIdentityProvider
{
    private readonly StaffAuthenticationResult _result;

    public StubIdentityProvider(StaffAuthenticationResult result) => _result = result;

    /// <summary>Builds a stub that authenticates any credential to the given identity.</summary>
    public static StubIdentityProvider Accepting(StaffIdentity identity) => new(new StaffAuthenticationResult
    {
        Outcome = StaffAuthenticationOutcome.Authenticated,
        Identity = identity,
    });

    /// <summary>Builds a stub that rejects every credential.</summary>
    public static StubIdentityProvider Rejecting() => new(new StaffAuthenticationResult
    {
        Outcome = StaffAuthenticationOutcome.Rejected,
    });

    /// <inheritdoc />
    public Task<StaffAuthenticationResult> AuthenticateAsync(StaffCredentials credentials, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(credentials);
        return Task.FromResult(_result);
    }
}

/// <summary>
/// Counts <c>SaveChanges</c>/<c>SaveChangesAsync</c> invocations on the <see cref="Pulse.WebApi.Data.PulseDbContext"/>
/// it is attached to — used to pin XC-004's "the telemetry event shares the mutation's unit of work" invariant
/// for <see cref="Pulse.WebApi.Features.Identity.Staff.StaffLoginService"/> and
/// <see cref="Pulse.WebApi.Features.Identity.Staff.StaffAssignmentService"/>: the entity mutation (the
/// <c>StaffUser</c>/<c>Session</c> row) and its paired <c>TelemetryEvent</c> must reach the database in
/// exactly ONE <c>SaveChangesAsync</c> call (one transaction), never two separate round trips where one could
/// persist without the other.
/// </summary>
public sealed class CountingSaveChangesInterceptor : SaveChangesInterceptor
{
    /// <summary>How many times <c>SaveChanges</c> or <c>SaveChangesAsync</c> was invoked on the attached context.</summary>
    public int SaveChangesCallCount { get; private set; }

    /// <inheritdoc />
    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        SaveChangesCallCount++;
        return base.SavingChanges(eventData, result);
    }

    /// <inheritdoc />
    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        SaveChangesCallCount++;
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }
}
