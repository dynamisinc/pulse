namespace Pulse.WebApi.Features.Identity.Sessions;

using Pulse.WebApi.Data.Entities;

/// <summary>
/// The single fail-closed definition of "a session is live" — shared by every consumer that authenticates a
/// presented token (the request-scope middleware's <see cref="SessionAuthenticator"/>, the
/// <see cref="CurrentStaffSessionAccessor"/>, and <see cref="SessionService"/>'s <c>GET /api/session</c> path)
/// so the live/expired/revoked decision can never drift between them. <see cref="SessionService"/> additionally
/// inspects <see cref="Pulse.WebApi.Data.Entities.Session.RevokedAt"/> to tell the expired-not-revoked case
/// (which emits <c>session.expired</c>) apart from the revoked case — but the "is it live?" boolean itself is
/// this one definition.
/// </summary>
internal static class SessionValidityExtensions
{
    /// <summary>
    /// A session is live only when it has NOT been revoked (logout / story-07 revoke-all) AND its wall-clock
    /// expiry is still in the future relative to <paramref name="asOf"/>. Anything else fails closed: a
    /// revoked or expired session authenticates NOTHING and resolves NO scope.
    /// </summary>
    /// <param name="session">The persisted session.</param>
    /// <param name="asOf">The reference instant (the server wall clock).</param>
    /// <returns><c>true</c> when the session is non-revoked and unexpired; otherwise <c>false</c>.</returns>
    public static bool IsLive(this Session session, DateTimeOffset asOf)
    {
        ArgumentNullException.ThrowIfNull(session);
        return session.RevokedAt is null && session.ExpiresAt > asOf;
    }
}
