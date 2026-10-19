namespace Pulse.WebApi.Features.Identity.Staff;

using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// The ORG staff sign-in (identity-auth-roles/15, COR-077, ADMIN-IDENTITY-MODEL §1.2): <c>POST /api/auth/staff/login
/// {orgSlug?, email, password}</c> and <c>POST /api/auth/staff/login/choose {choiceToken, orgSlug}</c>. Staff sign in
/// to an ORGANIZATION, not an exercise; the session is minted org-scope (<see cref="Session.ExerciseId"/> null) for an
/// org admin, otherwise on the person's most recently used staff enrollment in that organization. The exercise-bound
/// request shape (<c>{username, secret, exerciseId}</c>) stays on <see cref="StaffLoginService"/>, unchanged.
/// </summary>
/// <remarks>
/// <para>
/// <b>Credentials.</b> Verification goes through the chained <see cref="IIdentityProvider"/> (§1.3): the Pulse password
/// when the person has one, else the Dynamis allowlist keyed on <see cref="StaffUser.ExternalSubject"/>. A verified
/// identity counts for a candidate only when its staff facet IS that candidate person, in that candidate's
/// organization. A subject with no staff facet is never provisioned here (there is no organization to put it in).
/// </para>
/// <para>
/// <b>Lockout attribution (slugless).</b> Up to <see cref="MaxCandidates"/> people share the email across
/// organizations. Locked-out (or disabled) candidates are skipped without verification. The failure counter goes up
/// only when the attempt fails AS A WHOLE (no candidate verified) — then each tried candidate gets one failure; a
/// success in one org never counts against the same email's person in another.
/// </para>
/// <para>
/// <b>Uniform 401.</b> Every refusal (unknown slug, unknown email, wrong password, locked out, no grant, a foreign or
/// spent choice) is the same empty 401. Orgs are disclosed only after the password verified for them.
/// </para>
/// <para>
/// <b>Audit (§7.5).</b> Org-scope sign-in success and refusal and the org choice are <see cref="OrgAuditEvent"/>s in the
/// organization they concern. A sign-in landing on an exercise is the exercise's XC-004 <c>login</c>
/// <see cref="TelemetryEvent"/>, exactly like the exercise-bound path. An attempt with no resolvable organization goes
/// only to the structured application log (a hashed handle — never the password).
/// </para>
/// </remarks>
public sealed partial class OrgStaffLoginService
{
    /// <summary>The most people one slugless sign-in verifies against (bounds the PBKDF2 work per request).</summary>
    public const int MaxCandidates = 5;

    /// <summary>The audit kind of an org sign-in (outcome <see cref="SuccessOutcome"/> or <see cref="RefusedOutcome"/>).</summary>
    public const string SignInAuditKind = "org.signin";

    /// <summary>The audit kind of a consumed org choice.</summary>
    public const string ChoiceAuditKind = "org.signin.choice";

    /// <summary>The audit outcome of a successful sign-in / choice.</summary>
    public const string SuccessOutcome = "success";

    /// <summary>The audit outcome of a refused sign-in.</summary>
    public const string RefusedOutcome = "refused";

    /// <summary>The longest accepted choice token (the issued token is 64 hex characters).</summary>
    public const int MaxChoiceTokenLength = 256;

    /// <summary>How long an org choice may be redeemed.</summary>
    public static readonly TimeSpan ChoiceLifetime = TimeSpan.FromMinutes(2);

    private const string StaffSessionKind = "staff";
    private const int MaxPasswordLength = 1024;
    private const string SuccessTelemetryPayload = "{\"outcome\":\"success\"}";

    /// <summary>A throwaway hash verified when no candidate exists, so an unknown email costs the same PBKDF2 work.</summary>
    private static readonly Lazy<string> DummyHash = new(() =>
        new PasswordHasher<Person>().HashPassword(new Person { DisplayName = string.Empty }, Guid.NewGuid().ToString("N")));

