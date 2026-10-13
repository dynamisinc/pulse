namespace Pulse.WebApi.Tests.Features.Identity.Roster;

using System;
using System.Collections.Generic;
using System.Linq;
using FluentAssertions;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Roster;
using Xunit;

/// <summary>
/// easy-login/02 (AC-2, AC-3, AC-4, AC-5 and the amended derivation and matching rules) — the ONE row-judging engine,
/// <see cref="RosterWorkspace"/>, driven in memory. It starts from the staff roster mock's seed and ports its rule
/// tests (<c>participantAdmin/mocks/rosterMocks.test.ts</c>, the 34c6c80 rules), then pins the later amendments in
/// <c>implementation.md</c> that the server follows and the mock does not yet (the persona-less rule and the same-file
/// guards; story 10's mock is updated separately). The database-backed behaviour (one save, dry run, telemetry,
/// isolation) is <see cref="RosterServiceTests"/>.
/// </summary>
public sealed class RosterWorkspaceTests
{
    private static readonly Guid FulcoEmId = Guid.NewGuid();
    private static readonly Guid FulcoPioId = Guid.NewGuid();

    private static readonly string[] NonRosterSignInNames = ["admin", "legacybot", "plee"];

    // ------------------------------------------------------------------ the mock's seed

    private static List<RosterPersonaRef> SeedPersonas() =>
    [
        new(FulcoEmId, "FulcoEM", "Fulco County Emergency Management", "org"),
        new(FulcoPioId, "FulcoPIO", "City of Fulco Public Information", "org"),
        new(Guid.NewGuid(), "RegionalHealth", "Regional Health Authority", "org"),
        new(Guid.NewGuid(), "marcus_oyelaran", "Marcus Oyelaran", "human"),
        new(Guid.NewGuid(), "priya_raman", "Priya Raman", "human"),
        new(Guid.NewGuid(), "tom_becker", "Tom Becker", "human"),
        new(Guid.NewGuid(), "jpike_utilities", "Jordan Pike", "human"),
    ];

    private static List<RosterParticipant> SeedParticipants(IReadOnlyList<RosterPersonaRef> personas)
    {
        RosterPersonaRef P(string handle) => personas.Single(p => p.Handle == handle);

        return
        [
            Participant("Dana Whitfield", "dwhitfield", "Fulco County EM", "EOC Liaison", "dana.whitfield@example.test", "pio", P("FulcoEM")),
            Participant("Marcus Oyelaran", "moyelaran", "Fulco County Health", "Public Health Officer", null, "participant", P("marcus_oyelaran"), auto: true),
            Participant("Priya Raman", "praman", "Red Cross", "Shelter Coordinator", null, "participant", P("priya_raman"), auto: true),
            Participant("Tom Becker", "tbecker", "County Transportation", "Dispatch Supervisor", null, "participant", P("tom_becker"), auto: true),
            Participant("Elena Vasquez", "evasquez", "City of Fulco", "Public Information Officer", null, "pio", P("FulcoPIO")),
            Participant("Jordan Pike", "jpike", "Fulco Utilities", "Operations Lead", null, "participant", P("jpike_utilities")),
            Participant("Aiko Tanaka", "atanaka", null, null, null, "participant", null),
        ];
    }

    private static RosterParticipant Participant(
        string name, string signInName, string? agency, string? jobRole, string? email, string role, RosterPersonaRef? persona, bool auto = false) => new()
    {
        Id = Guid.NewGuid(),
        Name = name,
        SignInName = signInName,
        Agency = agency,
        JobRole = jobRole,
        Email = email,
        ExerciseRole = role,
        Persona = persona,
        PersonaAutoCreated = auto,
    };

    /// <summary>A roster held across "requests": each <see cref="Import"/> runs a fresh workspace and then "persists" it.</summary>
    private sealed class Roster
    {
        public Roster()
        {
            Personas = SeedPersonas();
            Participants = SeedParticipants(Personas);
        }

        public List<RosterPersonaRef> Personas { get; }

        public List<RosterParticipant> Participants { get; }

        public RosterWorkspace Open() => new(Participants, NonRosterSignInNames, Personas);

        /// <summary>Applies the rows as one file. Persists (like a real run) unless <paramref name="dryRun"/>.</summary>
        public List<RosterRowOutcome> Import(bool dryRun, params RosterRowWrite[] rows)
        {
            // A dry run must judge against copies, exactly as the service reads untracked rows for one.
            var workspace = dryRun
                ? new RosterWorkspace(Participants.Select(Copy), NonRosterSignInNames, Personas)
                : Open();
            var outcomes = workspace.ApplyFile(Numbered(rows)).ToList();
            if (!dryRun)
            {
                Persist(workspace);
            }

            return outcomes;
        }

        /// <summary>Adds one participant (the <c>POST /api/staff/roster</c> path). Persists when it created someone.</summary>
        public RosterRowOutcome Add(RosterRowWrite row)
        {
            // Like the service, a single add never commits an update: judge against copies, keep only a creation.
            var workspace = new RosterWorkspace(Participants.Select(Copy), NonRosterSignInNames, Personas);
            var outcome = workspace.Apply(RosterRowRules.Normalize(row));
            if (outcome.Status == RosterRowStatuses.Created)
            {
                Persist(workspace);
            }

            return outcome;
        }

