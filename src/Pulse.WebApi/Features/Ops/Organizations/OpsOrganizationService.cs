namespace Pulse.WebApi.Features.Ops.Organizations;

using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Credentials;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.LinkEmail;
using Pulse.WebApi.Features.Ops.Bootstrap;
using Pulse.WebApi.Features.Org.PeopleDirectory;

/// <summary>
/// Platform provisioning of a customer organization (identity-auth-roles/20 "Org admin platform provisioning", #575b;
/// ADMIN-IDENTITY-MODEL §7.6): <c>POST /api/ops/organizations {name, adminEmail, adminDisplayName?}</c>, gated by the
/// bootstrap secret. In ONE transaction it creates the <see cref="Organization"/> with a collision-safe slug
/// (<see cref="OrganizationSlugAllocator"/>, #602 L-5), its first org-admin <see cref="Person"/> (<c>OrgRole =
/// orgAdmin</c>, no password) WITH the shared-key <see cref="StaffUser"/> facet (the org sign-in mints only for a person
/// with a facet), and a 7-day single-use <c>invite</c> token. The invite link is returned ONCE to the ops caller (the
/// copy-link flow — email is off until ACS is deployed) and handed to <see cref="IPulseMailer"/> for the admin's address.
/// Once the admin sets a password they sign in to the empty organization (an org-scope session needs no exercise).
/// </summary>
/// <remarks>
/// <para>
/// <b>Secret-gated, fail closed.</b> The <c>X-Bootstrap-Secret</c> is checked by <see cref="BootstrapSecretGate"/> before
/// the body is even validated, so a wrong or unconfigured secret is a bare 404 that discloses nothing. Unlike
/// <c>bootstrap-exercise</c> this is the production path for onboarding a customer (§7.6: "the only thing Dynamis does").
/// </para>
/// <para>
/// <b>The null issuer.</b> No person issues this invite (ops is not a Person), so the token carries
/// <c>IssuedByPersonId = null</c>, which <see cref="CredentialTokenService.StageIssueAsync"/> allows only for a link
/// delivered to the subject's OWN email: it is staged with <c>deliverToEmail</c> = the admin's address, after the person
/// is saved, so the null-issuer rule is checked against the stored row. The redemption trusts a null issuer for an org
/// admin target for exactly that reason (<see cref="PasswordResetService"/> W5).
/// </para>
/// <para>
/// <b>Audit.</b> Two <see cref="OrgAuditEvent"/>s in the new organization, in the same unit of work:
/// <see cref="OrganizationCreatedKind"/> and <see cref="OrgInviteService.InviteIssuedKind"/> (no actor: ops). Neither
/// carries the token or the link.
/// </para>
/// </remarks>
public sealed partial class OpsOrganizationService
{
    /// <summary>The org-audit kind of a provisioned organization.</summary>
    public const string OrganizationCreatedKind = "org.organization.created";

    /// <summary>The 400 error code for a missing or over-long organization name.</summary>
    public const string InvalidNameError = "invalid-name";

    /// <summary>The 400 error code for a missing or malformed admin email.</summary>
    public const string InvalidAdminEmailError = "invalid-admin-email";

    /// <summary>The 400 error code for an over-long admin display name.</summary>
    public const string InvalidAdminDisplayNameError = "invalid-admin-display-name";

    /// <summary>The 409 error code when an organization with that name already exists (or a concurrent create won).</summary>
    public const string OrganizationExistsError = "organization-exists";

    /// <summary>The most characters an organization name may have (the <c>Organizations.Name</c> column bound).</summary>
    public const int MaxNameLength = 200;

    private const int UniqueIndexViolation = 2601;
    private const int UniqueConstraintViolation = 2627;

    private readonly PulseDbContext _dbContext;
    private readonly CredentialTokenService _tokens;
    private readonly JoinUrlBuilder _urls;
    private readonly IPulseMailer _mailer;
    private readonly TimeProvider _timeProvider;
    private readonly BootstrapOptions _options;
    private readonly ILogger<OpsOrganizationService> _logger;

    /// <summary>Creates the service.</summary>
    /// <param name="dbContext">The request-scoped persistence context (one unit of work).</param>
    /// <param name="tokens">The credential-token lifecycle.</param>
    /// <param name="urls">The validated <c>Authentication:FrontendBaseUrl</c>.</param>
    /// <param name="mailer">The credential mailer (a no-op unless email is configured).</param>
    /// <param name="timeProvider">The server wall clock.</param>
    /// <param name="options">The bootstrap secret (the same <c>Authentication:Bootstrap:Secret</c> the other ops routes use).</param>
    /// <param name="logger">Logs a mailer failure after the commit (the purpose only — never the link or recipient).</param>
    public OpsOrganizationService(
        PulseDbContext dbContext,
        CredentialTokenService tokens,
        JoinUrlBuilder urls,
        IPulseMailer mailer,
        TimeProvider timeProvider,
        IOptions<BootstrapOptions> options,
        ILogger<OpsOrganizationService>? logger = null)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(tokens);
        ArgumentNullException.ThrowIfNull(urls);
        ArgumentNullException.ThrowIfNull(mailer);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(options);

