namespace Pulse.WebApi.Features.Identity.Accounts;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// The STAFF-ONLY account provisioning service behind <c>POST /api/staff/accounts</c> (individual create) and
/// <c>POST /api/staff/accounts/import</c> (bulk CSV, story 02, COR-011). Both require a live STAFF session
/// (resolved via <see cref="ICurrentStaffSessionAccessor"/>, which yields a session only for a staff caller — so
/// these are staff-world-only by construction, never participant-reachable, XC-002) and write <see cref="Account"/>
/// rows into the caller's ACTIVE exercise (<see cref="IExerciseContext.CurrentExerciseId"/>, set by the story-03
/// session middleware from the staff session's selected exercise). The <see cref="Account.ExerciseId"/> is ALWAYS
/// stamped from that resolved scope — never a client-supplied id. Scoped lifetime, matching the
/// <see cref="PulseDbContext"/> unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (always-Critical).</b> A created account inherits the B0 write-guard (a <see cref="Guid.Empty"/>
/// scope is refused) and the read-side global query filter (the duplicate-handle check runs within the active
/// exercise), so provisioning can only ever land in — and dedupe against — the staff caller's own active
/// exercise. R6: the resolved scope is validated to be a live <see cref="Exercise"/> before any row is stamped.
/// </para>
/// <para>
/// <b>No telemetry here (deliberate).</b> Story 02's telemetry AC covers only participant login success/failure;
/// account provisioning is not called out, so — per "don't over-emit" — no XC-004 event is emitted for create /
/// import. (A staff admin-audit event for provisioning is a reasonable follow-up, flagged for review.)
/// </para>
/// <para>
/// <b>Partial success on import.</b> Each row is validated independently; valid rows are created and invalid /
/// duplicate rows are reported with a reason, then all created rows commit in ONE <c>SaveChanges</c>. Duplicate
/// detection is case-insensitive (matching the DB's <c>CI</c> collation on the <c>(ExerciseId, Username)</c>
/// unique index, which is the authoritative final guard) and covers both existing rows and repeats within the
/// same file. Credentials are never logged (NFR-009).
/// </para>
/// </remarks>
public sealed class AccountProvisioningService
{
    private const string CreatedStatus = "created";
    private const string FailedStatus = "failed";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentStaffSessionAccessor _currentStaffSession;
    private readonly ParticipantPasswordHasher _passwordHasher;

