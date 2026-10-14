namespace Pulse.WebApi.Features.Identity.DayWord;

using System.Globalization;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.SharedAccess;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// The staff side of the day word (easy-login story 05, EL-9): read the status, set or generate a word for a date, and
/// clear a date. Behind <c>GET</c> / <c>PUT</c> / <c>DELETE /api/staff/day-word</c>, which the endpoint gates with
/// <c>EngineCockpitStaffAuthorizationFilter</c> + <see cref="RosterStaffRoleFilter"/> (EL-13). Scoped, matching the
/// <see cref="PulseDbContext"/> unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (always-Critical, COR-001).</b> The exercise comes ONLY from <see cref="IExerciseContext"/>; no request
/// carries an exercise id. <see cref="ExerciseDayWord"/> is <see cref="IExerciseScoped"/>, so every read and write here
/// runs under the central filter and write guard: A's staff can neither see, set nor clear B's word. The caller is
/// re-resolved here (staff session, assignment on the resolved exercise, controller or planner role) so the service
/// fails closed even if a route were ever mapped without the filters.
/// </para>
/// <para>
/// <b>The word is shown once and stored only hashed (NFR-009).</b> The normalised word is hashed with
/// <see cref="ISharedCredentialHasher"/>; the plaintext lives only in the one <see cref="DayWordSetResultDto"/> the set
/// returns. Nothing here logs, and no telemetry payload or error message can carry the word.
/// </para>
/// <para>
/// <b>"Today" is the real date in the exercise time zone</b> (<see cref="ExerciseDay"/>, rolling over at
/// <see cref="EasyLoginOptions.DayRolloverHour"/>), read from the injected <see cref="TimeProvider"/>. Scenario time is
/// never used for it; it appears only on the telemetry envelope (COR-053). One clock read per operation is shared by
/// the row and its event.
/// </para>
/// <para>
/// <b>Concurrent writes to one date serialize</b> (Copilot review on #486). <see cref="ExerciseDayWord.ReplacedCount"/>
/// is the row's optimistic-concurrency token, so a set or clear whose read went stale before its save is refused by the
/// database, re-reads, and re-applies the same caller's write on top of what committed (at most
/// <see cref="MaxWriteAttempts"/> tries). Every successful rotation counts, the word a set returns was the current word
/// when it committed, and a request never fails merely because another staff member wrote the same date at once.
/// </para>
/// </remarks>
public sealed class DayWordService
{
    /// <summary>How many days past today a word may be pre-set (today plus 14, inclusive).</summary>
    public const int MaxDaysAhead = 14;

    /// <summary>
    /// How many times one set or clear tries its write when another staff member's write to the same (exercise, date)
    /// row keeps committing between its read and its save: the first try plus two re-reads. Past it the request fails
    /// (the last lost-race exception propagates) rather than loop.
    /// </summary>
    public const int MaxWriteAttempts = 3;

    /// <summary>The wire format of a calendar date (<see cref="EasyLoginWire.DateFormat"/>).</summary>
    public const string DateFormat = EasyLoginWire.DateFormat;

    /// <summary>SQL Server: cannot insert a duplicate key row (unique index).</summary>
    private const int DuplicateKeyErrorNumber = 2601;

    /// <summary>SQL Server: violation of a unique constraint.</summary>
    private const int UniqueConstraintErrorNumber = 2627;

    /// <summary>The 400 reason for a date that is not <c>yyyy-MM-dd</c>.</summary>
    public const string DateFormatError = "The date must be written yyyy-MM-dd.";

    /// <summary>The 400 reason for a set in the past.</summary>
    public const string PastDateError = "A word cannot be set for a date in the past.";

    /// <summary>The 400 reason for a clear outside today to today plus <see cref="MaxDaysAhead"/>.</summary>
    public static readonly string ClearRangeError =
        $"The date must be today or up to {MaxDaysAhead.ToString(CultureInfo.InvariantCulture)} days ahead.";

