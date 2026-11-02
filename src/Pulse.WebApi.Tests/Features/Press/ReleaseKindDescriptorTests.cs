namespace Pulse.WebApi.Tests.Features.Press;

using System;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Press.Contracts;
using Pulse.WebApi.Features.Press.Kind;
using Pulse.WebApi.Tests.Features.Channels.Publish;

/// <summary>
/// Press story 01 (#738): the <c>release</c> kind descriptor (PRS-010, FC-7). Registration through the real funnel, PC-1
/// validation and normalization, XC-001 isolation (another exercise's persona or document answers exactly like an
/// unknown one), and the participant projection leak test over the serialized JSON (XC-002).
/// </summary>
public sealed class ReleaseKindDescriptorTests : IDisposable
{
    private readonly PressHarness _harness = new();
    private readonly ReleaseKindDescriptor _descriptor = new();

    public void Dispose() => _harness.Dispose();

    [Fact]
    public void Descriptor_IsPressRelease_WithRichTables_AndImagePlusDocument()
    {
        _descriptor.Kind.Should().Be("release");
        _descriptor.ChannelId.Should().Be("press");
        _descriptor.BodyPolicy.Should().Be(ISanitizerProfileRegistry.RichTables, "F04's built-in profile; no new profile (FU-5)");
        _descriptor.AllowedMediaKinds.Should().BeEquivalentTo(["image", "document"]);
        _descriptor.DefaultAlertMapping.Should().BeNull();
    }

    [Fact]
    public async Task TheFunnel_ResolvesReleaseThroughTheRealDescriptor_AndStillRefusesAnUnregisteredKind()
    {
        var org = await _harness.AddOrgAsync(_harness.ExerciseId, "Fulton County EM", "FultonEM");
        using var scope = _harness.InA();
        scope.Services.GetServices<IContentKindDescriptor>().OfType<ReleaseKindDescriptor>().Should().ContainSingle();

        var release = _harness.Funnel.Request("Shelters open at three high schools", "release") with
        {
            Payload = PressHarness.Payload(org),
        };
        var created = await scope.Funnel.CreateDraftAsync(release, FunnelHarness.Participant);
        created.Outcome.Should().Be(ContentPublishOutcome.Ok, string.Join("; ", created.Errors));
        var stored = JsonNode.Parse((await scope.Db.ContentItems.AsNoTracking().SingleAsync()).PayloadJson)!.AsObject();
        stored["org"]!["name"]!.GetValue<string>().Should().Be("Fulton County EM", "the funnel persists the normalized payload");

        var podcast = await scope.Funnel.CreateDraftAsync(release with { Kind = "podcast" }, FunnelHarness.Participant);
        podcast.Outcome.Should().Be(ContentPublishOutcome.Invalid);
        podcast.Errors.Single().Should().Contain("podcast");

        var invalid = await scope.Funnel.CreateDraftAsync(
            release with { Payload = new JsonObject { ["orgPersonaId"] = Guid.NewGuid().ToString() } }, FunnelHarness.Participant);
        invalid.Outcome.Should().Be(ContentPublishOutcome.Invalid, "an invalid payload is a readable 400");
        invalid.Errors.Should().Contain(ReleasePayloadReader.OrgPersonaNotFound);
    }

    [Fact]
    public async Task AValidPayload_IsNormalizedInPlace_WithServerDerivedOrgAndDocumentFacts()
    {
        var org = await _harness.AddOrgAsync(_harness.ExerciseId, "Fulton County EM", "FultonEM");
        var newsroom = await ProvisionAsync();
        var pdf = await _harness.AddMediaAsync(_harness.ExerciseId, MediaKinds.Document, "shelters.pdf", 91_000);
        var payload = PressHarness.Payload(org);
        payload["document"] = new JsonObject { ["mediaId"] = pdf.ToString(), ["fileName"] = "evil.exe", ["sizeBytes"] = 1 };
        payload["org"] = new JsonObject { ["name"] = "The White House" };
        payload["unknown"] = "dropped";

        using var scope = _harness.InA();
        var result = await _descriptor.ValidatePayloadAsync(payload, PressHarness.Context(scope, _harness.ExerciseId));

        result.IsValid.Should().BeTrue(string.Join("; ", result.Errors));
        payload.Select(p => p.Key).Should().Equal(
            "orgPersonaId", "inputPath", "contact", "dateline", "document", "boilerplate", "crossPost", "approval", "org");
        payload["org"]!["name"]!.GetValue<string>().Should().Be("Fulton County EM", "a client-sent org is overwritten");
        payload["org"]!["outletId"]!.GetValue<string>().Should().Be(newsroom.ToString());
        payload["document"]!["fileName"]!.GetValue<string>().Should().Be("shelters.pdf");
        payload["document"]!["sizeBytes"]!.GetValue<long>().Should().Be(91_000);
    }

