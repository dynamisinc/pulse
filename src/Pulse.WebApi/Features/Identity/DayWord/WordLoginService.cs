namespace Pulse.WebApi.Features.Identity.DayWord;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Features.Identity.Accounts;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.SharedAccess;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// The anonymous "sign-in name plus today's word" funnel behind <c>POST /api/auth/word</c> (easy-login story 05,
/// EL-9). On success it mints exactly the session <c>POST /api/auth/login</c> mints (through
/// <see cref="ParticipantSessionRequests"/>), so the body is the same <c>ParticipantLoginResponseDto</c> envelope.
/// Every other outcome collapses to ONE indistinguishable refusal. Scoped, matching the <see cref="PulseDbContext"/>
/// unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>Word first, then name (EL-9).</b> The word is verified BEFORE the sign-in name is looked up, so a guesser needs
/// both at once and learns nothing from either alone. Exactly ONE word verification runs on every path: against
/// today's stored hash when one exists, otherwise <see cref="ISharedCredentialHasher.VerifyDecoy"/> (no word set, an
/// unresolved host, a word that cannot be valid). The name is then looked up on EVERY resolved-exercise path, whatever
/// the word's result (Gate-1 W-1), so a right word with a wrong name runs exactly the statements a wrong word does and
/// nothing in the request's work reveals that the word was right. There is deliberately NO failed-attempt lockout: one
/// script could otherwise lock every participant out at StartEx. Only the per-IP limiter on the route applies.
/// </para>
/// <para>
/// <b>The redaction check (story 01 Gate-1 fold).</b> Every refusal then runs exactly ONE more slow-KDF call: the
/// normalised attempted NAME against today's hash (the decoy when there is none, or when the name cannot be a word), so
/// a day word typed into the name box is recognised and kept out of the failure event. Every refusal therefore costs
/// the same two KDF calls whatever the reason, so the response time still does not separate "no word today" from
/// "wrong word" from "unknown name" from "disabled account"; only a success (one call) is quicker, and a success is not
/// a secret. The limiter bounds the extra cost.
/// </para>
/// <para>
/// <b>Isolation (always-Critical, COR-001).</b> The exercise comes ONLY from <see cref="IExerciseContext"/>, which the
/// host resolved for this pre-auth request. <see cref="ExerciseDayWord"/> and <see cref="Account"/> are both
/// <see cref="IExerciseScoped"/>, so exercise B's word and B's accounts are invisible on A's host: B's word never opens
/// A, and a B name with A's word is the uniform refusal.
/// </para>
/// <para>
/// <b>"Today"</b> is the real date in the exercise time zone (<see cref="ExerciseDay"/>, from the injected
/// <see cref="TimeProvider"/>), never scenario time: a word for D signs in until the rollover that ends D and not a
/// second after; yesterday's word and tomorrow's pre-set word do not work today.
/// </para>
/// <para>
/// <b>A Disable racing the sign-in (Gate-2 W-001, story 03's join pattern).</b> Staff can disable the account between
/// the name lookup and the session being minted, and the Disable's session sweep cannot see a session that does not
/// exist yet. So the session is minted FIRST and the account is re-read, untracked, AFTER it exists: a Disable committed
/// before the re-read ends the fresh session at once and the attempt is the uniform refusal (the same redaction check,
/// so it still costs the two KDF calls every refusal costs, and the same identity-less failure event); a Disable that
/// commits after it finds and ends the session. <see cref="Account.LastLoginAt"/> and the success event are written
/// only once the re-read passes, so a failed issue or a raced attempt never leaves a success event behind.
/// </para>
/// <para>
/// <b>Never creates or changes an account (COR-011)</b> beyond recording <see cref="Account.LastLoginAt"/> on success.
/// Refuses disabled accounts (<see cref="Account.DisabledAt"/>), any role outside the participant world, and any
/// exercise that is not Staged/Live/Paused (EL-11). <b>The word appears nowhere</b>: not in a log (nothing here logs),
/// an exception, an error body or telemetry. The failure event's target is the sanitized attempted sign-in name, nulled
/// when it normalises to the attempted word or verifies as today's word, and dropped by story 01's redactor when it
/// looks like any other secret.
/// </para>
/// </remarks>
public sealed class WordLoginService
{
    /// <summary>The longest RAW sign-in name accepted, checked before sanitizing (the <c>/api/auth/login</c> bound).</summary>
    public const int MaxRawSignInNameLength = ParticipantLoginService.MaxRawUsernameLength;

    /// <summary>The 400 reason for a missing sign-in name.</summary>
    public const string SignInNameRequiredError = "signInName is required.";

    /// <summary>The 400 reason for a missing word.</summary>
    public const string WordRequiredError = "word is required.";

