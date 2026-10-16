namespace Pulse.LoadTest;

using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

/// <summary>
/// Everything the harness needs, from a JSON file (<c>--config</c>) with command-line overrides. Defaults follow
/// PDF-D3..D5: 20 / 40 / 100 users, 10 minutes each, joins at 25 a minute, noise High, one 20-post burst item and a
/// harness-paced 120 posts/min for 2 minutes per step.
/// </summary>
internal sealed class LoadTestConfig
{
    /// <summary>The hard ceiling on the join pace: the server allows 30 a minute in ONE global bucket (PDF-D3).</summary>
    public const int MaxJoinsPerMinute = 25;

    /// <summary>The exercise name every target must start with (the refusal rule).</summary>
    public const string RequiredNamePrefix = "Load test";

    /// <summary>
    /// The API host bound to the LOAD-TEST exercise (not the demo's host): every participant call, the SignalR hub and
    /// the controller session go here. https on 443, a DNS name (no port, no IP), as the UAT scripts.
    /// </summary>
    public string? ApiHost { get; set; }

    /// <summary>The join-URL file New-LoadTestExercise.ps1 wrote (name,signInName,joinUrl). Never committed.</summary>
    public string? JoinUrlFile { get; set; }

    /// <summary>The demo exercise id: the harness refuses to run against it. Required.</summary>
    public string? DemoExerciseId { get; set; }

    /// <summary>The staff login for the controller session (its secret: PULSE_STAFF_SECRET or a hidden prompt).</summary>
    public string StaffUsername { get; set; } = "controller1";

    /// <summary>Concurrent participants per step.</summary>
    public IReadOnlyList<int> Steps { get; set; } = [20, 40, 100];

    /// <summary>Minutes per step.</summary>
    public double StepMinutes { get; set; } = 10;

    /// <summary>Joins per minute (at most <see cref="MaxJoinsPerMinute"/>).</summary>
    public int JoinsPerMinute { get; set; } = MaxJoinsPerMinute;

    /// <summary>Rows of the join file whose name starts with this are NPC authors, never joined.</summary>
    public string NpcNamePrefix { get; set; } = "Load NPC";

    /// <summary>Where CSV + JSON results go (a timestamped folder is made inside). Git-ignored.</summary>
    public string OutputDirectory { get; set; } = "loadtest-results";

    /// <summary>Participant activity mix.</summary>
    public ActivityMix Activity { get; set; } = new();

    /// <summary>Controller burst settings.</summary>
    public BurstSettings Burst { get; set; } = new();

    /// <summary>Stop rules (PDF-D4).</summary>
    public StopRuleSettings StopRules { get; set; } = new();

    /// <summary>SignalR fan-out thresholds.</summary>
    public FanOutSettings FanOut { get; set; } = new();

    /// <summary>Per-request HTTP timeout in seconds.</summary>
    public int RequestTimeoutSeconds { get; set; } = 30;

    /// <summary>Preflight only: guard checks, join-file parse, controller sign-in; no load.</summary>
    public bool DryRun { get; set; }

