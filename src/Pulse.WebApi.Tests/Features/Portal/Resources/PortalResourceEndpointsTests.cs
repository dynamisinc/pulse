namespace Pulse.WebApi.Tests.Features.Portal.Resources;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Portal.Contracts;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Xunit;

/// <summary>
/// The <c>/api/portal/resources*</c> contract over HTTP (exercise-portal story 04, #770), real SQL: staff CRUD, the
/// stale-version 409, the 25-resource cap, NFR-004 sanitization, the media rules, the participant read, the portal
/// channel gate and the XC-010 soft delete. Cross-exercise isolation has its own class
/// (<see cref="PortalResourceIsolationTests"/>).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PortalResourceEndpointsTests
{
    private const string Route = PortalResourceTestHost.Route;

    private readonly MsSqlContainerFixture _fixture;

    public PortalResourceEndpointsTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // ---- AC "Staff CRUD" --------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Create_PersistsTheFields_AtTheEndOfTheShelf_WithVersionOne()
    {
        await using var host = await StartAsync();
        var (exerciseId, staff) = await host.SeedExerciseAsync(role: "planner");
        await host.AddResourceAsync(exerciseId, "Existing", sortOrder: 4);
        host.ActAs(exerciseId, staff);

        var response = await host.PostAsync(Route, PortalResourceTestHost.Body(title: "  Ground rules  ", visible: false));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var created = (await response.Content.ReadFromJsonAsync<WireStaffResource>())!;
        response.Headers.Location!.OriginalString.Should().Be($"{Route}/{created.Id}");
        created.Title.Should().Be("Ground rules", "the title is trimmed");
        created.Summary.Should().Be("How the exercise works.");
        created.BodyHtml.Should().Be("<p>Read this first.</p>");
        created.Visible.Should().BeFalse();
        created.SortOrder.Should().Be(5, "a new resource goes to the end of the shelf");
        created.Version.Should().Be(1);

        await using var db = host.Db(exerciseId);
        var row = await db.PortalResources.AsNoTracking().SingleAsync(r => r.Id == created.Guid);
        row.Title.Should().Be("Ground rules");
        row.Visible.Should().BeFalse();
        row.ExerciseId.Should().Be(exerciseId, "the scope is the session's, never the body's");
    }

    [RequiresDockerFact]
    public async Task Update_WithTheCurrentVersion_Persists_AndAStaleVersionIs409()
    {
        await using var host = await StartAsync();
        var (exerciseId, staff) = await host.SeedExerciseAsync();
        var row = await host.AddResourceAsync(exerciseId, "Original", sortOrder: 1);
        host.ActAs(exerciseId, staff);

        var ok = await host.PutAsync(row.Id, PortalResourceTestHost.Body(title: "Edited", summary: null, visible: false, version: 1));
        ok.StatusCode.Should().Be(HttpStatusCode.OK);
        var edited = (await ok.Content.ReadFromJsonAsync<WireStaffResource>())!;
        edited.Title.Should().Be("Edited");
        edited.Summary.Should().BeNull();
        edited.Visible.Should().BeFalse();
        edited.Version.Should().Be(2);
        edited.SortOrder.Should().Be(1, "an edit keeps the shelf position");

        var stale = await host.PutAsync(row.Id, PortalResourceTestHost.Body(title: "Lost update", version: 1));
        stale.StatusCode.Should().Be(HttpStatusCode.Conflict);

        await using var db = host.Db(exerciseId);
        (await db.PortalResources.AsNoTracking().SingleAsync(r => r.Id == row.Id)).Title.Should().Be("Edited");
    }

    [RequiresDockerFact]
    public async Task Update_OfAnUnknownId_Is404()
    {
        await using var host = await StartAsync();
        var (exerciseId, staff) = await host.SeedExerciseAsync();
        host.ActAs(exerciseId, staff);

        var response = await host.PutAsync(Guid.NewGuid(), PortalResourceTestHost.Body(version: 1));

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [RequiresDockerFact]
    public async Task Create_BeyondTwentyFiveLiveResources_Is400_AndDeletedRowsDoNotCount()
    {
        await using var host = await StartAsync();
        var (exerciseId, staff) = await host.SeedExerciseAsync();
        for (var i = 1; i < PortalVocabulary.MaxResources; i++)
        {
            await host.AddResourceAsync(exerciseId, $"Resource {i}", sortOrder: i);
        }

        await host.AddResourceAsync(exerciseId, "Deleted", sortOrder: 99, deleted: true);
        host.ActAs(exerciseId, staff);

        var twentyFifth = await host.PostAsync(Route, PortalResourceTestHost.Body(title: "Twenty-fifth"));
        twentyFifth.StatusCode.Should().Be(HttpStatusCode.Created, "a soft-deleted row does not count toward the cap");

        var twentySixth = await host.PostAsync(Route, PortalResourceTestHost.Body(title: "Twenty-sixth"));
        twentySixth.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await twentySixth.Content.ReadAsStringAsync()).Should().Contain("25");
    }

    [RequiresDockerFact]
    public async Task ConcurrentCreates_AtTwentyFour_AdmitExactlyOne()
    {
        await using var host = await StartAsync();
        var (exerciseId, staff) = await host.SeedExerciseAsync();
        for (var i = 1; i < PortalVocabulary.MaxResources; i++)
        {
            await host.AddResourceAsync(exerciseId, $"Resource {i}", sortOrder: i);
        }

        host.ActAs(exerciseId, staff);

        var responses = await Task.WhenAll(Enumerable.Range(0, 4)
            .Select(i => host.PostAsync(Route, PortalResourceTestHost.Body(title: $"Racer {i}"))));

        responses.Count(r => r.StatusCode == HttpStatusCode.Created).Should().Be(1, "the cap holds under concurrency");
        responses.Count(r => r.StatusCode == HttpStatusCode.BadRequest).Should().Be(3);
        await using var db = host.Db(exerciseId);
        (await db.PortalResources.CountAsync()).Should().Be(PortalVocabulary.MaxResources);
    }

    [RequiresDockerTheory]
    [InlineData("title")]
    [InlineData("summary")]
    [InlineData("blank-title")]
    public async Task Create_OverATextLimit_OrWithABlankTitle_Is400(string field)
    {
        await using var host = await StartAsync();
        var (exerciseId, staff) = await host.SeedExerciseAsync();
        host.ActAs(exerciseId, staff);

        var body = field switch
        {
            "title" => PortalResourceTestHost.Body(title: new string('t', PortalVocabulary.ResourceTitleMaxLength + 1)),
            "summary" => PortalResourceTestHost.Body(summary: new string('s', PortalVocabulary.ResourceSummaryMaxLength + 1)),
            _ => PortalResourceTestHost.Body(title: "   "),
        };

        var response = await host.PostAsync(Route, body);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        await using var db = host.Db(exerciseId);
        (await db.PortalResources.CountAsync()).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task Create_AtExactlyTheTextLimits_IsAccepted()
    {
        await using var host = await StartAsync();
        var (exerciseId, staff) = await host.SeedExerciseAsync();
        host.ActAs(exerciseId, staff);

        var response = await host.PostAsync(Route, PortalResourceTestHost.Body(
            title: new string('t', PortalVocabulary.ResourceTitleMaxLength),
            summary: new string('s', PortalVocabulary.ResourceSummaryMaxLength)));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [RequiresDockerFact]
    public async Task Reorder_SetsTheShelfOrder_AndBumpsOnlyTheMovedRows()
    {
        await using var host = await StartAsync();
        var (exerciseId, staff) = await host.SeedExerciseAsync();
        var first = await host.AddResourceAsync(exerciseId, "First", sortOrder: 1);
        var second = await host.AddResourceAsync(exerciseId, "Second", sortOrder: 2);
        var third = await host.AddResourceAsync(exerciseId, "Third", sortOrder: 3, visible: false);
        host.ActAs(exerciseId, staff);

        var response = await host.PostAsync($"{Route}/reorder", new { orderedIds = new[] { third.Id, second.Id, first.Id } });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var shelf = (await response.Content.ReadFromJsonAsync<List<WireStaffResource>>())!;
        shelf.Select(r => r.Title).Should().Equal("Third", "Second", "First");
        shelf.Select(r => r.SortOrder).Should().Equal(1, 2, 3);
        shelf.Single(r => r.Title == "Second").Version.Should().Be(1, "an unmoved row keeps its version");
        shelf.Single(r => r.Title == "Third").Version.Should().Be(2);

        var list = (await (await host.GetAsync(Route)).Content.ReadFromJsonAsync<List<WireStaffResource>>())!;
        list.Select(r => r.Title).Should().Equal("Third", "Second", "First");
    }

    [RequiresDockerTheory]
    [InlineData("missing")]
    [InlineData("duplicate")]
    [InlineData("unknown")]
    [InlineData("not-a-guid")]
    [InlineData("null")]
    public async Task Reorder_ThatDoesNotNameEveryResourceExactlyOnce_Is400(string shape)
    {
        await using var host = await StartAsync();
        var (exerciseId, staff) = await host.SeedExerciseAsync();
        var first = await host.AddResourceAsync(exerciseId, "First", sortOrder: 1);
        var second = await host.AddResourceAsync(exerciseId, "Second", sortOrder: 2);
        host.ActAs(exerciseId, staff);

        string[]? ids = shape switch
        {
            "null" => null,
            "missing" => [first.Id.ToString()],
            "duplicate" => [first.Id.ToString(), first.Id.ToString()],
            "unknown" => [first.Id.ToString(), Guid.NewGuid().ToString()],
            _ => [first.Id.ToString(), "nope"],
        };

        var response = await host.PostAsync($"{Route}/reorder", new { orderedIds = ids });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        await using var db = host.Db(exerciseId);
        (await db.PortalResources.AsNoTracking().SingleAsync(r => r.Id == second.Id)).SortOrder.Should().Be(2);
    }

    // ---- AC "Sanitization (NFR-004)" --------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Body_IsSanitizedOnceAtWrite_AndStoredSanitized()
    {
        await using var host = await StartAsync();
        var (exerciseId, staff) = await host.SeedExerciseAsync();
        host.ActAs(exerciseId, staff);
        const string Hostile =
            "<p onclick=\"steal()\">Hello</p><script>alert(1)</script>" +
            "<a href=\"javascript:alert(2)\">js</a><a href=\"https://evil.example/\">external</a>" +
            "<a href=\"/portal\">home</a><form action=\"/x\"><input name=\"q\"></form>" +
            "<iframe src=\"https://evil.example/\"></iframe><img src=x onerror=\"alert(3)\">";

        var response = await host.PostAsync(Route, PortalResourceTestHost.Body(bodyHtml: Hostile));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var created = (await response.Content.ReadFromJsonAsync<WireStaffResource>())!;
        await using var db = host.Db(exerciseId);
        var stored = (await db.PortalResources.AsNoTracking().SingleAsync(r => r.Id == created.Guid)).BodyHtml!;
        stored.Should().Be(created.BodyHtml, "what is stored is what is served");
        foreach (var forbidden in new[]
                 {
                     "<script", "alert(1)", "onclick", "javascript:", "https://evil.example", "<form", "<input", "<iframe",
                     "onerror", "<img",
                 })
        {
            stored.Should().NotContainEquivalentOf(forbidden);
        }

        stored.Should().Contain("<p>Hello</p>");
        stored.Should().Contain("href=\"/portal\"", "a host-relative link survives (FC-9.3)");
    }

    [RequiresDockerFact]
    public async Task ABodyThatSanitizesToNothing_IsStoredAsNull()
    {
        await using var host = await StartAsync();
        var (exerciseId, staff) = await host.SeedExerciseAsync();
        host.ActAs(exerciseId, staff);

        var response = await host.PostAsync(Route, PortalResourceTestHost.Body(bodyHtml: "<script>alert(1)</script>"));

        (await response.Content.ReadFromJsonAsync<WireStaffResource>())!.BodyHtml.Should().BeNull();
    }

    // ---- AC "Media" -------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task AnImageOfThisExercise_IsAttached_AsInlineMedia()
    {
        await using var host = await StartAsync();
        var (exerciseId, staff) = await host.SeedExerciseAsync();
        var image = await host.AddMediaAssetAsync(exerciseId);
        host.ActAs(exerciseId, staff);

        var created = (await (await host.PostAsync(Route, PortalResourceTestHost.Body(mediaAssetId: image.ToString())))
            .Content.ReadFromJsonAsync<WireStaffResource>())!;

        created.Media.Should().NotBeNull();
        created.Media!.Id.Should().Be(image.ToString());
        created.Media.Kind.Should().Be("image");
        created.Media.Role.Should().Be(ChannelVocabulary.MediaRoleInline);
        created.Media.Url.Should().NotBeNullOrEmpty();
        created.Media.Alt.Should().Be("Quick-start guide");
    }

    [RequiresDockerTheory]
    [InlineData("other-exercise")]
    [InlineData("video")]
    [InlineData("document-flag-off")]
    [InlineData("unknown")]
    [InlineData("not-a-guid")]
    public async Task AnUnusableMediaAsset_Is400(string shape)
    {
        await using var host = await StartAsync();
        var (exerciseId, staff) = await host.SeedExerciseAsync();
        var (otherExercise, _) = await host.SeedExerciseAsync();
        var mediaId = shape switch
        {
            "other-exercise" => (await host.AddMediaAssetAsync(otherExercise)).ToString(),
            "video" => (await host.AddMediaAssetAsync(exerciseId, MediaKinds.Video)).ToString(),
            "document-flag-off" => (await host.AddMediaAssetAsync(exerciseId, MediaKinds.Document)).ToString(),
            "unknown" => Guid.NewGuid().ToString(),
            _ => "nope",
        };
        host.ActAs(exerciseId, staff);

        var response = await host.PostAsync(Route, PortalResourceTestHost.Body(mediaAssetId: mediaId));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).Should().NotContain(otherExercise.ToString());
    }

    [RequiresDockerFact]
    public async Task ADocument_BehindTheFlag_IsAttachedAsADownload()
    {
        await using var host = await PortalResourceTestHost.StartAsync(_fixture.ConnectionString!, documentsEnabled: true);
        var (exerciseId, staff) = await host.SeedExerciseAsync();
        var pdf = await host.AddMediaAssetAsync(exerciseId, MediaKinds.Document);
        host.ActAs(exerciseId, staff);

        var response = await host.PostAsync(Route, PortalResourceTestHost.Body(mediaAssetId: pdf.ToString()));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var media = (await response.Content.ReadFromJsonAsync<WireStaffResource>())!.Media!;
        media.Kind.Should().Be(MediaKinds.Document);
        media.Role.Should().Be(ChannelVocabulary.MediaRoleAttachment, "the shelf links a PDF as a download, never inline");
    }

    // ---- AC "Participant read" ----------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task ParticipantList_IsTheVisibleLiveRows_InSortOrder_AsTheParticipantShape()
    {
        await using var host = await StartAsync();
        var (exerciseId, _) = await host.SeedExerciseAsync();
        var image = await host.AddMediaAssetAsync(exerciseId);
        await host.AddResourceAsync(exerciseId, "Third", sortOrder: 3);
        await host.AddResourceAsync(exerciseId, "First", sortOrder: 1, mediaAssetId: image);
        await host.AddResourceAsync(exerciseId, "Hidden", sortOrder: 2, visible: false);
        await host.AddResourceAsync(exerciseId, "Deleted", sortOrder: 0, deleted: true);
        host.ActAs(exerciseId, staffUserId: null);

        var response = await host.GetAsync(Route);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadAsStringAsync();
        var list = JsonSerializer.Deserialize<List<WireResource>>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        list.Select(r => r.Title).Should().Equal("First", "Third");
        list[0].Media!.Id.Should().Be(image.ToString());

        using var document = JsonDocument.Parse(json);
        document.RootElement[0].EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
            ["id", "title", "summary", "bodyHtml", "media"],
            "XC-002: no version, sortOrder, visible, exerciseId or wall clock reaches a participant");
        json.Should().NotContain(exerciseId.ToString());
    }

    [RequiresDockerFact]
    public async Task ParticipantGet_OfAHiddenDeletedOrUnknownId_IsTheSame404()
    {
        await using var host = await StartAsync();
        var (exerciseId, _) = await host.SeedExerciseAsync();
        var visible = await host.AddResourceAsync(exerciseId, "Visible", sortOrder: 1);
        var hidden = await host.AddResourceAsync(exerciseId, "Hidden", sortOrder: 2, visible: false);
        var deleted = await host.AddResourceAsync(exerciseId, "Deleted", sortOrder: 3, deleted: true);
        host.ActAs(exerciseId, staffUserId: null);

        var ok = await host.GetAsync($"{Route}/{visible.Id}");
        ok.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ok.Content.ReadFromJsonAsync<WireResource>())!.Title.Should().Be("Visible");

        var unknown = await host.GetAsync($"{Route}/{Guid.NewGuid()}");
        var unknownBody = await unknown.Content.ReadAsStringAsync();
        unknown.StatusCode.Should().Be(HttpStatusCode.NotFound);
        foreach (var id in new[] { hidden.Id, deleted.Id })
        {
            var response = await host.GetAsync($"{Route}/{id}");
            response.StatusCode.Should().Be(HttpStatusCode.NotFound);
            (await response.Content.ReadAsStringAsync()).Should().Be(unknownBody);
        }
    }

    [RequiresDockerFact]
    public async Task StaffList_IncludesHiddenRows_WithTheStaffFields()
    {
        await using var host = await StartAsync();
        var (exerciseId, _) = await host.SeedExerciseAsync();
        var evaluator = await host.AddStaffAsync(exerciseId, "evaluator");
        var hidden = await host.AddResourceAsync(exerciseId, "Hidden", sortOrder: 1, visible: false);
        host.ActAs(exerciseId, evaluator);

        var list = (await (await host.GetAsync(Route)).Content.ReadFromJsonAsync<List<WireStaffResource>>())!;
        list.Should().ContainSingle().Which.Visible.Should().BeFalse();

        var one = await host.GetAsync($"{Route}/{hidden.Id}");
        one.StatusCode.Should().Be(HttpStatusCode.OK);
        (await one.Content.ReadFromJsonAsync<WireStaffResource>())!.Version.Should().Be(1);
    }

    // ---- AC "Gate" ----------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task APortalChannelDisabled_HidesParticipantReads_ButStaffAuthoringStillWorks()
    {
        await using var host = await StartAsync();
        var (exerciseId, staff) = await host.SeedExerciseAsync(enabledChannels: "social,news");
        var row = await host.AddResourceAsync(exerciseId, "Visible", sortOrder: 1);

        host.ActAs(exerciseId, staffUserId: null);
        (await host.GetAsync(Route)).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await host.GetAsync($"{Route}/{row.Id}")).StatusCode.Should().Be(HttpStatusCode.NotFound);

        host.ActAs(exerciseId, staff);
        (await host.PostAsync(Route, PortalResourceTestHost.Body())).StatusCode.Should().Be(HttpStatusCode.Created);
        var list = await host.GetAsync(Route);
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        (await list.Content.ReadFromJsonAsync<List<WireStaffResource>>())!.Should().HaveCount(2);
    }

    // ---- Roles --------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task AnEvaluatorOrParticipant_CannotWrite()
    {
        await using var host = await StartAsync();
        var (exerciseId, _) = await host.SeedExerciseAsync();
        var evaluator = await host.AddStaffAsync(exerciseId, "evaluator");

        host.ActAs(exerciseId, evaluator);
        (await host.PostAsync(Route, PortalResourceTestHost.Body())).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        host.ActAs(exerciseId, staffUserId: null);
        (await host.PostAsync(Route, PortalResourceTestHost.Body())).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        await using var db = host.Db(exerciseId);
        (await db.PortalResources.CountAsync()).Should().Be(0);
    }

    // ---- AC "Soft delete (XC-010)" ------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Delete_RetainsTheRow_AndRemovesItFromEveryList()
    {
        await using var host = await StartAsync();
        var (exerciseId, staff) = await host.SeedExerciseAsync();
        var row = await host.AddResourceAsync(exerciseId, "Doomed", sortOrder: 1);
        host.ActAs(exerciseId, staff);

        (await host.DeleteAsync(row.Id)).StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await host.DeleteAsync(row.Id)).StatusCode.Should().Be(HttpStatusCode.NotFound, "a deleted id is not found");

        (await (await host.GetAsync(Route)).Content.ReadFromJsonAsync<List<WireStaffResource>>())!.Should().BeEmpty();
        (await host.GetAsync($"{Route}/{row.Id}")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        host.ActAs(exerciseId, staffUserId: null);
        (await (await host.GetAsync(Route)).Content.ReadFromJsonAsync<List<WireResource>>())!.Should().BeEmpty();

        await using var db = host.Db(exerciseId);
        var retained = await db.IncludingSoftDeleted<PortalResource>().AsNoTracking().SingleAsync(r => r.Id == row.Id);
        retained.DeletedAt.Should().NotBeNull("XC-010: the row is retained for the AAR");
        retained.Title.Should().Be("Doomed");
    }

    private Task<PortalResourceTestHost> StartAsync() => PortalResourceTestHost.StartAsync(_fixture.ConnectionString!);
}