        public RosterParticipant BySignIn(string signInName) => Participants.Single(p => p.SignInName == signInName);

        private void Persist(RosterWorkspace workspace)
        {
            // Updates mutated the working objects (this list's own), so only the creations and new personas need adding.
            Participants.AddRange(workspace.Created);
            foreach (var participant in workspace.Created.Concat(workspace.Updated))
            {
                if (participant.PersonaCreated && participant.Persona is { } persona)
                {
                    Personas.Add(persona);
                    participant.PersonaCreated = false; // persisted: the next request reads it as an existing persona
                }
            }
        }

        private static RosterParticipant Copy(RosterParticipant p) => new()
        {
            Id = p.Id,
            Name = p.Name,
            SignInName = p.SignInName,
            Agency = p.Agency,
            JobRole = p.JobRole,
            Email = p.Email,
            ExerciseRole = p.ExerciseRole,
            Persona = p.Persona,
            PersonaAutoCreated = p.PersonaAutoCreated,
        };
    }

    private static List<(int RowNumber, RosterRowInput Row)> Numbered(params RosterRowWrite[] rows) =>
        rows.Select((row, i) => (i + 1, RosterRowRules.Normalize(row))).ToList();

    private static RosterRowWrite Row(
        string? name, string? agency = null, string? role = null, string? email = null, string? personaHandle = null, string? signInName = null) =>
        new() { Name = name, Agency = agency, Role = role, Email = email, PersonaHandle = personaHandle, SignInName = signInName };

    private static readonly RosterRowWrite[] File =
    [
        Row("Riley Chen", "Fulco Fire", "Captain", "riley@example.test"),
        Row("Sam Ortiz", "Fulco EM", "Liaison", personaHandle: "@FulcoEM"),
        Row("Taylor Reed"),
        Row("Bad Persona", "Fulco EM", personaHandle: "NoSuchOrg"),
    ];

    // ------------------------------------------------------------------ add one (AC-5 rules, in memory)

    [Fact]
    public void Add_CreatesAParticipantWithADerivedSignInNameAndAnAutoCitizenPersona()
    {
        var roster = new Roster();

        var outcome = roster.Add(Row("Riley Chen", "Fulco Fire"));

        outcome.Status.Should().Be(RosterRowStatuses.Created);
        outcome.PersonaCreated.Should().BeTrue("no personaHandle means an auto citizen persona (EL-4)");
        var p = outcome.Participant!;
        p.SignInName.Should().Be("rchen");
        p.ExerciseRole.Should().Be("participant");
        p.PersonaAutoCreated.Should().BeTrue();
        p.Persona.Should().NotBeNull();
        p.Persona!.Handle.Should().Be("riley_chen");
        p.Persona.Kind.Should().Be("human");
        p.Agency.Should().Be("Fulco Fire");
    }

    [Fact]
    public void Add_BindsAnOrgPersona_CaseInsensitive_AtTolerated_AndMakesTheAccountPio()
    {
        var outcome = new Roster().Add(Row("Sam Ortiz", personaHandle: "@fulcoem"));

        outcome.Status.Should().Be(RosterRowStatuses.Created);
        outcome.PersonaCreated.Should().BeFalse("binding an org persona creates none");
        outcome.Participant!.ExerciseRole.Should().Be("pio", "bound to an org persona means pio (EL-1)");
        outcome.Participant.Persona!.Id.Should().Be(FulcoEmId);
        outcome.Participant.PersonaAutoCreated.Should().BeFalse();
    }

    [Theory]
    [InlineData("   ", RosterRowRules.NameRequiredMessage)]
    [InlineData("<script>alert(1)</script>", RosterRowRules.NameOnlyMarkupMessage)]
    public void Add_ABlankOrMarkupOnlyName_IsInvalid(string name, string expected)
    {
        var outcome = new Roster().Add(Row(name));

        outcome.Failure.Should().Be(RosterRowFailure.Invalid);
        outcome.Message.Should().Be(expected);
    }

    [Fact]
    public void Add_InvalidEmailOrSignInName_IsInvalid_WithAReadableReason()
    {
        var roster = new Roster();

        roster.Add(Row("A B", email: "nope")).Message.Should().Be(RosterRowRules.EmailInvalidMessage);
        roster.Add(Row("A B", email: "a<b>@x.test")).Message.Should().Be(RosterRowRules.EmailInvalidMessage);
        var shortName = roster.Add(Row("A B", signInName: "x"));
        shortName.Failure.Should().Be(RosterRowFailure.Invalid);
        shortName.Message.Should().Contain("3 to 32");
    }

