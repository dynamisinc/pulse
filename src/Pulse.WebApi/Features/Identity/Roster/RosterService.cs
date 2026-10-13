namespace Pulse.WebApi.Features.Identity.Roster;

using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// The staff-only roster writes (story 02, COR-011, COR-018): <c>POST /api/staff/roster/import</c> (a CSV, per row,
/// with a dry run) and <c>POST /api/staff/roster</c> (one participant). Both judge every row with ONE
/// <see cref="RosterWorkspace"/>, so a dry run and a real run, and an import row and a single add, cannot diverge.
/// Scoped lifetime, matching the <see cref="PulseDbContext"/> unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (always-Critical).</b> The exercise comes ONLY from <see cref="IExerciseContext"/>; no request field
/// names it. Every account, persona and link written is stamped with that scope, and every read (accounts, personas)
/// runs through the central exercise filter, so a staff caller of exercise A can neither see, match, update nor bind
/// anything in B: B's persona handle is "unknown", B's people are absent.
/// </para>
/// <para>
/// <b>One unit of work.</b> A real run stages every created account and auto persona, every update, each new link
/// (through <see cref="IParticipantLinkIssuer"/>, which stages on this same context) and the telemetry, then saves
/// ONCE. A failed row writes nothing. A dry run builds the same report from the same workspace and never stages
/// anything (it reads untracked), so it cannot write an account, persona, link or event.
/// </para>
/// <para>
/// <b>Telemetry (XC-004).</b> A real import that writes something emits one <c>roster.imported</c> event (the four
/// counts only); an import that writes nothing (every row unchanged or failed, so re-uploading the same file) emits
/// none, which is what makes a re-upload a true no-op (EL-3). Every link the issuer returns for a new participant
/// emits <c>participant.link.issued</c>. The actor is the staff user and their role on this exercise; no name, email
/// or token reaches any payload. A single add emits only its link event.
/// </para>
/// <para>
/// <b>Races.</b> Names are de-duplicated in memory first (case-insensitively, as the database's unique indexes
/// compare), so a unique-index violation means another request claimed the same sign-in name or handle in between. The
/// whole request is then re-judged once against fresh state; if it collides again, nothing is written and the rows
/// that would have written are reported failed (a 409 for a single add), never a 500.
/// </para>
/// </remarks>
public sealed class RosterService
{
    /// <summary>The 409 reason when a single add matches someone already on the roster.</summary>
    public const string AlreadyOnRosterMessage = "That person is already on the roster.";

    /// <summary>The reason a row is reported failed when a concurrent change collided twice.</summary>
    public const string ConcurrentChangeMessage =
        "another change took the same sign-in name or persona handle while this was being saved; nothing was written. Try again.";

    private const int MaxAttempts = 2;
    private const int DuplicateKeyErrorNumber = 2601;
    private const int UniqueConstraintErrorNumber = 2627;

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentStaffSessionAccessor _currentStaffSession;
    private readonly ExerciseFactsReader _exerciseFacts;
    private readonly IParticipantLinkIssuer _linkIssuer;
    private readonly RosterLinkDtoFactory _linkDtoFactory;
    private readonly TimeProvider _timeProvider;
    private readonly IExerciseClock? _exerciseClock;

