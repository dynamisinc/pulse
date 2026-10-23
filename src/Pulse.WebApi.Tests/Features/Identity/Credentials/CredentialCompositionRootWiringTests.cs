namespace Pulse.WebApi.Tests.Features.Identity.Credentials;

using System;
using System.Linq;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.Identity.Credentials;
using Pulse.WebApi.Features.Identity.Sessions;
using Xunit;

/// <summary>
/// identity-auth-roles/21 — composition-root guard (plain <see cref="FactAttribute"/>, no Docker): the REAL
/// <c>Program</c> maps both credential routes exactly once, the pre-auth route is allow-listed (and the admin route is
/// not), and every handler dependency resolves — with the no-op <see cref="NullPulseMailer"/> as the default mailer
/// (email is off; ACS is not deployed).
/// </summary>
public sealed class CredentialCompositionRootWiringTests
{
    [Fact]
    public void ProgramCs_MapsBothCredentialRoutes_ExactlyOnce_WithOnlyTheResetPreAuth()
    {
        using var factory = new WiringProbeFactory();
        var endpoints = factory.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>().ToList();

        RouteEndpoint Single(string route) => endpoints
            .Where(e => string.Equals(e.RoutePattern.RawText, route, StringComparison.OrdinalIgnoreCase)
                && (e.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains("POST") ?? false))
            .Should().ContainSingle("POST {0} must be wired into Program.cs exactly once via MapCredentialEndpoints()", route)
            .Which;

        PreAuthAllowlist.Contains(Single(CredentialEndpoints.ResetRoute)).Should().BeTrue(
            "the reset link is redeemed with no session");
        Single(CredentialEndpoints.ResetRoute).Metadata.GetMetadata<Microsoft.AspNetCore.RateLimiting.EnableRateLimitingAttribute>()
            ?.PolicyName.Should().Be(CredentialEndpoints.PasswordResetRateLimitPolicy, "the reset route has its own per-IP partition (S4)");
        PreAuthAllowlist.Contains(Single(CredentialEndpoints.AdminResetRoute)).Should().BeFalse(
            "the admin reset requires a live org-admin session");
    }

    [Fact]
    public void ProgramCs_CallsAddCredentials_SoEveryHandlerDependencyResolves_AndMailIsOffByDefault()
    {
        using var factory = new WiringProbeFactory();
        using var scope = factory.Services.CreateScope();
        var provider = scope.ServiceProvider;

        provider.GetService<CredentialTokenService>().Should().NotBeNull();
        provider.GetService<PasswordResetService>().Should().NotBeNull();
        provider.GetService<AdminPasswordResetService>().Should().NotBeNull();
        provider.GetRequiredService<IPulseMailer>().Should().BeOfType<NullPulseMailer>(
            "email is OFF until ACS is deployed: the default mailer sends nothing")
            .Which.IsConfigured.Should().BeFalse();
    }

    /// <summary>The real host with a dummy, never-connecting connection string, so it merely BUILDS.</summary>
    private sealed class WiringProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";
        private const string DummyConnectionString = "Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;";

        public WiringProbeFactory() => Environment.SetEnvironmentVariable(ConnectionStringEnvVar, DummyConnectionString);

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }

    [Fact]
    public void IsStaleFor_CountsTheTieAsStale_SoClockSkewFailsClosed()
    {
        var at = new DateTimeOffset(2026, 10, 19, 12, 0, 0, TimeSpan.Zero);
        var token = new Pulse.WebApi.Data.Entities.CredentialToken { TokenHash = "h", Purpose = "reset", CreatedAt = at };

        CredentialTokenService.IsStaleFor(token, at).Should().BeTrue("CreatedAt == PasswordChangedAt is stale (fails closed)");
        CredentialTokenService.IsStaleFor(token, at.AddTicks(-1)).Should().BeFalse("a token issued after the change is fresh");
        CredentialTokenService.IsStaleFor(token, at.AddTicks(1)).Should().BeTrue();
        CredentialTokenService.IsStaleFor(token, null).Should().BeFalse("no password change yet");
    }
}
