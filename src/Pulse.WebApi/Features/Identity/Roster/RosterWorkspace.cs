namespace Pulse.WebApi.Features.Identity.Roster;

using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// The roster as one request sees it, and the ONE place a roster row is judged (<see cref="Apply"/>): the CSV import
/// and the single add both run every row through it, and a dry run and a real run differ only in whether the caller
/// then commits what it decided. It never touches the database: it works on in-memory copies, so a dry run cannot
/// write anything even by accident (EL-3).
/// </summary>
/// <remarks>
/// <para>
/// <b>The frozen derivation and matching rules</b> (<c>docs/features/easy-login/implementation.md</c>, as amended at
/// 34c6c80 and 1aea6f2; the staff roster mock implements the same rules), in the order they are applied:
/// </para>
/// <list type="number">
///   <item><description>An invalid field fails the row (<see cref="RosterRowRules.Validate"/>). A <c>personaHandle</c>
///   must name an ORG persona in this exercise; an unknown handle, a non-org persona and a handle that exists only in
///   another exercise (which the central filter keeps out of this workspace) all fail with the SAME message.</description></item>
///   <item><description>An explicit <c>signInName</c> is never altered. Unless it is an existing participant's (then it
///   is that participant's identity match), it fails when it equals a persona handle in the exercise (including one an
///   earlier row claimed), when an earlier row of the same file claimed it, or when an account the roster does not
///   list holds it.</description></item>
///   <item><description>The identity key CASCADES <c>signInName</c>, <c>email</c>, <c>name + agency</c>
///   (case-insensitive, whitespace-normalised; a blank agency still keys), against the participants that existed
///   BEFORE this request only, so rows of one file never update each other. The first key that matches is the match.
///   A later key that matches only other people fails the row, and so does a <c>signInName</c> match whose stored
///   email differs from the row's.</description></item>
///   <item><description>A match is <c>updated</c> (agency, role, email, the display name when matched by sign-in name
///   or email, or the org-persona binding changed) or <c>unchanged</c>; a blank cell never clears a stored value and a
///   blank <c>personaHandle</c> keeps the current persona. An explicit <c>signInName</c> that matched nobody is not
///   applied to the matched person and is reported in the message.</description></item>
///   <item><description>Otherwise a new participant: the given or derived sign-in name (a derived one steps around
///   every sign-in name AND every persona handle), and the named org persona (role <c>pio</c>) or a new citizen
///   persona whose handle steps around every handle AND every sign-in name, the row's own included (role
///   <c>participant</c>).</description></item>
/// </list>
/// <para>
/// <b>One deliberate tightening of the mock</b>: a key that matches MORE than one existing participant (two legacy
/// "Pat Lee" rows with no agency) fails the row instead of silently picking one, and a later key only conflicts when
/// none of the people it matches is the matched person. Without the second half, re-uploading a file whose two
/// same-name, same-agency people are told apart by <c>signInName</c> would fail one of them, breaking idempotency.
/// </para>
/// <para>
/// <b>Isolation.</b> The caller builds the workspace from reads that ran through the central exercise filter, so
/// another exercise's accounts and personas are simply absent: a persona handle from exercise B behaves exactly like
/// an unknown handle, and a person in B can never be matched, updated or bound.
/// </para>
/// </remarks>
public sealed class RosterWorkspace
{
    /// <summary>The single message for an unknown, non-org or other-exercise persona handle (no oracle).</summary>
    public const string UnknownPersonaMessage = "personaHandle must name an organization persona in this exercise.";

    /// <summary>The message for a row whose sign-in name belongs to a matched person with a different email.</summary>
    public const string DifferentEmailMessage = "signInName belongs to someone with a different email.";

    private const string SignInNameLabel = "signInName";
    private const string EmailLabel = "email";
    private const string NameAgencyLabel = "name and agency";

