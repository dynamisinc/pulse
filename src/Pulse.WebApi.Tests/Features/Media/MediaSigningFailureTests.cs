namespace Pulse.WebApi.Tests.Features.Media;

using System;
using System.IO;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Tests.Features.Social;
using Xunit;

/// <summary>
/// Wave 1b Gate-2 L-2: a media-SIGNING fault is a storage outage, answered <c>503 {"error":"media-store-unavailable"}</c>
/// — never a 500. An upload whose row and blob already committed keeps them (only the response URL could not be
/// minted), and the staff library degrades the same way on ANY signing fault, not just "no store configured". Real
/// <c>Program</c> host (<see cref="MediaTestHost"/>: Development, the Local store), real SQL.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class MediaSigningFailureTests
{
    private readonly MsSqlContainerFixture _fixture;

    public MediaSigningFailureTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerTheory]
    [InlineData("azure-request-failed")]
    [InlineData("timeout")]
    [InlineData("invalid-operation")]
    public async Task SigningFailsAfterTheUploadCommitted_Is503MediaStoreUnavailable_AndTheAssetRowAndBlobStay(string failureKind)
    {
        MediaSeed.SeededExercise exercise;
        MediaSeed.SeededSession participant;
        await using (var db = _fixture.CreateContext())
        {
            exercise = MediaSeed.NewExercise(db);
            participant = MediaSeed.Participant(db, exercise);
            await db.SaveChangesAsync();
        }

        await using var host = HostWithThrowingSigner(Failure(failureKind));
        using var client = host.CreateClientFor(exercise.Host, participant.Token);

        using var response = await client.PostAsync(new Uri("/api/media", UriKind.Relative), MediaTestFiles.Form(MediaTestFiles.Png(2048), "photo.png"));

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable, "a storage-auth outage is a 503 the client can retry, never a 500 ({0})", failureKind);
        AssertStoreUnavailableBody(await response.Content.ReadAsStringAsync());

        await using var check = _fixture.CreateContext();
        var row = await check.MediaAssets.IgnoreQueryFilters().SingleAsync(asset => asset.ExerciseId == exercise.ExerciseId);
        row.UploadedByHumanId.Should().Be(participant.Session.ActingHumanId, "the committed row stays — it is a real, usable asset");
        File.Exists(Path.Combine(host.LocalRoot, row.BlobName)).Should().BeTrue("the committed blob is not deleted as if the upload had failed");
    }

    [RequiresDockerTheory]
    [InlineData("azure-request-failed")]
    [InlineData("timeout")]
    [InlineData("invalid-operation")]
    public async Task TheStaffLibrary_IsA503OnAnySigningFault_NotOnlyWhenNoStoreIsConfigured(string failureKind)
    {
        MediaSeed.SeededExercise exercise;
        MediaSeed.SeededSession staff;
        await using (var db = _fixture.CreateContext())
        {
            exercise = MediaSeed.NewExercise(db);
            staff = MediaSeed.Staff(db, exercise);
            MediaSeed.Asset(db, exercise);
            await db.SaveChangesAsync();
        }

        await using var host = HostWithThrowingSigner(Failure(failureKind));
        using var client = host.CreateClientFor(exercise.Host, staff.Token);

        using var response = await client.GetAsync(new Uri("/api/staff/media", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable, "any signing fault degrades like an unconfigured store ({0})", failureKind);
        AssertStoreUnavailableBody(await response.Content.ReadAsStringAsync());
    }

    private static void AssertStoreUnavailableBody(string body)
    {
        using var json = JsonDocument.Parse(body);
        json.RootElement.GetProperty("error").GetString().Should().Be(MediaEndpoints.StoreUnavailableErrorCode);
    }

    private static Exception Failure(string kind) => kind switch
    {
        "azure-request-failed" => new Azure.RequestFailedException(403, "AuthorizationPermissionMismatch"),
        "timeout" => new TimeoutException("delegation key fetch timed out"),
        _ => new InvalidOperationException("The issued user delegation key does not outlive the SAS it must sign."),
    };

    private MediaTestHost HostWithThrowingSigner(Exception failure) =>
        new(_fixture.ConnectionString!, configureServices: services =>
        {
            services.RemoveAll<IMediaUrlSigner>();
            services.AddSingleton<IMediaUrlSigner>(new ThrowingMediaUrlSigner(failure));
        });
}
