namespace Pulse.WebApi.Tests.Features.Identity.RoleMatrix;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Enrollments;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Helpers;

/// <summary>The nine callers the identity-auth-roles/17 matrix is asserted for (ADMIN-IDENTITY-MODEL §8.2).</summary>
public enum MatrixRole
{
    /// <summary>An org-scope session of a person holding <c>OrgRole = orgAdmin</c> and NO enrollment on the exercise.</summary>
    OrgAdmin,

    /// <summary>A staff session on the exercise, planner enrollment.</summary>
    Planner,

    /// <summary>A staff session on the exercise, controller enrollment (not the lead).</summary>
    Controller,

    /// <summary>A staff session on the exercise, the lead controller's enrollment.</summary>
    LeadController,

    /// <summary>A staff session on the exercise, evaluator enrollment.</summary>
    Evaluator,

    /// <summary>A participant session (role <c>participant</c>) bound to a persona.</summary>
    Participant,

    /// <summary>A participant session (role <c>pio</c>) bound to a persona.</summary>
    Pio,

    /// <summary>A shared view-only session (COR-015).</summary>
    ReadOnly,

    /// <summary>No credential at all.</summary>
    Anonymous,
}

/// <summary>
/// The real <c>Program</c> host plus the enrollment slice's not-yet-wired <c>AddEnrollments()</c> /
/// <c>MapEnrollmentEndpoints()</c> (identity-auth-roles/16), so the live endpoint table is the production one plus the
/// lead route the orchestrator wires with A1.
/// </summary>
public sealed class RoleMatrixHost : WebApplicationFactory<Program>
{
    private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

    /// <summary>Creates the host against <paramref name="connectionString"/> (a never-connecting one when <c>null</c>).</summary>
    public RoleMatrixHost(string? connectionString)
        => Environment.SetEnvironmentVariable(
            ConnectionStringEnvVar,
            connectionString ?? "Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;");

    /// <summary>Every mapped route endpoint of the live host.</summary>
    public IReadOnlyList<RouteEndpoint> RouteEndpoints() =>
        Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>().ToList();

    /// <inheritdoc />
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        // identity-auth-roles/17: the ambient-policy lead gate is only reachable for an AUTONOMOUS request, which the
        // governed flag otherwise rejects 400 for every caller before the gate. Authorising it here lets the matrix and
        // the lead-gate suite prove the raise is lead-only (403 for a non-lead, allowed for the lead).
        builder.UseSetting("Generation:Governance:AmbientAutonomyAuthorized", "true");
        // The Phase-1 timeout-auto-send flag (PROVIDER-GOVERNANCE §8) is ON here so swamped-mode probes reach the
        // lead gate this suite is about; the flag-off refusal is covered by EngineReviewSafetyInvariantTests.
        builder.UseSetting("Generation:Governance:TimeoutAutoSendAuthorized", "true");

        builder.ConfigureTestServices(services =>
        {
            services.AddEnrollments();
            services.AddSingleton<IStartupFilter>(new MapEnrollmentsStartupFilter());
        });
    }

    /// <inheritdoc />
    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
    }

    private sealed class MapEnrollmentsStartupFilter : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            next(app);

            if (app.Properties.TryGetValue("__EndpointRouteBuilder", out var value) && value is IEndpointRouteBuilder routes
                && !routes.DataSources.SelectMany(source => source.Endpoints).OfType<RouteEndpoint>()
                    .Any(endpoint => string.Equals(endpoint.RoutePattern.RawText, EnrollmentEndpoints.LeadRoute, StringComparison.Ordinal)))
            {
                routes.MapEnrollmentEndpoints();
            }
        };
    }
}

/// <summary>
/// One seeded exercise world for the matrix: an organization, an exercise with a hostname, a persona, one person per
/// staff role (plus an org admin with no enrollment) and a fresh live session per request on demand. Fresh GUIDs.
/// </summary>
public sealed class RoleMatrixWorld
{
    private readonly MsSqlContainerFixture _fixture;
    private readonly Dictionary<MatrixRole, Guid> _people = new();

