namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration.Chrome;

using System;
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
using Pulse.WebApi.Features.ExerciseConfiguration.Chrome;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// HTTP integration tests for story 02's staff chrome surface
/// (<c>GET/PUT /api/staff/chrome-settings</c>) over the composed <see cref="ChromeTestHost"/> and the shared
/// migrated real SQL Server.
/// </summary>
/// <remarks>
/// Covers the COR-031 persist/reload round trip and its participant-visible consequence, the NFR-008
/// chrome↔watermark mutual guard in both directions, the staff gate (401/403), NFR-004 sanitization end to
/// end, the fail-closed 400s that leave the stored config untouched, isolation (a chrome write in exercise A
/// cannot reach exercise B even when the body tries), and the XC-004 telemetry event.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class ChromeSettingsEndpointsTests
{
    private const string Route = ChromeSettingsEndpoints.ChromeSettingsRoute;
    private const string ChromeConfigRoute = "/api/chrome-config";

    private readonly MsSqlContainerFixture _fixture;

    public ChromeSettingsEndpointsTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // ---- the staff gate (XC-002 / COR-005) -------------------------------------------------------

    [RequiresDockerFact]
    public async Task Get_NoStaffSession_Returns401_FailClosed()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId, authenticatedStaff: false);
        var response = await host.Client.GetAsync(new Uri(Route, UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "a participant / shared read-only / anonymous caller must never read or edit staff-world chrome config");
    }

    [RequiresDockerFact]
    public async Task Put_NoStaffSession_Returns401_AndWritesNothing()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, e => e.ChromeTopText = "Untouched");

        await using var host = await StartHostAsync(exerciseId, authenticatedStaff: false);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), ValidBody("Renamed banner"));

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await LoadAsync(exerciseId)).ChromeTopText.Should().Be(
            "Untouched", "the gate rejects before the handler runs");
    }

    [RequiresDockerFact]
    public async Task Get_StaffNotAssignedToTheResolvedExercise_Returns403_FailClosed()
    {
        // The cross-exercise case: there is no way to NAME another exercise on this surface, so "cross-exercise
        // chrome read" can only mean a staff caller whose assignment is elsewhere. That is a 403 (COR-005).
        var resolvedExercise = Guid.NewGuid();
        var assignedElsewhere = Guid.NewGuid();
        await SeedExerciseAsync(resolvedExercise);

        await using var host = await StartHostAsync(resolvedExercise, assignedExerciseId: assignedElsewhere);
        var response = await host.Client.GetAsync(new Uri(Route, UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.Forbidden,
            "a staff user not assigned to the resolved exercise must not read its chrome config");
    }

    [RequiresDockerFact]
    public async Task Put_StaffNotAssignedToTheResolvedExercise_Returns403_AndWritesNothing()
    {
        var resolvedExercise = Guid.NewGuid();
        var assignedElsewhere = Guid.NewGuid();
        await SeedExerciseAsync(resolvedExercise, e => e.ChromeTopText = "Original banner");

        await using var host = await StartHostAsync(resolvedExercise, assignedExerciseId: assignedElsewhere);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), ValidBody("Hijacked banner"));

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await LoadAsync(resolvedExercise)).ChromeTopText.Should().Be("Original banner");
    }

    [RequiresDockerFact]
    public async Task Get_UnresolvedScope_Returns401_FailClosed()
    {
        await using var host = await StartHostAsync(exerciseId: null);
        var response = await host.Client.GetAsync(new Uri(Route, UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized, "an unresolved scope fails closed, never a default/empty-200");
    }

    // ---- read ------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Get_ResolvedExercise_ReturnsTheChromeBlock_WithUnconfiguredFieldsNull()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, e => e.ChromeTopText = "UNCLASSIFIED // ATLANTA");

        await using var host = await StartHostAsync(exerciseId);
        var root = await GetOkAsync(host);

        root.GetProperty("exerciseId").GetString().Should().Be(
            exerciseId.ToString(), "the response echoes the SERVER-resolved scope, it never accepted one");
        root.GetProperty("chromeEnabled").GetBoolean().Should().BeTrue();
        root.GetProperty("watermarkEnabled").GetBoolean().Should().BeTrue();
        root.GetProperty("topText").GetString().Should().Be("UNCLASSIFIED // ATLANTA");
        root.GetProperty("bottomText").ValueKind.Should().Be(
            JsonValueKind.Null,
            "an unconfigured banner is null so the editor shows an empty box, never the shipped constant");
        root.GetProperty("topFg").ValueKind.Should().Be(JsonValueKind.Null);
    }

    // ---- AC1: persist per exercise, and AC2: serve it through the frozen participant shape --------

    [RequiresDockerFact]
    public async Task Put_PersistsTheChromeBlock_AndTheParticipantEndpointServesIt()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new
        {
            chromeEnabled = true,
            watermarkEnabled = true,
            topText = "UNCLASSIFIED // FOR EXERCISE PURPOSES ONLY",
            topFg = "#ffffff",
            topBg = "#14532d",
            bottomText = "ATLANTA CIE 2026 — SIMULATED",
            bottomFg = "#ffffff",
            bottomBg = "#14532d",
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var stored = await LoadAsync(exerciseId);
        stored.ChromeTopText.Should().Be("UNCLASSIFIED // FOR EXERCISE PURPOSES ONLY");
        stored.ChromeTopFg.Should().Be("#ffffff");
        stored.ChromeTopBg.Should().Be("#14532d");
        stored.ChromeBottomText.Should().Be("ATLANTA CIE 2026 — SIMULATED");

        // Reload through the staff surface: it persisted, it did not merely echo.
        var reloaded = await GetOkAsync(host);
        reloaded.GetProperty("topText").GetString().Should().Be("UNCLASSIFIED // FOR EXERCISE PURPOSES ONLY");

        // And the participant surface serves it through the UNCHANGED frozen ChromeConfigResponse shape.
        var chrome = await GetOkAsync(host, ChromeConfigRoute);
        chrome.GetProperty("enabled").GetBoolean().Should().BeTrue();
        chrome.GetProperty("top").GetProperty("text").GetString().Should().Be(
            "UNCLASSIFIED // FOR EXERCISE PURPOSES ONLY", "the constant is gone; the DTO is unchanged");
        chrome.GetProperty("bottom").GetProperty("bg").GetString().Should().Be("#14532d");
    }

    [RequiresDockerFact]
    public async Task Put_ClearingABannerField_FallsBackToTheShippedConstantRatherThanServingBlank()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, e => e.ChromeTopText = "PREVIOUSLY CONFIGURED");

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new
        {
            chromeEnabled = true,
            watermarkEnabled = true,
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK, "PUT is a FULL REPLACE — an absent field clears it");
        (await LoadAsync(exerciseId)).ChromeTopText.Should().BeNull();

        var chrome = await GetOkAsync(host, ChromeConfigRoute);
        chrome.GetProperty("top").GetProperty("text").GetString().Should().Be(
            "UNCLASSIFIED // EXERCISE · EXERCISE · EXERCISE — ALL CONTENT SIMULATED",
            "a cleared setting returns to the shipped Phase-1 banner, never to an empty marking");
    }

    [RequiresDockerFact]
    public async Task Put_InOneExercise_LeavesEveryOtherExercisesChromeUnchanged()
    {
        // AC1's second half, and the always-Critical isolation guarantee: Exercise is the SCOPE, so the central
        // query filter is a no-op on this table and the server-resolved scope is the only thing standing between
        // a chrome write and every other exercise's participants.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        await SeedExerciseAsync(exerciseA);
        await SeedExerciseAsync(exerciseB, e => e.ChromeTopText = "EXERCISE B UNTOUCHED");

        await using var host = await StartHostAsync(exerciseA);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new
        {
            chromeEnabled = false,
            watermarkEnabled = true,
            topText = "EXERCISE A ONLY",
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var b = await LoadAsync(exerciseB);
        b.ChromeTopText.Should().Be("EXERCISE B UNTOUCHED", "a write scoped to A must not touch B");
        b.ComplianceChromeEnabled.Should().BeTrue("B's chrome switch is B's own");

        var a = await LoadAsync(exerciseA);
        a.ChromeTopText.Should().Be("EXERCISE A ONLY");
        a.ComplianceChromeEnabled.Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task Put_InExerciseA_NeverTouchesExerciseB_EvenWhenTheBodyNamesIt()
    {
        // The request DTO has NO exercise id, so a client-supplied one is not merely ignored — there is nowhere
        // for it to bind. This proves the cross-exercise write vector COR-001/XC-002 forbid is shut.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        await SeedExerciseAsync(exerciseA);
        await SeedExerciseAsync(exerciseB, e => e.ChromeTopText = "B SECRET BANNER");

        await using var host = await StartHostAsync(exerciseA);
        using var content = new StringContent(
            JsonSerializer.Serialize(new
            {
                exerciseId = exerciseB.ToString(),
                id = exerciseB.ToString(),
                chromeEnabled = true,
                watermarkEnabled = true,
                topText = "HIJACKED",
            }),
            Encoding.UTF8,
            "application/json");

        var response = await host.Client.PutAsync(new Uri(Route, UriKind.Relative), content);

        response.StatusCode.Should().Be(HttpStatusCode.OK, "the unknown body fields are ignored, not fatal");
        (await LoadAsync(exerciseB)).ChromeTopText.Should().Be("B SECRET BANNER");
        (await LoadAsync(exerciseA)).ChromeTopText.Should().Be(
            "HIJACKED", "the write landed on the SERVER-resolved exercise, A");
    }

    [RequiresDockerFact]
    public async Task Get_InExerciseA_NeverReturnsExerciseBsChrome()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        await SeedExerciseAsync(exerciseA, e => e.ChromeTopText = "A BANNER");
        await SeedExerciseAsync(exerciseB, e => e.ChromeTopText = "B SECRET BANNER");

        await using var host = await StartHostAsync(exerciseA);
        var response = await host.Client.GetAsync(new Uri(Route, UriKind.Relative));
        var body = await response.Content.ReadAsStringAsync();

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        body.Should().Contain("A BANNER");
        body.Should().NotContain(
            "B SECRET BANNER",
            "Exercise is unfiltered by the central query filter — the service's own scoping is the guard");
    }

    // ---- AC3: the NFR-008 mutual guard, server-side ----------------------------------------------

    [RequiresDockerFact]
    public async Task Put_DisablingChromeWhileTheWatermarkIsAlreadyOff_Returns400_AndWritesNothing()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, e =>
        {
            e.ComplianceChromeEnabled = true;
            e.WatermarkEnabled = false;
        });

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new
        {
            chromeEnabled = false,
            watermarkEnabled = false,
        });

        response.StatusCode.Should().Be(
            HttpStatusCode.BadRequest, "chrome and the watermark are never BOTH off (NFR-008)");
        (await response.Content.ReadAsStringAsync()).Should().Contain(
            "NFR-008", "the rejection explains itself so a planner knows which switch to turn back on");

        var stored = await LoadAsync(exerciseId);
        stored.ComplianceChromeEnabled.Should().BeTrue("a rejected write persists nothing at all");
        stored.WatermarkEnabled.Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task Put_DisablingTheWatermarkWhileChromeIsOff_Returns400_TheGuardIsMutual()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, e =>
        {
            e.ComplianceChromeEnabled = false;
            e.WatermarkEnabled = true;
        });

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new
        {
            chromeEnabled = false,
            watermarkEnabled = false,
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "the guard holds in both directions");
        (await LoadAsync(exerciseId)).WatermarkEnabled.Should().BeTrue();
    }

    [RequiresDockerFact]
    public async Task Put_TurningChromeOffWhileTheWatermarkStaysOn_IsAccepted()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new
        {
            chromeEnabled = false,
            watermarkEnabled = true,
        });

        response.StatusCode.Should().Be(
            HttpStatusCode.OK, "chrome-off is a LEGAL per-exercise state (D7-008) — the guard is not a ban");
        (await LoadAsync(exerciseId)).ComplianceChromeEnabled.Should().BeFalse();

        var chrome = await GetOkAsync(host, ChromeConfigRoute);
        chrome.GetProperty("enabled").GetBoolean().Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task Put_OmittingASwitch_Returns400_RatherThanDefaultingOneOff()
    {
        // Defaulting a missing switch is exactly how an exercise would quietly lose its last marking, so both
        // halves of the invariant are REQUIRED on the wire.
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(
            new Uri(Route, UriKind.Relative), new { chromeEnabled = true });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).Should().Contain("watermarkEnabled");
    }

    // ---- AC4: NFR-004 content security -----------------------------------------------------------

    [RequiresDockerFact]
    public async Task Put_MarkupInBannerText_IsStrippedNotEncoded_AllTheWayToTheParticipantSurface()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new
        {
            chromeEnabled = true,
            watermarkEnabled = true,
            topText = "<script>alert('xss')</script>UNCLASSIFIED // EXERCISE",
            bottomText = "Ally's <img src=x onerror=alert(1)> exercise",
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var stored = await LoadAsync(exerciseId);
        stored.ChromeTopText.Should().Be(
            "UNCLASSIFIED // EXERCISE",
            "the whole script element and its contents are STRIPPED at ingest (NFR-004)");
        stored.ChromeTopText.Should().NotContain("<script");

        // The participant surface gets inert text, with the author's literals intact and NO entities: an
        // HtmlEncoder here would ship a banner reading 'UNCLASSIFIED &#47;&#47; EXERCISE' on every channel.
        var chrome = await GetOkAsync(host, ChromeConfigRoute);
        var topText = chrome.GetProperty("top").GetProperty("text").GetString();
        topText.Should().Be("UNCLASSIFIED // EXERCISE");
        topText.Should().NotContain("&#", "the sanitizer strips, it never entity-encodes");

        var bottomText = chrome.GetProperty("bottom").GetProperty("text").GetString();
        bottomText.Should().Be(
            "Ally's  exercise", "markup is stripped but the author's literal apostrophe survives un-encoded");
        bottomText.Should().NotContain("onerror");
    }

    [RequiresDockerFact]
    public async Task Put_AllMarkupBannerText_Returns400_RatherThanStoringABlankMarking()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new
        {
            chromeEnabled = true,
            watermarkEnabled = true,
            topText = "<script>alert(1)</script>",
        });

        response.StatusCode.Should().Be(
            HttpStatusCode.BadRequest, "a banner that sanitizes to nothing is a marking that marks nothing");
        (await LoadAsync(exerciseId)).ChromeTopText.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task Put_OverLengthBannerText_Returns400()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new
        {
            chromeEnabled = true,
            watermarkEnabled = true,
            topText = new string('b', ChromeFieldRules.MaxBannerTextLength + 1),
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "the bound matches the column width");
        (await LoadAsync(exerciseId)).ChromeTopText.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task Put_MalformedColor_Returns400_AndWritesNothing()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new
        {
            chromeEnabled = true,
            watermarkEnabled = true,
            topText = "VALID BANNER",
            topBg = "javascript:alert(1)",
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var stored = await LoadAsync(exerciseId);
        stored.ChromeTopBg.Should().BeNull();
        stored.ChromeTopText.Should().BeNull("validation runs BEFORE anything is applied — not even the valid fields land");
    }

    [RequiresDockerFact]
    public async Task Put_MissingBody_Returns400()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        using var content = new StringContent("null", Encoding.UTF8, "application/json");
        var response = await host.Client.PutAsync(new Uri(Route, UriKind.Relative), content);

        response.StatusCode.Should().Be(
            HttpStatusCode.BadRequest, "a missing chrome body is rejected before the service");
    }

    // ---- XC-004 telemetry ------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Put_EmitsExactlyOneChromeUpdatedTelemetryEvent_ListingTheChangedFields()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new
        {
            chromeEnabled = true,
            watermarkEnabled = true,
            topText = "TELEMETERED BANNER",
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        await using var context = _fixture.CreateContext();
        var events = await context.TelemetryEvents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(e => e.ExerciseId == exerciseId)
            .ToListAsync();

        var chromeEvent = events.Should().ContainSingle(
            "exactly ONE telemetry event per meaningful action (XC-004)").Subject;
        chromeEvent.EventType.Should().Be("exercise.chrome.updated");
        chromeEvent.SchemaVersion.Should().Be("v0");
        chromeEvent.Actor.Kind.Should().Be("system");
        chromeEvent.Actor.ActingHumanId.Should().Be(
            host.StaffUserId.ToString(), "the acting staff human is attributed, never an empty string");
        chromeEvent.Target!.EntityType.Should().Be("exercise");
        chromeEvent.Target.EntityId.Should().Be(exerciseId.ToString());
        chromeEvent.Payload.Should().Contain("ChromeTopText", "the opaque payload records which columns changed");
    }

    [RequiresDockerFact]
    public async Task Put_ThatChangesNothing_PersistsNothingAndEmitsNoTelemetry()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, e => e.ChromeTopText = "STEADY BANNER");

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new
        {
            chromeEnabled = true,
            watermarkEnabled = true,
            topText = "STEADY BANNER",
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        await using var context = _fixture.CreateContext();
        var count = await context.TelemetryEvents
            .IgnoreQueryFilters()
            .CountAsync(e => e.ExerciseId == exerciseId);

        count.Should().Be(0, "a no-op write is not a meaningful action");
    }

    [RequiresDockerFact]
    public async Task Put_RejectedByTheNfr008Guard_EmitsNoTelemetry()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new
        {
            chromeEnabled = false,
            watermarkEnabled = false,
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        await using var context = _fixture.CreateContext();
        var count = await context.TelemetryEvents
            .IgnoreQueryFilters()
            .CountAsync(e => e.ExerciseId == exerciseId);

        count.Should().Be(0, "a rejected write is not a mutation, so there is nothing to audit");
    }

    // ---- helpers ---------------------------------------------------------------------------------

    private static object ValidBody(string topText) => new
    {
        chromeEnabled = true,
        watermarkEnabled = true,
        topText,
    };

    private static async Task<JsonElement> GetOkAsync(ChromeTestHost host, string route = Route)
    {
        var response = await host.Client.GetAsync(new Uri(route, UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK, "{0} must return 200", route);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    private async Task SeedExerciseAsync(Guid exerciseId, Action<Exercise>? configure = null)
    {
        var exercise = ExerciseConfigurationTestData.UnconfiguredExercise(exerciseId, "Chrome Settings Exercise");
        configure?.Invoke(exercise);

        await using var context = _fixture.CreateContext();
        context.Exercises.Add(exercise);
        await context.SaveChangesAsync();
    }

    private async Task<Exercise> LoadAsync(Guid exerciseId)
    {
        await using var context = _fixture.CreateContext();
        return await context.Exercises.AsNoTracking().SingleAsync(e => e.Id == exerciseId);
    }

    private Task<ChromeTestHost> StartHostAsync(
        Guid? exerciseId,
        bool authenticatedStaff = true,
        Guid? assignedExerciseId = null)
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");
        return ChromeTestHost.StartAsync(
            _fixture.ConnectionString!, exerciseId, authenticatedStaff, assignedExerciseId);
    }
}
