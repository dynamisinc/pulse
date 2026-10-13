namespace Pulse.WebApi.Tests.Features.Identity.DayWord;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.DayWord;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using static Pulse.WebApi.Tests.Features.Identity.DayWord.DayWordTestSupport;

/// <summary>
/// easy-login/05 (Telemetry, XC-004; NFR-009) — every word sign-in emits one <c>login</c> event with
/// <c>method: "word"</c> (success: the participant; failure: an identity-less <c>system</c> actor whose target is the
/// sanitized attempted sign-in name, never the word); a set emits <c>credential.rotated</c> (<c>first</c>,
/// <c>generated</c>, <c>date</c>) and a clear <c>credential.revoked</c>, both targeting <c>dayWord</c> with the staff
/// role and acting human. Every event passes the v0 envelope rules. The failure target is nulled when the attempted
/// name (a) normalises to the attempted word or (b) verifies as today's word (story 01 Gate-1 fold). And the word, set
/// or attempted, appears in NO event, log line, exception or response body except the one-time
/// <c>DayWordSetResultDto.word</c>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class DayWordTelemetryTests
{
    private const string Word = "Maple Harbor 42";

    private static readonly DateOnly Today = new(2026, 10, 13);
    private static readonly DateTimeOffset Scenario = new(2031, 4, 2, 8, 15, 0, TimeSpan.FromHours(-4));

    private readonly MsSqlContainerFixture _fixture;

    public DayWordTelemetryTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    // ---------------------------------------------------------------- sign-in events

    [RequiresDockerFact]
    public async Task ASuccess_EmitsOneLoginEvent_WithTheParticipantActor()
    {
        var exercise = await SeedExerciseAsync(_fixture);
        var account = await SeedAccountAsync(_fixture, exercise.Id, "jsmith");
        await SeedWordAsync(_fixture, exercise.Id, Today, Word);

        await SignInAsync(exercise.Id, "jsmith", Word, new StubExerciseClock(Scenario));

        var evt = (await ReadEventsAsync(_fixture, exercise.Id)).Should().ContainSingle().Subject;
        evt.EventType.Should().Be("login");
        evt.Channel.Should().Be("system");
        evt.SchemaVersion.Should().Be("v0");
        evt.Actor.Kind.Should().Be("participant");
        evt.Actor.ParticipantId.Should().Be(account.Id.ToString());
        evt.Target.Should().BeNull();
        evt.Payload.Should().Be("{\"outcome\":\"success\",\"method\":\"word\"}");
        evt.WallClockTime.Should().Be(DefaultNow, "the one server clock read");
        evt.EmittedAt.Should().Be(DefaultNow);
        evt.ScenarioTime.Should().Be(Scenario, "scenario time comes from the exercise clock (COR-053)");
        evt.TimeZone.Should().Be("America/New_York");
        TelemetryEnvelopeRules.Validate(TelemetryAttributionFacts.FromEntity(evt)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task AWrongWord_KeepsThePlainSanitizedSignInName_AsTheTarget()
    {
        var exercise = await SeedExerciseAsync(_fixture, scenarioTime: Scenario);
        await SeedAccountAsync(_fixture, exercise.Id, "jsmith");
        await SeedWordAsync(_fixture, exercise.Id, Today, Word);

        await SignInAsync(exercise.Id, "<b>jsmith</b>", "Totally Wrong 11");

        var evt = (await ReadEventsAsync(_fixture, exercise.Id)).Should().ContainSingle().Subject;
        evt.Actor.Kind.Should().Be("system", "an identity-less failure is a system actor (#356)");
        evt.Actor.ParticipantId.Should().BeNull();
        evt.Target.Should().NotBeNull();
        evt.Target!.EntityType.Should().Be("accountHandle");
        evt.Target.EntityId.Should().Be("jsmith", "the target is the SANITIZED attempted sign-in name");
        evt.Payload.Should().Be("{\"outcome\":\"failure\",\"method\":\"word\"}");
        evt.ScenarioTime.Should().Be(Scenario, "with no live clock the stored scenario instant is used");
        TelemetryEnvelopeRules.Validate(TelemetryAttributionFacts.FromEntity(evt)).Should().BeEmpty();
        JsonSerializer.Serialize(evt).Should().NotContainEquivalentOf("totally").And.NotContainEquivalentOf("wrong11");
    }

    /// <summary>A custom word with no two-digit tail, so story 01's shape-based redactor KEEPS it as a name.</summary>
    private const string CustomWord = "Sunflower Valley";

    [RequiresDockerTheory]
    [InlineData("sunflowervalley", "garbage in here")]
    [InlineData("SunflowerValley", "jsmith")]
    [InlineData("sunflower_valley", "not the word")]
    public async Task B_TodaysWordTypedIntoTheNameBox_IsNotRecorded(string name, string word)
    {
        // Precondition: story 01's redactor alone would record this name; only the caller-side check (b) drops it.
        EasyLoginTelemetry.RedactAttemptedName(name).Should().Be(name);

        var exercise = await SeedExerciseAsync(_fixture);
        await SeedAccountAsync(_fixture, exercise.Id, "jsmith");
        await SeedWordAsync(_fixture, exercise.Id, Today, CustomWord);

        var hasher = new CountingHasher();
        var outcome = await SignInAsync(exercise.Id, name, word, hasher: hasher);

        outcome.Should().Be(WordLoginOutcome.Rejected);
        hasher.Calls.Should().Equal(["Verify", "Verify"], "the refusal checks the NAME against today's hash once");
        var evt = (await ReadEventsAsync(_fixture, exercise.Id)).Should().ContainSingle().Subject;
        evt.Target.Should().BeNull("the name box held today's word: it must never reach telemetry");
        JsonSerializer.Serialize(evt).Should().NotContainEquivalentOf("sunflower");
    }

    [RequiresDockerTheory]
    [InlineData("pinecone", "Pine Cone")]
    [InlineData("sunflower", "SUNFLOWER")]
    [InlineData("cafecreme", "Café Crème")]
    public async Task A_ANameEqualToTheAttemptedWord_IsNotRecorded(string name, string word)
    {
        // Precondition: story 01's redactor alone would record this name; only the caller-side check (a) drops it.
        EasyLoginTelemetry.RedactAttemptedName(name).Should().Be(name);

        var exercise = await SeedExerciseAsync(_fixture);
        await SeedAccountAsync(_fixture, exercise.Id, "jsmith");
        await SeedWordAsync(_fixture, exercise.Id, Today, CustomWord);

        await SignInAsync(exercise.Id, name, word);

        var evt = (await ReadEventsAsync(_fixture, exercise.Id)).Should().ContainSingle().Subject;
        evt.Target.Should().BeNull("a custom word typed into both boxes is still a word, not a sign-in name");
        JsonSerializer.Serialize(evt).Should().NotContainEquivalentOf(name);
    }

    [RequiresDockerFact]
    public async Task WithNoWordSet_TheNameIsStillChecked_AgainstTheDecoy_AndKept()
    {
        var exercise = await SeedExerciseAsync(_fixture);

        var hasher = new CountingHasher();
        await SignInAsync(exercise.Id, "jsmith", Word, hasher: hasher);

        hasher.Calls.Should().Equal(["VerifyDecoy", "VerifyDecoy"], "no hash: both checks pay the decoy, so 'no word today' is not quicker");
        (await ReadEventsAsync(_fixture, exercise.Id)).Should().ContainSingle().Which.Target!.EntityId.Should().Be("jsmith");
    }

    // ---------------------------------------------------------------- staff events

    [RequiresDockerFact]
    public async Task SetAndReplace_EmitCredentialRotated_WithFirstGeneratedAndDate()
    {
        var exercise = await SeedExerciseAsync(_fixture);
        var staffUserId = await SeedStaffAsync(_fixture, exercise.Id, "planner");

        var first = await StaffAsync(exercise.Id, staffUserId, s => s.SetAsync(new DayWordPutBody { Word = Word }));
        var second = await StaffAsync(exercise.Id, staffUserId, s => s.SetAsync(new DayWordPutBody()));
        var preset = await StaffAsync(exercise.Id, staffUserId, s => s.SetAsync(new DayWordPutBody { Word = Word, Date = "2026-10-20" }));

        var rows = await ReadWordsAsync(_fixture, exercise.Id);
        var todayRow = rows.Single(r => r.ForDate == Today);
        var presetRow = rows.Single(r => r.ForDate == new DateOnly(2026, 10, 20));

        var events = (await ReadEventsAsync(_fixture, exercise.Id)).OrderBy(e => e.Payload).ToList();
        events.Should().HaveCount(3, "one event per set, in the same unit of work");
        events.Should().OnlyContain(e => e.EventType == "credential.rotated" && e.Channel == "system");
        events.Should().OnlyContain(e => e.Actor.Kind == "system" && e.Actor.Role == "planner"
            && e.Actor.ActingHumanId == staffUserId.ToString() && e.Actor.ParticipantId == null);
        events.Should().OnlyContain(e => e.Target!.EntityType == "dayWord");
        events.Select(e => e.Payload).Should().BeEquivalentTo(
            "{\"date\":\"2026-10-13\",\"first\":true,\"generated\":false}",
            "{\"date\":\"2026-10-13\",\"first\":false,\"generated\":true}",
            "{\"date\":\"2026-10-20\",\"first\":true,\"generated\":false}");
        events.Where(e => e.Payload!.Contains("2026-10-13", StringComparison.Ordinal))
            .Should().OnlyContain(e => e.Target!.EntityId == todayRow.Id.ToString());
        events.Single(e => e.Payload!.Contains("2026-10-20", StringComparison.Ordinal)).Target!.EntityId.Should().Be(presetRow.Id.ToString());

        foreach (var evt in events)
        {
            TelemetryEnvelopeRules.Validate(TelemetryAttributionFacts.FromEntity(evt)).Should().BeEmpty();
            var json = JsonSerializer.Serialize(evt);
            json.Should().NotContainEquivalentOf("maple").And.NotContainEquivalentOf("harbor");
            json.Should().NotContainEquivalentOf(second.SetResult!.Word).And.NotContainEquivalentOf(DayWordNormalizer.Normalize(second.SetResult.Word));
        }

        first.SetResult!.Replaced.Should().BeFalse();
        preset.SetResult!.Replaced.Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task Clear_EmitsCredentialRevoked_AndANoOpClearEmitsNothing()
    {
        var exercise = await SeedExerciseAsync(_fixture);
        var staffUserId = await SeedStaffAsync(_fixture, exercise.Id);
        await StaffAsync(exercise.Id, staffUserId, s => s.SetAsync(new DayWordPutBody { Word = Word }));
        var rowId = (await ReadWordsAsync(_fixture, exercise.Id)).Single().Id;

        await StaffAsync(exercise.Id, staffUserId, s => s.ClearAsync(null));
        await StaffAsync(exercise.Id, staffUserId, s => s.ClearAsync(null));

        var revoked = (await ReadEventsAsync(_fixture, exercise.Id)).Where(e => e.EventType == "credential.revoked").ToList();
        var evt = revoked.Should().ContainSingle("the idempotent second clear removed nothing and emits nothing").Subject;
        evt.Payload.Should().Be("{\"date\":\"2026-10-13\"}");
        evt.Target!.EntityType.Should().Be("dayWord");
        evt.Target.EntityId.Should().Be(rowId.ToString());
        evt.Actor.Role.Should().Be("controller");
        evt.Actor.ActingHumanId.Should().Be(staffUserId.ToString());
        TelemetryEnvelopeRules.Validate(TelemetryAttributionFacts.FromEntity(evt)).Should().BeEmpty();
    }

    // ---------------------------------------------------------------- the word appears nowhere

    [RequiresDockerFact]
    public async Task TheWord_SetOrAttempted_AppearsInNoEventLogLineOrResponseBody_ButTheOneTimeSetResult()
    {
        var exercise = await SeedExerciseAsync(_fixture, hostname: $"dw{Guid.NewGuid():N}.example.test");
        var staffUserId = await SeedStaffAsync(_fixture, exercise.Id);
        await SeedAccountAsync(_fixture, exercise.Id, "jsmith");
        var token = $"staff-{Guid.NewGuid():N}";
        await using (var seed = _fixture.CreateContext())
        {
            seed.Sessions.Add(DayWordHttpTestHost.StaffSession(token, exercise.Id, staffUserId));
            await seed.SaveChangesAsync();
        }

        await using var host = await DayWordHttpTestHost.StartAsync(_fixture.ConnectionString!);
        using var staff = host.CreateClient("staff.example.test", token);
        using var anonymous = host.CreateClient(exercise.Hostname!);
        var bodies = new List<string>();

        // Staff: a typed word for today, a generated word for tomorrow, a read, a clear, a refused set.
        var typed = await PutAsync(staff, new { word = "Sunflower Valley 93" });
        var generated = await PutAsync(staff, new { date = "2026-10-14" });
        bodies.Add(await (await staff.GetAsync("/api/staff/day-word")).Content.ReadAsStringAsync());
        bodies.Add(await (await staff.DeleteAsync("/api/staff/day-word?date=2026-10-14")).Content.ReadAsStringAsync());
        bodies.Add(await (await staff.PutAsJsonAsync("/api/staff/day-word", new { word = "Pelican Bay 77", date = "2026-10-12" })).Content.ReadAsStringAsync());

        // Anonymous: a success, a wrong word, the word in the name box, a word in both boxes, an oversized word, and a
        // body that is not valid JSON (the deserializer's own failure path).
        bodies.Add(await PostWordAsync(anonymous, "{\"signInName\":\"jsmith\",\"word\":\"sunflower-valley-93\"}"));
        bodies.Add(await PostWordAsync(anonymous, "{\"signInName\":\"jsmith\",\"word\":\"Zebra Crossing 55\"}"));
        bodies.Add(await PostWordAsync(anonymous, "{\"signInName\":\"sunflowervalley93\",\"word\":\"nope nope\"}"));
        bodies.Add(await PostWordAsync(anonymous, "{\"signInName\":\"crossingzebra11\",\"word\":\"Crossing Zebra 11\"}"));
        bodies.Add(await PostWordAsync(anonymous, "{\"signInName\":\"jsmith\",\"word\":\"Gannet" + new string('g', 300) + "\"}"));
        bodies.Add(await PostWordAsync(anonymous, "{\"signInName\":\"jsmith\",\"word\":\"Truncated Secret 12"));

        // The one place a word may appear: the PUT 200's word field. Strip it; keep the rest of those bodies.
        typed.Word.Should().Be("Sunflower Valley 93");
        bodies.Add(typed.BodyWithoutWord);
        bodies.Add(generated.BodyWithoutWord);

        var secrets = new[]
        {
            "Sunflower Valley 93", "sunflowervalley93", "sunflower-valley-93",
            generated.Word, DayWordNormalizer.Normalize(generated.Word),
            "Zebra Crossing 55", "zebracrossing55", "nope nope", "nopenope", "crossingzebra11", "Crossing Zebra 11",
            "Gannet", "Pelican", "pelicanbay77", "Truncated Secret", "truncatedsecret12",
        };

        var events = (await ReadEventsAsync(_fixture, exercise.Id)).Select(e => JsonSerializer.Serialize(e)).ToList();
        events.Should().NotBeEmpty();
        var rows = (await ReadWordsAsync(_fixture, exercise.Id)).Select(r => JsonSerializer.Serialize(r)).ToList();
        var logs = host.Logs.Entries.ToList();
        logs.Should().NotBeEmpty("the capture must actually be seeing the host's log output");

        foreach (var secret in secrets)
        {
            events.Should().NotContain(e => e.Contains(secret, StringComparison.OrdinalIgnoreCase), "no event may carry '{0}'", secret);
            rows.Should().NotContain(r => r.Contains(secret, StringComparison.OrdinalIgnoreCase), "storage holds only the hash, never '{0}'", secret);
            logs.Should().NotContain(l => l.Contains(secret, StringComparison.OrdinalIgnoreCase), "no log line may carry '{0}'", secret);
            bodies.Should().NotContain(b => b.Contains(secret, StringComparison.OrdinalIgnoreCase), "no response body may carry '{0}'", secret);
        }
    }

    // ---------------------------------------------------------------- helpers

    private async Task<WordLoginOutcome> SignInAsync(
        Guid exerciseId,
        string name,
        string word,
        StubExerciseClock? clock = null,
        CountingHasher? hasher = null)
    {
        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
        var service = LoginService(context, exerciseId, ClockAt(DefaultNow), new RecordingSessionIssuer(), hasher, exerciseClock: clock);
        return (await service.SignInAsync(Body(name, word))).Outcome;
    }

    private async Task<DayWordResult> StaffAsync(Guid exerciseId, Guid staffUserId, Func<DayWordService, Task<DayWordResult>> action)
    {
        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
        return await action(StaffService(context, exerciseId, staffUserId, ClockAt(DefaultNow)));
    }

    private static async Task<(string Word, string BodyWithoutWord)> PutAsync(HttpClient staff, object body)
    {
        using var response = await staff.PutAsJsonAsync("/api/staff/day-word", body);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();
        var word = json["word"]!.GetValue<string>();
        json.Remove("word");
        return (word, json.ToJsonString());
    }

    private static async Task<string> PostWordAsync(HttpClient anonymous, string json)
    {
        using var response = await anonymous.PostAsync("/api/auth/word", new StringContent(json, Encoding.UTF8, "application/json"));
        return await response.Content.ReadAsStringAsync();
    }
}
