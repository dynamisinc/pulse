namespace Pulse.WebApi.Tests.Features.Identity.Roster;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Roster;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// easy-login/02 (AC-1, AC-5, AC-6 and the Authorization AC, EL-13) — the three roster routes over a self-hosted test
/// server that maps exactly <see cref="RosterEndpoints.MapRosterEndpoints"/> with the REAL filters
/// (<c>EngineCockpitStaffAuthorizationFilter</c> then <c>RosterStaffRoleFilter</c>) and real SQL: 200/201/400/409/401/403,
/// ProblemDetails bodies, and <c>Cache-Control: no-store</c> on every response, refusals included. The no-staff-session
/// 401 needs no database (the gate answers before any read), so it is a plain fact.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class RosterEndpointsHttpTests
{
    private const string Header = "name,agency,role,email,personaHandle,signInName\n";

    private readonly MsSqlContainerFixture _fixture;

    public RosterEndpointsHttpTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task List_Is200_WithTheFrozenShape_AndNoStore()
    {
        var world = await RosterSeed.ExerciseAsync(_fixture);
        await RosterSeed.AccountAsync(_fixture, world.ExerciseId, "atanaka", "Aiko Tanaka");
        using var host = await RosterHttpHost.StartAsync(_fixture, world.ExerciseId, world.StaffSession);
        using var client = host.GetTestClient();

        var response = await client.GetAsync(RosterEndpoints.RosterRoute);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Headers.CacheControl!.NoStore.Should().BeTrue();
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        body.RootElement.GetProperty("joinLinksAvailable").GetBoolean().Should().BeTrue();
        body.RootElement.GetProperty("capabilities").GetProperty("emailLinks").GetBoolean().Should().BeFalse();
        var entry = body.RootElement.GetProperty("participants").EnumerateArray().Should().ContainSingle().Subject;
        entry.GetProperty("signInName").GetString().Should().Be("atanaka");
        entry.GetProperty("link").GetProperty("status").GetString().Should().Be("none");
        entry.TryGetProperty("agency", out _).Should().BeFalse("an absent optional field is omitted, never null");
        entry.TryGetProperty("persona", out _).Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task Add_Is201WithTheEntry_ThenTheSameKeyIs409_AndAnInvalidFieldIs400_AsProblemDetails()
    {
        var world = await RosterSeed.ExerciseAsync(_fixture);
        using var host = await RosterHttpHost.StartAsync(_fixture, world.ExerciseId, world.StaffSession);
        using var client = host.GetTestClient();

        var created = await client.PostAsJsonAsync(RosterEndpoints.RosterRoute, new { name = "Riley Chen", agency = "Fulco Fire", exerciseId = Guid.NewGuid() });
        created.StatusCode.Should().Be(HttpStatusCode.Created);
        created.Headers.CacheControl!.NoStore.Should().BeTrue();
        var entry = (await created.Content.ReadFromJsonAsync<RosterEntryDto>())!;
        entry.SignInName.Should().Be("rchen");
        entry.Link.Status.Should().Be(RosterLinkStatuses.Active, "a new participant has an active link before the response returns");

        var duplicate = await client.PostAsJsonAsync(RosterEndpoints.RosterRoute, new { name = "riley  chen", agency = "fulco fire" });
        duplicate.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await ProblemDetailAsync(duplicate)).Should().Be(RosterService.AlreadyOnRosterMessage);

        var invalid = await client.PostAsJsonAsync(RosterEndpoints.RosterRoute, new { name = "A B", email = "nope" });
        invalid.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await ProblemDetailAsync(invalid)).Should().Be(RosterRowRules.EmailInvalidMessage);

        var nullBody = await client.PostAsync(RosterEndpoints.RosterRoute, new StringContent("null", Encoding.UTF8, "application/json"));
        nullBody.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        await using var read = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = world.ExerciseId });
        (await read.Accounts.SingleAsync()).ExerciseId.Should().Be(
            world.ExerciseId, "a body's exerciseId is ignored: the scope is the resolved one");
    }

    [RequiresDockerFact]
    public async Task Import_Is200_ADryRunWritesNothing_AndARealRunWrites()
    {
        var world = await RosterSeed.ExerciseAsync(_fixture);
        using var host = await RosterHttpHost.StartAsync(_fixture, world.ExerciseId, world.StaffSession);
        using var client = host.GetTestClient();
        const string file = Header + "Riley Chen,Fulco Fire,,,,\nTaylor Reed,,,,,";

        var dry = await client.PostAsync(RosterEndpoints.ImportRoute + "?dryRun=true", RosterSeed.CsvUpload(file));
        dry.StatusCode.Should().Be(HttpStatusCode.OK);
        dry.Headers.CacheControl!.NoStore.Should().BeTrue();
        var dryReport = (await dry.Content.ReadFromJsonAsync<RosterImportResultDto>())!;
        (dryReport.DryRun, dryReport.CreatedCount).Should().Be((true, 2));

        await using (var read = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = world.ExerciseId }))
        {
            (await read.Accounts.CountAsync()).Should().Be(0, "dryRun=true writes nothing");
        }

        var real = await client.PostAsync(RosterEndpoints.ImportRoute, RosterSeed.CsvUpload(file));
        real.StatusCode.Should().Be(HttpStatusCode.OK);
        var realReport = (await real.Content.ReadFromJsonAsync<RosterImportResultDto>())!;
        (realReport.DryRun, realReport.CreatedCount).Should().Be((false, 2), "an absent dryRun is a real run");

        await using var after = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = world.ExerciseId });
        (await after.Accounts.CountAsync()).Should().Be(2);
        (await after.ParticipantLinks.CountAsync()).Should().Be(2);
    }

    [RequiresDockerFact]
    public async Task Import_RefusesABadUpload_With400AndAReadableReason_AndWritesNothing()
    {
        var world = await RosterSeed.ExerciseAsync(_fixture);
        using var host = await RosterHttpHost.StartAsync(_fixture, world.ExerciseId, world.StaffSession);
        using var client = host.GetTestClient();

        var cases = new (string Label, HttpContent Content, string Query, string Reason)[]
        {
            ("empty file", RosterSeed.CsvUpload(string.Empty), string.Empty, "non-empty CSV"),
            ("over 1 MB", RosterSeed.CsvUpload("name\n" + new string('a', RosterEndpoints.MaxImportFileBytes)), string.Empty, "maximum size"),
            ("not a CSV", RosterSeed.CsvUpload("name\nA B", "photo.png", "image/png"), string.Empty, "must be a CSV"),
            ("no name column", RosterSeed.CsvUpload("agency\nFulco"), string.Empty, "\"name\" column"),
            ("more than 5000 rows", RosterSeed.CsvUpload("name\n" + string.Concat(Enumerable.Range(0, 5001).Select(i => $"P {i}\n"))), string.Empty, "5000"),
            ("a dryRun typo", RosterSeed.CsvUpload("name\nA B"), "?dryRun=ture", "dryRun must be true or false"),
            ("no file field", new MultipartFormDataContent { { new StringContent("x"), "other" } }, string.Empty, "non-empty CSV"),
        };

        foreach (var (label, content, query, reason) in cases)
        {
            var response = await client.PostAsync(RosterEndpoints.ImportRoute + query, content);
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest, label);
            response.Headers.CacheControl!.NoStore.Should().BeTrue(label);
            (await ProblemDetailAsync(response)).Should().Contain(reason, label);
        }

        await using var read = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = world.ExerciseId });
        (await read.Accounts.CountAsync()).Should().Be(0, "a refused file writes nothing");
    }

    [RequiresDockerFact]
    public async Task AnEvaluator_AndAnUnassignedStaffUser_Are403_OnEveryRoute()
    {
        var evaluator = await RosterSeed.ExerciseAsync(_fixture, staffRole: "evaluator");
        var elsewhere = await RosterSeed.ExerciseAsync(_fixture, staffRole: "controller");

        foreach (var (scope, staff) in new[] { (evaluator.ExerciseId, evaluator.StaffSession), (evaluator.ExerciseId, elsewhere.StaffSession) })
        {
            using var host = await RosterHttpHost.StartAsync(_fixture, scope, staff);
            using var client = host.GetTestClient();

            foreach (var response in new[]
            {
                await client.GetAsync(RosterEndpoints.RosterRoute),
                await client.PostAsJsonAsync(RosterEndpoints.RosterRoute, new { name = "A B" }),
                await client.PostAsync(RosterEndpoints.ImportRoute, RosterSeed.CsvUpload(Header + "A B,,,,,")),
            })
            {
                response.StatusCode.Should().Be(HttpStatusCode.Forbidden, "only an assigned controller or planner may use the roster (EL-13)");
                response.Headers.CacheControl!.NoStore.Should().BeTrue();
            }
        }

        await using var read = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = evaluator.ExerciseId });
        (await read.Accounts.CountAsync()).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task APlanner_IsAdmitted()
    {
        var planner = await RosterSeed.ExerciseAsync(_fixture, staffRole: "planner");
        using var host = await RosterHttpHost.StartAsync(_fixture, planner.ExerciseId, planner.StaffSession);
        using var client = host.GetTestClient();

        (await client.GetAsync(RosterEndpoints.RosterRoute)).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    private static async Task<string?> ProblemDetailAsync(HttpResponseMessage response)
    {
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return problem.RootElement.GetProperty("detail").GetString();
    }
}

