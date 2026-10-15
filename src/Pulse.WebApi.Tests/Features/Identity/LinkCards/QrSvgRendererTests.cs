namespace Pulse.WebApi.Tests.Features.Identity.LinkCards;

using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;
using FluentAssertions;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.LinkCards;
using QRCoder;

/// <summary>
/// easy-login/04 (QR AC, EL-12): <see cref="QrSvgRenderer"/> turns a join URL into
/// <c>data:image/svg+xml;base64,…</c> for an SVG that encodes EXACTLY that URL: its module matrix equals the
/// <see cref="QRCodeData"/> QRCoder generates for the same URL at error correction M, quiet zone included, black on
/// white, with a <c>viewBox</c> and no width or height. The SVG is well-formed XML with no script, image, href or
/// external reference, and the data URI passes the frontend's <c>safeQrDataUri.ts</c> gate. Pure (no host, no SQL).
/// </summary>
public sealed partial class QrSvgRendererTests
{
    private const string SvgNamespace = "http://www.w3.org/2000/svg";

    /// <summary>The width of the quiet zone QRCoder pads the matrix with, in modules.</summary>
    private const int QuietZone = 4;

    private static readonly QrSvgRenderer Renderer = new();

    /// <summary>A join URL of the real shape: the UAT SPA origin plus a 22-character token.</summary>
    private static string JoinUrl(string? token = null) =>
        $"https://pulse-uat.cobrasoftware.com/join/{token ?? ParticipantLinkTokens.Generate()}";

    [Fact]
    public void TheRenderedModuleMatrix_EqualsQRCodersMatrix_ForTheSameUrl_AtErrorCorrectionM()
    {
        var url = JoinUrl();

        var rendered = RenderedMatrix(Renderer.RenderSvg(url));
        var expected = ExpectedMatrix(url, QRCodeGenerator.ECCLevel.M);

        rendered.Should().BeEquivalentTo(expected, options => options.WithStrictOrdering(),
            "every dark module drawn must be a dark module of QRCoder's own matrix for exactly this URL, and vice versa");
    }

    [Theory]
    [InlineData(QRCodeGenerator.ECCLevel.L)]
    [InlineData(QRCodeGenerator.ECCLevel.Q)]
    [InlineData(QRCodeGenerator.ECCLevel.H)]
    public void TheRenderedMatrix_IsNotTheMatrixOfAnyOtherErrorCorrectionLevel(QRCodeGenerator.ECCLevel other)
    {
        var url = JoinUrl();

        var rendered = RenderedMatrix(Renderer.RenderSvg(url));

        // The format bits carry the level, so a different level is always a different matrix: this pins M.
        rendered.Should().NotBeEquivalentTo(ExpectedMatrix(url, other), options => options.WithStrictOrdering());
    }

    [Fact]
    public void AnotherUrl_GivesAnotherMatrix()
    {
        var token = ParticipantLinkTokens.Generate();
        var otherToken = ParticipantLinkTokens.Generate();

        RenderedMatrix(Renderer.RenderSvg(JoinUrl(token)))
            .Should().NotBeEquivalentTo(
                ExpectedMatrix(JoinUrl(otherToken), QRCodeGenerator.ECCLevel.M), options => options.WithStrictOrdering(),
                "the QR encodes the card's own URL, not some other card's");
    }

    [Fact]
    public void TheSvg_IsWellFormedXml_WithAViewBoxTheSizeOfTheMatrix_AndNoWidthOrHeight()
    {
        var url = JoinUrl();
        var size = ExpectedMatrix(url, QRCodeGenerator.ECCLevel.M).Length;

        var root = Parse(Renderer.RenderSvg(url));

        root.Name.Should().Be(XName.Get("svg", SvgNamespace));
        root.Attribute("viewBox")!.Value.Should().Be($"0 0 {size} {size}", "one module per user unit, quiet zone included");
        root.Attribute("width").Should().BeNull("a viewBox without width/height lets the page scale the QR");
        root.Attribute("height").Should().BeNull();
    }