    private readonly Dictionary<string, List<RosterParticipant>> _beforeBySignInName = new(StringComparer.Ordinal);
    private readonly Dictionary<string, List<RosterParticipant>> _beforeByEmail = new(StringComparer.Ordinal);
    private readonly Dictionary<string, List<RosterParticipant>> _beforeByNameAgency = new(StringComparer.Ordinal);
    private readonly Dictionary<Guid, RosterParticipant> _working = [];
    private readonly Dictionary<string, RosterPersonaRef> _orgPersonasByHandle = new(StringComparer.Ordinal);
    private readonly HashSet<string> _signInNames = new(StringComparer.Ordinal);
    private readonly HashSet<string> _handles = new(StringComparer.Ordinal);
    private readonly HashSet<string> _claimedInFile = new(StringComparer.Ordinal);
    private readonly Dictionary<string, int> _fileKeys = new(StringComparer.Ordinal);
    private readonly List<RosterParticipant> _created = [];
    private readonly List<RosterParticipant> _updated = [];
    private readonly HashSet<Guid> _updatedIds = [];

    /// <summary>Builds the workspace from the exercise's current state.</summary>
    /// <param name="participants">Every participant on the roster (participant-world accounts), read under the central filter.</param>
    /// <param name="otherSignInNames">The sign-in names of the exercise's accounts the roster does not list; they are taken.</param>
    /// <param name="personas">Every persona in the exercise, read under the central filter.</param>
    public RosterWorkspace(
        IEnumerable<RosterParticipant> participants,
        IEnumerable<string> otherSignInNames,
        IEnumerable<RosterPersonaRef> personas)
    {
        ArgumentNullException.ThrowIfNull(participants);
        ArgumentNullException.ThrowIfNull(otherSignInNames);
        ArgumentNullException.ThrowIfNull(personas);

        foreach (var participant in participants)
        {
            // The match indexes hold an immutable copy: "before this request" never moves while rows are applied.
            var before = participant.Clone();
            Index(_beforeBySignInName, RosterRowRules.NormalizeKey(before.SignInName), before);
            Index(_beforeByEmail, RosterRowRules.NormalizeKey(before.Email), before);
            Index(_beforeByNameAgency, NameAgencyKey(before.Name, before.Agency), before);

            _working[participant.Id] = participant;
            _signInNames.Add(RosterRowRules.NormalizeKey(participant.SignInName));
        }

        foreach (var name in otherSignInNames)
        {
            _signInNames.Add(RosterRowRules.NormalizeKey(name));
        }

        // A handle without '@' wins its key over an '@'-prefixed twin; otherwise ordinal order, so the result is stable.
        foreach (var persona in personas.OrderBy(p => p.Handle.StartsWith('@') ? 1 : 0).ThenBy(p => p.Handle, StringComparer.Ordinal))
        {
            var key = HandleKey(persona.Handle);
            _handles.Add(key);
            if (string.Equals(persona.Kind, CitizenPersonaFactory.OrgKind, StringComparison.Ordinal))
            {
                _orgPersonasByHandle.TryAdd(key, persona);
            }
        }
    }

    /// <summary>The participants rows created, in row order. A real run persists exactly these.</summary>
    public IReadOnlyList<RosterParticipant> Created => _created;

    /// <summary>The existing participants rows changed, in the order first changed, in their final state.</summary>
    public IReadOnlyList<RosterParticipant> Updated => _updated;

    /// <summary>
    /// Applies one row of a CSV file: a row with a name whose first identity key (<c>signInName</c>, else
    /// <c>email</c>, else <c>name + agency</c>) an earlier row of the same file already used fails as that row's
    /// duplicate; otherwise it is <see cref="Apply"/>-ed.
    /// </summary>
    /// <param name="rowNumber">The 1-based data-row number.</param>
    /// <param name="row">The normalised row.</param>
    /// <returns>What the row did.</returns>
    public RosterRowOutcome ApplyFileRow(int rowNumber, RosterRowInput row)
    {
        ArgumentNullException.ThrowIfNull(row);

        var key = FileKey(row);
        if (row.Name.Length > 0 && _fileKeys.TryGetValue(key, out var earlier))
        {
            return RosterRowOutcome.Failed(
                RosterRowFailure.Conflict, $"duplicate of row {earlier}; give a signInName to tell them apart");
        }

        _fileKeys[key] = rowNumber;
        return Apply(row);
    }

