namespace Pulse.WebApi.Features.Identity.EasyLogin;

using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// Builds the <see cref="SessionIssueRequest"/> for a participant who has just proved who they are (a join link or the
/// day word), field for field the request <c>ParticipantLoginService</c> builds for a password sign-in today (its step
/// 7). One builder, so the three sign-in methods cannot drift apart on persona, acting human or read-only-ness, and the
/// success body stays exactly the <c>/api/auth/login</c> envelope (<c>ParticipantLoginResponseDto.From</c>).
/// </summary>
public static class ParticipantSessionRequests
{
    /// <summary>The session kind every participant sign-in mints.</summary>
    public const string ParticipantSessionKind = "participant";

    /// <summary>The participant-world account roles a link or the day word may sign in (case-insensitive).</summary>
    private static readonly HashSet<string> ParticipantWorldRoles = new(StringComparer.OrdinalIgnoreCase)
    {
        "participant",
        "pio",
    };

    /// <summary>
    /// Whether <paramref name="role"/> is a participant-world account role (<c>participant</c> or <c>pio</c>, any
    /// casing): the only roles the join link and the day word sign in (Gate-2 S-6, one rule for both). Anything else,
    /// a staff-adjacent account role or a blank one, is refused with the method's uniform refusal.
    /// </summary>
    /// <param name="role">The account's stored role.</param>
    /// <returns><c>true</c> for a participant-world role.</returns>
    public static bool IsParticipantWorldRole(string? role) => role is not null && ParticipantWorldRoles.Contains(role);

    /// <summary>
    /// The session request for <paramref name="account"/>, bound to <paramref name="exerciseId"/>: kind
    /// <c>participant</c>, the account's role and persona, principal = the account id, acting human = the account's
    /// own <c>ActingHumanId</c> or else the account id (COR-018, the 1:1 case), never read-only, no staff user.
    /// </summary>
    /// <param name="account">The authenticated account, loaded under the central exercise filter.</param>
    /// <param name="exerciseId">The host-resolved exercise (<c>IExerciseContext</c>); must be the account's own exercise.</param>
    /// <returns>The request to pass to <see cref="ISessionIssuer.IssueAsync"/>.</returns>
    /// <exception cref="ArgumentException">
    /// <paramref name="exerciseId"/> is empty or is not the account's exercise. Fail closed: a session is never bound to
    /// an exercise other than the one its account belongs to (COR-001).
    /// </exception>
    public static SessionIssueRequest For(Account account, Guid exerciseId)
    {
        ArgumentNullException.ThrowIfNull(account);

        if (exerciseId == Guid.Empty || exerciseId != account.ExerciseId)
        {
            throw new ArgumentException(
                "A participant session must be bound to the account's own, non-empty exercise.", nameof(exerciseId));
        }

        var accountId = account.Id.ToString();

        return new SessionIssueRequest
        {
            ExerciseId = exerciseId,
            Kind = ParticipantSessionKind,
            Role = account.Role,
            PrincipalId = accountId,
            ActingHumanId = string.IsNullOrEmpty(account.ActingHumanId) ? accountId : account.ActingHumanId,
            IsReadOnly = false,
            AccountId = account.Id,
            StaffUserId = null,
            PersonaId = account.PersonaId,
        };
    }
}
