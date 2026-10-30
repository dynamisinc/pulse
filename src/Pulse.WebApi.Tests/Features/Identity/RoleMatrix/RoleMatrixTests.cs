namespace Pulse.WebApi.Tests.Features.Identity.RoleMatrix;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.Core.Features.Ambient.Models;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// identity-auth-roles/17 (#573) — THE ROUTE x ROLE MATRIX (ADMIN-IDENTITY-MODEL §8.2). Every mutating route mapped by
/// the REAL <c>Program</c> host is enumerated from <see cref="EndpointDataSource"/> and must have an explicit row in
/// <see cref="Matrix"/>; an unlisted route fails the build. Each probed row is then driven over HTTP, with a fresh real
/// session per request, for org admin (org scope), planner, controller, lead controller, evaluator, participant, pio,
/// read-only and anonymous, and the outcome compared with the row.
/// </summary>
/// <remarks>
/// <para>
/// <b>Allowed vs refused.</b> "A" means the role gate let the request through — any status but 401/403 (bodies are
/// deliberately minimal, so most allowed probes stop at the handler's own 400/404/409 and write nothing). "R" means the
/// request was refused with 401 or 403 before any handler work. State-dependent rows are set up per probe (the exercise
/// is reset to the row's lifecycle state, and engine autonomy state is reset, before EVERY role's request).
/// </para>
/// <para>
/// <b>Not probed here, but still explicit rows:</b> the pre-auth sign-in / refresh / logout / ops routes (asserted to be
/// anonymous-allowlisted; their per-role behaviour is <see cref="SelfServiceSessionTests"/> and the default-deny suite). The per-transition lifecycle rows, the
/// build-vs-live authoring rows and both directions of the lead gate have their own focused suites in this folder.
/// </para>
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class RoleMatrixTests
{
    // Column order of every expectation string: OrgAdmin, Planner, Controller, LeadController, Evaluator,
    // Participant, Pio, ReadOnly, Anonymous.
    private const string OrgAdminOnly = "ARRRRRRRR";
    private const string OrgAdminOrPlanner = "AARRRRRRR";
    private const string PlannerOnly = "RARRRRRRR";
    private const string PlannerOrController = "RAAARRRRR";
    private const string ControllerOnly = "RRAARRRRR";
    private const string LeadOnly = "RRRARRRRR";
    private const string StaffWorld = "AAAAARRRR";
    private const string ParticipantSim = "RRRRRAARR";
    private const string LiveAuthoring = "RRAARAARR";
    private const string UploadAuthoring = "RAAARAARR";
    private const string ExerciseBoundSessions = "RAAAAAAAR";
    private const string Multipart = "multipart";

    private static readonly MatrixRole[] Columns = Enum.GetValues<MatrixRole>();

    private readonly MsSqlContainerFixture _fixture;

    public RoleMatrixTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>The §8.2 matrix, one row per mapped mutating route ("METHOD pattern").</summary>
    internal static IReadOnlyDictionary<string, MatrixRow> Matrix { get; } = BuildMatrix();

    [Fact]
    public void EveryMappedMutatingRoute_HasAnExplicitMatrixRow_AndEveryRowIsMapped()
    {
        using var host = new RoleMatrixHost(connectionString: null);
        var mapped = MutatingRouteKeys(host).ToList();

        mapped.Should().NotBeEmpty();
        mapped.Where(key => !Matrix.ContainsKey(key)).Should().BeEmpty(
            "every mutating route must carry an explicit §8.2 role-matrix row — add one to RoleMatrixTests.Matrix");
        Matrix.Keys.Where(key => !mapped.Contains(key)).Should().BeEmpty(
            "a matrix row for a route that is no longer mapped is stale");
    }

    [Fact]
    public void PreAuthRows_AreExactlyTheAnonymousAllowlistedMutatingRoutes()
    {
        using var host = new RoleMatrixHost(connectionString: null);
        foreach (var endpoint in host.RouteEndpoints())
        {
            foreach (var key in KeysOf(endpoint).Where(Matrix.ContainsKey))
            {
                var anonymous = endpoint.Metadata.GetMetadata<IAllowAnonymous>() is not null;
                anonymous.Should().Be(
                    Matrix[key].Kind == RowKind.PreAuth,
                    "{0} is {1} in the matrix, so it must {2}be reachable before sign-in",
                    key,
                    Matrix[key].Kind,
                    Matrix[key].Kind == RowKind.PreAuth ? string.Empty : "NOT ");
            }
        }
    }

    [RequiresDockerFact]
    public async Task EveryProbedRoute_AnswersEachRoleAsTheMatrixSays()
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture);
        using var host = new RoleMatrixHost(_fixture.ConnectionString!);
        var failures = new List<string>();

        foreach (var (key, row) in Matrix.Where(pair => pair.Value.Kind == RowKind.Probe).OrderBy(pair => pair.Key, StringComparer.Ordinal))
        {
            var method = key[..key.IndexOf(' ', StringComparison.Ordinal)];
            var pattern = key[(method.Length + 1)..];

            for (var column = 0; column < Columns.Length; column++)
            {
                var role = Columns[column];
                await world.SetStatusAsync(row.State, row.State == "build" ? null : DateTimeOffset.UtcNow.AddDays(-1));
                ResetEngineState(host, world.ExerciseId, row);

                var token = await world.TokenForAsync(role);
                using var client = world.Client(host, token);
                using var request = new HttpRequestMessage(new HttpMethod(method), Path(pattern, world))
                {
                    Content = row.Body == Multipart
                        ? CsvUpload()
                        : method is "GET" or "DELETE" && row.Body is null
                            ? null
                            : new StringContent(row.Body ?? "{}", Encoding.UTF8, "application/json"),
                };

                using var response = await client.SendAsync(request);
                var refused = response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden;
                var expectedRefused = row.Expect[column] == 'R';
                if (refused != expectedRefused)
                {
                    failures.Add($"{key} as {role} [{row.State}]: expected {(expectedRefused ? "REFUSED" : "ALLOWED")}, got {(int)response.StatusCode}");
                }
            }
        }

        failures.Should().BeEmpty("every route must answer every role exactly as the §8.2 matrix row says");
    }

    /// <summary>The mutating route keys ("METHOD pattern") of the live host.</summary>
    internal static IEnumerable<string> MutatingRouteKeys(RoleMatrixHost host) =>
        host.RouteEndpoints().SelectMany(KeysOf).Distinct(StringComparer.Ordinal);

    private static IEnumerable<string> KeysOf(RouteEndpoint endpoint)
    {
        var methods = endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods ?? [];
        foreach (var method in methods.Where(m => m is "POST" or "PUT" or "PATCH" or "DELETE"))
        {
            yield return $"{method} /{endpoint.RoutePattern.RawText!.TrimStart('/')}";
        }
    }

    private static string Path(string pattern, RoleMatrixWorld world)
    {
        var path = pattern
            .Replace("{exerciseId:guid}", world.ExerciseId.ToString(), StringComparison.Ordinal)
            .Replace("/api/staff/enrollments/{id:guid}", $"/api/staff/enrollments/{world.EvaluatorEnrollmentId}", StringComparison.Ordinal)
            .Replace("{kind}", "like", StringComparison.Ordinal);

        path = Regex.Replace(path, @"\{[^}:]+:guid\}", _ => Guid.NewGuid().ToString());
        return Regex.Replace(path, @"\{[^}]+\}", "matrix-probe");
    }

    private static MultipartFormDataContent CsvUpload()
    {
        var content = new MultipartFormDataContent();
        var file = new ByteArrayContent(Encoding.UTF8.GetBytes(string.Empty));
        file.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("text/csv");
        content.Add(file, "file", "matrix.csv");
        return content;
    }

    private static void ResetEngineState(RoleMatrixHost host, Guid exerciseId, MatrixRow row)
    {
        var autonomy = host.Services.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(exerciseId);
        autonomy.SetSwampedMode(false, "matrix-reset", 0);
        autonomy.SetExerciseDefault(AutonomyLevel.Suggest, "matrix-reset", 0);
        host.Services.GetRequiredService<EngineTierPolicyRegistry>().SetMode(exerciseId, row.TierBefore);
        host.Services.GetRequiredService<EngineAmbientPolicyRegistry>().Set(exerciseId, AmbientTierPolicy.Off);
    }

    private static Dictionary<string, MatrixRow> BuildMatrix()
    {
        const string Acting = "\"actingHumanId\":\"matrix-probe\"";
        var rows = new Dictionary<string, MatrixRow>(StringComparer.Ordinal);

        void Probe(string key, string expect, string? body = null, string state = "live", TierPolicyMode tierBefore = TierPolicyMode.Auto)
            => rows.Add(key, new MatrixRow(RowKind.Probe, expect, body, state, tierBefore));

        void PreAuth(string key) => rows.Add(key, new MatrixRow(RowKind.PreAuth, string.Empty, null, "live", TierPolicyMode.Auto));

        // ---- Pre-auth: sign-in, refresh, logout, secret-gated ops (self-service; SelfServiceSessionTests). ----
        PreAuth("POST /api/auth/login");
        PreAuth("POST /api/auth/staff/login");
        PreAuth("POST /api/auth/staff/login/choose"); // identity-auth-roles/15: org sign-in org choice (choice token)
        PreAuth("POST /api/auth/shared");
        PreAuth("POST /api/auth/join");
        PreAuth("POST /api/auth/word");
        PreAuth("POST /api/auth/refresh");
        PreAuth("POST /api/auth/logout");
        PreAuth("POST /api/ops/bootstrap-exercise");
        PreAuth("POST /api/ops/seed-engine-content");
        PreAuth("POST /api/ops/bind-participant-persona");

        // ---- Self-service, staff world only (evaluators and org admins included). ----
        Probe("POST /api/staff/active-exercise", StaffWorld);

        // ---- Measurement: client telemetry from any exercise-bound session (not exercise content). An org-scope
        //      session has no exercise to attribute an event to, so it is refused. ----
        Probe("POST /api/telemetry", ExerciseBoundSessions);

        // ---- Org tier. ----
        Probe("POST /api/org/exercises", OrgAdminOnly);
        Probe("PATCH /api/org/exercises/{exerciseId:guid}", OrgAdminOrPlanner);
        Probe("POST /api/org/exercises/{exerciseId:guid}/archive", OrgAdminOrPlanner);

        // ---- Configuration: planner only. Lead assignment: planner only. ----
        Probe("PUT /api/staff/exercise-settings", PlannerOnly);
        Probe("PUT /api/staff/chrome-settings", PlannerOnly);
        Probe("PUT /api/staff/practice-mode", PlannerOnly);
        Probe("PUT /api/staff/enrollments/{id:guid}/lead", PlannerOnly);

        // ---- Lifecycle: per transition (live → paused is the controller's; LifecycleTransitionRoleTests has the rest). ----
        Probe("POST /api/staff/exercise-lifecycle/transition", ControllerOnly, "{\"to\":\"paused\"}");

        // ---- Roster, links, day word, accounts, view-only code: planner + controller. ----
        Probe("POST /api/staff/roster", PlannerOrController);
        Probe("POST /api/staff/roster/import", PlannerOrController, Multipart);
        Probe("POST /api/staff/roster/cards", PlannerOrController);
        Probe("POST /api/staff/roster/email-links", PlannerOrController);
        Probe("POST /api/staff/roster/{id:guid}/link/reissue", PlannerOrController);
        Probe("POST /api/staff/roster/{id:guid}/link/revoke", PlannerOrController);
        Probe("POST /api/staff/roster/{id:guid}/disable", PlannerOrController);
        Probe("POST /api/staff/roster/{id:guid}/enable", PlannerOrController);
        Probe("PUT /api/staff/day-word", PlannerOrController);
        Probe("DELETE /api/staff/day-word", PlannerOrController);
        Probe("POST /api/staff/accounts", PlannerOrController);
        Probe("POST /api/staff/accounts/import", PlannerOrController, Multipart);
        Probe("POST /api/staff/shared-credential/rotate", PlannerOrController);
        Probe("POST /api/staff/shared-credential/revoke", PlannerOrController);

        // ---- Personas and the run sheet: planner + controller. ----
        Probe("PATCH /api/staff/personas/{personaId:guid}", PlannerOrController);
        Probe("POST /api/injects", PlannerOrController);
        Probe("PUT /api/injects/{id:guid}", PlannerOrController);
        Probe("DELETE /api/injects/{id:guid}", PlannerOrController);
        Probe("POST /api/injects/reorder", PlannerOrController);
        Probe("POST /api/injects/import", PlannerOrController);

        // ---- Conduct: controller only. ----
        Probe("POST /api/injects/{id:guid}/fire", ControllerOnly);
        Probe("POST /api/injects/{id:guid}/hold", ControllerOnly);
        Probe("POST /api/injects/{id:guid}/release", ControllerOnly);
        Probe("POST /api/injects/{id:guid}/skip", ControllerOnly);
        Probe("POST /api/injects/{id:guid}/unskip", ControllerOnly);
        Probe("POST /api/injects/{id:guid}/retry", ControllerOnly);
        Probe("POST /api/injects/{itemId:guid}/mark-fired", ControllerOnly);
        Probe("POST /api/alerts", ControllerOnly); // channels-foundation 10: raise an in-fiction alert
        Probe("POST /api/alerts/{id:guid}/clear", ControllerOnly);

        // channels-foundation 03 (#699): outlet registry writes are controller-only (story AC "Staff write").
        Probe("POST /api/outlets", ControllerOnly);
        Probe("PUT /api/outlets/{id:guid}", ControllerOnly);
        Probe("DELETE /api/outlets/{id:guid}", ControllerOnly);
        Probe("POST /api/outlets/reorder", ControllerOnly);
        Probe("POST /api/outlets/defaults", ControllerOnly);
        Probe("DELETE /api/staff/posts/{postId:guid}", ControllerOnly);
        Probe("PUT /api/staff/noise", ControllerOnly);
        Probe("PUT /api/staff/noise/pool", ControllerOnly);
        Probe("POST /api/steering/pause-tier", ControllerOnly);
        Probe("POST /api/steering/runtime-state/reset", ControllerOnly);
        Probe("POST /api/steering/storylines/{storylineId}/target", ControllerOnly);
        Probe("POST /api/engine/review/{draftId:guid}/approve", ControllerOnly);
        Probe("POST /api/engine/review/{draftId:guid}/edit", ControllerOnly);
        Probe("POST /api/engine/review/{draftId:guid}/veto", ControllerOnly);
        Probe("POST /api/engine/review/{draftId:guid}/re-roll", ControllerOnly);
        Probe("POST /api/engine/review/batch-approve", ControllerOnly);

        // ---- Autonomy: LOWER is any controller; RAISE is the lead only (both directions: LeadControllerGateTests). ----
        Probe("POST /api/engine/autonomy/kill-switch", ControllerOnly, $"{{\"mode\":\"drop-to-suggest\",{Acting}}}");
        Probe("POST /api/engine/generation-provider/cut-to-fake", ControllerOnly, $"{{{Acting}}}");
        Probe("POST /api/engine/autonomy/swamped-mode", LeadOnly, $"{{\"enabled\":true,{Acting}}}");
        Probe("POST /api/engine/autonomy/restore", LeadOnly, $"{{{Acting}}}");
        Probe("POST /api/engine/settings/autonomy-default", LeadOnly, $"{{\"level\":\"delayed-auto\",{Acting}}}");
        Probe("POST /api/engine/settings/tier-policy", LeadOnly, $"{{\"mode\":\"auto\",{Acting}}}", tierBefore: TierPolicyMode.Ambient);
        Probe("POST /api/engine/generation-provider/restore", LeadOnly, $"{{{Acting}}}");

        // identity-auth-roles/17: ambient off -> autonomous is a RAISE (lead-only; judged inside the service's
        // compare-and-set loop, not by a filter). The policy is reset to off before every role's request.
        Probe(
            "POST /api/engine/settings/ambient-policy",
            LeadOnly,
            $"{{\"mode\":\"autonomous\",\"maxPerMinute\":1,\"maxPerHour\":1,{Acting}}}");

        // ---- Authoring as a persona (live = conduct, controller only; build: StaffAuthoringTests). ----
        Probe("POST /api/posts", LiveAuthoring);
        Probe("PUT /api/staff/posts/{postId:guid}/pin", ControllerOnly);
        Probe("DELETE /api/staff/posts/{postId:guid}/pin", ControllerOnly);
        Probe("POST /api/media", UploadAuthoring);

        // press-room story 02: a document upload is staff-only until a feature opts participants in — the default-deny
        // IDocumentUploadAuthorizer answers 403 for participant and PIO sessions before the body is read.
        Probe("POST /api/media/documents", PlannerOrController);

        // ---- Participant sim writes (live; staged in StaffAuthoringTests). Staff never react, edit, or
        //      follow without a persona of their own (the services' own refusals). ----
        Probe("PUT /api/posts/{postId:guid}/reactions/{kind}", ParticipantSim);
        Probe("DELETE /api/posts/{postId:guid}/reactions/{kind}", ParticipantSim);
        Probe("PATCH /api/posts/{postId:guid}", ParticipantSim);
        Probe("POST /api/personas/{personaId:guid}/follow", ParticipantSim);
        Probe("DELETE /api/personas/{personaId:guid}/follow", ParticipantSim);

        return rows;
    }
}

/// <summary>How a matrix row is asserted.</summary>
internal enum RowKind
{
    /// <summary>Driven over HTTP for every role.</summary>
    Probe,

    /// <summary>A pre-auth route (sign-in / refresh / logout / secret-gated ops): asserted to be anonymous-allowlisted.</summary>
    PreAuth,

}

/// <summary>One matrix row.</summary>
/// <param name="Kind">How it is asserted.</param>
/// <param name="Expect">Nine 'A'/'R' characters in <see cref="MatrixRole"/> order.</param>
/// <param name="Body">The probe body (JSON), <c>"multipart"</c> for an empty CSV upload, or <c>null</c> for <c>{}</c>.</param>
/// <param name="State">The lifecycle state the exercise is put in before each probe.</param>
/// <param name="TierBefore">The tier-policy mode set before each probe.</param>
internal sealed record MatrixRow(RowKind Kind, string Expect, string? Body, string State, TierPolicyMode TierBefore);
