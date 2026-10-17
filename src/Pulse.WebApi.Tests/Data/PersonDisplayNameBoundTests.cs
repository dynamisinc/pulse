namespace Pulse.WebApi.Tests.Data;

using FluentAssertions;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// L-5: <see cref="Person.BoundDisplayName"/> bounds a display name from a longer source to the
/// <c>People.DisplayName</c> column (nvarchar(200)) instead of letting the save fail.
/// </summary>
public sealed class PersonDisplayNameBoundTests
{
    [Fact]
    public void BoundDisplayName_AtOrUnderTheLimit_IsUnchanged()
    {
        Person.BoundDisplayName("Jane Controller").Should().Be("Jane Controller");
        var exact = new string('x', Person.MaxDisplayNameLength);
        Person.BoundDisplayName(exact).Should().BeSameAs(exact, "a name that fits is never copied or altered");
    }

    [Fact]
    public void BoundDisplayName_OverTheLimit_IsTruncatedToTheColumnLength()
    {
        Person.BoundDisplayName(new string('y', 500))
            .Should().Be(new string('y', Person.MaxDisplayNameLength), "an over-long name is truncated, never a 500");
    }

    [Fact]
    public void BoundDisplayName_NeverSplitsASurrogatePair()
    {
        // 199 ASCII chars then an emoji (a surrogate pair at indexes 199-200): cutting at 200 would strand the high half.
        var name = new string('z', Person.MaxDisplayNameLength - 1) + "\U0001F600" + "tail";

        var bounded = Person.BoundDisplayName(name);

        bounded.Should().Be(new string('z', Person.MaxDisplayNameLength - 1), "the pair is dropped whole");
        bounded.Length.Should().BeLessThanOrEqualTo(Person.MaxDisplayNameLength);
    }
}
