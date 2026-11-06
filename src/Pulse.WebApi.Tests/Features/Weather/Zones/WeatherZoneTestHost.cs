namespace Pulse.WebApi.Tests.Features.Weather.Zones;

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
using Pulse.WebApi.Features.Weather;
using Pulse.WebApi.Tests.Features.Channels.Outlets;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Pulse.WebApi.Tests.Features.Social;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// A minimal TestServer host wired the way <c>Program.cs</c> wires the weather zone API: persistence + exercise scoping,
/// the exercise clock, <c>AddExerciseConfiguration()</c>, <c>AddChannels()</c> + <c>AddWeather()</c> and
/// <c>MapChannels()</c> + <c>MapWeather()</c> behind the SHIPPED staff/controller filters and the F08 channel gate, against
/// the shared real-SQL database (the unfiltered unique slug index is real). Only the edges are doubled: the caller's
/// identity and scope (switchable per call), the wall clock and the media URL signer. A save recorder lists what each
/// <c>SaveChanges</c> wrote, so tests can prove a change and its telemetry event share one unit of work.
/// </summary>
internal sealed class WeatherZoneTestHost : IAsyncDisposable
{
    private static readonly TimeSpan Step = TimeSpan.FromMilliseconds(10);

    private readonly WebApplication _app;
    private readonly CallerHolder _caller;

    private WeatherZoneTestHost(WebApplication app, CallerHolder caller, string connectionString, SaveRecorder saves)
    {
        _app = app;
        _caller = caller;
        ConnectionString = connectionString;
        Saves = saves;
        Client = app.GetTestClient();
        Time = (ManualTimeProvider)app.Services.GetRequiredService<TimeProvider>();
    }

    public HttpClient Client { get; }

    public ManualTimeProvider Time { get; }

    public string ConnectionString { get; }

    public SaveRecorder Saves { get; }

    /// <summary>Makes every following request act in <paramref name="exerciseId"/> as <paramref name="staffUserId"/> (null = no staff session).</summary>
    public void ActAs(Guid? exerciseId, Guid? staffUserId)
    {
        _caller.ExerciseId = exerciseId;
        _caller.StaffUserId = staffUserId;
    }

    public static async Task<WeatherZoneTestHost> StartAsync(string connectionString, Action<IServiceCollection>? configureServices = null)
    {
        var caller = new CallerHolder();
        var saves = new SaveRecorder();

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();

        builder.Services.AddDbContext<PulseDbContext>((sp, options) =>
            options.UseSqlServer(connectionString).AddInterceptors(saves).AddInterceptors(sp.GetServices<IInterceptor>()));
        builder.Services.AddExerciseScoping();
        builder.Services.AddExerciseClock();
        builder.Services.AddExerciseConfiguration();
        builder.Services.AddChannels();
        builder.Services.AddWeather();

        builder.Services.RemoveAll<TimeProvider>();
        builder.Services.AddSingleton<TimeProvider>(new ManualTimeProvider(DateTimeOffset.UtcNow));
        builder.Services.AddSingleton<SignerProbe>();
        builder.Services.AddScoped<IMediaUrlSigner>(sp =>
            new FakeMediaUrlSigner(sp.GetRequiredService<IExerciseContext>(), sp.GetRequiredService<SignerProbe>()));

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
        app.MapWeather();
        await app.StartAsync();

        return new WeatherZoneTestHost(app, caller, connectionString, saves);
    }

    /// <summary>A context outside any request, scoped to <paramref name="exerciseId"/> (null = unscoped).</summary>
    public PulseDbContext Db(Guid? exerciseId)
    {
        var options = new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(ConnectionString).Options;
        return new PulseDbContext(options, new ExerciseContext { CurrentExerciseId = exerciseId });
    }

    /// <summary>Seeds an exercise (channels stored verbatim) and one staff user enrolled in <paramref name="role"/>.</summary>
    public async Task<SeededExercise> SeedExerciseAsync(string role = "controller", string? enabledChannels = "social,news,press,weather")
    {
        var exerciseId = Guid.NewGuid();
        var staffUserId = Guid.NewGuid();
        await using var db = Db(exerciseId);
        db.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = exerciseId,
            Name = "Kestrel County storm",
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

    /// <summary>Seeds a zone directly (bypassing the API).</summary>
    public async Task<WeatherZone> AddZoneAsync(Guid exerciseId, string slug, int sortOrder = 1, bool isDefault = false, bool deleted = false)
    {
        var zone = new WeatherZone
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            Slug = slug,
            Name = slug,
            Kind = "county",
            SortOrder = sortOrder,
            IsDefault = isDefault,
            Version = 1,
            DeletedAt = deleted ? DateTimeOffset.UtcNow : null,
        };
        await using var db = Db(exerciseId);
        db.WeatherZones.Add(zone);
        await db.SaveChangesAsync();
        return zone;
    }

    /// <summary>The <c>weather_zone_changed</c> events of an exercise, oldest first.</summary>
    public async Task<List<TelemetryEvent>> ZoneEventsAsync(Guid exerciseId)
    {
        await using var db = Db(exerciseId);
        return await db.TelemetryEvents
            .AsNoTracking()
            .Where(e => e.EventType == "weather_zone_changed")
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
        return Client.PutAsJsonAsync(new Uri($"/api/weather/zones/{id}", UriKind.Relative), body);
    }

