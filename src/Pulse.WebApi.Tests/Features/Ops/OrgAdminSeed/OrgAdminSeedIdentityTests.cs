namespace Pulse.WebApi.Tests.Features.Ops.OrgAdminSeed;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseLifecycleAdmin;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Ops.OrgAdminSeed;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Xunit;

/// <summary>
/// THE test this whole feature exists to make pass: a seeded <c>orgAdmin</c> must be an identity the REAL staff
/// login path resolves to the SAME <see cref="StaffUser"/> row. <c>StaffLoginService</c> looks a human up by
/// <see cref="StaffUser.ExternalSubject"/> and AUTO-PROVISIONS one when absent, so a seeder that invented its
/// own subject would produce a second, disconnected staff user the moment the human actually logged in — the
/// seeded assignment would hang off a row nobody can authenticate as, and every test that merely checked "the
/// assignment row exists" would still be green.
/// </summary>
/// <remarks>
/// <para>
/// <b>These tests exercise the seeder's OTHER tenant path</b> — the well-known DEFAULT organization it falls
/// back to when the staff human does not exist yet, which is the path that actually creates the
/// <see cref="StaffUser"/>. That tenant is shared by most of the test suite, so each test runs inside an
/// EXPLICIT transaction that is never committed: the seeder sees a real, migrated database and writes real
/// rows, and the shared database is left byte-for-byte as it was. Everything (the arranged exercise, the
/// seeder, the login, and the verification reads) therefore runs on ONE context so it all sits inside that
/// transaction.
/// </para>
/// <para>
/// <b>No credential value from any real environment appears here.</b> The allowlist secret is a test-local
/// placeholder that exists only so the entry is non-empty; <see cref="StaffUser"/> stores no credential at all
/// by design (NFR-004), and the seeder never reads the secret's value — only whether it is present.
/// </para>
/// <para>
/// <b>Every test here CLEARS the default tenant's existing org admins first, and that step is load-bearing.</b>
/// <c>WebApplicationFactory&lt;Program&gt;</c> boots the real <c>Program</c> host in the <c>Development</c>
/// environment (that is its default, not something this assembly sets), and the many suites that point such a
/// host at this shared database therefore run the seeder for real. Since the seeder became zero-config, those
/// boots have a credential — so any one of them that happens to run while the default tenant owns an exercise
/// legitimately COMMITS an orgAdmin into it. Without this precondition step, the three tests below would then
/// observe <c>AlreadyProvisioned</c> and fail for a reason that has nothing to do with what they assert, purely
/// on suite ordering. The deletion happens INSIDE the never-committed transaction, so it is invisible to every
/// other test.
/// </para>
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class OrgAdminSeedIdentityTests
{
    private const string PlaceholderSecret = "test-only-placeholder-secret";

    private readonly MsSqlContainerFixture _fixture;

    public OrgAdminSeedIdentityTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task Seed_CreatesTheStaffUserVerbatimFromTheAllowlist()
    {
        var externalSubject = $"idp|{Guid.NewGuid():N}";
        const string displayName = "Seeded Org Admin";

        await using var context = _fixture.CreateContext();
        await using var transaction = await context.Database.BeginTransactionAsync();

        await ClearExistingOrgAdminsInTheDefaultOrganizationAsync(context);
        var exercise = ArrangeExerciseInTheDefaultOrganization(context);
        await context.SaveChangesAsync();

        var result = await OrgAdminSeedTestKit
            .NewService(
                context,
                OrgAdminSeedTestKit.AllowlistFor(externalSubject, PlaceholderSecret, displayName))
            .SeedAsync();

        result.Outcome.Should().Be(OrgAdminSeedOutcome.Seeded);

        var staffUser = await context.StaffUsers
            .AsNoTracking()
            .SingleAsync(u => u.ExternalSubject == externalSubject);

        staffUser.ExternalSubject.Should().Be(
            externalSubject,
            "the subject is copied VERBATIM from the allowlist entry, because that is the exact value "
            + "DynamisIdentityProvider hands StaffLoginService on a successful login. Inventing one here is the "
            + "defect this feature was written to avoid");
        staffUser.DisplayName.Should().Be(displayName, "likewise the display name — same source, same values");
        staffUser.Username.Should().Be(OrgAdminSeedService.TargetUsername);
        staffUser.OrganizationId.Should().Be(
            Organization.DefaultOrganizationId,
            "a first-seen staff human joins the same well-known default tenant BootstrapService and the "
            + "OrganizationTenantBoundary migration use — never Guid.Empty, which the write guard refuses");

        (await context.StaffAssignments
                .AsNoTracking()
                .SingleAsync(a => a.StaffUserId == staffUser.Id && a.ExerciseId == exercise.Id))
            .Role.Should().Be(ExerciseAdminRoles.OrgAdmin);

        await transaction.RollbackAsync();
    }

    [RequiresDockerFact]
    public async Task Seed_ThenARealStaffLogin_BindsToTheSameStaffUser_AndIssuesAnOrgAdminSession()
    {
        var externalSubject = $"idp|{Guid.NewGuid():N}";
        var allowlist = OrgAdminSeedTestKit.AllowlistFor(externalSubject, PlaceholderSecret);

        await using var context = _fixture.CreateContext();
        await using var transaction = await context.Database.BeginTransactionAsync();

        await ClearExistingOrgAdminsInTheDefaultOrganizationAsync(context);
        var exercise = ArrangeExerciseInTheDefaultOrganization(context);
        await context.SaveChangesAsync();

        var seedResult = await OrgAdminSeedTestKit.NewService(context, allowlist).SeedAsync();
        seedResult.Outcome.Should().Be(OrgAdminSeedOutcome.Seeded);
        var seededStaffUserId = seedResult.StaffUserId!.Value;

        // The REAL login funnel, over the REAL provider, reading the SAME allowlist an operator would configure.
        var issuer = new RecordingSessionIssuer();
        var login = new StaffLoginService(context, new DynamisIdentityProvider(allowlist), issuer);

        var loginResult = await login.LoginAsync(new StaffLoginRequest
        {
            Username = OrgAdminSeedService.TargetUsername,
            Secret = PlaceholderSecret,
            ExerciseId = exercise.Id.ToString(),
        });

        loginResult.Outcome.Should().Be(
            StaffLoginOutcome.Authenticated,
            "if the seeder's subject did not match the one the provider resolves, login would auto-provision a "
            + "SECOND StaffUser with no assignment and fail closed with NotAssigned (403) — a seeded row that "
            + "can never be used, which a row-existence test would not have seen");

        issuer.IssueCount.Should().Be(1);
        issuer.LastRequest!.StaffUserId.Should().Be(
            seededStaffUserId,
            "the session must bind to the very staff user the seeder wrote — same row, not a same-looking one");
        issuer.LastRequest.Role.Should().Be(
            ExerciseAdminRoles.OrgAdmin,
            "Session.Role comes from the assignment, so the seeded assignment is what actually makes the org "
            + "tier reachable; anything else means the seed did not take");
        issuer.LastRequest.Kind.Should().Be("staff");
        issuer.LastRequest.ExerciseId.Should().Be(exercise.Id);

        (await context.StaffUsers.AsNoTracking().CountAsync(u => u.ExternalSubject == externalSubject))
            .Should().Be(1, "the login reused the seeded human rather than provisioning a parallel identity");

        await transaction.RollbackAsync();
    }

    /// <summary>
    /// THE zero-config end-to-end: a host with NO <c>Authentication:StaffIdentity</c> configuration whatsoever
    /// seeds the org admin AND accepts a real login with the published default credential.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This is the assertion the whole zero-config change exists to satisfy, and it is deliberately end-to-end
    /// rather than "the row exists": the allowlist comes from the REAL <c>AddStaffIdentity()</c> +
    /// <c>AddOrgAdminSeed()</c> registration over an EMPTY configuration, the seeder is the real one, and the
    /// login runs the real <see cref="StaffLoginService"/> over the real <see cref="DynamisIdentityProvider"/>.
    /// A registration-time injection that were invisible to the login path — the wrong options accessor, a
    /// mutation of a copy, an ordering hazard — would still leave a seeded row and would still pass a
    /// row-existence test, while the human at the keyboard could not sign in.
    /// </para>
    /// <para>
    /// The default account's <c>ExternalSubject</c> is a FIXED value (it has to be — the seeded row is keyed on
    /// it), so this test writes inside the same never-committed transaction as its neighbours and leaves the
    /// shared database untouched.
    /// </para>
    /// </remarks>
    [RequiresDockerFact]
    public async Task ZeroConfig_SeedsTheOrgAdmin_AndTheDefaultCredentialLogsIn()
    {
        using var registration = OrgAdminSeedTestKit.BuildRegisteredProvider();
        var allowlist = OrgAdminSeedTestKit.RegisteredAllowlist(registration);

        await using var context = _fixture.CreateContext();
        await using var transaction = await context.Database.BeginTransactionAsync();

        await ClearExistingOrgAdminsInTheDefaultOrganizationAsync(context);
        var exercise = ArrangeExerciseInTheDefaultOrganization(context);
        await context.SaveChangesAsync();

        var seedResult = await OrgAdminSeedTestKit.NewService(context, allowlist).SeedAsync();

        seedResult.Outcome.Should().Be(
            OrgAdminSeedOutcome.Seeded,
            "with no configuration at all the seeder must still find a usable credential — the registration seam "
            + "put the published default into the very allowlist the seeder reads, so its unchanged "
            + "'resolve or refuse' logic resolves");

        var issuer = new RecordingSessionIssuer();
        var login = new StaffLoginService(context, new DynamisIdentityProvider(allowlist), issuer);
        var loginResult = await login.LoginAsync(new StaffLoginRequest
        {
            Username = DefaultOrgAdminAccount.Username,
            Secret = DefaultOrgAdminAccount.Secret,
            ExerciseId = exercise.Id.ToString(),
        });

        loginResult.Outcome.Should().Be(
            StaffLoginOutcome.Authenticated,
            "boot the app, sign in — that is the entire acceptance criterion. Anything else means zero-config "
            + "still needs a manual configuration step");
        issuer.LastRequest!.StaffUserId.Should().Be(
            seedResult.StaffUserId!.Value, "the session binds to the very staff user the seeder wrote");
        issuer.LastRequest.Role.Should().Be(
            ExerciseAdminRoles.OrgAdmin,
            "and it must be an ORG ADMIN session, since that is the role the org tier gates on; a staff session "
            + "with any other role reaches none of it");

        (await context.StaffUsers
                .AsNoTracking()
                .CountAsync(u => u.ExternalSubject == DefaultOrgAdminAccount.ExternalSubject))
            .Should().Be(
                1,
                "the login bound to the SEEDED human rather than auto-provisioning a second one — which is what "
                + "would happen if the injected subject and the seeded subject ever drifted apart");

        await transaction.RollbackAsync();
    }

    /// <summary>
    /// Stages one exercise in the well-known DEFAULT organization — the tenant the seeder falls back to for a
    /// staff human it has never seen. Staged on the caller's context so it lives (and dies) with the caller's
    /// transaction.
    /// </summary>
    private static Exercise ArrangeExerciseInTheDefaultOrganization(PulseDbContext context)
    {
        var exercise = OrgAdminSeedTestKit.NewExercise(Organization.DefaultOrganizationId);
        context.Exercises.Add(exercise);
        return exercise;
    }

    /// <summary>
    /// Establishes the one precondition these tests are ABOUT — the default tenant has no org admin yet — by
    /// removing any that a real-host boot elsewhere in the suite committed (see the class remarks). Runs on the
    /// caller's context, inside the caller's never-committed transaction.
    /// </summary>
    private static async Task ClearExistingOrgAdminsInTheDefaultOrganizationAsync(PulseDbContext context)
    {
        var defaultTenantStaffUserIds = await context.StaffUsers
            .Where(u => u.OrganizationId == Organization.DefaultOrganizationId)
            .Select(u => u.Id)
            .ToListAsync();

        var incumbents = await context.StaffAssignments
            .Where(a => a.Role == ExerciseAdminRoles.OrgAdmin && defaultTenantStaffUserIds.Contains(a.StaffUserId))
            .ToListAsync();

        context.StaffAssignments.RemoveRange(incumbents);
        await context.SaveChangesAsync();
    }
}
