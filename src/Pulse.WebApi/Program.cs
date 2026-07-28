using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Pulse.Core.Core.Extensions;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.ExerciseConfiguration.Chrome;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Features.ExerciseConfiguration.PracticeMode;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Features.Identity.Accounts;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.SharedAccess;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Ops.Bootstrap;
using Pulse.WebApi.Features.Ops.EngineContentSeed;
using Pulse.WebApi.Features.ParticipantShell;
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

// Per-exercise configuration (E1 exercise-configuration, story 01b). REQUIRED, not optional: the six
// participant-shell config GETs mapped by MapParticipantShellEndpoints() below now resolve
// ParticipantShellConfigService, which only this call registers — omit it and those previously-working
// routes fail on an unresolvable handler dependency and blank the participant shell (the #310/#317
// composition-root failure mode). Placed after AddStaffIdentity for readability — the staff settings
// endpoints reuse the staff-session authorization filter, which resolves from HttpContext.RequestServices
// at request time, so there is no DI ordering dependency. It also TryAdd()s the constant-preserving
// defaults for the three wave-3 projection seams (IChromeConfigProjection / IShellVariantProjection /
// IOverlayStateProjection). A contributor — stories 02/03/04 — MUST override with services.Replace(),
// which works from either side of this line. Never TryAdd: against an already-registered default that is
// a silent no-op leaving the constant serving. (A bare AddScoped would in fact still win, last-descriptor;
// the trap is copying THIS line's TryAdd idiom.) Guarded by ExerciseConfiguration/CompositionRootWiringTests.
builder.Services.AddExerciseConfiguration();

// E1 exercise-configuration WAVE 3 — the three contributor slices, each shipping its own Add*/Map* pair from
// its own extensions file (no builder edits this one). All three override an AddExerciseConfiguration()
// TryAdd()ed default with services.Replace(), which is ORDER-INDEPENDENT — so listing them after the line
// above is this feature's CONVENTION for readability, not a correctness requirement. (The convention exists
// so the mistaken TryAdd idiom can never appear to work: a TryAdd here would silently stand down and leave
// 01b's constant serving.) Practice mode is the one seam with NO fail-safe default anywhere — deliberately,
// so a missing AddPracticeMode() is a loud GetRequiredService throw rather than a silent "everything is
// eligible" that would leak rehearsal data into an AAR. Guarded by
// ExerciseConfiguration/CompositionRootWiringTests.
builder.Services.AddComplianceChromeConfig();   // story 02 — per-exercise COR-031 chrome + the NFR-008 guard
builder.Services.AddPracticeMode();             // story 04 — COR-033 practice flag + IEvaluationEligibility
builder.Services.AddExerciseLifecycle();        // story 03 — COR-032 state machine + shell/overlay projections

// Default-deny session gate (identity-auth-roles/11, #361 — the fix for #359) — orchestrator-wired.
// Registers a RequireAuthenticatedUser FALLBACK policy plus the result handler that writes the 401/403 and
// emits the XC-004 access.rejected audit event. Before this, every endpoint asked only "is an exercise scope
// resolved" — a COR-001 isolation question that UseExerciseResolution answers for an ANONYMOUS caller from
// the bare Host header — so 12 routes and the SignalR hub were reachable with no credential at all. The
// fallback policy applies to every endpoint that declares no authorization metadata of its own: minimal
// APIs, MVC controllers (POST /api/telemetry) and hub endpoints alike, which an IEndpointFilter could not
// have covered. The ONLY exceptions are the eleven routes in PreAuthAllowlist, each marked
// .AllowAnonymousPreAuth() at its own mapping call site.
builder.Services.AddSessionAuthorization();

// Participant login methods (Phase B2 Wave 3). AddParticipantAccounts (identity-auth-roles/02) registers the
// participant credential-login + staff account-provisioning services + the "participant-login" rate-limiter
// policy. AddSharedReadOnly (identity-auth-roles/06) registers the shared view-only login + the read-only
// write-denial probe/filter + the "shared-login" rate-limiter policy. All policies accumulate under the single
// app.UseRateLimiter() above; each policy name is distinct (participant-login / shared-login / staff-login /
// session-endpoints). Both depend on the ISessionIssuer (03) already registered above.
builder.Services.AddParticipantAccounts();
builder.Services.AddSharedReadOnly();

// Shared-credential lifecycle (identity-auth-roles/07, #64, Phase B2 Wave 4) — staff-only rotate/revoke +
// rotation-grace + brute-force lockout over story 06's SharedCredential. Reuses 06's "shared-login"
// rate-limiter policy (registers no new limiter); staff endpoints are gated by ICurrentStaffSessionAccessor.
builder.Services.AddSharedCredentialLifecycle();