    private readonly PulseDbContext _dbContext;
    private readonly IIdentityProvider _identityProvider;
    private readonly ISessionIssuer _sessionIssuer;
    private readonly ILogger<OrgStaffLoginService> _logger;

    /// <summary>Creates the org sign-in over its collaborators.</summary>
    /// <param name="dbContext">The persistence context (people, choices, audit, telemetry).</param>
    /// <param name="identityProvider">The chained staff provider (Pulse password, then the Dynamis allowlist).</param>
    /// <param name="sessionIssuer">The session-issuance seam.</param>
    /// <param name="logger">The structured log the no-resolvable-org attempts go to (never secrets).</param>
    public OrgStaffLoginService(
        PulseDbContext dbContext,
        IIdentityProvider identityProvider,
        ISessionIssuer sessionIssuer,
        ILogger<OrgStaffLoginService> logger)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(identityProvider);
        ArgumentNullException.ThrowIfNull(sessionIssuer);
        ArgumentNullException.ThrowIfNull(logger);

        _dbContext = dbContext;
        _identityProvider = identityProvider;
        _sessionIssuer = sessionIssuer;
        _logger = logger;
    }

    /// <summary>
    /// Whether a login body is the ORG shape (no <c>exerciseId</c>, and any of <c>email</c> / <c>password</c> /
    /// <c>orgSlug</c>). Every other body keeps going to the exercise-bound <see cref="StaffLoginService"/>, unchanged.
    /// </summary>
    /// <param name="request">The login body.</param>
    /// <returns><c>true</c> for the org shape.</returns>
    public static bool IsOrgShape(StaffLoginRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        return request.ExerciseId is null
            && (request.Email is not null || request.Password is not null || request.OrgSlug is not null);
    }

    /// <summary>Signs a staff human in to an organization (by slug, or email-first with an org choice).</summary>
    /// <param name="request">The org-shape login body.</param>
    /// <param name="remoteIp">The caller's IP (hashed onto a created choice; never stored in the clear).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A session, an org choice, a validation failure (400), or the uniform refusal (401).</returns>
    public async Task<OrgStaffLoginResult> LoginAsync(
        StaffLoginRequest request,
        string? remoteIp,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var handle = request.Email?.Trim();
        if (string.IsNullOrEmpty(handle) || handle.Length > Person.MaxEmailLength)
        {
            return OrgStaffLoginResult.Invalid($"email is required (1-{Person.MaxEmailLength} characters).");
        }

        if (string.IsNullOrEmpty(request.Password) || request.Password.Length > MaxPasswordLength)
        {
            return OrgStaffLoginResult.Invalid($"password is required (1-{MaxPasswordLength} characters).");
        }

        var slug = NormalizeSlug(request.OrgSlug);
        if (slug is { Length: > Organization.MaxSlugLength })
        {
            return OrgStaffLoginResult.Invalid($"orgSlug must be at most {Organization.MaxSlugLength} characters.");
        }

        var now = DateTimeOffset.UtcNow;
        var email = PulsePasswordIdentityProvider.NormalizeEmail(handle);

        return slug is null
            ? await LoginWithoutSlugAsync(handle, email, request.Password, remoteIp, now, cancellationToken)
            : await LoginWithSlugAsync(handle, email, request.Password, slug, now, cancellationToken);
    }

    /// <summary>
    /// Redeems an org choice: mints the session for the chosen candidate organization, consuming the WHOLE choice in
    /// one statement guarded by <c>ConsumedAt IS NULL</c>. Changes no credential.
    /// </summary>
    /// <param name="request">The choice token and the chosen slug.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A session, a validation failure (400), or the uniform refusal (401).</returns>
    public async Task<OrgStaffLoginResult> ChooseAsync(StaffLoginChooseRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var token = request.ChoiceToken?.Trim();
        if (string.IsNullOrEmpty(token) || token.Length > MaxChoiceTokenLength)
        {
            return OrgStaffLoginResult.Invalid($"choiceToken is required (1-{MaxChoiceTokenLength} characters).");
        }

        var slug = NormalizeSlug(request.OrgSlug);
        if (slug is null || slug.Length > Organization.MaxSlugLength)
        {
            return OrgStaffLoginResult.Invalid($"orgSlug is required (1-{Organization.MaxSlugLength} characters).");
        }

        var now = DateTimeOffset.UtcNow;
        var tokenHash = SessionTokens.Hash(token);

        // LoginChoice is an unscoped resolution root, looked up by its token hash.
        var choice = await _dbContext.LoginChoices
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.TokenHash == tokenHash, cancellationToken);

        if (choice is null || choice.ConsumedAt is not null || choice.ExpiresAt <= now)
        {
            LogChoiceRefused();
            return OrgStaffLoginResult.Rejected();
        }

        var organization = await FindOrganizationAsync(slug, cancellationToken);

        // Only a CANDIDATE organization of this choice is accepted; any other slug (foreign, unknown) is the uniform
        // refusal and leaves the choice unconsumed.
        var candidate = organization is null
            ? null
            : await _dbContext.LoginChoiceCandidates
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.ChoiceId == choice.Id && c.OrganizationId == organization.Id, cancellationToken);

        if (organization is null || candidate is null)
        {
            LogChoiceRefused();
            return OrgStaffLoginResult.Rejected();
        }

        // Consume the whole choice atomically: one statement, guarded so a token can never mint twice (or for a
        // second organization). Consumed before minting — a later refusal leaves it spent (fail closed).
        var consumed = await _dbContext.LoginChoices
            .Where(c => c.Id == choice.Id && c.ConsumedAt == null && c.ExpiresAt > now)
            .ExecuteUpdateAsync(set => set.SetProperty(c => c.ConsumedAt, now), cancellationToken);

        if (consumed != 1)
        {
            LogChoiceRefused();
            return OrgStaffLoginResult.Rejected();
        }

        var person = await _dbContext.People
            .InOrganization(organization.Id)
            .FirstOrDefaultAsync(p => p.Id == candidate.PersonId, cancellationToken);

        // A credential change after the choice was verified (§3.3) — or a lockout / disable since — refuses it.
        var choiceCreatedAt = choice.ExpiresAt - ChoiceLifetime;
        if (person is null
            || StaffSignInLockout.IsBlocked(person, now)
            || (person.PasswordChangedAt is { } changedAt && changedAt > choiceCreatedAt))
        {
            AddAudit(organization.Id, SignInAuditKind, RefusedOutcome, person?.Id, "{\"reason\":\"choice-stale\"}", now);
            await _dbContext.SaveChangesAsync(cancellationToken);
            return OrgStaffLoginResult.Rejected();
        }

        var staffUser = await _dbContext.StaffUsers
            .InOrganization(organization.Id)
            .FirstOrDefaultAsync(u => u.Id == person.Id, cancellationToken);

        if (staffUser is null)
        {
            AddAudit(organization.Id, SignInAuditKind, RefusedOutcome, person.Id, "{\"reason\":\"no-grant\"}", now);
            await _dbContext.SaveChangesAsync(cancellationToken);
            return OrgStaffLoginResult.Rejected();
        }

        AddAudit(organization.Id, ChoiceAuditKind, SuccessOutcome, person.Id, "{}", now);
        return await MintAsync(person, staffUser, organization.Id, now, cancellationToken);
    }

    /// <summary>
    /// Stages (does NOT save) the invalidation of every unconsumed <see cref="LoginChoiceCandidate"/> of
    /// <paramref name="personId"/> — the credential-change rule (ADMIN-IDENTITY-MODEL §3.3): a choice verified against
    /// the old password can no longer mint a session. Call it in the SAME unit of work as the credential change.
    /// </summary>
    /// <param name="dbContext">The unit of work the credential change is saved through.</param>
    /// <param name="personId">The person whose credential changed.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>How many candidate rows were staged for removal.</returns>
    public static async Task<int> StageCredentialChangeInvalidationAsync(
        PulseDbContext dbContext,
        Guid personId,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(dbContext);

        var stale = await (
            from candidate in dbContext.LoginChoiceCandidates
            join choice in dbContext.LoginChoices on candidate.ChoiceId equals choice.Id
            where candidate.PersonId == personId && choice.ConsumedAt == null
            select candidate).ToListAsync(cancellationToken);

        dbContext.LoginChoiceCandidates.RemoveRange(stale);
        return stale.Count;
    }

    private static string? NormalizeSlug(string? raw)
    {
        var trimmed = raw?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed.ToLowerInvariant();
    }

    private static string HashForLog(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value.ToLowerInvariant())))[..12];

    private async Task<OrgStaffLoginResult> LoginWithSlugAsync(
        string handle,
        string? email,
        string password,
        string slug,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var organization = await FindOrganizationAsync(slug, cancellationToken);
        if (organization is null)
        {
            BurnVerification(password);
            LogUnresolved(handle);
            return OrgStaffLoginResult.Rejected();
        }

        // Exactly one candidate with a slug: the person with this email in this organization (when there is one).
        var candidate = email is null
            ? null
            : await _dbContext.People
                .InOrganization(organization.Id)
                .FirstOrDefaultAsync(p => p.Email == email, cancellationToken);

        if (candidate is not null && StaffSignInLockout.IsBlocked(candidate, now))
        {
            // Locked out (or disabled): skipped without verification.
            AddAudit(organization.Id, SignInAuditKind, RefusedOutcome, candidate.Id, "{\"reason\":\"locked\"}", now);
            await _dbContext.SaveChangesAsync(cancellationToken);
            return OrgStaffLoginResult.Rejected();
        }

        var staffUser = await VerifyAsync(handle, password, organization.Id, cancellationToken);
        var verified = staffUser is not null
            && staffUser.OrganizationId == organization.Id
            && (candidate is null || staffUser.Id == candidate.Id);

        if (!verified)
        {
            if (candidate is not null)
            {
                StaffSignInLockout.RecordFailure(candidate, now);
            }

            AddAudit(organization.Id, SignInAuditKind, RefusedOutcome, candidate?.Id, "{\"reason\":\"credentials\"}", now);
            await _dbContext.SaveChangesAsync(cancellationToken);
            return OrgStaffLoginResult.Rejected();
        }

        // The allowlist fallback (no Person matched the email): the verified staff facet names the person.
        var person = candidate ?? await _dbContext.People
            .InOrganization(organization.Id)
            .FirstOrDefaultAsync(p => p.Id == staffUser!.Id, cancellationToken);

        if (person is null || StaffSignInLockout.IsBlocked(person, now))
        {
            AddAudit(organization.Id, SignInAuditKind, RefusedOutcome, person?.Id, "{\"reason\":\"locked\"}", now);
            await _dbContext.SaveChangesAsync(cancellationToken);
            return OrgStaffLoginResult.Rejected();
        }

        return await MintAsync(person, staffUser!, organization.Id, now, cancellationToken);
    }

    private async Task<OrgStaffLoginResult> LoginWithoutSlugAsync(
        string handle,
        string? email,
        string password,
        string? remoteIp,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        List<Person> candidates = [];
        if (email is not null)
        {
            // org-scope-exempt(ResolutionRoot): email-first sign-in IS the resolution of which organizations this human
            // belongs to, before any tenant is known. Nothing is disclosed from it: a candidate's organization is
            // revealed only after the password verified for that candidate (below), and the read is capped.
            candidates = await _dbContext.People
                .Where(p => p.Email == email)
                .OrderBy(p => p.CreatedAt)
                .ThenBy(p => p.Id)
                .Take(MaxCandidates)
                .ToListAsync(cancellationToken);
        }

        if (candidates.Count == 0)
        {
            return await LoginByAllowlistAsync(handle, password, now, cancellationToken);
        }

        var tried = new List<Person>();
        var verified = new List<(Person Person, StaffUser StaffUser)>();
        foreach (var candidate in candidates)
        {
            if (StaffSignInLockout.IsBlocked(candidate, now))
            {
                continue; // locked out / disabled: skipped WITHOUT verification
            }

            tried.Add(candidate);
            var staffUser = await VerifyAsync(handle, password, candidate.OrganizationId, cancellationToken);
            if (staffUser is not null && staffUser.Id == candidate.Id && staffUser.OrganizationId == candidate.OrganizationId)
            {
                verified.Add((candidate, staffUser));
            }
        }

        if (verified.Count == 0)
        {
            // The attempt failed AS A WHOLE: every tried candidate gets one failure (and each org its own refusal).
            foreach (var person in candidates)
            {
                var wasTried = tried.Contains(person);
                if (wasTried)
                {
                    StaffSignInLockout.RecordFailure(person, now);
                }

                AddAudit(
                    person.OrganizationId,
                    SignInAuditKind,
                    RefusedOutcome,
                    person.Id,
                    wasTried ? "{\"reason\":\"credentials\"}" : "{\"reason\":\"locked\"}",
                    now);
            }

            await _dbContext.SaveChangesAsync(cancellationToken);
            return OrgStaffLoginResult.Rejected();
        }

        if (verified.Count == 1)
        {
            var (person, staffUser) = verified[0];
            return await MintAsync(person, staffUser, person.OrganizationId, now, cancellationToken);
        }

        // More than one organization verified: offer the choice. The other (non-verified) candidates' counters are
        // left alone; the verified ones proved the password.
        foreach (var (person, _) in verified)
        {
            StaffSignInLockout.RecordSuccess(person);
        }

        var rawToken = SessionTokens.Generate();
        var choice = new LoginChoice
        {
            Id = Guid.NewGuid(),
            TokenHash = SessionTokens.Hash(rawToken),
            ExpiresAt = now + ChoiceLifetime,
            CreatedFromIpHash = SessionTokens.Hash("ip:" + (string.IsNullOrEmpty(remoteIp) ? "unknown" : remoteIp)),
        };
        _dbContext.LoginChoices.Add(choice);
        foreach (var (person, _) in verified)
        {
            _dbContext.LoginChoiceCandidates.Add(new LoginChoiceCandidate
            {
                ChoiceId = choice.Id,
                PersonId = person.Id,
                OrganizationId = person.OrganizationId,
            });
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        var organizationIds = verified.Select(v => v.Person.OrganizationId).ToList();
        // org-scope-exempt(ResolutionRoot): by-id lookup of ONLY the organizations whose password just verified for
        // this human (never an enumeration of the customer roster) — the resolution the org choice discloses.
        var organizations = await _dbContext.Organizations
            .AsNoTracking()
            .Where(o => organizationIds.Contains(o.Id))
            .OrderBy(o => o.Name)
            .Select(o => new StaffLoginChoiceOrgDto { Slug = o.Slug, OrgName = o.Name })
            .ToListAsync(cancellationToken);

        return OrgStaffLoginResult.ChoiceRequired(new StaffLoginChoiceDto { Choose = organizations, ChoiceToken = rawToken });
    }

    /// <summary>
    /// No person carries the email (every A1 backfilled staffer has none until invited): the §1.3 break-glass chain —
    /// the Dynamis allowlist, keyed on the staff facet's external subject, which carries the organization.
    /// </summary>
    private async Task<OrgStaffLoginResult> LoginByAllowlistAsync(
        string handle,
        string password,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        BurnVerification(password);

        var staffUser = await VerifyAsync(handle, password, organizationId: null, cancellationToken);
        if (staffUser is null)
        {
            LogUnresolved(handle);
            return OrgStaffLoginResult.Rejected();
        }

        var person = await _dbContext.People
            .InOrganization(staffUser.OrganizationId)
            .FirstOrDefaultAsync(p => p.Id == staffUser.Id, cancellationToken);

        if (person is null || StaffSignInLockout.IsBlocked(person, now))
        {
            AddAudit(staffUser.OrganizationId, SignInAuditKind, RefusedOutcome, person?.Id, "{\"reason\":\"locked\"}", now);
            await _dbContext.SaveChangesAsync(cancellationToken);
            return OrgStaffLoginResult.Rejected();
        }

        return await MintAsync(person, staffUser, staffUser.OrganizationId, now, cancellationToken);
    }

    /// <summary>
    /// Mints the session for a verified person: ORG scope for an org admin, otherwise the person's most recently used
    /// staff enrollment in <paramref name="organizationId"/>; neither is the uniform refusal.
    /// </summary>
    private async Task<OrgStaffLoginResult> MintAsync(
        Person person,
        StaffUser staffUser,
        Guid organizationId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (Person.IsOrgAdmin(person.OrgRole))
        {
            StaffSignInLockout.RecordSuccess(person);
            staffUser.LastLoginAt = now;
            AddAudit(organizationId, SignInAuditKind, SuccessOutcome, person.Id, "{\"scope\":\"org\"}", now);
            await _dbContext.SaveChangesAsync(cancellationToken);

            var orgSession = await _sessionIssuer.IssueAsync(
                StaffSessionRequest(staffUser.Id, exerciseId: null, Person.OrgAdminRole),
                cancellationToken);
            return OrgStaffLoginResult.Authenticated(orgSession, isLead: false);
        }

        var enrollment = await MostRecentlyUsedStaffEnrollmentAsync(person.Id, organizationId, cancellationToken);
        if (enrollment is null)
        {
            // The password was right but there is nothing to sign in to — not a credential failure, so no counter.
            AddAudit(organizationId, SignInAuditKind, RefusedOutcome, person.Id, "{\"reason\":\"no-grant\"}", now);
            await _dbContext.SaveChangesAsync(cancellationToken);
            return OrgStaffLoginResult.Rejected();
        }

        StaffSignInLockout.RecordSuccess(person);
        staffUser.LastLoginAt = now;

        // An exercise-scoped sign-in stays the exercise's XC-004 login event (§7.5), as on the exercise-bound path.
        _dbContext.TelemetryEvents.Add(StaffLoginService.BuildLoginTelemetry(
            enrollment.ExerciseId,
            role: enrollment.Role,
            actingHumanId: staffUser.Id.ToString(),
            outcome: SuccessTelemetryPayload,
            now: now,
            scenarioTime: enrollment.CurrentScenarioTime ?? now,
            timeZone: enrollment.TimeZone,
            targetStaffUserId: staffUser.Id));
        await _dbContext.SaveChangesAsync(cancellationToken);

        var issued = await _sessionIssuer.IssueAsync(
            StaffSessionRequest(staffUser.Id, enrollment.ExerciseId, enrollment.Role),
            cancellationToken);
        return OrgStaffLoginResult.Authenticated(issued, enrollment.IsLead);
    }

    private static SessionIssueRequest StaffSessionRequest(Guid staffUserId, Guid? exerciseId, string role) => new()
    {
        ExerciseId = exerciseId,
        Kind = StaffSessionKind,
        Role = role,
        PrincipalId = staffUserId.ToString(),
        ActingHumanId = staffUserId.ToString(),
        IsReadOnly = false,
        AccountId = null,
        StaffUserId = staffUserId,
        PersonaId = null,
        PersonId = staffUserId,
    };

    /// <summary>
    /// The person's staff enrollment in the organization most recently signed in to (its latest staff session), then
    /// the newest enrollment. Only staff-role enrollments — never one with an account.
    /// </summary>
    private async Task<LandingEnrollment?> MostRecentlyUsedStaffEnrollmentAsync(
        Guid personId,
        Guid organizationId,
        CancellationToken cancellationToken)
    {
        var enrollments = await (
            // org-scope-exempt(TenantChecked): own-only (PersonId is the person whose password just verified) and every
            // row must inner-join an Exercise of that person's own organization (InOrganization), so no other
            // customer's exercise can be landed on. Cross-exercise by design — no exercise scope exists yet.
            from enrollment in _dbContext.Enrollments.IgnoreQueryFilters().Active().AsNoTracking().Where(EnrollmentRoles.IsStaffEnrollment)
            where enrollment.PersonId == personId
            join exercise in _dbContext.Exercises.AsNoTracking().InOrganization(organizationId) on enrollment.ExerciseId equals exercise.Id
            select new LandingEnrollment(
                enrollment.ExerciseId,
                enrollment.Role,
                enrollment.IsLead,
                enrollment.CreatedAt,
                exercise.CurrentScenarioTime,
                exercise.TimeZone)).ToListAsync(cancellationToken);

        if (enrollments.Count == 0)
        {
            return null;
        }

        // Session is unscoped; this is the person's own staff session history.
        var lastUsed = await _dbContext.Sessions
            .AsNoTracking()
            .Where(s => s.StaffUserId == personId && s.Kind == StaffSessionKind && s.ExerciseId != null)
            .GroupBy(s => s.ExerciseId)
            .Select(g => new { ExerciseId = g.Key!.Value, LastIssuedAt = g.Max(s => s.IssuedAt) })
            .ToDictionaryAsync(x => x.ExerciseId, x => x.LastIssuedAt, cancellationToken);

        return enrollments
            .OrderByDescending(e => lastUsed.TryGetValue(e.ExerciseId, out var at) ? at : DateTimeOffset.MinValue)
            .ThenByDescending(e => e.CreatedAt)
            .ThenBy(e => e.ExerciseId)
            .First();
    }

    /// <summary>Verifies through the chained provider; returns the staff facet of the verified subject, or <c>null</c>.</summary>
    private async Task<StaffUser?> VerifyAsync(string handle, string password, Guid? organizationId, CancellationToken cancellationToken)
    {
        var authentication = await _identityProvider.AuthenticateAsync(
            new StaffCredentials { Username = handle, Secret = password, OrganizationId = organizationId },
            cancellationToken);

        if (authentication.Outcome != StaffAuthenticationOutcome.Authenticated || authentication.Identity is null)
        {
            return null;
        }

        // org-scope-exempt(ResolutionRoot): IdP subject → staff human, the same resolve-by-subject read the
        // exercise-bound login performs. Every caller then compares the row's OrganizationId to the organization the
        // sign-in is for before anything is minted.
        return await _dbContext.StaffUsers
            .FirstOrDefaultAsync(u => u.ExternalSubject == authentication.Identity.ExternalSubject, cancellationToken);
    }

    private async Task<OrgRef?> FindOrganizationAsync(string slug, CancellationToken cancellationToken) =>
        // org-scope-exempt(ResolutionRoot): this read IS the resolution — the URL slug to its tenant, exactly as a host
        // header resolves to an exercise — performed before any tenant is known. One row by its unique slug.
        await _dbContext.Organizations
            .AsNoTracking()
            .Where(o => o.Slug == slug)
            .Select(o => new OrgRef(o.Id))
            .FirstOrDefaultAsync(cancellationToken);

    private void AddAudit(Guid organizationId, string kind, string outcome, Guid? subjectPersonId, string payload, DateTimeOffset now) =>
        _dbContext.OrgAuditEvents.Add(new OrgAuditEvent
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            Kind = kind,
            Outcome = outcome,
            ActorPersonId = outcome == SuccessOutcome ? subjectPersonId : null,
            SubjectPersonId = subjectPersonId,
            ExerciseId = null,
            Payload = payload,
            OccurredAt = now,
        });

    /// <summary>Spends one PBKDF2 verification so an attempt with no Pulse-password candidate is not measurably faster.</summary>
    private static void BurnVerification(string password) =>
        _ = new PasswordHasher<Person>().VerifyHashedPassword(new Person { DisplayName = string.Empty }, DummyHash.Value, password);

    private void LogUnresolved(string handle)
    {
        if (_logger.IsEnabled(LogLevel.Information))
        {
            var handleHash = HashForLog(handle);
            LogUnresolvedSignIn(handleHash);
        }
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Information,
        Message = "Staff sign-in refused with no resolvable organization (handle hash {HandleHash}).")]
    private partial void LogUnresolvedSignIn(string handleHash);

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Information,
        Message = "Staff org choice refused (unknown, spent, expired, or non-candidate organization).")]
    private partial void LogChoiceRefused();

    private sealed record OrgRef(Guid Id);

    private sealed record LandingEnrollment(
        Guid ExerciseId,
        string Role,
        bool IsLead,
        DateTimeOffset CreatedAt,
        DateTimeOffset? CurrentScenarioTime,
        string TimeZone);
}

