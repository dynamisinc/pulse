namespace Pulse.WebApi.Tests.Features.Press;

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using FluentAssertions;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Press.Contracts;

/// <summary>
/// Press story 01 (#738): the C# half of the C#↔TS wire-contract parity check. The golden file
/// <c>src/frontend/src/features/press/contract/pressWireContract.json</c> is read by BOTH suites (this one and
/// <c>pressWireContract.test.ts</c>), so the C# records, <see cref="PressVocabulary"/>, <see cref="PressTelemetry"/> and
/// the TS types can only agree through it. Key sets are read off a REAL serialization of a fully-populated instance AND
/// of an all-nullables-null instance. Plain facts, no database.
/// </summary>
public sealed partial class PressContractParityTests
{
    private static readonly Lazy<JsonObject> Golden = new(() =>
        (JsonNode.Parse(File.ReadAllText(Path.Combine(
            FindRepositoryRoot(), "src", "frontend", "src", "features", "press", "contract", "pressWireContract.json")))
            ?? throw new InvalidOperationException("pressWireContract.json is empty.")).AsObject());

    private static readonly IReadOnlyDictionary<string, object> Samples = BuildSamples();

    private static readonly IReadOnlyDictionary<string, object> NullSamples = BuildNullSamples();

    public static TheoryData<string> ShapeNames()
    {
        var data = new TheoryData<string>();
        foreach (var name in Samples.Keys)
        {
            data.Add(name);
        }

        return data;
    }

    public static TheoryData<string> ParticipantShapeNames()
    {
        var data = new TheoryData<string>();
        foreach (var name in GoldenStrings(Golden.Value["participantShapes"]))
        {
            data.Add(name);
        }

        return data;
    }

    [Fact]
    public void Samples_CoverExactlyTheGoldenShapes()
    {
        Samples.Keys.Should().BeEquivalentTo(Golden.Value["shapes"]!.AsObject().Select(p => p.Key));
    }

    [Theory]
    [MemberData(nameof(ShapeNames))]
    public void SerializedKeys_EqualTheGoldenKeySet(string shape)
    {
        var expected = GoldenStrings(Golden.Value["shapes"]![shape]);

        SerializedKeys(Samples[shape]).Should().Equal(expected, $"{shape} must serialize to exactly the frozen camelCase keys");
        if (NullSamples.TryGetValue(shape, out var nulls))
        {
            SerializedKeys(nulls).Should().Equal(expected, $"{shape} must write every nullable key as null");
        }
    }

    [Fact]
    public void Samples_PopulateEveryNullableMember_AndNullSamplesNullThemAll()
    {
        foreach (var (shape, sample) in Samples)
        {
            var nullables = NullableProperties(sample.GetType());
            foreach (var property in nullables)
            {
                property.GetValue(sample).Should().NotBeNull($"the full {shape} sample populates {property.Name}");
            }

            if (nullables.Count > 0)
            {
                NullSamples.Should().ContainKey(shape, $"{shape} has nullable members");
            }
        }

        foreach (var (shape, sample) in NullSamples)
        {
            foreach (var property in NullableProperties(sample.GetType()))
            {
                property.GetValue(sample).Should().BeNull($"{shape}.{property.Name} is nullable");
            }
        }
    }

    [Theory]
    [MemberData(nameof(ParticipantShapeNames))]
    public void ParticipantShape_GraphHoldsNoForbiddenMember(string shape)
    {
        ForbiddenMembers(Samples[shape].GetType()).Should().BeEmpty($"{shape} is a participant shape (XC-002)");
    }

    [Fact]
    public void ForbiddenMemberCheck_CatchesTheAuthorShapes()
    {
        // The check can fail: the author payload carries exactly the staff/author-only keys the participant one drops.
        ForbiddenMembers(typeof(ReleaseAuthorPayloadDto)).Should().Contain(
            ["ReleaseAuthorPayloadDto.OrgPersonaId", "ReleaseAuthorPayloadDto.InputPath", "ReleaseAuthorPayloadDto.Boilerplate",
                "ReleaseAuthorPayloadDto.CrossPost"]);
        ForbiddenMembers(typeof(ReleaseAuthorDto)).Should().Contain("ReleaseAuthorDto.Version");
    }

