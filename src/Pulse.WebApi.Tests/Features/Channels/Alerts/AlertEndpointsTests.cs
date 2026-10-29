namespace Pulse.WebApi.Tests.Features.Channels.Alerts;

using System;
using System.Globalization;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Pulse.WebApi.Features.Channels;
using Pulse.WebApi.Features.Channels.Alerts;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.ParticipantShell;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Injects;
using Xunit;

/// <summary>
/// Channels-foundation story 10 over HTTP on real SQL Server: <c>GET /api/alerts</c> (through the shell's delegate),
/// <c>GET /api/alerts/history</c>, and the staff <c>POST /api/alerts</c> / <c>POST /api/alerts/{id}/clear</c> behind the
/// SHIPPED staff + controller-role filters. Proves the queries translate (scenario-time filter, history keyset) and the
/// always-Critical isolation: another exercise's alert id gets exactly the unknown-id response.
/// </summary>
/// <remarks>
/// Rides <see cref="InjectTestHost"/> (persistence, scoping, staff identity, the manual wall clock and the inject fire
/// rate-limit policy the raise route reuses). The exercise clock is not started, so scenario time falls back to the
/// manual wall clock, which the tests advance. The hosted expiry sweep is dropped so nothing moves behind a test.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class AlertEndpointsTests
{
    private readonly MsSqlContainerFixture _fixture;

    public AlertEndpointsTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task Controller_RaisesAConsoleAlert_201_AndParticipantsSeeItOnTheBar()
    {
        await using var host = await StartAsync();
        var exercise = await host.SeedExerciseAsync();
        host.ActAs(exercise.ExerciseId, exercise.StaffUserId);

        var response = await host.Client.PostAsJsonAsync(
            "/api/alerts", new { severity = "emergency", headline = "Evacuate Zone B now", href = "/alerts" });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var raised = await response.Content.ReadFromJsonAsync<JsonElement>();
        raised.GetProperty("message").GetString().Should().Be("Evacuate Zone B now");
        raised.GetProperty("sourceChannel").ValueKind.Should().Be(JsonValueKind.Null);

        host.ActAs(exercise.ExerciseId, staffUserId: null); // a participant: scope, no staff session
        var bar = await host.Client.GetFromJsonAsync<JsonElement>("/api/alerts");
        var alerts = bar.GetProperty("alerts");
        alerts.GetArrayLength().Should().Be(1);
        alerts[0].GetProperty("id").GetString().Should().Be(raised.GetProperty("id").GetString());
        alerts[0].GetProperty("severity").GetString().Should().Be("emergency");
        alerts[0].GetProperty("scenarioTime").GetString().Should().NotBeNullOrEmpty();
        alerts[0].TryGetProperty("origin", out _).Should().BeFalse("participants never see who raised it (XC-002)");
        alerts[0].TryGetProperty("actingHumanId", out _).Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task Active_IsOrderedBySeverityThenNewest_AndDropsExpiredOnScenarioTime_OnRealSql()
    {
        await using var host = await StartAsync();
        var exercise = await host.SeedExerciseAsync();
        host.ActAs(exercise.ExerciseId, exercise.StaffUserId);
        var expires = host.Time.GetUtcNow().AddMinutes(10).ToString("O", CultureInfo.InvariantCulture);

        var info = await RaiseOkAsync(host, new { severity = "info", headline = "info" });
        host.Time.Advance(TimeSpan.FromSeconds(1));
        var expiring = await RaiseOkAsync(host, new { severity = "emergency", headline = "expiring", expiresScenarioTime = expires });
        host.Time.Advance(TimeSpan.FromSeconds(1));
        var advisory = await RaiseOkAsync(host, new { severity = "advisory", headline = "advisory" });

        (await ActiveIdsAsync(host)).Should().Equal(expiring, advisory, info);

        host.Time.Advance(TimeSpan.FromMinutes(11));

        (await ActiveIdsAsync(host)).Should().Equal(advisory, info);
        var history = await host.Client.GetFromJsonAsync<JsonElement>("/api/alerts/history");
        history.GetProperty("alerts").EnumerateArray().Select(a => a.GetProperty("id").GetString())
            .Should().Equal(advisory, expiring, info);
        history.GetProperty("nextCursor").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [RequiresDockerFact]
    public async Task History_PagesWithTheCursor_OnRealSql()
    {
        await using var host = await StartAsync();
        var exercise = await host.SeedExerciseAsync();
        host.ActAs(exercise.ExerciseId, exercise.StaffUserId);
        // The manual clock stands still between these raises, so all five share one scenario instant: the tie path.
        var raised = new System.Collections.Generic.List<string>();
        for (var i = 0; i < 5; i++)
        {
            raised.Add(await RaiseOkAsync(host, new { severity = "info", headline = $"alert {i}" }));
        }

        var seen = new System.Collections.Generic.List<string>();
        string? cursor = null;
        do
        {
            var url = cursor is null ? "/api/alerts/history?limit=2" : $"/api/alerts/history?limit=2&cursor={cursor}";
            var page = await host.Client.GetFromJsonAsync<JsonElement>(url);
            seen.AddRange(page.GetProperty("alerts").EnumerateArray().Select(a => a.GetProperty("id").GetString()!));
            cursor = page.GetProperty("nextCursor").GetString();
        }
        while (cursor is not null && seen.Count < 20);

        seen.Should().OnlyHaveUniqueItems().And.BeEquivalentTo(raised);
        (await host.Client.GetAsync(new Uri("/api/alerts/history?cursor=%%%", UriKind.Relative)))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [RequiresDockerFact]
    public async Task Controller_Clears_204_ThenTheIdIs404()
    {
        await using var host = await StartAsync();
        var exercise = await host.SeedExerciseAsync();
        host.ActAs(exercise.ExerciseId, exercise.StaffUserId);
        var id = await RaiseOkAsync(host, new { severity = "advisory", headline = "Boil water notice" });

        (await ClearAsync(host, id)).StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await ActiveIdsAsync(host)).Should().BeEmpty();
        (await ClearAsync(host, id)).StatusCode.Should().Be(HttpStatusCode.NotFound);

        await using var db = host.Db(exercise.ExerciseId);
        var events = await db.TelemetryEvents.Where(e => e.EventType.StartsWith("alert_")).ToListAsync();
        events.Select(e => e.EventType).Should().BeEquivalentTo(new[] { "alert_issued", "alert_cleared" });
        events.Should().OnlyContain(e => e.Actor.ActingHumanId == exercise.StaffUserId.ToString());
    }

    [RequiresDockerFact]
    public async Task Raise_AnEmojiHeavyHeadlineAtTheBound_SavesOnRealSql_AndOneOverIs400_Not500()
    {
        await using var host = await StartAsync();
        var exercise = await host.SeedExerciseAsync();
        host.ActAs(exercise.ExerciseId, exercise.StaffUserId);

        await RaiseOkAsync(host, new { severity = "emergency", headline = string.Concat(Enumerable.Repeat("🌪", 150)) });
        (await host.Client.PostAsJsonAsync(
                "/api/alerts", new { severity = "emergency", headline = string.Concat(Enumerable.Repeat("🌪", 151)) }))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [RequiresDockerFact]
    public async Task Sweep_ExpiresEachExerciseInItsOwnScope_OnRealSql()
    {
        await using var host = await StartAsync();
        var a = await host.SeedExerciseAsync();
        var b = await host.SeedExerciseAsync();
        var expires = host.Time.GetUtcNow().AddMinutes(10).ToString("O", CultureInfo.InvariantCulture);
        host.ActAs(a.ExerciseId, a.StaffUserId);
        var aId = await RaiseOkAsync(host, new { severity = "emergency", headline = "A", expiresScenarioTime = expires });
        host.ActAs(b.ExerciseId, b.StaffUserId);
        var bId = await RaiseOkAsync(host, new { severity = "emergency", headline = "B", expiresScenarioTime = expires });

        // The exercise clocks are not started here, so pin a persisted scenario instant: the sweep never expires on wall time.
        await using (var db = host.Db(exerciseId: null))
        {
            foreach (var exercise in await db.Exercises.IgnoreQueryFilters()
                         .Where(x => x.Id == a.ExerciseId || x.Id == b.ExerciseId).ToListAsync())
            {
                exercise.CurrentScenarioTime = host.Time.GetUtcNow().AddMinutes(11);
            }

            await db.SaveChangesAsync();
        }

        var sweeper = ActivatorUtilities.CreateInstance<AlertExpirySweeper>(host.Services);
        (await sweeper.SweepAsync()).Should().BeGreaterThanOrEqualTo(2, "other tests' exercises may share the database");

        await using var check = host.Db(exerciseId: null);
        var rows = await check.ChannelAlerts.IgnoreQueryFilters()
            .Where(x => x.Id == Guid.Parse(aId) || x.Id == Guid.Parse(bId)).ToListAsync();
        rows.Should().HaveCount(2).And.OnlyContain(x => x.ClearedScenarioTime == x.ExpiresScenarioTime);
        var events = await check.TelemetryEvents.IgnoreQueryFilters()
            .Where(e => e.EventType == "alert_cleared" && (e.Target!.EntityId == aId || e.Target.EntityId == bId))
            .ToListAsync();
        events.Should().HaveCount(2);
        events.Single(e => e.Target!.EntityId == aId).ExerciseId.Should().Be(a.ExerciseId, "each expiry is written in its own scope");
        events.Single(e => e.Target!.EntityId == bId).ExerciseId.Should().Be(b.ExerciseId);
    }

    [RequiresDockerFact]
    public async Task ConcurrentClears_ExactlyOneWins_AndOneAlertClearedIsWritten()
    {
        await using var host = await StartAsync();
        var exercise = await host.SeedExerciseAsync();
        host.ActAs(exercise.ExerciseId, exercise.StaffUserId);
        var id = await RaiseOkAsync(host, new { severity = "emergency", headline = "Race" });

        var responses = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => ClearAsync(host, id)));

        responses.Count(r => r.StatusCode == HttpStatusCode.NoContent).Should().Be(1);
        responses.Count(r => r.StatusCode == HttpStatusCode.NotFound).Should().Be(5,
            "a losing clear (stale Version, or already cleared) is the no-op 404, never a 500");
        await using var db = host.Db(exercise.ExerciseId);
        (await db.TelemetryEvents.CountAsync(e => e.EventType == "alert_cleared")).Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task Raise_Validation_Is400_WithAReadableDetail()
    {
        await using var host = await StartAsync();
        var exercise = await host.SeedExerciseAsync();
        host.ActAs(exercise.ExerciseId, exercise.StaffUserId);

        foreach (var body in new object[]
                 {
                     new { severity = "severe", headline = "x" },
                     new { severity = "info", headline = "" },
                     new { severity = "info", headline = new string('a', 201) },
                     new { severity = "info", headline = "<b></b>" },
                     new { severity = "info", headline = "x", href = "https://evil.example/" },
                     new { severity = "info", headline = "x", expiresScenarioTime = "2000-01-01T00:00:00Z" },
                 })
        {
            var response = await host.Client.PostAsJsonAsync("/api/alerts", body);
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "{0} is invalid", JsonSerializer.Serialize(body));
            (await response.Content.ReadFromJsonAsync<ProblemDetails>())!.Detail.Should().NotBeNullOrWhiteSpace();
        }

        await using var db = host.Db(exercise.ExerciseId);
        (await db.ChannelAlerts.CountAsync()).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task Mutations_AreControllerOnly_ParticipantAndAnonymous401_Evaluator403()
    {
        await using var host = await StartAsync();
        var exercise = await host.SeedExerciseAsync();
        var evaluator = await host.AddStaffAsync(exercise.ExerciseId, "evaluator", "Eve Evaluator");
        host.ActAs(exercise.ExerciseId, exercise.StaffUserId);
        var id = await RaiseOkAsync(host, new { severity = "info", headline = "x" });
        var body = new { severity = "info", headline = "y" };

        host.ActAs(exercise.ExerciseId, staffUserId: null); // participant
        (await host.Client.PostAsJsonAsync("/api/alerts", body)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await ClearAsync(host, id)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        host.ActAs(exerciseId: null, staffUserId: null); // anonymous
        (await host.Client.PostAsJsonAsync("/api/alerts", body)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await host.Client.GetAsync(new Uri("/api/alerts/history", UriKind.Relative)))
            .StatusCode.Should().Be(HttpStatusCode.Unauthorized, "an unresolved scope fails closed, never an empty 200");

        host.ActAs(exercise.ExerciseId, evaluator);
        (await host.Client.PostAsJsonAsync("/api/alerts", body)).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await ClearAsync(host, id)).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        host.ActAs(exercise.ExerciseId, exercise.StaffUserId);
        (await ActiveIdsAsync(host)).Should().Equal(id);
    }

    [RequiresDockerFact]
    public async Task Isolation_AnotherExercisesAlertId_IsIndistinguishableFromUnknown()
    {
        await using var host = await StartAsync();
        var a = await host.SeedExerciseAsync();
        var b = await host.SeedExerciseAsync();
        host.ActAs(a.ExerciseId, a.StaffUserId);
        var aId = await RaiseOkAsync(host, new { severity = "emergency", headline = "A only" });

        host.ActAs(b.ExerciseId, b.StaffUserId);
        var cross = await ClearAsync(host, aId);
        var unknown = await ClearAsync(host, Guid.NewGuid().ToString());
        cross.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await cross.Content.ReadAsStringAsync()).Should().Be(await unknown.Content.ReadAsStringAsync());
        (await ActiveIdsAsync(host)).Should().BeEmpty();
        var history = await host.Client.GetFromJsonAsync<JsonElement>("/api/alerts/history");
        history.GetProperty("alerts").GetArrayLength().Should().Be(0);

        host.ActAs(a.ExerciseId, a.StaffUserId);
        (await ActiveIdsAsync(host)).Should().Equal(aId);
        await using var db = host.Db(b.ExerciseId);
        (await db.ChannelAlerts.CountAsync()).Should().Be(0);
        (await db.ChannelAlerts.IgnoreQueryFilters().CountAsync(x => x.Id == Guid.Parse(aId))).Should().Be(1);
    }

    private static async Task<string> RaiseOkAsync(InjectTestHost host, object body)
    {
        var response = await host.Client.PostAsJsonAsync("/api/alerts", body);
        response.StatusCode.Should().Be(HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
    }

    private static Task<HttpResponseMessage> ClearAsync(InjectTestHost host, string id) =>
        host.Client.PostAsync(new Uri($"/api/alerts/{id}/clear", UriKind.Relative), content: null);

    private static async Task<string[]> ActiveIdsAsync(InjectTestHost host) =>
        (await host.Client.GetFromJsonAsync<JsonElement>("/api/alerts")).GetProperty("alerts").EnumerateArray()
            .Select(a => a.GetProperty("id").GetString()!)
            .ToArray();

    private Task<InjectTestHost> StartAsync() => InjectTestHost.StartAsync(
        _fixture.ConnectionString!,
        configureServices: services =>
        {
            services.AddExerciseConfiguration();
            services.AddChannels();
            var sweeper = services.Single(d =>
                d.ServiceType == typeof(IHostedService) && d.ImplementationType == typeof(AlertExpirySweeper));
            services.Remove(sweeper);
        },
        mapEndpoints: app =>
        {
            app.MapParticipantShellEndpoints();
            app.MapChannels();
        });
}
