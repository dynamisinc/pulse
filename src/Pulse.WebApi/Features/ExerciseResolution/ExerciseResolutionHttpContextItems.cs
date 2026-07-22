namespace Pulse.WebApi.Features.ExerciseResolution;

using Microsoft.AspNetCore.Http;

/// <summary>
/// The cross-wave seam between host resolution (this story, exercise-isolation/08) and the participant
/// session layer (identity-auth-roles/03, Wave 2). <see cref="ExerciseResolutionMiddleware"/> stashes the
/// host-resolved exercise id in <see cref="HttpContext.Items"/> so the later session middleware can enforce
/// the always-Critical check: <b>a participant session's bound exercise MUST equal the host's resolved
/// exercise, else fail closed</b> (401/403). A session for exercise A presented on exercise B's host is
/// never honored (COR-008 / COR-001).
/// </summary>
/// <remarks>
/// This story owns only the WRITE (populating the stash on a resolved host). The session-mismatch comparison
/// and its fail-closed response are identity-auth-roles/03's to build — this seam merely exposes the value
/// it needs. <see cref="GetHostResolvedExerciseId"/> returns <c>null</c> when no host resolved; the session
/// layer must treat "no host resolved" for a participant session as a fail-closed case (it cannot confirm
/// the session belongs to this host).
/// </remarks>
public static class ExerciseResolutionHttpContextItems
{
    /// <summary>
    /// The <see cref="HttpContext.Items"/> key under which the host-resolved exercise id (a boxed
    /// <see cref="Guid"/>) is stashed. Present only when the request host matched a provisioned exercise.
    /// </summary>
    public const string HostResolvedExerciseIdKey = "Pulse.ExerciseResolution.HostResolvedExerciseId";

    /// <summary>Records the host-resolved exercise id for later middleware (the session-vs-host check).</summary>
    /// <param name="context">The current request context.</param>
    /// <param name="exerciseId">The exercise id the request host resolved to.</param>
    public static void SetHostResolvedExerciseId(this HttpContext context, Guid exerciseId)
    {
        ArgumentNullException.ThrowIfNull(context);
        context.Items[HostResolvedExerciseIdKey] = exerciseId;
    }

    /// <summary>Reads the host-resolved exercise id stashed by <see cref="ExerciseResolutionMiddleware"/>.</summary>
    /// <param name="context">The current request context.</param>
    /// <returns>The host-resolved exercise id, or <c>null</c> when the host did not resolve to an exercise.</returns>
    public static Guid? GetHostResolvedExerciseId(this HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        return context.Items.TryGetValue(HostResolvedExerciseIdKey, out var value) && value is Guid exerciseId
            ? exerciseId
            : null;
    }
}
