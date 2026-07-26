namespace Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;

using System.Threading;
using System.Threading.Tasks;
using Pulse.WebApi.Features.ParticipantShell;

/// <summary>
/// The frozen participant shell-variant literals (<c>shellState.ts</c>'s <c>ShellVariant</c> union):
/// <c>full | readOnly | kiosk | preview</c>. String constants, never a C# enum — the wire value must be
/// <c>readOnly</c> verbatim, and the client guard fails closed on anything else.
/// </summary>
public static class ShellVariants
{
    /// <summary><c>full</c> — the interactive shell (realtime feed stream + "new posts" pill).</summary>
    public const string Full = "full";

    /// <summary><c>readOnly</c> — the shell renders but nothing may be authored through it.</summary>
    public const string ReadOnly = "readOnly";

    /// <summary><c>kiosk</c> — an unattended display variant. Not produced by the lifecycle.</summary>
    public const string Kiosk = "kiosk";

    /// <summary><c>preview</c> — staff previewing an exercise that is not open to participants.</summary>
    public const string Preview = "preview";
}

/// <summary>
/// The frozen participant overlay literals (<c>OverlayLayer/overlayState.ts</c>): states
/// <c>none | pause | endex | broadcast</c> and registers <c>in-fiction | out-of-fiction</c>.
/// </summary>
/// <remarks>
/// <b>Merge note (integration hazard 1).</b> <c>feature/world-steering-wave2</c> declares the identical
/// literals as <c>EngineRuntime.Steering.OverlayStateWire</c>. These are string CONSTANTS, not a second
/// mechanism — at merge, collapse onto whichever single home survives and point this slice at it. Nothing
/// about the composition contract below depends on which file the constants live in.
/// </remarks>
public static class LifecycleOverlayWire
{
    /// <summary><c>none</c> — no overlay; the participant shell renders nothing extra.</summary>
    public const string None = "none";

    /// <summary><c>pause</c> — the holding page (COR-032 Paused; CTL-023 Freeze).</summary>
    public const string Pause = "pause";

    /// <summary><c>endex</c> — the end-of-exercise overlay (COR-054; not written by this story).</summary>
    public const string Endex = "endex";

    /// <summary><c>broadcast</c> — a Break Fiction controller broadcast (not written by this story).</summary>
    public const string Broadcast = "broadcast";

    /// <summary><c>in-fiction</c> — the fiction-preserving register ("We'll be right back").</summary>
    public const string InFiction = "in-fiction";

    /// <summary><c>out-of-fiction</c> — the calm out-of-fiction notice ("EXERCISE PAUSED").</summary>
    public const string OutOfFiction = "out-of-fiction";
}

/// <summary>
/// One overlay contribution: the frozen triple, with no provenance attached (XC-002). Used for both the
/// lifecycle's own contribution and the CTL-023 steering contribution so the composer joins like with like.
/// </summary>
/// <param name="State">A <see cref="LifecycleOverlayWire"/> state literal.</param>
/// <param name="Register">
/// A <see cref="LifecycleOverlayWire"/> register literal, or <c>null</c> when this contributor does NOT choose
/// one. <b>Tier-2 human ruling (decision 3):</b> the lifecycle is an UNSPECIFIED register — COR-032 says the
/// holding page is "configurable (in-fiction or out-of-fiction, CTL-023)", so the register is CTL-023's to
/// author. A contributor that hardcodes one takes that choice away; see
/// <see cref="LifecycleOverlayComposer.Compose"/> for how an unspecified register composes.
/// </param>
/// <param name="Message">The overlay message; empty when there is no authored copy.</param>
public sealed record OverlayContribution(string State, string? Register, string Message)
{
    /// <summary>The "no overlay" contribution — the fail-closed identity of the composition.</summary>
    /// <remarks>Inactive, and authors no register: an absent overlay has no register to have an opinion about.</remarks>
    public static OverlayContribution None { get; } =
        new(LifecycleOverlayWire.None, Register: null, string.Empty);

    /// <summary>Whether this contribution is actually asking for an overlay.</summary>
    public bool IsActive => !string.Equals(State, LifecycleOverlayWire.None, StringComparison.Ordinal);
}

