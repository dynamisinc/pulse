namespace Pulse.WebApi.Features.Injects.Import;

using System.Collections.Generic;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The MSEL import (demo-feedback story 03, DF-9/10/11): reads a Cadence MSEL export as-is (<c>.xlsx</c> or <c>.csv</c>),
/// keeps the social-media rows, and turns each into a single-post run-sheet item through the queue's own write path —
/// with a dry run that reports the same thing and writes nothing but its telemetry event. Scoped, matching the
/// <see cref="PulseDbContext"/> unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>Scope (COR-001 / XC-001).</b> The exercise comes only from <see cref="IExerciseContext"/>; an unresolved scope is
/// the fail-closed <c>401</c> before the file is even read. Personas, media and assignees are read inside that scope
/// (the central filter plus an explicit predicate), so a handle that exists only in another exercise is simply unknown.
/// </para>
/// <para>
/// <b>Format by content.</b> A file is an <c>.xlsx</c> when its bytes start with <c>PK\x03\x04</c>; otherwise it must be
/// strict UTF-8 text, read as CSV. A file whose NAME or MIME type claims a workbook but whose bytes are not a zip is
/// refused rather than read as CSV, so a renamed text file is a readable <c>400</c>, never a surprise import.
/// </para>
/// </remarks>
public sealed class InjectImportService
{
    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly InjectQueueService _queue;

    /// <summary>Creates the import service.</summary>
    /// <param name="dbContext">The exercise-scoped persistence context.</param>
    /// <param name="exerciseContext">The server-authoritative exercise scope.</param>
    /// <param name="queue">The run-sheet queue whose write path the import goes through.</param>
    public InjectImportService(PulseDbContext dbContext, IExerciseContext exerciseContext, InjectQueueService queue)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(queue);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _queue = queue;
    }

    /// <summary>Imports (or, with <paramref name="dryRun"/>, reports on) one MSEL file.</summary>
    /// <param name="content">The file bytes (the endpoint has bounded them to <see cref="MselLimits.MaxFileBytes"/>).</param>
    /// <param name="fileName">The uploaded file name (used only to refuse a false workbook claim).</param>
    /// <param name="contentType">The part's content type (likewise).</param>
    /// <param name="dryRun">Whether to report only.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The report, a readable 400 reason, a 409 after repeated lost races, or the fail-closed result.</returns>
    public async Task<InjectResult<InjectImportResultDto>> ImportAsync(
        byte[] content,
        string? fileName,
        string? contentType,
        bool dryRun,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(content);

        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return InjectResult.ScopeUnresolved<InjectImportResultDto>();
        }

        var read = Read(content, fileName, contentType);
        if (read.Table is not { } table)
        {
            return InjectResult.Invalid<InjectImportResultDto>(read.Error!);
        }

        var assignees = await _queue.GetAssigneesAsync(cancellationToken);
        if (assignees.Value is not { } roster)
        {
            return InjectResult.ScopeUnresolved<InjectImportResultDto>();
        }

        var facts = new MselImportFacts(
            await ReadPersonasAsync(scope.Value, cancellationToken),
            await ReadLibraryAsync(scope.Value, cancellationToken),
            roster.Assignees
                .Select(assignee => new ImportAssignee(Guid.Parse(assignee.Id), assignee.DisplayName))
                .ToList());

        var plan = MselImportPlanner.Plan(table, facts);
        if (plan.Error is not null)
        {
            return InjectResult.Invalid<InjectImportResultDto>(plan.Error);
        }

        return await _queue.ImportAsync(plan, dryRun, cancellationToken);
    }

    /// <summary>Reads an upload into a table by its content (see the remarks), or says why it cannot be read.</summary>
    /// <param name="content">The file bytes.</param>
    /// <param name="fileName">The uploaded file name, if any.</param>
    /// <param name="contentType">The part's content type, if any.</param>
    /// <returns>The table, or the readable refusal.</returns>
    public static MselReadResult Read(byte[] content, string? fileName, string? contentType)
    {
        ArgumentNullException.ThrowIfNull(content);

        if (content.Length == 0)
        {
            return MselReadResult.Fail("the file is empty.");
        }

        if (content.Length > MselLimits.MaxFileBytes)
        {
            return MselReadResult.Fail(TooLargeMessage);
        }

        if (MselFileFormat.HasXlsxMagic(content))
        {
            return MselWorkbookReader.Read(content);
        }

        if (MselFileFormat.ClaimsWorkbook(fileName, contentType))
        {
            return MselReadResult.Fail(MselFileFormat.NotAWorkbookMessage);
        }

        var text = MselFileFormat.DecodeUtf8Text(content);
        return text is null ? MselReadResult.Fail(MselFileFormat.NotXlsxOrCsvMessage) : MselCsvReader.Read(text);
    }

    /// <summary>The refusal for a file over the size cap.</summary>
    public static string TooLargeMessage => $"the file exceeds the maximum size of {MselLimits.MaxFileBytes} bytes (2 MiB).";

    private async Task<List<ImportPersona>> ReadPersonasAsync(Guid exerciseId, CancellationToken cancellationToken) =>
        await _dbContext.Personas
            .AsNoTracking()
            .Where(persona => persona.ExerciseId == exerciseId)
            .OrderBy(persona => persona.Id)
            .Select(persona => new ImportPersona(persona.Id, persona.Handle, persona.DisplayName))
            .ToListAsync(cancellationToken);

    /// <summary>
    /// The exercise's media library as the staff library lists it: every asset except video poster frames and
    /// download-only documents (press-room story 02), which a post can never carry.
    /// </summary>
    private async Task<List<ImportMedia>> ReadLibraryAsync(Guid exerciseId, CancellationToken cancellationToken)
    {
        var posterIds = _dbContext.MediaAssets
            .Where(asset => asset.ExerciseId == exerciseId && asset.PosterMediaAssetId != null)
            .Select(asset => asset.PosterMediaAssetId!.Value);

        return await _dbContext.MediaAssets
            .AsNoTracking()
            .Where(asset => asset.ExerciseId == exerciseId && !posterIds.Contains(asset.Id) && asset.Kind != MediaKinds.Document)
            .Select(asset => new ImportMedia(asset.Id, asset.OriginalFileName, asset.Kind, asset.CreatedWallClock))
            .ToListAsync(cancellationToken);
    }
}