    /// <summary>Validates the config. Returns every problem found (empty when it is usable).</summary>
    public IReadOnlyList<string> Validate()
    {
        var problems = new List<string>();
        if (string.IsNullOrWhiteSpace(ApiHost))
        {
            problems.Add("apiHost is required: the host bound to the load-test exercise.");
        }
        else if (!TryNormalizeApiHost(ApiHost, out _, out var hostError))
        {
            problems.Add(hostError);
        }

        if (string.IsNullOrWhiteSpace(JoinUrlFile))
        {
            problems.Add("joinUrlFile is required (written by scripts/uat/New-LoadTestExercise.ps1).");
        }

        if (!Guid.TryParse(DemoExerciseId, out var demo) || demo == Guid.Empty)
        {
            problems.Add("demoExerciseId is required and must be a GUID: the harness refuses to run against it.");
        }

        if (string.IsNullOrWhiteSpace(StaffUsername))
        {
            problems.Add("staffUsername is required.");
        }

        if (Steps.Count == 0 || Steps.Any(s => s < 1 || s > 1000))
        {
            problems.Add("steps must list 1 to 1000 users per step.");
        }
        else if (Steps.Zip(Steps.Skip(1)).Any(pair => pair.Second < pair.First))
        {
            problems.Add("steps must not decrease (users join once and stay).");
        }

        if (StepMinutes is < 1 or > 60)
        {
            problems.Add("stepMinutes must be between 1 and 60.");
        }

        if (JoinsPerMinute is < 1 or > MaxJoinsPerMinute)
        {
            problems.Add($"joinsPerMinute must be between 1 and {MaxJoinsPerMinute} (the join limit is 30/min in one global bucket).");
        }

        problems.AddRange(Activity.Validate());
        problems.AddRange(Burst.Validate(StepMinutes));
        problems.AddRange(StopRules.Validate());
        problems.AddRange(FanOut.Validate());
        if (RequestTimeoutSeconds is < 1 or > 300)
        {
            problems.Add("requestTimeoutSeconds must be between 1 and 300.");
        }

        return problems;
    }

    /// <summary>
    /// The API host as an origin: a bare host gets https://. https on 443 only, a DNS name, no path, query or user info.
    /// Mirrors the UAT scripts' Resolve-ApiHost so a secret-bearing call never travels in the clear.
    /// </summary>
    public static bool TryNormalizeApiHost(string raw, out Uri origin, out string error)
    {
        origin = null!;
        var value = raw.Trim().TrimEnd('/');
        if (!value.Contains("://", StringComparison.Ordinal))
        {
            value = "https://" + value;
        }

        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
        {
            error = $"apiHost '{raw}' is not a host name or an https URL.";
            return false;
        }

        if (uri.Scheme != Uri.UriSchemeHttps)
        {
            error = $"apiHost '{raw}' uses plain http: https only, as the UAT scripts (the staff secret must not travel in the clear).";
            return false;
        }

        // As the UAT scripts' Resolve-ApiHost: a DNS host name on 443, no explicit port (even :443), no IP literal.
        if (System.Text.RegularExpressions.Regex.IsMatch(value, @"^[A-Za-z][A-Za-z0-9+.-]*://[^/?#]*:\d*(?:[/?#]|$)"))
        {
            error = $"apiHost '{raw}' names a port: https on 443 only.";
            return false;
        }

        if (uri.HostNameType != UriHostNameType.Dns)
        {
            error = $"apiHost '{raw}' is an IP address: use the host name bound to the load-test exercise (Pulse resolves the exercise from it).";
            return false;
        }

        if (!string.IsNullOrEmpty(uri.UserInfo) || uri.AbsolutePath != "/" || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment))
        {
            error = $"apiHost '{raw}' must be a host name or an origin, without a path, query or user info.";
            return false;
        }

