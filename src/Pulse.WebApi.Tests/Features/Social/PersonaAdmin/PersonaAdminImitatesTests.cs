namespace Pulse.WebApi.Tests.Features.Social.PersonaAdmin;

using System;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Features.Social.PersonaAdmin;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Xunit;
using static Pulse.WebApi.Tests.Features.Social.PersonaAdmin.PersonaAdminHttp;

/// <summary>
/// <c>imitatesPersonaId</c> on <c>PATCH /api/staff/personas/{personaId}</c> (demo-feedback story 33, DF-49): a guid
/// sets the named pair and <c>null</c> clears it; the target must be another, verified persona in this exercise (a
/// persona in another exercise reads exactly like an unknown id, COR-001); only a persona that is unverified after the
/// patch may name one; the gates and 404s are unchanged; the staff read carries the field and the participant read
/// never does (XC-002). Real <c>Program</c> pipeline, real tokens, real SQL.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PersonaAdminImitatesTests
{
    private readonly PersonaAdminSeeder _seed;

    public PersonaAdminImitatesTests(MsSqlContainerFixture fixture) => _seed = new PersonaAdminSeeder(fixture);

    [RequiresDockerFact]
    public async Task AGuid_SetsTheTarget_AndNull_ClearsIt()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var verified = await _seed.SeedPersonaAsync(exercise.Id);
        var lookalike = await _seed.SeedPersonaAsync(exercise.Id, verified: false);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        await using var factory = _seed.CreateFactory();
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var set = await PatchAsync(client, lookalike, new { imitatesPersonaId = verified.ToString() });

        set.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadObjectAsync(set)).GetProperty("imitatesPersonaId").GetString().Should().Be(verified.ToString());
        (await _seed.ReadPersonaAsync(lookalike)).ImitatesPersonaId.Should().Be(verified);

        var cleared = await PatchAsync(client, lookalike, """{ "imitatesPersonaId": null }""");

        cleared.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadObjectAsync(cleared)).GetProperty("imitatesPersonaId").ValueKind.Should().Be(JsonValueKind.Null);
        (await _seed.ReadPersonaAsync(lookalike)).ImitatesPersonaId.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task VerifiedFalse_AndATarget_InOnePatch_IsAccepted()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var verified = await _seed.SeedPersonaAsync(exercise.Id);
        var editee = await _seed.SeedPersonaAsync(exercise.Id);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        await using var factory = _seed.CreateFactory();
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await PatchAsync(client, editee, new { verified = false, imitatesPersonaId = verified.ToString() });

        response.StatusCode.Should().Be(HttpStatusCode.OK, "the persona is unverified once the patch is applied");
        var after = await _seed.ReadPersonaAsync(editee);
        after.Verified.Should().BeFalse();
        after.ImitatesPersonaId.Should().Be(verified);
    }

    [RequiresDockerFact]
    public async Task TheTargetIsThePersonaItself_Returns400_AndChangesNothing()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var lookalike = await _seed.SeedPersonaAsync(exercise.Id, verified: false);

        await AssertInvalidAsync(exercise, lookalike, lookalike, PersonaAdminMessages.ImitatesSelf);
    }

    [RequiresDockerFact]
    public async Task AnUnknownTarget_Returns400_AndChangesNothing()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var lookalike = await _seed.SeedPersonaAsync(exercise.Id, verified: false);

        await AssertInvalidAsync(exercise, lookalike, Guid.NewGuid(), PersonaAdminMessages.ImitatesNotFound);
    }

    [RequiresDockerFact]
    public async Task AnUnverifiedTarget_Returns400_AndChangesNothing()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var otherUnverified = await _seed.SeedPersonaAsync(exercise.Id, verified: false);
        var lookalike = await _seed.SeedPersonaAsync(exercise.Id, verified: false);

        await AssertInvalidAsync(exercise, lookalike, otherUnverified, PersonaAdminMessages.ImitatesNotVerified);
    }

    [RequiresDockerFact]
    public async Task AVerifiedEditee_Returns400_AndChangesNothing()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var verified = await _seed.SeedPersonaAsync(exercise.Id);
        var verifiedEditee = await _seed.SeedPersonaAsync(exercise.Id);

        await AssertInvalidAsync(exercise, verifiedEditee, verified, PersonaAdminMessages.ImitatesRequiresUnverified);
    }

    [RequiresDockerFact]
    public async Task VerifiedTrue_AndATarget_InOnePatch_Returns400_AndChangesNothing()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var verified = await _seed.SeedPersonaAsync(exercise.Id);
        var lookalike = await _seed.SeedPersonaAsync(exercise.Id, verified: false);
        var before = await _seed.ReadPersonaAsync(lookalike);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        await using var factory = _seed.CreateFactory();
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await PatchAsync(client, lookalike, new { verified = true, imitatesPersonaId = verified.ToString() });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await ReadMessageAsync(response)).Should().Be(PersonaAdminMessages.ImitatesRequiresUnverified);
        var after = await _seed.ReadPersonaAsync(lookalike);
        after.Verified.Should().Be(before.Verified, "a refused patch is applied whole or not at all");
        after.ImitatesPersonaId.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task VerifiedTrue_Alone_WithAStoredTarget_IsAllowed_AndKeepsTheValue()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var verified = await _seed.SeedPersonaAsync(exercise.Id);
        var lookalike = await _seed.SeedPersonaAsync(exercise.Id, verified: false, imitatesPersonaId: verified);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        await using var factory = _seed.CreateFactory();
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await PatchAsync(client, lookalike, new { verified = true });

        response.StatusCode.Should().Be(HttpStatusCode.OK, "the stored value is kept; the report skips the pair");
        var after = await _seed.ReadPersonaAsync(lookalike);
        after.Verified.Should().BeTrue();
        after.ImitatesPersonaId.Should().Be(verified);
    }

    [RequiresDockerFact]
    public async Task AnotherExercisesVerifiedPersona_Returns400_ByteIdenticalToAnUnknownId_AndChangesNothing()
    {
        // Always-Critical (COR-001): B's REAL verified persona is refused with exactly the unknown-id body.
        var a = await _seed.SeedExerciseAsync();
        var b = await _seed.SeedExerciseAsync();
        var aLookalike = await _seed.SeedPersonaAsync(a.Id, verified: false);
        var bVerified = await _seed.SeedPersonaAsync(b.Id);
        var bBefore = await _seed.ReadPersonaAsync(bVerified);
        var controllerOfA = await _seed.SeedControllerSessionAsync(a.Id);

        await using var factory = _seed.CreateFactory();
        using var client = factory.CreateClientFor(a.Host, controllerOfA);

        var crossExercise = await PatchAsync(client, aLookalike, $$"""{ "displayName": "Should not apply", "imitatesPersonaId": "{{bVerified}}" }""");
        var unknown = await PatchAsync(client, aLookalike, $$"""{ "displayName": "Should not apply", "imitatesPersonaId": "{{Guid.NewGuid()}}" }""");

        crossExercise.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await ReadMessageAsync(crossExercise)).Should().Be(PersonaAdminMessages.ImitatesNotFound);
        (await crossExercise.Content.ReadAsStringAsync()).Should().Be(
            await unknown.Content.ReadAsStringAsync(), "the response must not reveal that B's persona exists");

        var aAfter = await _seed.ReadPersonaAsync(aLookalike);
        aAfter.ImitatesPersonaId.Should().BeNull("nothing is written");
        aAfter.DisplayName.Should().NotBe("Should not apply", "a refused patch is applied whole or not at all");
        var bAfter = await _seed.ReadPersonaAsync(bVerified);
        bAfter.Verified.Should().Be(bBefore.Verified, "B's row exists (read past the filter) and is untouched");
        bAfter.DisplayName.Should().Be(bBefore.DisplayName);
    }

    [RequiresDockerFact]
    public async Task Gates_AndNotFound_AreUnchanged_ForAPatchNamingATarget()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var verified = await _seed.SeedPersonaAsync(exercise.Id);
        var lookalike = await _seed.SeedPersonaAsync(exercise.Id, verified: false);
        var participant = await _seed.SeedParticipantSessionAsync(exercise.Id, lookalike);
        var evaluator = await _seed.SeedStaffSessionAsync(exercise.Id, [(exercise.Id, "evaluator")]);
        var readOnlyController = await _seed.SeedStaffSessionAsync(
            exercise.Id, [(exercise.Id, "controller")], session => session.IsReadOnly = true);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);
        var body = new { imitatesPersonaId = verified.ToString() };

        await using var factory = _seed.CreateFactory();
        using var anonymousClient = factory.CreateClientFor(exercise.Host, bearerToken: null);
        using var participantClient = factory.CreateClientFor(exercise.Host, participant);
        using var evaluatorClient = factory.CreateClientFor(exercise.Host, evaluator);
        using var readOnlyClient = factory.CreateClientFor(exercise.Host, readOnlyController);
        using var controllerClient = factory.CreateClientFor(exercise.Host, controller);

        (await PatchAsync(anonymousClient, lookalike, body)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await PatchAsync(participantClient, lookalike, body)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await PatchAsync(evaluatorClient, lookalike, body)).StatusCode.Should().Be(HttpStatusCode.Forbidden, "controller only");
        (await PatchAsync(readOnlyClient, lookalike, body)).StatusCode.Should().Be(HttpStatusCode.Forbidden, "read-only sessions are denied");
        (await PatchAsync(controllerClient, Guid.NewGuid(), body)).StatusCode.Should().Be(HttpStatusCode.NotFound);

        (await _seed.ReadPersonaAsync(lookalike)).ImitatesPersonaId.Should().BeNull("no refused caller wrote the field");
    }

    [RequiresDockerFact]
    public async Task StaffRead_CarriesImitatesPersonaId_TheParticipantReadNeverDoes()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var verified = await _seed.SeedPersonaAsync(exercise.Id);
        var lookalike = await _seed.SeedPersonaAsync(exercise.Id, verified: false, imitatesPersonaId: verified);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);
        var participant = await _seed.SeedParticipantSessionAsync(exercise.Id, verified);

        await using var factory = _seed.CreateFactory();
        using var staffClient = factory.CreateClientFor(exercise.Host, controller);
        using var participantClient = factory.CreateClientFor(exercise.Host, participant);

        var seenByStaff = (await ReadPersonaFromListAsync(staffClient, lookalike))!.Value;
        seenByStaff.GetProperty("imitatesPersonaId").GetString().Should().Be(verified.ToString());
        var unsetForStaff = (await ReadPersonaFromListAsync(staffClient, verified))!.Value;
        unsetForStaff.GetProperty("imitatesPersonaId").ValueKind.Should().Be(JsonValueKind.Null);

        var seenByParticipant = (await ReadPersonaFromListAsync(participantClient, lookalike))!.Value;
        PropertyNames(seenByParticipant).Should().NotContain(
            "imitatesPersonaId", "XC-002: the named pair is staff-world authoring state, never on the participant shape");
    }

    private async Task AssertInvalidAsync(PersonaAdminExercise exercise, Guid personaId, Guid target, string expected)
    {
        var before = await _seed.ReadPersonaAsync(personaId);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        await using var factory = _seed.CreateFactory();
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await PatchAsync(
            client, personaId, $$"""{ "displayName": "Should not apply", "imitatesPersonaId": "{{target}}" }""");

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await ReadMessageAsync(response)).Should().Be(expected);
        var after = await _seed.ReadPersonaAsync(personaId);
        after.ImitatesPersonaId.Should().Be(before.ImitatesPersonaId, "a refused patch writes nothing");
        after.DisplayName.Should().Be(before.DisplayName, "a refused patch is applied whole or not at all");
    }
}
