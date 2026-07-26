namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;

using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Xunit;

/// <summary>
/// The gate's COVERAGE SET, asserted as data — AC3's four social routes plus all six participant-shell config
/// GETs, and nothing else. Pure (no database, no HTTP), so plain <see cref="FactAttribute"/>s outside
/// <c>MsSqlCollection</c>.
/// </summary>
public sealed class ExerciseLifecycleGatedRoutesTests
{
    /// <summary>AC3: exactly the covered set implementation.md names — no more, no fewer.</summary>
    [Fact]
    public void Paths_AreExactlyTheCoveredSetImplementationMdNames() =>
        ExerciseLifecycleGatedRoutes.Paths.Should().BeEquivalentTo(
            [
                "/api/feed",
                "/api/threads",
                "/api/personas",
                "/api/posts",
                "/api/shell-state",
                "/api/chrome-config",
                "/api/brand-tokens",
                "/api/channel-nav-config",
                "/api/alerts",
                "/api/overlay-state",
            ],
            "the covered set is implementation.md's 'participant-gating seam' list, verbatim");

    /// <summary>AC3: every covered participant route matches, including the templated thread route.</summary>
    [Theory]
    [InlineData("/api/feed")]
    [InlineData("/api/threads/6b1f3e6c-2f60-4a3c-9d4a-2a4d1f7bd6d1")]
    [InlineData("/api/personas")]
    [InlineData("/api/posts")]
    [InlineData("/api/shell-state")]
    [InlineData("/api/chrome-config")]
    [InlineData("/api/brand-tokens")]
    [InlineData("/api/channel-nav-config")]
    [InlineData("/api/alerts")]
    [InlineData("/api/overlay-state")]
    [InlineData("/API/FEED")]
    public void IsGated_CoversEveryParticipantWorldRoute(string path) =>
        ExerciseLifecycleGatedRoutes.IsGated(new PathString(path)).Should().BeTrue(
            "{0} is a participant-world route and must be refusable in Build/Completed/Archived", path);

    /// <summary>
    /// AC4: the pre-auth allowlist and the whole staff/ops surface are never gated — by CONSTRUCTION (they are
    /// not on the covered list), not by a second exemption list that could drift.
    /// </summary>
    [Theory]
    [InlineData("/api/exercise-context")]
    [InlineData("/api/session")]
    [InlineData("/api/auth/login")]
    [InlineData("/api/auth/staff/login")]
    [InlineData("/api/auth/shared")]
    [InlineData("/api/auth/refresh")]
    [InlineData("/api/staff/exercise-settings")]
    [InlineData("/api/staff/exercise-lifecycle")]
    [InlineData("/api/staff/assignments")]
    [InlineData("/api/telemetry")]
    [InlineData("/api/ops/bootstrap-exercise")]
    [InlineData("/health")]
    [InlineData("/health/ready")]
    [InlineData("/hubs/exercise")]
    public void IsGated_NeverTouchesTheAuthStaffOpsOrHealthSurface(string path) =>
        ExerciseLifecycleGatedRoutes.IsGated(new PathString(path)).Should().BeFalse(
            "{0} must never be gated — gating it would lock staff out of a Build-state exercise they are configuring", path);

    /// <summary>
    /// Decision 2: the <c>completed</c> carve-out is recognized on the overlay route ALONE, and by segment —
    /// so it can never widen to a prefix-similar path.
    /// </summary>
    [Theory]
    [InlineData("/api/overlay-state", true)]
    [InlineData("/API/OVERLAY-STATE", true)]
    [InlineData("/api/overlay-state-history", false)]
    [InlineData("/api/shell-state", false)]
    [InlineData("/api/feed", false)]
    public void IsOverlayState_IsTheOverlayRouteAlone(string path, bool expected) =>
        ExerciseLifecycleGatedRoutes.IsOverlayState(new PathString(path)).Should().Be(
            expected, "only /api/overlay-state carries the completed-state carve-out (decision 2)");

    /// <summary>
    /// Matching is by path SEGMENT, so a route that merely shares a prefix string is not swept in — and a
    /// genuine sub-route of a covered path is.
    /// </summary>
    [Theory]
    [InlineData("/api/feedback", false)]
    [InlineData("/api/personas-export", false)]
    [InlineData("/api/posts/123/react", true)]
    [InlineData("/api/feed/page/2", true)]
    public void IsGated_MatchesWholeSegmentsNotStringPrefixes(string path, bool gated) =>
        ExerciseLifecycleGatedRoutes.IsGated(new PathString(path)).Should().Be(gated);
}
