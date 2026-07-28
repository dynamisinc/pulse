namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using FluentAssertions;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// <see cref="SessionPrincipal"/> — the projection of a live session onto <c>HttpContext.User</c> (the single
/// fact story 11's default-deny fallback policy reads) and, as of <c>identity-auth-roles/13</c> (#362), the way
/// back: <see cref="SessionPrincipal.Read"/>, which <c>POST /api/telemetry</c> uses to stamp an event's scope and
/// actor instead of believing the envelope.
/// </summary>
/// <remarks>
/// <b>Why <see cref="SessionPrincipal.Read"/> is worth its own suite.</b> It is the boundary where "authenticated"
/// becomes "identified", and every failure mode has to land on <c>null</c>. A partially-populated identity would be
/// worse than none: a consumer that believed a half-empty one would stamp a telemetry row it could not attribute,
/// which is precisely the unattributable-evaluation-record harm story 13 exists to prevent (COR-018).
/// </remarks>
public class SessionPrincipalTests
{
    private static readonly Guid SessionId = Guid.Parse("aaaaaaaa-0000-4000-8000-00000000000a");
    private static readonly Guid ExerciseId = Guid.Parse("bbbbbbbb-0000-4000-8000-00000000000b");
    private static readonly Guid PersonaId = Guid.Parse("cccccccc-0000-4000-8000-00000000000c");
    private static readonly Guid StaffUserId = Guid.Parse("dddddddd-0000-4000-8000-00000000000d");

    [Fact]
    public void CreateThenRead_RoundTripsEverySessionFact()
    {
        var principal = SessionPrincipal.Create(Session(personaId: PersonaId));

        var identity = SessionPrincipal.Read(principal);

        identity.Should().NotBeNull();
        identity!.SessionId.Should().Be(SessionId);
        identity.ExerciseId.Should().Be(ExerciseId);
        identity.Kind.Should().Be("participant");
        identity.PrincipalId.Should().Be("account-1");
        identity.ActingHumanId.Should().Be("human-1");
        identity.PersonaId.Should().Be(PersonaId);
        identity.StaffUserId.Should().BeNull("a participant session has no bound StaffUser");
    }

    [Fact]
    public void CreateThenRead_CarriesAStaffSessionsStaffUserId_AndNoPersonaBinding()
    {
        var principal = SessionPrincipal.Create(Session(kind: "staff", staffUserId: StaffUserId, personaId: null));

        var identity = SessionPrincipal.Read(principal);

        identity.Should().NotBeNull();
        identity!.Kind.Should().Be("staff");
        identity.StaffUserId.Should().Be(StaffUserId);
        identity.PersonaId.Should().BeNull();
    }

    [Fact]
    public void Read_OfNothing_IsNull()
    {
        SessionPrincipal.Read(null).Should().BeNull();
    }

    [Fact]
    public void Read_OfAnAnonymousPrincipal_IsNull()
    {
        SessionPrincipal.Read(new ClaimsPrincipal(new ClaimsIdentity())).Should().BeNull(
            "an unauthenticated request identifies nobody");
    }

    [Fact]
    public void Read_OfClaimsCarriedByAnUnauthenticatedIdentity_IsNull()
    {
        // The trap SessionPrincipal's own remarks call out: ClaimsIdentity.IsAuthenticated is true ONLY when the
        // identity carries an authenticationType. An identity built without one is anonymous no matter how many
        // claims it holds — so a caller that could somehow attach these claims without authenticating gets nothing.
        var unauthenticated = new ClaimsPrincipal(new ClaimsIdentity(RequiredClaims()));

        SessionPrincipal.Read(unauthenticated).Should().BeNull();
    }

    [Fact]
    public void Read_OfAForeignAuthenticationTypeCarryingTheSameClaims_IsNull()
    {
        // Fail closed on provenance, not just on shape. If another authentication scheme is ever added to this
        // host, its principal must not be readable as a Pulse session identity merely because the claim TYPES
        // happen to match — the claims would be that scheme's assertions, vouched for by nothing here.
        var foreign = new ClaimsPrincipal(new ClaimsIdentity(RequiredClaims(), "SomeOtherScheme"));

        SessionPrincipal.Read(foreign).Should().BeNull();
    }