// UAT bootstrap seam (feature login/05, #308/#310) — the secret-gated, idempotent seed endpoint that
// creates the FIRST Exercise/StaffAssignment/SharedCredential/Account in an empty database (no other
// endpoint can, since they all require an already-authenticated staff session). The slice ships its own
// Add/Map extensions and never edits this file itself; this is the orchestrator-owned one-line wiring
// (implementation.md "Integration seam"). Disabled by default — fails closed to 404 unless
// Authentication:Bootstrap:Secret is configured. No middleware/ordering constraint: the header secret is
// the only gate, reusing the single app.UseRateLimiter() below.
builder.Services.AddOpsBootstrap(builder.Configuration);

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

// Engine content seed (feature engine-content-seed, #324/#327) — orchestrator-wired. AddEngineContentSeed
// registers the secret-gated POST /api/ops/seed-engine-content ops endpoint that seeds the persona cast +
// a canned starter storyline and calls IReactionLoopRegistry.Register (the previously-unbuilt production
// drive path #324 traced). Placed AFTER AddReactionLoopHost/AddEngineReview: it depends on
// IReactionLoopRegistry being registered and shares AddEngineReview's EngineAutonomyRegistry SINGLETON via
// GetOrCreate (the load-bearing shared-instance correctness point — a detached autonomy state would
// desynchronize the loop from the cockpit's kill-switch/swamped-mode). Tolerant of DI order via TryAdd. It
// reuses Authentication:Bootstrap:Secret (same X-Bootstrap-Secret header) — no new secret/infra; fails
// closed to 404 when unconfigured. No middleware/ordering constraint (same as MapBootstrapEndpoints).
builder.Services.AddEngineContentSeed(builder.Configuration);

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

// Default-deny authorization (identity-auth-roles/11) — MUST be called EXPLICITLY, and MUST sit exactly here:
// immediately after UseSessionAuthentication, which is what populates HttpContext.User for a live session.
// WebApplication auto-inserts UseAuthorization() ahead of ALL user middleware when it is never called
// explicitly; that placement would evaluate the fallback policy before the principal exists. The failure would
// be SILENT and nastier than a total outage: the eleven allowlisted routes keep working (IAllowAnonymous
// short-circuits the middleware wherever it sits), so login still succeeds — and then every authenticated call
// after it 401s. Calling it here is load-bearing, not stylistic — the same class of ordering constraint as
// host-resolution-before-session-authentication above. From this line on, an endpoint is reachable without a
// live session ONLY if it carries .AllowAnonymousPreAuth() (PreAuthAllowlist).
//
// It runs BEFORE UseExerciseLifecycleGating() below, deliberately. Both middlewares document "immediately
// after the session scope is final", and both constraints hold with authorization first — this one reads
// HttpContext.User and writes no scope, so the lifecycle gate still sees the same resolved scope it would
// have. Ordering them the other way would answer an UNAUTHENTICATED request to a participant route with the
// lifecycle gate's 403, disclosing the exercise's lifecycle state to a caller who has not proven it may know
// anything at all. Default-deny is the outermost gate; "may this caller have any data" is answered before
// "is this world currently being served".
app.UseAuthorization();

// COR-032 participant lifecycle gating (exercise-configuration story 03) — in build/completed/archived the
// participant-world routes are NOT SERVED (403); staff sessions and every un-listed route pass through.
// ORDER IS LOAD-BEARING, and this is the ONLY middleware-ordering constraint wave 3 introduces: it MUST run
// AFTER both UseExerciseResolution() (host → provisional scope) and UseSessionAuthentication() (session
// scope, higher precedence) above, because it decides from the RESOLVED scope. Wired any earlier it reads an
// unset scope on every request, finds no lifecycle to check, and passes everything through — a SILENT, TOTAL
// no-op: a gate that looks wired, breaks no test, and lets /api/feed hand a participant an archived world's
// posts. It sits before UseRateLimiter() only because that is where "immediately after the scope is final"
// falls; the limiter's policies are per-endpoint, so no gated route's behaviour depends on that adjacency.
// The mis-ordering itself is caught by ExerciseConfiguration/LifecycleGatingPipelineOrderTests' real-SQL 403
// probe, the only test that can see it (a slice-composed host fixes its own scope, so it cannot).
app.UseExerciseLifecycleGating();

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
// PRE-AUTH (identity-auth-roles/11, PreAuthAllowlist): platform liveness/readiness probes present no
// credential by construction, and a probe that 401s reads as an unhealthy instance to the orchestrator.
app.MapHealthChecks("/health", new HealthCheckOptions { Predicate = _ => false }).AllowAnonymousPreAuth();
app.MapHealthChecks("/health/ready").AllowAnonymousPreAuth();

