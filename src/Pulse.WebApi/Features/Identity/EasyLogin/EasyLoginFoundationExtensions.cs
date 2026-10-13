namespace Pulse.WebApi.Features.Identity.EasyLogin;

using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.DependencyInjection.Extensions;

/// <summary>
/// The composition entry point for the easy-login shared kernel (story 01). It registers services only: story 01 maps
/// no route and needs no middleware. The orchestrator wires <c>builder.Services.AddEasyLoginFoundation();</c> in the
/// backend seam commit, alongside <c>AddRoster()</c>, <c>AddPersonalLinks()</c>, <c>AddLinkCards()</c> and
/// <c>AddDayWord()</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Order-independent by construction.</b> Every kernel service is added with <c>TryAdd</c>, so a test host (or a
/// later story) that registered its own first keeps it. The one seam a later story overrides,
/// <see cref="IParticipantLinkIssuer"/>, is a fail-closed <see cref="NullParticipantLinkIssuer"/> here, and story 03's
/// <c>AddPersonalLinks()</c> must <c>Replace</c> it (not <c>TryAdd</c>), so the real issuer wins whichever of the two
/// calls runs first.
/// </para>
/// <para>
/// <b>Configuration.</b> <see cref="EasyLoginOptions"/> binds from <c>Authentication:EasyLogin</c> through
/// <c>BindConfiguration</c>, which reads <c>IConfiguration</c> from the container at options-build time (so this method
/// needs no <c>IConfiguration</c> parameter), and is validated at startup. <see cref="JoinUrlBuilder"/> reads
/// <c>Authentication:FrontendBaseUrl</c>, the key <c>webapp.bicep</c> provisions.
/// </para>
/// <para>
/// <b>Not registered, by design.</b> <see cref="RosterStaffRoleFilter"/> has no constructor dependencies and is created
/// by the minimal-API filter factory; it resolves <c>StaffAssignmentService</c> (B2's <c>AddStaffIdentity()</c>) and
/// <c>IExerciseContext</c> from the request scope, like the engine-cockpit filters it is modelled on.
/// </para>
/// </remarks>
public static class EasyLoginFoundationExtensions
{
    /// <summary>Registers the easy-login kernel: options, clock, Data Protection, token protector, URL builder, facts reader, link DTO factory and the null link issuer.</summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddEasyLoginFoundation(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddOptions<EasyLoginOptions>()
            .BindConfiguration(EasyLoginOptions.SectionName)
            .Validate(
                options => options.IsValid(),
                $"{EasyLoginOptions.SectionName}: DayRolloverHour must be 0 to {EasyLoginOptions.MaxDayRolloverHour}, "
                + "and JoinPermitPerMinute, WordPermitPerMinute and MaxCardsPerRequest must be positive.")
            .ValidateOnStart();

        // Stories 05 and 06 inject TimeProvider so day-boundary tests substitute a fake clock instead of sleeping.
        // TryAdd: several slices register the same system clock, and a test host's fake must win.
        services.TryAddSingleton(TimeProvider.System);

        // ASP.NET Data Protection (shared framework, no package, no secret) backs the reprintable link copy (EL-5).
        // Idempotent: it TryAdds its own services. Key-ring storage stays the App Service default (documented limitation).
        services.AddDataProtection();

        services.TryAddSingleton<IParticipantLinkTokenProtector, ParticipantLinkTokenProtector>();
        services.TryAddSingleton<JoinUrlBuilder>();
        services.TryAddSingleton<RosterLinkDtoFactory>();

        // Scoped to the PulseDbContext unit of work.
        services.TryAddScoped<ExerciseFactsReader>();

        // Fail-closed default; story 03's AddPersonalLinks() Replaces it with the real issuer.
        services.TryAddScoped<IParticipantLinkIssuer, NullParticipantLinkIssuer>();

        return services;
    }
}
