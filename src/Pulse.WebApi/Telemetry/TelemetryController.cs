namespace Pulse.WebApi.Telemetry;

using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// The durable telemetry sink (XC-004, backend half of the <c>telemetry</c> feature). Answers the
/// best-effort <c>api.post('/telemetry', event)</c> the shipped client mock sink
/// (<c>src/frontend/src/core/telemetry/mockSink.ts</c>) already fire-and-forgets — this is the real
/// endpoint that call has always targeted. It validates the LOCKED v0 envelope server-side (defense in
/// depth — it never trusts the client's <c>zod</c> check), dedupes on <c>eventId</c>, and persists one
/// row through <see cref="PulseDbContext"/>. Self-registers via <c>[ApiController]</c>/attribute routing —
/// no <c>Program.cs</c> edit.
/// </summary>
/// <remarks>
/// <para>
/// <b>Scope and actor identity are SERVER-AUTHORITATIVE</b> as of <c>identity-auth-roles/13</c> (#362): the
/// envelope's <c>exerciseId</c> is stamped from the caller's own session (a body value that disagrees is a 400,
/// never a silent correction) and its <c>actor</c> identity fields are stamped from that session too. See
/// <see cref="TelemetryEnvelopeAuthority"/> for the full rule set and the audit finding it closes. The route
/// itself is gated by story 11's (#361) default-deny fallback policy — it carries NO pre-auth allowlist entry
/// and there are no legitimately pre-auth telemetry emitters (login-outcome telemetry is written server-side,
/// in-process, and never over HTTP).
/// </para>
/// <para>
/// Out of scope (by story): any read/query API over stored telemetry, rate limiting beyond the size cap,
/// SignalR fan-out, and <c>actor.role</c> (a display/filter string, left caller-stated).
/// </para>
/// </remarks>
[ApiController]
[Route("api/telemetry")]
public sealed class TelemetryController : ControllerBase
{
    /// <summary>
    /// Content-security cap (NFR-004): the maximum accepted request-body size, in bytes. A v0 envelope is a
    /// few KB even with a payload; 64 KiB is a generous but bounded ceiling. A body exceeding it is rejected
    /// with <c>400</c> and never buffered in full.
    /// </summary>
    private const int MaxRequestBodyBytes = 64 * 1024;

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;