    [Fact]
    public void Add_AnUnknownHandle_ANonOrgPersona_AndAnotherExercisesHandle_FailWithTheSameMessage()
    {
        var roster = new Roster();

        // "OtherExerciseOrg" stands for exercise B's org: the central filter keeps it out of A's workspace entirely.
        var unknown = roster.Add(Row("A B", personaHandle: "NoSuchOrg"));
        var seededCitizen = roster.Add(Row("C D", personaHandle: "jpike_utilities"));
        var otherExercise = roster.Add(Row("E F", personaHandle: "OtherExerciseOrg"));

        foreach (var outcome in new[] { unknown, seededCitizen, otherExercise })
        {
            outcome.Failure.Should().Be(RosterRowFailure.Invalid);
            outcome.Message.Should().Be(RosterWorkspace.UnknownPersonaMessage, "the three cases must be indistinguishable (no oracle)");
        }
    }

    [Fact]
    public void Add_AKeyAlreadyOnTheRoster_IsNotCreated_BySignInNameEmailOrNameAndAgency()
    {
        var roster = new Roster();

        roster.Add(Row("Someone Else", signInName: "DWhitfield")).Status.Should().NotBe(RosterRowStatuses.Created);
        roster.Add(Row("Someone Else", email: "DANA.whitfield@example.test")).Status.Should().NotBe(RosterRowStatuses.Created);
        roster.Add(Row(" dana  whitfield", "fulco county em")).Status.Should().NotBe(
            RosterRowStatuses.Created, "the key is case-insensitive and whitespace-normalised");
    }

    // ------------------------------------------------------------------ import (AC-2, AC-4)

    [Fact]
    public void Import_ADryRun_ReportsPerRow_AndChangesNothing()
    {
        var roster = new Roster();
        var before = roster.Participants.Count;

        var outcomes = roster.Import(dryRun: true, File);

        outcomes.Select(o => o.Status).Should().Equal(
            RosterRowStatuses.Created, RosterRowStatuses.Created, RosterRowStatuses.Created, RosterRowStatuses.Failed);
        roster.Participants.Should().HaveCount(before, "a dry run writes nothing");
    }

    [Fact]
    public void Import_CreatesTheValidRows_FailsTheBadOne_WithTheFrozenNames()
    {
        var roster = new Roster();

        var outcomes = roster.Import(dryRun: false, File);

        outcomes[0].Participant!.SignInName.Should().Be("rchen");
        outcomes[0].Participant!.Persona!.Handle.Should().Be("riley_chen");
        outcomes[0].PersonaCreated.Should().BeTrue();
        outcomes[1].Participant!.SignInName.Should().Be("sortiz");
        outcomes[1].Participant!.Persona!.Handle.Should().Be("FulcoEM");
        outcomes[1].Participant!.ExerciseRole.Should().Be("pio");
        outcomes[1].PersonaCreated.Should().BeFalse();
        outcomes[2].Participant!.SignInName.Should().Be("treed");
        outcomes[3].Failure.Should().Be(RosterRowFailure.Invalid);
        outcomes[3].Message.Should().Be(RosterWorkspace.UnknownPersonaMessage);
    }

    [Fact]
    public void Import_TheSameFileAgain_IsIdempotent_EveryValidRowUnchanged()
    {
        var roster = new Roster();
        roster.Import(dryRun: false, File);
        var count = roster.Participants.Count;

        var again = roster.Import(dryRun: false, File);

        again.Select(o => o.Status).Should().Equal(
            RosterRowStatuses.Unchanged, RosterRowStatuses.Unchanged, RosterRowStatuses.Unchanged, RosterRowStatuses.Failed);
        roster.Participants.Should().HaveCount(count, "a re-upload never duplicates anyone");
    }

    [Fact]
    public void Import_AChangedAgency_IsUpdatedAndSaysSo_AndABlankCellNeverClears()
    {
        var roster = new Roster();
        roster.Import(dryRun: false, File);

        var outcomes = roster.Import(
            dryRun: false,
            Row("Riley Chen", "Fulco Fire Dept", email: "riley@example.test"),
            Row("Sam Ortiz", signInName: "sortiz"));

        outcomes[0].Status.Should().Be(RosterRowStatuses.Updated);
        outcomes[0].Message.Should().Contain("agency");
        outcomes[1].Status.Should().Be(RosterRowStatuses.Unchanged, "a row blank apart from its key changes nothing");

        var riley = roster.BySignIn("rchen");
        riley.Agency.Should().Be("Fulco Fire Dept");
        riley.JobRole.Should().Be("Captain", "a blank role cell never clears the stored role");
        roster.BySignIn("sortiz").Persona!.Handle.Should().Be("FulcoEM", "a blank personaHandle keeps the current persona");
    }

    [Fact]
    public void Import_BindingAnOrgPersonaOnReupload_UpdatesTheRow_AndMakesItPio()
    {
        var roster = new Roster();
        roster.Import(dryRun: false, File);

        var outcome = roster.Import(dryRun: false, Row("Riley Chen", personaHandle: "FulcoPIO", signInName: "rchen")).Single();

        outcome.Status.Should().Be(RosterRowStatuses.Updated);
        outcome.Message.Should().Contain("persona bound to @FulcoPIO");
        outcome.Participant!.ExerciseRole.Should().Be("pio");
        outcome.Participant.Persona!.Id.Should().Be(FulcoPioId);
        outcome.Participant.PersonaAutoCreated.Should().BeFalse();
    }