    [Fact]
    public void TheSvg_IsBlackModulesOnAWhiteBackground_ThatCoversTheWholeCode()
    {
        var url = JoinUrl();
        var size = ExpectedMatrix(url, QRCodeGenerator.ECCLevel.M).Length.ToString(CultureInfo.InvariantCulture);

        var root = Parse(Renderer.RenderSvg(url));

        var background = root.Elements(XName.Get("rect", SvgNamespace)).Should().ContainSingle().Subject;
        background.Attribute("x")!.Value.Should().Be("0");
        background.Attribute("y")!.Value.Should().Be("0");
        background.Attribute("width")!.Value.Should().Be(size);
        background.Attribute("height")!.Value.Should().Be(size);
        background.Attribute("fill")!.Value.Should().BeEquivalentTo("#ffffff", "the background (and quiet zone) is white");

        root.Elements(XName.Get("path", SvgNamespace)).Should().ContainSingle()
            .Which.Attribute("fill")!.Value.Should().BeEquivalentTo("#000000", "modules are black");
    }

    [Fact]
    public void TheQuietZone_IsDrawn_AndHoldsNoDarkModule()
    {
        var url = JoinUrl();

        var rendered = RenderedMatrix(Renderer.RenderSvg(url));
        var size = rendered.Length;

        var darkInQuietZone =
            from y in Enumerable.Range(0, size)
            from x in Enumerable.Range(0, size)
            where rendered[y][x] && (x < QuietZone || y < QuietZone || x >= size - QuietZone || y >= size - QuietZone)
            select (x, y);

        darkInQuietZone.Should().BeEmpty("a four-module white margin is what lets a phone camera find the code");
        rendered[QuietZone][QuietZone].Should().BeTrue("the top-left finder pattern starts right after the quiet zone");
    }

    [Fact]
    public void TheSvg_HasNoScriptImageHrefOrExternalReference()
    {
        var svg = Renderer.RenderSvg(JoinUrl());
        var root = Parse(svg);

        root.DescendantsAndSelf().Select(e => e.Name.LocalName).Distinct()
            .Should().BeSubsetOf(["svg", "rect", "path"], "only the root, the background and the module path are drawn");
        root.DescendantsAndSelf().Should().OnlyContain(e => e.Name.NamespaceName == SvgNamespace);

        var attributes = root.DescendantsAndSelf().SelectMany(e => e.Attributes()).ToList();
        attributes.Select(a => a.Name.LocalName)
            .Should().NotContain(name => name.Equals("href", StringComparison.OrdinalIgnoreCase)
                || name.StartsWith("on", StringComparison.OrdinalIgnoreCase)
                || name.Equals("style", StringComparison.OrdinalIgnoreCase));
        attributes.Where(a => !a.IsNamespaceDeclaration)
            .Should().OnlyContain(
                a => !a.Value.Contains("://", StringComparison.Ordinal) && !a.Value.Contains("url(", StringComparison.OrdinalIgnoreCase),
                "no attribute may point anywhere: the only URI in the document is the SVG namespace itself");
        attributes.Where(a => a.IsNamespaceDeclaration).Select(a => a.Value)
            .Should().Equal([SvgNamespace], "no xlink (or any other) namespace is declared");

        svg.Should().NotContainAny(["<script", "<image", "href", "<!DOCTYPE", "<!ENTITY", "<foreignObject", "<use"]);
    }

    [Fact]
    public void TheSvg_NeverCarriesTheUrlItself_OnlyModuleGeometry()
    {
        var token = ParticipantLinkTokens.Generate();

        var svg = Renderer.RenderSvg(JoinUrl(token));

        svg.Should().NotContain(token, "the URL is encoded as modules; its text never appears in the markup");
        svg.Should().NotContain("cobrasoftware");
    }

    [Fact]
    public void TheDataUri_IsTheBase64OfTheUtf8Svg()
    {
        var url = JoinUrl();

        var dataUri = Renderer.RenderDataUri(url);

        dataUri.Should().StartWith(QrSvgRenderer.DataUriPrefix).And.StartWith("data:image/svg+xml;base64,");
        var svg = Encoding.UTF8.GetString(Convert.FromBase64String(dataUri[QrSvgRenderer.DataUriPrefix.Length..]));
        svg.Should().Be(Renderer.RenderSvg(url), "the data URI is exactly the rendered SVG, base64-encoded");
        RenderedMatrix(svg).Should().BeEquivalentTo(ExpectedMatrix(url, QRCodeGenerator.ECCLevel.M), o => o.WithStrictOrdering());
    }

