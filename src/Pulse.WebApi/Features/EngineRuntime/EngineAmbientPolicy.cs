namespace Pulse.WebApi.Features.EngineRuntime;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Pulse.Core.Features.Ambient.Models;
using Pulse.Core.Features.Ambient.Services;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Storylines.Models;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// The governed deployment flag that decides whether ANY exercise may select ambient <c>autonomous</c> mode
/// (ambient-chatter story 01, AC0). Bound from <c>Generation:Governance</c> — the App Service setting
/// <c>Generation__Governance__AmbientAutonomyAuthorized</c> (<c>infrastructure/modules/webapp.bicep</c>).
/// </summary>
/// <remarks>
/// <b>False by default, and committed false.</b> PROVIDER-GOVERNANCE §8 authorises only Suggest and Delayed-auto
/// with swamped mode on UAT; autonomous ambient posting needs its own signed amendment, and the signer sets this flag
/// in the same reviewed commit (the <c>generationTenantBounded</c> pattern). A SEPARATE options class from
/// <c>GenerationOptions</c>, so the NFR-005 startup gate over that object is untouched by this story.
/// </remarks>
public sealed class EngineAmbientGovernanceOptions
{
    /// <summary>The configuration section the flag lives in.</summary>
    public const string SectionName = "Generation:Governance";

    /// <summary>Whether autonomous ambient posting is authorised for this deployment (PROVIDER-GOVERNANCE §8).</summary>
    public bool AmbientAutonomyAuthorized { get; set; }

    /// <summary>
    /// Registers the options, bound from <see cref="SectionName"/> when the host HAS configuration and left at the
    /// fail-closed default (<c>false</c>) when it does not (a bare test container). Safe to call more than once.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection.</returns>
    public static IServiceCollection Register(IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);
        services.AddOptions<EngineAmbientGovernanceOptions>()
            .Configure<IServiceProvider>((options, provider) =>
                provider.GetService<IConfiguration>()?.GetSection(SectionName).Bind(options));
        return services;
    }
}

/// <summary>
/// The per-exercise <see cref="AmbientTierPolicy"/> store (singleton) — the third sibling of
/// <see cref="EngineAutonomyRegistry"/> and <see cref="EngineTierPolicyRegistry"/>. One independently-settable policy
/// per exercise, keyed by <c>exerciseId</c> (COR-001). Read by the reaction loop every tick, so a change is live on
/// the next tick with no redeploy.
/// </summary>
/// <remarks>
/// <para>
/// <b>Process memory, by design, and fail-safe.</b> Only non-resting policies are stored; an exercise with no entry
/// reads <see cref="AmbientTierPolicy.Off"/>. A restart therefore resets every exercise to <c>off</c> — no ambient
/// content until a controller turns it back on (persistence is wave C3, after Session A's A1 schema).
/// </para>
/// <para>
/// <b>Only a human raises it (§8.2).</b> <see cref="TrySet"/> is called only by the controller-role settings POST;
/// the engine can only ever LOWER a policy (<see cref="DemoteAutonomous"/>, on a safety clamp), never raise one.
/// </para>
/// </remarks>
public sealed class EngineAmbientPolicyRegistry
{
    // Each stored value is wrapped in a fresh Slot per write, so ConcurrentDictionary.TryUpdate (which compares with the
    // value type's default equality) is a STRICT reference compare-and-set: AmbientTierPolicy is a record (value
    // equality), the Slot is not. Every writer — Set (test-only), TrySet and DemoteAutonomous — CASes on the same slot identity,
    // so they are mutually atomic (orchestrator review WR-5).
    private readonly ConcurrentDictionary<Guid, Slot> _policies = new();
    private readonly bool _autonomyAuthorized;
    private readonly IReactionLoopRegistry? _loops;

