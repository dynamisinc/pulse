namespace Pulse.WebApi.Tests.Features.WhiteNoise;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Injects;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.WhiteNoise;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Pulse.WebApi.Tests.Features.Injects;
using Pulse.WebApi.Tests.Features.Social;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// A minimal TestServer host wired the way <c>Program.cs</c> will wire the white-noise slice (seam S-2): persistence +
/// exercise scoping, the exercise clock, the pause tiers, the REAL post funnel, <c>AddInjects()</c> (so the run sheet
/// is there to prove noise never reaches it), then <c>AddWhiteNoise()</c> + <c>MapWhiteNoise()</c> behind the SHIPPED
/// staff/controller filters, against the shared real-SQL database. Only the edges are doubled: the caller (switchable
/// per call), the wall clock (hand-advanced; it also drives the exercise clock), the jitter (pinned), the feed
/// broadcaster and the noise broadcaster (recording). The hosted pacer is replaced by a directly callable instance,
/// so pacing is driven tick by tick, never by sleeping.
/// </summary>
internal sealed class WhiteNoiseTestHost : IAsyncDisposable
{
    private readonly WebApplication _app;
    private readonly CallerHolder _caller;

    private WhiteNoiseTestHost(WebApplication app, CallerHolder caller, ManualTimeProvider time, string connectionString)
    {
        _app = app;
        _caller = caller;
        Time = time;
        ConnectionString = connectionString;
        Client = app.GetTestClient();
    }

    public HttpClient Client { get; }

    public IServiceProvider Services => _app.Services;

    public ManualTimeProvider Time { get; }

    public string ConnectionString { get; }

    public FakeFeedBroadcaster FeedBroadcaster => _app.Services.GetRequiredService<FakeFeedBroadcaster>();

    public RecordingNoiseBroadcaster NoiseBroadcaster => _app.Services.GetRequiredService<RecordingNoiseBroadcaster>();

    public PauseTierRegistry PauseTiers => _app.Services.GetRequiredService<PauseTierRegistry>();

    public IExerciseClock Clock => _app.Services.GetRequiredService<IExerciseClock>();

    public WhiteNoisePacer Pacer => _app.Services.GetRequiredService<WhiteNoisePacer>();

    /// <summary>Makes every following request act as this staff user in this exercise (null = none).</summary>
    public void ActAs(Guid? exerciseId, Guid? staffUserId)
    {
        _caller.ExerciseId = exerciseId;
        _caller.StaffUserId = staffUserId;
    }

    public static async Task<WhiteNoiseTestHost> StartAsync(
        string connectionString,
        INoiseJitterSource? jitter = null,
        Action<IServiceCollection>? configureServices = null)
    {
        var caller = new CallerHolder();
        var time = new ManualTimeProvider(new DateTimeOffset(2026, 10, 20, 14, 0, 0, TimeSpan.Zero));

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Configuration["ConnectionStrings:DefaultConnection"] = connectionString;

        builder.Services.AddSingleton<TimeProvider>(time);
        builder.Services.AddPulsePersistence(builder.Configuration);
        builder.Services.AddExerciseScoping();
        builder.Services.AddExerciseClock();
        builder.Services.AddPauseTierSteering();
        builder.Services.AddSocialPostWrite();
        builder.Services.AddSocialThreads();
        builder.Services.RemoveAll<IMediaUrlSigner>();
        builder.Services.AddScoped<IMediaUrlSigner>(sp => new FakeMediaUrlSigner(sp.GetRequiredService<IExerciseContext>(), new SignerProbe()));

        var feedBroadcaster = new FakeFeedBroadcaster();
        builder.Services.AddSingleton(feedBroadcaster);
        builder.Services.AddScoped<IFeedBroadcaster>(_ => feedBroadcaster);

        // The recording noise broadcaster is registered first, so AddWhiteNoise's TryAdd leaves it in place.
        var noiseBroadcaster = new RecordingNoiseBroadcaster();
        builder.Services.AddSingleton(noiseBroadcaster);
        builder.Services.AddSingleton<INoiseBroadcaster>(noiseBroadcaster);

        builder.Services.AddInjects();
        builder.Services.AddWhiteNoise();

        // Drive pacing by hand: drop both hosted loops, keep a directly callable pacer over the same services.
        foreach (var hosted in builder.Services
                     .Where(d => d.ServiceType == typeof(IHostedService)
                         && (d.ImplementationType == typeof(InjectBurstRunner) || d.ImplementationType == typeof(WhiteNoisePacer)))
                     .ToList())
        {
            builder.Services.Remove(hosted);
        }

        builder.Services.AddSingleton<WhiteNoisePacer>();
        builder.Services.RemoveAll<INoiseJitterSource>();
        builder.Services.AddSingleton(jitter ?? new FixedJitter(0.5));

        builder.Services.AddScoped<StaffAssignmentService>();
        builder.Services.RemoveAll<ICurrentStaffSessionAccessor>();
        builder.Services.AddScoped<ICurrentStaffSessionAccessor>(_ => new StubCurrentStaffSessionAccessor(
            caller.StaffUserId is { } staff
                ? new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = staff }
                : null));

