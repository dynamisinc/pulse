namespace Pulse.WebApi.Tests.Features.Social;

using System;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Social;

/// <summary>
/// The shared test host for story <c>social-api/01-feed-read-api</c> (#270): <c>GET /api/feed</c> and
/// <c>GET /api/threads/{postId}</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this factory maps the endpoints itself.</b> Per <c>docs/features/social-api/implementation.md</c>
/// ("Integration seam (orchestrator-owned — never a wave story)"), wiring <c>AddSocialFeedRead()</c> /
/// <c>MapSocialFeedEndpoints()</c> / <c>MapSocialThreadEndpoints()</c> into <c>Program.cs</c> is explicitly
/// NOT this story's builder's job — it lands as a later, serial, orchestrator-owned composition-root edit.
/// So as of this commit <c>Program.cs</c> does not yet call any of the three, and a plain
/// <c>WebApplicationFactory&lt;Program&gt;</c> (the <c>TelemetryIngestTests</c> pattern) would 404 both
/// routes. This factory registers the service (<see cref="MapSocialEndpointsStartupFilter"/>) the same way
/// the eventual <c>Program.cs</c> edit will, purely at the test boundary — it does NOT touch
/// <c>Pulse.WebApi/Program.cs</c> or any production file.
/// </para>
/// <para>
/// Otherwise mirrors <c>Telemetry/TelemetryIngestTests.cs</c>'s <c>TelemetryWebApplicationFactory</c>: feeds
/// the Testcontainers connection string via the <c>ConnectionStrings__DefaultConnection</c> process env var
/// (set before <c>builder.Build()</c> captures config, cleared on dispose), and optionally overrides the
/// scoped <see cref="IExerciseContext"/> so a test can drive the endpoints as a specific exercise (or as an
/// unresolved scope, by passing <c>exerciseId: null</c>).
/// </para>
/// </remarks>
public sealed class SocialApiWebApplicationFactory : WebApplicationFactory<Program>
{
    private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

    private readonly Guid? _exerciseId;

    public SocialApiWebApplicationFactory(string connectionString, Guid? exerciseId)
    {
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);
        _exerciseId = exerciseId;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.ConfigureServices(services =>
        {
            services.AddSocialFeedRead();
            services.AddSingleton<IStartupFilter>(new MapSocialEndpointsStartupFilter());
        });

        builder.ConfigureTestServices(services =>
        {
            // Per the harness rules: set the request's exercise scope by replacing the registered
            // IExerciseContext, mirroring exercise-isolation/01's own DI-injection proof
            // (QueryFilterIsolationTests.AddDbContext_InjectsRegisteredExerciseContext_DrivingTheFilter).
            services.RemoveAll<IExerciseContext>();
            services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = _exerciseId });
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
    }
}

/// <summary>
/// Maps the story's two read endpoints onto the test host's pipeline — the test-only stand-in for the
/// orchestrator's future <c>Program.cs</c> edit (see <see cref="SocialApiWebApplicationFactory"/> remarks).
/// <see cref="IStartupFilter"/> is the documented, supported ASP.NET Core seam for adding endpoints to a
/// minimal-hosting-model app (<c>WebApplication</c>) from a test host without touching the app's own
/// composition root.
/// </summary>
internal sealed class MapSocialEndpointsStartupFilter : IStartupFilter
{
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next)
    {
        ArgumentNullException.ThrowIfNull(next);

        return app =>
        {
            next(app);

            app.UseEndpoints(endpoints =>
            {
                endpoints.MapSocialFeedEndpoints();
                endpoints.MapSocialThreadEndpoints();
            });
        };
    }
}