    [Fact]
    public async Task Approval_IsServerOwned_IgnoredOnCreate_AndCarriedForwardOnEdit()
    {
        var org = await _harness.AddOrgAsync(_harness.ExerciseId, "Fulton County EM", "FultonEM");
        using var scope = _harness.InA();
        var create = PressHarness.Payload(org);
        create["approval"] = new JsonObject { ["required"] = false };

        (await _descriptor.ValidatePayloadAsync(create, PressHarness.Context(scope, _harness.ExerciseId))).IsValid.Should().BeTrue();
        create["approval"].Should().BeNull("an author cannot opt out of (or into) approval through the payload");

        var item = Pulse.WebApi.Tests.Data.ChannelRows.ContentItem(_harness.ExerciseId, _harness.WireRoomId, "held-release");
        item.ChannelId = ChannelVocabulary.Press;
        item.Kind = ChannelVocabulary.KindRelease;
        item.PayloadJson = """{"approval":{"required":true}}""";
        scope.Db.ContentItems.Add(item);
        await scope.Db.SaveChangesAsync();

        var edit = PressHarness.Payload(org);
        edit["approval"] = new JsonObject { ["required"] = false };
        var context = PressHarness.Context(scope, _harness.ExerciseId) with { ContentItemId = item.Id };
        (await _descriptor.ValidatePayloadAsync(edit, context)).IsValid.Should().BeTrue();
        edit["approval"]!["required"]!.GetValue<bool>().Should().BeTrue("the stored value wins over the write");
    }

    [Fact]
    public async Task TheOrgRef_IsAnEnabledNewsroomUnderTheWireRoom_ElseThePersonaName()
    {
        var org = await _harness.AddOrgAsync(_harness.ExerciseId, "Fulton County EM", "FultonEM");
        var newsroom = await ProvisionAsync();
        using var scope = _harness.InA();
        var outlet = await scope.Db.Outlets.SingleAsync(o => o.Id == newsroom);
        outlet.Name = "Fulton County Newsroom";
        outlet.Enabled = false;
        await scope.Db.SaveChangesAsync();

        var payload = PressHarness.Payload(org);
        (await _descriptor.ValidatePayloadAsync(payload, PressHarness.Context(scope, _harness.ExerciseId))).IsValid.Should().BeTrue();
        payload["org"]!["outletId"].Should().BeNull("a disabled newsroom is not the org ref");
        payload["org"]!["name"]!.GetValue<string>().Should().Be("Fulton County EM");

        outlet.Enabled = true;
        outlet.ParentOutletId = null;
        await scope.Db.SaveChangesAsync();
        var moved = PressHarness.Payload(org);
        (await _descriptor.ValidatePayloadAsync(moved, PressHarness.Context(scope, _harness.ExerciseId))).IsValid.Should().BeTrue();
        moved["org"]!["outletId"].Should().BeNull("only a child of The Wire Room is an org newsroom");
    }

    [Fact]
    public async Task InputPath_DefaultsToRich_AndAnUnknownValueIsRefused()
    {
        var org = await _harness.AddOrgAsync(_harness.ExerciseId, "Fulton County EM", "FultonEM");
        using var scope = _harness.InA();

        var minimal = new JsonObject { ["orgPersonaId"] = org.ToString() };
        (await _descriptor.ValidatePayloadAsync(minimal, PressHarness.Context(scope, _harness.ExerciseId))).IsValid.Should().BeTrue();
        minimal["inputPath"]!.GetValue<string>().Should().Be("rich");
        minimal["contact"].Should().BeNull();

        var bad = PressHarness.Payload(org);
        bad["inputPath"] = "fax";
        (await _descriptor.ValidatePayloadAsync(bad, PressHarness.Context(scope, _harness.ExerciseId)))
            .Errors.Should().ContainSingle(e => e.StartsWith("payload.inputPath", StringComparison.Ordinal));
    }

