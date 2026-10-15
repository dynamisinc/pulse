namespace Pulse.WebApi.Features.Injects;

using System.Collections.Generic;
using System.Linq;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Injects.Import;

/// <summary>
/// The queue's MSEL import write path (demo-feedback story 03, DF-10). It lives with the import slice but is part of
/// <see cref="InjectQueueService"/>, so an imported item is built by exactly the code a console create or edit uses —
/// <see cref="InjectItemValidator.Parse"/>, <see cref="InjectItemValidator.CheckReferences"/>, the queue's own
/// <c>ApplyItemFields</c>/<c>ApplyChildren</c>, <see cref="InjectTransitions"/>' edit rules, the queue-membership token
/// and every item's <see cref="InjectItem.Version"/> — with one difference: ALL the rows commit in ONE
/// <c>SaveChanges</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Create, update or leave alone (DF-10).</b> A candidate whose <c>Inject #</c> matches no live item's
/// <see cref="InjectItem.ExternalRef"/> (case-insensitive, as the filtered unique index compares it) is created. One that
/// matches an item that differs from the file (alt text and engagement baseline included, story 16) is updated while the
/// item is editable (<see cref="InjectTransitions.WhyNotEditable"/>: pending, held or failed, nothing in flight) and left
/// <c>unchanged</c> with the reason otherwise ("already fired; not changed"). A deleted item's <c>ExternalRef</c> is free
/// again, because only live items are matched.
/// </para>
/// <para>
/// <b>Order (DF-22, story 16).</b> Created items are placed by planned minute among the pending items
/// (<see cref="ImportQueuePlacement"/>) and the whole order is written with <see cref="ReorderAsync"/>'s own mechanics:
/// the queue token read before the membership, <c>Order</c> 1..n via <c>WriteQueueOrder</c>, no item version bumped
/// for a shift, and one queue-token bump. Updated items keep their places (judged by their stored minute). Nothing is
/// pushed: open consoles pick the new order up on the run sheet's 3-second poll, exactly as they do after a reorder.
/// </para>
/// <para>
/// <b>Concurrency.</b> Creates bump the queue-membership token once; every update bumps its item's version. A save that
/// loses to another writer (a console edit, a create, a delete, a reorder, a fire, a second import inserting the same
/// <c>Inject #</c>, or a deadlock victim) is rolled back whole and the import is re-planned against the run sheet as it
/// is now, up to <see cref="MaxQueueAttempts"/> times; then it is a <c>409</c> and nothing is written.
/// </para>
/// <para>
/// <b>Dry run.</b> The same plan, read without tracking and with nothing computed about order; the only write is the
/// <c>injects.imported</c> event.
/// </para>
/// </remarks>
public sealed partial class InjectQueueService
{
    /// <summary>The readable 409 when the run sheet kept changing under the import.</summary>
    public const string ImportConflictMessage = "The run sheet changed while importing. Run the import again.";

    /// <summary>The reason a changed row leaves a fired (or firing) item alone.</summary>
    public const string ImportAlreadyFiredMessage = "already fired; not changed";

    /// <summary>The reason a changed row leaves a skipped item alone.</summary>
    public const string ImportSkippedMessage = "skipped in the run sheet; not changed";

