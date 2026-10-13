namespace Pulse.WebApi.Tests.Features.Identity.EasyLogin;

using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Moq;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// easy-login/01 (Exercise facts and telemetry AC, XC-004) — every event in the <c>implementation.md</c> telemetry
/// table is built by <see cref="EasyLoginTelemetry"/> on the locked v0 envelope, and every one PASSES
/// <see cref="TelemetryEnvelopeRules"/> (the same rules the <c>PulseDbContext</c> write guard enforces): a participant
/// success has a <c>participantId</c>, an identity-less failure is <c>system</c> (the #356 trap), and no payload or
/// target can carry a token, a word, a URL or an email address.
/// </summary>
public sealed class EasyLoginTelemetryTests
{
    private static readonly Guid ExerciseId = Guid.NewGuid();
    private static readonly Guid StaffUserId = Guid.NewGuid();
    private static readonly Guid AccountId = Guid.NewGuid();
    private static readonly Guid LinkId = Guid.NewGuid();
    private static readonly Guid DayWordId = Guid.NewGuid();
    private static readonly EasyLoginStaffActor Staff = new(StaffUserId, "controller");

    private static readonly EasyLoginEventTime Time = new(
        new DateTimeOffset(2026, 10, 20, 13, 0, 0, TimeSpan.Zero),
        new DateTimeOffset(2033, 6, 14, 9, 30, 0, TimeSpan.FromHours(-4)),
        "America/New_York");

    /// <summary>Every builder, with the event type and exact payload the frozen table specifies.</summary>
    public static TheoryData<string, string, string> EveryEvent() => new()
    {
        { "login.success.link", "login", """{"outcome":"success","method":"link"}""" },
        { "login.success.word", "login", """{"outcome":"success","method":"word"}""" },
        { "login.failure.link", "login", """{"outcome":"failure","method":"link"}""" },
        { "login.failure.word", "login", """{"outcome":"failure","method":"word"}""" },
        { "link.issued", "participant.link.issued", $$"""{"accountId":"{{AccountId}}","sessionsEnded":0}""" },
        { "link.reissued", "participant.link.reissued", $$"""{"accountId":"{{AccountId}}","sessionsEnded":2}""" },
        { "link.revoked", "participant.link.revoked", $$"""{"accountId":"{{AccountId}}","sessionsEnded":1}""" },
        { "participant.disabled", "participant.disabled", """{"sessionsEnded":3}""" },
        { "participant.enabled", "participant.enabled", """{"sessionsEnded":0}""" },
        { "roster.imported", "roster.imported", """{"created":5,"updated":1,"unchanged":2,"failed":1}""" },
        { "roster.cards.generated", "roster.cards.generated", """{"count":42}""" },
        { "dayword.set", "credential.rotated", """{"date":"2026-10-21","first":true,"generated":false}""" },
        { "dayword.cleared", "credential.revoked", """{"date":"2026-10-21"}""" },
        { "link.emailed", "participant.link.emailed", """{"outcome":"sent"}""" },
    };

    [Theory]
    [MemberData(nameof(EveryEvent))]
    public void EveryEvent_IsTheFrozenTypeAndPayload_OnTheV0Envelope_AndPassesTheEnvelopeRules(
        string builder, string eventType, string payload)
    {
        var evt = Build(builder);

        evt.EventType.Should().Be(eventType);
        JsonNode.DeepEquals(JsonNode.Parse(evt.Payload!), JsonNode.Parse(payload)).Should().BeTrue(
            "the {0} payload must be exactly {1}, but was {2}", builder, payload, evt.Payload);

        evt.SchemaVersion.Should().Be("v0");
        evt.Channel.Should().Be("system", "every easy-login event is on the system channel");
        evt.ExerciseId.Should().Be(ExerciseId);
        Guid.TryParse(evt.EventId, out _).Should().BeTrue("each event gets a fresh uuid event id");
        evt.WallClockTime.Should().Be(Time.WallClock);
        evt.EmittedAt.Should().Be(Time.WallClock, "one clock read shared by the mutation and its event");
        evt.ScenarioTime.Should().Be(Time.ScenarioTime);
        evt.TimeZone.Should().Be("America/New_York");
        evt.Origin.Should().BeNull("a sign-in or a staff action is not content, so it carries no provenance origin");

        TelemetryEnvelopeRules.Validate(TelemetryAttributionFacts.FromEntity(evt)).Should().BeEmpty(
            "every built event must pass the v0 conditional rules the write guard enforces");
    }

