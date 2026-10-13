namespace Pulse.WebApi.Features.Identity.Roster;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// The read behind <c>GET /api/staff/roster</c> (story 02): every participant in the staff caller's exercise as a
/// <see cref="RosterEntryDto"/>, ordered by name, plus whether join links can be built and whether emailing is
/// configured. Staff-only (the endpoint's filters) and scoped to the request: the exercise comes ONLY from
/// <see cref="IExerciseContext"/>. Scoped lifetime, matching the <see cref="PulseDbContext"/> unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>Who is on the roster.</b> Every account in the exercise that carries a participant-world role
/// (<c>participant</c> or <c>pio</c>), whoever created it: the roster, the legacy CSV import or the bootstrap (those
/// show no agency and <c>link.status: none</c>). <c>Account</c> has no other writer today; an account with any other
/// role could not be represented by the frozen <c>exerciseRole</c> union, so it is not listed (and its sign-in name is
/// treated as taken when provisioning).
/// </para>
/// <para>
/// <b>Isolation.</b> Accounts, personas and links are read through the central exercise filter, so another
/// exercise's rows are absent. <c>Session</c> is NOT exercise-scoped, so the live-session count carries an explicit
/// <c>ExerciseId</c> predicate (gotcha 4). The email is staff-only (XC-002) and appears on no participant projection.
/// </para>
/// <para>
/// <b>Live sessions</b> are this account's sessions in this exercise that are not revoked and whose access window or
/// refresh window is still open, so a locked phone that will refresh on wake still counts.
/// </para>
/// </remarks>
public sealed class RosterQueryService
{
    /// <summary>
    /// The configuration key whose presence means link emailing is configured (story 13, EL-18). Read here so the roster
    /// can report <c>capabilities.emailLinks</c> without depending on story 13's code; absent, the capability is off.
    /// </summary>
    public const string EmailEndpointKey = "Email:Endpoint";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly RosterLinkDtoFactory _linkDtoFactory;
    private readonly JoinUrlBuilder _joinUrlBuilder;
    private readonly IConfiguration _configuration;
    private readonly TimeProvider _timeProvider;

    /// <summary>Creates the query service.</summary>
    /// <param name="dbContext">The request's persistence context (central exercise filter).</param>
    /// <param name="exerciseContext">The server-resolved exercise scope.</param>
    /// <param name="linkDtoFactory">Projects each participant's link (story 01).</param>
    /// <param name="joinUrlBuilder">Whether join links can be built (story 01).</param>
    /// <param name="configuration">Host configuration (the email capability).</param>
    /// <param name="timeProvider">The server clock (live-session windows).</param>
    public RosterQueryService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        RosterLinkDtoFactory linkDtoFactory,
        JoinUrlBuilder joinUrlBuilder,
        IConfiguration configuration,
        TimeProvider timeProvider)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(linkDtoFactory);
        ArgumentNullException.ThrowIfNull(joinUrlBuilder);
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(timeProvider);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _linkDtoFactory = linkDtoFactory;
        _joinUrlBuilder = joinUrlBuilder;
        _configuration = configuration;
        _timeProvider = timeProvider;
    }

    /// <summary>Lists the roster of the resolved exercise, or <c>null</c> when no exercise is resolved (fail closed: 401).</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The roster, or <c>null</c>.</returns>
    public async Task<RosterListDto?> ListAsync(CancellationToken cancellationToken = default)
    {
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return null;
        }

        var exerciseId = scope.Value;
        var now = _timeProvider.GetUtcNow();

        var rows = await (
            from account in _dbContext.Accounts.AsNoTracking()
            where account.Role == RosterRoles.Participant || account.Role == RosterRoles.Pio
            join persona in _dbContext.Personas.AsNoTracking() on account.PersonaId equals (Guid?)persona.Id into personas
            from persona in personas.DefaultIfEmpty()
            join link in _dbContext.ParticipantLinks.AsNoTracking() on account.Id equals link.AccountId into links
            from link in links.DefaultIfEmpty()
            orderby account.DisplayName, account.Username
            select new
            {
                Account = account,
                PersonaId = (Guid?)persona!.Id,
                PersonaHandle = persona.Handle,
                PersonaDisplayName = persona.DisplayName,
                PersonaKind = persona.Kind,
                Link = link,
            }).ToListAsync(cancellationToken);

        // Session is NOT IExerciseScoped: the ExerciseId predicate is the isolation here, not a style point.
        var liveSessions = await _dbContext.Sessions
            .AsNoTracking()
            .Where(s => s.ExerciseId == exerciseId
                && s.AccountId != null
                && s.RevokedAt == null
                && (s.ExpiresAt > now || (s.RefreshExpiresAt != null && s.RefreshExpiresAt > now)))
            .GroupBy(s => s.AccountId!.Value)
            .Select(g => new { AccountId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.AccountId, g => g.Count, cancellationToken);

        var participants = rows
            .Select(row => RosterEntryProjection.Create(
                row.Account,
                row.PersonaId is { } personaId
                    ? new RosterPersonaRef(personaId, row.PersonaHandle, row.PersonaDisplayName, row.PersonaKind)
                    : null,
                _linkDtoFactory.Create(row.Link),
                liveSessions.GetValueOrDefault(row.Account.Id)))
            .ToList();

        return new RosterListDto
        {
            Participants = participants,
            JoinLinksAvailable = _joinUrlBuilder.IsAvailable,
            Capabilities = new RosterCapabilitiesDto
            {
                EmailLinks = !string.IsNullOrWhiteSpace(_configuration[EmailEndpointKey]),
            },
        };
    }
}

/// <summary>Projects an account (and its persona and link state) to the frozen <see cref="RosterEntryDto"/>. One place, for the list and the single add.</summary>
internal static class RosterEntryProjection
{
    /// <summary>Builds the entry. Optional fields are omitted (null), never written as empty strings.</summary>
    /// <param name="account">The account, read under the central filter.</param>
    /// <param name="persona">Its persona, or <c>null</c>.</param>
    /// <param name="link">Its link state (<see cref="RosterLinkDtoFactory"/>).</param>
    /// <param name="liveSessions">Its live-session count.</param>
    /// <returns>The entry.</returns>
    public static RosterEntryDto Create(Account account, RosterPersonaRef? persona, RosterLinkDto link, int liveSessions) => new()
    {
        Id = account.Id.ToString(),
        Name = account.DisplayName,
        Agency = Optional(account.Agency),
        Role = Optional(account.JobRole),
        Email = Optional(account.Email),
        SignInName = account.Username,
        ExerciseRole = string.Equals(account.Role, RosterRoles.Pio, StringComparison.OrdinalIgnoreCase)
            ? RosterRoles.Pio
            : RosterRoles.Participant,
        Persona = persona is null
            ? null
            : new RosterPersonaDto
            {
                Id = persona.Id.ToString(),
                Handle = persona.Handle,
                DisplayName = persona.DisplayName,
                Kind = persona.Kind,
                AutoCreated = account.PersonaAutoCreated,
            },
        Link = link,
        Access = account.DisabledAt is null ? RosterAccessStates.Enabled : RosterAccessStates.Disabled,
        LiveSessions = liveSessions,
        LastSignInAt = account.LastLoginAt is { } lastLogin ? EasyLoginWire.Instant(lastLogin) : null,
        CreatedAt = EasyLoginWire.Instant(account.CreatedAt),
    };

    private static string? Optional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;
}
