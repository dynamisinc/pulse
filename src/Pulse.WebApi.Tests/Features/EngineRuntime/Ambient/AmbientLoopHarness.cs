namespace Pulse.WebApi.Tests.Features.EngineRuntime.Ambient;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pulse.Core.Features.Ambient.Models;
using Pulse.Core.Features.Autonomy.Services;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;
using Pulse.Core.Features.Storylines.Models;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Publishing;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;

/// <summary>
/// A Docker-free harness for the ambient branch of the reaction loop (ambient-chatter story 01): the REAL
/// <see cref="ReactionLoopDriver"/>, <see cref="GenerateStage"/> (with the content guard), interim lifecycle gate,
/// registries and pause tiers, over an EF in-memory <see cref="PulseDbContext"/> (only telemetry, review items and the
/// exercise row live there), with a scripted provider and a recording publish funnel. The real-SQL publish path is
/// covered separately by the Docker-gated suite.
/// </summary>
internal sealed class AmbientLoopHarness : IAsyncDisposable
{
    public static readonly DateTimeOffset ScenarioStart = new(2033, 6, 1, 9, 0, 0, TimeSpan.Zero);

    private readonly ServiceProvider _services;

    private AmbientLoopHarness(ServiceProvider services, Guid exerciseId, ReactionLoopRegistration registration)
    {
        _services = services;
        ExerciseId = exerciseId;
        Registration = registration;
    }

    public Guid ExerciseId { get; }

    public ReactionLoopRegistration Registration { get; }

    public IServiceProvider Services => _services;

    public ScriptedGenerationProvider Provider => _services.GetRequiredService<ScriptedGenerationProvider>();

    public RecordingPublishService Publisher => _services.GetRequiredService<RecordingPublishService>();

    public EngineAmbientPolicyRegistry Ambient => _services.GetRequiredService<EngineAmbientPolicyRegistry>();

    public EngineAutonomyRegistry Autonomy => _services.GetRequiredService<EngineAutonomyRegistry>();

    public IGenerationProviderCutRegistry Cut => _services.GetRequiredService<IGenerationProviderCutRegistry>();

    public PauseTierRegistry PauseTiers => _services.GetRequiredService<PauseTierRegistry>();

    public IExerciseClock Clock => _services.GetRequiredService<IExerciseClock>();

    public ManualTimeProvider Time => (ManualTimeProvider)_services.GetRequiredService<TimeProvider>();

    /// <summary>The handles of the two allow-listed cast members.</summary>
    public static IReadOnlyList<string> Handles { get; } = ["@rosa", "@marcus"];

    public static async Task<AmbientLoopHarness> CreateAsync(
        bool autonomyAuthorized = true,
        string status = "live",
        TimeProvider? timeProvider = null,
        Action<IServiceCollection>? configure = null)
    {
        var exerciseId = Guid.NewGuid();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(timeProvider ?? new ManualTimeProvider(ScenarioStart));
        services.AddScoped<IExerciseContext, ExerciseContext>();

        var dbName = $"ambient-{Guid.NewGuid():N}";
        services.AddDbContext<PulseDbContext>(o => o.UseInMemoryDatabase(dbName));

        var provider = new ScriptedGenerationProvider();
        services.AddSingleton(provider);
        services.AddSingleton(new GenerateStage(provider, new PromptAssembler()));
        services.AddSingleton<IGenerationProviderCutRegistry>(new GenerationProviderCutRegistry());
        services.AddSingleton(new EngineAutonomyRegistry());
        services.AddSingleton(new EngineAmbientPolicyRegistry(
            Options.Create(new EngineAmbientGovernanceOptions { AmbientAutonomyAuthorized = autonomyAuthorized })));

        var publisher = new RecordingPublishService();
        services.AddSingleton(publisher);
        services.AddSingleton<IEnginePublishService>(publisher);
        services.AddSingleton<IEngineReviewBroadcaster>(new RecordingReviewBroadcaster());

        services.AddExerciseClock();
        services.AddEngineRuntimeSeams();
        services.AddReactionLoopHost();
        services.AddSingleton(sp => new PauseTierRegistry(
            sp.GetRequiredService<IExerciseClock>(), new NullPauseOverlayPublisher(), NullLogger<PauseTierRegistry>.Instance));

        configure?.Invoke(services);

        var built = services.BuildServiceProvider();

        await using (var scope = built.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<PulseDbContext>();
            db.Exercises.Add(new Exercise
            {
                OrganizationId = Organization.DefaultOrganizationId,
                Id = exerciseId,
                Name = "Ambient harness",
                TimeZone = "UTC",
                Status = status,
            });
            await db.SaveChangesAsync();
        }

        var clock = built.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);

        var cast = Handles.ToDictionary(
            handle => handle,
            handle => new EnginePersona(
                Guid.NewGuid(),
                new PersonaDossier { Handle = handle, DisplayName = handle.TrimStart('@'), Type = PersonaType.Resident }),
            StringComparer.OrdinalIgnoreCase);

        var registration = new ReactionLoopRegistration
        {
            ExerciseId = exerciseId,
            ExerciseBrief = "The fictional town of Cedar Falls on an ordinary weekday.",
            TimeZone = "UTC",
            ScenarioStart = ScenarioStart,
            TimeZoneInfo = TimeZoneInfo.Utc,
            Storylines = [],
            PersonasByHandle = cast,
            Autonomy = built.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(exerciseId),
            ControllerDeskId = Guid.NewGuid(),
        };

