namespace Pulse.WebApi.Tests.Helpers;

using System;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// Test-host shim that presents a request as coming from a LIVE session, so a suite whose subject is something
/// other than authentication can drive a gated endpoint without minting a real session row.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this exists (identity-auth-roles/11).</b> Before the default-deny gate, an endpoint honored any
/// request whose exercise scope resolved — so these suites faked the scope through DI
/// (<c>services.RemoveAll&lt;IExerciseContext&gt;()</c>, the established harness idiom) and presented no
/// credential at all. That is precisely the hole #359 exploited, and closing it correctly 401s those requests.
/// This is the symmetric fake for the other half of the request's identity: alongside "pretend the host
/// resolved exercise X", "pretend a live session of kind K authenticated". It keeps a feed-read or
/// sanitization test testing feed reads and sanitization, rather than the identity slice.
/// </para>
/// <para>
/// <b>It fakes only the principal, never the gate.</b> The middleware runs unchanged: this shim populates
/// <c>HttpContext.User</c> exactly as <see cref="SessionAuthenticationMiddleware"/> would for a live session
/// (via the same <see cref="SessionPrincipal"/> factory), and it deliberately DEFERS to a real credential —
/// a request that carries an <c>Authorization</c> header is left alone so the real resolution path still runs.
/// Whether the gate itself is correct is asserted by the anonymous-access regression suite
/// (identity-auth-roles/14), which uses NO shim.
/// </para>
/// </remarks>
public static class FakeAuthenticatedSessionExtensions
{
    /// <summary>
    /// Presents every credential-less request to this host as an authenticated session of the given kind bound
    /// to <paramref name="exerciseId"/>.
    /// </summary>
    /// <param name="builder">The test host builder.</param>
    /// <param name="exerciseId">The session's bound exercise. <c>null</c> presents an UNRESOLVED session (no principal), which is the "anonymous" case.</param>
    /// <param name="kind">The session kind — <c>participant</c> (default) / <c>staff</c> / <c>readonly</c>.</param>
    /// <returns>The same builder, for chaining.</returns>
    public static IWebHostBuilder UseFakeAuthenticatedSession(
        this IWebHostBuilder builder,
        Guid? exerciseId,
        string kind = "participant")
    {
        ArgumentNullException.ThrowIfNull(builder);

        if (exerciseId is null)
        {
            // Nothing to present — leave the request anonymous so the gate's real behavior is observed.
            return builder;
        }

        var session = new AuthenticatedSession
        {
            SessionId = Guid.NewGuid(),
            ExerciseId = exerciseId.Value,
            Kind = kind,
        };

        return builder.ConfigureTestServices(services =>
            services.AddSingleton<IStartupFilter>(new FakeSessionStartupFilter(session)));
    }

    /// <summary>
    /// Inserts the principal-stamping middleware ahead of the application's own pipeline. A startup filter is
    /// the only seam that can add middleware to a <c>WebApplication</c> host from a test.
    /// </summary>
    private sealed class FakeSessionStartupFilter : IStartupFilter
    {
        private readonly AuthenticatedSession _session;

        public FakeSessionStartupFilter(AuthenticatedSession session) => _session = session;

        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            app.Use(async (context, nextMiddleware) =>
            {
                // Defer to a real credential: if one is presented, the genuine middleware resolves it.
                if (!SessionTokenExtractor.TryGetSessionToken(context.Request, out _))
                {
                    context.User = SessionPrincipal.Create(_session);
                }

                await nextMiddleware(context);
            });

            next(app);
        };
    }
}
