namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;

using System;
using System.Net.Http;
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
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.ParticipantShell;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// A host wired EXACTLY as the orchestrator will wire story 03 — <c>AddExerciseConfiguration()</c> (01b's
/// defaults) then <c>AddExerciseLifecycle()</c> (this story's <c>Replace</c> contributions),
/// <c>UseExerciseLifecycleGating()</c> in the pipeline, and the real participant + staff endpoint maps —
/// against the shared migrated real SQL Server.
/// </summary>
/// <remarks>
/// <para>
/// <b>The participant routes are the REAL ones, deliberately.</b> The gating suite maps the shipped Social
/// endpoints (<c>/api/feed</c>, <c>/api/threads/{postId}</c>, <c>/api/personas</c>, <c>POST /api/posts</c>)
/// and the shipped six shell-config GETs, so "the participant surface is not served" is asserted against the
/// endpoints that actually serve participants — not against probe routes that could pass while the real ones
/// still hand out an archived world's posts. Only <see cref="IFeedBroadcaster"/> is stubbed (the SignalR hub
/// is not under test here).
/// </para>
/// <para>
/// Its own file under this story's own test folder: it does not touch 01b's
/// <c>ExerciseConfigurationTestHost</c>, so the wave-3 branches stay file-disjoint.
/// </para>
/// </remarks>
public sealed class ExerciseLifecycleTestHost : IAsyncDisposable
{
    private readonly WebApplication _app;

    private ExerciseLifecycleTestHost(WebApplication app, Guid staffUserId)
    {
        _app = app;
        StaffUserId = staffUserId;
        Client = app.GetTestClient();
    }

    /// <summary>The HTTP client bound to the in-memory test server.</summary>
    public HttpClient Client { get; }

    /// <summary>The staff user the stubbed staff-session accessor reports (also the telemetry actor).</summary>
    public Guid StaffUserId { get; }

    /// <summary>The host's root service provider.</summary>
    public IServiceProvider Services => _app.Services;

    /// <summary>Starts the host.</summary>
    /// <param name="connectionString">The migrated test database.</param>
    /// <param name="currentExerciseId">The server-resolved scope; <c>null</c> is the fail-closed case.</param>
    /// <param name="authenticatedStaff">Whether the caller has a live staff session (the gating exemption).</param>
    /// <param name="assignedExerciseId">The exercise the staff user is assigned to (defaults to the resolved scope).</param>
    /// <param name="seedStaffAssignment">Whether to seed the staff assignment row at all.</param>
    /// <param name="configureServices">A hook for a test to contribute an extra registration (e.g. a steering-overlay source).</param>
    /// <returns>The started host.</returns>
    public static async Task<ExerciseLifecycleTestHost> StartAsync(
        string connectionString,
        Guid? currentExerciseId,
        bool authenticatedStaff = false,
        Guid? assignedExerciseId = null,
        bool seedStaffAssignment = true,
        Action<IServiceCollection>? configureServices = null)
    {
        ArgumentNullException.ThrowIfNull(connectionString);

        var staffUserId = Guid.NewGuid();
        var accessor = authenticatedStaff
            ? new StubCurrentStaffSessionAccessor(
                new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = staffUserId })
            : new StubCurrentStaffSessionAccessor(null);

        if (authenticatedStaff && seedStaffAssignment && (assignedExerciseId ?? currentExerciseId) is { } assignExercise)
        {
            await SeedStaffAssignmentAsync(connectionString, staffUserId, assignExercise);
        }

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Configuration["ConnectionStrings:DefaultConnection"] = connectionString;

        builder.Services.AddPulsePersistence(builder.Configuration);
        builder.Services.AddExerciseScoping();

        // B2's staff-identity dependencies the shared staff gate + the gating exemption resolve.
        builder.Services.AddScoped<StaffAssignmentService>();
        builder.Services.RemoveAll<ICurrentStaffSessionAccessor>();
        builder.Services.AddScoped<ICurrentStaffSessionAccessor>(_ => accessor);

        // The native per-exercise clock. Program.cs registers this BEFORE the social services, and this host
        // must mirror that: the social read surface reaches FollowService (profiles-social-graph, #372), whose
        // constructor takes IExerciseClock. Without it the endpoints below build fine and then throw
        // "Unable to resolve service for type 'IExerciseClock'" at REQUEST time — which is how this host
        // stayed green on its own branch and went red only once #372 and this feature met on main.
        builder.Services.AddExerciseClock();

