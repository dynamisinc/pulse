namespace Pulse.WebApi.Features.ExerciseResolution;

/// <summary>
/// Resolves the request <c>Host</c> header to the owning exercise's id (COR-008) — the participant,
/// pre-auth realization of the central exercise scope (COR-001). Returns the exercise id for a provisioned
/// host, or <c>null</c> for an absent, malformed, or un-provisioned host (fail closed — an unresolved scope
/// collapses to <see cref="System.Guid.Empty"/> and the <c>PulseDbContext</c> global query filter then
/// matches ZERO rows, never all exercises).
/// </summary>
/// <remarks>
/// Abstracted behind an interface so the <see cref="ExerciseResolutionMiddleware"/> can be unit-tested with
/// a stand-in resolver (proving the fail-closed wiring) without a database.
/// </remarks>
public interface IHostExerciseResolver
{
    /// <summary>
    /// Resolves a request host to the id of the exercise provisioned on it.
    /// </summary>
    /// <param name="rawHost">
    /// The raw request host (the hostname without its port, e.g.
    /// <see cref="Microsoft.AspNetCore.Http.HostString.Host"/>). Case-normalized and format-validated before
    /// use; a malformed value is never used to build a query (NFR-004).
    /// </param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>
    /// The resolved exercise id, or <c>null</c> when the host is absent, malformed, or does not match any
    /// provisioned exercise <c>Hostname</c> or <c>BrandedDomain</c>.
    /// </returns>
    Task<Guid?> ResolveExerciseIdAsync(string? rawHost, CancellationToken cancellationToken);
}