    /// <summary>The 400 reason for a set past today plus <see cref="MaxDaysAhead"/>.</summary>
    public static readonly string FutureDateError =
        $"A word can be set at most {MaxDaysAhead.ToString(CultureInfo.InvariantCulture)} days ahead.";

    /// <summary>The 400 reason for a word whose normalised length is out of range. Never quotes the word.</summary>
    public static readonly string WordLengthError =
        $"The word must be {DayWordNormalizer.MinLength.ToString(CultureInfo.InvariantCulture)} to "
        + $"{DayWordNormalizer.MaxLength.ToString(CultureInfo.InvariantCulture)} letters and digits once capitals, "
        + "accents, spaces and punctuation are ignored.";

    /// <summary>The 400 reason for a raw word longer than <see cref="DayWordNormalizer.MaxRawLength"/>. Never quotes the word.</summary>
    public static readonly string WordTooLongError =
        $"The word must be at most {DayWordNormalizer.MaxRawLength.ToString(CultureInfo.InvariantCulture)} characters as typed.";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentStaffSessionAccessor _staffSession;
    private readonly ExerciseFactsReader _factsReader;
    private readonly ISharedCredentialHasher _hasher;
    private readonly IExerciseClock _exerciseClock;
    private readonly TimeProvider _timeProvider;
    private readonly EasyLoginOptions _options;
    private readonly ILogger<DayWordService> _logger;