        _dbContext = dbContext;
        _tokens = tokens;
        _urls = urls;
        _mailer = mailer;
        _timeProvider = timeProvider;
        _options = options.Value ?? new BootstrapOptions();
        _logger = logger ?? NullLogger<OpsOrganizationService>.Instance;
    }

    /// <summary>Provisions the organization, its first org admin and their invite.</summary>
    /// <param name="request">The request body (may be <c>null</c>).</param>
    /// <param name="presentedSecret">The <c>X-Bootstrap-Secret</c> header (never logged).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome the endpoint maps to a status.</returns>
    public async Task<OpsOrganizationResult> CreateAsync(
        CreateOrganizationRequest? request,
        string? presentedSecret,
        CancellationToken cancellationToken = default)
    {
        if (!BootstrapSecretGate.IsAuthorized(_options.Secret, presentedSecret))
        {
            return OpsOrganizationResult.Rejected();
        }

        var name = request?.Name?.Trim();
        if (string.IsNullOrEmpty(name) || name.Length > MaxNameLength)
        {
            return OpsOrganizationResult.Invalid(InvalidNameError);
        }

        var email = OrgInviteService.NormalizeEmail(request?.AdminEmail);
        if (email is null)
        {
            return OpsOrganizationResult.Invalid(InvalidAdminEmailError);
        }

        var displayName = request?.AdminDisplayName?.Trim();
        if (string.IsNullOrEmpty(displayName))
        {
            // The address's local part until the admin's name is edited (never empty: NormalizeEmail requires text before '@').
            displayName = email[..email.IndexOf('@', StringComparison.Ordinal)];
        }
        else if (displayName.Length > Person.MaxDisplayNameLength)
        {
            return OpsOrganizationResult.Invalid(InvalidAdminDisplayNameError);
        }

        if (!_urls.TryGetBase(out var baseUrl))
        {
            return OpsOrganizationResult.Unavailable();
        }

        var now = _timeProvider.GetUtcNow();
        var organizationId = Guid.NewGuid();
        var adminId = Guid.NewGuid();
        string slug;
        IssuedCredentialToken issued;
        try
        {
            await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

            slug = await OrganizationSlugAllocator.UniqueAsync(_dbContext, name, cancellationToken);
            _dbContext.Organizations.Add(new Organization { Id = organizationId, Name = name, Slug = slug, CreatedAt = now });

            var admin = new Person
            {
                Id = adminId,
                OrganizationId = organizationId,
                Email = email,
                DisplayName = displayName,
                OrgRole = Person.OrgAdminRole,
                CreatedAt = now,
            };
            _dbContext.People.Add(admin);

            // The org sign-in mints only for a person with a staff facet (shared key), so it is created here, exactly as an
            // org-admin grant creates it (OrgPeopleService.EnsureStaffFacetAsync). Its subject is Pulse-local: the Dynamis
            // allowlist can never authenticate as this person.
            _dbContext.StaffUsers.Add(new StaffUser
            {
                Id = adminId,
                OrganizationId = organizationId,
                ExternalSubject = $"pulse|{adminId:N}",
                DisplayName = displayName,
                CreatedAt = now,
            });

            _dbContext.OrgAuditEvents.Add(Audit(organizationId, OrganizationCreatedKind, adminId, now, "{\"via\":\"ops\"}"));

            // Saved first (inside the transaction) so the null-issuer rule checks the delivery target against the STORED
            // admin row.
            await _dbContext.SaveChangesAsync(cancellationToken);

            issued = await _tokens.StageIssueAsync(
                CredentialTokenPurposes.Invite,
                CredentialSubject.ForPerson(adminId),
                organizationId,
                issuedByPersonId: null,
                now,
                deliverToEmail: email,
                cancellationToken: cancellationToken);

            _dbContext.OrgAuditEvents.Add(Audit(
                organizationId, OrgInviteService.InviteIssuedKind, adminId, now, "{\"actorRole\":\"ops\",\"created\":true}"));

            await _dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            // The unique organization name (or a concurrent create that took the same free slug between the probe and the
            // insert). Nothing was written: the transaction rolled back.
            _dbContext.ChangeTracker.Clear();
            return OpsOrganizationResult.Conflict(OrganizationExistsError);
        }

        var inviteUrl = OrgInviteService.BuildInviteUrl(baseUrl, issued.RawToken);
        var emailed = await TrySendAsync(email, inviteUrl, cancellationToken);

        return OpsOrganizationResult.Created(new CreatedOrganizationDto
        {
            OrganizationId = organizationId.ToString(),
            Name = name,
            Slug = slug,
            AdminPersonId = adminId.ToString(),
            InviteUrl = inviteUrl,
            Emailed = emailed,
        });
    }

    private static OrgAuditEvent Audit(Guid organizationId, string kind, Guid subject, DateTimeOffset now, string payload) => new()
    {
        Id = Guid.NewGuid(),
        OrganizationId = organizationId,
        Kind = kind,
        Outcome = PasswordResetService.SuccessOutcome,
        ActorPersonId = null,
        SubjectPersonId = subject,
        ExerciseId = null,
        Payload = payload,
        OccurredAt = now,
    };

    private static bool IsUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is SqlException { Number: UniqueIndexViolation or UniqueConstraintViolation };

    private async Task<bool> TrySendAsync(string email, string inviteUrl, CancellationToken cancellationToken)
    {
        if (!_mailer.IsConfigured)
        {
            return false;
        }

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
        Message = "Credential email failed after the first-admin invite was issued (purpose {Purpose}, {ExceptionType}); the link was returned to the ops caller.")]
    private partial void LogMailerFailed(string purpose, string exceptionType);
}
