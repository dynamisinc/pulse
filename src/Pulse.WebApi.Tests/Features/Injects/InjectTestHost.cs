namespace Pulse.WebApi.Tests.Features.Injects;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
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
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Injects;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Pulse.WebApi.Tests.Features.Social;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// A minimal TestServer host wired the way <c>Program.cs</c> wires the inject slice — persistence + exercise scoping,
/// the exercise clock, the pause tiers, the REAL post funnel (<c>AddSocialPostWrite</c>), and <c>AddInjects()</c> +
/// <c>MapInjects()</c> behind the SHIPPED staff/controller filters — against the shared real-SQL database. Only the
/// edges are doubled: the caller's identity and scope (switchable per call), the wall clock (hand-advanced), the burst
/// jitter (pinned), the broadcaster and a post observer (recording). The hosted runner is replaced by a directly
/// callable instance so pacing is driven tick by tick, never by sleeping.
/// </summary>
internal sealed class InjectTestHost : IAsyncDisposable
{
    private readonly WebApplication _app;
    private readonly CallerHolder _caller;

    private InjectTestHost(WebApplication app, CallerHolder caller, ManualTimeProvider time, string connectionString)
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

    /// <summary>
    /// How far the manual clock moves before each helper request, so successive actions get distinct, ordered
    /// wall-clock stamps. Pacing tests set it to zero and move the clock themselves.
    /// </summary>
    public TimeSpan StepPerRequest { get; set; } = TimeSpan.FromMilliseconds(10);

    public string ConnectionString { get; }

    public FakeFeedBroadcaster Broadcaster => _app.Services.GetRequiredService<FakeFeedBroadcaster>();

    public RecordingPostObserver Observer => _app.Services.GetRequiredService<RecordingPostObserver>();

    public PauseTierRegistry PauseTiers => _app.Services.GetRequiredService<PauseTierRegistry>();

    public IExerciseClock Clock => _app.Services.GetRequiredService<IExerciseClock>();

    public InjectBurstRunner Runner => _app.Services.GetRequiredService<InjectBurstRunner>();

    /// <summary>Makes every following request (and service resolution) act as this staff user in this exercise.</summary>
    public void ActAs(Guid? exerciseId, Guid? staffUserId)
    {
        _caller.ExerciseId = exerciseId;
        _caller.StaffUserId = staffUserId;
    }

    public static async Task<InjectTestHost> StartAsync(
        string connectionString,
        IBurstJitterSource? jitter = null,
        Func<IServiceProvider, IInjectPostPublisher>? publisher = null,
        IFeedBroadcaster? broadcaster = null)
    {
        var caller = new CallerHolder();
        var time = new ManualTimeProvider(DateTimeOffset.UtcNow);

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Configuration["ConnectionStrings:DefaultConnection"] = connectionString;

        builder.Services.AddPulsePersistence(builder.Configuration);
        builder.Services.AddExerciseScoping();
        builder.Services.AddExerciseClock();
        builder.Services.AddPauseTierSteering();
        builder.Services.AddSocialPostWrite();

        var recordingBroadcaster = new FakeFeedBroadcaster();
        builder.Services.AddSingleton(recordingBroadcaster);
        builder.Services.AddScoped<IFeedBroadcaster>(_ => broadcaster ?? recordingBroadcaster);
        builder.Services.AddSingleton<RecordingPostObserver>();
        builder.Services.AddSingleton<IPostPublishedObserver>(sp => sp.GetRequiredService<RecordingPostObserver>());

        builder.Services.AddInjects();

        // Drive pacing by hand: drop the hosted loop, keep a directly callable runner over the same services.
        var hosted = builder.Services
            .Where(d => d.ServiceType == typeof(IHostedService) && d.ImplementationType == typeof(InjectBurstRunner))
            .ToList();
        hosted.Should().ContainSingle("AddInjects() must register the runner as a hosted service");
        builder.Services.Remove(hosted[0]);
        builder.Services.AddSingleton<InjectBurstRunner>();

        builder.Services.RemoveAll<TimeProvider>();
        builder.Services.AddSingleton<TimeProvider>(time);
        builder.Services.RemoveAll<IBurstJitterSource>();
        builder.Services.AddSingleton(jitter ?? new FixedJitterSource());

        if (publisher is not null)
        {
            builder.Services.RemoveAll<IInjectPostPublisher>();
            builder.Services.AddScoped(publisher);
        }

        // The shipped staff gate resolves StaffAssignmentService over the real rows this host seeds.
        builder.Services.AddScoped<StaffAssignmentService>();
        builder.Services.RemoveAll<ICurrentStaffSessionAccessor>();
        builder.Services.AddScoped<ICurrentStaffSessionAccessor>(_ => new StubCurrentStaffSessionAccessor(
            caller.StaffUserId is { } staff
                ? new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = staff }
                : null));

