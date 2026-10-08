namespace Pulse.WebApi.Tests.Features.Social.Threads;

using System;
using System.Collections.Generic;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;

/// <summary>The sibling Wave-1b capabilities a Gate-2 test needs on the host.</summary>
[Flags]
public enum Gate2Capability
{
    /// <summary>BP's reply write: <c>POST /api/posts</c> accepts <c>parentPostId</c> and calls the resolver.</summary>
    ReplyIngest = 1,

    /// <summary>B3's <c>PostEngagementReader</c>: real counts behind the projector.</summary>
    EngagementReader = 2,
}

/// <summary>
/// A <see cref="FactAttribute"/> for the end-to-end reply-flow tests that story B2 authors but that can only pass at
/// Gate 2, after BP (and, for counts, B3) merge. At discovery time it checks whether those capabilities exist in the
/// compiled <c>Pulse.WebApi</c> assembly. If any is missing, the test is reported as <c>Skipped</c> with the reason,
/// never as <c>Passed</c>. Once they merge, the test runs automatically with no edit. It then also needs a real SQL
/// target, under the same rule as <see cref="RequiresDockerFactAttribute"/>.
/// </summary>
public sealed class Gate2FactAttribute : FactAttribute
{
    /// <summary>The <c>PostEngagementReader</c> type B3 adds (implementation.md §2 row 08).</summary>
    private const string EngagementReaderTypeName = "Pulse.WebApi.Features.Social.Engagement.PostEngagementReader";

    /// <summary>Skips the test unless every capability in <paramref name="requires"/> is present.</summary>
    /// <param name="requires">The sibling capabilities the test needs.</param>
    public Gate2FactAttribute(Gate2Capability requires)
    {
        var missing = new List<string>();

        if (requires.HasFlag(Gate2Capability.ReplyIngest)
            && typeof(CreatePostRequest).GetProperty("ParentPostId") is null)
        {
            missing.Add("BP's reply ingest (CreatePostRequest.ParentPostId)");
        }

        if (requires.HasFlag(Gate2Capability.EngagementReader)
            && typeof(Program).Assembly.GetType(EngagementReaderTypeName) is null)
        {
            missing.Add("B3's PostEngagementReader");
        }

        if (missing.Count > 0)
        {
            Skip = $"Gate-2 test (demo-polish B2): waits for {string.Join(" and ", missing)}; it runs automatically once merged.";
            return;
        }

        var localSql = Environment.GetEnvironmentVariable(MsSqlContainerFixture.LocalSqlConnectionEnvVar);
        if (string.IsNullOrWhiteSpace(localSql) && !DockerAvailabilityProbe.IsAvailable)
        {
            Skip = $"No real SQL Server target is available — set {MsSqlContainerFixture.LocalSqlConnectionEnvVar} "
                + "or start a Docker daemon. Reported as Skipped, not Passed.";
        }
    }
}
