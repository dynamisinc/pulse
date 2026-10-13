namespace Pulse.WebApi.Features.Identity.EasyLogin;

using System.Globalization;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Projects a participant's <see cref="ParticipantLink"/> (or the absence of one) to the frozen
/// <see cref="RosterLinkDto"/>, in one place, so the roster list (story 02), the staff link actions (story 03) and the
/// card sheet (story 04) agree on what "active", "recoverable" and "needs reissue" mean. Stateless: a singleton.
/// </summary>
/// <remarks>
/// <list type="bullet">
///   <item><description><b>No row</b>: <c>status: none</c>, <c>useCount: 0</c>, nothing else.</description></item>
///   <item><description><b>Revoked</b> (<c>RevokedAt</c> set): <c>status: revoked</c> with its instants and use count;
///   never a <c>joinUrl</c>.</description></item>
///   <item><description><b>Active and recoverable</b>: the protected copy decrypts to the token whose hash IS the row's
///   <c>TokenHash</c>: <c>joinUrl</c> is set when a join base is configured (omitted, with no <c>needsReissue</c>,
///   when it is not: the token is fine, the deployment has no SPA origin).</description></item>
///   <item><description><b>Active but unrecoverable</b>: no protected copy, it does not decrypt (lost key ring), or it
///   decrypts to some other token: <c>needsReissue: true</c> and no <c>joinUrl</c>. Never an exception.</description></item>
/// </list>
/// The join URL is a bearer credential: the factory never logs it.
/// </remarks>
public sealed class RosterLinkDtoFactory
{
    private readonly IParticipantLinkTokenProtector _protector;
    private readonly JoinUrlBuilder _joinUrlBuilder;

    /// <summary>Creates the factory.</summary>
    /// <param name="protector">Decrypts the stored token copy.</param>
    /// <param name="joinUrlBuilder">Builds the join URL from the token.</param>
    public RosterLinkDtoFactory(IParticipantLinkTokenProtector protector, JoinUrlBuilder joinUrlBuilder)
    {
        ArgumentNullException.ThrowIfNull(protector);
        ArgumentNullException.ThrowIfNull(joinUrlBuilder);

        _protector = protector;
        _joinUrlBuilder = joinUrlBuilder;
    }

    /// <summary>Projects a link row (or <c>null</c> for an account with no link) to the wire shape.</summary>
    /// <param name="link">The account's link row, read under the central exercise filter, or <c>null</c>.</param>
    /// <returns>The roster link state.</returns>
    public RosterLinkDto Create(ParticipantLink? link)
    {
        if (link is null)
        {
            return new RosterLinkDto { Status = RosterLinkStatuses.None, UseCount = 0 };
        }

        var issuedAt = FormatInstant(link.IssuedAt);
        var lastUsedAt = link.LastUsedAt is { } used ? FormatInstant(used) : null;

        if (link.RevokedAt is { } revoked)
        {
            return new RosterLinkDto
            {
                Status = RosterLinkStatuses.Revoked,
                IssuedAt = issuedAt,
                RevokedAt = FormatInstant(revoked),
                LastUsedAt = lastUsedAt,
                UseCount = link.UseCount,
            };
        }

        var token = RecoverToken(link);

        return new RosterLinkDto
        {
            Status = RosterLinkStatuses.Active,
            IssuedAt = issuedAt,
            LastUsedAt = lastUsedAt,
            UseCount = link.UseCount,
            JoinUrl = token is null ? null : _joinUrlBuilder.Build(token),
            NeedsReissue = token is null ? true : null,
        };
    }

    /// <summary>
    /// The raw token behind an active link, or <c>null</c> when the stored copy is missing, does not decrypt, or
    /// decrypts to a token that is not the one the row's hash names (a stale copy must never print a dead link).
    /// </summary>
    private string? RecoverToken(ParticipantLink link)
    {
        var token = _protector.Unprotect(link.ProtectedToken);
        if (token is null)
        {
            return null;
        }

        return string.Equals(ParticipantLinkTokens.Hash(token), link.TokenHash, StringComparison.Ordinal)
            ? token
            : null;
    }

    private static string FormatInstant(DateTimeOffset instant) => instant.ToString("O", CultureInfo.InvariantCulture);
}
