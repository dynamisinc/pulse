namespace Pulse.WebApi.Tests.Features.Identity.RoleMatrix;

using System;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;

/// <summary>
/// identity-auth-roles/17 lead-controller folds (ADMIN-IDENTITY-MODEL §1.1, §12 Option A; L-002 / M-003): the five
/// covered routes in BOTH directions for the lead, a non-lead controller, a planner and an evaluator. Raising needs the
/// lead; lowering is open to any controller; planners and evaluators are refused both ways. The lead flag is read live
/// and keyed on the session's person, never on a body <c>actingHumanId</c>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class LeadControllerGateTests
{
    private readonly MsSqlContainerFixture _fixture;

    public LeadControllerGateTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    public enum Direction
    {
        Raise,
        Lower,
    }

    [RequiresDockerTheory]
    [InlineData("swamped-mode", Direction.Raise)]
    [InlineData("swamped-mode", Direction.Lower)]
    [InlineData("autonomy-default", Direction.Raise)]
    [InlineData("autonomy-default", Direction.Lower)]
    [InlineData("tier-policy", Direction.Raise)]
    [InlineData("tier-policy", Direction.Lower)]
    [InlineData("tier-policy-standard-from-ambient", Direction.Raise)]
    [InlineData("tier-policy-ambient-from-standard", Direction.Lower)]
    [InlineData("autonomy-restore", Direction.Raise)]
    [InlineData("kill-switch", Direction.Lower)]
    [InlineData("provider-restore", Direction.Raise)]
    [InlineData("cut-to-fake", Direction.Lower)]
    public async Task RaiseNeedsTheLead_LowerIsAnyController_PlannerAndEvaluatorNeither(string control, Direction direction)
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture);
        using var host = new RoleMatrixHost(_fixture.ConnectionString!);

        foreach (var (role, expectAllowed) in new[]
        {
            (MatrixRole.Evaluator, false),
            (MatrixRole.Planner, false),
            (MatrixRole.Controller, direction == Direction.Lower),
            (MatrixRole.LeadController, true),
        })
        {
            var (route, body) = Arrange(host, world.ExerciseId, control, direction);
            using var client = world.Client(host, await world.TokenForAsync(role));
            using var response = await client.PostAsync(route, Json(body));

            if (expectAllowed)
            {
                response.StatusCode.Should().Be(HttpStatusCode.OK, "{0} may {1} via {2}", role, direction, control);
            }
            else
            {
                response.StatusCode.Should().Be(HttpStatusCode.Forbidden, "{0} may not {1} via {2}", role, direction, control);
            }
        }
    }

    [RequiresDockerFact]
    public async Task ANonLead_ClaimingTheLeadsIdInTheBody_IsStillRefused_AndAPromotionTakesEffectLiveWithoutReSignIn()
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture);
        using var host = new RoleMatrixHost(_fixture.ConnectionString!);
        using var controller = world.Client(host, await world.TokenForAsync(MatrixRole.Controller));
        var leadId = world.PersonOf(MatrixRole.LeadController);

        using var spoofed = await controller.PostAsync(
            "/api/engine/autonomy/swamped-mode", Json($"{{\"enabled\":true,\"actingHumanId\":\"{leadId}\"}}"));
        spoofed.StatusCode.Should().Be(HttpStatusCode.Forbidden, "the gate keys on the session's person, never the body");

        using var planner = world.Client(host, await world.TokenForAsync(MatrixRole.Planner));
        using var promoted = await planner.PutAsync($"/api/staff/enrollments/{world.ControllerEnrollmentId}/lead", content: null);
        promoted.StatusCode.Should().Be(HttpStatusCode.OK);

        using var raised = await controller.PostAsync(
            "/api/engine/autonomy/swamped-mode", Json("{\"enabled\":true,\"actingHumanId\":\"x\"}"));
        raised.StatusCode.Should().Be(HttpStatusCode.OK, "IsLead is read live on the same session — no re-sign-in");
    }

    private static (string Route, string Body) Arrange(RoleMatrixHost host, Guid exerciseId, string control, Direction direction)
    {
        var autonomy = host.Services.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(exerciseId);
        var tiers = host.Services.GetRequiredService<EngineTierPolicyRegistry>();
        var raise = direction == Direction.Raise;
        const string Acting = "\"actingHumanId\":\"lead-gate-test\"";

        switch (control)
        {
            case "swamped-mode":
                // Raise: off -> on. Lower: on -> off.
                autonomy.SetSwampedMode(!raise, "arrange", 0);
                return ("/api/engine/autonomy/swamped-mode", $"{{\"enabled\":{(raise ? "true" : "false")},{Acting}}}");
            case "autonomy-default":
                autonomy.SetExerciseDefault(raise ? AutonomyLevel.Suggest : AutonomyLevel.DelayedAuto, "arrange", 0);
                return ("/api/engine/settings/autonomy-default", $"{{\"level\":\"{(raise ? "delayed-auto" : "suggest")}\",{Acting}}}");
            case "tier-policy":
                // Raise: ambient -> auto. Lower: auto -> ambient.
                tiers.SetMode(exerciseId, raise ? TierPolicyMode.Ambient : TierPolicyMode.Auto);
                return ("/api/engine/settings/tier-policy", $"{{\"mode\":\"{(raise ? "auto" : "ambient")}\",{Acting}}}");
            case "tier-policy-standard-from-ambient":
                tiers.SetMode(exerciseId, TierPolicyMode.Ambient);
                return ("/api/engine/settings/tier-policy", $"{{\"mode\":\"standard\",{Acting}}}");
            case "tier-policy-ambient-from-standard":
                tiers.SetMode(exerciseId, TierPolicyMode.Standard);
                return ("/api/engine/settings/tier-policy", $"{{\"mode\":\"ambient\",{Acting}}}");
            case "autonomy-restore":
                return ("/api/engine/autonomy/restore", $"{{{Acting}}}");
            case "kill-switch":
                return ("/api/engine/autonomy/kill-switch", $"{{\"mode\":\"drop-to-suggest\",{Acting}}}");
            case "provider-restore":
                return ("/api/engine/generation-provider/restore", $"{{{Acting}}}");
            case "cut-to-fake":
                return ("/api/engine/generation-provider/cut-to-fake", $"{{{Acting}}}");
            default:
                throw new ArgumentOutOfRangeException(nameof(control));
        }
    }

    private static StringContent Json(string body) => new(body, System.Text.Encoding.UTF8, "application/json");
}
