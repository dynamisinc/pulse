namespace Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// The easy-participant-login settings, bound from <c>Authentication:EasyLogin</c> by
/// <see cref="EasyLoginFoundationExtensions.AddEasyLoginFoundation"/>. Every value has a safe default
/// (<c>implementation.md</c>, "Configuration"), so an absent section configures the feature as designed; operators
/// raise a limit with an app setting (<c>Authentication__EasyLogin__JoinPermitPerMinute</c>) and no deploy (EL-16).
/// </summary>
/// <remarks>
/// The bound values are validated once at startup (<c>ValidateOnStart</c>): an out-of-range value fails the host
/// loudly on deploy rather than silently moving the day boundary or disabling a rate limit.
/// </remarks>
public sealed class EasyLoginOptions
{
    /// <summary>The configuration section these options bind from (<c>Authentication:EasyLogin</c>).</summary>
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

    /// <summary>The most cards one <c>GET /api/staff/roster/cards</c> may return (story 04). Default 500.</summary>
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
}
