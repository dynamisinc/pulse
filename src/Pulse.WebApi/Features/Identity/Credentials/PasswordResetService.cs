namespace Pulse.WebApi.Features.Identity.Credentials;

using System.Globalization;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Realtime;

/// <summary>
/// Sets a staff person's password from a single-use link (identity-auth-roles/21, ADMIN-IDENTITY-MODEL §3.3):
/// <c>POST /api/auth/password/reset {token, newPassword}</c>. Works for both <c>reset</c> and <c>invite</c> tokens.
/// </summary>
/// <remarks>
/// <para>
/// <b>Order.</b> (1) The token is looked up; anything but a live, unused token naming an enabled person in the token's
/// own organization is the uniform <see cref="InvalidTokenError"/>. (2) The password is checked against
/// <see cref="PasswordPolicy"/> (staff floor, §3.2) — a policy refusal does NOT consume the token, so the person can
/// retry. (3) In ONE transaction: the token is claimed by a single conditional statement (a lost race is the uniform
/// error), the password is hashed with the SAME <see cref="PasswordHasher{TUser}"/> sign-in verifies with, every
/// outstanding credential token of both purposes and every unconsumed org-choice candidate of the person are voided,
/// every live session of the person is revoked, the lockout counter is cleared, and the change is audited.
/// (4) After the commit, the revoked sessions' live hub connections are cut (best effort).
/// </para>
/// <para>
/// <b>The invite landing (#575b, ADMIN-IDENTITY-MODEL §3.3 "Staff invites without a grant").</b> Redeeming an INVITE also
/// answers where the person goes next (<see cref="InviteLanding"/>): <see cref="InviteLanding.SignInNext"/> when they hold
/// a grant the org sign-in can mint a session from — a staff facet AND (<c>OrgRole = orgAdmin</c> or an active staff
/// enrollment in the organization) — else <see cref="InviteLanding.AwaitingAssignmentNext"/>. This route mints no session
/// itself: the client signs in through the ordinary org sign-in (<c>POST /api/auth/staff/login {orgSlug, email,
/// password}</c>), so lockout, the fixed slow-hash work, the timing floor and the sign-in audit stay in ONE place. The
/// landing carries the org slug and the person's own email: the caller just proved possession of a token that was
/// delivered to that address, so it discloses nothing the caller does not already hold. A reset answers no landing.
/// </para>
/// <para>
/// <b>Audit, not XC-004.</b> <c>TelemetryEvent</c> needs an exercise and a person has none here (the route is
/// pre-auth and the person spans exercises), so <see cref="CredentialChangedKind"/> is an <see cref="OrgAuditEvent"/>
/// in the person's organization (§7.5), in the same unit of work. It never carries the token, the password or a hash.
/// </para>
/// </remarks>
public sealed partial class PasswordResetService
{
    /// <summary>The uniform error code for a missing, malformed, unknown, expired, used or voided token.</summary>
    public const string InvalidTokenError = "invalid-token";

    /// <summary>The org-audit kind of a completed credential change.</summary>
    public const string CredentialChangedKind = "identity.credential.changed";

    /// <summary>The org-audit kind of a redeemed invite (alongside <see cref="CredentialChangedKind"/>).</summary>
    public const string InviteRedeemedKind = "org.invite.redeemed";

    /// <summary>The audit outcome of a completed change.</summary>
    public const string SuccessOutcome = "success";

    private const int DeadlockVictimErrorNumber = 1205;

    private static readonly PasswordHasher<Person> Hasher = new();

    private readonly PulseDbContext _dbContext;
    private readonly CredentialTokenService _tokens;
    private readonly TimeProvider _timeProvider;
    private readonly ISessionConnectionRevoker _connectionRevoker;
    private readonly ILogger<PasswordResetService> _logger;

    /// <summary>Creates the service.</summary>
    /// <param name="dbContext">The request-scoped persistence context (one unit of work).</param>
    /// <param name="tokens">The credential-token lifecycle.</param>
    /// <param name="timeProvider">The server wall clock.</param>
    /// <param name="connectionRevoker">Cuts the live hub connections of the sessions the change revokes.</param>
    /// <param name="logger">Logs a post-commit connection cut that failed (never the token or the password).</param>
    public PasswordResetService(
        PulseDbContext dbContext,
        CredentialTokenService tokens,
        TimeProvider timeProvider,
        ISessionConnectionRevoker connectionRevoker,
        ILogger<PasswordResetService>? logger = null)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(tokens);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(connectionRevoker);

