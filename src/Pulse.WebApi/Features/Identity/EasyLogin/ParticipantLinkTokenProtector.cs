namespace Pulse.WebApi.Features.Identity.EasyLogin;

using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;

/// <summary>
/// Encrypts a raw personal-link token for storage in <c>ParticipantLink.ProtectedToken</c>, so staff can rebuild the
/// same join URL to reprint a card or copy the link (EL-5: "reprintable, because cards get lost"), and decrypts it
/// back. The lookup never uses this: a join request is matched by <c>TokenHash</c> alone.
/// </summary>
/// <remarks>
/// <b>Decryption fails soft.</b> <see cref="Unprotect"/> returns <c>null</c>, and never throws, for anything it cannot
/// turn back into a token: tampered text, text protected under another purpose, or a key ring that no longer holds
/// the key (a lost App Service key ring, a slot swap). The roster turns that into <c>needsReissue</c> instead of a
/// 500. No method logs its input or output.
/// </remarks>
public interface IParticipantLinkTokenProtector
{
    /// <summary>Encrypts a raw link token for storage.</summary>
    /// <param name="rawToken">The raw token (non-empty).</param>
    /// <returns>The protected text to store in <c>ParticipantLink.ProtectedToken</c>.</returns>
    string Protect(string rawToken);

    /// <summary>Decrypts a stored protected token, or returns <c>null</c> when it cannot be decrypted. Never throws.</summary>
    /// <param name="protectedToken">The stored protected text, or <c>null</c> (a revoked link has none).</param>
    /// <returns>The raw token, or <c>null</c>.</returns>
    string? Unprotect(string? protectedToken);
}

/// <summary>
/// The ASP.NET Data Protection implementation of <see cref="IParticipantLinkTokenProtector"/>, under one fixed
/// purpose string (<see cref="Purpose"/>) so a payload protected for any other feature can never be read back as a
/// link token, and vice versa. Stateless and thread-safe: registered as a singleton.
/// </summary>
/// <remarks>
/// Data Protection is part of the ASP.NET Core shared framework (no package, no secret). On App Service its default
/// key ring lives under <c>$HOME</c>, which is persisted storage; the key-ring storage choice beyond that default is a
/// documented limitation of this feature (see <c>implementation.md</c>, risks), not something this type configures.
/// </remarks>
public sealed class ParticipantLinkTokenProtector : IParticipantLinkTokenProtector
{
    /// <summary>The fixed Data Protection purpose for personal-link tokens. Changing it orphans every stored copy.</summary>
    public const string Purpose = "Pulse.EasyLogin.ParticipantLinkToken.v1";

    private readonly IDataProtector _protector;

    /// <summary>Creates the protector from the host's Data Protection provider.</summary>
    /// <param name="provider">The Data Protection provider (<c>services.AddDataProtection()</c>).</param>
    public ParticipantLinkTokenProtector(IDataProtectionProvider provider)
    {
        ArgumentNullException.ThrowIfNull(provider);
        _protector = provider.CreateProtector(Purpose);
    }

    /// <inheritdoc />
    public string Protect(string rawToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(rawToken);
        return _protector.Protect(rawToken);
    }

    /// <inheritdoc />
    public string? Unprotect(string? protectedToken)
    {
        if (string.IsNullOrEmpty(protectedToken))
        {
            return null;
        }

        try
        {
            var token = _protector.Unprotect(protectedToken);
            return string.IsNullOrEmpty(token) ? null : token;
        }
        catch (CryptographicException)
        {
            // Tampered payload, another purpose, or a key the ring no longer holds: unrecoverable, not an error.
            return null;
        }
        catch (FormatException)
        {
            // Not even valid base64url: unrecoverable for the same reason.
            return null;
        }
    }
}
