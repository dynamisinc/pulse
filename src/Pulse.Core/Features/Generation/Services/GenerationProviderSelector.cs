namespace Pulse.Core.Features.Generation.Services;

using Pulse.Core.Features.Generation.Models;

/// <summary>
/// The <see cref="IGenerationProvider"/> the reaction loop actually resolves (autonomy-safety story 07): a thin
/// per-exercise selector over the TWO providers <c>AddEngineGeneration</c> registers — the startup-configured
/// one and <see cref="FakeGenerationProvider"/> — dispatching each burst on the cut state in
/// <see cref="IGenerationProviderCutRegistry"/>. It makes "which provider runs" a runtime, per-exercise fact
/// with no restart and no config change, without adding a single reachable endpoint: the set of registered
/// providers is exactly what startup created (NFR-005 / ADP-025), and this only changes which
/// ALREADY-REGISTERED instance a given exercise resolves to.
/// </summary>
/// <remarks>
/// <para>
/// <b>Scope comes off the request, not from ambient state.</b> <see cref="GenerationRequest.ExerciseId"/> is
/// already <c>required</c>, so the dispatch needs no <c>IExerciseContext</c> and works identically on the
/// request-bound and the non-request-bound (reaction-loop / tick) paths.
/// </para>
/// <para>
/// <b><see cref="Name"/> and <see cref="Governance"/> pass through to the startup-configured provider,
/// unconditionally — even while a cut is active.</b> This is load-bearing, not an oversight:
/// </para>
/// <list type="bullet">
/// <item><c>GET /api/engine/settings</c>'s <c>provider</c> field must keep meaning "the startup-configured
/// provider, unchanged", so existing consumers do not silently start lying. The per-exercise EFFECTIVE
/// provider is a separate, directly-readable field (<c>effectiveProvider</c>) computed from the cut registry —
/// never re-derived by comparing two fields (WR-003).</item>
/// <item>Tier bindings are a DEPLOYMENT fact, not a per-exercise one. The tier-policy validation gate keys on
/// "no tiers configured AND the provider is Fake"; if a real provider with bound tiers is temporarily cut,
/// that validation must still run, because the cut is temporary and the chosen tier has to be servable on
/// restore.</item>
/// <item><see cref="GenerationGovernance"/> describes the DEPLOYMENT's attested NFR-005 / ADP-025 posture (read
/// by the NFR-006 security questionnaire off the running provider), so it must stay stable and keep
/// describing the configured provider.</item>
/// </list>
/// <para>
/// The provider that actually served a burst is reported truthfully where it belongs — in
/// <see cref="GenerationResult.ProviderName"/>, which the Fake provider stamps itself, so the
/// <c>engine.generated</c> telemetry for a cut burst says <c>Fake</c>.
/// </para>
/// </remarks>
public sealed class GenerationProviderSelector : IGenerationProvider
{
    private readonly IGenerationProvider _configured;
    private readonly IGenerationProvider _fake;
    private readonly IGenerationProviderCutRegistry _cuts;

    /// <summary>Creates the selector over the startup-configured provider, the Fake provider, and the cut registry.</summary>
    /// <param name="configuredProvider">The provider the <c>Generation:Provider</c> discriminator selected at startup.</param>
    /// <param name="fakeProvider">The offline provider a cut routes to (never egresses).</param>
    /// <param name="cutRegistry">The per-exercise cut state (COR-001).</param>
    public GenerationProviderSelector(
        IGenerationProvider configuredProvider,
        IGenerationProvider fakeProvider,
        IGenerationProviderCutRegistry cutRegistry)
    {
        ArgumentNullException.ThrowIfNull(configuredProvider);
        ArgumentNullException.ThrowIfNull(fakeProvider);
        ArgumentNullException.ThrowIfNull(cutRegistry);

        _configured = configuredProvider;
        _fake = fakeProvider;
        _cuts = cutRegistry;
    }

    /// <summary>The startup-configured provider a restore returns to — exposed so composition tests can assert what the selector wraps.</summary>
    public IGenerationProvider ConfiguredProvider => _configured;

    /// <summary>The offline provider a cut routes to.</summary>
    public IGenerationProvider FakeProvider => _fake;

    /// <inheritdoc />
    /// <remarks>The STARTUP-CONFIGURED provider's name, deliberately unchanged by an active cut — see the type remarks.</remarks>
    public string Name => _configured.Name;

    /// <inheritdoc />
    /// <remarks>The STARTUP-CONFIGURED provider's attested posture, deliberately unchanged by an active cut — see the type remarks.</remarks>
    public GenerationGovernance Governance => _configured.Governance;

    /// <inheritdoc />
    public Task<GenerationResult> GenerateAsync(GenerationRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        return Resolve(request.ExerciseId).GenerateAsync(request, cancellationToken);
    }

    /// <summary>
    /// The provider a burst for <paramref name="exerciseId"/> resolves to right now: Fake while a cut is
    /// active, otherwise the startup-configured provider. An EMPTY exercise id resolves to Fake — an unscoped
    /// generation request is a bug, and the fail-closed answer at an egress boundary is "do not egress"
    /// (COR-001), never "reach the live endpoint anyway".
    /// </summary>
    /// <param name="exerciseId">The exercise the burst belongs to.</param>
    /// <returns>The provider that will serve the burst.</returns>
    public IGenerationProvider Resolve(Guid exerciseId) =>
        exerciseId == Guid.Empty || _cuts.IsCutToFake(exerciseId) ? _fake : _configured;
}
