namespace Pulse.WebApi.Tests.Features.Social.Editing;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Identity.SharedAccess;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.Social.Editing;
using Pulse.WebApi.Features.Social.Follows;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// Records every broadcast the edit tests care about: <c>PostEdited</c> frames (with their target exercise) and any
/// <c>PostReceived</c>, which an edit must never send (DF-33).
/// </summary>
public sealed class RecordingEditBroadcaster : IFeedBroadcaster
{
    private readonly ConcurrentQueue<(Guid ExerciseId, PostEditedDto Frame)> _edited = new();
    private readonly ConcurrentQueue<(Guid ExerciseId, ParticipantPostDto Post)> _received = new();

    /// <summary>Every <c>PostEdited</c> frame, in order.</summary>
    public IReadOnlyList<(Guid ExerciseId, PostEditedDto Frame)> Edited => _edited.ToArray();

    /// <summary>Every <c>PostReceived</c> broadcast, in order.</summary>
    public IReadOnlyList<(Guid ExerciseId, ParticipantPostDto Post)> Received => _received.ToArray();

    /// <inheritdoc />
    public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default)
    {
        _received.Enqueue((exerciseId, post));
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task BroadcastPostEditedAsync(Guid exerciseId, PostEditedDto edited, CancellationToken cancellationToken = default)
    {
        _edited.Enqueue((exerciseId, edited));
        return Task.CompletedTask;
    }
}

/// <summary>A broadcaster whose <c>PostEdited</c> send always fails (a SignalR outage after commit).</summary>
public sealed class ThrowingEditBroadcaster : IFeedBroadcaster
{
    /// <inheritdoc />
    public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    /// <inheritdoc />
    public Task BroadcastPostEditedAsync(Guid exerciseId, PostEditedDto edited, CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException("Simulated SignalR failure while sending PostEdited.");
}

/// <summary>Who the next request acts as. Mutable so one host serves several callers.</summary>
internal sealed class EditCaller
{
    public Guid? ExerciseId { get; set; }

    public Guid? PersonaId { get; set; }

    public string Kind { get; set; } = "participant";

    public Guid? StaffUserId { get; set; }

    public bool IsReadOnly { get; set; }
}

/// <summary>
/// A minimal TestServer host wired the way S-5 will wire the slice — persistence + exercise scoping, the exercise clock,
/// the pause tiers, the post funnel, the feed and thread reads, and <c>AddPostEditing()</c> + <c>MapPostEditing()</c> —
/// against the shared real-SQL database (story 19 does not edit <c>Program.cs</c>). Only the edges are doubled: the
/// caller's identity and scope (switchable per call), the read-only probe, the wall clock (hand-advanced), the URL
/// signer and the broadcaster.
/// </summary>
internal sealed class PostEditTestHost : IAsyncDisposable
{
    /// <summary>The stored <c>Exercise.CurrentScenarioTime</c> every seeded exercise carries (the edit's scenario fallback).</summary>
    public static readonly DateTimeOffset StoredScenarioTime = new(2033, 9, 4, 13, 20, 0, TimeSpan.Zero);

    /// <summary>The scenario instant seeded posts are created at.</summary>
    public static readonly DateTimeOffset PostScenarioTime = new(2033, 9, 4, 13, 0, 0, TimeSpan.Zero);

    private readonly WebApplication _app;
    private readonly EditCaller _caller;

    private PostEditTestHost(WebApplication app, EditCaller caller, ManualTimeProvider time, string connectionString)
    {
        _app = app;
        _caller = caller;
        Time = time;
        ConnectionString = connectionString;
        Client = app.GetTestClient();
    }

    public HttpClient Client { get; }

    public ManualTimeProvider Time { get; }

    public string ConnectionString { get; }

    public IServiceProvider Services => _app.Services;

    public RecordingEditBroadcaster Broadcaster => _app.Services.GetRequiredService<RecordingEditBroadcaster>();

    public PauseTierRegistry PauseTiers => _app.Services.GetRequiredService<PauseTierRegistry>();

    public IExerciseClock Clock => _app.Services.GetRequiredService<IExerciseClock>();

