namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// Integration tests for <see cref="SessionIssuer"/> (story 03, COR-012 / NFR-009) against REAL SQL Server
/// (Testcontainers). Proves issuance persists ONLY the token/refresh HASHES (never the raw tokens), stamps a
/// short-lived expiry + refresh window server-side, binds every identity field from the request, and hands the
/// raw tokens back exactly once.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class SessionIssuerTests
{
    private readonly MsSqlContainerFixture _fixture;

    public SessionIssuerTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private static SessionIssuer IssuerFor(PulseDbContext context, SessionOptions? options = null) =>
        new(context, Options.Create(options ?? new SessionOptions()));

    private static SessionIssueRequest ParticipantRequest(Guid exerciseId, Guid accountId, Guid personaId) => new()
    {
        ExerciseId = exerciseId,
        Kind = "participant",
        Role = "participant",
        PrincipalId = accountId.ToString(),
        ActingHumanId = "human-42",
        IsReadOnly = false,
        AccountId = accountId,
        StaffUserId = null,
        PersonaId = personaId,
    };

    [RequiresDockerFact]
    public async Task Issue_PersistsOnlyHashes_NeverRawTokens()
    {
        var exerciseId = Guid.NewGuid();
        var accountId = Guid.NewGuid();
        var personaId = Guid.NewGuid();

        SessionIssueResult issued;
        await using (var context = _fixture.CreateContext())
        {
            issued = await IssuerFor(context).IssueAsync(ParticipantRequest(exerciseId, accountId, personaId));
        }

        issued.SessionToken.Should().NotBeNullOrEmpty("the raw session token is returned to the caller once");
        issued.RefreshToken.Should().NotBeNullOrEmpty("the raw refresh token is returned to the caller once");

        await using var verify = _fixture.CreateContext();
        var stored = await verify.Sessions.SingleAsync(s => s.Id == issued.Session.Id);

        stored.TokenHash.Should().Be(SessionTokens.Hash(issued.SessionToken!),
            "the stored TokenHash is the hash of the raw token handed to the client");
        stored.TokenHash.Should().NotBe(issued.SessionToken, "the RAW token is never persisted (NFR-009)");
        stored.RefreshTokenHash.Should().Be(SessionTokens.Hash(issued.RefreshToken!));
        stored.RefreshTokenHash.Should().NotBe(issued.RefreshToken, "the RAW refresh token is never persisted (NFR-009)");
    }

    [RequiresDockerFact]
    public async Task Issue_StampsShortLivedExpiryAndRefreshWindow_ServerSide()
    {
        var exerciseId = Guid.NewGuid();
        var options = new SessionOptions { SessionLifetimeMinutes = 30, RefreshLifetimeMinutes = 240 };
        var before = DateTimeOffset.UtcNow;

        await using var context = _fixture.CreateContext();
        var issued = await IssuerFor(context, options).IssueAsync(ParticipantRequest(exerciseId, Guid.NewGuid(), Guid.NewGuid()));

        var session = issued.Session;
        session.IssuedAt.Should().BeOnOrAfter(before, "issued-at is the server wall clock, never client input");
        session.ExpiresAt.Should().BeCloseTo(session.IssuedAt.AddMinutes(30), TimeSpan.FromSeconds(5),
            "the access window is the configured short-lived lifetime");
        session.RefreshExpiresAt.Should().NotBeNull();
        session.RefreshExpiresAt!.Value.Should().BeCloseTo(session.IssuedAt.AddMinutes(240), TimeSpan.FromSeconds(5),
            "the refresh window is the configured (longer) lifetime");
    }

    [RequiresDockerFact]
    public async Task Issue_BindsEveryIdentityFieldFromTheRequest()
    {
        var exerciseId = Guid.NewGuid();
        var accountId = Guid.NewGuid();
        var personaId = Guid.NewGuid();

        await using var context = _fixture.CreateContext();
        var issued = await IssuerFor(context).IssueAsync(ParticipantRequest(exerciseId, accountId, personaId));

        var session = issued.Session;
        session.Kind.Should().Be("participant");
        session.ExerciseId.Should().Be(exerciseId, "the session binds to exactly one exercise (COR-012)");
        session.Role.Should().Be("participant");
        session.PrincipalId.Should().Be(accountId.ToString());
        session.AccountId.Should().Be(accountId, "a participant session binds to exactly one account (COR-012)");
        session.PersonaId.Should().Be(personaId);
        session.ActingHumanId.Should().Be("human-42");
        session.IsReadOnly.Should().BeFalse();
        session.StaffUserId.Should().BeNull();
        session.RevokedAt.Should().BeNull("a freshly issued session is live");
    }

    [RequiresDockerFact]
    public async Task Issue_SatisfiesTheStaffLoginRequestShape()
    {
        // Story 05's StaffLoginService already calls IssueAsync with Kind="staff", StaffUserId set, no account /
        // persona. Prove the real issuer honors exactly that request shape (the seam story 05 depends on).
        var exerciseId = Guid.NewGuid();
        var staffUserId = Guid.NewGuid();

        await using var context = _fixture.CreateContext();
        var issued = await IssuerFor(context).IssueAsync(new SessionIssueRequest
        {
            ExerciseId = exerciseId,
            Kind = "staff",
            Role = "controller",
            PrincipalId = staffUserId.ToString(),
            ActingHumanId = staffUserId.ToString(),
            IsReadOnly = false,
            AccountId = null,
            StaffUserId = staffUserId,
            PersonaId = null,
        });

        issued.Session.Kind.Should().Be("staff");
        issued.Session.StaffUserId.Should().Be(staffUserId);
        issued.Session.AccountId.Should().BeNull();
        issued.Session.PersonaId.Should().BeNull();
        issued.Session.Role.Should().Be("controller");
    }
}