    /// <summary>Creates the registry.</summary>
    /// <param name="governance">The governed autonomy flag; absent means NOT authorised (fail closed).</param>
    /// <param name="loops">The active loops, read only for each exercise's <c>MaxEnginePostsPerMinute</c>; absent means the default config.</param>
    public EngineAmbientPolicyRegistry(
        IOptions<EngineAmbientGovernanceOptions>? governance = null,
        IReactionLoopRegistry? loops = null)
    {
        _autonomyAuthorized = governance?.Value.AmbientAutonomyAuthorized ?? false;
        _loops = loops;
    }

    /// <summary>Whether this deployment authorises <see cref="AmbientPolicyMode.Autonomous"/> (AC0).</summary>
    public bool AutonomyAuthorized => _autonomyAuthorized;

    /// <summary>
    /// The exercise's policy, or <see cref="AmbientTierPolicy.Off"/> (the same static instance) when none is set. The
    /// returned instance is the snapshot <see cref="TrySet"/> compares against.
    /// </summary>
    /// <param name="exerciseId">The exercise (COR-001); must not be empty.</param>
    /// <returns>The policy.</returns>
    public AmbientTierPolicy Get(Guid exerciseId)
    {
        EnsureScoped(exerciseId);
        return _policies.TryGetValue(exerciseId, out var slot) ? slot.Policy : AmbientTierPolicy.Off;
    }

    /// <summary>
    /// TEST SET-UP ONLY. Records the exercise's policy unconditionally and returns the policy it displaced, atomically.
    /// Internal (visible to <c>Pulse.WebApi.Tests</c> only) so no production writer can bypass the compare-and-set:
    /// controller writes go through <see cref="TrySet"/>, engine lowering through <see cref="DemoteAutonomous"/>
    /// (orchestrator delta-review item 3).
    /// </summary>
    /// <param name="exerciseId">The exercise (COR-001); must not be empty.</param>
    /// <param name="policy">The validated policy.</param>
    /// <returns>The previous policy.</returns>
    internal AmbientTierPolicy Set(Guid exerciseId, AmbientTierPolicy policy)
    {
        EnsureScoped(exerciseId);
        ArgumentNullException.ThrowIfNull(policy);

        while (true)
        {
            if (_policies.TryGetValue(exerciseId, out var existing))
            {
                if (_policies.TryUpdate(exerciseId, new Slot(policy), existing))
                {
                    return existing.Policy;
                }
            }
            else if (_policies.TryAdd(exerciseId, new Slot(policy)))
            {
                return AmbientTierPolicy.Off;
            }
        }
    }

    /// <summary>
    /// Compare-and-set (orchestrator review WR-5): replaces the exercise's policy with <paramref name="next"/> ONLY if
    /// the current policy is reference-equal to <paramref name="expected"/> — the snapshot the caller read through
    /// <see cref="Get"/> (<see cref="AmbientTierPolicy.Off"/> when nothing is stored). Atomic with <see cref="Set"/> and
    /// <see cref="DemoteAutonomous"/>: a demotion (or another writer) that lands between the caller's read and this call
    /// makes it return <c>false</c> and change nothing, so a stale snapshot can never overwrite — and so never resurrect
    /// — a policy the engine just lowered.
    /// </summary>
    /// <remarks>
    /// <see cref="AmbientTierPolicy"/> carries no version, so the comparison is by reference. Callers re-read with
    /// <see cref="Get"/>, re-run every snapshot-dependent check, and retry a bounded number of times on <c>false</c>.
    /// </remarks>
    /// <param name="exerciseId">The exercise (COR-001); must not be empty.</param>
    /// <param name="expected">The snapshot the caller's checks were evaluated against.</param>
    /// <param name="next">The policy to store.</param>
    /// <returns><c>true</c> when THIS call stored <paramref name="next"/>; <c>false</c> on a stale snapshot.</returns>
    public bool TrySet(Guid exerciseId, AmbientTierPolicy expected, AmbientTierPolicy next)
    {
        EnsureScoped(exerciseId);
        ArgumentNullException.ThrowIfNull(expected);
        ArgumentNullException.ThrowIfNull(next);

        if (_policies.TryGetValue(exerciseId, out var current))
        {
            return ReferenceEquals(current.Policy, expected)
                && _policies.TryUpdate(exerciseId, new Slot(next), current);
        }

        // Nothing stored: the caller's snapshot is the resting Off instance Get returned, or it is stale.
        return ReferenceEquals(expected, AmbientTierPolicy.Off) && _policies.TryAdd(exerciseId, new Slot(next));
    }

