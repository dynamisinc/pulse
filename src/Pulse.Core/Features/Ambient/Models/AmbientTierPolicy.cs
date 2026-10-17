namespace Pulse.Core.Features.Ambient.Models;

/// <summary>
/// How an exercise's ambient chatter (ADP-005, ambient-chatter story 01) runs. A controller picks it; the engine
/// never raises it itself (§8.2).
/// </summary>
public enum AmbientPolicyMode
{
    /// <summary>No ambient content is generated or published. The default for every exercise, and after any restart.</summary>
    Off = 0,

    /// <summary>Ambient drafts are generated and enter the controller review queue like any draft (never auto-sent).</summary>
    Review = 1,

    /// <summary>
    /// Ambient drafts publish without a controller click, inside the caps and allow-lists. Only reachable when the
    /// deployment's governed <c>Generation:Governance:AmbientAutonomyAuthorized</c> flag is true (PROVIDER-GOVERNANCE §8).
    /// </summary>
    Autonomous = 2,
}

/// <summary>
/// One exercise's ambient-chatter tier policy: the mode, the per-minute and per-hour caps, and the two allow-lists the
/// quiet-floor decide policy (<see cref="Services.AmbientBehavior"/>) draws from. Immutable; a change replaces the whole
/// record. Staff/backend only (XC-002): no participant surface reads it.
/// </summary>
/// <remarks>
/// <b>An empty allow-list means "nothing allowed", never "everything".</b> A policy with no topics or no personas
/// produces no ambient content at all, whatever its mode.
/// </remarks>
public sealed record AmbientTierPolicy
{
    /// <summary>The resting policy: <see cref="AmbientPolicyMode.Off"/>, zero caps, empty allow-lists.</summary>
    public static AmbientTierPolicy Off { get; } = new()
    {
        Mode = AmbientPolicyMode.Off,
        MaxPerMinute = 0,
        MaxPerHour = 0,
        TopicAllowList = [],
        PersonaAllowList = [],
    };

    /// <summary>The ambient mode.</summary>
    public required AmbientPolicyMode Mode { get; init; }

    /// <summary>The most ambient posts generated in any rolling minute; never above the exercise's <c>MaxEnginePostsPerMinute</c>.</summary>
    public required int MaxPerMinute { get; init; }

    /// <summary>The most ambient posts generated in any rolling hour (the ambient spend cap).</summary>
    public required int MaxPerHour { get; init; }

    /// <summary>The topic keys ambient posts may be seeded from — a subset of <see cref="AmbientTopics.Vocabulary"/>.</summary>
    public required IReadOnlyList<string> TopicAllowList { get; init; }

    /// <summary>The persona INSTANCE ids that may voice ambient posts — personas of THIS exercise only.</summary>
    public required IReadOnlyList<Guid> PersonaAllowList { get; init; }

    /// <summary>
    /// The controller (COR-018 acting human) who set this policy, or <c>null</c> for the resting <see cref="Off"/>
    /// policy. Carried onto the ambient engine events' actor so an autonomous post is attributable to the human who
    /// authorised it (XC-004).
    /// </summary>
    public string? SetBy { get; init; }
}
