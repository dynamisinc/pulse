namespace Pulse.WebApi.Tests.Helpers;

using System;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// Builds live <see cref="Session"/> rows for suites that drive the REAL pipeline with a REAL bearer token —
/// the preferred harness once the default-deny gate exists (identity-auth-roles/11), because it exercises
/// host resolution, session authentication and the gate exactly as production does.
/// </summary>
/// <remarks>
/// <para>
/// Prefer this over <see cref="FakeAuthenticatedSessionExtensions.UseFakeAuthenticatedSession"/>: the shim is
/// for older suites that already fake the exercise scope through DI (where host resolution is bypassed
/// entirely and a real token would have nothing to bind against). New suites should seed a session and present
/// its token.
/// </para>
/// <para>
/// Deliberately mirrors <c>Follows/FollowTestHost.NewSession</c>, which predates this file and is left in
/// place; that duplication is worth collapsing when the several session-lookup/seeding seams are consolidated
/// (flagged as a follow-up in story 12).
/// </para>
/// </remarks>
public static class TestSessions
{
    /// <summary>
    /// A live session row. The token is stored hashed, never in the clear.
    /// </summary>
    /// <param name="rawToken">The raw token the client will present as <c>Authorization: Bearer</c>.</param>
    /// <param name="exerciseId">The exercise the session is bound to. A <c>participant</c> session is host-bound, so this MUST equal the exercise the request's host resolves to or the middleware fails closed with 403.</param>
    /// <param name="personaId">The session's persona binding, or <c>null</c> for a session with none.</param>
    /// <param name="kind">The session kind — <c>participant</c>, <c>staff</c>, or <c>readonly</c>.</param>
    /// <param name="isReadOnly">Whether this is a view-only session (COR-015).</param>
    /// <returns>The session entity to seed.</returns>
    public static Session NewSession(
        string rawToken,
        Guid exerciseId,
        Guid? personaId = null,
        string kind = "participant",
        bool isReadOnly = false) => new()
        {
            Id = Guid.NewGuid(),
            TokenHash = SessionTokens.Hash(rawToken),
            Kind = kind,
            ExerciseId = exerciseId,
            PrincipalId = Guid.NewGuid().ToString(),
            Role = kind == "staff" ? "controller" : "participant",
            PersonaId = personaId,
            ActingHumanId = $"human-{Guid.NewGuid():N}",
            IsReadOnly = isReadOnly,
            IssuedAt = DateTimeOffset.UtcNow.AddMinutes(-5),
            ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
        };
}
