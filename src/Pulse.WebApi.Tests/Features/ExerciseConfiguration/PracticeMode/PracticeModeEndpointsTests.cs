namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration.PracticeMode;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// HTTP integration tests for the staff practice/sandbox surface (<c>GET/PUT /api/staff/practice-mode</c>,
/// COR-033) over the composed <see cref="PracticeModeTestHost"/> and the shared migrated real SQL Server.
/// </summary>
/// <remarks>
/// Covers the flag's persist/reload round trip and its default-off state, the staff gate (401/403), the
/// fail-closed 400, the isolation cases (a write in A cannot reach B; a read in A never reports B's flag),
/// the XC-004 audit event, and the story's "otherwise fully functional" guarantee — a flagged exercise serves
/// every participant-shell config byte-for-byte identically and never mentions practice mode anywhere.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class PracticeModeEndpointsTests
{
    private const string Route = "/api/staff/practice-mode";

    /// <summary>The six frozen participant-shell config GETs the flag must leave completely alone.</summary>
    private static readonly string[] ParticipantShellRoutes =
    [
        "/api/shell-state",
        "/api/chrome-config",
        "/api/brand-tokens",
        "/api/channel-nav-config",
        "/api/alerts",
        "/api/overlay-state",
    ];

    private readonly MsSqlContainerFixture _fixture;

    public PracticeModeEndpointsTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // ---- the staff gate (XC-002 / COR-005) -------------------------------------------------------

    [RequiresDockerFact]
    public async Task Get_NoStaffSession_Returns401_FailClosed()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, practiceMode: true);

        await using var host = await StartHostAsync(exerciseId, authenticatedStaff: false);
        var response = await host.Client.GetAsync(new Uri(Route, UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "practice state is staff-world only — a participant / read-only / anonymous caller must never read it");
    }

    [RequiresDockerFact]
    public async Task Get_StaffNotAssignedToTheResolvedExercise_Returns403_FailClosed()
    {
        var resolvedExercise = Guid.NewGuid();
        var assignedElsewhere = Guid.NewGuid();
        await SeedExerciseAsync(resolvedExercise);

        await using var host = await StartHostAsync(resolvedExercise, assignedExerciseId: assignedElsewhere);
        var response = await host.Client.GetAsync(new Uri(Route, UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.Forbidden,
            "a staff user not assigned to the resolved exercise must not read its practice state (COR-005)");
    }

    [RequiresDockerFact]
    public async Task Get_UnresolvedScope_Returns401_FailClosed()
    {
        await using var host = await StartHostAsync(exerciseId: null);
        var response = await host.Client.GetAsync(new Uri(Route, UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized, "an unresolved scope fails closed, never a default/empty-200");
    }

    [RequiresDockerFact]
    public async Task Put_NoStaffSession_Returns401_AndWritesNothing()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId, authenticatedStaff: false);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new { isPracticeMode = true });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await LoadAsync(exerciseId)).IsPracticeMode.Should().BeFalse(
            "the gate rejects before the handler runs, so nothing is flagged");
    }

    // ---- read + write: the COR-033 round trip ----------------------------------------------------

    [RequiresDockerFact]
    public async Task Get_ExerciseThatWasNeverFlagged_ReportsPracticeModeOff_AndEvaluationEligible()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var body = await GetOkAsync(host);

        body.GetProperty("exerciseId").GetString().Should().Be(
            exerciseId.ToString(), "the response echoes the SERVER-resolved scope, it never accepted one");
        body.GetProperty("isPracticeMode").GetBoolean().Should().BeFalse(
            "the flag defaults to off for every exercise that has never been flagged (COR-033)");
        body.GetProperty("evaluationEligible").GetBoolean().Should().BeTrue(
            "unflagged is real conduct, so its data belongs in an evaluation export");
    }

    [RequiresDockerFact]
    public async Task Put_FlaggingTheExercise_PersistsAndSurvivesAReload_AndTurnsOffEvaluationEligibility()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new { isPracticeMode = true });

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var written = await ReadJsonAsync(response);
        written.GetProperty("isPracticeMode").GetBoolean().Should().BeTrue();
        written.GetProperty("evaluationEligible").GetBoolean().Should().BeFalse(
            "the write response reports the consequence through the SAME eligibility seam E10 reads");

        (await LoadAsync(exerciseId)).IsPracticeMode.Should().BeTrue("the flag is persisted on the exercise");

        var reloaded = await GetOkAsync(host);
        reloaded.GetProperty("isPracticeMode").GetBoolean().Should().BeTrue("and it survives a reload");
        reloaded.GetProperty("evaluationEligible").GetBoolean().Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task Put_ClearingTheFlag_RestoresEvaluationEligibility()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, practiceMode: true);

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new { isPracticeMode = false });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await LoadAsync(exerciseId)).IsPracticeMode.Should().BeFalse();

        var reloaded = await GetOkAsync(host);
        reloaded.GetProperty("isPracticeMode").GetBoolean().Should().BeFalse();
        reloaded.GetProperty("evaluationEligible").GetBoolean().Should().BeTrue(
            "a run that is no longer a rehearsal is evaluable again");
    }

    [RequiresDockerFact]
    public async Task Put_WithoutIsPracticeMode_Returns400_AndLeavesTheFlagUnchanged()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, practiceMode: true);

        await using var host = await StartHostAsync(exerciseId);
        using var content = new StringContent("{}", Encoding.UTF8, "application/json");
        var response = await host.Client.PutAsync(new Uri(Route, UriKind.Relative), content);

        response.StatusCode.Should().Be(
            HttpStatusCode.BadRequest, "an absent flag is a validation failure, never an implied 'off'");
        (await LoadAsync(exerciseId)).IsPracticeMode.Should().BeTrue("a rejected write persists nothing");
    }

    [RequiresDockerFact]
    public async Task Put_MissingBody_Returns400()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        using var content = new StringContent("null", Encoding.UTF8, "application/json");
        var response = await host.Client.PutAsync(new Uri(Route, UriKind.Relative), content);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "a missing body is rejected before the service");
    }

    // ---- isolation (always-Critical) -------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Put_InExerciseA_NeverFlagsExerciseB_EvenWhenTheBodyNamesIt()
    {
        // The request DTO has NO exercise id, so a client-supplied one is not merely ignored — there is
        // nowhere for it to bind. Exercise is the SCOPE, not an IExerciseScoped entity, so the central query
        // filter is a no-op here and the service's own scoping is the guard.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        await SeedExerciseAsync(exerciseA);
        await SeedExerciseAsync(exerciseB);

        await using var host = await StartHostAsync(exerciseA);
        using var content = new StringContent(
            JsonSerializer.Serialize(new
            {
                exerciseId = exerciseB.ToString(),
                id = exerciseB.ToString(),
                isPracticeMode = true,
            }),
            Encoding.UTF8,
            "application/json");

        var response = await host.Client.PutAsync(new Uri(Route, UriKind.Relative), content);

        response.StatusCode.Should().Be(HttpStatusCode.OK, "the unknown body fields are ignored, not fatal");

        (await LoadAsync(exerciseB)).IsPracticeMode.Should().BeFalse(
            "exercise B must be untouched by a write scoped to A — flagging B would silently drop B from its AAR");
        (await LoadAsync(exerciseA)).IsPracticeMode.Should().BeTrue(
            "the write landed on the SERVER-resolved exercise, A");
    }

    [RequiresDockerFact]
    public async Task Get_InExerciseA_NeverReportsExerciseBsFlag()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        await SeedExerciseAsync(exerciseA);
        await SeedExerciseAsync(exerciseB, practiceMode: true);

        await using var host = await StartHostAsync(exerciseA);
        var body = await GetOkAsync(host);

        body.GetProperty("exerciseId").GetString().Should().Be(exerciseA.ToString());
        body.GetProperty("isPracticeMode").GetBoolean().Should().BeFalse(
            "B's rehearsal flag must never be reported to a console scoped to A");
    }

    // ---- XC-002 / "otherwise fully functional" ---------------------------------------------------

    [RequiresDockerFact]
    public async Task FlaggingPracticeMode_LeavesEveryParticipantShellConfigByteIdentical_AndMentionsItNowhere()
    {
        // The story's AC: a flagged exercise remains OTHERWISE FULLY FUNCTIONAL, and practice state is never
        // exposed on a participant surface (XC-002). The participant read model structurally omits the flag,
        // so this pins that a projection cannot leak what it was never handed.
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var before = await ReadShellSurfacesAsync(host);

        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new { isPracticeMode = true });
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var after = await ReadShellSurfacesAsync(host);

        foreach (var route in ParticipantShellRoutes)
        {
            after[route].Should().Be(
                before[route],
                "flagging practice mode must change nothing a participant sees on {0}", route);
            after[route].Should().NotContainEquivalentOf(
                "practice", "practice/sandbox state is staff-world only (XC-002)");
            after[route].Should().NotContainEquivalentOf("sandbox");
        }
    }

    // ---- XC-004 telemetry ------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Put_ThatFlipsTheFlag_EmitsExactlyOnePracticeModeTelemetryEvent()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new { isPracticeMode = true });

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        await using var context = _fixture.CreateContext();
        var events = await context.TelemetryEvents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(e => e.ExerciseId == exerciseId)
            .ToListAsync();

        var practiceEvent = events.Should().ContainSingle(
            "exactly ONE telemetry event per meaningful action (XC-004)").Subject;
        practiceEvent.EventType.Should().Be("exercise.practice_mode.updated");
        practiceEvent.SchemaVersion.Should().Be("v0");
        practiceEvent.Actor.Kind.Should().Be("system");
        practiceEvent.Actor.ActingHumanId.Should().Be(
            host.StaffUserId.ToString(), "the acting staff human is attributed, never an empty string");
        practiceEvent.Target!.EntityType.Should().Be("exercise");
        practiceEvent.Target.EntityId.Should().Be(exerciseId.ToString());
        practiceEvent.Payload.Should().Contain("isPracticeMode");
    }

    [RequiresDockerFact]
    public async Task Put_ThatChangesNothing_PersistsNothingAndEmitsNoTelemetry()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, practiceMode: true);

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new { isPracticeMode = true });

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        await using var context = _fixture.CreateContext();
        var count = await context.TelemetryEvents
            .IgnoreQueryFilters()
            .CountAsync(e => e.ExerciseId == exerciseId);

        count.Should().Be(0, "a no-op write is not a meaningful action");
    }

    // ---- helpers ---------------------------------------------------------------------------------

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    private static async Task<JsonElement> GetOkAsync(PracticeModeTestHost host)
    {
        var response = await host.Client.GetAsync(new Uri(Route, UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK, "{0} must return 200 for an assigned staff caller", Route);
        return await ReadJsonAsync(response);
    }

    /// <summary>Reads the six participant-shell config GETs as raw bodies, for a before/after comparison.</summary>
    private static async Task<IReadOnlyDictionary<string, string>> ReadShellSurfacesAsync(PracticeModeTestHost host)
    {
        var bodies = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var route in ParticipantShellRoutes)
        {
            var response = await host.Client.GetAsync(new Uri(route, UriKind.Relative));
            response.StatusCode.Should().Be(HttpStatusCode.OK, "{0} must keep serving participants", route);
            bodies[route] = await response.Content.ReadAsStringAsync();
        }

        return bodies;
    }

    /// <remarks>
    /// The fixture name deliberately contains NEITHER "practice" NOR "sandbox".
    /// <see cref="FlaggingPracticeMode_LeavesEveryParticipantShellConfigByteIdentical_AndMentionsItNowhere"/>
    /// asserts no shell body contains those words; naming the fixture "Practice Mode Exercise" made that
    /// assertion pass only because no shell response happens to echo the exercise name today. The moment
    /// story 02 routes a name into <c>brand-tokens</c> or <c>chrome-config</c>, such a fixture would fail on
    /// its OWN name rather than on a real XC-002 leak — a false positive that hides the real check. Keep this
    /// name leak-word-free so the assertion tests only what it claims.
    /// </remarks>
    private async Task SeedExerciseAsync(Guid exerciseId, bool practiceMode = false)
    {
        var exercise = ExerciseConfigurationTestData.UnconfiguredExercise(exerciseId, "Rehearsal Fixture Exercise");
        exercise.IsPracticeMode = practiceMode;

        await using var context = _fixture.CreateContext();
        context.Exercises.Add(exercise);
        await context.SaveChangesAsync();
    }

    private async Task<Exercise> LoadAsync(Guid exerciseId)
    {
        await using var context = _fixture.CreateContext();
        return await context.Exercises.AsNoTracking().SingleAsync(e => e.Id == exerciseId);
    }

    private Task<PracticeModeTestHost> StartHostAsync(
        Guid? exerciseId,
        bool authenticatedStaff = true,
        Guid? assignedExerciseId = null)
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");
        return PracticeModeTestHost.StartAsync(
            _fixture.ConnectionString!, exerciseId, authenticatedStaff, assignedExerciseId);
    }
}