/// <summary>
/// easy-login/02 (Authorization AC) — the database-free half of <see cref="RosterEndpointsHttpTests"/>: with no staff
/// session every roster route is a 401 carrying <c>Cache-Control: no-store</c>, decided by the gate before any read, so
/// it needs no SQL Server and runs everywhere.
/// </summary>
public sealed class RosterEndpointsGateHttpTests
{
    private const string Header = "name,agency,role,email,personaHandle,signInName\n";

    [Fact]
    public async Task EveryRoute_WithNoStaffSession_Is401_AndNoStore()
    {
        // A participant, read-only or anonymous caller: the staff accessor yields nothing. The DbContext never connects.
        using var host = await RosterHttpHost.StartAsync(services =>
        {
            services.AddDbContext<PulseDbContext>(options =>
                options.UseSqlServer("Server=nonexistent;Database=pulse;Trusted_Connection=False;"));
            services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = Guid.NewGuid() });
            services.AddScoped<ICurrentStaffSessionAccessor, NullCurrentStaffSessionAccessor>();
        });
        using var client = host.GetTestClient();

        foreach (var response in new[]
        {
            await client.GetAsync(RosterEndpoints.RosterRoute),
            await client.PostAsJsonAsync(RosterEndpoints.RosterRoute, new { name = "A B" }),
            await client.PostAsync(RosterEndpoints.ImportRoute + "?dryRun=true", RosterSeed.CsvUpload(Header + "A B,,,,,")),
        })
        {
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "no staff session never reaches a roster handler");
            response.Headers.CacheControl!.NoStore.Should().BeTrue("every roster response, a refusal included, is no-store");
        }
    }
}
