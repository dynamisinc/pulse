namespace Pulse.WebApi.Features.Org.PeopleDirectory;

using System.Globalization;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseLifecycleAdmin;
using Pulse.WebApi.Features.Identity.Credentials;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.LinkEmail;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// The org admin's staff invite (identity-auth-roles/20 "Invite", #575b; ADMIN-IDENTITY-MODEL §1.1, §3.3, §7.5):
/// <c>POST /api/org/people/invite {email, displayName}</c>. Creates the directory <see cref="Person"/> (no password, no
/// grant) in the caller's OWN organization — or reuses the one that already holds that email — and issues a 7-day
/// single-use <c>invite</c> <see cref="CredentialToken"/> through <see cref="CredentialTokenService"/>. The link is
/// returned ONCE (the copy-link flow: email is off until ACS is deployed) and also handed to <see cref="IPulseMailer"/>.
/// The invitee sets their password on <c>/staff/invite</c> (the <c>POST /api/auth/password/reset</c> redemption).
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (always-Critical).</b> The tenant is the caller's server-resolved organization; no organization id is
/// accepted from the request. The email lookup is <c>InOrganization(tenant)</c>, so the same address in another
/// customer is a different person and is never touched or disclosed.
/// </para>
/// <para>
/// <b>Reuse rules</b> (an existing person with that email): <list type="bullet">
///   <item><description>already has a Pulse password → 409 <see cref="AlreadyActiveError"/> (use the admin reset);</description></item>
///   <item><description>disabled → 409 <see cref="PersonDisabledError"/> (a link they could never redeem);</description></item>
///   <item><description>ANOTHER org admin → 409 <see cref="TargetIsOrgAdminError"/> — a peer admin's credential must never
///   be set from a link a different admin holds (the same rule as the admin reset, and the redemption refuses it
///   too);</description></item>
///   <item><description>otherwise the invite is re-issued: the earlier invite of that person is voided
///   (<see cref="CredentialTokenService.StageIssueAsync"/> voids the same purpose) and the display name is left as it
///   is.</description></item>
/// </list>
/// </para>
/// <para>
/// <b>No grant here.</b> An invite creates no <c>OrgRole</c>, no enrollment and no staff facet: the person lands on
/// "awaiting assignment" until an admin grants them org admin or a planner assigns them (both create the facet).
/// </para>
/// <para>
/// <b>Audit, not XC-004</b> (there is no exercise): one <see cref="OrgAuditEvent"/> <see cref="InviteIssuedKind"/> in
/// the same unit of work as the person, the token and the voiding; its payload says whether the person was created. It
/// never carries the token or the link.
/// </para>
/// </remarks>
public sealed partial class OrgInviteService
{
    /// <summary>The org-audit kind of an issued staff invite.</summary>
    public const string InviteIssuedKind = "org.invite.issued";

    /// <summary>The 400 error code for a missing or malformed email.</summary>
    public const string InvalidEmailError = "invalid-email";

    /// <summary>The 400 error code for a missing or over-long display name.</summary>
    public const string InvalidDisplayNameError = "invalid-display-name";

    /// <summary>The 409 error code for a person who already has a Pulse password (use the admin reset).</summary>
    public const string AlreadyActiveError = "already-active";

    /// <summary>The 409 error code for a disabled person.</summary>
    public const string PersonDisabledError = AdminPasswordResetService.PersonDisabledError;

    /// <summary>The 409 error code for a PEER org admin.</summary>
    public const string TargetIsOrgAdminError = AdminPasswordResetService.TargetIsOrgAdminError;

    /// <summary>The 409 error code when a concurrent invite created the same person first (retry).</summary>
    public const string InviteConflictError = "invite-conflict";

    /// <summary>
    /// The 409 error code when the by-id invite's email is already held by ANOTHER person of the organization (the
    /// <c>(OrganizationId, Email)</c> unique index, #849).
    /// </summary>
    public const string EmailInUseError = "email-in-use";

    /// <summary>The 409 error code when the by-id invite's person already has a DIFFERENT email on file (#849).</summary>
    public const string EmailMismatchError = "email-mismatch";

