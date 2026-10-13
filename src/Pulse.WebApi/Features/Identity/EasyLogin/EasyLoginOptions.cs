namespace Pulse.WebApi.Features.Identity.EasyLogin;

using System.Globalization;
using Microsoft.Extensions.Configuration;

/// <summary>
/// The easy-participant-login settings, read from <c>Authentication:EasyLogin</c> by
/// <see cref="EasyLoginFoundationExtensions.AddEasyLoginFoundation"/>. Every value has a safe default
/// (<c>implementation.md</c>, "Configuration"), so an absent section configures the feature as designed; operators
/// raise a limit with an app setting (<c>Authentication__EasyLogin__JoinPermitPerMinute</c>) and no deploy (EL-16).
/// </summary>
/// <remarks>
/// <para>
/// <b>Configuration can never take the API down (review W-2).</b> Each key is read on its own with an invariant
/// <c>int.TryParse</c>, never through the configuration binder (which throws on non-numeric text). A value that is
/// missing or blank uses the default silently; a value that is non-numeric or out of range ALSO uses the default, and
/// <see cref="EasyLoginOptionsStartupCheck"/> logs a warning once at startup naming the key (never the value).
/// </para>
/// <para>
/// <b>Read these through <c>IOptions&lt;EasyLoginOptions&gt;</c></b> (or <see cref="FromConfiguration"/> where no
/// container is at hand). Never bind the section yourself: that would bypass the clamp, and the rate-limit policies
/// stories 03 and 05 build must see the same values the rest of the feature does.
/// </para>
/// </remarks>
public sealed class EasyLoginOptions
{
    /// <summary>The configuration section these options are read from (<c>Authentication:EasyLogin</c>).</summary>
    public const string SectionName = "Authentication:EasyLogin";

    /// <summary>The latest allowed <see cref="DayRolloverHour"/> (the exercise day may roll over between midnight and 06:00).</summary>
    public const int MaxDayRolloverHour = 6;

    /// <summary>Per-IP permits per minute on <c>POST /api/auth/join</c> (the <c>easy-login-join</c> policy, story 03). Default 30.</summary>
    public int JoinPermitPerMinute { get; set; } = 30;

    /// <summary>Per-IP permits per minute on <c>POST /api/auth/word</c> (the <c>easy-login-word</c> policy, story 05). Default 10.</summary>
    public int WordPermitPerMinute { get; set; } = 10;

    /// <summary>
    /// The local hour (exercise time zone) at which one exercise day ends and the next begins: 0 (midnight, the
    /// default) to <see cref="MaxDayRolloverHour"/>. Used by the day word (story 05) and the participant session
    /// cap (story 06) through <see cref="ExerciseDay"/>.
    /// </summary>
    public int DayRolloverHour { get; set; }

    /// <summary>The most participant ids one <c>POST /api/staff/roster/cards</c> <c>{ participantIds }</c> body may name (story 04, EL-20). Default 500. <c>{ all: true }</c> is uncapped.</summary>
    public int MaxCardsPerRequest { get; set; } = 500;

    /// <summary>
    /// Whether every value is in range: <see cref="DayRolloverHour"/> within 0 to <see cref="MaxDayRolloverHour"/>
    /// and every permit / cap positive.
    /// </summary>
    /// <returns><c>true</c> when the options are usable.</returns>
    public bool IsValid() =>
        DayRolloverHour is >= 0 and <= MaxDayRolloverHour
        && JoinPermitPerMinute > 0
        && WordPermitPerMinute > 0
        && MaxCardsPerRequest > 0;

    /// <summary>
    /// Reads the options from <paramref name="configuration"/> with clamp-to-default: a missing, blank, non-numeric or
    /// out-of-range value takes its default. Never throws on bad configuration. This is exactly what
    /// <c>IOptions&lt;EasyLoginOptions&gt;</c> holds.
    /// </summary>
    /// <param name="configuration">The application configuration (the root, not the section).</param>
    /// <returns>Options that always satisfy <see cref="IsValid"/>.</returns>
    public static EasyLoginOptions FromConfiguration(IConfiguration configuration) => Read(configuration, rejectedKeys: null);

    /// <summary>The full keys (for example <c>Authentication:EasyLogin:DayRolloverHour</c>) whose configured value was refused.</summary>
    internal static IReadOnlyList<string> FindRejectedKeys(IConfiguration configuration)
    {
        var rejected = new List<string>();
        Read(configuration, rejected);
        return rejected;
    }

    /// <summary>Copies another instance's values onto this one (the options pipeline configures an existing instance).</summary>
    internal void CopyFrom(EasyLoginOptions source)
    {
        JoinPermitPerMinute = source.JoinPermitPerMinute;
        WordPermitPerMinute = source.WordPermitPerMinute;
        DayRolloverHour = source.DayRolloverHour;
        MaxCardsPerRequest = source.MaxCardsPerRequest;
    }

    private static EasyLoginOptions Read(IConfiguration configuration, List<string>? rejectedKeys)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        var defaults = new EasyLoginOptions();
        return new EasyLoginOptions
        {
            JoinPermitPerMinute = ReadInt(
                configuration, nameof(JoinPermitPerMinute), defaults.JoinPermitPerMinute, value => value > 0, rejectedKeys),
            WordPermitPerMinute = ReadInt(
                configuration, nameof(WordPermitPerMinute), defaults.WordPermitPerMinute, value => value > 0, rejectedKeys),
            DayRolloverHour = ReadInt(
                configuration, nameof(DayRolloverHour), defaults.DayRolloverHour, value => value is >= 0 and <= MaxDayRolloverHour, rejectedKeys),
            MaxCardsPerRequest = ReadInt(
                configuration, nameof(MaxCardsPerRequest), defaults.MaxCardsPerRequest, value => value > 0, rejectedKeys),
        };
    }

    private static int ReadInt(
        IConfiguration configuration,
        string name,
        int fallback,
        Func<int, bool> isInRange,
        List<string>? rejectedKeys)
    {
        var key = $"{SectionName}:{name}";
        var raw = configuration[key];
        if (string.IsNullOrWhiteSpace(raw))
        {
            return fallback;
        }

        if (int.TryParse(raw.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) && isInRange(value))
        {
            return value;
        }

        rejectedKeys?.Add(key);
        return fallback;
    }
}
