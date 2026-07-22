using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Pulse.Core.Core.Extensions;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
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
// and the config-selected generation provider. The committed default is Fake (see appsettings.json),
// so CI/tests never reach a live endpoint. Story 04 (#288, Tier-2): the Fake->AzureOpenAI "flip" is a
// GOVERNED-CONFIG action in the deployed environment (Generation:Provider=AzureOpenAI + the governance
// keys, sourced from ai.bicep outputs — see appsettings.Generation.Example.json / PROVIDER-GOVERNANCE.md),
// NOT a committed code change: AddEngineGeneration fails closed at startup on ungoverned config, so
// committing AzureOpenAI here would (correctly) break the keyless CI build. Provider is config, not code.
builder.Services.AddEngineGeneration(builder.Configuration);

// Engine-runtime foundations (feature/engine-runtime) — orchestrator-wired between waves, each behind its
// own extension (this file never gains engine logic). Wave 1: AddExerciseClock (#287) registers the native
// per-exercise IExerciseClock (StartEx + freeze + discrete jump) and adapts the engine's IScenarioClock onto
// it (one clock); AddEngineRuntimeSeams (Wave-0 seam-freeze) registers the shared IEngineTelemetryEmitter +
// IEngineReviewStore that stories 01 (produces review items + telemetry) and 02 (serves the queue) consume.
builder.Services.AddExerciseClock();
builder.Services.AddEngineRuntimeSeams();

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

// Engine runtime — Wave 2 (feature/engine-runtime), orchestrator-wired. AddReactionLoopHost (#285)
// registers the in-process reaction-loop BackgroundService + the IEnginePublishService publish funnel
// (publishes through B1's PostIngestService as origin:'engine', reusing IFeedBroadcaster). AddEngineReview
// (#286) registers the review-cockpit service + endpoints + the SignalR broadcaster (reusing the B1
// ExerciseRealtimeHub — no second hub) + the auto-HOLD scenario tick, and REPLACES the generation NoOp
// IProviderHealthListener with the degrade-only autonomy fan-out listener — so it MUST run after
// AddEngineGeneration (above). Both consume AddExerciseClock + AddEngineRuntimeSeams.
builder.Services.AddReactionLoopHost();    // #285 reaction-loop host + IEnginePublishService
builder.Services.AddEngineReview();        // #286 review queue API + autonomy/safety wiring + SignalR push

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

// Engine-runtime endpoints (Wave 2) — REST only; the review push reuses the B1 ExerciseRealtimeHub mapped
// above (no second hub). Scope comes only from the resolved IExerciseContext (COR-001), never a client
// exerciseId; per-request population lands with Phase B2 (endpoints fail closed until then).
app.MapEngineRuntime();   // #285 reaction-loop host runtime surface
app.MapEngineReview();    // #286 GET queue + approve/edit/veto/re-roll/batch + swamped-mode + kill-switch

app.Run();

// Reachable by WebApplicationFactory<Program> in Pulse.WebApi.Tests.
public partial class Program { }
