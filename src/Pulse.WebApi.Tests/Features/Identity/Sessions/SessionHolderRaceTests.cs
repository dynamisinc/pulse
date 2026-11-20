namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Org.PeopleDirectory;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Credentials;
using Pulse.WebApi.Tests.Features.Identity.Enrollments;
using Pulse.WebApi.Tests.Features.Org.PeopleDirectory;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// #839 — the DEFENCE IN DEPTH behind the person-row lock (<see cref="PersonSessionLock"/>, proven by
/// <see cref="PersonRowSerializationTests"/>): <see cref="SessionHolderQueries"/>' per-request re-check of the session's
/// person. Each test leaves a session live that a change did not sweep — inserted on its own connection at the start of
/// the change's final save, as a mint path that took no person lock would — and proves the session then authenticates
/// nowhere: not the request middleware's <see cref="SessionAuthenticator"/>, not <see cref="CurrentStaffSessionAccessor"/>,
/// not <c>GET /api/session</c>, not refresh. Only the STATE checks (disabled, org-admin grant) are exercised this way:
/// the password check compares timestamps, and a lock-free mint could legitimately stamp a later issue time, so the
/// password arm is closed by the lock alone (see <see cref="PersonRowSerializationTests"/>). A control session of a person
/// whose state did not change keeps authenticating.
/// </summary>
[Collection(MsSqlRcsiCollection.Name)]
public sealed class SessionHolderRaceTests
{
    private readonly MsSqlContainerFixture _fixture;
    private readonly CredentialTestWorld _world;

    public SessionHolderRaceTests(MsSqlRcsiFixture rcsi)
    {
        ArgumentNullException.ThrowIfNull(rcsi);
        var fixture = rcsi.Sql;
        _fixture = fixture;
        _world = new CredentialTestWorld(fixture);
    }

