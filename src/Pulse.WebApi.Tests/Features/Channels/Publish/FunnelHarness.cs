namespace Pulse.WebApi.Tests.Features.Channels.Publish;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;

/// <summary>
/// The publish funnel wired the way <c>AddChannels()</c> wires it, over the EF in-memory provider (Docker-free): two
/// exercises (A, the caller's, and B, another), an outlet in each, the native exercise clock on a manual wall clock, and
/// recording fakes for every seam. <see cref="In"/> opens a request-like scope resolved to one exercise.
/// </summary>
internal sealed class FunnelHarness : IDisposable
{
    public static readonly DateTimeOffset WallStart = new(2026, 10, 29, 14, 0, 0, TimeSpan.Zero);

    public static readonly DateTimeOffset ScenarioStart = new(2033, 9, 4, 8, 0, 0, TimeSpan.Zero);

    public static readonly ContentCaller Controller = new() { Origin = "controller", ActingHumanId = "human-ctl" };

    public static readonly ContentCaller Participant = new() { Origin = "participant", ActingHumanId = "human-ptc" };

    public static readonly ContentCaller Engine = new() { Origin = "engine", ActingHumanId = "human-authorizer" };

    private readonly ServiceProvider _root;

    private FunnelHarness(ServiceProvider root, ManualTimeProvider time, ExerciseClockService clock)
    {
        _root = root;
        Time = time;
        Clock = clock;
    }

    public Guid ExerciseId { get; } = Guid.NewGuid();

    public Guid OtherExerciseId { get; } = Guid.NewGuid();

    public static Guid OrganizationId { get; } = Guid.NewGuid();

    public Guid OutletId { get; private set; }

    public Guid PressOutletId { get; private set; }

    public Guid OtherOutletId { get; private set; }

    public ManualTimeProvider Time { get; }

    public ExerciseClockService Clock { get; }

    public RecordingBroadcaster Broadcaster { get; } = new();

    public RecordingObserver Observer { get; } = new();

    public TestKindDescriptor Article { get; } = new("article", "news", ISanitizerProfileRegistry.RichBasic);

    public TestKindDescriptor Release { get; } = new("release", "press", ISanitizerProfileRegistry.RichTables);

    public List<IContentPublishGate> Gates { get; } = [];

    public FakeAlertRaiser? AlertRaiser { get; set; }

    public FakePairedPoster? PairedPoster { get; set; }

    public FailingSaveInterceptor Saves { get; } = new();

    public static FunnelHarness Create(
        Action<IServiceCollection>? configure = null, bool withAlertRaiser = true, bool withPairedPoster = true)
    {
        var time = new ManualTimeProvider(WallStart);
        var clock = new ExerciseClockService(time);
        var services = new ServiceCollection();
        var dbName = Guid.NewGuid().ToString();
        FunnelHarness? harness = null;

        services.AddLogging();
        services.AddSingleton<TimeProvider>(time);
        services.AddSingleton<IExerciseClock>(clock);
        services.AddScoped<ExerciseContext>();
        services.AddScoped<IExerciseContext>(provider => provider.GetRequiredService<ExerciseContext>());
        services.AddScoped<IOrganizationContext>(_ => new OrganizationContext { CurrentOrganizationId = OrganizationId });
        services.AddDbContext<PulseDbContext>(options => options.UseInMemoryDatabase(dbName).AddInterceptors(harness!.Saves));
        services.AddSingleton<IFeedBroadcaster>(_ => harness!.Broadcaster);
        services.AddScoped<IContentKindDescriptor>(_ => harness!.Article);
        services.AddScoped<IContentKindDescriptor>(_ => harness!.Release);
        services.AddScoped<IContentPublishedObserver>(_ => harness!.Observer);
        services.AddScoped<IEnumerable<IContentPublishGate>>(_ => harness!.Gates.ToList());
        if (withAlertRaiser)
        {
            services.AddScoped<IAlertRaiser>(_ => harness!.AlertRaiser ??= new FakeAlertRaiser());
        }

        if (withPairedPoster)
        {
            services.AddScoped<IPairedSocialPoster>(_ => harness!.PairedPoster ??= new FakePairedPoster());
        }

        services.AddChannels();
        if (!withAlertRaiser)
        {
            // AddChannels() now registers the real alert source (story 10); "absent" means no raiser at all.
            services.RemoveAll<IAlertRaiser>();
        }

        configure?.Invoke(services);

        harness = new FunnelHarness(services.BuildServiceProvider(), time, clock);
        harness.Seed();
        return harness;
    }

    /// <summary>A scope resolved to <paramref name="exerciseId"/> (null = no scope resolved).</summary>
    public Scope In(Guid? exerciseId)
    {
        var scope = _root.CreateScope();
        scope.ServiceProvider.GetRequiredService<ExerciseContext>().CurrentExerciseId = exerciseId;
        return new Scope(scope);
    }

    public Scope InA() => In(ExerciseId);