    [Fact]
    public void Import_DerivesCollisionSuffixes_AgainstEarlierRowsOfTheSameFile()
    {
        var outcomes = new Roster().Import(dryRun: false, Row("Jane Smith", "A"), Row("John Smith", "B"), Row("Joan Smith", "C"));

        outcomes.Select(o => o.Participant!.SignInName).Should().Equal("jsmith", "jsmith2", "jsmith3");
        outcomes.Select(o => o.Participant!.Persona!.Handle).Should().Equal("jane_smith", "john_smith", "joan_smith");
    }

    [Fact]
    public void Import_AnExplicitSignInName_IsNeverAltered_InvalidFails_ValidIsKept()
    {
        var outcomes = new Roster().Import(dryRun: true, Row("B Two", signInName: "x"), Row("C Three", signInName: "CThree"));

        outcomes[0].Failure.Should().Be(RosterRowFailure.Invalid);
        outcomes[0].Message.Should().Contain("3 to 32");
        outcomes[1].Status.Should().Be(RosterRowStatuses.Created);
        outcomes[1].Participant!.SignInName.Should().Be("cthree", "trimmed and lower-cased, never otherwise altered");
    }

    [Fact]
    public void Import_AnExplicitSignInNameOnTheRoster_MatchesThatPerson_AndCorrectsTheName()
    {
        var outcome = new Roster().Import(dryRun: true, Row("Dana Whitfield-Reyes", signInName: "dwhitfield")).Single();

        outcome.Status.Should().Be(RosterRowStatuses.Updated);
        outcome.Participant!.SignInName.Should().Be("dwhitfield");
        outcome.Message.Should().Contain("name");
    }

    [Fact]
    public void Import_TwoRowsWithTheSameKey_FailTheLaterOne_NamingTheEarlierRow()
    {
        var outcomes = new Roster().Import(dryRun: true, Row("Jane Smith", "A"), Row("Jane Smith", "A"));

        outcomes[0].Status.Should().Be(RosterRowStatuses.Created);
        outcomes[1].Status.Should().Be(RosterRowStatuses.Failed);
        outcomes[1].Message.Should().Be("duplicate of row 1; give a signInName to tell them apart");
    }

    // ------------------------------------------------------------------ the identity key cascades

    [Fact]
    public void Cascade_AnUnknownSignInNameButAKnownEmail_MatchesByEmail_AndReportsTheIgnoredSignInName()
    {
        var roster = new Roster();
        var before = roster.Participants.Count;

        var outcome = roster.Import(
            dryRun: false, Row("Dana Whitfield", email: "dana.whitfield@example.test", signInName: "dana.w")).Single();

        outcome.Status.Should().Be(RosterRowStatuses.Unchanged);
        outcome.Participant!.SignInName.Should().Be("dwhitfield", "the matched person's sign-in name is never changed by a row");
        outcome.Message.Should().Be("signInName dana.w ignored: this person signs in as dwhitfield.");
        roster.Participants.Should().HaveCount(before);
    }

    [Fact]
    public void Cascade_AnUnknownSignInNameButAKnownNameAndAgency_MatchesThatPerson()
    {
        var outcome = new Roster().Import(dryRun: true, Row("Tom Becker", "County Transportation", signInName: "tom.b")).Single();

        outcome.Status.Should().Be(RosterRowStatuses.Unchanged);
        outcome.Participant!.SignInName.Should().Be("tbecker");
    }

    [Fact]
    public void Cascade_FillingInABlankEmail_UpdatesTheSamePerson_ThenTheEmailKeyCarriesTheMatch()
    {
        var roster = new Roster();
        var before = roster.Participants.Count;
        var row = Row("Tom Becker", "County Transportation", email: "tom.becker@example.test");

        var first = roster.Import(dryRun: false, row).Single();
        first.Status.Should().Be(RosterRowStatuses.Updated);
        first.Message.Should().Contain("email");
        roster.Participants.Should().HaveCount(before);
        roster.BySignIn("tbecker").Email.Should().Be("tom.becker@example.test");

        roster.Import(dryRun: false, row).Single().Status.Should().Be(RosterRowStatuses.Unchanged);
    }

    [Fact]
    public void Cascade_TwoKeysMatchingDifferentPeople_FailsTheRow_AndNamesBoth()
    {
        var outcome = new Roster().Import(
            dryRun: false, Row("Anyone", email: "dana.whitfield@example.test", signInName: "moyelaran")).Single();

        outcome.Failure.Should().Be(RosterRowFailure.Conflict);
        outcome.Message.Should().Be("signInName matches Marcus Oyelaran but email matches Dana Whitfield.");
    }

    [Fact]
    public void Cascade_AnEmailMatchingOnePersonAndNameAndAgencyAnother_FailsTheRow()
    {
        var outcome = new Roster().Import(
            dryRun: true, Row("Tom Becker", "County Transportation", email: "dana.whitfield@example.test")).Single();

        outcome.Failure.Should().Be(RosterRowFailure.Conflict);
        outcome.Message.Should().Be("email matches Dana Whitfield but name and agency matches Tom Becker.");
    }

