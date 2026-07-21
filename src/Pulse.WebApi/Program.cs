using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Pulse.Core.Core.Extensions;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Features.Identity.Accounts;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.SharedAccess;
using Pulse.WebApi.Features.Identity.Staff;
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

// Staff identity (identity-auth-roles/05, #62) + Sessions (identity-auth-roles/03, #60) — Phase B2 Wave 2.
// AddStaffIdentity registers DynamisIdentityProvider (behind IIdentityProvider) + the staff
// login/assignments/active-exercise services + the staff-login rate-limiter policy, and TryAdds the
// fail-closed NullCurrentStaffSessionAccessor. AddSessions registers ISessionIssuer→SessionIssuer,
// SessionService, the opaque-bearer auth scheme + the session-endpoints rate-limiter policy, and Replace()s
// the staff-session accessor with the real CurrentStaffSessionAccessor (order-independent via Replace, but
// AddStaffIdentity is listed first as the intended order). Both AddRateLimiter calls accumulate distinct
// named policies under the single app.UseRateLimiter() below.
builder.Services.AddStaffIdentity(builder.Configuration);
builder.Services.AddSessions(builder.Configuration);

// Participant login methods (Phase B2 Wave 3). AddParticipantAccounts (identity-auth-roles/02) registers the
// participant credential-login + staff account-provisioning services + the "participant-login" rate-limiter
// policy. AddSharedReadOnly (identity-auth-roles/06) registers the shared view-only login + the read-only
// write-denial probe/filter + the "shared-login" rate-limiter policy. All policies accumulate under the single
// app.UseRateLimiter() above; each policy name is distinct (participant-login / shared-login / staff-login /
// session-endpoints). Both depend on the ISessionIssuer (03) already registered above.
builder.Services.AddParticipantAccounts();
builder.Services.AddSharedReadOnly();

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

// Session authentication (identity-auth-roles/03) — MUST run AFTER UseExerciseResolution so an
// authenticated session's scope write OVERRIDES the host's provisional one (precedence: session > host >
// unset). For a token-bearing request it resolves the live session via a throwaway scope (so the
// request-scoped PulseDbContext is constructed only AFTER the higher-precedence scope is written), and for
// a participant session fails closed (403) when the session's exercise != the host-resolved exercise. It
// does no DB work for a request without a bearer token (health probes carry none), so it needs no /health
// exclusion. Getting this order wrong is a correctness break: session-before-host 403s all participants;
// host-after-session inverts precedence (shows the wrong exercise) — keep it exactly here.
app.UseSessionAuthentication();

// Rate limiting (identity-auth-roles/05 staff-login + /03 session-endpoints policies). NOTE (Gate-1,
// tracked for /security-review before the umbrella→main PR): the staff-login limiter partitions on
// Connection.RemoteIpAddress, which behind the Azure App Service reverse proxy is the platform proxy's
// address — so the "per-IP" partition collapses to one global bucket unless forwarded-headers handling that
// trusts ONLY the platform proxy (NEVER client-supplied X-Forwarded-For, which would let an attacker evade
// the limit) is wired ahead of this. That config is a deployment/security decision finalized under
// /security-review. Separately, the always-on session middleware's per-request token lookup is not covered
// by these per-endpoint policies — a global per-IP limiter / edge-WAF is a /security-review item too.
app.UseRateLimiter();

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
// #271 POST /api/posts — the one existing sim WRITE. Wrapped in a DenyReadOnlySessions() group
// (identity-auth-roles/06) so a shared read-only session is refused (403) before the handler runs — the
// server-side realization of the read-only-never-writes guarantee (COR-015). Opt-in per sim-write by design
// (a verb-blanket would wrongly block read-only's legitimate writes to /api/telemetry, /auth/refresh,
// /auth/logout, SignalR negotiate); each FUTURE sim-write (E2 reply/react/follow/DM) must apply the same
// guard — tracked for a defense-in-depth backstop before E2 participant writes land.
app.MapGroup(string.Empty).DenyReadOnlySessions().MapSocialPostEndpoints();

app.MapSocialPersonaEndpoints();  // #273 GET /api/personas
app.MapSocialRealtimeHub();       // #272 SignalR hub at /hubs/exercise

// Identity + exercise-resolution endpoints (Phase B2 Waves 1–3). Scope comes only from the resolved
// IExerciseContext (COR-001); /exercise-context and /session read the resolved scope, never a client
// exerciseId. Staff auth endpoints require the live-session accessor (story 03) now that it is wired.
app.MapExerciseContextEndpoints();  // #51 GET /api/exercise-context (frozen ExerciseScope; 404 on unknown host)
app.MapSessionEndpoints();          // #60 GET /api/session, POST /api/auth/refresh, POST /api/auth/logout
app.MapStaffAuthEndpoints();        // #62 POST /api/auth/staff/login, GET /api/staff/assignments, POST /api/staff/active-exercise
app.MapSharedReadOnlyEndpoints();   // #64 POST /api/auth/shared (view-only session + ephemeral identity)
app.MapAccountEndpoints();          // #59 POST /api/auth/login, POST /api/staff/accounts[/import]

app.Run();

// Reachable by WebApplicationFactory<Program> in Pulse.WebApi.Tests.
public partial class Program { }
