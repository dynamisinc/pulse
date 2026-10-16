namespace Pulse.WebApi.Tests.Features.EngineRuntime.Persistence;

using System;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Injects;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Injects;
using Xunit;

/// <summary>
/// demo-feedback story 18 (AC-8): a Freeze that came back from a restart — restored through the same in-memory entry
/// points the rehydrator uses, NOT set by a live POST — still blocks inject fire and retry with
/// <see cref="InjectQueueService.FrozenMessage"/>, exactly as a live Freeze does today.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class RestoredFreezeBlocksInjectsTests
{
    private readonly MsSqlContainerFixture _fixture;

    public RestoredFreezeBlocksInjectsTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task Fire_UnderARestoredFreeze_Is409_TheWorldIsFrozen()
    {
        await using var host = await InjectTestHost.StartAsync(_fixture.ConnectionString!);
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));

        // What ExerciseRuntimeStateRehydrator applies for a persisted Freeze row.
        ((IExerciseClockPersistence)host.Clock).Restore(
            seeded.ExerciseId,
            new ExerciseClockAnchor(DateTimeOffset.UtcNow, TimeZoneInfo.Utc, TimeSpan.FromMinutes(12), DateTimeOffset.UtcNow, Frozen: true));
        host.PauseTiers.Restore(seeded.ExerciseId, PauseTier.Freeze);

        var fire = await host.ActionAsync(item.Guid, "fire");

        fire.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await InjectTestHost.ReadProblemAsync(fire)).Detail.Should().Be(InjectQueueService.FrozenMessage);
        (await host.GetQueueAsync()).Items.Select(i => i.Status).Should().Equal(["pending"], "nothing fired under the restored Freeze");
    }
}
