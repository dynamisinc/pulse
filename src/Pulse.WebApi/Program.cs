using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Pulse.Core.Core.Extensions;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.ExerciseResolution;
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

// Host → exercise resolution (exercise-isolation/08, #51, Phase B2 Wave 1) — orchestrator-wired.
// Registers the host→exercise resolver that UseExerciseResolution() (below) uses to set the pre-auth
// participant scope from the request Host header. Fail-closed on an unknown host (scope stays unset).
builder.Services.AddExerciseResolution();

// Staff identity (identity-auth-roles/05, #62) is BUILT + merged, but its composition-root wiring
// (builder.Services.AddStaffIdentity(builder.Configuration) + app.UseRateLimiter() + app.MapStaffAuthEndpoints())
// is DEFERRED to Phase B2 Wave 2 (story 03): StaffLoginService depends on ISessionIssuer, whose
// implementation + DI registration land with story 03. Wiring it now would fail DI validation at startup
// (unresolvable ISessionIssuer) and expose only non-functional endpoints (no auth scheme, no session
// issuer, the ICurrentStaffSessionAccessor Null default fails closed). It is wired alongside AddSessions()
// in Wave 2, once every runtime dependency exists — the "wire the composition root as dependencies become
// ready" model.

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

// Exercise scope resolution (exercise-isolation/08) — MUST run BEFORE any auth/session middleware
// (Phase B2 Wave 2, story 03) so an authenticated session's scope write takes precedence over the host's
// provisional one (the precedence model: session > host > unset → fail-closed zero rows). Maps the
// request Host to an Exercise and sets ExerciseContext.CurrentExerciseId for anonymous/pre-auth
// participant requests; an unknown/spoofed/omitted host leaves the scope unset (fail-closed).
// Scoped OFF the /health path (UseWhen): resolution runs a DB lookup, and the liveness probe
// (/health) is deliberately DB-independent — a DB hang must never delay the liveness 200 into an
// instance recycle. (Middleware-vs-endpoint order is not governed by map order, so excluding the
// path here is what actually keeps liveness DB-free.)
app.UseWhen(
    context => !context.Request.Path.StartsWithSegments("/health"),
    branch => branch.UseExerciseResolution());

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

// Exercise-resolution endpoint (Phase B2 Wave 1, exercise-isolation/08). Scope comes only from the
// resolved IExerciseContext (COR-001); /exercise-context reads the host-resolved scope, never a client
// exerciseId. (Story 05's MapStaffAuthEndpoints() is deferred to Wave 2 — see the DI note above.)
app.MapExerciseContextEndpoints();  // #51 GET /api/exercise-context (frozen ExerciseScope; 404 on unknown host)

app.Run();

// Reachable by WebApplicationFactory<Program> in Pulse.WebApi.Tests.
public partial class Program { }