/// <summary>
/// <b>The CTL-023 seam this story composes with, rather than duplicating (integration hazard 1).</b> The
/// unmerged <c>feature/world-steering-wave2</c> makes <c>/api/overlay-state</c> a real write path: a
/// controller's tiered pause / WORLD FROZEN records a per-exercise overlay snapshot in its singleton
/// <c>OverlayStateService</c> and pushes it over SignalR. COR-032's Paused holding page targets the SAME wire
/// field and the SAME register.
/// </summary>
/// <remarks>
/// <para>
/// <b>This story adds NO second pause mechanism.</b> It writes no overlay state, owns no overlay store, and
/// pushes nothing. It only READS the live steering overlay through this one-method seam and joins it with the
/// lifecycle's own contribution in <see cref="LifecycleOverlayComposer"/> — a single composed
/// <c>OverlayStateResponse</c>, so a participant can never be shown two competing pause pages.
/// </para>
/// <para>
/// <b>The merge is a one-file adapter.</b> Whoever merges world-steering registers an implementation that
/// returns <c>overlayStateService.Get(exerciseId)</c> projected onto <see cref="OverlayContribution"/>, with
/// <c>services.Replace(ServiceDescriptor.Singleton&lt;ISteeringOverlaySource, WorldSteeringOverlaySource&gt;())</c>
/// (Replace, never TryAdd — the same override contract the shell projections use). Nothing else in this slice
/// changes, and the composition rules below become the reconciled behaviour of both features.
/// </para>
/// <para>
/// <b>Synchronous by design.</b> World-steering's store is an in-memory <c>ConcurrentDictionary</c> read, so
/// this seam is sync rather than a fake-async wrapper. The exercise id is a parameter and is always the
/// SERVER-resolved scope (COR-001) — an implementation must never accept one from a caller.
/// </para>
/// </remarks>
public interface ISteeringOverlaySource
{
    /// <summary>
    /// The live CTL-023 overlay for <paramref name="exerciseId"/>, or <c>null</c>/<see cref="OverlayContribution.None"/>
    /// when no steering overlay is active. Must never return another exercise's overlay, and must return the
    /// inactive answer for <see cref="Guid.Empty"/> (the fail-closed unresolved scope).
    /// </summary>
    /// <param name="exerciseId">The SERVER-resolved exercise (COR-001).</param>
    /// <returns>The active steering overlay, or <c>null</c> when none.</returns>
    OverlayContribution? GetCurrent(Guid exerciseId);
}

/// <summary>
/// The fail-closed default <see cref="ISteeringOverlaySource"/> for a host where the world-steering slice is
/// not wired: there is never an active steering overlay, so the composed result is the lifecycle's own
/// contribution alone. It never INVENTS an overlay nobody triggered.
/// </summary>
public sealed class NoSteeringOverlaySource : ISteeringOverlaySource
{
    /// <inheritdoc />
    public OverlayContribution? GetCurrent(Guid exerciseId) => null;
}