    [Theory]
    [MemberData(nameof(ParticipantShapeNames))]
    public void ParticipantShape_IsSealedAndDerivesFromNothing(string shape)
    {
        var type = Samples[shape].GetType();

        type.IsSealed.Should().BeTrue();
        type.BaseType.Should().Be(typeof(object));
    }

    [Fact]
    public void Vocabulary_EqualsTheGoldenListsInOrder()
    {
        var vocabulary = Golden.Value["vocabulary"]!;

        PressVocabulary.ReleaseStates.Should().Equal(GoldenStrings(vocabulary["releaseStates"]));
        PressVocabulary.InputPaths.Should().Equal(GoldenStrings(vocabulary["inputPaths"]));
        PressVocabulary.LetterheadExtKeys.Should().Equal(GoldenStrings(vocabulary["letterheadExtKeys"]));
        PressVocabulary.WireRoomSlug.Should().Be(Golden.Value["wireRoomSlug"]!.GetValue<string>());
        PressVocabulary.ParticipantPayloadKeys.Should().Equal(GoldenStrings(Golden.Value["participantPayloadKeys"]));
        PressVocabulary.StaffOnlyPayloadKeys.Should().Equal(GoldenStrings(Golden.Value["staffOnlyPayloadKeys"]));
        PressVocabulary.ParticipantPayloadKeys.Should().Equal(GoldenStrings(Golden.Value["shapes"]!["ReleaseParticipantPayloadDto"]));
    }

    [Fact]
    public void Limits_EqualTheGoldenLimits()
    {
        var limits = Golden.Value["limits"]!;
        var actual = new Dictionary<string, int>
        {
            ["contactNameMaxLength"] = PressVocabulary.ContactNameMaxLength,
            ["contactTitleMaxLength"] = PressVocabulary.ContactTitleMaxLength,
            ["contactPhoneMaxLength"] = PressVocabulary.ContactPhoneMaxLength,
            ["contactEmailMaxLength"] = PressVocabulary.ContactEmailMaxLength,
            ["datelineMaxLength"] = PressVocabulary.DatelineMaxLength,
            ["boilerplateMaxLength"] = PressVocabulary.BoilerplateMaxLength,
            ["crossPostTextMaxLength"] = PressVocabulary.CrossPostTextMaxLength,
            ["dekMaxLength"] = PressVocabulary.DekMaxLength,
            ["letterheadAddressMaxLength"] = PressVocabulary.LetterheadAddressMaxLength,
        };

        actual.Should().BeEquivalentTo(limits.AsObject().ToDictionary(p => p.Key, p => p.Value!.GetValue<int>()));
    }

    [Fact]
    public void Telemetry_DeclaresExactlyTheGoldenShapesInOrder()
    {
        var golden = Golden.Value["telemetry"]!.AsArray().Select(n => new
        {
            EventType = n!["eventType"]!.GetValue<string>(),
            Emitter = n["emitter"]!.GetValue<string>(),
            PayloadKeys = GoldenStrings(n["payloadKeys"]),
        }).ToList();

        PressTelemetry.All.Select(s => new { s.EventType, s.Emitter, PayloadKeys = s.PayloadKeys.ToArray() })
            .Should().BeEquivalentTo(golden, o => o.WithStrictOrdering());
    }

