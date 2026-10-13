namespace Pulse.WebApi.Tests.Features.Identity.LinkCards;

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using FluentAssertions;

/// <summary>
/// easy-login/04 (EL-12 guard): the card slice uses ONLY QRCoder's cross-platform path (<c>QRCodeGenerator</c> +
/// <c>SvgQRCode</c> with string colours). QRCoder 1.8.1 pulls <c>System.Drawing.Common</c> in transitively, so nothing
/// stops a later edit from reaching for a bitmap renderer or a <c>System.Drawing.Color</c> overload, which compile
/// everywhere and throw on Linux App Service at the first print. This sweeps the production source of
/// <c>Features/Identity/LinkCards/</c> (code only: whole-line <c>//</c> and <c>///</c> comments are dropped, nothing
/// else) so that edit fails here instead. Model-only: runs on every machine.
/// </summary>
public sealed partial class LinkCardSourceGuardTests
{
    /// <summary>The QRCoder identifiers the slice may use: the namespace, the generator and the SVG renderer.</summary>
    private static readonly HashSet<string> AllowedQrCoderIdentifiers = new(StringComparer.Ordinal)
    {
        "QRCoder",
        "QRCodeGenerator",
        "SvgQRCode",
    };

    [Fact]
    public void TheLinkCardSlice_NeverReferencesSystemDrawing_TheBitmapRenderers_OrColor()
    {
        var files = SliceFiles();
        files.Select(f => f.Name).Should().Contain(
            ["QrSvgRenderer.cs", "LinkCardService.cs", "LinkCardEndpoints.cs"], "the sweep must actually see the slice");

        foreach (var (name, code) in files)
        {
            code.Should().NotContain("System.Drawing", "{0} must not touch the Windows-only System.Drawing", name);
            DrawingColor().IsMatch(code).Should().BeFalse("{0} must not use a Color (the System.Drawing overloads)", name);
            BitmapRenderer().IsMatch(code).Should().BeFalse("{0} must not use a bitmap QR renderer", name);

            QrCoderIdentifier().Matches(code).Select(m => m.Value).Distinct()
                .Should().BeSubsetOf(AllowedQrCoderIdentifiers, "{0} may only use QRCodeGenerator and SvgQRCode", name);
        }
    }

    [Theory]
    [InlineData("    /// <see cref=\"System.Drawing.Color\"/> overloads are Windows-only.", false)]
    [InlineData("// SvgQRCode owns the QRCodeData it renders.", false)]
    [InlineData("var url = \"https://example.com\"; // trailing comment", true)]
    [InlineData("        var svg = Render(); // uses QRCode", true)]
    public void TheStripper_DropsOnlyWholeLineComments(string line, bool kept)
    {
        WholeLineComment().IsMatch(line).Should().Be(!kept, "'{0}' is {1}", line, kept ? "code, kept" : "a comment line, dropped");
    }

    [Theory]
    [InlineData("using System.Drawing;")]
    [InlineData("var c = Color.Black;")]
    [InlineData("using var qr = new QRCode(data);")]
    [InlineData("var png = new PngByteQRCode(data);")]
    [InlineData("var bmp = new BitmapByteQRCode(data);")]
    [InlineData("var art = new ArtQRCode(data);")]
    public void TheGuard_CatchesTheThingsItBans(string offendingLine)
    {
        var caught = offendingLine.Contains("System.Drawing", StringComparison.Ordinal)
            || DrawingColor().IsMatch(offendingLine)
            || BitmapRenderer().IsMatch(offendingLine)
            || QrCoderIdentifier().Matches(offendingLine).Any(m => !AllowedQrCoderIdentifiers.Contains(m.Value));

        caught.Should().BeTrue("the guard would be vacuous if it let '{0}' through", offendingLine);
    }

    /// <summary>
    /// Every production <c>.cs</c> file of the slice with its whole-line <c>//</c> and <c>///</c> comments dropped. Only
    /// WHOLE lines go: a trailing comment after code, and anything inside a string literal (<c>"https://…"</c>), stays,
    /// so the stripper can only make the guard stricter, never hide code from it.
    /// </summary>
    private static List<(string Name, string Code)> SliceFiles()
    {
        var slice = Path.Combine(FindRepositoryRoot(), "src", "Pulse.WebApi", "Features", "Identity", "LinkCards");
        Directory.Exists(slice).Should().BeTrue($"the slice lives at {slice}");

        return Directory.EnumerateFiles(slice, "*.cs", SearchOption.AllDirectories)
            .Select(path => (Path.GetFileName(path), string.Join(
                '\n',
                File.ReadLines(path).Where(line => !WholeLineComment().IsMatch(line)))))
            .ToList();
    }

    /// <summary>Walks up from the test binary to the directory holding <c>pulse.slnx</c>.</summary>
    private static string FindRepositoryRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "pulse.slnx")))
            {
                return directory.FullName;
            }
        }

        throw new InvalidOperationException($"Could not locate pulse.slnx above '{AppContext.BaseDirectory}'.");
    }

    /// <summary>A line that is nothing but a <c>//</c> or <c>///</c> comment (leading whitespace allowed).</summary>
    [GeneratedRegex(@"^\s*//", RegexOptions.CultureInvariant)]
    private static partial Regex WholeLineComment();

    /// <summary><c>Color</c> as a whole identifier (not <c>DarkColorHex</c>).</summary>
    [GeneratedRegex(@"\bColor\b", RegexOptions.CultureInvariant)]
    private static partial Regex DrawingColor();

    /// <summary>QRCoder's bitmap / raster renderers: <c>QRCode</c> itself and the byte/art/xaml/postscript/pdf family.</summary>
    [GeneratedRegex(@"\b(QRCode|\w+ByteQRCode|ArtQRCode|XamlQRCode|PostscriptQRCode|Base64QRCode)\b", RegexOptions.CultureInvariant)]
    private static partial Regex BitmapRenderer();

    /// <summary>Any identifier containing <c>QRCode</c> (or the <c>QRCoder</c> namespace).</summary>
    [GeneratedRegex(@"\b\w*QRCode\w*\b", RegexOptions.CultureInvariant)]
    private static partial Regex QrCoderIdentifier();
}
