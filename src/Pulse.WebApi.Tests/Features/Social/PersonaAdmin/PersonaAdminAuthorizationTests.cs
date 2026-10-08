namespace Pulse.WebApi.Tests.Features.Social.PersonaAdmin;

using System;
using System.Net;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Xunit;
using static Pulse.WebApi.Tests.Features.Social.PersonaAdmin.PersonaAdminHttp;

/// <summary>
/// The caller matrix for <c>PATCH /api/staff/personas/{personaId}</c> (demo-polish PE-BE, story 21 AC "Isolation and
/// authz"; COR-005, COR-015). Only a live, non-read-only staff session assigned to the resolved exercise as
/// <c>controller</c> may edit. Anonymous, participant, shared read-only and expired sessions get 401; an assigned
/// evaluator or planner, staff not assigned to the resolved exercise, and a read-only staff session get 403. Every
/// refusal leaves the persona untouched. Real <c>Program</c> pipeline, real tokens, real SQL.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PersonaAdminAuthorizationTests
{
    private const string ValidPatch = """{ "displayName": "Should not apply", "verified": false }""";

    private readonly PersonaAdminSeeder _seed;

    public PersonaAdminAuthorizationTests(MsSqlContainerFixture fixture) => _seed = new PersonaAdminSeeder(fixture);

    [RequiresDockerFact]
    public async Task Anonymous_Returns401_AndChangesNothing()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var personaId = await _seed.SeedPersonaAsync(exercise.Id);

        await AssertRefusedAsync(exercise.Host, token: null, personaId, HttpStatusCode.Unauthorized, "an anonymous caller has no session");
    }

    [RequiresDockerFact]
    public async Task ParticipantSession_OnItsOwnHost_Returns401_AndChangesNothing()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var personaId = await _seed.SeedPersonaAsync(exercise.Id);
        var participant = await _seed.SeedParticipantSessionAsync(exercise.Id, personaId);

        await AssertRefusedAsync(
            exercise.Host, participant, personaId, HttpStatusCode.Unauthorized, "a participant is not staff, even when it IS this persona");
    }

    [RequiresDockerFact]
    public async Task SharedReadOnlySession_Returns401_AndChangesNothing()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var personaId = await _seed.SeedPersonaAsync(exercise.Id);
        var readOnly = await _seed.SeedReadOnlySessionAsync(exercise.Id);

        await AssertRefusedAsync(exercise.Host, readOnly, personaId, HttpStatusCode.Unauthorized, "a shared read-only session is not staff");
    }

    [RequiresDockerFact]
    public async Task ExpiredControllerSession_Returns401_AndChangesNothing()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var personaId = await _seed.SeedPersonaAsync(exercise.Id);
        var expired = await _seed.SeedStaffSessionAsync(
            exercise.Id, [(exercise.Id, "controller")], session => session.ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1));

        await AssertRefusedAsync(exercise.Host, expired, personaId, HttpStatusCode.Unauthorized, "an expired session is no session");
    }

    [RequiresDockerTheory]
    [InlineData("evaluator")]
    [InlineData("planner")]
    public async Task AssignedNonControllerStaff_Returns403_AndChangesNothing(string role)
    {
        var exercise = await _seed.SeedExerciseAsync();
        var personaId = await _seed.SeedPersonaAsync(exercise.Id);
        var staff = await _seed.SeedStaffSessionAsync(exercise.Id, [(exercise.Id, role)]);

        await AssertRefusedAsync(
            exercise.Host, staff, personaId, HttpStatusCode.Forbidden, $"an assigned {role} may read personas but only a controller edits them");
    }

    [RequiresDockerFact]
    public async Task StaffNotAssignedToTheResolvedExercise_Returns403_AndChangesNothing()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var elsewhere = await _seed.SeedExerciseAsync();
        var personaId = await _seed.SeedPersonaAsync(exercise.Id);
        var staff = await _seed.SeedStaffSessionAsync(exercise.Id, [(elsewhere.Id, "controller")]);

        await AssertRefusedAsync(
            exercise.Host, staff, personaId, HttpStatusCode.Forbidden, "a controller of another exercise is not assigned to this one (COR-005)");
    }

    [RequiresDockerFact]
    public async Task ReadOnlyStaffSession_EvenAsAnAssignedController_Returns403_AndChangesNothing()
    {
        // No issuer mints a read-only staff session today; the innermost DenyReadOnlySessions() gate makes the
        // COR-015 guarantee structural for this write anyway.
        var exercise = await _seed.SeedExerciseAsync();
        var personaId = await _seed.SeedPersonaAsync(exercise.Id);
        var readOnlyController = await _seed.SeedStaffSessionAsync(
            exercise.Id, [(exercise.Id, "controller")], session => session.IsReadOnly = true);

        await AssertRefusedAsync(
            exercise.Host, readOnlyController, personaId, HttpStatusCode.Forbidden, "a read-only session never writes (COR-015)");
    }

    [RequiresDockerFact]
    public async Task AssignedController_Returns200_NotABlanketDeny()
    {
        // Positive control: without it, a route that refused everyone would pass every test above.
        var exercise = await _seed.SeedExerciseAsync();
        var personaId = await _seed.SeedPersonaAsync(exercise.Id);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        await using var factory = _seed.CreateFactory();
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await PatchAsync(client, personaId, ValidPatch);

        response.StatusCode.Should().Be(HttpStatusCode.OK, "an assigned controller is exactly who may edit a persona");
        (await _seed.ReadPersonaAsync(personaId)).DisplayName.Should().Be("Should not apply");
    }

    [RequiresDockerTheory]
    [InlineData("not json")]
    [InlineData("""{ "handle": "x" }""")]
    [InlineData("""{ "avatarMediaId": "not-a-guid" }""")]
    public async Task RefusedCaller_WithAnInvalidBody_GetsTheAuthStatus_NotA400(string body)
    {
        // The gates run before the body is read, so an unauthorized caller learns nothing about the body rules.
        var exercise = await _seed.SeedExerciseAsync();
        var personaId = await _seed.SeedPersonaAsync(exercise.Id);
        var participant = await _seed.SeedParticipantSessionAsync(exercise.Id);
        var evaluator = await _seed.SeedStaffSessionAsync(exercise.Id, [(exercise.Id, "evaluator")]);

        await using var factory = _seed.CreateFactory();
        using var participantClient = factory.CreateClientFor(exercise.Host, participant);
        using var evaluatorClient = factory.CreateClientFor(exercise.Host, evaluator);

        (await PatchAsync(participantClient, personaId, body)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await PatchAsync(evaluatorClient, personaId, body)).StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [RequiresDockerFact]
    public async Task RefusedCaller_WithANonJsonContentType_GetsTheAuthStatus_Not415()
    {
        // The content-type check (Gate-1 L-1) sits inside the handler, after every gate.
        var exercise = await _seed.SeedExerciseAsync();
        var personaId = await _seed.SeedPersonaAsync(exercise.Id);
        var participant = await _seed.SeedParticipantSessionAsync(exercise.Id);
        var evaluator = await _seed.SeedStaffSessionAsync(exercise.Id, [(exercise.Id, "evaluator")]);

        await using var factory = _seed.CreateFactory();
        using var anonymousClient = factory.CreateClientFor(exercise.Host, bearerToken: null);
        using var participantClient = factory.CreateClientFor(exercise.Host, participant);
        using var evaluatorClient = factory.CreateClientFor(exercise.Host, evaluator);

        (await PatchAsync(anonymousClient, personaId, ValidPatch, "text/plain")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await PatchAsync(participantClient, personaId, ValidPatch, "text/plain")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await PatchAsync(evaluatorClient, personaId, ValidPatch, "text/plain")).StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    private async Task AssertRefusedAsync(string host, string? token, Guid personaId, HttpStatusCode expected, string because)
    {
        var before = await _seed.ReadPersonaAsync(personaId);

        await using var factory = _seed.CreateFactory();
        using var client = factory.CreateClientFor(host, token);

        var response = await PatchAsync(client, personaId, ValidPatch);

        response.StatusCode.Should().Be(expected, because);
        var after = await _seed.ReadPersonaAsync(personaId);
        after.DisplayName.Should().Be(before.DisplayName, "a refused caller never edits the persona");
        after.Verified.Should().Be(before.Verified);
    }
}
