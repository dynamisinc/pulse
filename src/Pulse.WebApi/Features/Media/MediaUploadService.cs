namespace Pulse.WebApi.Features.Media;

using System.Globalization;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.Social.Follows;

/// <summary>The fail-closed outcomes of an upload, each mapped to exactly one HTTP status by the endpoint.</summary>
public enum MediaUploadOutcome
{
    /// <summary>201 — stored, recorded, signed.</summary>
    Created,

    /// <summary>401 — no exercise scope is resolved.</summary>
    ScopeUnresolved,

    /// <summary>403 — authenticated, but neither staff nor a persona-bound participant.</summary>
    Forbidden,

    /// <summary>400 — a malformed request or hint.</summary>
    Invalid,

    /// <summary>413 — the file exceeds its kind's ceiling.</summary>
    TooLarge,

    /// <summary>415 — not an allowed type by magic bytes, empty, or a <c>kind</c> hint that disagrees.</summary>
    UnsupportedMediaType,

    /// <summary>503 — no media store is configured.</summary>
    StoreUnavailable,
}

/// <summary>The result of <see cref="MediaUploadService.UploadAsync"/>.</summary>
public sealed class MediaUploadResult
{
    private MediaUploadResult(MediaUploadOutcome outcome, MediaAssetView? view, string? error)
    {
        Outcome = outcome;
        View = view;
        Error = error;
    }

    /// <summary>The outcome.</summary>
    public MediaUploadOutcome Outcome { get; }

    /// <summary>The 201 body, on <see cref="MediaUploadOutcome.Created"/>.</summary>
    public MediaAssetView? View { get; }

    /// <summary>The client-facing message for a 4xx outcome (never discloses another exercise's data).</summary>
    public string? Error { get; }

    /// <summary>A successful upload.</summary>
    /// <param name="view">The 201 body.</param>
    /// <returns>The result.</returns>
    public static MediaUploadResult Created(MediaAssetView view) => new(MediaUploadOutcome.Created, view, null);

    /// <summary>A failed upload.</summary>
    /// <param name="outcome">The failure outcome.</param>
    /// <param name="error">The client-facing message, if any.</param>
    /// <returns>The result.</returns>
    public static MediaUploadResult Failed(MediaUploadOutcome outcome, string? error = null) => new(outcome, null, error);
}

/// <summary>
/// <c>POST /api/media</c>'s service (demo-polish BM): reads the multipart body with a STREAMING
/// <see cref="MultipartReader"/> (never <c>IFormFile</c>, never buffered whole), types the file by MAGIC BYTES only
/// (<see cref="MediaSniffer"/>), streams it to the <see cref="IMediaStore"/> under its per-kind ceiling, records one
/// <see cref="MediaAsset"/>, and returns its signed <see cref="MediaAssetView"/>. Scoped, like the
/// <see cref="PulseDbContext"/> unit of work it writes through.
/// </summary>
/// <remarks>
/// <para>
/// <b>Server-authoritative (COR-001, COR-018).</b> The exercise comes only from <see cref="IExerciseContext"/>; the
/// uploader (<see cref="MediaAsset.UploadedByHumanId"/>) only from the session — a staff session's
/// <c>StaffUserId</c> or a persona-bound <c>participant</c> session's <c>ActingHumanId</c>, the exact values
/// <see cref="PostAttributionResolver"/> stamps as <c>ActingHumanId</c> on a post. No form field can name either.
/// </para>
/// <para>
/// <b>Cross-exercise references (DP-16).</b> <c>posterMediaId</c> is resolved under the scope's query filter AND
/// an explicit <c>ExerciseId</c> predicate; another exercise's real id, an unknown id, a non-image and someone
/// else's image all get the SAME 400 text, and nothing is written (the already-streamed blob is deleted).
/// </para>
/// <para>
/// <b>Staff must be assigned (COR-005).</b> A staff caller is re-checked against its own assignments
/// (<see cref="StaffAssignmentService"/>, the same read <c>EngineCockpitStaffAuthorizationFilter</c> uses for the
/// library's 403), so a staff member whose assignment was revoked after selecting the exercise is refused before
/// anything is read or stored.
/// </para>
/// <para>
/// <b>Scenario time — the DP-18a staff-metadata exception.</b> <see cref="MediaAsset.CreatedScenarioTime"/> is
/// stamped <c>running exercise clock ?? the exercise's persisted CurrentScenarioTime ?? the server wall clock</c>.
/// The wall-clock fallback is deliberate here and ONLY here: an asset has no post to anchor to, the column is
/// staff-only metadata (the library's <c>uploadedAtScenario</c>; no participant payload carries it), and S1 seeds
/// media during <c>build</c> when no clock runs, so refusing the upload would break demo prep.
/// <see cref="MediaAsset.CreatedWallClock"/> is the authoritative upload ORDER (the library sorts by it, never by the
/// mixed-base scenario column).
/// </para>
/// <para>
/// <b>Telemetry.</b> None — an upload is not a meaningful exercise action on its own (implementation.md §1.8); it
/// is logged (the ACCOUNT — the same key the <c>media-upload</c> rate limit partitions on — kind and bytes) for
/// abuse forensics. The post that later attaches it emits the XC-004 event.
/// </para>
/// </remarks>
public sealed partial class MediaUploadService
{
    /// <summary>The multipart field carrying the file.</summary>
    public const string FileField = "file";

