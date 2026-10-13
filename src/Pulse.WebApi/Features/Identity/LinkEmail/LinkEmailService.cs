namespace Pulse.WebApi.Features.Identity.LinkEmail;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// How a batch is paced. Code-only (not bound from configuration, so it adds no config key); a test host overrides it
/// with <c>services.Configure&lt;LinkEmailPacing&gt;(…)</c>.
/// </summary>
public sealed class LinkEmailPacing
{
    /// <summary>The default pause between two sends.</summary>
    public static readonly TimeSpan DefaultSendPause = TimeSpan.FromMilliseconds(250);

    /// <summary>
    /// The default time budget of one batch: comfortably under the App Service front end's 230 s request timeout, so
    /// the caller always gets the per-participant answer instead of a gateway error while sends carry on unseen.
    /// </summary>
    public static readonly TimeSpan DefaultBatchBudget = TimeSpan.FromSeconds(150);

    /// <summary>The pause between two sends (story 13: "sequential with a short pause"). Zero = none.</summary>
    public TimeSpan SendPause { get; set; } = DefaultSendPause;

    /// <summary>
    /// Once this much time has passed, no further send is STARTED (the first one always is): the remaining eligible
    /// participants are reported <c>failed</c> / <c>notAttempted</c> (nothing was sent to them, so staff can simply
    /// send again).
    /// </summary>
    public TimeSpan BatchBudget { get; set; } = DefaultBatchBudget;
}

/// <summary>
/// Emails each selected participant their OWN personal join link, behind <c>POST /api/staff/roster/email-links</c>
/// (easy-login story 13, EL-18). It READS links that stories 02 and 03 created, through the same kernel the card
/// sheet uses (<see cref="RosterLinkDtoFactory"/>: decrypt, check against the row's hash, build the URL with
/// <c>JoinUrlBuilder</c>); it never issues, rotates or changes one. Scoped, matching the <see cref="PulseDbContext"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Who is considered.</b> With <c>participantIds</c>: those accounts (1 to <see cref="MaxParticipantsPerRequest"/>
/// as sent, de-duplicated). Omitted (<c>{}</c>): every participant in the exercise, of whom at most
/// <see cref="MaxParticipantsPerRequest"/> may be eligible (more is a <c>400</c>, decided BEFORE any send). Each one is,
/// in this order: <c>skipped</c> <c>disabled</c>, <c>noEmail</c> (none, or not a single bare deliverable address),
/// <c>noActiveLink</c>, <c>tokenUnrecoverable</c>; otherwise eligible and emailed. Ids that match no account here
/// (unknown, malformed, or from ANOTHER exercise, which the central filter hides) are <c>skipped</c> /
/// <c>notFound</c> through the same path, so a cross-exercise id is indistinguishable from an unknown one.
/// </para>
/// <para>
/// <b>Sending.</b> Sequential, in name order, with <see cref="LinkEmailPacing.SendPause"/> between sends. One failure
/// never aborts the batch: a provider refusal, throttle, timeout, credential failure or any unexpected fault in one
/// send becomes that participant's <c>failed</c> result (<see cref="RosterEmailFailureReasons"/>, generic) and the next
/// one is attempted. No send is retried automatically. When the request is aborted the batch stops between sends.
/// </para>
/// <para>
/// <b>Telemetry (XC-004).</b> Every send ATTEMPT records exactly one <c>participant.link.emailed</c> event
/// (<c>sent</c> / <c>failed</c>, the staff actor, the link as target) and saves it at once, so the audit trail matches
/// what actually left even if the request dies mid-batch. The event carries no address, token, URL or name
/// (<see cref="EasyLoginTelemetry.LinkEmailed"/> accepts an id and a boolean only). Skips, and participants not
/// attempted, record nothing. A refused request (401/403/400/503) records nothing and sends nothing. If an audit
/// write fails the batch stops there (a 500): no further email leaves unrecorded.
/// </para>
/// <para>
/// <b>Isolation.</b> The exercise comes only from <see cref="IExerciseContext"/>; the exercise name in the subject from
/// <see cref="ExerciseFactsReader"/>, never from the request. <b>Secrets.</b> This service logs one summary line of
/// counts per batch and nothing else; its results carry ids and fixed reasons only.
/// </para>
/// </remarks>
public sealed partial class LinkEmailService
{
    /// <summary>The most participants one request may name, or may email when ids are omitted.</summary>
    public const int MaxParticipantsPerRequest = 100;

