namespace Pulse.WebApi.Features.Identity.LinkCards;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// Builds the printable card sheet behind <c>POST /api/staff/roster/cards</c> (easy-login story 04, EL-12, EL-20): for each
/// participant with an enabled account and an active link whose stored copy still decrypts, a card with the name,
/// agency, job label, sign-in name, join URL and a QR of exactly that URL. Everyone else considered is reported in
/// <c>skipped</c> with a reason. It READS links that stories 02 and 03 created; it never creates, rotates or changes
/// one. Scoped, matching the <see cref="PulseDbContext"/> unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (always-Critical, COR-001/XC-001).</b> The exercise comes ONLY from
/// <see cref="IExerciseContext"/>. Accounts and links are read through the central exercise filter
/// (<c>IExerciseScoped</c>), so an id from another exercise matches no row and is skipped as <c>notFound</c> through
/// exactly the same code path, status and body shape as an id that exists nowhere. A malformed or blank id is also
/// <c>notFound</c>: only the explicit <c>{ "all": true }</c> means "every participant" (EL-20), so a request can
/// never widen to the whole roster by accident.
/// </para>
/// <para>
/// <b>Which participants are considered.</b> With <c>all: true</c>: every account in the exercise (the same set the
/// roster lists; uncapped, as EL-20 decides). With <c>participantIds</c>: those accounts, de-duplicated (a GUID in any
/// casing, or the same malformed text in any casing, is one entry). Each one is then, in this order: <c>disabled</c> (staff disabled
/// them; re-enable first), <c>noActiveLink</c> (no link, or revoked), <c>tokenUnrecoverable</c> (active, but the
/// stored copy no longer decrypts to the token the row's hash names, so reissue), or a card. "Recoverable" is
/// decided by <see cref="RosterLinkDtoFactory"/>, the one definition the roster list also uses, so the sheet and the
/// roster can never disagree about a link.
/// </para>
/// <para>
/// <b>Order.</b> Cards are ordered by name (then account id, for a stable order between equal names), as the
/// database collation sorts them. <c>skipped</c> lists the participants found but skipped in the same name order,
/// then the <c>notFound</c> ids in the order they were requested, each once.
/// </para>
/// <para>
/// <b>Who may ask (EL-13), re-checked here.</b> The endpoint filters already refuse anyone but an assigned controller
/// or planner. This service re-reads the caller's assignment through the SAME primitive the filters use
/// (<see cref="StaffAssignmentService.GetAssignmentsAsync"/>: own-only, bounded by the caller's tenant) and the same
/// role rule (<see cref="RosterStaffRoleFilter.IsAdmittedRole"/>), so the two checks share one definition, and the
/// role it admits is the one recorded on the event.
/// </para>
/// <para>
/// <b>Telemetry (XC-004).</b> Every successful request emits exactly one <c>roster.cards.generated</c> event with the
/// card count, a staff actor (role and acting human) and no target, persisted by the request's one
/// <c>SaveChanges</c> (the read itself changes no row). No URL, token or name reaches it:
/// <see cref="EasyLoginTelemetry.RosterCardsGenerated"/> accepts a count only. A refused request (401, 403, 400,
/// 409) emits nothing.
/// </para>
/// <para>
/// <b>Secrets.</b> A join URL is a bearer credential. This service never logs, and its error messages carry no URL,
/// token or name.
/// </para>
/// </remarks>
public sealed class LinkCardService
{
    /// <summary>
    /// The longest requested id echoed back in a <c>notFound</c> skip; a longer value is echoed cut to this length (a
    /// GUID is 36, so no real id is ever cut). It stays a skip rather than a 400 so one bad id never fails the sheet.
    /// </summary>
    public const int MaxEchoedIdLength = 64;

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentStaffSessionAccessor _currentStaffSession;
    private readonly StaffAssignmentService _staffAssignments;
    private readonly ExerciseFactsReader _factsReader;
    private readonly RosterLinkDtoFactory _linkDtoFactory;
    private readonly JoinUrlBuilder _joinUrlBuilder;
    private readonly QrSvgRenderer _qrRenderer;
    private readonly IOptions<EasyLoginOptions> _options;
    private readonly IExerciseClock _exerciseClock;
    private readonly TimeProvider _timeProvider;

