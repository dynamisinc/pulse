namespace Pulse.WebApi.Features.ExerciseResolution;

using System.Text.RegularExpressions;

/// <summary>
/// Case-normalizes and format-validates the request <c>Host</c> header before it is ever used to build a
/// host → exercise query (COR-008, NFR-004). The always-Critical isolation rule this enforces: a malformed
/// or hostile <c>Host</c> value is <b>rejected outright</b> — it never reaches a database query, a redirect
/// target, or a rendered value (no Host-header injection). A well-formed but un-provisioned host is allowed
/// through to the lookup, where it simply matches nothing and fails closed.
/// </summary>
/// <remarks>
/// <para>
/// The accepted grammar is a conservative RFC-1123 hostname: dot-separated labels of <c>[a-z0-9-]</c>
/// (1–63 chars, no leading/trailing hyphen), total length 1–253. Ports are NOT accepted here — callers pass
/// <see cref="Microsoft.AspNetCore.Http.HostString.Host"/>, which already excludes the port. Anything else
/// (empty, whitespace, IPv6 literals, embedded <c>:</c>/<c>/</c>/<c>@</c>, control characters, a smuggled
/// trailing newline) is rejected.
/// </para>
/// <para>
/// The regex is anchored with <c>\A</c>/<c>\z</c> (absolute string start/end) rather than <c>^</c>/<c>$</c>
/// precisely so a trailing-newline payload (<c>"evil.example.com\n"</c>) — which <c>$</c> would match before
/// — is rejected. Matching against a provisioned host relies on the database's case-insensitive collation
/// (<c>SQL_Latin1_General_CP1_CI_AS</c>); the incoming host is additionally lower-cased here so the value we
/// stash / log / compare is deterministic regardless of how the client cased it.
/// </para>
/// </remarks>
public static partial class ExerciseHostName
{
    /// <summary>Maximum length of a DNS name (RFC 1035) — the upper bound the <see cref="Exercise"/> columns also use.</summary>
    private const int MaxHostLength = 253;

    /// <summary>
    /// Attempts to normalize a raw <c>Host</c> value to a lower-cased, format-validated hostname.
    /// </summary>
    /// <param name="rawHost">
    /// The raw host string (expected to be <see cref="Microsoft.AspNetCore.Http.HostString.Host"/> — the
    /// hostname without its port). May be <c>null</c>/empty when no <c>Host</c> header was sent.
    /// </param>
    /// <param name="normalizedHost">
    /// On success, the trimmed, lower-cased, validated hostname; otherwise <see cref="string.Empty"/>.
    /// </param>
    /// <returns>
    /// <c>true</c> when <paramref name="rawHost"/> is a well-formed hostname safe to use in a lookup;
    /// <c>false</c> when it is absent or malformed (in which case the caller must fail closed and never query
    /// with it).
    /// </returns>
    public static bool TryNormalize(string? rawHost, out string normalizedHost)
    {
        normalizedHost = string.Empty;

        if (string.IsNullOrWhiteSpace(rawHost))
        {
            return false;
        }

        var candidate = rawHost.Trim().ToLowerInvariant();

        if (candidate.Length is 0 or > MaxHostLength)
        {
            return false;
        }

        if (!HostNameRegex().IsMatch(candidate))
        {
            return false;
        }

        normalizedHost = candidate;
        return true;
    }

    [GeneratedRegex(
        @"\A[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\z",
        RegexOptions.CultureInvariant)]
    private static partial Regex HostNameRegex();
}