    public ContentWriteRequest Request(string headline = "Bridge closed after overnight flooding", string kind = "article") => new()
    {
        Kind = kind,
        OutletId = (kind == "release" ? PressOutletId : OutletId).ToString(),
        Headline = headline,
        BodyHtml = "<p>The <strong>Route 9</strong> bridge is closed.</p>",
        Payload = new JsonObject { ["breaking"] = false },
    };

    public async Task<ChannelContentStaffDto> CreateAsync(ContentCaller? caller = null, ContentWriteRequest? request = null)
    {
        using var scope = InA();
        var result = await scope.Funnel.CreateDraftAsync(request ?? Request(), caller ?? Controller);
        if (result.Outcome != ContentPublishOutcome.Ok)
        {
            throw new InvalidOperationException($"Create failed: {result.Outcome} {string.Join("; ", result.Errors)}");
        }

        return result.Item!;
    }

    public async Task<ChannelContentStaffDto> CreatePublishedAsync(ContentCaller? caller = null)
    {
        var created = await CreateAsync(caller);
        using var scope = InA();
        var result = await scope.Funnel.PublishAsync(Guid.Parse(created.Id), null, Controller);
        if (result.Outcome != ContentPublishOutcome.Ok)
        {
            throw new InvalidOperationException($"Publish failed: {result.Outcome} {string.Join("; ", result.Errors)}");
        }

        return result.Item!;
    }

    public async Task<ContentItem> ItemAsync(string id)
    {
        using var scope = InA();
        return await scope.Db.IncludingSoftDeleted<ContentItem>().AsNoTracking().SingleAsync(item => item.Id == Guid.Parse(id));
    }

    public async Task<List<TelemetryEvent>> EventsAsync()
    {
        using var scope = InA();
        return await scope.Db.TelemetryEvents.AsNoTracking().OrderBy(e => e.EmittedAt).ToListAsync();
    }

    public async Task<List<ContentItemRevision>> RevisionsAsync(string id)
    {
        using var scope = InA();
        return await scope.Db.IncludingSoftDeleted<ContentItemRevision>().AsNoTracking()
            .Where(revision => revision.ContentItemId == Guid.Parse(id))
            .OrderBy(revision => revision.Number)
            .ToListAsync();
    }

    public void Dispose() => _root.Dispose();

    private void Seed()
    {
        using (var a = InA())
        {
            a.Db.Exercises.Add(new Exercise { Id = ExerciseId, OrganizationId = OrganizationId, Name = "Exercise A", TimeZone = "America/New_York" });
            var news = ChannelRows.Outlet(ExerciseId);
            var press = ChannelRows.Outlet(ExerciseId, slug: "wire-room", channelId: "press");
            OutletId = news.Id;
            PressOutletId = press.Id;
            a.Db.Outlets.AddRange(news, press);
            a.Db.SaveChanges();
        }

        using var b = In(OtherExerciseId);
        b.Db.Exercises.Add(new Exercise { Id = OtherExerciseId, OrganizationId = OrganizationId, Name = "Exercise B" });
        var other = ChannelRows.Outlet(OtherExerciseId);
        OtherOutletId = other.Id;
        b.Db.Outlets.Add(other);
        b.Db.SaveChanges();
    }

    internal sealed class Scope : IDisposable
    {
        private readonly IServiceScope _scope;

        public Scope(IServiceScope scope) => _scope = scope;

        public IContentPublishService Funnel => _scope.ServiceProvider.GetRequiredService<IContentPublishService>();

        public PulseDbContext Db => _scope.ServiceProvider.GetRequiredService<PulseDbContext>();

        public IServiceProvider Services => _scope.ServiceProvider;

        public void Dispose() => _scope.Dispose();
    }
}

/// <summary>A kind descriptor whose payload rule, derived options and last validation context are observable.</summary>
internal sealed class TestKindDescriptor : IContentKindDescriptor
{
    public TestKindDescriptor(string kind, string channelId, string bodyPolicy)
    {
        Kind = kind;
        ChannelId = channelId;
        BodyPolicy = bodyPolicy;
    }

    public string Kind { get; }

    public string ChannelId { get; }

    public string BodyPolicy { get; set; }

    public IReadOnlySet<string> AllowedMediaKinds { get; set; } = new HashSet<string> { "image", "video" };

    /// <summary>A suggestion that must NEVER be raised by the funnel (FC-7a).</summary>
    public PublishAlertOptions? DefaultAlertMapping { get; } = new() { Severity = "emergency", Headline = "DEFAULT MAPPING" };

    public Func<ContentItem, PublishOptions?>? Derive { get; set; }

    public PayloadValidationContext? LastContext { get; private set; }

    public Task<PayloadValidationResult> ValidatePayloadAsync(
        JsonObject payload, PayloadValidationContext context, CancellationToken cancellationToken = default)
    {
        LastContext = context;
        return Task.FromResult(payload["invalid"] is not null
            ? PayloadValidationResult.Invalid("payload.invalid must not be set.")
            : PayloadValidationResult.Valid);
    }

    public JsonObject ProjectPayload(JsonObject payload) => payload;

    public PublishOptions? ResolvePublishOptions(ContentItem item) => Derive?.Invoke(item);
}

