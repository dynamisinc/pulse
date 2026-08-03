namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration.Chrome;

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
using Pulse.WebApi.Features.ExerciseConfiguration.Chrome;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.ParticipantShell;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// A minimal host wired EXACTLY as the orchestrator will wire story 02 into <c>Program.cs</c> — 01b's
/// <c>AddExerciseConfiguration()</c> first, then this story's OWN
/// <see cref="ChromeExtensions.AddComplianceChromeConfig"/> and
/// <see cref="ChromeExtensions.MapComplianceChromeEndpoints"/>, alongside the already-wired
/// <c>MapParticipantShellEndpoints()</c> — against the shared migrated real SQL Server.
/// </summary>
/// <remarks>
/// <para>
/// Story 02 stands up its OWN host rather than extending 01b's <c>ExerciseConfigurationTestHost</c>: that file
/// belongs to a shipped story and is shared with the concurrent wave-3 builders, and this one has to vary a
/// knob 01b's does not have — whether story 02's slice is wired at all
/// (<c>includeComplianceChromeSlice</c>), which is what makes the "the contributed projection is what actually
/// serves" assertions non-vacuous rather than merely true-by-construction.
/// </para>
/// <para>
/// The other knobs are the three things the staff-gate tests need: the server-resolved exercise scope
/// (<c>null</c> for the fail-closed case), whether the caller has a live STAFF session, and which exercise
/// that staff user is assigned to (so the not-assigned 403 is provable).
/// </para>
/// </remarks>
public sealed class ChromeTestHost : IAsyncDisposable
{
    private readonly WebApplication _app;

    private ChromeTestHost(WebApplication app, Guid staffUserId)
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
    /// <param name="includeComplianceChromeSlice">
    /// Whether story 02's own <c>AddComplianceChromeConfig()</c> / <c>MapComplianceChromeEndpoints()</c> are
    /// wired. <c>false</c> is the NEGATIVE CONTROL: 01b's constant-preserving default serves and the staff
    /// chrome routes do not exist.
    /// </param>
    /// <returns>The started host.</returns>
    public static async Task<ChromeTestHost> StartAsync(
        string connectionString,
        Guid? currentExerciseId,
        bool authenticatedStaff = true,
        Guid? assignedExerciseId = null,
        bool includeComplianceChromeSlice = true)
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

        // B2's staff-identity dependencies the shared staff gate resolves per request.
        builder.Services.AddScoped<StaffAssignmentService>();
        builder.Services.RemoveAll<ICurrentStaffSessionAccessor>();
        builder.Services.AddScoped<ICurrentStaffSessionAccessor>(_ => accessor);

        // The orchestrator's order: 01b's constant-preserving defaults first, story 02's contribution after.
        builder.Services.AddExerciseConfiguration();
        if (includeComplianceChromeSlice)
        {
            builder.Services.AddComplianceChromeConfig();
        }

        // The server-authoritative request scope (fixed per host; null = the fail-closed case).
        builder.Services.RemoveAll<IExerciseContext>();
        builder.Services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = currentExerciseId });

        var app = builder.Build();
        app.MapParticipantShellEndpoints();
        if (includeComplianceChromeSlice)
        {
            app.MapComplianceChromeEndpoints();
        }

        await app.StartAsync();

        return new ChromeTestHost(app, staffUserId);
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        Client.Dispose();
        await _app.DisposeAsync();
    }

    /// <summary>
    /// Seeds the <see cref="Exercise"/> + <see cref="StaffAssignment"/> rows the staff gate reads. Both are
    /// unscoped entities, so the write-guard needs no resolved exercise scope here. The exercise row is created
    /// only when it does not already exist, so a test may seed a configured exercise first.
    /// </summary>
    private static async Task SeedStaffAssignmentAsync(string connectionString, Guid staffUserId, Guid exerciseId)
    {
        await using var context = ExerciseConfigurationTestData.CreateContext(connectionString);

        if (!await ExerciseConfigurationTestData.ExerciseExistsAsync(context, exerciseId))
        {
            context.Exercises.Add(new Exercise
            {
                OrganizationId = Organization.DefaultOrganizationId,
                Id = exerciseId,
                Name = "Chrome Test Exercise",
                TimeZone = "UTC",
                Status = "live",
            });
        }

        // exercise-isolation/11: the staff human the session names must EXIST and share the exercise's
        // customer tenant, or the org bound fails closed and every staff endpoint 403s.
        context.StaffUsers.Add(StaffTenantSeed.StaffUserFor(staffUserId));
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
