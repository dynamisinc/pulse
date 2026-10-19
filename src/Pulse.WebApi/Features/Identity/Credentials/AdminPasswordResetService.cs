namespace Pulse.WebApi.Features.Identity.Credentials;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseLifecycleAdmin;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// The org admin's staff password reset (identity-auth-roles/21, ADMIN-IDENTITY-MODEL §3.3 "Admin reset"):
/// <c>POST /api/org/people/{personId}/password-reset</c>. Issues a <c>reset</c> token for a person of the caller's OWN
/// organization and returns the reset link ONCE (the copy-link flow — email is off), also handing it to
/// <see cref="IPulseMailer"/> (a no-op by default). The admin never sees or chooses the person's password.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (always-Critical).</b> The person is read with <c>InOrganization(caller.OrganizationId)</c> — the
/// caller's SERVER-resolved tenant — so another customer's person id is the same bare 404 as an id that does not
/// exist. The organization never comes from the request.
/// </para>
/// <para>
/// <b>Audit.</b> An <see cref="OrgAuditEvent"/> (<see cref="ResetIssuedKind"/>, §7.5 "password reset issuance") in the
/// SAME unit of work as the token and the voiding of the person's earlier reset tokens. It never carries the token or
/// the link. The link's token rides in the URL FRAGMENT (<c>/staff/reset#token=…</c>), which browsers never send to a
/// server, so it reaches no access log; the response is <c>Cache-Control: no-store</c>.
/// </para>
/// </remarks>
public sealed partial class AdminPasswordResetService
{
    /// <summary>The org-audit kind of an issued admin reset.</summary>
    public const string ResetIssuedKind = "org.credential.reset-issued";

    /// <summary>The 409 error code for a disabled person (their reset link could never be used).</summary>
    public const string PersonDisabledError = "person-disabled";

    /// <summary>
    /// The 409 error code for a target who is ANOTHER org admin (Gate-1 W-001): handing one admin a link that sets a peer
    /// admin's password would be a lateral takeover. An admin may still reset themselves.
    /// </summary>
    public const string TargetIsOrgAdminError = "target-is-org-admin";

    /// <summary>The 503 error code when no frontend base URL is configured, so no link can be built.</summary>
    public const string LinkUnavailableError = "reset-link-unavailable";

    /// <summary>The SPA route of the staff reset page; the token follows in the fragment.</summary>
    public const string StaffResetPath = "/staff/reset";

    private readonly PulseDbContext _dbContext;
    private readonly StaffCallerContext _staffCaller;
    private readonly CredentialTokenService _tokens;
    private readonly JoinUrlBuilder _urls;
    private readonly IPulseMailer _mailer;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<AdminPasswordResetService> _logger;

    /// <summary>Creates the service.</summary>
    /// <param name="dbContext">The request-scoped persistence context (one unit of work).</param>
    /// <param name="staffCaller">The resolved staff caller (role and tenant from the caller's own session).</param>
    /// <param name="tokens">The credential-token lifecycle.</param>
    /// <param name="urls">The validated <c>Authentication:FrontendBaseUrl</c> (the same base join links use).</param>
    /// <param name="mailer">The credential mailer (a no-op unless email is configured).</param>
    /// <param name="timeProvider">The server wall clock.</param>
    /// <param name="logger">Logs a mailer failure after the commit (the purpose only — never the link or recipient).</param>
    public AdminPasswordResetService(
        PulseDbContext dbContext,
        StaffCallerContext staffCaller,
        CredentialTokenService tokens,
        JoinUrlBuilder urls,
        IPulseMailer mailer,
        TimeProvider timeProvider,
        ILogger<AdminPasswordResetService>? logger = null)
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
        _logger = logger ?? NullLogger<AdminPasswordResetService>.Instance;
    }

    /// <summary>The staff reset link for <paramref name="rawToken"/>: <c>{FrontendBaseUrl}/staff/reset#token={token}</c>.</summary>
    /// <param name="baseUrl">The validated frontend base (no trailing slash).</param>
    /// <param name="rawToken">The raw token.</param>
    /// <returns>The link.</returns>
    public static string BuildResetUrl(string baseUrl, string rawToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(baseUrl);
        ArgumentException.ThrowIfNullOrEmpty(rawToken);
        return $"{baseUrl}{StaffResetPath}#token={Uri.EscapeDataString(rawToken)}";
    }

    /// <summary>Issues a reset link for <paramref name="personId"/> on behalf of the calling org admin.</summary>
    /// <param name="personId">The target person (route value).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome the endpoint maps to a status.</returns>
    public async Task<AdminPasswordResetResult> IssueAsync(Guid personId, CancellationToken cancellationToken = default)
    {
        var caller = await _staffCaller.ResolveAsync(cancellationToken);
        if (caller is null)
        {
            return AdminPasswordResetResult.Unauthenticated();
        }

        // Org admins only, on their org-scope session (the endpoint filter admits the role; the scope is checked here).
        if (!ExerciseAdminRoles.IsOrgAdmin(caller.Role) || !caller.IsOrgScope)
        {
            return AdminPasswordResetResult.Forbidden();
        }

        // Checked before anything is read, so it discloses nothing about the id.
        if (!_urls.TryGetBase(out var baseUrl))
        {
            return AdminPasswordResetResult.Unavailable();
        }

        // The bare-404 pattern: another customer's person is indistinguishable from a missing one.
        var person = await _dbContext.People
            .AsNoTracking()
            .InOrganization(caller.OrganizationId)
            .FirstOrDefaultAsync(p => p.Id == personId, cancellationToken);
        if (person is null)
        {
            return AdminPasswordResetResult.NotFound();
        }

        // Gate-1 W-001: never another org admin (a lateral takeover); the tenant bound above still answers first, so a
        // foreign admin is the bare 404. Resetting oneself stays allowed.
        if (Person.IsOrgAdmin(person.OrgRole) && person.Id != caller.StaffUserId)
        {
            return AdminPasswordResetResult.Conflict(TargetIsOrgAdminError);
        }

        if (person.DisabledAt is not null)
        {
            return AdminPasswordResetResult.Conflict(PersonDisabledError);
        }

        var now = _timeProvider.GetUtcNow();

        // One transaction: the voiding of earlier reset links (executed immediately, Gate-1 S-002), the new token and its
        // audit record commit or roll back together.
        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        var issued = await _tokens.StageIssueAsync(
            CredentialTokenPurposes.Reset,
            CredentialSubject.ForPerson(person.Id),
            person.OrganizationId,
            issuedByPersonId: caller.StaffUserId,
            now,
            cancellationToken);

        _dbContext.OrgAuditEvents.Add(new OrgAuditEvent
        {
            Id = Guid.NewGuid(),
            OrganizationId = person.OrganizationId,
            Kind = ResetIssuedKind,
            Outcome = PasswordResetService.SuccessOutcome,
            ActorPersonId = caller.StaffUserId,
            SubjectPersonId = person.Id,
            ExerciseId = null,
            Payload = "{\"purpose\":\"reset\"}",
            OccurredAt = now,
        });

        await _dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        var resetUrl = BuildResetUrl(baseUrl, issued.RawToken);
        if (!string.IsNullOrWhiteSpace(person.Email))
        {
            // A no-op on a host without email. Gate-1 S-007: the token is already committed, so a misbehaving mailer must
            // never turn this into a 500 that hides the only copy of the link — log the purpose only and answer anyway.
            try
            {
                await _mailer.SendCredentialLinkAsync(
                    new CredentialMail { Purpose = CredentialTokenPurposes.Reset, RecipientAddress = person.Email, Link = resetUrl },
                    cancellationToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                LogMailerFailed(CredentialTokenPurposes.Reset, exception.GetType().Name);
            }
        }

        return AdminPasswordResetResult.Ok(resetUrl);
    }

    // The exception TYPE only: a provider message could echo the recipient or the link.
    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Credential email failed after the reset link was issued (purpose {Purpose}, {ExceptionType}); the link was returned to the admin.")]
    private partial void LogMailerFailed(string purpose, string exceptionType);
}