    /// <summary>
    /// LOWERS an <see cref="AmbientPolicyMode.Autonomous"/> policy to <see cref="AmbientPolicyMode.Off"/> (caps and
    /// allow-lists kept, so a human re-selecting the mode is one action) — the engine's response to any safety clamp
    /// (AC6). Restoring the engine never re-raises it; only a controller re-selecting the mode does. A no-op for any
    /// other mode.
    /// </summary>
    /// <param name="exerciseId">The exercise (COR-001); must not be empty.</param>
    /// <param name="demoted">The policy that was demoted, when this call demoted one.</param>
    /// <returns><c>true</c> when an autonomous policy was lowered by THIS call.</returns>
    public bool DemoteAutonomous(Guid exerciseId, out AmbientTierPolicy demoted)
    {
        EnsureScoped(exerciseId);

        while (_policies.TryGetValue(exerciseId, out var existing))
        {
            if (existing.Policy.Mode != AmbientPolicyMode.Autonomous)
            {
                break;
            }

            if (_policies.TryUpdate(exerciseId, new Slot(existing.Policy with { Mode = AmbientPolicyMode.Off }), existing))
            {
                demoted = existing.Policy;
                return true;
            }
        }

        demoted = AmbientTierPolicy.Off;
        return false;
    }

    /// <summary>The exercise's global engine cap (ADP-011): its loop's <c>RateConfig</c>, or the default when it has no loop.</summary>
    /// <param name="exerciseId">The exercise.</param>
    /// <returns><see cref="RateGovernanceConfig.MaxEnginePostsPerMinute"/> for the exercise.</returns>
    public int MaxEnginePostsPerMinute(Guid exerciseId)
    {
        var registration = _loops?.Active.FirstOrDefault(loop => loop.ExerciseId == exerciseId);
        return (registration?.RateConfig ?? RateGovernanceConfig.Default).MaxEnginePostsPerMinute;
    }

    /// <summary>The staff wire snapshot of the exercise's policy.</summary>
    /// <param name="exerciseId">The exercise.</param>
    /// <returns>The DTO.</returns>
    public EngineAmbientPolicyDto Snapshot(Guid exerciseId) =>
        EngineAmbientPolicyDto.From(
            Get(exerciseId), MaxEnginePostsPerMinute(exerciseId), _autonomyAuthorized, VoiceablePersonaIds(exerciseId));

    /// <summary>
    /// The persona instance ids ambient chatter can actually voice for the exercise — its reaction loop's registered
    /// cast (<see cref="ReactionLoopRegistration.PersonasByHandle"/>) intersected with the ambient-eligible types
    /// (<see cref="AmbientPolicyValidator.EligiblePersonaTypes"/>, orchestrator review W-4) — or <c>null</c> when the
    /// exercise has no loop registered. Informational for the settings panel: an allow-listed persona outside this set
    /// is never voiced by ambient chatter. Only THIS exercise's registration is read (COR-001).
    /// </summary>
    /// <param name="exerciseId">The exercise.</param>
    /// <returns>The voiceable ids, or <c>null</c> with no loop.</returns>
    public IReadOnlyList<Guid>? VoiceablePersonaIds(Guid exerciseId)
    {
        EnsureScoped(exerciseId);
        var registration = _loops?.Active.FirstOrDefault(loop => loop.ExerciseId == exerciseId);
        return registration?.PersonasByHandle.Values
            .Where(persona => AmbientPolicyValidator.IsEligiblePersonaType(persona.Dossier.Type))
            .Select(persona => persona.InstanceId)
            .Distinct()
            .ToList();
    }

