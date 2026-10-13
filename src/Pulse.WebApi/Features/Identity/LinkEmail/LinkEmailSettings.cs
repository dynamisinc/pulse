namespace Pulse.WebApi.Features.Identity.LinkEmail;

using System.Net.Mail;
using Microsoft.Extensions.Configuration;

/// <summary>
/// The keyless email settings of easy-login story 13 (EL-18): <c>Email:Endpoint</c> (the Communication Services
/// endpoint, <c>https://{acs-host}</c>) and <c>Email:SenderAddress</c> (the managed-domain
/// <c>DoNotReply@….azurecomm.net</c> address in UAT). There is NO connection-string or access-key member, and nothing
/// here reads one: the credential is the App Service's managed identity (<see cref="LinkEmailEndpoints"/>).
/// </summary>
/// <remarks>
/// <para>
/// <b>Dark until configured.</b> An unset endpoint, or one that is set but unusable (not an absolute <c>https</c> URL,
/// or no valid sender), leaves the fail-closed <see cref="NullParticipantLinkMailer"/> in place: the host still starts,
/// the send path answers <c>503</c>, and the roster's <c>capabilities.emailLinks</c> (which asks the SAME mailer's
/// <see cref="IParticipantLinkMailer.IsConfigured"/>) is <c>false</c>, so the button is hidden. For a set-but-unusable
/// value <see cref="LinkEmailStartupCheck"/> names the offending KEY once, never its value.
/// </para>
/// </remarks>
public sealed class LinkEmailSettings
{
    /// <summary>The endpoint key, verbatim as <c>webapp.bicep</c> provisions it (<c>Email__Endpoint</c>).</summary>
    public const string EndpointKey = "Email:Endpoint";

    /// <summary>The sender key, verbatim as <c>webapp.bicep</c> provisions it (<c>Email__SenderAddress</c>).</summary>
    public const string SenderAddressKey = "Email:SenderAddress";

    private LinkEmailSettings(Uri endpoint, string senderAddress)
    {
        Endpoint = endpoint;
        SenderAddress = senderAddress;
    }

    /// <summary>The Communication Services endpoint (absolute <c>https</c>, no query, fragment or user-info).</summary>
    public Uri Endpoint { get; }

    /// <summary>The verified sender (<c>MailFrom</c>) address. Not a secret.</summary>
    public string SenderAddress { get; }

    /// <summary>
    /// Whether email delivery was ASKED for: <c>Email:Endpoint</c> is non-blank. Asked for is not usable: see
    /// <see cref="TryRead"/>.
    /// </summary>
    /// <param name="configuration">The host configuration.</param>
    /// <returns><c>true</c> when the endpoint key holds a non-blank value.</returns>
    public static bool IsRequested(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        return !string.IsNullOrWhiteSpace(configuration[EndpointKey]);
    }

    /// <summary>
    /// Reads and validates the settings. Returns <c>null</c> when the endpoint is unset (the feature is dark, and
    /// <paramref name="problemKeys"/> is empty) or when a value is unusable (<paramref name="problemKeys"/> names the
    /// key or keys, never a value).
    /// </summary>
    /// <param name="configuration">The host configuration.</param>
    /// <param name="problemKeys">The keys whose values are unusable; empty when the feature is simply off.</param>
    /// <returns>The usable settings, or <c>null</c>.</returns>
    public static LinkEmailSettings? TryRead(IConfiguration configuration, out IReadOnlyList<string> problemKeys)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        if (!IsRequested(configuration))
        {
            problemKeys = [];
            return null;
        }

        var problems = new List<string>(2);

        var endpoint = TryParseEndpoint(configuration[EndpointKey]);
        if (endpoint is null)
        {
            problems.Add(EndpointKey);
        }

        var sender = configuration[SenderAddressKey]?.Trim();
        if (!LinkEmailAddresses.IsDeliverable(sender))
        {
            problems.Add(SenderAddressKey);
        }

        problemKeys = problems;
        return problems.Count == 0 ? new LinkEmailSettings(endpoint!, sender!) : null;
    }

    /// <summary>An absolute <c>https</c> URL with a host and no query, fragment or user-info; anything else is <c>null</c>.</summary>
    private static Uri? TryParseEndpoint(string? value)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed)
            || !Uri.TryCreate(trimmed, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps
            || string.IsNullOrEmpty(uri.Host)
            || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.Fragment)
            || !string.IsNullOrEmpty(uri.UserInfo))
        {
            return null;
        }

        return uri;
    }
}

/// <summary>
/// The one address rule of the slice: a single bare mailbox (<c>local@domain</c>), at most 254 characters, with no
/// display name, no whitespace and no control or format character. Applied to the configured sender and to every
/// recipient before a message is built, so nothing that could fold or inject a header ever reaches the provider.
/// </summary>
public static class LinkEmailAddresses
{
    /// <summary>The longest address accepted (the RFC 5321 path limit, as <c>Account.Email</c> stores it).</summary>
    public const int MaxLength = 254;

    /// <summary>Whether <paramref name="address"/> is a single bare mailbox that can be sent to.</summary>
    /// <param name="address">The candidate address (already trimmed by the caller, or not: surrounding space fails).</param>
    /// <returns><c>true</c> for a usable address.</returns>
    public static bool IsDeliverable(string? address)
    {
        if (string.IsNullOrEmpty(address) || address.Length > MaxLength)
        {
            return false;
        }

        foreach (var c in address)
        {
            if (char.IsWhiteSpace(c) || char.IsControl(c) || char.GetUnicodeCategory(c) == System.Globalization.UnicodeCategory.Format)
            {
                return false;
            }
        }

        // MailAddress also accepts "Name <a@b>" and quoted forms; requiring the parsed address to BE the input, with no
        // display name, leaves only a bare mailbox.
        return MailAddress.TryCreate(address, out var parsed)
            && string.IsNullOrEmpty(parsed.DisplayName)
            && string.Equals(parsed.Address, address, StringComparison.Ordinal);
    }
}