/// <summary>
/// <b>The reconciliation (integration hazard 1), in one pure function.</b> Joins COR-032's lifecycle overlay
/// contribution and CTL-023's live steering contribution into exactly ONE
/// <see cref="OverlayStateResponse"/> on the unchanged frozen wire shape.
/// </summary>
/// <remarks>
/// <para><b>The three rules, and why each is the safe direction:</b></para>
/// <list type="number">
/// <item>
/// <b>A non-pause steering overlay wins outright.</b> <c>broadcast</c> (Break Fiction) and <c>endex</c> are
/// authored, message-bearing, deliberate controller actions in a register the lifecycle cannot express. A
/// lifecycle holding page must never suppress one — hiding a Break Fiction broadcast behind "We'll be right
/// back" is a safety failure, not a cosmetic one. The lifecycle contribution yields to it entirely.
/// </item>
/// <item>
/// <b>Two pauses become ONE pause, joined field by field</b> — never two overlays and never a winner that
/// discards the other's reason to exist:
/// <list type="bullet">
///   <item><b>State:</b> <c>pause</c> if EITHER side asks for it. So a controller Resume during a
///   lifecycle-Paused exercise leaves the holding page up (the world is still administratively paused), and
///   ending the lifecycle Pause during a live Freeze leaves the Freeze page up. A naive "steering wins" rule
///   gets both of those backwards; this one cannot.</item>
///   <item><b>Register (Tier-2 human ruling, decision 3):</b> a register is composed only from the sides that
///   actually CHOSE one. Between two explicit choices, <c>out-of-fiction</c> dominates <c>in-fiction</c> —
///   world-steering's own stated safety direction (its <c>CoerceRegister</c> fails closed to out-of-fiction):
///   an out-of-fiction notice is safe when the fiction is already broken, whereas wrongly staying in-fiction
///   HIDES a real stop from participants. A single explicit choice simply stands, and when NEITHER side chose
///   one the composer falls back to <c>out-of-fiction</c> — so the fail-closed default survives when nothing
///   speaks, while CTL-023 can still choose <c>in-fiction</c> as COR-032 requires. (The lifecycle deliberately
///   chooses nothing; had it kept hardcoding <c>out-of-fiction</c>, domination would have made an in-fiction
///   holding page unreachable by construction and a COR-032 pause would break fiction by default — a D0 §4
///   cost.)</item>
///   <item><b>Message:</b> the steering message when it carries one, else the lifecycle's. The live
///   controller action is the more specific, more recent copy.</item>
/// </list>
/// The join is idempotent, and commutative <b>over the reachable domain</b> — see the commutativity note on
/// <see cref="Compose"/> — so the composed result never depends on which condition was observed first, which
/// matters because the two are written by different subsystems at different times.
/// </item>
/// <item>
/// <b>Neither active → <c>none</c>/<c>in-fiction</c>/empty</b>, byte-identical to the shipped Phase-1
/// constant. An exercise that is neither paused nor frozen sees no behaviour change at all.
/// </item>
/// </list>
/// <para>
/// <b>Holding-page CONTENT is out of scope</b> (this story and world-steering/08 both say so), so the
/// lifecycle contributes an EMPTY message and the participant shell renders its own static copy. There is no
/// per-exercise holding-page column on <c>Exercise</c> — story 01a authored none and this story authors no
/// migration — so "configurable" is realized as the CTL-023 register/message channel above, which is exactly
/// what COR-032 itself points at ("a configurable holding page (in-fiction or out-of-fiction, CTL-023)").
/// </para>
/// </remarks>
public static class LifecycleOverlayComposer
{
    /// <summary>
    /// The lifecycle's own overlay contribution for a state literal: <c>paused</c> asks for the holding page,
    /// every other state asks for nothing.
    /// </summary>
    /// <remarks>
    /// <b>The lifecycle authors NO register</b> (<c>null</c>) — a Tier-2 human ruling (decision 3). COR-032
    /// itself says the holding page is "configurable (in-fiction or out-of-fiction, <b>CTL-023</b>)", so the
    /// register belongs to the controller, not to the state machine. Hardcoding <c>out-of-fiction</c> here
    /// combined with rule 2's domination made in-fiction UNREACHABLE by construction, forcing every COR-032
    /// pause to break fiction. With nothing chosen on either side the composer still falls back to
    /// <c>out-of-fiction</c>, so the fail-closed default is unchanged when CTL-023 is silent.
    /// </remarks>
    /// <param name="state">A canonical or legacy lifecycle literal.</param>
    /// <returns>The lifecycle contribution — <c>none</c>, or an unspecified-register <c>pause</c>.</returns>
    public static OverlayContribution FromLifecycle(string? state) =>
        ExerciseLifecycleStates.TryParse(state, out var canonical)
        && string.Equals(canonical, ExerciseLifecycleStates.Paused, StringComparison.Ordinal)
            ? new OverlayContribution(LifecycleOverlayWire.Pause, Register: null, string.Empty)
            : OverlayContribution.None;

    /// <summary>Joins the two contributions into the single frozen <see cref="OverlayStateResponse"/>.</summary>
    /// <remarks>
    /// <para>
    /// <b>Commutativity is domain-limited — do not read it as a general law.</b> The join IS commutative over
    /// the reachable domain, because <see cref="FromLifecycle"/> can only ever yield <c>none</c> or an
    /// unspecified-register <c>pause</c>: swapping those two arguments cannot change the answer (the register
    /// join is symmetric, and the message rule is a no-op against the lifecycle's always-empty message). It is
    /// <b>not</b> commutative in general: <c>Compose(none, broadcast)</c> is a <c>broadcast</c> while
    /// <c>Compose(broadcast, none)</c> is a <c>pause</c>, because rule 1 is a deliberate STEERING-SIDE
    /// privilege — only an authored controller overlay may outrank a holding page. Callers must therefore keep
    /// passing the lifecycle contribution first.
    /// </para>
    /// </remarks>
    /// <param name="lifecycle">The COR-032 lifecycle contribution (<c>none</c> or <c>pause</c>).</param>
    /// <param name="steering">The live CTL-023 contribution, or <c>null</c> when none.</param>
    /// <returns>One composed overlay state.</returns>
    public static OverlayStateResponse Compose(OverlayContribution lifecycle, OverlayContribution? steering)
    {
        ArgumentNullException.ThrowIfNull(lifecycle);

        var live = steering is { IsActive: true } ? steering : null;

        // Rule 1 — a non-pause steering overlay (broadcast / endex) wins outright.
        if (live is not null && !string.Equals(live.State, LifecycleOverlayWire.Pause, StringComparison.Ordinal))
        {
            return Response(live.State, ComposeRegister(null, live.Register), live.Message);
        }

        var lifecyclePausing = lifecycle.IsActive;
        if (!lifecyclePausing && live is null)
        {
            // Rule 3 — nothing active: the shipped Phase-1 constant, byte for byte.
            return Response(LifecycleOverlayWire.None, LifecycleOverlayWire.InFiction, string.Empty);
        }

        // Rule 2 — one pause, joined field by field. Only an ACTIVE side's register is an authored choice.
        var register = ComposeRegister(
            lifecyclePausing ? lifecycle.Register : null,
            live?.Register);

        var message = live is not null && !string.IsNullOrEmpty(live.Message)
            ? live.Message
            : lifecycle.Message;

        return Response(LifecycleOverlayWire.Pause, register, message);
    }

