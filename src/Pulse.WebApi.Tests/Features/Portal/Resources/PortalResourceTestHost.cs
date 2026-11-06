namespace Pulse.WebApi.Tests.Features.Portal.Resources;

using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
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
using Pulse.WebApi.Features.Portal.Resources;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Pulse.WebApi.Tests.Features.Social;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// A minimal TestServer host wired the way <c>Program.cs</c> wires the Resources shelf: persistence + exercise scoping,
/// <c>AddChannels()</c> (the F04 sanitizer registry and F08's gate), <c>AddPortalResources()</c> +
/// <c>MapPortalResources()</c> behind the SHIPPED staff and role filters, against the shared real-SQL database. Only the
/// edges are doubled: the caller's identity and scope (switchable per call) and the media URL signer (BP's deterministic,
/// scope-checking stand-in).
/// </summary>
internal sealed class PortalResourceTestHost : IAsyncDisposable
{
    public const string Route = "/api/portal/resources";

    private readonly WebApplication _app;
    private readonly CallerHolder _caller;

    private PortalResourceTestHost(WebApplication app, CallerHolder caller, string connectionString)
    {
        _app = app;
        _caller = caller;
        ConnectionString = connectionString;
        Client = app.GetTestClient();
    }

    public HttpClient Client { get; }

    public string ConnectionString { get; }

    /// <summary>Makes every following request act in <paramref name="exerciseId"/> as <paramref name="staffUserId"/> (null = no staff session).</summary>
    public void ActAs(Guid? exerciseId, Guid? staffUserId)
    {
        _caller.ExerciseId = exerciseId;
        _caller.StaffUserId = staffUserId;
    }

    public static async Task<PortalResourceTestHost> StartAsync(string connectionString, bool documentsEnabled = false)
    {
        var caller = new CallerHolder();

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            [$"{PortalResourceOptions.SectionName}:{nameof(PortalResourceOptions.DocumentAttachmentsEnabled)}"] =
                documentsEnabled ? "true" : "false",
        });

        builder.Services.AddDbContext<PulseDbContext>(options => options.UseSqlServer(connectionString));
        builder.Services.AddExerciseScoping();
        builder.Services.AddExerciseClock();
        builder.Services.AddExerciseConfiguration();
        builder.Services.AddChannels();
        builder.Services.AddPortalResources();

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

        var app = builder.Build();
        app.MapPortalResources();
        await app.StartAsync();

        return new PortalResourceTestHost(app, caller, connectionString);
    }

    /// <summary>A context outside any request, scoped to <paramref name="exerciseId"/>.</summary>
    public PulseDbContext Db(Guid? exerciseId)
    {
        var options = new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(ConnectionString).Options;
        return new PulseDbContext(options, new ExerciseContext { CurrentExerciseId = exerciseId });
    }

    /// <summary>Seeds an exercise with <paramref name="enabledChannels"/> and one staff user enrolled in <paramref name="role"/>.</summary>
    public async Task<(Guid ExerciseId, Guid StaffUserId)> SeedExerciseAsync(
        string role = "controller", string? enabledChannels = "social,portal,news,press,weather")
    {
        var exerciseId = Guid.NewGuid();
        await using (var db = Db(exerciseId))
        {
            db.Exercises.Add(new Exercise
            {
                OrganizationId = Organization.DefaultOrganizationId,
                Id = exerciseId,
                Name = "Fairhaven water",
                TimeZone = "America/Chicago",
                Status = "live",
                EnabledChannels = enabledChannels,
            });
            await db.SaveChangesAsync();
        }

        return (exerciseId, await AddStaffAsync(exerciseId, role));
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

    public async Task<Guid> AddMediaAssetAsync(Guid exerciseId, string kind = MediaKinds.Image)
    {
        var id = Guid.NewGuid();
        await using var db = Db(exerciseId);
        db.MediaAssets.Add(new MediaAsset
        {
            Id = id,
            ExerciseId = exerciseId,
            Kind = kind,
            ContentType = kind switch
            {
                MediaKinds.Video => "video/mp4",
                MediaKinds.Document => "application/pdf",
                _ => "image/png",
            },
            BlobName = $"{exerciseId:N}/{id:N}",
            Bytes = 1024,
            Width = kind == MediaKinds.Image ? 400 : null,
            Height = kind == MediaKinds.Image ? 120 : null,
            OriginalFileName = kind == MediaKinds.Document ? "quick-start.pdf" : "photo.png",
            UploadedByHumanId = "staff",
            CreatedScenarioTime = DateTimeOffset.UtcNow,
            CreatedWallClock = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
        return id;
    }

    /// <summary>Seeds a resource row directly (bypassing the API).</summary>
    public async Task<PortalResource> AddResourceAsync(
        Guid exerciseId, string title, int sortOrder, bool visible = true, bool deleted = false, Guid? mediaAssetId = null)
    {
        var row = new PortalResource
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            Title = title,
            Summary = $"{title} summary",
            BodyHtml = $"<p>{title}</p>",
            MediaAssetId = mediaAssetId,
            SortOrder = sortOrder,
            Visible = visible,
            Version = 1,
            DeletedAt = deleted ? DateTimeOffset.UtcNow : null,
        };
        await using var db = Db(exerciseId);
        db.PortalResources.Add(row);
        await db.SaveChangesAsync();
        return row;
    }

    // ---- HTTP helpers ----

    public Task<HttpResponseMessage> GetAsync(string path) => Client.GetAsync(new Uri(path, UriKind.Relative));

    public Task<HttpResponseMessage> PostAsync(string path, object body) =>
        Client.PostAsJsonAsync(new Uri(path, UriKind.Relative), body);

    public Task<HttpResponseMessage> PutAsync(Guid id, object body) =>
        Client.PutAsJsonAsync(new Uri($"{Route}/{id}", UriKind.Relative), body);

    public Task<HttpResponseMessage> DeleteAsync(Guid id) => Client.DeleteAsync(new Uri($"{Route}/{id}", UriKind.Relative));

    public static object Body(
        string title = "Quick-start guide",
        string? summary = "How the exercise works.",
        string? bodyHtml = "<p>Read this first.</p>",
        string? mediaAssetId = null,
        bool visible = true,
        int version = 0) => new { title, summary, bodyHtml, mediaAssetId, visible, version };

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

internal sealed record WireMedia(string Id, string Kind, string Role, string Url, string ContentType, string Alt);

internal sealed record WireResource(string Id, string Title, string? Summary, string? BodyHtml, WireMedia? Media);

internal sealed record WireStaffResource(
    string Id, string Title, string? Summary, string? BodyHtml, WireMedia? Media, int SortOrder, bool Visible, int Version)
{
    public Guid Guid => Guid.Parse(Id);
}