    /// <summary>The longest requested id echoed back in a <c>notFound</c> result (a GUID is 36).</summary>
    public const int MaxEchoedIdLength = 64;

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentStaffSessionAccessor _currentStaffSession;
    private readonly StaffAssignmentService _staffAssignments;
    private readonly ExerciseFactsReader _factsReader;
    private readonly RosterLinkDtoFactory _linkDtoFactory;
    private readonly JoinUrlBuilder _joinUrlBuilder;
    private readonly IParticipantLinkMailer _mailer;
    private readonly IOptions<LinkEmailPacing> _pacing;
    private readonly IExerciseClock _exerciseClock;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<LinkEmailService> _logger;

    /// <summary>Creates the service over its collaborators.</summary>
    /// <param name="dbContext">The request's persistence context (central exercise filter applied).</param>
    /// <param name="exerciseContext">The server-resolved exercise scope, the ONLY source of the exercise.</param>
    /// <param name="currentStaffSession">Identifies the staff caller (the telemetry acting human).</param>
    /// <param name="staffAssignments">The caller's own assignments: the role re-check, as the filters read it.</param>
    /// <param name="factsReader">The exercise name and the telemetry time zone / scenario time.</param>
    /// <param name="linkDtoFactory">Decides whether a link is active and recoverable, and builds its join URL.</param>
    /// <param name="joinUrlBuilder">Tells whether a join base is configured at all.</param>
    /// <param name="mailer">Sends one message; <see cref="IParticipantLinkMailer.IsConfigured"/> is the 503 switch.</param>
    /// <param name="pacing">The pause between sends and the batch time budget.</param>
    /// <param name="exerciseClock">The native exercise clock, for each event's scenario time.</param>
    /// <param name="timeProvider">The server wall clock.</param>
    /// <param name="logger">The logger (one count-only summary per batch).</param>
    public LinkEmailService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ICurrentStaffSessionAccessor currentStaffSession,
        StaffAssignmentService staffAssignments,
        ExerciseFactsReader factsReader,
        RosterLinkDtoFactory linkDtoFactory,
        JoinUrlBuilder joinUrlBuilder,
        IParticipantLinkMailer mailer,
        IOptions<LinkEmailPacing> pacing,
        IExerciseClock exerciseClock,
        TimeProvider timeProvider,
        ILogger<LinkEmailService> logger)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(currentStaffSession);
        ArgumentNullException.ThrowIfNull(staffAssignments);
        ArgumentNullException.ThrowIfNull(factsReader);
        ArgumentNullException.ThrowIfNull(linkDtoFactory);
        ArgumentNullException.ThrowIfNull(joinUrlBuilder);
        ArgumentNullException.ThrowIfNull(mailer);
        ArgumentNullException.ThrowIfNull(pacing);
        ArgumentNullException.ThrowIfNull(exerciseClock);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(logger);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _currentStaffSession = currentStaffSession;
        _staffAssignments = staffAssignments;
        _factsReader = factsReader;
        _linkDtoFactory = linkDtoFactory;
        _joinUrlBuilder = joinUrlBuilder;
        _mailer = mailer;
        _pacing = pacing;
        _exerciseClock = exerciseClock;
        _timeProvider = timeProvider;
        _logger = logger;
    }

    /// <summary>
    /// Emails the requested participants' links. Fails closed, in order, before anything is read or sent: no resolved
    /// exercise or no staff session (<see cref="LinkEmailOutcome.Unauthenticated"/>); not a controller or planner there
    /// (<see cref="LinkEmailOutcome.Forbidden"/>); email not configured (<see cref="LinkEmailOutcome.NotConfigured"/>);
    /// a body that is not <c>{}</c> or <c>{ participantIds: [1..100 strings] }</c> (<see cref="LinkEmailOutcome.Invalid"/>
    /// / <see cref="LinkEmailOutcome.TooMany"/>); no join base (<see cref="LinkEmailOutcome.JoinLinksUnavailable"/>);
    /// and, with ids omitted, more than <see cref="MaxParticipantsPerRequest"/> eligible (<see cref="LinkEmailOutcome.TooMany"/>).
    /// </summary>
    /// <param name="request">The deserialized body (<c>null</c> for a JSON <c>null</c>).</param>
    /// <param name="cancellationToken">The request's cancellation: checked between sends only.</param>
    /// <returns>The result the endpoint maps to a status.</returns>
    public async Task<LinkEmailResult> SendAsync(RosterEmailLinksBody? request, CancellationToken cancellationToken = default)
    {
        // COR-001: the server-resolved scope, never a request value. Unset or the empty sentinel: fail closed.
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is not { } exerciseId || exerciseId == Guid.Empty)
        {
            return LinkEmailResult.Unauthenticated();
        }

        var staff = await _currentStaffSession.GetCurrentStaffSessionAsync(cancellationToken);
        if (staff is null)
        {
            return LinkEmailResult.Unauthenticated();
        }

        // The caller's OWN assignment on the resolved exercise, read exactly as the filters read it, with the same role
        // rule: the role admitted here is the one recorded on each event.
        var assignments = await _staffAssignments.GetAssignmentsAsync(cancellationToken);
        if (assignments is null)
        {
            return LinkEmailResult.Unauthenticated();
        }

        var role = assignments
            .FirstOrDefault(assignment => Guid.TryParse(assignment.ExerciseId, out var id) && id == exerciseId)
            ?.Role;
        if (!RosterStaffRoleFilter.IsAdmittedRole(role))
        {
            return LinkEmailResult.Forbidden();
        }

        // Dark until configured (EL-18): the same switch the endpoint checks before reading the body.
        if (!_mailer.IsConfigured)
        {
            return LinkEmailResult.NotConfigured();
        }

        var parsed = RequestedAccounts.Parse(request);
        if (parsed.Refusal is { } refusal)
        {
            return refusal;
        }

        if (!_joinUrlBuilder.IsAvailable)
        {
            return LinkEmailResult.JoinLinksUnavailable();
        }

        var facts = await _factsReader.GetAsync(exerciseId, cancellationToken);
        if (facts is null)
        {
            // A scope with no exercise row behind it cannot name the subject or carry scoped telemetry: fail closed.
            return LinkEmailResult.Unauthenticated();
        }

        var requested = parsed.Accounts!;
        var candidates = await LoadCandidatesAsync(requested, cancellationToken);
        var plan = Plan(candidates);

        if (requested.Everyone && plan.Count(step => step.Delivery is not null) > MaxParticipantsPerRequest)
        {
            return LinkEmailResult.TooMany(
                $"More than {MaxParticipantsPerRequest} participants can be emailed. Select at most "
                + $"{MaxParticipantsPerRequest} at a time.");
        }

        var results = await DeliverAsync(exerciseId, facts, new EasyLoginStaffActor(staff.StaffUserId, role), plan, cancellationToken);

        if (!requested.Everyone)
        {
            var found = candidates.Select(candidate => candidate.AccountId).ToHashSet();
            foreach (var entry in requested.Entries)
            {
                // Unknown, from another exercise (hidden by the central filter), or malformed: one answer.
                if (entry.Id is not { } id || !found.Contains(id))
                {
                    results.Add(Result(entry.Raw, RosterEmailStatuses.Skipped, RosterEmailSkipReasons.NotFound));
                }
            }
        }

        var sent = results.Count(r => r.Status == RosterEmailStatuses.Sent);
        var skipped = results.Count(r => r.Status == RosterEmailStatuses.Skipped);
        LogBatch(_logger, sent, skipped, results.Count - sent - skipped);

        return LinkEmailResult.Ok(new RosterEmailResultDto { Results = results });
    }

    /// <summary>Decides, for each considered participant in name order, whether they are skipped (and why) or emailed.</summary>
    private List<PlannedStep> Plan(List<EmailCandidate> candidates)
    {
        var plan = new List<PlannedStep>(candidates.Count);
        foreach (var candidate in candidates)
        {
            var participantId = candidate.AccountId.ToString();

            if (candidate.DisabledAt is not null)
            {
                plan.Add(PlannedStep.Skip(participantId, RosterEmailSkipReasons.Disabled));
                continue;
            }

            var address = candidate.Email?.Trim();
            if (!LinkEmailAddresses.IsDeliverable(address))
            {
                plan.Add(PlannedStep.Skip(participantId, RosterEmailSkipReasons.NoEmail));
                continue;
            }

            var link = _linkDtoFactory.Create(candidate.Link);
            if (!string.Equals(link.Status, RosterLinkStatuses.Active, StringComparison.Ordinal) || candidate.Link is null)
            {
                plan.Add(PlannedStep.Skip(participantId, RosterEmailSkipReasons.NoActiveLink));
                continue;
            }

            if (link.NeedsReissue == true || link.JoinUrl is not { } joinUrl)
            {
                // Unrecoverable copy; or (rarely) the join base stopped being usable after the up-front check, in
                // which case no URL can be built for this person either. Either way: no email, reissue or fix config.
                plan.Add(PlannedStep.Skip(participantId, RosterEmailSkipReasons.TokenUnrecoverable));
                continue;
            }

            plan.Add(new PlannedStep(participantId, Skipped: null, new Delivery(
                candidate.Link.Id,
                address!,
                candidate.DisplayName,
                candidate.Username,
                joinUrl)));
        }

        return plan;
    }

    /// <summary>
    /// Runs the plan: skips are reported as they are; each delivery is sent, one at a time, paced, within the batch
    /// budget, with its event saved straight after the attempt.
    /// </summary>
    private async Task<List<RosterEmailResultItemDto>> DeliverAsync(
        Guid exerciseId,
        ExerciseFacts facts,
        EasyLoginStaffActor actor,
        List<PlannedStep> plan,
        CancellationToken cancellationToken)
    {
        var pacing = _pacing.Value;
        var started = _timeProvider.GetTimestamp();
        var results = new List<RosterEmailResultItemDto>(plan.Count);
        var attempted = 0;

        foreach (var step in plan)
        {
            if (step.Delivery is not { } delivery)
            {
                results.Add(Result(step.ParticipantId, RosterEmailStatuses.Skipped, step.Skipped));
                continue;
            }

            // The first send always starts; after that, no new send starts once the budget is spent.
            if (attempted > 0 && _timeProvider.GetElapsedTime(started) >= pacing.BatchBudget)
            {
                results.Add(Result(step.ParticipantId, RosterEmailStatuses.Failed, RosterEmailFailureReasons.NotAttempted));
                continue;
            }

            // Stop between sends (never mid-send) when the caller has gone: the response could not be delivered.
            cancellationToken.ThrowIfCancellationRequested();
            if (attempted > 0 && pacing.SendPause > TimeSpan.Zero)
            {
                await Task.Delay(pacing.SendPause, _timeProvider, cancellationToken);
            }

            attempted++;
            var outcome = await SendOneAsync(facts.Name, delivery);

            // XC-004: one event per attempt, one clock read for it, saved now. CancellationToken.None on purpose: the
            // send already happened, so its audit record must be written even if the caller has just gone.
            var time = EasyLoginEventTime.For(exerciseId, facts, _exerciseClock, _timeProvider.GetUtcNow());
            _dbContext.TelemetryEvents.Add(EasyLoginTelemetry.LinkEmailed(
                exerciseId,
                actor,
                delivery.LinkId,
                sent: outcome == LinkMailSendOutcome.Sent,
                time));
            await _dbContext.SaveChangesAsync(CancellationToken.None);

            results.Add(outcome switch
            {
                LinkMailSendOutcome.Sent => Result(step.ParticipantId, RosterEmailStatuses.Sent, reason: null),
                LinkMailSendOutcome.RateLimited =>
                    Result(step.ParticipantId, RosterEmailStatuses.Failed, RosterEmailFailureReasons.RateLimited),
                _ => Result(step.ParticipantId, RosterEmailStatuses.Failed, RosterEmailFailureReasons.SendFailed),
            });
        }

        return results;
    }

    /// <summary>
    /// Composes and sends one message. Any fault, of any type, becomes <see cref="LinkMailSendOutcome.Failed"/>: one
    /// participant's failure must never abort the rest of the batch. The request token is NOT passed to the mailer, so
    /// a send is never cut off half way (its outcome would be unknown); the mailer's own timeout bounds it.
    /// </summary>
    private async Task<LinkMailSendOutcome> SendOneAsync(string exerciseName, Delivery delivery)
    {
#pragma warning disable CA1031 // One participant's fault (including an unexpected one) must not stop the batch.
        try
        {
            var message = LinkEmailComposer.Compose(
                delivery.Address,
                exerciseName,
                delivery.DisplayName,
                delivery.SignInName,
                delivery.JoinUrl);
            return await _mailer.SendAsync(message, CancellationToken.None);
        }
        catch (Exception exception)
        {
            // The type only: an exception message from deeper down could carry the address or the URL.
            LogUnexpectedSendFault(_logger, exception.GetType().Name);
            return LinkMailSendOutcome.Failed;
        }
#pragma warning restore CA1031
    }

    /// <summary>
    /// Reads the considered accounts with their link (if any) in one query, through the central exercise filter on
    /// BOTH sets, ordered by name. With ids of which none parses there is nothing to read.
    /// </summary>
    private async Task<List<EmailCandidate>> LoadCandidatesAsync(RequestedAccounts request, CancellationToken cancellationToken)
    {
        IQueryable<Account> accounts = _dbContext.Accounts.AsNoTracking();
        if (!request.Everyone)
        {
            var ids = request.Entries
                .Where(entry => entry.Id is not null)
                .Select(entry => entry.Id!.Value)
                .ToArray();
            if (ids.Length == 0)
            {
                return [];
            }

            accounts = accounts.Where(account => ids.Contains(account.Id));
        }

        // One link per account at most (the unique (ExerciseId, AccountId) index); a left join keeps accounts with none.
        var query =
            from account in accounts
            join link in _dbContext.ParticipantLinks.AsNoTracking() on account.Id equals link.AccountId into links
            from link in links.DefaultIfEmpty()
            orderby account.DisplayName, account.Id
            select new EmailCandidate
            {
                AccountId = account.Id,
                DisplayName = account.DisplayName,
                Username = account.Username,
                Email = account.Email,
                DisabledAt = account.DisabledAt,
                Link = link,
            };

        return await query.ToListAsync(cancellationToken);
    }

    private static RosterEmailResultItemDto Result(string participantId, string status, string? reason) =>
        new() { ParticipantId = participantId, Status = status, Reason = reason };

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Information,
        Message = "Link email batch finished: {Sent} sent, {Skipped} skipped, {Failed} failed.")]
    private static partial void LogBatch(ILogger logger, int sent, int skipped, int failed);

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Warning,
        Message = "Link email send faulted unexpectedly ({ExceptionType}); reported as failed, the batch continues.")]
    private static partial void LogUnexpectedSendFault(ILogger logger, string exceptionType);

    /// <summary>One considered account and its link row (or <c>null</c>), as read from the database.</summary>
    private sealed class EmailCandidate
    {
        public required Guid AccountId { get; init; }

        public required string DisplayName { get; init; }

        public required string Username { get; init; }

        public string? Email { get; init; }

        public DateTimeOffset? DisabledAt { get; init; }

        public ParticipantLink? Link { get; init; }
    }

    /// <summary>What to send to one eligible participant. Never logged (it holds the address and the join URL).</summary>
    private sealed record Delivery(Guid LinkId, string Address, string DisplayName, string SignInName, string JoinUrl)
    {
        public override string ToString() => "Delivery (withheld)";
    }

    /// <summary>One participant's planned step: a skip reason, or a delivery.</summary>
    private sealed record PlannedStep(string ParticipantId, string? Skipped, Delivery? Delivery)
    {
        public static PlannedStep Skip(string participantId, string reason) => new(participantId, reason, Delivery: null);
    }

    /// <summary>
    /// The validated body: "everyone" for <c>{}</c>, otherwise each distinct requested value in request order with its
    /// parsed account id (<c>null</c> when it is not a GUID). Two spellings of one GUID, or the same malformed text in two
    /// casings, are one entry; a value is echoed at most <see cref="MaxEchoedIdLength"/> characters long.
    /// </summary>
    private sealed class RequestedAccounts
    {
        private RequestedAccounts(bool everyone, IReadOnlyList<RequestedId> entries)
        {
            Everyone = everyone;
            Entries = entries;
        }

        public bool Everyone { get; }

        public IReadOnlyList<RequestedId> Entries { get; }

        /// <summary>Validates the body's shape and parses it, or returns the 400 that refuses it.</summary>
        public static (RequestedAccounts? Accounts, LinkEmailResult? Refusal) Parse(RosterEmailLinksBody? body)
        {
            if (body is null)
            {
                return (null, LinkEmailResult.Invalid(
                    "A JSON body is required: {} for every eligible participant, or { \"participantIds\": [ ... ] }."));
            }

            if (body.ParticipantIds is not { } ids)
            {
                return (new RequestedAccounts(everyone: true, []), null);
            }

            if (ids.Count == 0)
            {
                return (null, LinkEmailResult.Invalid(
                    "participantIds must hold at least one id; to email every eligible participant, omit it."));
            }

            if (ids.Count > MaxParticipantsPerRequest)
            {
                return (null, LinkEmailResult.TooMany(
                    $"At most {MaxParticipantsPerRequest} participants may be emailed at once."));
            }

            var entries = new List<RequestedId>(ids.Count);
            var seenIds = new HashSet<Guid>();
            var seenUnparsed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var raw in ids)
            {
                if (Guid.TryParse(raw, out var id))
                {
                    if (seenIds.Add(id))
                    {
                        entries.Add(new RequestedId(id, raw));
                    }

                    continue;
                }

                var echo = BoundedEcho(raw ?? string.Empty);
                if (seenUnparsed.Add(echo))
                {
                    entries.Add(new RequestedId(Id: null, echo));
                }
            }

            return (new RequestedAccounts(everyone: false, entries), null);
        }

        /// <summary>The value cut to <see cref="MaxEchoedIdLength"/> characters, never splitting a surrogate pair.</summary>
        private static string BoundedEcho(string raw)
        {
            if (raw.Length <= MaxEchoedIdLength)
            {
                return raw;
            }

            var length = char.IsHighSurrogate(raw[MaxEchoedIdLength - 1]) ? MaxEchoedIdLength - 1 : MaxEchoedIdLength;
            return raw[..length];
        }
    }

    /// <summary>One requested id: the parsed account id (or <c>null</c>) and the value to echo (as sent, length-bounded).</summary>
    private sealed record RequestedId(Guid? Id, string Raw);
}
