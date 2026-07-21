namespace Pulse.WebApi.Tests.Features.Identity.SharedAccess;

using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Pulse.WebApi.Features.Identity.SharedAccess;

/// <summary>
/// Pure, no-DB, no-HTTP-pipeline unit tests of <see cref="ReadOnlySessionWriteFilter"/> — the load-bearing
/// write-denial primitive itself (COR-015, story 06), isolated via a fake <see cref="IReadOnlySessionProbe"/>
/// and a call-counting <see cref="EndpointFilterDelegate"/> standing in for the guarded handler. These give the
/// STRONGEST possible proof that a denied write's handler never runs at all — not merely that the HTTP response
/// happens to be 403 — by asserting the "next" delegate is invoked exactly ZERO times when the probe reports a
/// live read-only session, and exactly ONCE (with its own result passed through unchanged) when it does not.
/// Complements the end-to-end proof in <see cref="SharedReadOnlyWriteDenialIsolationTests"/> (real HTTP + real
/// SQL Server via <see cref="SharedReadOnlyTestHost"/>), which additionally proves the guard composes correctly
/// through the real ASP.NET Core filter pipeline and DI.
/// </summary>
public sealed class ReadOnlySessionWriteFilterTests
{
    private sealed class FakeReadOnlySessionProbe : IReadOnlySessionProbe
    {
        private readonly bool _isReadOnly;

        public FakeReadOnlySessionProbe(bool isReadOnly) => _isReadOnly = isReadOnly;

        public Task<bool> IsReadOnlySessionAsync(HttpContext httpContext, CancellationToken cancellationToken = default) =>
            Task.FromResult(_isReadOnly);
    }

    [Fact]
    public async Task InvokeAsync_LiveReadOnlySession_Returns403_AndNeverInvokesTheHandler()
    {
        var filter = new ReadOnlySessionWriteFilter(new FakeReadOnlySessionProbe(isReadOnly: true));
        var invocationContext = EndpointFilterInvocationContext.Create(new DefaultHttpContext());
        var handlerInvocationCount = 0;
        EndpointFilterDelegate next = _ =>
        {
            handlerInvocationCount++;
            return ValueTask.FromResult<object?>(Results.Ok("handler-ran"));
        };

        var result = await filter.InvokeAsync(invocationContext, next);

        handlerInvocationCount.Should().Be(0,
            "a live read-only session must be denied BEFORE the handler runs (COR-015) — the handler's own " +
            "side effect (standing in for a sim write) must never execute, not merely be overridden in the " +
            "response the client sees");
        var statusResult = result.Should().BeAssignableTo<IStatusCodeHttpResult>().Subject;
        statusResult.StatusCode.Should().Be(StatusCodes.Status403Forbidden,
            "a live read-only session is denied a write with 403 Forbidden");
    }

    [Fact]
    public async Task InvokeAsync_NotALiveReadOnlySession_InvokesTheHandlerExactlyOnce_AndReturnsItsResultUnchanged()
    {
        var filter = new ReadOnlySessionWriteFilter(new FakeReadOnlySessionProbe(isReadOnly: false));
        var invocationContext = EndpointFilterInvocationContext.Create(new DefaultHttpContext());
        var handlerInvocationCount = 0;
        var handlerResult = Results.Ok("handler-ran");
        EndpointFilterDelegate next = _ =>
        {
            handlerInvocationCount++;
            return ValueTask.FromResult<object?>(handlerResult);
        };

        var result = await filter.InvokeAsync(invocationContext, next);

        handlerInvocationCount.Should().Be(1,
            "a request that is not a live read-only session (anonymous, expired/revoked token, or a " +
            "non-read-only session) must reach the handler exactly once — the guard is keyed off a LIVE " +
            "read-only session, nothing else");
        result.Should().BeSameAs(handlerResult,
            "the filter must pass the handler's own result through completely unchanged when it is not denying " +
            "the write");
    }
}
