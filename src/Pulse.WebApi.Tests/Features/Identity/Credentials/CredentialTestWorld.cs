namespace Pulse.WebApi.Tests.Features.Identity.Credentials;

using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Credentials;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.PersonalLinks;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// Real-SQL seeding for the identity-auth-roles/21 credential suites: organizations, people (with an email and a Pulse
/// password), staff enrollments, live sessions and credential tokens. Fresh GUIDs per call; every row goes through the
/// real write guards.
/// </summary>
public sealed class CredentialTestWorld
{
    /// <summary>The frontend base URL the probe host is configured with.</summary>
    public const string FrontendBaseUrl = "https://console.pulse.test";

    /// <summary>The password every seeded person starts with.</summary>
    public const string OldPassword = "old-lantern-ferry-2026";

    /// <summary>A policy-valid new password (no org / email / display-name word in it).</summary>
    public const string NewPassword = "quartz-meadow-river-91";

    private readonly MsSqlContainerFixture _fixture;

    public CredentialTestWorld(MsSqlContainerFixture fixture) => _fixture = fixture;

    public async Task<(Guid Id, string Slug)> SeedOrganizationAsync()
    {
        var id = Guid.NewGuid();
        var slug = $"cred-{id:N}";
        await using var seed = _fixture.CreateContext();
        seed.Organizations.Add(new Organization { Id = id, Name = $"Credential Org {id:N}", Slug = slug, CreatedAt = DateTimeOffset.UtcNow });
        await seed.SaveChangesAsync();
        return (id, slug);
    }

    public async Task<Guid> SeedExerciseAsync(Guid organizationId)
    {
        var id = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            Id = id,
            OrganizationId = organizationId,
            Name = $"Credential Exercise {id:N}",
            Hostname = $"cred-{id:N}.example.com",
            TimeZone = "UTC",
            Status = "live",
        });
        await seed.SaveChangesAsync();
        return id;
    }

    /// <summary>Seeds a person with a staff facet, an email and <see cref="OldPassword"/>.</summary>
    public async Task<(Guid Id, string Email)> SeedPersonAsync(Guid organizationId, string? orgRole = null, bool disabled = false)
    {
        var id = Guid.NewGuid();
        var email = $"cred.{id:N}@example.com";
        var staffUser = StaffTenantSeed.StaffUserFor(id, organizationId);
        var person = staffUser.Person!;
        person.Email = email;
        person.OrgRole = orgRole;
        person.PasswordHash = new PasswordHasher<Person>().HashPassword(person, OldPassword);
        person.DisabledAt = disabled ? DateTimeOffset.UtcNow.AddDays(-1) : null;

        await using var seed = _fixture.CreateContext();
        seed.StaffUsers.Add(staffUser);
        await seed.SaveChangesAsync();
        return (id, email);
    }

    public async Task<Guid> SeedEnrollmentAsync(Guid exerciseId, Guid personId, string role, DateTimeOffset? deletedAt = null)
    {
        var id = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Enrollments.Add(new Enrollment
        {
            Id = id,
            ExerciseId = exerciseId,
            PersonId = personId,
            Role = role,
            CreatedAt = DateTimeOffset.UtcNow,
            DeletedAt = deletedAt,
        });
        await seed.SaveChangesAsync();
        return id;
    }

    /// <summary>Seeds a live staff session; <c>null</c> exercise = org scope (orgAdmin only, per the Sessions CHECK).</summary>
    public async Task<(Guid SessionId, string Token, string RefreshToken)> SeedStaffSessionAsync(Guid personId, Guid? exerciseId, string role)
    {
        var token = $"cred-{Guid.NewGuid():N}";
        var refresh = token + "-refresh";
        var session = new Session
        {
            Id = Guid.NewGuid(),
            TokenHash = SessionTokens.Hash(token),
            RefreshTokenHash = SessionTokens.Hash(refresh),
            Kind = "staff",
            ExerciseId = exerciseId,
            PrincipalId = personId.ToString(),
            StaffUserId = personId,
            PersonId = personId,
            Role = role,
            ActingHumanId = personId.ToString(),
            IssuedAt = DateTimeOffset.UtcNow.AddMinutes(-5),
            ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
            RefreshExpiresAt = DateTimeOffset.UtcNow.AddHours(8),
        };

        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(session);
        await seed.SaveChangesAsync();
        return (session.Id, token, refresh);
    }

    /// <summary>Issues (and saves) a token through the real service, as an admin reset or an invite would.</summary>
    public async Task<IssuedCredentialToken> IssueAsync(string purpose, Guid personId, Guid organizationId, DateTimeOffset? now = null)
    {
        await using var context = _fixture.CreateContext();
        var service = new CredentialTokenService(context, TimeProvider.System);
        var issued = await service.StageIssueAsync(
            purpose, CredentialSubject.ForPerson(personId), organizationId, issuedByPersonId: null, now ?? DateTimeOffset.UtcNow);
        await context.SaveChangesAsync();
        return issued;
    }

    /// <summary>Seeds an unconsumed slugless org choice whose candidate is <paramref name="personId"/>.</summary>
    public async Task<string> SeedOrgChoiceAsync(Guid personId, Guid organizationId)
    {
        var raw = SessionTokens.Generate();
        var choice = new LoginChoice
        {
            Id = Guid.NewGuid(),
            TokenHash = SessionTokens.Hash(raw),
            ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(2),
            CreatedFromIpHash = SessionTokens.Hash("ip:test"),
        };

        await using var seed = _fixture.CreateContext();
        seed.LoginChoices.Add(choice);
        seed.LoginChoiceCandidates.Add(new LoginChoiceCandidate { ChoiceId = choice.Id, PersonId = personId, OrganizationId = organizationId });
        await seed.SaveChangesAsync();
        return raw;
    }

    public PulseDbContext ReadContext() => _fixture.CreateContext();

    public static HttpClient CreateClient(WebApplicationFactory<Program> factory, string? token = null)
    {
        ArgumentNullException.ThrowIfNull(factory);
        var client = factory.CreateClient();
        if (token is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        return client;
    }
}

/// <summary>
/// The REAL <c>Program</c> host pointed at the shared migrated database, with <c>Authentication:FrontendBaseUrl</c> set
/// (so reset links can be built) and every log line captured (so the suites can prove no token or link is logged).
/// Overrides nothing else: the pipeline, the pre-auth gate, the tenant resolution and the rate limiter are production's.
/// </summary>
internal sealed class CredentialProbeFactory : WebApplicationFactory<Program>
{
    private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";
    private readonly string? _frontendBaseUrl;
    private readonly Action<IServiceCollection>? _configureServices;

    public CredentialProbeFactory(
        string connectionString,
        string? frontendBaseUrl = CredentialTestWorld.FrontendBaseUrl,
        Action<IServiceCollection>? configureServices = null)
    {
        _frontendBaseUrl = frontendBaseUrl;
        _configureServices = configureServices;
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);
    }

    /// <summary>Every log line the host wrote.</summary>
    public CapturingLoggerProvider Logs { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);
        builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(
            new System.Collections.Generic.Dictionary<string, string?> { [JoinUrlBuilder.FrontendBaseUrlKey] = _frontendBaseUrl ?? string.Empty }));
        if (_configureServices is not null)
        {
            builder.ConfigureServices(_configureServices);
        }

        builder.ConfigureLogging(logging =>
        {
            logging.SetMinimumLevel(LogLevel.Trace);
            logging.AddProvider(Logs);
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
    }
}