    /// <summary>Creates the service over its collaborators.</summary>
    /// <param name="dbContext">The persistence context (rows and telemetry share one unit of work).</param>
    /// <param name="exerciseContext">The server-resolved exercise scope, the only source of the exercise.</param>
    /// <param name="staffSession">Identifies the authenticated staff caller (the acting human).</param>
    /// <param name="factsReader">The feature's one read of the exercise row (zone, tenant, scenario fallback).</param>
    /// <param name="hasher">The slow-KDF hasher the normalised word is stored under.</param>
    /// <param name="exerciseClock">The native exercise clock, for the telemetry scenario time.</param>
    /// <param name="timeProvider">The wall clock (a fake in tests).</param>
    /// <param name="options">The easy-login options (the day rollover hour).</param>
    /// <param name="logger">Logs the once-per-exercise time-zone fallback warning (never a word).</param>
    public DayWordService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ICurrentStaffSessionAccessor staffSession,
        ExerciseFactsReader factsReader,
        ISharedCredentialHasher hasher,
        IExerciseClock exerciseClock,
        TimeProvider timeProvider,
        IOptions<EasyLoginOptions> options,
        ILogger<DayWordService> logger)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(staffSession);
        ArgumentNullException.ThrowIfNull(factsReader);
        ArgumentNullException.ThrowIfNull(hasher);
        ArgumentNullException.ThrowIfNull(exerciseClock);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(logger);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _staffSession = staffSession;
        _factsReader = factsReader;
        _hasher = hasher;
        _exerciseClock = exerciseClock;
        _timeProvider = timeProvider;
        _options = options.Value;
        _logger = logger;
    }

    /// <summary>
    /// The day-word status for the resolved exercise: zone, today, when today ends, whether today's word is set (by
    /// whom, when, how many replacements) and the later dates that already have a word. Never a word or a hash.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns><see cref="DayWordOutcome.Ok"/> with <see cref="DayWordResult.Status"/>, or a fail-closed outcome.</returns>
    public async Task<DayWordResult> GetStatusAsync(CancellationToken cancellationToken = default)
    {
        var caller = await ResolveCallerAsync(cancellationToken);
        if (caller.Context is not { } context)
        {
            return DayWordResult.Refused(caller.Failure);
        }

        var now = _timeProvider.GetUtcNow();
        var rollover = _options.DayRolloverHour;
        var today = ExerciseDay.Today(context.Facts.TimeZone, now, rollover);

        // The central filter confines this to the resolved exercise; the explicit predicate keeps that visible. The
        // projection never selects WordHash.
        var rows = await _dbContext.ExerciseDayWords
            .AsNoTracking()
            .Where(row => row.ExerciseId == context.ExerciseId && row.ForDate >= today)
            .OrderBy(row => row.ForDate)
            .Select(row => new DayWordRow(row.ForDate, row.SetAt, row.SetByStaffUserId, row.ReplacedCount))
            .ToListAsync(cancellationToken);

        var todayRow = rows.FirstOrDefault(row => row.ForDate == today);

        string? setByName = null;
        if (todayRow is not null)
        {
            // Bounded by the exercise's own customer tenant (COR-010), never an unbounded staff read.
            setByName = await _dbContext.StaffUsers
                .AsNoTracking()
                .InOrganization(context.Facts.OrganizationId)
                .Where(user => user.Id == todayRow.SetByStaffUserId)
                .Select(user => user.DisplayName)
                .FirstOrDefaultAsync(cancellationToken);
        }

        var status = new DayWordStatusDto
        {
            TimeZone = EffectiveZone(context.Facts.TimeZone),
            Today = FormatDate(today),
            TodayEndsAt = FormatInstant(ExerciseDay.EndOfDayUtc(context.Facts.TimeZone, today, rollover)),
            TodaySet = todayRow is not null,
            SetAt = todayRow is null ? null : FormatInstant(todayRow.SetAt),
            SetByName = string.IsNullOrWhiteSpace(setByName) ? null : setByName,
            ReplacedCount = todayRow?.ReplacedCount ?? 0,
            Upcoming = rows
                .Where(row => row.ForDate > today)
                .Select(row => new DayWordUpcomingDto { Date = FormatDate(row.ForDate), SetAt = FormatInstant(row.SetAt) })
                .ToList(),
        };

        return DayWordResult.ForStatus(status);
    }

    /// <summary>
    /// Sets the word for a date (default today in the exercise zone; up to <see cref="MaxDaysAhead"/> days ahead; never
    /// the past). With no word the server generates one. A date that already has a word is replaced in place (a
    /// rotation, effective on the very next sign-in). Emits one <c>credential.rotated</c> event in the same unit of work.
    /// </summary>
    /// <param name="body">The request body (<c>{ word?, date? }</c>); <c>null</c> is treated as <c>{}</c>.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns><see cref="DayWordOutcome.Ok"/> with the one-time <see cref="DayWordResult.SetResult"/>, a 400 reason, or a fail-closed outcome.</returns>
    public async Task<DayWordResult> SetAsync(DayWordPutBody? body, CancellationToken cancellationToken = default)
    {
        var caller = await ResolveCallerAsync(cancellationToken);
        if (caller.Context is not { } context)
        {
            return DayWordResult.Refused(caller.Failure);
        }

        var now = _timeProvider.GetUtcNow();
        var rollover = _options.DayRolloverHour;
        var today = ExerciseDay.Today(context.Facts.TimeZone, now, rollover);

        // 1. The date: today by default, never the past, at most MaxDaysAhead ahead.
        DateOnly date;
        if (body?.Date is null)
        {
            date = today;
        }
        else if (!TryParseDate(body.Date, out date))
        {
            return DayWordResult.Invalid(DateFormatError);
        }

        if (date < today)
        {
            return DayWordResult.Invalid(PastDateError);
        }

        if (date > today.AddDays(MaxDaysAhead))
        {
            return DayWordResult.Invalid(FutureDateError);
        }

        // 2. The word: supplied (bounded raw, 6-64 normalised) or generated. Error texts never quote it.
        var generated = body?.Word is null;
        string word;
        if (body?.Word is { } supplied)
        {
            if (supplied.Length > DayWordNormalizer.MaxRawLength)
            {
                return DayWordResult.Invalid(WordTooLongError);
            }

            word = supplied.Trim();
        }
        else
        {
            word = DayWordGenerator.Generate();
        }

        var normalized = DayWordNormalizer.Normalize(word);
        if (!DayWordNormalizer.IsAcceptableLength(normalized))
        {
            return DayWordResult.Invalid(WordLengthError);
        }

        var hash = _hasher.Hash(normalized);

        // 3. One row per (exercise, date): replace in place when one exists (a rotation), else insert. Tracked read
        //    under the central filter, so it can only ever be this exercise's row.
        //
        //    Concurrent writes to one date SERIALIZE (Copilot review on #486): each request is applied on top of
        //    whatever committed before it, none is silently overwritten, and none fails merely because another staff
        //    member wrote the same date at the same moment. Our save can lose a race in two ways, retried alike:
        //      - another rotation (or a clear) committed between our read and our UPDATE. ReplacedCount is the row's
        //        concurrency token (PulseDbContext), so our UPDATE carries `AND ReplacedCount = <the count we read>`,
        //        matches no row, and EF raises DbUpdateConcurrencyException. (Without the token the UPDATE overwrote
        //        the other rotation and wrote OUR read count + 1 over theirs: last writer won and one increment, which
        //        the panel shows as "Replaced N times", was lost.)
        //      - Gate-1 W-3: another staff member's FIRST set committed between our read and our INSERT, so the
        //        (ExerciseId, ForDate) unique index refused ours.
        //    Either way: drop the refused write and its event, re-read the row as it now is under the central filter,
        //    and apply the SAME word on top of it: a rotation when a row exists, a first set when it was cleared in
        //    between. No 409: the caller asked for this word to be the date's word, and at our commit it is. Exactly
        //    one credential.rotated is written, with the save that commits. Bounded by MaxWriteAttempts: past it the
        //    last exception propagates (it names the table, index or key, never the word) rather than loop.
        var eventTime = EasyLoginEventTime.For(context.ExerciseId, context.Facts, _exerciseClock, now);
        bool replaced;
        for (var attempt = 1; ; attempt++)
        {
            var row = await FindRowAsync(context.ExerciseId, date, cancellationToken);

            replaced = row is not null;
            if (row is null)
            {
                row = new ExerciseDayWord
                {
                    Id = Guid.NewGuid(),
                    ExerciseId = context.ExerciseId,
                    ForDate = date,
                    WordHash = hash,
                    SetAt = now,
                    SetByStaffUserId = context.StaffUserId,
                    ReplacedCount = 0,
                };
                _dbContext.ExerciseDayWords.Add(row);
            }
            else
            {
                Replace(row, hash, now, context.StaffUserId);
            }

            _dbContext.TelemetryEvents.Add(SetEvent(context, row.Id, date, first: !replaced, generated, eventTime));

            try
            {
                await _dbContext.SaveChangesAsync(cancellationToken);
                break;
            }
            catch (DbUpdateException ex) when (attempt < MaxWriteAttempts && IsLostRace(ex, inserted: !replaced))
            {
                // Lost the race: forget the refused insert or update and its event, then go round and re-read.
                // Clearing the WHOLE tracker relies on nothing else being tracked in this request scope (every earlier
                // read, here and in the route filters, is AsNoTracking); a tracked write added before this loop would
                // be silently dropped.
                _dbContext.ChangeTracker.Clear();
            }
        }

        return DayWordResult.ForSet(new DayWordSetResultDto
        {
            Date = FormatDate(date),
            Word = word,
            Generated = generated,
            Replaced = replaced,
            SetAt = FormatInstant(now),
            ValidUntil = FormatInstant(ExerciseDay.EndOfDayUtc(context.Facts.TimeZone, date, rollover)),
        });
    }

    /// <summary>
    /// Clears the word for a date (default today), closing word sign-in for it until a new word is set. Idempotent: a
    /// date with no word is still a success, and emits nothing. A removed row emits one <c>credential.revoked</c> event
    /// in the same unit of work.
    /// </summary>
    /// <param name="rawDate">The <c>date</c> query value (<c>yyyy-MM-dd</c>), or <c>null</c> for today.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns><see cref="DayWordOutcome.Ok"/> (204), a 400 reason, or a fail-closed outcome.</returns>
    public async Task<DayWordResult> ClearAsync(string? rawDate, CancellationToken cancellationToken = default)
    {
        var caller = await ResolveCallerAsync(cancellationToken);
        if (caller.Context is not { } context)
        {
            return DayWordResult.Refused(caller.Failure);
        }

        var now = _timeProvider.GetUtcNow();
        var today = ExerciseDay.Today(context.Facts.TimeZone, now, _options.DayRolloverHour);

        DateOnly date;
        if (rawDate is null)
        {
            date = today;
        }
        else if (!TryParseDate(rawDate, out date))
        {
            return DayWordResult.Invalid(DateFormatError);
        }

        if (date < today || date > today.AddDays(MaxDaysAhead))
        {
            return DayWordResult.Invalid(ClearRangeError);
        }

        // Concurrent writes to one date serialize here too (Copilot review on #486). Our DELETE carries the
        // ReplacedCount concurrency token, so it matches no row when, between our read and our save, another staff
        // member rotated the word (the count moved) or cleared it (the row is gone), and EF raises
        // DbUpdateConcurrencyException. Neither is a 500: drop the refused delete and its event, re-read, and apply
        // the clear again on top of what committed. A word rotated meanwhile is cleared too (the clear is the later
        // request, and the staff member closing the word path must not be left with a word still open that they never
        // saw); a row another clear already removed is the idempotent no-op (that clear wrote the one
        // credential.revoked; this one writes none). Bounded by MaxWriteAttempts, exactly as a set.
        var eventTime = EasyLoginEventTime.For(context.ExerciseId, context.Facts, _exerciseClock, now);
        for (var attempt = 1; ; attempt++)
        {
            var row = await FindRowAsync(context.ExerciseId, date, cancellationToken);
            if (row is null)
            {
                return DayWordResult.Cleared();
            }

            _dbContext.ExerciseDayWords.Remove(row);
            _dbContext.TelemetryEvents.Add(EasyLoginTelemetry.DayWordCleared(context.ExerciseId, context.Actor, row.Id, date, eventTime));

            try
            {
                await _dbContext.SaveChangesAsync(cancellationToken);
                return DayWordResult.Cleared();
            }
            catch (DbUpdateConcurrencyException) when (attempt < MaxWriteAttempts)
            {
                // Lost the race: forget the refused delete and its event, then go round and re-read.
                // Clearing the WHOLE tracker relies on nothing else being tracked in this request scope (every earlier
                // read, here and in the route filters, is AsNoTracking); a tracked write added before this loop would
                // be silently dropped.
                _dbContext.ChangeTracker.Clear();
            }
        }
    }

    /// <summary>Parses a strict <c>yyyy-MM-dd</c> calendar date.</summary>
    /// <param name="raw">The raw value.</param>
    /// <param name="date">The parsed date.</param>
    /// <returns><c>true</c> when <paramref name="raw"/> is a real date in that exact form.</returns>
    public static bool TryParseDate(string? raw, out DateOnly date) =>
        DateOnly.TryParseExact(raw, DateFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out date);

    /// <summary>Whether a save failed on a unique index (SQL Server 2601 duplicate key, 2627 unique constraint).</summary>
    private static bool IsUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is SqlException { Number: DuplicateKeyErrorNumber or UniqueConstraintErrorNumber };

    /// <summary>
    /// Whether a set's save lost a race to another writer of the same (exercise, date) row: our INSERT lost to another
    /// first set on the unique index (<paramref name="inserted"/>), or our UPDATE matched no row because a rotation or a
    /// clear committed since our read (<see cref="DbUpdateConcurrencyException"/>, raised on the
    /// <see cref="ExerciseDayWord.ReplacedCount"/> concurrency token). Anything else is not a race and is not retried.
    /// </summary>
    private static bool IsLostRace(DbUpdateException exception, bool inserted) =>
        inserted ? IsUniqueViolation(exception) : exception is DbUpdateConcurrencyException;

    /// <summary>Rotates <paramref name="row"/> in place to the new hash (ReplacedCount + 1).</summary>
    private static void Replace(ExerciseDayWord row, string hash, DateTimeOffset now, Guid staffUserId)
    {
        row.WordHash = hash;
        row.SetAt = now;
        row.SetByStaffUserId = staffUserId;
        row.ReplacedCount++;
    }

    private static TelemetryEvent SetEvent(
        StaffDayWordContext context,
        Guid rowId,
        DateOnly date,
        bool first,
        bool generated,
        EasyLoginEventTime time) =>
        EasyLoginTelemetry.DayWordSet(context.ExerciseId, context.Actor, rowId, date, first, generated, time);

    /// <summary>This exercise's row for <paramref name="date"/>, tracked, under the central filter.</summary>
    private Task<ExerciseDayWord?> FindRowAsync(Guid exerciseId, DateOnly date, CancellationToken cancellationToken) =>
        _dbContext.ExerciseDayWords
            .FirstOrDefaultAsync(r => r.ExerciseId == exerciseId && r.ForDate == date, cancellationToken);

    /// <summary>The zone the day maths actually used: the stored id when it resolves, else <c>UTC</c>.</summary>
    private static string EffectiveZone(string? timeZone) =>
        ExerciseDay.TryResolveTimeZone(timeZone, out _) ? timeZone!.Trim() : ExerciseDay.UtcZoneId;

    private static string FormatDate(DateOnly date) => EasyLoginWire.Date(date);

    private static string FormatInstant(DateTimeOffset instant) => EasyLoginWire.Instant(instant);

    /// <summary>
    /// Re-resolves the caller, failing closed in the same order as the route filters: no staff session or no resolved
    /// scope is <see cref="DayWordOutcome.Unauthorized"/>; no assignment on the resolved exercise, or a role other than
    /// controller or planner, is <see cref="DayWordOutcome.Forbidden"/>; a scope with no exercise row is
    /// <see cref="DayWordOutcome.Unauthorized"/>.
    /// </summary>
    private async Task<CallerResolution> ResolveCallerAsync(CancellationToken cancellationToken)
    {
        var current = await _staffSession.GetCurrentStaffSessionAsync(cancellationToken);
        if (current is null)
        {
            return new CallerResolution(DayWordOutcome.Unauthorized, null);
        }

        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is not { } exerciseId || exerciseId == Guid.Empty)
        {
            return new CallerResolution(DayWordOutcome.Unauthorized, null);
        }

        // StaffAssignment is deliberately unscoped (a staff human spans exercises), so the exercise predicate is
        // explicit: the caller's OWN assignment on the RESOLVED exercise, never one named by the request.
        var role = await _dbContext.StaffAssignments
            .AsNoTracking()
            .Where(assignment => assignment.StaffUserId == current.StaffUserId && assignment.ExerciseId == exerciseId)
            .Select(assignment => assignment.Role)
            .FirstOrDefaultAsync(cancellationToken);

        if (!RosterStaffRoleFilter.IsAdmittedRole(role))
        {
            return new CallerResolution(DayWordOutcome.Forbidden, null);
        }

        var facts = await _factsReader.GetAsync(exerciseId, cancellationToken);
        if (facts is null)
        {
            return new CallerResolution(DayWordOutcome.Unauthorized, null);
        }

        // An unknown zone falls back to UTC for "today" (logged once per exercise: exercise id and zone id only).
        DayWordTimeZoneWarning.WarnIfFallback(_logger, exerciseId, facts.TimeZone);

        return new CallerResolution(
            DayWordOutcome.Ok,
            new StaffDayWordContext(exerciseId, current.StaffUserId, new EasyLoginStaffActor(current.StaffUserId, role), facts));
    }

    private sealed record DayWordRow(DateOnly ForDate, DateTimeOffset SetAt, Guid SetByStaffUserId, int ReplacedCount);

    private sealed record StaffDayWordContext(Guid ExerciseId, Guid StaffUserId, EasyLoginStaffActor Actor, ExerciseFacts Facts);

    private sealed record CallerResolution(DayWordOutcome Failure, StaffDayWordContext? Context);
}