        // A fresh, SETTABLE ExerciseContext per scope (the runner sets its own), seeded from the acting caller.
        builder.Services.RemoveAll<IExerciseContext>();
        builder.Services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = caller.ExerciseId });

        var app = builder.Build();
        app.MapInjects();
        await app.StartAsync();

        return new InjectTestHost(app, caller, time, connectionString);
    }

    /// <summary>A context outside any request, scoped to <paramref name="exerciseId"/> (null = unscoped).</summary>
    public PulseDbContext Db(Guid? exerciseId)
    {
        var options = new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(ConnectionString).Options;
        return new PulseDbContext(options, new ExerciseContext { CurrentExerciseId = exerciseId });
    }

    /// <summary>Seeds an exercise with one assigned staff user (role <paramref name="role"/>) and personas.</summary>
    public async Task<SeededExercise> SeedExerciseAsync(string role = "controller", int personas = 3, string timeZone = "America/Chicago")
    {
        var exerciseId = Guid.NewGuid();
        var staffUserId = Guid.NewGuid();
        await using (var db = Db(exerciseId))
        {
            db.Exercises.Add(new Exercise
            {
                OrganizationId = Organization.DefaultOrganizationId,
                Id = exerciseId,
                Name = "Fairhaven water",
                TimeZone = timeZone,
                Status = "live",
            });
            var staff = StaffTenantSeed.StaffUserFor(staffUserId);
            staff.DisplayName = "Casey Controller";
            db.StaffUsers.Add(staff);
            db.StaffAssignments.Add(new StaffAssignment
            {
                Id = Guid.NewGuid(),
                StaffUserId = staffUserId,
                ExerciseId = exerciseId,
                Role = role,
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var personaIds = new List<Guid>();
        for (var index = 0; index < personas; index++)
        {
            personaIds.Add(await AddPersonaAsync(exerciseId));
        }

        return new SeededExercise(exerciseId, staffUserId, personaIds);
    }

    /// <summary>Assigns another staff user to the exercise.</summary>
    public async Task<Guid> AddStaffAsync(Guid exerciseId, string role, string displayName)
    {
        var staffUserId = Guid.NewGuid();
        await using var db = Db(exerciseId);
        var staff = StaffTenantSeed.StaffUserFor(staffUserId);
        staff.DisplayName = displayName;
        db.StaffUsers.Add(staff);
        db.StaffAssignments.Add(new StaffAssignment
        {
            Id = Guid.NewGuid(),
            StaffUserId = staffUserId,
            ExerciseId = exerciseId,
            Role = role,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
        return staffUserId;
    }

    public async Task<Guid> AddPersonaAsync(Guid exerciseId)
    {
        var id = Guid.NewGuid();
        await using var db = Db(exerciseId);
        db.Personas.Add(new Persona
        {
            Id = id,
            ExerciseId = exerciseId,
            DisplayName = "Fairhaven Resident",
            Handle = $"@resident_{id:N}",
            Kind = "citizen",
        });
        await db.SaveChangesAsync();
        return id;
    }

    // ---- HTTP helpers ----

    public async Task<HttpResponseMessage> CreateAsync(object body)
    {
        Time.Advance(StepPerRequest);
        return await Client.PostAsJsonAsync(new Uri("/api/injects", UriKind.Relative), body);
    }

    public Task<HttpResponseMessage> PutAsync(string itemId, object body)
    {
        Time.Advance(StepPerRequest);
        return Client.PutAsJsonAsync(new Uri($"/api/injects/{itemId}", UriKind.Relative), body);
    }

    public Task<HttpResponseMessage> DeleteAsync(string itemId, int? version)
    {
        Time.Advance(StepPerRequest);
        var query = version is null ? string.Empty : $"?version={version}";
        return Client.DeleteAsync(new Uri($"/api/injects/{itemId}{query}", UriKind.Relative));
    }

    public async Task<WireItem> CreateOkAsync(object body)
    {
        var response = await CreateAsync(body);
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
        return (await ReadItemAsync(response))!;
    }

    public Task<HttpResponseMessage> ActionAsync(Guid itemId, string action)
    {
        Time.Advance(StepPerRequest);
        return Client.PostAsync(new Uri($"/api/injects/{itemId}/{action}", UriKind.Relative), content: null);
    }

    public async Task<WireItem> ActionOkAsync(Guid itemId, string action)
    {
        var response = await ActionAsync(itemId, action);
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        return (await ReadItemAsync(response))!;
    }

    public async Task<WireQueue> GetQueueAsync()
    {
        var response = await Client.GetAsync(new Uri("/api/injects", UriKind.Relative));
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<WireQueue>())!;
    }

    public static async Task<WireItem?> ReadItemAsync(HttpResponseMessage response) =>
        await response.Content.ReadFromJsonAsync<WireItem>();

    public static async Task<WireProblem> ReadProblemAsync(HttpResponseMessage response)
    {
        var json = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        WireItem? item = null;
        if (root.TryGetProperty("item", out var itemElement))
        {
            item = itemElement.Deserialize<WireItem>(new JsonSerializerOptions(JsonSerializerDefaults.Web));
        }

        return new WireProblem(
            root.GetProperty("status").GetInt32(),
            root.TryGetProperty("detail", out var detail) ? detail.GetString() : null,
            item);
    }

    // ---- request builders ----

    public static object PostItem(Guid personaId, string text = "The water from my tap is BROWN #WaterIssues", object? replyTo = null) => new
    {
        kind = "post",
        title = "Beat 3 photo",
        plannedMinute = 12,
        posts = new[] { new { personaId = personaId.ToString(), text, replyTo } },
    };

    public static object BurstItem(IReadOnlyList<Guid> personaIds, int count = 3, int window = 90) => new
    {
        kind = "burst",
        title = "Pile-on",
        burstWindowSeconds = window,
        posts = Enumerable.Range(0, count)
            .Select(index => new { personaId = personaIds[index % personaIds.Count].ToString(), text = $"pile-on {index + 1} #WaterIssues" })
            .ToArray(),
    };

    public async ValueTask DisposeAsync()
    {
        Client.Dispose();
        await _app.DisposeAsync();
    }

    /// <summary>The identity every request acts as — switchable between calls.</summary>
    private sealed class CallerHolder
    {
        public Guid? ExerciseId { get; set; }

        public Guid? StaffUserId { get; set; }
    }
}

internal sealed record SeededExercise(Guid ExerciseId, Guid StaffUserId, IReadOnlyList<Guid> PersonaIds);

internal sealed record WireQueue(List<WireItem> Items, string PauseTier);

internal sealed record WireItem(
    string Id,
    string Kind,
    string Title,
    string? Notes,
    int? PlannedMinute,
    string? AssigneeId,
    int? BurstWindowSeconds,
    int Order,
    string Status,
    string? AssigneeName,
    List<WirePost> Posts,
    int FiredCount,
    int Total,
    int Version,
    string CreatedByHumanId,
    string UpdatedAt,
    string? FiredByHumanId,
    string? FiredScenarioTime,
    string? Error)
{
    public Guid Guid => System.Guid.Parse(Id);
}

internal sealed record WirePost(
    string Id,
    int Sequence,
    string Status,
    string PersonaId,
    string Text,
    int? DueOffsetSeconds,
    string? FiredPostId,
    string? FiredScenarioTime,
    string? FiredWallClock,
    string? FiredByHumanId,
    string? Error);

internal sealed record WireProblem(int Status, string? Detail, WireItem? Item);

/// <summary>Records every committed post the funnel announces.</summary>
internal sealed class RecordingPostObserver : IPostPublishedObserver
{
    private readonly List<(Guid ExerciseId, Post Post)> _calls = [];
    private readonly Lock _gate = new();

    public IReadOnlyList<(Guid ExerciseId, Post Post)> Calls
    {
        get
        {
            lock (_gate)
            {
                return _calls.ToList();
            }
        }
    }

    public void OnPostPublished(Guid exerciseId, Post post)
    {
        lock (_gate)
        {
            _calls.Add((exerciseId, post));
        }
    }
}

/// <summary>A publisher that refuses every post, as the funnel will for bad media or an unresolvable parent.</summary>
internal sealed class RefusingPublisher : IInjectPostPublisher
{
    public const string Reason = "mediaId 'beat3-photo' does not name a media item in this exercise.";

    public Task<PostIngestResult> PublishAsync(CreatePostRequest request, PostAttribution attribution, CancellationToken cancellationToken = default) =>
        Task.FromResult(PostIngestResult.Invalid(Reason));
}

/// <summary>The real funnel publisher that can be told to refuse — for a refuse-then-retry sequence.</summary>
internal sealed class ToggleablePublisher : IInjectPostPublisher
{
    private readonly PublisherToggle _toggle;
    private readonly FunnelInjectPostPublisher _funnel;

    public ToggleablePublisher(PublisherToggle toggle, PostIngestService ingest)
    {
        _toggle = toggle;
        _funnel = new FunnelInjectPostPublisher(ingest);
    }

    public Task<PostIngestResult> PublishAsync(CreatePostRequest request, PostAttribution attribution, CancellationToken cancellationToken = default) =>
        _toggle.Refuse
            ? Task.FromResult(PostIngestResult.Invalid(RefusingPublisher.Reason))
            : _funnel.PublishAsync(request, attribution, cancellationToken);
}

/// <summary>The shared switch for <see cref="ToggleablePublisher"/>.</summary>
internal sealed class PublisherToggle
{
    public bool Refuse { get; set; }
}

/// <summary>A publisher that throws before anything is written.</summary>
internal sealed class ThrowingPublisher : IInjectPostPublisher
{
    public Task<PostIngestResult> PublishAsync(CreatePostRequest request, PostAttribution attribution, CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException("database unreachable");
}

/// <summary>A broadcaster that throws AFTER the funnel committed the post (the broadcast is the funnel's last step).</summary>
internal sealed class ThrowingBroadcaster : IFeedBroadcaster
{
    public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException("SignalR unavailable");
}
