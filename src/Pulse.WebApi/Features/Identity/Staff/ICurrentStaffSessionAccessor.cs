namespace Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// The minimal cross-wave seam that yields the authenticated STAFF session for the current request. Story 05
/// (Wave 1) defines and depends on this interface so <c>GET /api/staff/assignments</c> and
/// <c>POST /api/staff/active-exercise</c> can identify the calling staff user WITHOUT owning an auth scheme —
/// the auth scheme, the token/cookie validation, and the real implementation are story 03's (Wave 2).
/// </summary>
/// <remarks>
/// <para>
/// <b>Wave boundary (documented for the orchestrator).</b> Story 05 ships a fail-closed default
/// (<see cref="NullCurrentStaffSessionAccessor"/>, always <c>null</c> → the endpoints 401) so the host still
/// boots and the endpoints are testable now against a registered test double. Story 03 MUST provide the real
/// implementation — backed by its session auth scheme, reading the presented session token, resolving the
/// persisted <c>Session</c> row, and returning a <see cref="CurrentStaffSession"/> ONLY for a live,
/// non-revoked, non-expired <c>staff</c>-kind session (participant / read-only sessions yield <c>null</c>, so
/// the assignments/active-exercise endpoints are staff-only by construction, XC-002). The orchestrator wires
/// story 03's registration so it takes precedence over story 05's fail-closed default.
/// </para>
/// <para>
/// <b>Fail closed.</b> A <c>null</c> result means "no authenticated staff session" and the endpoints return
/// 401 — never a default/empty 200 and never another staff user's data.
/// </para>
/// </remarks>
public interface ICurrentStaffSessionAccessor
{
    /// <summary>
    /// Resolves the current request's authenticated staff session, or <c>null</c> when there is none (no
    /// token, an invalid/expired/revoked session, or a non-staff session) — fail closed.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The current staff session identity, or <c>null</c>.</returns>
    Task<CurrentStaffSession?> GetCurrentStaffSessionAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The identity of the current staff session — the minimum the staff endpoints need: which persisted
/// <c>Session</c> row to update on an active-exercise switch, and which <c>StaffUser</c> owns it (so
/// assignments are scoped own-only). No secret / token material is carried here (NFR-009).
/// </summary>
public sealed class CurrentStaffSession
{
    /// <summary>The persisted <c>Session.Id</c> of the current staff session (the row an active-exercise switch mutates).</summary>
    public required Guid SessionId { get; init; }

    /// <summary>The <c>StaffUser.Id</c> the session is bound to — the owner whose assignments the endpoints read.</summary>
    public required Guid StaffUserId { get; init; }
}

/// <summary>
/// The fail-closed default <see cref="ICurrentStaffSessionAccessor"/> shipped by story 05 (Wave 1): it always
/// reports "no authenticated staff session", so before story 03's real accessor is wired the staff endpoints
/// return 401 rather than throwing or leaking. Story 03 replaces this in Wave 2.
/// </summary>
public sealed class NullCurrentStaffSessionAccessor : ICurrentStaffSessionAccessor
{
    /// <inheritdoc />
    public Task<CurrentStaffSession?> GetCurrentStaffSessionAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult<CurrentStaffSession?>(null);
}
