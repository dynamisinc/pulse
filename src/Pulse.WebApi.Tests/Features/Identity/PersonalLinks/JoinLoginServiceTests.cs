namespace Pulse.WebApi.Tests.Features.Identity.PersonalLinks;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.PersonalLinks;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// easy-login/03 (join AC 1 and 2, telemetry) — <see cref="JoinLoginService"/> against real SQL Server. An active link in
/// the host-resolved exercise, for an enabled account, while the exercise is Staged/Live/Paused, mints exactly the
/// password sign-in's session request (<see cref="ParticipantSessionRequests"/>), records <c>LastUsedAt</c> /
/// <c>UseCount</c> / <c>LastLoginAt</c>, and stays reusable. Every other case takes ONE refusal path with ONE
/// identity-less, target-less failure event. Session issuance is the <see cref="RecordingSessionIssuer"/> double.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class JoinLoginServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 20, 15, 30, 0, TimeSpan.Zero);

    private readonly MsSqlContainerFixture _fixture;

    public JoinLoginServiceTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>Every refusal the AC lists that reaches a resolved exercise.</summary>
    public enum RejectCase
    {
        UnknownToken,
        MalformedToken,
        RevokedLink,
        SupersededLink,
        OtherExercisesToken,
        DisabledAccount,
        ExerciseInBuild,
        ExerciseCompleted,
        ExerciseArchived,
    }

    private static JoinLoginService ServiceFor(PulseDbContext context, Guid? scope, RecordingSessionIssuer issuer, DateTimeOffset? now = null) =>
        new(
            context,
            new ExerciseContext { CurrentExerciseId = scope },
            issuer,
            new ExerciseFactsReader(context),
            new ManualTimeProvider(now ?? Now));

    private PulseDbContext ScopedContext(Guid? exerciseId) =>
        _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });

    [RequiresDockerFact]
    public async Task Join_ActiveLink_IssuesTheSameSessionAsAPasswordSignIn_AndRecordsTheUse()
    {
        var scenario = new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5));
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture, scenarioTime: scenario);
        var personaId = Guid.NewGuid();
        var account = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id, personaId: personaId, role: "pio");
        var (link, token) = await PersonalLinkSeed.LinkAsync(_fixture, account);

        var issuer = new RecordingSessionIssuer();
        JoinLoginResult result;
        await using (var context = ScopedContext(exercise.Id))
        {
            result = await ServiceFor(context, exercise.Id, issuer).JoinAsync(new JoinRequestBody { Token = token });
        }

        result.Outcome.Should().Be(JoinLoginOutcome.Authenticated);
        result.Issued.Should().NotBeNull();
        issuer.IssueCount.Should().Be(1);
        issuer.LastRequest.Should().BeEquivalentTo(
            ParticipantSessionRequests.For(account, exercise.Id),
            "a link sign-in mints exactly the session a password sign-in mints (same envelope as /api/auth/login)");
        issuer.LastRequest!.PersonaId.Should().Be(personaId);
        issuer.LastRequest.IsReadOnly.Should().BeFalse();

        var storedLink = await PersonalLinkSeed.ReadLinkAsync(_fixture, exercise.Id, account.Id);
        storedLink!.LastUsedAt.Should().Be(Now);
        storedLink.UseCount.Should().Be(1);
        storedLink.RevokedAt.Should().BeNull("using a link never expires it");
        storedLink.TokenHash.Should().Be(link.TokenHash);
        (await PersonalLinkSeed.ReadAccountAsync(_fixture, exercise.Id, account.Id)).LastLoginAt.Should().Be(Now);

        var evt = (await PersonalLinkSeed.ReadEventsAsync(_fixture, exercise.Id)).Should().ContainSingle().Subject;
        evt.EventType.Should().Be("login");
        evt.Channel.Should().Be("system");
        evt.Actor.Kind.Should().Be("participant");
        evt.Actor.ParticipantId.Should().Be(account.Id.ToString());
        evt.Target.Should().BeNull();
        evt.Payload.Should().Be("{\"outcome\":\"success\",\"method\":\"link\"}");
        evt.WallClockTime.Should().Be(Now);
        evt.ScenarioTime.Should().Be(scenario, "scenario time falls back to the exercise's stored instant");
        evt.TimeZone.Should().Be("America/Chicago");
        TelemetryEnvelopeRules.Validate(TelemetryAttributionFacts.FromEntity(evt)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task Join_TheSameLink_WorksAgainAndAgain_UntilRevokedOrReissued()
    {
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var account = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id);
        var (_, token) = await PersonalLinkSeed.LinkAsync(_fixture, account);
        var issuer = new RecordingSessionIssuer();

        for (var use = 1; use <= 3; use++)
        {
            await using var context = ScopedContext(exercise.Id);
            var result = await ServiceFor(context, exercise.Id, issuer, Now.AddMinutes(use)).JoinAsync(new JoinRequestBody { Token = token });
            result.Outcome.Should().Be(JoinLoginOutcome.Authenticated, "use {0} of the same link", use);
        }

        var stored = await PersonalLinkSeed.ReadLinkAsync(_fixture, exercise.Id, account.Id);
        stored!.UseCount.Should().Be(3);
        stored.LastUsedAt.Should().Be(Now.AddMinutes(3));
        issuer.IssueCount.Should().Be(3);
    }

    [RequiresDockerTheory]
    [InlineData("staged")]
    [InlineData("live")]
    [InlineData("paused")]
    public async Task Join_IsAdmitted_InEveryParticipantAccessibleState(string status)
    {
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture, status: status);
        var account = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id);
        var (_, token) = await PersonalLinkSeed.LinkAsync(_fixture, account);

        await using var context = ScopedContext(exercise.Id);
        var result = await ServiceFor(context, exercise.Id, new RecordingSessionIssuer()).JoinAsync(new JoinRequestBody { Token = token });

        result.Outcome.Should().Be(JoinLoginOutcome.Authenticated, "participants may enter a {0} exercise (EL-11)", status);
    }

    [RequiresDockerTheory]
    [InlineData(RejectCase.UnknownToken)]
    [InlineData(RejectCase.MalformedToken)]
    [InlineData(RejectCase.RevokedLink)]
    [InlineData(RejectCase.SupersededLink)]
    [InlineData(RejectCase.OtherExercisesToken)]
    [InlineData(RejectCase.DisabledAccount)]
    [InlineData(RejectCase.ExerciseInBuild)]
    [InlineData(RejectCase.ExerciseCompleted)]
    [InlineData(RejectCase.ExerciseArchived)]
    public async Task Join_EveryOtherOutcome_IsTheSameRefusal_WithOneIdentitylessTargetlessEvent(RejectCase rejectCase)
    {
        var status = rejectCase switch
        {
            RejectCase.ExerciseInBuild => "build",
            RejectCase.ExerciseCompleted => "completed",
            RejectCase.ExerciseArchived => "archived",
            _ => "live",
        };
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture, status: status);
        var account = await PersonalLinkSeed.AccountAsync(
            _fixture, exercise.Id, disabledAt: rejectCase == RejectCase.DisabledAccount ? Now.AddHours(-1) : null);
        var (_, token) = await PersonalLinkSeed.LinkAsync(_fixture, account, revoked: rejectCase == RejectCase.RevokedLink);

        var presented = rejectCase switch
        {
            RejectCase.UnknownToken => ParticipantLinkTokens.Generate(),
            RejectCase.MalformedToken => "not a token <script>!",
            RejectCase.SupersededLink => await SupersedeAsync(exercise.Id, account, token),
            RejectCase.OtherExercisesToken => await OtherExercisesTokenAsync(),
            _ => token,
        };

        var issuer = new RecordingSessionIssuer();
        await using (var context = ScopedContext(exercise.Id))
        {
            var result = await ServiceFor(context, exercise.Id, issuer).JoinAsync(new JoinRequestBody { Token = presented });

            result.Outcome.Should().Be(JoinLoginOutcome.Rejected, "{0} is refused like every other failure", rejectCase);
            result.Issued.Should().BeNull();
            result.ValidationError.Should().BeNull("a refusal says nothing about why");
        }

        issuer.IssueCount.Should().Be(0, "no session for {0}", rejectCase);

        var evt = (await PersonalLinkSeed.ReadEventsAsync(_fixture, exercise.Id)).Should().ContainSingle(
            "every join attempt in a resolved exercise emits exactly one login event").Subject;
        evt.EventType.Should().Be("login");
        evt.Actor.Kind.Should().Be("system", "a failed attempt has no identity (#356)");
        evt.Actor.ParticipantId.Should().BeNull();
        evt.Actor.ActingHumanId.Should().BeNull();
        evt.Target.Should().BeNull("a link failure carries no target and never the token");
        evt.Payload.Should().Be("{\"outcome\":\"failure\",\"method\":\"link\"}");
        TelemetryEnvelopeRules.Validate(TelemetryAttributionFacts.FromEntity(evt)).Should().BeEmpty();

        var stored = await PersonalLinkSeed.ReadLinkAsync(_fixture, exercise.Id, account.Id);
        stored!.UseCount.Should().Be(0, "a refused attempt is not a use");
        stored.LastUsedAt.Should().BeNull();
        (await PersonalLinkSeed.ReadAccountAsync(_fixture, exercise.Id, account.Id)).LastLoginAt.Should().BeNull();
    }

    [RequiresDockerTheory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Join_WithNoResolvedScope_IsRefused_WithNoEvent(bool emptyGuid)
    {
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var account = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id);
        var (_, token) = await PersonalLinkSeed.LinkAsync(_fixture, account);
        Guid? scope = emptyGuid ? Guid.Empty : null;

        var issuer = new RecordingSessionIssuer();
        await using var context = ScopedContext(scope);
        var result = await ServiceFor(context, scope, issuer).JoinAsync(new JoinRequestBody { Token = token });

        result.Outcome.Should().Be(JoinLoginOutcome.ScopeUnresolved, "an unresolved host scope fails closed (401)");
        issuer.IssueCount.Should().Be(0);
        (await PersonalLinkSeed.ReadEventsAsync(_fixture, exercise.Id)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task Join_OnAHostScopeWithNoExerciseRow_IsRefused_WithNoEvent()
    {
        var ghost = Guid.NewGuid();

        await using var context = ScopedContext(ghost);
        var result = await ServiceFor(context, ghost, new RecordingSessionIssuer()).JoinAsync(
            new JoinRequestBody { Token = ParticipantLinkTokens.Generate() });

        result.Outcome.Should().Be(JoinLoginOutcome.ScopeUnresolved);
        (await PersonalLinkSeed.ReadEventsAsync(_fixture, ghost)).Should().BeEmpty();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Join_AMissingOrEmptyToken_IsInvalid_BeforeAnyLookup(string? token)
    {
        // A never-connecting database: the 400 must return before any read or write.
        await using var context = new PulseDbContext(
            new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer("Server=nonexistent;Database=none;").Options);
        var issuer = new RecordingSessionIssuer();
        var service = ServiceFor(context, Guid.NewGuid(), issuer);

        var withBody = await service.JoinAsync(new JoinRequestBody { Token = token });
        var noBody = await service.JoinAsync(null);

        withBody.Outcome.Should().Be(JoinLoginOutcome.Invalid);
        withBody.ValidationError.Should().Be("token is required.");
        noBody.Outcome.Should().Be(JoinLoginOutcome.Invalid, "a missing body is a 400");
        issuer.IssueCount.Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task Join_Success_BookkeepingAndTelemetry_ShareOneSaveChanges()
    {
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var account = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id);
        var (_, token) = await PersonalLinkSeed.LinkAsync(_fixture, account);

        var interceptor = new CountingSaveChangesInterceptor();
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(_fixture.ConnectionString)
            .AddInterceptors(interceptor)
            .Options;
        await using var context = new PulseDbContext(options, new ExerciseContext { CurrentExerciseId = exercise.Id });

        var result = await ServiceFor(context, exercise.Id, new RecordingSessionIssuer()).JoinAsync(new JoinRequestBody { Token = token });

        result.Outcome.Should().Be(JoinLoginOutcome.Authenticated);
        interceptor.SaveChangesCallCount.Should().Be(1, "the link/account bookkeeping and its login event commit together (XC-004)");
    }

    /// <summary>Reissues the account's link (as staff would) and returns the now-superseded old token.</summary>
    private async Task<string> SupersedeAsync(Guid exerciseId, Account account, string oldToken)
    {
        await using var context = ScopedContext(exerciseId);
        await new ParticipantLinkService(context, PersonalLinkSeed.Protector()).ReissueAsync(account, Guid.NewGuid(), Now.AddMinutes(-1));
        await context.SaveChangesAsync();
        return oldToken;
    }

    /// <summary>A live, active, enabled link in ANOTHER exercise, whose token is then presented here.</summary>
    private async Task<string> OtherExercisesTokenAsync()
    {
        var other = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var otherAccount = await PersonalLinkSeed.AccountAsync(_fixture, other.Id);
        var (_, otherToken) = await PersonalLinkSeed.LinkAsync(_fixture, otherAccount);
        return otherToken;
    }
}
