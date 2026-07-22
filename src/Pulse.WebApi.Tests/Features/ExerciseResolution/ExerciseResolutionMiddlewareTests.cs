namespace Pulse.WebApi.Tests.Features.ExerciseResolution;

using System;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.ExerciseResolution;

/// <summary>
/// Story <c>exercise-isolation/08</c> (Tier-2) — the always-Critical fail-closed proof for
/// <see cref="ExerciseResolutionMiddleware"/>, driven with a stand-in <see cref="IHostExerciseResolver"/> so
/// no database is needed. Proves the middleware:
/// <list type="bullet">
///   <item><description>writes the resolved scope AND the cross-wave stash on a matched host;</description></item>
///   <item><description>leaves the scope UNSET (and stashes nothing) on an unmatched host — fail closed;</description></item>
///   <item><description>treats a <see cref="Guid.Empty"/> resolver result as unresolved (never the empty floor);</description></item>
///   <item><description>passes the port-stripped <c>Host</c> to the resolver and always calls the next delegate.</description></item>
/// </list>
/// Plain <c>[Fact]</c> — no database, so these run everywhere.
/// </summary>
public class ExerciseResolutionMiddlewareTests
{
    private static ExerciseResolutionMiddleware CreateMiddleware(RequestDelegate next) =>
        new(next, NullLogger<ExerciseResolutionMiddleware>.Instance);

    private static HttpContext HttpContextForHost(string host)
    {
        var context = new DefaultHttpContext();
        context.Request.Host = new HostString(host);
        return context;
    }

    [Fact]
    public async Task ResolvedHost_SetsScope_AndStashesForSessionLayer()
    {
        var exerciseId = Guid.NewGuid();
        var resolver = new StubResolver(exerciseId);
        var exerciseContext = new ExerciseContext();
        var nextCalled = false;
        var middleware = CreateMiddleware(_ => { nextCalled = true; return Task.CompletedTask; });

        var context = HttpContextForHost("atl-cie.example.com");
        await middleware.InvokeAsync(context, resolver, exerciseContext);

        exerciseContext.CurrentExerciseId.Should().Be(
            exerciseId, "a matched host sets the request scope to the resolved exercise");
        context.GetHostResolvedExerciseId().Should().Be(
            exerciseId, "the host-resolved exercise is stashed for identity-auth-roles/03's session-vs-host check");
        resolver.LastHost.Should().Be("atl-cie.example.com", "the middleware passes the request host to the resolver");
        nextCalled.Should().BeTrue("the pipeline must continue");
    }

    [Fact]
    public async Task UnresolvedHost_LeavesScopeUnset_AndStashesNothing_FailClosed()
    {
        var resolver = new StubResolver(null);
        var exerciseContext = new ExerciseContext();
        var nextCalled = false;
        var middleware = CreateMiddleware(_ => { nextCalled = true; return Task.CompletedTask; });

        var context = HttpContextForHost("unknown-host.example.com");
        await middleware.InvokeAsync(context, resolver, exerciseContext);

        exerciseContext.CurrentExerciseId.Should().BeNull(
            "an unmatched host leaves the scope UNSET — fail closed (zero rows), never a default/first exercise");
        context.GetHostResolvedExerciseId().Should().BeNull("nothing is stashed when no host resolves");
        nextCalled.Should().BeTrue("the pipeline must continue even when no scope resolves");
    }

    [Fact]
    public async Task EmptyGuidFromResolver_IsTreatedAsUnresolved_FailClosed()
    {
        // Defensive: even if a resolver ever returned Guid.Empty, that is the fail-closed floor, never a scope.
        var resolver = new StubResolver(Guid.Empty);
        var exerciseContext = new ExerciseContext();
        var middleware = CreateMiddleware(_ => Task.CompletedTask);

        var context = HttpContextForHost("atl-cie.example.com");
        await middleware.InvokeAsync(context, resolver, exerciseContext);

        exerciseContext.CurrentExerciseId.Should().BeNull("Guid.Empty is the unresolved floor, never a resolved scope");
        context.GetHostResolvedExerciseId().Should().BeNull();
    }

    private sealed class StubResolver : IHostExerciseResolver
    {
        private readonly Guid? _result;

        public StubResolver(Guid? result) => _result = result;

        public string? LastHost { get; private set; }

        public Task<Guid?> ResolveExerciseIdAsync(string? rawHost, CancellationToken cancellationToken)
        {
            LastHost = rawHost;
            return Task.FromResult(_result);
        }
    }
}