    [Fact]
    public void Cascade_ASignInNameMatchWithADifferentStoredEmail_FailsAndChangesNothing()
    {
        var roster = new Roster();
        var workspace = roster.Open();

        var outcome = workspace.ApplyFile(
            Numbered(Row("Dana Whitfield-Reyes", email: "other@example.test", signInName: "dwhitfield"))).Single();

        outcome.Failure.Should().Be(RosterRowFailure.Conflict);
        outcome.Message.Should().Be(RosterWorkspace.DifferentEmailMessage);
        workspace.Updated.Should().BeEmpty();
        roster.BySignIn("dwhitfield").Name.Should().Be("Dana Whitfield", "a typo must not rename someone else");
    }

    [Fact]
    public void Cascade_TheSameEmailDifferentlyCased_IsNoConflict_AndABlankStoredEmailIsFilledIn()
    {
        var roster = new Roster();

        roster.Import(dryRun: true, Row("Dana Whitfield", email: " DANA.whitfield@example.test ", signInName: "dwhitfield"))
            .Single().Status.Should().Be(RosterRowStatuses.Unchanged);

        roster.Import(dryRun: false, Row("Marcus Oyelaran", email: "marcus@example.test", signInName: "moyelaran"))
            .Single().Status.Should().Be(RosterRowStatuses.Updated);
        roster.BySignIn("moyelaran").Email.Should().Be("marcus@example.test");
    }

    [Fact]
    public void Cascade_AKeyMatchingMoreThanOnePerson_FailsRatherThanGuessing()
    {
        var roster = new Roster();
        roster.Participants.Add(Participant("Pat Lee", "plee7", null, null, null, "participant", new(Guid.NewGuid(), "pat_lee", "Pat Lee", "human"), auto: true));
        roster.Participants.Add(Participant("Pat Lee", "plee8", null, null, null, "participant", new(Guid.NewGuid(), "pat_lee_2", "Pat Lee", "human"), auto: true));

        var ambiguous = roster.Import(dryRun: true, Row("Pat Lee")).Single();
        ambiguous.Failure.Should().Be(RosterRowFailure.Conflict);
        ambiguous.Message.Should().Contain("more than one person");

        roster.Import(dryRun: true, Row("Pat Lee", signInName: "plee8")).Single().Status.Should().Be(
            RosterRowStatuses.Unchanged, "a signInName tells them apart");
    }

    [Fact]
    public void Cascade_ReuploadingTwoSameNamePeopleToldApartBySignInName_IsUnchangedForBoth()
    {
        var roster = new Roster();
        var file = new[] { Row("Jane Smith", "A", signInName: "jane.a"), Row("Jane Smith", "A", signInName: "jane.b") };

        roster.Import(dryRun: false, file).Select(o => o.Status).Should().Equal(RosterRowStatuses.Created, RosterRowStatuses.Created);

        roster.Import(dryRun: false, file).Select(o => o.Status).Should().Equal(
            [RosterRowStatuses.Unchanged, RosterRowStatuses.Unchanged],
            "name + agency matching BOTH people, one of them the signInName match, is not a conflict (idempotency)");
    }

    // ------------------------------------------------------------------ rows in one file never update each other

    [Fact]
    public void SameFile_ASecondRowWithTheSameKey_FailsAsADuplicate_AndUpdatesNobody()
    {
        var roster = new Roster();
        var workspace = roster.Open();

        var outcomes = workspace.ApplyFile(Numbered(Row("Zed Zimmer", "Alpha"), Row("Zed Zimmer", "Alpha")));

        outcomes[0].Status.Should().Be(RosterRowStatuses.Created);
        outcomes[1].Message.Should().Be("duplicate of row 1; give a signInName to tell them apart");
        workspace.Updated.Should().BeEmpty();
    }

    [Fact]
    public void SameFile_ANameAndAgencyOnlyRow_FailsWhenAnotherRowHasThatNameAndAgencyWithAKey_OnEveryUpload()
    {
        // Row 1 could mean the person row 2 names (by email) or someone else: on a first upload it would create a second
        // person, on a re-upload it would match row 2's. The amended guard (241b7d0) fails it on BOTH, so the file's
        // answer never depends on which upload this is.
        var roster = new Roster();
        var file = new[] { Row("Zed Zimmer", "Alpha"), Row("Zed Zimmer", "Alpha", email: "zed@example.test") };

        var first = roster.Import(dryRun: false, file);
        first[0].Status.Should().Be(RosterRowStatuses.Failed);
        first[0].Message.Should().Be("same name and agency as row 2: add a signInName or email to tell them apart");
        first[1].Status.Should().Be(RosterRowStatuses.Created);
        first[1].Participant!.SignInName.Should().Be("zzimmer");

        var again = roster.Import(dryRun: false, file);
        again[0].Status.Should().Be(RosterRowStatuses.Failed);
        again[0].Message.Should().Be("same name and agency as row 2: add a signInName or email to tell them apart");
        again[1].Status.Should().Be(RosterRowStatuses.Unchanged);
        roster.Participants.Count(p => p.Name == "Zed Zimmer").Should().Be(1, "the ambiguous row never creates a second person");
    }

