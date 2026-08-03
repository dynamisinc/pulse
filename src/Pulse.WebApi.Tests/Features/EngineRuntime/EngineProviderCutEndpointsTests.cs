namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.Core.Core.Extensions;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Publishing;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Pulse.WebApi.Tests.Helpers;
using Xunit;

/// <summary>
/// autonomy-safety story 07 — the HTTP half of the generation-provider egress lever, over a minimal host wired
/// exactly as <c>Program.cs</c> wires the feature (<c>AddEngineGeneration</c> → <c>AddEngineReview</c> →
/// <c>MapEngineReview</c>) against real SQL. Covers the two routes' existence + wire shape (AC1/AC5), the
/// already-Fake no-op (AC3), the fail-closed <c>401</c> (AC6), and — AC4 — that the wire contract has NO slot
/// for selecting a provider, proven over the real route table, structurally (the request DTO's property set)
/// and behaviourally (a posted provider selector is ignored, never honoured).
/// </summary>
/// <remarks>
/// The controller-role gate (#297) and the cross-exercise refusal on these two routes are covered by
/// <see cref="EngineSettingsEndpointsTests"/>, which derives its surface from the real route table and now
/// includes them in <c>MutatingRoutes</c> — so this suite deliberately does not duplicate that.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class EngineProviderCutEndpointsTests
{
    private const string CutRoute = "/api/engine/generation-provider/cut-to-fake";
    private const string RestoreRoute = "/api/engine/generation-provider/restore";

    private readonly MsSqlContainerFixture _fixture;

    public EngineProviderCutEndpointsTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task BothLeverRoutes_AreMappedExactlyOnce_OnTheExistingEngineGroup()
    {
        await using var host = await StartHostAsync(Guid.NewGuid());
        var dataSource = host.Services.GetRequiredService<EndpointDataSource>();

        CountRoutes(dataSource, "POST", CutRoute).Should().Be(1);
        CountRoutes(dataSource, "POST", RestoreRoute).Should().Be(1);
    }

    // ---- AC4: there is no slot for a provider selector, anywhere on the wire ---------------------

    /// <summary>
    /// The ROUTE-TABLE half of AC4: the <c>/api/engine/generation-provider</c> prefix carries EXACTLY the binary
    /// cut/restore pair, and neither route has a parameter.
    /// </summary>
    /// <remarks>
    /// Asserted over the real <see cref="EndpointDataSource"/> — the routes <c>MapEngineReview</c> actually
    /// mapped — and NOT over template constants declared in this test class. A constants-only version of this
    /// guard cannot observe <c>EngineReviewEndpoints.cs</c> at all: adding a third
    /// <c>.../cut-to/{provider}</c> route leaves it green, which is precisely the "smaller change slipping in
    /// unreviewed" AC4 exists to stop. Needing the SQL-gated host is an acceptable price for a guard that
    /// observes reality; the model-only (host-free) half of AC4 is the request-DTO shape test below.
    /// </remarks>
    [RequiresDockerFact]
    public async Task TheGenerationProviderPrefix_CarriesExactlyTheBinaryPair_WithNoRouteParameter()
    {
        await using var host = await StartHostAsync(Guid.NewGuid());

        var lever = host.Services.GetRequiredService<EndpointDataSource>().Endpoints
            .OfType<RouteEndpoint>()
            .Select(endpoint => endpoint.RoutePattern.RawText)
            .Where(template => template is not null && template.StartsWith(
                "/api/engine/generation-provider", StringComparison.OrdinalIgnoreCase))
            .Select(template => template!)
            .ToList();

        lever.Should().BeEquivalentTo(
            [CutRoute, RestoreRoute],
            "the lever is a BINARY pair; any third route under this prefix is a provider chooser by another name "
            + "(AC4) — a Tier-2 governance change against PROVIDER-GOVERNANCE.md §8 (UNSIGNED), not a smaller "
            + "version of this feature");
        lever.Should().OnlyContain(
            template => !template.Contains('{', StringComparison.Ordinal),
            "a route parameter here would be a provider selector — the destination is baked into the route name "
            + "('cut to fake', not 'cut to whatever you name')");
    }

    [RequiresDockerFact]
    public async Task APostedProviderSelector_IsIgnored_AndTheDestinationStaysFake()
    {
        // The behavioural half of AC4: an attacker (or a well-meaning future client) naming a provider must not
        // be able to steer generation anywhere. The fields are unmapped, so they are ignored — and this proves
        // the ignoring rather than assuming it.
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, configuredProvider: "AzureOpenAI");

        var response = await host.Client.PostAsync(
            new Uri(CutRoute, UriKind.Relative),
            JsonBody("""
                {
                  "actingHumanId": "controller-7",
                  "timeZone": "UTC",
                  "provider": "ClaudeFoundry",
                  "toProvider": "ClaudeFoundry",
                  "endpoint": "https://attacker.example/",
                  "deployment": "unattested",
                  "model": "unattested-model"
                }
                """));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        doc.RootElement.GetProperty("effectiveProvider").GetString().Should().Be(
            "Fake",
            "the only destination a cut can ever have is the offline provider — a named provider in the body is "
            + "ignored, never honoured (NFR-005 / ADP-025)");
        doc.RootElement.GetProperty("provider").GetString().Should().Be(
            "AzureOpenAI", "and the configured provider is untouched by the request body");
    }

    [RequiresDockerFact]
    public async Task ARestoreThatNamesAProvider_StillLandsOnTheStartupConfiguredOne()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, configuredProvider: "AzureOpenAI");

        await host.Client.PostAsJsonAsync(
            new Uri(CutRoute, UriKind.Relative), new { actingHumanId = "controller-7", timeZone = "UTC" });

        var response = await host.Client.PostAsync(
            new Uri(RestoreRoute, UriKind.Relative),
            JsonBody("""{"actingHumanId":"controller-7","provider":"ClaudeFoundry"}"""));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        doc.RootElement.GetProperty("effectiveProvider").GetString().Should().Be(
            "AzureOpenAI",
            "restore reads its destination from the RUNNING provider, never from the request — that is what makes "
            + "'capped at the startup baseline' structural rather than a rule someone could relax (§8.2)");
        doc.RootElement.GetProperty("providerCutToFake").GetBoolean().Should().BeFalse();
    }

    // ---- AC1 / AC5: the wire shape the console (edge 7) builds against ---------------------------

    [RequiresDockerFact]
    public async Task Cut_ThenGetSettings_ReportsConfiguredAndEffectiveProviderAsSeparateKeys()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, configuredProvider: "AzureOpenAI");

        var cut = await host.Client.PostAsJsonAsync(
            new Uri(CutRoute, UriKind.Relative), new { actingHumanId = "controller-7", timeZone = "UTC" });

        cut.StatusCode.Should().Be(HttpStatusCode.OK);
        using (var doc = JsonDocument.Parse(await cut.Content.ReadAsStringAsync()))
        {
            foreach (var key in new[] { "provider", "effectiveProvider", "providerCutToFake", "alreadyFake" })
            {
                doc.RootElement.TryGetProperty(key, out _).Should().BeTrue(
                    $"the story-07 contract requires a '{key}' key on every settings response");
            }

            doc.RootElement.GetProperty("effectiveProvider").GetString().Should().Be("Fake");
            doc.RootElement.GetProperty("providerCutToFake").GetBoolean().Should().BeTrue();
            doc.RootElement.GetProperty("alreadyFake").GetBoolean().Should().BeFalse();
        }

        // The mutation's own response is authoritative, and a follow-up GET agrees with it (the panel's
        // await-then-apply model relies on both being the same snapshot).
        var read = await host.Client.GetAsync(new Uri("/api/engine/settings", UriKind.Relative));
        using var readDoc = JsonDocument.Parse(await read.Content.ReadAsStringAsync());
        readDoc.RootElement.GetProperty("effectiveProvider").GetString().Should().Be("Fake");
        readDoc.RootElement.GetProperty("inMemoryStateNote").GetString().Should().Contain(
            "generation-provider cut", "the note tells the operator this lever resets on a restart too");

        // The host singleton the reaction loop's selector reads is what moved — not a per-request copy.
        host.Services.GetRequiredService<IGenerationProviderCutRegistry>().IsCutToFake(exerciseId)
            .Should().BeTrue();
    }

    // ---- AC3: the already-Fake no-op over HTTP ---------------------------------------------------

    [RequiresDockerFact]
    public async Task Cut_WithFakeConfigured_Returns200_WithAlreadyFakeTrue_AndRecordsNoCut()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId); // Provider=Fake, the committed default

        var response = await host.Client.PostAsJsonAsync(
            new Uri(CutRoute, UriKind.Relative), new { actingHumanId = "controller-7", timeZone = "UTC" });

        response.StatusCode.Should().Be(HttpStatusCode.OK, "an idempotent no-op is not an error");
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        doc.RootElement.GetProperty("alreadyFake").GetBoolean().Should().BeTrue();
        doc.RootElement.GetProperty("providerCutToFake").GetBoolean().Should().BeFalse();
        host.Services.GetRequiredService<IGenerationProviderCutRegistry>().IsCutToFake(exerciseId)
            .Should().BeFalse("nothing was locked down, so nothing is recorded");
    }

    // ---- AC6: fail closed -------------------------------------------------------------------------

    /// <summary>
    /// The OUTCOME contract for an unresolved scope: <c>401</c> and no snapshot, on both routes.
    /// </summary>
    /// <remarks>
    /// <b>Honest about which layer answers.</b> With no resolved scope,
    /// <c>EngineCockpitStaffAuthorizationFilter</c> already 401s before the handler runs (its documented
    /// fail-closed order), so this test proves the endpoint is CLOSED — defence in depth — and deliberately does
    /// NOT claim to prove the service's own guard. That one is proven where it is observable, in
    /// <see cref="EngineProviderCutServiceTests.CutAndRestore_WithAnUnresolvedScope_FailClosed_AndChangeNothing"/>
    /// (verified by neutering the service guard and watching that test fail, while this one kept passing — which
    /// is exactly why both exist).
    /// </remarks>
    [RequiresDockerFact]
    public async Task BothRoutes_WithAnUnresolvedScope_Return401_WithNoSnapshot()
    {
        await using var host = await StartHostAsync(currentExerciseId: null);

        var cut = await host.Client.PostAsJsonAsync(
            new Uri(CutRoute, UriKind.Relative), new { actingHumanId = "controller-7" });
        var restore = await host.Client.PostAsJsonAsync(
            new Uri(RestoreRoute, UriKind.Relative), new { actingHumanId = "controller-7" });

        cut.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "an unresolved scope fails closed on the egress lever exactly as on the settings POSTs — never a "
            + "default/unscoped 200 snapshot (COR-001)");
        restore.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await cut.Content.ReadAsStringAsync()).Should().NotContain(
            "effectiveProvider", "a 401 carries no snapshot at all");
    }

    [RequiresDockerFact]
    public async Task BothRoutes_MissingActingHumanId_Return400()
    {
        await using var host = await StartHostAsync(Guid.NewGuid(), configuredProvider: "AzureOpenAI");

        var cut = await host.Client.PostAsJsonAsync(new Uri(CutRoute, UriKind.Relative), new { timeZone = "UTC" });
        var restore = await host.Client.PostAsJsonAsync(new Uri(RestoreRoute, UriKind.Relative), new { timeZone = "UTC" });

        cut.StatusCode.Should().Be(HttpStatusCode.BadRequest, "COR-018 requires actingHumanId");
        restore.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [RequiresDockerFact]
    public async Task BothRoutes_MissingBody_Return400()
    {
        await using var host = await StartHostAsync(Guid.NewGuid());

        var cut = await host.Client.PostAsync(new Uri(CutRoute, UriKind.Relative), JsonBody("null"));
        var restore = await host.Client.PostAsync(new Uri(RestoreRoute, UriKind.Relative), JsonBody("null"));

        cut.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        restore.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    // ---- host + helpers --------------------------------------------------------------------------

    private static StringContent JsonBody(string json) => new(json, Encoding.UTF8, "application/json");

    private static int CountRoutes(EndpointDataSource dataSource, string method, string rawText)
        => dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Count(endpoint =>
                string.Equals(endpoint.RoutePattern.RawText, rawText, StringComparison.OrdinalIgnoreCase)
                && (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false));

    private async Task<ProviderCutTestHost> StartHostAsync(
        Guid? currentExerciseId,
        string configuredProvider = "Fake")
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");
        return await ProviderCutTestHost.StartAsync(
            _fixture.ConnectionString!, currentExerciseId, configuredProvider);
    }

    /// <summary>
    /// A minimal host wired exactly as <c>Program.cs</c> wires the feature, with a controller-role staff session,
    /// a fixed server-authoritative exercise scope, and a configurable CONFIGURED provider.
    /// </summary>
    /// <remarks>
    /// A non-<c>Fake</c> configured provider is simulated by replacing <see cref="IGenerationProvider"/> with a
    /// stub that only reports a live NAME. That is all the settings/cut path reads from it — and it keeps the
    /// suite hermetic: no test in this file can egress, and no governance key has to be faked to reach the live
    /// branch of <c>AddEngineGeneration</c>. The selector's actual per-exercise DELEGATION is proven in
    /// <c>Pulse.Core.Tests</c>' <c>GenerationProviderSelectorTests</c> and in
    /// <see cref="EngineProviderCutServiceTests"/>.
    /// </remarks>
    private sealed class ProviderCutTestHost : IAsyncDisposable
    {
        private readonly WebApplication _app;

        private ProviderCutTestHost(WebApplication app)
        {
            _app = app;
            Client = app.GetTestClient();
        }

        public HttpClient Client { get; }

        public IServiceProvider Services => _app.Services;

        public static async Task<ProviderCutTestHost> StartAsync(
            string connectionString,
            Guid? currentExerciseId,
            string configuredProvider)
        {
            var staffUserId = Guid.NewGuid();
            if (currentExerciseId is { } assignExercise)
            {
                await SeedStaffAssignmentAsync(connectionString, staffUserId, assignExercise);
            }

            var builder = WebApplication.CreateBuilder();
            builder.WebHost.UseTestServer();
            builder.Configuration["ConnectionStrings:DefaultConnection"] = connectionString;
            builder.Configuration["Generation:Provider"] = "Fake";

            builder.Services.AddPulsePersistence(builder.Configuration);
            builder.Services.AddExerciseScoping();
            builder.Services.AddSignalR();
            builder.Services.AddEngineGeneration(builder.Configuration);
            builder.Services.AddEngineRuntimeSeams();
            builder.Services.AddExerciseClock();
            builder.Services.AddEngineReview();

            // Nothing in this suite publishes a burst; the funnel is a stub so the review service can activate.
            builder.Services.AddSingleton<IEnginePublishService>(new NeverPublishes());

            if (!string.Equals(configuredProvider, "Fake", StringComparison.Ordinal))
            {
                builder.Services.RemoveAll<IGenerationProvider>();
                builder.Services.AddSingleton<IGenerationProvider>(new StubLiveProvider(configuredProvider));
            }

            builder.Services.AddScoped<StaffAssignmentService>();
            builder.Services.RemoveAll<ICurrentStaffSessionAccessor>();
            builder.Services.AddScoped<ICurrentStaffSessionAccessor>(_ => new StubCurrentStaffSessionAccessor(
                new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = staffUserId }));

            builder.Services.RemoveAll<IExerciseContext>();
            builder.Services.AddScoped<IExerciseContext>(
                _ => new ExerciseContext { CurrentExerciseId = currentExerciseId });

            var app = builder.Build();
            app.MapEngineReview();
            await app.StartAsync();

            return new ProviderCutTestHost(app);
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await _app.DisposeAsync();
        }

        private static async Task SeedStaffAssignmentAsync(string connectionString, Guid staffUserId, Guid exerciseId)
        {
            var options = new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(connectionString).Options;

            await using var context = new PulseDbContext(options);
            context.Exercises.Add(new Exercise
            {
                OrganizationId = Organization.DefaultOrganizationId,
                Id = exerciseId,
                Name = "Provider Cut Test Exercise",
                TimeZone = "UTC",
                Status = "active",
            });
            // exercise-isolation/11: the staff human the session names must EXIST and share the exercise's
            // customer tenant, or the org bound fails closed and every staff endpoint 403s.
            context.StaffUsers.Add(StaffTenantSeed.StaffUserFor(staffUserId));
            context.StaffAssignments.Add(new StaffAssignment
            {
                Id = Guid.NewGuid(),
                StaffUserId = staffUserId,
                ExerciseId = exerciseId,
                Role = "controller",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await context.SaveChangesAsync();
        }

        /// <summary>A publish funnel that must never be reached — the egress lever publishes nothing.</summary>
        private sealed class NeverPublishes : IEnginePublishService
        {
            public Task<EngineBurstPublishResult> PublishBurstAsync(
                EngineBurst burst,
                CancellationToken cancellationToken = default)
                => throw new NotSupportedException("the generation-provider lever never publishes a burst");
        }

        /// <summary>A provider that only reports a live NAME — never invoked for generation in this suite.</summary>
        private sealed class StubLiveProvider : IGenerationProvider
        {
            public StubLiveProvider(string name) => Name = name;

            public string Name { get; }

            public GenerationGovernance Governance => GenerationGovernance.InProcess;

            public Task<GenerationResult> GenerateAsync(
                GenerationRequest request,
                CancellationToken cancellationToken = default)
                => throw new NotSupportedException("never invoked — this stub exists only to report a live Name");
        }
    }
}

/// <summary>
/// Story 07's model-only wire-contract guards — deliberately <see cref="FactAttribute"/>s outside the SQL
/// collection, so they run on every machine and in every CI job, not only where a real SQL Server is reachable.
/// They reflect over / read the real production contract types, so they observe production code with no host at
/// all: the REQUEST-CONTRACT half of AC4 ("this endpoint can never become a provider chooser"), and the backend
/// half of the Gate-2 WR-G2-007 <see cref="EngineSettingsDto.InMemoryNote"/> drift guard.
/// </summary>
/// <remarks>
/// The ROUTE-TABLE half necessarily lives in the host-bearing suite above
/// (<see cref="EngineProviderCutEndpointsTests.TheGenerationProviderPrefix_CarriesExactlyTheBinaryPair_WithNoRouteParameter"/>),
/// because only a built host can be asked what routes were actually mapped.
/// </remarks>
public sealed class EngineGenerationProviderRequestShapeTests
{
    [Fact]
    public void TheCutAndRestoreRequestContract_HasNoPropertyThatCouldSelectAProvider()
    {
        var properties = typeof(EngineGenerationProviderRequest)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Select(p => p.Name)
            .ToList();

        properties.Should().BeEquivalentTo(
            ["ActingHumanId", "TimeZone"],
            "the cut/restore body takes ONLY the acting human (COR-018) and the optional telemetry zone — adding "
            + "any provider/endpoint/deployment/model field here would turn a safety brake into a provider "
            + "chooser, which is a Tier-2 governance change against PROVIDER-GOVERNANCE.md §8 (UNSIGNED), not a "
            + "smaller version of this feature (AC4)");

        // The negative form too, so a differently-NAMED selector cannot slip past the list above.
        properties.Should().NotContain(
            name => name.Contains("provider", StringComparison.OrdinalIgnoreCase)
                || name.Contains("endpoint", StringComparison.OrdinalIgnoreCase)
                || name.Contains("deployment", StringComparison.OrdinalIgnoreCase)
                || name.Contains("model", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Gate-2 WR-G2-007, backend half: the shared <see cref="EngineSettingsDto.InMemoryNote"/> must keep naming
    /// THIS lever and its reset target, so an operator is told a restart returns generation to the
    /// startup-configured provider instead of discovering it. Model-only, like the AC4 guard above, so it runs on
    /// every machine and in every CI job.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>This is the paired half of the frontend guard in</b>
    /// <c>src/frontend/src/features/controller/engine/hooks/useEngineSettings.test.ts</c> ("WR-002: the mock
    /// inMemoryStateNote honestly names the generation-provider cut …"), which asserts the same two markers
    /// against the mock's copy of the note. That one alone could only catch a REVERT of the mock fixture to the
    /// pre-story-07 wording; this one makes an edit to the C# <c>const</c> that drops either marker fail a build,
    /// which is the direction that already shipped a stale note to UAT once.
    /// </para>
    /// <para>
    /// <b>What the pair still does NOT close, stated honestly:</b> the two sides assert the same two markers
    /// <i>independently</i>, against two separate strings. So the pair catches a one-sided drop of a marker in
    /// either language, but NOT a coordinated reword that changes both copies together (nor a copy that keeps the
    /// markers while the rest of the sentence goes stale, nor divergence in any text outside the markers). There
    /// is still no shared source of truth across the language boundary — closing that needs a generated/exported
    /// contract fixture, tracked separately.
    /// </para>
    /// </remarks>
    [Fact]
    public void TheSharedInMemoryNote_NamesTheGenerationProviderCutAndItsStartupConfiguredResetTarget()
    {
        EngineSettingsDto.InMemoryNote.Should().MatchRegex("(?i)generation-provider cut")
            .And.MatchRegex("(?i)startup-configured provider");
    }
}
