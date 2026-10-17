namespace Pulse.WebApi.Tests.Features.EngineEval.ReactionCorrectness;

using System.Linq;

/// <summary>Shared scripted official-post texts so every scenario means the same thing by "an answer" and "a non-answer".</summary>
internal static class ScenarioScripts
{
    /// <summary>
    /// A genuine answer to the default storyline: it carries the storyline's hashtag, so the matcher scores it
    /// 0.9 confidence (well over the 0.3 match threshold).
    /// </summary>
    public const string AnsweringPost = "County update on #WaterIssues: do not drink tap water until further notice.";

    /// <summary>
    /// A real official post that has nothing to do with any storyline (the PIO is busy with something else). It
    /// must never calm the world, and must never be mistaken for silence either.
    /// </summary>
    public const string UnrelatedPost = "Reminder: the Elm Street farmers market opens Saturday at 8am.";

    /// <summary>
    /// A plausible-but-not-certain official post: it names the concern's subject without the tag. Scores in the
    /// "needs the controller's Y/N" band (at/over the threshold) rather than as a confident match.
    /// </summary>
    public const string PlausiblePost = "Statement from the county about the water: crews are investigating.";

    /// <summary>
    /// Reads the "Target emotional mix for this burst" line out of an assembled generation prompt into
    /// tone-name to weight (tones the prompt omitted because they are ~0 are absent). This is the tone the
    /// PROVIDER was actually asked for, as opposed to the tone the decide stage logged.
    /// </summary>
    public static System.Collections.Generic.Dictionary<string, double> PromptMix(Pulse.Core.Features.Generation.Models.GenerationRequest request)
    {
        var line = request.SystemPrompt.Split('\n')
            .Single(l => l.StartsWith("Target emotional mix for this burst:", System.StringComparison.Ordinal));
        return line["Target emotional mix for this burst:".Length..]
            .Split(',', System.StringSplitOptions.TrimEntries | System.StringSplitOptions.RemoveEmptyEntries)
            .Select(part => part.Split(' ', System.StringSplitOptions.RemoveEmptyEntries))
            .ToDictionary(p => p[0], p => double.Parse(p[1], System.Globalization.CultureInfo.InvariantCulture));
    }
}