// Attribute-routed controllers. POST /api/telemetry is the only one today, and it inherits the default-deny
// fallback policy above — the surface a minimal-API endpoint filter could never have gated (identity-auth-
// roles/11 decision 1). Server-side authority over its exerciseId/actor claims is story 13 (#362).
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

// Participant-shell config reads — the six GET endpoints the frozen frontend shell seams call
// (shell-state, chrome-config, brand-tokens, channel-nav-config, alerts, overlay-state). Fixes the UAT
// bug where these 404'd with mock data OFF: the shell-state 404 forced the fail-closed readOnly variant,
// which disabled the realtime feed stream + "new posts" pill so the participant feed never updated live.
// Story 01b replaced the fixed Phase-1 constants with PER-EXERCISE config read through
// ParticipantShellConfigService (registered by AddExerciseConfiguration above) behind the SAME frozen
// wire shapes, so no frontend consumer or runtime type-guard changed. Scope comes only from the resolved
// IExerciseContext (COR-001), fail-closed 401 on an unresolved scope. GET reads a read-only/observer
// session must still receive — NOT under DenyReadOnlySessions().
app.MapParticipantShellEndpoints();

// Staff per-exercise settings (E1 exercise-configuration, story 01b): GET/PUT /api/staff/exercise-settings.
// Staff-gated (XC-002) and exercise-scoped from the server-resolved scope — the route takes no exercise id
// in any form, so there is no IDOR surface. The other half of the required line-pair above.
app.MapExerciseConfigurationEndpoints();

// E1 exercise-configuration WAVE 3 staff surfaces — the endpoint half of the three DI lines above. All three
// are staff-gated (XC-002) and take the exercise from the server-resolved scope alone: no route, query or
// body carries an exercise id, so none of them has an IDOR surface. None of them maps a PARTICIPANT route —
// /api/chrome-config, /api/shell-state and /api/overlay-state stay on MapParticipantShellEndpoints() above;
// wave 3 only changed what backs them (the Replace()d projections).
app.MapComplianceChromeEndpoints();     // story 02 — GET/PUT /api/staff/chrome-settings
app.MapPracticeModeEndpoints();         // story 04 — GET/PUT /api/staff/practice-mode
app.MapExerciseLifecycleEndpoints();    // story 03 — GET /api/staff/exercise-lifecycle, POST .../transition

// Identity + exercise-resolution endpoints (Phase B2 Waves 1–3). Scope comes only from the resolved
// IExerciseContext (COR-001); /exercise-context and /session read the resolved scope, never a client
// exerciseId. Staff auth endpoints require the live-session accessor (story 03) now that it is wired.
app.MapExerciseContextEndpoints();  // #51 GET /api/exercise-context (frozen ExerciseScope; 404 on unknown host)
app.MapSessionEndpoints();          // #60 GET /api/session, POST /api/auth/refresh, POST /api/auth/logout
app.MapStaffAuthEndpoints();        // #62 POST /api/auth/staff/login, GET /api/staff/assignments, POST /api/staff/active-exercise
app.MapSharedReadOnlyEndpoints();          // #63 POST /api/auth/shared (view-only session + ephemeral identity)
app.MapAccountEndpoints();                 // #59 POST /api/auth/login, POST /api/staff/accounts[/import]
app.MapSharedCredentialLifecycleEndpoints(); // #64 POST /api/staff/shared-credential/{rotate,revoke}
app.MapBootstrapEndpoints();               // #308 POST /api/ops/bootstrap-exercise (secret-gated seed; 404 when unconfigured)
app.MapEngineContentSeedEndpoints();       // #327 POST /api/ops/seed-engine-content (secret-gated engine drive path; 404 when unconfigured)

// Engine-runtime endpoints (Wave 2) — REST only; the review push reuses the B1 ExerciseRealtimeHub mapped
// above (no second hub). Scope comes only from the resolved IExerciseContext (COR-001), never a client
// exerciseId — populated per-request by B2's UseExerciseResolution + UseSessionAuthentication above. The
// STAFF-ONLY review cockpit (#286) is additionally role-gated by EngineCockpitStaffAuthorizationFilter
// (wired inside MapEngineReview): a live STAFF session is required (401 otherwise) AND it must be assigned
// to the resolved exercise (403 NotAssigned, COR-005) — so a participant/read-only session cannot drive
// the safety-critical cockpit. Requires AddStaffIdentity (above) to precede AddEngineReview — it does.
app.MapEngineRuntime();   // #285 reaction-loop host runtime surface
app.MapEngineReview();    // #286 GET queue + approve/edit/veto/re-roll/batch + swamped-mode + kill-switch

app.Run();

// Reachable by WebApplicationFactory<Program> in Pulse.WebApi.Tests.
public partial class Program { }
