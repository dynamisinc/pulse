namespace Pulse.Core.Tests.Features.Generation;

using FluentAssertions;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;

public class GenerationGovernanceTests
{
    private static GenerationOptions CompliantAzureOptions()
    {
        var options = new GenerationOptions
        {
            Provider = "AzureOpenAI",
            Endpoint = "https://aif-pulse-uat.openai.azure.com/",
            Governance = new GovernanceOptions
            {
                TenantBounded = true,
                NoTrainingAttested = true,
                Residency = "centralus",
                Retention = RetentionPosture.ZeroDataRetention,
            },
        };
        options.Tiers["Standard"] = new TierModelOptions { Model = "gpt-4.1", ZdrCapable = true };
        options.Tiers["Ambient"] = new TierModelOptions { Model = "gpt-4.1-mini", ZdrCapable = true };
        return options;
    }

    [Fact]
    public void Validate_WithFullyCompliantConfig_ReturnsAttestedPosture()
    {
        // Act
        var posture = GenerationGovernance.Validate(CompliantAzureOptions());

        // Assert
        posture.TenantBounded.Should().BeTrue();
        posture.NoTrainingAttested.Should().BeTrue();
        posture.Residency.Should().Be("centralus");
        posture.Retention.Should().Be(RetentionPosture.ZeroDataRetention);
    }

    [Fact]
    public void Validate_WhenNotTenantBounded_ThrowsWithClearMessage()
    {
        // Arrange
        var options = CompliantAzureOptions();
        options.Governance.TenantBounded = false;

        // Act
        var act = () => GenerationGovernance.Validate(options);

        // Assert
        act.Should().Throw<GenerationConfigurationException>().WithMessage("*tenant-bounded*");
    }

    [Fact]
    public void Validate_WhenNoTrainingNotAttested_Throws()
    {
        // Arrange
        var options = CompliantAzureOptions();
        options.Governance.NoTrainingAttested = false;

        // Act
        var act = () => GenerationGovernance.Validate(options);

        // Assert
        act.Should().Throw<GenerationConfigurationException>().WithMessage("*no-training*");
    }

    [Fact]
    public void Validate_WhenResidencyMissing_Throws()
    {
        // Arrange
        var options = CompliantAzureOptions();
        options.Governance.Residency = "   ";

        // Act
        var act = () => GenerationGovernance.Validate(options);

        // Assert
        act.Should().Throw<GenerationConfigurationException>().WithMessage("*residency*");
    }

    [Fact]
    public void Validate_WhenRetentionUnspecified_Throws()
    {
        // Arrange — the gate must require an explicit retention stance (NFR-005), not silently pass.
        var options = CompliantAzureOptions();
        options.Governance.Retention = RetentionPosture.Unspecified;

        // Act
        var act = () => GenerationGovernance.Validate(options);

        // Assert
        act.Should().Throw<GenerationConfigurationException>().WithMessage("*retention posture*");
    }

    [Fact]
    public void Validate_WhenZdrTargetedButModelNotZdrCapable_RejectsTheModel()
    {
        // Arrange
        var options = CompliantAzureOptions();
        options.Tiers["Standard"].ZdrCapable = false;

        // Act
        var act = () => GenerationGovernance.Validate(options);

        // Assert — the error names both the ZDR conflict and the offending model
        act.Should().Throw<GenerationConfigurationException>()
            .WithMessage("*zero-data-retention*")
            .WithMessage("*gpt-4.1*");
    }

    [Fact]
    public void Validate_WhenNotTargetingZdr_AllowsNonZdrModel()
    {
        // Arrange
        var options = CompliantAzureOptions();
        options.Governance.Retention = RetentionPosture.Retained;
        options.Tiers["Standard"].ZdrCapable = false;

        // Act
        var act = () => GenerationGovernance.Validate(options);

        // Assert
        act.Should().NotThrow();
    }

    [Fact]
    public void Validate_AggregatesEveryViolationInOneError()
    {
        // Arrange
        var options = CompliantAzureOptions();
        options.Governance.TenantBounded = false;
        options.Governance.NoTrainingAttested = false;

        // Act
        var act = () => GenerationGovernance.Validate(options);

        // Assert
        act.Should().Throw<GenerationConfigurationException>()
            .WithMessage("*tenant-bounded*")
            .WithMessage("*no-training*");
    }

    [Fact]
    public void InProcessPosture_IsCompliantByConstruction()
    {
        // Assert
        GenerationGovernance.InProcess.TenantBounded.Should().BeTrue();
        GenerationGovernance.InProcess.NoTrainingAttested.Should().BeTrue();
        GenerationGovernance.InProcess.Retention.Should().Be(RetentionPosture.ZeroDataRetention);
    }
}
