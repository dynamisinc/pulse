namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using System;
using System.Linq;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Sessions;
using Xunit;

/// <summary>
/// #839 — the person-state half of session validity (<see cref="SessionHolderQueries"/>), model-only: the decision
/// table of <see cref="SessionHolderQueries.HolderPermits"/>, and proof that the standing is read in the SAME SQL
/// statement as the session (no extra round-trip on the every-request path). The real-SQL race reproductions live in
/// <see cref="SessionHolderRaceTests"/>.
/// </summary>
public sealed class SessionHolderStandingTests
{
    private static readonly DateTimeOffset IssuedAt = new(2026, 11, 20, 12, 0, 0, TimeSpan.Zero);

    private static Session NewSession(Guid? exerciseId, Guid? personId = null) => new()
    {
        Id = Guid.NewGuid(),
        TokenHash = "hash",
        Kind = "staff",
        ExerciseId = exerciseId,
        PrincipalId = "p",
        PersonId = personId ?? Guid.NewGuid(),
        Role = exerciseId is null ? Person.OrgAdminRole : "controller",
        ActingHumanId = "h",
        IssuedAt = IssuedAt,
        ExpiresAt = IssuedAt.AddHours(1),
    };

    private static SessionHolderStanding Standing(
        DateTimeOffset? disabledAt = null,
        string? orgRole = null,
        DateTimeOffset? passwordChangedAt = null) =>
        new() { DisabledAt = disabledAt, OrgRole = orgRole, PasswordChangedAt = passwordChangedAt };

    [Fact]
    public void AnEnabledPerson_WithNoPasswordChangeSinceIssue_PermitsAnExerciseSession()
    {
        SessionHolderQueries.HolderPermits(NewSession(Guid.NewGuid()), Standing())
            .Should().BeTrue("nothing about the person has changed");
    }

    [Fact]
    public void ADisabledPerson_PermitsNoSession_OfAnyScope()
    {
        var disabled = Standing(disabledAt: IssuedAt.AddMinutes(1), orgRole: Person.OrgAdminRole);

        SessionHolderQueries.HolderPermits(NewSession(Guid.NewGuid()), disabled).Should().BeFalse("disable ends every session");
        SessionHolderQueries.HolderPermits(NewSession(exerciseId: null), disabled).Should().BeFalse("disable ends org scope too");
    }

    [Fact]
    public void AnOrgScopeSession_NeedsTheOrgAdminGrant_ButAnExerciseSessionDoesNot()
    {
        SessionHolderQueries.HolderPermits(NewSession(exerciseId: null), Standing(orgRole: Person.OrgAdminRole))
            .Should().BeTrue("an enabled org admin keeps their org-scope session");
        SessionHolderQueries.HolderPermits(NewSession(exerciseId: null), Standing(orgRole: "ORGADMIN"))
            .Should().BeTrue("the grant compares case-insensitively, matching the CI collation");
        SessionHolderQueries.HolderPermits(NewSession(exerciseId: null), Standing(orgRole: null))
            .Should().BeFalse("a demoted org admin's org-scope session is refused");
        SessionHolderQueries.HolderPermits(NewSession(Guid.NewGuid()), Standing(orgRole: null))
            .Should().BeTrue("losing the org grant revokes only org-scope sessions, never exercise ones");
    }

    [Fact]
    public void APasswordChangedAfterIssue_RefusesTheSession_ButOneAtOrBeforeIssueDoesNot()
    {
        SessionHolderQueries.HolderPermits(NewSession(Guid.NewGuid()), Standing(passwordChangedAt: IssuedAt.AddTicks(1)))
            .Should().BeFalse("a session issued before the password change was minted on the old credential");
        SessionHolderQueries.HolderPermits(NewSession(Guid.NewGuid()), Standing(passwordChangedAt: IssuedAt))
            .Should().BeTrue("the same instant is not an older credential");
        SessionHolderQueries.HolderPermits(NewSession(Guid.NewGuid()), Standing(passwordChangedAt: IssuedAt.AddDays(-1)))
            .Should().BeTrue("a sign-in after the change uses the new credential");
    }

    [Fact]
    public void ASessionWithNoPersonRow_PassesAtExerciseScope_ButFailsClosedAtOrgScope()
    {
        SessionHolderQueries.HolderPermits(NewSession(Guid.NewGuid()), holder: null)
            .Should().BeTrue("a one-off participant or read-only viewer has no person to re-check");
        SessionHolderQueries.HolderPermits(NewSession(exerciseId: null), holder: null)
            .Should().BeFalse("an org-scope session is only ever an org admin's, so a missing person fails closed");
    }

    [Fact]
    public void TheStanding_IsReadInTheSameStatementAsTheSession_NoExtraRoundTrip()
    {
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer("Server=model-only;Database=none;")
            .Options;
        using var context = new PulseDbContext(options);

        var sql = context.Sessions
            .AsNoTracking()
            .Where(s => s.TokenHash == "hash")
            .WithHolderStanding(context)
            .ToQueryString();

        sql.Should().Contain("[Sessions]").And.Contain("[People]", "the person is read by the session lookup itself");
        sql.Split("SELECT", StringSplitOptions.None).Length.Should().BeGreaterThan(
            2, "the person read is a correlated subquery of the one statement");
        sql.Should().Contain("COALESCE", "a legacy staff session names its person only through the shared-key StaffUserId");
    }
}
