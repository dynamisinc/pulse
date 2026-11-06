namespace Pulse.WebApi.Features.Press.Contracts;

using Pulse.WebApi.Data.Entities;

/// <summary>
/// The default <see cref="IReleaseApprovalGate"/>: every release passes (approval is off by default, PRS-016). Lets
/// stories 04/05 build without story 06, which replaces it.
/// </summary>
public sealed class PassThroughReleaseApprovalGate : IReleaseApprovalGate
{
    /// <inheritdoc />
    public Task<ReleaseApprovalDecision> EvaluateAsync(
        ContentItem release, string humanId, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(release);
        return Task.FromResult(ReleaseApprovalDecision.Pass);
    }
}

/// <summary>The default <see cref="IReleaseReactionHook"/>: does nothing (story 12 wires the real observers).</summary>
public sealed class NoOpReleaseReactionHook : IReleaseReactionHook
{
    /// <inheritdoc />
    public Task OnReleasePublishedAsync(ReleasePublishedEvent published, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;
}