    /// <summary>Judges one row against the roster and records what it would do (see the type remarks for the rules).</summary>
    /// <param name="row">The normalised row.</param>
    /// <returns>What the row did.</returns>
    public RosterRowOutcome Apply(RosterRowInput row)
    {
        ArgumentNullException.ThrowIfNull(row);

        var invalid = RosterRowRules.Validate(row);
        if (invalid is not null)
        {
            return RosterRowOutcome.Failed(RosterRowFailure.Invalid, invalid);
        }

        RosterPersonaRef? org = null;
        if (row.PersonaHandle.Length > 0 && !_orgPersonasByHandle.TryGetValue(HandleKey(row.PersonaHandle), out org))
        {
            return RosterRowOutcome.Failed(RosterRowFailure.Invalid, UnknownPersonaMessage);
        }

        var signInName = row.SignInName;
        var namesAParticipant = signInName.Length > 0 && _beforeBySignInName.ContainsKey(signInName);
        if (signInName.Length > 0 && !namesAParticipant)
        {
            if (_handles.Contains(signInName))
            {
                return RosterRowOutcome.Failed(
                    RosterRowFailure.Invalid, $"signInName \"{signInName}\" is the same as a persona handle.");
            }

            if (_claimedInFile.Contains(signInName))
            {
                return RosterRowOutcome.Failed(
                    RosterRowFailure.Conflict, $"signInName \"{signInName}\" is already claimed by an earlier row in this file.");
            }

            if (_signInNames.Contains(signInName))
            {
                return RosterRowOutcome.Failed(
                    RosterRowFailure.Conflict, $"signInName \"{signInName}\" is already taken by another account.");
            }
        }

        var keys = new List<(string Label, List<RosterParticipant> Matches)>(3);
        if (signInName.Length > 0)
        {
            keys.Add((SignInNameLabel, Lookup(_beforeBySignInName, signInName)));
        }

        if (row.Email.Length > 0)
        {
            keys.Add((EmailLabel, Lookup(_beforeByEmail, RosterRowRules.NormalizeKey(row.Email))));
        }

        keys.Add((NameAgencyLabel, Lookup(_beforeByNameAgency, NameAgencyKey(row.Name, row.Agency))));

        var primaryIndex = keys.FindIndex(key => key.Matches.Count > 0);
        if (primaryIndex < 0)
        {
            return Create(row, org);
        }

        var (primaryLabel, primaryMatches) = keys[primaryIndex];
        if (primaryMatches.Count > 1)
        {
            return RosterRowOutcome.Failed(
                RosterRowFailure.Conflict,
                $"{primaryLabel} matches more than one person on the roster; give a signInName to tell them apart.");
        }

        var matched = primaryMatches[0];
        foreach (var (label, matches) in keys.Skip(primaryIndex + 1))
        {
            if (matches.Count > 0 && !matches.Any(m => m.Id == matched.Id))
            {
                return RosterRowOutcome.Failed(
                    RosterRowFailure.Conflict, $"{primaryLabel} matches {matched.Name} but {label} matches {matches[0].Name}.");
            }
        }

        if (primaryLabel == SignInNameLabel
            && row.Email.Length > 0
            && !string.IsNullOrWhiteSpace(matched.Email)
            && RosterRowRules.NormalizeKey(row.Email) != RosterRowRules.NormalizeKey(matched.Email))
        {
            return RosterRowOutcome.Failed(RosterRowFailure.Conflict, DifferentEmailMessage);
        }

        return Update(row, org, _working[matched.Id], matchedBySignInName: primaryLabel == SignInNameLabel, matchedByNameAgency: primaryLabel == NameAgencyLabel);
    }

