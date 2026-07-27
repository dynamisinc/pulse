namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;

using System;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// The <see cref="TheoryAttribute"/> sibling of <see cref="RequiresDockerFactAttribute"/>: a parameterized
/// test that needs the shared real-SQL fixture and must SKIP cleanly (a real <c>Skipped</c> outcome, not a
/// silent <c>Passed</c>) where neither <c>PULSE_TEST_SQL_CONNECTION</c> nor a reachable Docker daemon exists.
/// </summary>
/// <remarks>
/// <para>
/// Same two ways to satisfy the gate, same discovery-time mechanism, and the same deliberate limitation as
/// the Fact attribute: it only answers "is a real SQL target available at all". A target that IS present but
/// whose container/DB start or migration fails is a genuine break and must fail loudly, which is why
/// <see cref="MsSqlContainerFixture.InitializeAsync"/> does not swallow it.
/// </para>
/// <para>
/// <b>Why it lives here and not beside its Fact sibling.</b> The lifecycle suite is the first in the repo to
/// need a SQL-backed <c>[Theory]</c> (a plain one inside <c>MsSqlCollection</c> hard-fails on a Docker-less
/// box — the Gate-2 finding), and wave-3 branches must stay file-disjoint, so it is authored in this story's
/// own folder. Re-homing it next to <see cref="RequiresDockerFactAttribute"/> in <c>Data/</c> is a safe
/// tidy-up once the wave has merged.
/// </para>
/// </remarks>
public sealed class RequiresDockerTheoryAttribute : TheoryAttribute
{
    /// <summary>Decides the skip at test-DISCOVERY time, before any fixture is constructed.</summary>
    public RequiresDockerTheoryAttribute()
    {
        var localSql = Environment.GetEnvironmentVariable(MsSqlContainerFixture.LocalSqlConnectionEnvVar);
        if (!string.IsNullOrWhiteSpace(localSql))
        {
            return;
        }

        if (!DockerAvailabilityProbe.IsAvailable)
        {
            Skip = "No real SQL Server target is available — set " +
                   $"{MsSqlContainerFixture.LocalSqlConnectionEnvVar} to a SQL Server/LocalDB connection " +
                   "string (Docker-free local path), or start a Docker daemon for Testcontainers.MsSql. " +
                   "Reported as Skipped, not Passed (Gate-1 W-001).";
        }
    }
}