    /// <summary>
    /// The multipart reader's buffer — "one chunk". The pipeline never holds more of the body than this (plus the
    /// <see cref="MediaSniffer.HeadLength"/> sniff head, which is handed to the store first).
    /// </summary>
    public const int ReadBufferBytes = 16 * 1024;

    /// <summary>The longest text field value accepted (the hints are short scalars).</summary>
    public const int MaxTextFieldBytes = 128;

    /// <summary>The largest accepted width/height hint.</summary>
    public const int MaxDimension = 16384;

    /// <summary>The largest accepted duration hint in seconds.</summary>
    public const double MaxDurationSec = 3600;

    private const string ParticipantSessionKind = "participant";
    private const string KindField = "kind";
    private const string WidthField = "width";
    private const string HeightField = "height";
    private const string DurationField = "durationSec";
    private const string PosterField = "posterMediaId";
    private const string PosterRejection = "posterMediaId does not name an image you uploaded in this exercise.";

    /// <summary>The fixed 415 text for a <c>kind</c> hint that disagrees — never echoes client input.</summary>
    private const string KindMismatchRejection = "The file's contents do not match the 'kind' hint.";

    private static readonly HashSet<string> TextFields = new(StringComparer.Ordinal)
    {
        KindField, WidthField, HeightField, DurationField, PosterField,
    };

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentStaffSessionAccessor _staffSessionAccessor;
    private readonly ICurrentSessionPersonaAccessor _sessionPersonaAccessor;
    private readonly StaffAssignmentService _staffAssignments;
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly IMediaStore _store;
    private readonly IMediaUrlSigner _signer;
    private readonly IExerciseClock _exerciseClock;
    private readonly TimeProvider _timeProvider;
    private readonly MediaUploadOptions _options;
    private readonly ILogger<MediaUploadService> _logger;

