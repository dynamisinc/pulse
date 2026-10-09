namespace Pulse.WebApi.Tests.Features.Media;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Xunit;

/// <summary>
/// Wave 1b Gate-2 H-1: the stored original file name can never carry a live tag. The old order sanitized markup
/// FIRST and removed control characters AFTER, so <c>"&lt;\u0001img src=x onerror=…&gt;.png"</c> (not a tag while
/// the control character sits after the <c>&lt;</c>) was stored as a live <c>&lt;img …&gt;</c>, and the staff
/// library served it. A participant can send it through <c>filename*=UTF-8''%3C%01img…</c>. Real <c>Program</c>
/// host, real multipart parsing, real SQL.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed partial class MediaFileNameHardeningTests
{
    private readonly MsSqlContainerFixture _fixture;

    public MediaFileNameHardeningTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerTheory]
    [InlineData("%01")]
    [InlineData("%00")]
    [InlineData("%09")]
    public async Task AControlCharacterInsideATag_ThroughFilenameStar_IsNeverStoredOrServedAsALiveTag(string control)
    {
        MediaSeed.SeededExercise exercise;
        MediaSeed.SeededSession participant;
        MediaSeed.SeededSession staff;
        await using (var db = _fixture.CreateContext())
        {
            exercise = MediaSeed.NewExercise(db);
            participant = MediaSeed.Participant(db, exercise);
            staff = MediaSeed.Staff(db, exercise);
            await db.SaveChangesAsync();
        }

        await using var host = new MediaTestHost(_fixture.ConnectionString!);
        using var uploader = host.CreateClientFor(exercise.Host, participant.Token);

        // The exact wire form a participant can send: RFC 5987 filename* with a percent-encoded control character.
        var encodedName = $"%3C{control}img%20src%3Dx%20onerror%3Dalert%281%29%3E.png";
        using var upload = await uploader.PostAsync(new Uri("/api/media", UriKind.Relative), RawMultipart(encodedName, MediaTestFiles.Png(2048)));
        upload.StatusCode.Should().Be(HttpStatusCode.Created, await upload.Content.ReadAsStringAsync());
        var id = Guid.Parse(JsonDocument.Parse(await upload.Content.ReadAsStringAsync()).RootElement.GetProperty("id").GetString()!);

        await using (var read = _fixture.CreateContext())
        {
            var stored = (await read.MediaAssets.IgnoreQueryFilters().SingleAsync(asset => asset.Id == id)).OriginalFileName;
            AssertInert(stored, control);
            stored.Should().Be(".png", "the whole tag is stripped once the control character is gone; the extension remains");
        }

        using var library = host.CreateClientFor(exercise.Host, staff.Token);
        using var list = await library.GetAsync(new Uri("/api/staff/media", UriKind.Relative));
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var item = JsonDocument.Parse(await list.Content.ReadAsStringAsync()).RootElement.EnumerateArray()
            .Single(element => element.GetProperty("id").GetString() == id.ToString());
        AssertInert(item.GetProperty("fileName").GetString()!, control);
    }

    [Fact]
    public void AnyFileName_IsStoredWithNoTag_AsAFixedPointOfTheSanitizer()
    {
        // Property: whatever the client sends — markup, control characters (including inside tags), path separators,
        // whitespace — the stored name contains no complete tag and re-sanitizing it changes nothing.
        var random = new Random(911);
        const string alphabet = "<<>>//\\\\abimgsrcxonerror=() \t\u0000\u0001\u001f\u007f\u0085.";
        for (var sample = 0; sample < 20_000; sample++)
        {
            var chars = new char[random.Next(0, 48)];
            for (var i = 0; i < chars.Length; i++)
            {
                chars[i] = alphabet[random.Next(alphabet.Length)];
            }

            var input = new string(chars);
            var stored = MediaUploadService.SanitizeFileName(input, "png");

            AnyTag().IsMatch(stored).Should().BeFalse("no tag may be stored: {0} → {1}", Escape(input), stored);
            PostSanitizer.Sanitize(stored).Should().Be(stored, "the stored name is a fixed point: {0}", Escape(input));
            MediaUploadService.SanitizeFileName(stored, "png").Should().Be(stored, "normalizing again changes nothing: {0}", Escape(input));
            stored.Any(char.IsControl).Should().BeFalse("no control character is stored: {0}", Escape(input));
        }
    }

    private static void AssertInert(string name, string control)
    {
        name.Should().NotContain("<img", "no live tag is stored or served ({0})", control);
        name.Should().NotContain("onerror");
        AnyTag().IsMatch(name).Should().BeFalse();
        name.Any(char.IsControl).Should().BeFalse();
    }

    private static string Escape(string value) =>
        string.Concat(value.Select(c => char.IsControl(c) ? $"\\u{(int)c:x4}" : c.ToString()));

    private static ByteArrayContent RawMultipart(string encodedFileNameStar, byte[] file)
    {
        const string boundary = "pulse-h1-boundary";
        var head = Encoding.ASCII.GetBytes(
            $"--{boundary}\r\n"
            + $"Content-Disposition: form-data; name=\"file\"; filename*=UTF-8''{encodedFileNameStar}\r\n"
            + "Content-Type: application/octet-stream\r\n\r\n");
        var tail = Encoding.ASCII.GetBytes($"\r\n--{boundary}--\r\n");
        var content = new ByteArrayContent([.. head, .. file, .. tail]);
        content.Headers.ContentType = MediaTypeHeaderValue.Parse($"multipart/form-data; boundary={boundary}");
        return content;
    }

    [GeneratedRegex(@"</?[a-zA-Z][^>]*>")]
    private static partial Regex AnyTag();
}