    /// <summary>The 400 reason for an over-long sign-in name. Never quotes it.</summary>
    public const string SignInNameTooLongError = "signInName is too long.";

    /// <summary>The 400 reason for an over-long word. Never quotes it.</summary>
    public const string WordTooLongError = "word is too long.";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ISessionIssuer _sessionIssuer;
    private readonly ISharedCredentialHasher _hasher;
    private readonly ExerciseFactsReader _factsReader;
    private readonly IExerciseClock _exerciseClock;
    private readonly TimeProvider _timeProvider;
    private readonly EasyLoginOptions _options;
    private readonly ILogger<WordLoginService> _logger;

    /// <summary>Creates the word sign-in funnel over its collaborators.</summary>
    /// <param name="dbContext">The persistence context (the account update and telemetry share one unit of work).</param>
    /// <param name="exerciseContext">The host-resolved exercise scope, the only source of the exercise.</param>
    /// <param name="sessionIssuer">Mints the participant session, as for a password sign-in.</param>
    /// <param name="hasher">The slow-KDF verifier (real hash or decoy, exactly once per attempt).</param>
    /// <param name="factsReader">The feature's one read of the exercise row (zone, lifecycle status).</param>
    /// <param name="exerciseClock">The native exercise clock, for the telemetry scenario time.</param>
    /// <param name="timeProvider">The wall clock (a fake in tests).</param>
    /// <param name="options">The easy-login options (the day rollover hour).</param>
    /// <param name="logger">Logs the once-per-exercise time-zone fallback warning (never a name or a word).</param>
    public WordLoginService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ISessionIssuer sessionIssuer,
        ISharedCredentialHasher hasher,
        ExerciseFactsReader factsReader,
        IExerciseClock exerciseClock,
        TimeProvider timeProvider,
        IOptions<EasyLoginOptions> options,
        ILogger<WordLoginService> logger)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(sessionIssuer);
        ArgumentNullException.ThrowIfNull(hasher);
        ArgumentNullException.ThrowIfNull(factsReader);
        ArgumentNullException.ThrowIfNull(exerciseClock);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(logger);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _sessionIssuer = sessionIssuer;
        _hasher = hasher;
        _factsReader = factsReader;
        _exerciseClock = exerciseClock;
        _timeProvider = timeProvider;
        _options = options.Value;
        _logger = logger;
    }

    /// <summary>
    /// Signs a participant in with their sign-in name and today's word. Emits one XC-004 <c>login</c> event
    /// (<c>method: "word"</c>) whenever the host resolved an exercise, success or failure.
    /// </summary>
    /// <param name="request">The body (<c>{ signInName, word }</c>). The word is never logged.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Authenticated (200 envelope), invalid (400: a missing or oversized field), or rejected (the uniform 401).</returns>
    public async Task<WordLoginResult> SignInAsync(WordSignInRequestBody request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        // 1. Shape (400). Both fields are bounded RAW before any work (DoS guards on an anonymous route); the name is
        //    then trimmed and sanitized exactly as /api/auth/login does, so a stored handle round-trips.
        var rawName = request.SignInName?.Trim();
        if (string.IsNullOrEmpty(rawName))
        {
            return WordLoginResult.Invalid(SignInNameRequiredError);
        }

        if (rawName.Length > MaxRawSignInNameLength)
        {
            return WordLoginResult.Invalid(SignInNameTooLongError);
        }

        if (string.IsNullOrWhiteSpace(request.Word))
        {
            return WordLoginResult.Invalid(WordRequiredError);
        }

        if (request.Word.Length > DayWordNormalizer.MaxRawLength)
        {
            return WordLoginResult.Invalid(WordTooLongError);
        }

        if (!AccountFieldRules.TryNormalizeUsername(rawName, out var signInName, out _))
        {
            // Sanitizes to nothing, or past the stored maximum: no account can carry it. Same reasons as above.
            return WordLoginResult.Invalid(
                rawName.Length > AccountFieldRules.MaxUsernameLength ? SignInNameTooLongError : SignInNameRequiredError);
        }

        var word = DayWordNormalizer.Normalize(request.Word);

        // 2. The host-resolved scope. Unresolved, or no exercise row: refuse, after the same KDF work as every other
        //    refusal, and with no telemetry (there is no exercise to stamp an event against).
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is not { } exerciseId || exerciseId == Guid.Empty)
        {
            return RejectWithoutExercise(word, signInName);
        }

        var facts = await _factsReader.GetAsync(exerciseId, cancellationToken);
        if (facts is null)
        {
            return RejectWithoutExercise(word, signInName);
        }

        // One clock read: today's date, LastLoginAt and the event share it. An unknown zone falls back to UTC (logged
        // once per exercise, with only the exercise id and the zone id).
        DayWordTimeZoneWarning.WarnIfFallback(_logger, exerciseId, facts.TimeZone);
        var now = _timeProvider.GetUtcNow();
        var today = ExerciseDay.Today(facts.TimeZone, now, _options.DayRolloverHour);

        // 3. Today's word, under the central filter (another exercise's word is invisible). Only the hash is read.
        var storedHash = await _dbContext.ExerciseDayWords
            .AsNoTracking()
            .Where(row => row.ExerciseId == exerciseId && row.ForDate == today)
            .Select(row => row.WordHash)
            .FirstOrDefaultAsync(cancellationToken);

        // 4. Exactly one word verification, BEFORE the name is looked up. A word that cannot be valid (wrong length
        //    once normalised) and a day with no word both pay the decoy, so neither is faster than a wrong word.
        var wordMatches = storedHash is not null && DayWordNormalizer.IsAcceptableLength(word)
            ? _hasher.Verify(storedHash, word)
            : _hasher.VerifyDecoy(word);

        // 5. Only after the word, the name: trimmed, sanitized, matched case-insensitively (the column collation, as
        //    for /api/auth/login) under the central filter. Looked up on EVERY path whatever the word's result
        //    (Gate-1 W-1), so the statements run never reveal that the word was right. Tracked, because a success
        //    records LastLoginAt; on a refusal it is left unmodified, so the refusal's save writes only its event.
        var account = await _dbContext.Accounts
            .FirstOrDefaultAsync(a => a.ExerciseId == exerciseId && a.Username == signInName, cancellationToken);

        // 6. Everything must hold: today's word, a participant-accessible exercise (EL-11: Staged / Live / Paused; an
        //    unknown status fails closed), and an enabled participant-world account of that name.
        if (!wordMatches
            || !ExerciseLifecycleStates.IsParticipantAccessible(facts.Status)
            || account is null
            || account.DisabledAt is not null
            || !ParticipantSessionRequests.IsParticipantWorldRole(account.Role))
        {
            return await RejectAsync(exerciseId, facts, storedHash, signInName, word, now, cancellationToken);
        }

        // 7. Mint exactly the session /api/auth/login mints (persona and acting human as the account has them). Nothing
        //    about the sign-in is recorded yet: nothing is pending on the context, so the issuer saves only the session.
        var issued = await _sessionIssuer.IssueAsync(ParticipantSessionRequests.For(account, exerciseId), cancellationToken);

        // 8. Gate-2 W-001: re-read the account, untracked, now that the session exists. A Disable that committed while
        //    the session was being minted fails this check; one that commits after it will find (and end) the session.
        var accountId = account.Id;
        var stillEnabled = await _dbContext.Accounts
            .AsNoTracking()
            .AnyAsync(a => a.ExerciseId == exerciseId && a.Id == accountId && a.DisabledAt == null, cancellationToken);

        if (!stillEnabled)
        {
            // End the session just minted, then refuse exactly as a disabled account is refused above: the same
            // redaction check and the same identity-less event, saved with the revocation in one unit of work.
            await StageRacedSessionRevocationAsync(issued.Session.Id, exerciseId, cancellationToken);
            return await RejectAsync(exerciseId, facts, storedHash, signInName, word, now, cancellationToken);
        }

        // 9. Success: LastLoginAt and one success event in one unit of work, only now that the account is known to be
        //    enabled after its session exists.
        account.LastLoginAt = now;
        _dbContext.TelemetryEvents.Add(EasyLoginTelemetry.LoginSucceeded(
            exerciseId, account.Id, EasyLoginMethod.Word, EventTime(exerciseId, facts, now)));
        await _dbContext.SaveChangesAsync(cancellationToken);

        return WordLoginResult.Authenticated(issued);
    }

    /// <summary>
    /// Stages the revocation of a session minted for an attempt that lost a race to a Disable (Gate-2 W-001). The read
    /// carries an explicit <c>ExerciseId</c> predicate, since <c>Session</c> is unscoped; the caller's refusal saves it.
    /// </summary>
    private async Task StageRacedSessionRevocationAsync(Guid sessionId, Guid exerciseId, CancellationToken cancellationToken)
    {
        var raced = await _dbContext.Sessions
            .FirstOrDefaultAsync(s => s.Id == sessionId && s.ExerciseId == exerciseId, cancellationToken);
        if (raced is not null)
        {
            // A fresh read: the issuer stamped IssuedAt after this attempt's first clock read.
            raced.RevokedAt ??= _timeProvider.GetUtcNow();
        }
    }

    /// <summary>
    /// Records one identity-less failure event (saved with anything the caller staged, such as a raced session's
    /// revocation) and returns the uniform refusal. The target is the sanitized attempted name, or none when the name
    /// is (or may be) a day word: (a) it normalises to the attempted word, or (b) it verifies
    /// against today's hash (the word typed into the name box, garbage in the word box). Check (b) is the refusal's one
    /// extra KDF call, always made so every refusal costs the same.
    /// </summary>
    private async Task<WordLoginResult> RejectAsync(
        Guid exerciseId,
        ExerciseFacts facts,
        string? storedHash,
        string attemptedSignInName,
        string normalizedWord,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var normalizedName = DayWordNormalizer.Normalize(attemptedSignInName);
        var nameIsTheAttemptedWord = string.Equals(normalizedName, normalizedWord, StringComparison.Ordinal);
        var nameIsTodaysWord = NameVerifiesAsTodaysWord(storedHash, normalizedName);

        var target = nameIsTheAttemptedWord || nameIsTodaysWord ? null : attemptedSignInName;

        _dbContext.TelemetryEvents.Add(EasyLoginTelemetry.WordLoginFailed(exerciseId, target, EventTime(exerciseId, facts, now)));
        await _dbContext.SaveChangesAsync(cancellationToken);

        return WordLoginResult.Rejected();
    }

    /// <summary>
    /// The refusal for a request with no resolved exercise: no event can be stamped, but it pays the same two KDF calls
    /// as every other refusal (the word decoy, then the name decoy), so an unresolved host is not quicker.
    /// </summary>
    private WordLoginResult RejectWithoutExercise(string normalizedWord, string attemptedSignInName)
    {
        _ = _hasher.VerifyDecoy(normalizedWord);
        _ = NameVerifiesAsTodaysWord(storedHash: null, DayWordNormalizer.Normalize(attemptedSignInName));
        return WordLoginResult.Rejected();
    }

    /// <summary>
    /// The redaction check: exactly one slow-KDF call. Against today's hash when there is one and the normalised name
    /// could be a word (6 to 64 characters); otherwise the decoy, so the cost never depends on whether a word is set.
    /// </summary>
    private bool NameVerifiesAsTodaysWord(string? storedHash, string normalizedName) =>
        storedHash is not null && DayWordNormalizer.IsAcceptableLength(normalizedName)
            ? _hasher.Verify(storedHash, normalizedName)
            : _hasher.VerifyDecoy(normalizedName);

    private EasyLoginEventTime EventTime(Guid exerciseId, ExerciseFacts facts, DateTimeOffset now) =>
        EasyLoginEventTime.For(exerciseId, facts, _exerciseClock, now);
}