/// <summary>The outcome kind of an <see cref="OrgStaffLoginService"/> call.</summary>
public enum OrgStaffLoginOutcome
{
    /// <summary>A session was minted — 200 with the login response.</summary>
    Authenticated,

    /// <summary>The password verified for more than one organization — 200 with the org choice.</summary>
    ChoiceRequired,

    /// <summary>The body failed validation — 400.</summary>
    Invalid,

    /// <summary>The uniform refusal — 401, no body.</summary>
    Rejected,
}

/// <summary>The result of an org sign-in or org choice.</summary>
public sealed class OrgStaffLoginResult
{
    private OrgStaffLoginResult(OrgStaffLoginOutcome outcome) => Outcome = outcome;

    /// <summary>Which outcome occurred.</summary>
    public OrgStaffLoginOutcome Outcome { get; }

    /// <summary>The issued session (Authenticated only).</summary>
    public SessionIssueResult? Issued { get; private init; }

    /// <summary>Whether the landing enrollment is the lead controller, read live (Authenticated only).</summary>
    public bool IsLead { get; private init; }

    /// <summary>The org choice (ChoiceRequired only).</summary>
    public StaffLoginChoiceDto? Choice { get; private init; }

    /// <summary>The validation message (Invalid only).</summary>
    public string? ValidationError { get; private init; }

