namespace Pulse.WebApi.Tests.Features.EngineRuntime.Ambient;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.Core.Features.Ambient.Models;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Helpers;
using Xunit;

/// <summary>
/// ambient-chatter story 01, AC3 — the cross-exercise and cross-org extension of the standing isolation suite
/// (XC-001 / COR-001) for <c>POST /api/engine/settings/ambient-policy</c> and the <c>ambientPolicy</c> field of
/// <c>GET /api/engine/settings</c>. Boots the REAL <c>Program</c> composition root over REAL SQL Server with real
/// persisted session tokens: scope comes only from the server-resolved session, never from the body.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class AmbientPolicyIsolationTests
{
    private const string PolicyRoute = "/api/engine/settings/ambient-policy";
    private const string SettingsRoute = "/api/engine/settings";

    private readonly MsSqlContainerFixture _fixture;

    public AmbientPolicyIsolationTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task OwnExerciseController_SetsReview_AndTheSettingsReadReflectsIt()
    {
        var exercise = await SeedExerciseAsync();
        var token = await SeedStaffSessionAsync(sessionExercise: exercise, assignedTo: exercise);
        using var host = new AmbientHost(_fixture.ConnectionString!);
        using var client = Client(host, token);

        var post = await client.PostAsJsonAsync(PolicyRoute, Body("review"));
        post.StatusCode.Should().Be(HttpStatusCode.OK, "the positive control: a controller on their own exercise");
        using (var body = JsonDocument.Parse(await post.Content.ReadAsStringAsync()))
        {
            body.RootElement.GetProperty("ambientPolicy").GetProperty("mode").GetString().Should().Be("review",
                "the POST returns the FULL settings snapshot, like the other settings POSTs");
        }

        using var read = JsonDocument.Parse(await client.GetStringAsync(SettingsRoute));
        read.RootElement.GetProperty("ambientPolicy").GetProperty("mode").GetString().Should().Be("review");
        read.RootElement.GetProperty("ambientPolicy").GetProperty("autonomousAuthorized").GetBoolean().Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task Autonomous_IsRejected400_WhileTheGovernanceFlagIsOff()
    {
        var exercise = await SeedExerciseAsync();
        var token = await SeedStaffSessionAsync(sessionExercise: exercise, assignedTo: exercise);
        using var host = new AmbientHost(_fixture.ConnectionString!);
        using var client = Client(host, token);

        var response = await client.PostAsJsonAsync(PolicyRoute, Body("autonomous"));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).Should().Contain("not authorized by PROVIDER-GOVERNANCE");
        Registry(host).Get(exercise).Mode.Should().Be(AmbientPolicyMode.Off);
    }

    [RequiresDockerFact]
    public async Task ASessionOnExerciseA_FromAStaffUserAssignedOnlyToB_FailsClosed_AndAIsUnchanged()
    {
        var exerciseA = await SeedExerciseAsync();
        var exerciseB = await SeedExerciseAsync();
        var token = await SeedStaffSessionAsync(sessionExercise: exerciseA, assignedTo: exerciseB);
        using var host = new AmbientHost(_fixture.ConnectionString!);
        using var client = Client(host, token);

        var post = await client.PostAsJsonAsync(PolicyRoute, Body("review"));
        var get = await client.GetAsync(SettingsRoute);

        post.StatusCode.Should().BeOneOf([HttpStatusCode.Forbidden, HttpStatusCode.Unauthorized], "a cross-exercise write fails closed");
        get.StatusCode.Should().BeOneOf([HttpStatusCode.Forbidden, HttpStatusCode.Unauthorized], "and so does the read of A's ambientPolicy");
        Registry(host).Get(exerciseA).Mode.Should().Be(AmbientPolicyMode.Off, "A's policy is unchanged");
        Registry(host).Get(exerciseB).Mode.Should().Be(AmbientPolicyMode.Off);
    }

    [RequiresDockerFact]
    public async Task AStaffUserOfAnotherOrganization_FailsClosed_EvenWhenAssigned()
    {
        var exerciseA = await SeedExerciseAsync();
        var otherOrganization = await SeedOrganizationAsync();
        var token = await SeedStaffSessionAsync(sessionExercise: exerciseA, assignedTo: exerciseA, organizationId: otherOrganization);
        using var host = new AmbientHost(_fixture.ConnectionString!);
        using var client = Client(host, token);

        var post = await client.PostAsJsonAsync(PolicyRoute, Body("review"));
        var get = await client.GetAsync(SettingsRoute);

        post.StatusCode.Should().BeOneOf([HttpStatusCode.Forbidden, HttpStatusCode.Unauthorized], "org B never steers org A's exercise");
        get.StatusCode.Should().BeOneOf([HttpStatusCode.Forbidden, HttpStatusCode.Unauthorized]);
        Registry(host).Get(exerciseA).Mode.Should().Be(AmbientPolicyMode.Off);
    }

    [RequiresDockerFact]
    public async Task AnUnresolvedScope_Anonymous_Is401()
    {
        var exerciseA = await SeedExerciseAsync();
        using var host = new AmbientHost(_fixture.ConnectionString!);
        using var client = host.CreateClient();

        (await client.PostAsJsonAsync(PolicyRoute, Body("review"))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await client.GetAsync(SettingsRoute)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        Registry(host).Get(exerciseA).Mode.Should().Be(AmbientPolicyMode.Off);
    }

    [RequiresDockerFact]
    public async Task ASpoofedActingHumanId_IsNotRecorded_TheVerifiedStaffUserIs()
    {
        // SG-7, endpoint level (W-2): attribution comes from the verified session's StaffUser, never the body.
        const string spoofed = "spoofed-lead-99";
        var exercise = await SeedExerciseAsync();
        var token = await SeedStaffSessionAsync(sessionExercise: exercise, assignedTo: exercise);
        using var host = new AmbientHost(_fixture.ConnectionString!);
        using var client = Client(host, token);

        var response = await client.PostAsJsonAsync(PolicyRoute, new
        {
            actingHumanId = spoofed,
            mode = "review",
            maxPerMinute = 2,
            maxPerHour = 20,
            topicAllowList = new[] { "food" },
            timeZone = "UTC",
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var setBy = Registry(host).Get(exercise).SetBy;
        setBy.Should().NotBe(spoofed, "the client-supplied actingHumanId is never trusted for attribution");
        Guid.TryParse(setBy, out var staffUserId).Should().BeTrue("SetBy is the verified session's StaffUser id");

        await using var read = _fixture.CreateContext();
        var audit = await read.TelemetryEvents.IgnoreQueryFilters()
            .Where(e => e.ExerciseId == exercise && e.EventType == EngineEventTypes.TierPolicyChanged)
            .ToListAsync();
        audit.Should().ContainSingle().Which.Actor.ActingHumanId.Should().Be(staffUserId.ToString());
    }

    [RequiresDockerFact]
    public async Task ABodyExerciseId_IsIgnored_TheSessionScopeWins()
    {
        var exerciseA = await SeedExerciseAsync();
        var exerciseB = await SeedExerciseAsync();
        var token = await SeedStaffSessionAsync(sessionExercise: exerciseB, assignedTo: exerciseB);
        using var host = new AmbientHost(_fixture.ConnectionString!);
        using var client = Client(host, token);

        var response = await client.PostAsJsonAsync(PolicyRoute, new
        {
            exerciseId = exerciseA,
            actingHumanId = "controller-7",
            mode = "review",
            maxPerMinute = 2,
            maxPerHour = 20,
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        Registry(host).Get(exerciseB).Mode.Should().Be(AmbientPolicyMode.Review, "the write lands on the session's exercise");
        Registry(host).Get(exerciseA).Mode.Should().Be(AmbientPolicyMode.Off, "a client-supplied exerciseId never selects scope");
    }

    [RequiresDockerFact]
    public async Task APersonaOfAnotherExercise_IsRejected400()
    {
        var exerciseA = await SeedExerciseAsync();
        var exerciseB = await SeedExerciseAsync();
        var foreignPersona = await SeedPersonaAsync(exerciseB);
        var ownPersona = await SeedPersonaAsync(exerciseA);
        var token = await SeedStaffSessionAsync(sessionExercise: exerciseA, assignedTo: exerciseA);
        using var host = new AmbientHost(_fixture.ConnectionString!);
        using var client = Client(host, token);

        var foreign = await client.PostAsJsonAsync(PolicyRoute, Body("review", personas: [foreignPersona.ToString()]));
        foreign.StatusCode.Should().Be(HttpStatusCode.BadRequest, "only personas of THIS exercise may be allow-listed");
        Registry(host).Get(exerciseA).Mode.Should().Be(AmbientPolicyMode.Off);

        var own = await client.PostAsJsonAsync(PolicyRoute, Body("review", personas: [ownPersona.ToString()]));
        own.StatusCode.Should().Be(HttpStatusCode.OK, "the same request with a persona of A is accepted");
        Registry(host).Get(exerciseA).PersonaAllowList.Should().Equal(ownPersona);
    }

    // ---- helpers --------------------------------------------------------------------------------

    private static object Body(string mode, string[]? personas = null) => new
    {
        actingHumanId = "controller-7",
        mode,
        maxPerMinute = 2,
        maxPerHour = 20,
        topicAllowList = new[] { "food", "sports" },
        personaAllowList = personas ?? [],
        timeZone = "UTC",
    };

    private static EngineAmbientPolicyRegistry Registry(AmbientHost host) =>
        host.Services.GetRequiredService<EngineAmbientPolicyRegistry>();

    private static HttpClient Client(AmbientHost host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private async Task<Guid> SeedExerciseAsync()
    {
        var exerciseId = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = exerciseId,
            Name = $"Ambient isolation {exerciseId:N}",
            Hostname = $"ambient-{exerciseId:N}.example.com",
            TimeZone = "UTC",
            Status = "live",
        });
        await seed.SaveChangesAsync();
        return exerciseId;
    }

    private async Task<Guid> SeedOrganizationAsync()
    {
        var organizationId = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Organizations.Add(new Organization
        {
            Id = organizationId,
            Name = $"Other customer {organizationId:N}",
            Slug = $"org-{organizationId:N}",
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
        return organizationId;
    }

    private async Task<Guid> SeedPersonaAsync(Guid exerciseId)
    {
        var personaId = Guid.NewGuid();
        await using var seed = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
        seed.Personas.Add(new Persona
        {
            Id = personaId,
            ExerciseId = exerciseId,
            DisplayName = "Ambient Neighbour",
            Handle = $"@amb{personaId:N}"[..14],
            Kind = "npc",
        });
        await seed.SaveChangesAsync();
        return personaId;
    }

    private async Task<string> SeedStaffSessionAsync(Guid sessionExercise, Guid assignedTo, Guid? organizationId = null)
    {
        var token = $"ambient-staff-{Guid.NewGuid():N}";
        var staffUserId = Guid.NewGuid();
        var session = TestSessions.NewSession(token, sessionExercise, kind: "staff");
        session.StaffUserId = staffUserId;
        session.PrincipalId = staffUserId.ToString();

        await using var seed = _fixture.CreateContext();
        seed.StaffUsers.Add(StaffTenantSeed.StaffUserFor(staffUserId, organizationId));
        seed.Enrollments.Add(new Enrollment
        {
            Id = Guid.NewGuid(),
            PersonId = staffUserId,
            ExerciseId = assignedTo,
            Role = "controller",
            CreatedAt = DateTimeOffset.UtcNow,
        });
        seed.Sessions.Add(session);
        await seed.SaveChangesAsync();
        return token;
    }

    /// <summary>The real <c>Program</c> host over the fixture's migrated database — no service overrides.</summary>
    private sealed class AmbientHost : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

        public AmbientHost(string connectionString)
            => Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}
