namespace Pulse.WebApi.Tests.Features.Social;

using System;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// The shared test host for story <c>social-api/01-feed-read-api</c> (#270): <c>GET /api/feed</c> and
/// <c>GET /api/threads/{postId}</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Program.cs now owns the wiring.</b> The orchestrator's composition-root edit has landed:
/// <c>Program.cs</c> calls <c>AddSocialFeedRead()</c> and maps <c>MapSocialFeedEndpoints()</c> /
/// <c>MapSocialThreadEndpoints()</c> itself, so a plain <c>WebApplicationFactory&lt;Program&gt;</c> already
/// serves both routes. This factory therefore no longer self-maps the endpoints (doing so would DOUBLE-MAP
/// each route and raise an <c>AmbiguousMatchException</c> at request time); it only overrides the request's
/// exercise scope for a test.
/// </para>
/// <para>
/// Otherwise mirrors <c>Telemetry/TelemetryIngestTests.cs</c>'s <c>TelemetryWebApplicationFactory</c>: feeds
/// the Testcontainers connection string via the <c>ConnectionStrings__DefaultConnection</c> process env var
/// (set before <c>builder.Build()</c> captures config, cleared on dispose), and overrides the scoped
/// <see cref="IExerciseContext"/> so a test can drive the endpoints as a specific exercise (or as an
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

        // identity-auth-roles/11: these routes now require a LIVE session, not merely a resolved scope. Present
        // one for the same exercise the scope is faked as — the symmetric half of the same fiction. A test that
        // passes exerciseId: null stays anonymous, which is the fail-closed case those tests assert.
        builder.UseFakeAuthenticatedSession(_exerciseId);

        builder.ConfigureTestServices(services =>
        {
            // Per the harness rules: set the request's exercise scope by replacing the registered
            // IExerciseContext, mirroring exercise-isolation/01's own DI-injection proof
            // (QueryFilterIsolationTests.AddDbContext_InjectsRegisteredExerciseContext_DrivingTheFilter).
            services.RemoveAll<IExerciseContext>();
            services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = _exerciseId });

            // exercise-configuration/01b: the six participant-shell config GETs mapped by Program.cs now
            // resolve ParticipantShellConfigService, so the host needs the slice's registration. This call is
            // idempotent (AddScoped for the concrete services, TryAddScoped for the projection defaults), so
            // it stays correct once the orchestrator wires AddExerciseConfiguration() into Program.cs — and
            // until then it is what keeps these Program-booted tests exercising the real routes.
            services.AddExerciseConfiguration();
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
    }
}