/// <summary>The outcome of a <see cref="DayWordService"/> call, mapped to a status by the endpoint.</summary>
public enum DayWordOutcome
{
    /// <summary>Success: 200 with a body (status, set) or 204 (clear).</summary>
    Ok,

    /// <summary>A bad date or word: 400 ProblemDetails with a readable reason (never the word).</summary>
    Invalid,

    /// <summary>No staff session, no resolved scope, or no exercise row: 401 (fail closed).</summary>
    Unauthorized,

    /// <summary>A staff user not assigned to the resolved exercise, or not a controller or planner there: 403.</summary>
    Forbidden,
}

/// <summary>The result of a <see cref="DayWordService"/> call.</summary>
public sealed class DayWordResult
{
    private DayWordResult(DayWordOutcome outcome, DayWordStatusDto? status, DayWordSetResultDto? setResult, string? error)
    {
        Outcome = outcome;
        Status = status;
        SetResult = setResult;
        Error = error;
    }

    /// <summary>Which outcome occurred.</summary>
    public DayWordOutcome Outcome { get; }

    /// <summary>The status body (a successful <see cref="DayWordService.GetStatusAsync"/> only).</summary>
    public DayWordStatusDto? Status { get; }

    /// <summary>The one-time set body, carrying the plaintext word (a successful <see cref="DayWordService.SetAsync"/> only).</summary>
    public DayWordSetResultDto? SetResult { get; }