    [Theory]
    [InlineData(SessionPrincipal.SessionIdClaimType)]
    [InlineData(SessionPrincipal.ExerciseIdClaimType)]
    [InlineData(SessionPrincipal.SessionKindClaimType)]
    [InlineData(SessionPrincipal.PrincipalIdClaimType)]
    [InlineData(SessionPrincipal.ActingHumanIdClaimType)]
    public void Read_WithAnyRequiredClaimMissing_IsNull(string missingClaimType)
    {
        var claims = RequiredClaims().Where(claim => claim.Type != missingClaimType).ToList();
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, SessionPrincipal.AuthenticationType));

        SessionPrincipal.Read(principal).Should().BeNull(
            "{0} is required — a partially-populated identity is never returned", missingClaimType);
    }

    [Theory]
    [InlineData(SessionPrincipal.SessionIdClaimType, "")]
    [InlineData(SessionPrincipal.SessionIdClaimType, "not-a-guid")]
    [InlineData(SessionPrincipal.SessionIdClaimType, "00000000-0000-0000-0000-000000000000")]
    [InlineData(SessionPrincipal.ExerciseIdClaimType, "")]
    [InlineData(SessionPrincipal.ExerciseIdClaimType, "not-a-guid")]
    [InlineData(SessionPrincipal.ExerciseIdClaimType, "00000000-0000-0000-0000-000000000000")]
    [InlineData(SessionPrincipal.SessionKindClaimType, "")]
    [InlineData(SessionPrincipal.PrincipalIdClaimType, "")]
    [InlineData(SessionPrincipal.ActingHumanIdClaimType, "")]
    public void Read_WithAnyRequiredClaimUnusable_IsNull(string claimType, string value)
    {
        // Guid.Empty is called out explicitly: it is the fail-closed sentinel the exercise-scope write-guard
        // rejects, so reading it as a real scope would turn a clean rejection into a 500 at SaveChanges.
        var claims = RequiredClaims()
            .Where(claim => claim.Type != claimType)
            .Append(new Claim(claimType, value))
            .ToList();
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, SessionPrincipal.AuthenticationType));

        SessionPrincipal.Read(principal).Should().BeNull();
    }

    [Theory]
    [InlineData(SessionPrincipal.StaffUserIdClaimType)]
    [InlineData(SessionPrincipal.PersonaIdClaimType)]
    public void Read_WithAnUnusableOPTIONALClaim_YieldsNullForThatFactOnly(string claimType)
    {
        // The optional facts fail SOFT — an unparseable value means "not bound", which is the same fail-closed
        // answer as absent (no persona to act as / not a staff user), and must not discard the whole identity.
        var claims = RequiredClaims().Append(new Claim(claimType, "not-a-guid")).ToList();
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, SessionPrincipal.AuthenticationType));

        var identity = SessionPrincipal.Read(principal);

        identity.Should().NotBeNull();
        identity!.StaffUserId.Should().BeNull();
        identity.PersonaId.Should().BeNull();
    }

    [Fact]
    public void Create_OmitsTheOptionalClaimsForASessionThatCarriesNeither()
    {
        var principal = SessionPrincipal.Create(Session(personaId: null));

        principal.FindFirst(SessionPrincipal.StaffUserIdClaimType).Should().BeNull();
        principal.FindFirst(SessionPrincipal.PersonaIdClaimType).Should().BeNull();
    }

    [Fact]
    public void Create_NeverCarriesTokenMaterial()
    {
        // NFR-009. The principal is ids only; nothing here may be a credential, and the claim SET is closed so a
        // future field cannot be added to AuthenticatedSession and leak onto the wire unnoticed.
        var principal = SessionPrincipal.Create(
            Session(kind: "staff", staffUserId: StaffUserId, personaId: PersonaId));

        principal.Claims.Select(claim => claim.Type).Should().BeEquivalentTo(
        [
            SessionPrincipal.SessionIdClaimType,
            SessionPrincipal.SessionKindClaimType,
            SessionPrincipal.ExerciseIdClaimType,
            SessionPrincipal.PrincipalIdClaimType,
            SessionPrincipal.ActingHumanIdClaimType,
            SessionPrincipal.StaffUserIdClaimType,
            SessionPrincipal.PersonaIdClaimType,
        ]);
    }

    /// <summary>
    /// A live session. Both optional bindings are passed EXPLICITLY — "carries neither" is a case under test, so a
    /// convenience default that quietly supplied one would make the omission assertions vacuous.
    /// </summary>
    private static AuthenticatedSession Session(
        string kind = "participant",
        Guid? staffUserId = null,
        Guid? personaId = null) => new()
        {
            SessionId = SessionId,
            ExerciseId = ExerciseId,
            Kind = kind,
            PrincipalId = "account-1",
            ActingHumanId = "human-1",
            StaffUserId = staffUserId,
            PersonaId = personaId,
        };

    /// <summary>The five claims <see cref="SessionPrincipal.Read"/> requires, as a mutable list.</summary>
    private static List<Claim> RequiredClaims() =>
    [
        new(SessionPrincipal.SessionIdClaimType, SessionId.ToString()),
        new(SessionPrincipal.ExerciseIdClaimType, ExerciseId.ToString()),
        new(SessionPrincipal.SessionKindClaimType, "participant"),
        new(SessionPrincipal.PrincipalIdClaimType, "account-1"),
        new(SessionPrincipal.ActingHumanIdClaimType, "human-1"),
    ];
}
