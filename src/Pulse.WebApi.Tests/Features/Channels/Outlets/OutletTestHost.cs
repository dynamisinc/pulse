namespace Pulse.WebApi.Tests.Features.Channels.Outlets;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.Channels;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Pulse.WebApi.Tests.Features.Social;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// A minimal TestServer host wired the way <c>Program.cs</c> wires the outlet registry: persistence + exercise scoping,
/// the exercise clock, <c>AddExerciseConfiguration()</c> (the channel gate's projection), <c>AddChannels()</c> +
/// <c>MapChannels()</c> behind the SHIPPED staff/controller filters, against the shared real-SQL database. Only the edges
/// are doubled: the caller's identity and scope (switchable per call), the wall clock, and the media URL signer (BP's
/// deterministic, scope-checking stand-in). A save recorder lists what each <c>SaveChanges</c> wrote, so tests can prove
/// a change and its telemetry event share one unit of work.
/// </summary>
internal sealed class OutletTestHost : IAsyncDisposable
{
    private static readonly TimeSpan Step = TimeSpan.FromMilliseconds(10);

    private readonly WebApplication _app;
    private readonly CallerHolder _caller;

    private OutletTestHost(WebApplication app, CallerHolder caller, string connectionString, SaveRecorder saves, ManualTimeProvider time)
    {
        _app = app;
        Time = time;
        _caller = caller;
        ConnectionString = connectionString;
        Saves = saves;
        Client = app.GetTestClient();
    }

    public HttpClient Client { get; }

    /// <summary>The server wall clock; every HTTP helper advances it 10 ms so successive actions are ordered.</summary>
    public ManualTimeProvider Time { get; }

    public IServiceProvider Services => _app.Services;

    public string ConnectionString { get; }

    /// <summary>Every <c>SaveChanges</c> the host's contexts ran, with the entity types each added/modified/deleted.</summary>
    public SaveRecorder Saves { get; }

    /// <summary>Makes every following request act in <paramref name="exerciseId"/> as <paramref name="staffUserId"/> (null = no staff session).</summary>
    public void ActAs(Guid? exerciseId, Guid? staffUserId)
    {
        _caller.ExerciseId = exerciseId;
        _caller.StaffUserId = staffUserId;
    }

