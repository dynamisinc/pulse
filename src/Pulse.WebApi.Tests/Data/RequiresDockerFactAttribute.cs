namespace Pulse.WebApi.Tests.Data;

using System;
using System.Diagnostics;

/// <summary>
/// Gate-1 review finding W-001: xUnit 2.9.3's <c>Assert</c> has no public dynamic-skip API (that arrived in
/// xUnit v3) — so a machine with no real SQL Server target can't be told apart from a genuine failure via a
/// runtime <c>Assert.Skip(...)</c> call. This attribute gets the same observable effect (a real
/// <c>Skipped</c> — not <c>Passed</c> — outcome) the only way xUnit 2.x supports a *conditional* skip: by
/// setting the inherited, writable <see cref="Xunit.FactAttribute.Skip"/> property in the attribute's own
/// constructor, which runs at TEST DISCOVERY time, before any test body or fixture executes.
/// </summary>
/// <remarks>
/// <para>
/// <b>Two ways to satisfy the gate</b> (either lets the test run; the name is kept for stability across its
/// ~300 call sites even though "Docker" is now only one of the two options):
/// </para>
/// <list type="number">
/// <item>Set <see cref="MsSqlContainerFixture.LocalSqlConnectionEnvVar"/> (<c>PULSE_TEST_SQL_CONNECTION</c>)
/// to a SQL Server / LocalDB connection string — the Docker-free local path
/// (<see cref="MsSqlContainerFixture"/> targets it, creating an ephemeral per-run database). Checked FIRST,
/// so no <c>docker info</c> probe runs when a real SQL target is already configured.</item>
/// <item>Otherwise, a reachable Docker daemon (<see cref="DockerAvailabilityProbe"/>: a fast, best-effort
/// <c>docker info</c>) — CI's path, for Testcontainers.MsSql.</item>
/// </list>
/// <para>
/// The discovery-time check only answers "is a real SQL target available at all" — it does NOT try to start
/// the container or run the migration. That distinction is deliberate (Gate-1 W-001): "no SQL target at all"
/// is what this attribute skips; "a target is present but the container/DB start or migration genuinely
/// fails" is a real infrastructure or product break that must FAIL the suite, which is why
/// <see cref="MsSqlContainerFixture.InitializeAsync"/> does not swallow that case — a test class whose
/// collection fixture throws during initialization is reported as a failing test, not a skipped one.
/// </para>
/// <para>
/// Applied to every test that needs the shared MSSQL fixture, in place of a plain <c>[Fact]</c>. Model-only
/// tests (<c>TelemetrySchemaParityTests</c>) never touch a database and keep using <c>[Fact]</c>.
/// </para>
/// </remarks>
public sealed class RequiresDockerFactAttribute : FactAttribute
{
    public RequiresDockerFactAttribute()
    {
        // A local SQL Server connection string (e.g. LocalDB) lets these real-SQL tests run WITHOUT Docker;
        // checked first so a configured local target skips the Docker probe entirely.
        var localSql = Environment.GetEnvironmentVariable(MsSqlContainerFixture.LocalSqlConnectionEnvVar);
        if (!string.IsNullOrWhiteSpace(localSql))
        {
            return;
        }

        if (!DockerAvailabilityProbe.IsAvailable)
        {
            Skip = "No real SQL Server target is available — set " +
                   $"{MsSqlContainerFixture.LocalSqlConnectionEnvVar} to a SQL Server/LocalDB connection " +
                   "string (Docker-free local path), or start a Docker daemon for Testcontainers.MsSql " +
                   "(`docker info` failed). Reported as Skipped, not Passed (Gate-1 W-001): it must not " +
                   "silently pass with no database to prove against.";
        }
    }
}

/// <summary>
/// A cheap, once-per-test-run probe for "is the Docker daemon reachable at all" — deliberately simpler
/// than actually starting a container (that's <see cref="MsSqlContainerFixture"/>'s job, and its failures
/// are a different, non-skippable case per Gate-1 W-001). Shells out to the <c>docker</c> CLI rather than
/// depending on Docker.DotNet's client wiring directly, so this has no opinion about which Docker endpoint
/// (Unix socket, named pipe, <c>DOCKER_HOST</c>) is in play — whatever `docker info` itself resolves to.
/// </summary>
internal static class DockerAvailabilityProbe
{
    private static readonly Lazy<bool> IsAvailableLazy = new(Probe);

    public static bool IsAvailable => IsAvailableLazy.Value;

    private static bool Probe()
    {
        try
        {
            using var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "docker",
                    Arguments = "info",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                },
            };

            if (!process.Start())
            {
                return false;
            }

            var exited = process.WaitForExit(TimeSpan.FromSeconds(10));
            if (!exited)
            {
                TryKill(process);
                return false;
            }

            return process.ExitCode == 0;
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            // `docker` isn't even on PATH, or the process couldn't be started — Docker is unreachable.
            return false;
        }
    }

    private static void TryKill(Process process)
    {
        try
        {
            process.Kill(entireProcessTree: true);
        }
        catch (InvalidOperationException)
        {
            // Already exited between the timeout and the kill attempt — nothing to do.
        }
    }
}
