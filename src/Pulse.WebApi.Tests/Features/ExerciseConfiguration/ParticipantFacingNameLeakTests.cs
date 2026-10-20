namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration;

using System;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.LinkCards;
using Pulse.WebApi.Features.Identity.LinkEmail;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Tests.Features.ExerciseResolution;
using Pulse.WebApi.Tests.Features.Identity.LinkCards;
using Pulse.WebApi.Tests.Features.Identity.LinkEmail;

/// <summary>
/// exercise-build-golive/09 (#376, ADMIN-IDENTITY-MODEL §8.4, Tier-2 information leak) — the projection leak test. An
/// exercise's INTERNAL <see cref="Exercise.Name"/> can leak the scenario ("HURREX-26 Cat 4 Landfall Dry Run"), so it is
/// seeded as a unique sentinel and asserted absent from every participant-facing output reachable here: the scope
/// (<c>GET /api/exercise-context</c>), the real Social reads (<c>/api/feed</c>, <c>/api/threads/{id}</c>,
/// <c>/api/personas</c>), the six participant shell-config GETs, the printed card sheet and the personal-link email
/// (subject, HTML and plain text). Each participant-facing name output carries <see cref="Exercise.ParticipantName"/>
/// when set and nothing (no fallback) when unset.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ParticipantFacingNameLeakTests
{
    private const string ParticipantName = "Harbor City Exercise";

    /// <summary>The participant GETs the lifecycle host maps (the shipped routes, not probes).</summary>
    private static readonly string[] ParticipantRoutes =
    [
        "/api/feed",
        "/api/personas",
        "/api/shell-state",
        "/api/chrome-config",
        "/api/brand-tokens",
        "/api/channel-nav-config",
        "/api/alerts",
        "/api/overlay-state",
    ];

    private readonly MsSqlContainerFixture _fixture;

    public ParticipantFacingNameLeakTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private static string NewSentinel() => $"HURREX-INTERNAL-{Guid.NewGuid():N}";

    [RequiresDockerTheory]
    [InlineData(ParticipantName)]
    [InlineData(null)]
    public async Task TheInternalName_AppearsInNoParticipantReadResponse(string? participantName)
    {
        var sentinel = NewSentinel();
        var exerciseId = Guid.NewGuid();
        var hostname = $"leak-{exerciseId:N}.example.com";
        Guid postId;

        await using (var seed = _fixture.CreateContext())
        {
            seed.Exercises.Add(new Exercise
            {
                Id = exerciseId,
                OrganizationId = Organization.DefaultOrganizationId,
                Name = sentinel,
                ParticipantName = participantName,
                Hostname = hostname,
                TimeZone = "America/New_York",
                Status = "live",
            });
            await seed.SaveChangesAsync();
        }

        await using (var scoped = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId }))
        {
            var persona = new Persona
            {
                Id = Guid.NewGuid(),
                ExerciseId = exerciseId,
                DisplayName = "Harbor Weather Desk",
                Handle = $"wx{exerciseId:N}"[..12],
                Kind = "org",
            };
            scoped.Personas.Add(persona);
            var post = ExerciseLifecycleTestData.PostIn(exerciseId, "Storm surge advisory for the harbor.");
            post.AuthorPersonaId = persona.Id;
            postId = post.Id;
            scoped.Posts.Add(post);
            await scoped.SaveChangesAsync();
        }

        // The participant scope, through the real host-resolution pipeline.
        await using (var resolution = await ExerciseResolutionTestHost.StartAsync(_fixture.ConnectionString!))
        {
            using var client = resolution.CreateClientForHost(hostname);
            using var response = await client.GetAsync(new Uri("/api/exercise-context", UriKind.Relative));
            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var body = await response.Content.ReadAsStringAsync();
            body.Should().NotContain(sentinel, "the scope carries the participant-facing name only (§8.4)");

            using var document = JsonDocument.Parse(body);
            var name = document.RootElement.GetProperty("exerciseName");
            if (participantName is null)
            {
                name.ValueKind.Should().Be(JsonValueKind.Null, "no participant name means null, never a fallback");
            }
            else
            {
                name.GetString().Should().Be(participantName);
            }
        }

        // The real participant read surface (feed, thread, personas, shell configs), unauthenticated participant path.
        await using var host = await ExerciseLifecycleTestHost.StartAsync(_fixture.ConnectionString!, exerciseId);
        foreach (var route in ParticipantRoutes.Append($"/api/threads/{postId}"))
        {
            using var response = await host.Client.GetAsync(new Uri(route, UriKind.Relative));
            response.StatusCode.Should().Be(HttpStatusCode.OK, "{0} serves a live exercise, so the body is real", route);
            (await response.Content.ReadAsStringAsync()).Should().NotContain(
                sentinel, "{0} is participant-facing and must never carry the internal exercise name", route);
        }
    }

    [RequiresDockerTheory]
    [InlineData(ParticipantName)]
    [InlineData(null)]
    public async Task ThePrintedCardSheet_CarriesOnlyTheParticipantName(string? participantName)
    {
        var world = new LinkCardTestWorld(_fixture);
        var sentinel = NewSentinel();
        var exercise = await world.SeedExerciseAsync(name: sentinel, participantName: participantName);
        var staff = await world.SeedStaffAsync((exercise, "controller"));
        await world.SeedParticipantAsync(exercise, "Jane Smith", agency: "Fulco County EM");

        var result = await world.GenerateAsync(exercise, staff);

        result.Outcome.Should().Be(LinkCardOutcome.Ok);
        result.Sheet!.Cards.Should().ContainSingle("the sheet is real, so the absence below is meaningful");
        result.Sheet.ExerciseName.Should().Be(participantName, "the card header is the participant-facing name, or null");
        var json = JsonSerializer.Serialize(result.Sheet);
        json.Should().NotContain(sentinel, "a printed card is handed to participants (§8.4)");
        using var document = JsonDocument.Parse(json);
        document.RootElement.TryGetProperty("exerciseName", out var name).Should().BeTrue(
            "the frozen client type is string | null: the key is always present");
        if (participantName is null)
        {
            name.ValueKind.Should().Be(JsonValueKind.Null);
        }
    }

    [RequiresDockerTheory]
    [InlineData(ParticipantName)]
    [InlineData(null)]
    public async Task ThePersonalLinkEmail_CarriesOnlyTheParticipantName(string? participantName)
    {
        var world = new LinkEmailTestWorld(_fixture);
        var sentinel = NewSentinel();
        var exercise = await world.SeedExerciseAsync(name: sentinel, participantName: participantName);
        var staff = await world.SeedStaffAsync((exercise, "controller"));
        await world.SeedParticipantAsync(exercise, "Ann Active");
        var mailer = new FakeParticipantLinkMailer();

        var result = await world.SendAsync(exercise, staff, mailer);

        result.Outcome.Should().Be(LinkEmailOutcome.Ok);
        var message = mailer.Messages.Should().ContainSingle("the email is real, so the absence below is meaningful").Subject;
        message.Subject.Should().Be(
            participantName is null
                ? LinkEmailComposer.SubjectWithoutExerciseName
                : LinkEmailComposer.SubjectPrefix + participantName,
            "the subject names the participant-facing name, or none at all (no fallback)");
        message.Subject.Should().NotContain(sentinel);
        message.HtmlBody.Should().NotContain(sentinel);
        message.PlainTextBody.Should().NotContain(sentinel);
    }

    /// <summary>
    /// A stored participant name that is blank or padded (a legacy row, a direct DB edit) goes through the same
    /// normalization on the card sheet as on the scope: whitespace is null (no fallback to the internal name, no empty
    /// header), and a padded value is trimmed.
    /// </summary>
    [RequiresDockerTheory]
    [InlineData("   ", null)]
    [InlineData("\t \n", null)]
    [InlineData("  " + ParticipantName + "  ", ParticipantName)]
    public async Task ThePrintedCardSheet_NormalizesAWhitespaceParticipantName(string storedName, string? expected)
    {
        var world = new LinkCardTestWorld(_fixture);
        var sentinel = NewSentinel();
        var exercise = await world.SeedExerciseAsync(name: sentinel, participantName: storedName);
        var staff = await world.SeedStaffAsync((exercise, "controller"));
        await world.SeedParticipantAsync(exercise, "Jane Smith", agency: "Fulco County EM");

        var result = await world.GenerateAsync(exercise, staff);

        result.Outcome.Should().Be(LinkCardOutcome.Ok);
        result.Sheet!.Cards.Should().ContainSingle("the sheet is real, so the absence below is meaningful");
        result.Sheet.ExerciseName.Should().Be(expected, "a blank stored name is null and a padded one is trimmed");
        var json = JsonSerializer.Serialize(result.Sheet);
        json.Should().NotContain(sentinel, "a blank participant name never falls back to the internal name (§8.4)");
        using var document = JsonDocument.Parse(json);
        var name = document.RootElement.GetProperty("exerciseName");
        if (expected is null)
        {
            name.ValueKind.Should().Be(JsonValueKind.Null, "a blank name is null on the wire, never an empty header");
        }
        else
        {
            name.GetString().Should().Be(expected);
        }
    }

    /// <summary>
    /// The link-email path normalizes a blank or padded stored participant name (<c>LinkEmailService</c> via
    /// <see cref="Exercise.NormalizeParticipantName"/>): whitespace yields the generic subject (never the internal name
    /// and never a dangling "for " artifact), and a padded value is trimmed into the subject.
    /// </summary>
    [RequiresDockerTheory]
    [InlineData("   ", null)]
    [InlineData("\t \n", null)]
    [InlineData("  " + ParticipantName + "  ", ParticipantName)]
    public async Task ThePersonalLinkEmail_NormalizesAWhitespaceParticipantName(string storedName, string? expected)
    {
        var world = new LinkEmailTestWorld(_fixture);
        var sentinel = NewSentinel();
        var exercise = await world.SeedExerciseAsync(name: sentinel, participantName: storedName);
        var staff = await world.SeedStaffAsync((exercise, "controller"));
        await world.SeedParticipantAsync(exercise, "Ann Active");
        var mailer = new FakeParticipantLinkMailer();

        var result = await world.SendAsync(exercise, staff, mailer);

        result.Outcome.Should().Be(LinkEmailOutcome.Ok);
        var message = mailer.Messages.Should().ContainSingle("the email is real, so the absence below is meaningful").Subject;
        if (expected is null)
        {
            message.Subject.Should().Be(
                LinkEmailComposer.SubjectWithoutExerciseName, "a blank participant name falls back to the generic subject");
            message.Subject.Should().NotStartWith(
                LinkEmailComposer.SubjectPrefix, "a blank name must not leave a dangling \"for \" in the subject");
        }
        else
        {
            message.Subject.Should().Be(LinkEmailComposer.SubjectPrefix + expected, "a padded name is trimmed");
        }

        message.Subject.Should().NotEndWith(" ", "no blank-name artifact trails the subject");
        message.Subject.Should().NotContain(sentinel);
        message.HtmlBody.Should().NotContain(sentinel);
        message.PlainTextBody.Should().NotContain(sentinel);
    }

    /// <summary>
    /// The email-template inventory, enumerated so a NEW participant email (A2's invite and reset, PR #665) cannot land
    /// without being added to the leak cases above: every type in the API assembly with a method that produces a message
    /// carrying a <c>Subject</c> (an email template) is listed here.
    /// </summary>
    [Fact]
    public void EveryEmailTemplate_IsCoveredByThisLeakSuite()
    {
        var templates = typeof(PulseDbContext).Assembly.GetTypes()
            .Where(type => type.GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                .Any(method => method.ReturnType.GetProperty("Subject")?.PropertyType == typeof(string)))
            .ToList();

        templates.Should().BeEquivalentTo(
            [typeof(LinkEmailComposer)],
            "a new email template must take the participant-facing name (never Exercise.Name) and get a leak case here");
    }
}