    /// <summary>
    /// The register join (decision 3): domination applies only BETWEEN TWO EXPLICIT CHOICES; a lone choice
    /// stands; and <c>out-of-fiction</c> is the floor when neither side chose one.
    /// </summary>
    private static string ComposeRegister(string? lifecycleRegister, string? steeringRegister)
    {
        // Nobody authored a register — the fail-closed default (the lifecycle-pause-alone case).
        if (lifecycleRegister is null && steeringRegister is null)
        {
            return LifecycleOverlayWire.OutOfFiction;
        }

        // Exactly one side chose: its choice stands, so CTL-023 can hold an in-fiction holding page through a
        // concurrent COR-032 pause — which is what COR-032 asks for ("configurable ... CTL-023").
        if (lifecycleRegister is null)
        {
            return CoerceRegister(steeringRegister!);
        }

        if (steeringRegister is null)
        {
            return CoerceRegister(lifecycleRegister);
        }

        // Both chose: out-of-fiction dominates — wrongly staying in-fiction HIDES a real stop.
        return IsOutOfFiction(CoerceRegister(lifecycleRegister)) || IsOutOfFiction(CoerceRegister(steeringRegister))
            ? LifecycleOverlayWire.OutOfFiction
            : LifecycleOverlayWire.InFiction;
    }

    /// <summary>
    /// Fail-closed normalization of an authored register: anything that is not exactly <c>in-fiction</c> reads
    /// as <c>out-of-fiction</c> (world-steering's own <c>CoerceRegister</c> direction), so a coined literal can
    /// never reach the frozen wire union.
    /// </summary>
    private static string CoerceRegister(string register) =>
        string.Equals(register, LifecycleOverlayWire.InFiction, StringComparison.Ordinal)
            ? LifecycleOverlayWire.InFiction
            : LifecycleOverlayWire.OutOfFiction;

    private static bool IsOutOfFiction(string register) =>
        string.Equals(register, LifecycleOverlayWire.OutOfFiction, StringComparison.Ordinal);

    private static OverlayStateResponse Response(string state, string register, string message) =>
        new() { State = state, Register = register, Message = message };
}

