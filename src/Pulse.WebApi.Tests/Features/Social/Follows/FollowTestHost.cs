namespace Pulse.WebApi.Tests.Features.Social.Follows;

using System;
using System.Net.Http;
using System.Net.Http.Headers;
using Microsoft.AspNetCore.Mvc.Testing;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// The shared test host for the follow-graph endpoints (<c>profiles-social-graph/07</c>). It boots the REAL
/// <c>Program</c> composition root — no self-mapped routes, no <c>IExerciseContext</c> override — so every
/// request travels the genuine pipeline: host→exercise resolution, then session authentication (which writes
/// the request's exercise scope with precedence), then the endpoint. That is deliberate: this story's routes
/// resolve their FOLLOWER from the caller's session, so a test that stubbed the scope would prove nothing
/// about the identity path, and a test host that mapped its own routes would mask a composition-root wiring
/// gap (#310→#317, dead at 404).
/// </summary>
/// <remarks>
/// The connection-string env var is set in the constructor (before the host captures configuration) and
/// cleared on dispose, mirroring <c>PersonaWebApplicationFactory</c>. The assembly disables cross-class
/// parallelization, so the process-wide variable cannot race another class's host build.
/// </remarks>
public sealed class FollowTestHost : WebApplicationFactory<Program>
{
    private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

    public FollowTestHost(string connectionString)
        => Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);

    /// <summary>
    /// A client whose <see cref="HttpClient.BaseAddress"/> host populates <c>Request.Host</c> exactly as a real
    /// <c>Host</c> header would (driving the host→exercise resolution), optionally presenting a session token.
    /// </summary>
    /// <param name="host">The request host to simulate — an exercise's provisioned <c>Hostname</c>.</param>
    /// <param name="bearerToken">The raw session token, or <c>null</c> for an anonymous request.</param>
    /// <returns>The configured client.</returns>
    public HttpClient CreateClientFor(string host, string? bearerToken)
    {
        var client = CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri($"http://{host}"),
        });

        if (bearerToken is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        }

        return client;
    }

    /// <summary>
    /// A live session row for the tests. <paramref name="personaId"/> is the binding the follow write path
    /// resolves its FOLLOWER from (identity-auth-roles/10's <c>Account.PersonaId</c> → <c>Session.PersonaId</c>).
    /// </summary>
    /// <param name="rawToken">The raw token the client will present (stored hashed, never in the clear).</param>
    /// <param name="exerciseId">The exercise the session is bound to.</param>
    /// <param name="personaId">The session's persona binding, or <c>null</c> for a session with none.</param>
    /// <param name="kind">The session kind — <c>participant</c>, <c>staff</c>, or <c>readonly</c>.</param>
    /// <param name="isReadOnly">Whether this is a view-only session (COR-015).</param>
    /// <returns>The session entity to seed.</returns>
    public static Session NewSession(
        string rawToken,
        Guid exerciseId,
        Guid? personaId,
        string kind = "participant",
        bool isReadOnly = false) => new()
        {
            Id = Guid.NewGuid(),
            TokenHash = SessionTokens.Hash(rawToken),
            Kind = kind,
            ExerciseId = exerciseId,
            PrincipalId = Guid.NewGuid().ToString(),
            Role = kind == "staff" ? "controller" : "participant",
            PersonaId = personaId,
            ActingHumanId = $"human-{Guid.NewGuid():N}",
            IsReadOnly = isReadOnly,
            IssuedAt = DateTimeOffset.UtcNow.AddMinutes(-5),
            ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
        };

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
    }
}
