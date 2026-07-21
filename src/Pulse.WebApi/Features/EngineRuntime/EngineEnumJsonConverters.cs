namespace Pulse.WebApi.Features.EngineRuntime;

using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using Pulse.Core.Features.Autonomy.Models;

/// <summary>
/// Explicit, dictionary-backed JSON converters that map the PascalCase C# engine enums to the
/// lowercase-kebab string literals the FROZEN frontend contract
/// (<c>features/controller/engine/models/reviewContracts.ts</c>) and the XC-004 payload vocabulary expect.
/// </summary>
/// <remarks>
/// These are DELIBERATELY explicit (a hand-maintained bidirectional map) rather than a
/// <see cref="JsonStringEnumConverter{TEnum}"/> with a naming policy: "a schema mistake is a cross-phase
/// migration" (E8 architecture §11, adversarial review D2), so every wire literal is pinned by name and
/// asserted by test rather than inferred from a casing policy that a future enum rename could silently
/// shift. Reading rejects any unknown literal (fail loud, never a silent default).
/// </remarks>
public abstract class MappedEnumJsonConverter<TEnum> : JsonConverter<TEnum>
    where TEnum : struct, System.Enum
{
    private readonly IReadOnlyDictionary<TEnum, string> _toWire;
    private readonly Dictionary<string, TEnum> _fromWire;

    /// <summary>Creates the converter over an exhaustive enum-to-wire-literal map.</summary>
    /// <param name="map">The exhaustive enum-value → wire-literal map; its inverse must be unambiguous.</param>
    protected MappedEnumJsonConverter(IReadOnlyDictionary<TEnum, string> map)
    {
        System.ArgumentNullException.ThrowIfNull(map);
        _toWire = map;
        _fromWire = map.ToDictionary(pair => pair.Value, pair => pair.Key, System.StringComparer.Ordinal);
    }

    /// <inheritdoc />
    public override TEnum Read(ref Utf8JsonReader reader, System.Type typeToConvert, JsonSerializerOptions options)
    {
        var value = reader.GetString();
        if (value is not null && _fromWire.TryGetValue(value, out var result))
        {
            return result;
        }

        throw new JsonException($"'{value}' is not a valid {typeof(TEnum).Name} wire value.");
    }

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, TEnum value, JsonSerializerOptions options)
    {
        System.ArgumentNullException.ThrowIfNull(writer);
        if (!_toWire.TryGetValue(value, out var wire))
        {
            throw new JsonException($"{value} has no {typeof(TEnum).Name} wire mapping.");
        }

        writer.WriteStringValue(wire);
    }
}

/// <summary>
/// Serializes <see cref="AutonomyLevel"/> as the frozen kebab literals
/// <c>suggest</c> / <c>delayed-auto</c> / <c>auto</c> (<c>reviewContracts.ts</c> <c>AutonomyLevel</c>).
/// </summary>
public sealed class AutonomyLevelJsonConverter : MappedEnumJsonConverter<AutonomyLevel>
{
    private static readonly IReadOnlyDictionary<AutonomyLevel, string> Map = new Dictionary<AutonomyLevel, string>
    {
        [AutonomyLevel.Suggest] = "suggest",
        [AutonomyLevel.DelayedAuto] = "delayed-auto",
        [AutonomyLevel.Auto] = "auto",
    };

    /// <summary>Creates the <see cref="AutonomyLevel"/> converter.</summary>
    public AutonomyLevelJsonConverter()
        : base(Map)
    {
    }
}

/// <summary>
/// Serializes <see cref="DraftDisposition"/> as the frozen kebab literals
/// <c>queued</c> / <c>counting-down</c> / <c>held</c> / <c>published</c> / <c>vetoed</c>
/// (<c>reviewContracts.ts</c> <c>DraftDisposition</c>).
/// </summary>
public sealed class DraftDispositionJsonConverter : MappedEnumJsonConverter<DraftDisposition>
{
    private static readonly IReadOnlyDictionary<DraftDisposition, string> Map = new Dictionary<DraftDisposition, string>
    {
        [DraftDisposition.Queued] = "queued",
        [DraftDisposition.CountingDown] = "counting-down",
        [DraftDisposition.Held] = "held",
        [DraftDisposition.Published] = "published",
        [DraftDisposition.Vetoed] = "vetoed",
    };

    /// <summary>Creates the <see cref="DraftDisposition"/> converter.</summary>
    public DraftDispositionJsonConverter()
        : base(Map)
    {
    }
}

/// <summary>
/// Serializes <see cref="ControllerDecision"/> as the frozen lower literals
/// <c>none</c> / <c>approved</c> / <c>vetoed</c> (<c>reviewContracts.ts</c> <c>ControllerDecision</c>).
/// </summary>
public sealed class ControllerDecisionJsonConverter : MappedEnumJsonConverter<ControllerDecision>
{
    private static readonly IReadOnlyDictionary<ControllerDecision, string> Map = new Dictionary<ControllerDecision, string>
    {
        [ControllerDecision.None] = "none",
        [ControllerDecision.Approved] = "approved",
        [ControllerDecision.Vetoed] = "vetoed",
    };

    /// <summary>Creates the <see cref="ControllerDecision"/> converter.</summary>
    public ControllerDecisionJsonConverter()
        : base(Map)
    {
    }
}

/// <summary>
/// Serializes <see cref="EngineReviewAction"/> as the XC-004 <c>engine.reviewed</c> action literals
/// <c>approve</c> / <c>edit</c> / <c>veto</c> / <c>re-roll</c> / <c>hold-on-expiry</c> / <c>auto-send</c>
/// (E8 architecture §11).
/// </summary>
public sealed class EngineReviewActionJsonConverter : MappedEnumJsonConverter<EngineReviewAction>
{
    private static readonly IReadOnlyDictionary<EngineReviewAction, string> Map = new Dictionary<EngineReviewAction, string>
    {
        [EngineReviewAction.Approve] = "approve",
        [EngineReviewAction.Edit] = "edit",
        [EngineReviewAction.Veto] = "veto",
        [EngineReviewAction.ReRoll] = "re-roll",
        [EngineReviewAction.HoldOnExpiry] = "hold-on-expiry",
        [EngineReviewAction.AutoSend] = "auto-send",
    };

    /// <summary>Creates the <see cref="EngineReviewAction"/> converter.</summary>
    public EngineReviewActionJsonConverter()
        : base(Map)
    {
    }
}
