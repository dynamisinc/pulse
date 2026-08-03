namespace Pulse.WebApi.Tests.Features.ExerciseLifecycleAdmin;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseLifecycleAdmin;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// <b>The guard on <c>app.UseOrganizationResolution()</c> — the production writer of
/// <see cref="IOrganizationContext"/> (reviewer finding WR-006).</b> Before it existed, nothing in production
/// ever assigned <c>CurrentOrganizationId</c>: the org-axis global query filter matched
/// <see cref="Guid.Empty"/> on every request, so every <see cref="IOrganizationScoped"/> read returned zero
/// rows — fail-closed and harmless only because nothing read templates yet.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why a real request through the real pipeline is the only place this is observable.</b> The middleware's
/// correctness is entirely a question of WHERE it sits, and any host that stubs the organization context has
/// no ordering to get wrong. Wired above <c>UseSessionAuthentication()</c> the principal is still anonymous, so
/// no tenant is ever resolved and every <c>/api/org/*</c> route 401s while every template read silently
/// returns nothing — registered, mapped, resolvable, and inert. This codebase has shipped exactly that shape
/// of silent no-op before (<c>UseExerciseLifecycleGating</c>), which is why the guard is a real 200 vs 401
/// through <c>Program.cs</c>.
/// </para>
/// <para>
/// <b>Both directions are asserted.</b> A resolvable tenant serves data (so the guard cannot pass because
/// everything is refused), and a caller whose tenant CANNOT resolve is refused (so it cannot pass because
/// everything is served).
/// </para>
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class OrganizationResolutionPipelineOrderTests
{
    private readonly MsSqlContainerFixture _fixture;

    /// <summary>Creates the suite over the shared real-SQL fixture.</summary>
    /// <param name="fixture">The shared migrated database.</param>
    public OrganizationResolutionPipelineOrderTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>
    /// The ordering guard: a staff session whose <c>StaffUser</c> row names a real organization gets a served
    /// <c>200</c>, which is only possible if the tenant was resolved BEFORE the endpoint ran.
    /// </summary>
    [RequiresDockerFact]
    public async Task AStaffSession_HasItsCustomerTenantResolvedBeforeTheEndpointRuns()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.OrgAdmin);

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        var rows = await client.GetFromJsonAsync<List<OrgExerciseWire>>(
            new Uri(ExerciseLifecycleAdminEndpoints.ExercisesRoute, UriKind.Relative));

        rows!.Select(row => row.ExerciseId).Should().Contain(
            world.OwnExercise.Id.ToString(),
            "the row is only reachable through OrganizationScope.InOrganization(the resolved tenant). A 401 "
            + "instead means app.UseOrganizationResolution() is missing from Program.cs, or is wired above "
            + "app.UseSessionAuthentication() and therefore read an anonymous principal");
    }

    /// <summary>
    /// The fail-closed half: a live, perfectly valid staff session whose <c>StaffUser</c> row does not exist
    /// resolves NO tenant — and reaches nothing, rather than widening to every customer.
    /// </summary>
    [RequiresDockerFact]
    public async Task AStaffSessionWhoseTenantCannotBeResolved_ReachesNothing_RatherThanEverything()
    {
        var world = await OrgAdminTestWorld.SeedAsync(
            _fixture, ExerciseAdminRoles.OrgAdmin, seedCallerStaffUser: false);

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        var exercises = await client.GetAsync(
            new Uri(ExerciseLifecycleAdminEndpoints.ExercisesRoute, UriKind.Relative));
        var assignments = await client.GetAsync(
            new Uri(ExerciseLifecycleAdminEndpoints.StaffAssignmentsRoute, UriKind.Relative));
        var create = await client.PostAsJsonAsync(
            ExerciseLifecycleAdminEndpoints.ExercisesRoute, new { name = "Tenantless Attempt" });

        exercises.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "an unresolved tenant is the Guid.Empty sentinel no persisted row can carry, so the correct "
            + "outcome is 'reaches nothing'. A 200 with rows would mean the bound had been inverted to "
            + "'unknown tenant sees everything' — the cross-CUSTOMER analogue of the leak COR-001 forbids");
        assignments.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        create.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "and a WRITE with no resolvable tenant must be refused outright rather than stamped with an empty "
            + "OrganizationId — which the write guard would reject anyway, but as a 500 rather than a refusal");

        await using var read = _fixture.CreateContext();
        var created = await read.Exercises.AsNoTracking().CountAsync(e => e.Name == "Tenantless Attempt");
        created.Should().Be(0, "nothing was written");
    }

    /// <summary>
    /// The consequence the reviewer's WR-006 finding actually named: with a production writer in place, an
    /// org-owned SHARED LIBRARY asset (<see cref="PersonaTemplate"/>) is readable by its own customer's staff
    /// and invisible to another's — through the CENTRAL org query filter, with no explicit bound anywhere.
    /// </summary>
    /// <remarks>
    /// This is what makes the middleware load-bearing rather than decorative. It is asserted at the data layer
    /// (the filter is what the middleware feeds) because no endpoint reads templates yet — the point of the
    /// finding was that the seam was inert, and this proves it no longer is.
    /// </remarks>
    [RequiresDockerFact]
    public async Task WithATenantResolved_TheCentralOrgFilterServesThatCustomersLibrary_AndOnlyThatCustomers()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.OrgAdmin);

        var ownTemplateId = Guid.NewGuid();
        var otherTemplateId = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.PersonaTemplates.Add(new PersonaTemplate
            {
                Id = ownTemplateId,
                OrganizationId = world.OwnOrganizationId,
                DisplayName = "Own Customer Template",
                Handle = $"@own_{ownTemplateId:N}",
            });
            seed.PersonaTemplates.Add(new PersonaTemplate
            {
                Id = otherTemplateId,
                OrganizationId = world.OtherOrganizationId,
                DisplayName = "Other Customer Template",
                Handle = $"@other_{otherTemplateId:N}",
            });
            await seed.SaveChangesAsync();
        }

        // A context bound to the tenant the middleware would resolve for this caller.
        await using var scoped = _fixture.CreateContextForOrganization(world.OwnOrganizationId);
        var visible = await scoped.PersonaTemplates
            .AsNoTracking()
            .Where(template => template.Id == ownTemplateId || template.Id == otherTemplateId)
            .Select(template => template.Id)
            .ToListAsync();

        visible.Should().ContainSingle(
            "the central org filter admits exactly the resolved customer's library — before a production "
            + "writer existed this read returned ZERO rows for every caller, which was safe but inert")
            .Which.Should().Be(ownTemplateId);

        // The unresolved case, unchanged and still fail-closed: it must never widen to both.
        await using var unscoped = _fixture.CreateContext();
        var unresolved = await unscoped.PersonaTemplates
            .AsNoTracking()
            .Where(template => template.Id == ownTemplateId || template.Id == otherTemplateId)
            .CountAsync();
        unresolved.Should().Be(
            0, "an unresolved tenant matches zero library rows, never all customers' — do not invert this");

        var reallyBothExist = await unscoped.PersonaTemplates
            .IgnoreQueryFilters()
            .AsNoTracking()
            .CountAsync(template => template.Id == ownTemplateId || template.Id == otherTemplateId);
        reallyBothExist.Should().Be(
            2, "IgnoreQueryFilters proves both rows exist, so the zero above is the filter and not an empty table");
    }

    /// <summary>
    /// XC-002: a PARTICIPANT request leaves the tenant unset. The organization concept must not reach a
    /// participant code path at all, and the middleware is staff-only by construction rather than by luck.
    /// </summary>
    [RequiresDockerFact]
    public async Task AParticipantSession_NeverReachesTheOrganizationTierAtAll()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.OrgAdmin);
        var participantToken = $"participant-token-{Guid.NewGuid():N}";
        var host = $"participant-{Guid.NewGuid():N}.pulse.test";

        await using (var seed = _fixture.CreateContext())
        {
            var own = await seed.Exercises.SingleAsync(e => e.Id == world.OwnExercise.Id);
            own.Hostname = host;
            seed.Sessions.Add(Helpers.TestSessions.NewSession(participantToken, world.OwnExercise.Id));
            await seed.SaveChangesAsync();
        }

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = factory.CreateClient();
        client.BaseAddress = new Uri($"http://{host}");
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", participantToken);

        var response = await client.GetAsync(
            new Uri(ExerciseLifecycleAdminEndpoints.ExercisesRoute, UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "a participant session resolves no tenant (XC-002) and holds no staff role, so the org tier is "
            + "unreachable from the participant world — 401, never a list of the exercises their exercise's "
            + "customer happens to own");
    }
}
