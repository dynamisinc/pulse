namespace Pulse.WebApi.Features.Media.Documents;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Social.Follows;

/// <summary>The outcomes of a document read, each mapped to exactly one HTTP status by the endpoint.</summary>
public enum DocumentReadOutcome
{
    /// <summary>200 — the document and its signed download URL.</summary>
    Ok,

    /// <summary>401 — no exercise scope is resolved.</summary>
    ScopeUnresolved,

    /// <summary>404 — unknown, malformed, another exercise's, another participant's, or not a document: ONE answer.</summary>
    NotFound,

    /// <summary>503 — the download URL could not be signed.</summary>
    StoreUnavailable,
}

/// <summary>The result of <see cref="DocumentReadService.GetAsync"/>.</summary>
/// <param name="Outcome">The outcome.</param>
/// <param name="View">The 200 body, on <see cref="DocumentReadOutcome.Ok"/>.</param>
public sealed record DocumentReadResult(DocumentReadOutcome Outcome, DocumentDownloadView? View = null);

/// <summary>
/// <c>GET /api/media/documents/{id}</c> (press-room story 02): an uploaded document's metadata and a signed,
/// download-only URL — for its uploader, or for staff assigned to the exercise. Exercise-scoped like every media read.
/// </summary>
/// <remarks>
/// <b>Isolation (XC-001, DP-16).</b> The id is resolved under the central query filter AND an explicit
/// <c>ExerciseId</c> predicate. Unknown, malformed, cross-exercise, another participant's and non-document ids all get
/// the SAME 404 with no body, so no response confirms that another exercise's asset exists. The registered signer then
/// re-checks the scope before minting anything.
/// </remarks>
public sealed class DocumentReadService
{
    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentStaffSessionAccessor _staffSessionAccessor;
    private readonly ICurrentSessionPersonaAccessor _sessionPersonaAccessor;
    private readonly StaffAssignmentService _staffAssignments;
    private readonly IMediaUrlSigner _signer;

    /// <summary>Creates the service.</summary>
    /// <param name="dbContext">The persistence context.</param>
    /// <param name="exerciseContext">The resolved exercise scope — the ONLY scoping source.</param>
    /// <param name="staffSessionAccessor">Identifies a staff caller.</param>
    /// <param name="sessionPersonaAccessor">Identifies a persona-bound participant caller.</param>
    /// <param name="staffAssignments">The staff caller's own assignments (COR-005 re-check).</param>
    /// <param name="signer">The read-URL signer.</param>
    public DocumentReadService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ICurrentStaffSessionAccessor staffSessionAccessor,
        ICurrentSessionPersonaAccessor sessionPersonaAccessor,
        StaffAssignmentService staffAssignments,
        IMediaUrlSigner signer)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(staffSessionAccessor);
        ArgumentNullException.ThrowIfNull(sessionPersonaAccessor);
        ArgumentNullException.ThrowIfNull(staffAssignments);
        ArgumentNullException.ThrowIfNull(signer);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _staffSessionAccessor = staffSessionAccessor;
        _sessionPersonaAccessor = sessionPersonaAccessor;
        _staffAssignments = staffAssignments;
        _signer = signer;
    }

    /// <summary>Reads one document.</summary>
    /// <param name="id">The route id (untrusted text).</param>
    /// <param name="cancellationToken">Cancels the read.</param>
    /// <returns>The outcome.</returns>
    public async Task<DocumentReadResult> GetAsync(string? id, CancellationToken cancellationToken = default)
    {
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return new DocumentReadResult(DocumentReadOutcome.ScopeUnresolved);
        }

        var exerciseId = scope.Value;
        if (!Guid.TryParse(id, out var documentId) || documentId == Guid.Empty)
        {
            return new DocumentReadResult(DocumentReadOutcome.NotFound);
        }

        var caller = await MediaCallerResolution.ResolveAsync(
            _staffSessionAccessor, _sessionPersonaAccessor, _staffAssignments, exerciseId, cancellationToken);
        if (caller is null)
        {
            // Nobody to read as: the same 404, so an unauthorized caller learns nothing about the id either.
            return new DocumentReadResult(DocumentReadOutcome.NotFound);
        }

        var query = _dbContext.MediaAssets
            .AsNoTracking()
            .Where(asset => asset.Id == documentId && asset.ExerciseId == exerciseId && asset.Kind == MediaKinds.Document);
        if (!caller.IsStaff)
        {
            query = query.Where(asset => asset.UploadedByHumanId == caller.HumanId);
        }

        var document = await query.FirstOrDefaultAsync(cancellationToken);
        if (document is null)
        {
            return new DocumentReadResult(DocumentReadOutcome.NotFound);
        }

        string url;
        try
        {
            url = await _signer.GetReadUrlAsync(document, cancellationToken);
        }
#pragma warning disable CA1031 // Any signing fault is a storage outage, answered 503 — never a 500.
        catch (Exception ex) when (ex is not OperationCanceledException and not ExerciseScopeViolationException)
#pragma warning restore CA1031
        {
            return new DocumentReadResult(DocumentReadOutcome.StoreUnavailable);
        }

        return new DocumentReadResult(
            DocumentReadOutcome.Ok,
            new DocumentDownloadView(document.Id.ToString(), document.OriginalFileName, document.Bytes, url));
    }
}