        _dbContext = dbContext;
        _tokens = tokens;
        _timeProvider = timeProvider;
        _connectionRevoker = connectionRevoker;
        _logger = logger ?? NullLogger<PasswordResetService>.Instance;
    }

    /// <summary>Redeems <paramref name="request"/>'s token and sets the new password.</summary>
    /// <param name="request">The request body (may be <c>null</c>).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome the endpoint maps to a status.</returns>
    public async Task<PasswordResetResult> ResetAsync(PasswordResetRequest? request, CancellationToken cancellationToken = default)
    {
        var now = _timeProvider.GetUtcNow();

        var token = await _tokens.FindRedeemableAsync(request?.Token, now, cancellationToken);
        if (token?.PersonId is not { } personId)
        {
            // Account (one-off participant) tokens belong to the participant reset, which is not this route.
            return PasswordResetResult.Invalid(InvalidTokenError);
        }

        // Bounded by the token's OWN organization: a token can only ever reach a person of the tenant it was issued in.
        var person = await _dbContext.People
            .InOrganization(token.OrganizationId)
            .FirstOrDefaultAsync(p => p.Id == personId, cancellationToken);
        if (person is null || person.DisabledAt is not null || CredentialTokenService.IsStaleFor(token, person.PasswordChangedAt))
        {
            return PasswordResetResult.Invalid(InvalidTokenError);
        }

        // Adversarial review W5 (#665): the admin reset refuses a PEER org admin at issue, but the target may have been
        // promoted to org admin after the link was issued. Refuse the redemption then too (uniformly) unless the person
        // issued it themselves. A token with no issuer is not a peer's link: CredentialTokenService.StageIssueAsync only
        // creates one for SELF-DELIVERY to the subject's own email (the null-issuer rule — #575b's first-admin invite and
        // the later forgot-password MUST comply), so it can never have been handed to a third party.
        if (Person.IsOrgAdmin(person.OrgRole) && token.IssuedByPersonId is { } issuer && issuer != person.Id)
        {
            return PasswordResetResult.Invalid(InvalidTokenError);
        }

        // org-scope-exempt(TenantRoot): a by-id lookup of the person's OWN organization (token.OrganizationId, which the
        // server stamped at issue) for its name — the policy refuses a password containing it — and its slug (an invite's
        // landing). Never an enumeration.
        var organization = await _dbContext.Organizations
            .AsNoTracking()
            .Where(o => o.Id == token.OrganizationId)
            .Select(o => new { o.Name, o.Slug })
            .FirstOrDefaultAsync(cancellationToken);
        var organizationName = organization?.Name;

        var policyError = PasswordPolicy.Validate(
            request!.NewPassword,
            PasswordAudience.Staff,
            new PasswordContext { OrganizationName = organizationName, Email = person.Email, DisplayName = person.DisplayName });
        if (policyError is not null)
        {
            // The token is NOT consumed: the person can try again with a better password.
            return PasswordResetResult.Invalid(policyError);
        }

        CredentialChange? change;
        try
        {
            change = await ChangeCredentialAsync(token, person, request.NewPassword!, now, cancellationToken);
        }
        catch (Exception exception) when (IsDeadlock(exception))
        {
            // Adversarial review S3 (#665): two concurrent redemptions can deadlock; SQL Server rolls the victim back, so
            // nothing changed — the same uniform answer as losing the claim.
            _dbContext.ChangeTracker.Clear();
            return PasswordResetResult.Invalid(InvalidTokenError);
        }

        if (change is null)
        {
            return PasswordResetResult.Invalid(InvalidTokenError);
        }

        await CutRevokedConnectionsAfterCommitAsync(change.RevokedSessionIds, cancellationToken);

        var landing = token.Purpose == CredentialTokenPurposes.Invite && organization is not null && person.Email is { Length: > 0 } email
            ? new InviteLanding(change.HasGrant ? InviteLanding.SignInNext : InviteLanding.AwaitingAssignmentNext, organization.Slug, email)
            : null;
        return PasswordResetResult.Ok(landing);
    }

    private static bool IsDeadlock(Exception exception) =>
        exception is SqlException { Number: DeadlockVictimErrorNumber }
        || exception.InnerException is SqlException { Number: DeadlockVictimErrorNumber };

    /// <summary>
    /// The single transaction of a credential change. Returns the revoked session ids and (for an invite) whether the
    /// person holds a grant, or <c>null</c> when the claim was lost (a concurrent redemption, or the token expired in
    /// between) and nothing changed.
    /// </summary>
    private async Task<CredentialChange?> ChangeCredentialAsync(
        CredentialToken token,
        Person person,
        string newPassword,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        List<Guid> revokedSessionIds;
        var hasGrant = false;
        await using (var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken))
        {
            if (!await _tokens.TryClaimAsync(token.Id, token.OrganizationId, now, cancellationToken))
            {
                // Lost a race with a concurrent redemption (or it expired in between): the same uniform answer.
                await transaction.RollbackAsync(cancellationToken);
                return null;
            }

            person.PasswordHash = Hasher.HashPassword(person, newPassword);
            person.PasswordChangedAt = now;
            await StaffSignInLockout.RecordSuccessAsync(_dbContext, person, cancellationToken);

            // The credential-change rule (§3.3): every outstanding token of BOTH purposes and every unconsumed org choice
            // verified against the old password are void from this commit on.
            var voidedTokens = await CredentialTokenService.StageCredentialChangeInvalidationAsync(
                _dbContext, CredentialSubject.ForPerson(person.Id), token.OrganizationId, now, cancellationToken);
            var voidedChoices = await OrgStaffLoginService.StageCredentialChangeInvalidationAsync(
                _dbContext, person.Id, cancellationToken);

            revokedSessionIds = await StageRevokeEverySessionAsync(person.Id, now, cancellationToken);

            _dbContext.OrgAuditEvents.Add(new OrgAuditEvent
            {
                Id = Guid.NewGuid(),
                OrganizationId = token.OrganizationId,
                Kind = CredentialChangedKind,
                Outcome = SuccessOutcome,
                ActorPersonId = person.Id,
                SubjectPersonId = person.Id,
                ExerciseId = null,
                Payload = string.Create(
                    CultureInfo.InvariantCulture,
                    $"{{\"via\":\"{token.Purpose}\",\"sessionsRevoked\":{revokedSessionIds.Count}," +
                    $"\"tokensVoided\":{voidedTokens},\"choicesVoided\":{voidedChoices}}}"),
                OccurredAt = now,
            });

            if (token.Purpose == CredentialTokenPurposes.Invite)
            {
                // Read inside the transaction, so the landing and its audit record agree with the committed state.
                hasGrant = await HasStaffGrantAsync(person, token.OrganizationId, cancellationToken);
                _dbContext.OrgAuditEvents.Add(new OrgAuditEvent
                {
                    Id = Guid.NewGuid(),
                    OrganizationId = token.OrganizationId,
                    Kind = InviteRedeemedKind,
                    Outcome = SuccessOutcome,
                    ActorPersonId = person.Id,
                    SubjectPersonId = person.Id,
                    ExerciseId = null,
                    Payload = hasGrant ? "{\"next\":\"sign-in\"}" : "{\"next\":\"awaiting-assignment\"}",
                    OccurredAt = now,
                });
            }

            await _dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }

        return new CredentialChange(revokedSessionIds, hasGrant);
    }

    /// <summary>
    /// Whether the org sign-in can mint a staff session for <paramref name="person"/> (§3.3 "a grant"): the shared-key
    /// staff facet exists AND the person is an org admin or holds an ACTIVE staff enrollment on an exercise of their own
    /// organization — the same facet and landing-enrollment reads <c>OrgStaffLoginService</c> makes.
    /// </summary>
    private async Task<bool> HasStaffGrantAsync(Person person, Guid organizationId, CancellationToken cancellationToken)
    {
        var hasFacet = await _dbContext.StaffUsers
            .AsNoTracking()
            .InOrganization(organizationId)
            .AnyAsync(u => u.Id == person.Id, cancellationToken);
        if (!hasFacet)
        {
            return false;
        }

        if (Person.IsOrgAdmin(person.OrgRole))
        {
            return true;
        }

        return await (
            // org-scope-exempt(TenantChecked): own-only (PersonId is the person whose invite was just redeemed) and every
            // row must inner-join an Exercise of the token's own organization (InOrganization), so no other customer's
            // enrollment can count as a grant. Cross-exercise by design: the redemption has no exercise scope.
            from enrollment in _dbContext.Enrollments.IgnoreQueryFilters().Active().AsNoTracking().Where(EnrollmentRoles.IsStaffEnrollment)
            where enrollment.PersonId == person.Id
            join exercise in _dbContext.Exercises.AsNoTracking().InOrganization(organizationId) on enrollment.ExerciseId equals exercise.Id
            select enrollment.Id).AnyAsync(cancellationToken);
    }

    /// <summary>
    /// Stages the revocation of EVERY live session of the person — staff and participant, any exercise or org scope
    /// (access AND refresh: <c>RevokedAt</c> stops both). Sessions minted before the person column existed carry the
    /// person only as <c>StaffUserId</c> (shared key), so both columns are matched.
    /// </summary>
    private Task<List<Guid>> StageRevokeEverySessionAsync(Guid personId, DateTimeOffset now, CancellationToken cancellationToken) =>
        PersonSessionRevoker.StageRevokeAsync(_dbContext, personId, PersonSessionScope.All, now, cancellationToken);

    private async Task CutRevokedConnectionsAfterCommitAsync(List<Guid> revoked, CancellationToken cancellationToken)
    {
        if (revoked.Count == 0)
        {
            return;
        }

        try
        {
            await _connectionRevoker.RevokeAsync(revoked, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // The sessions are already revoked in the database; a surviving connection is refused on its next call.
            LogConnectionCutFailed(revoked.Count, exception);
        }
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Error,
        Message = "{Count} revoked session(s) could not have their live connections cut; the password change has committed.")]
    private partial void LogConnectionCutFailed(int count, Exception exception);
}

