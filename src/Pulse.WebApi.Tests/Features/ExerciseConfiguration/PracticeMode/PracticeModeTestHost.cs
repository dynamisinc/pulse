namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration.PracticeMode;

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
using Pulse.WebApi.Features.ExerciseConfiguration.PracticeMode;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.ParticipantShell;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// A minimal host wired EXACTLY as the orchestrator will wire story 04 into <c>Program.cs</c> —
/// <c>AddPracticeMode()</c> + <c>MapPracticeModeEndpoints()</c>, placed AFTER story 01b's
/// <c>AddExerciseConfiguration()</c> — against the shared migrated real SQL Server.
/// </summary>
/// <remarks>
/// <para>
/// This story owns its own host rather than extending 01b's <c>ExerciseConfigurationTestHost</c>: two wave-3
/// builders editing one shared test helper is the same collision the feature avoids in the production slice,
/// and story 04's host needs its OWN <c>Map*</c> call, which 01b's does not make.
/// </para>
/// <para>
/// The knobs are what the tests must vary: the server-resolved exercise scope (<c>null</c> for the fail-closed
/// case), whether the caller has a live STAFF session, and which exercise that staff user is assigned to (so
/// the not-assigned 403 is provable). The six participant-shell config GETs are mapped too, so the "practice
/// mode changes nothing else and never reaches a participant surface" assertions run against the REAL shell
/// handlers rather than a stand-in.
/// </para>
/// </remarks>
public sealed class PracticeModeTestHost : IAsyncDisposable
{
    private readonly WebApplication _app;

    private PracticeModeTestHost(WebApplication app, Guid staffUserId)
    {
        _app = app;
        StaffUserId = staffUserId;
        Client = app.GetTestClient();
    }

    /// <summary>The HTTP client bound to the in-memory test server.</summary>
    public HttpClient Client { get; }

    /// <summary>The staff user the stubbed staff-session accessor reports (also the telemetry actor).</summary>
    public Guid StaffUserId { get; }

    /// <summary>The host's root service provider — the FULLY COMPOSED provider the DI-resolution AC resolves from.</summary>
    public IServiceProvider Services => _app.Services;

    /// <summary>Starts the host.</summary>
    /// <param name="connectionString">The migrated test database.</param>
    /// <param name="currentExerciseId">The server-resolved scope; <c>null</c> is the fail-closed case.</param>
    /// <param name="authenticatedStaff">Whether the caller has a live staff session.</param>
    /// <param name="assignedExerciseId">The exercise the staff user is assigned to (defaults to the resolved scope).</param>
    /// <returns>The started host.</returns>
    public static async Task<PracticeModeTestHost> StartAsync(
        string connectionString,
        Guid? currentExerciseId,
        bool authenticatedStaff = true,
        Guid? assignedExerciseId = null)
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

        // The feature in the orchestrator's declared order: 01b's slice first, this story's contribution after.
        builder.Services.AddExerciseConfiguration();
        builder.Services.AddPracticeMode();

        // The server-authoritative request scope (fixed per host; null = the fail-closed case).
        builder.Services.RemoveAll<IExerciseContext>();
        builder.Services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = currentExerciseId });

        var app = builder.Build();
        app.MapParticipantShellEndpoints();
        app.MapPracticeModeEndpoints();
        await app.StartAsync();

        return new PracticeModeTestHost(app, staffUserId);
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
    /// created only when it does not already exist, so a test may seed a flagged exercise first.
    /// </summary>
    private static async Task SeedStaffAssignmentAsync(string connectionString, Guid staffUserId, Guid exerciseId)
    {
        await using var context = ExerciseConfigurationTestData.CreateContext(connectionString);

        if (!await ExerciseConfigurationTestData.ExerciseExistsAsync(context, exerciseId))
        {
            context.Exercises.Add(new Exercise
            {
                Id = exerciseId,
                // Leak-word-free by design: the shell-config assertions reject any body containing
                // "practice"/"sandbox", so a fixture name carrying those words would one day fail on
                // ITSELF rather than on a real XC-002 leak. See PracticeModeEndpointsTests.SeedExerciseAsync.
                Name = "Rehearsal Fixture Host Exercise",
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
