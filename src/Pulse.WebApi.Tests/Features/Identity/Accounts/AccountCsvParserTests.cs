namespace Pulse.WebApi.Tests.Features.Identity.Accounts;

using System.Linq;
using System.Text;
using FluentAssertions;
using Pulse.WebApi.Features.Identity.Accounts;

/// <summary>
/// Unit tests for <see cref="AccountCsvParser"/> (story 02) — pure, no container, plain <c>[Fact]</c>. Proves
/// header mapping (case-insensitive, order-independent), quoted-field handling, blank-line skipping, and the
/// fail-closed malformed cases (empty, missing required header, over the row cap) the endpoint maps to 400.
/// </summary>
public sealed class AccountCsvParserTests
{
    [Fact]
    public void Parse_ValidCsv_MapsColumnsByHeaderName()
    {
        const string csv = "username,displayName,role,password\nalice,Alice A,participant,pw-alice\nbob,Bob B,pio,pw-bob";

        var result = AccountCsvParser.Parse(csv);

        result.IsValid.Should().BeTrue();
        result.Rows.Should().HaveCount(2);
        result.Rows[0].RowNumber.Should().Be(1);
        result.Rows[0].Username.Should().Be("alice");
        result.Rows[0].DisplayName.Should().Be("Alice A");
        result.Rows[0].Role.Should().Be("participant");
        result.Rows[0].Password.Should().Be("pw-alice");
        result.Rows[1].RowNumber.Should().Be(2);
        result.Rows[1].Username.Should().Be("bob");
    }

    [Fact]
    public void Parse_HeaderOrderAndCase_AreIrrelevant()
    {
        const string csv = "Role,PASSWORD,DisplayName,Username\npio,pw,Bob B,bob";

        var result = AccountCsvParser.Parse(csv);

        result.IsValid.Should().BeTrue();
        result.Rows.Should().ContainSingle();
        var row = result.Rows[0];
        row.Username.Should().Be("bob", "columns are mapped by (case-insensitive) header name, not position");
        row.Role.Should().Be("pio");
        row.DisplayName.Should().Be("Bob B");
        row.Password.Should().Be("pw");
    }

    [Fact]
    public void Parse_QuotedField_PreservesEmbeddedCommaAndEscapedQuote()
    {
        const string csv = "username,displayName,role\ndoe,\"Doe, \"\"JD\"\" John\",participant";

        var result = AccountCsvParser.Parse(csv);

        result.IsValid.Should().BeTrue();
        result.Rows[0].DisplayName.Should().Be("Doe, \"JD\" John",
            "a quoted field preserves its embedded comma and un-escapes \"\" to a single quote");
        result.Rows[0].Role.Should().Be("participant");
    }

    [Fact]
    public void Parse_SkipsBlankLines_AndDoesNotCountThemAsRows()
    {
        const string csv = "username,displayName,role\n\nalice,Alice,participant\n\n   \nbob,Bob,pio\n";

        var result = AccountCsvParser.Parse(csv);

        result.IsValid.Should().BeTrue();
        result.Rows.Should().HaveCount(2, "blank/whitespace-only lines are skipped and not numbered");
        result.Rows.Select(r => r.RowNumber).Should().Equal(1, 2);
    }

    [Fact]
    public void Parse_OptionalPasswordColumnAbsent_YieldsNullPassword()
    {
        const string csv = "username,displayName,role\nalice,Alice,participant";

        var result = AccountCsvParser.Parse(csv);

        result.IsValid.Should().BeTrue();
        result.Rows[0].Password.Should().BeNull("password is an optional column");
    }

    [Fact]
    public void Parse_EmptyContent_IsMalformed()
    {
        AccountCsvParser.Parse("   ").IsValid.Should().BeFalse("an empty CSV has no header and is malformed (→ 400)");
    }

    [Fact]
    public void Parse_MissingRequiredHeader_IsMalformed()
    {
        // No 'role' column.
        var result = AccountCsvParser.Parse("username,displayName\nalice,Alice");

        result.IsValid.Should().BeFalse();
        result.Error.Should().Contain("role", "a missing required header column is a malformed CSV");
    }

    [Fact]
    public void Parse_ExceedsRowCap_IsMalformed()
    {
        var builder = new StringBuilder("username,displayName,role\n");
        for (var i = 0; i <= AccountCsvParser.MaxRows; i++)
        {
            builder.Append("user").Append(i).Append(",Name,participant\n");
        }

        var result = AccountCsvParser.Parse(builder.ToString());

        result.IsValid.Should().BeFalse("a CSV over the row cap is rejected as malformed (a size guard)");
        result.Error.Should().Contain(AccountCsvParser.MaxRows.ToString());
    }

    [Fact]
    public void Parse_HeaderOnly_IsValidWithNoRows()
    {
        var result = AccountCsvParser.Parse("username,displayName,role\n");

        result.IsValid.Should().BeTrue("a header with no data rows is valid but empty");
        result.Rows.Should().BeEmpty();
    }
}
