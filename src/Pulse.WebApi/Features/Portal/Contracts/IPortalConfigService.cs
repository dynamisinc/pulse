namespace Pulse.WebApi.Features.Portal.Contracts;

/// <summary>
/// PC-3 / PC-4, the portal configuration seam (implemented by exercise-portal story 03): the participant
/// projection behind <c>GET /api/portal</c> and the staff read/write behind <c>GET|PUT /api/portal/config</c>.
/// </summary>
/// <remarks>
/// <para>
/// The exercise scope is the ambient, server-resolved one (<c>IExerciseContext</c>); no member takes an exercise
/// id and none can name another exercise (XC-001). Authorization and the <c>RequireChannelEnabled('portal')</c>
/// gate stay with the calling endpoint; staff routes work while the <c>portal</c> channel is disabled (F08).
/// </para>
/// <para>
/// An exercise with no <c>PortalConfig</c> row reads as the defaults (<see cref="PortalVocabulary.DefaultModuleOrder"/>,
/// <see cref="PortalVocabulary.DefaultLayoutKey"/>, the <c>"{CityName} Today"</c> / <c>"Local Today"</c> name) and no
/// read ever writes a row.
/// </para>
/// </remarks>
public interface IPortalConfigService
{
    /// <summary>
    /// The participant portal: the resolved masthead, and only the modules that are enabled in config AND whose
    /// source channel is enabled (<c>IChannelEnablement</c>), in stored order. Carries no staff field (XC-002).
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The participant projection; the defaults when no row exists.</returns>
    Task<PortalDto> GetParticipantPortalAsync(CancellationToken cancellationToken = default);

    /// <summary>The staff view of the stored config (every module setting, the version, the resolved name).</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The staff view; <c>version</c> <c>0</c> and the defaults when no row exists.</returns>
    Task<PortalConfigStaffDto> GetStaffConfigAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Replaces the config (creating the row on the first write). Validates against the PC-1 limits and
    /// vocabulary, the logo's exercise and kind, and the skin overrides via <c>ISkinOverridesValidator</c>; emits
    /// <c>portal_config_changed</c> (<see cref="PortalTelemetry.PortalConfigChanged"/>) in the same unit of work.
    /// </summary>
    /// <param name="request">The new config; a stale <c>version</c> is <see cref="PortalWriteOutcome.Conflict"/>.</param>
    /// <param name="caller">The authenticated staff caller.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome and, on success, the new staff view.</returns>
    Task<PortalWriteResult<PortalConfigStaffDto>> UpdateConfigAsync(
        PortalConfigWriteRequest request, PortalStaffCaller caller, CancellationToken cancellationToken = default);
}
