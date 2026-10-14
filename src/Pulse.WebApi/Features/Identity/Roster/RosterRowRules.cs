namespace Pulse.WebApi.Features.Identity.Roster;

using System.Text.RegularExpressions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Ops.Bootstrap;
using Pulse.WebApi.Features.Social;

/// <summary>
/// The ingest rules for one roster row, a CSV row or a <c>POST /api/staff/roster</c> body alike (NFR-004): how each
/// cell is sanitized and normalised (<see cref="Normalize"/>) and when a row is refused (<see cref="Validate"/>).
/// </summary>
/// <remarks>
/// <para>
/// <b>Strip, never encode.</b> <c>name</c>, <c>agency</c>, <c>role</c> and the <c>personaHandle</c> cell go through the
/// same <see cref="PostSanitizer"/> the post ingest path uses: a name renders on the staff console AND (as the auto
/// persona's display name) on participant surfaces, so it is a stored-XSS surface. Every value is then trimmed with its
/// inner whitespace collapsed to single spaces, so a key compares the same however it was typed (the matching rules are
/// "case-insensitive and whitespace-normalised"). A name that was nothing but markup is refused, never stored empty.
/// </para>
/// <para>
/// <b>Bounds</b> (after sanitizing): name 256, agency 128, role 128, email 254 (the <see cref="Account"/> column
/// widths), handle 256 (the <see cref="Persona.Handle"/> width). The email passes a simple address pattern that also
/// refuses angle brackets; it is staff-only (XC-002) and is never sanitized into a different address. An explicit
/// sign-in name is trimmed and lower-cased, then must match <c>^[a-z0-9][a-z0-9._-]{2,31}$</c>; it is never altered
/// beyond that.
/// </para>
/// </remarks>
public static partial class RosterRowRules
{
    /// <summary>The longest accepted name (<c>Account.DisplayName</c>).</summary>
    public const int MaxNameLength = 256;

    /// <summary>The longest accepted persona-handle cell.</summary>
    public const int MaxPersonaHandleLength = OpsPersonaResolver.MaxHandleLength;

    /// <summary>The reason a row whose name is blank is refused.</summary>
    public const string NameRequiredMessage = "name is required.";

    /// <summary>The reason a row whose name was nothing but markup is refused.</summary>
    public const string NameOnlyMarkupMessage = "name is required (it contained only markup, which is stripped on ingest).";

    /// <summary>The reason an over-long name is refused.</summary>
    public const string NameTooLongMessage = "name must be 256 characters or fewer.";

    /// <summary>The reason an over-long agency is refused.</summary>
    public const string AgencyTooLongMessage = "agency must be 128 characters or fewer.";

    /// <summary>The reason an over-long job label is refused.</summary>
    public const string RoleTooLongMessage = "role must be 128 characters or fewer.";

    /// <summary>The reason a malformed or over-long email is refused.</summary>
    public const string EmailInvalidMessage = "email is not a valid address.";

    /// <summary>The reason a malformed explicit sign-in name is refused.</summary>
    public const string SignInNameInvalidMessage = "signInName must be 3 to 32 characters: a-z, 0-9, \".\", \"_\" or \"-\".";

    /// <summary>Normalises one raw row: sanitize, trim and collapse whitespace; lower-case the sign-in name; drop a leading <c>@</c> from the handle.</summary>
    /// <param name="raw">The raw row (a CSV row or a request body).</param>
    /// <returns>The normalised row. Never fails: <see cref="Validate"/> decides whether it is acceptable.</returns>
    public static RosterRowInput Normalize(RosterRowWrite raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        var rawName = Squash(raw.Name);
        var name = SanitizeText(raw.Name);

        string personaHandle;
        string? personaHandleError;
        if (OpsPersonaResolver.TryNormalizeHandle(raw.PersonaHandle, out var handle, out var handleError))
        {
            // The ops resolver strips one '@'; the roster tolerates any number ('@@FulcoEM' names @FulcoEM, as the mock does).
            personaHandle = Squash(handle?.TrimStart('@'));
            personaHandleError = handle is not null && personaHandle.Length == 0
                ? "personaHandle is not a usable persona handle."
                : null;
        }
        else
        {
            personaHandle = string.Empty;
            personaHandleError = handleError;
        }

        return new RosterRowInput
        {
            Name = name,
            NameWasOnlyMarkup = name.Length == 0 && rawName.Length > 0,
            Agency = SanitizeText(raw.Agency),
            JobRole = SanitizeText(raw.Role),
            Email = Squash(raw.Email),
            PersonaHandle = personaHandle,
            PersonaHandleError = personaHandleError,
            SignInName = Squash(raw.SignInName).ToLowerInvariant(),
        };
    }