    /// <summary>The 503 error code when no frontend base URL is configured, so no link can be built.</summary>
    public const string LinkUnavailableError = "invite-link-unavailable";

    /// <summary>The SPA route of the staff invite page; the token follows in the fragment.</summary>
    public const string StaffInvitePath = "/staff/invite";

    private const int UniqueIndexViolation = 2601;
    private const int UniqueConstraintViolation = 2627;

    private readonly PulseDbContext _dbContext;
    private readonly StaffCallerContext _staffCaller;
    private readonly CredentialTokenService _tokens;
    private readonly JoinUrlBuilder _urls;
    private readonly IPulseMailer _mailer;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<OrgInviteService> _logger;

    /// <summary>Creates the service.</summary>
    /// <param name="dbContext">The request-scoped persistence context (one unit of work).</param>
    /// <param name="staffCaller">The resolved staff caller (role and tenant from the caller's own session).</param>
    /// <param name="tokens">The credential-token lifecycle.</param>
    /// <param name="urls">The validated <c>Authentication:FrontendBaseUrl</c>.</param>
    /// <param name="mailer">The credential mailer (a no-op unless email is configured).</param>
    /// <param name="timeProvider">The server wall clock.</param>
    /// <param name="logger">Logs a mailer failure after the commit (the purpose only — never the link or recipient).</param>
    public OrgInviteService(
        PulseDbContext dbContext,
        StaffCallerContext staffCaller,
        CredentialTokenService tokens,
        JoinUrlBuilder urls,
        IPulseMailer mailer,
        TimeProvider timeProvider,
        ILogger<OrgInviteService>? logger = null)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(staffCaller);
        ArgumentNullException.ThrowIfNull(tokens);
        ArgumentNullException.ThrowIfNull(urls);
        ArgumentNullException.ThrowIfNull(mailer);
        ArgumentNullException.ThrowIfNull(timeProvider);