    /// <summary>Creates the service.</summary>
    /// <param name="dbContext">The persistence context.</param>
    /// <param name="exerciseContext">The resolved exercise scope — the ONLY scoping source.</param>
    /// <param name="staffSessionAccessor">Identifies a staff caller.</param>
    /// <param name="sessionPersonaAccessor">Identifies a persona-bound participant caller.</param>
    /// <param name="staffAssignments">The staff caller's own assignments (COR-005 re-check).</param>
    /// <param name="httpContextAccessor">The current request (its principal names the account for the log line).</param>
    /// <param name="store">The media store.</param>
    /// <param name="signer">The read-URL signer.</param>
    /// <param name="exerciseClock">The native per-exercise scenario clock (COR-050).</param>
    /// <param name="timeProvider">The server wall clock.</param>
    /// <param name="options">The upload limits.</param>
    /// <param name="logger">Diagnostics logger (never logs token material).</param>
    public MediaUploadService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ICurrentStaffSessionAccessor staffSessionAccessor,
        ICurrentSessionPersonaAccessor sessionPersonaAccessor,
        StaffAssignmentService staffAssignments,
        IHttpContextAccessor httpContextAccessor,
        IMediaStore store,
        IMediaUrlSigner signer,
        IExerciseClock exerciseClock,
        TimeProvider timeProvider,
        IOptions<MediaUploadOptions> options,
        ILogger<MediaUploadService> logger)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(staffSessionAccessor);
        ArgumentNullException.ThrowIfNull(sessionPersonaAccessor);
        ArgumentNullException.ThrowIfNull(staffAssignments);
        ArgumentNullException.ThrowIfNull(httpContextAccessor);
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(signer);
        ArgumentNullException.ThrowIfNull(exerciseClock);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(logger);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _staffSessionAccessor = staffSessionAccessor;
        _sessionPersonaAccessor = sessionPersonaAccessor;
        _staffAssignments = staffAssignments;
        _httpContextAccessor = httpContextAccessor;
        _store = store;
        _signer = signer;
        _exerciseClock = exerciseClock;
        _timeProvider = timeProvider;
        _options = options.Value;
        _logger = logger;
    }

    /// <summary>Runs one upload.</summary>
    /// <param name="contentType">The request's <c>Content-Type</c> (must be <c>multipart/form-data</c> with a boundary).</param>
    /// <param name="body">The request body, read once, forward-only.</param>
    /// <param name="cancellationToken">Cancels the upload.</param>
    /// <returns>The outcome.</returns>
    public async Task<MediaUploadResult> UploadAsync(string? contentType, Stream body, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(body);

        // 1. Scope — the ONLY source of the exercise (COR-001). Guid.Empty is the fail-closed sentinel.
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return MediaUploadResult.Failed(MediaUploadOutcome.ScopeUnresolved);
        }

        var exerciseId = scope.Value;

        // 2. Who is uploading — staff first (a staff session may carry a persona too; staff must be ASSIGNED to this
        //    exercise), then a POSITIVE allowlist on the participant kind. Anything else is authenticated but has
        //    nobody to upload as.
        var uploader = await ResolveUploaderAsync(exerciseId, cancellationToken);
        if (uploader is null)
        {
            return MediaUploadResult.Failed(MediaUploadOutcome.Forbidden);
        }

        // 3. No store → 503, and nothing else in the API is affected.
        if (!_store.IsConfigured)
        {
            return MediaUploadResult.Failed(MediaUploadOutcome.StoreUnavailable);
        }

        var boundary = TryGetBoundary(contentType);
        if (boundary is null)
        {
            return MediaUploadResult.Failed(MediaUploadOutcome.Invalid, "The request must be multipart/form-data with a 'file' part.");
        }

        var upload = new UploadState();
        try
        {
            var failure = await ReadBodyAsync(boundary, body, exerciseId, upload, cancellationToken);
            if (failure is not null)
            {
                return failure;
            }

            if (upload.Stored is null)
            {
                return MediaUploadResult.Failed(MediaUploadOutcome.Invalid, "A 'file' part is required.");
            }

            var hints = await ValidateHintsAsync(upload, exerciseId, uploader.HumanId, cancellationToken);
            if (hints.Failure is not null)
            {
                return hints.Failure;
            }

            var asset = await PersistAsync(upload, hints, exerciseId, uploader.HumanId, cancellationToken);
            upload.Committed = true;

            // Hoisted so the log argument is a plain local read (CA1873).
            var account = AccountKey();
            LogUploaded(asset.Id, exerciseId, account, asset.Kind, asset.Bytes);

            var toSign = hints.Poster is null ? new[] { asset } : new[] { asset, hints.Poster };
            var urls = await _signer.GetReadUrlsAsync(toSign, cancellationToken);
            return MediaUploadResult.Created(MediaAssetView.FromAsset(
                asset, urls[asset.Id], hints.Poster is null ? null : urls[hints.Poster.Id]));
        }
        finally
        {
            if (upload.Stored is not null && !upload.Committed)
            {
                // Zero rows written → no blob left behind either (best effort; never masks the outcome). Stored is set
                // only once SaveAsync COMPLETED, so this can never delete a pre-existing blob a store refused to
                // overwrite; a store cleans up its own partial on failure.
                await _store.DeleteAsync(upload.Stored.BlobName, CancellationToken.None);
            }
        }
    }

    /// <summary>Walks the multipart sections, streaming the one file part to the store.</summary>
    /// <returns><c>null</c> to continue, or the failure to return.</returns>
    private async Task<MediaUploadResult?> ReadBodyAsync(
        string boundary, Stream body, Guid exerciseId, UploadState upload, CancellationToken cancellationToken)
    {
        // BodyLengthLimit bounds runaway (unknown/text) sections; it is NOT the file ceiling. It is the whole request's
        // own limit (largest kind + multipart overhead), a full MiB above every per-kind ceiling, and one read off the
        // reader never returns more than its ReadBufferBytes buffer — so for the file part MaxLengthReadStream always
        // sees the crossing read first and the answer is the exact per-kind 413. (A ceiling of "largest + 1" let the
        // reader's InvalidDataException win for an oversize video: a 400.) Consequently an InvalidDataException from
        // the reader can only mean a MALFORMED body — a bad delimiter line, oversized part headers — and is a 400.
        var reader = new MultipartReader(boundary, body, ReadBufferBytes)
        {
            HeadersCountLimit = 8,
            HeadersLengthLimit = 4 * 1024,
            BodyLengthLimit = _options.MaxRequestBodyBytes(),
        };

        try
        {
            MultipartSection? section;
            while ((section = await reader.ReadNextSectionAsync(cancellationToken)) is not null)
            {
                // form-data with or without a filename (IsFormDisposition() would exclude the file part).
                if (!ContentDispositionHeaderValue.TryParse(section.ContentDisposition, out var disposition)
                    || !disposition.DispositionType.Equals("form-data", StringComparison.OrdinalIgnoreCase))
                {
                    return MediaUploadResult.Failed(MediaUploadOutcome.Invalid, "Every part must be form-data.");
                }

                var name = HeaderUtilities.RemoveQuotes(disposition.Name).Value ?? string.Empty;
                if (string.Equals(name, FileField, StringComparison.Ordinal))
                {
                    var failure = await StoreFileAsync(section, disposition, exerciseId, upload, cancellationToken);
                    if (failure is not null)
                    {
                        return failure;
                    }
                }
                else if (TextFields.Contains(name))
                {
                    if (upload.Fields.ContainsKey(name))
                    {
                        return MediaUploadResult.Failed(MediaUploadOutcome.Invalid, $"'{name}' may appear only once.");
                    }

                    var value = await ReadBoundedTextAsync(section.Body, cancellationToken);
                    if (value is null)
                    {
                        return MediaUploadResult.Failed(MediaUploadOutcome.Invalid, $"'{name}' is too long.");
                    }

                    upload.Fields[name] = value.Trim();

                    // Fail fast on a kind hint that disagrees with a file already sniffed.
                    if (name == KindField && upload.Sniffed is not null && !KindHintMatches(upload))
                    {
                        return MediaUploadResult.Failed(MediaUploadOutcome.UnsupportedMediaType, KindMismatchRejection);
                    }
                }
                else
                {
                    // Unknown parts are ignored, but drained forward-only (never buffered).
                    await section.Body.CopyToAsync(Stream.Null, cancellationToken);
                }
            }
        }
        catch (MediaTooLargeException)
        {
            return TooLarge(upload);
        }
        catch (BadHttpRequestException exception) when (exception.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            // The endpoint's own request-size limit tripped (Kestrel) — same answer as the per-kind ceiling.
            return TooLarge(upload);
        }
        catch (InvalidDataException)
        {
            return MediaUploadResult.Failed(MediaUploadOutcome.Invalid, "The multipart body is malformed.");
        }
        catch (IOException) when (!cancellationToken.IsCancellationRequested)
        {
            return MediaUploadResult.Failed(MediaUploadOutcome.Invalid, "The multipart body is malformed or truncated.");
        }

        return null;
    }

    /// <summary>Sniffs the file part's head, then streams head + rest to the store under the sniffed kind's ceiling.</summary>
    private async Task<MediaUploadResult?> StoreFileAsync(
        MultipartSection section,
        ContentDispositionHeaderValue disposition,
        Guid exerciseId,
        UploadState upload,
        CancellationToken cancellationToken)
    {
        if (upload.FileSeen)
        {
            return MediaUploadResult.Failed(MediaUploadOutcome.Invalid, "Exactly one 'file' part is allowed.");
        }

        upload.FileSeen = true;

        // The type is decided from these bytes ALONE — the part's filename and Content-Type header are not inputs.
        var head = new byte[MediaSniffer.HeadLength];
        var headLength = await section.Body.ReadAtLeastAsync(head, head.Length, throwOnEndOfStream: false, cancellationToken);
        if (headLength == 0)
        {
            return MediaUploadResult.Failed(MediaUploadOutcome.UnsupportedMediaType, "The file is empty.");
        }

        var sniffed = MediaSniffer.Sniff(head.AsSpan(0, headLength));
        if (sniffed is null)
        {
            return MediaUploadResult.Failed(
                MediaUploadOutcome.UnsupportedMediaType,
                "Unsupported file type. Allowed: JPEG, PNG, GIF, WebP images and MP4, WebM videos.");
        }

        upload.Sniffed = sniffed;
        if (!KindHintMatches(upload))
        {
            return MediaUploadResult.Failed(MediaUploadOutcome.UnsupportedMediaType, KindMismatchRejection);
        }

        var maxBytes = sniffed.Kind == MediaKinds.Video ? _options.VideoMaxBytes : _options.ImageMaxBytes;
        var assetId = Guid.NewGuid();
        var blobName = MediaBlobNames.Build(exerciseId, assetId, sniffed.Extension);

        upload.OriginalFileName = SanitizeFileName(
            HeaderUtilities.RemoveQuotes(disposition.FileNameStar).Value
            ?? HeaderUtilities.RemoveQuotes(disposition.FileName).Value,
            sniffed.Extension);

        // A store that fails mid-save deletes its OWN partial (IMediaStore contract) — and a store that refuses an
        // existing name must not have that blob deleted by us. So the blob becomes ours to clean up (the caller's
        // finally, unless the row commits) only once SaveAsync has COMPLETED.
        var content = new PrefixedReadStream(head.AsMemory(0, headLength), section.Body);
        var bytes = await _store.SaveAsync(blobName, sniffed.ContentType, content, maxBytes, cancellationToken);
        upload.Stored = new StoredFile(assetId, blobName, bytes);
        return null;
    }

    /// <summary>Validates the hint fields once the whole body is read (and the kind is known).</summary>
    private async Task<ValidatedHints> ValidateHintsAsync(
        UploadState upload, Guid exerciseId, string uploaderHumanId, CancellationToken cancellationToken)
    {
        if (!KindHintMatches(upload))
        {
            return ValidatedHints.Fail(MediaUploadResult.Failed(MediaUploadOutcome.UnsupportedMediaType, KindMismatchRejection));
        }

        var isVideo = upload.Sniffed!.Kind == MediaKinds.Video;

        if (!TryParseDimension(upload, WidthField, out var width) || !TryParseDimension(upload, HeightField, out var height))
        {
            return ValidatedHints.Fail(MediaUploadResult.Failed(
                MediaUploadOutcome.Invalid, $"width and height must be whole numbers from 1 to {MaxDimension}."));
        }

        double? duration = null;
        if (upload.Fields.TryGetValue(DurationField, out var durationText))
        {
            if (!isVideo)
            {
                return ValidatedHints.Fail(MediaUploadResult.Failed(MediaUploadOutcome.Invalid, "durationSec applies to videos only."));
            }

            if (!double.TryParse(durationText, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
                || !double.IsFinite(parsed) || parsed <= 0 || parsed > MaxDurationSec)
            {
                return ValidatedHints.Fail(MediaUploadResult.Failed(
                    MediaUploadOutcome.Invalid, $"durationSec must be greater than 0 and at most {MaxDurationSec}."));
            }

            duration = parsed;
        }

        MediaAsset? poster = null;
        if (upload.Fields.TryGetValue(PosterField, out var posterText))
        {
            if (!isVideo)
            {
                return ValidatedHints.Fail(MediaUploadResult.Failed(MediaUploadOutcome.Invalid, "posterMediaId applies to videos only."));
            }

            if (!Guid.TryParse(posterText, out var posterId) || posterId == Guid.Empty)
            {
                return ValidatedHints.Fail(MediaUploadResult.Failed(MediaUploadOutcome.Invalid, PosterRejection));
            }

            // DP-16: the central filter already confines this to the scope; the explicit ExerciseId predicate keeps
            // the isolation visible here. Unknown, cross-exercise, non-image and someone else's image are the SAME
            // 400 — the message never confirms that another exercise's id exists.
            poster = await _dbContext.MediaAssets
                .AsNoTracking()
                .FirstOrDefaultAsync(
                    candidate => candidate.Id == posterId
                        && candidate.ExerciseId == exerciseId
                        && candidate.Kind == MediaKinds.Image
                        && candidate.UploadedByHumanId == uploaderHumanId,
                    cancellationToken);

            if (poster is null)
            {
                return ValidatedHints.Fail(MediaUploadResult.Failed(MediaUploadOutcome.Invalid, PosterRejection));
            }
        }

        return new ValidatedHints(null, width, height, duration, poster);
    }

    /// <summary>Writes the one <see cref="MediaAsset"/> row (one clock read shared by both time stamps' sources).</summary>
    private async Task<MediaAsset> PersistAsync(
        UploadState upload, ValidatedHints hints, Guid exerciseId, string uploaderHumanId, CancellationToken cancellationToken)
    {
        var now = _timeProvider.GetUtcNow();

        // org-scope-exempt(ResolvedScope): exerciseId is the SERVER-resolved scope from IExerciseContext (step 1 of
        // UploadAsync), never a form field; it only supplies the scenario-time fallback (COR-053).
        var exerciseScenarioTime = await _dbContext.Exercises
            .AsNoTracking()
            .Where(exercise => exercise.Id == exerciseId)
            .Select(exercise => exercise.CurrentScenarioTime)
            .FirstOrDefaultAsync(cancellationToken);

        var stored = upload.Stored!;
        var sniffed = upload.Sniffed!;
        var asset = new MediaAsset
        {
            Id = stored.AssetId,
            ExerciseId = exerciseId,
            Kind = sniffed.Kind,
            ContentType = sniffed.ContentType,
            BlobName = stored.BlobName,
            Bytes = stored.Bytes,
            Width = hints.Width,
            Height = hints.Height,
            DurationSec = hints.DurationSec,
            OriginalFileName = upload.OriginalFileName!,
            UploadedByHumanId = uploaderHumanId,
            // DP-18a staff-metadata exception (see the class remarks): clock ?? persisted scenario time ?? wall clock.
            // Never participant-visible; CreatedWallClock is the authoritative upload order.
            CreatedScenarioTime = _exerciseClock.CurrentScenarioTime(exerciseId) ?? exerciseScenarioTime ?? now,
            CreatedWallClock = now,
            PosterMediaAssetId = hints.Poster?.Id,
        };

        _dbContext.MediaAssets.Add(asset);
        await _dbContext.SaveChangesAsync(cancellationToken);
        return asset;
    }

    /// <summary>Resolves the uploading human: staff by <c>StaffUserId</c>, participant by a positive kind allowlist.</summary>
    private async Task<Uploader?> ResolveUploaderAsync(Guid exerciseId, CancellationToken cancellationToken)
    {
        var staff = await _staffSessionAccessor.GetCurrentStaffSessionAsync(cancellationToken);
        if (staff is not null)
        {
            // COR-005: the staff caller must be assigned to THIS exercise — re-checked explicitly, exactly as
            // EngineCockpitStaffAuthorizationFilter does for the library, never trusted from the active selection.
            var assignments = await _staffAssignments.GetAssignmentsAsync(cancellationToken);
            var assigned = assignments?.Any(
                assignment => Guid.TryParse(assignment.ExerciseId, out var assignedExerciseId) && assignedExerciseId == exerciseId) == true;
            if (!assigned)
            {
                return null;
            }

            // Same value PostAttributionResolver stamps as a staff post's ActingHumanId (COR-018).
            return new Uploader("staff", staff.StaffUserId.ToString());
        }

        var participant = await _sessionPersonaAccessor.GetCurrentSessionPersonaAsync(cancellationToken);
        if (participant is not null
            && string.Equals(participant.Kind, ParticipantSessionKind, StringComparison.Ordinal)
            && participant.ExerciseId == exerciseId
            && !string.IsNullOrWhiteSpace(participant.ActingHumanId))
        {
            return new Uploader(ParticipantSessionKind, participant.ActingHumanId);
        }

        return null;
    }

    /// <summary>
    /// The uploading ACCOUNT for the log line — the same key the <c>media-upload</c> rate limit partitions on
    /// (<c>participant:{AccountId}</c> / <c>staff:{StaffUserId}</c>), so a log search lines up with a 429.
    /// </summary>
    private string AccountKey() =>
        _httpContextAccessor.HttpContext is { } httpContext
            ? MediaUploadRateLimiterPolicy.PartitionKeyFor(httpContext)
            : "unknown";

    private static MediaUploadResult TooLarge(UploadState upload) =>
        MediaUploadResult.Failed(
            MediaUploadOutcome.TooLarge,
            upload.Sniffed?.Kind == MediaKinds.Video
                ? "The video is too large."
                : "The file is too large.");

    private static bool KindHintMatches(UploadState upload) =>
        upload.Sniffed is null
        || !upload.Fields.TryGetValue(KindField, out var hint)
        || string.Equals(hint, upload.Sniffed.Kind, StringComparison.Ordinal);

    private static bool TryParseDimension(UploadState upload, string field, out int? value)
    {
        value = null;
        if (!upload.Fields.TryGetValue(field, out var text))
        {
            return true;
        }

        if (!int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed) || parsed < 1 || parsed > MaxDimension)
        {
            return false;
        }

        value = parsed;
        return true;
    }

    /// <summary>
    /// The stored original file name: the last path segment (either separator), markup stripped
    /// (<see cref="PostSanitizer.Sanitize"/> — strip, never encode), control characters removed, bounded to the
    /// column. Falls back to <c>upload.{ext}</c> when nothing is left. Staff-only; never used for typing.
    /// </summary>
    /// <param name="fileName">The client's file name, if any.</param>
    /// <param name="extension">The sniffed extension for the fallback.</param>
    /// <returns>The sanitized name.</returns>
    public static string SanitizeFileName(string? fileName, string extension)
    {
        // Markup first (a closing tag contains '/', which must not be mistaken for a path separator), then the
        // path, then markup again in case the path cut exposed a fragment.
        var name = PostSanitizer.Sanitize(fileName ?? string.Empty);
        var lastSeparator = name.LastIndexOfAny(['/', '\\']);
        if (lastSeparator >= 0)
        {
            name = name[(lastSeparator + 1)..];
        }

        name = PostSanitizer.Sanitize(name);
        var builder = new StringBuilder(name.Length);
        foreach (var character in name)
        {
            if (!char.IsControl(character))
            {
                builder.Append(character);
            }
        }

        name = builder.ToString().Trim();
        if (name.Length > MediaAsset.MaxOriginalFileNameLength)
        {
            name = name[..MediaAsset.MaxOriginalFileNameLength];
        }

        return name.Length == 0 ? $"upload.{extension}" : name;
    }

    /// <summary>The multipart boundary of a <c>multipart/form-data</c> content type, or <c>null</c>.</summary>
    private static string? TryGetBoundary(string? contentType)
    {
        if (!MediaTypeHeaderValue.TryParse(contentType, out var mediaType)
            || !string.Equals(mediaType.MediaType.Value, "multipart/form-data", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var boundary = HeaderUtilities.RemoveQuotes(mediaType.Boundary).Value;
        return string.IsNullOrWhiteSpace(boundary) || boundary.Length > 70 ? null : boundary;
    }

    /// <summary>Reads a short text part, refusing (null) anything over <see cref="MaxTextFieldBytes"/>.</summary>
    private static async Task<string?> ReadBoundedTextAsync(Stream body, CancellationToken cancellationToken)
    {
        var buffer = new byte[MaxTextFieldBytes + 1];
        var read = await body.ReadAtLeastAsync(buffer, buffer.Length, throwOnEndOfStream: false, cancellationToken);
        if (read > MaxTextFieldBytes)
        {
            return null;
        }

        return Encoding.UTF8.GetString(buffer, 0, read);
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Information,
        Message = "Media uploaded: asset {AssetId} in exercise {ExerciseId} by account {Account} — {Kind}, {Bytes} bytes.")]
    private partial void LogUploaded(Guid assetId, Guid exerciseId, string account, string kind, long bytes);

    /// <summary>The uploading human and the kind of account behind them.</summary>
    private sealed record Uploader(string AccountKind, string HumanId);

    /// <summary>The blob written for this request (deleted unless the row commits).</summary>
    private sealed record StoredFile(Guid AssetId, string BlobName, long Bytes);

    /// <summary>The validated hints, or the failure that stopped validation.</summary>
    private sealed record ValidatedHints(MediaUploadResult? Failure, int? Width, int? Height, double? DurationSec, MediaAsset? Poster)
    {
        public static ValidatedHints Fail(MediaUploadResult failure) => new(failure, null, null, null, null);
    }

    /// <summary>The mutable per-request parse state.</summary>
    private sealed class UploadState
    {
        public Dictionary<string, string> Fields { get; } = new(StringComparer.Ordinal);

        public bool FileSeen { get; set; }

        public SniffedMediaType? Sniffed { get; set; }

        public StoredFile? Stored { get; set; }

        public string? OriginalFileName { get; set; }

        public bool Committed { get; set; }
    }
}