    /// <summary>The readable 400 reason (<see cref="DayWordOutcome.Invalid"/> only). Never contains the word.</summary>
    public string? Error { get; }

    /// <summary>A successful status read.</summary>
    /// <param name="status">The status body.</param>
    /// <returns>An ok result.</returns>
    public static DayWordResult ForStatus(DayWordStatusDto status)
    {
        ArgumentNullException.ThrowIfNull(status);
        return new DayWordResult(DayWordOutcome.Ok, status, null, null);
    }

    /// <summary>A successful set.</summary>
    /// <param name="setResult">The one-time set body.</param>
    /// <returns>An ok result.</returns>
    public static DayWordResult ForSet(DayWordSetResultDto setResult)
    {
        ArgumentNullException.ThrowIfNull(setResult);
        return new DayWordResult(DayWordOutcome.Ok, null, setResult, null);
    }

    /// <summary>A successful (possibly no-op) clear.</summary>
    /// <returns>An ok result with no body.</returns>
    public static DayWordResult Cleared() => new(DayWordOutcome.Ok, null, null, null);

    /// <summary>A refused request (400).</summary>
    /// <param name="error">The readable reason; never the word.</param>
    /// <returns>An invalid result.</returns>
    public static DayWordResult Invalid(string error)
    {
        ArgumentException.ThrowIfNullOrEmpty(error);
        return new DayWordResult(DayWordOutcome.Invalid, null, null, error);
    }

    /// <summary>A fail-closed refusal (401 or 403).</summary>
    /// <param name="outcome"><see cref="DayWordOutcome.Unauthorized"/> or <see cref="DayWordOutcome.Forbidden"/>; anything else collapses to unauthorized.</param>
    /// <returns>A refused result.</returns>
    public static DayWordResult Refused(DayWordOutcome outcome) =>
        new(outcome == DayWordOutcome.Forbidden ? DayWordOutcome.Forbidden : DayWordOutcome.Unauthorized, null, null, null);
}
