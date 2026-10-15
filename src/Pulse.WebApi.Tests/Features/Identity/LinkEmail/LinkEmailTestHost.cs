namespace Pulse.WebApi.Tests.Features.Identity.LinkEmail;

using System;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.LinkEmail;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// A minimal host wired the way the backend seam commit will wire story 13 (persistence + exercise scoping, the
/// exercise clock, <c>AddLinkEmail()</c> (which brings the easy-login kernel), <c>MapLinkEmailEndpoints()</c>) behind the
/// SHIPPED filters (<c>EngineCockpitStaffAuthorizationFilter</c> + <c>RosterStaffRoleFilter</c>), the real
/// <see cref="StaffAssignmentService"/> and the REAL token-backed <see cref="CurrentStaffSessionAccessor"/>. Self-hosted
/// because <c>Program.cs</c> does not map the route yet (the orchestrator wires it). The test sets the resolved
/// exercise, the key ring, the <c>Email:*</c> configuration and (optionally) the mailer; with <c>mailer: null</c> the
/// host composes its own, so an unconfigured host gets the real fail-closed <see cref="NullParticipantLinkMailer"/>.
/// </summary>
internal sealed class LinkEmailTestHost : IAsyncDisposable
{
    private readonly WebApplication _app;
    private readonly ScopeHolder _scope;

    private LinkEmailTestHost(WebApplication app, ScopeHolder scope)
    {
        _app = app;
        _scope = scope;
    }

    public IServiceProvider Services => _app.Services;

    /// <summary>Starts a host. <paramref name="emailConfigured"/> sets (or leaves unset) <c>Email:Endpoint</c> and <c>Email:SenderAddress</c>.</summary>
    public static async Task<LinkEmailTestHost> StartAsync(
        string connectionString,
        IDataProtectionProvider keyRing,
        IParticipantLinkMailer? mailer,
        bool emailConfigured = true,
        LinkEmailCapturingLoggerProvider? logs = null)
    {
        var scope = new ScopeHolder();

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        if (logs is not null)
        {
            builder.Logging.AddProvider(logs);
        }

        builder.Configuration["ConnectionStrings:DefaultConnection"] = connectionString;
        builder.Configuration[JoinUrlBuilder.FrontendBaseUrlKey] = LinkEmailTestWorld.FrontendBase;
        if (emailConfigured)
        {
            builder.Configuration[LinkEmailSettings.EndpointKey] = LinkEmailTestWorld.AcsEndpoint;
            builder.Configuration[LinkEmailSettings.SenderAddressKey] = LinkEmailTestWorld.Sender;
        }

        builder.Services.AddPulsePersistence(builder.Configuration);
        builder.Services.AddExerciseScoping();
        builder.Services.AddExerciseClock();
        if (mailer is not null)
        {
            builder.Services.AddSingleton(mailer);
        }

        builder.Services.AddLinkEmail();
        builder.Services.Configure<LinkEmailPacing>(options => options.SendPause = TimeSpan.Zero);
        builder.Services.AddSingleton(keyRing);

        builder.Services.AddHttpContextAccessor();
        builder.Services.AddScoped<StaffAssignmentService>();
        builder.Services.RemoveAll<ICurrentStaffSessionAccessor>();
        builder.Services.AddScoped<ICurrentStaffSessionAccessor, CurrentStaffSessionAccessor>();

        builder.Services.RemoveAll<IExerciseContext>();
        builder.Services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = scope.ExerciseId });

        var app = builder.Build();
        app.MapLinkEmailEndpoints();
        await app.StartAsync();

        return new LinkEmailTestHost(app, scope);
    }

    /// <summary>Resolves every following request to <paramref name="exerciseId"/> (<c>null</c> = unresolved).</summary>
    public void ScopeTo(Guid? exerciseId) => _scope.ExerciseId = exerciseId;

    /// <summary>A client presenting <paramref name="bearerToken"/> (or no credential).</summary>
    public HttpClient Client(string? bearerToken)
    {
        var client = _app.GetTestClient();
        if (bearerToken is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        }

        return client;
    }

    /// <summary>POSTs <paramref name="body"/> verbatim to the email-links route.</summary>
    public static Task<HttpResponseMessage> PostAsync(HttpClient client, string body, string contentType = "application/json") =>
        client.PostAsync(LinkEmailEndpoints.EmailLinksRoute, new StringContent(body, Encoding.UTF8, contentType));

    /// <summary>The JSON for <c>{ "participantIds": [ … ] }</c>.</summary>
    public static string IdsJson(params object[] ids) =>
        $"{{\"participantIds\":[{string.Join(",", ids.Select(id => $"\"{id}\""))}]}}";

    /// <summary>The JSON for "every eligible participant".</summary>
    public const string EveryoneJson = "{}";

    /// <summary>Seeds a live STAFF session for <paramref name="staffUserId"/> active on <paramref name="exerciseId"/>.</summary>
    public static async Task<string> SeedStaffSessionAsync(LinkEmailTestWorld world, Guid staffUserId, Guid exerciseId)
    {
        var token = $"email-staff-{Guid.NewGuid():N}";
        var session = TestSessions.NewSession(token, exerciseId, kind: "staff");
        session.StaffUserId = staffUserId;
        session.PrincipalId = staffUserId.ToString();

        await using var seed = world.Fixture.CreateContext();
        seed.Sessions.Add(session);
        await seed.SaveChangesAsync();
        return token;
    }

    /// <summary>Seeds a live PARTICIPANT session in <paramref name="exerciseId"/>.</summary>
    public static async Task<string> SeedParticipantSessionAsync(LinkEmailTestWorld world, Guid exerciseId)
    {
        var token = $"email-participant-{Guid.NewGuid():N}";
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
