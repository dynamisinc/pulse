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
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Credentials;
using Pulse.WebApi.Features.Identity.LinkEmail;
using Pulse.WebApi.Features.Ops.Bootstrap;
using Pulse.WebApi.Features.Ops.Organizations;
using Pulse.WebApi.Features.Org.PeopleDirectory;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Credentials;
using Pulse.WebApi.Tests.Features.Org.PeopleDirectory;
using Xunit;

/// <summary>
/// #847 — <c>POST /api/ops/organizations/{slug}/admin-invite {adminEmail}</c> through the REAL <c>Program</c> pipeline
/// against real SQL. Bootstrap-secret gated (a bare 404 otherwise); re-issues a null-issuer invite for the organization's
/// named org admin and voids the earlier one, for an expired or an undelivered invite alike; keeps the CR-001 link rule
/// (the link only while no mailer is configured) and the tenant id off the wire (XC-002). An unknown slug, or an email that
/// is not an org admin of THAT organization, is the same bare 404.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class OpsAdminInviteReissueEndpointTests
{
    private const string Secret = "ops-reissue-test-secret-7a1d";

    private static readonly Uri ProvisionRoute = new(OpsOrganizationEndpoints.Route, UriKind.Relative);
    private static readonly Uri ResetUri = new(CredentialEndpoints.ResetRoute, UriKind.Relative);

    private static readonly IReadOnlyDictionary<string, string?> SecretSettings =
        new Dictionary<string, string?> { [$"{BootstrapOptions.SectionName}:Secret"] = Secret };

    private readonly MsSqlContainerFixture _fixture;
    private readonly CredentialTestWorld _world;

    public OpsAdminInviteReissueEndpointTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _world = new CredentialTestWorld(fixture);
    }

    [RequiresDockerFact]
    public async Task AWrongMissingOrUnconfiguredSecret_IsTheBare404_AndIssuesNothing()
    {
        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!, settings: SecretSettings);
        using var client = CredentialTestWorld.CreateClient(factory);
        var (slug, admin, email, _) = await ProvisionAsync(client);

        foreach (var secret in new[] { null, string.Empty, "not-the-secret" })
        {
            using var response = await ReissueAsync(client, slug, new { adminEmail = email }, secret);
            response.StatusCode.Should().Be(HttpStatusCode.NotFound, "secret {0}", secret ?? "(none)");
            (await response.Content.ReadAsStringAsync()).Should().BeEmpty("the bare 404 discloses nothing");
        }

        await using (var unconfigured = new CredentialProbeFactory(_fixture.ConnectionString!))
        {
            using var anonymous = CredentialTestWorld.CreateClient(unconfigured);
            using var response = await ReissueAsync(anonymous, slug, new { adminEmail = email }, string.Empty);
            response.StatusCode.Should().Be(HttpStatusCode.NotFound, "no secret configured: nothing ever authorizes");
        }

        await using var read = _world.ReadContext();
        (await read.CredentialTokens.AsNoTracking().CountAsync(t => t.PersonId == admin))
            .Should().Be(1, "only the provisioning's own invite exists");
    }

    [RequiresDockerFact]
    public async Task Reissue_VoidsTheEarlierInvite_IssuesANullIssuerOne_ReturnsTheLinkOnce_AndKeepsTheTenantIdOffTheWire()
    {
        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!, settings: SecretSettings);
        using var client = CredentialTestWorld.CreateClient(factory);
        var (slug, admin, email, firstUrl) = await ProvisionAsync(client);

        using var response = await ReissueAsync(client, slug.ToUpperInvariant(), new { adminEmail = "  " + email.ToUpperInvariant() + " " }, Secret);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Headers.CacheControl?.NoStore.Should().BeTrue("the body carries a single-use credential link");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
            ["slug", "adminPersonId", "inviteUrl", "emailed"], "no organization id: the tenant id never reaches the wire (XC-002)");
        body.GetProperty("slug").GetString().Should().Be(slug);
        body.GetProperty("adminPersonId").GetString().Should().Be(admin.ToString());
        body.GetProperty("emailed").GetBoolean().Should().BeFalse("email is off on a host without a mailer");
        var newUrl = body.GetProperty("inviteUrl").GetString()!;
        newUrl.Should().StartWith($"{CredentialTestWorld.FrontendBaseUrl}{OrgInviteService.StaffInvitePath}#token=",
            "with no mailer the link is returned to the ops caller (CR-001)");
        var newToken = OrgInviteEndpointTests.TokenOf(newUrl);

        await using (var read = _world.ReadContext())
        {
            var org = (await read.Organizations.AsNoTracking().SingleAsync(o => o.Slug == slug)).Id;
            (await response.Content.ReadAsStringAsync()).Should().NotContain(org.ToString(), "the tenant id is never on the wire");

            var tokens = await read.CredentialTokens.AsNoTracking().Where(t => t.PersonId == admin).ToListAsync();
            tokens.Should().HaveCount(2);
            tokens.Should().ContainSingle(t => t.UsedAt == null, "the earlier invite is voided").Which.Should().Match<CredentialToken>(t =>
                t.TokenHash == Pulse.WebApi.Features.Identity.Sessions.SessionTokens.Hash(newToken)
                && t.IssuedByPersonId == null
                && t.Purpose == CredentialTokenPurposes.Invite
                && t.OrganizationId == org);

            var audits = await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking()
                .Where(a => a.SubjectPersonId == admin && a.Kind == OrgInviteService.InviteIssuedKind)
                .ToListAsync();
            audits.Should().HaveCount(2, "the provisioning's invite and the re-issue");
            var reissue = audits.Should().ContainSingle(a => a.Payload.Contains("\"created\":false")).Which;
            reissue.OrganizationId.Should().Be(org);
            reissue.ActorPersonId.Should().BeNull("ops is not a person");
            reissue.Payload.Should().Contain("\"actorRole\":\"ops\"").And.NotContain(newToken);
        }

        using var anonymous = CredentialTestWorld.CreateClient(factory);
        using (var stale = await anonymous.PostAsJsonAsync(ResetUri, new { token = OrgInviteEndpointTests.TokenOf(firstUrl!), newPassword = CredentialTestWorld.NewPassword }))
        {
            stale.StatusCode.Should().Be(HttpStatusCode.BadRequest, "the earlier link is void");
        }

        using (var redeem = await anonymous.PostAsJsonAsync(ResetUri, new { token = newToken, newPassword = CredentialTestWorld.NewPassword }))
        {
            redeem.StatusCode.Should().Be(HttpStatusCode.OK, "the re-issued link sets the first admin's password");
        }

        factory.Logs.Messages.Should().NotContain(
            message => message.Contains(newToken, StringComparison.Ordinal), "the invite token may never reach a log (NFR-009)");
    }

    [RequiresDockerFact]
    public async Task AnUnknownSlug_OrAnEmailThatIsNotAnOrgAdminOfThatOrg_IsTheSameBare404()
    {
        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!, settings: SecretSettings);
        using var client = CredentialTestWorld.CreateClient(factory);
        var (slug, admin, email, _) = await ProvisionAsync(client);
        var (otherSlug, otherAdmin, otherEmail, _) = await ProvisionAsync(client);

        // A non-admin person of the SAME organization, by email.
        var orgId = await OrganizationIdAsync(slug);
        var nonAdminEmail = $"member.{Guid.NewGuid():N}@example.com";
        await using (var seed = _world.ReadContext())
        {
            seed.People.Add(new Person { Id = Guid.NewGuid(), OrganizationId = orgId, DisplayName = "Member", Email = nonAdminEmail, CreatedAt = DateTimeOffset.UtcNow });
            await seed.SaveChangesAsync();
        }

        var bodies = new List<byte[]>();
        foreach (var (label, routeSlug, adminEmail) in new[]
        {
            ("unknown slug", $"no-such-org-{Guid.NewGuid():N}"[..40], email),
            ("another org's admin", slug, otherEmail),
            ("this admin under another org's slug", otherSlug, email),
            ("a non-admin person of the org", slug, nonAdminEmail),
            ("an unknown email", slug, $"nobody.{Guid.NewGuid():N}@example.com"),
            ("an over-long slug", new string('s', Organization.MaxSlugLength + 1), email),
        })
        {
            using var response = await ReissueAsync(client, routeSlug, new { adminEmail }, Secret);
            response.StatusCode.Should().Be(HttpStatusCode.NotFound, label);
            bodies.Add(await response.Content.ReadAsByteArrayAsync());
        }

        bodies.Should().OnlyContain(b => b.Length == 0, "every miss is the same bare 404");

        await using var read = _world.ReadContext();
        (await read.CredentialTokens.AsNoTracking().CountAsync(t => t.PersonId == admin || t.PersonId == otherAdmin))
            .Should().Be(2, "nothing was issued: only each provisioning's own invite exists");
        (await read.CredentialTokens.AsNoTracking().CountAsync(t => t.PersonId == admin && t.UsedAt == null))
            .Should().Be(1, "no miss voided the real admin's invite");
    }

    [RequiresDockerFact]
    public async Task AnActiveOrDisabledAdmin_Is409_ABadBodyIs400_AndNoFrontendBaseUrlIs503()
    {
        var (org, slug) = await _world.SeedOrganizationAsync();
        var (_, activeEmail) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var (_, disabledEmail) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole, disabled: true);

        await using (var factory = new CredentialProbeFactory(_fixture.ConnectionString!, settings: SecretSettings))
        {
            using var client = CredentialTestWorld.CreateClient(factory);
            foreach (var (adminEmail, error) in new[]
            {
                (activeEmail, OrgInviteService.AlreadyActiveError),
                (disabledEmail, OrgInviteService.PersonDisabledError),
            })
            {
                using var response = await ReissueAsync(client, slug, new { adminEmail }, Secret);
                response.StatusCode.Should().Be(HttpStatusCode.Conflict, error);
                (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString().Should().Be(error);
            }

            foreach (var body in new object[] { new { }, new { adminEmail = "nope" } })
            {
                using var response = await ReissueAsync(client, slug, body, Secret);
                response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
                (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString()
                    .Should().Be(OpsOrganizationService.InvalidAdminEmailError);
            }
        }

        await using (var noBase = new CredentialProbeFactory(_fixture.ConnectionString!, frontendBaseUrl: null, settings: SecretSettings))
        {
            using var client = CredentialTestWorld.CreateClient(noBase);
            using var unavailable = await ReissueAsync(client, slug, new { adminEmail = activeEmail }, Secret);
            unavailable.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        }

        await using var read = _world.ReadContext();
        (await read.CredentialTokens.AsNoTracking().CountAsync(t => t.OrganizationId == org)).Should().Be(0, "no refusal issues a token");
        (await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking().CountAsync(a => a.OrganizationId == org)).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task AnAllowlistAdminWithNoPulsePassword_Is409AlreadyActive_AndIssuesNothing()
    {
        // #862 Sonnet 2: an admin who signs in through the Dynamis allowlist (an IdP subject, not "pulse|") is live. The
        // bootstrap-secret holder must not be able to set a Pulse password on their account.
        var (org, slug) = await _world.SeedOrganizationAsync();
        var (allowlistAdmin, email) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        await using (var context = _world.ReadContext())
        {
            await context.People.IgnoreQueryFilters().Where(p => p.Id == allowlistAdmin)
                .ExecuteUpdateAsync(set => set.SetProperty(p => p.PasswordHash, (string?)null));
            (await context.StaffUsers.IgnoreQueryFilters().AsNoTracking().SingleAsync(u => u.Id == allowlistAdmin)).ExternalSubject
                .Should().NotStartWith(OpsOrganizationService.PulseLocalSubjectPrefix, "precondition: an IdP (allowlist) subject");
        }

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!, settings: SecretSettings);
        using var client = CredentialTestWorld.CreateClient(factory);
        using var response = await ReissueAsync(client, slug, new { adminEmail = email }, Secret);

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString()
            .Should().Be(OrgInviteService.AlreadyActiveError);

        await using var read = _world.ReadContext();
        (await read.CredentialTokens.AsNoTracking().AnyAsync(t => t.PersonId == allowlistAdmin)).Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task Reissue_OfAnActuallyExpiredInvite_IssuesAWorkingLink()
    {
        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!, settings: SecretSettings);
        using var client = CredentialTestWorld.CreateClient(factory);
        var (slug, admin, email, firstUrl) = await ProvisionAsync(client);

        // The first invite's 7 days run out.
        await using (var context = _world.ReadContext())
        {
            await context.CredentialTokens.IgnoreQueryFilters().Where(t => t.PersonId == admin)
                .ExecuteUpdateAsync(set => set
                    .SetProperty(t => t.CreatedAt, DateTimeOffset.UtcNow.AddDays(-8))
                    .SetProperty(t => t.ExpiresAt, DateTimeOffset.UtcNow.AddDays(-1)));
        }

        using var anonymous = CredentialTestWorld.CreateClient(factory);
        using (var expired = await anonymous.PostAsJsonAsync(ResetUri, new { token = OrgInviteEndpointTests.TokenOf(firstUrl!), newPassword = CredentialTestWorld.NewPassword }))
        {
            expired.StatusCode.Should().Be(HttpStatusCode.BadRequest, "precondition: the first invite has expired");
        }

        using var response = await ReissueAsync(client, slug, new { adminEmail = email }, Secret);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var newToken = OrgInviteEndpointTests.TokenOf((await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("inviteUrl").GetString()!);

        using (var redeem = await anonymous.PostAsJsonAsync(ResetUri, new { token = newToken, newPassword = CredentialTestWorld.NewPassword }))
        {
            redeem.StatusCode.Should().Be(HttpStatusCode.OK, "the re-issued invite replaces the expired one");
        }
    }

    [RequiresDockerFact]
    public async Task TheBadSecret404_AndTheUnknownSlug404_AreIdenticalOnTheWire()
    {
        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!, settings: SecretSettings);
        using var client = CredentialTestWorld.CreateClient(factory);
        var (slug, _, email, _) = await ProvisionAsync(client);

        using var badSecret = await ReissueAsync(client, slug, new { adminEmail = email }, "not-the-secret");
        using var unknownSlug = await ReissueAsync(client, $"unknown-{Guid.NewGuid():N}"[..30], new { adminEmail = email }, Secret);

        badSecret.StatusCode.Should().Be(HttpStatusCode.NotFound);
        unknownSlug.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await badSecret.Content.ReadAsByteArrayAsync()).Should().Equal(
            await unknownSlug.Content.ReadAsByteArrayAsync(), "a secret-less prober cannot tell a real slug from a made-up one");
        badSecret.Content.Headers.ContentType?.ToString().Should().Be(unknownSlug.Content.Headers.ContentType?.ToString());
    }

    [RequiresDockerFact]
    public async Task WithAMailerConfigured_TheReissuedLinkGoesByEmailOnly_AndAFailedSendStillReturnsNoLink()
    {
        // CR-001 (Tom, 2026-11-20): the same rule as the provisioning — never a copy-link once a mailer exists.
        var mailer = new RecordingMailer();
        await using (var factory = MailerFactory(services => services.AddSingleton<IPulseMailer>(mailer)))
        {
            using var client = CredentialTestWorld.CreateClient(factory);
            var (slug, _, email, _) = await ProvisionAsync(client, expectLink: false);
            while (mailer.Sent.TryDequeue(out _))
            {
            }

            using var response = await ReissueAsync(client, slug, new { adminEmail = email }, Secret);
            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            body.GetProperty("inviteUrl").ValueKind.Should().Be(JsonValueKind.Null, "a configured mailer means email only");
            body.GetProperty("emailed").GetBoolean().Should().BeTrue();

            var sent = mailer.Sent.Should().ContainSingle().Which;
            sent.Purpose.Should().Be(CredentialTokenPurposes.Invite);
            sent.RecipientAddress.Should().Be(email, "the admin's OWN address — the null-issuer rule");
            (await response.Content.ReadAsStringAsync()).Should().NotContain(OrgInviteEndpointTests.TokenOf(sent.Link));
        }

        await using (var failing = MailerFactory(services => services.AddSingleton<IPulseMailer, ThrowingMailer>()))
        {
            using var client = CredentialTestWorld.CreateClient(failing);
            var (slug, _, email, _) = await ProvisionAsync(client, expectLink: false);

            using var response = await ReissueAsync(client, slug, new { adminEmail = email }, Secret);
            response.StatusCode.Should().Be(HttpStatusCode.OK, "the invite is committed; only the delivery failed");
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            body.GetProperty("inviteUrl").ValueKind.Should().Be(JsonValueKind.Null, "never a copy-link fallback once a mailer exists");
            body.GetProperty("emailed").GetBoolean().Should().BeFalse();
            failing.Logs.Messages.Should().NotContain(m => m.Contains("#token=", StringComparison.Ordinal), "no link reaches a log");
        }
    }

    // ---------------------------------------------------------------- helpers

    private static Task<HttpResponseMessage> ReissueAsync(HttpClient client, string slug, object body, string? secret)
    {
        var request = new HttpRequestMessage(
            HttpMethod.Post, new Uri($"/api/ops/organizations/{Uri.EscapeDataString(slug)}/admin-invite", UriKind.Relative))
        {
            Content = JsonContent.Create(body),
        };
        if (secret is not null)
        {
            request.Headers.Add(BootstrapEndpoints.BootstrapSecretHeaderName, secret);
        }

        return client.SendAsync(request);
    }

    /// <summary>Provisions an organization through the real route; returns (slug, admin id, admin email, first invite url).</summary>
    private static async Task<(string Slug, Guid Admin, string Email, string? InviteUrl)> ProvisionAsync(HttpClient client, bool expectLink = true)
    {
        var unique = Guid.NewGuid().ToString("N")[..12];
        var email = $"first.admin.{unique}@example.com";
        using var request = new HttpRequestMessage(HttpMethod.Post, ProvisionRoute)
        {
            Content = JsonContent.Create(new { name = $"Reissue Org {unique}", adminEmail = email }),
        };
        request.Headers.Add(BootstrapEndpoints.BootstrapSecretHeaderName, Secret);
        using var response = await client.SendAsync(request);
        response.StatusCode.Should().Be(HttpStatusCode.Created, "precondition: the organization is provisioned");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var inviteUrl = body.GetProperty("inviteUrl").GetString();
        if (expectLink)
        {
            inviteUrl.Should().NotBeNullOrEmpty("precondition: no mailer, so the first link is returned");
        }

        return (body.GetProperty("slug").GetString()!, Guid.Parse(body.GetProperty("adminPersonId").GetString()!), email, inviteUrl);
    }

    private async Task<Guid> OrganizationIdAsync(string slug)
    {
        await using var read = _world.ReadContext();
        return (await read.Organizations.AsNoTracking().SingleAsync(o => o.Slug == slug)).Id;
    }

    private CredentialProbeFactory MailerFactory(Action<IServiceCollection> register) => new(
        _fixture.ConnectionString!,
        configureServices: services =>
        {
            services.RemoveAll<IPulseMailer>();
            register(services);
        },
        settings: SecretSettings);

    private sealed class ThrowingMailer : IPulseMailer
    {
        public bool IsConfigured => true;

        public Task<LinkMailSendOutcome> SendCredentialLinkAsync(CredentialMail mail, System.Threading.CancellationToken cancellationToken) =>
            throw new InvalidOperationException("provider down");
    }

    private sealed class RecordingMailer : IPulseMailer
    {
        public System.Collections.Concurrent.ConcurrentQueue<CredentialMail> Sent { get; } = new();

        public bool IsConfigured => true;

        public Task<LinkMailSendOutcome> SendCredentialLinkAsync(CredentialMail mail, System.Threading.CancellationToken cancellationToken)
        {
            Sent.Enqueue(mail);
            return Task.FromResult(LinkMailSendOutcome.Sent);
        }
    }
}