/// <summary>
/// Story 03's real <see cref="IShellVariantProjection"/> — the COR-032 lifecycle decides the shell variant
/// behind the unchanged frozen <c>ShellStateResponse { variant }</c> shape (AC6).
/// </summary>
/// <remarks>
/// <para>
/// <b>Registered with <c>services.Replace(...)</c></b> from this slice's own
/// <see cref="LifecycleExtensions.AddExerciseLifecycle"/> — never <c>TryAddScoped</c>, which against 01b's
/// already-present <c>ConstantShellVariantProjection</c> is a silent no-op that leaves the constant serving
/// while this class's own unit tests still pass. See the projection-override contract on
/// <see cref="IChromeConfigProjection"/>.
/// </para>
/// <para>
/// <b>This projection cannot and does not fail closed.</b> Returning <c>readOnly</c> for an archived exercise
/// would still leave <c>/api/feed</c> serving posts. Refusing service is a PIPELINE concern and belongs to
/// <see cref="ExerciseLifecycleGatingMiddleware"/> (AC3). The mapping below is only what the shell LOOKS like
/// for a caller who is allowed to be there at all.
/// </para>
/// <para><b>The mapping:</b></para>
/// <list type="bullet">
///   <item><c>build</c> → <c>preview</c>: only staff reach it (participants are refused upstream), and what
///   they are doing is previewing a world under construction.</item>
///   <item><c>staged</c> → <c>full</c> (<b>Tier-2 human ruling, decision 1</c> — DO NOT "tidy" this back to
///   <c>readOnly</c>): <c>readOnly</c> is not a cosmetic downgrade. <c>mountContract.ts</c>'s
///   <c>affordancesAvailable(variant) =&gt; variant === 'full'</c> gates the realtime feed stream
///   (<c>Feed.tsx</c>: <c>useFeedStream({ enabled: affordances })</c>), the "▲ N new posts" pill and the
///   composer — so <c>readOnly</c> shipped Staged as a frozen snapshot with no error, during precisely the
///   pre-StartEx familiarization window Staged exists for. It also contradicted this story's own AC7 hooks,
///   where <c>staged</c> declares <c>AmbientWorldRuns = true</c> and <c>ParticipantWritesAccepted = true</c>.
///   The hooks were right; the projection was the half that disagreed.</item>
///   <item><c>live</c> → <c>full</c>: the interactive shell. Staged shares it (above); Live is what the clock
///   and scenario content add, and neither is a shell-variant concern.</item>
///   <item><c>paused</c> → <c>readOnly</c>: the holding page covers the shell; nothing beneath it may be
///   authored.</item>
///   <item><c>completed</c> / <c>archived</c> → <c>readOnly</c>: the run is over; a staff reader sees a
///   frozen world.</item>
///   <item>anything unrecognized → <c>readOnly</c>, the fail-closed direction the frontend's own default
///   already uses.</item>
/// </list>
/// <c>kiosk</c> is never produced by the lifecycle — it is an unattended-display concern, not a lifecycle one.
/// </remarks>
public sealed class LifecycleShellVariantProjection : IShellVariantProjection
{
    /// <summary>Maps a lifecycle state literal onto its frozen shell variant.</summary>
    /// <param name="state">A canonical or legacy lifecycle literal.</param>
    /// <returns>A <see cref="ShellVariants"/> literal.</returns>
    public static string VariantFor(string? state)
    {
        if (!ExerciseLifecycleStates.TryParse(state, out var canonical))
        {
            return ShellVariants.ReadOnly;
        }

        return canonical switch
        {
            ExerciseLifecycleStates.Build => ShellVariants.Preview,

            // Staged shares Live's variant on purpose (decision 1): 'full' is the only variant
            // affordancesAvailable() grants, and Staged's ambient world is meant to stream and be posted into.
            ExerciseLifecycleStates.Staged or ExerciseLifecycleStates.Live => ShellVariants.Full,

            _ => ShellVariants.ReadOnly,
        };
    }

    /// <inheritdoc />
    public Task<ShellStateResponse> ProjectAsync(
        ExerciseShellConfigSource source,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);

        return Task.FromResult(new ShellStateResponse { Variant = VariantFor(source.Status) });
    }
}

/// <summary>
/// Story 03's real <see cref="IOverlayStateProjection"/> — COR-032's Paused holding page, composed with any
/// live CTL-023 steering overlay into ONE state behind the unchanged frozen
/// <c>OverlayStateResponse { state, register, message }</c> shape (AC6).
/// </summary>
/// <remarks>
/// <para>
/// <b>Registered with <c>services.Replace(...)</c></b>, exactly as the shell-variant projection is, and for
/// the same reason: a copied <c>TryAddScoped</c> would silently lose to 01b's
/// <c>ConstantOverlayStateProjection</c> and every exercise would keep serving <c>none</c>.
/// </para>
/// <para>
/// The composition rules — and why this reads the CTL-023 seam instead of adding a second pause mechanism
/// beside it — are documented in full on <see cref="LifecycleOverlayComposer"/> and
/// <see cref="ISteeringOverlaySource"/>.
/// </para>
/// </remarks>
public sealed class LifecycleOverlayStateProjection : IOverlayStateProjection
{
    private readonly ISteeringOverlaySource _steeringOverlays;

    /// <summary>Creates the projection over the CTL-023 steering-overlay seam.</summary>
    /// <param name="steeringOverlays">The live steering overlay source (a no-op default until world-steering merges).</param>
    public LifecycleOverlayStateProjection(ISteeringOverlaySource steeringOverlays)
    {
        ArgumentNullException.ThrowIfNull(steeringOverlays);
        _steeringOverlays = steeringOverlays;
    }

    /// <inheritdoc />
    public Task<OverlayStateResponse> ProjectAsync(
        ExerciseShellConfigSource source,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);

        var lifecycle = LifecycleOverlayComposer.FromLifecycle(source.Status);
        var steering = _steeringOverlays.GetCurrent(source.ExerciseId);

        return Task.FromResult(LifecycleOverlayComposer.Compose(lifecycle, steering));
    }
}