        _dbContext = dbContext;
        _staffCaller = staffCaller;
        _tokens = tokens;
        _urls = urls;
        _mailer = mailer;
        _timeProvider = timeProvider;
        _logger = logger ?? NullLogger<OrgInviteService>.Instance;
    }

    /// <summary>The staff invite link for <paramref name="rawToken"/>: <c>{FrontendBaseUrl}/staff/invite#token={token}</c>.</summary>
    /// <param name="baseUrl">The validated frontend base (no trailing slash).</param>
    /// <param name="rawToken">The raw token.</param>
    /// <returns>The link.</returns>
    public static string BuildInviteUrl(string baseUrl, string rawToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(baseUrl);
        ArgumentException.ThrowIfNullOrEmpty(rawToken);
        return $"{baseUrl}{StaffInvitePath}#token={Uri.EscapeDataString(rawToken)}";
    }

    /// <summary>The normalized form of an invite email (trimmed, lower-case, bounded), or <c>null</c> when malformed.</summary>
    /// <param name="raw">The email as typed.</param>
    /// <returns>The normalized email, or <c>null</c>.</returns>
    public static string? NormalizeEmail(string? raw)
    {
        // The SAME normalization sign-in looks people up by (PulsePasswordIdentityProvider), so the invited address is
        // exactly the one the person later signs in with. Plus a minimal shape check: one '@' with text either side and
        // no whitespace.
        var email = PulsePasswordIdentityProvider.NormalizeEmail(raw);
        if (email is null)
        {
            return null;
        }

        var at = email.IndexOf('@', StringComparison.Ordinal);
        return at > 0
            && at == email.LastIndexOf('@')
            && at < email.Length - 1
            && !email.Any(char.IsWhiteSpace)
            ? email
            : null;
    }

    /// <summary>Invites <paramref name="request"/>'s person on behalf of the calling org admin.</summary>
    /// <param name="request">The request body (may be <c>null</c>).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome the endpoint maps to a status.</returns>
    public async Task<OrgInviteResult> InviteAsync(InviteOrgPersonRequest? request, CancellationToken cancellationToken = default)
    {
        var caller = await _staffCaller.ResolveAsync(cancellationToken);
        if (caller is null)
        {
            return OrgInviteResult.Unauthenticated();
        }

        // Org admins only, on their org-scope session (the endpoint filter admits the role; the scope is checked here).
        if (!ExerciseAdminRoles.IsOrgAdmin(caller.Role) || !caller.IsOrgScope)
        {
            return OrgInviteResult.Forbidden();
        }

        var email = NormalizeEmail(request?.Email);
        if (email is null)
        {
            return OrgInviteResult.Invalid(InvalidEmailError);
        }

        var displayName = request?.DisplayName?.Trim();
        if (string.IsNullOrEmpty(displayName) || displayName.Length > Person.MaxDisplayNameLength)
        {
            return OrgInviteResult.Invalid(InvalidDisplayNameError);
        }

        if (!_urls.TryGetBase(out var baseUrl))
        {
            return OrgInviteResult.Unavailable();
        }

        var tenant = caller.OrganizationId;
        var now = _timeProvider.GetUtcNow();

        Guid personId;
        bool created;
        IssuedCredentialToken issued;
        try
        {
            await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

            // Serialize concurrent invites of the same existing person (cold review #8): take the row lock first with a no-op
            // UPDATE, so a second invite waits here and its void statement then sees (and voids) the first one's committed
            // token — never two live invites. Zero rows (a new address) locks nothing; the unique index arbitrates that race.
            await _dbContext.People
                .InOrganization(tenant)
                .Where(p => p.Email == email)
                .ExecuteUpdateAsync(setters => setters.SetProperty(p => p.Email, p => p.Email), cancellationToken);

            // Bounded by the caller's own tenant: the same address in another customer is a different person. Read AFTER the
            // lock, so the password / disabled / admin state checked below is the committed one.
            var person = await _dbContext.People
                .InOrganization(tenant)
                .FirstOrDefaultAsync(p => p.Email == email, cancellationToken);

            if (person is not null)
            {
                var refusal = RefuseReuse(person, caller.StaffUserId);
                if (refusal is not null)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return OrgInviteResult.Conflict(refusal);
                }

                created = false;
            }
            else
            {
                person = new Person
                {
                    Id = Guid.NewGuid(),
                    OrganizationId = tenant,
                    Email = email,
                    DisplayName = displayName,
                    CreatedAt = now,
                };
                _dbContext.People.Add(person);
                created = true;
            }

            personId = person.Id;

            // Issued BY the calling admin (never the null issuer: this link is handed to the admin, a third party).
            issued = await _tokens.StageIssueAsync(
                CredentialTokenPurposes.Invite,
                CredentialSubject.ForPerson(person.Id),
                tenant,
                issuedByPersonId: caller.StaffUserId,
                now,
                cancellationToken: cancellationToken);

            _dbContext.OrgAuditEvents.Add(new OrgAuditEvent
            {
                Id = Guid.NewGuid(),
                OrganizationId = tenant,
                Kind = InviteIssuedKind,
                Outcome = PasswordResetService.SuccessOutcome,
                ActorPersonId = caller.StaffUserId,
                SubjectPersonId = person.Id,
                ExerciseId = null,
                Payload = string.Create(
                    CultureInfo.InvariantCulture,
                    $"{{\"actorRole\":\"{Person.OrgAdminRole}\",\"created\":{(created ? "true" : "false")}}}"),
                OccurredAt = now,
            });

            await _dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            // Two admins inviting the same new address at once: the (OrganizationId, Email) unique index lets exactly one
            // create the person. The loser wrote nothing (rolled back); it can simply retry and will re-issue.
            _dbContext.ChangeTracker.Clear();
            return OrgInviteResult.Conflict(InviteConflictError);
        }

        var inviteUrl = BuildInviteUrl(baseUrl, issued.RawToken);
        var emailed = await TrySendAsync(email, inviteUrl, cancellationToken);
        return OrgInviteResult.Ok(new OrgInviteDto
        {
            PersonId = personId.ToString(),
            InviteUrl = inviteUrl,
            Emailed = emailed,
            Created = created,
        });
    }

    /// <summary>
    /// Invites an EXISTING person of the caller's organization by id (#849): <c>POST /api/org/people/{personId}/invite
    /// {email}</c>. For a person with no email on file (a legacy allowlist staffer backfilled from <c>StaffUser</c>) the
    /// email is set in the SAME transaction as the invite, so the invite targets that person instead of creating a
    /// duplicate. The person keeps their enrollments; they move off the allowlist when they redeem the invite.
    /// </summary>
    /// <remarks>
    /// Isolation: the person is read <c>InOrganization(tenant)</c> by id, so another customer's person is the same bare
    /// 404 as an id that never existed. The reuse rules (disabled, peer admin, already active) are the email invite's.
    /// A person whose stored email DIFFERS from the requested one is refused (<see cref="EmailMismatchError"/>): this
    /// action never changes an address already on file. An email held by another person of the organization is refused
    /// by the <c>(OrganizationId, Email)</c> unique index (<see cref="EmailInUseError"/>), and nothing is written.
    /// </remarks>
    /// <param name="personId">The route's person id.</param>
    /// <param name="request">The request body (may be <c>null</c>).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome the endpoint maps to a status.</returns>
    public async Task<OrgInviteResult> InvitePersonAsync(
        Guid personId,
        InviteExistingOrgPersonRequest? request,
        CancellationToken cancellationToken = default)
    {
        var caller = await _staffCaller.ResolveAsync(cancellationToken);
        if (caller is null)
        {
            return OrgInviteResult.Unauthenticated();
        }

        if (!ExerciseAdminRoles.IsOrgAdmin(caller.Role) || !caller.IsOrgScope)
        {
            return OrgInviteResult.Forbidden();
        }

        var email = NormalizeEmail(request?.Email);
        if (email is null)
        {
            return OrgInviteResult.Invalid(InvalidEmailError);
        }

        if (!_urls.TryGetBase(out var baseUrl))
        {
            return OrgInviteResult.Unavailable();
        }

        var tenant = caller.OrganizationId;
        var now = _timeProvider.GetUtcNow();

        bool emailSet;
        IssuedCredentialToken issued;
        try
        {
            await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

            // #862 S-002 (the #840 rule): the caller was authorized before this transaction opened. Re-check, as a locking
            // no-op update of their own row, that they are STILL an enabled org admin; a demotion or disable that
            // committed meanwhile matches nothing and is a 403, and one still in flight waits behind this transaction.
            // Lock order as OrgPeopleService (PersonSessionLock remarks): the caller first, then the target.
            var callerStillAdmin = await _dbContext.People
                .InOrganization(tenant)
                .Where(p => p.Id == caller.StaffUserId && p.OrgRole == Person.OrgAdminRole && p.DisabledAt == null)
                .ExecuteUpdateAsync(setters => setters.SetProperty(p => p.OrgRole, p => p.OrgRole), cancellationToken);
            if (callerStillAdmin != 1)
            {
                await transaction.RollbackAsync(cancellationToken);
                return OrgInviteResult.Forbidden();
            }

            // Serialize concurrent invites of this person with the one person-row lock idiom (#862 S-001): a second invite
            // waits here and its void statement then sees the first one's committed token. Zero rows for a foreign or
            // missing id: nothing is locked, and the read below answers the bare 404.
            await PersonSessionLock.LockAsync(_dbContext, personId, tenant, cancellationToken);

            // The bare-404 pattern: another customer's person is indistinguishable from a missing one.
            var person = await _dbContext.People
                .InOrganization(tenant)
                .FirstOrDefaultAsync(p => p.Id == personId, cancellationToken);
            if (person is null)
            {
                await transaction.RollbackAsync(cancellationToken);
                return OrgInviteResult.NotFound();
            }

            var refusal = RefuseReuse(person, caller.StaffUserId)
                ?? (person.Email is { Length: > 0 } stored && !string.Equals(stored, email, StringComparison.OrdinalIgnoreCase)
                    ? EmailMismatchError
                    : null);
            if (refusal is not null)
            {
                await transaction.RollbackAsync(cancellationToken);
                return OrgInviteResult.Conflict(refusal);
            }

            emailSet = string.IsNullOrEmpty(person.Email);
            if (emailSet)
            {
                person.Email = email;
            }

            // Issued BY the calling admin, exactly as the email invite.
            issued = await _tokens.StageIssueAsync(
                CredentialTokenPurposes.Invite,
                CredentialSubject.ForPerson(person.Id),
                tenant,
                issuedByPersonId: caller.StaffUserId,
                now,
                cancellationToken: cancellationToken);

            _dbContext.OrgAuditEvents.Add(new OrgAuditEvent
            {
                Id = Guid.NewGuid(),
                OrganizationId = tenant,
                Kind = InviteIssuedKind,
                Outcome = PasswordResetService.SuccessOutcome,
                ActorPersonId = caller.StaffUserId,
                SubjectPersonId = person.Id,
                ExerciseId = null,
                Payload = string.Create(
                    CultureInfo.InvariantCulture,
                    $"{{\"actorRole\":\"{Person.OrgAdminRole}\",\"created\":false,\"emailSet\":{(emailSet ? "true" : "false")}}}"),
                OccurredAt = now,
            });

            await _dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            // The address belongs to another person of this organization (the (OrganizationId, Email) unique index). The
            // transaction rolled back: no email was set, no token issued and nothing was audited.
            _dbContext.ChangeTracker.Clear();
            return OrgInviteResult.Conflict(EmailInUseError);
        }

        var inviteUrl = BuildInviteUrl(baseUrl, issued.RawToken);

        // #862 (Tom, 2026-11-20), the CR-001 rule of the ops route: while this host has NO mailer the link is returned to
        // the inviting admin for copy-link delivery. That admin could redeem it themselves and take the person's account;
        // that risk is ACCEPTED and documented (planner guide, OPERATE.md). Once a mailer IS configured, the link goes to
        // the address by email only and inviteUrl is null, even when the send fails (the admin re-invites).
        var mailerConfigured = _mailer.IsConfigured;
        var emailed = mailerConfigured && await TrySendAsync(email, inviteUrl, cancellationToken);
        return OrgInviteResult.Ok(new OrgInviteDto
        {
            PersonId = personId.ToString(),
            InviteUrl = mailerConfigured ? null : inviteUrl,
            Emailed = emailed,
            Created = false,
        });
    }

    private static string? RefuseReuse(Person person, Guid callerId)
    {
        if (person.DisabledAt is not null)
        {
            return PersonDisabledError;
        }

        // Checked before "already active": a peer admin is refused whatever their password state, and an admin re-inviting
        // themselves always has a password (they are signed in), so self falls through to AlreadyActive.
        if (Person.IsOrgAdmin(person.OrgRole) && person.Id != callerId)
        {
            return TargetIsOrgAdminError;
        }

        return string.IsNullOrEmpty(person.PasswordHash) ? null : AlreadyActiveError;
    }

    private static bool IsUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is SqlException { Number: UniqueIndexViolation or UniqueConstraintViolation };

    private async Task<bool> TrySendAsync(string email, string inviteUrl, CancellationToken cancellationToken)
    {
        if (!_mailer.IsConfigured)
        {
            return false;
        }

        // The token is already committed, so a misbehaving mailer must never turn this into a 500 that hides the only copy
        // of the link (the AdminPasswordResetService rule, Gate-1 S-007): log the purpose only and answer anyway.
        try
        {
            var outcome = await _mailer.SendCredentialLinkAsync(
                new CredentialMail { Purpose = CredentialTokenPurposes.Invite, RecipientAddress = email, Link = inviteUrl },
                cancellationToken);
            return outcome == LinkMailSendOutcome.Sent;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            LogMailerFailed(CredentialTokenPurposes.Invite, exception.GetType().Name);
            return false;
        }
    }

    // The exception TYPE only: a provider message could echo the recipient or the link.
    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Credential email failed after the invite link was issued (purpose {Purpose}, {ExceptionType}); the link was returned to the admin.")]
    private partial void LogMailerFailed(string purpose, string exceptionType);
}
