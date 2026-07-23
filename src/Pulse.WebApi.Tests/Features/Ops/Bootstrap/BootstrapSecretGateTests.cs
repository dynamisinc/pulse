namespace Pulse.WebApi.Tests.Features.Ops.Bootstrap;

using FluentAssertions;
using Pulse.WebApi.Features.Ops.Bootstrap;

/// <summary>
/// Unit tests for <see cref="BootstrapSecretGate"/> (story login/05, NFR-009) — the fail-closed, constant-time
/// gate that decides whether a presented secret authorizes the bootstrap endpoint. Pure model-only
/// (<c>[Fact]</c>, no container): mirrors the fail-closed matrix <c>DynamisIdentityProviderTests</c> proves for
/// the staff allowlist's secret comparison. The constant-time property itself (SHA-256 digest +
/// <c>FixedTimeEquals</c>) is a code-level guarantee of the primitive used, exercised here for correctness across
/// matching / mismatched / different-length inputs.
/// </summary>
public sealed class BootstrapSecretGateTests
{
    [Fact]
    public void IsAuthorized_WithMatchingSecret_ReturnsTrue()
    {
        BootstrapSecretGate.IsAuthorized(configuredSecret: "s3cr3t-bootstrap", presentedSecret: "s3cr3t-bootstrap")
            .Should().BeTrue("the presented secret matches the configured one exactly");
    }

    [Fact]
    public void IsAuthorized_WithWrongSecret_ReturnsFalse()
    {
        BootstrapSecretGate.IsAuthorized(configuredSecret: "s3cr3t-bootstrap", presentedSecret: "wrong")
            .Should().BeFalse("a mismatched secret must be rejected (fail closed)");
    }

    [Fact]
    public void IsAuthorized_SecretComparisonIsCaseSensitive()
    {
        BootstrapSecretGate.IsAuthorized(configuredSecret: "s3cr3t-bootstrap", presentedSecret: "S3CR3T-BOOTSTRAP")
            .Should().BeFalse("the secret must match exactly (case-sensitive)");
    }

    [Fact]
    public void IsAuthorized_WithUnconfiguredEmptySecret_ReturnsFalse_EvenForEmptyPresented()
    {
        // The always-Critical fail-closed contract: an unconfigured (empty) secret DISABLES the endpoint — it must
        // never be the case that "any secret works", not even an empty presented secret against an empty config.
        BootstrapSecretGate.IsAuthorized(configuredSecret: string.Empty, presentedSecret: string.Empty)
            .Should().BeFalse("an empty configured secret disables the endpoint entirely (never 'any secret works')");
    }

    [Fact]
    public void IsAuthorized_WithUnconfiguredSecret_RejectsAnyPresentedValue()
    {
        BootstrapSecretGate.IsAuthorized(configuredSecret: string.Empty, presentedSecret: "anything")
            .Should().BeFalse("with no configured secret the endpoint is disabled — every presented value is rejected");
    }

    [Fact]
    public void IsAuthorized_WithNullSecrets_ReturnsFalse()
    {
        BootstrapSecretGate.IsAuthorized(configuredSecret: null, presentedSecret: null)
            .Should().BeFalse("a null (unset) configured secret fails closed");
    }

    [Fact]
    public void IsAuthorized_ConfiguredButNoPresented_ReturnsFalse()
    {
        BootstrapSecretGate.IsAuthorized(configuredSecret: "s3cr3t-bootstrap", presentedSecret: null)
            .Should().BeFalse("a configured endpoint with no presented secret is rejected");
    }

    [Fact]
    public void IsAuthorized_DifferentLengthSecrets_ReturnsFalse_WithoutThrowing()
    {
        // The digest-then-FixedTimeEquals design compares equal-length (32-byte) digests regardless of raw
        // lengths, so a length mismatch neither throws nor leaks length by timing.
        BootstrapSecretGate.IsAuthorized(configuredSecret: "short", presentedSecret: "a-much-longer-presented-secret")
            .Should().BeFalse("a length-mismatched secret is rejected via the fixed-time digest compare, never throwing");
    }
}
