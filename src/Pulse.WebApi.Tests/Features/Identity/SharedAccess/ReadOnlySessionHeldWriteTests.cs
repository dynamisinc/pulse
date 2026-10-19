namespace Pulse.WebApi.Tests.Features.Identity.SharedAccess;

using System;
using System.Net;
using System.Threading.Tasks;
using FluentAssertions;
using FluentAssertions.Execution;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Tests.Features.Social;
using Xunit;

/// <summary>
/// #661 S2: a COR-015 shared read-only session that attempts a participant write while the world is HELD (lifecycle
/// <c>paused</c>, or the Freeze tier) gets <c>403</c> — the read-only denial — not the held-world <c>409 frozen</c>. The
/// read-only refusal is the more fundamental one (this caller may never write, held or not), so it must answer
/// first; a 409 would tell an observer "try again after the pause". Real <c>Program</c> host, real SQL, real sessions.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ReadOnlySessionHeldWriteTests
{
    private readonly MsSqlContainerFixture _fixture;

    public ReadOnlySessionHeldWriteTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>The two ways a world is held for participants.</summary>
    public static TheoryData<string> HeldConditions => new() { "paused", "freeze" };

    [RequiresDockerTheory]
    [MemberData(nameof(HeldConditions))]
    public async Task ASharedReadOnlySession_WritingWhileHeld_Gets403_Not409(string condition)
    {
        var world = await EndedReviewWorld.SeedAsync(_fixture, condition == "paused" ? "paused" : "live");
        await using var host = new PauseTestHost(
            _fixture.ConnectionString ?? throw new InvalidOperationException("The MsSql fixture has no connection string."));

        if (condition == "freeze")
        {
            var frozen = await host.Services.GetRequiredService<PauseTierRegistry>().SetTierAsync(
                world.Exercise,
                PauseTier.Freeze,
                "controller-1",
                new PauseClockStart(DateTimeOffset.UtcNow, TimeZoneInfo.Utc));
            frozen.Outcome.Should().Be(PauseTierOutcome.Applied);
        }

        using var readOnly = host.CreateClientFor(world.Host, world.ReadOnlyToken);
        using var participant = host.CreateClientFor(world.Host, world.ParticipantToken);

        using (new AssertionScope())
        {
            foreach (var write in world.ParticipantWrites())
            {
                using var observerRequest = write.Build();
                using var observer = await readOnly.SendAsync(observerRequest);
                observer.StatusCode.Should().Be(
                    HttpStatusCode.Forbidden,
                    "a read-only session is refused {0} outright (COR-015) — never the held-world 409 ({1})",
                    write.Name,
                    condition);
            }
        }

        // The control: the SAME write by a participant in the SAME held world is the 409, so the 403 above is the
        // read-only denial answering first, not the world being closed.
        using var participantRequest = world.ParticipantWrites()[0].Build();
        using var held = await participant.SendAsync(participantRequest);
        held.StatusCode.Should().Be(HttpStatusCode.Conflict, "a participant write while {0} is the held-world refusal", condition);

        await using var db = _fixture.CreateContext();
        (await db.Posts.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == world.Exercise))
            .Should().Be(2, "nothing was written by either caller");
    }
}
