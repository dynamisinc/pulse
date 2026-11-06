namespace Pulse.WebApi.Features.Portal.Resources;

using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Features.Portal.Contracts;
using Pulse.WebApi.Features.Portal.Data;

/// <summary>
/// The Resources shelf (exercise-portal story 04, PRT-022): staff CRUD and reorder over <see cref="PortalResource"/>
/// rows, and the participant read of the visible ones. Resources are not <c>ContentItem</c>s: nothing here touches the
/// fiction pipeline, the alert source or E10 signal/noise.
/// </summary>
/// <remarks>
/// <para>
/// <b>Scope.</b> Every read goes through the context's central exercise filter (deleted and other-exercise rows never
/// load), and every row written passes <see cref="PortalWriteScope.EnsureInScope"/>. A hidden, deleted, unknown or
/// other-exercise id is one not-found.
/// </para>
/// <para>
/// <b>Cap and order.</b> Create, reorder and delete run in one transaction holding an exclusive per-exercise
/// application lock (<see cref="SqlApplicationLock"/>), so two concurrent creates at 24 cannot both pass <see cref="PortalLimits.CheckResourceCount"/>
/// and a reorder always sees the whole live set. Update needs no lock: <c>Version</c> is a concurrency token. A lock
/// not granted in time is a retryable <see cref="PortalWriteOutcome.Conflict"/>.
/// </para>
/// <para>
/// <b>Reorder takes a set.</b> <c>orderedIds</c> must equal the live set exactly, so an id that is unknown, deleted or
/// another exercise's makes the list wrong (<see cref="PortalWriteOutcome.Invalid"/>, 400), not a per-id 404; nothing
/// about the foreign id is disclosed either way.
/// </para>
/// <para>
/// <b>Body.</b> Sanitized once at write with <see cref="PortalResourceSanitizer"/> (NFR-004); stored sanitized, served
/// as stored.
/// </para>
/// </remarks>
public sealed partial class PortalResourceService : IPortalResourceService
{
    /// <summary>The longest raw <c>bodyHtml</c> accepted, in UTF-16 units, before sanitizing.</summary>
    public const int MaxBodyHtmlLength = 100_000;

    private const string StaleVersionMessage = "The resource was changed by someone else; reload it and try again.";
    private const string BusyMessage = "The shelf is being changed by someone else; try again in a moment.";
    private const int LockTimeoutMilliseconds = 5000;
    private const string MediaNotUsableMessage = "The media asset is not usable: it must be an image uploaded to this exercise.";
    private const string DocumentsDisabledMessage = "PDF attachments are not enabled for resources yet.";

    private readonly PulseDbContext _db;
    private readonly IExerciseContext _scope;
    private readonly ISanitizerProfileRegistry _sanitizer;
    private readonly PortalResourceOptions _options;
    private readonly IMediaUrlSigner? _signer;
    private readonly ILogger<PortalResourceService> _logger;

    /// <summary>Creates the service.</summary>
    /// <param name="db">The exercise-scoped context.</param>
    /// <param name="scope">The request's exercise scope.</param>
    /// <param name="sanitizer">F04's profile registry.</param>
    /// <param name="options">The shelf options.</param>
    /// <param name="logger">The logger.</param>
    /// <param name="signer">The media URL signer, when media is configured.</param>
    public PortalResourceService(
        PulseDbContext db,
        IExerciseContext scope,
        ISanitizerProfileRegistry sanitizer,
        IOptions<PortalResourceOptions> options,
        ILogger<PortalResourceService> logger,
        IMediaUrlSigner? signer = null)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(scope);
        ArgumentNullException.ThrowIfNull(sanitizer);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(logger);
        _db = db;
        _scope = scope;
        _sanitizer = sanitizer;
        _options = options.Value;
        _logger = logger;
        _signer = signer;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<PortalResourceDto>> ListVisibleAsync(CancellationToken cancellationToken = default)
    {
        var rows = await _db.LivePortalResources().AsNoTracking().Where(r => r.Visible).ToListAsync(cancellationToken);
        var media = await LoadMediaAsync(rows, cancellationToken);
        return rows.Select(row => ToParticipant(row, media)).ToList();
    }

