namespace Pulse.WebApi.Tests.Features.Identity.Enrollments;

using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;
using FluentAssertions;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Pulse.WebApi.Features.Identity.Enrollments;
using Xunit;

/// <summary>
/// Pins the STAFF-CHANGE event-type vocabulary (<see cref="StaffChangeEventTypes"/>, #618) the way
/// <c>EngineEventTaxonomyTests</c> pins the engine-loop one: the exact set, the dotted kebab-segment pattern, and that the
/// two families never share a name. Model-only, so <c>[Fact]</c>.
/// </summary>
public class StaffChangeEventTypesTests
{
    /// <summary>Hand-written on purpose: a pin that read its expectation off the constants would pass for anything.</summary>
    private static readonly string[] RatifiedStaffChangeEventTypes =
    [
        "enrollment.granted",
        "enrollment.role.changed",
        "enrollment.revoked",
        "enrollment.lead.changed",
        "enrollment.lead.released",
        "engine.swamped-mode.turned-on",
        "engine.swamped-mode.turned-off",
        "engine.kill-switch.engaged",
        "engine.autonomy.restored",
    ];

    [Fact]
    public void Vocabulary_IsExactlyTheRatifiedStaffChangeTypes() =>
        Constants(typeof(StaffChangeEventTypes)).Should().BeEquivalentTo(
            RatifiedStaffChangeEventTypes, "a new staff-change event type is a deliberate, reviewed addition");

    [Fact]
    public void EveryName_IsDottedSegmentsOfKebabWords()
    {
        // At least two dotted segments; each segment lowercase words joined by single hyphens — no underscores.
        var pattern = new Regex(@"^[a-z]+(?:-[a-z]+)*(?:\.[a-z]+(?:-[a-z]+)*)+$", RegexOptions.CultureInvariant);

        Constants(typeof(StaffChangeEventTypes)).Should().OnlyContain(
            name => pattern.IsMatch(name), "staff-change names are dotted kebab segments (engine.swamped-mode.turned-off)");
    }

    [Fact]
    public void NoName_IsSharedWithTheEngineLoopTaxonomy() =>
        Constants(typeof(StaffChangeEventTypes)).Should().NotIntersectWith(
            Constants(typeof(EngineEventTypes)), "the two families are filtered separately; one name in both would double-count");

    [Fact]
    public void EnrollmentServiceConstants_AreTheVocabularysOwn()
    {
        EnrollmentService.SwampedModeOffEventType.Should().Be(StaffChangeEventTypes.SwampedModeTurnedOff);
        EnrollmentService.LeadReleasedEventType.Should().Be(StaffChangeEventTypes.LeadReleased);
        EnrollmentService.GrantedEventType.Should().Be(StaffChangeEventTypes.EnrollmentGranted);
    }

    private static string[] Constants(System.Type type) => type
        .GetFields(BindingFlags.Public | BindingFlags.Static)
        .Where(f => f.IsLiteral && f.FieldType == typeof(string))
        .Select(f => (string)f.GetRawConstantValue()!)
        .ToArray();
}