        // The real participant read/write surface (only the SignalR fan-out is stubbed).
        builder.Services.AddSocialFeedRead();
        builder.Services.AddSocialPersonaRead();
        builder.Services.AddSocialPostWrite();
        builder.Services.AddSingleton<IFeedBroadcaster, NoOpFeedBroadcaster>();

        // The feature under test, in the orchestrator's order: 01b's defaults first, this story after.
        builder.Services.AddExerciseConfiguration();
        builder.Services.AddExerciseLifecycle();
        configureServices?.Invoke(builder.Services);

        // The server-authoritative request scope (fixed per host; null = the fail-closed case).
        builder.Services.RemoveAll<IExerciseContext>();
        builder.Services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = currentExerciseId });

        var app = builder.Build();

        // The orchestrator's pipeline position: AFTER scope + session resolution (both fixed above).
        app.UseExerciseLifecycleGating();

        app.MapSocialFeedEndpoints();
        app.MapSocialThreadEndpoints();
        app.MapSocialPersonaEndpoints();
        app.MapSocialPostEndpoints();
        app.MapParticipantShellEndpoints();
        app.MapExerciseLifecycleEndpoints();

        // A stand-in for the pre-auth allowlist: an /api route that is NOT on the gated list must be
        // untouched by the gate no matter what state the exercise is in.
        app.MapGet("/api/exercise-context", () => Results.Ok(new { ok = true }));

        await app.StartAsync();

        return new ExerciseLifecycleTestHost(app, staffUserId);
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        Client.Dispose();
        await _app.DisposeAsync();
    }

    private static async Task SeedStaffAssignmentAsync(string connectionString, Guid staffUserId, Guid exerciseId)
    {
        await using var context = ExerciseLifecycleTestData.CreateContext(connectionString);

        if (!await context.Exercises.AsNoTracking().AnyAsync(e => e.Id == exerciseId))
        {
            context.Exercises.Add(ExerciseLifecycleTestData.ExerciseInState(exerciseId, "live"));
        }

        context.StaffAssignments.Add(new StaffAssignment
        {
            Id = Guid.NewGuid(),
            StaffUserId = staffUserId,
            ExerciseId = exerciseId,
            Role = "controller",
            CreatedAt = DateTimeOffset.UtcNow,
        });

        await context.SaveChangesAsync();
    }
}

/// <summary>A no-op <see cref="IFeedBroadcaster"/> — the SignalR fan-out is not what these suites assert.</summary>
public sealed class NoOpFeedBroadcaster : IFeedBroadcaster
{
    /// <inheritdoc />
    public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;
}

/// <summary>Seeding helpers for the lifecycle suites. Every test uses a fresh exercise id.</summary>
public static class ExerciseLifecycleTestData
{
    /// <summary>Builds an unscoped <see cref="PulseDbContext"/> against the test database.</summary>
    /// <param name="connectionString">The migrated test database.</param>
    /// <returns>A fresh context.</returns>
    public static PulseDbContext CreateContext(string connectionString)
    {
        ArgumentNullException.ThrowIfNull(connectionString);

        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(connectionString)
            .Options;

        return new PulseDbContext(options);
    }

    /// <summary>Builds an exercise row carrying the given raw <c>Status</c> value (canonical or legacy).</summary>
    /// <param name="exerciseId">The exercise id.</param>
    /// <param name="status">The raw status literal to store.</param>
    /// <returns>The entity to add.</returns>
    public static Exercise ExerciseInState(Guid exerciseId, string status) => new()
    {
        Id = exerciseId,
        Name = "Lifecycle Test Exercise",
        TimeZone = "UTC",
        Status = status,
    };

    /// <summary>Builds a visible post in the given exercise, so a served feed is provably non-empty.</summary>
    /// <param name="exerciseId">The owning exercise.</param>
    /// <param name="body">The post body.</param>
    /// <returns>The entity to add.</returns>
    public static Post PostIn(Guid exerciseId, string body) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        AuthorPersonaId = Guid.NewGuid(),
        Body = body,
        CreatedScenarioTime = new DateTimeOffset(2033, 3, 1, 12, 0, 0, TimeSpan.Zero),
        CreatedWallClock = DateTimeOffset.UtcNow,
        Origin = "participant",
        ActingHumanId = "human-1",
    };
}
