namespace Pulse.WebApi.Tests.Features.Social.PersonaAdmin;

using System;
using System.Net;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social.PersonaAdmin;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Xunit;
using static Pulse.WebApi.Tests.Features.Social.PersonaAdmin.PersonaAdminHttp;

/// <summary>
/// Exercise isolation for <c>PATCH /api/staff/personas/{personaId}</c> (demo-polish PE-BE; story 21 ACs "Isolation
/// and authz" and "Media must be in-scope images"; COR-001, XC-001, DP-16). Always-Critical. Every case runs a
/// controller of exercise A against exercise B's REAL ids and proves the request FAILS CLOSED: the same status and
/// the byte-identical body an unknown id gets, and zero rows changed in either exercise. Each case also reads B's
/// rows with <c>IgnoreQueryFilters()</c>, so "nothing happened" is the filter closing the door on a row that
/// exists, not an empty table. Real <c>Program</c> pipeline, real tokens, real SQL.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PersonaAdminIsolationTests
{
    private readonly PersonaAdminSeeder _seed;

    public PersonaAdminIsolationTests(MsSqlContainerFixture fixture) => _seed = new PersonaAdminSeeder(fixture);

    [RequiresDockerFact]
    public async Task OtherExercisesPersona_Returns404_ByteIdenticalToAnUnknownId_AndChangesNothing()
    {
        var a = await _seed.SeedExerciseAsync();
        var b = await _seed.SeedExerciseAsync();
        var bPersona = await _seed.SeedPersonaAsync(b.Id);
        var bBefore = await _seed.ReadPersonaAsync(bPersona);
        var controllerOfA = await _seed.SeedControllerSessionAsync(a.Id);

        await using var factory = _seed.CreateFactory();
        using var client = factory.CreateClientFor(a.Host, controllerOfA);

        var crossExercise = await PatchAsync(client, bPersona, new { displayName = "Hijacked", verified = false, bio = (string?)null });
        var unknown = await PatchAsync(client, Guid.NewGuid(), new { displayName = "Hijacked", verified = false, bio = (string?)null });

        crossExercise.StatusCode.Should().Be(HttpStatusCode.NotFound, "another exercise's persona does not exist from A's scope (COR-001)");
        unknown.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await crossExercise.Content.ReadAsStringAsync()).Should().Be(
            await unknown.Content.ReadAsStringAsync(), "the response must not reveal that B's persona exists");

        var bAfter = await _seed.ReadPersonaAsync(bPersona);
        bAfter.DisplayName.Should().Be(bBefore.DisplayName, "zero rows change in the other exercise");
        bAfter.Verified.Should().Be(bBefore.Verified);
        bAfter.Bio.Should().Be(bBefore.Bio);
    }

    [RequiresDockerTheory]
    [InlineData("avatarMediaId", PersonaAdminMessages.AvatarMediaNotFound)]
    [InlineData("bannerMediaId", PersonaAdminMessages.BannerMediaNotFound)]
    public async Task OtherExercisesRealImage_Returns400_ByteIdenticalToAnUnknownId_AndChangesNothing(string field, string expected)
    {
        var a = await _seed.SeedExerciseAsync();
        var b = await _seed.SeedExerciseAsync();
        var aPersona = await _seed.SeedPersonaAsync(a.Id);
        var aBefore = await _seed.ReadPersonaAsync(aPersona);
        var bImage = await _seed.SeedMediaAsync(b.Id);
        var controllerOfA = await _seed.SeedControllerSessionAsync(a.Id);

        await using var factory = _seed.CreateFactory();
        using var client = factory.CreateClientFor(a.Host, controllerOfA);

        // Each id is sent next to a valid rename, so a half-applied patch would show up as a changed display name.
        var crossExercise = await PatchAsync(client, aPersona, $$"""{ "displayName": "Should not apply", "{{field}}": "{{bImage}}" }""");
        var unknown = await PatchAsync(client, aPersona, $$"""{ "displayName": "Should not apply", "{{field}}": "{{Guid.NewGuid()}}" }""");
        var malformed = await PatchAsync(client, aPersona, $$"""{ "displayName": "Should not apply", "{{field}}": "not-a-guid" }""");

        crossExercise.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await ReadMessageAsync(crossExercise)).Should().Be(expected);
        var crossBody = await crossExercise.Content.ReadAsStringAsync();
        crossBody.Should().Be(await unknown.Content.ReadAsStringAsync(), "DP-16: B's real id gets the same 4xx as an unknown id");
        crossBody.Should().Be(await malformed.Content.ReadAsStringAsync());
        unknown.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        malformed.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var aAfter = await _seed.ReadPersonaAsync(aPersona);
        aAfter.DisplayName.Should().Be(aBefore.DisplayName, "zero rows written: the rename in the same patch did not apply");
        aAfter.AvatarMediaId.Should().BeNull();
        aAfter.BannerMediaId.Should().BeNull();
        (await _seed.MediaExistsAsync(bImage)).Should().BeTrue("B's image is real; the refusal is the scope closing the door");

        // No persona anywhere now points at B's image.
        await using var read = _seed.CreateContext();
        (await read.Personas.IgnoreQueryFilters().CountAsync(p => p.AvatarMediaId == bImage || p.BannerMediaId == bImage))
            .Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task BodyExerciseId_IsRefused_AndNeverRetargetsTheEdit()
    {
        // Scope comes ONLY from IExerciseContext; a client-supplied exerciseId is a 400, never a scope (COR-001).
        var a = await _seed.SeedExerciseAsync();
        var b = await _seed.SeedExerciseAsync();
        var aPersona = await _seed.SeedPersonaAsync(a.Id);
        var bPersona = await _seed.SeedPersonaAsync(b.Id);
        var aBefore = await _seed.ReadPersonaAsync(aPersona);
        var bBefore = await _seed.ReadPersonaAsync(bPersona);
        var controllerOfA = await _seed.SeedControllerSessionAsync(a.Id);

        await using var factory = _seed.CreateFactory();
        using var client = factory.CreateClientFor(a.Host, controllerOfA);

        var toOwn = await PatchAsync(client, aPersona, new { exerciseId = b.Id.ToString(), displayName = "Moved" });
        var toOther = await PatchAsync(client, bPersona, new { exerciseId = b.Id.ToString(), displayName = "Moved" });

        toOwn.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await ReadMessageAsync(toOwn)).Should().Be(PersonaAdminMessages.CannotBeChanged("exerciseId"));
        toOther.StatusCode.Should().Be(HttpStatusCode.BadRequest, "the body is refused before any lookup");

        var aAfter = await _seed.ReadPersonaAsync(aPersona);
        aAfter.ExerciseId.Should().Be(a.Id);
        aAfter.DisplayName.Should().Be(aBefore.DisplayName);
        (await _seed.ReadPersonaAsync(bPersona)).DisplayName.Should().Be(bBefore.DisplayName);
    }

    [RequiresDockerFact]
    public async Task ControllerOfBothExercises_ActiveOnA_CannotEditBsPersona_ScopeIsTheSessionNotTheTargetId()
    {
        // Assigned to B as well, but the resolved scope is the session's active exercise (A). B's persona is
        // therefore not found, exactly like an unknown id: the target id never selects the scope.
        var a = await _seed.SeedExerciseAsync();
        var b = await _seed.SeedExerciseAsync();
        var bPersona = await _seed.SeedPersonaAsync(b.Id);
        var bBefore = await _seed.ReadPersonaAsync(bPersona);
        var controller = await _seed.SeedStaffSessionAsync(a.Id, [(a.Id, "controller"), (b.Id, "controller")]);

        await using var factory = _seed.CreateFactory();
        using var client = factory.CreateClientFor(a.Host, controller);

        var response = await PatchAsync(client, bPersona, new { displayName = "Hijacked" });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await _seed.ReadPersonaAsync(bPersona)).DisplayName.Should().Be(bBefore.DisplayName);
    }

    [RequiresDockerFact]
    public async Task ControllerOfA_OnBsHost_CannotEditBsPersona()
    {
        // Whatever scope the pipeline resolves for a staff session presented on another exercise's host, the edit
        // must fail closed: either the session's own exercise (B's persona → 404) or B (not assigned → 403).
        var a = await _seed.SeedExerciseAsync();
        var b = await _seed.SeedExerciseAsync();
        var bPersona = await _seed.SeedPersonaAsync(b.Id);
        var bBefore = await _seed.ReadPersonaAsync(bPersona);
        var controllerOfA = await _seed.SeedControllerSessionAsync(a.Id);

        await using var factory = _seed.CreateFactory();
        using var client = factory.CreateClientFor(b.Host, controllerOfA);

        var response = await PatchAsync(client, bPersona, new { displayName = "Hijacked" });

        response.StatusCode.Should().BeOneOf(HttpStatusCode.NotFound, HttpStatusCode.Forbidden, HttpStatusCode.Unauthorized);
        (await _seed.ReadPersonaAsync(bPersona)).DisplayName.Should().Be(bBefore.DisplayName);
    }

    [RequiresDockerFact]
    public async Task AnEditInA_NeverAppearsInBsPersonaRead()
    {
        var a = await _seed.SeedExerciseAsync();
        var b = await _seed.SeedExerciseAsync();
        var aPersona = await _seed.SeedPersonaAsync(a.Id);
        var aImage = await _seed.SeedMediaAsync(a.Id);
        var controllerOfA = await _seed.SeedControllerSessionAsync(a.Id);
        var bViewer = await _seed.SeedPersonaAsync(b.Id);
        var participantOfB = await _seed.SeedParticipantSessionAsync(b.Id, bViewer);

        await using var factory = _seed.CreateFactory();
        using var aClient = factory.CreateClientFor(a.Host, controllerOfA);
        using var bClient = factory.CreateClientFor(b.Host, participantOfB);

        var edited = await PatchAsync(aClient, aPersona, new { displayName = "Only in A 5c1e", avatarMediaId = aImage.ToString() });
        edited.StatusCode.Should().Be(HttpStatusCode.OK);

        (await ReadPersonaFromListAsync(bClient, aPersona)).Should().BeNull("A's persona does not exist in B's world");
        var bRaw = await (await bClient.GetAsync(new Uri("/api/personas", UriKind.Relative))).Content.ReadAsStringAsync();
        bRaw.Should().NotContain("Only in A 5c1e").And.NotContain(aImage.ToString("N"));
    }
}
