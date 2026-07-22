namespace Pulse.WebApi.Tests.Features.ExerciseResolution;

using System;
using System.Linq;
using System.Net.Http;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.ExerciseResolution;

/// <summary>
/// A minimal, story-08-only ASP.NET Core pipeline — the documented "test middleware without a
/// <c>WebApplicationFactory</c>" pattern (<c>new HostBuilder().ConfigureWebHost(...).UseTestServer()</c>) —
/// deliberately NOT <see cref="Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory{TEntryPoint}"/> over
/// <c>Program</c>. <c>Program.cs</c> does not yet call
/// <see cref="ExerciseResolutionExtensions.AddExerciseResolution"/> /
/// <see cref="ExerciseResolutionExtensions.UseExerciseResolution"/> /
/// <see cref="ExerciseContextEndpoints.MapExerciseContextEndpoints"/> (that composition-root wiring is a
/// later, orchestrator-owned wave), so this harness registers exactly the story-08 seam directly:
/// persistence + exercise scoping + host resolution (DI and middleware, in the same relative order
/// <c>Program.cs</c> will eventually use) plus the frozen <c>/api/exercise-context</c> endpoint, plus one
/// test-only endpoint (<c>GET /test/posts</c>) that reads <see cref="Data.Entities.Post"/> — an
/// <see cref="IExerciseScoped"/> entity — through the SAME request-scoped <see cref="PulseDbContext"/> the
/// middleware's scope write feeds.
/// </summary>
/// <remarks>
/// Minimal-API parameter binding constructs that <see cref="PulseDbContext"/> lazily, at
/// endpoint-invocation time — i.e. AFTER <see cref="ExerciseResolutionMiddleware"/> has already run (it sits
/// earlier in the pipeline, before <c>UseEndpoints</c>) — so a correct A-host request seeing A's own rows
/// (rather than zero) is itself the proof that the scope write lands before the scoped read is constructed,
/// pinning the load-bearing "throwaway resolver scope, lazy request-scoped endpoint context" ordering
/// decision documented on <see cref="HostExerciseResolver"/>.
/// </remarks>
public sealed class ExerciseResolutionTestHost : IAsyncDisposable
{
    private readonly IHost _host;

    private ExerciseResolutionTestHost(IHost host)
    {
        _host = host;
    }

    /// <summary>
    /// A fresh in-memory <see cref="HttpClient"/> against this pipeline with <see cref="HttpClient.BaseAddress"/>
    /// set to <c>http://{host}</c>, so <c>TestServer</c> populates <c>HttpContext.Request.Host</c> from
    /// <paramref name="host"/> exactly as a real request's <c>Host</c> header would.
    /// </summary>
    /// <param name="host">The request host to simulate (e.g. an exercise's provisioned <c>Hostname</c>).</param>
    public HttpClient CreateClientForHost(string host)
    {
        var client = _host.GetTestClient();
        client.BaseAddress = new Uri($"http://{host}");
        return client;
    }

    /// <summary>Boots the pipeline against <paramref name="connectionString"/> (the shared Testcontainers SQL Server).</summary>
    public static async Task<ExerciseResolutionTestHost> StartAsync(string connectionString)
    {
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
                    })
                    .Configure(app =>
                    {
                        app.UseRouting();

                        // Same relative ordering Program.cs will eventually use: host resolution runs before
                        // endpoint execution (there is no session/auth layer yet in Wave 1 to run after).
                        app.UseExerciseResolution();

                        app.UseEndpoints(endpoints =>
                        {
                            endpoints.MapExerciseContextEndpoints();

                            // Test-only scoped read (not part of the story's shipped surface): any
                            // IExerciseScoped entity would do; Post mirrors the standing isolation suite's own
                            // choice (QueryFilterIsolationTests / FeedThreadIsolationTests).
                            endpoints.MapGet("/test/posts", async (PulseDbContext dbContext) =>
                                Results.Ok(await dbContext.Posts
                                    .OrderBy(post => post.Id)
                                    .Select(post => post.Id)
                                    .ToListAsync()));
                        });
                    });
            })
            .StartAsync();

        return new ExerciseResolutionTestHost(host);
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        await _host.StopAsync();
        _host.Dispose();
    }
}