    /// <summary>Creates the provisioning service over its collaborators.</summary>
    /// <param name="dbContext">The persistence context the account rows are written through.</param>
    /// <param name="exerciseContext">The staff caller's active-exercise scope the accounts are stamped into.</param>
    /// <param name="currentStaffSession">The staff-caller identity seam (authorizes these staff-only writes).</param>
    /// <param name="passwordHasher">The slow-KDF hasher used to store any supplied initial credential.</param>
    public AccountProvisioningService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ICurrentStaffSessionAccessor currentStaffSession,
        ParticipantPasswordHasher passwordHasher)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(currentStaffSession);
        ArgumentNullException.ThrowIfNull(passwordHasher);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _currentStaffSession = currentStaffSession;
        _passwordHasher = passwordHasher;
    }

    /// <summary>
    /// Creates ONE account in the staff caller's active exercise. Fails closed: 401 when unauthenticated, 400 on
    /// an unresolved active exercise or invalid input, 409 on a duplicate handle.
    /// </summary>
    /// <param name="request">The create request.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A result the endpoint maps to a status.</returns>
    public async Task<CreateAccountResult> CreateAsync(CreateAccountRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var authorization = await AuthorizeAndResolveScopeAsync(cancellationToken);
        if (authorization.Failure is { } failure)
        {
            return failure;
        }

        var scope = authorization.ExerciseId;

        if (!AccountFieldRules.TryNormalizeUsername(request.Username, out var username, out var usernameError))
        {
            return CreateAccountResult.Invalid(usernameError);
        }

        if (!AccountFieldRules.TryNormalizeDisplayName(request.DisplayName, out var displayName, out var displayNameError))
        {
            return CreateAccountResult.Invalid(displayNameError);
        }

        if (!AccountFieldRules.TryNormalizeRole(request.Role, out var role, out var roleError))
        {
            return CreateAccountResult.Invalid(roleError);
        }

        if (!AccountFieldRules.TryValidatePassword(request.Password, out var password, out var passwordError))
        {
            return CreateAccountResult.Invalid(passwordError);
        }

        // Duplicate handle within the active exercise (scoped by the global filter; the DB unique index is the
        // authoritative final guard against a race).
        var duplicate = await _dbContext.Accounts.AnyAsync(a => a.Username == username, cancellationToken);
        if (duplicate)
        {
            return CreateAccountResult.Duplicate($"an account with username '{username}' already exists in this exercise.");
        }

        var now = DateTimeOffset.UtcNow;
        var account = new Account
        {
            Id = Guid.NewGuid(),
            ExerciseId = scope,
            Username = username,
            DisplayName = displayName,
            Role = role,
            CredentialHash = password is null ? null : _passwordHasher.Hash(password),
            CreatedAt = now,
        };

        _dbContext.Accounts.Add(account);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return CreateAccountResult.Created(AccountDto.From(account));
    }

    /// <summary>
    /// Imports accounts from raw CSV text into the staff caller's active exercise, returning a per-row outcome
    /// summary. Fails closed: 401 when unauthenticated, 400 on an unresolved active exercise or a malformed CSV.
    /// </summary>
    /// <param name="csvContent">The raw CSV text (already size-bounded by the endpoint).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A result the endpoint maps to a status; the OK outcome carries the per-row summary.</returns>
    public async Task<ImportAccountsResult> ImportAsync(string csvContent, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(csvContent);

        var authorization = await AuthorizeAndResolveScopeAsync(cancellationToken);
        if (authorization.Failure is { } failure)
        {
            return ImportAccountsResult.From(failure);
        }

        var scope = authorization.ExerciseId;

        var parsed = AccountCsvParser.Parse(csvContent);
        if (!parsed.IsValid)
        {
            return ImportAccountsResult.Malformed(parsed.Error!);
        }

        // Load existing handles in the active exercise once (scoped by the global filter) for dedup; track
        // in-file handles too, case-insensitively (matching the DB's CI collation).
        var existingHandles = await _dbContext.Accounts
            .Select(a => a.Username)
            .ToListAsync(cancellationToken);
        var seenHandles = new HashSet<string>(existingHandles, StringComparer.OrdinalIgnoreCase);

        var now = DateTimeOffset.UtcNow;
        var rowResults = new List<AccountImportRowResultDto>(parsed.Rows.Count);
        var createdCount = 0;

        foreach (var row in parsed.Rows)
        {
            if (!AccountFieldRules.TryNormalizeUsername(row.Username, out var username, out var usernameError))
            {
                rowResults.Add(Failed(row.RowNumber, row.Username?.Trim() ?? string.Empty, usernameError));
                continue;
            }

            if (!AccountFieldRules.TryNormalizeDisplayName(row.DisplayName, out var displayName, out var displayNameError))
            {
                rowResults.Add(Failed(row.RowNumber, username, displayNameError));
                continue;
            }

            if (!AccountFieldRules.TryNormalizeRole(row.Role, out var role, out var roleError))
            {
                rowResults.Add(Failed(row.RowNumber, username, roleError));
                continue;
            }

            if (!AccountFieldRules.TryValidatePassword(row.Password, out var password, out var passwordError))
            {
                rowResults.Add(Failed(row.RowNumber, username, passwordError));
                continue;
            }

            if (!seenHandles.Add(username))
            {
                rowResults.Add(Failed(row.RowNumber, username, $"duplicate username '{username}' (already exists in this exercise or earlier in the file)."));
                continue;
            }

            _dbContext.Accounts.Add(new Account
            {
                Id = Guid.NewGuid(),
                ExerciseId = scope,
                Username = username,
                DisplayName = displayName,
                Role = role,
                CredentialHash = password is null ? null : _passwordHasher.Hash(password),
                CreatedAt = now,
            });

            createdCount++;
            rowResults.Add(new AccountImportRowResultDto
            {
                RowNumber = row.RowNumber,
                Username = username,
                Status = CreatedStatus,
            });
        }

        // Commit all created accounts in one unit of work (the write-guard runs here against the valid scope).
        await _dbContext.SaveChangesAsync(cancellationToken);

        return ImportAccountsResult.Ok(new AccountImportResultDto
        {
            TotalRows = parsed.Rows.Count,
            CreatedCount = createdCount,
            FailedCount = parsed.Rows.Count - createdCount,
            Rows = rowResults,
        });
    }

    /// <summary>Builds a failed row outcome with the given (sanitized-where-possible) handle and reason.</summary>
    private static AccountImportRowResultDto Failed(int rowNumber, string username, string message) => new()
    {
        RowNumber = rowNumber,
        Username = username,
        Status = FailedStatus,
        Message = message,
    };

    /// <summary>
    /// Shared gate for both writes: requires a live staff session (else 401) and a resolved, live active exercise
    /// (else 400). Returns the resolved scope on success, or a ready-made failure the caller returns as-is.
    /// </summary>
    private async Task<ScopeAuthorization> AuthorizeAndResolveScopeAsync(CancellationToken cancellationToken)
    {
        var current = await _currentStaffSession.GetCurrentStaffSessionAsync(cancellationToken);
        if (current is null)
        {
            return ScopeAuthorization.Failed(CreateAccountResult.Unauthenticated());
        }

        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return ScopeAuthorization.Failed(CreateAccountResult.NoActiveExercise());
        }

        // R6: the active exercise must resolve to a real Exercise before any account row is stamped with it.
        var exerciseExists = await _dbContext.Exercises
            .AsNoTracking()
            .AnyAsync(e => e.Id == scope.Value, cancellationToken);

        if (!exerciseExists)
        {
            return ScopeAuthorization.Failed(CreateAccountResult.NoActiveExercise());
        }

        return ScopeAuthorization.Ok(scope.Value);
    }

    /// <summary>Internal carrier for the authorize-and-resolve-scope gate: either a scope or a terminal failure.</summary>
    private readonly struct ScopeAuthorization
    {
        private ScopeAuthorization(Guid exerciseId, CreateAccountResult? failure)
        {
            ExerciseId = exerciseId;
            Failure = failure;
        }

        public Guid ExerciseId { get; }

        public CreateAccountResult? Failure { get; }

        public static ScopeAuthorization Ok(Guid exerciseId) => new(exerciseId, null);

        public static ScopeAuthorization Failed(CreateAccountResult failure) => new(Guid.Empty, failure);
    }
}

