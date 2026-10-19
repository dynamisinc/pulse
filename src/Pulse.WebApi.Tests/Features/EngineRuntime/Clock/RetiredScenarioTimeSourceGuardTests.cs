namespace Pulse.WebApi.Tests.Features.EngineRuntime.Clock;

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using FluentAssertions;
using Xunit;

/// <summary>
/// engine-runtime/08 (CLK-2) — the static guard that keeps the retired <c>Exercise.CurrentScenarioTime</c> placeholder
/// retired. No production source under <c>src/Pulse.WebApi</c> may reference the PROPERTY (the
/// <c>IExerciseClock.CurrentScenarioTime(exerciseId)</c> METHOD is fine) or the dropped
/// <c>ExerciseFacts.StoredScenarioTime</c>, outside the entity itself and the EF-generated migrations (the context names
/// the column only in comments, which the sweep strips, so it needs no allowance). Every reader uses <c>IScenarioNow</c>. Comment lines are not code and are not swept.
/// Model-only: no host, no SQL, runs on every machine.
/// </summary>
public sealed partial class RetiredScenarioTimeSourceGuardTests
{
    /// <summary>The files allowed to name the column: the entity that declares it.</summary>
    private static readonly HashSet<string> AllowedFiles = new(StringComparer.OrdinalIgnoreCase)
    {
        Path.Combine("src", "Pulse.WebApi", "Data", "Entities", "Exercise.cs"),
    };

    [Fact]
    public void NoProductionCode_ReadsTheRetiredScenarioTimePlaceholder()
    {
        var files = ProductionSourceFiles();

        // Anti-vacuity: the sweep must see the tree, and must see the clock METHOD it deliberately lets through.
        files.Should().HaveCountGreaterThan(50, "a near-empty sweep would pass on any tree");
        files.Should().Contain(
            file => file.Code.Any(line => line.Contains(".CurrentScenarioTime(", StringComparison.Ordinal)),
            "the IExerciseClock.CurrentScenarioTime(...) method calls must be visible to the sweep (and allowed)");

        var offenders = files
            .Where(file => !AllowedFiles.Contains(file.RelativePath))
            .SelectMany(file => file.Code
                .Select((line, index) => (line, index))
                .Where(entry => IsOffending(entry.line))
                .Select(entry => $"{file.RelativePath}:{entry.index + 1}: {entry.line.Trim()}"))
            .ToList();

        offenders.Should().BeEmpty(
            "Exercise.CurrentScenarioTime is RETIRED (engine-runtime/08, CLK-2) and ExerciseFacts.StoredScenarioTime is "
            + "gone: read the exercise's scenario now through IScenarioNow (clock, else latest post, else now). "
            + "Offending line(s): " + string.Join(" | ", offenders));
    }

    [Theory]
    [InlineData("        ScenarioTime = exercise.CurrentScenarioTime ?? now,", true)]
    [InlineData("            .Select(e => new { e.Status, e.CurrentScenarioTime })", true)]
    [InlineData("        exercise.CurrentScenarioTime = scenarioNow;", true)]
    [InlineData("        var t = facts?.StoredScenarioTime;", true)]
    [InlineData("        var t = _clock.CurrentScenarioTime(exerciseId) ?? now;", false)]
    [InlineData("    DateTimeOffset? CurrentScenarioTime(Guid exerciseId);", false)]
    [InlineData("        var t = state.CurrentScenarioTime (_timeProvider);", false)]
    public void TheGuard_CatchesThePropertyAndTheDroppedField_ButNotTheClockMethod(string line, bool offending)
    {
        IsOffending(line).Should().Be(offending, "'{0}' is {1}", line, offending ? "a read of the retired source" : "the clock method");
    }

    [Fact]
    public void TheCommentStripper_DropsOnlyWholeLineComments()
    {
        WholeLineComment().IsMatch("    /// <see cref=\"Exercise.CurrentScenarioTime\"/> is retired.").Should().BeTrue();
        WholeLineComment().IsMatch("        // the stored CurrentScenarioTime is gone").Should().BeTrue();
        WholeLineComment().IsMatch("        var x = exercise.CurrentScenarioTime; // trailing").Should().BeFalse(
            "a trailing comment never hides the code in front of it");
    }

    private static bool IsOffending(string line) =>
        RetiredProperty().IsMatch(line) || DroppedField().IsMatch(line);

    /// <summary>Every hand-written production <c>.cs</c> file (no bin/obj/Migrations), whole-line comments dropped.</summary>
    private static List<(string RelativePath, string[] Code)> ProductionSourceFiles()
    {
        var root = FindRepositoryRoot();
        var tree = Path.Combine(root, "src", "Pulse.WebApi");

        return Directory.EnumerateFiles(tree, "*.cs", SearchOption.AllDirectories)
            .Select(path => (RelativePath: Path.GetRelativePath(root, path), Path: path))
            .Where(file => !file.RelativePath.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                .Any(segment => segment is "obj" or "bin" or "Migrations"))
            .Select(file => (file.RelativePath, File.ReadAllLines(file.Path).Where(line => !WholeLineComment().IsMatch(line)).ToArray()))
            .ToList();
    }

    /// <summary>Walks up from the test binary to the directory holding <c>pulse.slnx</c>; throws rather than sweep nothing.</summary>
    private static string FindRepositoryRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "pulse.slnx")))
            {
                return directory.FullName;
            }
        }

        throw new InvalidOperationException($"Could not locate pulse.slnx above '{AppContext.BaseDirectory}'.");
    }

    /// <summary>A line that is nothing but a <c>//</c> or <c>///</c> comment.</summary>
    [GeneratedRegex(@"^\s*//", RegexOptions.CultureInvariant)]
    private static partial Regex WholeLineComment();

    /// <summary><c>CurrentScenarioTime</c> as an identifier NOT followed by an argument list (the property, not the clock method).</summary>
    [GeneratedRegex(@"\bCurrentScenarioTime\b(?!\s*\()", RegexOptions.CultureInvariant)]
    private static partial Regex RetiredProperty();

    /// <summary>The dropped <c>ExerciseFacts.StoredScenarioTime</c>.</summary>
    [GeneratedRegex(@"\bStoredScenarioTime\b", RegexOptions.CultureInvariant)]
    private static partial Regex DroppedField();
}