    private RosterRowOutcome Update(RosterRowInput row, RosterPersonaRef? org, RosterParticipant current, bool matchedBySignInName, bool matchedByNameAgency)
    {
        var changed = new List<string>(4);

        // A blank cell never clears a stored value.
        if (row.Agency.Length > 0 && !string.Equals(row.Agency, current.Agency ?? string.Empty, StringComparison.Ordinal))
        {
            current.Agency = row.Agency;
            changed.Add("agency");
        }

        if (row.JobRole.Length > 0 && !string.Equals(row.JobRole, current.JobRole ?? string.Empty, StringComparison.Ordinal))
        {
            current.JobRole = row.JobRole;
            changed.Add("role");
        }

        // Emails compare as the key does: a re-cased address is no change.
        if (row.Email.Length > 0 && RosterRowRules.NormalizeKey(row.Email) != RosterRowRules.NormalizeKey(current.Email))
        {
            current.Email = row.Email;
            changed.Add("email");
        }

        // The display name is only corrected when the person was matched by sign-in name or email.
        if (!matchedByNameAgency && !string.Equals(row.Name, current.Name, StringComparison.Ordinal))
        {
            current.Name = row.Name;
            changed.Add("name");
        }

        string? bound = null;
        if (org is not null
            && (current.Persona?.Id != org.Id
                || !string.Equals(current.ExerciseRole, RosterRoles.Pio, StringComparison.Ordinal)))
        {
            // Bound to an org persona means pio. The old (auto) persona is left as it is (out of scope to move it).
            current.Persona = org;
            current.PersonaAutoCreated = false;
            current.ExerciseRole = RosterRoles.Pio;
            bound = $"persona bound to @{org.Handle}";
        }

        var note = !matchedBySignInName && row.SignInName.Length > 0
            ? $"signInName {row.SignInName} ignored: this person signs in as {current.SignInName}."
            : null;

        if (changed.Count == 0 && bound is null)
        {
            return RosterRowOutcome.Unchanged(current, note);
        }

        if (_updatedIds.Add(current.Id))
        {
            _updated.Add(current);
        }

        var parts = new List<string>(2);
        if (changed.Count > 0)
        {
            parts.Add($"{string.Join(", ", changed)} changed");
        }

        if (bound is not null)
        {
            parts.Add(bound);
        }

        var message = string.Join("; ", parts) + "." + (note is null ? string.Empty : " " + note);
        return RosterRowOutcome.Updated(current, message);
    }

    private RosterRowOutcome Create(RosterRowInput row, RosterPersonaRef? org)
    {
        // A derived sign-in name steps around every sign-in name AND every persona handle (EL-1).
        var signInName = row.SignInName.Length > 0
            ? row.SignInName
            : SignInNameDeriver.Derive(row.Name, candidate => _signInNames.Contains(candidate) || _handles.Contains(candidate));
        _signInNames.Add(signInName);
        _claimedInFile.Add(signInName);

        RosterPersonaRef persona;
        var autoCreated = org is null;
        if (org is not null)
        {
            persona = org;
        }
        else
        {
            // The handle steps around every handle AND every sign-in name, this row's own (just added) included.
            var handle = PersonaHandleDeriver.Derive(row.Name, candidate => _handles.Contains(candidate) || _signInNames.Contains(candidate));
            _handles.Add(handle);
            persona = new RosterPersonaRef(Guid.NewGuid(), handle, row.Name, CitizenPersonaFactory.HumanKind);
        }

        var created = new RosterParticipant
        {
            Id = Guid.NewGuid(),
            IsNew = true,
            SignInName = signInName,
            Name = row.Name,
            Agency = NullIfEmpty(row.Agency),
            JobRole = NullIfEmpty(row.JobRole),
            Email = NullIfEmpty(row.Email),
            ExerciseRole = org is null ? RosterRoles.Participant : RosterRoles.Pio,
            Persona = persona,
            PersonaAutoCreated = autoCreated,
        };

        _working[created.Id] = created;
        _created.Add(created);
        return RosterRowOutcome.Created(created, personaCreated: autoCreated);
    }