        return new AmbientLoopHarness(built, exerciseId, registration);
    }

    /// <summary>A policy allow-listing both cast members and two topics.</summary>
    public AmbientTierPolicy Policy(AmbientPolicyMode mode, int perMinute = 10, int perHour = 100) => new()
    {
        Mode = mode,
        MaxPerMinute = perMinute,
        MaxPerHour = perHour,
        TopicAllowList = [AmbientTopics.Food, AmbientTopics.Sports],
        PersonaAllowList = Registration.PersonasByHandle.Values.Select(p => p.InstanceId).ToList(),
        SetBy = "controller-7",
    };

    public void SetPolicy(AmbientPolicyMode mode, int perMinute = 10, int perHour = 100) =>
        Ambient.Set(ExerciseId, Policy(mode, perMinute, perHour));

    public async Task<ReactionTickResult> TickAsync(ReactionLoopRegistration? registration = null)
    {
        var target = registration ?? Registration;
        var driver = _services.GetRequiredService<ReactionLoopDriver>();
        await using var scope = _services.CreateAsyncScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = target.ExerciseId;
        return await driver.RunTickAsync(target, scope.ServiceProvider);
    }

    public async Task SetStatusAsync(string status)
    {
        await using var scope = _services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<PulseDbContext>();
        var row = await db.Exercises.SingleAsync(e => e.Id == ExerciseId);
        row.Status = status;
        await db.SaveChangesAsync();
    }

    /// <summary>All telemetry for the exercise, in insertion order.</summary>
    public async Task<List<TelemetryEvent>> EventsAsync()
    {
        await using var scope = _services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<PulseDbContext>();
        return await db.TelemetryEvents.IgnoreQueryFilters().Where(e => e.ExerciseId == ExerciseId).ToListAsync();
    }

    public async Task<List<JsonElement>> PayloadsAsync(string eventType) =>
        (await EventsAsync())
            .Where(e => e.EventType == eventType)
            .Select(e => JsonDocument.Parse(e.Payload!).RootElement.Clone())
            .ToList();

    public async Task<List<EngineReviewItemEntity>> ReviewItemsAsync()
    {
        await using var scope = _services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<PulseDbContext>();
        return await db.EngineReviewItems.IgnoreQueryFilters().Where(i => i.ExerciseId == ExerciseId).ToListAsync();
    }

    public ValueTask DisposeAsync() => _services.DisposeAsync();
}

/// <summary>A provider whose burst and side effect (run DURING generation, i.e. "in flight") a test scripts.</summary>
internal sealed class ScriptedGenerationProvider : IGenerationProvider
{
    public static readonly IReadOnlyList<GeneratedPost> CleanBurst =
    [
        new("@gen0", "finally tried the new taco truck on 5th street, the carnitas are worth the line", 0.6, []),
        new("@gen1", "varsity soccer pulled off a late equalizer tonight, what a finish for the seniors", 0.5, []),
    ];

    public IReadOnlyList<GeneratedPost> Posts { get; set; } = CleanBurst;

    /// <summary>Runs inside every generation call, before it returns (a switch flipped while a burst is in flight).</summary>
    public Action? DuringGenerate { get; set; }

    public int Calls { get; private set; }

    public string Name => "Stub";

    public GenerationGovernance Governance => GenerationGovernance.InProcess;

    public Task<GenerationResult> GenerateAsync(GenerationRequest request, CancellationToken cancellationToken = default)
    {
        Calls++;
        LastRequest = request;
        DuringGenerate?.Invoke();
        return Task.FromResult(new GenerationResult(
            Posts: Posts,
            Usage: new GenerationUsage(InputTokens: 40, OutputTokens: 20),
            Latency: TimeSpan.FromMilliseconds(5),
            ProviderName: Name,
            Model: "stub-ambient"));
    }

    public GenerationRequest? LastRequest { get; private set; }
}

/// <summary>A publish funnel that records each burst (with the wall time) and can flip a switch after each publish.</summary>
internal sealed class RecordingPublishService : IEnginePublishService
{
    private readonly List<(EngineBurst Burst, DateTimeOffset At)> _published = [];

    public IReadOnlyList<EngineBurst> Published
    {
        get
        {
            lock (_published)
            {
                return _published.Select(p => p.Burst).ToList();
            }
        }
    }

    public IReadOnlyList<DateTimeOffset> PublishedAt
    {
        get
        {
            lock (_published)
            {
                return _published.Select(p => p.At).ToList();
            }
        }
    }

    public Action<EngineBurst>? AfterPublish { get; set; }

    public Task<EngineBurstPublishResult> PublishBurstAsync(EngineBurst burst, CancellationToken cancellationToken = default)
    {
        lock (_published)
        {
            _published.Add((burst, DateTimeOffset.UtcNow));
        }

        AfterPublish?.Invoke(burst);
        return Task.FromResult(new EngineBurstPublishResult
        {
            Posts = burst.Posts
                .Select(p => new EnginePublishedPost { PersonaHandle = p.PersonaHandle, PostId = Guid.NewGuid(), Outcome = EnginePublishOutcome.Published })
                .ToList(),
        });
    }
}
