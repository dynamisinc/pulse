namespace Pulse.WebApi.Tests.Features.Media;

using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// demo-polish BM — the standing isolation suite extended to media (XC-001 / COR-001, always-Critical). Real SQL,
/// real <c>Program</c> pipeline. Proves exercise B's caller cannot LIST, MINT or ATTACH exercise A's media:
/// the library is scoped; a scoped context finds nothing by a known cross-exercise id (IDOR) and an unset scope
/// sees zero rows while <c>IgnoreQueryFilters()</c> proves they exist; the REGISTERED signer throws for an
/// out-of-scope row even if one leaks; and (DP-16) another exercise's REAL asset id used as <c>posterMediaId</c>
/// gets the byte-identical 400 an unknown id gets, with zero rows and zero blobs written.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class MediaIsolationTests
{
    private readonly MsSqlContainerFixture _fixture;

    public MediaIsolationTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>
    /// DP-16 (required at Gate 1): B's real image id, written under scope A as <c>posterMediaId</c>, is
    /// indistinguishable from an unknown id — same status, same body — and nothing is written. B's image was even
    /// uploaded by the SAME acting human, so only the exercise boundary can be what refuses it.
    /// </summary>
    [RequiresDockerFact]
    public async Task PosterIdFromAnotherExercise_GetsTheSame400AsAnUnknownId_AndWritesNothing()
    {
        MediaSeed.SeededExercise exerciseA;
        MediaSeed.SeededExercise exerciseB;
        MediaSeed.SeededSession participantA;
        MediaAsset imageInB;
        await using (var db = _fixture.CreateContext())
        {
            exerciseA = MediaSeed.NewExercise(db);
            exerciseB = MediaSeed.NewExercise(db);
            participantA = MediaSeed.Participant(db, exerciseA);
            imageInB = MediaSeed.Asset(db, exerciseB, uploadedBy: participantA.Session.ActingHumanId);
            await db.SaveChangesAsync();
        }

        await using var host = new MediaTestHost(_fixture.ConnectionString!);
        using var client = host.CreateClientFor(exerciseA.Host, participantA.Token);

        async Task<(HttpStatusCode Status, string Body)> UploadVideoWithPoster(string posterId)
        {
            using var response = await client.PostAsync(new Uri("/api/media", UriKind.Relative), MediaTestFiles.Form(
                MediaTestFiles.Mp4(), "clip.mp4", "video/mp4", [MediaTestFiles.Field("posterMediaId", posterId)]));
            return (response.StatusCode, await response.Content.ReadAsStringAsync());
        }

        var crossExercise = await UploadVideoWithPoster(imageInB.Id.ToString());
        var unknown = await UploadVideoWithPoster(Guid.NewGuid().ToString());

        crossExercise.Status.Should().Be(HttpStatusCode.BadRequest, "another exercise's asset does not resolve in this scope");
        crossExercise.Should().Be(unknown, "the cross-exercise id gets the SAME 4xx and the SAME body as an unknown id — nothing confirms it exists");

        await using var check = _fixture.CreateContext();
        (await check.MediaAssets.IgnoreQueryFilters().CountAsync(asset => asset.ExerciseId == exerciseA.ExerciseId))
            .Should().Be(0, "zero rows are written in exercise A");
        (await check.MediaAssets.IgnoreQueryFilters().CountAsync(asset => asset.ExerciseId == exerciseB.ExerciseId))
            .Should().Be(1, "and exercise B is untouched");
        (Directory.Exists(host.LocalRoot) ? Directory.EnumerateFiles(host.LocalRoot, "*", SearchOption.AllDirectories) : [])
            .Should().BeEmpty("the streamed video blob is deleted too");
    }

    [RequiresDockerFact]
    public async Task Library_ReturnsOnlyTheResolvedExercisesMedia_AndNeverAnotherExercises()
    {
        MediaSeed.SeededExercise exerciseA;
        MediaSeed.SeededExercise exerciseB;
        MediaSeed.SeededSession staffA;
        MediaSeed.SeededSession staffB;
        MediaAsset[] assetsA;
        MediaAsset assetB;
        await using (var db = _fixture.CreateContext())
        {
            exerciseA = MediaSeed.NewExercise(db);
            exerciseB = MediaSeed.NewExercise(db);
            staffA = MediaSeed.Staff(db, exerciseA);
            staffB = MediaSeed.Staff(db, exerciseB);
            assetsA = [MediaSeed.Asset(db, exerciseA), MediaSeed.Asset(db, exerciseA, MediaKinds.Video)];
            assetB = MediaSeed.Asset(db, exerciseB);
            await db.SaveChangesAsync();
        }

        await using var host = new MediaTestHost(_fixture.ConnectionString!);

        var listA = await ListIdsAsync(host, exerciseA, staffA);
        var listB = await ListIdsAsync(host, exerciseB, staffB);

        listA.Should().BeEquivalentTo(assetsA.Select(asset => asset.Id.ToString()), "A's staff sees A's media");
        listA.Should().NotContain(assetB.Id.ToString(), "and never B's");
        listB.Should().Equal([assetB.Id.ToString()], "B's staff sees only B's media");

        await using var check = _fixture.CreateContext();
        (await check.MediaAssets.IgnoreQueryFilters()
                .CountAsync(asset => asset.ExerciseId == exerciseA.ExerciseId || asset.ExerciseId == exerciseB.ExerciseId))
            .Should().Be(3, "the rows all exist — the narrower lists are the filter closing the door, not an empty table");
    }

    [RequiresDockerFact]
    public async Task ScopedReads_FindNothingByACrossExerciseId_AndAnUnsetScopeSeesZero()
    {
        MediaSeed.SeededExercise exerciseA;
        MediaSeed.SeededExercise exerciseB;
        MediaAsset assetA;
        await using (var db = _fixture.CreateContext())
        {
            exerciseA = MediaSeed.NewExercise(db);
            exerciseB = MediaSeed.NewExercise(db);
            assetA = MediaSeed.Asset(db, exerciseA);
            MediaSeed.Asset(db, exerciseB);
            await db.SaveChangesAsync();
        }

        await using var scopedToB = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseB.ExerciseId });
        await using var unscoped = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = null });
        await using var raw = _fixture.CreateContext();

        (await scopedToB.MediaAssets.FindAsync(assetA.Id)).Should().BeNull("IDOR: a known id from exercise A resolves to nothing under B");
        (await scopedToB.MediaAssets.SingleOrDefaultAsync(asset => asset.Id == assetA.Id)).Should().BeNull();
        (await scopedToB.MediaAssets.CountAsync()).Should().Be(1, "B's aggregate count does not include A's media");
        (await unscoped.MediaAssets.CountAsync()).Should().Be(0, "an unset scope fails closed to ZERO rows, never all exercises");
        (await raw.MediaAssets.IgnoreQueryFilters().AnyAsync(asset => asset.Id == assetA.Id)).Should().BeTrue("the row does exist");
    }

    [RequiresDockerFact]
    public async Task TheRegisteredSigner_RefusesToMintAnotherExercisesAsset_EvenIfTheRowLeaks()
    {
        MediaSeed.SeededExercise exerciseA;
        MediaSeed.SeededExercise exerciseB;
        MediaAsset assetA;
        await using (var db = _fixture.CreateContext())
        {
            exerciseA = MediaSeed.NewExercise(db);
            exerciseB = MediaSeed.NewExercise(db);
            assetA = MediaSeed.Asset(db, exerciseA);
            await db.SaveChangesAsync();
        }

        await using var raw = _fixture.CreateContext();
        var leaked = await raw.MediaAssets.IgnoreQueryFilters().AsNoTracking().SingleAsync(asset => asset.Id == assetA.Id);

        await using var host = new MediaTestHost(_fixture.ConnectionString!);
        using var scope = host.Services.CreateScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = exerciseB.ExerciseId;
        var signer = scope.ServiceProvider.GetRequiredService<IMediaUrlSigner>();

        var single = () => signer.GetReadUrlAsync(leaked, CancellationToken.None);
        var batch = () => signer.GetReadUrlsAsync([leaked], CancellationToken.None);

        await single.Should().ThrowAsync<ExerciseScopeViolationException>("a URL is never minted outside the caller's exercise (COR-002)");
        await batch.Should().ThrowAsync<ExerciseScopeViolationException>();
    }

    private static async Task<string[]> ListIdsAsync(MediaTestHost host, MediaSeed.SeededExercise exercise, MediaSeed.SeededSession staff)
    {
        using var client = host.CreateClientFor(exercise.Host, staff.Token);
        using var response = await client.GetAsync(new Uri("/api/staff/media", UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.EnumerateArray().Select(item => item.GetProperty("id").GetString()!).ToArray();
    }
}