    /// <summary>Creates the service.</summary>
    /// <param name="dbContext">The request's persistence context (central exercise filter and write guard).</param>
    /// <param name="exerciseContext">The server-resolved exercise scope.</param>
    /// <param name="currentStaffSession">The authenticated staff caller (the telemetry actor).</param>
    /// <param name="exerciseFacts">The feature's one exercise read (EL-17), for the telemetry envelope.</param>
    /// <param name="linkIssuer">Gives each new participant a link (story 03's issuer; story 01's null default issues none).</param>
    /// <param name="linkDtoFactory">Projects a new participant's link state.</param>
    /// <param name="timeProvider">The server clock, read once per operation.</param>
    /// <param name="exerciseClock">The native exercise clock for scenario time, when the host has one.</param>
    public RosterService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ICurrentStaffSessionAccessor currentStaffSession,
        ExerciseFactsReader exerciseFacts,
        IParticipantLinkIssuer linkIssuer,
        RosterLinkDtoFactory linkDtoFactory,
        TimeProvider timeProvider,
        IExerciseClock? exerciseClock = null)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(currentStaffSession);
        ArgumentNullException.ThrowIfNull(exerciseFacts);
        ArgumentNullException.ThrowIfNull(linkIssuer);
        ArgumentNullException.ThrowIfNull(linkDtoFactory);
        ArgumentNullException.ThrowIfNull(timeProvider);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _currentStaffSession = currentStaffSession;
        _exerciseFacts = exerciseFacts;
        _linkIssuer = linkIssuer;
        _linkDtoFactory = linkDtoFactory;
        _timeProvider = timeProvider;
        _exerciseClock = exerciseClock;
    }

    /// <summary>
    /// Imports a roster CSV into the caller's exercise: per row, partial apply, one save; or, with
    /// <paramref name="dryRun"/>, the same report and no write at all.
    /// </summary>
    /// <param name="csvContent">The decoded file text (size and type already checked by the endpoint).</param>
    /// <param name="dryRun">Whether to report only.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The report, or why the request was refused.</returns>
    public async Task<RosterImportResult> ImportAsync(string csvContent, bool dryRun, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(csvContent);

        var (caller, refusal) = await ResolveCallerAsync(cancellationToken);
        if (caller is null)
        {
            return RosterImportResult.Refused(refusal);
        }

        var parsed = RosterCsvParser.Parse(csvContent);
        if (!parsed.IsValid)
        {
            return RosterImportResult.Invalid(parsed.Error!);
        }

        for (var attempt = 1; ; attempt++)
        {
            var (workspace, accountsById) = await LoadWorkspaceAsync(track: !dryRun, cancellationToken);

            var inputs = parsed.Rows.Select(r => (r.RowNumber, Row: RosterRowRules.Normalize(r.Fields))).ToList();
            var outcomes = workspace.ApplyFile(inputs);
            var rows = inputs.Select((input, i) => ToReportRow(input.RowNumber, input.Row, outcomes[i])).ToList();

            var report = BuildReport(dryRun, rows);
            if (dryRun || (workspace.Created.Count == 0 && workspace.Updated.Count == 0))
            {
                return RosterImportResult.Ok(report);
            }

            var now = _timeProvider.GetUtcNow();
            var time = EasyLoginEventTime.For(caller.ExerciseId, caller.Facts, _exerciseClock, now);

            await StageAsync(caller, workspace, accountsById, now, time, cancellationToken);
            _dbContext.TelemetryEvents.Add(EasyLoginTelemetry.RosterImported(
                caller.ExerciseId,
                caller.Staff,
                report.CreatedCount,
                report.UpdatedCount,
                report.UnchangedCount,
                report.FailedCount,
                time));

            try
            {
                await _dbContext.SaveChangesAsync(cancellationToken);
                return RosterImportResult.Ok(report);
            }
            catch (DbUpdateException exception) when (IsUniqueViolation(exception))
            {
                _dbContext.ChangeTracker.Clear();
                if (attempt >= MaxAttempts)
                {
                    return RosterImportResult.Ok(FailWrites(report));
                }
            }
        }
    }

    /// <summary>Adds one participant to the caller's exercise, by exactly the rules an import row follows.</summary>
    /// <param name="request">The row.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The new roster entry, or why it was refused (400 invalid, 409 already on the roster or a clash).</returns>
    public async Task<RosterAddResult> AddAsync(RosterRowWrite request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var (caller, refusal) = await ResolveCallerAsync(cancellationToken);
        if (caller is null)
        {
            return RosterAddResult.Refused(refusal);
        }

        var input = RosterRowRules.Normalize(request);

        for (var attempt = 1; ; attempt++)
        {
            var (workspace, accountsById) = await LoadWorkspaceAsync(track: false, cancellationToken);

            var outcome = workspace.Apply(input);
            if (outcome.Failure == RosterRowFailure.Invalid)
            {
                return RosterAddResult.Invalid(outcome.Message!);
            }

            if (outcome.Failure == RosterRowFailure.Conflict)
            {
                return RosterAddResult.Conflict(outcome.Message!);
            }

            if (outcome.Status != RosterRowStatuses.Created)
            {
                return RosterAddResult.Conflict(AlreadyOnRosterMessage);
            }

            var now = _timeProvider.GetUtcNow();
            var time = EasyLoginEventTime.For(caller.ExerciseId, caller.Facts, _exerciseClock, now);
            var created = await StageAsync(caller, workspace, accountsById, now, time, cancellationToken);

            try
            {
                await _dbContext.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException exception) when (IsUniqueViolation(exception))
            {
                _dbContext.ChangeTracker.Clear();
                if (attempt >= MaxAttempts)
                {
                    return RosterAddResult.Conflict(ConcurrentChangeMessage);
                }

                continue;
            }

            var (account, persona, link) = created[0];
            return RosterAddResult.Created(RosterEntryProjection.Create(account, persona, _linkDtoFactory.Create(link), liveSessions: 0));
        }
    }

    /// <summary>
    /// Resolves the staff caller, their role on the resolved exercise and that exercise's facts, failing closed: no
    /// staff session or no resolved scope is 401, a role other than controller or planner is 403 (defense in depth
    /// behind <see cref="RosterStaffRoleFilter"/>), and a scope with no exercise row is 401.
    /// </summary>
    private async Task<(RosterCaller? Caller, RosterOutcome Refusal)> ResolveCallerAsync(CancellationToken cancellationToken)
    {
        var current = await _currentStaffSession.GetCurrentStaffSessionAsync(cancellationToken);
        var scope = _exerciseContext.CurrentExerciseId;
        if (current is null || scope is null || scope.Value == Guid.Empty)
        {
            return (null, RosterOutcome.Unauthenticated);
        }

        var exerciseId = scope.Value;

        // StaffAssignment is unscoped by design (a staff human spans exercises): the explicit predicate on BOTH the
        // caller's own staff user id and the resolved exercise is what confines this read.
        var role = await _dbContext.StaffAssignments
            .AsNoTracking()
            .Where(a => a.StaffUserId == current.StaffUserId && a.ExerciseId == exerciseId)
            .Select(a => a.Role)
            .FirstOrDefaultAsync(cancellationToken);

        if (!RosterStaffRoleFilter.IsAdmittedRole(role))
        {
            return (null, RosterOutcome.Forbidden);
        }

        var facts = await _exerciseFacts.GetAsync(exerciseId, cancellationToken);
        if (facts is null)
        {
            return (null, RosterOutcome.Unauthenticated);
        }

        return (new RosterCaller(exerciseId, new EasyLoginStaffActor(current.StaffUserId, role), facts), RosterOutcome.Ok);
    }

    /// <summary>
    /// Builds the workspace from the exercise's accounts and personas, both read through the central filter. Accounts
    /// are tracked only when the caller may update them (never for a dry run).
    /// </summary>
    private async Task<(RosterWorkspace Workspace, Dictionary<Guid, Account> AccountsById)> LoadWorkspaceAsync(
        bool track,
        CancellationToken cancellationToken)
    {
        var accountQuery = track ? _dbContext.Accounts : _dbContext.Accounts.AsNoTracking();
        var accounts = await accountQuery
            .OrderBy(a => a.CreatedAt)
            .ThenBy(a => a.Id)
            .ToListAsync(cancellationToken);

        var personas = await _dbContext.Personas
            .AsNoTracking()
            .Select(p => new RosterPersonaRef(p.Id, p.Handle, p.DisplayName, p.Kind))
            .ToListAsync(cancellationToken);

        var personasById = personas.ToDictionary(p => p.Id);
        var participants = new List<RosterParticipant>(accounts.Count);
        var otherSignInNames = new List<string>();

        foreach (var account in accounts)
        {
            if (!RosterRoles.IsRosterRole(account.Role))
            {
                otherSignInNames.Add(account.Username);
                continue;
            }

            participants.Add(new RosterParticipant
            {
                Id = account.Id,
                SignInName = account.Username,
                Name = account.DisplayName,
                Agency = account.Agency,
                JobRole = account.JobRole,
                Email = account.Email,
                ExerciseRole = string.Equals(account.Role, RosterRoles.Pio, StringComparison.OrdinalIgnoreCase)
                    ? RosterRoles.Pio
                    : RosterRoles.Participant,
                Persona = account.PersonaId is { } personaId ? personasById.GetValueOrDefault(personaId) : null,
                PersonaAutoCreated = account.PersonaAutoCreated,

                // A dangling id and another exercise's persona look the same here: neither is in this exercise's set.
                HadUnresolvedPersona = account.PersonaId is { } storedId && !personasById.ContainsKey(storedId),
            });
        }

        return (new RosterWorkspace(participants, otherSignInNames, personas), accounts.ToDictionary(a => a.Id));
    }

    /// <summary>
    /// Stages what the workspace decided on the request's context, stamping every new row with the resolved scope:
    /// each created account (no credential) with its auto persona, a link per new account from the issuer (and its
    /// <c>participant.link.issued</c> event), and each updated account's final state, with the auto persona a
    /// persona-less participant was given. Does not save.
    /// </summary>
    private async Task<List<(Account Account, RosterPersonaRef? Persona, ParticipantLink? Link)>> StageAsync(
        RosterCaller caller,
        RosterWorkspace workspace,
        Dictionary<Guid, Account> accountsById,
        DateTimeOffset now,
        EasyLoginEventTime time,
        CancellationToken cancellationToken)
    {
        var created = new List<(Account, RosterPersonaRef?, ParticipantLink?)>(workspace.Created.Count);

        foreach (var participant in workspace.Created)
        {
            AddCreatedPersona(caller, participant);

            var account = new Account
            {
                Id = participant.Id,
                ExerciseId = caller.ExerciseId,
                Username = participant.SignInName,
                DisplayName = participant.Name,
                Role = participant.ExerciseRole,
                Agency = participant.Agency,
                JobRole = participant.JobRole,
                Email = participant.Email,
                CredentialHash = null,
                CreatedAt = now,
                PersonaId = participant.Persona?.Id,
                PersonaAutoCreated = participant.PersonaAutoCreated,
            };
            _dbContext.Accounts.Add(account);

            // The staff caller who provisioned the participant is recorded as the issuer. A link the issuer staged as
            // Added is a new one (the seam's contract); only that emits participant.link.issued.
            var link = await _linkIssuer.EnsureActiveAsync(account, caller.Staff.StaffUserId, now, cancellationToken);
            if (link is not null && _dbContext.Entry(link).State == EntityState.Added)
            {
                _dbContext.TelemetryEvents.Add(EasyLoginTelemetry.LinkIssued(caller.ExerciseId, caller.Staff, link.Id, account.Id, time));
            }

            created.Add((account, participant.Persona, link));
        }

        foreach (var participant in workspace.Updated)
        {
            // A matched participant who had no persona gets one (implementation.md, amended f07c1ea). Account.PersonaId has
            // no foreign key, so the persona row must be inserted here or the id would dangle. No link is issued for them.
            AddCreatedPersona(caller, participant);

            var account = accountsById[participant.Id];
            account.DisplayName = participant.Name;
            account.Agency = participant.Agency;
            account.JobRole = participant.JobRole;
            account.Email = participant.Email;
            account.Role = participant.ExerciseRole;
            account.PersonaAutoCreated = participant.PersonaAutoCreated;

            // A row only ever binds a persona, never clears one (a blank personaHandle keeps the current persona).
            if (participant.Persona is { } persona)
            {
                account.PersonaId = persona.Id;
            }
        }

        return created;
    }

    /// <summary>Inserts the auto citizen persona this request created for <paramref name="participant"/>, if it created one.</summary>
    private void AddCreatedPersona(RosterCaller caller, RosterParticipant participant)
    {
        if (participant.PersonaCreated && participant.Persona is { } persona)
        {
            _dbContext.Personas.Add(CitizenPersonaFactory.Create(persona.Id, caller.ExerciseId, participant.Name, persona.Handle));
        }
    }

    private static RosterImportRowDto ToReportRow(int rowNumber, RosterRowInput input, RosterRowOutcome outcome)
    {
        if (outcome.Participant is not { } participant)
        {
            return new RosterImportRowDto
            {
                RowNumber = rowNumber,
                Name = input.Name,
                SignInName = input.SignInName.Length > 0 ? input.SignInName : null,
                Status = RosterRowStatuses.Failed,
                PersonaCreated = false,
                Message = outcome.Message,
            };
        }

        return new RosterImportRowDto
        {
            RowNumber = rowNumber,
            Name = participant.Name,
            SignInName = participant.SignInName,
            Status = outcome.Status,
            PersonaHandle = participant.Persona?.Handle,
            PersonaCreated = outcome.PersonaCreated,
            Message = outcome.Message,
        };
    }

    private static RosterImportResultDto BuildReport(bool dryRun, List<RosterImportRowDto> rows) => new()
    {
        DryRun = dryRun,
        TotalRows = rows.Count,
        CreatedCount = rows.Count(r => r.Status == RosterRowStatuses.Created),
        UpdatedCount = rows.Count(r => r.Status == RosterRowStatuses.Updated),
        UnchangedCount = rows.Count(r => r.Status == RosterRowStatuses.Unchanged),
        FailedCount = rows.Count(r => r.Status == RosterRowStatuses.Failed),
        Rows = rows,
    };

    /// <summary>The report after a second collision: every row that would have written is failed, because nothing was.</summary>
    private static RosterImportResultDto FailWrites(RosterImportResultDto report)
    {
        var rows = report.Rows
            .Select(row => row.Status is RosterRowStatuses.Created or RosterRowStatuses.Updated
                ? new RosterImportRowDto
                {
                    RowNumber = row.RowNumber,
                    Name = row.Name,
                    SignInName = row.SignInName,
                    Status = RosterRowStatuses.Failed,
                    PersonaCreated = false,
                    Message = ConcurrentChangeMessage,
                }
                : row)
            .ToList();

        return BuildReport(report.DryRun, rows);
    }

    private static bool IsUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is SqlException { Number: DuplicateKeyErrorNumber or UniqueConstraintErrorNumber };

    /// <summary>The resolved staff caller: the exercise, the telemetry actor and the exercise facts.</summary>
    private sealed record RosterCaller(Guid ExerciseId, EasyLoginStaffActor Staff, ExerciseFacts Facts);
}