    /// <inheritdoc />
    public async Task<PortalResourceDto?> GetVisibleAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var row = await _db.PortalResources.AsNoTracking()
            .FirstOrDefaultAsync(r => r.Id == id && r.Visible, cancellationToken);
        return row is null ? null : ToParticipant(row, await LoadMediaAsync([row], cancellationToken));
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<PortalResourceStaffDto>> ListStaffAsync(CancellationToken cancellationToken = default)
    {
        var rows = await _db.LivePortalResources().AsNoTracking().ToListAsync(cancellationToken);
        return await ToStaffAsync(rows, cancellationToken);
    }

    /// <inheritdoc />
    public async Task<PortalResourceStaffDto?> GetStaffAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var row = await _db.PortalResources.AsNoTracking().FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
        return row is null ? null : await ToStaffAsync(row, cancellationToken);
    }

    /// <inheritdoc />
    public async Task<PortalWriteResult<PortalResourceStaffDto>> CreateAsync(
        PortalResourceWriteRequest request, PortalStaffCaller caller, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(caller);

        if (CurrentExercise() is not { } exerciseId)
        {
            return NotFound<PortalResourceStaffDto>();
        }

        var draft = await ParseAsync(request, cancellationToken);
        if (draft.Errors.Count > 0)
        {
            return Invalid<PortalResourceStaffDto>(draft.Errors);
        }

        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);
        if (!await TryLockShelfAsync(exerciseId, cancellationToken))
        {
            return Busy<PortalResourceStaffDto>();
        }

        var limit = PortalLimits.CheckResourceCount(await _db.CountLivePortalResourcesAsync(cancellationToken));
        if (!limit.IsValid)
        {
            return Invalid<PortalResourceStaffDto>(limit.Errors);
        }

        var lastSortOrder = await _db.PortalResources.MaxAsync(r => (int?)r.SortOrder, cancellationToken) ?? 0;
        var row = new PortalResource
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            Title = draft.Title,
            SortOrder = lastSortOrder + 1,
            Version = 1,
        };
        Apply(row, draft, request.Visible);
        PortalWriteScope.EnsureInScope(_scope, row);
        _db.PortalResources.Add(row);
        await _db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        LogResourceWritten("create", row.Id, caller.ActingHumanId);
        return Ok(await ToStaffAsync(row, cancellationToken));
    }

    /// <inheritdoc />
    public async Task<PortalWriteResult<PortalResourceStaffDto>> UpdateAsync(
        Guid id, PortalResourceWriteRequest request, PortalStaffCaller caller, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(caller);

        var row = await _db.PortalResources.FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
        if (row is null)
        {
            return NotFound<PortalResourceStaffDto>();
        }

        // A stale version is a 409 whatever else is wrong with the body: the editor must reload first.
        if (request.Version != row.Version)
        {
            return Conflict<PortalResourceStaffDto>();
        }

        var draft = await ParseAsync(request, cancellationToken);
        if (draft.Errors.Count > 0)
        {
            return Invalid<PortalResourceStaffDto>(draft.Errors);
        }

        PortalWriteScope.EnsureInScope(_scope, row);
        row.Title = draft.Title;
        Apply(row, draft, request.Visible);
        row.Version++;

        try
        {
            await _db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            _db.ChangeTracker.Clear();
            return Conflict<PortalResourceStaffDto>();
        }

        LogResourceWritten("update", row.Id, caller.ActingHumanId);
        return Ok(await ToStaffAsync(row, cancellationToken));
    }

    /// <inheritdoc />
    public async Task<PortalWriteResult<IReadOnlyList<PortalResourceStaffDto>>> ReorderAsync(
        PortalResourceReorderRequest request, PortalStaffCaller caller, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(caller);

        if (CurrentExercise() is not { } exerciseId)
        {
            return NotFound<IReadOnlyList<PortalResourceStaffDto>>();
        }

        // System.Text.Json assigns an explicit `"orderedIds": null` over the contract's [] default.
        if (request.OrderedIds is null)
        {
            return Invalid<IReadOnlyList<PortalResourceStaffDto>>(["orderedIds is required."]);
        }

        if (request.OrderedIds.Count > PortalVocabulary.MaxResources)
        {
            return Invalid<IReadOnlyList<PortalResourceStaffDto>>(
                [$"orderedIds names more than {PortalVocabulary.MaxResources} resources."]);
        }

        var orderedIds = new List<Guid>(request.OrderedIds.Count);
        foreach (var raw in request.OrderedIds)
        {
            if (!Guid.TryParse(raw, out var parsed))
            {
                return Invalid<IReadOnlyList<PortalResourceStaffDto>>([$"'{raw}' is not a resource id."]);
            }

            orderedIds.Add(parsed);
        }

        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);
        if (!await TryLockShelfAsync(exerciseId, cancellationToken))
        {
            return Busy<IReadOnlyList<PortalResourceStaffDto>>();
        }

        var rows = await _db.LivePortalResources().ToListAsync(cancellationToken);
        if (orderedIds.Count != rows.Count
            || orderedIds.Distinct().Count() != orderedIds.Count
            || !rows.All(row => orderedIds.Contains(row.Id)))
        {
            return Invalid<IReadOnlyList<PortalResourceStaffDto>>(
                ["orderedIds must name every resource of the shelf exactly once."]);
        }

        var byId = rows.ToDictionary(row => row.Id);
        for (var position = 0; position < orderedIds.Count; position++)
        {
            var row = byId[orderedIds[position]];
            if (row.SortOrder != position + 1)
            {
                PortalWriteScope.EnsureInScope(_scope, row);
                row.SortOrder = position + 1;
                row.Version++;
            }
        }

        try
        {
            await _db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            _db.ChangeTracker.Clear();
            return Conflict<IReadOnlyList<PortalResourceStaffDto>>();
        }

        await transaction.CommitAsync(cancellationToken);

        LogShelfReordered(rows.Count, caller.ActingHumanId);
        var ordered = orderedIds.Select(id => byId[id]).ToList();
        return Ok(await ToStaffAsync(ordered, cancellationToken));
    }

    /// <inheritdoc />
    public async Task<PortalWriteResult<PortalResourceStaffDto>> DeleteAsync(
        Guid id, PortalStaffCaller caller, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(caller);

        if (CurrentExercise() is not { } exerciseId)
        {
            return NotFound<PortalResourceStaffDto>();
        }

        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);
        if (!await TryLockShelfAsync(exerciseId, cancellationToken))
        {
            return Busy<PortalResourceStaffDto>();
        }

        var row = await _db.PortalResources.FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
        if (row is null)
        {
            return NotFound<PortalResourceStaffDto>();
        }

        PortalWriteScope.EnsureInScope(_scope, row);
        row.Version++;
        _db.PortalResources.Remove(row); // converted to a DeletedAt stamp by PulseDbContext (XC-010)

        try
        {
            await _db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            _db.ChangeTracker.Clear();
            return Conflict<PortalResourceStaffDto>();
        }

        await transaction.CommitAsync(cancellationToken);

        LogResourceWritten("delete", row.Id, caller.ActingHumanId);
        return new PortalWriteResult<PortalResourceStaffDto> { Outcome = PortalWriteOutcome.Ok };
    }

    private static PortalWriteResult<T> Ok<T>(T value)
        where T : class => new() { Outcome = PortalWriteOutcome.Ok, Value = value };

    private static PortalWriteResult<T> NotFound<T>()
        where T : class => new() { Outcome = PortalWriteOutcome.NotFound };

    private static PortalWriteResult<T> Conflict<T>()
        where T : class => new() { Outcome = PortalWriteOutcome.Conflict, Errors = [StaleVersionMessage] };

    private static PortalWriteResult<T> Busy<T>()
        where T : class => new() { Outcome = PortalWriteOutcome.Conflict, Errors = [BusyMessage] };

    private static PortalWriteResult<T> Invalid<T>(IReadOnlyList<string> errors)
        where T : class => new() { Outcome = PortalWriteOutcome.Invalid, Errors = errors };

    private static void Apply(PortalResource row, ResourceDraft draft, bool visible)
    {
        row.Summary = draft.Summary;
        row.BodyHtml = draft.BodyHtml;
        row.MediaAssetId = draft.MediaAssetId;
        row.Visible = visible;
    }

    private static int CountCharacters(string value) => value.EnumerateRunes().Count();

    private static void CheckLength(List<string> errors, string label, string value, int limit, int column)
    {
        var length = CountCharacters(value);
        if (length > limit)
        {
            errors.Add($"The {label} is {length} characters; the limit is {limit}.");
        }
        else if (value.Length > column)
        {
            errors.Add($"The {label} is too long to store.");
        }
    }

    private static PortalResourceDto ToParticipant(PortalResource row, IReadOnlyDictionary<Guid, ContentMediaDto> media) => new()
    {
        Id = row.Id.ToString(),
        Title = row.Title,
        Summary = row.Summary,
        BodyHtml = row.BodyHtml,
        Media = MediaFor(row, media),
    };

    private static PortalResourceStaffDto ToStaff(PortalResource row, IReadOnlyDictionary<Guid, ContentMediaDto> media) => new()
    {
        Id = row.Id.ToString(),
        Title = row.Title,
        Summary = row.Summary,
        BodyHtml = row.BodyHtml,
        Media = MediaFor(row, media),
        SortOrder = row.SortOrder,
        Visible = row.Visible,
        Version = row.Version,
    };

    private static ContentMediaDto? MediaFor(PortalResource row, IReadOnlyDictionary<Guid, ContentMediaDto> media) =>
        row.MediaAssetId is { } mediaId && media.TryGetValue(mediaId, out var dto) ? dto with { Alt = row.Title } : null;

    private Guid? CurrentExercise() =>
        _scope.CurrentExerciseId is { } id && id != Guid.Empty ? id : null;

    /// <summary>
    /// Takes the exercise's shelf lock for the rest of the current transaction. <c>false</c> when it was not granted
    /// within <see cref="LockTimeoutMilliseconds"/> (the caller answers a retryable 409, never a 500).
    /// </summary>
    private async Task<bool> TryLockShelfAsync(Guid exerciseId, CancellationToken cancellationToken)
    {
        var resource = string.Create(CultureInfo.InvariantCulture, $"pulse:portal-resources:{exerciseId:N}");
        return await _db.Database.TryAcquireExclusiveAsync(resource, LockTimeoutMilliseconds, cancellationToken);
    }

    private async Task<ResourceDraft> ParseAsync(PortalResourceWriteRequest request, CancellationToken cancellationToken)
    {
        var errors = new List<string>();

        var title = request.Title?.Trim() ?? string.Empty;
        if (title.Length == 0)
        {
            errors.Add("A title is required.");
        }
        else
        {
            CheckLength(errors, "title", title, PortalVocabulary.ResourceTitleMaxLength, PortalResource.MaxTitleLength);
        }

        var summary = string.IsNullOrWhiteSpace(request.Summary) ? null : request.Summary.Trim();
        if (summary is not null)
        {
            CheckLength(errors, "summary", summary, PortalVocabulary.ResourceSummaryMaxLength, PortalResource.MaxSummaryLength);
        }

        string? body = null;
        if (!string.IsNullOrWhiteSpace(request.BodyHtml))
        {
            if (request.BodyHtml.Length > MaxBodyHtmlLength)
            {
                errors.Add($"The body is {request.BodyHtml.Length} characters; the limit is {MaxBodyHtmlLength}.");
            }
            else
            {
                var sanitized = _sanitizer.Sanitize(PortalResourceSanitizer.ProfileName, request.BodyHtml).Trim();
                body = sanitized.Length == 0 ? null : sanitized;
            }
        }

        var (mediaId, mediaError) = await ResolveMediaAsync(request.MediaAssetId, cancellationToken);
        if (mediaError is not null)
        {
            errors.Add(mediaError);
        }

        return new ResourceDraft(title, summary, body, mediaId, errors);
    }

    /// <summary>
    /// An image of this exercise (or, behind <see cref="PortalResourceOptions.DocumentAttachmentsEnabled"/>, a document).
    /// An asset exists only after the media pipeline (sniffer, size cap, scan) accepted it. Another exercise's id is
    /// invisible through the central filter, so it reads as "not usable", never as "exists elsewhere".
    /// </summary>
    private async Task<(Guid? Id, string? Error)> ResolveMediaAsync(string? raw, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return (null, null);
        }

        if (!Guid.TryParse(raw, out var id))
        {
            return (null, MediaNotUsableMessage);
        }

        var kind = await _db.MediaAssets.AsNoTracking()
            .Where(asset => asset.Id == id)
            .Select(asset => asset.Kind)
            .FirstOrDefaultAsync(cancellationToken);

        return kind switch
        {
            MediaKinds.Image => (id, null),
            MediaKinds.Document when _options.DocumentAttachmentsEnabled => (id, null),
            MediaKinds.Document => (null, DocumentsDisabledMessage),
            _ => (null, MediaNotUsableMessage),
        };
    }

    private async Task<PortalResourceStaffDto> ToStaffAsync(PortalResource row, CancellationToken cancellationToken) =>
        ToStaff(row, await LoadMediaAsync([row], cancellationToken));

    private async Task<IReadOnlyList<PortalResourceStaffDto>> ToStaffAsync(
        IReadOnlyList<PortalResource> rows, CancellationToken cancellationToken)
    {
        var media = await LoadMediaAsync(rows, cancellationToken);
        return rows.Select(row => ToStaff(row, media)).ToList();
    }

    /// <summary>
    /// The FC-3 media of <paramref name="rows"/>, keyed by asset id. A document is an <c>attachment</c> (the signer serves
    /// it as a download, never inline); an image is <c>inline</c>. A signing fault degrades to media-less rows.
    /// </summary>
    private async Task<IReadOnlyDictionary<Guid, ContentMediaDto>> LoadMediaAsync(
        IReadOnlyCollection<PortalResource> rows, CancellationToken cancellationToken)
    {
        var ids = rows.Select(row => row.MediaAssetId).OfType<Guid>().Distinct().ToList();
        if (ids.Count == 0)
        {
            return new Dictionary<Guid, ContentMediaDto>();
        }

        var assets = await _db.MediaAssets.AsNoTracking().Where(asset => ids.Contains(asset.Id)).ToListAsync(cancellationToken);
        if (assets.Count == 0 || _signer is null)
        {
            return new Dictionary<Guid, ContentMediaDto>();
        }

        IReadOnlyDictionary<Guid, string> urls;
        try
        {
            urls = await _signer.GetReadUrlsAsync(assets, cancellationToken);
        }
#pragma warning disable CA1031 // A storage fault must degrade the read to media-less resources, never fail it.
        catch (Exception ex) when (ex is not OperationCanceledException and not ExerciseScopeViolationException)
        {
            LogMediaSigningFailed(ex, assets.Count);
            return new Dictionary<Guid, ContentMediaDto>();
        }
#pragma warning restore CA1031

        var media = new Dictionary<Guid, ContentMediaDto>();
        foreach (var asset in assets)
        {
            if (urls.TryGetValue(asset.Id, out var url))
            {
                media[asset.Id] = new ContentMediaDto
                {
                    Id = asset.Id.ToString(),
                    Kind = asset.Kind,
                    Role = asset.Kind == MediaKinds.Document
                        ? ChannelVocabulary.MediaRoleAttachment
                        : ChannelVocabulary.MediaRoleInline,
                    Url = url,
                    ContentType = asset.ContentType,
                    Width = asset.Width,
                    Height = asset.Height,
                    DurationSec = asset.DurationSec,
                    Alt = string.Empty,
                };
            }
        }

        return media;
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Portal resource {Action} {ResourceId} by {ActingHumanId}.")]
    private partial void LogResourceWritten(string action, Guid resourceId, string actingHumanId);

    [LoggerMessage(Level = LogLevel.Information, Message = "Portal resources reordered ({Count} rows) by {ActingHumanId}.")]
    private partial void LogShelfReordered(int count, string actingHumanId);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Signing {Count} portal resource media URL(s) failed; serving without media.")]
    private partial void LogMediaSigningFailed(Exception exception, int count);

    private sealed record ResourceDraft(
        string Title, string? Summary, string? BodyHtml, Guid? MediaAssetId, IReadOnlyList<string> Errors);
}
