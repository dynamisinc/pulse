namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using System;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// Story 03 (COR-001 / COR-012) — the always-Critical fail-closed proof for
/// <see cref="SessionAuthenticationMiddleware"/>, driven with a stub <see cref="ISessionAuthenticator"/> so no
/// database is needed. Proves the middleware: honors no token (leaves host scope); ignores an invalid/expired
/// token (leaves host scope); sets the session scope with PRECEDENCE over the host for a live session; enforces
/// the participant host-binding rule (mismatch / no host → 403 short-circuit, scope untouched); and does NOT
/// host-bind staff / read-only sessions. Plain <c>[Fact]</c> — no database.
/// </summary>
public class SessionAuthenticationMiddlewareTests
{
    private const string SampleToken = "Bearer TESTTOKEN";

    private static SessionAuthenticationMiddleware CreateMiddleware(RequestDelegate next) =>
        new(next, NullLogger<SessionAuthenticationMiddleware>.Instance);

    private static HttpContext ContextWith(string? authorization, Guid? hostResolvedExerciseId)
    {
        var context = new DefaultHttpContext();
        if (authorization is not null)
        {
            context.Request.Headers.Authorization = authorization;
        }

        if (hostResolvedExerciseId is { } hostId)
        {
            context.SetHostResolvedExerciseId(hostId);
        }

        return context;
    }

    [Fact]
    public async Task NoToken_LeavesScopeAsHostSet_AndContinues()
    {
        var hostExercise = Guid.NewGuid();
        var exerciseContext = new ExerciseContext { CurrentExerciseId = hostExercise };
        var nextCalled = false;
        var middleware = CreateMiddleware(_ => { nextCalled = true; return Task.CompletedTask; });

        await middleware.InvokeAsync(ContextWith(authorization: null, hostExercise), new StubAuthenticator(null), exerciseContext);

        exerciseContext.CurrentExerciseId.Should().Be(hostExercise, "with no token the host's provisional scope stands");
        nextCalled.Should().BeTrue();
    }

    [Fact]
    public async Task InvalidOrExpiredToken_LeavesScopeAsHostSet_AndContinues()
    {
        var hostExercise = Guid.NewGuid();
        var exerciseContext = new ExerciseContext { CurrentExerciseId = hostExercise };
        var nextCalled = false;
        var middleware = CreateMiddleware(_ => { nextCalled = true; return Task.CompletedTask; });

        // The authenticator returns null for an unknown/expired/revoked token (fail closed).
        await middleware.InvokeAsync(ContextWith(SampleToken, hostExercise), new StubAuthenticator(null), exerciseContext);

        exerciseContext.CurrentExerciseId.Should().Be(hostExercise,
            "an invalid/expired token is never honored — the scope stays as host resolution set it");
        nextCalled.Should().BeTrue();
    }

    [Fact]
    public async Task ParticipantSession_MatchingHost_SetsSessionScope()
    {
        var exercise = Guid.NewGuid();
        var exerciseContext = new ExerciseContext { CurrentExerciseId = exercise };
        var middleware = CreateMiddleware(_ => Task.CompletedTask);
        var authenticated = Session(exercise, "participant");

        var context = ContextWith(SampleToken, exercise);
        await middleware.InvokeAsync(context, new StubAuthenticator(authenticated), exerciseContext);

        context.Response.StatusCode.Should().Be((int)HttpStatusCode.OK);
        exerciseContext.CurrentExerciseId.Should().Be(exercise, "a participant session on its own exercise's host is honored");
    }