/// <summary>How a roster request ended; the endpoint maps it to a status.</summary>
public enum RosterOutcome
{
    /// <summary>Done: 200 for an import, 201 for an add.</summary>
    Ok,

    /// <summary>A bad request (an unreadable file, an invalid field): 400.</summary>
    Invalid,

    /// <summary>The participant is already on the roster, or a key clashes: 409.</summary>
    Conflict,

    /// <summary>No staff session or no resolved exercise: 401 (fail closed).</summary>
    Unauthenticated,

    /// <summary>A staff caller without the controller or planner role here: 403.</summary>
    Forbidden,
}

/// <summary>The result of <see cref="RosterService.ImportAsync"/>.</summary>
public sealed class RosterImportResult
{
    private RosterImportResult(RosterOutcome outcome, RosterImportResultDto? report, string? error)
    {
        Outcome = outcome;
        Report = report;
        Error = error;
    }

    /// <summary>How the request ended.</summary>
    public RosterOutcome Outcome { get; }

    /// <summary>The per-row report when <see cref="Outcome"/> is <see cref="RosterOutcome.Ok"/>.</summary>
    public RosterImportResultDto? Report { get; }

    /// <summary>The readable reason when <see cref="Outcome"/> is <see cref="RosterOutcome.Invalid"/>.</summary>
    public string? Error { get; }

