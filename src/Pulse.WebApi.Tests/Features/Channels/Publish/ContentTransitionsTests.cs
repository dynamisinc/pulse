namespace Pulse.WebApi.Tests.Features.Channels.Publish;

using System.Collections.Generic;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Channels.Contracts;
using Xunit;

/// <summary>The frozen FC-1 table, every (action, status) pair, and the FC-7a resolution order.</summary>
public sealed class ContentTransitionsTests
{
    private static readonly Dictionary<(string Action, string From), string> Allowed = new()
    {
        [("schedule", "draft")] = "scheduled",
        [("publish", "draft")] = "published",
        [("publish", "scheduled")] = "published",
        [("unschedule", "scheduled")] = "draft",
        [("retract", "published")] = "retracted",
        [("restore", "retracted")] = "published",
        [("revise", "published")] = "published",
        [("edit", "draft")] = "draft",
        [("edit", "scheduled")] = "scheduled",
    };

    [Fact]
    public void EveryPairOutsideTheFrozenTable_IsRefused()
    {
        foreach (var action in ContentTransitions.Actions)
        {
            foreach (var status in ChannelVocabulary.ContentStatuses)
            {
                var expected = Allowed.TryGetValue((action, status), out var target) ? target : null;
                ContentTransitions.TargetOf(action, status).Should().Be(expected, "{0} from {1}", action, status);
            }
        }
    }

    [Fact]
    public void Resolution_IsFirstNonNullWins_AndNeverTheDefaultAlertMapping()
    {
        var descriptor = new TestKindDescriptor("weather_product", "weather", "plain");
        var call = new PublishOptions { PairedPost = new PairedPostOptions { Text = "call" } };
        var persisted = new PublishOptions { Alert = new PublishAlertOptions { Severity = "advisory" } };
        var derived = new PublishOptions { Alert = new PublishAlertOptions { Severity = "emergency" } };
        descriptor.Derive = _ => derived;
        var item = NewItem(PublishOptionsResolver.Serialize(persisted));

        PublishOptionsResolver.Resolve(call, item, descriptor).Should().Be((call, PublishOptionsResolver.Source.Call));
        PublishOptionsResolver.Resolve(null, item, descriptor).Options!.Alert!.Severity.Should().Be("advisory");
        PublishOptionsResolver.Resolve(null, NewItem(null), descriptor).Should().Be((derived, PublishOptionsResolver.Source.Descriptor));

        descriptor.Derive = null;
        PublishOptionsResolver.Resolve(null, NewItem(null), descriptor).Should().Be(((PublishOptions?)null, PublishOptionsResolver.Source.None),
            "DefaultAlertMapping is a dialog suggestion, never a resolution step");
        PublishOptionsResolver.Resolve(null, NewItem("{not json"), descriptor).Options.Should().BeNull("unreadable stored options are none");
    }

    [Fact]
    public void PersistedOptions_UseTheCamelCaseStoredContract()
    {
        var json = PublishOptionsResolver.Serialize(new PublishOptions
        {
            PairedPost = new PairedPostOptions { Text = "t" },
            Alert = new PublishAlertOptions { Severity = "emergency", Headline = "h", ExpiresScenarioTime = "2033-01-01T00:00:00Z" },
        });

        json.Should().Be(
            "{\"pairedPost\":{\"text\":\"t\"},\"alert\":{\"severity\":\"emergency\",\"headline\":\"h\",\"expiresScenarioTime\":\"2033-01-01T00:00:00Z\"}}");
    }

    private static ContentItem NewItem(string? optionsJson) => new()
    {
        ChannelId = "weather",
        Kind = "weather_product",
        Slug = "w",
        Status = "scheduled",
        Headline = "h",
        CreatedScenarioTime = default,
        CreatedWallClock = default,
        Origin = "controller",
        ActingHumanId = "h",
        PublishOptionsJson = optionsJson,
    };
}