/// <summary>The outcome kind of a <see cref="AccountProvisioningService.CreateAsync"/> call.</summary>
public enum CreateAccountOutcome
{
    /// <summary>The account was created — the endpoint returns 201 with the account projection.</summary>
    Created,

    /// <summary>The request failed validation — the endpoint returns 400.</summary>
    Invalid,

    /// <summary>A handle collision within the active exercise — the endpoint returns 409.</summary>
    Duplicate,

    /// <summary>No authenticated staff session — the endpoint returns 401 (fail closed).</summary>
    Unauthenticated,

    /// <summary>Authenticated but no active exercise is resolved — the endpoint returns 400.</summary>
    NoActiveExercise,
}

/// <summary>
/// The result of an individual-create attempt. <see cref="CreateAccountOutcome.Created"/> carries the account
/// projection; <see cref="CreateAccountOutcome.Invalid"/>/<see cref="CreateAccountOutcome.Duplicate"/> carry a
/// reason; the fail-closed outcomes carry neither.
/// </summary>
public sealed class CreateAccountResult
{
    private CreateAccountResult(CreateAccountOutcome outcome, AccountDto? account, string? error)
    {
        Outcome = outcome;
        Account = account;
        Error = error;
    }

    /// <summary>Which outcome occurred.</summary>
    public CreateAccountOutcome Outcome { get; }

    /// <summary>The created account — non-null only when <see cref="Outcome"/> is <see cref="CreateAccountOutcome.Created"/>.</summary>
    public AccountDto? Account { get; }

    /// <summary>The error message — non-null for <see cref="CreateAccountOutcome.Invalid"/> / <see cref="CreateAccountOutcome.Duplicate"/>.</summary>
    public string? Error { get; }

    /// <summary>A successful create.</summary>
    /// <param name="account">The created account projection.</param>
    /// <returns>A created result.</returns>
    public static CreateAccountResult Created(AccountDto account)
    {
        ArgumentNullException.ThrowIfNull(account);
        return new CreateAccountResult(CreateAccountOutcome.Created, account, null);
    }

