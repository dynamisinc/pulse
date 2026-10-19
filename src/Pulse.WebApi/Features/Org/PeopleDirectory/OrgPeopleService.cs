namespace Pulse.WebApi.Features.Org.PeopleDirectory;

using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseLifecycleAdmin;
using Pulse.WebApi.Features.Identity.Credentials;
using Pulse.WebApi.Features.Identity.Enrollments;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Realtime;

/// <summary>
/// The org directory (identity-auth-roles/19, ADMIN-IDENTITY-MODEL §1.1 / §7): lists the people of the caller's OWN
/// organization, and lets an org admin grant or revoke the org-admin grant (<see cref="Person.OrgRole"/>) and disable or
/// enable a person. Behind <c>/api/org/people</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (always-Critical).</b> The tenant is the caller's SERVER-resolved organization
/// (<see cref="StaffCaller.OrganizationId"/>), never a request value. Every <c>People</c> / <c>Exercises</c> /
/// <c>StaffUsers</c> read is bounded with <c>InOrganization(tenant)</c>, so another customer's person id is the same bare
/// <c>404</c> as an id that does not exist. One-off participants (<c>Enrollment.PersonId</c> null) have no
/// <see cref="Person"/> row and so can never appear.
/// </para>
/// <para>
/// <b>The last-org-admin safeguard.</b> Revoking the grant from, or disabling, the last ENABLED org admin
/// (<c>OrgRole = orgAdmin AND DisabledAt IS NULL</c>) is refused with <c>409 last-org-admin</c>. The count is taken in
/// the SAME transaction as the write, by an <c>UPDATE … SET OrgRole = OrgRole</c> over exactly those rows: the update
/// locks every enabled admin row of the organization until commit (a write lock, which read-committed snapshot does not
/// bypass), and its row count IS the count. Two admins demoting or disabling each other concurrently therefore
/// serialize on those row locks, and the second recounts after the first commits — never leaving zero.
/// </para>
/// <para>
/// <b>Grant-revoke rule (§1.1).</b> Revoking the grant revokes the person's org-scope sessions; disabling revokes ALL of
/// their sessions (any exercise and org scope) — both in the same transaction, access and refresh — and the matching
/// live hub connections are cut after the commit.
/// </para>
/// <para>
/// <b>Promotion voids credential links.</b> Granting the org-admin grant voids every outstanding credential token
/// (invite and reset) of the person in the same transaction (#665 review W5).
/// </para>
/// <para>
/// <b>Audit.</b> Each change writes one <see cref="OrgAuditEvent"/> (no XC-004 <c>TelemetryEvent</c>: the change touches
/// no exercise) in the same unit of work, through <see cref="StaffChangeRecorder"/>'s org-level overload. A no-op (grant
/// to an existing admin, enable of an enabled person, …) writes nothing.
/// </para>
/// </remarks>
public sealed partial class OrgPeopleService
{
    /// <summary>The default directory page size.</summary>
    public const int DefaultPageSize = 25;

    /// <summary>The largest page size a caller may ask for.</summary>
    public const int MaxPageSize = 100;

    /// <summary>The longest search term accepted.</summary>
    public const int MaxSearchLength = 200;

    /// <summary>409: the change would leave the organization with no enabled org admin.</summary>
    public const string LastOrgAdminError = "last-org-admin";

    /// <summary>409: an org admin may not disable themselves.</summary>
    public const string CannotDisableSelfError = "cannot-disable-self";

    /// <summary>400: the PATCH body must carry exactly one of <c>isOrgAdmin</c> / <c>disabled</c>.</summary>
    public const string InvalidRequestError = "invalid-request";

    /// <summary>400: <c>page</c> / <c>pageSize</c> out of range.</summary>
    public const string InvalidPagingError = "invalid-paging";

    /// <summary>400: the search term is longer than <see cref="MaxSearchLength"/>.</summary>
    public const string SearchTooLongError = "search-too-long";

    /// <summary>Org-audit kind: <c>OrgRole = orgAdmin</c> granted.</summary>
    public const string OrgRoleGrantedKind = "org.person.org-role-granted";

    /// <summary>Org-audit kind: <c>OrgRole</c> revoked.</summary>
    public const string OrgRoleRevokedKind = "org.person.org-role-revoked";

    /// <summary>Org-audit kind: person disabled.</summary>
    public const string DisabledKind = "org.person.disabled";

    /// <summary>Org-audit kind: person enabled.</summary>
    public const string EnabledKind = "org.person.enabled";