    [Fact]
    public async Task AnotherExercisesPersona_AnswersExactlyLikeAnUnknownOne()
    {
        var foreign = await _harness.AddOrgAsync(_harness.OtherExerciseId, "Elsewhere EM", "ElsewhereEM");
        using var scope = _harness.InA();

        var crossExercise = await _descriptor.ValidatePayloadAsync(
            PressHarness.Payload(foreign), PressHarness.Context(scope, _harness.ExerciseId));
        var unknown = await _descriptor.ValidatePayloadAsync(
            PressHarness.Payload(Guid.NewGuid()), PressHarness.Context(scope, _harness.ExerciseId));
        var malformed = await _descriptor.ValidatePayloadAsync(
            new JsonObject { ["orgPersonaId"] = "not-a-guid" }, PressHarness.Context(scope, _harness.ExerciseId));

        crossExercise.Errors.Should().Equal(ReleasePayloadReader.OrgPersonaNotFound);
        unknown.Errors.Should().Equal(crossExercise.Errors);
        malformed.Errors.Should().Equal(crossExercise.Errors);
        (await _descriptor.ValidatePayloadAsync([], PressHarness.Context(scope, _harness.ExerciseId)))
            .Errors.Should().Equal("payload.orgPersonaId: is required");
    }

    [Fact]
    public async Task Document_MustBeAnExerciseOwnedDocumentAsset()
    {
        var org = await _harness.AddOrgAsync(_harness.ExerciseId, "Fulton County EM", "FultonEM");
        var image = await _harness.AddMediaAsync(_harness.ExerciseId, MediaKinds.Image, "logo.jpg");
        var foreignPdf = await _harness.AddMediaAsync(_harness.OtherExerciseId, MediaKinds.Document);
        using var scope = _harness.InA();

        foreach (var id in new[] { image, foreignPdf, Guid.NewGuid() })
        {
            var payload = PressHarness.Payload(org);
            payload["document"] = new JsonObject { ["mediaId"] = id.ToString() };

            (await _descriptor.ValidatePayloadAsync(payload, PressHarness.Context(scope, _harness.ExerciseId)))
                .Errors.Should().Equal(ReleasePayloadReader.DocumentNotFound);
        }
    }

    [Theory]
    [InlineData("name", 121)]
    [InlineData("title", 121)]
    [InlineData("phone", 41)]
    [InlineData("email", 255)]
    public async Task ContactFields_AreLengthCapped(string field, int length)
    {
        var org = await _harness.AddOrgAsync(_harness.ExerciseId, "Fulton County EM", "FultonEM");
        var payload = PressHarness.Payload(org);
        payload["contact"]![field] = new string('a', length);
        using var scope = _harness.InA();

        var result = await _descriptor.ValidatePayloadAsync(payload, PressHarness.Context(scope, _harness.ExerciseId));

        result.Errors.Should().ContainSingle().Which.Should().StartWith($"payload.contact.{field}: must be at most");
    }

    [Fact]
    public async Task ContactAndDateline_AreStoredAsPlainText_AndAContactNeedsAName()
    {
        var org = await _harness.AddOrgAsync(_harness.ExerciseId, "Fulton County EM", "FultonEM");
        var payload = PressHarness.Payload(org);
        payload["contact"]!["name"] = "<script>alert(1)</script>Jordan <b>Alvarez</b>";
        payload["dateline"] = "<img src=x onerror=alert(1)>ATLANTA —";
        using var scope = _harness.InA();

        (await _descriptor.ValidatePayloadAsync(payload, PressHarness.Context(scope, _harness.ExerciseId))).IsValid.Should().BeTrue();
        payload["contact"]!["name"]!.GetValue<string>().Should().NotContain("<").And.Contain("Alvarez");
        payload["dateline"]!.GetValue<string>().Should().Be("ATLANTA —");

        var nameless = PressHarness.Payload(org);
        nameless["contact"] = new JsonObject { ["phone"] = "404-555-0142" };
        (await _descriptor.ValidatePayloadAsync(nameless, PressHarness.Context(scope, _harness.ExerciseId)))
            .Errors.Should().Equal("payload.contact.name: is required when a contact is given");

        var wrongType = PressHarness.Payload(org);
        wrongType["dateline"] = 42;
        (await _descriptor.ValidatePayloadAsync(wrongType, PressHarness.Context(scope, _harness.ExerciseId)))
            .Errors.Should().Equal("payload.dateline: must be a string or null");
    }

