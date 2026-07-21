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
    public async Task UnknownHost_ResolvesToNull_FailClosed()
    {
        // Seed one exercise so the table is non-empty; then query a host that matches nothing.
        await SeedExerciseAsync(Guid.NewGuid(), hostname: $"h-{Guid.NewGuid():N}.example.com", brandedDomain: null);

        var resolved = await CreateResolver()
            .ResolveExerciseIdAsync($"nomatch-{Guid.NewGuid():N}.example.com", CancellationToken.None);

        resolved.Should().BeNull("an un-provisioned host resolves to no scope — never a default/first exercise");
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