    private readonly PulseDbContext _dbContext;
    private readonly StaffCallerContext _staffCaller;
    private readonly ISessionConnectionRevoker _connectionRevoker;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<OrgPeopleService> _logger;

    /// <summary>Creates the service.</summary>
    /// <param name="dbContext">The request-scoped persistence context (one unit of work).</param>
    /// <param name="staffCaller">The resolved staff caller (identity, role and tenant from the caller's own session).</param>
    /// <param name="connectionRevoker">Cuts the live hub connections of the sessions a change revokes.</param>
    /// <param name="timeProvider">The server wall clock.</param>
    /// <param name="logger">Logs a post-commit connection cut that failed.</param>
    public OrgPeopleService(
        PulseDbContext dbContext,
        StaffCallerContext staffCaller,
        ISessionConnectionRevoker connectionRevoker,
        TimeProvider timeProvider,
        ILogger<OrgPeopleService>? logger = null)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(staffCaller);
        ArgumentNullException.ThrowIfNull(connectionRevoker);
        ArgumentNullException.ThrowIfNull(timeProvider);

        _dbContext = dbContext;
        _staffCaller = staffCaller;
        _connectionRevoker = connectionRevoker;
        _timeProvider = timeProvider;
        _logger = logger ?? NullLogger<OrgPeopleService>.Instance;
    }

    /// <summary>Lists one page of the caller's organization's people, optionally filtered by name or email.</summary>
    /// <param name="search">A case-insensitive substring of the display name or email, or <c>null</c>.</param>
    /// <param name="page">The 1-based page (default 1).</param>
    /// <param name="pageSize">The page size (default <see cref="DefaultPageSize"/>, at most <see cref="MaxPageSize"/>).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome the endpoint maps to a status.</returns>
    public async Task<OrgPeopleResult> ListAsync(string? search, int? page, int? pageSize, CancellationToken cancellationToken = default)
    {
        var (caller, refusal) = await AuthorizeAsync(cancellationToken);
        if (refusal is not null)
        {
            return refusal;
        }

        var pageNumber = page ?? 1;
        var size = pageSize ?? DefaultPageSize;
        if (pageNumber < 1 || size < 1 || size > MaxPageSize || (long)(pageNumber - 1) * size > int.MaxValue)
        {
            return OrgPeopleResult.Invalid(InvalidPagingError);
        }

        var term = search?.Trim();
        if (term is { Length: > MaxSearchLength })
        {
            return OrgPeopleResult.Invalid(SearchTooLongError);
        }

        var tenant = caller!.OrganizationId;
        var people = _dbContext.People.AsNoTracking().InOrganization(tenant);
        if (!string.IsNullOrEmpty(term))
        {
            people = people.Where(p => p.DisplayName.Contains(term) || (p.Email != null && p.Email.Contains(term)));
        }

        var total = await people.CountAsync(cancellationToken);
        var rows = await people
            .OrderBy(p => p.DisplayName)
            .ThenBy(p => p.Id)
            .Skip((pageNumber - 1) * size)
            .Take(size)
            .Select(PersonRow.Projection)
            .ToListAsync(cancellationToken);

        var items = await ToDtosAsync(tenant, rows, cancellationToken);
        return OrgPeopleResult.Ok(new OrgPeoplePageDto { Items = items, Page = pageNumber, PageSize = size, Total = total });
    }

    /// <summary>Reads one person of the caller's organization.</summary>
    /// <param name="personId">The person (route value).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome the endpoint maps to a status (a foreign or missing id is the bare 404).</returns>
    public async Task<OrgPeopleResult> GetAsync(Guid personId, CancellationToken cancellationToken = default)
    {
        var (caller, refusal) = await AuthorizeAsync(cancellationToken);
        if (refusal is not null)
        {
            return refusal;
        }

        var dto = await ReadPersonAsync(caller!.OrganizationId, personId, cancellationToken);
        return dto is null ? OrgPeopleResult.NotFound() : OrgPeopleResult.Ok(dto);
    }

    /// <summary>
    /// Applies ONE change to a person of the caller's organization: grant/revoke the org-admin grant, or disable/enable.
    /// </summary>
    /// <param name="personId">The person (route value).</param>
    /// <param name="request">The body (may be <c>null</c>).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome the endpoint maps to a status.</returns>
    public async Task<OrgPeopleResult> UpdateAsync(Guid personId, UpdateOrgPersonRequest? request, CancellationToken cancellationToken = default)
    {
        var (caller, refusal) = await AuthorizeAsync(cancellationToken);
        if (refusal is not null)
        {
            return refusal;
        }

        // Exactly one change per request, so each request is one audited action.
        if (request is null || (request.IsOrgAdmin is null) == (request.Disabled is null))
        {
            return OrgPeopleResult.Invalid(InvalidRequestError);
        }

        var tenant = caller!.OrganizationId;
        var reducesAdmins = request.IsOrgAdmin == false || request.Disabled == true;
        var now = _timeProvider.GetUtcNow();
        var actor = new StaffChangeActor(caller.StaffUserId, caller.Role, caller.SessionId);

        List<Guid> revokedSessionIds = [];
        await using (var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken))
        {
            // The last-org-admin lock + count (see the type remarks). Taken BEFORE the target is read, so the target's
            // own state below is read after any concurrent admin change has committed.
            var enabledAdmins = reducesAdmins
                ? await _dbContext.People
                    .InOrganization(tenant)
                    .Where(p => p.OrgRole == Person.OrgAdminRole && p.DisabledAt == null)
                    .ExecuteUpdateAsync(setters => setters.SetProperty(p => p.OrgRole, p => p.OrgRole), cancellationToken)
                : 0;

            // The bare-404 pattern: another customer's person is indistinguishable from a missing one.
            var person = await _dbContext.People
                .InOrganization(tenant)
                .FirstOrDefaultAsync(p => p.Id == personId, cancellationToken);
            if (person is null)
            {
                await transaction.RollbackAsync(cancellationToken);
                return OrgPeopleResult.NotFound();
            }

            var isEnabledAdmin = Person.IsOrgAdmin(person.OrgRole) && person.DisabledAt is null;
            string? auditKind = null;
            string? payload = null;

            if (request.IsOrgAdmin is { } grant)
            {
                if (grant && !Person.IsOrgAdmin(person.OrgRole))
                {
                    person.OrgRole = Person.OrgAdminRole;
                    await EnsureStaffFacetAsync(person, now, cancellationToken);

                    // #665 adversarial review W5: a reset or invite link issued while the person was NOT an admin must
                    // never be redeemable once they are one (it would hand a non-admin-era link holder an admin
                    // credential). Every outstanding token of both purposes is voided in this transaction.
                    var voided = await CredentialTokenService.StageCredentialChangeInvalidationAsync(
                        _dbContext, CredentialSubject.ForPerson(person.Id), tenant, now, cancellationToken);
                    auditKind = OrgRoleGrantedKind;
                    payload = Payload(caller.Role, revoked: 0, tokensVoided: voided);
                }
                else if (!grant && Person.IsOrgAdmin(person.OrgRole))
                {
                    if (isEnabledAdmin && enabledAdmins <= 1)
                    {
                        await transaction.RollbackAsync(cancellationToken);
                        return OrgPeopleResult.Conflict(LastOrgAdminError);
                    }

                    person.OrgRole = null;
                    revokedSessionIds = await PersonSessionRevoker.StageRevokeAsync(
                        _dbContext, person.Id, PersonSessionScope.OrgScopeOnly, now, cancellationToken);
                    auditKind = OrgRoleRevokedKind;
                    payload = Payload(caller.Role, revokedSessionIds.Count);
                }
            }
            else if (request.Disabled is true)
            {
                if (person.DisabledAt is null)
                {
                    // The last-admin rule answers first (it is the stronger reason); otherwise an admin may still never
                    // disable themselves — that would sign them out of the console they are using, with no way back in.
                    if (isEnabledAdmin && enabledAdmins <= 1)
                    {
                        await transaction.RollbackAsync(cancellationToken);
                        return OrgPeopleResult.Conflict(LastOrgAdminError);
                    }

                    if (person.Id == caller.StaffUserId)
                    {
                        await transaction.RollbackAsync(cancellationToken);
                        return OrgPeopleResult.Conflict(CannotDisableSelfError);
                    }

                    person.DisabledAt = now;
                    revokedSessionIds = await PersonSessionRevoker.StageRevokeAsync(
                        _dbContext, person.Id, PersonSessionScope.All, now, cancellationToken);
                    auditKind = DisabledKind;
                    payload = Payload(caller.Role, revokedSessionIds.Count);
                }
            }
            else if (person.DisabledAt is not null)
            {
                person.DisabledAt = null;
                auditKind = EnabledKind;
                payload = Payload(caller.Role, revoked: 0);
            }

            if (auditKind is null)
            {
                // A no-op: nothing changed, so nothing is written or audited.
                await transaction.RollbackAsync(cancellationToken);
            }
            else
            {
                StaffChangeRecorder.Stage(_dbContext, tenant, actor, person.Id, auditKind, payload!, now);
                await _dbContext.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
            }
        }

        await CutRevokedConnectionsAfterCommitAsync(revokedSessionIds, cancellationToken);

        var dto = await ReadPersonAsync(tenant, personId, cancellationToken);
        return dto is null ? OrgPeopleResult.NotFound() : OrgPeopleResult.Ok(dto);
    }

    /// <summary>The audit payload: the acting role and how many sessions the change revoked. Never a secret.</summary>
    private static string Payload(string actorRole, int revoked, int tokensVoided = 0) => string.Create(
        CultureInfo.InvariantCulture,
        $"{{\"actorRole\":{JsonSerializer.Serialize(actorRole)},\"sessionsRevoked\":{revoked},\"tokensVoided\":{tokensVoided}}}");

    /// <summary>
    /// Org-scope sign-in mints a session only for a person with a staff facet, so granting the org-admin grant creates the
    /// facet when missing (shared key, as <c>EnrollmentService.GrantAsync</c> does), in the same unit of work.
    /// </summary>
    private async Task EnsureStaffFacetAsync(Person person, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var hasFacet = await _dbContext.StaffUsers
            .InOrganization(person.OrganizationId)
            .AnyAsync(u => u.Id == person.Id, cancellationToken);
        if (!hasFacet)
        {
            _dbContext.StaffUsers.Add(new StaffUser
            {
                Id = person.Id,
                OrganizationId = person.OrganizationId,
                ExternalSubject = $"pulse|{person.Id:N}",
                DisplayName = person.DisplayName,
                CreatedAt = now,
            });
        }
    }

    private async Task<(StaffCaller? Caller, OrgPeopleResult? Refusal)> AuthorizeAsync(CancellationToken cancellationToken)
    {
        var caller = await _staffCaller.ResolveAsync(cancellationToken);
        if (caller is null)
        {
            return (null, OrgPeopleResult.Unauthenticated());
        }

        // Org admins only, on their org-scope session (the endpoint filter admits the role; the scope is checked here).
        if (!ExerciseAdminRoles.IsOrgAdmin(caller.Role) || !caller.IsOrgScope)
        {
            return (null, OrgPeopleResult.Forbidden());
        }

        return (caller, null);
    }

    private async Task<OrgPersonDto?> ReadPersonAsync(Guid tenant, Guid personId, CancellationToken cancellationToken)
    {
        var row = await _dbContext.People
            .AsNoTracking()
            .InOrganization(tenant)
            .Where(p => p.Id == personId)
            .Select(PersonRow.Projection)
            .FirstOrDefaultAsync(cancellationToken);

        return row is null ? null : (await ToDtosAsync(tenant, [row], cancellationToken))[0];
    }

    private async Task<List<OrgPersonDto>> ToDtosAsync(Guid tenant, List<PersonRow> rows, CancellationToken cancellationToken)
    {
        var ids = rows.Select(row => row.Id).ToList();
        var enrollments = ids.Count == 0
            ? []
            : await (
                // org-scope-exempt(TenantChecked): every row must inner-join an Exercise of the caller's OWN server-resolved
                // organization (InOrganization below), and the person ids were themselves read .InOrganization(tenant).
                // The person ids were just read .InOrganization(tenant); the exercise join is bounded the same way, so an
                // enrollment straddling a tenant boundary is never listed. Enrollment is exercise-scoped and this read
                // spans the organization's exercises by design, so the exercise filter is bypassed explicitly.
                from enrollment in _dbContext.Enrollments.IgnoreQueryFilters().Active().AsNoTracking()
                join exercise in _dbContext.Exercises.AsNoTracking().InOrganization(tenant)
                    on enrollment.ExerciseId equals exercise.Id
                where enrollment.PersonId != null && ids.Contains(enrollment.PersonId.Value)
                orderby exercise.Name, exercise.Id
                select new EnrollmentRow(enrollment.PersonId!.Value, exercise.Id, exercise.Name, enrollment.Role, enrollment.IsLead))
                .ToListAsync(cancellationToken);

        var byPerson = enrollments.ToLookup(row => row.PersonId);
        var now = _timeProvider.GetUtcNow();

        // Guids are stringified in memory (SQL Server renders uniqueidentifier UPPERCASE inside a translated ToString()).
        return rows.Select(row => new OrgPersonDto
        {
            Id = row.Id.ToString(),
            DisplayName = row.DisplayName,
            Email = row.Email,
            OrgRole = Person.IsOrgAdmin(row.OrgRole) ? Person.OrgAdminRole : null,
            Disabled = row.DisabledAt is not null,
            DisabledAt = row.DisabledAt?.ToString("O", CultureInfo.InvariantCulture),
            LockedOutUntil = row.LockedOutUntil is { } until && until > now
                ? until.ToString("O", CultureInfo.InvariantCulture)
                : null,
            Enrollments = byPerson[row.Id]
                .Select(e => new OrgPersonEnrollmentDto
                {
                    ExerciseId = e.ExerciseId.ToString(),
                    ExerciseName = e.ExerciseName,
                    Role = e.Role,
                    IsLead = e.IsLead,
                })
                .ToList(),
        }).ToList();
    }

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
        Message = "{Count} revoked session(s) could not have their live connections cut; the org-directory change has committed.")]
    private partial void LogConnectionCutFailed(int count, Exception exception);

    /// <summary>The materialized person projection (no credential columns are ever selected).</summary>
    private sealed record PersonRow(
        Guid Id,
        string DisplayName,
        string? Email,
        string? OrgRole,
        DateTimeOffset? DisabledAt,
        DateTimeOffset? LockedOutUntil)
    {
        public static System.Linq.Expressions.Expression<Func<Person, PersonRow>> Projection { get; } =
            p => new PersonRow(p.Id, p.DisplayName, p.Email, p.OrgRole, p.DisabledAt, p.LockedOutUntil);
    }

    private sealed record EnrollmentRow(Guid PersonId, Guid ExerciseId, string ExerciseName, string Role, bool IsLead);
}

