namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration;

using System;
using System.Net.Http;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.ParticipantShell;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// A minimal host wired EXACTLY as the orchestrator will wire story 01b into <c>Program.cs</c>
/// (<c>AddExerciseConfiguration()</c> + <c>MapExerciseConfigurationEndpoints()</c>, alongside the already
/// wired <c>MapParticipantShellEndpoints()</c>), against the shared migrated real SQL Server.
/// </summary>
/// <remarks>
/// <para>
/// Mirrors <c>EngineReviewEndpointsTests.EngineReviewTestHost</c>: it stands up the production prerequisites
/// (<c>AddPulsePersistence</c>, <c>AddExerciseScoping</c>, B2's staff-identity pieces the shared staff gate
/// resolves) and then the feature itself, so the HTTP tests exercise the real DI graph rather than a
/// hand-assembled service.
/// </para>
/// <para>
/// The knobs are the three things the tests need to vary: the server-resolved exercise scope (<c>null</c>
/// for the fail-closed case), whether the caller has a live STAFF session, and which exercise that staff
/// user is assigned to (so the not-assigned 403 is provable). A <paramref name="configureContributor"/> hook
/// lets a test play the part of a wave-3 story contributing a projection over 01b's default.
/// </para>
/// </remarks>
public sealed class ExerciseConfigurationTestHost : IAsyncDisposable
{
    private readonly WebApplication _app;

    private ExerciseConfigurationTestHost(WebApplication app, Guid staffUserId)
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
    /// <param name="authenticatedStaff">Whether the caller has a live staff session.</param>
    /// <param name="assignedExerciseId">The exercise the staff user is assigned to (defaults to the resolved scope).</param>
    /// <param name="configureContributor">A hook standing in for a wave-3 story's own <c>Add*()</c> extension.</param>
    /// <returns>The started host.</returns>
    public static async Task<ExerciseConfigurationTestHost> StartAsync(
        string connectionString,
        Guid? currentExerciseId,
        bool authenticatedStaff = true,
        Guid? assignedExerciseId = null,
        Action<IServiceCollection>? configureContributor = null)
    {
        ArgumentNullException.ThrowIfNull(connectionString);

        var staffUserId = Guid.NewGuid();
        var accessor = authenticatedStaff
            ? new StubCurrentStaffSessionAccessor(new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = staffUserId })
            : new StubCurrentStaffSessionAccessor(null);

        if (authenticatedStaff && (assignedExerciseId ?? currentExerciseId) is { } assignExercise)
        {
            await SeedStaffAssignmentAsync(connectionString, staffUserId, assignExercise);
        }

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Configuration["ConnectionStrings:DefaultConnection"] = connectionString;

        builder.Services.AddPulsePersistence(builder.Configuration);
        builder.Services.AddExerciseScoping();

        // B2's staff-identity dependencies the shared staff gate resolves per request (the orchestrator wires
        // AddStaffIdentity ahead of this feature in production).
        builder.Services.AddScoped<StaffAssignmentService>();
        builder.Services.RemoveAll<ICurrentStaffSessionAccessor>();
        builder.Services.AddScoped<ICurrentStaffSessionAccessor>(_ => accessor);

        // The feature under test, in the orchestrator's order: 01b's defaults first, contributors after.
        builder.Services.AddExerciseConfiguration();
        configureContributor?.Invoke(builder.Services);

        // The server-authoritative request scope (fixed per host; null = the fail-closed case).
        builder.Services.RemoveAll<IExerciseContext>();
        builder.Services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = currentExerciseId });

        var app = builder.Build();
        app.MapParticipantShellEndpoints();
        app.MapExerciseConfigurationEndpoints();
        await app.StartAsync();

        return new ExerciseConfigurationTestHost(app, staffUserId);
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        Client.Dispose();
        await _app.DisposeAsync();
    }

    /// <summary>
    /// Seeds the <see cref="Exercise"/> + <see cref="StaffAssignment"/> rows the staff gate reads. Both are
    /// unscoped entities, so the write-guard needs no resolved exercise scope here. The exercise row is
    /// created only when it does not already exist, so a test may seed a configured exercise first.
    /// </summary>
    private static async Task SeedStaffAssignmentAsync(string connectionString, Guid staffUserId, Guid exerciseId)
    {
        await using var context = ExerciseConfigurationTestData.CreateContext(connectionString);

        if (!await ExerciseConfigurationTestData.ExerciseExistsAsync(context, exerciseId))
        {
            context.Exercises.Add(new Exercise
            {
                Id = exerciseId,
                Name = "Settings Test Exercise",
                TimeZone = "UTC",
                Status = "live",
            });
        }

        context.StaffAssignments.Add(new StaffAssignment
        {
            Id = Guid.NewGuid(),
            StaffUserId = staffUserId,
            ExerciseId = exerciseId,
            Role = "planner",
            CreatedAt = DateTimeOffset.UtcNow,
        });

        await context.SaveChangesAsync();
    }
}
