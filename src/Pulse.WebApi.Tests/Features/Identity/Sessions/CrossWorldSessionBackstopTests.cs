namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Tests.Features.Identity.Enrollments;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// identity-auth-roles/16 — the server backstop of the one-world-per-origin rule (ADMIN-IDENTITY-MODEL §1.2): minting a
/// session for person P in world W stamps the request Origin and revokes P's live OTHER-world sessions minted from the
/// SAME origin; another origin, the same world, and another person are untouched.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class CrossWorldSessionBackstopTests
{
    private const string ConsoleOrigin = "https://console.pulse.example";
    private const string ExerciseOrigin = "https://exercise.pulse.example";

    private readonly MsSqlContainerFixture _fixture;

    public CrossWorldSessionBackstopTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task MintingAParticipantSession_RevokesThePersonsStaffSessionFromTheSameOrigin_Only()
    {
        var exerciseId = await SeedExerciseAsync();
        var person = Guid.NewGuid();
        var other = Guid.NewGuid();
        await using (var seed = _fixture.CreateContext())
        {
            seed.StaffUsers.Add(StaffTenantSeed.StaffUserFor(person));
            seed.StaffUsers.Add(StaffTenantSeed.StaffUserFor(other));
            await seed.SaveChangesAsync();
        }

        var sameOriginStaff = await SeedSessionAsync(person, exerciseId, "staff", ConsoleOrigin);
        var otherOriginStaff = await SeedSessionAsync(person, exerciseId, "staff", ExerciseOrigin);
        var otherPersonsStaff = await SeedSessionAsync(other, exerciseId, "staff", ConsoleOrigin);

        Session minted;
        await using (var context = _fixture.CreateContext())
        {
            var issued = await IssuerFor(context, ConsoleOrigin).IssueAsync(new SessionIssueRequest
            {
                ExerciseId = exerciseId,
                Kind = "participant",
                Role = "participant",
                PrincipalId = Guid.NewGuid().ToString(),
                ActingHumanId = person.ToString(),
                IsReadOnly = false,
                PersonId = person,
            });
            minted = issued.Session;
        }

        await using var read = _fixture.CreateContext();
        (await read.Sessions.SingleAsync(s => s.Id == minted.Id)).Origin.Should().Be(ConsoleOrigin, "the minting origin is stamped");
        (await read.Sessions.SingleAsync(s => s.Id == sameOriginStaff)).RevokedAt.Should().NotBeNull(
            "the person's other-world session from the SAME origin is revoked in the same unit of work");
        (await read.Sessions.SingleAsync(s => s.Id == otherOriginStaff)).RevokedAt.Should().BeNull(
            "separate origins legitimately hold one world each");
        (await read.Sessions.SingleAsync(s => s.Id == otherPersonsStaff)).RevokedAt.Should().BeNull("another person is untouched");
    }

    [RequiresDockerFact]
    public async Task MintingAStaffSession_KeepsTheSameWorldsSessions_AndRevokesNothingWithoutAnOrigin()
    {
        var exerciseId = await SeedExerciseAsync();
        var person = Guid.NewGuid();
        await using (var seed = _fixture.CreateContext())
        {
            seed.StaffUsers.Add(StaffTenantSeed.StaffUserFor(person));
            await seed.SaveChangesAsync();
        }

        var otherStaff = await SeedSessionAsync(person, exerciseId, "staff", ConsoleOrigin);
        var participant = await SeedSessionAsync(person, exerciseId, "participant", ConsoleOrigin);

        await using (var context = _fixture.CreateContext())
        {
            await IssuerFor(context, origin: null).IssueAsync(StaffRequest(exerciseId, person));
        }

        await using (var read = _fixture.CreateContext())
        {
            (await read.Sessions.SingleAsync(s => s.Id == participant)).RevokedAt.Should().BeNull("no Origin header, no backstop");
        }

        await using (var context = _fixture.CreateContext())
        {
            await IssuerFor(context, ConsoleOrigin).IssueAsync(StaffRequest(exerciseId, person));
        }

        await using var after = _fixture.CreateContext();
        (await after.Sessions.SingleAsync(s => s.Id == otherStaff)).RevokedAt.Should().BeNull("the same world is never revoked");
        (await after.Sessions.SingleAsync(s => s.Id == participant)).RevokedAt.Should().NotBeNull("the other world on that origin is");
    }

    private static SessionIssueRequest StaffRequest(Guid exerciseId, Guid person) => new()
    {
        ExerciseId = exerciseId,
        Kind = "staff",
        Role = "controller",
        PrincipalId = person.ToString(),
        ActingHumanId = person.ToString(),
        IsReadOnly = false,
        StaffUserId = person,
        PersonId = person,
    };

    [RequiresDockerFact]
    public async Task TheBackstop_CutsTheRevokedSessionsLiveHubConnections_AfterTheCommit_Only()
    {
        var exerciseId = await SeedExerciseAsync();
        var person = Guid.NewGuid();
        await using (var seed = _fixture.CreateContext())
        {
            seed.StaffUsers.Add(StaffTenantSeed.StaffUserFor(person));
            await seed.SaveChangesAsync();
        }

        var sameOriginParticipant = await SeedSessionAsync(person, exerciseId, "participant", ConsoleOrigin);
        var otherOriginParticipant = await SeedSessionAsync(person, exerciseId, "participant", ExerciseOrigin);
        var revoker = new RecordingConnectionRevoker();

        await using (var context = _fixture.CreateContext())
        {
            await IssuerFor(context, ConsoleOrigin, revoker).IssueAsync(StaffRequest(exerciseId, person));
        }

        revoker.Revoked.ToList().Should().Equal(
            [sameOriginParticipant],
            "the revoked other-world session's live hub connections are cut, and nothing else's");
        await using var read = _fixture.CreateContext();
        (await read.Sessions.SingleAsync(s => s.Id == sameOriginParticipant)).RevokedAt.Should().NotBeNull(
            "the cut follows a committed revocation");
        (await read.Sessions.SingleAsync(s => s.Id == otherOriginParticipant)).RevokedAt.Should().BeNull();
    }

    private static SessionIssuer IssuerFor(PulseDbContext context, string? origin, RecordingConnectionRevoker? revoker = null)
    {
        var httpContext = new DefaultHttpContext();
        if (origin is not null)
        {
            httpContext.Request.Headers.Origin = origin;
        }

        return new SessionIssuer(
            context,
            Options.Create(new SessionOptions()),
            new ExerciseFactsReader(context),
            Options.Create(new EasyLoginOptions()),
            TimeProvider.System,
            NullLogger<SessionIssuer>.Instance,
            new HttpContextAccessor { HttpContext = httpContext },
            revoker);
    }

    private async Task<Guid> SeedExerciseAsync()
    {
        var id = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise { Id = id, OrganizationId = Organization.DefaultOrganizationId, Name = $"Backstop {id:N}", TimeZone = "UTC" });
        await seed.SaveChangesAsync();
        return id;
    }

    private async Task<Guid> SeedSessionAsync(Guid person, Guid exerciseId, string kind, string origin)
    {
        var session = TestSessions.NewSession($"cw-{Guid.NewGuid():N}", exerciseId, kind: kind);
        session.PersonId = person;
        session.Origin = origin;
        if (kind == "staff")
        {
            session.StaffUserId = person;
        }

        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(session);
        await seed.SaveChangesAsync();
        return session.Id;
    }
}
