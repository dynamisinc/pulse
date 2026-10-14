namespace Pulse.WebApi.Tests.Features.Identity.EasyLogin;

using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// easy-login/01 (Exercise facts AC, EL-17) — <see cref="ExerciseFactsReader.GetAsync"/> returns the five facts the
/// feature needs from the ONE new <c>// org-scope-exempt(ResolvedScope)</c> read of <c>Exercises</c>, and fails closed
/// (<c>null</c>) for an empty or unknown id. The pinned exemption count itself is
/// <c>OrganizationScopeSweepTests</c>'s job (bumped by exactly one); the source check here pins that the marker sits
/// on THIS read with the agreed wording.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ExerciseFactsReaderTests
{
    private readonly MsSqlContainerFixture _fixture;

    public ExerciseFactsReaderTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task GetAsync_ReturnsNameZoneStatusTenantAndStoredScenarioTime()
    {
        var scenario = new DateTimeOffset(2033, 6, 14, 9, 30, 0, TimeSpan.FromHours(-4));
        var exercise = new Exercise
        {
            Id = Guid.NewGuid(),
            OrganizationId = Organization.DefaultOrganizationId,
            Name = $"Looking Glass {Guid.NewGuid():N}",
            TimeZone = "America/New_York",
            Status = "live",
            CurrentScenarioTime = scenario,
        };

        await using (var seed = _fixture.CreateContext())
        {
            seed.Exercises.Add(exercise);
            await seed.SaveChangesAsync();
        }

        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id });
        var facts = await new ExerciseFactsReader(context).GetAsync(exercise.Id);

        facts.Should().Be(new ExerciseFacts(
            exercise.Name, "America/New_York", "live", Organization.DefaultOrganizationId, scenario));
    }

    [RequiresDockerFact]
    public async Task GetAsync_WithNoStoredScenarioTime_ReturnsNullForIt()
    {
        var exercise = new Exercise
        {
            Id = Guid.NewGuid(),
            OrganizationId = Organization.DefaultOrganizationId,
            Name = "No scenario clock",
        };

        await using (var seed = _fixture.CreateContext())
        {
            seed.Exercises.Add(exercise);
            await seed.SaveChangesAsync();
        }

        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id });
        var facts = await new ExerciseFactsReader(context).GetAsync(exercise.Id);

        facts.Should().NotBeNull();
        facts!.StoredScenarioTime.Should().BeNull();
        facts.TimeZone.Should().Be("UTC", "the column default");
        facts.Status.Should().Be("build", "the column default");
    }

    [RequiresDockerFact]
    public async Task GetAsync_UnknownOrEmptyId_ReturnsNull_FailClosed()
    {
        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = Guid.NewGuid() });
        var reader = new ExerciseFactsReader(context);

        (await reader.GetAsync(Guid.NewGuid())).Should().BeNull("an id with no exercise row yields no facts");
        (await reader.GetAsync(Guid.Empty)).Should().BeNull("an unresolved (empty) scope yields no facts, never a default");
    }

    [Fact]
    public void Constructor_RefusesANullContext()
    {
        ((Action)(() => _ = new ExerciseFactsReader(null!))).Should().Throw<ArgumentNullException>();
    }

    [Fact]
    public void TheReader_CarriesTheResolvedScopeExemptionMarker_OnItsOneExercisesRead()
    {
        var source = File.ReadAllLines(Path.Combine(
            FindRepositoryRoot(), "src", "Pulse.WebApi", "Features", "Identity", "EasyLogin", "ExerciseFactsReader.cs"));

        var readLines = source
            .Select((line, index) => (line, index))
            .Where(x => !x.line.TrimStart().StartsWith("//", StringComparison.Ordinal) && x.line.Contains("_dbContext.Exercises", StringComparison.Ordinal))
            .ToList();

        readLines.Should().ContainSingle("ExerciseFactsReader holds the feature's ONE Exercises read (EL-17)");
        source[readLines[0].index - 3].Should().Contain(
            "// org-scope-exempt(ResolvedScope): exerciseId is the server-resolved scope",
            "the marker uses the same wording as InjectQueueService.ReadExerciseFactsAsync and sits directly above the read");
    }

    private static string FindRepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "pulse.slnx")))
        {
            directory = directory.Parent;
        }

        return directory?.FullName ?? throw new InvalidOperationException("Could not locate pulse.slnx above the test binary.");
    }
}
