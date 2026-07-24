namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;
using Pulse.Core.Features.Storylines.Services;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Review;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;

/// <summary>
/// A deterministic <see cref="IGenerationProvider"/> that returns a fixed burst every call — so a test can
/// drive the guard-before-human gate with exactly the content it wants (clean, converged, or an obeyed
/// injection tell). Compliant by construction (no egress), so it reports the in-process governance posture.
/// </summary>
internal sealed class StubGenerationProvider : IGenerationProvider
{
    private readonly IReadOnlyList<GeneratedPost> _posts;

    public StubGenerationProvider(IReadOnlyList<GeneratedPost> posts)
    {
        _posts = posts;
        Calls = 0;
    }

    public string Name => "Stub";

    public GenerationGovernance Governance => GenerationGovernance.InProcess;

    /// <summary>How many times <see cref="GenerateAsync"/> was invoked — proves re-rolls happened.</summary>
    public int Calls { get; private set; }

    public Task<GenerationResult> GenerateAsync(GenerationRequest request, CancellationToken cancellationToken = default)
    {
        Calls++;
        var result = new GenerationResult(
            Posts: _posts,
            Usage: new GenerationUsage(InputTokens: 42, OutputTokens: 17),
            Latency: TimeSpan.FromMilliseconds(12),
            ProviderName: Name,
            Model: "stub-deterministic");

        return Task.FromResult(result);
    }
}

/// <summary>A hand-set <see cref="IScenarioClock"/> — the scenario minute is whatever the test assigns.</summary>
internal sealed class FakeScenarioClock : IScenarioClock
{
    public int CurrentScenarioMinute { get; set; }
}

/// <summary>A no-op <see cref="IFeedBroadcaster"/> that records the exercise ids it was asked to fan out to.</summary>
internal sealed class RecordingFeedBroadcaster : IFeedBroadcaster
{
    public List<Guid> Broadcasts { get; } = [];

    public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default)
    {
        Broadcasts.Add(exerciseId);
        return Task.CompletedTask;
    }
}

/// <summary>
/// A recording <see cref="IEngineReviewBroadcaster"/> that captures every (exerciseId, item) push — so a test
/// can prove the reaction loop broadcasts a freshly enqueued review item to its own exercise (the on-enqueue
/// SignalR push). The real exercise-grouped SignalR fan-out is proven separately in
/// <c>EngineReviewBroadcasterTests</c>; here we only need to see WHAT the loop hands the broadcaster.
/// </summary>
internal sealed class RecordingReviewBroadcaster : IEngineReviewBroadcaster
{
    public List<(Guid ExerciseId, EngineReviewItemDto Item)> Pushes { get; } = [];

    public Task BroadcastReviewItemChangedAsync(
        Guid exerciseId,
        EngineReviewItemDto item,
        CancellationToken cancellationToken = default)
    {
        Pushes.Add((exerciseId, item));
        return Task.CompletedTask;
    }
}
