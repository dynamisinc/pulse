using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Storylines.Models;
using Pulse.Core.Features.Storylines.Services;

// A developer harness to watch the storyline model (E8) behave with no UI/API in front of it.
// It advances a fake scenario clock and prints phase / intensity / sentiment each step. There is no
// runtime yet (no reaction-loop, no E7 cockpit, no E2 publish) — this drives the pure domain model by
// hand so you can feel how it reacts to silence, amplification, a matched response, and the dial.

var clock = new Clock();
var exercise = Guid.NewGuid();

Section("SCENARIO A — silence escalates, a matched response calms it, then it resolves");

var water = Storyline.Create(
    exercise,
    title: "Water main contamination fears",
    expectation: "County issues a boil-water advisory",
    curveName: "Standard",
    responseWindowMin: 15,
    initialIntensity: 30,
    participatingPersonas: ["@riverside_mom", "@ktla_dan", "@county_helper"],
    hashtags: ["#WaterCrisis", "#BoilWater"]);

water.Seed(0);
Print(water, "seeded (armed; silence window = 15 scenario min)");

Tick(water, 5, "5 min of official silence");
Tick(water, 15, "window elapses → escalation opens");
Tick(water, 20, "still no response — climbing");

// A rumor gets amplified: high velocity, big-audience account. Watch intensity bend up faster.
var amplified = new StorylineTickSignals { Amplification = new AmplificationSignal(Velocity: 0.9, AudienceBand: 7) };
Tick(water, 24, "an influencer amplifies it (velocity 0.9, audience 7)", amplified);
Tick(water, 28, "amplification continues", amplified);

Console.WriteLine();
Console.WriteLine("  What the generation prompt would receive right now (StorylineBrief):");
PrintBrief(water.ToBrief());
Console.WriteLine();

// The PIO finally posts the advisory — a matched official response.
var responded = water.RecordMatchedResponse(scenarioMinute: 32);
Console.WriteLine($"  >> t=32  PIO posts the advisory — RecordMatchedResponse() " +
                  $"[{string.Join(", ", responded.Select(Describe))}]");
Print(water, "addressed — intensity bent down, silence clock reset");

Tick(water, 40, "decaying");
Tick(water, 55, "decaying");
Tick(water, 80, "decaying");
Tick(water, 120, "burns out → resolved");

Section("SCENARIO B — the controller drives the dial (CTL-022)");

var protest = Storyline.Create(
    exercise, "Protest forming downtown", "EOC confirms road closures",
    curveName: "Flash panic", responseWindowMin: 5, initialIntensity: 20,
    hashtags: ["#Downtown"]);
protest.Seed(0);
protest.Tick(clock.At(5));   // open
protest.Tick(clock.At(9));   // let it run hot on the flash-panic curve
Print(protest, "running hot on the Flash panic curve");

// Controller decides it's too hot: dial the target down to 40.
var lowered = protest.SetTargetIntensity(40, scenarioMinute: 9);
Console.WriteLine($"  >> t=9   controller sets dial target 40  [{DescribeSteering(lowered)}]");
ShowModulation(protest);
Tick(protest, 12, "engine tapers toward the target");
Tick(protest, 16, "…");
Tick(protest, 22, "holds near the target (no overshoot)");

// Now raise the target back up: the engine drives up, bounded by the rate cap.
var raised = protest.SetTargetIntensity(85, scenarioMinute: 22);
Console.WriteLine($"  >> t=22  controller raises dial target to 85  [{DescribeSteering(raised)}]");
ShowModulation(protest, RateGovernanceConfig.Default);
Tick(protest, 26, "engine drives back up toward 85");
Tick(protest, 32, "…");
Tick(protest, 40, "reaches and holds the target");

Section("SCENARIO C — exercise-wide sentiment + rate governance");

var mood = SentimentModel.Aggregate([water, protest]);
Console.WriteLine($"  Exercise-wide sentiment (intensity-weighted): {mood,+6:0.00}   {SentimentBar(mood)}");

var gov = new ExerciseRateGovernor(exercise); // default cap 60/min, floor 6/min
var cap = gov.WithinCap(postsThisMinute: 58, requestedCount: 5);
Console.WriteLine($"  Rate cap: 58 posts already this minute, engine wants 5 more → " +
                  $"allowed {cap.Allowed}, throttled {cap.Throttled} (cap {gov.Current.MaxEnginePostsPerMinute}/min)");