    /// <summary>Creates the controller with the injected persistence context and request scope.</summary>
    /// <param name="dbContext">The persistence context the dedup check and the insert run through.</param>
    /// <param name="exerciseContext">
    /// The request's resolved exercise scope (COR-001) — cross-checked against the caller's session binding by
    /// <see cref="TelemetryEnvelopeAuthority"/>. Already registered by <c>AddPulsePersistence</c>, so this
    /// dependency needs no composition-root edit.
    /// </param>
    public TelemetryController(PulseDbContext dbContext, IExerciseContext exerciseContext)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
    }

    /// <summary>
    /// Ingests one v0 telemetry envelope: identifies the caller, size-caps the body, stamps the
    /// server-authoritative scope and actor identity, validates the v0 shape and conditional rules, dedupes on
    /// <c>eventId</c>, and persists the sanitized envelope as one <see cref="Data.Entities.TelemetryEvent"/> row.
    /// Returns <c>202 Accepted</c> for both a freshly-stored event and a duplicate (idempotent — a retry after
    /// the client swallowed a failure is indistinguishable), <c>400</c> for anything malformed, schema-invalid,
    /// oversized, or naming an exercise other than the caller's own, <c>403</c> for an actor claim the caller
    /// cannot hold, and <c>401</c> when no session is identified (never persisting in any of those cases).
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> Ingest(CancellationToken cancellationToken)
    {
        // Identify the caller FIRST — before the body is even read. Story 11's fallback policy has already
        // answered 401 for an unauthenticated request in AuthorizationMiddleware, so reaching here with no
        // identity should be impossible; failing closed anyway costs one claims read (no I/O) and means a future
        // change to the gate cannot silently turn this into a body-trusting endpoint again. Doing it ahead of the
        // bounded read also means an unidentified caller never gets 64 KiB of buffering out of us.
        var identity = SessionPrincipal.Read(User);
        if (identity is null)
        {
            return Unauthorized();
        }

        // Content security (NFR-004): bounded read. Read at most cap+1 bytes; if the stream still had data
        // we know the body exceeded the cap without ever buffering a huge/chunked payload in full.
        var buffer = new byte[MaxRequestBodyBytes + 1];
        var total = 0;
        while (total < buffer.Length)
        {
            var read = await Request.Body.ReadAsync(buffer.AsMemory(total, buffer.Length - total), cancellationToken);
            if (read == 0)
            {
                break;
            }

            total += read;
        }

        if (total > MaxRequestBodyBytes)
        {
            return BadRequest("Telemetry envelope exceeds the maximum accepted size.");
        }

        TelemetryEventRequest? request;
        try
        {
            request = JsonSerializer.Deserialize<TelemetryEventRequest>(
                buffer.AsSpan(0, total), TelemetryEventRequest.SerializerOptions);
        }
        catch (JsonException)
        {
            // Malformed JSON, a scalar type mismatch, or an unrecognized top-level/nested key
            // (JsonUnmappedMemberHandling.Disallow) — all mirror a client zod failure. Opaque 400.
            return BadRequest("Telemetry envelope is not a well-formed v0 payload.");
        }

        if (request is null)
        {
            return BadRequest("Telemetry envelope body is empty.");
        }

        // Server authority (identity-auth-roles/13) runs BEFORE validation, not after: it rewrites the actor's
        // identity fields in place, so what Validate() checks is exactly what will be STORED — and so a field it
        // drops can never satisfy Validate() and then trip PulseDbContext's write-time envelope guard, which
        // throws (a 500 where a 400 belongs). It also means a stamped field can SATISFY a conditional rule the
        // caller's own body did not: an `actor.kind: 'participant'` event that omits participantId, or a view
        // event with no reach key at all (COR-015), is now completed server-side rather than rejected.
        var authority = TelemetryEnvelopeAuthority.Apply(request, identity, _exerciseContext.CurrentExerciseId);
        if (!authority.IsResolved)
        {
            return StatusCode(authority.RejectionStatusCode, authority.RejectionReason);
        }

        if (request.Validate().Count > 0)
        {
            return BadRequest("Telemetry envelope failed v0 validation.");
        }

        // The isolation scope (COR-001) is the SESSION's, never the envelope's. The envelope's own exerciseId has
        // already been required to agree with it (400 otherwise) and contributes nothing here.
        var exerciseId = authority.ExerciseId!.Value;

        // Dedup / idempotency on eventId (the documented client retry-after-swallowed-failure case).
        //
        // IgnoreQueryFilters(): eventId is the PRIMARY KEY — global, not per-exercise — so the dedup existence
        // check has to be global too. exercise-isolation/01 (#44) added the read-side query filter on every
        // IExerciseScoped entity (TelemetryEvent included), and a scoped check would miss a row stored under a
        // different scope, insert a duplicate, and hit the PK violation below instead of returning a clean 202.
        // Bypassing the filter for a lookup by unique key discloses nothing: only existence, never a row.
        var alreadyStored = await _dbContext.TelemetryEvents
            .IgnoreQueryFilters()
            .AnyAsync(e => e.EventId == request.EventId, cancellationToken);
        if (alreadyStored)
        {
            return Accepted();
        }

        _dbContext.TelemetryEvents.Add(request.ToEntity(exerciseId));
        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // A concurrent POST of the same eventId won the race between the check above and this insert; the
            // unique eventId key rejected the duplicate. If the row is now present, surface the same
            // idempotent success (no duplicate, no error to the caller); otherwise the failure is real.
            var nowStored = await _dbContext.TelemetryEvents
                .IgnoreQueryFilters()
                .AnyAsync(e => e.EventId == request.EventId, cancellationToken);
            if (nowStored)
            {
                return Accepted();
            }

            throw;
        }

        return Accepted();
    }
}