    public static async Task<PostEditTestHost> StartAsync(string connectionString, IFeedBroadcaster? broadcaster = null)
    {
        var caller = new EditCaller();
        var time = new ManualTimeProvider(DateTimeOffset.UtcNow);

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Configuration["ConnectionStrings:DefaultConnection"] = connectionString;

        builder.Services.AddPulsePersistence(builder.Configuration);
        builder.Services.AddExerciseScoping();
        builder.Services.AddExerciseClock();
        builder.Services.AddPauseTierSteering();
        builder.Services.AddSocialPostWrite();
        builder.Services.AddSocialFeedRead();
        builder.Services.AddSocialThreads();
        builder.Services.AddPostEditing();

        builder.Services.RemoveAll<IMediaUrlSigner>();
        builder.Services.AddScoped<IMediaUrlSigner>(sp => new FakeMediaUrlSigner(sp.GetRequiredService<IExerciseContext>(), new SignerProbe()));

        var recording = new RecordingEditBroadcaster();
        builder.Services.AddSingleton(recording);
        builder.Services.RemoveAll<IFeedBroadcaster>();
        builder.Services.AddSingleton<IFeedBroadcaster>(broadcaster ?? recording);

        builder.Services.RemoveAll<TimeProvider>();
        builder.Services.AddSingleton<TimeProvider>(time);

        builder.Services.RemoveAll<IExerciseContext>();
        builder.Services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = caller.ExerciseId });

