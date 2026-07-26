namespace Pulse.WebApi.Features.ExerciseConfiguration.Chrome;

using System.Diagnostics.CodeAnalysis;

/// <summary>
/// The NFR-008 / COR-031 / XC-003 MUTUAL GUARD, in ONE place: compliance chrome and the in-content
/// "EXERCISE" watermark are never BOTH off. Turning either one off alone is legal (chrome-off is an
/// explicitly sanctioned per-exercise state, D7-008); turning off the last remaining exercise marking is not.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why one type rather than an <c>if</c> at the write boundary.</b> The invariant has two enforcement
/// points and they must never drift apart:
/// </para>
/// <list type="number">
/// <item>
/// <b>The write path</b> (<see cref="ChromeSettingsService"/>) calls <see cref="TryValidate"/> BEFORE anything
/// is applied, so an attempt to leave an exercise with no marking at all is a <c>400</c> and NOTHING is
/// persisted — and it holds regardless of what the client sends, because both switches arrive on the same
/// full-replace body and are checked together. There is no other writer: story 01b's
/// <c>PUT /api/staff/exercise-settings</c> deliberately touches none of the chrome or watermark columns, so
/// this is the single write boundary for both.
/// </item>
/// <item>
/// <b>The read path</b> (<see cref="ChromeConfigProjection"/>) applies the SAME invariant through
/// <see cref="ResolveEffectiveChromeEnabled"/>. A row that somehow carries both switches off — a hand-edited
/// database, a restore from a system that predates this guard — must not serve an unmarked participant world;
/// it degrades to chrome VISIBLE. Failing closed here means the invariant is a property of what participants
/// see, not merely of what this API accepts.
/// </item>
/// </list>
/// <para>
/// <b>Why the read path forces chrome on rather than the watermark.</b> The watermark's renderer is an NFR-008
/// fast-follow in participant content; this story only reads its on/off state. Chrome is the marking that
/// actually ships today (<c>ComplianceChrome.tsx</c>), so it is the one that can be relied on to appear.
/// </para>
/// <para>
/// A pure static function type — no state, no DI registration, no database access.
/// </para>
/// </remarks>
public static class ComplianceChromeGuard
{
    /// <summary>
    /// The single rejection message the write path returns with its <c>400</c>. It names both switches and
    /// the rule, so a planner reading it knows which one to turn back on.
    /// </summary>
    public const string BothOffMessage =
        "Compliance chrome and the in-content EXERCISE watermark must not both be off (NFR-008). "
        + "Turn one of them on: an exercise always carries at least one exercise marking.";

    /// <summary>
    /// Whether a chrome/watermark pair satisfies the NFR-008 invariant — i.e. at least one marking is on.
    /// </summary>
    /// <param name="complianceChromeEnabled">Whether the compliance-chrome banners are on.</param>
    /// <param name="watermarkEnabled">Whether the in-content EXERCISE watermark is on.</param>
    /// <returns><c>true</c> when at least one exercise marking remains.</returns>
    public static bool IsSatisfied(bool complianceChromeEnabled, bool watermarkEnabled) =>
        complianceChromeEnabled || watermarkEnabled;

    /// <summary>
    /// The WRITE-path check: validates a requested chrome/watermark pair, yielding the human-readable reason
    /// the endpoint returns as a <c>400</c> when the pair would leave the exercise unmarked.
    /// </summary>
    /// <param name="complianceChromeEnabled">The requested compliance-chrome state.</param>
    /// <param name="watermarkEnabled">The requested watermark state.</param>
    /// <param name="error">The rejection reason when the pair is refused.</param>
    /// <returns><c>true</c> when the pair may be persisted.</returns>
    public static bool TryValidate(
        bool complianceChromeEnabled,
        bool watermarkEnabled,
        [NotNullWhen(false)] out string? error)
    {
        if (IsSatisfied(complianceChromeEnabled, watermarkEnabled))
        {
            error = null;
            return true;
        }

        error = BothOffMessage;
        return false;
    }

    /// <summary>
    /// The READ-path application: the compliance-chrome <c>enabled</c> value actually served for a stored
    /// chrome/watermark pair. Chrome-off is honoured while the watermark is on; a stored pair that is BOTH off
    /// violates NFR-008 and is served as chrome ON, so a participant surface is never left unmarked.
    /// </summary>
    /// <param name="storedComplianceChromeEnabled">The exercise's stored compliance-chrome switch.</param>
    /// <param name="storedWatermarkEnabled">The exercise's stored watermark switch.</param>
    /// <returns>The <c>enabled</c> value to serve on the frozen chrome-config body.</returns>
    public static bool ResolveEffectiveChromeEnabled(
        bool storedComplianceChromeEnabled,
        bool storedWatermarkEnabled) =>
        storedComplianceChromeEnabled || !storedWatermarkEnabled;
}
