using Pulse.LoadTest;

// Pulse load-test harness (post-demo-feedback/01, #547). See README.md.
if (args.Contains("--help") || args.Contains("-h"))
{
    Console.WriteLine("""
        Pulse.LoadTest — drives a throwaway "Load test" exercise and writes CSV + JSON results.

          dotnet run --project tools/Pulse.LoadTest -- --config loadtest.json [overrides]

        Overrides:
          --api-host <host>            host bound to the LOAD-TEST exercise (https; http for localhost only)
          --join-urls <file>           join-URL file from scripts/uat/New-LoadTestExercise.ps1
          --demo-exercise-id <guid>    the demo exercise: the harness refuses to run against it (required)
          --staff-username <name>      controller login (secret: PULSE_STAFF_SECRET or a hidden prompt)
          --steps 20,40,100            users per step        --step-minutes 10
          --joins-per-minute 25        at most 25            --out <dir>  (default loadtest-results)
          --burst-posts-per-minute 120 --burst-minutes 2     --no-burst-item
          --dry-run                    preflight only (refusal checks, join file, sign-in); no load

        Exit codes: 0 completed, 1 refused or failed, 2 a stop rule ended the run, 130 interrupted.
        Ctrl+C stops the load, turns noise off, closes connections and writes a partial summary.
        """);
    return 0;
}

LoadTestConfig config;
try
{
    config = LoadTestConfig.Load(args);
}
catch (Exception ex) when (ex is ArgumentException or IOException or System.Text.Json.JsonException or UnauthorizedAccessException)
{
    Console.Error.WriteLine($"FAIL {ex.Message}");
    return 1;
}

using var cancel = new CancellationTokenSource();
var presses = 0;
Console.CancelKeyPress += (_, e) =>
{
    // First Ctrl+C: graceful stop (noise off, close, partial summary). Second: hard exit.
    if (Interlocked.Increment(ref presses) == 1)
    {
        e.Cancel = true;
        cancel.Cancel();
    }
};

using var runner = new LoadTestRunner(config, StaffSecret.Read(config.StaffUsername), Console.Out);
try
{
    return await runner.RunAsync(cancel.Token);
}
catch (InvalidOperationException ex)
{
    Console.Error.WriteLine($"FAIL {ex.Message}");
    return 1;
}

/// <summary>The staff secret: PULSE_STAFF_SECRET, otherwise a hidden prompt. Never echoed or logged.</summary>
internal static class StaffSecret
{
    public static Func<string?> Read(string username) => () =>
    {
        var fromEnv = Environment.GetEnvironmentVariable("PULSE_STAFF_SECRET");
        if (!string.IsNullOrEmpty(fromEnv))
        {
            return fromEnv;
        }

        if (Console.IsInputRedirected)
        {
            return null;
        }

        Console.Write($"Staff secret for '{username}' (hidden; Copy-StaffSecret.ps1 {username} puts it on the clipboard): ");
        var buffer = new System.Text.StringBuilder();
        while (true)
        {
            var key = Console.ReadKey(intercept: true);
            if (key.Key == ConsoleKey.Enter)
            {
                break;
            }

            if (key.Key == ConsoleKey.Backspace)
            {
                if (buffer.Length > 0)
                {
                    buffer.Length--;
                }

                continue;
            }

            if (!char.IsControl(key.KeyChar))
            {
                buffer.Append(key.KeyChar);
            }
        }

        Console.WriteLine();
        var secret = buffer.ToString();
        buffer.Clear();
        return secret;
    };
}