    private RoleMatrixWorld(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>The organization.</summary>
    public Guid OrganizationId { get; private set; }

    /// <summary>The exercise every exercise-scoped probe targets.</summary>
    public Guid ExerciseId { get; private set; }

    /// <summary>The exercise's host (participant sessions are host-bound).</summary>
    public string Hostname { get; private set; } = string.Empty;

    /// <summary>The persona participant sessions are bound to.</summary>
    public Guid PersonaId { get; private set; }

    /// <summary>The evaluator's enrollment id (a non-controller target for the lead route).</summary>
    public Guid EvaluatorEnrollmentId { get; private set; }

    /// <summary>The non-lead controller's enrollment id.</summary>
    public Guid ControllerEnrollmentId { get; private set; }

    /// <summary>The person behind a staff matrix role.</summary>
    public Guid PersonOf(MatrixRole role) => _people[role];

    /// <summary>Seeds a world whose exercise starts in <paramref name="status"/>.</summary>
    public static async Task<RoleMatrixWorld> SeedAsync(MsSqlContainerFixture fixture, string status = "live", Guid? organizationId = null)
    {
        var world = new RoleMatrixWorld(fixture);
        await using var seed = fixture.CreateContext();

        world.OrganizationId = organizationId ?? Guid.NewGuid();
        if (organizationId is null)
        {
            seed.Organizations.Add(new Organization
            {
                Id = world.OrganizationId,
                Name = $"Matrix Org {world.OrganizationId:N}",
                Slug = $"matrix-{world.OrganizationId:N}",
                CreatedAt = DateTimeOffset.UtcNow,
            });
        }

        world.ExerciseId = Guid.NewGuid();
        world.Hostname = $"mx-{world.ExerciseId:N}.example.com";
        seed.Exercises.Add(new Exercise
        {
            Id = world.ExerciseId,
            OrganizationId = world.OrganizationId,
            Name = $"Matrix Exercise {world.ExerciseId:N}",
            Hostname = world.Hostname,
            TimeZone = "UTC",
            Status = status,
        });

        world.PersonaId = Guid.NewGuid();
        seed.Personas.Add(new Persona
        {
            Id = world.PersonaId,
            ExerciseId = world.ExerciseId,
            DisplayName = "Matrix Citizen",
            Handle = $"mx{world.PersonaId:N}"[..20],
            Kind = "human",
        });

        foreach (var (role, enrollmentRole, isLead) in new[]
        {
            (MatrixRole.OrgAdmin, (string?)null, false),
            (MatrixRole.Planner, EnrollmentRoles.Planner, false),
            (MatrixRole.Controller, EnrollmentRoles.Controller, false),
            (MatrixRole.LeadController, EnrollmentRoles.Controller, true),
            (MatrixRole.Evaluator, EnrollmentRoles.Evaluator, false),
        })
        {
            var personId = Guid.NewGuid();
            world._people[role] = personId;
            var staff = StaffTenantSeed.StaffUserFor(personId, world.OrganizationId);
            if (role == MatrixRole.OrgAdmin)
            {
                staff.Person!.OrgRole = "orgAdmin";
            }

            seed.StaffUsers.Add(staff);
            if (enrollmentRole is not null)
            {
                var enrollmentId = Guid.NewGuid();
                seed.Enrollments.Add(new Enrollment
                {
                    Id = enrollmentId,
                    ExerciseId = world.ExerciseId,
                    PersonId = personId,
                    Role = enrollmentRole,
                    IsLead = isLead,
                    CreatedAt = DateTimeOffset.UtcNow,
                });

                if (role == MatrixRole.Evaluator)
                {
                    world.EvaluatorEnrollmentId = enrollmentId;
                }

                if (role == MatrixRole.Controller)
                {
                    world.ControllerEnrollmentId = enrollmentId;
                }
            }
        }

        await seed.SaveChangesAsync();
        return world;
    }

    /// <summary>Seeds a fresh live session for <paramref name="role"/> and returns its raw token (null for anonymous).</summary>
    public async Task<string?> TokenForAsync(MatrixRole role)
    {
        if (role == MatrixRole.Anonymous)
        {
            return null;
        }

        var token = $"mx-{role}-{Guid.NewGuid():N}";
        Session session = role switch
        {
            MatrixRole.Participant or MatrixRole.Pio => ParticipantSession(token, role == MatrixRole.Pio ? "pio" : "participant"),
            MatrixRole.ReadOnly => ReadOnlySession(token),
            MatrixRole.OrgAdmin => StaffSession(token, PersonOf(role), exerciseId: null, "orgAdmin"),
            MatrixRole.Planner => StaffSession(token, PersonOf(role), ExerciseId, EnrollmentRoles.Planner),
            MatrixRole.Evaluator => StaffSession(token, PersonOf(role), ExerciseId, EnrollmentRoles.Evaluator),
            _ => StaffSession(token, PersonOf(role), ExerciseId, EnrollmentRoles.Controller),
        };

        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(session);
        await seed.SaveChangesAsync();
        return token;
    }

    /// <summary>Seeds a staff session for any person (e.g. a second enrollment's switch) and returns (session id, token).</summary>
    public async Task<(Guid SessionId, string Token)> StaffTokenAsync(Guid personId, Guid? exerciseId, string role)
    {
        var token = $"mx-staff-{Guid.NewGuid():N}";
        var session = StaffSession(token, personId, exerciseId, role);
        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(session);
        await seed.SaveChangesAsync();
        return (session.Id, token);
    }

    /// <summary>Sets the exercise's stored lifecycle status (and optionally <c>FirstLiveAt</c>).</summary>
    public async Task SetStatusAsync(string status, DateTimeOffset? firstLiveAt = null)
    {
        await using var context = _fixture.CreateContext();
        await context.Exercises
            .Where(e => e.Id == ExerciseId)
            .ExecuteUpdateAsync(set => set
                .SetProperty(e => e.Status, status)
                .SetProperty(e => e.FirstLiveAt, firstLiveAt));
    }

    /// <summary>Reads the exercise's stored status.</summary>
    public async Task<string> ReadStatusAsync()
    {
        await using var context = _fixture.CreateContext();
        return await context.Exercises.Where(e => e.Id == ExerciseId).Select(e => e.Status).SingleAsync();
    }

    /// <summary>A client on the exercise's host presenting <paramref name="token"/> (none when null).</summary>
    public HttpClient Client(RoleMatrixHost host, string? token)
    {
        ArgumentNullException.ThrowIfNull(host);
        var client = host.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri($"http://{Hostname}/") });
        if (token is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        return client;
    }