    [RequiresDockerFact]
    public async Task Demote_RacingASignIn_LeavesAnUnrevokedOrgScopeSession_ThatNoLongerAuthenticates()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (caller, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var (target, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var (callerSession, callerToken, _) = await _world.SeedStaffSessionAsync(caller, exerciseId: null, Person.OrgAdminRole);

        var escaped = NewSession(target, exerciseId: null, Person.OrgAdminRole, issuedAt: DateTimeOffset.UtcNow);
        var hook = new MintBeforeFinalSave(_fixture, escaped.Session);
        var (service, _, context) = OrgPeopleServiceKit.For(_fixture, callerSession, caller, org, hook);
        await using (context)
        {
            (await service.UpdateAsync(target, new UpdateOrgPersonRequest { IsOrgAdmin = false })).Outcome
                .Should().Be(OrgPeopleOutcome.Ok, "the demote commits");
        }

        await AssertRaceReproducedAsync(hook, escaped.Session.Id);
        await AssertRefusedEverywhereAsync(escaped.Token, escaped.RefreshToken);
        await AssertStillAuthenticatesAsync(callerToken, "the demoting admin's own org-scope session is untouched");
    }

    [RequiresDockerFact]
    public async Task Disable_RacingASignIn_LeavesAnUnrevokedSession_ThatNoLongerAuthenticates()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var exercise = await _world.SeedExerciseAsync(org);
        var (caller, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var (target, _) = await _world.SeedPersonAsync(org);
        await _world.SeedEnrollmentAsync(exercise, target, "controller");
        var (callerSession, callerToken, _) = await _world.SeedStaffSessionAsync(caller, exerciseId: null, Person.OrgAdminRole);

        var escaped = NewSession(target, exercise, "controller", issuedAt: DateTimeOffset.UtcNow);
        var hook = new MintBeforeFinalSave(_fixture, escaped.Session);
        var (service, _, context) = OrgPeopleServiceKit.For(_fixture, callerSession, caller, org, hook);
        await using (context)
        {
            (await service.UpdateAsync(target, new UpdateOrgPersonRequest { Disabled = true })).Outcome
                .Should().Be(OrgPeopleOutcome.Ok, "the disable commits");
        }

        await AssertRaceReproducedAsync(hook, escaped.Session.Id);
        await AssertRefusedEverywhereAsync(escaped.Token, escaped.RefreshToken);
        await AssertStillAuthenticatesAsync(callerToken, "the disabling admin's own session is untouched");
    }

    [RequiresDockerFact]
    public async Task ADemotedOrgAdmin_KeepsTheirExerciseSessions_OnlyOrgScopeIsRefused()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var exercise = await _world.SeedExerciseAsync(org);
        var (target, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        await _world.SeedEnrollmentAsync(exercise, target, "planner");
        var orgScope = NewSession(target, exerciseId: null, Person.OrgAdminRole, DateTimeOffset.UtcNow.AddMinutes(-1));
        var exerciseScope = NewSession(target, exercise, "planner", DateTimeOffset.UtcNow.AddMinutes(-1));
        await using (var seed = _fixture.CreateContext())
        {
            seed.Sessions.AddRange(orgScope.Session, exerciseScope.Session);
            await seed.SaveChangesAsync();
        }

        // The grant is removed WITHOUT any sweep (the state an escaped session is left in).
        await using (var write = _fixture.CreateContext())
        {
            await write.Database.ExecuteSqlInterpolatedAsync($"UPDATE [People] SET [OrgRole] = NULL WHERE [Id] = {target}");
        }

        await AssertRefusedEverywhereAsync(orgScope.Token, orgScope.RefreshToken);
        await AssertStillAuthenticatesAsync(exerciseScope.Token, "the org grant governs org scope only (§1.1)");
    }

    private static (Session Session, string Token, string RefreshToken) NewSession(
        Guid personId, Guid? exerciseId, string role, DateTimeOffset issuedAt)
    {
        var token = $"hold-{Guid.NewGuid():N}";
        var refresh = token + "-refresh";
        return (new Session
        {
            Id = Guid.NewGuid(),
            TokenHash = SessionTokens.Hash(token),
            RefreshTokenHash = SessionTokens.Hash(refresh),
            Kind = "staff",
            ExerciseId = exerciseId,
            PrincipalId = personId.ToString(),
            StaffUserId = personId,
            PersonId = personId,
            Role = role,
            ActingHumanId = personId.ToString(),
            IssuedAt = issuedAt,
            ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
            RefreshExpiresAt = DateTimeOffset.UtcNow.AddHours(8),
        }, token, refresh);
    }

    private async Task AssertRaceReproducedAsync(MintBeforeFinalSave hook, Guid escapedSessionId)
    {
        hook.Fired.Should().BeTrue("the racing sign-in's session landed after the sweep's read, before the commit");
        await using var read = _fixture.CreateContext();
        (await read.Sessions.AsNoTracking().SingleAsync(s => s.Id == escapedSessionId)).RevokedAt.Should().BeNull(
            "the change's own sweep never saw the racing session — exactly the #839 window");
    }

    private async Task AssertRefusedEverywhereAsync(string token, string refreshToken)
    {
        (await AuthenticatorFor().AuthenticateAsync(token, CancellationToken.None)).Should().BeNull(
            "the request middleware refuses the session, so every gated route 401s");

        await using var context = _fixture.CreateContext();
        (await StaffAccessorFor(context, token).GetCurrentStaffSessionAsync()).Should().BeNull(
            "no staff route resolves a caller from it");

        var sessions = SessionServiceFor(context);
        (await sessions.GetCurrentAsync(token)).Outcome.Should().Be(
            SessionQueryOutcome.Absent, "GET /api/session answers the same 401 as a revoked session");
        (await sessions.RefreshAsync(refreshToken)).Outcome.Should().Be(
            RefreshOutcome.Invalid, "it cannot refresh itself past the change either");
    }

    private async Task AssertStillAuthenticatesAsync(string token, string because)
    {
        (await AuthenticatorFor().AuthenticateAsync(token, CancellationToken.None)).Should().NotBeNull(because);
        await using var context = _fixture.CreateContext();
        (await SessionServiceFor(context).GetCurrentAsync(token)).Outcome.Should().Be(SessionQueryOutcome.Live, because);
    }

    private SessionAuthenticator AuthenticatorFor()
    {
        var services = new ServiceCollection();
        services.AddScoped(_ => _fixture.CreateContext());
        return new SessionAuthenticator(
            services.BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(),
            NullLogger<SessionAuthenticator>.Instance);
    }

    private static CurrentStaffSessionAccessor StaffAccessorFor(PulseDbContext context, string token)
    {
        var http = new DefaultHttpContext();
        http.Request.Headers.Authorization = $"Bearer {token}";
        return new CurrentStaffSessionAccessor(context, new HttpContextAccessor { HttpContext = http });
    }

    private static SessionService SessionServiceFor(PulseDbContext context) =>
        new(
            context,
            Options.Create(new SessionOptions()),
            new ExerciseFactsReader(context),
            Options.Create(new EasyLoginOptions()),
            TimeProvider.System,
            NullLogger<SessionService>.Instance);

    /// <summary>
    /// Inserts the racing sign-in's session on its OWN connection at the start of the change's FINAL save (the one that
    /// carries its org audit row) — after the change's sweep has read the person's sessions, before the change commits.
    /// </summary>
    private sealed class MintBeforeFinalSave(MsSqlContainerFixture fixture, Session session) : SaveChangesInterceptor
    {
        public bool Fired { get; private set; }

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (!Fired && eventData.Context is { } context
                && context.ChangeTracker.Entries<OrgAuditEvent>().Any(e => e.State == EntityState.Added))
            {
                Fired = true;
                await using var competing = fixture.CreateContext();
                competing.Sessions.Add(session);
                await competing.SaveChangesAsync(cancellationToken);
            }

            return result;
        }
    }
}
