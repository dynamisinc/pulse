namespace Pulse.WebApi.Tests.Features.Identity.Credentials;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Credentials;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Enrollments;
using Pulse.WebApi.Tests.Helpers;
using Xunit;

/// <summary>
/// identity-auth-roles/21 — <see cref="PasswordResetService"/> races that need a deterministic interleaving (adversarial
/// review W3 on #665): the redemption that LOSES the single-use claim changes nothing.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PasswordResetServiceTests
{
    private readonly MsSqlContainerFixture _fixture;
    private readonly CredentialTestWorld _world;

    public PasswordResetServiceTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _world = new CredentialTestWorld(fixture);
    }

    [RequiresDockerFact]
    public async Task Reset_ThatLosesTheClaim_IsInvalidToken_AndChangesNoPasswordAndRevokesNoSession()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (target, _) = await _world.SeedPersonAsync(org);
        var exercise = await _world.SeedExerciseAsync(org);
        await _world.SeedEnrollmentAsync(exercise, target, "controller");
        var (sessionId, _, _) = await _world.SeedStaffSessionAsync(target, exercise, "controller");
        var issued = await _world.IssueAsync(CredentialTokenPurposes.Reset, target, org);
        string hashBefore;
        await using (var read = _world.ReadContext())
        {
            hashBefore = (await read.People.AsNoTracking().SingleAsync(p => p.Id == target)).PasswordHash!;
        }

        // A concurrent redemption consumes the token just before this one's claim statement runs.
        var hook = new BeforeCommandHook(
            sql => sql.Contains("UPDATE", StringComparison.Ordinal) && sql.Contains("[CredentialTokens]", StringComparison.Ordinal),
            async () =>
            {
                await using var competing = _world.ReadContext();
                await competing.Database.ExecuteSqlInterpolatedAsync(
                    $"UPDATE [CredentialTokens] SET [UsedAt] = SYSDATETIMEOFFSET() WHERE [Id] = {issued.Token.Id}");
            });

        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(_fixture.ConnectionString!)
            .AddInterceptors(hook)
            .Options;
        var revoker = new RecordingConnectionRevoker();
        await using (var context = new PulseDbContext(options))
        {
            var service = new PasswordResetService(context, new CredentialTokenService(context, TimeProvider.System), TimeProvider.System, revoker);
            var result = await service.ResetAsync(new PasswordResetRequest { Token = issued.RawToken, NewPassword = CredentialTestWorld.NewPassword });

            result.Outcome.Should().Be(PasswordResetOutcome.Invalid);
            result.Error.Should().Be(PasswordResetService.InvalidTokenError);
        }

        hook.Fired.Should().BeTrue("the competing claim landed in the window");
        await using var after = _world.ReadContext();
        var person = await after.People.AsNoTracking().SingleAsync(p => p.Id == target);
        person.PasswordHash.Should().Be(hashBefore);
        person.PasswordChangedAt.Should().BeNull();
        (await after.Sessions.AsNoTracking().SingleAsync(s => s.Id == sessionId)).RevokedAt.Should().BeNull();
        (await after.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking()
                .CountAsync(a => a.SubjectPersonId == target && a.Kind == PasswordResetService.CredentialChangedKind))
            .Should().Be(0);
        revoker.Revoked.Should().BeEmpty();
    }
}
