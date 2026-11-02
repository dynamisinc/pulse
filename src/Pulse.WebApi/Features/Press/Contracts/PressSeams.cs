namespace Pulse.WebApi.Features.Press.Contracts;

using Pulse.WebApi.Data.Entities;

// PC-4: the seams E5 defines (press-room story 01, #738). Each is resolved in the request's exercise scope; none takes
// an exercise id (XC-001), so no caller can name another exercise.

/// <summary>
/// The ONLY place "who may release as which org" is decided (PRS-001, COR-018). Story 04 implements it over the PIO
/// enrollment's bound persona (Q-18: one org per person in December); the COR-018 multi-org grant model replaces that
/// implementation later with no caller changes. Not registered by story 01.
/// </summary>
public interface IReleaseOrgResolver
{
    /// <summary>The organizations <paramref name="humanId"/> may release as, in the resolved exercise.</summary>
    /// <param name="humanId">The acting human (server-derived from the session).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The orgs; empty when the human may release as none.</returns>
    Task<IReadOnlyList<ReleaseOrg>> ListOrgsAsync(string humanId, CancellationToken cancellationToken = default);

    /// <summary>Whether <paramref name="humanId"/> may release as <paramref name="personaId"/>.</summary>
    /// <param name="humanId">The acting human.</param>
    /// <param name="personaId">The organization persona.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>True only for a grant in the resolved exercise; an unknown or other-exercise persona is false.</returns>
    Task<bool> CanReleaseAsync(string humanId, Guid personaId, CancellationToken cancellationToken = default);
}

/// <summary>One organization a human may release as (the server model behind <see cref="ReleaseOrgDto"/>).</summary>
/// <param name="PersonaId">The organization persona.</param>
/// <param name="OutletId">Its org newsroom outlet.</param>
/// <param name="Name">The organization's name.</param>
/// <param name="Handle">The persona handle, without a leading <c>@</c>.</param>
public sealed record ReleaseOrg(Guid PersonaId, Guid OutletId, string Name, string Handle);

/// <summary>
/// The release approval gate (PC-4). Stories 05 call it before every publish/schedule; story 06 replaces the
/// pass-through default with the real routing. Distinct from F04's <c>IContentPublishGate</c>.
/// </summary>
public interface IReleaseApprovalGate
{
    /// <summary>Decides whether <paramref name="release"/> may go out now or must wait for approval.</summary>
    /// <param name="release">The release being published or scheduled (a <c>release</c>-kind content item).</param>
    /// <param name="humanId">The acting human.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns><see cref="ReleaseApprovalDecision.Pass"/>, or a hold naming the approval record.</returns>
    Task<ReleaseApprovalDecision> EvaluateAsync(ContentItem release, string humanId, CancellationToken cancellationToken = default);
}

/// <summary>The outcome of <see cref="IReleaseApprovalGate.EvaluateAsync"/>: pass, or hold pending an approval.</summary>
public sealed record ReleaseApprovalDecision
{
    private ReleaseApprovalDecision(Guid? approvalId) => ApprovalId = approvalId;

    /// <summary>The release may proceed.</summary>
    public static ReleaseApprovalDecision Pass { get; } = new((Guid?)null);

    /// <summary>The approval record the release waits on, or null when it passed.</summary>
    public Guid? ApprovalId { get; }

    /// <summary>Whether the release is held.</summary>
    public bool IsHeld => ApprovalId is not null;

    /// <summary>A hold pending <paramref name="approvalId"/>.</summary>
    /// <param name="approvalId">The approval record (non-empty).</param>
    /// <returns>The decision.</returns>
    public static ReleaseApprovalDecision Hold(Guid approvalId)
    {
        if (approvalId == Guid.Empty)
        {
            throw new ArgumentException("A hold must name its approval record.", nameof(approvalId));
        }

        return new ReleaseApprovalDecision(approvalId);
    }
}

/// <summary>
/// E5's reaction hook (PC-4): E8/E10 observe a published release through it. Story 12 wires it to the funnel's
/// published observer; story 01 ships the no-op default.
/// </summary>
public interface IReleaseReactionHook
{
    /// <summary>Called once after a release publishes. Best effort: must never be load-bearing for the publish.</summary>
    /// <param name="published">What was published.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task that completes when the hook is done.</returns>
    Task OnReleasePublishedAsync(ReleasePublishedEvent published, CancellationToken cancellationToken = default);
}

/// <summary>A published release, as <see cref="IReleaseReactionHook"/> sees it. Ids only; no participant-authored text.</summary>
/// <param name="ContentItemId">The release.</param>
/// <param name="OrgPersonaId">The organization it was issued as.</param>
/// <param name="OutletId">The org newsroom it was published under.</param>
/// <param name="PublishedScenarioTime">When it published, in scenario time.</param>
/// <param name="ActingHumanId">The human behind the publish (COR-018).</param>
public sealed record ReleasePublishedEvent(
    Guid ContentItemId, Guid OrgPersonaId, Guid OutletId, DateTimeOffset PublishedScenarioTime, string ActingHumanId);

/// <summary>
/// Creates the per-org newsroom outlets under The Wire Room (PRS-012, Q2). Idempotent; runs in the resolved exercise.
/// Called on exercise setup (<see cref="ProvisionAsync"/>) and on an org grant (<see cref="EnsureForPersonaAsync"/>).
/// </summary>
public interface IOrgNewsroomProvisioner
{
    /// <summary>Ensures one newsroom per publishing org persona (every persona bound to a PIO enrollment).</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>What was created and what already existed.</returns>
    Task<OrgNewsroomProvisionResult> ProvisionAsync(CancellationToken cancellationToken = default);

    /// <summary>Ensures the newsroom for one organization persona (an org grant).</summary>
    /// <param name="personaId">The organization persona; an unknown or other-exercise id provisions nothing.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>What was created and what already existed.</returns>
    Task<OrgNewsroomProvisionResult> EnsureForPersonaAsync(Guid personaId, CancellationToken cancellationToken = default);
}

/// <summary>The outcome of a provisioning run.</summary>
/// <param name="Status">Whether the run could provision at all.</param>
/// <param name="Created">The newsroom outlet ids created by this run.</param>
/// <param name="Existing">The org personas that already had a newsroom.</param>
public sealed record OrgNewsroomProvisionResult(
    OrgNewsroomProvisionStatus Status, IReadOnlyList<Guid> Created, IReadOnlyList<Guid> Existing)
{
    /// <summary>A run that could not provision anything.</summary>
    /// <param name="status">Why.</param>
    /// <returns>The result.</returns>
    public static OrgNewsroomProvisionResult Nothing(OrgNewsroomProvisionStatus status) => new(status, [], []);
}

/// <summary>Why a provisioning run did (or did not) provision.</summary>
public enum OrgNewsroomProvisionStatus
{
    /// <summary>The run completed (possibly creating nothing, when every org already had a newsroom).</summary>
    Ok,

    /// <summary>No exercise scope is resolved (fail closed).</summary>
    ScopeUnresolved,

    /// <summary>The exercise has no live Wire Room outlet to parent the newsrooms under.</summary>
    NoWireRoom,

    /// <summary>The persona does not exist in this exercise.</summary>
    PersonaNotFound,
}
