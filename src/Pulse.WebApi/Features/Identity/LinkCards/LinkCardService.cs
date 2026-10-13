namespace Pulse.WebApi.Features.Identity.LinkCards;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// Builds the printable card sheet behind <c>GET /api/staff/roster/cards</c> (easy-login story 04, EL-12): for each
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
/// <c>notFound</c>: only a request with NO <c>id</c> at all means "every participant", so a request can never
/// widen to the whole roster by accident.
/// </para>
/// <para>
/// <b>Which participants are considered.</b> With no <c>id</c>: every account in the exercise (the same set the
/// roster lists). With <c>id</c>s: those accounts. Each one is then, in this order: <c>disabled</c> (staff disabled
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
    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentStaffSessionAccessor _currentStaffSession;
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
    /// more than <see cref="EasyLoginOptions.MaxCardsPerRequest"/> ids gives <see cref="LinkCardOutcome.TooManyIds"/>;
    /// no usable join base gives <see cref="LinkCardOutcome.JoinLinksUnavailable"/>. None of those reads a link or
    /// writes anything.
    /// </summary>
    /// <param name="requestedIds">
    /// The <c>id</c> query values as sent. Empty (or <c>null</c>) means every participant in the exercise; otherwise
    /// only these accounts, where a value that is not an account id of this exercise (unknown, from another
    /// exercise, malformed or blank) is skipped as <c>notFound</c>.
    /// </param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The result the endpoint maps to a status.</returns>
    public async Task<LinkCardResult> GenerateAsync(
        IReadOnlyList<string>? requestedIds,
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

        // The caller's OWN assignment on the resolved exercise: the role the filter admitted, re-checked here and
        // recorded on the event. StaffAssignment is an access record (not exercise-scoped, not org-owned), and this
        // read is pinned to the caller's own staff id and the resolved exercise, so it cannot reach anyone else's.
        var role = await _dbContext.StaffAssignments
            .AsNoTracking()
            .Where(assignment => assignment.StaffUserId == staff.StaffUserId && assignment.ExerciseId == exerciseId)
            .Select(assignment => assignment.Role)
            .FirstOrDefaultAsync(cancellationToken);
        if (!RosterStaffRoleFilter.IsAdmittedRole(role))
        {
            return LinkCardResult.Forbidden();
        }

        var maxCards = _options.Value.MaxCardsPerRequest;
        if (requestedIds is not null && requestedIds.Count > maxCards)
        {
            return LinkCardResult.TooManyIds(maxCards);
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

        var request = RequestedAccounts.Parse(requestedIds);
        var candidates = await LoadCandidatesAsync(request, cancellationToken);

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

        if (!request.Everyone)
        {
            var found = candidates.Select(candidate => candidate.AccountId).ToHashSet();
            foreach (var requested in request.Entries)
            {
                // Unknown, from another exercise (hidden by the central filter), malformed or blank: one answer.
                if (requested.Id is not { } id || !found.Contains(id))
                {
                    skipped.Add(Skip(requested.Raw, RosterCardSkipReasons.NotFound));
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
            ExerciseName = facts.Name,
            Cards = cards,
            Skipped = skipped,
        });
    }

    /// <summary>
    /// Reads the considered accounts with their link (if any) in one query, through the central exercise filter on
    /// BOTH sets, ordered by name. In id mode with no parseable id there is nothing to read.
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
    /// The parsed <c>id</c> query: "everyone" when no value was sent, otherwise each distinct value in request order
    /// with its parsed account id (<c>null</c> when it is not a GUID). Two spellings of one GUID are one entry (the
    /// first spelling is the one echoed back in a <c>notFound</c> skip).
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

        public static RequestedAccounts Parse(IReadOnlyList<string>? values)
        {
            if (values is null || values.Count == 0)
            {
                return new RequestedAccounts(everyone: true, []);
            }

            var entries = new List<RequestedId>(values.Count);
            var seenIds = new HashSet<Guid>();
            var seenUnparsed = new HashSet<string>(StringComparer.Ordinal);

            foreach (var value in values)
            {
                var raw = value ?? string.Empty;
                if (Guid.TryParse(raw, out var id))
                {
                    if (seenIds.Add(id))
                    {
                        entries.Add(new RequestedId(id, raw));
                    }
                }
                else if (seenUnparsed.Add(raw))
                {
                    entries.Add(new RequestedId(Id: null, raw));
                }
            }

            return new RequestedAccounts(everyone: false, entries);
        }
    }

    /// <summary>One requested id: the parsed account id (or <c>null</c>) and the value exactly as sent.</summary>
    private sealed record RequestedId(Guid? Id, string Raw);
}