    [Fact]
    public async Task ParticipantSession_WrongHost_FailsClosedWith403_ScopeUntouched()
    {
        var sessionExercise = Guid.NewGuid();
        var hostExercise = Guid.NewGuid();
        var exerciseContext = new ExerciseContext { CurrentExerciseId = hostExercise };
        var nextCalled = false;
        var middleware = CreateMiddleware(_ => { nextCalled = true; return Task.CompletedTask; });

        var context = ContextWith(SampleToken, hostExercise);
        await middleware.InvokeAsync(context, new StubAuthenticator(Session(sessionExercise, "participant")), exerciseContext);

        context.Response.StatusCode.Should().Be((int)HttpStatusCode.Forbidden,
            "a participant session for exercise A presented on exercise B's host must fail closed (403)");
        nextCalled.Should().BeFalse("the request is short-circuited — the pipeline must not continue");
        exerciseContext.CurrentExerciseId.Should().Be(hostExercise,
            "the mismatched session's exercise must never be written into the scope");
    }

    [Fact]
    public async Task ParticipantSession_NoHostResolved_FailsClosedWith403()
    {
        var sessionExercise = Guid.NewGuid();
        var exerciseContext = new ExerciseContext();
        var nextCalled = false;
        var middleware = CreateMiddleware(_ => { nextCalled = true; return Task.CompletedTask; });

        var context = ContextWith(SampleToken, hostResolvedExerciseId: null);
        await middleware.InvokeAsync(context, new StubAuthenticator(Session(sessionExercise, "participant")), exerciseContext);

        context.Response.StatusCode.Should().Be((int)HttpStatusCode.Forbidden,
            "a participant session on a host that resolved to NO exercise cannot be confirmed to belong here — fail closed");
        nextCalled.Should().BeFalse();
        exerciseContext.CurrentExerciseId.Should().BeNull();
    }

    [Fact]
    public async Task StaffSession_OverridesHostScope_Precedence()
    {
        var sessionExercise = Guid.NewGuid();
        var hostExercise = Guid.NewGuid();
        // The host middleware already wrote its provisional scope (exercise B) before this middleware runs.
        var exerciseContext = new ExerciseContext { CurrentExerciseId = hostExercise };
        var nextCalled = false;
        var middleware = CreateMiddleware(_ => { nextCalled = true; return Task.CompletedTask; });

        var context = ContextWith(SampleToken, hostExercise);
        await middleware.InvokeAsync(context, new StubAuthenticator(Session(sessionExercise, "staff")), exerciseContext);

        exerciseContext.CurrentExerciseId.Should().Be(sessionExercise,
            "a staff session is NOT host-bound and its selected exercise takes precedence over the host's write (session > host)");
        context.Response.StatusCode.Should().Be((int)HttpStatusCode.OK);
        nextCalled.Should().BeTrue();
    }

    [Fact]
    public async Task ReadOnlySession_IsNotHostBound_SetsSessionScope()
    {
        var sessionExercise = Guid.NewGuid();
        var hostExercise = Guid.NewGuid();
        var exerciseContext = new ExerciseContext { CurrentExerciseId = hostExercise };
        var middleware = CreateMiddleware(_ => Task.CompletedTask);

        var context = ContextWith(SampleToken, hostExercise);
        await middleware.InvokeAsync(context, new StubAuthenticator(Session(sessionExercise, "readonly")), exerciseContext);

        exerciseContext.CurrentExerciseId.Should().Be(sessionExercise,
            "a read-only session is not host-bound (per the story-03 per-kind rule) and sets its own bound scope");
        context.Response.StatusCode.Should().Be((int)HttpStatusCode.OK);
    }

    private static AuthenticatedSession Session(Guid exerciseId, string kind) => new()
    {
        SessionId = Guid.NewGuid(),
        ExerciseId = exerciseId,
        Kind = kind,
        StaffUserId = kind == "staff" ? Guid.NewGuid() : null,
    };

    private sealed class StubAuthenticator : ISessionAuthenticator
    {
        private readonly AuthenticatedSession? _result;

        public StubAuthenticator(AuthenticatedSession? result) => _result = result;

        public Task<AuthenticatedSession?> AuthenticateAsync(string rawToken, CancellationToken cancellationToken) =>
            Task.FromResult(_result);
    }
}