    private Session ParticipantSession(string token, string role) => new()
    {
        Id = Guid.NewGuid(),
        TokenHash = SessionTokens.Hash(token),
        Kind = "participant",
        ExerciseId = ExerciseId,
        PrincipalId = Guid.NewGuid().ToString(),
        Role = role,
        PersonaId = PersonaId,
        ActingHumanId = $"human-{Guid.NewGuid():N}",
        IssuedAt = DateTimeOffset.UtcNow.AddMinutes(-5),
        ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
    };

    private Session ReadOnlySession(string token) => new()
    {
        Id = Guid.NewGuid(),
        TokenHash = SessionTokens.Hash(token),
        Kind = "readonly",
        ExerciseId = ExerciseId,
        PrincipalId = Guid.NewGuid().ToString(),
        Role = "readonly",
        ActingHumanId = $"viewer-{Guid.NewGuid():N}",
        IsReadOnly = true,
        IssuedAt = DateTimeOffset.UtcNow.AddMinutes(-5),
        ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
    };

    private static Session StaffSession(string token, Guid personId, Guid? exerciseId, string role) => new()
    {
        Id = Guid.NewGuid(),
        TokenHash = SessionTokens.Hash(token),
        RefreshTokenHash = SessionTokens.Hash(token + "-refresh"),
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
}
