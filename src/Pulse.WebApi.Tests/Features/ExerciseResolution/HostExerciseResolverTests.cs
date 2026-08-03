namespace Pulse.WebApi.Tests.Features.ExerciseResolution;

using System;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// Story <c>exercise-isolation/08</c> (Tier-2) — integration proof of <see cref="HostExerciseResolver"/>
/// against a REAL SQL Server (Testcontainers), the only way to exercise the case-insensitive collation the
/// exact-match rule relies on. Seeds exercises with provisioned hosts and asserts a request host resolves to
/// exactly the owning exercise's id, matching on either the default subdomain (<c>Hostname</c>) or the
/// optional customer <c>BrandedDomain</c>; and that an unknown, malformed, or absent host resolves to
/// <c>null</c> (fail closed — never a default/first exercise). <see cref="RequiresDockerFactAttribute"/> so
/// it is a real <c>Skipped</c> on a Docker-less machine, never a silent <c>Passed</c> (Gate-1 W-001).
/// </summary>
[Collection(MsSqlCollection.Name)]
public class HostExerciseResolverTests
{
    private readonly MsSqlContainerFixture _fixture;

    public HostExerciseResolverTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task Resolves_ByHostname_ToTheOwningExercise()
    {
        var id = Guid.NewGuid();
        var host = $"h-{id:N}.example.com";
        await SeedExerciseAsync(id, hostname: host, brandedDomain: null);

        var resolved = await CreateResolver().ResolveExerciseIdAsync(host, CancellationToken.None);

        resolved.Should().Be(id, "the host matches the exercise's provisioned Hostname exactly");
    }

    [RequiresDockerFact]
    public async Task Resolves_ByBrandedDomain_ToTheOwningExercise()
    {
        var id = Guid.NewGuid();
        var branded = $"brand-{id:N}.example.org";
        await SeedExerciseAsync(id, hostname: $"h-{id:N}.example.com", brandedDomain: branded);

        var resolved = await CreateResolver().ResolveExerciseIdAsync(branded, CancellationToken.None);

        resolved.Should().Be(id, "the optional customer BrandedDomain also resolves to the exercise (Looking Glass)");
    }

    [RequiresDockerFact]
    public async Task Resolves_CaseInsensitively_ViaCollation()
    {
        var id = Guid.NewGuid();
        // Stored mixed/upper case; the incoming host differs only in case → must still match (CI collation).
        var storedUpper = $"ATL-{id:N}.EXAMPLE.COM";
        await SeedExerciseAsync(id, hostname: storedUpper, brandedDomain: null);

        var resolved = await CreateResolver().ResolveExerciseIdAsync(storedUpper.ToLowerInvariant(), CancellationToken.None);

        resolved.Should().Be(id, "host matching is case-insensitive (SQL_Latin1_General_CP1_CI_AS)");
    }

    [RequiresDockerFact]
    public async Task KnownHost_MatchingExerciseB_ResolvesToExerciseB_NeverExerciseA_NoCrossMatch()
    {
        // The uniqueness counterpart to the "resolves to the owning exercise" cases above: with TWO
        // provisioned exercises in the table, a request for B's host must resolve to B's id specifically —
        // never fall through to A's (e.g. a broken predicate that matched "any provisioned host" instead of
        // "THIS host", or an unordered/first-row query bug) — the always-Critical case once more than one
        // exercise is live at a time.
        var idA = Guid.NewGuid();
        var idB = Guid.NewGuid();
        var hostA = $"host-a-{idA:N}.example.com";
        var hostB = $"host-b-{idB:N}.example.com";

        await SeedExerciseAsync(idA, hostname: hostA, brandedDomain: null);
        await SeedExerciseAsync(idB, hostname: hostB, brandedDomain: null);

        var resolved = await CreateResolver().ResolveExerciseIdAsync(hostB, CancellationToken.None);

        resolved.Should().Be(idB, "a request for exercise B's host must resolve to B's id");
        resolved.Should().NotBe(idA, "a request for exercise B's host must never cross-match to exercise A's id");
    }

    [RequiresDockerFact]
    public async Task UnknownHost_ResolvesToNull_FailClosed()
    {
        // Seed one exercise so the table is non-empty; then query a host that matches nothing.
        await SeedExerciseAsync(Guid.NewGuid(), hostname: $"h-{Guid.NewGuid():N}.example.com", brandedDomain: null);

        var resolved = await CreateResolver()
            .ResolveExerciseIdAsync($"nomatch-{Guid.NewGuid():N}.example.com", CancellationToken.None);

        resolved.Should().BeNull("an un-provisioned host resolves to no scope — never a default/first exercise");
    }

    [RequiresDockerFact]
    public async Task AmbiguousHost_CrossColumnCollision_ResolvesToNull_FailClosed()
    {
        // No cross-column uniqueness guard exists: one exercise's Hostname can equal a DIFFERENT exercise's
        // BrandedDomain (the per-column filtered unique indexes do not prevent this). Such a host must fail
        // closed, never resolve to an arbitrary one of the two exercises (a silent cross-exercise misroute).
        var collidingHost = $"collide-{Guid.NewGuid():N}.example.com";
        var idA = Guid.NewGuid();
        var idB = Guid.NewGuid();
        await SeedExerciseAsync(idA, hostname: collidingHost, brandedDomain: null);
        await SeedExerciseAsync(idB, hostname: $"h-{idB:N}.example.com", brandedDomain: collidingHost);

        var resolved = await CreateResolver().ResolveExerciseIdAsync(collidingHost, CancellationToken.None);

        resolved.Should().BeNull(
            "a host matching two exercises (one's Hostname == another's BrandedDomain) fails closed — " +
            "never resolves to an arbitrary exercise (cross-exercise misroute on the scope-resolution seam)");
    }

    [RequiresDockerFact]
    public async Task MalformedHost_ResolvesToNull_WithoutQuerying()
    {
        await SeedExerciseAsync(Guid.NewGuid(), hostname: $"h-{Guid.NewGuid():N}.example.com", brandedDomain: null);

        var resolver = CreateResolver();

        (await resolver.ResolveExerciseIdAsync("bad host!/../etc", CancellationToken.None)).Should().BeNull();
        (await resolver.ResolveExerciseIdAsync("[::1]", CancellationToken.None)).Should().BeNull();
        (await resolver.ResolveExerciseIdAsync(null, CancellationToken.None)).Should().BeNull();
        (await resolver.ResolveExerciseIdAsync(string.Empty, CancellationToken.None)).Should().BeNull();
    }

    private HostExerciseResolver CreateResolver()
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started before these tests run");

        var services = new ServiceCollection();
        services.AddDbContext<PulseDbContext>(options => options.UseSqlServer(_fixture.ConnectionString));
        services.AddExerciseScoping();
        var provider = services.BuildServiceProvider();

        return new HostExerciseResolver(
            provider.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<HostExerciseResolver>.Instance);
    }

    private async Task SeedExerciseAsync(Guid id, string hostname, string? brandedDomain)
    {
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = id,
            Name = $"Exercise {id:N}",
            Hostname = hostname,
            BrandedDomain = brandedDomain,
            TimeZone = "America/New_York",
            Status = "active",
        });
        await seed.SaveChangesAsync();
    }
}