        origin = new Uri("https://" + uri.IdnHost.ToLowerInvariant() + "/");
        error = string.Empty;
        return true;
    }

    internal static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>
    /// Loads the config: <c>--config file.json</c> first (if given), then every other argument overrides it. Throws
    /// <see cref="ArgumentException"/> with a readable message on an unknown or malformed argument.
    /// </summary>
    public static LoadTestConfig Load(IReadOnlyList<string> args, Func<string, string>? readFile = null)
    {
        readFile ??= File.ReadAllText;
        var config = new LoadTestConfig();

        for (var i = 0; i < args.Count; i++)
        {
            if (args[i] is "--config" or "-c")
            {
                var path = Value(args, ref i);
                config = JsonSerializer.Deserialize<LoadTestConfig>(readFile(path), JsonOptions)
                    ?? throw new ArgumentException($"--config '{path}' is empty.");
            }
        }

        for (var i = 0; i < args.Count; i++)
        {
            var name = args[i];
            switch (name)
            {
                case "--config" or "-c": Value(args, ref i); break;
                case "--api-host": config.ApiHost = Value(args, ref i); break;
                case "--join-urls": config.JoinUrlFile = Value(args, ref i); break;
                case "--demo-exercise-id": config.DemoExerciseId = Value(args, ref i); break;
                case "--staff-username": config.StaffUsername = Value(args, ref i); break;
                case "--steps": config.Steps = ParseSteps(Value(args, ref i)); break;
                case "--step-minutes": config.StepMinutes = ParseDouble(name, Value(args, ref i)); break;
                case "--joins-per-minute": config.JoinsPerMinute = ParseInt(name, Value(args, ref i)); break;
                case "--out": config.OutputDirectory = Value(args, ref i); break;
                case "--burst-posts-per-minute": config.Burst.PostsPerMinute = ParseInt(name, Value(args, ref i)); break;
                case "--burst-minutes": config.Burst.DurationMinutes = ParseDouble(name, Value(args, ref i)); break;
                case "--no-burst-item": config.Burst.FireBurstItem = false; break;
                case "--dry-run": config.DryRun = true; break;
                default: throw new ArgumentException($"Unknown argument '{name}'. Run with --help.");
            }
        }

        return config;
    }

    internal static IReadOnlyList<int> ParseSteps(string raw)
    {
        var parts = raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var steps = new List<int>(parts.Length);
        foreach (var part in parts)
        {
            steps.Add(ParseInt("--steps", part));
        }

        return steps;
    }

    private static string Value(IReadOnlyList<string> args, ref int i)
    {
        if (i + 1 >= args.Count || args[i + 1].StartsWith("--", StringComparison.Ordinal))
        {
            throw new ArgumentException($"{args[i]} needs a value.");
        }

        i++;
        return args[i];
    }

    private static int ParseInt(string name, string value) =>
        int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : throw new ArgumentException($"{name} expects a whole number, not '{value}'.");

    private static double ParseDouble(string name, string value) =>
        double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : throw new ArgumentException($"{name} expects a number, not '{value}'.");
}

/// <summary>What each virtual participant does (the AC's mix; every value configurable).</summary>
internal sealed class ActivityMix
{
    /// <summary>GET /api/feed every N seconds.</summary>
    public double FeedReadSeconds { get; set; } = 30;

    /// <summary>A like or repost about once every N seconds (mean, exponential).</summary>
    public double ReactionMeanSeconds { get; set; } = 60;

    /// <summary>The share of reactions that are reposts (the rest are likes).</summary>
    public double RepostShare { get; set; } = 0.3;

    /// <summary>A post about once every N seconds (mean, exponential).</summary>
    public double PostMeanSeconds { get; set; } = 300;

    /// <summary>The share of a participant's posts that are replies to a feed post.</summary>
    public double ReplyShare { get; set; } = 0.25;

    public IEnumerable<string> Validate()
    {
        if (FeedReadSeconds is < 1 or > 3600) { yield return "activity.feedReadSeconds must be between 1 and 3600."; }
        if (ReactionMeanSeconds is < 1 or > 36000) { yield return "activity.reactionMeanSeconds must be between 1 and 36000."; }
        if (PostMeanSeconds is < 1 or > 36000) { yield return "activity.postMeanSeconds must be between 1 and 36000."; }
        if (RepostShare is < 0 or > 1) { yield return "activity.repostShare must be between 0 and 1."; }
        if (ReplyShare is < 0 or > 1) { yield return "activity.replyShare must be between 0 and 1."; }
    }
}

/// <summary>The controller's per-step load (PDF-D5, amended).</summary>
internal sealed class BurstSettings
{
    /// <summary>Set white noise to High at the start of each step.</summary>
    public bool NoiseHigh { get; set; } = true;

    /// <summary>Fire one 20-post burst item per step (exercises the burst runner).</summary>
    public bool FireBurstItem { get; set; } = true;

