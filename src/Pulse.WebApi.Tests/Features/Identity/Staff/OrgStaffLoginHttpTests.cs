namespace Pulse.WebApi.Tests.Features.Identity.Staff;

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
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// identity-auth-roles/15 over the REAL <c>Program</c> host (the routes are mapped by the already-wired
/// <c>MapStaffAuthEndpoints()</c>): the org sign-in and org choice wire contract, <c>Cache-Control: no-store</c>, the
/// uniform 401, the org-scope session reaching the <c>/api/org/*</c> surface with its tenant resolved and failing closed
/// on exercise-scoped routes, and the active-exercise switch's bare 404 for foreign / missing targets.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class OrgStaffLoginHttpTests
{
    private const string LoginRoute = "/api/auth/staff/login";
    private const string ChooseRoute = "/api/auth/staff/login/choose";

    private readonly MsSqlContainerFixture _fixture;
    private readonly OrgSignInTestKit _kit;

    public OrgStaffLoginHttpTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _kit = new OrgSignInTestKit(fixture);
    }

    [RequiresDockerFact]
    public async Task OrgAdminOfAnEmptyOrg_SignsIn_GetsTheOrgScopeSession_AndTheOrgSurfaceWorks_ExerciseRoutesFailClosed()
    {
        // AC1 / AC2 / AC3 / AC5 and the Copilot review 3 contract ({world:'staff', scope:'org', role:'orgAdmin', exerciseId:null}).
        var org = await _kit.SeedOrganizationAsync();
        var email = OrgSignInTestKit.NewEmail();
        var admin = await _kit.SeedPersonAsync(org.Id, email, orgRole: Person.OrgAdminRole);

        using var host = new Host(_fixture.ConnectionString!);
        using var anonymous = host.CreateClient();
        using var login = await anonymous.PostAsJsonAsync(LoginRoute, new { orgSlug = org.Slug, email, password = OrgSignInTestKit.Password });

        login.StatusCode.Should().Be(HttpStatusCode.OK);
        login.Headers.CacheControl!.NoStore.Should().BeTrue("the 200 carries session tokens");
        using var body = JsonDocument.Parse(await login.Content.ReadAsStringAsync());
        var token = body.RootElement.GetProperty("token").GetString()!;
        var session = body.RootElement.GetProperty("session");
        session.GetProperty("exerciseId").ValueKind.Should().Be(JsonValueKind.Null);
        session.GetProperty("scope").GetString().Should().Be("org");
        session.GetProperty("world").GetString().Should().Be("staff");
        session.GetProperty("role").GetString().Should().Be("orgAdmin");
        session.GetProperty("personId").GetString().Should().Be(admin.ToString());

        using var client = Authorized(host, token);
        (await client.GetAsync("/api/session")).StatusCode.Should().Be(HttpStatusCode.OK);
        (await client.GetAsync("/api/org/exercises")).StatusCode.Should().Be(HttpStatusCode.OK);
        (await client.GetAsync("/api/org/staff-assignments")).StatusCode.Should().Be(HttpStatusCode.OK);

        // COR-074: the org admin of an EMPTY organization creates its first exercise from org scope.
        using var created = await client.PostAsJsonAsync(
            "/api/org/exercises", new { name = $"First {Guid.NewGuid():N}", hostname = $"first-{Guid.NewGuid():N}.example.com" });
        created.IsSuccessStatusCode.Should().BeTrue("an org-scope session reaches POST /api/org/exercises unchanged");

        // AC3: exercise-scoped routes fail closed under org scope (CurrentExerciseId stays null) — never "every exercise".
        (await client.GetAsync("/api/staff/exercise-lifecycle")).StatusCode
            .Should().BeOneOf(HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden);
        (await client.GetAsync("/api/feed")).StatusCode
            .Should().BeOneOf(HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden, HttpStatusCode.NotFound);
    }

    [RequiresDockerFact]
    public async Task OrgScopeSession_OnAnExerciseHost_NeverReadsThatExercisesContent_TheSessionsNullScopeWins()
    {
        // AC3 / exercise-isolation/07 — "staff session, no exercise scope", distinct from "no session at all": the
        // host resolves exercise X provisionally, but the org-scope session's NULL exercise overwrites it, so a
        // participant-facing scoped read fails closed instead of reading X (or every exercise).
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org.Id);
        var personaId = Guid.NewGuid();
        await using (var seed = _kit.Context())
        {
            seed.Personas.Add(new Persona
            {
                Id = personaId,
                ExerciseId = exercise,
                DisplayName = $"Persona {personaId:N}",
                Handle = $"@p_{personaId:N}",
                Kind = "human",
            });
            await seed.SaveChangesAsync();
        }

        var email = OrgSignInTestKit.NewEmail();
        await _kit.SeedPersonAsync(org.Id, email, orgRole: Person.OrgAdminRole);

        using var host = new Host(_fixture.ConnectionString!);
        var token = await LoginAsync(host, new { orgSlug = org.Slug, email, password = OrgSignInTestKit.Password });
        using var client = Authorized(host, token);
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/personas");
        request.Headers.Host = $"signin-{exercise:N}.example.com";
        using var response = await client.SendAsync(request);

        var text = await response.Content.ReadAsStringAsync();
        text.Should().NotContain(personaId.ToString(), "an org-scope session never reads an exercise's content");
        text.Should().NotContain($"@p_{personaId:N}");
        if (response.StatusCode == HttpStatusCode.OK)
        {
            JsonDocument.Parse(text).RootElement.EnumerateArray().Should().BeEmpty("zero rows — the fail-closed collapse");
        }
        else
        {
            response.StatusCode.Should().BeOneOf(HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden);
        }
    }

    [RequiresDockerFact]
    public async Task OrgScopeSession_ResolvesItsOwnTenant_WithNoExerciseInTheRequest()
    {
        // AC4: OrganizationResolutionMiddleware resolves the tenant from the staff facet alone — the list carries the
        // org's own exercise (in which the admin holds NO enrollment) and never another organization's.
        var org = await _kit.SeedOrganizationAsync();
        var other = await _kit.SeedOrganizationAsync();
        var own = await _kit.SeedExerciseAsync(org.Id);
        var foreign = await _kit.SeedExerciseAsync(other.Id);
        var email = OrgSignInTestKit.NewEmail();
        await _kit.SeedPersonAsync(org.Id, email, orgRole: Person.OrgAdminRole);

        using var host = new Host(_fixture.ConnectionString!);
        var token = await LoginAsync(host, new { email, password = OrgSignInTestKit.Password });

        using var list = await Authorized(host, token).GetAsync("/api/org/exercises");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var text = await list.Content.ReadAsStringAsync();
        text.Should().Contain(own.ToString());
        text.Should().NotContain(foreign.ToString(), "the tenant is the caller's own organization, never another");
    }

    [RequiresDockerFact]
    public async Task EveryRefusal_IsTheSameEmpty401_WithNoStore()
    {
        var org = await _kit.SeedOrganizationAsync();
        var foreign = await _kit.SeedOrganizationAsync();
        var email = OrgSignInTestKit.NewEmail();
        await _kit.SeedPersonAsync(org.Id, email, orgRole: Person.OrgAdminRole);

        using var host = new Host(_fixture.ConnectionString!);
        using var client = host.CreateClient();
        object[] bodies =
        [
            new { orgSlug = org.Slug, email, password = "wrong password" },
            new { orgSlug = foreign.Slug, email, password = OrgSignInTestKit.Password },
            new { orgSlug = $"missing-{Guid.NewGuid():N}", email, password = OrgSignInTestKit.Password },
            new { email = OrgSignInTestKit.NewEmail(), password = OrgSignInTestKit.Password },
        ];

        foreach (var body in bodies)
        {
            using var response = await client.PostAsJsonAsync(LoginRoute, body);
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await response.Content.ReadAsStringAsync()).Should().BeEmpty("the refusal is uniform — nothing distinguishes the cases");
            response.Headers.CacheControl!.NoStore.Should().BeTrue();
        }

        using var choose = await client.PostAsJsonAsync(ChooseRoute, new { choiceToken = "not-a-token", orgSlug = org.Slug });
        choose.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await choose.Content.ReadAsStringAsync()).Should().BeEmpty();
        choose.Headers.CacheControl!.NoStore.Should().BeTrue();
    }

    [RequiresDockerFact]
    public async Task EmailFirstChoice_OverHttp_ListsOnlyVerifiedOrgs_ChooseMintsOnce_ForeignOrgRefused()
    {
        var orgA = await _kit.SeedOrganizationAsync();
        var orgB = await _kit.SeedOrganizationAsync();
        var foreign = await _kit.SeedOrganizationAsync();
        var email = OrgSignInTestKit.NewEmail();
        await _kit.SeedPersonAsync(orgA.Id, email, orgRole: Person.OrgAdminRole);
        await _kit.SeedPersonAsync(orgB.Id, email, orgRole: Person.OrgAdminRole);

        using var host = new Host(_fixture.ConnectionString!);
        using var client = host.CreateClient();
        using var login = await client.PostAsJsonAsync(LoginRoute, new { email, password = OrgSignInTestKit.Password });

        login.StatusCode.Should().Be(HttpStatusCode.OK);
        login.Headers.CacheControl!.NoStore.Should().BeTrue();
        using var choice = JsonDocument.Parse(await login.Content.ReadAsStringAsync());
        choice.RootElement.TryGetProperty("token", out _).Should().BeFalse("no session before the choice");
        var orgs = choice.RootElement.GetProperty("choose").EnumerateArray()
            .Select(o => (Slug: o.GetProperty("slug").GetString(), Name: o.GetProperty("orgName").GetString())).ToList();
        orgs.Should().BeEquivalentTo([(orgA.Slug, orgA.Name), (orgB.Slug, orgB.Name)]);
        var choiceToken = choice.RootElement.GetProperty("choiceToken").GetString()!;

        (await client.PostAsJsonAsync(ChooseRoute, new { choiceToken, orgSlug = foreign.Slug })).StatusCode
            .Should().Be(HttpStatusCode.Unauthorized, "a foreign (non-candidate) organization is refused");

        using var chosen = await client.PostAsJsonAsync(ChooseRoute, new { choiceToken, orgSlug = orgA.Slug });
        chosen.StatusCode.Should().Be(HttpStatusCode.OK);
        chosen.Headers.CacheControl!.NoStore.Should().BeTrue();
        using var minted = JsonDocument.Parse(await chosen.Content.ReadAsStringAsync());
        minted.RootElement.GetProperty("session").GetProperty("scope").GetString().Should().Be("org");

        (await client.PostAsJsonAsync(ChooseRoute, new { choiceToken, orgSlug = orgB.Slug })).StatusCode
            .Should().Be(HttpStatusCode.Unauthorized, "the whole choice was consumed");

        (await client.PostAsJsonAsync(ChooseRoute, new { orgSlug = orgB.Slug })).StatusCode
            .Should().Be(HttpStatusCode.BadRequest, "a missing choiceToken is a validation 400");
    }

    [RequiresDockerFact]
    public async Task ActiveExercise_FromAnOrgLogin_EntersOwnEnrollment_ForeignOrMissingIsTheBare404()
    {
        var org = await _kit.SeedOrganizationAsync();
        var other = await _kit.SeedOrganizationAsync();
        var own = await _kit.SeedExerciseAsync(org.Id);
        var sameOrgNotEnrolled = await _kit.SeedExerciseAsync(org.Id);
        var foreign = await _kit.SeedExerciseAsync(other.Id);
        var email = OrgSignInTestKit.NewEmail();
        var admin = await _kit.SeedPersonAsync(org.Id, email, orgRole: Person.OrgAdminRole);
        await _kit.SeedEnrollmentAsync(own, admin, "planner");

        using var host = new Host(_fixture.ConnectionString!);
        using var client = Authorized(host, await LoginAsync(host, new { orgSlug = org.Slug, email, password = OrgSignInTestKit.Password }));

        foreach (var target in new[] { foreign, Guid.NewGuid(), sameOrgNotEnrolled })
        {
            using var refused = await client.PostAsJsonAsync("/api/staff/active-exercise", new { exerciseId = target.ToString() });
            refused.StatusCode.Should().Be(HttpStatusCode.NotFound);
            (await refused.Content.ReadAsStringAsync()).Should().BeEmpty("the bare 404");
        }

        using var entered = await client.PostAsJsonAsync("/api/staff/active-exercise", new { exerciseId = own.ToString() });
        entered.StatusCode.Should().Be(HttpStatusCode.OK);

        // Now exercise-bound: a foreign or missing target is still the bare 404 (aligned in 15); an unenrolled same-org
        // exercise keeps story 05's documented 403.
        (await client.PostAsJsonAsync("/api/staff/active-exercise", new { exerciseId = foreign.ToString() })).StatusCode
            .Should().Be(HttpStatusCode.NotFound);
        (await client.PostAsJsonAsync("/api/staff/active-exercise", new { exerciseId = Guid.NewGuid().ToString() })).StatusCode
            .Should().Be(HttpStatusCode.NotFound);
        (await client.PostAsJsonAsync("/api/staff/active-exercise", new { exerciseId = sameOrgNotEnrolled.ToString() })).StatusCode
            .Should().Be(HttpStatusCode.Forbidden);
    }

    [RequiresDockerFact]
    public async Task NonAdminOrgLogin_LandsOnTheirStaffEnrollment_ExerciseScope()
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org.Id);
        var email = OrgSignInTestKit.NewEmail();
        var person = await _kit.SeedPersonAsync(org.Id, email);
        await _kit.SeedEnrollmentAsync(exercise, person, "controller");

        using var host = new Host(_fixture.ConnectionString!);
        using var client = host.CreateClient();
        using var login = await client.PostAsJsonAsync(LoginRoute, new { orgSlug = org.Slug, email, password = OrgSignInTestKit.Password });

        login.StatusCode.Should().Be(HttpStatusCode.OK);
        using var body = JsonDocument.Parse(await login.Content.ReadAsStringAsync());
        var session = body.RootElement.GetProperty("session");
        session.GetProperty("scope").GetString().Should().Be("exercise");
        session.GetProperty("exerciseId").GetString().Should().Be(exercise.ToString());
        session.GetProperty("role").GetString().Should().Be("controller");
    }

    private static async Task<string> LoginAsync(Host host, object body)
    {
        using var client = host.CreateClient();
        using var response = await client.PostAsJsonAsync(LoginRoute, body);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.GetProperty("token").GetString()!;
    }

    private static HttpClient Authorized(Host host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private sealed class Host : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

        public Host(string connectionString) => Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}
