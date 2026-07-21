namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// Integration tests for the real <see cref="CurrentStaffSessionAccessor"/> (story 03) against REAL SQL Server
/// (Testcontainers) — the Wave-2 implementation of story 05's <c>ICurrentStaffSessionAccessor</c> seam. Proves
/// it yields a <c>CurrentStaffSession</c> ONLY for a live, non-revoked, non-expired <c>staff</c>-kind session,
/// and fails closed (null) for a participant / read-only / expired / revoked session or an absent token — so
/// the staff endpoints are staff-only by construction (XC-002).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class CurrentStaffSessionAccessorTests
{
    private readonly MsSqlContainerFixture _fixture;

    public CurrentStaffSessionAccessorTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private static IHttpContextAccessor AccessorWithToken(string? rawToken)
    {
        var context = new DefaultHttpContext();
        if (rawToken is not null)
        {
            context.Request.Headers.Authorization = $"Bearer {rawToken}";
        }

        return new HttpContextAccessor { HttpContext = context };
    }

    private async Task<Guid> SeedSessionAsync(
        string kind,
        string rawToken,
        Guid? staffUserId = null,
        DateTimeOffset? expiresAt = null,
        DateTimeOffset? revokedAt = null)
    {
        var sessionId = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(new Session
        {
            Id = sessionId,
            TokenHash = SessionTokens.Hash(rawToken),
            Kind = kind,
            ExerciseId = Guid.NewGuid(),
            PrincipalId = (staffUserId ?? Guid.NewGuid()).ToString(),
            StaffUserId = kind == "staff" ? staffUserId ?? Guid.NewGuid() : null,
            Role = kind == "staff" ? "controller" : "participant",
            ActingHumanId = "human-1",
            IsReadOnly = kind == "readonly",
            IssuedAt = DateTimeOffset.UtcNow.AddMinutes(-5),
            ExpiresAt = expiresAt ?? DateTimeOffset.UtcNow.AddHours(1),
            RevokedAt = revokedAt,
        });
        await seed.SaveChangesAsync();
        return sessionId;
    }

    [RequiresDockerFact]
    public async Task LiveStaffSession_ReturnsCurrentStaffSession()
    {
        var staffUserId = Guid.NewGuid();
        var sessionId = await SeedSessionAsync("staff", "staff-token", staffUserId);

        await using var context = _fixture.CreateContext();
        var accessor = new CurrentStaffSessionAccessor(context, AccessorWithToken("staff-token"));

        var current = await accessor.GetCurrentStaffSessionAsync();

        current.Should().NotBeNull("a live staff session authenticates the staff caller");
        current!.SessionId.Should().Be(sessionId);
        current.StaffUserId.Should().Be(staffUserId);
    }

    [RequiresDockerFact]
    public async Task ParticipantSession_ReturnsNull_FailClosed()
    {
        await SeedSessionAsync("participant", "participant-token");

        await using var context = _fixture.CreateContext();
        var accessor = new CurrentStaffSessionAccessor(context, AccessorWithToken("participant-token"));

        (await accessor.GetCurrentStaffSessionAsync()).Should().BeNull(
            "a participant session must never authenticate the staff endpoints (XC-002 — staff-only by construction)");
    }

    [RequiresDockerFact]
    public async Task ReadOnlySession_ReturnsNull_FailClosed()
    {
        await SeedSessionAsync("readonly", "readonly-token");

        await using var context = _fixture.CreateContext();
        var accessor = new CurrentStaffSessionAccessor(context, AccessorWithToken("readonly-token"));

        (await accessor.GetCurrentStaffSessionAsync()).Should().BeNull("a read-only session is not a staff session");
    }

    [RequiresDockerFact]
    public async Task ExpiredStaffSession_ReturnsNull_FailClosed()
    {
        await SeedSessionAsync("staff", "expired-staff", Guid.NewGuid(), expiresAt: DateTimeOffset.UtcNow.AddMinutes(-1));

        await using var context = _fixture.CreateContext();
        var accessor = new CurrentStaffSessionAccessor(context, AccessorWithToken("expired-staff"));

        (await accessor.GetCurrentStaffSessionAsync()).Should().BeNull("an expired staff session authenticates nothing");
    }

    [RequiresDockerFact]
    public async Task RevokedStaffSession_ReturnsNull_FailClosed()
    {
        await SeedSessionAsync("staff", "revoked-staff", Guid.NewGuid(), revokedAt: DateTimeOffset.UtcNow.AddMinutes(-1));

        await using var context = _fixture.CreateContext();
        var accessor = new CurrentStaffSessionAccessor(context, AccessorWithToken("revoked-staff"));

        (await accessor.GetCurrentStaffSessionAsync()).Should().BeNull("a revoked staff session authenticates nothing");
    }

    [RequiresDockerFact]
    public async Task NoToken_ReturnsNull_FailClosed()
    {
        await using var context = _fixture.CreateContext();
        var accessor = new CurrentStaffSessionAccessor(context, AccessorWithToken(null));

        (await accessor.GetCurrentStaffSessionAsync()).Should().BeNull("with no presented token there is no staff caller");
    }
}