/// <summary>The outcome kind of a <see cref="PasswordResetService"/> call.</summary>
public enum PasswordResetOutcome
{
    /// <summary>The password was set — 204.</summary>
    Ok,

    /// <summary>A bad token or a policy refusal — 400 with an error code.</summary>
    Invalid,
}

/// <summary>The result of a <see cref="PasswordResetService"/> call.</summary>
public sealed class PasswordResetResult
{
    private PasswordResetResult(PasswordResetOutcome outcome, string? error)
    {
        Outcome = outcome;
        Error = error;
    }

    /// <summary>Which outcome occurred.</summary>
    public PasswordResetOutcome Outcome { get; }

    /// <summary>The error code on <see cref="PasswordResetOutcome.Invalid"/>.</summary>
    public string? Error { get; }

    /// <summary>Where a redeemed INVITE goes next (200 with it); <c>null</c> for a reset (204).</summary>
    public InviteLanding? Landing { get; private init; }

    /// <summary>A success.</summary>
    /// <param name="landing">The invite landing, or <c>null</c> for a reset.</param>
    /// <returns>The result.</returns>
    public static PasswordResetResult Ok(InviteLanding? landing = null) => new(PasswordResetOutcome.Ok, null) { Landing = landing };

    /// <summary>A 400 carrying <paramref name="error"/>.</summary>
    /// <param name="error">The error code.</param>
    /// <returns>The result.</returns>
    public static PasswordResetResult Invalid(string error) => new(PasswordResetOutcome.Invalid, error);
}

