namespace Pulse.WebApi.Tests.Features.Portal;

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
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Portal.Contracts;

/// <summary>
/// Exercise-portal story 02 (#768): the C# half of the C#↔TS wire-contract parity check. The golden file
/// <c>src/frontend/src/features/portal/contract/portalWireContract.json</c> is read by BOTH suites (this one and
/// <c>portalWireContract.test.ts</c>), so the C# records, <see cref="PortalVocabulary"/>, <see cref="PortalTelemetry"/>
/// and the TS types can only agree through it. Key sets are read off a REAL serialization of a fully-populated
/// instance, so a <c>[JsonPropertyName]</c> typo or a dropped member fails here. Plain facts, no database.
/// </summary>
public class PortalContractParityTests
{
    private static readonly Lazy<JsonObject> Golden = new(() =>
        (JsonNode.Parse(File.ReadAllText(Path.Combine(
            FindRepositoryRoot(), "src", "frontend", "src", "features", "portal", "contract", "portalWireContract.json")))
            ?? throw new InvalidOperationException("portalWireContract.json is empty.")).AsObject());

    private static readonly IReadOnlyDictionary<string, object> Samples = BuildSamples();

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
        SerializedKeys(Samples[shape]).Should().BeEquivalentTo(
            GoldenStrings(Golden.Value["shapes"]![shape]), $"{shape} must serialize to exactly the frozen PC-3 camelCase keys");
    }

    [Fact]
    public void SerializedKeys_SurviveTheHostsRealRestAndHubOptions()
    {
        // Every nullable key must be WRITTEN as null: the TS guards treat an absent key as out of shape.
        using var factory = new HostOptionsProbeFactory();
        var rest = factory.Services.GetRequiredService<IOptions<Microsoft.AspNetCore.Http.Json.JsonOptions>>()
            .Value.SerializerOptions;
        var hub = factory.Services.GetRequiredService<IOptions<JsonHubProtocolOptions>>().Value.PayloadSerializerOptions;

        foreach (var (shape, sample) in Samples)
        {
            var expected = GoldenStrings(Golden.Value["shapes"]![shape]);

            SerializedKeys(sample, rest).Should().BeEquivalentTo(expected, $"{shape} over REST");
            SerializedKeys(sample, hub).Should().BeEquivalentTo(expected, $"{shape} over the SignalR hub protocol");
        }
    }

    [Theory]
    [MemberData(nameof(ParticipantShapeNames))]
    public void ParticipantShape_GraphHoldsNoForbiddenMember(string shape)
    {
        // XC-002, by construction: walk the participant record and every type it embeds (ContentMediaDto included),
        // checking both the CLR name and the wire name of every property.
        ForbiddenMembers(Samples[shape].GetType()).Should().BeEmpty($"{shape} is a participant DTO (XC-002)");
    }

    [Fact]
    public void ForbiddenMemberCheck_CatchesAStaffShape()
    {
        // The check can fail: the staff config carries `version`, and a type naming any forbidden pattern trips it.
        ForbiddenMembers(typeof(PortalConfigStaffDto)).Should().Contain("PortalConfigStaffDto.Version");
        ForbiddenMembers(typeof(LeakyProbe)).Should().HaveCount(6);
    }

    [Theory]
    [MemberData(nameof(ParticipantShapeNames))]
    public void ParticipantShape_IsSealedAndDerivesFromNothing(string shape)
    {
        // A derived instance would serialize its runtime type's extra members on the SignalR protocol.
        var type = Samples[shape].GetType();

        type.IsSealed.Should().BeTrue();
        type.BaseType.Should().Be(typeof(object));
    }

    [Theory]
    [MemberData(nameof(ParticipantShapeNames))]
    public void ParticipantShape_SerializesNoAbsoluteUrlOrHostname(string shape)
    {
        // FC-9.3 tripwire over the populated samples (no exemption in December: DisplayStaffDto.link is Deferred).
        var json = JsonSerializer.Serialize(Samples[shape], Samples[shape].GetType());

        json.Should().NotMatchRegex(AbsoluteUrl.ToString());
    }

    [Fact]
    public void AbsoluteUrlTripwire_CatchesAbsoluteUrls()
    {
        foreach (var bad in new[] { "https://pulse.example.com/x", "\"//cdn.test/a.png\"", "www.fairhaven.gov", "evil.com/x" })
        {
            AbsoluteUrl.IsMatch(bad).Should().BeTrue(bad);
        }

        AbsoluteUrl.IsMatch("\"/weather/weather-desk/tornado-warning-1\"").Should().BeFalse();
    }

    public static TheoryData<string, string[]> VocabularyLists() => new()
    {
        { "moduleIds", PortalVocabulary.ModuleIds.ToArray() },
        { "defaultModuleOrder", PortalVocabulary.DefaultModuleOrder.ToArray() },
        { "layoutKeys", PortalVocabulary.LayoutKeys.ToArray() },
    };

    [Theory]
    [MemberData(nameof(VocabularyLists))]
    public void Vocabulary_EqualsTheGoldenListInOrder(string name, string[] values)
    {
        values.Should().Equal(GoldenStrings(Golden.Value["vocabulary"]![name]));
    }

    [Fact]
    public void ModuleChannels_MapEachModuleToExactlyOneChannel()
    {
        var golden = Golden.Value["moduleChannels"]!.AsObject().ToDictionary(p => p.Key, p => p.Value!.GetValue<string>());

        PortalVocabulary.ModuleChannelIds.Should().BeEquivalentTo(golden);
        PortalVocabulary.ModuleChannelIds.Keys.Should().BeEquivalentTo(PortalVocabulary.ModuleIds);
        PortalVocabulary.ModuleChannelIds.Values.Should().OnlyContain(c => ChannelVocabulary.IsChannelId(c) && c != ChannelVocabulary.Portal);
        PortalVocabulary.DefaultModuleOrder.Should().BeEquivalentTo(PortalVocabulary.ModuleIds);
        PortalVocabulary.DefaultLayoutKey.Should().Be(Golden.Value["defaultLayoutKey"]!.GetValue<string>());
    }

    [Fact]
    public void Limits_EqualTheGoldenLimits()
    {
        var limits = Golden.Value["limits"]!;

        PortalVocabulary.MaxResources.Should().Be(limits["maxResources"]!.GetValue<int>());
        PortalVocabulary.MastheadNameMaxLength.Should().Be(limits["mastheadNameMaxLength"]!.GetValue<int>());
        PortalVocabulary.ModulesJsonMaxBytes.Should().Be(limits["modulesJsonMaxBytes"]!.GetValue<int>());
        PortalVocabulary.SkinOverridesJsonMaxBytes.Should().Be(limits["skinOverridesJsonMaxBytes"]!.GetValue<int>());
        PortalVocabulary.ResourceTitleMaxLength.Should().Be(limits["resourceTitleMaxLength"]!.GetValue<int>());
        PortalVocabulary.ResourceSummaryMaxLength.Should().Be(limits["resourceSummaryMaxLength"]!.GetValue<int>());
        limits.AsObject().Count.Should().Be(6, "every golden limit is asserted above");
    }

    [Theory]
    [InlineData("topStories", true)]
    [InlineData("TopStories", false)]
    [InlineData("radio", false)]
    [InlineData(null, false)]
    public void IsModuleId_IsOrdinalAndClosed(string? value, bool expected)
    {
        PortalVocabulary.IsModuleId(value).Should().Be(expected);
    }

    [Theory]
    [InlineData("anchor", true)]
    [InlineData("band", false)]
    [InlineData("grid", false)]
    [InlineData(null, false)]
    public void IsLayoutKey_AllowsOnlyTheDecemberLayout(string? value, bool expected)
    {
        PortalVocabulary.IsLayoutKey(value).Should().Be(expected);
    }

    [Fact]
    public void Telemetry_DeclaresExactlyTheGoldenShapesInOrder()
    {
        var golden = Golden.Value["telemetry"]!.AsArray().Select(n => new
        {
            EventType = n!["eventType"]!.GetValue<string>(),
            Emitter = n["emitter"]!.GetValue<string>(),
            EntityType = n["entityType"]!.GetValue<string>(),
            HasEntityId = n["hasEntityId"]!.GetValue<bool>(),
            PayloadKeys = GoldenStrings(n["payloadKeys"]),
            Deferred = n["deferred"]!.GetValue<bool>(),
        }).ToList();

        PortalTelemetry.All.Select(s => new
        {
            s.EventType, s.Emitter, s.EntityType, s.HasEntityId, PayloadKeys = s.PayloadKeys.ToArray(), s.Deferred,
        }).Should().BeEquivalentTo(golden, o => o.WithStrictOrdering());
    }

    [Fact]
    public void Telemetry_EveryPc6EventIsRegisteredByF02()
    {
        // FU-2 resolved: F02 registers the strings once (FC-6b); this story edits neither list.
        PortalTelemetry.All.Select(s => s.EventType).Should().OnlyHaveUniqueItems()
            .And.BeSubsetOf(ChannelTelemetryEventTypes.All);
    }

    [Theory]
    [InlineData(typeof(IPortalConfigService))]
    [InlineData(typeof(IPortalResourceService))]
    public void ServiceSeams_NeverTakeAnExerciseId(Type seam)
    {
        // XC-001: the scope is the ambient, server-resolved one; no seam can name another exercise.
        seam.IsInterface.Should().BeTrue();
        seam.GetMethods().Should().NotBeEmpty();
        seam.GetMethods().SelectMany(m => m.GetParameters())
            .Should().NotContain(p => p.Name!.Contains("exercise", StringComparison.OrdinalIgnoreCase));
        seam.GetMethods().Should().OnlyContain(m => typeof(System.Threading.Tasks.Task).IsAssignableFrom(m.ReturnType));
    }

    [Theory]
    [InlineData(typeof(PortalConfigWriteRequest))]
    [InlineData(typeof(PortalResourceWriteRequest))]
    [InlineData(typeof(PortalResourceReorderRequest))]
    public void WriteRequests_CarryNoExerciseId(Type request)
    {
        request.GetProperties().Should().NotContain(p => p.Name.Contains("Exercise", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void ServiceSeams_ReturnTheParticipantProjectionsOnTheirParticipantReads()
    {
        typeof(IPortalConfigService).GetMethod(nameof(IPortalConfigService.GetParticipantPortalAsync))!.ReturnType
            .Should().Be(typeof(System.Threading.Tasks.Task<PortalDto>));
        typeof(IPortalResourceService).GetMethod(nameof(IPortalResourceService.ListVisibleAsync))!.ReturnType
            .Should().Be(typeof(System.Threading.Tasks.Task<IReadOnlyList<PortalResourceDto>>));
        typeof(IPortalResourceService).GetMethod(nameof(IPortalResourceService.GetVisibleAsync))!.ReturnType
            .Should().Be(typeof(System.Threading.Tasks.Task<PortalResourceDto?>));
    }

    [Fact]
    public void DisplayContracts_AreDeferred()
    {
        // Q-35 (Tom, 10/29): no display DTO, vocabulary or service ships in December.
        typeof(PortalDto).Assembly.GetTypes()
            .Where(t => t.Namespace == typeof(PortalDto).Namespace)
            .Select(t => t.Name)
            .Should().NotContain(n => n.Contains("Display", StringComparison.Ordinal));
    }

    private static readonly Regex AbsoluteUrl = new(
        @"[a-z][a-z0-9+.-]*://|(^|[\s""'(=])//[^/]|\bwww\.|\b[a-z0-9-]+\.(com|net|org|gov|io|test|local|invalid)\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static IReadOnlyList<string> ForbiddenPatterns => GoldenStrings(Golden.Value["participantForbiddenKeyPatterns"]);

    /// <summary>Every property in <paramref name="root"/>'s record graph whose CLR or wire name matches a forbidden pattern.</summary>
    private static List<string> ForbiddenMembers(Type root)
    {
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
                if (ForbiddenPatterns.Any(p =>
                    property.Name.Contains(p, StringComparison.OrdinalIgnoreCase) || wireName.Contains(p, StringComparison.OrdinalIgnoreCase)))
                {
                    hits.Add($"{type.Name}.{property.Name}");
                }

                var nested = ElementType(property.PropertyType);
                if (nested.Namespace?.StartsWith("Pulse.", StringComparison.Ordinal) == true)
                {
                    queue.Enqueue(nested);
                }
            }
        }

        return hits;
    }

    private static Type ElementType(Type type)
    {
        type = Nullable.GetUnderlyingType(type) ?? type;
        if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(IReadOnlyList<>))
        {
            return type.GetGenericArguments()[0];
        }

        return type;
    }

    private static string[] GoldenStrings(JsonNode? node) =>
        node!.AsArray().Select(n => n!.GetValue<string>()).ToArray();

    private static List<string> SerializedKeys(object value, JsonSerializerOptions? options = null)
    {
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(value, value.GetType(), options));
        return document.RootElement.EnumerateObject().Select(p => p.Name).ToList();
    }

    /// <summary>One fully-populated instance per pinned shape, keyed by the golden-file name.</summary>
    private static Dictionary<string, object> BuildSamples()
    {
        var media = new ContentMediaDto
        {
            Id = "m-1", Kind = "image", Role = "hero", Url = "/media/m-1", PosterUrl = null, ContentType = "image/png",
            Width = 200, Height = 80, DurationSec = null, Alt = "Fairhaven Today logo", Caption = null,
        };
        var module = new PortalModuleDto { Id = PortalVocabulary.ModuleTopStories, ChannelId = ChannelVocabulary.News };
        var masthead = new PortalMastheadDto { Name = "Fairhaven Today", Tagline = "Your city, every hour.", Logo = media };
        var setting = new PortalModuleSettingDto { Id = PortalVocabulary.ModuleWeather, Enabled = false };

        return new Dictionary<string, object>(StringComparer.Ordinal)
        {
            ["PortalDto"] = new PortalDto
            {
                Masthead = masthead, LayoutKey = PortalVocabulary.LayoutAnchor, Modules = [module],
                SkinOverrides = new JsonObject { ["schemaVersion"] = 1 }, HasResources = true,
            },
            ["PortalMastheadDto"] = masthead,
            ["PortalModuleDto"] = module,
            ["PortalResourceDto"] = new PortalResourceDto
            {
                Id = "r-1", Title = "Emergency contacts", Summary = null, BodyHtml = "<p>Call <a href=\"/press/wire-room\">us</a></p>",
                Media = media,
            },
            ["PortalModuleSettingDto"] = setting,
            ["PortalConfigStaffDto"] = new PortalConfigStaffDto
            {
                CityName = "Fairhaven", LayoutKey = PortalVocabulary.LayoutAnchor, Modules = [setting], Logo = media,
                ResolvedName = "Fairhaven Today", Version = 3,
            },
            ["PortalConfigWriteRequest"] = new PortalConfigWriteRequest
            {
                LayoutKey = PortalVocabulary.LayoutAnchor, Modules = [setting], LogoMediaId = "m-1", Version = 3,
            },
            ["PortalResourceStaffDto"] = new PortalResourceStaffDto
            {
                Id = "r-1", Title = "Emergency contacts", SortOrder = 0, Visible = false, Version = 2,
            },
            ["PortalResourceWriteRequest"] = new PortalResourceWriteRequest { Title = "Emergency contacts", Visible = true },
            ["PortalResourceReorderRequest"] = new PortalResourceReorderRequest { OrderedIds = ["r-2", "r-1"] },
        };
    }

    /// <summary>A probe with one member per forbidden pattern except <c>version</c> (asserted on a real staff DTO).</summary>
    private sealed record LeakyProbe(
        string DisplayToken, string TokenHash, string ActingHumanId, string LastSeenAt, string CreatedWallClock, string ExerciseId);

    /// <summary>Boots the real composition root (no database is opened) to read its serializer options.</summary>
    private sealed class HostOptionsProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";
        private const string DummyConnectionString =
            "Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;";

        private readonly string? _previousConnectionString;

        public HostOptionsProbeFactory()
        {
            _previousConnectionString = Environment.GetEnvironmentVariable(ConnectionStringEnvVar);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, DummyConnectionString);
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, _previousConnectionString);
        }
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
