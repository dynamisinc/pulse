namespace Pulse.WebApi.Tests.Features.Portal.Config;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
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
using Pulse.WebApi.Features.Portal;
using Pulse.WebApi.Tests.Features.Channels.Outlets;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Pulse.WebApi.Tests.Features.Social;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// A minimal TestServer host wired the way <c>Program.cs</c> wires the portal config API: persistence + exercise
/// scoping, the exercise clock, <c>AddExerciseConfiguration()</c>, <c>AddChannels()</c> (F08 enablement, F03's skin
/// validator) and <c>AddPortal()</c> + <c>MapPortal()</c> behind the SHIPPED staff and role filters, against the shared
/// real-SQL database (the <see cref="OutletTestHost"/> pattern). Only the edges are doubled: the caller's identity and
/// scope (switchable per call), the wall clock and the media URL signer. A save recorder lists each <c>SaveChanges</c>.
/// </summary>
internal sealed class PortalConfigTestHost : IAsyncDisposable
{
    /// <summary>Every channel enabled, the portal included.</summary>
    public const string AllChannels = "social,portal,news,press,weather";

    private readonly WebApplication _app;
    private readonly CallerHolder _caller;

    private PortalConfigTestHost(WebApplication app, CallerHolder caller, string connectionString, SaveRecorder saves)
    {
        _app = app;
        _caller = caller;
        ConnectionString = connectionString;
        Saves = saves;
        Client = app.GetTestClient();
    }

    public HttpClient Client { get; }

    public string ConnectionString { get; }

    public SaveRecorder Saves { get; }

    /// <summary>Makes every following request act in <paramref name="exerciseId"/> as <paramref name="staffUserId"/> (null = a participant).</summary>
    public void ActAs(Guid? exerciseId, Guid? staffUserId)
    {
        _caller.ExerciseId = exerciseId;
        _caller.StaffUserId = staffUserId;
    }

    public static async Task<PortalConfigTestHost> StartAsync(string connectionString, Action<IServiceCollection>? configureServices = null)
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
        builder.Services.AddPortal();

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
        app.MapPortal();
        await app.StartAsync();

        return new PortalConfigTestHost(app, caller, connectionString, saves);
    }

    /// <summary>A context outside any request, scoped to <paramref name="exerciseId"/>.</summary>
    public PulseDbContext Db(Guid? exerciseId)
    {
        var options = new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(ConnectionString).Options;
        return new PulseDbContext(options, new ExerciseContext { CurrentExerciseId = exerciseId });
    }

    /// <summary>Seeds an exercise with <paramref name="enabledChannels"/> stored verbatim, and one staff user in <paramref name="role"/>.</summary>
    public async Task<SeededExercise> SeedExerciseAsync(string role = "controller", string? enabledChannels = AllChannels)
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
        db.Enrollments.Add(NewEnrollment(exerciseId, staffUserId, role));
        await db.SaveChangesAsync();
        return new SeededExercise(exerciseId, staffUserId);
    }

    /// <summary>Enrolls another staff user in the exercise.</summary>
    public async Task<Guid> AddStaffAsync(Guid exerciseId, string role)
    {
        var staffUserId = Guid.NewGuid();
        await using var db = Db(exerciseId);
        db.StaffUsers.Add(StaffTenantSeed.StaffUserFor(staffUserId));
        db.Enrollments.Add(NewEnrollment(exerciseId, staffUserId, role));
        await db.SaveChangesAsync();
        return staffUserId;
    }

    public async Task SetEnabledChannelsAsync(Guid exerciseId, string enabledChannels)
    {
        await using var db = Db(exerciseId);
        var exercise = await db.Exercises.SingleAsync(e => e.Id == exerciseId);
        exercise.EnabledChannels = enabledChannels;
        await db.SaveChangesAsync();
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

    /// <summary>Seeds a config row directly (bypassing the API), for read-side setups.</summary>
    public async Task SeedConfigAsync(Guid exerciseId, string modulesJson, string? cityName = null, string? portalName = null)
    {
        await using var db = Db(exerciseId);
        db.PortalConfigs.Add(new PortalConfig
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            LayoutKey = "anchor",
            ModulesJson = modulesJson,
            CityName = cityName,
            PortalName = portalName,
            Version = 1,
        });
        await db.SaveChangesAsync();
    }

    public async Task AddResourceAsync(Guid exerciseId, bool visible)
    {
        await using var db = Db(exerciseId);
        db.PortalResources.Add(new PortalResource
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            Title = "Shelter list",
            SortOrder = 1,
            Visible = visible,
            Version = 1,
        });
        await db.SaveChangesAsync();
    }

    public async Task<List<PortalConfig>> ConfigRowsAsync(Guid exerciseId)
    {
        await using var db = Db(exerciseId);
        return await db.PortalConfigs.AsNoTracking().ToListAsync();
    }

    public async Task<List<TelemetryEvent>> ConfigEventsAsync(Guid exerciseId)
    {
        await using var db = Db(exerciseId);
        return await db.TelemetryEvents
            .AsNoTracking()
            .Where(e => e.EventType == "portal_config_changed")
            .OrderBy(e => e.WallClockTime)
            .ToListAsync();
    }

    public Task<HttpResponseMessage> GetAsync(string path) => Client.GetAsync(new Uri(path, UriKind.Relative));

    public Task<HttpResponseMessage> PutConfigAsync(object body) =>
        Client.PutAsJsonAsync(new Uri("/api/portal/config", UriKind.Relative), body);

    /// <summary>A valid write body with every field overridable.</summary>
    public static Dictionary<string, object?> Body(
        int version = 0,
        string? portalName = null,
        string? cityName = "Fairhaven",
        string? tagline = null,
        string? logoMediaId = null,
        string layoutKey = "anchor",
        object? modules = null,
        object? skinOverrides = null) => new()
        {
            ["portalName"] = portalName,
            ["cityName"] = cityName,
            ["tagline"] = tagline,
            ["logoMediaId"] = logoMediaId,
            ["layoutKey"] = layoutKey,
            ["modules"] = modules ?? new object[]
            {
                new { id = "weather", enabled = true },
                new { id = "topStories", enabled = true },
            },
            ["skinOverrides"] = skinOverrides,
            ["version"] = version,
        };

    public async ValueTask DisposeAsync()
    {
        Client.Dispose();
        await _app.DisposeAsync();
    }

    private static Enrollment NewEnrollment(Guid exerciseId, Guid staffUserId, string role) => new()
    {
        Id = Guid.NewGuid(),
        PersonId = staffUserId,
        ExerciseId = exerciseId,
        Role = role,
        CreatedAt = DateTimeOffset.UtcNow,
    };

    private sealed class CallerHolder
    {
        public Guid? ExerciseId { get; set; }

        public Guid? StaffUserId { get; set; }
    }
}