    private static string FileKey(RosterRowInput row)
    {
        if (row.SignInName.Length > 0)
        {
            return "s:" + row.SignInName;
        }

        return row.Email.Length > 0
            ? "e:" + RosterRowRules.NormalizeKey(row.Email)
            : "n:" + NameAgencyKey(row.Name, row.Agency);
    }

    private static string NameAgencyKey(string name, string? agency) =>
        RosterRowRules.NormalizeKey(name) + "|" + RosterRowRules.NormalizeKey(agency);

    private static string HandleKey(string handle) => handle.Trim().TrimStart('@').ToLowerInvariant();

    private static string? NullIfEmpty(string value) => value.Length == 0 ? null : value;

    private static void Index(Dictionary<string, List<RosterParticipant>> index, string key, RosterParticipant participant)
    {
        if (key.Length == 0 || key == "|")
        {
            return;
        }

        if (!index.TryGetValue(key, out var list))
        {
            list = [];
            index[key] = list;
        }

        list.Add(participant);
    }

    private static List<RosterParticipant> Lookup(Dictionary<string, List<RosterParticipant>> index, string key) =>
        index.TryGetValue(key, out var list) ? list : [];
}

/// <summary>The participant-world <c>ExerciseRole</c> values a roster account carries (EL-1: derived, never the CSV <c>role</c>).</summary>
public static class RosterRoles
{
    /// <summary>A participant with no org persona.</summary>
    public const string Participant = "participant";

    /// <summary>A participant bound to an org persona.</summary>
    public const string Pio = "pio";

    /// <summary>Whether <paramref name="role"/> is a participant-world role, i.e. whether the account is on the roster.</summary>
    /// <param name="role">The stored <c>Account.Role</c>.</param>
    /// <returns><c>true</c> for <c>participant</c> or <c>pio</c>.</returns>
    public static bool IsRosterRole(string? role) =>
        string.Equals(role, Participant, StringComparison.OrdinalIgnoreCase)
        || string.Equals(role, Pio, StringComparison.OrdinalIgnoreCase);
}

/// <summary>A persona as the roster needs it: enough to bind it and to show it.</summary>
/// <param name="Id">The persona id.</param>
/// <param name="Handle">The stored handle.</param>
/// <param name="DisplayName">The display name.</param>
/// <param name="Kind"><c>human</c> or <c>org</c>.</param>
public sealed record RosterPersonaRef(Guid Id, string Handle, string DisplayName, string Kind);

/// <summary>A participant on the roster, as a workspace holds and changes it. Mirrors the <c>Account</c> columns the roster owns.</summary>
public sealed class RosterParticipant
{
    /// <summary>The account id.</summary>
    public required Guid Id { get; init; }

    /// <summary>Whether a row of this request created the participant.</summary>
    public bool IsNew { get; init; }

    /// <summary>The sign-in name (<c>Account.Username</c>). Never changed by a row.</summary>
    public required string SignInName { get; init; }

    /// <summary>The display name (<c>Account.DisplayName</c>).</summary>
    public required string Name { get; set; }

    /// <summary>The agency, or <c>null</c>.</summary>
    public string? Agency { get; set; }

    /// <summary>The free-text job label (<c>Account.JobRole</c>), or <c>null</c>.</summary>
    public string? JobRole { get; set; }

    /// <summary>The staff-only email, or <c>null</c>.</summary>
    public string? Email { get; set; }

