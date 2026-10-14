namespace Pulse.WebApi.Tests.Features.WhiteNoise;

using System;
using System.Linq;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Features.WhiteNoise;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// Story 05 against real SQL: <c>GET /api/staff/noise</c> (any assigned staff), <c>PUT /api/staff/noise</c> (level:
/// persist, push to the staff group, telemetry, no-op on the same level, 400 on an unknown one) and
/// <c>PUT /api/staff/noise/pool</c> (replace / append / per-entry rejections / limits), with the role gates
/// (evaluator reads, evaluator PUT is 403, no staff session is 401) and cross-exercise isolation of the pool.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class WhiteNoiseEndpointTests
{
    private readonly MsSqlContainerFixture _fixture;

    public WhiteNoiseEndpointTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task Get_AsAnEvaluator_ReturnsTheStateOfAFreshExercise()
    {
        await using var host = await WhiteNoiseTestHost.StartAsync(_fixture.ConnectionString!);
        var exercise = await host.SeedExerciseAsync();
        host.ActAs(exercise.ExerciseId, exercise.EvaluatorId);

        var response = await host.GetStateAsync();
        var json = await response.Content.ReadAsStringAsync();
        var state = await host.ReadStateOkAsync(response);

        state.Should().Be(new WireNoiseState("off", 0, 0, 0, null, false), "a new exercise starts quiet with an empty pool");
        using var document = JsonDocument.Parse(json);
        document.RootElement.TryGetProperty("lastPostedAt", out _).Should().BeFalse("lastPostedAt is omitted before the first post");
    }

    [RequiresDockerFact]
    public async Task Puts_AsAnEvaluator_Are403_AndWithoutAStaffSession_Everything401()
    {
        await using var host = await WhiteNoiseTestHost.StartAsync(_fixture.ConnectionString!);
        var exercise = await host.SeedExerciseAsync();

        host.ActAs(exercise.ExerciseId, exercise.EvaluatorId);
        (await host.PutLevelAsync(new { level = "high" })).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await host.PutPoolAsync(new { mode = "replace", posts = Array.Empty<object>() })).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        host.ActAs(exercise.ExerciseId, staffUserId: null);
        (await host.GetStateAsync()).StatusCode.Should().Be(HttpStatusCode.Unauthorized, "the state is staff-only (XC-002)");
        (await host.PutLevelAsync(new { level = "high" })).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        var stranger = await host.SeedExerciseAsync();
        host.ActAs(exercise.ExerciseId, stranger.ControllerId);
        (await host.GetStateAsync()).StatusCode.Should().Be(HttpStatusCode.Forbidden, "a controller of another exercise is not assigned here");

        await using var db = host.Db(exercise.ExerciseId);
        (await db.Exercises.SingleAsync(e => e.Id == exercise.ExerciseId)).NoiseLevel.Should().Be("off", "no refused call changed anything");
    }

    [RequiresDockerFact]
    public async Task PutLevel_PersistsPushesToTheStaffGroupAndEmitsOneEvent_AndTheSameLevelAgainIsANoOp()
    {
        await using var host = await WhiteNoiseTestHost.StartAsync(_fixture.ConnectionString!);
        var exercise = await host.SeedExerciseAsync();
        host.StartClock(exercise);
        await host.SeedPoolAsync(exercise, 4);
        host.ActAs(exercise.ExerciseId, exercise.ControllerId);

        var state = await host.ReadStateOkAsync(await host.PutLevelAsync(new { level = "medium" }));

        state.Should().Be(new WireNoiseState("medium", 6, 4, 0, null, true));
        await using (var db = host.Db(exercise.ExerciseId))
        {
            (await db.Exercises.SingleAsync(e => e.Id == exercise.ExerciseId)).NoiseLevel.Should().Be("medium");
        }

        host.NoiseBroadcaster.Calls.Should().ContainSingle().Which.ExerciseId.Should().Be(exercise.ExerciseId);
        host.NoiseBroadcaster.Calls[0].State.Level.Should().Be("medium");

        var events = await host.TelemetryAsync(exercise.ExerciseId, WhiteNoiseService.LevelChangedEventType);
        events.Should().ContainSingle();
        events[0].Payload.Should().Be("{\"from\":\"off\",\"to\":\"medium\"}", "counts and literals only");
        events[0].Actor.ActingHumanId.Should().Be(exercise.ControllerId.ToString());
        events[0].TimeZone.Should().Be("America/Chicago");

        var again = await host.ReadStateOkAsync(await host.PutLevelAsync(new { level = "medium" }));
        again.Level.Should().Be("medium");
        host.NoiseBroadcaster.Calls.Should().HaveCount(1, "setting the current level again pushes nothing");
        (await host.TelemetryAsync(exercise.ExerciseId, WhiteNoiseService.LevelChangedEventType))
            .Should().HaveCount(1, "and emits nothing");

        // The evaluator reads what the controller set.
        host.ActAs(exercise.ExerciseId, exercise.EvaluatorId);
        (await host.ReadStateOkAsync(await host.GetStateAsync())).Level.Should().Be("medium");
    }

    [RequiresDockerFact]
    public async Task PutLevel_RejectsAnUnknownLevelWith400_AndChangesNothing()
    {
        await using var host = await WhiteNoiseTestHost.StartAsync(_fixture.ConnectionString!);
        var exercise = await host.SeedExerciseAsync();
        host.ActAs(exercise.ExerciseId, exercise.ControllerId);

        foreach (var body in new object[] { new { level = "loud" }, new { level = "HIGH" }, new { } })
        {
            var response = await host.PutLevelAsync(body);
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await response.Content.ReadAsStringAsync()).Should().Contain(WhiteNoiseService.InvalidLevelMessage);
        }

        host.NoiseBroadcaster.Calls.Should().BeEmpty();
        (await host.TelemetryAsync(exercise.ExerciseId, WhiteNoiseService.LevelChangedEventType)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task PutPool_Replace_ResolvesPersonasInThisExerciseOnly_SanitizesText_AndReportsBadEntriesByIndex()
    {
        await using var host = await WhiteNoiseTestHost.StartAsync(_fixture.ConnectionString!);
        var exercise = await host.SeedExerciseAsync();
        var other = await host.SeedExerciseAsync();
        host.ActAs(exercise.ExerciseId, exercise.ControllerId);

        var emoji280 = string.Concat(Enumerable.Repeat("\U0001F4A7", 280)); // 280 code points, 560 UTF-16 units
        var response = await host.PutPoolAsync(new
        {
            mode = "replace",
            posts = new object?[]
            {
                new { persona = $"@{exercise.Prefix}0", text = "Lovely morning at the farmers market" },          // 0 ok (handle with @)
                new { persona = $"{exercise.Prefix}1", text = "Traffic on Route 9 again <script>alert(1)</script>" }, // 1 ok (handle without @)
                new { persona = exercise.PersonaIds[2].ToString(), text = "  Coffee time  " },                    // 2 ok (id)
                new { persona = other.PersonaIds[0].ToString(), text = "Wrong exercise" },                        // 3 another exercise's persona id
                new { persona = $"@{other.Prefix}0", text = "Wrong exercise" },                                  // 4 another exercise's handle
                new { persona = $"@{exercise.Prefix}0", text = "<b></b>   " },                                   // 5 empty once sanitized
                new { persona = $"@{exercise.Prefix}0", text = new string('x', 281) },                            // 6 too long
                new { persona = $"@{exercise.Prefix}0", text = emoji280 },                                        // 7 ok: 280 code points
                new { persona = (string?)null, text = "no persona" },                                             // 8 persona missing
                null,                                                                                             // 9 null entry
            },
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        var result = (await response.Content.ReadFromJsonAsync<WirePoolResult>())!;
        result.PoolSize.Should().Be(4);
        result.Rejected.Select(r => r.Index).Should().Equal(3, 4, 5, 6, 8, 9);
        result.Rejected.Single(r => r.Index == 3).Reason.Should().Be(WhiteNoiseService.PersonaNotFoundReason);
        result.Rejected.Single(r => r.Index == 4).Reason.Should().Be(WhiteNoiseService.PersonaNotFoundReason,
            "another exercise's id and handle get the same answer (COR-001)");
        result.Rejected.Single(r => r.Index == 6).Reason.Should().Be(WhiteNoiseService.TextLengthReason);

        var pool = await host.PoolAsync(exercise.ExerciseId);
        pool.Select(p => p.PersonaId).Should().Equal(
            exercise.PersonaIds[0], exercise.PersonaIds[1], exercise.PersonaIds[2], exercise.PersonaIds[0]);
        pool.Select(p => p.Order).Should().Equal(0, 1, 2, 3);
        pool[1].Text.Should().Be("Traffic on Route 9 again", "text goes through PostSanitizer");
        pool[2].Text.Should().Be("Coffee time");
        pool[3].Text.Should().Be(emoji280);
        pool.Should().OnlyContain(p => p.PostedCount == 0 && p.LastPostedWallClock == null);

        (await host.PoolAsync(other.ExerciseId)).Should().BeEmpty("nothing crossed into the other exercise");

        var events = await host.TelemetryAsync(exercise.ExerciseId, WhiteNoiseService.PoolReplacedEventType);
        events.Should().ContainSingle().Which.Payload.Should().Be("{\"poolSize\":4}");
    }

    [RequiresDockerFact]
    public async Task PutPool_AppendAddsAfterTheExistingEntries_AndReplaceResetsThePoolAndItsCounts()
    {
        await using var host = await WhiteNoiseTestHost.StartAsync(_fixture.ConnectionString!);
        var exercise = await host.SeedExerciseAsync();
        await host.SeedPoolAsync(exercise, 3);
        await using (var db = host.Db(exercise.ExerciseId))
        {
            foreach (var entry in await db.NoisePosts.ToListAsync())
            {
                entry.PostedCount = 5;
            }

            await db.SaveChangesAsync();
        }

        host.ActAs(exercise.ExerciseId, exercise.ControllerId);

        var appended = (await (await host.PutPoolAsync(new
        {
            mode = "append",
            posts = new[] { new { persona = $"@{exercise.Prefix}1", text = "Appended" } },
        })).Content.ReadFromJsonAsync<WirePoolResult>())!;
        appended.PoolSize.Should().Be(4);
        var pool = await host.PoolAsync(exercise.ExerciseId);
        pool.Last().Order.Should().Be(3, "append continues the pool order");
        pool.Last().PostedCount.Should().Be(0);
        (await host.TelemetryAsync(exercise.ExerciseId, WhiteNoiseService.PoolReplacedEventType))
            .Should().BeEmpty("only a replace emits noise.pool.replaced");

        var replaced = (await (await host.PutPoolAsync(new
        {
            mode = "replace",
            posts = new[] { new { persona = $"@{exercise.Prefix}2", text = "Fresh" } },
        })).Content.ReadFromJsonAsync<WirePoolResult>())!;
        replaced.PoolSize.Should().Be(1);
        pool = await host.PoolAsync(exercise.ExerciseId);
        pool.Should().ContainSingle().Which.Should().Match<Pulse.WebApi.Data.Entities.NoisePost>(
            p => p.Text == "Fresh" && p.PostedCount == 0 && p.Order == 0);
    }

    [RequiresDockerFact]
    public async Task PutPool_RefusesABadModeAMissingListAndMoreThanAThousandEntries()
    {
        await using var host = await WhiteNoiseTestHost.StartAsync(_fixture.ConnectionString!);
        var exercise = await host.SeedExerciseAsync();
        await host.SeedPoolAsync(exercise, 2);
        host.ActAs(exercise.ExerciseId, exercise.ControllerId);

        (await host.PutPoolAsync(new { mode = "merge", posts = Array.Empty<object>() })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await host.PutPoolAsync(new { mode = "replace" })).StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var tooMany = Enumerable.Range(0, 1001).Select(i => new { persona = $"@{exercise.Prefix}0", text = $"n{i}" }).ToArray();
        var response = await host.PutPoolAsync(new { mode = "replace", posts = tooMany });
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).Should().Contain("1000");

        (await host.PoolAsync(exercise.ExerciseId)).Should().HaveCount(2, "a refused call writes nothing");

        var exactly = Enumerable.Range(0, 1000).Select(i => new { persona = $"@{exercise.Prefix}0", text = $"n{i}" }).ToArray();
        var ok = (await (await host.PutPoolAsync(new { mode = "replace", posts = exactly })).Content.ReadFromJsonAsync<WirePoolResult>())!;
        ok.PoolSize.Should().Be(1000);
    }
}