    [Theory]
    [InlineData("https://pulse-uat.cobrasoftware.com")]
    [InlineData("http://localhost:5198")]
    [InlineData("https://a-very-long-frontend-host-name-for-an-agency.exercise.example.gov/pulse/participant/spa/v1")]
    public void TheDataUri_PassesTheFrontendGate_RegexAndSizeCap(string frontendBase)
    {
        for (var i = 0; i < 25; i++)
        {
            var dataUri = Renderer.RenderDataUri($"{frontendBase}/join/{ParticipantLinkTokens.Generate()}");

            FrontendQrGate.Admits(dataUri).Should().BeTrue(
                "safeQrDataUri.ts admits only data:image/svg+xml;base64,<base64> under 512 KB, and anything else is not shown");
            dataUri.Length.Should().BeLessThan(64 * 1024, "a join-URL QR is a few KB, far under the gate's cap");
        }
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void AnEmptyUrl_IsRefused(string? url)
    {
        var render = () => Renderer.RenderDataUri(url!);

        render.Should().Throw<ArgumentException>("an empty QR would print a card that signs no one in");
    }

    [Fact]
    public void TheRenderer_IsTheCrossPlatformSvgPath_NeverSystemDrawing()
    {
        // Calling it at all on Linux CI proves no Windows-only System.Drawing path is reached.
        var svg = Renderer.RenderSvg(JoinUrl());

        svg.Should().StartWith("<svg");
    }

    /// <summary>Parses the SVG with DTDs prohibited, so a well-formedness failure (or a DOCTYPE) throws.</summary>
    private static XElement Parse(string svg)
    {
        using var reader = XmlReader.Create(
            new StringReader(svg),
            new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null });
        return XDocument.Load(reader).Root!;
    }

    /// <summary>QRCoder's own module matrix for <paramref name="url"/>, quiet zone included, as rows of booleans.</summary>
    private static bool[][] ExpectedMatrix(string url, QRCodeGenerator.ECCLevel level)
    {
        using var data = QRCodeGenerator.GenerateQrCode(url, level);
        return data.ModuleMatrix.Select(row => Enumerable.Range(0, row.Length).Select(i => row[i]).ToArray()).ToArray();
    }

    /// <summary>
    /// The module matrix the SVG DRAWS: the viewBox gives the size, and every <c>M{x} {y}h{w}v1h-{w}z</c> run of the
    /// one path darkens <c>w</c> modules of row <c>y</c> from column <c>x</c>. The whole path must be such runs, so any
    /// other drawing command fails the test instead of being silently ignored.
    /// </summary>
    private static bool[][] RenderedMatrix(string svg)
    {
        var root = Parse(svg);
        var viewBox = root.Attribute("viewBox")!.Value.Split(' ');
        viewBox[0].Should().Be("0");
        viewBox[1].Should().Be("0");
        viewBox[2].Should().Be(viewBox[3], "a QR code is square");
        var size = int.Parse(viewBox[2], CultureInfo.InvariantCulture);

        var path = root.Elements(XName.Get("path", SvgNamespace)).Single().Attribute("d")!.Value;
        var runs = ModuleRun().Matches(path);
        string.Concat(runs.Select(m => m.Value)).Should().Be(path, "the path holds nothing but module runs");

        var matrix = Enumerable.Range(0, size).Select(_ => new bool[size]).ToArray();
        foreach (Match run in runs)
        {
            var x = int.Parse(run.Groups["x"].Value, CultureInfo.InvariantCulture);
            var y = int.Parse(run.Groups["y"].Value, CultureInfo.InvariantCulture);
            var width = int.Parse(run.Groups["w"].Value, CultureInfo.InvariantCulture);
            for (var dx = 0; dx < width; dx++)
            {
                matrix[y][x + dx].Should().BeFalse("no module is drawn twice");
                matrix[y][x + dx] = true;
            }
        }

        return matrix;
    }

    [GeneratedRegex(@"M(?<x>\d+) (?<y>\d+)h(?<w>\d+)v1h-\k<w>z", RegexOptions.CultureInvariant)]
    private static partial Regex ModuleRun();
}
