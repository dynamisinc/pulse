namespace Pulse.WebApi.Tests.Features.Identity.LinkCards;

using System;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.LinkCards;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// A minimal host wired the way the backend seam commit will wire story 04 (persistence + exercise scoping, the
/// exercise clock, <c>AddLinkCards()</c> (which brings the easy-login kernel), <c>MapLinkCardEndpoints()</c>) behind the
/// SHIPPED filters (<c>EngineCockpitStaffAuthorizationFilter</c> + <c>RosterStaffRoleFilter</c>), the real
/// <see cref="StaffAssignmentService"/> and the REAL <see cref="CurrentStaffSessionAccessor"/>, which resolves the
/// presented bearer token against a seeded <c>Session</c> row. Self-hosted because <c>Program.cs</c> does not map the
/// route during this wave (the orchestrator wires it). Only two edges are set by the test: the resolved exercise (in
/// production, host resolution + the session middleware) and the Data Protection key ring (shared with the seeding).
/// </summary>
/// <remarks>
/// By default it runs on <see cref="TestServer"/>. With <c>realKestrel: true</c> it listens on a real loopback socket
/// (port 0, so the OS picks a free one), because only real Kestrel enforces the request-line and body limits that
/// motivated EL-20: a TestServer test cannot see a 414.
/// </remarks>
internal sealed class LinkCardTestHost : IAsyncDisposable
{
    private readonly WebApplication _app;
    private readonly ScopeHolder _scope;
    private readonly Uri? _kestrelAddress;

    private LinkCardTestHost(WebApplication app, ScopeHolder scope, Uri? kestrelAddress)
    {
        _app = app;
        _scope = scope;
        _kestrelAddress = kestrelAddress;
    }

    /// <summary>Starts a host over <paramref name="connectionString"/> with the given join base (<c>null</c> = unset).</summary>
    public static async Task<LinkCardTestHost> StartAsync(
        string connectionString,
        IDataProtectionProvider keyRing,
        string? frontendBase = LinkCardTestWorld.FrontendBase,
        bool realKestrel = false)
    {
        var scope = new ScopeHolder();

        var builder = WebApplication.CreateBuilder();
        if (realKestrel)
        {
            builder.WebHost.UseUrls("http://127.0.0.1:0");
        }
        else
        {
            builder.WebHost.UseTestServer();
        }

        builder.Configuration["ConnectionStrings:DefaultConnection"] = connectionString;
        builder.Configuration[JoinUrlBuilder.FrontendBaseUrlKey] = frontendBase;

        builder.Services.AddPulsePersistence(builder.Configuration);
        builder.Services.AddExerciseScoping();
        builder.Services.AddExerciseClock();
        builder.Services.AddLinkCards();
        builder.Services.AddSingleton<IDataProtectionProvider>(keyRing);

        // The staff gate's B2 primitives: the assignment read and the real token-backed staff-session accessor.
        builder.Services.AddHttpContextAccessor();
        builder.Services.AddScoped<StaffAssignmentService>();
        builder.Services.RemoveAll<ICurrentStaffSessionAccessor>();
        builder.Services.AddScoped<ICurrentStaffSessionAccessor, CurrentStaffSessionAccessor>();

        // The resolved exercise for this request (production: host resolution, then the session middleware).
        builder.Services.RemoveAll<IExerciseContext>();
        builder.Services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = scope.ExerciseId });

        var app = builder.Build();
        app.MapLinkCardEndpoints();
        await app.StartAsync();

        Uri? address = null;
        if (realKestrel)
        {
            var bound = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses;
            address = new Uri(bound.Single());
        }

        return new LinkCardTestHost(app, scope, address);
    }

    /// <summary>Resolves every following request to <paramref name="exerciseId"/> (<c>null</c> = unresolved).</summary>
    public void ScopeTo(Guid? exerciseId) => _scope.ExerciseId = exerciseId;

    /// <summary>A client presenting <paramref name="bearerToken"/> (or no credential).</summary>
    public HttpClient Client(string? bearerToken)
    {
        var client = _kestrelAddress is { } address
            ? new HttpClient { BaseAddress = address }
            : _app.GetTestClient();
        if (bearerToken is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        }

        return client;
    }

    /// <summary>POSTs <paramref name="body"/> verbatim to the cards route with the given content type.</summary>
    public static Task<HttpResponseMessage> PostCardsAsync(HttpClient client, string body, string contentType = "application/json") =>
        client.PostAsync(LinkCardEndpoints.CardsRoute, new StringContent(body, Encoding.UTF8, contentType));

    /// <summary>The JSON for <c>{ "participantIds": [ … ] }</c>.</summary>
    public static string IdsJson(params object[] ids) =>
        $"{{\"participantIds\":[{string.Join(",", ids.Select(id => $"\"{id}\""))}]}}";

    /// <summary>The JSON for <c>{ "all": true }</c>.</summary>
    public const string AllJson = "{\"all\":true}";

    /// <summary>Seeds a live STAFF session for <paramref name="staffUserId"/> active on <paramref name="exerciseId"/>.</summary>
    public static async Task<string> SeedStaffSessionAsync(LinkCardTestWorld world, Guid staffUserId, Guid exerciseId)
    {
        var token = $"cards-staff-{Guid.NewGuid():N}";
        var session = TestSessions.NewSession(token, exerciseId, kind: "staff");
        session.StaffUserId = staffUserId;
        session.PrincipalId = staffUserId.ToString();

        await using var seed = world.Fixture.CreateContext();
        seed.Sessions.Add(session);
        await seed.SaveChangesAsync();
        return token;
    }

    /// <summary>Seeds a live PARTICIPANT session in <paramref name="exerciseId"/>.</summary>
    public static async Task<string> SeedParticipantSessionAsync(LinkCardTestWorld world, Guid exerciseId)
    {
        var token = $"cards-participant-{Guid.NewGuid():N}";
        Session session = TestSessions.NewSession(token, exerciseId, kind: "participant");

        await using var seed = world.Fixture.CreateContext();
        seed.Sessions.Add(session);
        await seed.SaveChangesAsync();
        return token;
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        await _app.StopAsync();
        await _app.DisposeAsync();
    }

    private sealed class ScopeHolder
    {
        public Guid? ExerciseId { get; set; }
    }
}