/// <summary>The outcome of a <see cref="WordLoginService.SignInAsync"/> call.</summary>
public enum WordLoginOutcome
{
    /// <summary>The word and name matched an enabled participant; a session was issued (200).</summary>
    Authenticated,

    /// <summary>A missing or oversized field (400).</summary>
    Invalid,

    /// <summary>Every other outcome, indistinguishable by design (the bodyless 401).</summary>
    Rejected,
}

/// <summary>The result of a word sign-in attempt.</summary>
public sealed class WordLoginResult
{
    private WordLoginResult(WordLoginOutcome outcome, SessionIssueResult? issued, string? validationError)
    {
        Outcome = outcome;
        Issued = issued;
        ValidationError = validationError;
    }

    /// <summary>Which outcome occurred.</summary>
    public WordLoginOutcome Outcome { get; }

    /// <summary>The issued session and raw tokens (<see cref="WordLoginOutcome.Authenticated"/> only).</summary>
    public SessionIssueResult? Issued { get; }

    /// <summary>The 400 reason (<see cref="WordLoginOutcome.Invalid"/> only). Never contains the name or the word.</summary>
    public string? ValidationError { get; }

    /// <summary>A successful sign-in.</summary>
    /// <param name="issued">The issuer result.</param>
    /// <returns>An authenticated result.</returns>
    public static WordLoginResult Authenticated(SessionIssueResult issued)
    {
        ArgumentNullException.ThrowIfNull(issued);
        return new WordLoginResult(WordLoginOutcome.Authenticated, issued, null);
    }

    /// <summary>A malformed request.</summary>
    /// <param name="validationError">The readable reason.</param>
    /// <returns>An invalid result.</returns>
    public static WordLoginResult Invalid(string validationError)
    {
        ArgumentException.ThrowIfNullOrEmpty(validationError);
        return new WordLoginResult(WordLoginOutcome.Invalid, null, validationError);
    }

    /// <summary>The uniform refusal.</summary>
    /// <returns>A rejected result.</returns>
    public static WordLoginResult Rejected() => new(WordLoginOutcome.Rejected, null, null);
}