    /// <summary>Burst items are found by this title prefix (New-LoadTestExercise.ps1 creates them).</summary>
    public string BurstItemTitlePrefix { get; set; } = "Load burst";

    /// <summary>Minutes into the step when the burst item fires.</summary>
    public double BurstItemAtMinute { get; set; } = 1;

    /// <summary>Minutes into the step when the paced controller-as-persona writes start.</summary>
    public double PacedStartMinute { get; set; } = 2;

    /// <summary>The harness-paced write rate (NFR-002 bar: 120/min, one every 0.5 s).</summary>
    public int PostsPerMinute { get; set; } = 120;

    /// <summary>How long the paced writes run.</summary>
    public double DurationMinutes { get; set; } = 2;

    public IEnumerable<string> Validate(double stepMinutes)
    {
        if (PostsPerMinute is < 0 or > 600) { yield return "burst.postsPerMinute must be between 0 and 600."; }
        if (DurationMinutes < 0) { yield return "burst.durationMinutes must be 0 or more."; }
        if (PacedStartMinute < 0 || PacedStartMinute + DurationMinutes > stepMinutes)
        {
            yield return "burst.pacedStartMinute + burst.durationMinutes must fit inside the step.";
        }

        if (BurstItemAtMinute < 0 || BurstItemAtMinute > stepMinutes) { yield return "burst.burstItemAtMinute must fall inside the step."; }
        if (string.IsNullOrWhiteSpace(BurstItemTitlePrefix)) { yield return "burst.burstItemTitlePrefix is required."; }
    }
}

/// <summary>PDF-D4: abort a step when the error rate is above 5% or POST p95 above 5 s, sustained for 60 s.</summary>
internal sealed class StopRuleSettings
{
    public double MaxErrorRate { get; set; } = 0.05;

    public double MaxPostP95Ms { get; set; } = 5000;

    public double SustainSeconds { get; set; } = 60;

    /// <summary>
    /// The short trailing window each tick's rates are computed over. Kept well under <see cref="SustainSeconds"/>, so
    /// "sustained for 60 s" means 60 s of breach, not a few seconds of errors stretched by a long lookback.
    /// </summary>
    public double WindowSeconds { get; set; } = 15;

    /// <summary>
    /// Fewer requests than this in the window never count as evidence. 10 in 15 s: 20 users make about 15 requests in
    /// 15 s outside the burst (feed every 30 s, a reaction a minute).
    /// </summary>
    public int MinSamples { get; set; } = 10;

    public IEnumerable<string> Validate()
    {
        if (MaxErrorRate is <= 0 or > 1) { yield return "stopRules.maxErrorRate must be above 0 and at most 1."; }
        if (MaxPostP95Ms <= 0) { yield return "stopRules.maxPostP95Ms must be above 0."; }
        if (SustainSeconds < 0) { yield return "stopRules.sustainSeconds must be 0 or more."; }
        if (WindowSeconds <= 0) { yield return "stopRules.windowSeconds must be above 0."; }
        if (SustainSeconds > 0 && WindowSeconds > SustainSeconds) { yield return "stopRules.windowSeconds must not exceed stopRules.sustainSeconds."; }
        if (MinSamples < 1) { yield return "stopRules.minSamples must be at least 1."; }
    }
}

/// <summary>When a PostReceived frame counts as late, and when a missing one counts as dropped.</summary>
internal sealed class FanOutSettings
{
    public double LateAfterSeconds { get; set; } = 2;

    public double DroppedAfterSeconds { get; set; } = 30;

    public IEnumerable<string> Validate()
    {
        if (LateAfterSeconds <= 0) { yield return "fanOut.lateAfterSeconds must be above 0."; }
        if (DroppedAfterSeconds <= LateAfterSeconds) { yield return "fanOut.droppedAfterSeconds must be above lateAfterSeconds."; }
    }
}
