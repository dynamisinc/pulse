// =====================================================================================================================
// TRIPWIRE (inject-queue/06, review finding M3). READ THIS BEFORE "FIXING" A FAILURE HERE.
//
// Until demo-polish BP merges, CreatePostRequest has no typed ParentPostId / Media / EngagementBaseline members, so
// InjectPostRequestFactory.Build maps scripted posts as TEXT ONLY (IQ-10). (Today's `Media` is an opaque JsonElement?
// placeholder that ingest ignores; it does not count as BP's typed member.)
//
// The day BP adds those members, this test FAILS until the factory fills them from the scripted post — so the BP
// merge cannot silently ship scripted posts without their photo, their reply parent or their seeded engagement.
// The fix is in InjectPostRequestFactory.Build (map child.Media, the resolved parentPostId and the Baseline* columns),
// NEVER in this test. `TheTripwire_Bites_...` proves the check really fails on a request type that has the members.
// =====================================================================================================================
namespace Pulse.WebApi.Tests.Features.Injects;

using System;
using System.Collections.Generic;
using System.Reflection;
using System.Text.Json;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Injects;
using Pulse.WebApi.Features.Social;
using Xunit;
using Xunit.Sdk;
using static Pulse.WebApi.Tests.Features.Injects.InjectTestData;

/// <summary>The BP-merge tripwire for the scripted-post funnel mapping (M3) — see the banner above.</summary>
public sealed class InjectPostRequestFactoryTripwireTests
{
    private static readonly string[] BpTypedMembers = ["ParentPostId", "Media", "EngagementBaseline"];

    private static readonly InjectEventTime Time = new(T0, T0, "UTC");

    [Fact]
    public void WhenCreatePostRequestGainsBpsTypedMembers_TheFactoryFillsThem()
    {
        var (request, _) = InjectPostRequestFactory.Build(
            ItemWithEverything(out var child), child, parentPostId: Guid.NewGuid(), Guid.NewGuid(), Time);

        AssertBpMembersMapped(typeof(CreatePostRequest), request);
    }

    [Fact]
    public void TheTripwire_Bites_OnARequestTypeThatHasTheMembersButLeavesThemNull()
    {
        var unmapped = () => AssertBpMembersMapped(typeof(FutureCreatePostRequest), new FutureCreatePostRequest());

        unmapped.Should().Throw<XunitException>("a typed member left null is exactly the silent BP-merge regression")
            .WithMessage("*ParentPostId*");

        var mapped = () => AssertBpMembersMapped(typeof(FutureCreatePostRequest), new FutureCreatePostRequest
        {
            ParentPostId = Guid.NewGuid().ToString(),
            Media = [new object()],
            EngagementBaseline = new object(),
        });
        mapped.Should().NotThrow("and it passes once the factory maps all three");
    }

    [Fact]
    public void TodaysMediaMember_IsTheOpaquePlaceholder_WhichIsWhyTheTripwireIsQuietNow()
    {
        var media = typeof(CreatePostRequest).GetProperty("Media");

        // If this fails, BP has changed Media — the tripwire above is now armed for it, as intended.
        media?.PropertyType.Should().Be(typeof(JsonElement?));
        typeof(CreatePostRequest).GetProperty("ParentPostId").Should().BeNull("BP has not landed yet");
        typeof(CreatePostRequest).GetProperty("EngagementBaseline").Should().BeNull("BP has not landed yet");
    }

    /// <summary>For each BP member the request TYPE really has (typed, not the opaque placeholder), demands a value.</summary>
    private static void AssertBpMembersMapped(Type requestType, object request)
    {
        foreach (var name in BpTypedMembers)
        {
            var property = requestType.GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
            if (property is null || IsOpaquePlaceholder(property))
            {
                continue;
            }

            property.GetValue(request).Should().NotBeNull(
                "{0}.{1} exists, so InjectPostRequestFactory.Build must map it from the scripted post (IQ-10, M3)",
                requestType.Name,
                name);
        }
    }

    private static bool IsOpaquePlaceholder(PropertyInfo property) =>
        property.PropertyType == typeof(JsonElement) || property.PropertyType == typeof(JsonElement?);

    private static InjectItem ItemWithEverything(out InjectItemPost child)
    {
        var item = Item(InjectKinds.Post, childCount: 1);
        child = Children(item)[0];
        child.Media = [new InjectMediaRef { MediaId = "beat3-photo", Alt = "Brown tap water" }];
        child.ReplyToPostId = Guid.NewGuid();
        child.BaselineLike = 120;
        child.BaselineRepost = 14;
        child.BaselineReply = 9;
        return item;
    }

    /// <summary>A stand-in for BP's CreatePostRequest: the three typed members, left null unless set.</summary>
    private sealed class FutureCreatePostRequest
    {
        public string? ParentPostId { get; init; }

        public IReadOnlyList<object>? Media { get; init; }

        public object? EngagementBaseline { get; init; }
    }
}