    /// <summary>The reason <paramref name="row"/> is unacceptable, or <c>null</c> when it may be applied.</summary>
    /// <param name="row">The normalised row.</param>
    /// <returns>A readable reason, or <c>null</c>.</returns>
    public static string? Validate(RosterRowInput row)
    {
        ArgumentNullException.ThrowIfNull(row);

        if (row.Name.Length == 0)
        {
            return row.NameWasOnlyMarkup ? NameOnlyMarkupMessage : NameRequiredMessage;
        }

        if (row.Name.Length > MaxNameLength)
        {
            return NameTooLongMessage;
        }

        if (row.Agency.Length > Account.MaxAgencyLength)
        {
            return AgencyTooLongMessage;
        }

        if (row.JobRole.Length > Account.MaxJobRoleLength)
        {
            return RoleTooLongMessage;
        }

        if (row.Email.Length > 0 && (row.Email.Length > Account.MaxEmailLength || !EmailPattern().IsMatch(row.Email)))
        {
            return EmailInvalidMessage;
        }

        if (row.SignInName.Length > 0 && !SignInNamePattern().IsMatch(row.SignInName))
        {
            return SignInNameInvalidMessage;
        }

        return row.PersonaHandleError;
    }

    /// <summary>The comparison key of a value: trimmed, inner whitespace collapsed, lower-cased (invariant).</summary>
    /// <param name="value">The value, or <c>null</c>.</param>
    /// <returns>The key (empty for a blank value).</returns>
    public static string NormalizeKey(string? value) => Squash(value).ToLowerInvariant();

    /// <summary>Trims <paramref name="value"/> and collapses every run of whitespace inside it to one space.</summary>
    /// <param name="value">The value, or <c>null</c>.</param>
    /// <returns>The squashed value (empty for a blank one).</returns>
    public static string Squash(string? value) =>
        string.IsNullOrWhiteSpace(value) ? string.Empty : Whitespace().Replace(value.Trim(), " ");

    private static string SanitizeText(string? value) =>
        string.IsNullOrWhiteSpace(value) ? string.Empty : Squash(PostSanitizer.Sanitize(value));

    /// <summary>A simple address check: something, <c>@</c>, something, a dot, something; no whitespace, second <c>@</c> or angle bracket.</summary>
    [GeneratedRegex(@"^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$", RegexOptions.CultureInvariant)]
    private static partial Regex EmailPattern();

    /// <summary>The frozen explicit sign-in name pattern, applied after trim and lower-case.</summary>
    [GeneratedRegex("^[a-z0-9][a-z0-9._-]{2,31}$", RegexOptions.CultureInvariant)]
    private static partial Regex SignInNamePattern();

    [GeneratedRegex(@"\s+", RegexOptions.CultureInvariant)]
    private static partial Regex Whitespace();
}

/// <summary>One roster row after <see cref="RosterRowRules.Normalize"/>: every field sanitized and squashed, empty when blank.</summary>
public sealed record RosterRowInput
{
    /// <summary>The sanitized name.</summary>
    public required string Name { get; init; }

    /// <summary>Whether the raw name was non-blank but nothing but markup.</summary>
    public bool NameWasOnlyMarkup { get; init; }

    /// <summary>The sanitized agency; empty when blank.</summary>
    public required string Agency { get; init; }

    /// <summary>The sanitized free-text job label (the CSV <c>role</c> column); empty when blank.</summary>
    public required string JobRole { get; init; }

    /// <summary>The trimmed email; empty when blank.</summary>
    public required string Email { get; init; }

    /// <summary>The sanitized persona handle without any leading <c>@</c>; empty when blank.</summary>
    public required string PersonaHandle { get; init; }

    /// <summary>Why the persona-handle cell is unusable (only markup, or too long), or <c>null</c>.</summary>
    public string? PersonaHandleError { get; init; }

    /// <summary>The trimmed, lower-cased explicit sign-in name; empty when blank.</summary>
    public required string SignInName { get; init; }
}