    /// <summary>Creates the service over its collaborators.</summary>
    /// <param name="dbContext">The request's persistence context (central exercise filter applied).</param>
    /// <param name="exerciseContext">The server-resolved exercise scope, the ONLY source of the exercise.</param>
    /// <param name="currentStaffSession">Identifies the staff caller (the telemetry acting human).</param>
    /// <param name="staffAssignments">The caller's own assignments: the role re-check, as the filters read it.</param>
    /// <param name="factsReader">The exercise name and the telemetry time zone / scenario time.</param>
    /// <param name="linkDtoFactory">Decides whether a link is active and recoverable, and builds its join URL.</param>
    /// <param name="joinUrlBuilder">Tells whether a join base is configured at all.</param>
    /// <param name="qrRenderer">Renders the QR data URI.</param>
    /// <param name="options">The easy-login options (<see cref="EasyLoginOptions.MaxCardsPerRequest"/>).</param>
    /// <param name="exerciseClock">The native exercise clock, for the event's scenario time.</param>
    /// <param name="timeProvider">The server wall clock (read once per request).</param>
    public LinkCardService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ICurrentStaffSessionAccessor currentStaffSession,
        StaffAssignmentService staffAssignments,
        ExerciseFactsReader factsReader,
        RosterLinkDtoFactory linkDtoFactory,
        JoinUrlBuilder joinUrlBuilder,
        QrSvgRenderer qrRenderer,
        IOptions<EasyLoginOptions> options,
        IExerciseClock exerciseClock,
        TimeProvider timeProvider)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(currentStaffSession);
        ArgumentNullException.ThrowIfNull(staffAssignments);
        ArgumentNullException.ThrowIfNull(factsReader);
        ArgumentNullException.ThrowIfNull(linkDtoFactory);
        ArgumentNullException.ThrowIfNull(joinUrlBuilder);
        ArgumentNullException.ThrowIfNull(qrRenderer);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(exerciseClock);
        ArgumentNullException.ThrowIfNull(timeProvider);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _currentStaffSession = currentStaffSession;
        _staffAssignments = staffAssignments;
        _factsReader = factsReader;
        _linkDtoFactory = linkDtoFactory;
        _joinUrlBuilder = joinUrlBuilder;
        _qrRenderer = qrRenderer;
        _options = options;
        _exerciseClock = exerciseClock;
        _timeProvider = timeProvider;
    }

    /// <summary>
    /// Builds the card sheet for the resolved exercise. Fails closed, in order: no resolved exercise or no staff
    /// session gives <see cref="LinkCardOutcome.Unauthenticated"/>; a caller who is not a controller or planner there
    /// gives <see cref="LinkCardOutcome.Forbidden"/> (the endpoint filters already refuse both; this re-checks);
    /// a body that is not exactly one of <c>{ participantIds }</c> (1 or more) or <c>{ all: true }</c> gives
    /// <see cref="LinkCardOutcome.Invalid"/>; more than <see cref="EasyLoginOptions.MaxCardsPerRequest"/> ids gives
    /// <see cref="LinkCardOutcome.TooManyIds"/>; no usable join base gives <see cref="LinkCardOutcome.JoinLinksUnavailable"/>.
    /// None of those reads a link or writes anything.
    /// </summary>
    /// <param name="request">
    /// The deserialized body (<c>null</c> for a JSON <c>null</c>). <c>all: true</c> means every participant in the
    /// exercise; <c>participantIds</c> means only these accounts, where a value that is not an account id of this
    /// exercise (unknown, from another exercise, malformed or blank) is skipped as <c>notFound</c>, echoed as sent
    /// (cut to <see cref="MaxEchoedIdLength"/> characters).
    /// </param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The result the endpoint maps to a status.</returns>
    public async Task<LinkCardResult> GenerateAsync(
        RosterCardsRequestBody? request,
        CancellationToken cancellationToken = default)
    {
        // COR-001: the server-resolved scope, never a request value. Unset or the empty sentinel: fail closed.
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is not { } exerciseId || exerciseId == Guid.Empty)
        {
            return LinkCardResult.Unauthenticated();
        }

        var staff = await _currentStaffSession.GetCurrentStaffSessionAsync(cancellationToken);
        if (staff is null)
        {
            return LinkCardResult.Unauthenticated();
        }

        // The caller's OWN assignment on the resolved exercise, read exactly as the filters read it (own-only and
        // tenant-bounded by StaffAssignmentService), with the same role rule: the role admitted here is the one
        // recorded on the event.
        var assignments = await _staffAssignments.GetAssignmentsAsync(cancellationToken);
        if (assignments is null)
        {
            return LinkCardResult.Unauthenticated();
        }

        var role = assignments
            .FirstOrDefault(assignment => Guid.TryParse(assignment.ExerciseId, out var id) && id == exerciseId)
            ?.Role;
        if (!RosterStaffRoleFilter.IsAdmittedRole(role))
        {
            return LinkCardResult.Forbidden();
        }

        var parsed = RequestedAccounts.Parse(request, _options.Value.MaxCardsPerRequest);
        if (parsed.Refusal is { } refusal)
        {
            return refusal;
        }

        if (!_joinUrlBuilder.IsAvailable)
        {
            return LinkCardResult.JoinLinksUnavailable();
        }

        var facts = await _factsReader.GetAsync(exerciseId, cancellationToken);
        if (facts is null)
        {
            // A scope with no exercise row behind it cannot name the sheet or carry scoped telemetry: fail closed.
            return LinkCardResult.Unauthenticated();
        }

        var requested = parsed.Accounts!;
        var candidates = await LoadCandidatesAsync(requested, cancellationToken);

        var cards = new List<RosterCardDto>(candidates.Count);
        var skipped = new List<RosterCardSkipDto>();

        foreach (var candidate in candidates)
        {
            var participantId = candidate.AccountId.ToString();

            if (candidate.DisabledAt is not null)
            {
                skipped.Add(Skip(participantId, RosterCardSkipReasons.Disabled));
                continue;
            }

            var link = _linkDtoFactory.Create(candidate.Link);
            if (!string.Equals(link.Status, RosterLinkStatuses.Active, StringComparison.Ordinal))
            {
                skipped.Add(Skip(participantId, RosterCardSkipReasons.NoActiveLink));
                continue;
            }

            if (link.NeedsReissue == true)
            {
                skipped.Add(Skip(participantId, RosterCardSkipReasons.TokenUnrecoverable));
                continue;
            }

            if (link.JoinUrl is not { } joinUrl)
            {
                // Recoverable, but the join base stopped being usable after the check above (a configuration
                // reload mid-request). Same answer as the up-front check: no card is produced.
                return LinkCardResult.JoinLinksUnavailable();
            }

            cards.Add(new RosterCardDto
            {
                ParticipantId = participantId,
                Name = candidate.DisplayName,
                Agency = OmitBlank(candidate.Agency),
                Role = OmitBlank(candidate.JobRole),
                SignInName = candidate.Username,
                JoinUrl = joinUrl,
                QrSvgDataUri = _qrRenderer.RenderDataUri(joinUrl),
            });
        }

        if (!requested.Everyone)
        {
            var found = candidates.Select(candidate => candidate.AccountId).ToHashSet();
            foreach (var entry in requested.Entries)
            {
                // Unknown, from another exercise (hidden by the central filter), malformed or blank: one answer.
                if (entry.Id is not { } id || !found.Contains(id))
                {
                    skipped.Add(Skip(entry.Raw, RosterCardSkipReasons.NotFound));
                }
            }
        }

        // XC-004: one event per request, same unit of work, one wall-clock read. Count only (no URL, token or name).
        var time = EasyLoginEventTime.For(exerciseId, facts, _exerciseClock, _timeProvider.GetUtcNow());
        _dbContext.TelemetryEvents.Add(EasyLoginTelemetry.RosterCardsGenerated(
            exerciseId,
            new EasyLoginStaffActor(staff.StaffUserId, role),
            cards.Count,
            time));
        await _dbContext.SaveChangesAsync(cancellationToken);

        return LinkCardResult.Ok(new RosterCardsDto
        {
            // §8.4 (exercise-build-golive/09): the participant-facing name only, null when unset or whitespace (trimmed
            // otherwise); never facts.Name.
            ExerciseName = Exercise.NormalizeParticipantName(facts.ParticipantName),
            Cards = cards,
            Skipped = skipped,
        });
    }

    /// <summary>
    /// Reads the considered accounts with their link (if any) in one query, through the central exercise filter on
    /// BOTH sets, ordered by name. With ids of which none parses there is nothing to read.
    /// </summary>
    private async Task<List<CardCandidate>> LoadCandidatesAsync(RequestedAccounts request, CancellationToken cancellationToken)
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
            select new CardCandidate
            {
                AccountId = account.Id,
                DisplayName = account.DisplayName,
                Agency = account.Agency,
                JobRole = account.JobRole,
                Username = account.Username,
                DisabledAt = account.DisabledAt,
                Link = link,
            };

        return await query.ToListAsync(cancellationToken);
    }

    private static RosterCardSkipDto Skip(string participantId, string reason) =>
        new() { ParticipantId = participantId, Reason = reason };

    private static string? OmitBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;

    /// <summary>One considered account and its link row (or <c>null</c>), as read from the database.</summary>
    private sealed class CardCandidate
    {
        public required Guid AccountId { get; init; }

        public required string DisplayName { get; init; }

        public string? Agency { get; init; }

        public string? JobRole { get; init; }

        public required string Username { get; init; }

        public DateTimeOffset? DisabledAt { get; init; }

        public ParticipantLink? Link { get; init; }
    }

    /// <summary>
    /// The validated body: "everyone" for <c>{ all: true }</c>, otherwise each distinct requested value in request
    /// order with its parsed account id (<c>null</c> when it is not a GUID). Two spellings of one GUID, or the same
    /// malformed text in two casings, are one entry (the first spelling is the one echoed back in a <c>notFound</c>
    /// skip). A value is echoed at most <see cref="MaxEchoedIdLength"/> characters long, and two over-long values
    /// that echo the same are one entry.
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

        /// <summary>Validates the body's shape (EL-20) and parses it, or returns the 400 that refuses it.</summary>
        public static (RequestedAccounts? Accounts, LinkCardResult? Refusal) Parse(RosterCardsRequestBody? body, int maxIds)
        {
            if (body is null)
            {
                return Refuse("A JSON body is required: { \"participantIds\": [ ... ] } or { \"all\": true }.");
            }

            var ids = body.ParticipantIds;
            var hasIds = ids is not null;
            var hasAll = body.All is not null;

            if (hasIds && hasAll)
            {
                return Refuse("Send either participantIds or all, not both.");
            }

            if (!hasIds && !hasAll)
            {
                return Refuse($"Send participantIds (1 to {maxIds} ids) or all: true.");
            }

            if (hasAll)
            {
                return body.All == true
                    ? (new RequestedAccounts(everyone: true, []), null)
                    : Refuse("all must be true; to print some participants, send participantIds instead.");
            }

            if (ids!.Count == 0)
            {
                return Refuse("participantIds must hold at least one id; to print everyone, send all: true.");
            }

            if (ids.Count > maxIds)
            {
                return (null, LinkCardResult.TooManyIds(maxIds));
            }

            var entries = new List<RequestedId>(ids.Count);
            var seenIds = new HashSet<Guid>();
            var seenUnparsed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var raw in ids)
            {
                if (raw is null)
                {
                    return Refuse("participantIds must hold strings only.");
                }

                if (Guid.TryParse(raw, out var id))
                {
                    if (seenIds.Add(id))
                    {
                        entries.Add(new RequestedId(id, raw));
                    }

                    continue;
                }

                var echo = BoundedEcho(raw);
                if (seenUnparsed.Add(echo))
                {
                    entries.Add(new RequestedId(Id: null, echo));
                }
            }

            return (new RequestedAccounts(everyone: false, entries), null);
        }

        private static (RequestedAccounts? Accounts, LinkCardResult? Refusal) Refuse(string message) =>
            (null, LinkCardResult.Invalid(message));

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
