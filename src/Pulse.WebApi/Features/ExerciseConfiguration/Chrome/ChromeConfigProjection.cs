namespace Pulse.WebApi.Features.ExerciseConfiguration.Chrome;

using System.Threading;
using System.Threading.Tasks;
using Pulse.WebApi.Features.ParticipantShell;

/// <summary>
/// Story 02's real, PER-EXERCISE <see cref="IChromeConfigProjection"/> — the contribution that retires story
/// 01b's constant-preserving default (COR-031). It fills the FROZEN <see cref="ChromeConfigResponse"/> shape
/// (<c>{ enabled, top{text,fg,bg}, bottom{text,fg,bg} }</c>) from the resolved exercise's chrome columns, so
/// <c>GET /api/chrome-config</c> finally answers differently for different exercises while
/// <c>chromeConfig.ts</c>'s runtime guard and <c>ComplianceChrome.tsx</c> need no change at all.
/// </summary>
/// <remarks>
/// <para>
/// <b>Registration (the projection-override contract).</b> Registered by this story's OWN
/// <see cref="ChromeExtensions.AddComplianceChromeConfig"/> with
/// <c>services.Replace(ServiceDescriptor.Scoped&lt;IChromeConfigProjection, ChromeConfigProjection&gt;())</c>.
/// <c>Replace</c> is mandatory: <c>TryAddScoped</c> — 01b's own idiom — would be a SILENT no-op against the
/// already-registered default, no error would be raised, this class's own unit tests would still pass, and
/// every exercise would keep serving the shipped constant. Proven end to end by
/// <c>ChromeProjectionRegistrationTests</c> + <c>ChromeConfigProjectionCompositionTests</c>, which resolve the
/// interface from a fully composed provider rather than instantiating this class.
/// </para>
/// <para>
/// <b>Isolation (COR-001 / XC-001).</b> This type takes no exercise id and reads no database. Its whole input
/// is <see cref="ExerciseShellConfigSource"/>, which <c>ParticipantShellConfigService</c> built from the
/// SERVER-resolved scope (<c>IExerciseContext</c>) — there is no code path here through which a client-supplied
/// id could select an exercise.
/// </para>
/// <para>
/// <b>XC-002.</b> The source read model is already participant-safe (no staff name, schedule, hostnames or
/// practice flag), and this projection copies only chrome fields onto a participant response, so no staff-world
/// state can reach a participant surface through it.
/// </para>
/// <para>
/// <b>Unconfigured means "shipped constant", not "empty".</b> A <c>null</c> column is not configuration: it
/// falls back to the <see cref="ParticipantShellDefaults"/> value, exactly as 01b's default served it. That is
/// what keeps an exercise nobody has edited byte-for-byte unchanged, and it is why the staff editor shows an
/// empty box for <c>null</c> rather than pre-filling the constant.
/// </para>
/// <para>
/// <b>NFR-008 is applied here too.</b> <c>enabled</c> comes from
/// <see cref="ComplianceChromeGuard.ResolveEffectiveChromeEnabled"/>, not straight off the column, so a row
/// carrying both chrome and watermark off (only reachable outside this API — a hand edit or a legacy restore)
/// serves chrome VISIBLE rather than an unmarked participant world.
/// </para>
/// </remarks>
public sealed class ChromeConfigProjection : IChromeConfigProjection
{
    /// <inheritdoc />
    public Task<ChromeConfigResponse> ProjectAsync(
        ExerciseShellConfigSource source,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);
        cancellationToken.ThrowIfCancellationRequested();

        return Task.FromResult(new ChromeConfigResponse
        {
            Enabled = ComplianceChromeGuard.ResolveEffectiveChromeEnabled(
                source.ComplianceChromeEnabled,
                source.WatermarkEnabled),
            Top = new ChromeBannerConfig
            {
                Text = Fallback(source.ChromeTopText, ParticipantShellDefaults.ChromeTopText),
                Fg = Fallback(source.ChromeTopFg, ParticipantShellDefaults.ChromeBannerFg),
                Bg = Fallback(source.ChromeTopBg, ParticipantShellDefaults.ChromeBannerBg),
            },
            Bottom = new ChromeBannerConfig
            {
                Text = Fallback(source.ChromeBottomText, ParticipantShellDefaults.ChromeBottomText),
                Fg = Fallback(source.ChromeBottomFg, ParticipantShellDefaults.ChromeBannerFg),
                Bg = Fallback(source.ChromeBottomBg, ParticipantShellDefaults.ChromeBannerBg),
            },
        });
    }

    /// <summary>Returns the configured value, or the shipped Phase-1 constant when it is absent or blank.</summary>
    private static string Fallback(string? configured, string shipped) =>
        string.IsNullOrWhiteSpace(configured) ? shipped : configured;
}