    /// <summary>
    /// Applies (or, with <paramref name="dryRun"/>, only reports) an import plan against the caller's run sheet.
    /// </summary>
    /// <param name="plan">The planned rows (skipped/failed rows pass straight through to the report).</param>
    /// <param name="dryRun">Whether to report only.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The report, a 409 after repeated lost races, or the fail-closed result.</returns>
    public async Task<InjectResult<InjectImportResultDto>> ImportAsync(
        MselImportPlan plan,
        bool dryRun,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(plan);

        var caller = await ResolveCallerAsync(cancellationToken);
        if (caller is null)
        {
            return InjectResult.ScopeUnresolved<InjectImportResultDto>();
        }

        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return InjectResult.Ok(await ImportOnceAsync(plan, dryRun, caller, cancellationToken));
            }
            catch (Exception ex) when (ex is DbUpdateConcurrencyException
                || IsUniqueViolation(ex)
                || InjectLockConflicts.IsLockConflict(ex))
            {
                // A stale version, a unique-index race on (ExerciseId, ExternalRef), or a deadlock victim: the whole
                // save rolled back, so nothing of this attempt is in the database. Re-plan against the current run sheet.
                _dbContext.ChangeTracker.Clear();
                if (attempt >= MaxQueueAttempts)
                {
                    LogLockConflict(ex, "import", Guid.Empty);
                    return InjectResult.Conflict<InjectImportResultDto>(ImportConflictMessage, null);
                }
            }
        }
    }

    /// <summary>
    /// Whether a save failed on a unique index — here, a concurrent import (or two first-ever creates inserting the
    /// queue token row) that inserted the same key first. SQL Server 2601 (unique index) / 2627 (unique constraint).
    /// </summary>
    private static bool IsUniqueViolation(Exception exception) =>
        exception is DbUpdateException { InnerException: SqlException { Number: 2601 or 2627 } };

    private async Task<InjectImportResultDto> ImportOnceAsync(
        MselImportPlan plan,
        bool dryRun,
        Caller caller,
        CancellationToken cancellationToken)
    {
        var exerciseId = caller.ExerciseId;
        var facts = await ReadExerciseFactsAsync(exerciseId, cancellationToken);
        var time = TimeFor(exerciseId, facts);

        // ReorderAsync's rule (DF-22 rewrites the order): read the queue token BEFORE the membership, so a create or
        // delete that lands after this read fails the save (and the import is re-planned) instead of being ordered around.
        // It is bumped only if the import creates something; a dry run reads nothing about order.
        var queueToken = dryRun ? null : await ReadQueueTokenAsync(exerciseId, cancellationToken);
        var existing = await LoadImportedItemsAsync(exerciseId, track: !dryRun, cancellationToken);
        var byRef = new Dictionary<string, InjectItem>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in existing)
        {
            byRef.TryAdd(item.ExternalRef!, item);
        }

        var candidates = plan.Rows.Where(row => row.Candidate is not null).Select(row => row.Candidate!).ToList();
        var baseFacts = await ReadImportReferenceFactsAsync(candidates, existing, exerciseId, facts, cancellationToken);

        var createdItems = new List<InjectItem>();
        var reports = new List<InjectImportRowDto>(plan.Rows.Count);

        foreach (var row in plan.Rows)
        {
            if (row.Candidate is not { } candidate)
            {
                reports.Add(row.ToFinalReport());
                continue;
            }

            if (!byRef.TryGetValue(candidate.ExternalRef, out var item))
            {
                var request = ImportRequests.ForCreate(candidate);
                var parse = InjectItemValidator.Parse(request);
                var error = parse.Error ?? InjectItemValidator.CheckReferences(parse.Draft!, baseFacts);
                if (error is not null)
                {
                    reports.Add(row.ToReport(InjectImportRowStatuses.Failed, error));
                    continue;
                }

                if (!dryRun)
                {
                    var newItem = new InjectItem
                    {
                        Id = Guid.NewGuid(),
                        ExerciseId = exerciseId,
                        Kind = parse.Draft!.Kind,
                        Title = parse.Draft.Title,
                        Status = InjectStatuses.Pending,
                        Version = 1,
                        CreatedByHumanId = caller.StaffUserId,
                        CreatedAt = time.WallClock,
                        UpdatedAt = time.WallClock,
                        ExternalRef = request.ExternalRef,
                    };
                    ApplyItemFields(newItem, parse.Draft);
                    ApplyChildren(newItem, parse.Draft, time.WallClock);
                    _dbContext.InjectItems.Add(newItem);
                    createdItems.Add(newItem); // its Order is set by the placement below
                }

                reports.Add(row.ToReport(InjectImportRowStatuses.Created, null));
                continue;
            }

            reports.Add(PlanUpdate(row, candidate, item, baseFacts, dryRun, time.WallClock));
        }

        var result = InjectImportResultDto.From(dryRun, plan.SocialRows, reports);

        if (createdItems.Count > 0)
        {
            // DF-22: place the created items by planned minute among the pending items, then write the order exactly as
            // ReorderAsync does (Order 1..n, no item version bumped) with ONE queue-token bump, all in this one save.
            // The read is this exercise's live items only (the central filter plus the explicit ExerciseId predicate),
            // tracked so the new numbers are saved. An item this import updated keeps its place and is judged by its
            // STORED minute (EF's original value); a created item by the minute it is created with.
            var queue = await LiveItems(exerciseId).ToListAsync(cancellationToken);
            var placed = ImportQueuePlacement.Place(
                queue,
                createdItems,
                item =>
                {
                    var entry = _dbContext.Entry(item);
                    return entry.State == EntityState.Added
                        ? item.PlannedMinute
                        : entry.Property(row => row.PlannedMinute).OriginalValue;
                });
            WriteQueueOrder(placed);
            BumpQueue(exerciseId, queueToken);
        }

        _dbContext.TelemetryEvents.Add(InjectImportTelemetry.Imported(exerciseId, caller.StaffUserId, result, time));
        await _dbContext.SaveChangesAsync(cancellationToken);
        return result;
    }

    /// <summary>Decides (and, for a real import, applies) the outcome for a candidate whose item already exists.</summary>
    private InjectImportRowDto PlanUpdate(
        PlannedImportRow row,
        ImportCandidate candidate,
        InjectItem item,
        InjectReferenceFacts baseFacts,
        bool dryRun,
        DateTimeOffset now)
    {
        var request = ImportRequests.ForUpdate(candidate, item);
        var parse = InjectItemValidator.Parse(request);
        if (parse.Draft is not { } draft)
        {
            return row.ToReport(InjectImportRowStatuses.Failed, parse.Error);
        }

        var changes = ImportRequests.Differences(item, draft);
        if (changes.Count == 0)
        {
            return row.ToReport(InjectImportRowStatuses.Unchanged, null);
        }

        if (InjectTransitions.WhyNotEditable(item) is { } notEditable)
        {
            var reason = item.Status switch
            {
                InjectStatuses.Fired or InjectStatuses.Firing => ImportAlreadyFiredMessage,
                InjectStatuses.Skipped => ImportSkippedMessage,
                _ => notEditable,
            };
            return row.ToReport(InjectImportRowStatuses.Unchanged, reason);
        }

        var children = InjectTransitions.LiveChildren(item);
        var referenceFacts = baseFacts with
        {
            EditedItemId = item.Id,
            EditedItemChildIds = children.Select(post => post.Id).ToHashSet(),
            PublishedChildIds = children.Where(post => post.Status == InjectPostStatuses.Fired).Select(post => post.Id).ToHashSet(),
        };
        var error = InjectItemValidator.CheckReferences(draft, referenceFacts)
            ?? InjectTransitions.WhyEditWouldRewriteHistory(item, draft);
        if (error is not null)
        {
            return row.ToReport(InjectImportRowStatuses.Failed, error);
        }

        if (!dryRun)
        {
            ApplyItemFields(item, draft);
            ApplyChildren(item, draft, now);
            item.Version++;
            item.UpdatedAt = now;
        }

        return row.ToReport(InjectImportRowStatuses.Updated, "changed: " + string.Join(", ", changes));
    }

    /// <summary>
    /// The live items that carry an <c>ExternalRef</c>, with all their children. Two single-table reads, never a join —
    /// the lock-order reason is on <c>LoadItemAsync</c>. Tracked for a real import (they may be updated), untracked for a
    /// dry run.
    /// </summary>
    private async Task<List<InjectItem>> LoadImportedItemsAsync(Guid exerciseId, bool track, CancellationToken cancellationToken)
    {
        var query = _dbContext.InjectItems
            .Where(item => item.ExerciseId == exerciseId && item.DeletedAt == null && item.ExternalRef != null);
        var items = await (track ? query : query.AsNoTracking()).ToListAsync(cancellationToken);
        if (items.Count == 0)
        {
            return items;
        }

        var ids = items.Select(item => item.Id).ToList();
        var children = _dbContext.InjectItemPosts
            .Where(post => post.ExerciseId == exerciseId && ids.Contains(post.InjectItemId))
            .OrderBy(post => post.Id);
        if (track)
        {
            await children.LoadAsync(cancellationToken); // relationship fix-up fills item.Posts
            return items;
        }

        var lookup = (await children.AsNoTracking().ToListAsync(cancellationToken)).ToLookup(post => post.InjectItemId);
        foreach (var item in items)
        {
            item.Posts = lookup[item.Id].ToList();
        }

        return items;
    }

    /// <summary>
    /// The in-scope reference facts for the whole file, read once (the per-request <c>CheckReferencesAsync</c> reads
    /// them per item; a 2,000-row file must not cost thousands of queries). Same predicates, same sets: every set holds
    /// only ids found inside the resolved exercise, so another exercise's id reads as unknown (COR-001). The edited-item
    /// members are filled per row.
    /// </summary>
    private async Task<InjectReferenceFacts> ReadImportReferenceFactsAsync(
        IReadOnlyList<ImportCandidate> candidates,
        IReadOnlyList<InjectItem> existing,
        Guid exerciseId,
        ExerciseFacts facts,
        CancellationToken cancellationToken)
    {
        var personaIds = candidates.Select(candidate => candidate.PersonaId).Distinct().ToList();
        var personasInScope = personaIds.Count == 0
            ? []
            : await _dbContext.Personas
                .AsNoTracking()
                .Where(persona => personaIds.Contains(persona.Id) && persona.ExerciseId == exerciseId)
                .Select(persona => persona.Id)
                .ToListAsync(cancellationToken);

        var roster = await ReadRosterAsync(exerciseId, facts.OrganizationId, cancellationToken);

        var assetIds = candidates.SelectMany(candidate => candidate.Media).Select(media => media.AssetId).Distinct().ToList();
        var mediaKinds = assetIds.Count == 0
            ? new Dictionary<Guid, string>()
            : await _dbContext.MediaAssets
                .AsNoTracking()
                .Where(asset => assetIds.Contains(asset.Id) && asset.ExerciseId == exerciseId)
                .ToDictionaryAsync(asset => asset.Id, asset => asset.Kind, cancellationToken);

        // An update keeps the reply target a controller set in the console, so those targets are checked as an edit would.
        var keptChildren = existing.SelectMany(InjectTransitions.LiveChildren).ToList();
        var targets = keptChildren.Select(post => post.ReplyToInjectPostId).OfType<Guid>().Distinct().ToList();
        var replyTargets = targets.Count == 0
            ? new Dictionary<Guid, Guid>()
            : await (
                from post in _dbContext.InjectItemPosts.AsNoTracking()
                join item in _dbContext.InjectItems.AsNoTracking() on post.InjectItemId equals item.Id
                where targets.Contains(post.Id)
                    && post.ExerciseId == exerciseId
                    && post.DeletedAt == null
                    && item.DeletedAt == null
                select new { post.Id, post.InjectItemId }).ToDictionaryAsync(
                    row => row.Id, row => row.InjectItemId, cancellationToken);

        var parentPostIds = keptChildren.Select(post => post.ReplyToPostId).OfType<Guid>().Distinct().ToList();
        var postsInScope = parentPostIds.Count == 0
            ? []
            : await _dbContext.Posts
                .AsNoTracking()
                .Where(post => parentPostIds.Contains(post.Id) && post.ExerciseId == exerciseId && post.DeletedAt == null)
                .Select(post => post.Id)
                .ToListAsync(cancellationToken);

        return new InjectReferenceFacts(
            personasInScope.ToHashSet(),
            roster.Select(entry => entry.StaffUserId).ToHashSet(),
            replyTargets,
            EditedItemId: null,
            new HashSet<Guid>(),
            mediaKinds,
            postsInScope.ToHashSet(),
            new HashSet<Guid>());
    }
}
