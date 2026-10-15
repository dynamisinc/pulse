namespace Pulse.WebApi.Tests.Features.Identity.Roster;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Roster;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// easy-login/02 (Content security AC, NFR-004, XC-002) — markup in a name, agency, job label or persona-handle cell is
/// STRIPPED on ingest (a name that is only markup fails the row), every field is bounded, the email passes a simple
/// address check, and the email never reaches a telemetry payload. The upload's MIME and size checks are in
/// <see cref="RosterEndpointsHttpTests"/>.
/// </summary>
public sealed class RosterContentSecurityTests
{
    [Fact]
    public void Normalize_StripsMarkup_FromNameAgencyRoleAndHandle_NeverEncodes()
    {
        var row = RosterRowRules.Normalize(new RosterRowWrite
        {
            Name = "Eve <script>alert(1)</script>Adams",
            Agency = "<b>Fulco</b> & Sons",
            Role = "<img src=x onerror=alert(1)>Lead",
            PersonaHandle = "<i>@FulcoEM</i>",
        });

        row.Name.Should().Be("Eve Adams");
        row.Agency.Should().Be("Fulco & Sons", "strip, never encode: a literal ampersand survives as itself");
        row.JobRole.Should().Be("Lead");
        row.PersonaHandle.Should().Be("FulcoEM");
    }

    [Theory]
    [InlineData("name", "<b></b>", RosterRowRules.NameOnlyMarkupMessage)]
    [InlineData("name", null, RosterRowRules.NameTooLongMessage)]
    [InlineData("agency", null, RosterRowRules.AgencyTooLongMessage)]
    [InlineData("role", null, RosterRowRules.RoleTooLongMessage)]
    [InlineData("email", null, RosterRowRules.EmailInvalidMessage)]
    [InlineData("email", "a@b", RosterRowRules.EmailInvalidMessage)]
    [InlineData("email", "\"<script>\"@x.test", RosterRowRules.EmailInvalidMessage)]
    [InlineData("personaHandle", "<b></b>", "personaHandle is not a usable persona handle.")]
    [InlineData("personaHandle", null, "personaHandle must be at most 256 characters.")]
    public void Validate_RefusesMarkupOnlyNamesOversizeFieldsAndBadEmails(string field, string? value, string expected)
    {
        var oversize = field switch
        {
            "name" => new string('n', 257),
            "agency" => new string('a', 129),
            "role" => new string('r', 129),
            "email" => new string('e', 250) + "@x.test",
            _ => new string('h', 257),
        };
        value ??= oversize;

        var raw = new RosterRowWrite
        {
            Name = field == "name" ? value : "A B",
            Agency = field == "agency" ? value : null,
            Role = field == "role" ? value : null,
            Email = field == "email" ? value : null,
            PersonaHandle = field == "personaHandle" ? value : null,
        };

        RosterRowRules.Validate(RosterRowRules.Normalize(raw)).Should().Be(expected);
    }

    [Fact]
    public void Validate_AcceptsTheBoundaryLengths()
    {
        var row = RosterRowRules.Normalize(new RosterRowWrite
        {
            Name = new string('n', 256),
            Agency = new string('a', 128),
            Role = new string('r', 128),
            Email = new string('e', 247) + "@x.test",
        });

        RosterRowRules.Validate(row).Should().BeNull();
    }

    [Fact]
    public void TheRosterEntry_IsTheOnlyEasyLoginShapeThatCarriesAnEmail()
    {
        // XC-002: email is staff-only. The one easy-login DTO with an email property is the staff RosterEntryDto.
        var withEmail = typeof(RosterEntryDto).Assembly.GetTypes()
            .Where(t => t.Namespace == typeof(RosterEntryDto).Namespace && t.Name.EndsWith("Dto", StringComparison.Ordinal))
            .Where(t => t.GetProperties().Any(p => p.Name == "Email"))
            .ToList();

        withEmail.Should().Equal([typeof(RosterEntryDto)]);
    }
}

/// <summary>
/// easy-login/02 (Content security AC, NFR-004) — the database half of <see cref="RosterContentSecurityTests"/>: what a
/// real import stores carries no markup, a markup-only row fails, and no email or name reaches a telemetry payload.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class RosterContentSecurityStorageTests
{
    private const string Header = "name,agency,role,email,personaHandle,signInName\n";

    private readonly MsSqlContainerFixture _fixture;

    public RosterContentSecurityStorageTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task Import_StoresNoMarkup_FailsAMarkupOnlyRow_AndKeepsTheEmailOutOfTelemetry()
    {
        var world = await RosterSeed.ExerciseAsync(_fixture);

        await using (var harness = RosterHarness.For(_fixture, world))
        {
            var report = (await harness.Service.ImportAsync(
                Header
                + "\"Eve <script>alert(1)</script>Adams\",<b>Fulco</b>,\"<img src=x onerror=alert(1)>Lead\",eve@example.test,,\n"
                + "<script>alert(2)</script>,,,,,",
                dryRun: false)).Report!;

            report.Rows[0].Status.Should().Be(RosterRowStatuses.Created);
            report.Rows[0].Name.Should().Be("Eve Adams");
            report.Rows[1].Status.Should().Be(RosterRowStatuses.Failed, "a row that is only markup fails");
            report.Rows[1].Message.Should().Be(RosterRowRules.NameOnlyMarkupMessage);
        }

        await using var read = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = world.ExerciseId });
        var account = await read.Accounts.SingleAsync();
        new[] { account.DisplayName, account.Agency, account.JobRole }.Should().OnlyContain(v => !v!.Contains('<'), "no stored markup");
        (await read.Personas.SingleAsync()).DisplayName.Should().Be("Eve Adams", "the auto persona's participant-visible name is the sanitized one");

        var payloads = await read.TelemetryEvents.Select(e => e.Payload).ToListAsync();
        payloads.Should().NotBeEmpty().And.OnlyContain(p => !p!.Contains("eve@example.test") && !p.Contains("Eve"), "no email or name in telemetry");
    }
}
