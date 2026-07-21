namespace Pulse.WebApi.Tests.Features.Identity.SharedAccess;

using System;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Features.Identity.SharedAccess;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// A minimal ASP.NET Core pipeline wiring the REAL host resolution, the REAL session middleware, and the REAL
/// shared-read-only slice in the same relative order <c>Program.cs</c> uses (<c>UseExerciseResolution()</c> →
/// <c>UseSessionAuthentication()</c> → endpoints). It maps the live <c>POST /api/auth/shared</c> login, a
/// <c>POST /test/sim-write</c> guarded by <see cref="ReadOnlyWriteDenialExtensions.DenyReadOnlySessions{TBuilder}"/>
/// (standing in for the orchestrator-guarded sim-write surface, e.g. <c>POST /api/posts</c>), and a
/// <c>GET /test/posts</c> scoped read — so a single end-to-end test can: log in with a shared credential, then
/// prove that session is denied a write (403) but sees only its own exercise's rows. This is the documented
/// "test middleware without a WebApplicationFactory" pattern (mirroring <c>SessionAuthenticationTestHost</c>);
/// <c>Program.cs</c> does not yet wire these routes (the orchestrator does that serially — this story must not
/// touch <c>Program.cs</c>).
/// </summary>
public sealed class SharedReadOnlyTestHost : IAsyncDisposable
{
    private readonly IHost _host;

    private SharedReadOnlyTestHost(IHost host) => _host = host;

    /// <summary>A fresh client whose base-address host populates <c>HttpContext.Request.Host</c> like a real <c>Host</c> header, optionally bearing a token.</summary>
    /// <param name="host">The request host to simulate.</param>
    /// <param name="bearerToken">The raw session token to present, or <c>null</c> for an anonymous request.</param>
    public HttpClient CreateClient(string host, string? bearerToken = null)
    {
        var client = _host.GetTestClient();
        client.BaseAddress = new Uri($"http://{host}");
        if (bearerToken is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        }

        return client;
    }

    /// <summary>Boots the pipeline against <paramref name="connectionString"/> (the shared Testcontainers SQL Server).</summary>
    public static async Task<SharedReadOnlyTestHost> StartAsync(string connectionString)
    {
        var configuration = new ConfigurationBuilder().Build();

        var host = await new HostBuilder()
            .ConfigureWebHost(webHost =>
            {
                webHost
                    .UseTestServer()
                    .ConfigureServices(services =>
                    {
                        services.AddRouting();
                        services.AddDbContext<PulseDbContext>(options => options.UseSqlServer(connectionString));
                        services.AddExerciseScoping();
                        services.AddExerciseResolution();
                        services.AddSessions(configuration);
                        services.AddSharedReadOnly();
                    })
                    .Configure(app =>
                    {
                        app.UseRouting();

                        // Program.cs order: host resolution (provisional) BEFORE session auth (precedence).
                        app.UseExerciseResolution();
                        app.UseSessionAuthentication();
                        app.UseRateLimiter();

                        app.UseEndpoints(endpoints =>
                        {
                            endpoints.MapSharedReadOnlyEndpoints();

                            // Stands in for the real sim-write surface (e.g. POST /api/posts). Wired EXACTLY the
                            // way the orchestrator guards the pre-existing Social write without editing that slice:
                            // a group carrying the read-only write filter, with the sim-write endpoint mapped
                            // through it. Reaching the handler resolves the scope; a read-only session must be
                            // denied 403 by the filter BEFORE the handler runs.
                            var guardedSimWrites = endpoints.MapGroup(string.Empty).DenyReadOnlySessions();
                            guardedSimWrites.MapPost("/test/sim-write", (IExerciseContext exerciseContext) =>
                            {
                                var scope = exerciseContext.CurrentExerciseId;
                                return scope is null || scope.Value == Guid.Empty
                                    ? Results.Unauthorized()
                                    : Results.Ok(scope.Value.ToString());
                            });

                            // Scoped read: a read-only session for exercise A must see only A's posts (zero B).
                            endpoints.MapGet("/test/posts", async (PulseDbContext dbContext) =>
                                Results.Ok(await dbContext.Posts
                                    .OrderBy(post => post.Id)
                                    .Select(post => post.Id)
                                    .ToListAsync()));
                        });
                    });
            })
            .StartAsync();

        return new SharedReadOnlyTestHost(host);
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        await _host.StopAsync();
        _host.Dispose();
    }
}
