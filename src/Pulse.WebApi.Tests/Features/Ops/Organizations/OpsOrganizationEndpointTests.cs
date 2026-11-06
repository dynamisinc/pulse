namespace Pulse.WebApi.Tests.Features.Ops.Organizations;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Credentials;
using Pulse.WebApi.Features.Ops.Bootstrap;
using Pulse.WebApi.Features.Ops.Organizations;
using Pulse.WebApi.Features.Org.PeopleDirectory;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Credentials;
using Pulse.WebApi.Tests.Features.Org.PeopleDirectory;
using Xunit;

/// <summary>
/// identity-auth-roles/20 "Org admin platform provisioning" (#575b; ADMIN-IDENTITY-MODEL §7.6) through the REAL
/// <c>Program</c> pipeline against real SQL: <c>POST /api/ops/organizations</c> is bootstrap-secret gated (a bare 404
/// otherwise), creates the organization with a collision-safe slug, its first org admin WITH a staff facet, and a
/// null-issuer invite; redeeming that invite lands on "sign in", and the org sign-in then mints an org-scope session on an
/// empty organization.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class OpsOrganizationEndpointTests
{
    private const string Secret = "ops-org-test-secret-0f3c";

    private static readonly Uri Route = new(OpsOrganizationEndpoints.Route, UriKind.Relative);
    private static readonly Uri ResetUri = new(CredentialEndpoints.ResetRoute, UriKind.Relative);
    private static readonly Uri LoginUri = new("/api/auth/staff/login", UriKind.Relative);

    private static readonly IReadOnlyDictionary<string, string?> SecretSettings =
        new Dictionary<string, string?> { [$"{BootstrapOptions.SectionName}:Secret"] = Secret };

    private readonly MsSqlContainerFixture _fixture;
    private readonly CredentialTestWorld _world;

    public OpsOrganizationEndpointTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _world = new CredentialTestWorld(fixture);
    }

    [RequiresDockerFact]
    public async Task AWrongMissingOrUnconfiguredSecret_IsTheBare404_AndWritesNothing()
    {
        var name = $"Gate Org {Guid.NewGuid():N}";
        var body = new { name, adminEmail = $"gate.{Guid.NewGuid():N}@example.com" };

        await using (var factory = new CredentialProbeFactory(_fixture.ConnectionString!, settings: SecretSettings))
        {
            using var client = CredentialTestWorld.CreateClient(factory);
            foreach (var secret in new[] { null, string.Empty, "not-the-secret" })
            {
                using var response = await PostAsync(client, body, secret);
                response.StatusCode.Should().Be(HttpStatusCode.NotFound, "secret {0}", secret ?? "(none)");
                (await response.Content.ReadAsStringAsync()).Should().BeEmpty("the bare 404 discloses nothing");
            }
        }

        // No secret configured at all: even an empty presented secret never authorizes.
        await using (var unconfigured = new CredentialProbeFactory(_fixture.ConnectionString!))
        {
            using var client = CredentialTestWorld.CreateClient(unconfigured);
            using var response = await PostAsync(client, body, string.Empty);
            response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        }

        await using var read = _world.ReadContext();
        (await read.Organizations.AsNoTracking().AnyAsync(o => o.Name == name)).Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task Create_ProvisionsTheOrg_ItsFirstAdminWithAStaffFacet_AndANullIssuerInvite_ReturnedOnce()
    {
        var unique = Guid.NewGuid().ToString("N")[..12];
        var name = $"Lantern County {unique}";
        var email = $"Admin.{unique}@Lantern.example";

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!, settings: SecretSettings);
        using var client = CredentialTestWorld.CreateClient(factory);
        using var response = await PostAsync(client, new { name = "  " + name + "  ", adminEmail = email, adminDisplayName = "Avery Admin" }, Secret);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        response.Headers.CacheControl?.NoStore.Should().BeTrue("the body carries a single-use credential link");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
            ["organizationId", "name", "slug", "adminPersonId", "inviteUrl", "emailed"]);
        body.GetProperty("name").GetString().Should().Be(name);
        body.GetProperty("slug").GetString().Should().Be($"lantern-county-{unique}");
        body.GetProperty("emailed").GetBoolean().Should().BeFalse();
        var inviteUrl = body.GetProperty("inviteUrl").GetString()!;
        inviteUrl.Should().StartWith($"{CredentialTestWorld.FrontendBaseUrl}{OrgInviteService.StaffInvitePath}#token=");
        var rawToken = OrgInviteEndpointTests.TokenOf(inviteUrl);

        var org = Guid.Parse(body.GetProperty("organizationId").GetString()!);
        var admin = Guid.Parse(body.GetProperty("adminPersonId").GetString()!);

        await using (var read = _world.ReadContext())
        {
            (await read.Organizations.AsNoTracking().SingleAsync(o => o.Id == org)).Slug.Should().Be($"lantern-county-{unique}");

            var person = await read.People.AsNoTracking().SingleAsync(p => p.Id == admin);
            person.OrganizationId.Should().Be(org);
            person.Email.Should().Be(email.ToLowerInvariant());
            person.DisplayName.Should().Be("Avery Admin");
            person.OrgRole.Should().Be(Person.OrgAdminRole);
            person.PasswordHash.Should().BeNull();

            var facet = await read.StaffUsers.AsNoTracking().SingleAsync(u => u.Id == admin);
            facet.OrganizationId.Should().Be(org, "the facet is created with the person, so the org sign-in can mint");
            facet.ExternalSubject.Should().Be($"pulse|{admin:N}", "a Pulse-local subject the Dynamis allowlist can never match");

            var token = await read.CredentialTokens.AsNoTracking().SingleAsync(t => t.PersonId == admin);
            token.Purpose.Should().Be(CredentialTokenPurposes.Invite);
            token.IssuedByPersonId.Should().BeNull("ops is not a person: a null-issuer, self-delivered invite");
            token.OrganizationId.Should().Be(org);

            var kinds = await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking()
                .Where(a => a.OrganizationId == org).Select(a => a.Kind).ToListAsync();
            kinds.Should().BeEquivalentTo([OpsOrganizationService.OrganizationCreatedKind, OrgInviteService.InviteIssuedKind]);
            (await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking().Where(a => a.OrganizationId == org).ToListAsync())
                .Should().OnlyContain(a => a.ActorPersonId == null && !a.Payload.Contains(rawToken));
        }

        factory.Logs.Messages.Should().NotContain(
            message => message.Contains(rawToken, StringComparison.Ordinal), "the invite token may never reach a log (NFR-009)");
    }

    [RequiresDockerFact]
    public async Task TheFirstAdmin_RedeemsTheInvite_LandsOnSignIn_AndSignsInToTheEmptyOrgAtItsSlug()
    {
        var unique = Guid.NewGuid().ToString("N")[..12];
        var email = $"first.{unique}@example.com";

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!, settings: SecretSettings);
        using var client = CredentialTestWorld.CreateClient(factory);
        using var created = await PostAsync(client, new { name = $"Empty Org {unique}", adminEmail = email }, Secret);
        created.StatusCode.Should().Be(HttpStatusCode.Created);
        var body = await created.Content.ReadFromJsonAsync<JsonElement>();
        var slug = body.GetProperty("slug").GetString()!;

        using (var redeem = await client.PostAsJsonAsync(
            ResetUri, new { token = OrgInviteEndpointTests.TokenOf(body.GetProperty("inviteUrl").GetString()!), newPassword = CredentialTestWorld.NewPassword }))
        {
            redeem.StatusCode.Should().Be(HttpStatusCode.OK);
            var landing = await redeem.Content.ReadFromJsonAsync<JsonElement>();
            landing.GetProperty("next").GetString().Should().Be(InviteLanding.SignInNext, "an org admin holds a grant from the start");
            landing.GetProperty("orgSlug").GetString().Should().Be(slug);
            landing.GetProperty("email").GetString().Should().Be(email);
        }

        using var signIn = await client.PostAsJsonAsync(LoginUri, new { orgSlug = slug, email, password = CredentialTestWorld.NewPassword });
        signIn.StatusCode.Should().Be(HttpStatusCode.OK, "an empty org admin signs in at their org's slug");
        var session = (await signIn.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("session");
        session.GetProperty("exerciseId").ValueKind.Should().Be(JsonValueKind.Null, "an org-scope session: the org has no exercise yet");
        session.GetProperty("scope").GetString().Should().Be("org");
    }

    [RequiresDockerFact]
    public async Task ASlugCollision_TakesTheNextSuffix_AndADuplicateName_Is409()
    {
        var unique = Guid.NewGuid().ToString("N")[..12];

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!, settings: SecretSettings);
        using var client = CredentialTestWorld.CreateClient(factory);

        string SlugOf(JsonElement e) => e.GetProperty("slug").GetString()!;

        using (var first = await PostAsync(client, new { name = $"Acme {unique}", adminEmail = $"a.{unique}@example.com" }, Secret))
        using (var second = await PostAsync(client, new { name = $"Acme, {unique}!", adminEmail = $"b.{unique}@example.com" }, Secret))
        {
            first.StatusCode.Should().Be(HttpStatusCode.Created);
            second.StatusCode.Should().Be(HttpStatusCode.Created, "a different name that slugifies the same is a different org");
            SlugOf(await first.Content.ReadFromJsonAsync<JsonElement>()).Should().Be($"acme-{unique}");
            SlugOf(await second.Content.ReadFromJsonAsync<JsonElement>()).Should().Be($"acme-{unique}-2", "#602 L-5's suffix rule");
        }

        using var duplicate = await PostAsync(client, new { name = $"Acme {unique}", adminEmail = $"c.{unique}@example.com" }, Secret);
        duplicate.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await duplicate.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString()
            .Should().Be(OpsOrganizationService.OrganizationExistsError);

        await using var read = _world.ReadContext();
        (await read.People.AsNoTracking().AnyAsync(p => p.Email == $"c.{unique}@example.com"))
            .Should().BeFalse("the refused create rolled back entirely");
    }

    [RequiresDockerFact]
    public async Task ABadBody_Is400_WithTheFieldsCode_AndNoFrontendBaseUrl_Is503()
    {
        await using (var factory = new CredentialProbeFactory(_fixture.ConnectionString!, settings: SecretSettings))
        {
            using var client = CredentialTestWorld.CreateClient(factory);
            foreach (var (body, error) in new (object Body, string Error)[]
            {
                (new { }, OpsOrganizationService.InvalidNameError),
                (new { name = "   ", adminEmail = "a@example.com" }, OpsOrganizationService.InvalidNameError),
                (new { name = new string('n', OpsOrganizationService.MaxNameLength + 1), adminEmail = "a@example.com" }, OpsOrganizationService.InvalidNameError),
                (new { name = "Valid Org", adminEmail = "nope" }, OpsOrganizationService.InvalidAdminEmailError),
                (new { name = "Valid Org", adminEmail = "a@example.com", adminDisplayName = new string('d', Person.MaxDisplayNameLength + 1) }, OpsOrganizationService.InvalidAdminDisplayNameError),
            })
            {
                using var response = await PostAsync(client, body, Secret);
                response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
                (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString().Should().Be(error);
            }
        }

        await using var noBase = new CredentialProbeFactory(_fixture.ConnectionString!, frontendBaseUrl: null, settings: SecretSettings);
        using var noBaseClient = CredentialTestWorld.CreateClient(noBase);
        var unique = Guid.NewGuid().ToString("N")[..12];
        using var unavailable = await PostAsync(noBaseClient, new { name = $"No Base {unique}", adminEmail = $"x.{unique}@example.com" }, Secret);
        unavailable.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);

        await using var read = _world.ReadContext();
        (await read.Organizations.AsNoTracking().AnyAsync(o => o.Name == $"No Base {unique}")).Should().BeFalse();
    }

    private static Task<HttpResponseMessage> PostAsync(HttpClient client, object body, string? secret)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, Route) { Content = JsonContent.Create(body) };
        if (secret is not null)
        {
            request.Headers.Add(BootstrapEndpoints.BootstrapSecretHeaderName, secret);
        }

        return client.SendAsync(request);
    }
}