    [Fact]
    public void SameFile_TwoRowsReachingTheSameExistingPersonThroughDifferentKeys_FailTheLaterOne()
    {
        var roster = new Roster();
        var file = new[]
        {
            Row("Dana Whitfield", "Fulco County EM", role: "Ops Chief", signInName: "dwhitfield"),
            Row("Dana Whitfield", "Fulco County EM", role: "Planner", email: "dana.whitfield@example.test"),
        };

        var first = roster.Import(dryRun: false, file);
        first[0].Status.Should().Be(RosterRowStatuses.Updated);
        first[1].Failure.Should().Be(RosterRowFailure.Conflict);
        first[1].Message.Should().Be("duplicate of row 1 (same person)");
        roster.BySignIn("dwhitfield").JobRole.Should().Be("Ops Chief", "one upload never updates a person twice");

        roster.Import(dryRun: false, file).Select(o => o.Status).Should().Equal(
            [RosterRowStatuses.Unchanged, RosterRowStatuses.Failed], "the re-upload is stable: no flip-flop between the two rows");
    }

    [Fact]
    public void Matched_APersonalessParticipant_GetsAnAutoCitizenPersona_ThenIsUnchanged()
    {
        var roster = new Roster();
        roster.Participants.Add(Participant("Madonna", "madonna", null, null, null, "participant", null));

        var first = roster.Import(dryRun: false, Row("Madonna"), Row("Aiko Tanaka")).ToList();

        first.Should().OnlyContain(o => o.Status == RosterRowStatuses.Updated && o.PersonaCreated);
        first[0].Participant!.Persona!.Handle.Should().Be("madonna_2", "the handle steps around the person's own sign-in name (EL-1)");
        first[0].Message.Should().Be("persona created @madonna_2.");
        first[1].Participant!.Persona!.Handle.Should().Be("aiko_tanaka");
        foreach (var participant in first.Select(o => o.Participant!))
        {
            participant.PersonaAutoCreated.Should().BeTrue();
            participant.Persona!.Kind.Should().Be("human");
            participant.ExerciseRole.Should().Be("participant");
        }

        roster.Import(dryRun: false, Row("Madonna"), Row("Aiko Tanaka")).Should().OnlyContain(
            o => o.Status == RosterRowStatuses.Unchanged && !o.PersonaCreated, "the persona exists now: a second upload changes nothing");
    }

    [Fact]
    public void Matched_APersonalessParticipant_InADryRun_ReportsThePersona_ButCreatesNone()
    {
        var roster = new Roster();
        var personas = roster.Personas.Count;

        var outcome = roster.Import(dryRun: true, Row("Aiko Tanaka")).Single();

        outcome.Status.Should().Be(RosterRowStatuses.Updated);
        outcome.PersonaCreated.Should().BeTrue("the dry run reports what the real run will do");
        roster.Personas.Should().HaveCount(personas);
        roster.BySignIn("atanaka").Persona.Should().BeNull("a dry run changes nothing");
    }

    [Fact]
    public void Add_MatchingAPersonalessParticipant_IsStillNotACreation()
    {
        var outcome = new Roster().Add(Row("Aiko Tanaka"));

        outcome.Status.Should().NotBe(RosterRowStatuses.Created, "a single add that matches someone is a 409, persona or not");
    }

    // ------------------------------------------------------------------ same-file guards (3) and (4), a70b106

    [Fact]
    public void SameFile_AFailingRowStillReachesItsPerson_TheReviewersRegression_IsIdenticalOnEveryUpload()
    {
        // Dana is stored as dwhitfield / dana.whitfield@. Row 1 fails (different email) but resolves Dana; row 2 reaches
        // Dana too (and repeats row 1's email). Before guard (3), row 2 updated Dana's email on upload 1, so upload 2
        // then let row 1 through: a flip-flop. Now every upload gives the same answer and writes nothing.
        var roster = new Roster();
        var file = new[]
        {
            Row("Dana Whitfield", "Fulco County EM", role: "Ops Chief", email: "new@example.test", signInName: "dwhitfield"),
            Row("Dana Whitfield", "Fulco County EM", role: "Planner", email: "new@example.test"),
        };

        var uploads = Enumerable.Range(0, 3)
            .Select(_ => roster.Import(dryRun: false, file).Select(o => (o.Status, o.Message)).ToList())
            .ToList();

        uploads[0].Should().Equal(
            (RosterRowStatuses.Failed, RosterWorkspace.DifferentEmailMessage),
            (RosterRowStatuses.Failed, "email also on row 1"));
        uploads[1].Should().Equal(uploads[0], "upload 2 gives exactly upload 1's answer");
        uploads[2].Should().Equal(uploads[0], "and so does upload 3");
        var dana = roster.BySignIn("dwhitfield");
        (dana.Email, dana.JobRole).Should().Be(("dana.whitfield@example.test", "EOC Liaison"), "nothing was ever written");
    }