    [Theory]
    [InlineData(typeof(IReleaseOrgResolver))]
    [InlineData(typeof(IReleaseApprovalGate))]
    [InlineData(typeof(IReleaseReactionHook))]
    [InlineData(typeof(IOrgNewsroomProvisioner))]
    public void Seams_NeverTakeAnExerciseId(Type seam)
    {
        // XC-001: the scope is the ambient, server-resolved one; no seam can name another exercise.
        seam.IsInterface.Should().BeTrue();
        seam.GetMethods().SelectMany(m => m.GetParameters())
            .Should().NotContain(p => p.Name!.Contains("exercise", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void TheWriteRequest_CarriesNoExerciseOriginOrActingHuman()
    {
        typeof(ReleaseWriteRequest).GetProperties().Select(p => p.Name)
            .Should().NotContain(n => n.Contains("Exercise", StringComparison.Ordinal)
                || n.Contains("Origin", StringComparison.Ordinal) || n.Contains("Human", StringComparison.Ordinal));
    }

    private static List<PropertyInfo> NullableProperties(Type type)
    {
        var context = new NullabilityInfoContext();
        return type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Where(p => Nullable.GetUnderlyingType(p.PropertyType) is not null
                || context.Create(p).ReadState == NullabilityState.Nullable)
            .ToList();
    }

    private static List<string> ForbiddenMembers(Type root)
    {
        var patterns = GoldenStrings(Golden.Value["participantForbiddenKeyPatterns"]);
        var allowed = GoldenStrings(Golden.Value["participantAllowedWords"]);
        bool IsForbidden(string name)
        {
            var normalized = Separators().Replace(name.ToLowerInvariant(), string.Empty);
            foreach (var word in allowed)
            {
                normalized = normalized.Replace(word, "|", StringComparison.Ordinal);
            }

            return patterns.Any(p => normalized.Contains(p, StringComparison.Ordinal));
        }

        var hits = new List<string>();
        var seen = new HashSet<Type>();
        var queue = new Queue<Type>([root]);
        while (queue.Count > 0)
        {
            var type = queue.Dequeue();
            if (!seen.Add(type))
            {
                continue;
            }

            foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                var wireName = property.GetCustomAttribute<JsonPropertyNameAttribute>()?.Name ?? property.Name;
                if (IsForbidden(property.Name) || IsForbidden(wireName))
                {
                    hits.Add($"{type.Name}.{property.Name}");
                }

                var nested = Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType;
                if (nested.IsGenericType)
                {
                    nested = nested.GetGenericArguments()[0];
                }

                if (nested.Namespace?.StartsWith("Pulse.", StringComparison.Ordinal) == true)
                {
                    queue.Enqueue(nested);
                }
            }
        }

        return hits;
    }

    [GeneratedRegex(@"[_\-\s]", RegexOptions.CultureInvariant)]
    private static partial Regex Separators();

    private static string[] GoldenStrings(JsonNode? node) => node!.AsArray().Select(n => n!.GetValue<string>()).ToArray();

    private static List<string> SerializedKeys(object value)
    {
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(value, value.GetType()));
        return document.RootElement.EnumerateObject().Select(p => p.Name).ToList();
    }

    private static Dictionary<string, object> BuildSamples()
    {
        var media = new ContentMediaDto
        {
            Id = "m-1", Kind = "image", Role = "hero", Url = "/media/m-1", ContentType = "image/png", Alt = "Fulton County EM logo",
        };
        var contact = new ReleaseContactDto { Name = "Jordan Alvarez", Title = "PIO", Phone = "404-555-0142", Email = "pio@x.example" };
        var document = new ReleaseDocumentDto { MediaId = "m-2", FileName = "shelters.pdf", SizeBytes = 91_000 };
        var org = new ReleaseOrgRefDto { Name = "Fulton County EM", OutletId = "o-1" };
        var crossPost = new ReleaseCrossPostDto { Text = "Shelters are open." };
        var authorPayload = new ReleaseAuthorPayloadDto
        {
            OrgPersonaId = "p-1", InputPath = "both", Contact = contact, Dateline = "ATLANTA —", Document = document,
            Boilerplate = "About Fulton County EM.", CrossPost = crossPost,
        };
        var letterhead = new ReleaseLetterheadDto { Logo = media, Address = "141 Pryor St SW", DefaultContact = contact };
        var editedBy = new ReleaseLastEditedByDto { DisplayName = "J. Alvarez" };
        var returnNote = new ReleaseReturnNoteDto { Text = "Fix the shelter list.", ByDisplayName = "K. Lee", ScenarioTime = "2033-09-04T09:30:00-04:00" };

        return new Dictionary<string, object>(StringComparer.Ordinal)
        {
            ["ReleaseContactDto"] = contact,
            ["ReleaseDocumentDto"] = document,
            ["ReleaseOrgRefDto"] = org,
            ["ReleaseParticipantPayloadDto"] = new ReleaseParticipantPayloadDto
            {
                Org = org, Contact = contact, Dateline = "ATLANTA —", Document = document,
            },
            ["ReleaseCrossPostDto"] = crossPost,
            ["ReleaseAuthorPayloadDto"] = authorPayload,
            ["ReleaseOrgDto"] = new ReleaseOrgDto
            {
                PersonaId = "p-1", OutletId = "o-1", Name = "Fulton County EM", Handle = "@FultonEM", PairedHandle = "@FultonEM",
                Letterhead = letterhead, ApprovalRequired = false,
            },
            ["ReleaseLetterheadDto"] = letterhead,
            ["ReleaseLastEditedByDto"] = editedBy,
            ["ReleaseReturnNoteDto"] = returnNote,
            ["ReleaseAuthorDto"] = new ReleaseAuthorDto
            {
                Id = "c-1", OrgPersonaId = "p-1", State = "returned", Headline = "Shelters open", BodyHtml = "<p>b</p>",
                Payload = authorPayload, Media = [media], ScheduledScenarioTime = "2033-09-04T11:00:00-04:00",
                UpdatedScenarioTime = "2033-09-04T09:00:00-04:00", LastEditedBy = editedBy, ReturnNote = returnNote,
                Permalink = "/press/fultonem/shelters-open", Version = 4,
                Revisions = [new ContentRevisionDto { Number = 2, Kind = "update", ScenarioTime = "2033-09-04T10:00:00-04:00" }],
            },
            ["ReleaseWriteRequest"] = new ReleaseWriteRequest
            {
                OrgPersonaId = "p-1", Headline = "Shelters open", BodyHtml = "<p>b</p>", Contact = contact, Dateline = "ATLANTA —",
                DocumentMediaId = "m-2", ImageMediaIds = ["m-1"], Version = 3,
            },
        };
    }

    private static Dictionary<string, object> BuildNullSamples()
    {
        var org = new ReleaseOrgRefDto { Name = "Fulton County EM", OutletId = null };
        var authorPayload = new ReleaseAuthorPayloadDto { OrgPersonaId = "p-1", InputPath = "rich" };
        var letterhead = new ReleaseLetterheadDto();

        return new Dictionary<string, object>(StringComparer.Ordinal)
        {
            ["ReleaseContactDto"] = new ReleaseContactDto { Name = "Jordan Alvarez" },
            ["ReleaseOrgRefDto"] = org,
            ["ReleaseParticipantPayloadDto"] = new ReleaseParticipantPayloadDto { Org = org },
            ["ReleaseCrossPostDto"] = new ReleaseCrossPostDto(),
            ["ReleaseAuthorPayloadDto"] = authorPayload,
            ["ReleaseOrgDto"] = new ReleaseOrgDto
            {
                PersonaId = "p-1", OutletId = "o-1", Name = "Fulton County EM", Handle = "@FultonEM", Letterhead = letterhead,
                ApprovalRequired = false,
            },
            ["ReleaseLetterheadDto"] = letterhead,
            ["ReleaseAuthorDto"] = new ReleaseAuthorDto
            {
                Id = "c-1", OrgPersonaId = "p-1", State = "draft", Headline = "Shelters open", BodyHtml = string.Empty,
                Payload = authorPayload, Version = 1,
            },
            ["ReleaseWriteRequest"] = new ReleaseWriteRequest(),
        };
    }

    private static string FindRepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "pulse.slnx")))
        {
            directory = directory.Parent;
        }

        return directory?.FullName ?? throw new InvalidOperationException("Could not locate pulse.slnx above the test binary.");
    }
}