/// <summary>The outcome kind of an <see cref="OrgPeopleService"/> call.</summary>
public enum OrgPeopleOutcome
{
    /// <summary>200 with a page or a person.</summary>
    Ok,

    /// <summary>400 with an error code.</summary>
    Invalid,

    /// <summary>No live staff session or no resolved tenant — 401.</summary>
    Unauthenticated,

    /// <summary>Not an org admin on an org-scope session — 403.</summary>
    Forbidden,

    /// <summary>Missing or foreign-org person — the bare 404.</summary>
    NotFound,

    /// <summary>409 with an error code (<c>last-org-admin</c>, <c>cannot-disable-self</c>).</summary>
    Conflict,
}

/// <summary>The result of an <see cref="OrgPeopleService"/> call.</summary>
public sealed class OrgPeopleResult
{
    private OrgPeopleResult(OrgPeopleOutcome outcome, OrgPeoplePageDto? page, OrgPersonDto? person, string? error)
    {
        Outcome = outcome;
        Page = page;
        Person = person;
        Error = error;
    }

    /// <summary>Which outcome occurred.</summary>
    public OrgPeopleOutcome Outcome { get; }

    /// <summary>The directory page (list).</summary>
    public OrgPeoplePageDto? Page { get; }

    /// <summary>The person (get / update).</summary>
    public OrgPersonDto? Person { get; }

