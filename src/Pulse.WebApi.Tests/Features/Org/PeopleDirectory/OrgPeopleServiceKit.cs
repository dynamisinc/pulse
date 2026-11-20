namespace Pulse.WebApi.Tests.Features.Org.PeopleDirectory;

using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.ExerciseLifecycleAdmin;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Org.PeopleDirectory;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Enrollments;

/// <summary>
/// Builds <see cref="OrgPeopleService"/> exactly as a request would see it — the caller's own session, the server-resolved
/// tenant — against the shared real-SQL database, for the service-level interleaving suites (#839, #840).
/// </summary>
internal static class OrgPeopleServiceKit
{
    /// <summary>
    /// The service for an org-scope caller, its <see cref="StaffCallerContext"/> (so a test can resolve the caller BEFORE
    /// staging a concurrent change) and its context (the caller disposes it).
    /// </summary>
    public static (OrgPeopleService Service, StaffCallerContext Caller, PulseDbContext Context) For(
        MsSqlContainerFixture fixture,
        Guid callerSessionId,
        Guid callerPersonId,
        Guid organizationId,
        IInterceptor? interceptor = null)
    {
        var organizationContext = new OrganizationContext { CurrentOrganizationId = organizationId };
        var exerciseContext = new ExerciseContext { CurrentExerciseId = null };
        PulseDbContext context;
        if (interceptor is null)
        {
            context = fixture.CreateContext(exerciseContext, organizationContext);
        }
        else
        {
            var options = new DbContextOptionsBuilder<PulseDbContext>()
                .UseSqlServer(fixture.ConnectionString!)
                .AddInterceptors(interceptor)
                .Options;
            context = new PulseDbContext(options, exerciseContext, organizationContext);
        }

        var caller = new StaffCallerContext(context, new FixedStaffSessionAccessor(callerSessionId, callerPersonId), organizationContext);
        var service = new OrgPeopleService(context, caller, new RecordingConnectionRevoker(), TimeProvider.System);
        return (service, caller, context);
    }

    /// <summary>A fixed staff-session accessor (the caller's own, already-authenticated session).</summary>
    private sealed class FixedStaffSessionAccessor(Guid sessionId, Guid staffUserId) : ICurrentStaffSessionAccessor
    {
        public Task<CurrentStaffSession?> GetCurrentStaffSessionAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult<CurrentStaffSession?>(new CurrentStaffSession { SessionId = sessionId, StaffUserId = staffUserId });
    }
}
