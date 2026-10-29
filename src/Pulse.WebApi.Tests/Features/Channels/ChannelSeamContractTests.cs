namespace Pulse.WebApi.Tests.Features.Channels;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// Channels-foundation story 02 (#698), AC "Seams declared": the FC-7 interfaces exist under their frozen names, with
/// the shapes downstream stories build against. Reflection only: implementations are the owning stories'.
/// </summary>
public class ChannelSeamContractTests
{
    [Theory]
    [InlineData(typeof(IContentPublishService))]
    [InlineData(typeof(IContentKindDescriptor))]
    [InlineData(typeof(ISanitizerProfileRegistry))]
    [InlineData(typeof(IContentPublishGate))]
    [InlineData(typeof(IContentPublishedObserver))]
    [InlineData(typeof(IAlertRaiser))]
    [InlineData(typeof(IPairedSocialPoster))]
    [InlineData(typeof(IInSimLinkResolver))]
    [InlineData(typeof(IContentPermalinks))]
    [InlineData(typeof(ISkinOverridesValidator))]
    public void Seam_IsAPublicInterfaceInTheContractsNamespace(Type seam)
    {
        seam.IsInterface.Should().BeTrue();
        seam.IsPublic.Should().BeTrue();
        seam.Namespace.Should().Be("Pulse.WebApi.Features.Channels.Contracts");
    }

    [Fact]
    public void KindDescriptor_OffersOnlyAsyncPayloadValidation()
    {
        var methods = typeof(IContentKindDescriptor).GetMethods();
        var validate = methods.Where(m => m.Name.Contains("Validate", StringComparison.Ordinal)).ToList();

        validate.Should().ContainSingle().Which.Name.Should().Be("ValidatePayloadAsync");
        validate[0].ReturnType.Should().Be(typeof(Task<PayloadValidationResult>));
        validate[0].GetParameters().Select(p => p.ParameterType).Should().Contain(typeof(PayloadValidationContext));
    }

    [Fact]
    public void KindDescriptor_ResolvePublishOptions_DefaultsToNull()
    {
        var method = typeof(IContentKindDescriptor).GetMethod(nameof(IContentKindDescriptor.ResolvePublishOptions));

        method.Should().NotBeNull();
        method!.IsAbstract.Should().BeFalse("ResolvePublishOptions is a default (null) member, FC-7a");
        method.ReturnType.Should().Be(typeof(PublishOptions));
        method.GetParameters().Select(p => p.ParameterType).Should().Equal(typeof(ContentItem));
    }

    [Theory]
    [InlineData(typeof(IContentPublishGate), nameof(IContentPublishGate.EvaluateAsync))]
    [InlineData(typeof(IContentPublishedObserver), nameof(IContentPublishedObserver.OnPublishedAsync))]
    [InlineData(typeof(IContentPublishedObserver), nameof(IContentPublishedObserver.OnRevisedAsync))]
    [InlineData(typeof(IContentPublishedObserver), nameof(IContentPublishedObserver.OnRetractedAsync))]
    [InlineData(typeof(IPairedSocialPoster), nameof(IPairedSocialPoster.PostLinkCardAsync))]
    public void EntitySeam_TakesTheF01ContentItemFirst(Type seam, string member)
    {
        var method = seam.GetMethod(member)!;

        method.GetParameters()[0].ParameterType.Should().Be(typeof(ContentItem), "FC-7 types these seams on the entity");
        typeof(Task).IsAssignableFrom(method.ReturnType).Should().BeTrue("every FC-7 entity seam is async");
    }

    [Fact]
    public void Observer_RevisedAndRetractedAreDefaultNoOps()
    {
        // Only OnPublishedAsync is abstract, so an E8/E10 observer that cares about publishes alone stays small.
        typeof(IContentPublishedObserver).GetMethod(nameof(IContentPublishedObserver.OnPublishedAsync))!
            .IsAbstract.Should().BeTrue();
        typeof(IContentPublishedObserver).GetMethod(nameof(IContentPublishedObserver.OnRevisedAsync))!
            .IsAbstract.Should().BeFalse();
        typeof(IContentPublishedObserver).GetMethod(nameof(IContentPublishedObserver.OnRetractedAsync))!
            .IsAbstract.Should().BeFalse();
    }

    [Fact]
    public void ReviseOptions_TouchUpdatedStamp_DefaultsToTrue()
    {
        new ReviseOptions { Kind = ChannelVocabulary.RevisionUpdate, Fields = new ContentWriteRequest() }
            .TouchUpdatedStamp.Should().BeTrue();
    }

    [Fact]
    public void ScheduleAsync_CarriesPublishOptions()
    {
        var schedule = typeof(IContentPublishService).GetMethod(nameof(IContentPublishService.ScheduleAsync))!;

        schedule.GetParameters().Select(p => p.ParameterType).Should().Contain(typeof(PublishOptions));
    }

    [Fact]
    public void ReviseAsync_TakesReviseOptions()
    {
        var revise = typeof(IContentPublishService).GetMethod(nameof(IContentPublishService.ReviseAsync))!;

        revise.GetParameters().Select(p => p.ParameterType).Should().Contain(typeof(ReviseOptions));
    }

    [Fact]
    public void PublishService_DeclaresTheFrozenFunnelMembers()
    {
        typeof(IContentPublishService).GetMethods().Select(m => m.Name).Should().BeEquivalentTo(
        [
            "CreateDraftAsync", "UpdateDraftAsync", "PublishAsync", "ScheduleAsync", "UnscheduleAsync",
            "RetractAsync", "RestoreAsync", "ReviseAsync", "SoftDeleteAsync",
        ]);
    }

    [Fact]
    public void PublishGate_DecisionsCarryNoteOrReason()
    {
        var allow = ContentPublishGateDecision.Allow("controller bypass");
        var hold = ContentPublishGateDecision.Hold("awaiting approval");

        allow.Allowed.Should().BeTrue();
        allow.AuditNote.Should().Be("controller bypass");
        hold.Allowed.Should().BeFalse();
        hold.Reason.Should().Be("awaiting approval");
    }

    [Fact]
    public void PayloadValidationResult_InvalidIsNeverValid()
    {
        PayloadValidationResult.Invalid("zone not found").IsValid.Should().BeFalse();
        PayloadValidationResult.Valid.IsValid.Should().BeTrue();
    }

    [Fact]
    public void SanitizerProfile_DefaultSchemesExcludeScriptCapableOnes()
    {
        var profile = new SanitizerProfile { AllowedElements = new HashSet<string> { "a" } };

        profile.AllowedUrlSchemes.Should().BeEquivalentTo(["https", "http", "mailto"]);
        profile.AllowedUrlSchemes.Should().NotContain(["javascript", "data", "vbscript"]);
    }

    [Fact]
    public void SanitizerRegistry_NamesTheBuiltInProfiles()
    {
        new[] { ISanitizerProfileRegistry.Plain, ISanitizerProfileRegistry.RichBasic, ISanitizerProfileRegistry.RichTables }
            .Should().Equal("plain", "rich-basic", "rich-tables");
    }
}
