namespace Pulse.WebApi.Features.Identity.EasyLogin;

using Pulse.WebApi.Data.Entities;

/// <summary>
/// The seam through which roster provisioning (story 02) gives a participant an active personal link. Story 01 ships a
/// fail-closed default (<see cref="NullParticipantLinkIssuer"/>); story 03's <c>AddPersonalLinks()</c> REPLACES it with
/// the real issuer (use <c>services.Replace(...)</c>, as <c>AddSessions</c> does for the staff-session accessor, so the
/// registration order in <c>Program.cs</c> does not matter).
/// </summary>
/// <remarks>
/// <para>
/// <b>Contract for implementations.</b> Returns the account's existing ACTIVE link unchanged (never rotates it);
/// otherwise creates the first link, or re-activates a revoked one with a fresh token. The link's
/// <c>ExerciseId</c> is stamped from <paramref name="account"/>'s own scope, never from a request value.
/// </para>
/// <para>
/// <b>Same unit of work as the caller.</b> The issuer STAGES its changes on the request's <c>PulseDbContext</c> and does
/// not call <c>SaveChanges</c>, so a roster row and its link commit (or fail) together in the caller's single save.
/// It emits no telemetry: the caller, which holds the staff role, emits <c>participant.link.issued</c> with
/// <see cref="EasyLoginTelemetry.LinkIssued"/> when a link was newly issued.
/// </para>
/// <para>
/// <b>Telling "newly issued" from "already active".</b> The return value is the active link either way; the caller
/// infers a new link from the change tracker: <c>dbContext.Entry(link).State == EntityState.Added</c> means this call
/// created it (a revoked link re-activated in place reads <c>Modified</c>; an untouched active link reads
/// <c>Unchanged</c>). The null default returns <c>null</c>, so nothing is inferred and no event is emitted.
/// </para>
/// </remarks>
public interface IParticipantLinkIssuer
{
    /// <summary>Ensures <paramref name="account"/> has an active personal link, staging any change on the caller's unit of work.</summary>
    /// <param name="account">The participant account, loaded or created under the central exercise filter.</param>
    /// <param name="issuedByStaffUserId">The staff user issuing the link, or <c>null</c> for provisioning.</param>
    /// <param name="now">The caller's one server wall-clock read.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The active link, or <c>null</c> when no link could be issued (the fail-closed default always returns <c>null</c>).</returns>
    Task<ParticipantLink?> EnsureActiveAsync(
        Account account,
        Guid? issuedByStaffUserId,
        DateTimeOffset now,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The fail-closed default <see cref="IParticipantLinkIssuer"/>: it issues nothing and returns <c>null</c>, so before
/// story 03's real issuer is wired a new participant simply reports no link (<c>link.status: 'none'</c>) rather than the
/// host failing to start or a link being minted by a half-built path. Stateless.
/// </summary>
public sealed class NullParticipantLinkIssuer : IParticipantLinkIssuer
{
    /// <inheritdoc />
    public Task<ParticipantLink?> EnsureActiveAsync(
        Account account,
        Guid? issuedByStaffUserId,
        DateTimeOffset now,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(account);
        return Task.FromResult<ParticipantLink?>(null);
    }
}
