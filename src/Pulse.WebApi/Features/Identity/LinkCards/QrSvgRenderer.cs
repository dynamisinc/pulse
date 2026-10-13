namespace Pulse.WebApi.Features.Identity.LinkCards;

using System.Text;
using QRCoder;

/// <summary>
/// Renders a personal join URL as a QR code in an SVG data URI (EL-12): <c>data:image/svg+xml;base64,…</c>, which the
/// card sheet (story 12) drops straight into an <c>&lt;img src&gt;</c>. Generated on the server so the frontend adds no
/// npm package. Stateless and thread-safe: registered as a singleton.
/// </summary>
/// <remarks>
/// <para>
/// <b>Cross-platform renderers only.</b> It uses QRCoder's <see cref="QRCodeGenerator"/>, <see cref="QRCodeData"/> and
/// <see cref="SvgQRCode"/> with the <b>string-colour</b> <c>GetGraphic</c> overload. The <c>System.Drawing.Color</c>
/// overloads and every bitmap renderer depend on <c>System.Drawing.Common</c>, which is Windows-only. They are never
/// called here.
/// </para>
/// <para>
/// <b>What the SVG is.</b> Error correction <see cref="QRCodeGenerator.ECCLevel.M"/>, quiet zone drawn, black modules
/// on a white background, and a <c>viewBox</c> with no width or height (<see cref="SvgQRCode.SizingMode.ViewBoxAttribute"/>)
/// so the page can scale it. One module is one user unit, so the <c>viewBox</c> is exactly the module matrix (quiet
/// zone included). The document has one <c>&lt;svg&gt;</c> root, one background <c>&lt;rect&gt;</c> and one
/// <c>&lt;path&gt;</c> of module geometry. It has no logo, so no <c>&lt;image&gt;</c>, and no script, <c>href</c> or
/// external reference.
/// </para>
/// <para>
/// <b>Content security (NFR-004).</b> The SVG is built from the URL only, never from user text, and the URL itself
/// never appears in the markup: only module coordinates do. The data URI uses standard base64 (<c>A-Z a-z 0-9 + /</c>,
/// <c>=</c> padding), which is the one shape the frontend's <c>safeQrDataUri.ts</c> gate admits.
/// </para>
/// <para>
/// <b>A join URL is a bearer credential.</b> This type never logs its input or output.
/// </para>
/// </remarks>
public sealed class QrSvgRenderer
{
    /// <summary>The data URI prefix of every rendered QR.</summary>
    public const string DataUriPrefix = "data:image/svg+xml;base64,";

    /// <summary>The error-correction level (M: about 15% of the code can be damaged and still scan).</summary>
    public const QRCodeGenerator.ECCLevel ErrorCorrection = QRCodeGenerator.ECCLevel.M;

    /// <summary>The colour of a dark module (black).</summary>
    public const string DarkColorHex = "#000000";

    /// <summary>The background colour, quiet zone included (white).</summary>
    public const string LightColorHex = "#ffffff";

    /// <summary>
    /// User units per module. In <see cref="SvgQRCode.SizingMode.ViewBoxAttribute"/> mode QRCoder writes no width or
    /// height, so this only fixes the coordinate system: one module per unit.
    /// </summary>
    private const int UnitsPerModule = 1;

    /// <summary>Renders <paramref name="joinUrl"/> as an SVG QR code (the raw markup).</summary>
    /// <param name="joinUrl">The exact text to encode (a card's join URL). Not empty.</param>
    /// <returns>The SVG document.</returns>
    public string RenderSvg(string joinUrl)
    {
        ArgumentException.ThrowIfNullOrEmpty(joinUrl);

        // SvgQRCode owns (and disposes) the QRCodeData it renders.
        using var svg = new SvgQRCode(QRCodeGenerator.GenerateQrCode(joinUrl, ErrorCorrection));

        // The STRING-colour overload (cross-platform). No logo: a null logo writes no <image>.
        return svg.GetGraphic(
            UnitsPerModule,
            DarkColorHex,
            LightColorHex,
            drawQuietZones: true,
            sizingMode: SvgQRCode.SizingMode.ViewBoxAttribute,
            logo: null);
    }

    /// <summary>
    /// Renders <paramref name="joinUrl"/> as a QR code and returns it as <c>data:image/svg+xml;base64,…</c>. The
    /// result is written in one allocation (prefix plus base64 of the UTF-8 SVG), since a sheet may hold 500.
    /// </summary>
    /// <param name="joinUrl">The exact text to encode (a card's join URL). Not empty.</param>
    /// <returns>The SVG data URI.</returns>
    public string RenderDataUri(string joinUrl)
    {
        var bytes = Encoding.UTF8.GetBytes(RenderSvg(joinUrl));
        var base64Length = ((bytes.Length + 2) / 3) * 4;

        return string.Create(DataUriPrefix.Length + base64Length, bytes, static (destination, svgBytes) =>
        {
            DataUriPrefix.AsSpan().CopyTo(destination);
            if (!Convert.TryToBase64Chars(svgBytes, destination[DataUriPrefix.Length..], out var written)
                || written != destination.Length - DataUriPrefix.Length)
            {
                throw new InvalidOperationException("The QR data URI could not be encoded.");
            }
        });
    }
}