    /// <summary>
    /// The engine persona type the exercise's reaction-loop cast gives <paramref name="personaId"/>, or <c>null</c> when
    /// the persona is not in the cast (or no loop is registered). Only THIS exercise's registration is read (COR-001).
    /// </summary>
    /// <param name="exerciseId">The exercise.</param>
    /// <param name="personaId">The persona instance id.</param>
    /// <returns>The cast persona's engine type, or <c>null</c>.</returns>
    public PersonaType? CastPersonaType(Guid exerciseId, Guid personaId)
    {
        EnsureScoped(exerciseId);
        var registration = _loops?.Active.FirstOrDefault(loop => loop.ExerciseId == exerciseId);
        return registration?.PersonasByHandle.Values.FirstOrDefault(persona => persona.InstanceId == personaId)?.Dossier.Type;
    }

    private static void EnsureScoped(Guid exerciseId)
    {
        if (exerciseId == Guid.Empty)
        {
            throw new ArgumentException("Ambient policy is exercise-scoped (COR-001).", nameof(exerciseId));
        }
    }

    /// <summary>A per-write identity around a policy, so the dictionary's compare-and-set compares by reference.</summary>
    private sealed class Slot(AmbientTierPolicy policy)
    {
        public AmbientTierPolicy Policy { get; } = policy;
    }
}

/// <summary>Serializes <see cref="AmbientPolicyMode"/> as <c>off</c> / <c>review</c> / <c>autonomous</c>.</summary>
public sealed class AmbientPolicyModeJsonConverter : MappedEnumJsonConverter<AmbientPolicyMode>
{
    /// <summary>Creates the converter.</summary>
    public AmbientPolicyModeJsonConverter()
        : base(AmbientPolicyModes.Wire)
    {
    }
}

/// <summary>
/// The <c>ambientPolicy</c> field of <see cref="EngineSettingsDto"/> (ambient-chatter story 01, AC2) — STAFF world
/// only (XC-002). Carries the policy plus the three facts the settings panel needs to render it honestly without a
/// client-side copy of server rules: the fixed topic vocabulary, the exercise's per-minute ceiling, and whether this
/// deployment authorises <c>autonomous</c> at all.
/// </summary>
public sealed class EngineAmbientPolicyDto
{
    /// <summary>The mode: <c>off</c> / <c>review</c> / <c>autonomous</c>.</summary>
    [JsonPropertyName("mode")]
    [JsonConverter(typeof(AmbientPolicyModeJsonConverter))]
    public required AmbientPolicyMode Mode { get; init; }

    /// <summary>The per-minute ambient cap.</summary>
    [JsonPropertyName("maxPerMinute")]
    public required int MaxPerMinute { get; init; }

    /// <summary>The per-hour ambient cap (the ambient spend cap).</summary>
    [JsonPropertyName("maxPerHour")]
    public required int MaxPerHour { get; init; }

    /// <summary>The allowed topic keys (empty = nothing allowed).</summary>
    [JsonPropertyName("topicAllowList")]
    public required IReadOnlyList<string> TopicAllowList { get; init; }

    /// <summary>The allowed persona instance ids as GUID strings (empty = nothing allowed).</summary>
    [JsonPropertyName("personaAllowList")]
    public required IReadOnlyList<string> PersonaAllowList { get; init; }

    /// <summary>The fixed server-side topic vocabulary, in display order — the only values <c>topicAllowList</c> accepts.</summary>
    [JsonPropertyName("topicVocabulary")]
    public required IReadOnlyList<string> TopicVocabulary { get; init; }

    /// <summary>The exercise's <c>MaxEnginePostsPerMinute</c> — the highest <c>maxPerMinute</c> the POST accepts.</summary>
    [JsonPropertyName("maxPerMinuteLimit")]
    public required int MaxPerMinuteLimit { get; init; }

    /// <summary>Whether this deployment authorises <c>autonomous</c> (PROVIDER-GOVERNANCE §8); when false the POST rejects it 400.</summary>
    [JsonPropertyName("autonomousAuthorized")]
    public required bool AutonomousAuthorized { get; init; }

