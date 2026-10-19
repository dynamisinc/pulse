namespace Pulse.WebApi.Tests.Features.Media;

using System;
using System.IO;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Xunit;

/// <summary>
/// #379 — <c>POST /api/media</c> is a participant sim write, so it is refused with <c>409 {"reason":"frozen"}</c>
/// while the exercise is in lifecycle <c>paused</c> or at the <c>Freeze</c> pause tier, before anything is stored;
/// the <c>Injects</c> / <c>Engine</c> tiers leave it alone, and a staff upload is never refused.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class MediaPausedUploadTests
{
    private static readonly Uri MediaUri = new("/api/media", UriKind.Relative);

    private readonly MsSqlContainerFixture _fixture;

    public MediaPausedUploadTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerTheory]
    [InlineData("paused")]
    [InlineData("freeze")]
    public async Task ParticipantUpload_WhileHeld_Is409Frozen_AndStoresNothing(string condition)
    {
        MediaSeed.SeededExercise exercise;
        MediaSeed.SeededSession participant;
        await using (var db = _fixture.CreateContext())
        {
            exercise = MediaSeed.NewExercise(db, condition == "paused" ? "paused" : "live");
            participant = MediaSeed.Participant(db, exercise);
            await db.SaveChangesAsync();
        }

        await using var host = NewHost();
        if (condition == "freeze")
        {
            (await SetTierAsync(host, exercise, PauseTier.Freeze)).Outcome.Should().Be(PauseTierOutcome.Applied);
        }

        using var client = host.CreateClientFor(exercise.Host, participant.Token);
        using var response = await client.PostAsync(MediaUri, MediaTestFiles.Form(MediaTestFiles.Png(), "p.png"));

        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.Conflict, $"a participant upload is refused while {condition}; got {body}");
        JsonDocument.Parse(body).RootElement.GetProperty("reason").GetString().Should().Be("frozen");

        await using var check = _fixture.CreateContext();
        (await check.MediaAssets.IgnoreQueryFilters().CountAsync(asset => asset.ExerciseId == exercise.ExerciseId))
            .Should().Be(0, "no MediaAsset row is written");
        (Directory.Exists(host.LocalRoot) ? Directory.EnumerateFiles(host.LocalRoot, "*", SearchOption.AllDirectories) : [])
            .Should().BeEmpty("no blob is stored");
    }

    [RequiresDockerTheory]
    [InlineData(PauseTier.Injects)]
    [InlineData(PauseTier.Engine)]
    public async Task ParticipantUpload_AtTheInjectsOrEngineTier_IsStillAccepted(PauseTier tier)
    {
        MediaSeed.SeededExercise exercise;
        MediaSeed.SeededSession participant;
        await using (var db = _fixture.CreateContext())
        {
            exercise = MediaSeed.NewExercise(db);
            participant = MediaSeed.Participant(db, exercise);
            await db.SaveChangesAsync();
        }

        await using var host = NewHost();
        (await SetTierAsync(host, exercise, tier)).Outcome.Should().Be(PauseTierOutcome.Applied);

        using var client = host.CreateClientFor(exercise.Host, participant.Token);
        using var response = await client.PostAsync(MediaUri, MediaTestFiles.Form(MediaTestFiles.Png(), "p.png"));

        response.StatusCode.Should().Be(HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
    }

    [RequiresDockerTheory]
    [InlineData("paused")]
    [InlineData("freeze")]
    public async Task StaffUpload_WhileHeld_IsNotRefused(string condition)
    {
        MediaSeed.SeededExercise exercise;
        MediaSeed.SeededSession staff;
        await using (var db = _fixture.CreateContext())
        {
            exercise = MediaSeed.NewExercise(db, condition == "paused" ? "paused" : "live");
            staff = MediaSeed.Staff(db, exercise);
            await db.SaveChangesAsync();
        }

        await using var host = NewHost();
        if (condition == "freeze")
        {
            (await SetTierAsync(host, exercise, PauseTier.Freeze)).Outcome.Should().Be(PauseTierOutcome.Applied);
        }

        using var client = host.CreateClientFor(exercise.Host, staff.Token);
        using var response = await client.PostAsync(MediaUri, MediaTestFiles.Form(MediaTestFiles.Png(), "p.png"));

        response.StatusCode.Should().Be(HttpStatusCode.Created,
            "staff authoring continues while the world is held: " + await response.Content.ReadAsStringAsync());
    }

    private MediaTestHost NewHost() => new(_fixture.ConnectionString!, "Development", null);

    private static Task<PauseTierResult> SetTierAsync(MediaTestHost host, MediaSeed.SeededExercise exercise, PauseTier tier) =>
        host.Services.GetRequiredService<PauseTierRegistry>().SetTierAsync(
            exercise.ExerciseId, tier, "controller-1", new PauseClockStart(MediaSeed.ScenarioTime, TimeZoneInfo.Utc));
}
