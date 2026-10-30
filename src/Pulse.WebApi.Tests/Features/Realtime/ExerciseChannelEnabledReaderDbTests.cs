namespace Pulse.WebApi.Tests.Features.Realtime;

using System;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// Channels-foundation story 09: the PRODUCTION, database-backed <see cref="ExerciseChannelEnabledReader"/> against a real
/// SQL Server (Docker), resolved from a singleton provider through its own scope per call, as the broadcaster uses it.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ExerciseChannelEnabledReaderDbTests
{
    private readonly MsSqlContainerFixture _fixture;

    public ExerciseChannelEnabledReaderDbTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task RealReader_ReadsTheStoredSet_FallsBackToTheDefault_AndFailsClosedOnAMissingRow()
    {
        var configured = await SeedExerciseAsync("social,news");
        var unconfigured = await SeedExerciseAsync(null);
        var reader = BuildReader();

        (await reader(configured, "news", CancellationToken.None)).Should().BeTrue();
        (await reader(configured, "weather", CancellationToken.None)).Should().BeFalse();
        (await reader(unconfigured, "social", CancellationToken.None)).Should().BeTrue("null → the social-only default");
        (await reader(unconfigured, "news", CancellationToken.None)).Should().BeFalse("null → the social-only default");
        (await reader(Guid.NewGuid(), "social", CancellationToken.None)).Should().BeFalse("no exercise row fails closed");
    }

    [RequiresDockerFact]
    public async Task RealReader_SeesAPlannersToggle_OnTheVeryNextRead()
    {
        var exerciseId = await SeedExerciseAsync("social");
        var reader = BuildReader();
        (await reader(exerciseId, "news", CancellationToken.None)).Should().BeFalse();

        await using (var context = _fixture.CreateContext())
        {
            var exercise = await context.Exercises.FindAsync(exerciseId);
            exercise!.EnabledChannels = "social,news";
            await context.SaveChangesAsync();
        }

        (await reader(exerciseId, "news", CancellationToken.None)).Should().BeTrue("no cache beyond one read");
    }

    private ExerciseChannelEnabledReader BuildReader()
    {
        var services = new ServiceCollection();
        services.AddScoped(_ => _fixture.CreateContext());
        services.TryAddExerciseChannelEnabledReader();
        return services.BuildServiceProvider().GetRequiredService<ExerciseChannelEnabledReader>();
    }

    private async Task<Guid> SeedExerciseAsync(string? enabledChannels)
    {
        var exerciseId = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = exerciseId,
            Name = $"Channel reader {exerciseId:N}",
            Hostname = $"rt-channels-{exerciseId:N}.example.com",
            TimeZone = "UTC",
            Status = "live",
            EnabledChannels = enabledChannels,
        });
        await seed.SaveChangesAsync();
        return exerciseId;
    }
}