    [Fact]
    public void LoginSuccess_IsAParticipantActorWithItsParticipantId_AndNoTarget()
    {
        foreach (var method in new[] { EasyLoginMethod.Link, EasyLoginMethod.Word })
        {
            var evt = EasyLoginTelemetry.LoginSucceeded(ExerciseId, AccountId, method, Time);

            evt.Actor.Kind.Should().Be("participant");
            evt.Actor.ParticipantId.Should().Be(AccountId.ToString(), "a participant actor must carry participantId");
            evt.Actor.ActingHumanId.Should().BeNull();
            evt.Actor.Role.Should().BeNull();
            evt.Target.Should().BeNull();
        }
    }

    [Fact]
    public void LoginFailures_AreIdentityLessSystemActors()
    {
        var link = EasyLoginTelemetry.LinkLoginFailed(ExerciseId, Time);
        var word = EasyLoginTelemetry.WordLoginFailed(ExerciseId, "jsmith", Time);

        foreach (var evt in new[] { link, word })
        {
            evt.Actor.Kind.Should().Be("system", "an attempt that resolved no participant is a system actor (#356)");
            evt.Actor.ParticipantId.Should().BeNull();
            evt.Actor.PersonaId.Should().BeNull();
            evt.Actor.ActingHumanId.Should().BeNull();
            evt.Actor.SessionId.Should().BeNull();
            evt.Actor.Role.Should().BeNull();
        }

        link.Target.Should().BeNull("a failed link sign-in has no target, and never the token");
        word.Target.Should().BeEquivalentTo(new TelemetryTarget { EntityType = "accountHandle", EntityId = "jsmith" });
    }

    [Fact]
    public void StaffEvents_AreSystemActorsWithTheStaffRoleAndActingHuman_AndTheirTargets()
    {
        var events = new Dictionary<string, (TelemetryEvent Event, TelemetryTarget? Target)>
        {
            ["issued"] = (Build("link.issued"), new TelemetryTarget { EntityType = "participantLink", EntityId = LinkId.ToString() }),
            ["reissued"] = (Build("link.reissued"), new TelemetryTarget { EntityType = "participantLink", EntityId = LinkId.ToString() }),
            ["revoked"] = (Build("link.revoked"), new TelemetryTarget { EntityType = "participantLink", EntityId = LinkId.ToString() }),
            ["disabled"] = (Build("participant.disabled"), new TelemetryTarget { EntityType = "account", EntityId = AccountId.ToString() }),
            ["enabled"] = (Build("participant.enabled"), new TelemetryTarget { EntityType = "account", EntityId = AccountId.ToString() }),
            ["imported"] = (Build("roster.imported"), null),
            ["cards"] = (Build("roster.cards.generated"), null),
            ["set"] = (Build("dayword.set"), new TelemetryTarget { EntityType = "dayWord", EntityId = DayWordId.ToString() }),
            ["cleared"] = (Build("dayword.cleared"), new TelemetryTarget { EntityType = "dayWord", EntityId = DayWordId.ToString() }),
            ["emailed"] = (Build("link.emailed"), new TelemetryTarget { EntityType = "participantLink", EntityId = LinkId.ToString() }),
        };

        foreach (var (name, (evt, target)) in events)
        {
            evt.Actor.Kind.Should().Be("system", "{0} is a staff action", name);
            evt.Actor.Role.Should().Be("controller", "{0} carries the staff role", name);
            evt.Actor.ActingHumanId.Should().Be(StaffUserId.ToString(), "{0} carries the staff user as acting human", name);
            evt.Actor.ParticipantId.Should().BeNull();
            evt.Target.Should().BeEquivalentTo(target, "{0} targets the row it acted on", name);
        }
    }