    [Fact]
    public void SameFile_APersonResolvedByAFailingRow_CannotBeReachedByALaterRow()
    {
        // Guard (3) on its own (no shared email): row 1 resolves Dana by sign-in name and then fails.
        var roster = new Roster();
        var file = new[]
        {
            Row("Dana Whitfield", "Fulco County EM", email: "other@example.test", signInName: "dwhitfield"),
            Row("Dana Whitfield", "Fulco County EM", role: "Planner", email: "new2@example.test"),
        };

        var first = roster.Import(dryRun: false, file);
        first[0].Message.Should().Be(RosterWorkspace.DifferentEmailMessage);
        first[1].Message.Should().Be("duplicate of row 1 (same person)");
        roster.Import(dryRun: false, file).Select(o => o.Message).Should().Equal(first.Select(o => o.Message));
        roster.BySignIn("dwhitfield").JobRole.Should().Be("EOC Liaison");
    }

    [Fact]
    public void SameFile_ThePeopleAConflictingKeyNamed_CountAsReachedToo()
    {
        var roster = new Roster();
        var file = new[]
        {
            Row("Anyone", email: "dana.whitfield@example.test", signInName: "moyelaran"),
            Row("Dana Whitfield", "Fulco County EM", role: "Planner", email: "new3@example.test"),
        };

        var outcomes = roster.Import(dryRun: false, file);

        outcomes[0].Message.Should().Be("signInName matches Marcus Oyelaran but email matches Dana Whitfield.");
        outcomes[1].Message.Should().Be("duplicate of row 1 (same person)", "row 1 resolved Dana through its email key");
    }

    [Fact]
    public void SameFile_AnEmailAnEarlierRowCarried_FailsTheLaterRow_TomAndPriya()
    {
        var roster = new Roster();
        var file = new[]
        {
            Row("Tom Becker", "County Transportation", email: "shared@example.test", signInName: "tbecker"),
            Row("Priya Raman", "Red Cross", email: "shared@example.test", signInName: "praman"),
        };

        var first = roster.Import(dryRun: false, file);
        first[0].Status.Should().Be(RosterRowStatuses.Updated);
        first[1].Status.Should().Be(RosterRowStatuses.Failed);
        first[1].Message.Should().Be("email also on row 1");

        var again = roster.Import(dryRun: false, file);
        again.Select(o => (o.Status, o.Message)).Should().Equal(
            (RosterRowStatuses.Unchanged, null), (RosterRowStatuses.Failed, "email also on row 1"));
        roster.BySignIn("praman").Email.Should().BeNull("two people never end up sharing an email through one file");
    }

    [Fact]
    public void SameFile_TwoNewPeopleWithExplicitSignInNamesAndOneEmail_FailTheLater_OnEveryUpload()
    {
        var roster = new Roster();
        var file = new[]
        {
            Row("New One", email: "Same@Example.test", signInName: "new.one"),
            Row("New Two", email: " same@example.test ", signInName: "new.two"),
        };

        roster.Import(dryRun: false, file).Select(o => (o.Status, o.Message)).Should().Equal(
            (RosterRowStatuses.Created, null), (RosterRowStatuses.Failed, "email also on row 1"));
        roster.Import(dryRun: false, file).Select(o => (o.Status, o.Message)).Should().Equal(
            (RosterRowStatuses.Unchanged, null), (RosterRowStatuses.Failed, "email also on row 1"));
        roster.Participants.Should().NotContain(p => p.SignInName == "new.two");
    }

    [Fact]
    public void SameFile_AnInvalidRow_ReportsItsFieldError_BeforeTheNameAndAgencyGuard()
    {
        var outcomes = new Roster().Import(
            dryRun: true,
            Row("Zed Zimmer", "Alpha", role: new string('r', 129)),
            Row("Zed Zimmer", "Alpha", email: "zed@example.test"));

        outcomes[0].Failure.Should().Be(RosterRowFailure.Invalid);
        outcomes[0].Message.Should().Be(RosterRowRules.RoleTooLongMessage);
    }

    [Fact]
    public void Matched_AnUnresolvablePersonaId_IsReCreated_WithOneUniformMessage()
    {
        var roster = new Roster();
        var lost = Participant("Lost Person", "lperson", null, null, null, "participant", null);
        lost.HadUnresolvedPersona = true; // a dangling id, or another exercise's persona: the workspace cannot tell
        roster.Participants.Add(lost);

        var outcome = roster.Import(dryRun: false, Row("Lost Person")).Single();

        outcome.Status.Should().Be(RosterRowStatuses.Updated);
        outcome.PersonaCreated.Should().BeTrue();
        outcome.Message.Should().Be("persona re-created @lost_person: the previous one was not found.");
        roster.Import(dryRun: false, Row("Lost Person")).Single().Status.Should().Be(RosterRowStatuses.Unchanged);
    }

    // ------------------------------------------------------------------ explicit signInName refusals

