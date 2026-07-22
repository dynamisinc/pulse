namespace Pulse.WebApi.Features.Identity.Accounts;

using System.Diagnostics.CodeAnalysis;
using Pulse.WebApi.Features.Social;

/// <summary>
/// Shared ingest validation + normalization for a provisioned <c>Account</c>'s fields, used identically by the
/// individual-create and bulk-CSV-import paths (story 02). Centralizes three concerns: (1) NFR-004 free-text
/// sanitization (STRIP, not encode — the exact <see cref="PostSanitizer"/> the post ingest path uses, because a
/// display name renders on both the staff console AND participant surfaces, a stored-XSS surface COR-007);
/// (2) length bounds (DoS + column-fit guards); (3) the two-worlds role guard — a participant <c>Account</c>
/// mints a <c>participant</c>-kind session, so it may ONLY carry a participant-world role
/// (<c>participant</c>/<c>pio</c>), never a staff role (<c>controller</c>/<c>evaluator</c>/<c>planner</c>) or
/// <c>orgAdmin</c> (XC-002 — a participant identity must never be able to claim a staff surface).
/// </summary>
public static class AccountFieldRules
{
    /// <summary>Maximum login-handle length (matches the <c>Account.Username</c> index-key bound).</summary>
    public const int MaxUsernameLength = 256;

    /// <summary>Maximum display-name length.</summary>
    public const int MaxDisplayNameLength = 256;

    /// <summary>Maximum accepted password length (a DoS guard on the slow KDF; never trimmed / logged).</summary>
    public const int MaxPasswordLength = 1024;

    /// <summary>
    /// The ONLY roles a participant <c>Account</c> may carry, keyed case-insensitively to their canonical frozen
    /// value (<c>core/auth/roles.ts</c>) so a CSV that says <c>PIO</c> / <c>Participant</c> is accepted but the
    /// stored value is the exact lowercase token the frozen <c>Session.role</c> wire field expects (no case-mapping).
    /// </summary>
    private static readonly Dictionary<string, string> CanonicalParticipantRoles =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["participant"] = "participant",
            ["pio"] = "pio",
        };

    /// <summary>Trims, strips markup, and length-checks a login handle. Fails on empty / oversized input.</summary>
    /// <param name="raw">The raw handle from the request body or CSV cell.</param>
    /// <param name="username">The sanitized handle on success.</param>
    /// <param name="error">A human-readable reason on failure.</param>
    /// <returns><c>true</c> when the handle is valid.</returns>
    public static bool TryNormalizeUsername(string? raw, [NotNullWhen(true)] out string? username, [NotNullWhen(false)] out string? error)
    {
        username = null;
        var trimmed = raw?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            error = "username is required.";
            return false;
        }

        var sanitized = PostSanitizer.Sanitize(trimmed).Trim();
        if (sanitized.Length == 0)
        {
            error = "username is required.";
            return false;
        }

        if (sanitized.Length > MaxUsernameLength)
        {
            error = $"username must be at most {MaxUsernameLength} characters.";
            return false;
        }

        username = sanitized;
        error = null;
        return true;
    }

    /// <summary>Trims, strips markup, and length-checks a display name. Fails when empty (incl. emptied by sanitizing).</summary>
    /// <param name="raw">The raw display name from the request body or CSV cell.</param>
    /// <param name="displayName">The sanitized display name on success.</param>
    /// <param name="error">A human-readable reason on failure.</param>
    /// <returns><c>true</c> when the display name is valid.</returns>
    public static bool TryNormalizeDisplayName(string? raw, [NotNullWhen(true)] out string? displayName, [NotNullWhen(false)] out string? error)
    {
        displayName = null;
        var trimmed = raw?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            error = "displayName is required.";
            return false;
        }

        var sanitized = PostSanitizer.Sanitize(trimmed).Trim();
        if (sanitized.Length == 0)
        {
            // The entire value was markup — reject rather than persist an empty display name (COR-007).
            error = "displayName is required (it contained only markup, which is stripped on ingest).";
            return false;
        }

        if (sanitized.Length > MaxDisplayNameLength)
        {
            error = $"displayName must be at most {MaxDisplayNameLength} characters.";
            return false;
        }

        displayName = sanitized;
        error = null;
        return true;
    }

    /// <summary>Maps a role string to its canonical participant-world value; rejects staff / org / unknown roles.</summary>
    /// <param name="raw">The raw role from the request body or CSV cell.</param>
    /// <param name="role">The canonical lowercase role on success.</param>
    /// <param name="error">A human-readable reason on failure.</param>
    /// <returns><c>true</c> when the role is a participant-world role.</returns>
    public static bool TryNormalizeRole(string? raw, [NotNullWhen(true)] out string? role, [NotNullWhen(false)] out string? error)
    {
        role = null;
        var trimmed = raw?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            error = "role is required.";
            return false;
        }

        if (!CanonicalParticipantRoles.TryGetValue(trimmed, out var canonical))
        {
            error = "role must be a participant-world role (participant or pio); staff roles are provisioned separately.";
            return false;
        }

        role = canonical;
        error = null;
        return true;
    }

    /// <summary>
    /// Validates an OPTIONAL password: an empty/absent value yields a <c>null</c> credential (a valid provisioned
    /// account with no login secret yet, per the <c>Account.CredentialHash</c> contract); a present value is
    /// length-checked but NEVER trimmed or sanitized (a secret's exact bytes are significant).
    /// </summary>
    /// <param name="raw">The raw password from the request body or CSV cell.</param>
    /// <param name="password">The password to hash (never <c>null</c> when present), or <c>null</c> when absent.</param>
    /// <param name="error">A human-readable reason on failure.</param>
    /// <returns><c>true</c> when absent or within bounds; <c>false</c> only when present but oversized.</returns>
    public static bool TryValidatePassword(string? raw, out string? password, [NotNullWhen(false)] out string? error)
    {
        if (string.IsNullOrEmpty(raw))
        {
            password = null;
            error = null;
            return true;
        }

        if (raw.Length > MaxPasswordLength)
        {
            password = null;
            error = $"password must be at most {MaxPasswordLength} characters.";
            return false;
        }

        password = raw;
        error = null;
        return true;
    }
}
