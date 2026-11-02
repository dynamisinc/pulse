namespace Pulse.WebApi.Tests.Features.Portal.Config;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Features.Portal.Config;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// <c>GET /api/portal</c> and <c>GET|PUT /api/portal/config</c> over HTTP (exercise-portal story 03, #769), real SQL:
/// defaults without a row, clean module hiding, the portal channel gate, the staff/role gate, the validation 400s,
/// version conflicts, logo and skin-override isolation, the participant projection (XC-002) and the one
/// <c>portal_config_changed</c> event in the same save as the row.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PortalConfigEndpointsTests
{
    private static readonly string[] ParticipantKeys = ["masthead", "layoutKey", "modules", "skinOverrides", "hasResources"];

    private readonly MsSqlContainerFixture _fixture;

    public PortalConfigEndpointsTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // ---- AC "Defaults without a row" -------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task NoRow_ReturnsTheNeutralDefaults_AndWritesNothing()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, staffUserId: null);

        var response = await host.GetAsync("/api/portal");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;
        root.GetProperty("masthead").GetProperty("name").GetString().Should().Be("Local Today", "Q-E3-1: never the exercise name");
        root.GetProperty("layoutKey").GetString().Should().Be("anchor");
        root.GetProperty("modules").EnumerateArray().Select(m => m.GetProperty("id").GetString())
            .Should().Equal("topStories", "socialStream", "pressLatest", "weather", "trending");
        root.GetProperty("hasResources").GetBoolean().Should().BeFalse();
        (await host.ConfigRowsAsync(seeded.ExerciseId)).Should().BeEmpty("a participant read never writes a row");
    }

    [RequiresDockerFact]
    public async Task ACityWithoutAPortalName_ReadsAsCityToday_AndAPortalNameWins()
    {
        await using var host = await StartAsync();
        var city = await host.SeedExerciseAsync();
        var named = await host.SeedExerciseAsync();
        await host.SeedConfigAsync(city.ExerciseId, "[]", cityName: "Atlanta");
        await host.SeedConfigAsync(named.ExerciseId, "[]", cityName: "Atlanta", portalName: "The Peach Post");

        host.ActAs(city.ExerciseId, staffUserId: null);
        (await ReadPortalAsync(host)).GetProperty("masthead").GetProperty("name").GetString().Should().Be("Atlanta Today");
        host.ActAs(named.ExerciseId, staffUserId: null);
        (await ReadPortalAsync(host)).GetProperty("masthead").GetProperty("name").GetString().Should().Be("The Peach Post");
    }

    [RequiresDockerFact]
    public async Task HasResources_IsTrueOnlyForAVisibleResource()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        await host.AddResourceAsync(seeded.ExerciseId, visible: false);
        host.ActAs(seeded.ExerciseId, staffUserId: null);
        (await ReadPortalAsync(host)).GetProperty("hasResources").GetBoolean().Should().BeFalse("a hidden resource does not count");

        await host.AddResourceAsync(seeded.ExerciseId, visible: true);
        (await ReadPortalAsync(host)).GetProperty("hasResources").GetBoolean().Should().BeTrue();
    }

    // ---- AC "Clean hiding" -----------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Modules_AreStoredOrder_EnabledInConfig_AndOnAnEnabledChannelOnly()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync(enabledChannels: "social,portal,news,weather"); // press disabled
        await host.SeedConfigAsync(
            seeded.ExerciseId,
            """[{"id":"weather","enabled":true},{"id":"pressLatest","enabled":true},{"id":"trending","enabled":false},{"id":"topStories","enabled":true},{"id":"socialStream","enabled":true}]""");
        host.ActAs(seeded.ExerciseId, staffUserId: null);

        var root = await ReadPortalAsync(host);

        var modules = root.GetProperty("modules").EnumerateArray().ToList();
        modules.Select(m => m.GetProperty("id").GetString()).Should().Equal(
            ["weather", "topStories", "socialStream"],
            "stored order; pressLatest (press disabled) and trending (off in config) are absent");
        modules.Select(m => m.GetProperty("channelId").GetString()).Should().Equal("weather", "news", "social");
        modules.Should().OnlyContain(m => m.EnumerateObject().Select(p => p.Name).SequenceEqual(new[] { "id", "channelId" }), "absent, not flagged");
    }

    [RequiresDockerFact]
    public async Task DisablingSocial_HidesBothSocialModules()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync(enabledChannels: "portal,news,press,weather");
        host.ActAs(seeded.ExerciseId, staffUserId: null);

        var ids = (await ReadPortalAsync(host)).GetProperty("modules").EnumerateArray().Select(m => m.GetProperty("id").GetString());

        ids.Should().Equal(["topStories", "pressLatest", "weather"], "C-3: trending hides with social");
    }

    // ---- AC "Gate" -------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task PortalDisabled_ParticipantGetsABare404_StaffStillReadsAndWritesConfig()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync(enabledChannels: "social,news,press,weather");

        host.ActAs(seeded.ExerciseId, staffUserId: null);
        var participant = await host.GetAsync("/api/portal");
        var unknown = await host.GetAsync("/api/portal/no-such-route");
        participant.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await participant.Content.ReadAsStringAsync()).Should().Be(await unknown.Content.ReadAsStringAsync(), "the same 404 as an unknown route");

        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        (await host.GetAsync("/api/portal/config")).StatusCode.Should().Be(HttpStatusCode.OK);
        (await host.PutConfigAsync(PortalConfigTestHost.Body())).StatusCode.Should().Be(HttpStatusCode.OK, "planners prepare before enabling");
    }

    [RequiresDockerFact]
    public async Task ParticipantRead_WithNoResolvedScope_IsTheGates404()
    {
        await using var host = await StartAsync();
        host.ActAs(exerciseId: null, staffUserId: null);

        var response = await host.GetAsync("/api/portal");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound, "the channel gate fails closed on an unresolved scope, before the handler");
    }

    // ---- AC "Staff write" ------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task ControllerAndPlanner_Write_AndAStaleVersionIs409()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        var planner = await host.AddStaffAsync(seeded.ExerciseId, "planner");

        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        var first = await host.PutConfigAsync(PortalConfigTestHost.Body(version: 0));
        first.StatusCode.Should().Be(HttpStatusCode.OK);
        (await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("version").GetInt32().Should().Be(1);

        host.ActAs(seeded.ExerciseId, planner);
        var second = await host.PutConfigAsync(PortalConfigTestHost.Body(version: 1, tagline: "Your town, your news."));
        second.StatusCode.Should().Be(HttpStatusCode.OK);
        (await second.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("version").GetInt32().Should().Be(2);

        var stale = await host.PutConfigAsync(PortalConfigTestHost.Body(version: 1, tagline: "Lost update"));
        stale.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var staleCreate = await host.PutConfigAsync(PortalConfigTestHost.Body(version: 0));
        staleCreate.StatusCode.Should().Be(HttpStatusCode.Conflict, "version 0 once a row exists is stale");
        (await host.ConfigRowsAsync(seeded.ExerciseId)).Single().Tagline.Should().Be("Your town, your news.");
    }

    [RequiresDockerFact]
    public async Task EvaluatorAndParticipant_AreRefused_AndWriteNothing()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        var evaluator = await host.AddStaffAsync(seeded.ExerciseId, "evaluator");

        host.ActAs(seeded.ExerciseId, evaluator);
        (await host.PutConfigAsync(PortalConfigTestHost.Body())).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await host.GetAsync("/api/portal/config")).StatusCode.Should().Be(HttpStatusCode.OK, "any assigned staff may read");

        host.ActAs(seeded.ExerciseId, staffUserId: null);
        // A participant has no staff session, so the shared staff gate answers 401 (the InjectEndpoints pattern the
        // story prescribes), not the AC's literal 403; either way it is refused before any handler work.
        (await host.PutConfigAsync(PortalConfigTestHost.Body())).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await host.GetAsync("/api/portal/config")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        (await host.ConfigRowsAsync(seeded.ExerciseId)).Should().BeEmpty();
        (await host.ConfigEventsAsync(seeded.ExerciseId)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task OutOfBoundsInput_Is400()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);

        var oversizedModules = Enumerable.Range(0, 200).Select(i => new { id = $"module-{i:D4}", enabled = true }).ToArray();
        var cases = new (string Why, object Body)[]
        {
            ("layout outside PC-1", PortalConfigTestHost.Body(layoutKey: "grid")),
            ("name over 60", PortalConfigTestHost.Body(portalName: new string('a', 61))),
            ("ModulesJson over 4 KB", PortalConfigTestHost.Body(modules: oversizedModules)),
            ("unknown module", PortalConfigTestHost.Body(modules: new[] { new { id = "ticker", enabled = true } })),
            ("duplicate module", PortalConfigTestHost.Body(modules: new[] { new { id = "weather", enabled = true }, new { id = "weather", enabled = false } })),
            ("city that would overflow the masthead", PortalConfigTestHost.Body(cityName: new string('c', 55))),
            ("empty module list (would blank the portal)", PortalConfigTestHost.Body(modules: Array.Empty<object>())),
        };

        foreach (var (why, body) in cases)
        {
            var response = await host.PutConfigAsync(body);
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest, why);
        }

        var modulesProblem = await host.PutConfigAsync(PortalConfigTestHost.Body(modules: oversizedModules));
        (await modulesProblem.Content.ReadAsStringAsync()).Should().Contain("4 KB");
        (await host.ConfigRowsAsync(seeded.ExerciseId)).Should().BeEmpty();
    }

    // ---- AC "Logo and overrides are isolated" -----------------------------------------------------------

    [RequiresDockerFact]
    public async Task Logo_FromAnotherExercise_OrNotAnImage_OrUnknown_IsTheSame400()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        var other = await host.SeedExerciseAsync();
        var foreignImage = await host.AddMediaAssetAsync(other.ExerciseId);
        var ownVideo = await host.AddMediaAssetAsync(seeded.ExerciseId, MediaKinds.Video);
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);

        var details = new List<string?>();
        foreach (var logo in new[] { foreignImage, ownVideo, Guid.NewGuid() })
        {
            var response = await host.PutConfigAsync(PortalConfigTestHost.Body(logoMediaId: logo.ToString()));
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            details.Add((await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("detail").GetString());
        }

        details.Distinct().Should().ContainSingle().Which.Should().Be(PortalConfigWriteValidator.LogoNotUsableMessage, "no existence leak");
    }

    [RequiresDockerFact]
    public async Task Logo_OfThisExercise_IsStored_AndSignedIntoTheMasthead()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        var logo = await host.AddMediaAssetAsync(seeded.ExerciseId);
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);

        (await host.PutConfigAsync(PortalConfigTestHost.Body(logoMediaId: logo.ToString()))).StatusCode.Should().Be(HttpStatusCode.OK);

        host.ActAs(seeded.ExerciseId, staffUserId: null);
        var masthead = (await ReadPortalAsync(host)).GetProperty("masthead");
        masthead.GetProperty("logo").GetProperty("id").GetString().Should().Be(logo.ToString());
        masthead.GetProperty("logo").GetProperty("alt").GetString().Should().Be("Fairhaven Today");
    }

    [RequiresDockerFact]
    public async Task SkinOverrides_GoThroughF03sValidator()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);

        (await host.PutConfigAsync(PortalConfigTestHost.Body(skinOverrides: new { position = "fixed" })))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest, "off the FC-3b allowlist");
        (await host.PutConfigAsync(PortalConfigTestHost.Body(skinOverrides: new { clutter = new[] { "SHOCKING!" } })))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest, "clutter is the tabloid skin's only");

        var accepted = await host.PutConfigAsync(PortalConfigTestHost.Body(
            skinOverrides: new { palette = new { accent = "#0a5c99" }, ext = new { portal = new { heroRatio = "wide" } } }));
        accepted.StatusCode.Should().Be(HttpStatusCode.OK, await accepted.Content.ReadAsStringAsync());

        host.ActAs(seeded.ExerciseId, staffUserId: null);
        (await ReadPortalAsync(host)).GetProperty("skinOverrides").GetProperty("palette").GetProperty("accent").GetString()
            .Should().Be("#0a5c99");
    }

    // ---- AC "No leakage and no exercise id" --------------------------------------------------------------

    [RequiresDockerFact]
    public async Task TheParticipantBody_CarriesNoStaffField_OrExerciseId()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        (await host.PutConfigAsync(PortalConfigTestHost.Body(tagline: "News you can use."))).EnsureSuccessStatusCode();

        host.ActAs(seeded.ExerciseId, staffUserId: null);
        var response = await host.GetAsync("/api/portal");
        var json = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(json);

        document.RootElement.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(ParticipantKeys);
        document.RootElement.GetProperty("masthead").EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo("name", "tagline", "logo");
        json.Should().NotContain("version").And.NotContain("actingHumanId").And.NotContain(seeded.ExerciseId.ToString())
            .And.NotContain(seeded.StaffUserId.ToString());
    }

    [RequiresDockerFact]
    public async Task ABodyNamingAnotherExercise_StillWritesOnlyTheCallersOwn()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        var other = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);

        var body = PortalConfigTestHost.Body(portalName: "Mine");
        body["exerciseId"] = other.ExerciseId.ToString();
        (await host.PutConfigAsync(body)).StatusCode.Should().Be(HttpStatusCode.OK);

        (await host.ConfigRowsAsync(seeded.ExerciseId)).Should().ContainSingle().Which.ExerciseId.Should().Be(seeded.ExerciseId);
        (await host.ConfigRowsAsync(other.ExerciseId)).Should().BeEmpty("the body cannot name another exercise");
    }

    // ---- AC "Audit and telemetry" -----------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task ASuccessfulWrite_EmitsOneEvent_InTheSameSave_WithFieldNamesOnly()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        host.Saves.Clear();

        var response = await host.PutConfigAsync(PortalConfigTestHost.Body(portalName: "Secret Masthead", cityName: null));
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        host.Saves.All.Should().ContainSingle(save => save.Any(e => e.Entity == nameof(PortalConfig)))
            .Which.Should().Contain(e => e.Entity == nameof(TelemetryEvent), "the change and its audit share one unit of work");

        var row = (await host.ConfigRowsAsync(seeded.ExerciseId)).Single();
        var evt = (await host.ConfigEventsAsync(seeded.ExerciseId)).Should().ContainSingle().Subject;
        evt.Channel.Should().Be("portal");
        evt.Actor.ActingHumanId.Should().Be(seeded.StaffUserId.ToString());
        evt.Target!.EntityType.Should().Be("portal");
        evt.Target.EntityId.Should().Be(row.Id.ToString());
        evt.TimeZone.Should().Be("America/Chicago");
        using var payload = JsonDocument.Parse(evt.Payload!);
        payload.RootElement.EnumerateObject().Select(p => p.Name).Should().Equal("fields");
        payload.RootElement.GetProperty("fields").EnumerateArray().Select(f => f.GetString())
            .Should().BeEquivalentTo("portalName", "modules");
        evt.Payload.Should().NotContain("Secret Masthead", "names only, never values");
    }

    [RequiresDockerFact]
    public async Task AWriteThatChangesNothing_WritesNoRowAndNoEvent()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        var defaults = PortalConfigTestHost.Body(cityName: null, modules: PortalModuleSettings.Defaults.Select(m => new { id = m.Id, enabled = m.Enabled }).ToArray());

        var response = await host.PutConfigAsync(defaults);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("version").GetInt32().Should().Be(0);
        (await host.ConfigRowsAsync(seeded.ExerciseId)).Should().BeEmpty();
        (await host.ConfigEventsAsync(seeded.ExerciseId)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task StaffRead_ListsEveryModule_WithTheResolvedName()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        await host.SeedConfigAsync(seeded.ExerciseId, """[{"id":"weather","enabled":true}]""", cityName: "Atlanta");
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);

        var root = await (await host.GetAsync("/api/portal/config")).Content.ReadFromJsonAsync<JsonElement>();

        root.GetProperty("resolvedName").GetString().Should().Be("Atlanta Today");
        root.GetProperty("version").GetInt32().Should().Be(1);
        var modules = root.GetProperty("modules").EnumerateArray().ToList();
        modules.Select(m => m.GetProperty("id").GetString()).Should().Equal("weather", "topStories", "socialStream", "trending", "pressLatest");
        modules.Skip(1).Should().OnlyContain(m => !m.GetProperty("enabled").GetBoolean(), "a module the row does not name is off");
    }

    [RequiresDockerFact]
    public async Task AnUpdateThatLosesTheRaceAtTheSave_Is409_AndEmitsNothing()
    {
        var bumper = new ConcurrentConfigBumper();
        await using var host = await PortalConfigTestHost.StartAsync(
            _fixture.ConnectionString!,
            services => services.AddSingleton<IInterceptor>(bumper));
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        (await host.PutConfigAsync(PortalConfigTestHost.Body(version: 0))).EnsureSuccessStatusCode();
        bumper.Arm(host.ConnectionString);

        var response = await host.PutConfigAsync(PortalConfigTestHost.Body(version: 1, tagline: "Mine"));

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var row = (await host.ConfigRowsAsync(seeded.ExerciseId)).Single();
        row.Tagline.Should().Be(ConcurrentConfigBumper.OtherTagline, "the other writer's change stands");
        (await host.ConfigEventsAsync(seeded.ExerciseId)).Should().ContainSingle("only the first write's event committed");
    }

    [RequiresDockerFact]
    public async Task ASignerFault_ServesTheMastheadWithoutALogo()
    {
        await using var host = await PortalConfigTestHost.StartAsync(
            _fixture.ConnectionString!,
            services => services.AddScoped<IMediaUrlSigner, ThrowingSigner>());
        var seeded = await host.SeedExerciseAsync();
        var logo = await host.AddMediaAssetAsync(seeded.ExerciseId);
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        (await host.PutConfigAsync(PortalConfigTestHost.Body(logoMediaId: logo.ToString()))).EnsureSuccessStatusCode();

        host.ActAs(seeded.ExerciseId, staffUserId: null);
        var masthead = (await ReadPortalAsync(host)).GetProperty("masthead");

        masthead.GetProperty("logo").ValueKind.Should().Be(JsonValueKind.Null, "a storage fault degrades, never fails the read");
        masthead.GetProperty("name").GetString().Should().Be("Fairhaven Today");
    }

    private static async Task<JsonElement> ReadPortalAsync(PortalConfigTestHost host)
    {
        var response = await host.GetAsync("/api/portal");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private Task<PortalConfigTestHost> StartAsync() => PortalConfigTestHost.StartAsync(_fixture.ConnectionString!);
}