        builder.Services.RemoveAll<ICurrentStaffSessionAccessor>();
        builder.Services.AddScoped<ICurrentStaffSessionAccessor>(_ => new StubCurrentStaffSessionAccessor(
            caller.StaffUserId is { } staff ? new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = staff } : null));

        builder.Services.RemoveAll<ICurrentSessionPersonaAccessor>();
        builder.Services.AddScoped<ICurrentSessionPersonaAccessor>(_ => new StubSessionPersonaAccessor(
            caller.PersonaId is { } persona && caller.ExerciseId is { } exercise
                ? new CurrentSessionPersona
                {
                    SessionId = Guid.NewGuid(),
                    PersonaId = persona,
                    Kind = caller.Kind,
                    ExerciseId = exercise,
                    ActingHumanId = $"human-{persona:N}",
                }
                : null));

        builder.Services.RemoveAll<IReadOnlySessionProbe>();
        builder.Services.AddSingleton<IReadOnlySessionProbe>(new StubReadOnlyProbe(caller));

        var app = builder.Build();
        app.MapSocialFeedEndpoints();
        app.MapSocialThreadEndpoints();
        app.MapPostEditing();
        await app.StartAsync();

        return new PostEditTestHost(app, caller, time, connectionString);
    }

    /// <summary>Acts as a participant session bound to <paramref name="personaId"/> in <paramref name="exerciseId"/>.</summary>
    public void ActAsParticipant(Guid exerciseId, Guid personaId)
    {
        _caller.ExerciseId = exerciseId;
        _caller.PersonaId = personaId;
        _caller.Kind = "participant";
        _caller.StaffUserId = null;
        _caller.IsReadOnly = false;
    }

    /// <summary>Acts as a live staff session in <paramref name="exerciseId"/>, optionally also bound to a persona.</summary>
    public void ActAsStaff(Guid exerciseId, Guid? personaId = null)
    {
        _caller.ExerciseId = exerciseId;
        _caller.PersonaId = personaId;
        _caller.Kind = "staff";
        _caller.StaffUserId = Guid.NewGuid();
        _caller.IsReadOnly = false;
    }

    /// <summary>Acts as a shared read-only session in <paramref name="exerciseId"/>.</summary>
    public void ActAsReadOnly(Guid exerciseId, Guid? personaId = null)
    {
        _caller.ExerciseId = exerciseId;
        _caller.PersonaId = personaId;
        _caller.Kind = "readonly";
        _caller.StaffUserId = null;
        _caller.IsReadOnly = true;
    }

    /// <summary>Acts with no resolved scope at all.</summary>
    public void ActUnscoped()
    {
        _caller.ExerciseId = null;
        _caller.PersonaId = null;
        _caller.StaffUserId = null;
        _caller.IsReadOnly = false;
    }

    public Task<HttpResponseMessage> EditAsync(Guid postId, string? text) =>
        Client.PatchAsJsonAsync($"/api/posts/{postId}", new { text });

    public Task<HttpResponseMessage> HistoryAsync(Guid postId) => Client.GetAsync($"/api/posts/{postId}/edits");

    /// <summary>A context outside any request, scoped to <paramref name="exerciseId"/> (null = unscoped).</summary>
    public PulseDbContext Db(Guid? exerciseId)
    {
        var options = new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(ConnectionString).Options;
        return new PulseDbContext(options, new ExerciseContext { CurrentExerciseId = exerciseId });
    }

    /// <summary>Seeds an exercise in <paramref name="status"/> with the stored scenario time.</summary>
    public async Task<Guid> SeedExerciseAsync(string status = "live")
    {
        var id = Guid.NewGuid();
        await using var db = Db(id);
        db.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = id,
            Name = $"Edit {id:N}",
            Hostname = $"edit-{id:N}.example.com",
            TimeZone = "UTC",
            Status = status,
            CurrentScenarioTime = StoredScenarioTime,
        });
        await db.SaveChangesAsync();
        return id;
    }

    /// <summary>Sets an exercise's lifecycle status.</summary>
    public async Task SetStatusAsync(Guid exerciseId, string status)
    {
        await using var db = Db(exerciseId);
        var exercise = await db.Exercises.SingleAsync(e => e.Id == exerciseId);
        exercise.Status = status;
        await db.SaveChangesAsync();
    }

    /// <summary>Seeds a persona in <paramref name="exerciseId"/>.</summary>
    public async Task<Guid> SeedPersonaAsync(Guid exerciseId)
    {
        var id = Guid.NewGuid();
        await using var db = Db(exerciseId);
        db.Personas.Add(new Persona
        {
            Id = id,
            ExerciseId = exerciseId,
            DisplayName = $"Persona {id:N}",
            Handle = $"p_{id:N}",
            Kind = "human",
            Verified = false,
        });
        await db.SaveChangesAsync();
        return id;
    }

    /// <summary>Seeds a post created NOW on the host's wall clock (so its window is open).</summary>
    public async Task<Guid> SeedPostAsync(
        Guid exerciseId,
        Guid authorPersonaId,
        string origin = "participant",
        string? body = null,
        Guid? parentPostId = null,
        DateTimeOffset? deletedAt = null,
        bool withMedia = false)
    {
        var id = Guid.NewGuid();
        await using var db = Db(exerciseId);
        db.Posts.Add(new Post
        {
            Id = id,
            ExerciseId = exerciseId,
            AuthorPersonaId = authorPersonaId,
            Body = body ?? $"Original body {id:N}",
            CreatedScenarioTime = PostScenarioTime,
            CreatedWallClock = Time.GetUtcNow(),
            Origin = origin,
            ActingHumanId = $"human-{authorPersonaId:N}",
            ParentPostId = parentPostId,
            DeletedAt = deletedAt,
            BaselineLikeCount = 7,
            BaselineReplyCount = 2,
        });

        if (withMedia)
        {
            var mediaId = Guid.NewGuid();
            db.MediaAssets.Add(new MediaAsset
            {
                Id = mediaId,
                ExerciseId = exerciseId,
                Kind = MediaKinds.Image,
                ContentType = "image/jpeg",
                BlobName = $"{exerciseId:D}/{mediaId:N}.jpg",
                Bytes = 4096,
                OriginalFileName = "street.jpg",
                UploadedByHumanId = $"human-{authorPersonaId:N}",
                CreatedScenarioTime = PostScenarioTime,
                CreatedWallClock = Time.GetUtcNow(),
            });
            db.PostMediaItems.Add(new PostMediaItem
            {
                Id = Guid.NewGuid(),
                ExerciseId = exerciseId,
                PostId = id,
                MediaAssetId = mediaId,
                Alt = "Flooded street",
                Order = 0,
            });
        }

        await db.SaveChangesAsync();
        return id;
    }

    /// <summary>Reads the physical post row (ignoring filters).</summary>
    public async Task<Post> ReadPostAsync(Guid postId)
    {
        await using var db = Db(null);
        return await db.Posts.IgnoreQueryFilters().AsNoTracking().SingleAsync(p => p.Id == postId);
    }

    /// <summary>Reads every physical edit row of a post (ignoring filters), by edit number.</summary>
    public async Task<List<PostEdit>> ReadEditsAsync(Guid postId)
    {
        await using var db = Db(null);
        return await db.PostEdits.IgnoreQueryFilters().AsNoTracking()
            .Where(e => e.PostId == postId).OrderBy(e => e.EditNumber).ToListAsync();
    }

    /// <summary>Reads every telemetry row of an exercise (ignoring filters).</summary>
    public async Task<List<TelemetryEvent>> ReadTelemetryAsync(Guid exerciseId)
    {
        await using var db = Db(null);
        return await db.TelemetryEvents.IgnoreQueryFilters().AsNoTracking()
            .Where(e => e.ExerciseId == exerciseId).ToListAsync();
    }

    public async ValueTask DisposeAsync() => await _app.DisposeAsync();

    private sealed class StubSessionPersonaAccessor(CurrentSessionPersona? current) : ICurrentSessionPersonaAccessor
    {
        public Task<CurrentSessionPersona?> GetCurrentSessionPersonaAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(current);
    }

    private sealed class StubReadOnlyProbe(EditCaller caller) : IReadOnlySessionProbe
    {
        public Task<bool> IsReadOnlySessionAsync(HttpContext httpContext, CancellationToken cancellationToken = default) =>
            Task.FromResult(caller.IsReadOnly);
    }
}
