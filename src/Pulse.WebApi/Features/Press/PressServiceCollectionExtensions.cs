namespace Pulse.WebApi.Features.Press;

using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Press.Contracts;
using Pulse.WebApi.Features.Press.Kind;
using Pulse.WebApi.Features.Press.Outlets;

/// <summary>
/// The press room's one DI entry point (E5), called once from the orchestrator-owned <c>Program.cs</c>. Each backend
/// press story adds its registrations here, guarded by <c>PressCompositionRootWiringTests</c>.
/// </summary>
public static class PressServiceCollectionExtensions
{
    /// <summary>Registers the press room's services.</summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddPress(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // Story 01: the `release` kind (FC-7). Scoped, so validation reads the exercise's own personas and media; TryAdd
        // keeps a second call from registering it twice.
        services.TryAddEnumerable(ServiceDescriptor.Scoped<IContentKindDescriptor, ReleaseKindDescriptor>());

        // Story 01: the PC-4 seam defaults. Story 06 replaces the approval gate, story 12 the reaction hook
        // (RemoveAll + add, or register before AddPress()).
        services.TryAddScoped<IReleaseApprovalGate, PassThroughReleaseApprovalGate>();
        services.TryAddScoped<IReleaseReactionHook, NoOpReleaseReactionHook>();

        // Story 01: org newsrooms under The Wire Room (PRS-012), for exercise setup and story 04's grant path.
        services.TryAddScoped<IOrgNewsroomProvisioner, OrgNewsroomProvisioner>();
        return services;
    }
}