    /// <summary>The account's <c>ExerciseRole</c> (<see cref="RosterRoles"/>).</summary>
    public required string ExerciseRole { get; set; }

    /// <summary>The bound persona, or <c>null</c>.</summary>
    public RosterPersonaRef? Persona { get; set; }

    /// <summary>Whether <see cref="Persona"/> is the citizen persona the roster created for this person.</summary>
    public bool PersonaAutoCreated { get; set; }

    /// <summary>A detached copy.</summary>
    /// <returns>The copy.</returns>
    internal RosterParticipant Clone() => new()
    {
        Id = Id,
        IsNew = IsNew,
        SignInName = SignInName,
        Name = Name,
        Agency = Agency,
        JobRole = JobRole,
        Email = Email,
        ExerciseRole = ExerciseRole,
        Persona = Persona,
        PersonaAutoCreated = PersonaAutoCreated,
    };
}

/// <summary>Why a row failed, which decides the single add's status: <see cref="Invalid"/> is 400, <see cref="Conflict"/> is 409.</summary>
public enum RosterRowFailure
{
    /// <summary>The row did not fail.</summary>
    None,

    /// <summary>A bad value (a field, an unknown persona, a sign-in name that is a persona handle).</summary>
    Invalid,

    /// <summary>A clash with someone already on the roster or earlier in the file.</summary>
    Conflict,
}

/// <summary>What one row did (<see cref="RosterWorkspace.Apply"/>).</summary>
public sealed class RosterRowOutcome
{
    private RosterRowOutcome(string status, RosterRowFailure failure, string? message, RosterParticipant? participant, bool personaCreated)
    {
        Status = status;
        Failure = failure;
        Message = message;
        Participant = participant;
        PersonaCreated = personaCreated;
    }

    /// <summary>A <see cref="RosterRowStatuses"/> value.</summary>
    public string Status { get; }

    /// <summary>Why the row failed, or <see cref="RosterRowFailure.None"/>.</summary>
    public RosterRowFailure Failure { get; }

    /// <summary>The reason when failed; what changed when updated; a note when an unused sign-in name was ignored.</summary>
    public string? Message { get; }

    /// <summary>The participant after the row (created, updated or matched); <c>null</c> when failed.</summary>
    public RosterParticipant? Participant { get; }

    /// <summary>Whether the row created an auto citizen persona.</summary>
    public bool PersonaCreated { get; }

    /// <summary>A failed row.</summary>
    /// <param name="failure">The failure class.</param>
    /// <param name="message">The readable reason.</param>
    /// <returns>The outcome.</returns>
    public static RosterRowOutcome Failed(RosterRowFailure failure, string message) =>
        new(RosterRowStatuses.Failed, failure, message, null, false);

    /// <summary>A row that created a participant.</summary>
    /// <param name="participant">The new participant.</param>
    /// <param name="personaCreated">Whether an auto persona was created.</param>
    /// <returns>The outcome.</returns>
    public static RosterRowOutcome Created(RosterParticipant participant, bool personaCreated) =>
        new(RosterRowStatuses.Created, RosterRowFailure.None, null, participant, personaCreated);

    /// <summary>A row that changed an existing participant.</summary>
    /// <param name="participant">The participant, changed.</param>
    /// <param name="message">What changed.</param>
    /// <returns>The outcome.</returns>
    public static RosterRowOutcome Updated(RosterParticipant participant, string message) =>
        new(RosterRowStatuses.Updated, RosterRowFailure.None, message, participant, false);

    /// <summary>A row that matched an existing participant and changed nothing.</summary>
    /// <param name="participant">The participant.</param>
    /// <param name="note">A note (an ignored sign-in name), or <c>null</c>.</param>
    /// <returns>The outcome.</returns>
    public static RosterRowOutcome Unchanged(RosterParticipant participant, string? note) =>
        new(RosterRowStatuses.Unchanged, RosterRowFailure.None, note, participant, false);
}
