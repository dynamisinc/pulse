namespace Pulse.WebApi.Tests.Features.Identity.PersonalLinks;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.PersonalLinks;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// easy-login/03 (issuer AC, reissue/revoke mechanics) — <see cref="ParticipantLinkService"/> against real SQL Server:
/// <c>EnsureActiveAsync</c> returns an active link unchanged, creates a first link or re-activates a revoked one with a
/// fresh token, stamps <c>ExerciseId</c> from the account and only STAGES (the caller saves); reissue rotates in place
/// (<c>Generation</c> + 1, new hash, new protected copy, <c>RevokedAt</c> cleared); revoke stamps and clears the
/// protected copy and is idempotent. The <c>[Fact]</c>s prove <c>AddPersonalLinks()</c> REPLACES story 01's null issuer
/// in either registration order.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ParticipantLinkServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 20, 14, 0, 0, TimeSpan.Zero);

    private readonly MsSqlContainerFixture _fixture;
    private readonly IParticipantLinkTokenProtector _protector = PersonalLinkSeed.Protector();

    public ParticipantLinkServiceTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private PulseDbContext ScopedContext(Guid exerciseId) =>
        _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });

    [RequiresDockerFact]
    public async Task EnsureActive_NoLink_StagesAFirstLink_StampedFromTheAccount_AndOnlyTheCallerSaves()
    {
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var account = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id);
        var staffUserId = Guid.NewGuid();

        await using var context = ScopedContext(exercise.Id);
        var service = PersonalLinkSeed.LinkService(context, exercise.Id, _protector);

        var link = await service.EnsureActiveAsync(account, staffUserId, Now);

        link.Should().NotBeNull();
        link!.ExerciseId.Should().Be(account.ExerciseId, "the link is stamped from the account's own exercise (COR-001)");
        link.AccountId.Should().Be(account.Id);
        link.Generation.Should().Be(1);
        link.IssuedAt.Should().Be(Now);
        link.IssuedByStaffUserId.Should().Be(staffUserId);
        link.RevokedAt.Should().BeNull();
        AssertRecoverable(link);

        (await PersonalLinkSeed.ReadLinkAsync(_fixture, exercise.Id, account.Id)).Should().BeNull(
            "the issuer only stages on the caller's unit of work; story 02 commits the row and its link together");

        await context.SaveChangesAsync();
        (await PersonalLinkSeed.ReadLinkAsync(_fixture, exercise.Id, account.Id))!.TokenHash.Should().Be(link.TokenHash);
    }

    [RequiresDockerFact]
    public async Task EnsureActive_ActiveLink_IsReturnedUnchanged_EvenWhenItsCopyCannotBeDecrypted()
    {
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var account = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id);

        // Protected under ANOTHER key ring: this host cannot decrypt it (the needsReissue state). Still never rotated.
        var (seeded, _) = await PersonalLinkSeed.LinkAsync(_fixture, account, PersonalLinkSeed.Protector());

        await using var context = ScopedContext(exercise.Id);
        var link = await PersonalLinkSeed.LinkService(context, exercise.Id, _protector).EnsureActiveAsync(account, Guid.NewGuid(), Now);

        link!.Id.Should().Be(seeded.Id);
        link.TokenHash.Should().Be(seeded.TokenHash, "an active link is never rotated by ensure");
        link.ProtectedToken.Should().Be(seeded.ProtectedToken);
        link.Generation.Should().Be(1);
        link.IssuedAt.Should().Be(seeded.IssuedAt);
        context.ChangeTracker.HasChanges().Should().BeFalse("ensuring an active link stages nothing");
    }

    [RequiresDockerFact]
    public async Task EnsureActive_RevokedLink_IsReactivated_WithAFreshToken()
    {
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var account = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id);
        var (seeded, oldToken) = await PersonalLinkSeed.LinkAsync(
            _fixture, account, revoked: true, useCount: 4, lastUsedAt: Now.AddDays(-1));

        await using var context = ScopedContext(exercise.Id);
        var link = await PersonalLinkSeed.LinkService(context, exercise.Id, _protector).EnsureActiveAsync(account, issuedByStaffUserId: null, Now);
        await context.SaveChangesAsync();

        var stored = await PersonalLinkSeed.ReadLinkAsync(_fixture, exercise.Id, account.Id);
        stored!.UseCount.Should().Be(0, "the counters describe the new token (W-002)");
        stored.LastUsedAt.Should().BeNull();

        link!.Id.Should().Be(seeded.Id, "one row per account: a re-activation rotates in place");
        link.RevokedAt.Should().BeNull();
        link.RevokedByStaffUserId.Should().BeNull();
        link.Generation.Should().Be(2);
        link.TokenHash.Should().NotBe(ParticipantLinkTokens.Hash(oldToken), "a revoked token must never come back to life");
        link.IssuedByStaffUserId.Should().BeNull("provisioning issues with no staff user");
        AssertRecoverable(link);
    }

    [RequiresDockerFact]
    public async Task EnsureActive_TwiceInOneUnitOfWork_ReturnsTheStagedLink()
    {
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var account = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id);

        await using var context = ScopedContext(exercise.Id);
        var service = PersonalLinkSeed.LinkService(context, exercise.Id, _protector);

        var first = await service.EnsureActiveAsync(account, null, Now);
        var second = await service.EnsureActiveAsync(account, null, Now);
        await context.SaveChangesAsync();

        second.Should().BeSameAs(first, "a second ensure before the save must not stage a duplicate row");
    }

    [Fact]
    public async Task EnsureActive_AnAccountWithNoExercise_IsRefused()
    {
        await using var context = ModelOnlyContext();
        var service = PersonalLinkSeed.LinkService(context, Guid.NewGuid(), _protector);
        var account = new Account { Id = Guid.NewGuid(), Username = "x", DisplayName = "X", Role = "participant" };

        var act = () => service.EnsureActiveAsync(account, null, Now);

        await act.Should().ThrowAsync<ArgumentException>("a link can only be stamped from a real exercise scope");
    }

    [Theory]
    [InlineData("another exercise")]
    [InlineData("unresolved")]
    [InlineData("empty")]
    public async Task EnsureActiveAndReissue_RefuseAnAccountOutsideTheResolvedScope_WithAReadableError(string scopeCase)
    {
        // S-004: a caller bug (an account from another exercise, or no resolved scope) is a readable refusal before any
        // read or write (the context never connects), never a unique-index 500 at the caller's save.
        var accountExercise = Guid.NewGuid();
        Guid? scope = scopeCase switch
        {
            "another exercise" => Guid.NewGuid(),
            "empty" => Guid.Empty,
            _ => null,
        };
        await using var context = ModelOnlyContext();
        var service = PersonalLinkSeed.LinkService(context, scope, _protector);
        var account = new Account
        {
            Id = Guid.NewGuid(),
            ExerciseId = accountExercise,
            Username = "x",
            DisplayName = "X",
            Role = "participant",
        };

        var ensure = () => service.EnsureActiveAsync(account, null, Now);
        var reissue = () => service.ReissueAsync(account, Guid.NewGuid(), Now);

        (await ensure.Should().ThrowAsync<InvalidOperationException>()).Which.Message.Should().Contain(
            "personal link", "the refusal reads as what it is ({0})", scopeCase);
        await reissue.Should().ThrowAsync<InvalidOperationException>();
        context.ChangeTracker.HasChanges().Should().BeFalse("nothing was staged");
    }

    [RequiresDockerFact]
    public async Task Reissue_RotatesInPlace_GenerationPlusOne_NewHashAndCopy_RevokedAtCleared()
    {
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var account = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id);
        var (seeded, oldToken) = await PersonalLinkSeed.LinkAsync(
            _fixture, account, revoked: true, useCount: 7, lastUsedAt: Now.AddHours(-3));
        var staffUserId = Guid.NewGuid();

        await using (var context = ScopedContext(exercise.Id))
        {
            var link = await PersonalLinkSeed.LinkService(context, exercise.Id, _protector).ReissueAsync(account, staffUserId, Now);
            await context.SaveChangesAsync();

            link.Id.Should().Be(seeded.Id);
            link.Generation.Should().Be(2);
            link.RevokedAt.Should().BeNull("a reissue re-activates a revoked link");
            link.IssuedAt.Should().Be(Now);
            link.IssuedByStaffUserId.Should().Be(staffUserId);
            AssertRecoverable(link);
        }

        var stored = await PersonalLinkSeed.ReadLinkAsync(_fixture, exercise.Id, account.Id);
        stored!.UseCount.Should().Be(0, "a reissued link has never been used (W-002, matches the story-10 mock's newLink())");
        stored.LastUsedAt.Should().BeNull();

        await using var read = ScopedContext(exercise.Id);
        (await read.ParticipantLinks.AnyAsync(l => l.TokenHash == ParticipantLinkTokens.Hash(oldToken))).Should().BeFalse(
            "the old hash leaves the table, so the old URL is an unknown token");
    }

    [RequiresDockerFact]
    public async Task Reissue_ActiveLink_AlsoRotates_AndANeedsReissueLinkBecomesRecoverable()
    {
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var account = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id);
        var (seeded, _) = await PersonalLinkSeed.LinkAsync(_fixture, account, PersonalLinkSeed.Protector());

        await using var context = ScopedContext(exercise.Id);
        var link = await PersonalLinkSeed.LinkService(context, exercise.Id, _protector).ReissueAsync(account, Guid.NewGuid(), Now);

        link.TokenHash.Should().NotBe(seeded.TokenHash);
        link.Generation.Should().Be(2);
        AssertRecoverable(link);
    }

    [RequiresDockerFact]
    public async Task Reissue_NoLinkYet_IssuesTheFirst()
    {
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var account = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id);

        await using var context = ScopedContext(exercise.Id);
        var link = await PersonalLinkSeed.LinkService(context, exercise.Id, _protector).ReissueAsync(account, Guid.NewGuid(), Now);
        await context.SaveChangesAsync();

        link.Generation.Should().Be(1);
        link.ExerciseId.Should().Be(exercise.Id);
        AssertRecoverable(link);
    }

    [Fact]
    public void Revoke_StampsTheRevoke_ClearsTheProtectedCopy_KeepsTheHash_AndIsIdempotent()
    {
        var staffUserId = Guid.NewGuid();
        var link = new ParticipantLink
        {
            Id = Guid.NewGuid(),
            ExerciseId = Guid.NewGuid(),
            AccountId = Guid.NewGuid(),
            TokenHash = ParticipantLinkTokens.Hash("token"),
            ProtectedToken = "copy",
            Generation = 3,
        };

        ParticipantLinkService.Revoke(link, staffUserId, Now).Should().BeTrue();

        link.RevokedAt.Should().Be(Now);
        link.RevokedByStaffUserId.Should().Be(staffUserId);
        link.ProtectedToken.Should().BeNull("a revoked link can never be copied or printed again (EL-5)");
        link.TokenHash.Should().Be(ParticipantLinkTokens.Hash("token"), "the hash stays: a revoked token is a dead lookup");
        link.Generation.Should().Be(3);

        ParticipantLinkService.Revoke(link, Guid.NewGuid(), Now.AddMinutes(5)).Should().BeFalse("revoking twice changes nothing");
        link.RevokedAt.Should().Be(Now, "the original revoke instant is kept");
        link.RevokedByStaffUserId.Should().Be(staffUserId);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void AddPersonalLinks_ReplacesTheNullIssuer_InEitherRegistrationOrder(bool foundationFirst)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IConfiguration>(new ConfigurationBuilder().Build());
        services.AddDbContext<PulseDbContext>(options => options.UseSqlServer("Server=model-only;Database=none;"));

        // The host's AddExerciseScoping(): the issuer checks every account against the resolved scope (S-004).
        services.AddExerciseScoping();

        if (foundationFirst)
        {
            services.AddEasyLoginFoundation();
            services.AddPersonalLinks();
        }
        else
        {
            services.AddPersonalLinks();
            services.AddEasyLoginFoundation();
        }

        services.Where(d => d.ServiceType == typeof(IParticipantLinkIssuer)).Should().ContainSingle(
            "exactly one issuer is registered whichever call runs first");

        using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });
        using var scope = provider.CreateScope();
        var issuer = scope.ServiceProvider.GetRequiredService<IParticipantLinkIssuer>();

        issuer.Should().BeOfType<ParticipantLinkService>("story 03's real issuer must replace story 01's null default");
        issuer.Should().BeSameAs(
            scope.ServiceProvider.GetRequiredService<ParticipantLinkService>(),
            "the issuer seam and the staff actions share one link service per request");
    }

    [Fact]
    public void AddPersonalLinks_RegistersTheEasyLoginJoinRateLimitPolicy()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IConfiguration>(new ConfigurationBuilder().Build());
        services.AddPersonalLinks();

        using var provider = services.BuildServiceProvider();
        var options = provider.GetRequiredService<Microsoft.Extensions.Options.IOptions<Microsoft.AspNetCore.RateLimiting.RateLimiterOptions>>().Value;

        options.RejectionStatusCode.Should().Be(429);
        JoinRateLimiterPolicy.PolicyName.Should().Be("easy-login-join");
    }

    private static PulseDbContext ModelOnlyContext() => new(
        new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer("Server=model-only;Database=none;").Options);

    /// <summary>The stored copy decrypts to a token whose hash IS the row's hash (the link is reprintable).</summary>
    private void AssertRecoverable(ParticipantLink link)
    {
        link.ProtectedToken.Should().NotBeNullOrEmpty();
        var token = _protector.Unprotect(link.ProtectedToken);
        token.Should().NotBeNull("the protected copy must decrypt");
        token!.Length.Should().Be(ParticipantLinkTokens.TokenLength);
        ParticipantLinkTokens.Hash(token).Should().Be(link.TokenHash, "the reprintable copy must be the live token");
        link.TokenHash.Should().MatchRegex("^[0-9A-F]{64}$");
    }
}