/// <summary>
/// Plays a concurrent writer that wins at the SAVE: when a save is about to modify a <see cref="PortalConfig"/>, it first
/// bumps that row's version (and tagline) through an independent context, so the original UPDATE matches no row. Fires
/// once, after <see cref="Arm"/>.
/// </summary>
internal sealed class ConcurrentConfigBumper : SaveChangesInterceptor
{
    public const string OtherTagline = "Changed by the other writer";

    private string? _connectionString;
    private int _fired;

    public void Arm(string connectionString) => _connectionString = connectionString;

    public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        var target = eventData.Context?.ChangeTracker.Entries<PortalConfig>().FirstOrDefault(e => e.State == EntityState.Modified);
        if (target is not null && _connectionString is not null && Interlocked.Exchange(ref _fired, 1) == 0)
        {
            var options = new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(_connectionString).Options;
            await using var other = new PulseDbContext(options, new ExerciseContext { CurrentExerciseId = target.Entity.ExerciseId });
            var row = await other.PortalConfigs.SingleAsync(cancellationToken);
            row.Tagline = OtherTagline;
            row.Version++;
            await other.SaveChangesAsync(cancellationToken);
        }

        return await base.SavingChangesAsync(eventData, result, cancellationToken);
    }
}

/// <summary>A media signer whose storage is down.</summary>
internal sealed class ThrowingSigner : IMediaUrlSigner
{
    public Task<string> GetReadUrlAsync(MediaAsset asset, CancellationToken cancellationToken) =>
        throw new InvalidOperationException("storage unavailable");

    public Task<IReadOnlyDictionary<Guid, string>> GetReadUrlsAsync(IReadOnlyCollection<MediaAsset> assets, CancellationToken cancellationToken) =>
        throw new InvalidOperationException("storage unavailable");
}
