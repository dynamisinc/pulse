namespace Pulse.Core.Features.ResponseReaction.Services;

/// <summary>
/// The response-matching trust curve (ADP-002a open-question-2, §7.2) — how suggestion-with-confirmation
/// earns the right to go automatic, the honest way. It logs each suggestion the controller confirmed or
/// rejected, computes <b>rolling precision within the exercise</b>, and — once precision holds over a
/// sustained window — reports that the console may <b>offer</b> an opt-in auto-confirm. It <b>never enables
/// auto-confirm itself</b>: <see cref="ShouldOfferAutoConfirm"/> is only an offer; a human flips
/// <see cref="EnableAutoConfirm"/> (consistent with the §8.2 rule that automation never self-escalates).
/// No cross-exercise learning (epic §5). One instance per exercise; not thread-safe.
/// </summary>
public sealed class ResponseMatchTrustCurve
{
    /// <summary>Default rolling window (most-recent suggestions) precision is computed over.</summary>
    public const int DefaultWindow = 10;

    /// <summary>Default precision threshold for offering auto-confirm.</summary>
    public const double DefaultPrecisionThreshold = 0.9;

    private readonly List<bool> _outcomes = [];

    /// <summary>Whether a controller has opted in to auto-confirm (only ever set by <see cref="EnableAutoConfirm"/>).</summary>
    public bool AutoConfirmEnabled { get; private set; }

    /// <summary>Total suggestions scored this exercise.</summary>
    public int SuggestionCount => _outcomes.Count;

    /// <summary>Logs one suggestion's outcome: whether the controller confirmed it was correct (Y) or not (N).</summary>
    public void Record(bool correct) => _outcomes.Add(correct);

    /// <summary>
    /// Rolling precision (confirmed-correct / suggested) over the most recent <paramref name="window"/>
    /// suggestions. Zero when there are no suggestions yet.
    /// </summary>
    public double RollingPrecision(int window = DefaultWindow)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(window, 1);
        if (_outcomes.Count == 0)
        {
            return 0.0;
        }

        var take = Math.Min(window, _outcomes.Count);
        var correct = 0;
        for (var i = _outcomes.Count - take; i < _outcomes.Count; i++)
        {
            if (_outcomes[i])
            {
                correct++;
            }
        }

        return (double)correct / take;
    }

    /// <summary>
    /// Whether the console may <b>offer</b> the auto-confirm opt-in: precision holds at/above
    /// <paramref name="precisionThreshold"/> over a full <paramref name="window"/> of suggestions (a
    /// sustained window, not a lucky first few). This is an <i>offer</i> only — never an auto-enable.
    /// </summary>
    public bool ShouldOfferAutoConfirm(
        double precisionThreshold = DefaultPrecisionThreshold,
        int window = DefaultWindow) =>
        !AutoConfirmEnabled
        && _outcomes.Count >= window
        && RollingPrecision(window) >= precisionThreshold;

    /// <summary>A controller opts in to auto-confirm (the only path that enables it — §8.2, never automatic).</summary>
    public void EnableAutoConfirm() => AutoConfirmEnabled = true;

    /// <summary>A controller (or a safety control) turns auto-confirm back off — one-way toward less automation is always allowed.</summary>
    public void DisableAutoConfirm() => AutoConfirmEnabled = false;
}
