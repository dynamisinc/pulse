namespace Pulse.WebApi.Tests.Features.Identity.Staff;

using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// Real-SQL seeding for the identity-auth-roles/15 org sign-in suites: organizations with slugs, people with an email,
/// a Pulse password and a shared-key staff facet, exercises and staff enrollments. Fresh GUIDs per call.
/// </summary>
public sealed class OrgSignInTestKit
{
    /// <summary>The password every seeded person gets unless told otherwise.</summary>
    public const string Password = "correct horse battery staple";

    private readonly MsSqlContainerFixture _fixture;

    public OrgSignInTestKit(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>A unique email for one test.</summary>
    public static string NewEmail() => $"signin.{Guid.NewGuid():N}@example.com";

    public async Task<(Guid Id, string Slug, string Name)> SeedOrganizationAsync()
    {
        var id = Guid.NewGuid();
        var slug = $"org-{id:N}";
        var name = $"Sign-in Org {id:N}";
        await using var seed = _fixture.CreateContext();
        seed.Organizations.Add(new Organization { Id = id, Name = name, Slug = slug, CreatedAt = DateTimeOffset.UtcNow });
        await seed.SaveChangesAsync();
        return (id, slug, name);
    }

    public async Task<Guid> SeedExerciseAsync(Guid organizationId)
    {
        var id = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            Id = id,
            OrganizationId = organizationId,
            Name = $"Sign-in Exercise {id:N}",
            Hostname = $"signin-{id:N}.example.com",
            TimeZone = "UTC",
            Status = "live",
        });
        await seed.SaveChangesAsync();
        return id;
    }

    /// <summary>Seeds a person (email + Pulse password unless <paramref name="email"/> is null) with a staff facet.</summary>
    public async Task<Guid> SeedPersonAsync(
        Guid organizationId,
        string? email,
        string password = Password,
        string? orgRole = null,
        Action<Person>? configure = null)
    {
        var id = Guid.NewGuid();
        var staffUser = StaffTenantSeed.StaffUserFor(id, organizationId);
        var person = staffUser.Person!;
        person.Email = email;
        person.OrgRole = orgRole;
        if (email is not null)
        {
            person.PasswordHash = new PasswordHasher<Person>().HashPassword(person, password);
        }

        configure?.Invoke(person);

        await using var seed = _fixture.CreateContext();
        seed.StaffUsers.Add(staffUser);
        await seed.SaveChangesAsync();
        return id;
    }

    public async Task SeedEnrollmentAsync(Guid exerciseId, Guid personId, string role = "controller", DateTimeOffset? createdAt = null)
    {
        await using var seed = _fixture.CreateContext();
        seed.Enrollments.Add(new Enrollment
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            PersonId = personId,
            Role = role,
            CreatedAt = createdAt ?? DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
    }

    /// <summary>Seeds a (past) staff session — the "last used" signal for the landing enrollment.</summary>
    public async Task SeedPastStaffSessionAsync(Guid personId, Guid exerciseId, DateTimeOffset issuedAt)
    {
        var session = TestSessions.NewSession($"past-{Guid.NewGuid():N}", exerciseId, kind: "staff");
        session.StaffUserId = personId;
        session.PersonId = personId;
        session.PrincipalId = personId.ToString();
        session.IssuedAt = issuedAt;
        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(session);
        await seed.SaveChangesAsync();
    }

    public PulseDbContext Context() => _fixture.CreateContext();

    /// <summary>
    /// The service as a request would build it: the chained provider over the given allowlist, both sharing ONE
    /// request-scoped <see cref="StaffPasswordVerifier"/> (over <paramref name="hasher"/> when given — a counting spy).
    /// </summary>
    public static OrgStaffLoginService Service(
        PulseDbContext context,
        ISessionIssuer issuer,
        IList<DynamisStaffAccount>? allowlist = null,
        IPasswordHasher<Person>? hasher = null)
    {
        var verifier = TestPasswordVerifiers.New(hasher);
        return new(
            context,
            new PulsePasswordIdentityProvider(
                context,
                new DynamisIdentityProvider(Options.Create(new DynamisIdentityProviderOptions
                {
                    Accounts = allowlist is null ? [] : [.. allowlist],
                })),
                verifier),
            verifier,
            issuer,
            NullLogger<OrgStaffLoginService>.Instance);
    }
}
