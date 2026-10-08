namespace Pulse.WebApi.Tests.Data;

using System;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.Social.Engagement;
using Pulse.WebApi.Features.Social.Threads;

/// <summary>
/// demo-polish B1 AC "Frozen seam skeleton lands, behaviour-free" (<c>implementation.md</c> §1.4). Model-only
/// (no Docker). Proves three things: the five seam interfaces exist in their frozen namespaces; the
/// <c>PostWireDtos.cs</c> records carry the §1.1 wire names and OMIT null optional members; and
/// <see cref="ParticipantPostDto"/> is unsealed with a protected copy constructor while
/// <see cref="ParticipantPostDto.FromPost"/> serializes BYTE-IDENTICALLY to the pre-demo shape.
/// </summary>
/// <remarks>
/// Lives under <c>Data/</c> only because that is the B1 row's test-file ownership in <c>implementation.md</c> §4.1
/// (<c>Data/DemoPolish*Tests.cs</c>); <c>Features/Social/*Tests</c> belong to other stories this push.
/// </remarks>
public class DemoPolishSeamSkeletonTests
{
    private static readonly JsonSerializerOptions WebOptions = new(JsonSerializerDefaults.Web);

    private static readonly JsonSerializerOptions DefaultOptions = new();

    private static Post SamplePost() => new()
    {
        Id = Guid.Parse("6f7c1b8e-2d1a-4c55-9a0e-5b2f6c1d9e01"),
        ExerciseId = Guid.Parse("0c8a2d5e-7b14-4f8b-9d3e-1a2b3c4d5e6f"),
        AuthorPersonaId = Guid.Parse("9b1e4c7a-3f2d-4a8e-b5c6-d7e8f9a0b1c2"),
        Body = "Water's coming over Main St — avoid the underpass. <b>&</b> \"quoted\" +1",
        CreatedScenarioTime = new DateTimeOffset(2033, 9, 4, 13, 7, 30, 123, TimeSpan.FromHours(-5)),
        Origin = "controller-as-persona",
        ActingHumanId = "human-should-never-appear",
        CreatedWallClock = new DateTimeOffset(2026, 10, 8, 1, 2, 3, TimeSpan.Zero),
        InjectId = "INJ-should-never-appear",
        ParentPostId = Guid.Parse("11111111-2222-3333-4444-555555555555"),
        BaselineLikeCount = 1450,
        BaselineRepostCount = 999,
        BaselineReplyCount = 12,
    };

    [Theory]
    [InlineData(typeof(IMediaStore), "Pulse.WebApi.Features.Media")]
    [InlineData(typeof(IMediaUrlSigner), "Pulse.WebApi.Features.Media")]
    [InlineData(typeof(IPostEngagementReader), "Pulse.WebApi.Features.Social.Engagement")]
    [InlineData(typeof(IParticipantPostProjector), "Pulse.WebApi.Features.Social")]
    [InlineData(typeof(IReplyParentResolver), "Pulse.WebApi.Features.Social.Threads")]
    public void FrozenSeam_IsAnInterface_InItsFrozenNamespace(Type seam, string frozenNamespace)
    {
        seam.IsInterface.Should().BeTrue("{0} is an interface-only seam (§1.4)", seam.Name);
        seam.Namespace.Should().Be(frozenNamespace, "the 1b builders compile against {0} at this path", seam.Name);
    }

    [Fact]
    public void FromPost_SerializesByteIdenticallyToThePreDemoShape()
    {
        var post = SamplePost();

        // The golden replica is the pre-B1 class, member-for-member and in declaration order, populated exactly
        // as the pre-B1 FromPost populated it. Any byte of difference — a new key, a null emitted, a reordering —
        // would break the frozen client's isPost guard contract and fails here.
        var golden = new PreDemoParticipantPostDto
        {
            Id = post.Id.ToString(),
            AuthorPersonaId = post.AuthorPersonaId.ToString(),
            Text = post.Body,
            ScenarioTime = post.CreatedScenarioTime.ToString("O"),
            Counts = new ParticipantPostCounts(0, 0, 0),
        };

        var dto = ParticipantPostDto.FromPost(post);

        JsonSerializer.Serialize(dto, WebOptions).Should().Be(
            JsonSerializer.Serialize(golden, WebOptions),
            "FromPost's behaviour is UNCHANGED in B1 — media/inReplyTo/viewer stay null and are omitted");
        JsonSerializer.Serialize(dto, DefaultOptions).Should().Be(
            JsonSerializer.Serialize(golden, DefaultOptions),
            "byte-identical under default serializer options too (the shape is independent of host config)");

        dto.Media.Should().BeNull("B1 implements no FromPost media behaviour");
        dto.InReplyTo.Should().BeNull("B1 implements no FromPost reply behaviour, even for a post with a parent");
        dto.Viewer.Should().BeNull("B1 implements no viewer behaviour");
    }

