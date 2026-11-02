namespace Pulse.WebApi.Tests.Features.Realtime;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// Channels-foundation story 09 (#705) over the REAL composition root: <c>Program.cs</c>'s own
/// <c>AddSocialRealtimeHub()</c> / <c>MapSocialRealtimeHub()</c>, a live (in-memory) SignalR connection, and the
/// registered <see cref="IFeedBroadcaster"/>. Docker-free, the same idiom as <see cref="ExerciseRealtimeHubIsolationTests"/>:
/// a dummy connection string so the host builds, a stub host resolver, and stub lifecycle / channel readers.
/// </summary>
public class ChannelRealtimeFanoutHostTests
{
    [Fact]
    public void CompositionRoot_RegistersTheChannelEnabledReader_AndTheSignalRBroadcaster()
    {
        // No reader replaced: this proves Program.cs's AddSocialRealtimeHub supplies the DB-backed reader itself,
        // so story 09 needs no Program.cs edit.
        using var host = new ChannelHostFactory(Guid.NewGuid(), channelEnabled: null);

        host.Services.GetService<ExerciseChannelEnabledReader>().Should().NotBeNull();
        using var scope = host.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<IFeedBroadcaster>().Should().BeOfType<SignalRFeedBroadcaster>();
    }

    [Fact]
    public async Task ParticipantInExerciseA_ReceivesItsOwnChannelFrames_NeverExerciseBs_AndTheWireCarriesNoProvenance()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        using var host = new ChannelHostFactory(exerciseA, TestFeedBroadcasters.AllChannelsEnabled);
        await using var connection = host.BuildConnection();
        var received = new List<(string Event, JsonElement Payload)>();
        var proofOfLife = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        foreach (var eventName in ChannelRealtimeEvents.All)
        {
            connection.On<JsonElement>(eventName, payload =>
            {
                lock (received)
                {
                    received.Add((eventName, payload.Clone()));
                    if (received.Count == ChannelRealtimeEvents.All.Count)
                    {
                        proofOfLife.TrySetResult();
                    }
                }
            });
        }

        await connection.StartAsync();
        await host.Connected.WaitForConnectedAsync();

