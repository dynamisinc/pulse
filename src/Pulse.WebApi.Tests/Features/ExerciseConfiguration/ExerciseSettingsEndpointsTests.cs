namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration;

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
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// HTTP integration tests for the staff settings surface (<c>GET/PUT /api/staff/exercise-settings</c>) over
/// the composed <see cref="ExerciseConfigurationTestHost"/> and the shared migrated real SQL Server.
/// </summary>
/// <remarks>
/// Covers the COR-030 persist/reload round trip, the participant-visible consequence of a channel toggle,
/// the staff gate (401/403), the fail-closed 400s (unknown channel id, non-IANA zone, malformed color,
/// over-length text) that leave the stored config untouched, NFR-004 sanitization end to end, and the
/// isolation case: a settings write in exercise A cannot reach exercise B even when the request body tries.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class ExerciseSettingsEndpointsTests
{
    private const string Route = "/api/staff/exercise-settings";

    private readonly MsSqlContainerFixture _fixture;

    public ExerciseSettingsEndpointsTests(MsSqlContainerFixture fixture)
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
            "a participant / shared read-only / anonymous caller must never read staff-world settings");
    }

    [RequiresDockerFact]
    public async Task Put_NoStaffSession_Returns401_AndWritesNothing()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, e => e.Name = "Untouched");

        await using var host = await StartHostAsync(exerciseId, authenticatedStaff: false);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), ValidBody("Renamed"));

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await LoadAsync(exerciseId)).Name.Should().Be("Untouched", "the gate rejects before the handler runs");
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
            "a staff user not assigned to the resolved exercise must not read its settings (COR-005)");
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
    public async Task Get_ResolvedExercise_ReturnsTheSettingsBlock_AndTheClosedChannelCatalog()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, e =>
        {
            e.Name = "Atlanta CIE";
            e.WorldName = "Metro Atlanta";
            e.TimeZone = "America/New_York";
        });

        await using var host = await StartHostAsync(exerciseId);
        var root = await GetOkAsync(host);

        root.GetProperty("exerciseId").GetString().Should().Be(
            exerciseId.ToString(), "the response echoes the SERVER-resolved scope, it never accepted one");
        root.GetProperty("name").GetString().Should().Be("Atlanta CIE");
        root.GetProperty("worldName").GetString().Should().Be("Metro Atlanta");
        root.GetProperty("timeZone").GetString().Should().Be("America/New_York");
        root.GetProperty("brandName").ValueKind.Should().Be(
            JsonValueKind.Null, "an unconfigured setting is null so the editor shows an empty box, not the constant");

        var channels = root.GetProperty("channels");
        channels.GetArrayLength().Should().Be(5);
        channels.EnumerateArray().Select(c => c.GetProperty("id").GetString())
            .Should().Equal("social", "portal", "news", "press", "weather");
        channels.EnumerateArray().Single(c => c.GetProperty("id").GetString() == "social")
            .GetProperty("enabled").GetBoolean().Should().BeTrue("the platform default is Social-only");
    }

    // NOTE: the service's NotFound → 404 outcome is unreachable over HTTP for a STAFF caller, because the
    // staff gate's assignment read inner-joins Exercise: a scope with no exercise row yields no assignment
    // and is refused with 403 before the handler. The 404 branch is covered at the service level in
    // ExerciseSettingsServiceTests.

    // ---- write: the COR-030 round trip -----------------------------------------------------------

    [RequiresDockerFact]
    public async Task Put_PersistsEverySettingNamedInCor030_AndSurvivesAReload()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);

        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new
        {
            name = "Atlanta CIE 2026",
            worldName = "Metro Atlanta",
            locale = "en-US",
            timeZone = "America/New_York",
            scheduledStartAt = "2026-03-01T13:00:00Z",
            scheduledEndAt = "2026-03-03T21:00:00Z",
            enabledChannels = new[] { "social", "news" },
            brandName = "Metro Atlanta Now",
            brandPrimary = "#123456",
            brandAccent = "#abc",
            brandSurface = "#ffffff",
            brandOnSurface = "#111111",
            outletNames = new { news = "WXYZ 9 News" },
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        // The write response and a fresh GET must agree — the settings survive a reload.
        var reloaded = await GetOkAsync(host);
        reloaded.GetProperty("name").GetString().Should().Be("Atlanta CIE 2026");
        reloaded.GetProperty("worldName").GetString().Should().Be("Metro Atlanta");
        reloaded.GetProperty("locale").GetString().Should().Be("en-US");
        reloaded.GetProperty("timeZone").GetString().Should().Be("America/New_York");
        reloaded.GetProperty("scheduledStartAt").GetString().Should().StartWith("2026-03-01T13:00:00");
        reloaded.GetProperty("scheduledEndAt").GetString().Should().StartWith("2026-03-03T21:00:00");
        reloaded.GetProperty("brandName").GetString().Should().Be("Metro Atlanta Now");
        reloaded.GetProperty("brandPrimary").GetString().Should().Be("#123456");
        reloaded.GetProperty("brandAccent").GetString().Should().Be("#abc");
        reloaded.GetProperty("outletNames").GetProperty("news").GetString().Should().Be("WXYZ 9 News");

        var enabled = reloaded.GetProperty("channels").EnumerateArray()
            .Where(c => c.GetProperty("enabled").GetBoolean())
            .Select(c => c.GetProperty("id").GetString());
        enabled.Should().BeEquivalentTo(["social", "news"]);
    }

    [RequiresDockerFact]
    public async Task Put_OmittedOptionalFields_ClearThemBackToNotConfigured()
    {
        // PUT is a FULL REPLACE of the COR-030 block: omitting a field clears it, so the participant
        // projection returns to the shipped Phase-1 constant.
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, e =>
        {
            e.WorldName = "Old World";
            e.BrandName = "Old Brand";
            e.EnabledChannels = "social,news";
        });

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(
            new Uri(Route, UriKind.Relative),
            new { name = "Kept", timeZone = "UTC" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var stored = await LoadAsync(exerciseId);
        stored.WorldName.Should().BeNull();
        stored.BrandName.Should().BeNull();
        stored.EnabledChannels.Should().BeNull();

        var brand = await GetOkAsync(host, "/api/brand-tokens");
        brand.GetProperty("name").GetString().Should().Be(
            ParticipantShellDefaults.BrandName, "a cleared setting falls back to the shipped constant");
    }

    [RequiresDockerFact]
    public async Task Put_DisablingAChannel_ReportsItEnabledFalse_OnTheParticipantCatalog()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new
        {
            name = "Channel Toggle",
            timeZone = "UTC",
            enabledChannels = new[] { "news" },
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var nav = await GetOkAsync(host, "/api/channel-nav-config");
        var channels = nav.GetProperty("channels").EnumerateArray().ToList();
        channels.Single(c => c.GetProperty("id").GetString() == "social").GetProperty("enabled").GetBoolean()
            .Should().BeFalse("a disabled channel is catalogued but reported enabled:false, so no participant route serves it");
        channels.Single(c => c.GetProperty("id").GetString() == "news").GetProperty("enabled").GetBoolean()
            .Should().BeTrue();
    }

    // ---- write: fail closed with 400 (AC7) -------------------------------------------------------

    [RequiresDockerFact]
    public async Task Put_InvalidTimeZone_Returns400_AndLeavesTheStoredConfigUnchanged()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, e =>
        {
            e.Name = "Original";
            e.TimeZone = "America/Chicago";
        });

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new
        {
            name = "Renamed",
            timeZone = "Eastern Standard Time",
        });

        response.StatusCode.Should().Be(
            HttpStatusCode.BadRequest, "a Windows time-zone id is not the IANA vocabulary XC-008 requires");

        var stored = await LoadAsync(exerciseId);
        stored.Name.Should().Be("Original", "a rejected write persists NOTHING — not even the valid fields");
        stored.TimeZone.Should().Be("America/Chicago");
    }

    [RequiresDockerFact]
    public async Task Put_UnknownChannelId_Returns400_AndLeavesTheStoredConfigUnchanged()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, e => e.EnabledChannels = "social");

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new
        {
            name = "Bad Channel",
            timeZone = "UTC",
            enabledChannels = new[] { "social", "radio" },
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await LoadAsync(exerciseId)).EnabledChannels.Should().Be("social");
    }

    [RequiresDockerFact]
    public async Task Put_EmptyEnabledChannels_Returns400_RatherThanBlankingTheParticipantWorld()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new
        {
            name = "No Channels",
            timeZone = "UTC",
            enabledChannels = Array.Empty<string>(),
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [RequiresDockerFact]
    public async Task Put_MalformedColor_Returns400()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new
        {
            name = "Bad Color",
            timeZone = "UTC",
            brandPrimary = "javascript:alert(1)",
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await LoadAsync(exerciseId)).BrandPrimary.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task Put_OverLengthWorldName_Returns400()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new
        {
            name = "Long",
            timeZone = "UTC",
            worldName = new string('w', ExerciseSettingsFieldRules.MaxWorldNameLength + 1),
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await LoadAsync(exerciseId)).WorldName.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task Put_MissingName_Returns400()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new { timeZone = "UTC" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [RequiresDockerFact]
    public async Task Put_MissingBody_Returns400()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        using var content = new StringContent("null", Encoding.UTF8, "application/json");
        var response = await host.Client.PutAsync(new Uri(Route, UriKind.Relative), content);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "a missing settings body is rejected before the service");
    }

    // ---- NFR-004 sanitization --------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Put_MarkupInFreeText_IsStrippedNotEncoded_AllTheWayToTheParticipantSurface()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new
        {
            name = "Sanitize Me",
            timeZone = "UTC",
            worldName = "<script>alert('x')</script>Metro Atlanta",
            brandName = "Ally's <img src=x onerror=alert(1)> News",
            outletNames = new { news = "<b>WXYZ</b> 9" },
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var stored = await LoadAsync(exerciseId);
        stored.WorldName.Should().Be(
            "Metro Atlanta", "the whole script element and its contents are STRIPPED at ingest (NFR-004)");
        stored.BrandName.Should().Be(
            "Ally's  News",
            "markup is stripped but the author's literal apostrophe survives un-encoded — encoding would "
            + "double-encode ordinary text at the React text node and break the fiction");
        stored.OutletNamesJson.Should().NotContain("<b>");

        // And a participant reading the shell gets the inert text, with no entities and no markup.
        var brand = await GetOkAsync(host, "/api/brand-tokens");
        var brandName = brand.GetProperty("name").GetString();
        brandName.Should().Be("Ally's  News");
        brandName.Should().NotContain("&#", "the sanitizer strips, it never entity-encodes");
    }

    [RequiresDockerFact]
    public async Task Put_AllMarkupBrandName_Returns400_RatherThanStoringAnEmptyBrand()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new
        {
            name = "Empty Brand",
            timeZone = "UTC",
            brandName = "<script>alert(1)</script>",
        });

        response.StatusCode.Should().Be(
            HttpStatusCode.BadRequest,
            "an empty brand name fails the frontend guard and would un-skin the whole participant world");
    }

    // ---- isolation (always-Critical) -------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Put_InExerciseA_NeverTouchesExerciseB_EvenWhenTheBodyNamesIt()
    {
        // The request DTO has NO exercise id, so a client-supplied one is not merely ignored — there is
        // nowhere for it to bind. This proves the cross-exercise write vector COR-001/XC-002 forbid is shut.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        await SeedExerciseAsync(exerciseA, e => e.Name = "Exercise A");
        await SeedExerciseAsync(exerciseB, e =>
        {
            e.Name = "Exercise B";
            e.WorldName = "B World";
        });

        await using var host = await StartHostAsync(exerciseA);
        using var content = new StringContent(
            JsonSerializer.Serialize(new
            {
                exerciseId = exerciseB.ToString(),
                id = exerciseB.ToString(),
                name = "Hijacked",
                timeZone = "UTC",
                worldName = "Hijacked World",
            }),
            Encoding.UTF8,
            "application/json");

        var response = await host.Client.PutAsync(new Uri(Route, UriKind.Relative), content);

        response.StatusCode.Should().Be(HttpStatusCode.OK, "the unknown body fields are ignored, not fatal");

        var b = await LoadAsync(exerciseB);
        b.Name.Should().Be("Exercise B", "exercise B must be untouched by a write scoped to A");
        b.WorldName.Should().Be("B World");

        var a = await LoadAsync(exerciseA);
        a.Name.Should().Be("Hijacked", "the write landed on the SERVER-resolved exercise, A");
        a.WorldName.Should().Be("Hijacked World");
    }

    [RequiresDockerFact]
    public async Task Get_InExerciseA_NeverReturnsExerciseBsSettings()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        await SeedExerciseAsync(exerciseA, e => e.Name = "Exercise A");
        await SeedExerciseAsync(exerciseB, e =>
        {
            e.Name = "Exercise B";
            e.WorldName = "B Secret World";
        });

        await using var host = await StartHostAsync(exerciseA);
        var response = await host.Client.GetAsync(new Uri(Route, UriKind.Relative));
        var body = await response.Content.ReadAsStringAsync();

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        body.Should().Contain("Exercise A");
        body.Should().NotContain("B Secret World", "Exercise is unfiltered by the central query filter — the service's own scoping is the guard");
    }

    // ---- XC-004 telemetry ------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Put_EmitsExactlyOneSettingsUpdatedTelemetryEvent_ListingTheChangedFields()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(new Uri(Route, UriKind.Relative), new
        {
            name = "Telemetered",
            timeZone = "UTC",
            worldName = "Telemetry World",
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        await using var context = _fixture.CreateContext();
        var events = await context.TelemetryEvents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(e => e.ExerciseId == exerciseId)
            .ToListAsync();

        var settingsEvent = events.Should().ContainSingle(
            "exactly ONE telemetry event per meaningful action (XC-004)").Subject;
        settingsEvent.EventType.Should().Be("exercise.settings.updated");
        settingsEvent.SchemaVersion.Should().Be("v0");
        settingsEvent.Actor.Kind.Should().Be("system");
        settingsEvent.Actor.ActingHumanId.Should().Be(
            host.StaffUserId.ToString(), "the acting staff human is attributed, never an empty string");
        settingsEvent.Target!.EntityType.Should().Be("exercise");
        settingsEvent.Target.EntityId.Should().Be(exerciseId.ToString());
        settingsEvent.Payload.Should().Contain("WorldName", "the opaque payload records which settings changed");
    }

    [RequiresDockerFact]
    public async Task Put_ThatChangesNothing_PersistsNothingAndEmitsNoTelemetry()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, e =>
        {
            e.Name = "Steady";
            e.TimeZone = "UTC";
        });

        await using var host = await StartHostAsync(exerciseId);
        var response = await host.Client.PutAsJsonAsync(
            new Uri(Route, UriKind.Relative),
            new { name = "Steady", timeZone = "UTC" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        await using var context = _fixture.CreateContext();
        var count = await context.TelemetryEvents
            .IgnoreQueryFilters()
            .CountAsync(e => e.ExerciseId == exerciseId);

        count.Should().Be(0, "a no-op write is not a meaningful action");
    }

    // ---- helpers ---------------------------------------------------------------------------------

    private static object ValidBody(string name) => new { name, timeZone = "UTC" };

    private static async Task<JsonElement> GetOkAsync(ExerciseConfigurationTestHost host, string route = Route)
    {
        var response = await host.Client.GetAsync(new Uri(route, UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK, "{0} must return 200", route);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    private async Task SeedExerciseAsync(Guid exerciseId, Action<Exercise>? configure = null)
    {
        var exercise = ExerciseConfigurationTestData.UnconfiguredExercise(exerciseId);
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

    private Task<ExerciseConfigurationTestHost> StartHostAsync(
        Guid? exerciseId,
        bool authenticatedStaff = true,
        Guid? assignedExerciseId = null)
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");
        return ExerciseConfigurationTestHost.StartAsync(
            _fixture.ConnectionString!, exerciseId, authenticatedStaff, assignedExerciseId);
    }
}
