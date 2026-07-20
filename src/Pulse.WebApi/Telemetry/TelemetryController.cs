namespace Pulse.WebApi.Telemetry;

using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;

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
/// Out of scope (by story): per-session/hostname authority of the <c>exerciseId</c> claim, any read/query
/// API over stored telemetry, rate limiting beyond the size cap, and SignalR fan-out.
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

    /// <summary>Creates the controller with the injected persistence context.</summary>
    public TelemetryController(PulseDbContext dbContext)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        _dbContext = dbContext;
    }

    /// <summary>
    /// Ingests one v0 telemetry envelope: size-caps the body, validates the v0 shape and conditional rules,
    /// dedupes on <c>eventId</c>, and persists a valid envelope as one <see cref="Data.Entities.TelemetryEvent"/>
    /// row. Returns <c>202 Accepted</c> for both a freshly-stored event and a duplicate (idempotent — a retry
    /// after the client swallowed a failure is indistinguishable), and <c>400</c> for anything malformed,
    /// schema-invalid, or oversized (never persisted).
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> Ingest(CancellationToken cancellationToken)
    {
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

        if (request.Validate().Count > 0)
        {
            return BadRequest("Telemetry envelope failed v0 validation.");
        }

        // exerciseId travels the envelope as a string (COR-001 isolation scope); the durable store keys it
        // as a Guid. A non-Guid or empty scope cannot be persisted, and would trip the write-guard anyway —
        // fail closed with a 400 rather than a 500.
        if (!Guid.TryParse(request.ExerciseId, out var exerciseId) || exerciseId == Guid.Empty)
        {
            return BadRequest("Telemetry envelope carries an invalid exerciseId scope.");
        }

        // Dedup / idempotency on eventId (the documented client retry-after-swallowed-failure case).
        //
        // IgnoreQueryFilters(): FORWARD-COMPAT with exercise-isolation/01 (#44), which adds a GLOBAL query
        // filter on IExerciseScoped entities (incl. TelemetryEvent) keyed to an AMBIENT current-exercise.
        // This endpoint has no ambient/current exercise (per-session authority is explicitly out of scope,
        // Phase B2), so once #44 lands that filter would hide already-stored rows from this existence check
        // and dedup would silently start creating duplicates. Querying by the unique eventId with filters
        // bypassed keeps dedup correct across that merge. In THIS worktree the filter isn't present yet, so
        // this is a harmless no-op — added deliberately now so the seam survives #44.
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
