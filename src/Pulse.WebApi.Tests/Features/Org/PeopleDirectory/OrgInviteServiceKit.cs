namespace Pulse.WebApi.Tests.Features.Org.PeopleDirectory;

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.ExerciseLifecycleAdmin;
using Pulse.WebApi.Features.Identity.Credentials;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Ops.Bootstrap;
using Pulse.WebApi.Features.Ops.Organizations;
using Pulse.WebApi.Features.Org.PeopleDirectory;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Credentials;

/// <summary>
/// Builds <see cref="OrgInviteService"/> and <see cref="OpsOrganizationService"/> exactly as a request would see them,
/// against the shared real-SQL database, optionally with a command interceptor, for the #862 interleaving suites (the
/// <see cref="OrgPeopleServiceKit"/> pattern). No mailer is configured, so a by-id invite returns its link.
/// </summary>
internal static class OrgInviteServiceKit
{
    /// <summary>The by-id invite service for an org-scope caller, its caller context, and its context (the caller disposes it).</summary>
    public static (OrgInviteService Service, StaffCallerContext Caller, PulseDbContext Context) Invite(
        MsSqlContainerFixture fixture,
        Guid callerSessionId,
        Guid callerPersonId,
        Guid organizationId,
        IInterceptor? interceptor = null)
    {
        var organizationContext = new OrganizationContext { CurrentOrganizationId = organizationId };
        var context = Context(fixture, organizationContext, interceptor);
        var caller = new StaffCallerContext(context, new FixedStaffSessionAccessor(callerSessionId, callerPersonId), organizationContext);
        var service = new OrgInviteService(
            context,
            caller,
            new CredentialTokenService(context, TimeProvider.System),
            Urls(),
            new NullPulseMailer(NullLogger<NullPulseMailer>.Instance),
            TimeProvider.System);
        return (service, caller, context);
    }

    /// <summary>The ops organization service with <paramref name="secret"/> configured, and its context (the caller disposes it).</summary>
    public static (OpsOrganizationService Service, PulseDbContext Context) Ops(
        MsSqlContainerFixture fixture,
        string secret,
        IInterceptor? interceptor = null)
    {
        var context = Context(fixture, new OrganizationContext(), interceptor);
        var service = new OpsOrganizationService(
            context,
            new CredentialTokenService(context, TimeProvider.System),
            Urls(),
            new NullPulseMailer(NullLogger<NullPulseMailer>.Instance),
            TimeProvider.System,
            Options.Create(new BootstrapOptions { Secret = secret }));
        return (service, context);
    }

    private static PulseDbContext Context(MsSqlContainerFixture fixture, OrganizationContext organizationContext, IInterceptor? interceptor)
    {
        var exerciseContext = new ExerciseContext { CurrentExerciseId = null };
        if (interceptor is null)
        {
            return fixture.CreateContext(exerciseContext, organizationContext);
        }

        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(fixture.ConnectionString!)
            .AddInterceptors(interceptor)
            .Options;
        return new PulseDbContext(options, exerciseContext, organizationContext);
    }

    private static JoinUrlBuilder Urls() => new(new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?> { [JoinUrlBuilder.FrontendBaseUrlKey] = CredentialTestWorld.FrontendBaseUrl })
        .Build());

    /// <summary>A fixed staff-session accessor (the caller's own, already-authenticated session).</summary>
    private sealed class FixedStaffSessionAccessor(Guid sessionId, Guid staffUserId) : ICurrentStaffSessionAccessor
    {
        public Task<CurrentStaffSession?> GetCurrentStaffSessionAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult<CurrentStaffSession?>(new CurrentStaffSession { SessionId = sessionId, StaffUserId = staffUserId });
    }
}