        // A fresh, SETTABLE ExerciseContext per scope (the pacer sets its own), seeded from the acting caller.
        builder.Services.RemoveAll<IExerciseContext>();
        builder.Services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = caller.ExerciseId });

        // Last word for a test (e.g. a SaveChanges interceptor that makes the funnel throw).
        configureServices?.Invoke(builder.Services);

        var app = builder.Build();
        app.Use(async (context, next) =>
        {
            if (caller.StaffUserId is { } staffUserId)
            {
                context.User = SessionPrincipal.Create(new AuthenticatedSession
                {
                    SessionId = Guid.NewGuid(),
                    ExerciseId = caller.ExerciseId ?? Guid.Empty,
                    Kind = "staff",
                    StaffUserId = staffUserId,
                    PrincipalId = staffUserId.ToString(),
                    ActingHumanId = staffUserId.ToString(),
                });
            }

            await next(context);
        });
        app.UseRateLimiter();
        app.MapInjects();
        app.MapWhiteNoise();
        await app.StartAsync();

        return new WhiteNoiseTestHost(app, caller, time, connectionString);
    }

    /// <summary>A context outside any request, scoped to <paramref name="exerciseId"/>.</summary>
    public PulseDbContext Db(Guid? exerciseId)
    {
        var options = new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(ConnectionString).Options;
        return new PulseDbContext(options, new ExerciseContext { CurrentExerciseId = exerciseId });
    }

    /// <summary>
    /// Seeds an exercise (time zone Chicago, live) with a controller and an evaluator, and personas whose handles are
    /// <c>@{prefix}0</c>, <c>@{prefix}1</c>, ...
    /// </summary>
    public async Task<NoiseExercise> SeedExerciseAsync(int personas = 3)
    {
        var exerciseId = Guid.NewGuid();
        var controller = Guid.NewGuid();
        var evaluator = Guid.NewGuid();
        var prefix = $"n{exerciseId:N}"[..12];

        await using var db = Db(exerciseId);
        db.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = exerciseId,
            Name = "Fairhaven water",
            TimeZone = "America/Chicago",
            Status = "live",
        });

        foreach (var (id, role) in new[] { (controller, "controller"), (evaluator, "evaluator") })
        {
            db.StaffUsers.Add(StaffTenantSeed.StaffUserFor(id));
            db.Enrollments.Add(new Enrollment
            {
                Id = Guid.NewGuid(),
                PersonId = id,
                ExerciseId = exerciseId,
                Role = role,
                CreatedAt = DateTimeOffset.UtcNow,
            });
        }

        var personaIds = new List<Guid>();
        for (var index = 0; index < personas; index++)
        {
            var personaId = Guid.NewGuid();
            personaIds.Add(personaId);
            db.Personas.Add(new Persona
            {
                Id = personaId,
                ExerciseId = exerciseId,
                DisplayName = $"Resident {index}",
                Handle = $"@{prefix}{index}",
                Kind = "citizen",
            });
        }

        await db.SaveChangesAsync();
        return new NoiseExercise(exerciseId, controller, evaluator, personaIds, prefix);
    }

    /// <summary>Starts the exercise's scenario clock (as the reaction loop's first tick does).</summary>
    public void StartClock(NoiseExercise exercise) =>
        Clock.Start(exercise.ExerciseId, new DateTimeOffset(2026, 10, 20, 9, 0, 0, TimeSpan.FromHours(-5)), TimeZoneInfo.Utc);

    /// <summary>Sets the level directly on the row (as a persisted value surviving a restart would be).</summary>
    public async Task SetLevelInDbAsync(Guid exerciseId, string level)
    {
        await using var db = Db(exerciseId);
        var row = await db.Exercises.SingleAsync(e => e.Id == exerciseId);
        row.NoiseLevel = level;
        await db.SaveChangesAsync();
    }

    /// <summary>Sets the lifecycle status directly on the row (as EndEx or a lifecycle pause would).</summary>
    public async Task SetStatusInDbAsync(Guid exerciseId, string status)
    {
        await using var db = Db(exerciseId);
        var row = await db.Exercises.SingleAsync(e => e.Id == exerciseId);
        row.Status = status;
        await db.SaveChangesAsync();
    }

    /// <summary>Loads a pool straight into the table, one entry per persona round-robin.</summary>
    public async Task SeedPoolAsync(NoiseExercise exercise, int entries)
    {
        await using var db = Db(exercise.ExerciseId);
        for (var index = 0; index < entries; index++)
        {
            db.NoisePosts.Add(new NoisePost
            {
                Id = Guid.NewGuid(),
                ExerciseId = exercise.ExerciseId,
                PersonaId = exercise.PersonaIds[index % exercise.PersonaIds.Count],
                Text = $"Noise {index} for {exercise.Prefix}",
                Order = index,
                CreatedWallClock = DateTimeOffset.UtcNow,
            });
        }

        await db.SaveChangesAsync();
    }

    public async Task<List<Post>> NoisePostsAsync(Guid exerciseId)
    {
        await using var db = Db(exerciseId);
        return await db.Posts.AsNoTracking()
            .Where(p => p.Origin == NoiseRates.NoiseOrigin)
            .OrderBy(p => p.CreatedWallClock)
            .ToListAsync();
    }

    public async Task<List<NoisePost>> PoolAsync(Guid exerciseId)
    {
        await using var db = Db(exerciseId);
        return await db.NoisePosts.AsNoTracking().OrderBy(n => n.Order).ToListAsync();
    }

    public async Task<List<TelemetryEvent>> TelemetryAsync(Guid exerciseId, string eventType)
    {
        await using var db = Db(exerciseId);
        return await db.TelemetryEvents.AsNoTracking().Where(e => e.EventType == eventType).ToListAsync();
    }

    /// <summary>Advances the clock by <paramref name="seconds"/>, one pacer tick per second.</summary>
    public async Task<int> TickForAsync(int seconds)
    {
        var published = 0;
        for (var second = 0; second < seconds; second++)
        {
            Time.Advance(TimeSpan.FromSeconds(1));
            published += await Pacer.RunTickAsync();
        }

        return published;
    }

    // ---- HTTP helpers ----

    public Task<HttpResponseMessage> GetStateAsync() =>
        Client.GetAsync(new Uri(WhiteNoiseEndpoints.NoiseRoute, UriKind.Relative));

    public Task<HttpResponseMessage> PutLevelAsync(object body) =>
        Client.PutAsJsonAsync(new Uri(WhiteNoiseEndpoints.NoiseRoute, UriKind.Relative), body);

    public Task<HttpResponseMessage> PutPoolAsync(object body) =>
        Client.PutAsJsonAsync(new Uri(WhiteNoiseEndpoints.PoolRoute, UriKind.Relative), body);

    public async Task<WireNoiseState> ReadStateOkAsync(HttpResponseMessage response)
    {
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<WireNoiseState>())!;
    }

    public async ValueTask DisposeAsync()
    {
        Client.Dispose();
        await _app.DisposeAsync();
    }

    private sealed class CallerHolder
    {
        public Guid? ExerciseId { get; set; }

        public Guid? StaffUserId { get; set; }
    }
}

internal sealed record NoiseExercise(
    Guid ExerciseId,
    Guid ControllerId,
    Guid EvaluatorId,
    IReadOnlyList<Guid> PersonaIds,
    string Prefix);

internal sealed record WireNoiseState(
    string Level,
    int RatePerMinute,
    int PoolSize,
    int PostedCount,
    string? LastPostedAt,
    bool Running);

internal sealed record WirePoolResult(int PoolSize, List<WireRejection> Rejected);

internal sealed record WireRejection(int Index, string Reason);

/// <summary>Records every NoiseStateChanged push.</summary>
internal sealed class RecordingNoiseBroadcaster : INoiseBroadcaster
{
    private readonly List<(Guid ExerciseId, NoiseStateDto State)> _calls = [];
    private readonly Lock _gate = new();

    public IReadOnlyList<(Guid ExerciseId, NoiseStateDto State)> Calls
    {
        get
        {
            lock (_gate)
            {
                return _calls.ToList();
            }
        }
    }

    public Task BroadcastStateAsync(Guid exerciseId, NoiseStateDto state, CancellationToken cancellationToken = default)
    {
        lock (_gate)
        {
            _calls.Add((exerciseId, state));
        }

        return Task.CompletedTask;
    }
}
