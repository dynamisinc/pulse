namespace Pulse.WebApi.Features.EngineRuntime.Steering;

using System.Text.Json.Serialization;

/// <summary>
/// The PARTICIPANT-facing overlay-state projection (feature: world-steering, story 08; XC-002, COR-018,
/// COR-053). Served by <c>GET /api/overlay-state</c> and pushed as the <c>OverlayStateChanged</c> SignalR event;
/// a field-for-field mirror of the frozen frontend <c>OverlayState</c> triple
/// (<c>features/participant-shell/components/OverlayLayer/types.ts</c>) plus the additive
/// <see cref="Sequence"/>. Every property carries an explicit <see cref="JsonPropertyNameAttribute"/> so the
/// camelCase wire shape is identical on BOTH transports (minimal-API JSON and the SignalR hub protocol have
/// separate serializer configurations — the attributes make config irrelevant).
/// </summary>
/// <remarks>
/// <para>
/// <b>The XC-002 projection is STRUCTURAL, not a discipline (read this before adding a property).</b> The one
/// factory, <see cref="FromSnapshot"/>, takes an <see cref="OverlayStateSnapshot"/> — a record that itself
/// carries no staff field. It deliberately does NOT accept a <see cref="PauseTierTransition"/>, so
/// <see cref="PauseTierTransition.ActingHumanId"/> (COR-018 staff attribution) is not merely omitted here, it
/// is not reachable from here: a participant can never learn WHICH controller paused the exercise. For the same
/// reason no <see cref="PauseTier"/> value is projected — <c>INJECTS PAUSED</c>/<c>ENGINE PAUSED</c>/<c>WORLD
/// FROZEN</c> are STAFF vocabulary, and only the fiction-safe <c>pause</c>/<c>none</c> kind crosses to the
/// participant world. Do not add a property that is not already on <see cref="OverlayStateSnapshot"/>, and do
/// not add a second factory that reads a staff record.
/// </para>
/// <para>
/// <b>No time field (COR-050/053).</b> The overlay carries no timestamp at all: the participant shell's pause
/// page shows no clock, so there is no wall-clock leak and nothing to re-derive. (Break Fiction's overlay is the
/// one deliberate wall-clock exception, and it is out of scope for this story.)
/// </para>
/// </remarks>
public sealed class ParticipantOverlayStateDto
{
    /// <summary>The overlay kind — <c>none</c> or <c>pause</c> (this feature writes no other).</summary>
    [JsonPropertyName("state")]
    public required string State { get; init; }

    /// <summary>The register a <c>pause</c> page renders in — <c>in-fiction</c> or <c>out-of-fiction</c>.</summary>
    [JsonPropertyName("register")]
    public required string Register { get; init; }

    /// <summary>The overlay message — always empty in this feature (COR-032 authoring is out of scope).</summary>
    [JsonPropertyName("message")]
    public required string Message { get; init; }

    /// <summary>
    /// The monotonic write sequence of this state (0 = never written). Opaque to participants — it carries no
    /// exercise content and no staff information; the client uses it only to DROP a push that is older than
    /// what it has already applied, so a late out-of-order push can never re-show a cleared holding page.
    /// </summary>
    [JsonPropertyName("sequence")]
    public required long Sequence { get; init; }

    /// <summary>
    /// Projects a stored overlay snapshot onto the participant wire shape. The ONLY way to build this DTO — see
    /// the type's remarks for why the input is deliberately the snapshot and never a staff transition record.
    /// </summary>
    /// <param name="snapshot">The exercise's stored overlay snapshot.</param>
    /// <returns>The participant-safe projection.</returns>
    public static ParticipantOverlayStateDto FromSnapshot(OverlayStateSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);

        return new ParticipantOverlayStateDto
        {
            State = snapshot.State,
            Register = snapshot.Register,
            Message = snapshot.Message,
            Sequence = snapshot.Sequence,
        };
    }
}