    /// <summary>The error code (400 / 409).</summary>
    public string? Error { get; }

    /// <summary>A page.</summary>
    /// <param name="page">The page.</param>
    /// <returns>The result.</returns>
    public static OrgPeopleResult Ok(OrgPeoplePageDto page) => new(OrgPeopleOutcome.Ok, page, null, null);

    /// <summary>A person.</summary>
    /// <param name="person">The person.</param>
    /// <returns>The result.</returns>
    public static OrgPeopleResult Ok(OrgPersonDto person) => new(OrgPeopleOutcome.Ok, null, person, null);

    /// <summary>A 400.</summary>
    /// <param name="error">The error code.</param>
    /// <returns>The result.</returns>
    public static OrgPeopleResult Invalid(string error) => new(OrgPeopleOutcome.Invalid, null, null, error);

    /// <summary>A 401.</summary>
    /// <returns>The result.</returns>
    public static OrgPeopleResult Unauthenticated() => new(OrgPeopleOutcome.Unauthenticated, null, null, null);

    /// <summary>A 403.</summary>
    /// <returns>The result.</returns>
    public static OrgPeopleResult Forbidden() => new(OrgPeopleOutcome.Forbidden, null, null, null);

    /// <summary>The bare 404.</summary>
    /// <returns>The result.</returns>
    public static OrgPeopleResult NotFound() => new(OrgPeopleOutcome.NotFound, null, null, null);

    /// <summary>A 409.</summary>
    /// <param name="error">The error code.</param>
    /// <returns>The result.</returns>
    public static OrgPeopleResult Conflict(string error) => new(OrgPeopleOutcome.Conflict, null, null, error);
}
