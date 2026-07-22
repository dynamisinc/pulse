namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

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
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// A minimal ASP.NET Core pipeline wiring the REAL Wave-1 host resolution AND the Wave-2 session middleware in
/// the same relative order <c>Program.cs</c> will use (<c>UseExerciseResolution()</c> → <c>UseSessionAuthentication()</c>),
/// plus a test-only <c>GET /test/posts</c> that reads <see cref="Data.Entities.Post"/> — an <c>IExerciseScoped</c>
/// entity — through the request-scoped <see cref="PulseDbContext"/> the middlewares' scope writes feed. This is
/// the documented "test middleware without a WebApplicationFactory" pattern (mirroring
/// <c>ExerciseResolutionTestHost</c>): <c>Program.cs</c> does not yet wire the session middleware (that is the
/// orchestrator's Wave-2 edit — this story must not touch <c>Program.cs</c>).
/// </summary>
/// <remarks>
/// Because the endpoint's <see cref="PulseDbContext"/> is constructed lazily at invocation time — AFTER both
/// middlewares have run — a request whose session resolves to exercise A seeing A's rows (not the host's) is
/// itself the proof that the session's scope write lands with precedence before the scoped read is constructed
/// (the load-bearing throwaway-scope ordering decision).
/// </remarks>
public sealed class SessionAuthenticationTestHost : IAsyncDisposable
{
    private readonly IHost _host;

    private SessionAuthenticationTestHost(IHost host) => _host = host;

    /// <summary>
    /// A fresh client whose <see cref="HttpClient.BaseAddress"/> host populates <c>HttpContext.Request.Host</c>
    /// exactly as a real <c>Host</c> header would, optionally carrying an <c>Authorization: Bearer</c> token.
    /// </summary>
    /// <param name="host">The request host to simulate.</param>
    /// <param name="bearerToken">The raw session token to present, or <c>null</c> for an anonymous request.</param>
    public HttpClient CreateClient(string host, string? bearerToken)
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
    public static async Task<SessionAuthenticationTestHost> StartAsync(string connectionString)
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
                            endpoints.MapSessionEndpoints();

                            // Test-only scoped read: any IExerciseScoped entity would do; Post mirrors the
                            // standing isolation suite's own choice.
                            endpoints.MapGet("/test/posts", async (PulseDbContext dbContext) =>
                                Results.Ok(await dbContext.Posts
                                    .OrderBy(post => post.Id)
                                    .Select(post => post.Id)
                                    .ToListAsync()));
                        });
                    });
            })
            .StartAsync();

        return new SessionAuthenticationTestHost(host);
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        await _host.StopAsync();
        _host.Dispose();
    }
}