    public static async Task<OutletTestHost> StartAsync(string connectionString, Action<IServiceCollection>? configureServices = null)
    {
        var caller = new CallerHolder();
        var saves = new SaveRecorder();

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();

        // Any IInterceptor a test registers (e.g. ConcurrentSlugWriter) joins the save recorder on every context.
        builder.Services.AddDbContext<PulseDbContext>((sp, options) =>
            options.UseSqlServer(connectionString).AddInterceptors(saves).AddInterceptors(sp.GetServices<IInterceptor>()));
        builder.Services.AddExerciseScoping();
        builder.Services.AddExerciseClock();
        builder.Services.AddExerciseConfiguration();
        builder.Services.AddChannels();

        builder.Services.RemoveAll<TimeProvider>();
        var time = new ManualTimeProvider(DateTimeOffset.UtcNow);
        builder.Services.AddSingleton<TimeProvider>(time);
        builder.Services.AddSingleton<SignerProbe>();
        builder.Services.AddScoped<IMediaUrlSigner>(sp =>
            new FakeMediaUrlSigner(sp.GetRequiredService<IExerciseContext>(), sp.GetRequiredService<SignerProbe>()));

        // The shipped staff gate resolves StaffAssignmentService over the real rows this host seeds.
        builder.Services.AddScoped<StaffAssignmentService>();
        builder.Services.RemoveAll<ICurrentStaffSessionAccessor>();
        builder.Services.AddScoped<ICurrentStaffSessionAccessor>(_ => new StubCurrentStaffSessionAccessor(
            caller.StaffUserId is { } staff
                ? new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = staff }
                : null));
        builder.Services.RemoveAll<IExerciseContext>();
        builder.Services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = caller.ExerciseId });

        configureServices?.Invoke(builder.Services);

        var app = builder.Build();
        app.MapChannels();
        await app.StartAsync();

        return new OutletTestHost(app, caller, connectionString, saves, time);
    }

    /// <summary>A context outside any request, scoped to <paramref name="exerciseId"/> (null = unscoped).</summary>
    public PulseDbContext Db(Guid? exerciseId)
    {
        var options = new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(ConnectionString).Options;
        return new PulseDbContext(options, new ExerciseContext { CurrentExerciseId = exerciseId });
    }

    /// <summary>
    /// Seeds an exercise (with <paramref name="enabledChannels"/> stored verbatim) and one staff user enrolled in
    /// <paramref name="role"/>.
    /// </summary>
    public async Task<SeededExercise> SeedExerciseAsync(string role = "controller", string? enabledChannels = "social,news,press,weather")
    {
        var exerciseId = Guid.NewGuid();
        var staffUserId = Guid.NewGuid();
        await using var db = Db(exerciseId);
        db.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = exerciseId,
            Name = "Fairhaven water",
            TimeZone = "America/Chicago",
            Status = "live",
            EnabledChannels = enabledChannels,
        });
        db.StaffUsers.Add(StaffTenantSeed.StaffUserFor(staffUserId));
        db.Enrollments.Add(new Enrollment
        {
            Id = Guid.NewGuid(),
            PersonId = staffUserId,
            ExerciseId = exerciseId,
            Role = role,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
        return new SeededExercise(exerciseId, staffUserId);
    }

    /// <summary>Enrolls another staff user in the exercise.</summary>
    public async Task<Guid> AddStaffAsync(Guid exerciseId, string role)
    {
        var staffUserId = Guid.NewGuid();
        await using var db = Db(exerciseId);
        db.StaffUsers.Add(StaffTenantSeed.StaffUserFor(staffUserId));
        db.Enrollments.Add(new Enrollment
        {
            Id = Guid.NewGuid(),
            PersonId = staffUserId,
            ExerciseId = exerciseId,
            Role = role,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
        return staffUserId;
    }

    public async Task<Guid> AddPersonaAsync(Guid exerciseId, string? handle = null)
    {
        var id = Guid.NewGuid();
        await using var db = Db(exerciseId);
        db.Personas.Add(new Persona
        {
            Id = id,
            ExerciseId = exerciseId,
            DisplayName = "Seeded persona",
            Handle = handle ?? $"persona_{id:N}",
            Kind = "org",
        });
        await db.SaveChangesAsync();
        return id;
    }

    public async Task<Guid> AddMediaAssetAsync(Guid exerciseId, string kind = MediaKinds.Image)
    {
        var id = Guid.NewGuid();
        await using var db = Db(exerciseId);
        db.MediaAssets.Add(new MediaAsset
        {
            Id = id,
            ExerciseId = exerciseId,
            Kind = kind,
            ContentType = kind == MediaKinds.Video ? "video/mp4" : "image/png",
            BlobName = $"{exerciseId:N}/{id:N}",
            Bytes = 1024,
            Width = 400,
            Height = 120,
            OriginalFileName = kind == MediaKinds.Video ? "clip.mp4" : "logo.png",
            UploadedByHumanId = "staff",
            CreatedScenarioTime = DateTimeOffset.UtcNow,
            CreatedWallClock = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
        return id;
    }

    /// <summary>Seeds an outlet directly (bypassing the API), for read-side and isolation setups.</summary>
    public async Task<Outlet> AddOutletAsync(
        Guid exerciseId,
        string channelId,
        string slug,
        string? name = null,
        int sortOrder = 1,
        bool enabled = true,
        bool deleted = false,
        Guid? logoMediaId = null)
    {
        var outlet = new Outlet
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            ChannelId = channelId,
            Slug = slug,
            Name = name ?? slug,
            SkinKey = "neutral",
            SortOrder = sortOrder,
            Enabled = enabled,
            Version = 1,
            LogoMediaId = logoMediaId,
            CategoriesJson = "[\"Local\"]",
            DeletedAt = deleted ? DateTimeOffset.UtcNow : null,
        };
        await using var db = Db(exerciseId);
        db.Outlets.Add(outlet);
        await db.SaveChangesAsync();
        return outlet;
    }

    /// <summary>The <c>outlet_action</c> events of an exercise, oldest first.</summary>
    public async Task<List<TelemetryEvent>> OutletEventsAsync(Guid exerciseId)
    {
        await using var db = Db(exerciseId);
        return await db.TelemetryEvents
            .AsNoTracking()
            .Where(e => e.EventType == "outlet_action")
            .OrderBy(e => e.WallClockTime)
            .ToListAsync();
    }

    // ---- HTTP helpers ----

    public Task<HttpResponseMessage> GetAsync(string path)
    {
        Time.Advance(Step);
        return Client.GetAsync(new Uri(path, UriKind.Relative));
    }

    public Task<HttpResponseMessage> PostAsync(string path, object body)
    {
        Time.Advance(Step);
        return Client.PostAsJsonAsync(new Uri(path, UriKind.Relative), body);
    }

    public Task<HttpResponseMessage> PutAsync(Guid id, object body)
    {
        Time.Advance(Step);
        return Client.PutAsJsonAsync(new Uri($"/api/outlets/{id}", UriKind.Relative), body);
    }

    public Task<HttpResponseMessage> DeleteAsync(Guid id, int? version)
    {
        Time.Advance(Step);
        return Client.DeleteAsync(new Uri($"/api/outlets/{id}{(version is null ? string.Empty : $"?version={version}")}", UriKind.Relative));
    }

    public async Task<WireStaffOutlet> CreateOkAsync(object body)
    {
        var response = await PostAsync("/api/outlets", body);
        if (response.StatusCode != System.Net.HttpStatusCode.Created)
        {
            throw new InvalidOperationException($"create failed: {(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
        }

        return (await response.Content.ReadFromJsonAsync<WireStaffOutlet>())!;
    }

    public static object Body(
        string channelId = "news",
        string slug = "metro-desk-9",
        string name = "Metro Desk 9",
        string skinKey = "newsline7",
        object? skinOverrides = null,
        IEnumerable<string>? categories = null,
        string? pairedPersonaId = null,
        string? parentOutletId = null,
        string? logoMediaId = null,
        bool? enabled = null,
        int? sortOrder = null,
        int? version = null,
        string? tagline = "On your side.") => new
        {
            channelId,
            slug,
            name,
            tagline,
            skinKey,
            skinOverrides,
            categories = (categories ?? ["Local", "Weather"]).ToArray(),
            pairedPersonaId,
            parentOutletId,
            logoMediaId,
            enabled,
            sortOrder,
            version,
        };

    /// <summary>Reads a ProblemDetails body into its comparable parts (everything but the per-request traceId).</summary>
    public static async Task<WireProblem> ProblemAsync(HttpResponseMessage response)
    {
        var json = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        WireStaffOutlet? item = null;
        if (root.TryGetProperty("item", out var itemElement))
        {
            item = itemElement.Deserialize<WireStaffOutlet>(new JsonSerializerOptions(JsonSerializerDefaults.Web));
        }

        var keys = string.Join(",", root.EnumerateObject().Select(p => p.Name).Where(n => n != "traceId").OrderBy(n => n, StringComparer.Ordinal));
        return new WireProblem(
            (int)response.StatusCode,
            root.TryGetProperty("type", out var type) ? type.GetString() : null,
            root.TryGetProperty("title", out var title) ? title.GetString() : null,
            root.TryGetProperty("detail", out var detail) ? detail.GetString() : null,
            keys,
            item);
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

internal sealed record SeededExercise(Guid ExerciseId, Guid StaffUserId);

internal sealed record WireLogo(string Id, string Kind, string Role, string Url, string ContentType, int? Width, int? Height, string Alt);

internal sealed record WireOutlet(
    string Id,
    string ChannelId,
    string Slug,
    string Name,
    string? Tagline,
    string? ParentOutletId,
    string? PairedPersonaId,
    WireLogo? Logo,
    List<string> Categories,
    string SkinKey,
    JsonElement? SkinOverrides,
    string HomeRoute);

internal sealed record WireStaffOutlet(
    string Id,
    string ChannelId,
    string Slug,
    string Name,
    string? Tagline,
    string? ParentOutletId,
    string? PairedPersonaId,
    WireLogo? Logo,
    List<string> Categories,
    string SkinKey,
    JsonElement? SkinOverrides,
    string HomeRoute,
    string? LogoMediaId,
    bool Enabled,
    int SortOrder,
    int Version)
{
    public Guid Guid => Guid.Parse(Id);
}

internal sealed record WireDefaults(List<WireStaffOutlet> Created, List<string> Skipped, List<string> UnresolvedHandles);

internal sealed record WireProblem(int Status, string? Type, string? Title, string? Detail, string Keys, WireStaffOutlet? Item);

/// <summary>Records, per <c>SaveChanges</c>, the entity types the save added, modified or deleted.</summary>
internal sealed class SaveRecorder : SaveChangesInterceptor
{
    private readonly List<IReadOnlyList<(string Entity, string State)>> _saves = [];
    private readonly Lock _gate = new();

    public IReadOnlyList<IReadOnlyList<(string Entity, string State)>> All
    {
        get
        {
            lock (_gate)
            {
                return _saves.ToList();
            }
        }
    }

    public void Clear()
    {
        lock (_gate)
        {
            _saves.Clear();
        }
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        if (eventData.Context is { } context)
        {
            var entries = context.ChangeTracker.Entries()
                .Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
                .Select(e => (e.Metadata.ClrType.Name, e.State.ToString()))
                .ToList();
            lock (_gate)
            {
                _saves.Add(entries);
            }
        }

        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }
}

/// <summary>
/// Plays a concurrent writer that wins the slug race: when a save is about to ADD an outlet with <see cref="RacedSlug"/>,
/// it first inserts the same <c>(exercise, channel, slug)</c> through an independent context, so the original save
/// meets the unique index after the service's own pre-check passed. Fires once.
/// </summary>
internal sealed class ConcurrentSlugWriter : SaveChangesInterceptor
{
    public const string RacedSlug = "raced-slug";

    private readonly Func<Guid?> _exerciseId;
    private int _fired;

    public ConcurrentSlugWriter(Func<Guid?> exerciseId)
    {
        _exerciseId = exerciseId;
    }

    public string? ConnectionString { get; set; }

    public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        var raced = eventData.Context?.ChangeTracker.Entries<Outlet>()
            .FirstOrDefault(e => e.State == EntityState.Added && e.Entity.Slug == RacedSlug);
        if (raced is not null && _exerciseId() is { } exerciseId && Interlocked.Exchange(ref _fired, 1) == 0)
        {
            var options = new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(ConnectionString).Options;
            await using var other = new PulseDbContext(options, new ExerciseContext { CurrentExerciseId = exerciseId });
            other.Outlets.Add(new Outlet
            {
                Id = Guid.NewGuid(),
                ExerciseId = exerciseId,
                ChannelId = raced.Entity.ChannelId,
                Slug = RacedSlug,
                Name = "The other writer",
                SkinKey = "neutral",
                Enabled = true,
                Version = 1,
            });
            await other.SaveChangesAsync(cancellationToken);
        }

        return await base.SavingChangesAsync(eventData, result, cancellationToken);
    }
}
