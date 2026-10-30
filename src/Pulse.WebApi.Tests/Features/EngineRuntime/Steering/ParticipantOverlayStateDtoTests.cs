namespace Pulse.WebApi.Tests.Features.EngineRuntime.Steering;

using System.Linq;
using System.Text.Json;
using FluentAssertions;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.ParticipantShell;
using Xunit;

/// <summary>
/// #390: <see cref="ParticipantOverlayStateDto.FromComposed"/> builds the lifecycle push frame ONLY from the composed
/// <see cref="OverlayStateResponse"/> the GET serves. Docker-free, and generic over the response's properties, so a
/// field later added to <see cref="OverlayStateResponse"/> but not carried by the push fails here.
/// </summary>
public sealed class ParticipantOverlayStateDtoTests
{
    [Fact]
    public void FromComposed_IsTheGetBodyPlusSequence_KeyForKey()
    {
        var composed = new OverlayStateResponse { State = "pause", Register = "out-of-fiction", Message = "held" };

        // The GET serializes through minimal-API JSON (web defaults); the push through the DTO's own attributes.
        var get = LifecycleOverlayPushTests.JsonFields(JsonSerializer.Serialize(composed, JsonSerializerOptions.Web));
        var pushed = LifecycleOverlayPushTests.JsonFields(
            JsonSerializer.Serialize(ParticipantOverlayStateDto.FromComposed(composed, sequence: 42)));

        pushed.Should().ContainKey("sequence").WhoseValue.Should().Be("42");
        pushed.Remove("sequence");
        pushed.Should().BeEquivalentTo(get, "the push frame minus its ticket IS the GET body — every key, every value");
    }

    [Fact]
    public void FromComposed_CarriesEveryOverlayStateResponseProperty()
    {
        var dtoProperties = typeof(ParticipantOverlayStateDto).GetProperties().Select(property => property.Name);

        typeof(OverlayStateResponse).GetProperties().Select(property => property.Name)
            .Should().BeSubsetOf(
                dtoProperties,
                "a field added to the composed GET projection must be added to the push frame too (#390 parity)");
    }
}