Console.WriteLine($"  Quiet floor: only 2 posts this minute → belowFloor={gov.BelowFloor(2)}, " +
                  $"ambient deficit={gov.AmbientDeficit(2)} (floor {gov.Current.MinBelievableActivity}/min)");

Console.WriteLine();
Console.WriteLine("Done. This is the pure domain model; the reaction-loop, E7 cockpit and E2 publish will drive it for real.");

// ---- helpers --------------------------------------------------------------------------------

void Tick(Storyline s, int minute, string note, StorylineTickSignals? signals = null)
{
    var result = s.Tick(clock.At(minute), signals);
    var transitions = result.StateChanges.Any()
        ? "  " + string.Join(", ", result.StateChanges.Select(c => $"{c.From}→{c.To}({c.Cause})"))
        : string.Empty;
    Print(s, note + transitions);
}

void Print(Storyline s, string note)
{
    Console.WriteLine(
        $"  t={s.LastTickScenarioMinute,3}  {s.Phase,-11}  " +
        $"I={s.Intensity,3} {IntensityBar(s.Intensity)}  " +
        $"S={s.Sentiment,+5:0.0} {SentimentBar(s.Sentiment)}  " +
        $"silence={s.MinutesSinceLastOfficialResponse,3}m   {note}");
}

void PrintBrief(StorylineBrief b)
{
    Console.WriteLine($"    title      : {b.Title}");
    Console.WriteLine($"    expectation: {b.Expectation}");
    Console.WriteLine($"    phase      : {b.Phase}   intensity {b.Intensity}   silence {b.MinutesSinceLastOfficialResponse}m");
    Console.WriteLine($"    hashtags   : {string.Join(" ", b.Hashtags)}");
    Console.WriteLine($"    tone mix   : worry {b.ToneMix.Worry:0.00}  anger {b.ToneMix.Anger:0.00}  " +
                      $"speculation {b.ToneMix.Speculation:0.00}  gratitude {b.ToneMix.Gratitude:0.00}  " +
                      $"skepticism {b.ToneMix.Skepticism:0.00}  calm {b.ToneMix.Calm:0.00}");
}

void ShowModulation(Storyline s, RateGovernanceConfig? cap = null)
{
    var m = TargetFollow.Modulate(s, cap);
    var posts = m.SuggestedPostCount > 0 ? $", suggest {m.SuggestedPostCount} posts" : string.Empty;
    Console.WriteLine($"          decide-stage intent: {m.Direction} (gap {m.Gap:+0;-0;0}{posts})");
}

static string Describe(IStorylineEvent e) => e switch
{
    StorylineStateChanged c => $"{c.From}→{c.To}",
    StorylineMeasured m => $"measured Δ{m.IntensityDelta:+0;-0;0} ({m.Cause})",
    _ => e.GetType().Name,
};

static string DescribeSteering(SteeringActionLogged s) => $"{s.Kind}: {s.Detail}";

static string IntensityBar(int intensity)
{
    var filled = (int)Math.Round(intensity / 5.0);
    return "[" + new string('#', filled) + new string('.', 20 - filled) + "]";
}

static string SentimentBar(double s)
{
    // −1..+1 mapped onto a 9-cell gauge with the midpoint at 0.
    var cell = Math.Clamp((int)Math.Round((s + 1) / 2 * 8), 0, 8);
    var chars = new char[9];
    Array.Fill(chars, '-');
    chars[4] = '|';
    chars[cell] = s < -0.05 ? '<' : s > 0.05 ? '>' : '|';
    return new string(chars);
}

void Section(string title)
{
    Console.WriteLine();
    Console.WriteLine(new string('=', 96));
    Console.WriteLine("  " + title);
    Console.WriteLine(new string('=', 96));
}

// A hand-cranked scenario clock — the reaction loop will supply the real one (E1).
sealed class Clock : IScenarioClock
{
    public int CurrentScenarioMinute { get; private set; }

    public Clock At(int minute)
    {
        CurrentScenarioMinute = minute;
        return this;
    }
}
