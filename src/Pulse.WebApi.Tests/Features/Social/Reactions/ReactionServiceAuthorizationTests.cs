namespace Pulse.WebApi.Tests.Features.Social.Reactions;

using System;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Social.Engagement;
using Pulse.WebApi.Features.Social.Follows;
using Pulse.WebApi.Features.Social.Reactions;

/// <summary>
/// The reaction service's identity gate (DP-10) in isolation, model-only: every refusal here is decided BEFORE any
/// database access, so the context points at a server that does not exist and would fail loudly if it were reached.
/// Pins the POSITIVE allowlist: only a <c>participant</c>-kind session may react; staff, read-only, an unknown future
/// kind, or a differently-cased kind are all refused, so "not staff" can never creep back in.
/// </summary>
public sealed class ReactionServiceAuthorizationTests
{
    private static readonly Guid Exercise = Guid.NewGuid();

    [Theory]
    [InlineData("staff")]
    [InlineData("readonly")]
    [InlineData("observer")]
    [InlineData("Participant")]
    [InlineData("")]
    public async Task OnlyAParticipantKindSession_MayReact_EveryOtherKindIsForbidden(string sessionKind)
    {
        var service = CreateService(Exercise, Session(sessionKind, Exercise));

        (await service.ReactAsync(Guid.NewGuid(), "like")).Outcome.Should().Be(
            ReactionOutcome.Forbidden, "kind '{0}' is not on the participant allowlist (DP-10)", sessionKind);
        (await service.UnreactAsync(Guid.NewGuid(), "repost")).Outcome.Should().Be(ReactionOutcome.Forbidden);
    }

    [Fact]
    public async Task NoSessionPersona_IsForbidden()
    {
        var service = CreateService(Exercise, sessionPersona: null);

        (await service.ReactAsync(Guid.NewGuid(), "like")).Outcome.Should().Be(ReactionOutcome.Forbidden);
    }

    [Fact]
    public async Task ASessionBoundToADifferentExercise_IsForbidden_NeverWrittenForInThisScope()
    {
        var service = CreateService(Exercise, Session("participant", Guid.NewGuid()));

        (await service.ReactAsync(Guid.NewGuid(), "like")).Outcome.Should().Be(
            ReactionOutcome.Forbidden, "a session/scope disagreement is resolved by refusing, never by writing (COR-001)");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task AnUnresolvedOrEmptyScope_FailsClosed(bool emptySentinel)
    {
        Guid? scope = emptySentinel ? Guid.Empty : null;
        var service = CreateService(scope, Session("participant", Exercise));

        (await service.ReactAsync(Guid.NewGuid(), "like")).Outcome.Should().Be(ReactionOutcome.ScopeUnresolved);
    }

    [Fact]
    public async Task AParticipantWithAnUnknownKind_IsInvalid()
    {
        var service = CreateService(Exercise, Session("participant", Exercise));

        var result = await service.ReactAsync(Guid.NewGuid(), "love");

        result.Outcome.Should().Be(ReactionOutcome.Invalid);
        result.ValidationError.Should().Be("kind must be 'like' or 'repost'.");
    }

    private static CurrentSessionPersona Session(string kind, Guid exerciseId) => new()
    {
        SessionId = Guid.NewGuid(),
        PersonaId = Guid.NewGuid(),
        Kind = kind,
        ExerciseId = exerciseId,
        ActingHumanId = "human-authz",
    };

    private static ReactionService CreateService(Guid? scope, CurrentSessionPersona? sessionPersona)
    {
        // Never opened: every path under test returns before the first query.
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer("Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;")
            .Options;
        var exerciseContext = new ExerciseContext { CurrentExerciseId = scope };
        var dbContext = new PulseDbContext(options, exerciseContext);

        return new ReactionService(
            dbContext,
            exerciseContext,
            new StubAccessor(sessionPersona),
            new ExerciseClockService(TimeProvider.System),
            new PostEngagementReader(dbContext, exerciseContext));
    }

    private sealed class StubAccessor : ICurrentSessionPersonaAccessor
    {
        private readonly CurrentSessionPersona? _sessionPersona;

        public StubAccessor(CurrentSessionPersona? sessionPersona) => _sessionPersona = sessionPersona;

        public Task<CurrentSessionPersona?> GetCurrentSessionPersonaAsync(CancellationToken cancellationToken = default)
            => Task.FromResult(_sessionPersona);
    }
}