    [Theory]
    [InlineData("fulcoem", "persona handle")]
    [InlineData("marcus_oyelaran", "persona handle")]
    [InlineData("admin", "taken by another account")]
    public void ExplicitSignInName_ThatIsAHandleOrANonRosterAccount_Fails(string signInName, string reason)
    {
        var outcome = new Roster().Import(dryRun: true, Row("A One", signInName: signInName)).Single();

        outcome.Status.Should().Be(RosterRowStatuses.Failed);
        outcome.Message.Should().Contain(reason);
    }

    [Fact]
    public void ExplicitSignInName_EqualToAHandleAnEarlierRowJustClaimed_Fails()
    {
        var outcomes = new Roster().Import(dryRun: true, Row("Riley Chen"), Row("Other Person", signInName: "riley_chen"));

        outcomes[0].Participant!.Persona!.Handle.Should().Be("riley_chen");
        outcomes[1].Status.Should().Be(RosterRowStatuses.Failed);
        outcomes[1].Message.Should().Contain("persona handle");
    }

    [Fact]
    public void ExplicitSignInName_ClaimedByAnEarlierRow_EvenADerivedOne_Fails()
    {
        var outcomes = new Roster().Import(dryRun: true, Row("Jane Smith", "A"), Row("Other Person", "B", signInName: "jsmith"));

        outcomes[0].Participant!.SignInName.Should().Be("jsmith");
        outcomes[1].Failure.Should().Be(RosterRowFailure.Conflict);
        outcomes[1].Message.Should().Contain("claimed by an earlier row");
    }

    [Fact]
    public void ExplicitSignInName_ThatIsFree_IsKept()
    {
        new Roster().Import(dryRun: true, Row("A One", signInName: "aone")).Single().Participant!.SignInName.Should().Be("aone");
    }

    // ------------------------------------------------------------------ derived names and auto handles never collide

    [Fact]
    public void Derived_SignInName_StepsAroundANonRosterAccount_AndAroundAPersonaHandle()
    {
        var outcomes = new Roster().Import(dryRun: true, Row("Pat Lee", "A"), Row("Fulcoem", "B"));

        outcomes[0].Participant!.SignInName.Should().Be("plee2", "plee belongs to an account the roster does not list");
        outcomes[1].Participant!.SignInName.Should().Be("fulcoem2", "fulcoem is the org persona @FulcoEM");
    }

    [Fact]
    public void Derived_AutoHandle_NeverEqualsTheRowsOwnSignInName_Madonna()
    {
        var outcome = new Roster().Import(dryRun: false, Row("Madonna")).Single();

        outcome.Participant!.SignInName.Should().Be("madonna");
        outcome.Participant.Persona!.Handle.Should().Be("madonna_2");
        outcome.PersonaCreated.Should().BeTrue();
    }

    [Fact]
    public void Derived_AutoHandle_NeverEqualsAnySignInNameInTheExercise()
    {
        var outcome = new Roster().Import(dryRun: false, Row("Dwhitfield")).Single();

        outcome.Participant!.SignInName.Should().Be("dwhitfield2");
        outcome.Participant.Persona!.Handle.Should().Be("dwhitfield_2");
    }

    [Fact]
    public void Derived_AcrossAWholeImportedRoster_NoPersonaHandleIsAnyonesSignInName()
    {
        var roster = new Roster();

        roster.Import(dryRun: false, Row("Madonna", "A"), Row("Cher", "B"), Row("Dwhitfield", "C"), Row("Jane Smith", "D"), Row("Jane Smith", "E"));

        var signIns = roster.Participants.Select(p => p.SignInName.ToLowerInvariant()).ToHashSet();
        roster.Participants
            .Where(p => p.Persona is not null)
            .Select(p => p.Persona!.Handle.ToLowerInvariant())
            .Should().NotContain(handle => signIns.Contains(handle), "a public handle never exposes a sign-in name (EL-1)");
    }

    [Fact]
    public void Add_TwoKeysMatchingDifferentPeople_IsAConflict_AndAHandleSignInNameIsInvalid()
    {
        var roster = new Roster();

        var clash = roster.Add(Row("Anyone", email: "dana.whitfield@example.test", signInName: "moyelaran"));
        clash.Failure.Should().Be(RosterRowFailure.Conflict, "a conflict is a 409 on the single add");

        var handle = roster.Add(Row("A One", signInName: "FulcoEM"));
        handle.Failure.Should().Be(RosterRowFailure.Invalid, "a sign-in name equal to a persona handle is a 400 on the single add");

        roster.Add(Row("A One", signInName: "admin")).Failure.Should().Be(RosterRowFailure.Conflict);
    }

    [Fact]
    public void TwoRowsMayNameTheSameOrgHandle_EachKeepsTheirOwnAccount()
    {
        var outcomes = new Roster().Import(dryRun: false, Row("Ana Lima", personaHandle: "FulcoEM"), Row("Ben Cole", personaHandle: "FulcoEM"));

        outcomes.Should().OnlyContain(o => o.Status == RosterRowStatuses.Created && o.Participant!.Persona!.Id == FulcoEmId);
        outcomes[0].Participant!.Id.Should().NotBe(outcomes[1].Participant!.Id, "COR-018: one org persona, two people, two accounts");
    }
}
