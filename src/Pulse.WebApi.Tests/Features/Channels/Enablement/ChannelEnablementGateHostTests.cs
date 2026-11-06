namespace Pulse.WebApi.Tests.Features.Channels.Enablement;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.Channels.Enablement;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Tests.Features.Social.Moderation;
using Xunit;

/// <summary>
/// Channels-foundation 08 (#704), the route half, against the REAL <c>Program</c> pipeline and real SQL: a participant
/// request inside <c>RequireChannelEnabled(channel)</c> for a disabled news/press/weather/portal channel gets the same 404 an
/// unmapped route gets; an enabled channel proceeds; a staff session passes regardless; a toggle applies on the next
/// request and the nav config agrees; Social is not gated (Q4); one exercise's setting never opens another's routes.
/// </summary>
/// <remarks>
/// No channel route exists yet (story 06 adds them), so a startup filter maps one probe route per channel onto the
/// host's own endpoint route builder, AFTER Program has built its pipeline, so every probe runs behind the real
/// exercise resolution, session authentication, default-deny authorization and lifecycle gate.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class ChannelEnablementGateHostTests
{
    private const string UnmappedRoute = "/api/channel-gate-probe/not-a-channel";

    private static readonly string[] GatedChannels = ["news", "press", "weather", "portal"];

    private readonly MsSqlContainerFixture _fixture;
    private readonly ModerationSeeder _seed;

    public ChannelEnablementGateHostTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _seed = new ModerationSeeder(fixture);
    }

    public static TheoryData<string> Channels => new(GatedChannels);

    [RequiresDockerTheory]
    [MemberData(nameof(Channels))]
    public async Task Participant_DisabledChannel_GetsTheSame404AsAnUnknownRoute(string channel)
    {
        var exercise = await SeedExerciseAsync(enabledChannels: null);
        var token = await _seed.SeedParticipantSessionAsync(exercise.Id);

        using var host = new GateProbeFactory(_seed.ConnectionString);
        using var client = host.CreateClientFor(exercise.Host, token);

        var gated = await client.GetAsync(ProbeRoute(channel));
        var unknown = await client.GetAsync(UnmappedRoute);

        unknown.StatusCode.Should().Be(HttpStatusCode.NotFound, "the comparison baseline is the host's own unknown-route 404");
        gated.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await gated.Content.ReadAsStringAsync()).Should().Be(await unknown.Content.ReadAsStringAsync());
        gated.Content.Headers.ContentType.Should().Be(unknown.Content.Headers.ContentType);
    }

    [RequiresDockerTheory]
    [MemberData(nameof(Channels))]
    public async Task Participant_EnabledChannel_Proceeds(string channel)
    {
        var exercise = await SeedExerciseAsync($"social,{channel}");
        var token = await _seed.SeedParticipantSessionAsync(exercise.Id);

        using var host = new GateProbeFactory(_seed.ConnectionString);
        using var client = host.CreateClientFor(exercise.Host, token);

        var response = await client.GetAsync(ProbeRoute(channel));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.Content.ReadAsStringAsync()).Should().Contain(channel);
    }

    [RequiresDockerFact]
    public async Task Staff_PassADisabledChannel_WhileTheParticipantStill404s()
    {
        var exercise = await SeedExerciseAsync(enabledChannels: null);
        var staff = await _seed.SeedControllerSessionAsync(exercise.Id);
        var participant = await _seed.SeedParticipantSessionAsync(exercise.Id);
        var readOnly = await _seed.SeedReadOnlySessionAsync(exercise.Id);

        using var host = new GateProbeFactory(_seed.ConnectionString);
        using var staffClient = host.CreateClientFor(exercise.Host, staff);
        using var participantClient = host.CreateClientFor(exercise.Host, participant);
        using var readOnlyClient = host.CreateClientFor(exercise.Host, readOnly);

        foreach (var channel in GatedChannels)
        {
            (await staffClient.GetAsync(ProbeRoute(channel))).StatusCode.Should().Be(
                HttpStatusCode.OK, "planners prepare and preview {0} before enabling it", channel);
            (await participantClient.GetAsync(ProbeRoute(channel))).StatusCode.Should().Be(HttpStatusCode.NotFound);
            (await readOnlyClient.GetAsync(ProbeRoute(channel))).StatusCode.Should().Be(
                HttpStatusCode.NotFound, "a shared read-only session is a participant-world session, not staff");
        }
    }

    [RequiresDockerFact]
    public async Task Staff_NotAssignedToTheExercise_AreGatedLikeAParticipant()
    {
        var exercise = await SeedExerciseAsync(enabledChannels: null);
        var elsewhere = await SeedExerciseAsync("social,news,press,weather,portal");
        var unassigned = await _seed.SeedStaffSessionAsync(exercise.Id, [(elsewhere.Id, "controller")]);

        using var host = new GateProbeFactory(_seed.ConnectionString);
        using var client = host.CreateClientFor(exercise.Host, unassigned);

        foreach (var channel in GatedChannels)
        {
            (await client.GetAsync(ProbeRoute(channel))).StatusCode.Should().Be(
                HttpStatusCode.NotFound, "an assignment to another exercise must not open {0} here", channel);
        }
    }

    [RequiresDockerFact]
    public async Task Toggle_AppliesOnTheNextRequest_AndTheNavConfigAgrees()
    {
        var exercise = await SeedExerciseAsync(enabledChannels: null);
        var token = await _seed.SeedParticipantSessionAsync(exercise.Id);

        using var host = new GateProbeFactory(_seed.ConnectionString);
        using var client = host.CreateClientFor(exercise.Host, token);

        await AssertNavAndGateAgreeAsync(client, expectedEnabled: ["social"]);

        await SetEnabledChannelsAsync(exercise.Id, "social,news,portal");
        await AssertNavAndGateAgreeAsync(client, expectedEnabled: ["social", "portal", "news"]);

        await SetEnabledChannelsAsync(exercise.Id, "social,weather");
        await AssertNavAndGateAgreeAsync(client, expectedEnabled: ["social", "weather"]);
    }

    [RequiresDockerFact]
    public async Task Isolation_AnotherExercisesEnabledChannel_NeverOpensThisExercisesRoutes()
    {
        var open = await SeedExerciseAsync("social,news,press,weather,portal");
        var closed = await SeedExerciseAsync(enabledChannels: null);
        var openToken = await _seed.SeedParticipantSessionAsync(open.Id);
        var closedToken = await _seed.SeedParticipantSessionAsync(closed.Id);

        using var host = new GateProbeFactory(_seed.ConnectionString);
        using var openClient = host.CreateClientFor(open.Host, openToken);
        using var closedClient = host.CreateClientFor(closed.Host, closedToken);

        foreach (var channel in GatedChannels)
        {
            (await openClient.GetAsync(ProbeRoute(channel))).StatusCode.Should().Be(HttpStatusCode.OK);
            (await closedClient.GetAsync(ProbeRoute(channel))).StatusCode.Should().Be(
                HttpStatusCode.NotFound, "exercise A enabling {0} must not reach exercise B", channel);
        }
    }

    [RequiresDockerFact]
    public async Task Social_IsNotGated_EvenWhenSocialIsDisabled()
    {
        var exercise = await SeedExerciseAsync("news");
        var persona = await _seed.SeedPersonaAsync(exercise.Id);
        var token = await _seed.SeedParticipantSessionAsync(exercise.Id, persona);

        using var host = new GateProbeFactory(_seed.ConnectionString);
        using var client = host.CreateClientFor(exercise.Host, token);

        (await client.GetAsync("/api/feed")).StatusCode.Should().Be(
            HttpStatusCode.OK, "Q4: the social routes keep serving; gating them is a follow-up");
    }

    private static string ProbeRoute(string channel) => $"/api/channel-gate-probe/{channel}";

    private static async Task AssertNavAndGateAgreeAsync(HttpClient client, IReadOnlyCollection<string> expectedEnabled)
    {
        var navResponse = await client.GetAsync("/api/channel-nav-config");
        navResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        using var nav = JsonDocument.Parse(await navResponse.Content.ReadAsStringAsync());

        var navEnabled = nav.RootElement.GetProperty("channels").EnumerateArray()
            .Where(c => c.GetProperty("enabled").GetBoolean())
            .Select(c => c.GetProperty("id").GetString()!)
            .ToList();
        navEnabled.Should().BeEquivalentTo(expectedEnabled);

        foreach (var channel in GatedChannels)
        {
            var status = (await client.GetAsync(ProbeRoute(channel))).StatusCode;
            status.Should().Be(
                navEnabled.Contains(channel) ? HttpStatusCode.OK : HttpStatusCode.NotFound,
                "the gate and the nav agree on '{0}'",
                channel);
        }
    }

    private async Task<SeededExercise> SeedExerciseAsync(string? enabledChannels)
    {
        var exercise = await _seed.SeedExerciseAsync();
        if (enabledChannels is not null)
        {
            await SetEnabledChannelsAsync(exercise.Id, enabledChannels);
        }

        return exercise;
    }

    private async Task SetEnabledChannelsAsync(Guid exerciseId, string? enabledChannels)
    {
        await using var write = _fixture.CreateContext();
        var row = await write.Exercises.SingleAsync(e => e.Id == exerciseId);
        row.EnabledChannels = enabledChannels;
        await write.SaveChangesAsync();
    }

    /// <summary>The real <c>Program</c> host over the fixture database, plus one gated probe route per channel.</summary>
    private sealed class GateProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

        public GateProbeFactory(string connectionString) =>
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);

        public HttpClient CreateClientFor(string host, string bearerToken)
        {
            var client = CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri($"http://{host}") });
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
            return client;
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            ArgumentNullException.ThrowIfNull(builder);
            builder.ConfigureTestServices(services => services.AddSingleton<IStartupFilter>(new MapProbeRoutesStartupFilter()));
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }

    private sealed class MapProbeRoutesStartupFilter : IStartupFilter
    {
        private const string EndpointRouteBuilderKey = "__EndpointRouteBuilder";

        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            next(app);

            if (!app.Properties.TryGetValue(EndpointRouteBuilderKey, out var value) || value is not IEndpointRouteBuilder routes)
            {
                throw new InvalidOperationException("The Program host exposes no endpoint route builder to map the probes on.");
            }

            foreach (var channel in GatedChannels)
            {
                routes.MapGet(ProbeRoute(channel), () => Results.Ok(new { channel })).RequireChannelEnabled(channel);
            }
        };
    }
}