/// <summary>The outcome kind of an <see cref="AdminPasswordResetService"/> call.</summary>
public enum AdminPasswordResetOutcome
{
    /// <summary>A reset link was issued — 200 with it, once.</summary>
    Ok,

    /// <summary>No live staff session or no resolved tenant — 401.</summary>
    Unauthenticated,

    /// <summary>Not an org admin on an org-scope session — 403.</summary>
    Forbidden,

    /// <summary>Missing or foreign-org person — the bare 404.</summary>
    NotFound,

    /// <summary>The person is disabled — 409.</summary>
    Conflict,

    /// <summary>No frontend base URL is configured, so no link can be built — 503.</summary>
    Unavailable,
}

/// <summary>The result of an <see cref="AdminPasswordResetService"/> call.</summary>
public sealed class AdminPasswordResetResult
{
    private AdminPasswordResetResult(AdminPasswordResetOutcome outcome, string? resetUrl, string? error)
    {
        Outcome = outcome;
        ResetUrl = resetUrl;
        Error = error;
    }

    /// <summary>Which outcome occurred.</summary>
    public AdminPasswordResetOutcome Outcome { get; }

    /// <summary>The single-use reset link on <see cref="AdminPasswordResetOutcome.Ok"/>. Never log it.</summary>
    public string? ResetUrl { get; }

    /// <summary>The error code (409 / 503).</summary>
    public string? Error { get; }

    /// <summary>A success.</summary>
    /// <param name="resetUrl">The link.</param>
    /// <returns>The result.</returns>
    public static AdminPasswordResetResult Ok(string resetUrl) => new(AdminPasswordResetOutcome.Ok, resetUrl, null);

    /// <summary>A 401.</summary>
    /// <returns>The result.</returns>
    public static AdminPasswordResetResult Unauthenticated() => new(AdminPasswordResetOutcome.Unauthenticated, null, null);

    /// <summary>A 403.</summary>
    /// <returns>The result.</returns>
    public static AdminPasswordResetResult Forbidden() => new(AdminPasswordResetOutcome.Forbidden, null, null);

    /// <summary>The bare 404.</summary>
    /// <returns>The result.</returns>
    public static AdminPasswordResetResult NotFound() => new(AdminPasswordResetOutcome.NotFound, null, null);

    /// <summary>A 409 carrying <paramref name="error"/>.</summary>
    /// <param name="error">The error code.</param>
    /// <returns>The result.</returns>
    public static AdminPasswordResetResult Conflict(string error) => new(AdminPasswordResetOutcome.Conflict, null, error);

    /// <summary>A 503.</summary>
    /// <returns>The result.</returns>
    public static AdminPasswordResetResult Unavailable() =>
        new(AdminPasswordResetOutcome.Unavailable, null, AdminPasswordResetService.LinkUnavailableError);

    /// <inheritdoc />
    public override string ToString() => $"AdminPasswordResetResult {{ Outcome = {Outcome} }}";
}