    /// <summary>A processed import (rows may still be individually failed).</summary>
    /// <param name="report">The report.</param>
    /// <returns>The result.</returns>
    public static RosterImportResult Ok(RosterImportResultDto report) => new(RosterOutcome.Ok, report, null);

    /// <summary>An unreadable file.</summary>
    /// <param name="error">The readable reason.</param>
    /// <returns>The result.</returns>
    public static RosterImportResult Invalid(string error) => new(RosterOutcome.Invalid, null, error);

    /// <summary>A refused caller.</summary>
    /// <param name="refusal"><see cref="RosterOutcome.Unauthenticated"/> or <see cref="RosterOutcome.Forbidden"/>.</param>
    /// <returns>The result.</returns>
    public static RosterImportResult Refused(RosterOutcome refusal) => new(refusal, null, null);
}

/// <summary>The result of <see cref="RosterService.AddAsync"/>.</summary>
public sealed class RosterAddResult
{
    private RosterAddResult(RosterOutcome outcome, RosterEntryDto? entry, string? error)
    {
        Outcome = outcome;
        Entry = entry;
        Error = error;
    }

    /// <summary>How the request ended.</summary>
    public RosterOutcome Outcome { get; }

    /// <summary>The new participant when <see cref="Outcome"/> is <see cref="RosterOutcome.Ok"/>.</summary>
    public RosterEntryDto? Entry { get; }

    /// <summary>The readable reason for a 400 or 409.</summary>
    public string? Error { get; }

    /// <summary>A created participant.</summary>
    /// <param name="entry">The roster entry.</param>
    /// <returns>The result.</returns>
    public static RosterAddResult Created(RosterEntryDto entry) => new(RosterOutcome.Ok, entry, null);

    /// <summary>An invalid field.</summary>
    /// <param name="error">The readable reason.</param>
    /// <returns>The result.</returns>
    public static RosterAddResult Invalid(string error) => new(RosterOutcome.Invalid, null, error);

    /// <summary>Already on the roster, or a key clash.</summary>
    /// <param name="error">The readable reason.</param>
    /// <returns>The result.</returns>
    public static RosterAddResult Conflict(string error) => new(RosterOutcome.Conflict, null, error);

    /// <summary>A refused caller.</summary>
    /// <param name="refusal"><see cref="RosterOutcome.Unauthenticated"/> or <see cref="RosterOutcome.Forbidden"/>.</param>
    /// <returns>The result.</returns>
    public static RosterAddResult Refused(RosterOutcome refusal) => new(refusal, null, null);
}