    /// <summary>A minted session.</summary>
    /// <param name="issued">The issuer result.</param>
    /// <param name="isLead">The live lead flag of the landing enrollment.</param>
    /// <returns>An authenticated result.</returns>
    public static OrgStaffLoginResult Authenticated(SessionIssueResult issued, bool isLead)
    {
        ArgumentNullException.ThrowIfNull(issued);
        return new OrgStaffLoginResult(OrgStaffLoginOutcome.Authenticated) { Issued = issued, IsLead = isLead };
    }

    /// <summary>An org choice to make.</summary>
    /// <param name="choice">The choice response.</param>
    /// <returns>A choice-required result.</returns>
    public static OrgStaffLoginResult ChoiceRequired(StaffLoginChoiceDto choice)
    {
        ArgumentNullException.ThrowIfNull(choice);
        return new OrgStaffLoginResult(OrgStaffLoginOutcome.ChoiceRequired) { Choice = choice };
    }

    /// <summary>A validation failure.</summary>
    /// <param name="validationError">The reason.</param>
    /// <returns>An invalid result.</returns>
    public static OrgStaffLoginResult Invalid(string validationError) =>
        new(OrgStaffLoginOutcome.Invalid) { ValidationError = validationError };

    /// <summary>The uniform refusal.</summary>
    /// <returns>A rejected result.</returns>
    public static OrgStaffLoginResult Rejected() => new(OrgStaffLoginOutcome.Rejected);
}
