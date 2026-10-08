namespace Pulse.WebApi.Features.Social.PersonaAdmin;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Applies a validated persona profile merge-patch in the caller's exercise (demo-polish PE-BE, story 21;
/// COR-020, COR-022 edit-only, COR-024, XC-001, XC-002). Scoped lifetime, matching the
/// <see cref="PulseDbContext"/> unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (COR-001, DP-16).</b> The exercise comes only from <see cref="IExerciseContext"/>. The persona and
/// every media id are resolved through the exercise-scoped <see cref="PulseDbContext.Personas"/> and
/// <see cref="PulseDbContext.MediaAssets"/> sets, with the exercise restated in the predicate as defense in
/// depth (the same pattern as <c>PostIngestService</c>'s media lookup). Another exercise's persona is therefore
/// <see cref="PersonaProfileEditOutcome.NotFound"/>, exactly like an unknown id; another exercise's media id is
/// <see cref="PersonaProfileEditOutcome.Invalid"/> with exactly the text of an unknown id. In both cases nothing
/// is written. The single-column <c>AvatarMediaId</c>/<c>BannerMediaId</c> foreign keys cannot stop a
/// cross-exercise reference on their own, so this check is the guarantee (DP-16).
/// </para>
/// <para>
/// <b>One write.</b> The persona is loaded tracked, the present fields are applied, and ONE
/// <c>SaveChangesAsync</c> persists them (the scope write-guard runs there). <c>Handle</c>, <c>Kind</c>,
/// <c>PersonaType</c> and <c>ExerciseId</c> are never assigned, so the per-exercise unique handle index is never
/// touched. Clearing an avatar or banner only nulls the reference: the <c>MediaAsset</c> row and its blob stay
/// (XC-010, nothing is hard-deleted).
/// </para>
/// <para>
/// <b>Read-back.</b> The response is BP's <see cref="PersonaReadService.GetStaffPersonaAsync"/>, so it carries the
/// same signed <c>avatarUrl</c>/<c>bannerUrl</c> as <c>GET /api/personas</c>, and the same degradation: a signing
/// failure omits the URLs instead of failing the request.
/// </para>
/// <para>
/// <b>No telemetry (DP-9).</b> The console emits the one <c>steering_action</c> (<c>persona_edit</c>) event; a
/// server event would double-count it. The service writes an operational log line (who edited which persona,
/// and which field NAMES), which is not an XC-004 event. Field values are never logged.
/// </para>
/// </remarks>
public sealed partial class PersonaProfileEditService
{
    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly PersonaReadService _personaReadService;
    private readonly ILogger<PersonaProfileEditService> _logger;

    /// <summary>Creates the service over its persistence, scope, read-back and logging collaborators.</summary>
    /// <param name="dbContext">The persistence context. Its central exercise filter scopes every read.</param>
    /// <param name="exerciseContext">The server-resolved exercise scope (COR-001), the only scope source.</param>
    /// <param name="personaReadService">BP's persona read, used for the signed staff read-back.</param>
    /// <param name="logger">Operational log (the edit record). Never telemetry.</param>
    public PersonaProfileEditService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        PersonaReadService personaReadService,
        ILogger<PersonaProfileEditService> logger)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(personaReadService);
        ArgumentNullException.ThrowIfNull(logger);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _personaReadService = personaReadService;
        _logger = logger;
    }

    /// <summary>
    /// Applies <paramref name="patch"/> to <paramref name="personaId"/> in the caller's exercise and reads the
    /// persona back in the staff shape.
    /// </summary>
    /// <param name="personaId">The persona to edit. Resolved only through the exercise-scoped persona set.</param>
    /// <param name="patch">The validated merge-patch (<see cref="PersonaProfilePatchParser"/>).</param>
    /// <param name="staffUserId">The acting staff user, from the server-resolved session. Used only in the log line.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome the endpoint maps to an HTTP status.</returns>
    public async Task<PersonaProfileEditResult> EditAsync(
        Guid personaId,
        PersonaProfilePatch patch,
        Guid? staffUserId,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(patch);

        // 1. Scope comes only from IExerciseContext (COR-001). Fail closed when it is unresolved.
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return PersonaProfileEditResult.ScopeUnresolved();
        }

        var exerciseId = scope.Value;

        // 2. The persona, through the scoped set. Another exercise's id does not match under the central filter (and
        //    the restated ExerciseId predicate), so it is indistinguishable from an unknown id.
        var persona = await _dbContext.Personas
            .FirstOrDefaultAsync(candidate => candidate.Id == personaId && candidate.ExerciseId == exerciseId, cancellationToken);
        if (persona is null)
        {
            return PersonaProfileEditResult.NotFound();
        }

        // 3. Every media id must name an IMAGE in this exercise (DP-16). One scoped query for both.
        var mediaError = await ValidateMediaAsync(patch, exerciseId, cancellationToken);
        if (mediaError is not null)
        {
            return PersonaProfileEditResult.Invalid(mediaError);
        }

        // 4. Apply the present fields and persist them in one unit of work. An empty patch writes nothing.
        patch.ApplyTo(persona);
        await _dbContext.SaveChangesAsync(cancellationToken);

        var fields = patch.PresentFieldNames;
        if (fields.Count > 0)
        {
            LogPersonaEdited(exerciseId, personaId, staffUserId, fields);
        }

        // 5. The signed staff read-back (BP). It cannot miss — nothing deletes a persona — but never answer 200
        //    without a body: report it as not found instead.
        var updated = await _personaReadService.GetStaffPersonaAsync(personaId, cancellationToken);
        return updated is null ? PersonaProfileEditResult.NotFound() : PersonaProfileEditResult.Updated(updated);
    }

    /// <summary>
    /// Checks that each media id the patch SETS names an image asset in <paramref name="exerciseId"/>. A present
    /// <c>null</c> (clear) needs no check.
    /// </summary>
    /// <param name="patch">The patch.</param>
    /// <param name="exerciseId">The resolved exercise scope.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The 400 message for the first id that does not resolve, or <c>null</c> when all resolve.</returns>
    private async Task<string?> ValidateMediaAsync(
        PersonaProfilePatch patch, Guid exerciseId, CancellationToken cancellationToken)
    {
        var avatarId = patch.AvatarMediaId.IsPresent ? patch.AvatarMediaId.Value : null;
        var bannerId = patch.BannerMediaId.IsPresent ? patch.BannerMediaId.Value : null;
        var requested = new[] { avatarId, bannerId }.OfType<Guid>().Distinct().ToArray();
        if (requested.Length == 0)
        {
            return null;
        }

        // Scoped set + restated ExerciseId (defense in depth, DP-16): another exercise's asset is invisible here,
        // exactly like an unknown id. A video in this exercise is excluded by the Kind predicate, with the same text.
        var images = await _dbContext.MediaAssets
            .AsNoTracking()
            .Where(asset => requested.Contains(asset.Id) && asset.ExerciseId == exerciseId && asset.Kind == MediaKinds.Image)
            .Select(asset => asset.Id)
            .ToListAsync(cancellationToken);

        if (avatarId is { } avatar && !images.Contains(avatar))
        {
            return PersonaAdminMessages.AvatarMediaNotFound;
        }

        if (bannerId is { } banner && !images.Contains(banner))
        {
            return PersonaAdminMessages.BannerMediaNotFound;
        }

        return null;
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Information,
        Message = "Persona {PersonaId} profile edited in exercise {ExerciseId} by staff user {StaffUserId} (fields {Fields}).")]
    private partial void LogPersonaEdited(Guid exerciseId, Guid personaId, Guid? staffUserId, IReadOnlyList<string> fields);
}
