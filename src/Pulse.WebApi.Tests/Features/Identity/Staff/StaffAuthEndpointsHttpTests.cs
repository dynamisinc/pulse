namespace Pulse.WebApi.Tests.Features.Identity.Staff;

using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// HTTP-level coverage of the three staff-auth endpoints (story 05) over a self-hosted
/// <see cref="TestServer"/> that maps <see cref="StaffAuthEndpoints.MapStaffAuthEndpoints"/> directly. These
/// are plain <c>[Fact]</c> (no Docker): they exercise only the FAIL-CLOSED paths that short-circuit BEFORE any
/// database access (bad body / missing field / no authenticated staff session), proving route + verb mapping,
/// model binding, and status mapping. The DB-backed happy paths are covered by the service-level
/// <c>[RequiresDockerFact]</c> tests. A self-hosted server is used because <c>Program.cs</c> does not map these
/// routes during this wave (the orchestrator wires them serially in Wave 2 — this story must not edit
/// <c>Program.cs</c>), so <c>WebApplicationFactory&lt;Program&gt;</c> would not yet serve them.
/// </summary>
public sealed class StaffAuthEndpointsHttpTests
{
    private static async Task<IHost> StartHostAsync()
    {
        var configuration = new ConfigurationBuilder().Build();

        return await new HostBuilder()
            .ConfigureWebHost(web =>
            {
                web.UseTestServer();
                web.ConfigureServices(services =>
                {
                    services.AddRouting();

                    // The slice under test + the cross-wave collaborators it needs registered. The DbContext
                    // uses a never-connecting string — every path asserted here returns before touching it.
                    services.AddStaffIdentity(configuration);
                    services.AddDbContext<PulseDbContext>(options =>
                        options.UseSqlServer("Server=nonexistent;Database=pulse;Trusted_Connection=False;"));
                    services.AddScoped<IExerciseContext, ExerciseContext>();
                    services.AddScoped<ISessionIssuer, RecordingSessionIssuer>();
                });
                web.Configure(app =>
                {
                    app.UseRouting();
                    app.UseRateLimiter();
                    app.UseEndpoints(endpoints => endpoints.MapStaffAuthEndpoints());
                });
            })
            .StartAsync();
    }

    [Fact]
    public async Task StaffLogin_NullBody_Returns400()
    {
        using var host = await StartHostAsync();
        using var client = host.GetTestClient();

        var response = await client.PostAsync("/api/auth/staff/login", new StringContent("null", System.Text.Encoding.UTF8, "application/json"));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "a missing login body is a 400, never a default session");
    }

    [Fact]
    public async Task StaffLogin_MissingUsername_Returns400()
    {
        using var host = await StartHostAsync();
        using var client = host.GetTestClient();

        var response = await client.PostAsJsonAsync("/api/auth/staff/login", new { secret = "pw-123456", exerciseId = Guid.NewGuid().ToString() });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "a missing username fails validation before any DB access");
    }

    [Fact]
    public async Task StaffLogin_InvalidExerciseId_Returns400()
    {
        using var host = await StartHostAsync();
        using var client = host.GetTestClient();

        var response = await client.PostAsJsonAsync("/api/auth/staff/login", new { username = "ctrl", secret = "pw-123456", exerciseId = "not-a-guid" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "a non-GUID exerciseId fails validation before any DB access");
    }

    [Fact]
    public async Task StaffAssignments_NoAuthenticatedStaffSession_Returns401()
    {
        using var host = await StartHostAsync();
        using var client = host.GetTestClient();

        // The default fail-closed NullCurrentStaffSessionAccessor yields no session → 401 before any query.
        var response = await client.GetAsync("/api/staff/assignments");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "assignments are staff-only and fail closed with no authenticated staff session");
    }

    [Fact]
    public async Task StaffActiveExercise_NonGuidBody_Returns400()
    {
        using var host = await StartHostAsync();
        using var client = host.GetTestClient();

        var response = await client.PostAsJsonAsync("/api/staff/active-exercise", new { exerciseId = "not-a-guid" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "a non-GUID exerciseId is a 400 at the endpoint");
    }

    [Fact]
    public async Task StaffActiveExercise_ValidGuidButNoStaffSession_Returns401()
    {
        using var host = await StartHostAsync();
        using var client = host.GetTestClient();

        var response = await client.PostAsJsonAsync("/api/staff/active-exercise", new { exerciseId = Guid.NewGuid().ToString() });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "with no authenticated staff session the switch fails closed before touching the DB");
    }
}