    /// <summary>A validation failure.</summary>
    /// <param name="error">The human-readable reason.</param>
    /// <returns>An invalid result.</returns>
    public static CreateAccountResult Invalid(string error) => new(CreateAccountOutcome.Invalid, null, error);

    /// <summary>A duplicate-handle failure.</summary>
    /// <param name="error">The human-readable reason.</param>
    /// <returns>A duplicate result.</returns>
    public static CreateAccountResult Duplicate(string error) => new(CreateAccountOutcome.Duplicate, null, error);

    /// <summary>The fail-closed result for an unauthenticated caller.</summary>
    /// <returns>An unauthenticated result.</returns>
    public static CreateAccountResult Unauthenticated() => new(CreateAccountOutcome.Unauthenticated, null, null);

    /// <summary>The fail-closed result for an unresolved active exercise.</summary>
    /// <returns>A no-active-exercise result.</returns>
    public static CreateAccountResult NoActiveExercise() =>
        new(CreateAccountOutcome.NoActiveExercise, null, "no active exercise is selected for this staff session.");
}

/// <summary>The outcome kind of a <see cref="AccountProvisioningService.ImportAsync"/> call.</summary>
public enum ImportAccountsOutcome
{
    /// <summary>The CSV was processed — the endpoint returns 200 with the per-row summary (rows may still be individually failed).</summary>
    Ok,

    /// <summary>The CSV was malformed (bad/missing header, too many rows) — the endpoint returns 400.</summary>
    Malformed,

    /// <summary>No authenticated staff session — the endpoint returns 401 (fail closed).</summary>
    Unauthenticated,

    /// <summary>Authenticated but no active exercise is resolved — the endpoint returns 400.</summary>
    NoActiveExercise,
}

/// <summary>
/// The result of a bulk-import attempt. <see cref="ImportAccountsOutcome.Ok"/> carries the per-row summary;
/// <see cref="ImportAccountsOutcome.Malformed"/> carries a reason; the fail-closed outcomes carry neither.
/// </summary>
public sealed class ImportAccountsResult
{
    private ImportAccountsResult(ImportAccountsOutcome outcome, AccountImportResultDto? summary, string? error)
    {
        Outcome = outcome;
        Summary = summary;
        Error = error;
    }

    /// <summary>Which outcome occurred.</summary>
    public ImportAccountsOutcome Outcome { get; }

    /// <summary>The per-row summary — non-null only when <see cref="Outcome"/> is <see cref="ImportAccountsOutcome.Ok"/>.</summary>
    public AccountImportResultDto? Summary { get; }

    /// <summary>The error message — non-null only when <see cref="Outcome"/> is <see cref="ImportAccountsOutcome.Malformed"/>.</summary>
    public string? Error { get; }

    /// <summary>A processed import carrying the per-row summary.</summary>
    /// <param name="summary">The import summary.</param>
    /// <returns>An OK result.</returns>
    public static ImportAccountsResult Ok(AccountImportResultDto summary)
    {
        ArgumentNullException.ThrowIfNull(summary);
        return new ImportAccountsResult(ImportAccountsOutcome.Ok, summary, null);
    }

    /// <summary>A malformed-CSV failure.</summary>
    /// <param name="error">The human-readable reason.</param>
    /// <returns>A malformed result.</returns>
    public static ImportAccountsResult Malformed(string error) =>
        new(ImportAccountsOutcome.Malformed, null, error);

    /// <summary>Maps a shared authorization failure (<see cref="CreateAccountResult"/>) onto the import outcome space.</summary>
    /// <param name="failure">The authorization failure from the shared gate.</param>
    /// <returns>The equivalent import result.</returns>
    public static ImportAccountsResult From(CreateAccountResult failure)
    {
        ArgumentNullException.ThrowIfNull(failure);
        return failure.Outcome == CreateAccountOutcome.Unauthenticated
            ? new ImportAccountsResult(ImportAccountsOutcome.Unauthenticated, null, null)
            : new ImportAccountsResult(ImportAccountsOutcome.NoActiveExercise, null, failure.Error);
    }
}