    [Fact]
    public void FromPost_StillCarriesNoProvenanceAndNoBaselines()
    {
        var json = JsonSerializer.Serialize(ParticipantPostDto.FromPost(SamplePost()), WebOptions);
        using var document = JsonDocument.Parse(json);

        document.RootElement.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
            ["id", "authorPersonaId", "text", "counts", "scenarioTime"],
            "the participant shape structurally omits provenance and the staff-only baselines (XC-002)");
        json.Should().NotContain("should-never-appear");
        document.RootElement.GetProperty("counts").GetProperty("like").GetInt32().Should().Be(
            0, "FromPost seeds counts to zero; baseline + real counts are the projector's job, not B1's");
    }

    [Fact]
    public void ParticipantPostDto_IsUnsealed_WithAProtectedCopyConstructorThatCopiesEveryMember()
    {
        typeof(ParticipantPostDto).IsSealed.Should().BeFalse("the thread read derives its reply shape from it");

        var copyConstructor = typeof(ParticipantPostDto).GetConstructor(
            BindingFlags.Instance | BindingFlags.NonPublic, [typeof(ParticipantPostDto)]);
        copyConstructor.Should().NotBeNull("§1.4 freezes a protected copy constructor");
        copyConstructor!.IsFamily.Should().BeTrue("the copy constructor is protected — derived shapes only");

        var source = new ParticipantPostDto
        {
            Id = "post-1",
            AuthorPersonaId = "persona-1",
            Text = "hello",
            Counts = new ParticipantPostCounts(1, 2, 3),
            ScenarioTime = "2033-09-04T13:00:00.0000000+00:00",
            Media = [new PostMediaDto("m1", MediaKinds.Image, "https://example.test/m1", "alt")],
            InReplyTo = new PostInReplyToDto("post-0", "FulcoEM"),
            Viewer = new PostViewerStateDto(true, false),
        };

        var derived = new DerivedReplyDto(source, "persona-0");

        derived.Should().BeEquivalentTo(source, options => options.ExcludingMissingMembers(),
            "the copy constructor copies every base member, so a derived shape never re-derives the safe base");
        derived.ReplyToPersonaId.Should().Be("persona-0");
    }

    [Fact]
    public void ParticipantPostDto_OptionalMembers_AreOmittedWhenNull_AndNamedPerContractWhenSet()
    {
        var bare = new ParticipantPostDto
        {
            Id = "p",
            AuthorPersonaId = "a",
            Text = "t",
            Counts = new ParticipantPostCounts(0, 0, 0),
            ScenarioTime = "s",
        };
        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(bare, WebOptions)))
        {
            document.RootElement.TryGetProperty("media", out _).Should().BeFalse("null optional members are omitted");
            document.RootElement.TryGetProperty("inReplyTo", out _).Should().BeFalse();
            document.RootElement.TryGetProperty("viewer", out _).Should().BeFalse();
        }

        var full = new ParticipantPostDto
        {
            Id = "p",
            AuthorPersonaId = "a",
            Text = "t",
            Counts = new ParticipantPostCounts(0, 0, 0),
            ScenarioTime = "s",
            Media = [new PostMediaDto("m1", MediaKinds.Video, "https://example.test/v", "alt", PosterUrl: "https://example.test/p")],
            InReplyTo = new PostInReplyToDto("parent", "FulcoEM"),
            Viewer = new PostViewerStateDto(Liked: true, Reposted: false),
        };
        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(full, DefaultOptions)))
        {
            var root = document.RootElement;
            root.GetProperty("media")[0].GetProperty("posterUrl").GetString().Should().Be("https://example.test/p");
            root.GetProperty("inReplyTo").GetProperty("postId").GetString().Should().Be("parent");
            root.GetProperty("inReplyTo").GetProperty("authorHandle").GetString().Should().Be("FulcoEM");
            root.GetProperty("viewer").GetProperty("liked").GetBoolean().Should().BeTrue();
            root.GetProperty("viewer").GetProperty("reposted").GetBoolean().Should().BeFalse();
        }
    }

    [Fact]
    public void PostMediaDto_OmitsNullOptionalMembers_AndUsesTheContractNames()
    {
        var minimal = JsonSerializer.Serialize(new PostMediaDto("id-1", "image", "https://u", "a photo"), DefaultOptions);
        using (var document = JsonDocument.Parse(minimal))
        {
            document.RootElement.EnumerateObject().Select(p => p.Name).Should().Equal(
                ["id", "kind", "url", "alt"], "null posterUrl/width/height/durationSec are omitted, never null");
        }

        var full = JsonSerializer.Serialize(
            new PostMediaDto("id-1", "video", "https://u", "a clip", "https://p", 1280, 720, 12.5), DefaultOptions);
        using (var document = JsonDocument.Parse(full))
        {
            document.RootElement.EnumerateObject().Select(p => p.Name).Should().Equal(
                ["id", "kind", "url", "alt", "posterUrl", "width", "height", "durationSec"]);
        }
    }

    [Fact]
    public void RequestRecords_BindTheContractNames_FromCamelCaseJson()
    {
        var media = JsonSerializer.Deserialize<CreatePostMediaRequest>(
            """{"mediaId":"m1","alt":"a photo","posterMediaId":"p1"}""", DefaultOptions);
        media.Should().Be(new CreatePostMediaRequest("m1", "a photo", "p1"));

        var missing = JsonSerializer.Deserialize<CreatePostMediaRequest>("{}", DefaultOptions);
        missing.Should().Be(
            new CreatePostMediaRequest(null, null, null),
            "nullable scalars: a missing field is a validation concern, never a deserialization failure");

        var baseline = JsonSerializer.Deserialize<EngagementBaselineRequest>(
            """{"like":1450,"repost":12,"reply":3}""", DefaultOptions);
        baseline.Should().Be(new EngagementBaselineRequest(1450, 12, 3));
    }

    [Fact]
    public void SeamRecords_HaveTheFrozenShapes()
    {
        new PostProjectionOptions().Should().Be(
            new PostProjectionOptions(ViewerPersonaId: null, IncludeViewerState: false),
            "the projector's options default to no viewer state");
        new PostEngagement(1, 2, 3, ViewerLiked: true, ViewerReposted: false).RealReply.Should().Be(3);
        Enum.GetNames<ReplyParentOutcome>().Should().Equal(["None", "Resolved", "NotFound"]);
        new ReplyParentResult(ReplyParentOutcome.None, null).Parent.Should().BeNull();
    }

    /// <summary>The pre-demo-polish <c>ParticipantPostDto</c>, verbatim — the golden replica for the byte test.</summary>
    private sealed class PreDemoParticipantPostDto
    {
        [JsonPropertyName("id")]
        public required string Id { get; init; }

        [JsonPropertyName("authorPersonaId")]
        public required string AuthorPersonaId { get; init; }

        [JsonPropertyName("text")]
        public required string Text { get; init; }

        [JsonPropertyName("counts")]
        public required ParticipantPostCounts Counts { get; init; }

        [JsonPropertyName("scenarioTime")]
        public required string ScenarioTime { get; init; }
    }

    /// <summary>A stand-in for the thread read's derived reply shape, proving the copy constructor is usable.</summary>
    private sealed class DerivedReplyDto : ParticipantPostDto
    {
        [System.Diagnostics.CodeAnalysis.SetsRequiredMembers]
        public DerivedReplyDto(ParticipantPostDto source, string replyToPersonaId)
            : base(source)
        {
            ReplyToPersonaId = replyToPersonaId;
        }

        public string ReplyToPersonaId { get; }
    }
}
