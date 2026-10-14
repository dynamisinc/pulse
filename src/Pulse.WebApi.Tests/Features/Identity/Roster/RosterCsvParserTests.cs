namespace Pulse.WebApi.Tests.Features.Identity.Roster;

using System.Linq;
using System.Text;
using FluentAssertions;
using Pulse.WebApi.Features.Identity.Roster;
using Xunit;

/// <summary>
/// easy-login/02 (AC-1, the frozen "Roster CSV" section) — <see cref="RosterCsvParser"/>: the header aliases, a BOM,
/// quoting, blank lines (a line of nothing but commas included), unknown columns, short rows, and the caps and header
/// failures the endpoint answers 400 for. Pure, so plain facts.
/// </summary>
public sealed class RosterCsvParserTests
{
    [Fact]
    public void Parse_TheTemplateHeader_ReadsEveryColumn()
    {
        var parsed = RosterCsvParser.Parse(
            "name,agency,role,email,personaHandle,signInName\nRiley Chen,Fulco Fire,Captain,riley@example.test,@FulcoEM,rchen");

        parsed.IsValid.Should().BeTrue();
        var row = parsed.Rows.Should().ContainSingle().Subject;
        row.RowNumber.Should().Be(1, "rows are numbered 1-based and the header is not counted");
        row.Fields.Name.Should().Be("Riley Chen");
        row.Fields.Agency.Should().Be("Fulco Fire");
        row.Fields.Role.Should().Be("Captain");
        row.Fields.Email.Should().Be("riley@example.test");
        row.Fields.PersonaHandle.Should().Be("@FulcoEM");
        row.Fields.SignInName.Should().Be("rchen");
    }

    [Fact]
    public void Parse_AcceptsTheLegacyAliasesAndTheBom_CaseInsensitively()
    {
        var parsed = RosterCsvParser.Parse("﻿DisplayName,USERNAME,Persona,Agency\nJane Smith,jsmith7,FulcoEM,Fulco EM");

        parsed.IsValid.Should().BeTrue("displayName, username and persona are the accepted aliases, and a BOM is tolerated");
        var fields = parsed.Rows.Should().ContainSingle().Subject.Fields;
        fields.Name.Should().Be("Jane Smith");
        fields.SignInName.Should().Be("jsmith7");
        fields.PersonaHandle.Should().Be("FulcoEM");
        fields.Agency.Should().Be("Fulco EM");
    }

    [Fact]
    public void Parse_HonoursQuotesAndEscapedQuotes()
    {
        var parsed = RosterCsvParser.Parse("displayName,username,Agency\n\"Smith, Jane\",jsmith7,\"Fulco \"\"EM\"\"\"");

        var fields = parsed.Rows.Should().ContainSingle().Subject.Fields;
        fields.Name.Should().Be("Smith, Jane", "a quoted comma is part of the cell");
        fields.Agency.Should().Be("Fulco \"EM\"", "a doubled quote is a literal quote");
    }

    [Fact]
    public void Parse_SkipsBlankLines_IncludingCommaOnlyLines_AndDoesNotCountThem()
    {
        var parsed = RosterCsvParser.Parse("\r\nname,agency\r\n\r\nA One,X\r\n,,\r\n   \r\nB Two,Y\r\n");

        parsed.IsValid.Should().BeTrue();
        parsed.Rows.Select(r => (r.RowNumber, r.Fields.Name)).Should().Equal(
            [(1, "A One"), (2, "B Two")],
            "blank and comma-only lines (spreadsheet leftovers) are skipped and never numbered");
    }

    [Fact]
    public void Parse_IgnoresUnknownColumns_AndReadsShortRowsAsMissingCells()
    {
        var parsed = RosterCsvParser.Parse("badge,name,shoeSize,email\n42,A One\n");

        var fields = parsed.Rows.Should().ContainSingle().Subject.Fields;
        fields.Name.Should().Be("A One");
        fields.Email.Should().BeNull("a short row has no email cell");
        fields.Agency.Should().BeNull("the file has no agency column");
    }

    [Fact]
    public void Parse_WhenAColumnAppearsTwice_TheFirstWins()
    {
        var parsed = RosterCsvParser.Parse("name,displayName\nFirst,Second");

        parsed.Rows.Should().ContainSingle().Which.Fields.Name.Should().Be("First");
    }

    [Fact]
    public void Parse_HeaderOnly_IsAValidEmptyImport()
    {
        var parsed = RosterCsvParser.Parse("name,agency\n");

        parsed.IsValid.Should().BeTrue();
        parsed.Rows.Should().BeEmpty();
    }

    [Theory]
    [InlineData("")]
    [InlineData("\n\n  \n")]
    [InlineData(",,,\n")]
    public void Parse_NoHeaderRow_IsMalformed(string content)
    {
        var parsed = RosterCsvParser.Parse(content);

        parsed.IsValid.Should().BeFalse();
        parsed.Error.Should().Be(RosterCsvParser.NoHeaderError);
    }

    [Fact]
    public void Parse_HeaderWithoutAName_IsMalformedWithAReadableReason()
    {
        var parsed = RosterCsvParser.Parse("agency,email\nFulco,a@b.test");

        parsed.IsValid.Should().BeFalse();
        parsed.Error.Should().Contain("\"name\" column");
        parsed.Rows.Should().BeEmpty("a refused file yields nothing to write");
    }

    [Fact]
    public void Parse_ExactlyTheCap_IsAccepted_AndOneMore_IsRefused()
    {
        var atCap = BuildFile(RosterCsvParser.MaxRows);
        var overCap = BuildFile(RosterCsvParser.MaxRows + 1);

        RosterCsvParser.Parse(atCap).Rows.Should().HaveCount(RosterCsvParser.MaxRows);

        var refused = RosterCsvParser.Parse(overCap);
        refused.IsValid.Should().BeFalse("more than 5000 data rows is a 400 with nothing written");
        refused.Error.Should().Contain("5000");
    }

    private static string BuildFile(int rows)
    {
        var builder = new StringBuilder("name\n");
        for (var i = 0; i < rows; i++)
        {
            builder.Append("Person ").Append(i).Append('\n');
        }

        return builder.ToString();
    }
}
