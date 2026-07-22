namespace Pulse.WebApi.Tests.Features.Identity.SharedAccess;

using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.SharedAccess;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// HTTP-level coverage of the two staff-only shared-credential lifecycle endpoints (story 07) over a self-hosted
/// <see cref="TestServer"/> that maps <see cref="SharedCredentialLifecycleEndpoints.MapSharedCredentialLifecycleEndpoints"/>
/// directly, plus DI-composition assertions. These are plain <c>[Fact]</c> (no Docker): they exercise the
/// FAIL-CLOSED staff-authz path that short-circuits BEFORE any database access (the fail-closed
/// <see cref="NullCurrentStaffSessionAccessor"/> yields no staff session → 401), proving route + verb mapping and
/// the staff-only gate. The DB-backed rotate/revoke behaviour is covered by the <c>[RequiresDockerFact]</c>
/// service tests. A self-hosted server is used because <c>Program.cs</c> does not map these routes during this
/// wave (the orchestrator wires them serially — this story must not edit <c>Program.cs</c>).
/// </summary>
public sealed class SharedCredentialLifecycleEndpointsHttpTests
{
    private static async Task<IHost> StartHostAsync()
    {
        return await new HostBuilder()
            .ConfigureWebHost(web =>
            {
                web.UseTestServer();
                web.ConfigureServices(services =>
                {
                    services.AddRouting();

                    // The slice under test + the collaborators it needs registered. The DbContext uses a
                    // never-connecting string — the staff-authz gate returns 401 before it is ever touched.
                    services.AddSharedCredentialLifecycle();
                    services.AddDbContext<PulseDbContext>(options =>
                        options.UseSqlServer("Server=nonexistent;Database=pulse;Trusted_Connection=False;"));
                    services.AddScoped<IExerciseContext, ExerciseContext>();

                    // The fail-closed default staff-session accessor (story 05): always "no staff session".
                    services.AddScoped<ICurrentStaffSessionAccessor, NullCurrentStaffSessionAccessor>();
                });
                web.Configure(app =>
                {
                    app.UseRouting();
                    app.UseEndpoints(endpoints => endpoints.MapSharedCredentialLifecycleEndpoints());
                });
            })
            .StartAsync();
    }

    [Fact]
    public async Task Rotate_NoAuthenticatedStaffSession_Returns401()
    {
        using var host = await StartHostAsync();
        using var client = host.GetTestClient();

        var response = await client.PostAsync("/api/staff/shared-credential/rotate", content: null);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "rotate is staff-only and fails closed with no authenticated staff session, before any DB access");
    }

    [Fact]
    public async Task Revoke_NoAuthenticatedStaffSession_Returns401()
    {
        using var host = await StartHostAsync();
        using var client = host.GetTestClient();

        var response = await client.PostAsync("/api/staff/shared-credential/revoke", content: null);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "revoke is staff-only and fails closed with no authenticated staff session, before any DB access");
    }

    [Fact]
    public async Task Rotate_WrongVerb_IsNotMappedForGet()
    {
        using var host = await StartHostAsync();
        using var client = host.GetTestClient();

        var response = await client.GetAsync("/api/staff/shared-credential/rotate");

        response.StatusCode.Should().Be(HttpStatusCode.MethodNotAllowed,
            "rotate is a POST-only endpoint — a GET is not routed to it");
    }

    [Fact]
    public void AddSharedCredentialLifecycle_ComposesWithAddSharedReadOnly_WithoutDuplicatingTheHasher()
    {
        // The coexistence guarantee: this slice reuses story 06's slow-KDF hasher and never re-registers a
        // duplicate. TryAddSingleton means the hasher is registered exactly once regardless of call order.
        var services = new ServiceCollection();
        services.AddSharedReadOnly();
        services.AddSharedCredentialLifecycle();

        services.Count(d => d.ServiceType == typeof(ISharedCredentialHasher)).Should().Be(
            1, "the shared-credential hasher must be registered exactly once across both slices (no duplicate)");
        services.Count(d => d.ServiceType == typeof(SharedCredentialLifecycleService)).Should().Be(
            1, "the lifecycle service is registered exactly once");
    }

    [Fact]
    public void AddSharedCredentialLifecycle_DoesNotRegisterRateLimiterPolicyOptions()
    {
        // The lifecycle endpoints are behind the staff-authz gate, not a limiter — so this slice must NOT touch
        // the rate limiter (no new policy, no global RejectionStatusCode reassignment). Called standalone it
        // registers no RateLimiterOptions configuration at all (Wave-3 Gate-2 coexistence flag).
        var services = new ServiceCollection();
        services.AddSharedCredentialLifecycle();

        services.Any(d => d.ServiceType.FullName is { } name && name.Contains("RateLimiter", System.StringComparison.Ordinal))
            .Should().BeFalse("the lifecycle slice registers no rate-limiting services — it reuses story 06's shared-login policy for the login and gates its own endpoints by staff authz");
    }
}
