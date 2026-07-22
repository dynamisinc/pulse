namespace Pulse.WebApi.Tests.Features.Identity.Accounts;

using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.Accounts;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// HTTP-level coverage of the account slice endpoints (story 02) over a self-hosted <see cref="TestServer"/> that
/// maps <see cref="AccountEndpoints.MapAccountEndpoints"/> directly. Plain <c>[Fact]</c> (no Docker): these
/// exercise only the FAIL-CLOSED paths that short-circuit BEFORE any database access (bad body / missing field /
/// no staff session / bad upload / rate limit), proving route + verb mapping, model binding, and status mapping.
/// DB-backed happy paths are the service-level <c>[RequiresDockerFact]</c> tests. A self-hosted server is used
/// because <c>Program.cs</c> does not map these routes this wave (the orchestrator wires them serially at merge).
/// </summary>
public sealed class AccountEndpointsHttpTests
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

                    // The slice under test + the cross-wave collaborators it depends on (story 03/05), stubbed.
                    // The DbContext uses a never-connecting string — every path asserted here returns first.
                    services.AddParticipantAccounts();
                    services.AddDbContext<PulseDbContext>(options =>
                        options.UseSqlServer("Server=nonexistent;Database=pulse;Trusted_Connection=False;"));
                    services.AddScoped<IExerciseContext, ExerciseContext>();
                    services.AddScoped<ISessionIssuer, RecordingSessionIssuer>();

                    // Fail-closed staff accessor → the staff endpoints 401 with no live staff session.
                    services.AddScoped<ICurrentStaffSessionAccessor, NullCurrentStaffSessionAccessor>();
                });
                web.Configure(app =>
                {
                    app.UseRouting();
                    app.UseRateLimiter();
                    app.UseEndpoints(endpoints => endpoints.MapAccountEndpoints());
                });
            })
            .StartAsync();
    }

    [Fact]
    public async Task ParticipantLogin_NullBody_Returns400()
    {
        using var host = await StartHostAsync();
        using var client = host.GetTestClient();

        var response = await client.PostAsync("/api/auth/login", new StringContent("null", Encoding.UTF8, "application/json"));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "a missing login body is a 400, never a default session");
    }

    [Fact]
    public async Task ParticipantLogin_MissingPassword_Returns400()
    {
        using var host = await StartHostAsync();
        using var client = host.GetTestClient();

        var response = await client.PostAsJsonAsync("/api/auth/login", new { username = "alice" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "a missing password fails validation before any DB access");
    }

    [Fact]
    public async Task ParticipantLogin_ExceedsPerIpRateLimit_Returns429()
    {
        // NFR-009: /api/auth/login is per-IP rate-limited (a fixed 10/minute window). Every request here fails
        // validation fast (a null body, never touching the DB), isolating the limiter: the 11th request within
        // the window must be rejected by the limiter itself (429), never reaching the handler.
        using var host = await StartHostAsync();
        using var client = host.GetTestClient();

        for (var attempt = 1; attempt <= 10; attempt++)
        {
            var response = await client.PostAsync("/api/auth/login", new StringContent("null", Encoding.UTF8, "application/json"));
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest, $"attempt {attempt} is within the configured 10/minute window");
        }

        var eleventh = await client.PostAsync("/api/auth/login", new StringContent("null", Encoding.UTF8, "application/json"));
        eleventh.StatusCode.Should().Be(HttpStatusCode.TooManyRequests,
            "the 11th participant-login attempt within the same window from the same caller must be rejected by the per-IP rate limiter (NFR-009)");
    }

    [Fact]
    public async Task StaffCreateAccount_NoStaffSession_Returns401()
    {
        using var host = await StartHostAsync();
        using var client = host.GetTestClient();

        var response = await client.PostAsJsonAsync("/api/staff/accounts", new { username = "x", displayName = "X", role = "participant" });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "account creation is staff-only and fails closed with no authenticated staff session, before any DB access");
    }

    [Fact]
    public async Task StaffCreateAccount_NullBody_Returns400()
    {
        using var host = await StartHostAsync();
        using var client = host.GetTestClient();

        var response = await client.PostAsync("/api/staff/accounts", new StringContent("null", Encoding.UTF8, "application/json"));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "a missing account body is a 400");
    }

    [Fact]
    public async Task StaffImport_NoStaffSession_Returns401()
    {
        using var host = await StartHostAsync();
        using var client = host.GetTestClient();

        using var content = CsvUpload("username,displayName,role\nalice,Alice,participant");
        var response = await client.PostAsync("/api/staff/accounts/import", content);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "import is staff-only and fails closed with no authenticated staff session, before any DB access");
    }

    [Fact]
    public async Task StaffImport_EmptyFile_Returns400()
    {
        using var host = await StartHostAsync();
        using var client = host.GetTestClient();

        using var content = CsvUpload(string.Empty);
        var response = await client.PostAsync("/api/staff/accounts/import", content);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "an empty CSV upload is rejected at the boundary");
    }

    [Fact]
    public async Task StaffImport_OversizedFile_Returns400()
    {
        using var host = await StartHostAsync();
        using var client = host.GetTestClient();

        var oversized = new string('a', AccountEndpoints.MaxImportFileBytes + 1);
        using var content = CsvUpload(oversized);
        var response = await client.PostAsync("/api/staff/accounts/import", content);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest,
            "an upload over the configured size limit is rejected at the boundary (a size guard, NFR-004)");
    }

    private static MultipartFormDataContent CsvUpload(string csv)
    {
        var content = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(Encoding.UTF8.GetBytes(csv));
        fileContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("text/csv");
        content.Add(fileContent, "file", "accounts.csv");
        return content;
    }
}