/// <summary>
/// Where a redeemed staff invite goes next (#575b, ADMIN-IDENTITY-MODEL §3.3): sign in now, or the "awaiting
/// assignment" page. The wire body of the invite's <c>200</c>.
/// </summary>
public sealed class InviteLanding
{
    /// <summary>The person holds a grant: sign in through the org sign-in.</summary>
    public const string SignInNext = "sign-in";

    /// <summary>No grant yet: show "awaiting assignment"; sign-in works once they are assigned.</summary>
    public const string AwaitingAssignmentNext = "awaiting-assignment";

    /// <summary>Creates the landing.</summary>
    /// <param name="next"><see cref="SignInNext"/> or <see cref="AwaitingAssignmentNext"/>.</param>
    /// <param name="orgSlug">The person's organization slug (the org sign-in body's <c>orgSlug</c>).</param>
    /// <param name="email">The person's own email (the org sign-in body's <c>email</c>).</param>
    public InviteLanding(string next, string orgSlug, string email)
    {
        Next = next;
        OrgSlug = orgSlug;
        Email = email;
    }

    /// <summary><see cref="SignInNext"/> or <see cref="AwaitingAssignmentNext"/>.</summary>
    [JsonPropertyName("next")]
    public string Next { get; }

    /// <summary>The person's organization slug.</summary>
    [JsonPropertyName("orgSlug")]
    public string OrgSlug { get; }

    /// <summary>The person's own email.</summary>
    [JsonPropertyName("email")]
    public string Email { get; }
}

/// <summary>What one committed credential change did.</summary>
/// <param name="RevokedSessionIds">The sessions it revoked (their connections are cut after commit).</param>
/// <param name="HasGrant">For an invite: whether the person holds a grant the org sign-in can mint from.</param>
internal sealed record CredentialChange(List<Guid> RevokedSessionIds, bool HasGrant);