    /// <summary>
    /// Additive (Gate-1 M-1): the persona instance ids (GUID strings) ambient chatter can voice — the exercise's
    /// reaction-loop cast intersected with the ambient-eligible persona types (Resident / Helper; orchestrator review
    /// W-4) — or <c>null</c> when no loop is registered for the exercise. The POST rejects a persona of an ineligible
    /// type; an allow-listed id outside this set (e.g. a citizen not in the engine cast) is labelled by the panel as
    /// not eligible for ambient.
    /// </summary>
    [JsonPropertyName("voiceablePersonaIds")]
    public IReadOnlyList<string>? VoiceablePersonaIds { get; init; }

    /// <summary>Projects a policy to the wire.</summary>
    /// <param name="policy">The policy.</param>
    /// <param name="maxPerMinuteLimit">The exercise's global per-minute cap.</param>
    /// <param name="autonomousAuthorized">The governed flag.</param>
    /// <param name="voiceablePersonaIds">The loop cast's persona ids, or <c>null</c> when no loop is registered.</param>
    /// <returns>The DTO.</returns>
    public static EngineAmbientPolicyDto From(
        AmbientTierPolicy policy,
        int maxPerMinuteLimit,
        bool autonomousAuthorized,
        IReadOnlyList<Guid>? voiceablePersonaIds = null)
    {
        ArgumentNullException.ThrowIfNull(policy);
        return new EngineAmbientPolicyDto
        {
            Mode = policy.Mode,
            MaxPerMinute = policy.MaxPerMinute,
            MaxPerHour = policy.MaxPerHour,
            TopicAllowList = policy.TopicAllowList.ToList(),
            PersonaAllowList = policy.PersonaAllowList.Select(id => id.ToString()).ToList(),
            TopicVocabulary = AmbientTopics.Vocabulary,
            MaxPerMinuteLimit = maxPerMinuteLimit,
            AutonomousAuthorized = autonomousAuthorized,
            VoiceablePersonaIds = voiceablePersonaIds?.Select(id => id.ToString()).ToList(),
        };
    }
}

/// <summary>
/// The <c>POST /api/engine/settings/ambient-policy</c> body (ambient-chatter story 01, AC2). Every scalar is nullable
/// so a missing field is a validation 400, never a deserialization failure. Carries NO <c>exerciseId</c>: scope is
/// server-authoritative from <see cref="Pulse.WebApi.Data.IExerciseContext"/> (COR-001) and a client-supplied one is
/// unmapped, therefore ignored.
/// </summary>
public sealed class EngineAmbientPolicyRequest
{
    /// <summary>The controller behind the shared account (COR-018) — required.</summary>
    public string? ActingHumanId { get; init; }

    /// <summary>The mode literal — <c>off</c>, <c>review</c> or <c>autonomous</c> — required.</summary>
    public string? Mode { get; init; }

    /// <summary>The per-minute cap — required, 0..<c>MaxEnginePostsPerMinute</c>.</summary>
    public int? MaxPerMinute { get; init; }

    /// <summary>The per-hour cap — required, 0..60 × <c>MaxEnginePostsPerMinute</c>.</summary>
    public int? MaxPerHour { get; init; }

    /// <summary>Topic keys from the fixed vocabulary; omitted means none.</summary>
    public IReadOnlyList<string>? TopicAllowList { get; init; }

    /// <summary>Persona instance ids of THIS exercise; omitted means none.</summary>
    public IReadOnlyList<string>? PersonaAllowList { get; init; }

    /// <summary>The exercise IANA time zone for the XC-004 envelope (XC-008) — optional; defaults to <c>UTC</c>.</summary>
    public string? TimeZone { get; init; }

    /// <summary>Projects the request to the common service input.</summary>
    /// <returns>The action input.</returns>
    public EngineReviewActionInput ToInput() => new(ActingHumanId, TimeZone);
}