    [Fact]
    public void AStaffActorWithNoRoleOrUser_OmitsThem_RatherThanWritingEmptyStrings()
    {
        var evt = EasyLoginTelemetry.RosterCardsGenerated(ExerciseId, new EasyLoginStaffActor(null, "  "), 1, Time);

        evt.Actor.Role.Should().BeNull("an off-envelope empty string is null-omitted, never \"\"");
        evt.Actor.ActingHumanId.Should().BeNull();
        TelemetryEnvelopeRules.Validate(TelemetryAttributionFacts.FromEntity(evt)).Should().BeEmpty();
    }

    [Theory]
    [InlineData("jsmith", "jsmith")]
    [InlineData("  mary.ann_o-neil  ", "mary.ann_o-neil")]
    [InlineData("ng1", "ng1")]
    [InlineData(null, null)]
    [InlineData("", null)]
    [InlineData("   ", null)]
    [InlineData("jane@agency.gov", null)]                    // an email address
    [InlineData("https://spa.example/join/abc", null)]       // a join URL
    [InlineData("spa.example/join/abc", null)]               // a URL without a scheme
    [InlineData("C:\\temp", null)]                           // a path
    [InlineData("AbC-dEf_GhIjKlMnOpQrSt", null)]             // a raw link token (22 base64url characters)
    [InlineData("abcdefghijklmnopqrstuv", null)]             // a lower-cased token is still token-shaped
    [InlineData("maple-harbor-42", null)]                    // a generated day word typed into the name box
    [InlineData("mapleharbor42", null)]                      // ...the same word typed without its separators (W-3)
    [InlineData("Maple_Harbor.42", null)]                    // ...or with other separators
    [InlineData("jsmith42", null)]                           // accepted over-redaction: a name ending in two digits
    [InlineData("jsmith2", "jsmith2")]                       // a collision suffix (one digit) is still a plain name
    [InlineData("Maple Harbor 42", null)]                    // a spoken day word (a phrase)
    [InlineData("jsmith\u0007", null)]                       // a control character
    public void RedactAttemptedName_KeepsOnlyAPlainSignInName(string? attempted, string? expected)
    {
        EasyLoginTelemetry.RedactAttemptedName(attempted).Should().Be(expected);
    }

    [Fact]
    public void RedactAttemptedName_DropsAnOverlongName()
    {
        EasyLoginTelemetry.RedactAttemptedName(new string('a', EasyLoginTelemetry.MaxAttemptedNameLength)).Should().NotBeNull();
        EasyLoginTelemetry.RedactAttemptedName(new string('a', EasyLoginTelemetry.MaxAttemptedNameLength + 1)).Should().BeNull();
    }

    [Fact]
    public void NoEvent_CarriesATokenWordUrlOrEmail_EvenWhenOneIsTypedIntoTheNameBox()
    {
        var token = ParticipantLinkTokens.Generate();
        string[] secrets =
        [
            token,
            token.ToLowerInvariant(),
            $"https://spa.example/join/{token}",
            "maple-harbor-42",
            "mapleharbor42",
            "Maple Harbor 42",
            "jane.smith@agency.gov",
        ];

        var events = new List<TelemetryEvent>();
        foreach (var (builder, _, _) in Rows(EveryEvent()))
        {
            events.Add(Build(builder));
        }

        foreach (var secret in secrets)
        {
            events.Add(EasyLoginTelemetry.WordLoginFailed(ExerciseId, secret, Time));
        }

        foreach (var evt in events)
        {
            var serialized = JsonSerializer.Serialize(evt);
            foreach (var secret in secrets)
            {
                serialized.Should().NotContain(secret, "no easy-login event may carry a token, word, URL or email address");
            }

            serialized.Should().NotContain("@", "no email address, in any field");
            serialized.Should().NotContain("://", "no URL, in any field");
        }
    }

