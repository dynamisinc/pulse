namespace Pulse.WebApi.Features.Press.Contracts;

using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// The press room's frozen vocabulary and limits (press-room story 01, #738; PC-1, PC-2). Every value is a lowercase
/// STRING wire literal, mirrored verbatim by <c>src/frontend/src/features/press/contract/vocabulary.ts</c>; both sides are
/// pinned to <c>contract/pressWireContract.json</c> by <c>PressContractParityTests</c> and <c>pressWireContract.test.ts</c>.
/// Additive-only after story 01.
/// </summary>
public static class PressVocabulary
{
    /// <summary>Release state <c>draft</c> (a foundation draft with no approval record).</summary>
    public const string StateDraft = "draft";

    /// <summary>Release state <c>scheduled</c>: embargoed until a scenario time (foundation <c>scheduled</c>).</summary>
    public const string StateScheduled = "scheduled";

    /// <summary>Release state <c>pending_approval</c>: an E5 state on a foundation <c>draft</c> (story 06).</summary>
    public const string StatePendingApproval = "pending_approval";

    /// <summary>Release state <c>returned</c>: an E5 state on a foundation <c>draft</c>, with a return note (story 06).</summary>
    public const string StateReturned = "returned";

    /// <summary>Release state <c>published</c>.</summary>
    public const string StatePublished = "published";

    /// <summary>Release state <c>retracted</c> (staff only; there is no participant retract, Q6).</summary>
    public const string StateRetracted = "retracted";

    /// <summary>
    /// Every PC-2 author-view state. <c>pending_approval</c> and <c>returned</c> are E5 states mapped onto a foundation
    /// <c>draft</c> plus approval records; they are never new <c>ContentStatus</c> values.
    /// </summary>
    public static IReadOnlyList<string> ReleaseStates { get; } =
        [StateDraft, StateScheduled, StatePendingApproval, StateReturned, StatePublished, StateRetracted];

    /// <summary>Input path <c>rich</c>: the release is the rich-text body.</summary>
    public const string InputPathRich = "rich";

    /// <summary>Input path <c>attachment</c>: the release is the attached PDF.</summary>
    public const string InputPathAttachment = "attachment";

    /// <summary>Input path <c>both</c>: a rich body and an attached PDF.</summary>
    public const string InputPathBoth = "both";

    /// <summary>Every PC-1 input path. Staff/evaluation-only: never in the participant projection.</summary>
    public static IReadOnlyList<string> InputPaths { get; } = [InputPathRich, InputPathAttachment, InputPathBoth];

    /// <summary>The slug of The Wire Room, the press outlet every org newsroom is a child of (F03 default, Q2).</summary>
    public const string WireRoomSlug = "wire-room";

    /// <summary>
    /// The PC-1 payload keys that are staff-set or author-only and NEVER leave <c>ProjectPayload</c> (XC-002). The TS
    /// guards reject a participant payload that carries any of them.
    /// </summary>
    public static IReadOnlyList<string> StaffOnlyPayloadKeys { get; } =
        ["crossPost", "approval", "inputPath", "boilerplate", "orgPersonaId"];

    /// <summary>The exact key set of the participant-safe projection, in order.</summary>
    public static IReadOnlyList<string> ParticipantPayloadKeys { get; } = ["org", "contact", "dateline", "document"];

    /// <summary>The longest contact name.</summary>
    public const int ContactNameMaxLength = 120;

    /// <summary>The longest contact title.</summary>
    public const int ContactTitleMaxLength = 120;

    /// <summary>The longest contact phone.</summary>
    public const int ContactPhoneMaxLength = 40;

    /// <summary>The longest contact email (RFC 5321 path limit).</summary>
    public const int ContactEmailMaxLength = 254;

    /// <summary>The longest dateline ("FULTON COUNTY, Ga. —").</summary>
    public const int DatelineMaxLength = 120;

    /// <summary>The longest boilerplate ("About {org}") block.</summary>
    public const int BoilerplateMaxLength = 2000;

    /// <summary>The longest cross-post text (a Social post).</summary>
    public const int CrossPostTextMaxLength = 280;

    /// <summary>The longest derived dek (R-P1).</summary>
    public const int DekMaxLength = 160;

    /// <summary>The longest letterhead address. Under F03's 500-character <c>ext</c> string cap.</summary>
    public const int LetterheadAddressMaxLength = 300;

    /// <summary>
    /// The <c>ext.press</c> skin-override keys that hold an org newsroom's letterhead defaults. F03's allowlist takes only
    /// FLAT values under <c>ext.&lt;ns&gt;</c> (no nested objects), so the "letterhead" block is these
    /// <c>letterhead*</c>-prefixed keys rather than one nested <c>letterhead</c> object.
    /// </summary>
    public static IReadOnlyList<string> LetterheadExtKeys { get; } =
    [
        LetterheadAddressKey, LetterheadContactNameKey, LetterheadContactTitleKey, LetterheadContactPhoneKey,
        LetterheadContactEmailKey,
    ];

    /// <summary><c>ext.press.letterheadAddress</c>.</summary>
    public const string LetterheadAddressKey = "letterheadAddress";

    /// <summary><c>ext.press.letterheadContactName</c>.</summary>
    public const string LetterheadContactNameKey = "letterheadContactName";

    /// <summary><c>ext.press.letterheadContactTitle</c>.</summary>
    public const string LetterheadContactTitleKey = "letterheadContactTitle";

    /// <summary><c>ext.press.letterheadContactPhone</c>.</summary>
    public const string LetterheadContactPhoneKey = "letterheadContactPhone";

    /// <summary><c>ext.press.letterheadContactEmail</c>.</summary>
    public const string LetterheadContactEmailKey = "letterheadContactEmail";

    /// <summary>The skin-overrides namespace the letterhead lives in.</summary>
    public const string SkinExtNamespace = ChannelVocabulary.Press;

    /// <summary>Whether <paramref name="value"/> is a PC-2 release state (ordinal).</summary>
    /// <param name="value">The candidate.</param>
    /// <returns>True for a known state.</returns>
    public static bool IsReleaseState(string? value) => value is not null && ReleaseStates.Contains(value, StringComparer.Ordinal);

    /// <summary>Whether <paramref name="value"/> is a PC-1 input path (ordinal).</summary>
    /// <param name="value">The candidate.</param>
    /// <returns>True for a known input path.</returns>
    public static bool IsInputPath(string? value) => value is not null && InputPaths.Contains(value, StringComparer.Ordinal);
}