/// <summary>
/// The engine's own lifecycle check before an AUTONOMOUS publish (ambient-chatter story 01, AC5): may this exercise's
/// engine content publish right now? Session A's A5 lifecycle gate replaces the interim implementation by changing the
/// ONE registration in <see cref="ReactionLoopHostExtensions.AddReactionLoopHost"/> — callers depend only on this.
/// </summary>
/// <remarks>
/// Two halves, so the publish re-check can be synchronous: <see cref="RefreshAsync"/> does any I/O (the interim
/// reads <c>Exercise.Status</c>) and the driver awaits it immediately before its no-await re-check block;
/// <see cref="CanPublish"/> is pure in-memory and is evaluated INSIDE that block, with no await between it and the
/// publisher call. A gate that has never been refreshed for an exercise answers <c>false</c> (fail closed).
/// </remarks>
public interface IEngineLifecyclePublishGate
{
    /// <summary>Re-reads whatever durable lifecycle state the gate needs for <paramref name="exerciseId"/>.</summary>
    /// <param name="exerciseId">The server-resolved exercise (never client-supplied).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task that completes when the state is current.</returns>
    ValueTask RefreshAsync(Guid exerciseId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Whether engine content may publish for <paramref name="exerciseId"/> right now: lifecycle <c>live</c>, the
    /// scenario clock not frozen, and neither "Pause engine" nor Freeze active. No I/O.
    /// </summary>
    /// <param name="exerciseId">The exercise.</param>
    /// <returns><c>true</c> only when every condition holds.</returns>
    bool CanPublish(Guid exerciseId);
}

/// <summary>
/// The INTERIM <see cref="IEngineLifecyclePublishGate"/> until Session A's A5 lands: reads <c>Exercise.Status</c>
/// through the shared <see cref="ExerciseFactsReader"/> and judges it with the SAME <see cref="ExerciseLifecycleStates"/>
/// literals the participant gate uses (no second vocabulary — legacy <c>active</c> folds to <c>live</c> through
/// <see cref="ExerciseLifecycleStates.TryParse"/>), plus the in-memory Freeze / Pause-engine tiers and clock freeze.
/// Scoped (it reads through the tick's <see cref="Pulse.WebApi.Data.PulseDbContext"/>).
/// </summary>
public sealed class InterimEngineLifecyclePublishGate : IEngineLifecyclePublishGate
{
    private readonly ExerciseFactsReader _facts;
    private readonly IExerciseClock _clock;
    private readonly PauseTierRegistry _pauseTiers;
    private readonly ConcurrentDictionary<Guid, string?> _statuses = new();

    /// <summary>Creates the gate.</summary>
    /// <param name="facts">The one shared read of the exercise row.</param>
    /// <param name="clock">The exercise clock (frozen ⇒ closed).</param>
    /// <param name="pauseTiers">The tiered pause (Pause engine / Freeze ⇒ closed).</param>
    public InterimEngineLifecyclePublishGate(ExerciseFactsReader facts, IExerciseClock clock, PauseTierRegistry pauseTiers)
    {
        ArgumentNullException.ThrowIfNull(facts);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(pauseTiers);
        _facts = facts;
        _clock = clock;
        _pauseTiers = pauseTiers;
    }

    /// <inheritdoc />
    public async ValueTask RefreshAsync(Guid exerciseId, CancellationToken cancellationToken = default)
    {
        var facts = await _facts.GetAsync(exerciseId, cancellationToken).ConfigureAwait(false);
        _statuses[exerciseId] = facts?.Status;
    }

    /// <inheritdoc />
    public bool CanPublish(Guid exerciseId) =>
        exerciseId != Guid.Empty
        && _statuses.TryGetValue(exerciseId, out var status)
        && IsLive(status)
        && !_clock.IsFrozen(exerciseId)
        && _pauseTiers.GetTier(exerciseId) is not (PauseTier.Engine or PauseTier.Freeze);

    /// <summary>Whether a stored status is <c>live</c> under the shared COR-032 vocabulary (unknown ⇒ false).</summary>
    /// <param name="status">The stored status.</param>
    /// <returns><c>true</c> only for <c>live</c> (or legacy <c>active</c>).</returns>
    public static bool IsLive(string? status) =>
        ExerciseLifecycleStates.TryParse(status, out var canonical)
        && string.Equals(canonical, ExerciseLifecycleStates.Live, StringComparison.Ordinal);
}
