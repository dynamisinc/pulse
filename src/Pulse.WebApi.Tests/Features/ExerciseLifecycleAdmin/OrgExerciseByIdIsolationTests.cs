namespace Pulse.WebApi.Tests.Features.ExerciseLifecycleAdmin;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Features.ExerciseLifecycleAdmin;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// The other half of <see cref="CompositionRootWiringTests.TheOrgTierRoutes_TakeOnlyAllowListedExerciseIds"/>: that
/// test pins WHICH org-tier routes may carry an id (<see cref="ExerciseLifecycleAdminEndpoints.ExerciseIdRoutes"/>);
/// this one proves EVERY route on that list refuses another customer's exercise with a bare <c>404</c> that is
/// byte-for-byte the response for an id that does not exist (never a <c>403</c>, which would confirm existence), and
/// leaves the other customer's row untouched. Real pipeline, real SQL, the adversarial two-customer world.
/// </summary>
/// <remarks>
/// The other customer's exercise is put in <c>completed</c> first, so an unbounded archive WOULD succeed — the 404 is
/// the tenant bound closing the door, not the state machine refusing.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class OrgExerciseByIdIsolationTests
{
    /// <summary>
    /// How to call each allow-listed route with a valid body. Must cover the allow-list exactly, which
    /// <see cref="CompositionRootWiringTests"/> asserts (a plain fact, outside this SQL collection).
    /// </summary>
    internal static readonly IReadOnlyDictionary<string, Func<HttpClient, Guid, Task<HttpResponseMessage>>> Callers =
        new Dictionary<string, Func<HttpClient, Guid, Task<HttpResponseMessage>>>(StringComparer.Ordinal)
        {
            [ExerciseLifecycleAdminEndpoints.ExerciseByIdRoute] = (client, id) =>
                client.PatchAsJsonAsync(new Uri($"/api/org/exercises/{id}", UriKind.Relative), new { name = "Cross Tenant" }),
            [ExerciseLifecycleAdminEndpoints.ArchiveExerciseRoute] = (client, id) =>
                client.PostAsync(new Uri($"/api/org/exercises/{id}/archive", UriKind.Relative), content: null),
        };

    private readonly MsSqlContainerFixture _fixture;

    /// <summary>Creates the suite over the shared real-SQL fixture.</summary>
    /// <param name="fixture">The shared migrated database.</param>
    public OrgExerciseByIdIsolationTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>Every id-bearing org route: another customer's id is the same bare 404 as an unknown id, for every admin role.</summary>
    [RequiresDockerFact]
    public async Task EveryIdRoute_AnswersAnotherCustomersExerciseExactlyLikeAMissingOne_AndChangesNothing()
    {
        foreach (var role in new[] { ExerciseAdminRoles.Planner, ExerciseAdminRoles.OrgAdmin, ExerciseAdminRoles.Controller })
        {
            foreach (var (route, call) in Callers)
            {
                var world = await OrgAdminTestWorld.SeedAsync(_fixture, role);
                await using (var write = _fixture.CreateContext())
                {
                    var other = await write.Exercises.SingleAsync(e => e.Id == world.OtherExercise.Id);
                    other.Status = "completed";
                    await write.SaveChangesAsync();
                }

                await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
                using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

                using var foreign = await call(client, world.OtherExercise.Id);
                using var missing = await call(client, Guid.NewGuid());

                foreign.StatusCode.Should().Be(HttpStatusCode.NotFound, "{0} as {1}: another customer's exercise", route, role);
                missing.StatusCode.Should().Be(HttpStatusCode.NotFound);
                (await foreign.Content.ReadAsByteArrayAsync()).Should().Equal(
                    await missing.Content.ReadAsByteArrayAsync(),
                    "{0}: the body must not distinguish 'exists elsewhere' from 'does not exist'",
                    route);
                foreign.Content.Headers.ContentType?.ToString().Should().Be(missing.Content.Headers.ContentType?.ToString());

                await using var read = _fixture.CreateContext();
                var after = await read.Exercises.AsNoTracking().SingleAsync(e => e.Id == world.OtherExercise.Id);
                after.Name.Should().Be(world.OtherExercise.Name, "{0}: the other customer's row is untouched", route);
                after.Status.Should().Be("completed");
                (await read.TelemetryEvents.IgnoreQueryFilters().AsNoTracking()
                    .CountAsync(e => e.ExerciseId == world.OtherExercise.Id))
                    .Should().Be(0, "{0}: nothing was emitted against the other customer's exercise", route);

                // Positive control: the same call on the caller's OWN exercise is not a 404, so the 404 above is the
                // tenant bound and not a broken route.
                await using (var write = _fixture.CreateContext())
                {
                    var own = await write.Exercises.SingleAsync(e => e.Id == world.OwnExercise.Id);
                    own.Status = "completed";
                    await write.SaveChangesAsync();
                }

                using var ownResponse = await call(client, world.OwnExercise.Id);
                ownResponse.StatusCode.Should().Be(HttpStatusCode.OK, "{0} as {1} on the caller's own exercise", route, role);
            }
        }
    }
}