    [Fact]
    public async Task Projection_CarriesOnlyOrgContactDatelineAndDocument_InTheSerializedJson()
    {
        var org = await _harness.AddOrgAsync(_harness.ExerciseId, "Fulton County EM", "FultonEM");
        await ProvisionAsync();
        var pdf = await _harness.AddMediaAsync(_harness.ExerciseId, MediaKinds.Document);
        var payload = PressHarness.Payload(org);
        payload["document"] = new JsonObject { ["mediaId"] = pdf.ToString() };
        using var scope = _harness.InA();
        (await _descriptor.ValidatePayloadAsync(payload, PressHarness.Context(scope, _harness.ExerciseId))).IsValid.Should().BeTrue();

        // Round-trip through the stored string, as the funnel's read path does.
        var projected = _descriptor.ProjectPayload(JsonNode.Parse(payload.ToJsonString())!.AsObject());
        var json = projected.ToJsonString();

        projected.Select(p => p.Key).Should().Equal(PressVocabulary.ParticipantPayloadKeys);
        projected["org"]!.AsObject().Select(p => p.Key).Should().Equal("name", "outletId");
        projected["document"]!.AsObject().Select(p => p.Key).Should().Equal("mediaId", "fileName", "sizeBytes");
        foreach (var leak in new[] { "crossPost", "approval", "inputPath", "boilerplate", "orgPersonaId", org.ToString(), "Shelters are open." })
        {
            json.Should().NotContain(leak, "XC-002: a participant never sees the author/staff fields");
        }
    }

    [Fact]
    public void Projection_OfAStoredPayloadWithoutAnOrg_FailsClosed()
    {
        _descriptor.ProjectPayload(new JsonObject { ["orgPersonaId"] = Guid.NewGuid().ToString() }).Should().BeEmpty();
        _descriptor.ProjectPayload([]).Should().BeEmpty();
    }

    [Fact]
    public void Projection_DropsAMalformedOptionalBlock_RatherThanBlanking()
    {
        var stored = new JsonObject
        {
            ["orgPersonaId"] = Guid.NewGuid().ToString(),
            ["contact"] = "not an object",
            ["dateline"] = "<b>ATLANTA</b> —",
            ["document"] = new JsonObject { ["mediaId"] = Guid.NewGuid().ToString() },
            ["org"] = new JsonObject { ["name"] = "Fulton County EM", ["outletId"] = null },
        };

        var projected = _descriptor.ProjectPayload(stored);

        projected["contact"].Should().BeNull();
        projected["document"].Should().BeNull("a stored document without its file facts is not shown");
        projected["dateline"]!.GetValue<string>().Should().Be("ATLANTA —");
        projected["org"]!["outletId"].Should().BeNull();
    }

    [Fact]
    public async Task APublishedReleaseSummary_IsNamedForTheOrg_NotTheWireRoom()
    {
        // R-P1: the summary's outlet is the child newsroom, so outlet.name is the publishing org.
        var org = await _harness.AddOrgAsync(_harness.ExerciseId, "Fulton County EM", "FultonEM");
        var newsroom = await ProvisionAsync();
        using var scope = _harness.InA();
        var request = _harness.Funnel.Request("Shelters open at three high schools", "release") with
        {
            OutletId = newsroom.ToString(),
            BodyHtml = "<p>Three shelters opened at noon. Bring medications.</p>",
            Dek = ReleaseDek.Derive("Shelters open at three high schools", "<p>Three shelters opened at noon. Bring medications.</p>", "Fulton County EM"),
            Payload = PressHarness.Payload(org),
        };
        var created = await scope.Funnel.CreateDraftAsync(request, FunnelHarness.Participant);
        created.Outcome.Should().Be(ContentPublishOutcome.Ok, string.Join("; ", created.Errors));
        (await scope.Funnel.PublishAsync(Guid.Parse(created.Item!.Id), null, FunnelHarness.Participant))
            .Outcome.Should().Be(ContentPublishOutcome.Ok);

        var item = await scope.Db.ContentItems.AsNoTracking().SingleAsync();
        var summary = await new ContentProjector(scope.Db).ToSummaryAsync(item);

        var wireRoomName = await scope.Db.Outlets.Where(o => o.Id == _harness.WireRoomId).Select(o => o.Name).SingleAsync();
        summary.Outlet.Name.Should().Be("Fulton County EM").And.NotBe(wireRoomName);
        summary.Dek.Should().Be("Three shelters opened at noon.");
    }

    private async Task<Guid> ProvisionAsync()
    {
        using var scope = _harness.InA();
        var result = await _harness.Provisioner(scope).ProvisionAsync();
        return result.Created.Single();
    }
}
