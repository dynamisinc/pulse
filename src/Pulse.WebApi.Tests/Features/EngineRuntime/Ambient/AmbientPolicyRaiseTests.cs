namespace Pulse.WebApi.Tests.Features.EngineRuntime.Ambient;

using System;
using System.Collections.Generic;
using FluentAssertions;
using Pulse.Core.Features.Ambient.Models;
using Pulse.WebApi.Features.EngineRuntime;
using Xunit;

/// <summary>
/// ambient-chatter story 01, orchestrator review W-1: the pure raise rule Session A's lead-only gate (A1c) calls.
/// A raise moves toward unreviewed output; everything else is open to any controller.
/// </summary>
public sealed class AmbientPolicyRaiseTests
{
    private static readonly Guid PersonaA = Guid.NewGuid();
    private static readonly Guid PersonaB = Guid.NewGuid();

    private static AmbientTierPolicy Current(AmbientPolicyMode mode) => new()
    {
        Mode = mode,
        MaxPerMinute = 4,
        MaxPerHour = 40,
        TopicAllowList = [AmbientTopics.Food],
        PersonaAllowList = [PersonaA],
        SetBy = "staff",
    };

    private static EngineAmbientPolicyRequest Request(
        string? mode,
        int? perMinute = 4,
        int? perHour = 40,
        IReadOnlyList<string>? topics = null,
        IReadOnlyList<string>? personas = null) => new()
        {
            ActingHumanId = "c",
            Mode = mode,
            MaxPerMinute = perMinute,
            MaxPerHour = perHour,
            TopicAllowList = topics ?? [AmbientTopics.Food],
            PersonaAllowList = personas ?? [PersonaA.ToString()],
        };

    [Theory]
    [InlineData(AmbientPolicyMode.Off)]
    [InlineData(AmbientPolicyMode.Review)]
    public void A_ToAutonomousFromAnyOtherMode_IsARaise(AmbientPolicyMode current)
    {
        AmbientPolicyRaise.IsRaise(Current(current), Request("autonomous")).Should().BeTrue();
    }

    [Fact]
    public void B_AutonomousToAutonomous_WideningAnything_IsARaise()
    {
        var current = Current(AmbientPolicyMode.Autonomous);

        AmbientPolicyRaise.IsRaise(current, Request("autonomous", perMinute: 5)).Should().BeTrue("per-minute cap raised");
        AmbientPolicyRaise.IsRaise(current, Request("autonomous", perHour: 41)).Should().BeTrue("per-hour cap raised");
        AmbientPolicyRaise.IsRaise(current, Request("autonomous", topics: [AmbientTopics.Food, AmbientTopics.Sports]))
            .Should().BeTrue("a topic added");
        AmbientPolicyRaise.IsRaise(current, Request("autonomous", personas: [PersonaA.ToString(), PersonaB.ToString()]))
            .Should().BeTrue("a persona added");
        AmbientPolicyRaise.IsRaise(current, Request("autonomous", personas: ["not-a-guid"]))
            .Should().BeTrue("an unparseable persona counts as an addition (fail closed)");
    }

    [Fact]
    public void AutonomousToAutonomous_UnchangedOrNarrowed_IsNotARaise()
    {
        var current = Current(AmbientPolicyMode.Autonomous);

        AmbientPolicyRaise.IsRaise(current, Request("autonomous")).Should().BeFalse("unchanged");
        AmbientPolicyRaise.IsRaise(current, Request("autonomous", perMinute: 1, perHour: 10, topics: [], personas: []))
            .Should().BeFalse("lowering caps and removing entries is a lower");
    }

    [Theory]
    [InlineData(AmbientPolicyMode.Off, "review")]
    [InlineData(AmbientPolicyMode.Review, "off")]
    [InlineData(AmbientPolicyMode.Review, "review")]
    [InlineData(AmbientPolicyMode.Autonomous, "review")]
    [InlineData(AmbientPolicyMode.Autonomous, "off")]
    [InlineData(AmbientPolicyMode.Off, "bogus")]
    [InlineData(AmbientPolicyMode.Off, null)]
    public void OffReviewChanges_AndLowersFromAutonomous_AreNotRaises(AmbientPolicyMode current, string? mode)
    {
        AmbientPolicyRaise.IsRaise(Current(current), Request(mode, perMinute: 60, perHour: 999, topics: [AmbientTopics.Sports]))
            .Should().BeFalse("only movement toward unreviewed output is lead-only");
    }
}
