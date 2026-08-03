namespace Pulse.WebApi.Tests.Features.Ops.OrgAdminSeed;

using System;
using FluentAssertions;
using Pulse.WebApi.Features.Ops.OrgAdminSeed;
using Xunit;

/// <summary>
/// The <see cref="OrgAdminSeedGate"/> in isolation — model-only, no host and no database, so it runs on every
/// machine and in every CI job. This is the gate that makes "an unattended process mints an administrator"
/// acceptable at all, so it is asserted directly rather than only through the seeder that consults it.
/// </summary>
public sealed class OrgAdminSeedGateTests
{
    [Theory]
    [InlineData("Production")]
    [InlineData("production")]
    [InlineData("PRODUCTION")]
    public void Gate_IsDisabled_InProduction_WhateverTheCasing(string environmentName)
    {
        OrgAdminSeedGate.IsEnabled(new TestHostEnvironment(environmentName)).Should().BeFalse(
            "the orgAdmin seeder is a development/UAT convenience and must be impossible to run against a real "
            + "customer deployment; matching is case-insensitive so a mis-cased ASPNETCORE_ENVIRONMENT cannot "
            + "open the door");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Gate_TreatsAnUnnamedEnvironmentAsProduction(string environmentName)
    {
        OrgAdminSeedGate.IsEnabled(new TestHostEnvironment(environmentName)).Should().BeFalse(
            "a blank environment name means 'unknown', and IHostEnvironment.IsProduction() alone would answer "
            + "false for it — i.e. ENABLE the seeder. Fail-open on this particular gate is the whole risk, so "
            + "an unnamed environment resolves to the most restrictive answer");
    }

    [Theory]
    [InlineData("Development")]
    [InlineData("Staging")]
    [InlineData("UAT")]
    [InlineData("Local")]
    public void Gate_IsEnabled_EverywhereElse(string environmentName)
    {
        OrgAdminSeedGate.IsEnabled(new TestHostEnvironment(environmentName)).Should().BeTrue(
            "the seeder exists to make the org-admin surface reachable in development and UAT — a gate that "
            + "only allowed 'Development' would leave UAT (this feature's actual target) unprovisioned");
    }

    [Fact]
    public void Gate_RejectsANullEnvironment()
    {
        var act = () => OrgAdminSeedGate.IsEnabled(null!);

        act.Should().Throw<ArgumentNullException>(
            "a caller with no environment must not be silently treated as either answer");
    }
}