internal sealed class RecordingBroadcaster : IFeedBroadcaster
{
    public List<ChannelContentSummaryDto> Published { get; } = [];

    public List<ContentRevisedDto> Revised { get; } = [];

    public List<ContentRetractedDto> Retracted { get; } = [];

    public List<Guid> Exercises { get; } = [];

    public bool Throw { get; set; }

    public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    public Task BroadcastContentPublishedAsync(Guid exerciseId, ChannelContentSummaryDto content, CancellationToken cancellationToken = default)
    {
        Exercises.Add(exerciseId);
        Published.Add(content);
        return Throw ? throw new InvalidOperationException("hub down") : Task.CompletedTask;
    }

    public Task BroadcastContentRevisedAsync(Guid exerciseId, ContentRevisedDto revised, CancellationToken cancellationToken = default)
    {
        Exercises.Add(exerciseId);
        Revised.Add(revised);
        return Throw ? throw new InvalidOperationException("hub down") : Task.CompletedTask;
    }

    public Task BroadcastContentRetractedAsync(Guid exerciseId, ContentRetractedDto retracted, CancellationToken cancellationToken = default)
    {
        Exercises.Add(exerciseId);
        Retracted.Add(retracted);
        return Throw ? throw new InvalidOperationException("hub down") : Task.CompletedTask;
    }
}

/// <summary>Records only the PUBLISHED callback, so revise/retract go through the interface's default members.</summary>
internal sealed class DefaultOnlyObserver : IContentPublishedObserver
{
    public int Published { get; private set; }

    public Task OnPublishedAsync(ContentItem item, CancellationToken cancellationToken = default)
    {
        Published++;
        return Task.CompletedTask;
    }
}

internal sealed class RecordingObserver : IContentPublishedObserver
{
    public List<(string Event, Guid Id, string Status)> Calls { get; } = [];

    public bool Throw { get; set; }

    public Task OnPublishedAsync(ContentItem item, CancellationToken cancellationToken = default) => Record("published", item);

    public Task OnRevisedAsync(ContentItem item, CancellationToken cancellationToken = default) => Record("revised", item);

    public Task OnRetractedAsync(ContentItem item, CancellationToken cancellationToken = default) => Record("retracted", item);

    private Task Record(string name, ContentItem item)
    {
        Calls.Add((name, item.Id, item.Status));
        return Throw ? throw new InvalidOperationException("observer broke") : Task.CompletedTask;
    }
}

internal sealed class FakeAlertRaiser : IAlertRaiser
{
    public List<(AlertRaise Raise, ContentCaller Caller)> Raised { get; } = [];

    public bool Throw { get; set; }

    public Task<AlertDto> RaiseAsync(AlertRaise raise, ContentCaller caller, CancellationToken cancellationToken = default)
    {
        if (Throw)
        {
            throw new InvalidOperationException("alert store down");
        }

        Raised.Add((raise, caller));
        return Task.FromResult(new AlertDto
        {
            Id = Guid.NewGuid().ToString(),
            Severity = raise.Severity,
            Message = raise.Headline,
            ScenarioTime = "2033-09-04T08:00:00.0000000+00:00",
        });
    }

    public Task<bool> ClearAsync(Guid id, ContentCaller caller, CancellationToken cancellationToken = default) => Task.FromResult(false);
}

internal sealed class FakePairedPoster : IPairedSocialPoster
{
    public List<(Guid ItemId, string? Text, ContentCaller Caller)> Posts { get; } = [];

    public Guid? Returns { get; set; } = Guid.NewGuid();

    public Action? OnPost { get; set; }

    public Task<Guid?> PostLinkCardAsync(ContentItem item, string? text, ContentCaller caller, CancellationToken cancellationToken = default)
    {
        Posts.Add((item.Id, text, caller));
        OnPost?.Invoke();
        return Task.FromResult(Returns);
    }
}

/// <summary>Fails the next SaveChanges once armed (to drive the funnel's post-commit failure paths).</summary>
internal sealed class FailingSaveInterceptor : Microsoft.EntityFrameworkCore.Diagnostics.SaveChangesInterceptor
{
    public bool FailNext { get; set; }

    public override ValueTask<Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<int>> SavingChangesAsync(
        Microsoft.EntityFrameworkCore.Diagnostics.DbContextEventData eventData,
        Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        if (FailNext)
        {
            FailNext = false;
            throw new InvalidOperationException("save failed");
        }

        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }
}

/// <summary>A gate with a fixed decision, optionally blocking until released (to stage a race).</summary>
internal sealed class TestGate : IContentPublishGate
{
    private readonly ContentPublishGateDecision _decision;

    public TestGate(ContentPublishGateDecision decision) => _decision = decision;

    public List<PublishContext> Seen { get; } = [];

    public TaskCompletionSource? Entered { get; set; }

    public TaskCompletionSource? Release { get; set; }

    public async Task<ContentPublishGateDecision> EvaluateAsync(
        ContentItem item, PublishContext context, CancellationToken cancellationToken = default)
    {
        Seen.Add(context);
        Entered?.TrySetResult();
        if (Release is not null)
        {
            await Release.Task;
        }

        return _decision;
    }
}
