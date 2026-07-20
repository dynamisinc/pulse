using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Pulse.Core.Core.Extensions;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;

// Pulse.WebApi — the first runtime for the Pulse.Core engine (docs/BACKEND_ROADMAP.md §4, Phase B0).
// This composition root is orchestrator-owned from here on: only a story that adds a *new* DI
// registration (e.g. story 02's AddPulsePersistence) may add a line here, serially, between waves.
// Endpoint-only additions (a new [ApiController]) need no edit at all — AddControllers()/
// MapControllers() are registered once, below.

const string FrontendCorsPolicy = "FrontendCors";

var builder = WebApplication.CreateBuilder(args);

// The engine's existing composition root (Pulse.Core, unmodified) — prompt assembler, tier policy,
// and the config-selected generation provider (Fake by default; see appsettings.json).
builder.Services.AddEngineGeneration(builder.Configuration);

builder.Services.AddControllers();
builder.Services.AddHealthChecks();

// Persistence (story 02, #269) — orchestrator-wired composition-root call. Registers PulseDbContext
// (ConnectionStrings:DefaultConnection) plus a readiness-only DbContext health check. Its own extension
// file owns the registration; this single line is the only Program.cs edit story 02 requires.
builder.Services.AddPulsePersistence(builder.Configuration);

// Read-side exercise scoping (exercise-isolation/01, #44) — orchestrator-wired. Registers the scoped
// IExerciseContext that PulseDbContext's global query filter reads; it starts UNSET (fail-closed: an
// unresolved scope matches zero rows). Later stories (host/auth/staff-switch) populate it per request.
builder.Services.AddExerciseScoping();

// Social API (Phase B1, feature/social-api) — orchestrator-wired composition root. Each story exposes its
// own Add*/Map* extension (never edits this file itself); these five DI calls register the read/write
// services, the persona read, and the SignalR realtime host. AddSocialRealtimeHub also registers
// IFeedBroadcaster -> SignalRFeedBroadcaster (which PostIngestService calls after a successful persist) and
// AddSignalR(); it must be present alongside AddSocialPostWrite so the write path's broadcast resolves.
builder.Services.AddSocialFeedRead();      // #270 GET /api/feed, /api/threads/{id}
builder.Services.AddSocialPostWrite();     // #271 POST /api/posts (sanitize + stamp + telemetry + broadcast)
builder.Services.AddSocialPersonaRead();   // #273 GET /api/personas
builder.Services.AddSocialRealtimeHub();   // #272 exercise-grouped hub + IFeedBroadcaster impl

// CORS: allow exactly the configured frontend origin (Authentication__FrontendBaseUrl — the same app
// setting infrastructure/modules/webapp.bicep provisions for the Static Web App's URL). Fail closed
// (no cross-origin access at all) when the key is unset/empty rather than falling open.
var frontendBaseUrl = builder.Configuration["Authentication:FrontendBaseUrl"];

builder.Services.AddCors(options =>
{
    options.AddPolicy(FrontendCorsPolicy, policy =>
    {
        if (!string.IsNullOrWhiteSpace(frontendBaseUrl))
        {
            policy.WithOrigins(frontendBaseUrl).AllowAnyHeader().AllowAnyMethod();
        }
        else
        {
            policy.WithOrigins(Array.Empty<string>());
        }
    });
});

// Reads APPLICATIONINSIGHTS_CONNECTION_STRING from configuration; a missing/absent connection string
// (local development) is a documented no-throw no-op here, never a startup failure.
builder.Services.AddApplicationInsightsTelemetry();

var app = builder.Build();

app.UseCors(FrontendCorsPolicy);

// Liveness — no checks run (Predicate false), so it stays free of any DB/dependency coupling: the host
// is "up" regardless of database reachability (story 01 AC). Readiness (/health/ready) runs every
// registered check, including story 02's DbContext check, for deploy/orchestration probes.
app.MapHealthChecks("/health", new HealthCheckOptions { Predicate = _ => false });
app.MapHealthChecks("/health/ready");
app.MapControllers();

// Social API endpoints + realtime hub (Phase B1) — the orchestrator-owned endpoint mappings paired with the
// DI registrations above. Provenance is projected out server-side (XC-002) inside each endpoint; scope comes
// only from the resolved IExerciseContext (COR-001), never a client-supplied exerciseId.
app.MapSocialFeedEndpoints();     // #270 GET /api/feed
app.MapSocialThreadEndpoints();   // #270 GET /api/threads/{postId}
app.MapSocialPostEndpoints();     // #271 POST /api/posts
app.MapSocialPersonaEndpoints();  // #273 GET /api/personas
app.MapSocialRealtimeHub();       // #272 SignalR hub at /hubs/exercise

app.Run();

// Reachable by WebApplicationFactory<Program> in Pulse.WebApi.Tests.
public partial class Program { }