        var publishedForA = ChannelFrames.Published();
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var broadcaster = scope.ServiceProvider.GetRequiredService<IFeedBroadcaster>();
            await broadcaster.BroadcastContentPublishedAsync(exerciseB, ChannelFrames.Published());
            await broadcaster.BroadcastContentRevisedAsync(exerciseB, ChannelFrames.Revised());
            await broadcaster.BroadcastContentRetractedAsync(exerciseB, ChannelFrames.Retracted());
            await broadcaster.BroadcastAlertsChangedAsync(exerciseB, ChannelFrames.Alerts());
            await broadcaster.BroadcastContentPublishedAsync(exerciseA, publishedForA);
            await broadcaster.BroadcastContentRevisedAsync(exerciseA, ChannelFrames.Revised());
            await broadcaster.BroadcastContentRetractedAsync(exerciseA, ChannelFrames.Retracted());
            await broadcaster.BroadcastAlertsChangedAsync(exerciseA, ChannelFrames.Alerts());
        }

        (await Task.WhenAny(proofOfLife.Task, Task.Delay(TimeSpan.FromSeconds(10)))).Should().Be(proofOfLife.Task);
        await Task.Delay(TimeSpan.FromMilliseconds(250)); // room for a wrongly cross-delivered frame to arrive

        lock (received)
        {
            received.Select(r => r.Event).Should().BeEquivalentTo(
                ChannelRealtimeEvents.All, "exactly A's four frames arrive; none of exercise B's (XC-001)");
            received.Single(r => r.Event == "ContentPublished").Payload.GetProperty("id").GetString()
                .Should().Be(publishedForA.Id);
            foreach (var (eventName, payload) in received)
            {
                var raw = payload.GetRawText();
                foreach (var key in new[] { "origin", "actingHumanId", "injectId", "createdWallClock", "body" })
                {
                    raw.Should().NotContain($"\"{key}\"", $"{eventName} must not carry '{key}' on the wire (XC-002)");
                }
            }
        }
    }

    [Fact]
    public async Task ParticipantNeverReceivesADisabledChannelsHeadline()
    {
        var exerciseId = Guid.NewGuid();
        using var host = new ChannelHostFactory(exerciseId, TestFeedBroadcasters.EnabledChannels("social", ChannelVocabulary.Weather));
        await using var connection = host.BuildConnection();
        var headlines = new List<string>();
        var weatherArrived = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        connection.On<JsonElement>("ContentPublished", payload =>
        {
            var channel = payload.GetProperty("channelId").GetString()!;
            lock (headlines)
            {
                headlines.Add(payload.GetProperty("headline").GetString()!);
            }

            if (channel == ChannelVocabulary.Weather)
            {
                weatherArrived.TrySetResult();
            }
        });

        await connection.StartAsync();
        await host.Connected.WaitForConnectedAsync();

        var hiddenNews = ChannelFrames.Published(ChannelVocabulary.News) with { Headline = "HIDDEN news headline" };
        var visibleWeather = ChannelFrames.Published(ChannelVocabulary.Weather) with { Headline = "Visible weather headline" };
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var broadcaster = scope.ServiceProvider.GetRequiredService<IFeedBroadcaster>();
            await broadcaster.BroadcastContentPublishedAsync(exerciseId, hiddenNews);
            await broadcaster.BroadcastContentPublishedAsync(exerciseId, visibleWeather);
        }

        (await Task.WhenAny(weatherArrived.Task, Task.Delay(TimeSpan.FromSeconds(10)))).Should().Be(weatherArrived.Task);
        await Task.Delay(TimeSpan.FromMilliseconds(250));

        lock (headlines)
        {
            headlines.Should().Equal(new[] { visibleWeather.Headline }, "a disabled channel's headline never reaches a participant");
        }
    }

    /// <summary>
    /// Boots the real <c>Program</c> host with a participant session in <c>exerciseId</c>, a <c>live</c> lifecycle, and the
    /// given channel reader (<c>null</c> keeps the composition root's own DB-backed reader).
    /// </summary>
    private sealed class ChannelHostFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";
        private const string DummyConnectionString =
            "Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;";

        private readonly Guid _exerciseId;
        private readonly ExerciseChannelEnabledReader? _channelEnabled;

        public ChannelHostFactory(Guid exerciseId, ExerciseChannelEnabledReader? channelEnabled)
        {
            _exerciseId = exerciseId;
            _channelEnabled = channelEnabled;
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, DummyConnectionString);
        }

        public HubConnectedSignal Connected { get; } = new();

        public HubConnection BuildConnection() =>
            new HubConnectionBuilder()
                .WithUrl(new Uri("http://localhost/hubs/exercise"), options =>
                {
                    options.HttpMessageHandlerFactory = _ => Server.CreateHandler();
                    options.Transports = Microsoft.AspNetCore.Http.Connections.HttpTransportType.LongPolling;
                })
                .Build();

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            ArgumentNullException.ThrowIfNull(builder);

            builder.UseFakeAuthenticatedSession(_exerciseId);
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IHostExerciseResolver>();
                services.AddSingleton<IHostExerciseResolver>(new StubHostExerciseResolver(_exerciseId));
                services.Configure<HubOptions>(options => options.AddFilter(Connected));
                services.Replace(ServiceDescriptor.Singleton(TestFeedBroadcasters.FixedStatus("live")));
                if (_channelEnabled is not null)
                {
                    services.Replace(ServiceDescriptor.Singleton(_channelEnabled));
                }
            });
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }

    private sealed class StubHostExerciseResolver(Guid exerciseId) : IHostExerciseResolver
    {
        public Task<Guid?> ResolveExerciseIdAsync(string? rawHost, CancellationToken cancellationToken) =>
            Task.FromResult<Guid?>(exerciseId);
    }
}
