namespace Pulse.WebApi.Features.Channels.Contracts;

using System.Text.Json.Nodes;

/// <summary>
/// FC-7, the public server-side validator for any <c>OutletSkinTokens</c> subset (FC-3b), implemented by
/// channels-foundation story 03 and reused by the portal config API (portal FU-4b).
/// </summary>
/// <remarks>
/// It enforces the FC-3b key allowlist (the D3-P2 CAN list), the <c>ext.&lt;ns&gt;</c> namespaces (<c>news</c>,
/// <c>press</c>, <c>weather</c>, <c>portal</c>; flat scalar or string-array values), a 4 KB total size cap,
/// rejection of <c>clutter</c> off the tabloid skin key, and rejection of anything on the CANNOT list.
/// </remarks>
public interface ISkinOverridesValidator
{
    /// <summary>Validates a skin-overrides object for an outlet with <paramref name="skinKey"/>.</summary>
    /// <param name="skinKey">The outlet's skin key (decides whether <c>clutter</c> is allowed).</param>
    /// <param name="skinOverrides">The partial token object, or null (always valid).</param>
    /// <returns>The result; <see cref="SkinOverridesValidationResult.Errors"/> names each rejected key.</returns>
    SkinOverridesValidationResult Validate(string skinKey, JsonObject? skinOverrides);
}

/// <summary>The result of <see cref="ISkinOverridesValidator.Validate"/>.</summary>
/// <param name="Errors">One message per rejected key or rule; empty when valid.</param>
public sealed record SkinOverridesValidationResult(IReadOnlyList<string> Errors)
{
    /// <summary>A valid result.</summary>
    public static SkinOverridesValidationResult Valid { get; } = new([]);

    /// <summary>Whether the overrides are acceptable.</summary>
    public bool IsValid => Errors.Count == 0;
}