    [Fact]
    public void Builders_RefuseEmptyIdsAndNegativeCounts()
    {
        ((Action)(() => EasyLoginTelemetry.LoginSucceeded(ExerciseId, Guid.Empty, EasyLoginMethod.Link, Time)))
            .Should().Throw<ArgumentException>("a participant success must name its participant");
        ((Action)(() => EasyLoginTelemetry.LinkLoginFailed(Guid.Empty, Time)))
            .Should().Throw<ArgumentException>("an event is always scoped to a real exercise");
        ((Action)(() => EasyLoginTelemetry.LinkRevoked(ExerciseId, Staff, Guid.Empty, AccountId, 0, Time)))
            .Should().Throw<ArgumentException>();
        ((Action)(() => EasyLoginTelemetry.ParticipantDisabled(ExerciseId, Staff, AccountId, -1, Time)))
            .Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void EventTime_PrefersTheLiveClock_ThenTheStoredScenarioTime_ThenTheWallClock()
    {
        var now = new DateTimeOffset(2026, 10, 20, 13, 0, 0, TimeSpan.Zero);
        var stored = new DateTimeOffset(2033, 6, 14, 8, 0, 0, TimeSpan.Zero);
        var live = new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.Zero);
        var facts = new ExerciseFacts("Ex", "America/New_York", "live", Guid.NewGuid(), stored);

        var running = Mock.Of<IExerciseClock>(c => c.CurrentScenarioTime(ExerciseId) == live);
        var stopped = Mock.Of<IExerciseClock>(c => c.CurrentScenarioTime(ExerciseId) == null);

        EasyLoginEventTime.For(ExerciseId, facts, running, now).Should().Be(new EasyLoginEventTime(now, live, "America/New_York"));
        EasyLoginEventTime.For(ExerciseId, facts, stopped, now).ScenarioTime.Should().Be(stored);
        EasyLoginEventTime.For(ExerciseId, facts with { StoredScenarioTime = null }, null, now).ScenarioTime.Should().Be(now);
        EasyLoginEventTime.For(ExerciseId, facts with { TimeZone = " " }, null, now).TimeZone.Should().Be(
            "UTC", "the envelope time zone is required, so a blank stored zone becomes UTC");
        EasyLoginEventTime.For(ExerciseId, null, null, now).Should().Be(new EasyLoginEventTime(now, now, "UTC"));
    }

    private static TelemetryEvent Build(string builder) => builder switch
    {
        "login.success.link" => EasyLoginTelemetry.LoginSucceeded(ExerciseId, AccountId, EasyLoginMethod.Link, Time),
        "login.success.word" => EasyLoginTelemetry.LoginSucceeded(ExerciseId, AccountId, EasyLoginMethod.Word, Time),
        "login.failure.link" => EasyLoginTelemetry.LinkLoginFailed(ExerciseId, Time),
        "login.failure.word" => EasyLoginTelemetry.WordLoginFailed(ExerciseId, "jsmith", Time),
        "link.issued" => EasyLoginTelemetry.LinkIssued(ExerciseId, Staff, LinkId, AccountId, Time),
        "link.reissued" => EasyLoginTelemetry.LinkReissued(ExerciseId, Staff, LinkId, AccountId, 2, Time),
        "link.revoked" => EasyLoginTelemetry.LinkRevoked(ExerciseId, Staff, LinkId, AccountId, 1, Time),
        "participant.disabled" => EasyLoginTelemetry.ParticipantDisabled(ExerciseId, Staff, AccountId, 3, Time),
        "participant.enabled" => EasyLoginTelemetry.ParticipantEnabled(ExerciseId, Staff, AccountId, 0, Time),
        "roster.imported" => EasyLoginTelemetry.RosterImported(ExerciseId, Staff, 5, 1, 2, 1, Time),
        "roster.cards.generated" => EasyLoginTelemetry.RosterCardsGenerated(ExerciseId, Staff, 42, Time),
        "dayword.set" => EasyLoginTelemetry.DayWordSet(ExerciseId, Staff, DayWordId, new DateOnly(2026, 10, 21), first: true, generated: false, Time),
        "dayword.cleared" => EasyLoginTelemetry.DayWordCleared(ExerciseId, Staff, DayWordId, new DateOnly(2026, 10, 21), Time),
        "link.emailed" => EasyLoginTelemetry.LinkEmailed(ExerciseId, Staff, LinkId, sent: true, Time),
        _ => throw new ArgumentOutOfRangeException(nameof(builder), builder, null),
    };

    private static IEnumerable<(string, string, string)> Rows(TheoryData<string, string, string> data)
    {
        foreach (var row in data)
        {
            yield return ((string)row[0], (string)row[1], (string)row[2]);
        }
    }
}