    public Task<HttpResponseMessage> DeleteAsync(Guid id, int? version)
    {
        Time.Advance(Step);
        return Client.DeleteAsync(new Uri(
            $"/api/weather/zones/{id}{(version is null ? string.Empty : $"?version={version}")}", UriKind.Relative));
    }

    public async Task<WireZoneStaff> CreateOkAsync(object body)
    {
        var response = await PostAsync("/api/weather/zones", body);
        if (response.StatusCode != System.Net.HttpStatusCode.Created)
        {
            throw new InvalidOperationException($"create failed: {(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
        }

        return (await response.Content.ReadFromJsonAsync<WireZoneStaff>())!;
    }

    public static object Body(
        string slug = "kestrel-county-north",
        string name = "Kestrel County (North)",
        string kind = "county",
        string? description = null,
        int? sortOrder = null,
        bool? isDefault = null,
        int? version = null) => new { slug, name, kind, description, sortOrder, isDefault, version };

    /// <summary>Reads a ProblemDetails body into its comparable parts (everything but the per-request traceId).</summary>
    public static async Task<WireZoneProblem> ProblemAsync(HttpResponseMessage response)
    {
        var json = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        WireZoneStaff? item = null;
        if (root.TryGetProperty("item", out var itemElement))
        {
            item = itemElement.Deserialize<WireZoneStaff>(new JsonSerializerOptions(JsonSerializerDefaults.Web));
        }

        var keys = string.Join(",", root.EnumerateObject().Select(p => p.Name).Where(n => n != "traceId").OrderBy(n => n, StringComparer.Ordinal));
        return new WireZoneProblem(
            (int)response.StatusCode,
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

internal sealed record WireZone(string Slug, string Name, string Kind, bool IsDefault);

internal sealed record WireZoneStaff(string Id, string Slug, string Name, string Kind, string? Description, int SortOrder, bool IsDefault, int Version)
{
    public Guid Guid => Guid.Parse(Id);
}

internal sealed record WireZoneStaffList(List<WireZoneStaff> Zones, bool CanAuthor, string? AuthoringBlockedReason);

internal sealed record WireZoneProblem(int Status, string? Title, string? Detail, string Keys, WireZoneStaff? Item);

/// <summary>
/// Plays a concurrent writer that wins the slug race: when a save is about to ADD a zone with <see cref="RacedSlug"/>, it
/// first inserts the same <c>(exercise, slug)</c> through an independent context, so the original save meets the unique
/// index after the service's own pre-check passed. Fires once.
/// </summary>
internal sealed class ConcurrentZoneSlugWriter : SaveChangesInterceptor
{
    public const string RacedSlug = "raced-zone";

    private int _fired;

    public string? ConnectionString { get; set; }

    public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        var raced = eventData.Context?.ChangeTracker.Entries<WeatherZone>()
            .FirstOrDefault(e => e.State == EntityState.Added && e.Entity.Slug == RacedSlug);
        if (raced is not null && Interlocked.Exchange(ref _fired, 1) == 0)
        {
            var options = new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(ConnectionString).Options;
            await using var other = new PulseDbContext(options, new ExerciseContext { CurrentExerciseId = raced.Entity.ExerciseId });
            other.WeatherZones.Add(new WeatherZone
            {
                Id = Guid.NewGuid(),
                ExerciseId = raced.Entity.ExerciseId,
                Slug = RacedSlug,
                Name = "The other writer",
                Kind = "custom",
                Version = 1,
            });
            await other.SaveChangesAsync(cancellationToken);
        }

        return await base.SavingChangesAsync(eventData, result, cancellationToken);
    }
}

/// <summary>
/// Plays a concurrent writer that wins at the SAVE: when a save is about to modify the armed zone, it first bumps that
/// row's <c>Version</c> (and renames it) through an independent context, so the original UPDATE's concurrency token matches
/// no row and EF throws <see cref="DbUpdateConcurrencyException"/>. Fires once.
/// </summary>
internal sealed class ConcurrentZoneVersionBumper : SaveChangesInterceptor
{
    public const string OtherName = "Changed by the other writer";

    private Guid? _zoneId;
    private string? _connectionString;
    private int _fired;

    public void Arm(Guid zoneId, string connectionString)
    {
        _zoneId = zoneId;
        _connectionString = connectionString;
    }

    public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        var target = eventData.Context?.ChangeTracker.Entries<WeatherZone>()
            .FirstOrDefault(e => e.State == EntityState.Modified && e.Entity.Id == _zoneId);
        if (target is not null && Interlocked.Exchange(ref _fired, 1) == 0)
        {
            var options = new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(_connectionString).Options;
            await using var other = new PulseDbContext(options, new ExerciseContext { CurrentExerciseId = target.Entity.ExerciseId });
            var row = await other.WeatherZones.SingleAsync(z => z.Id == target.Entity.Id, cancellationToken);
            row.Name = OtherName;
            row.Version++;
            await other.SaveChangesAsync(cancellationToken);
        }

        return await base.SavingChangesAsync(eventData, result, cancellationToken);
    }
}
