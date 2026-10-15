namespace Pulse.WebApi.Tests.Features.WhiteNoise;

using System;
using System.Linq;
using System.Net;
using System.Net.Http.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.WhiteNoise;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Injects;
using Xunit;

/// <summary>
/// Story 05's pacer against real SQL (DF-12/DF-13): posts publish through the real funnel with origin <c>noise</c>, the
/// pool persona, no acting human and the exercise's scenario time, at the level's rate; the picked entry is counted in
/// the same unit of work; least-posted first, no persona twice in a row; Freeze and a frozen or stopped clock stop it,
/// Pause injects and Engine paused do not; a restart resumes at the persisted level without a burst; the post-driven
/// push is throttled; noise never reaches the run sheet; and two exercises at different levels never mix. Ticks are
/// driven directly with a hand-advanced clock — no sleeping.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class WhiteNoisePacerTests
{
    private readonly MsSqlContainerFixture _fixture;

    public WhiteNoisePacerTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task High_PublishesNoisePostsThroughTheFunnel_AtItsRate_WithScenarioTimeAndNoActingHuman()
    {
        await using var host = await WhiteNoiseTestHost.StartAsync(_fixture.ConnectionString!);
        var exercise = await host.SeedExerciseAsync();
        await host.SeedPoolAsync(exercise, 6);
        await host.SetLevelInDbAsync(exercise.ExerciseId, NoiseRates.High);
        host.StartClock(exercise);

        // Mean jitter: one post every 4 s, the first 4 s after the pacer first sees the exercise.
        await host.TickForAsync(60);

        var posts = await host.NoisePostsAsync(exercise.ExerciseId);
        posts.Should().HaveCount(14, "15/min, the first one a gap after the first sweep");
        posts.Should().OnlyContain(p => p.Origin == "noise" && p.ActingHumanId == string.Empty && p.InjectId == null);
        posts.Select(p => p.AuthorPersonaId).Should().OnlyContain(id => exercise.PersonaIds.Contains(id));

        var scenarioNow = host.Clock.CurrentScenarioTime(exercise.ExerciseId)!.Value;
        posts.Last().CreatedScenarioTime.Should().BeCloseTo(scenarioNow, TimeSpan.FromSeconds(5), "scenario time, from the exercise clock");

        host.FeedBroadcaster.Calls.Where(c => c.ExerciseId == exercise.ExerciseId)
            .Should().HaveCount(14, "each post reaches feeds through the normal PostReceived push");

        var pool = await host.PoolAsync(exercise.ExerciseId);
        pool.Sum(p => p.PostedCount).Should().Be(14, "the picked entry is counted with its post");
        pool.Should().OnlyContain(p => p.PostedCount >= 2 && p.PostedCount <= 3, "least-posted first cycles the pool evenly");
        pool.Where(p => p.PostedCount > 0).Should().OnlyContain(p => p.LastPostedWallClock != null);

        host.ActAs(exercise.ExerciseId, exercise.EvaluatorId);
        var state = await host.ReadStateOkAsync(await host.GetStateAsync());
        state.PostedCount.Should().Be(14);
        state.Running.Should().BeTrue();
        state.LastPostedAt.Should().NotBeNull();
    }

    [RequiresDockerFact]
    public async Task Selection_NeverRepeatsAPersonaBackToBack_WhenAnotherIsAvailable()
    {
        await using var host = await WhiteNoiseTestHost.StartAsync(_fixture.ConnectionString!);
        var exercise = await host.SeedExerciseAsync(personas: 2);

        // Pool order: A, A, A, B — least-posted-then-order alone would post A three times running.
        await using (var db = host.Db(exercise.ExerciseId))
        {
            var personas = new[] { 0, 0, 0, 1 };
            for (var index = 0; index < personas.Length; index++)
            {
                db.NoisePosts.Add(new Pulse.WebApi.Data.Entities.NoisePost
                {
                    Id = Guid.NewGuid(),
                    ExerciseId = exercise.ExerciseId,
                    PersonaId = exercise.PersonaIds[personas[index]],
                    Text = $"entry {index}",
                    Order = index,
                    CreatedWallClock = DateTimeOffset.UtcNow,
                });
            }

            await db.SaveChangesAsync();
        }

        await host.SetLevelInDbAsync(exercise.ExerciseId, NoiseRates.High);
        host.StartClock(exercise);
        await host.TickForAsync((4 * 4) + 1);

        // e0 (least posted, first); then e3 (the only B); then e1; then e2 would repeat A, so B's e3 again.
        var posts = await host.NoisePostsAsync(exercise.ExerciseId);
        posts.Select(p => p.Body).Should().Equal("entry 0", "entry 3", "entry 1", "entry 3");
        posts.Zip(posts.Skip(1), (x, y) => x.AuthorPersonaId != y.AuthorPersonaId).Should().OnlyContain(differs => differs);
    }

    [RequiresDockerFact]
    public async Task FreezeAndAFrozenOrStoppedClock_StopNoise_PauseInjectsAndEnginePausedDoNot()
    {
        await using var host = await WhiteNoiseTestHost.StartAsync(_fixture.ConnectionString!);
        var exercise = await host.SeedExerciseAsync();
        await host.SeedPoolAsync(exercise, 6);
        await host.SetLevelInDbAsync(exercise.ExerciseId, NoiseRates.High);

        (await host.TickForAsync(30)).Should().Be(0, "the exercise clock is not running yet");
        host.ActAs(exercise.ExerciseId, exercise.EvaluatorId);
        (await host.ReadStateOkAsync(await host.GetStateAsync())).Running.Should().BeFalse("the clock is not running");

        host.StartClock(exercise);
        (await host.TickForAsync(8)).Should().Be(1, "the first post one 4 s gap after the clock starts");

        await host.PauseTiers.SetTierAsync(exercise.ExerciseId, PauseTier.Injects, "controller-1");
        (await host.TickForAsync(8)).Should().Be(2, "Pause injects does not stop noise (DF-13)");

        await host.PauseTiers.SetTierAsync(exercise.ExerciseId, PauseTier.Engine, "controller-1");
        (await host.TickForAsync(8)).Should().Be(2, "Engine paused does not stop noise either");

        var freezeStart = new PauseClockStart(DateTimeOffset.UtcNow, TimeZoneInfo.Utc);
        (await host.PauseTiers.SetTierAsync(exercise.ExerciseId, PauseTier.Freeze, "controller-1", freezeStart))
            .Outcome.Should().Be(PauseTierOutcome.Applied);
        (await host.TickForAsync(60)).Should().Be(0, "Freeze stops noise");
        (await host.ReadStateOkAsync(await host.GetStateAsync())).Running.Should().BeFalse("the world is frozen");

        await host.PauseTiers.SetTierAsync(exercise.ExerciseId, PauseTier.Running, "controller-1");
        (await host.TickForAsync(4)).Should().Be(0, "no catch-up burst after a minute frozen");
        (await host.TickForAsync(1)).Should().Be(1, "it resumes one gap after the stop cleared");

        // A frozen clock without the Freeze tier stops it too.
        host.Clock.Freeze(exercise.ExerciseId);
        (await host.TickForAsync(20)).Should().Be(0, "a frozen clock stops noise");
        host.Clock.Unfreeze(exercise.ExerciseId);
        (await host.TickForAsync(5)).Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task AnEmptyPool_PostsNothing_AndIsNotRunning()
    {
        await using var host = await WhiteNoiseTestHost.StartAsync(_fixture.ConnectionString!);
        var exercise = await host.SeedExerciseAsync();
        await host.SetLevelInDbAsync(exercise.ExerciseId, NoiseRates.High);
        host.StartClock(exercise);

        (await host.TickForAsync(20)).Should().Be(0);

        host.ActAs(exercise.ExerciseId, exercise.EvaluatorId);
        var state = await host.ReadStateOkAsync(await host.GetStateAsync());
        state.Should().Be(new WireNoiseState("high", 15, 0, 0, null, false));
    }

    [RequiresDockerFact]
    public async Task Off_StopsNoise_AndALevelChangeRestartsTheTimetableAtTheNewRate()
    {
        await using var host = await WhiteNoiseTestHost.StartAsync(_fixture.ConnectionString!);
        var exercise = await host.SeedExerciseAsync();
        await host.SeedPoolAsync(exercise, 4);
        host.StartClock(exercise);
        host.ActAs(exercise.ExerciseId, exercise.ControllerId);

        (await host.PutLevelAsync(new { level = "high" })).StatusCode.Should().Be(HttpStatusCode.OK);
        (await host.TickForAsync(9)).Should().Be(2);

        (await host.PutLevelAsync(new { level = "off" })).StatusCode.Should().Be(HttpStatusCode.OK);
        (await host.TickForAsync(60)).Should().Be(0, "Off stops noise");

        (await host.PutLevelAsync(new { level = "low" })).StatusCode.Should().Be(HttpStatusCode.OK);
        (await host.TickForAsync(30)).Should().Be(0);
        (await host.TickForAsync(1)).Should().Be(1, "Low's 30 s mean gap from the change");
    }

    [RequiresDockerFact]
    public async Task ARestart_ResumesAtThePersistedLevel_WithoutACatchUpBurst()
    {
        await using var host = await WhiteNoiseTestHost.StartAsync(_fixture.ConnectionString!);
        var exercise = await host.SeedExerciseAsync();
        await host.SeedPoolAsync(exercise, 6);
        await host.SetLevelInDbAsync(exercise.ExerciseId, NoiseRates.Medium);
        host.StartClock(exercise);
        (await host.TickForAsync(21)).Should().Be(2, "Medium: one post every 10 s");

        // "Restart": the persisted level survives; the in-memory timetable does not. Ten minutes of downtime pass.
        await using var restarted = await WhiteNoiseTestHost.StartAsync(_fixture.ConnectionString!);
        restarted.Clock.Start(exercise.ExerciseId, DateTimeOffset.UtcNow, TimeZoneInfo.Utc);
        restarted.Time.Advance(TimeSpan.FromMinutes(10));

        (await restarted.Pacer.RunTickAsync()).Should().Be(0, "no catch-up burst for the downtime");
        (await restarted.TickForAsync(9)).Should().Be(0);
        (await restarted.TickForAsync(1)).Should().Be(1, "the persisted Medium resumes one gap after the first sweep");

        (await restarted.NoisePostsAsync(exercise.ExerciseId)).Should().HaveCount(3);
    }

    [RequiresDockerFact]
    public async Task ThePostDrivenPush_IsThrottledToOnePerTwoSecondsPerExercise()
    {
        await using var host = await WhiteNoiseTestHost.StartAsync(_fixture.ConnectionString!);
        var exercise = await host.SeedExerciseAsync();
        await host.SeedPoolAsync(exercise, 4);
        await host.SetLevelInDbAsync(exercise.ExerciseId, NoiseRates.High);
        host.StartClock(exercise);

        async Task<NoisePublishOutcome> PublishAsync()
        {
            await using var scope = host.Services.CreateAsyncScope();
            ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = exercise.ExerciseId;
            return await scope.ServiceProvider.GetRequiredService<WhiteNoiseService>().PublishNextAsync();
        }

        (await PublishAsync()).Should().Be(NoisePublishOutcome.Posted);
        host.Time.Advance(TimeSpan.FromSeconds(1));
        (await PublishAsync()).Should().Be(NoisePublishOutcome.Posted);

        var pushes = host.NoiseBroadcaster.Calls.Where(c => c.ExerciseId == exercise.ExerciseId).ToList();
        pushes.Should().ContainSingle("two posts within 2 s push once");
        pushes[0].State.PostedCount.Should().Be(1);

        host.Time.Advance(TimeSpan.FromSeconds(1));
        (await PublishAsync()).Should().Be(NoisePublishOutcome.Posted);
        pushes = host.NoiseBroadcaster.Calls.Where(c => c.ExerciseId == exercise.ExerciseId).ToList();
        pushes.Should().HaveCount(2);
        pushes[1].State.PostedCount.Should().Be(3, "postedCount stays live");
        pushes[1].State.LastPostedAt.Should().NotBeNull();
    }

    [RequiresDockerFact]
    public async Task NoisePosts_NeverAppearInTheRunSheet()
    {
        await using var host = await WhiteNoiseTestHost.StartAsync(_fixture.ConnectionString!);
        var exercise = await host.SeedExerciseAsync();
        await host.SeedPoolAsync(exercise, 3);
        await host.SetLevelInDbAsync(exercise.ExerciseId, NoiseRates.High);
        host.StartClock(exercise);
        (await host.TickForAsync(13)).Should().Be(3);

        host.ActAs(exercise.ExerciseId, exercise.ControllerId);
        var response = await host.Client.GetAsync(new Uri("/api/injects", UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.Content.ReadFromJsonAsync<WireQueue>())!.Items.Should().BeEmpty("noise is not an inject");

        await using var db = host.Db(exercise.ExerciseId);
        (await db.InjectItems.CountAsync()).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task TwoExercisesAtDifferentLevels_EachPostOnlyTheirOwnPool()
    {
        await using var host = await WhiteNoiseTestHost.StartAsync(_fixture.ConnectionString!);
        var a = await host.SeedExerciseAsync();
        var b = await host.SeedExerciseAsync();
        await host.SeedPoolAsync(a, 5);
        await host.SeedPoolAsync(b, 5);
        await host.SetLevelInDbAsync(a.ExerciseId, NoiseRates.High);
        await host.SetLevelInDbAsync(b.ExerciseId, NoiseRates.Low);
        host.StartClock(a);
        host.StartClock(b);

        await host.TickForAsync(60);

        var postsA = await host.NoisePostsAsync(a.ExerciseId);
        var postsB = await host.NoisePostsAsync(b.ExerciseId);
        postsA.Should().HaveCount(14);
        postsB.Should().HaveCount(1, "Low: the first post 30 s in, the next at 60 s is the next tick");
        postsA.Should().OnlyContain(p => a.PersonaIds.Contains(p.AuthorPersonaId) && p.Body.Contains(a.Prefix));
        postsB.Should().OnlyContain(p => b.PersonaIds.Contains(p.AuthorPersonaId) && p.Body.Contains(b.Prefix));
        postsA.Should().OnlyContain(p => p.ExerciseId == a.ExerciseId);

        host.FeedBroadcaster.Calls.Where(c => c.ExerciseId == b.ExerciseId).Should().HaveCount(1);
        host.NoiseBroadcaster.Calls.Should().OnlyContain(c => c.ExerciseId == a.ExerciseId || c.ExerciseId == b.ExerciseId);
        host.NoiseBroadcaster.Calls.Where(c => c.ExerciseId == b.ExerciseId).Should().OnlyContain(c => c.State.Level == "low");

        // Freezing A leaves B alone.
        await host.PauseTiers.SetTierAsync(a.ExerciseId, PauseTier.Freeze, "controller-1", new PauseClockStart(DateTimeOffset.UtcNow, TimeZoneInfo.Utc));
        await host.TickForAsync(60);
        (await host.NoisePostsAsync(a.ExerciseId)).Should().HaveCount(14);
        (await host.NoisePostsAsync(b.ExerciseId)).Should().HaveCount(3);
    }

    [RequiresDockerFact]
    public async Task ALifecycleThatIsNotStagedOrLive_StopsNoise_AndRunningIsFalse()
    {
        await using var host = await WhiteNoiseTestHost.StartAsync(_fixture.ConnectionString!);
        var exercise = await host.SeedExerciseAsync();
        await host.SeedPoolAsync(exercise, 6);
        await host.SetLevelInDbAsync(exercise.ExerciseId, NoiseRates.High);
        host.StartClock(exercise);
        host.ActAs(exercise.ExerciseId, exercise.EvaluatorId);

        (await host.TickForAsync(5)).Should().Be(1, "live: noise runs");

        await host.SetStatusInDbAsync(exercise.ExerciseId, "paused");
        (await host.TickForAsync(60)).Should().Be(0, "a lifecycle pause stops noise (DF-13, amended)");
        (await host.ReadStateOkAsync(await host.GetStateAsync())).Should().Match<WireNoiseState>(
            state => state.Level == "high" && !state.Running, "the knob can say why: the level is set but nothing runs");

        await host.SetStatusInDbAsync(exercise.ExerciseId, "active");
        (await host.TickForAsync(4)).Should().Be(0, "no catch-up after the pause");
        (await host.TickForAsync(1)).Should().Be(1, "the legacy 'active' literal folds to live");
        (await host.ReadStateOkAsync(await host.GetStateAsync())).Running.Should().BeTrue();

        await host.SetStatusInDbAsync(exercise.ExerciseId, "completed");
        (await host.TickForAsync(60)).Should().Be(0, "EndEx stops noise");
        (await host.ReadStateOkAsync(await host.GetStateAsync())).Running.Should().BeFalse();

        await host.SetStatusInDbAsync(exercise.ExerciseId, "staged");
        (await host.TickForAsync(5)).Should().Be(1, "staged lets noise run");
    }

    [RequiresDockerFact]
    public async Task ARefusedEntry_IsSkipped_SoTheRotationMovesOn()
    {
        await using var host = await WhiteNoiseTestHost.StartAsync(_fixture.ConnectionString!);
        var exercise = await host.SeedExerciseAsync();

        // Entry 0 is least posted and first in order, but the funnel refuses it (no author persona).
        await using (var db = host.Db(exercise.ExerciseId))
        {
            db.NoisePosts.Add(new Pulse.WebApi.Data.Entities.NoisePost
            {
                Id = Guid.NewGuid(),
                ExerciseId = exercise.ExerciseId,
                PersonaId = Guid.Empty,
                Text = "refused",
                Order = 0,
                CreatedWallClock = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        await host.SeedPoolAsync(exercise, 2);
        await using (var db = host.Db(exercise.ExerciseId))
        {
            // SeedPoolAsync numbered its entries from 0 too; move them after the refused one.
            foreach (var entry in await db.NoisePosts.Where(n => n.Text != "refused").ToListAsync())
            {
                entry.Order += 1;
            }

            await db.SaveChangesAsync();
        }

        await host.SetLevelInDbAsync(exercise.ExerciseId, NoiseRates.High);
        host.StartClock(exercise);

        (await host.TickForAsync(5)).Should().Be(0, "the first due post is the refused entry");
        (await host.TickForAsync(8)).Should().Be(2, "it was skipped, so the next due times pick the other entries");

        var pool = await host.PoolAsync(exercise.ExerciseId);
        pool.Single(p => p.Text == "refused").PostedCount.Should().Be(1, "the skip is counted in its own save");
        (await host.NoisePostsAsync(exercise.ExerciseId)).Should().HaveCount(2).And.OnlyContain(p => p.Body != "refused");
    }

    [RequiresDockerFact]
    public async Task AThrowingPublish_SkipsTheEntry_SoTheRotationMovesOn()
    {
        var interceptor = new ThrowOnPostBodyInterceptor("boom");
        await using var host = await WhiteNoiseTestHost.StartAsync(
            _fixture.ConnectionString!,
            configureServices: services => services.ConfigureDbContext<PulseDbContext>(options => options.AddInterceptors(interceptor)));
        var exercise = await host.SeedExerciseAsync();

        await using (var db = host.Db(exercise.ExerciseId))
        {
            var texts = new[] { "boom", "calm one", "calm two" };
            for (var index = 0; index < texts.Length; index++)
            {
                db.NoisePosts.Add(new Pulse.WebApi.Data.Entities.NoisePost
                {
                    Id = Guid.NewGuid(),
                    ExerciseId = exercise.ExerciseId,
                    PersonaId = exercise.PersonaIds[index],
                    Text = texts[index],
                    Order = index,
                    CreatedWallClock = DateTimeOffset.UtcNow,
                });
            }

            await db.SaveChangesAsync();
        }

        await host.SetLevelInDbAsync(exercise.ExerciseId, NoiseRates.High);
        host.StartClock(exercise);

        (await host.TickForAsync(5)).Should().Be(0, "the first due post throws inside the funnel");
        interceptor.Thrown.Should().Be(1);
        (await host.TickForAsync(8)).Should().Be(2, "the throwing entry was skipped; the rotation moved on");

        (await host.PoolAsync(exercise.ExerciseId)).Single(p => p.Text == "boom").PostedCount.Should().Be(1);
        (await host.NoisePostsAsync(exercise.ExerciseId)).Select(p => p.Body).Should().Equal("calm one", "calm two");
    }
}

/// <summary>Makes the funnel's SaveChanges throw when it adds a post with the given body.</summary>
internal sealed class ThrowOnPostBodyInterceptor : Microsoft.EntityFrameworkCore.Diagnostics.SaveChangesInterceptor
{
    private readonly string _body;
    private int _thrown;

    public ThrowOnPostBodyInterceptor(string body) => _body = body;

    public int Thrown => System.Threading.Volatile.Read(ref _thrown);

    public override System.Threading.Tasks.ValueTask<Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<int>> SavingChangesAsync(
        Microsoft.EntityFrameworkCore.Diagnostics.DbContextEventData eventData,
        Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<int> result,
        System.Threading.CancellationToken cancellationToken = default)
    {
        var adding = eventData.Context?.ChangeTracker.Entries<Pulse.WebApi.Data.Entities.Post>()
            .Any(entry => entry.State == EntityState.Added && entry.Entity.Body == _body) ?? false;
        if (adding)
        {
            System.Threading.Interlocked.Increment(ref _thrown);
            throw new InvalidOperationException("database unreachable");
        }

        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }
}
