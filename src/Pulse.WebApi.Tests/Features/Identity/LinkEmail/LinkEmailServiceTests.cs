namespace Pulse.WebApi.Tests.Features.Identity.LinkEmail;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.LinkEmail;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// easy-login/13: <see cref="LinkEmailService"/> against real SQL with a fake mailer. Each eligible participant (enabled,
/// a deliverable address, an active link whose copy decrypts) gets ONE message carrying their OWN join link; everyone
/// else is <c>skipped</c> with the reason (<c>disabled</c>, <c>noEmail</c>, <c>noActiveLink</c>,
/// <c>tokenUnrecoverable</c>, <c>notFound</c>); a failed, throttled or faulting send is that person's <c>failed</c>
/// result and never aborts the batch. One <c>participant.link.emailed</c> event per attempt, and no address, token, URL
/// or name in any event, log line or result. The caps (100), the strict body, the 503 when dark and the time budget.
/// Isolation lives in <see cref="LinkEmailIsolationTests"/>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class LinkEmailServiceTests
{
    private readonly LinkEmailTestWorld _world;

    public LinkEmailServiceTests(MsSqlContainerFixture fixture) => _world = new LinkEmailTestWorld(fixture);

    [RequiresDockerFact]
    public async Task EachEligibleParticipant_GetsOneMessage_WithTheirOwnLink_AndEveryoneElseIsSkippedWithTheReason()
    {
        var exercise = await _world.SeedExerciseAsync(name: "Coastal Surge 2026");
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        var ann = await _world.SeedParticipantAsync(exercise, "Ann Active");
        var ben = await _world.SeedParticipantAsync(exercise, "Ben NoEmail", email: string.Empty);
        var cal = await _world.SeedParticipantAsync(exercise, "Cal NoLink", EmailSeededLink.None);
        var dee = await _world.SeedParticipantAsync(exercise, "Dee Revoked", EmailSeededLink.Revoked);
        var eve = await _world.SeedParticipantAsync(exercise, "Eve Disabled", disabled: true);
        var fay = await _world.SeedParticipantAsync(exercise, "Fay LostKeyRing", EmailSeededLink.LostKeyRing);
        var gus = await _world.SeedParticipantAsync(exercise, "Gus Active");
        var mailer = new FakeParticipantLinkMailer();

        var result = await _world.SendAsync(exercise, staff, mailer);

        result.Outcome.Should().Be(LinkEmailOutcome.Ok);
        result.Body!.Results.Select(r => (r.ParticipantId, r.Status, r.Reason)).Should().Equal(
            [
                (ann.AccountId.ToString(), RosterEmailStatuses.Sent, null),
                (ben.AccountId.ToString(), RosterEmailStatuses.Skipped, RosterEmailSkipReasons.NoEmail),
                (cal.AccountId.ToString(), RosterEmailStatuses.Skipped, RosterEmailSkipReasons.NoActiveLink),
                (dee.AccountId.ToString(), RosterEmailStatuses.Skipped, RosterEmailSkipReasons.NoActiveLink),
                (eve.AccountId.ToString(), RosterEmailStatuses.Skipped, RosterEmailSkipReasons.Disabled),
                (fay.AccountId.ToString(), RosterEmailStatuses.Skipped, RosterEmailSkipReasons.TokenUnrecoverable),
                (gus.AccountId.ToString(), RosterEmailStatuses.Sent, null),
            ],
            "omitting the ids considers everyone, in name order, and only the eligible are emailed");

        mailer.Messages.Select(m => m.RecipientAddress).Should().Equal([ann.Email, gus.Email], "one message per eligible person");
        var annMessage = mailer.Messages[0];
        annMessage.Subject.Should().Be("Your sign-in link for Coastal Surge 2026");
        annMessage.HtmlBody.Should().Contain(ann.JoinUrl).And.Contain(ann.SignInName).And.NotContain(gus.JoinUrl!);
        annMessage.PlainTextBody.Should().Contain(ann.JoinUrl).And.Contain(ann.SignInName);
        mailer.Messages[1].HtmlBody.Should().Contain(gus.JoinUrl).And.NotContain(ann.JoinUrl!, "each email carries its OWN link");
    }

    [RequiresDockerFact]
    public async Task ParticipantIds_LimitTheBatch_DeduplicatedCaseInsensitively_AndUnknownIdsAreNotFound()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "planner"));
        var one = await _world.SeedParticipantAsync(exercise, "One Person");
        await _world.SeedParticipantAsync(exercise, "Not Requested");
        var unknown = Guid.NewGuid().ToString();
        var mailer = new FakeParticipantLinkMailer();

        var result = await _world.SendAsync(
            exercise,
            staff,
            mailer,
            [one.AccountId.ToString(), one.AccountId.ToString().ToUpperInvariant(), unknown, "not-a-guid", "NOT-A-GUID"]);

        result.Body!.Results.Select(r => (r.ParticipantId, r.Status, r.Reason)).Should().Equal(
            [
                (one.AccountId.ToString(), RosterEmailStatuses.Sent, null),
                (unknown, RosterEmailStatuses.Skipped, RosterEmailSkipReasons.NotFound),
                ("not-a-guid", RosterEmailStatuses.Skipped, RosterEmailSkipReasons.NotFound),
            ],
            "only the requested accounts, once each; a malformed id is notFound, never 'everyone'");
        mailer.Messages.Should().ContainSingle().Which.RecipientAddress.Should().Be(one.Email);
    }

    [RequiresDockerFact]
    public async Task OneFailure_NeverAbortsTheBatch_FailedThrottledAndFaultingSendsAreReported_AndTheRestGoOut()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        var a = await _world.SeedParticipantAsync(exercise, "A Refused");
        var b = await _world.SeedParticipantAsync(exercise, "B Throttled");
        var c = await _world.SeedParticipantAsync(exercise, "C Faulting");
        var d = await _world.SeedParticipantAsync(exercise, "D Fine");
        var mailer = new FakeParticipantLinkMailer()
            .Answer(a.Email!, LinkMailSendOutcome.Failed)
            .Answer(b.Email!, LinkMailSendOutcome.RateLimited)
            .ThrowFor(c.Email!);
        var logs = new LinkEmailCapturingLoggerProvider();

        var result = await _world.SendAsync(exercise, staff, mailer, logs: logs);

        result.Outcome.Should().Be(LinkEmailOutcome.Ok);
        result.Body!.Results.Select(r => (r.ParticipantId, r.Status, r.Reason)).Should().Equal(
            [
                (a.AccountId.ToString(), RosterEmailStatuses.Failed, RosterEmailFailureReasons.SendFailed),
                (b.AccountId.ToString(), RosterEmailStatuses.Failed, RosterEmailFailureReasons.RateLimited),
                (c.AccountId.ToString(), RosterEmailStatuses.Failed, RosterEmailFailureReasons.SendFailed),
                (d.AccountId.ToString(), RosterEmailStatuses.Sent, null),
            ]);
        mailer.Messages.Should().HaveCount(4, "every eligible person was attempted, in order, despite the failures");

        var events = await _world.EmailEventsAsync(exercise);
        events.Should().HaveCount(4, "one event per send ATTEMPT");
        events.Select(e => (e.Target!.EntityId, Outcome(e.Payload!))).Should().BeEquivalentTo(
            [
                (a.LinkId.ToString(), "failed"),
                (b.LinkId.ToString(), "failed"),
                (c.LinkId.ToString(), "failed"),
                (d.LinkId.ToString(), "sent"),
            ]);

        logs.All.Should().Contain("InvalidOperationException", "an unexpected fault is logged by type");
        AssertNoSecrets(logs.All, a, b, c, d);
    }

    [RequiresDockerFact]
    public async Task EachAttempt_RecordsOneEvent_WithTheStaffActorAndTheLink_AndNoSecretAnywhere()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "planner"));
        var jane = await _world.SeedParticipantAsync(exercise, "Jane Smith");
        var skipped = await _world.SeedParticipantAsync(exercise, "Zed NoEmail", email: string.Empty);
        var logs = new LinkEmailCapturingLoggerProvider();

        var result = await _world.SendAsync(exercise, staff, new FakeParticipantLinkMailer(), logs: logs);

        var emitted = (await _world.EmailEventsAsync(exercise)).Should().ContainSingle("a skip records nothing").Subject;
        emitted.EventType.Should().Be("participant.link.emailed");
        emitted.Channel.Should().Be("system");
        emitted.Actor.Kind.Should().Be("system");
        emitted.Actor.Role.Should().Be("planner");
        emitted.Actor.ActingHumanId.Should().Be(staff.ToString());
        emitted.Actor.ParticipantId.Should().BeNull();
        emitted.Target!.EntityType.Should().Be("participantLink");
        emitted.Target.EntityId.Should().Be(jane.LinkId.ToString());
        JsonDocument.Parse(emitted.Payload!).RootElement.EnumerateObject().Select(p => (p.Name, p.Value.GetString()))
            .Should().Equal([("outcome", "sent")]);

        var everything = JsonSerializer.Serialize(emitted) + JsonSerializer.Serialize(result.Body) + logs.All;
        AssertNoSecrets(everything, jane);
        everything.Should().NotContain(skipped.Name);
        logs.All.Should().Contain("1 sent, 1 skipped, 0 failed", "one count-only summary line per batch");
    }

    [RequiresDockerFact]
    public async Task AHostileName_IsHtmlEncodedInTheMessage()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        var hostile = await _world.SeedParticipantAsync(exercise, "<img src=x onerror=alert(1)>\r\nBcc: x@evil.example");
        var mailer = new FakeParticipantLinkMailer();

        await _world.SendAsync(exercise, staff, mailer, [hostile.AccountId.ToString()]);

        var message = mailer.Messages.Should().ContainSingle().Subject;
        message.HtmlBody.Should().NotContain("<img").And.Contain("&lt;img src");
        message.PlainTextBody.Should().NotContain("\r").And.Contain("Hello <img src=x onerror=alert(1)> Bcc: x@evil.example,");
        message.RecipientAddress.Should().Be(hostile.Email, "the recipient is the stored address, never anything from the name");
    }

    [RequiresDockerFact]
    public async Task AnAddressThatIsNotASingleBareMailbox_IsNoEmail()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        var folded = await _world.SeedParticipantAsync(exercise, "Folded", email: "a@example.org\r\nBcc: b@example.org");
        var named = await _world.SeedParticipantAsync(exercise, "Named", email: "Jane <jane@example.org>");
        var mailer = new FakeParticipantLinkMailer();

        var result = await _world.SendAsync(exercise, staff, mailer, [folded.AccountId.ToString(), named.AccountId.ToString()]);

        result.Body!.Results.Should().OnlyContain(r => r.Status == RosterEmailStatuses.Skipped && r.Reason == RosterEmailSkipReasons.NoEmail);
        mailer.Messages.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task NotConfigured_IsTheDarkAnswer_AndNothingIsReadSentOrRecorded()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        await _world.SeedParticipantAsync(exercise, "Ann Active");
        var mailer = new FakeParticipantLinkMailer(configured: false);

        var result = await _world.SendAsync(exercise, staff, mailer);

        result.Outcome.Should().Be(LinkEmailOutcome.NotConfigured);
        result.Message.Should().Be("Email delivery is not configured");
        mailer.Messages.Should().BeEmpty();
        (await _world.EmailEventsAsync(exercise)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task NoJoinBase_IsJoinLinksUnavailable_AndNothingIsSent()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        await _world.SeedParticipantAsync(exercise, "Ann Active");
        var mailer = new FakeParticipantLinkMailer();

        var result = await _world.SendAsync(exercise, staff, mailer, frontendBase: null);

        result.Outcome.Should().Be(LinkEmailOutcome.JoinLinksUnavailable);
        mailer.Messages.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task TheBodyShape_IsStrict_AndTheCapIs100()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        var mailer = new FakeParticipantLinkMailer();

        var nullBody = await _world.SendWithBodyAsync(exercise, staff, mailer, body: null);
        var empty = await _world.SendAsync(exercise, staff, mailer, []);
        var hundred = await _world.SendAsync(exercise, staff, mailer, Enumerable.Range(0, 100).Select(_ => Guid.NewGuid().ToString()).ToList());
        var tooMany = await _world.SendAsync(exercise, staff, mailer, Enumerable.Range(0, 101).Select(_ => Guid.NewGuid().ToString()).ToList());

        nullBody.Outcome.Should().Be(LinkEmailOutcome.Invalid);
        empty.Outcome.Should().Be(LinkEmailOutcome.Invalid, "an empty array is never 'everyone': only an omitted participantIds is");
        hundred.Outcome.Should().Be(LinkEmailOutcome.Ok);
        hundred.Body!.Results.Should().HaveCount(100).And.OnlyContain(r => r.Reason == RosterEmailSkipReasons.NotFound);
        tooMany.Outcome.Should().Be(LinkEmailOutcome.TooMany);
        tooMany.Message.Should().Contain("100");
        mailer.Messages.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task OmittedIds_WithMoreThan100Eligible_IsRefusedBeforeAnySend()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        for (var i = 0; i < 101; i++)
        {
            await _world.SeedParticipantAsync(exercise, $"Person {i:D3}");
        }

        var mailer = new FakeParticipantLinkMailer();

        var result = await _world.SendAsync(exercise, staff, mailer);

        result.Outcome.Should().Be(LinkEmailOutcome.TooMany);
        result.Message.Should().Contain("100");
        mailer.Messages.Should().BeEmpty("the cap is decided before the first email leaves");
        (await _world.EmailEventsAsync(exercise)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task OnceTheBatchBudgetIsSpent_TheRestAreNotAttempted_AndRecordNothing()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        var first = await _world.SeedParticipantAsync(exercise, "A First");
        var second = await _world.SeedParticipantAsync(exercise, "B Second");
        var third = await _world.SeedParticipantAsync(exercise, "C Third");
        var mailer = new FakeParticipantLinkMailer();

        // A budget of one tick: the first send always starts; every later one finds the budget spent.
        var result = await _world.SendAsync(exercise, staff, mailer, pacing: p => p.BatchBudget = TimeSpan.FromTicks(1));

        result.Body!.Results.Select(r => (r.ParticipantId, r.Status, r.Reason)).Should().Equal(
            [
                (first.AccountId.ToString(), RosterEmailStatuses.Sent, null),
                (second.AccountId.ToString(), RosterEmailStatuses.Failed, RosterEmailFailureReasons.NotAttempted),
                (third.AccountId.ToString(), RosterEmailStatuses.Failed, RosterEmailFailureReasons.NotAttempted),
            ]);
        mailer.Messages.Should().ContainSingle();
        (await _world.EmailEventsAsync(exercise)).Should().ContainSingle("only an attempt records an event");
    }

    [RequiresDockerFact]
    public async Task AnEvaluator_IsForbidden_AndNoSessionIsUnauthenticated_AndNeitherSendsAnything()
    {
        var exercise = await _world.SeedExerciseAsync();
        var evaluator = await _world.SeedStaffAsync((exercise, "evaluator"));
        await _world.SeedParticipantAsync(exercise, "Ann Active");
        var mailer = new FakeParticipantLinkMailer();

        var forbidden = await _world.SendAsync(exercise, evaluator, mailer);
        var anonymous = await _world.SendAsync(exercise, staffUserId: null, mailer);

        forbidden.Outcome.Should().Be(LinkEmailOutcome.Forbidden);
        anonymous.Outcome.Should().Be(LinkEmailOutcome.Unauthenticated);
        mailer.Messages.Should().BeEmpty();
        (await _world.EmailEventsAsync(exercise)).Should().BeEmpty();
    }

    private static string? Outcome(string payload) =>
        JsonDocument.Parse(payload).RootElement.GetProperty("outcome").GetString();

    private static void AssertNoSecrets(string text, params EmailSeededParticipant[] people)
    {
        foreach (var person in people)
        {
            text.Should().NotContain(person.Email!, "no email address in any event, log or result");
            if (person.Token is not null)
            {
                text.Should().NotContain(person.Token, "no token anywhere");
                text.Should().NotContain(person.JoinUrl!, "no join URL anywhere");
            }

            text.Should().NotContain(person.Name, "no participant name in a log or event");
        }

        text.Should().NotContain("/join/");
    }
}
