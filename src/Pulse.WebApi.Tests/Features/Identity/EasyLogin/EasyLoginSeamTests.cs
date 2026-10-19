namespace Pulse.WebApi.Tests.Features.Identity.EasyLogin;

using System;
using System.Collections.Generic;
using System.Data.Common;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.Accounts;
using Pulse.WebApi.Features.Identity.DayWord;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.LinkCards;
using Pulse.WebApi.Features.Identity.PersonalLinks;
using Pulse.WebApi.Features.Identity.Roster;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.PersonalLinks;
using Xunit;

/// <summary>
/// The easy-login cross-story seam (Gate-2 W-002), on REAL SQL Server: stories 01 to 06 composed with their REAL
/// services in ONE container, exactly as <c>Program.cs</c> registers them (<c>AddEasyLoginFoundation</c>,
/// <c>AddRoster</c>, <c>AddPersonalLinks</c>, <c>AddLinkCards</c>, <c>AddDayWord</c>, over <c>AddSessions</c> and
/// <c>AddStaffIdentity</c>). Only the request context is stubbed: the host-resolved exercise and the staff caller.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this exists.</b> Every story is proven on its own slice with doubles at its edges (a recording issuer, a
/// seeded link, a hand-built session). Those suites cannot see a seam break between two stories: an import that issues
/// links through the null issuer, a card that cannot decrypt what the link service wrote, a reissue that leaves a word
/// session alive, a sign-in method that escapes the day cap. This suite walks one exercise through all six stories so
/// such a break fails here. The wiring of the same calls into the real <c>Program</c> host is pinned separately by
/// <see cref="EasyLoginCompositionRootWiringTests"/>.
/// </para>
/// <para>
/// <b><see cref="Stories01To06_ComposeEndToEnd"/>, step by step.</b>
/// <list type="number">
///   <item><description><b>02 x 03, import through the real issuer.</b> A CSV of two new people and one existing,
///   persona-less password participant creates two accounts, each with an ACTIVE link whose join URL is the configured
///   SPA origin (story 03's issuer replaced story 01's null default), and gives the existing person an auto-created
///   citizen persona and NO link. One <c>participant.link.issued</c> per new person and one <c>roster.imported</c>.</description></item>
///   <item><description><b>02, a re-upload never rotates.</b> The same file again changes nothing and every join URL is
///   the one issued the first time.</description></item>
///   <item><description><b>03 x 06, a link sign-in is day-capped.</b> Joining with the imported URL mints a participant
///   session whose refresh window ends at the end of the exercise day in the exercise zone, and whose access token does
///   not outlive it.</description></item>
///   <item><description><b>05 x 06, a word sign-in is day-capped too.</b> A planner sets today's word; the same person
///   signs in with their sign-in name (any case) and the word (any spelling), and gets the same day cap.</description></item>
///   <item><description><b>02 x 03, the roster counts agree.</b> The roster shows two live sessions and one use of the
///   link, with a last-used time.</description></item>
///   <item><description><b>04 x 03, a card decrypts what 03 wrote.</b> The card sheet prints the same join URL the roster
///   shows; a person with no active link is skipped as <c>noActiveLink</c>.</description></item>
///   <item><description><b>03 x 05 x 04, reissue.</b> Reissue ends BOTH sessions (the link one and the word one), resets
///   the counters, makes the refresh token of the word session fail, turns the printed card into an unknown token, and
///   the next sheet prints the new URL.</description></item>
///   <item><description><b>03 x 04 x 02, revoke.</b> A revoked person gets no card, and a re-upload does not resurrect the
///   revoked link.</description></item>
///   <item><description><b>03 x 05 x 04, disable.</b> A disabled person is refused by the link AND the word, and the card
///   sheet skips them as <c>disabled</c>.</description></item>
///   <item><description><b>03 x 05, closed run.</b> Once the exercise is <c>archived</c>, an enabled person with an active
///   link and today's word is refused by both (one rule for all, 2026-10-19: sign-in follows participant reads, which
///   <c>completed</c> still accepts and <c>archived</c> does not).</description></item>
///   <item><description><b>XC-004, no secret anywhere.</b> No event carries a link token, the word, an email address or
///   the SPA origin; the four <c>login</c> payloads (link and word, success and failure) are present; and every staff
///   event names the planner as a system actor with the acting human.</description></item>
/// </list>
/// </para>
/// <para>
/// <b>Racing a Disable (Gate-2 W-001, S-2).</b> The word and password sign-ins take story 03's join pattern: mint, re-read
/// the account untracked, and revoke and refuse if it was disabled meanwhile. The racing issuer runs the REAL staff
/// Disable on its own connection just before the session is minted, so the Disable's session sweep cannot see it; the
/// sign-in must notice by itself. The other interleaving, the one that used to leave a live session (the Disable's sweep
/// reads BEFORE the session is minted, and the sign-in re-reads BEFORE the Disable saves), is closed at its source: a
/// Disable commits <c>DisabledAt</c> before it sweeps, so that sign-in's re-read already sees the Disable. As defence
/// in depth, refresh refuses a session whose account is not an enabled account of its exercise.
/// </para>
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class EasyLoginSeamTests
{
    private const string TimeZone = "America/Chicago";

    private readonly MsSqlContainerFixture _fixture;

    public EasyLoginSeamTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task Stories01To06_ComposeEndToEnd()
    {
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture, timeZone: TimeZone);
        var staff = await PersonalLinkSeed.StaffAsync(_fixture, exercise.Id, role: "planner");
        var request = new RequestContext { ExerciseId = exercise.Id, Staff = staff.Current };

        // A persona-less legacy participant, as the legacy import or the bootstrap leaves one.
        var legacy = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id, withPassword: true);

        await using var services = Compose(request);

        // ---- 02 x 03: import through the REAL issuer ----------------------------------------------------------------
        var csv = "name,agency,role,email,personaHandle,signInName\n"
            + "Jane Smith,Fulco EM,EOC Liaison,jane@example.test,,\n"
            + "Bob Jones,Fulco PD,,,,\n"
            + $"Pat Participant,,,,,{legacy.Username}\n";
        var first = await InScope(services, s => s.GetRequiredService<RosterService>().ImportAsync(csv, dryRun: false));
        first.Outcome.Should().Be(RosterOutcome.Ok);
        first.Report!.CreatedCount.Should().Be(2);
        first.Report.UpdatedCount.Should().Be(1, "the persona-less legacy participant gets an auto persona");
        first.Report.FailedCount.Should().Be(0);

        var imported = await ListAsync(services);
        var jane = imported.Participants.Single(p => p.SignInName == "jsmith");
        var bob = imported.Participants.Single(p => p.SignInName == "bjones");
        var pat = imported.Participants.Single(p => p.Id == legacy.Id.ToString());
        jane.Link.Status.Should().Be("active", "story 03's real issuer, not story 01's null default, issued it");
        jane.Link.JoinUrl.Should().StartWith(PersonalLinkSeed.FrontendBaseUrl + "/join/");
        jane.Link.UseCount.Should().Be(0);
        pat.Persona.Should().NotBeNull("a matched persona-less person gets an auto citizen persona");
        pat.Persona!.AutoCreated.Should().BeTrue();
        pat.Link.Status.Should().Be("none", "a matched person gets a persona and NO link");

        var importEvents = await PersonalLinkSeed.ReadEventsAsync(_fixture, exercise.Id);
        importEvents.Count(e => e.EventType == EasyLoginTelemetry.LinkIssuedEventType).Should().Be(2, "one per new participant");
        importEvents.Count(e => e.EventType == EasyLoginTelemetry.RosterImportedEventType).Should().Be(1);

        // ---- 02: a re-upload never rotates --------------------------------------------------------------------------
        var again = await InScope(services, s => s.GetRequiredService<RosterService>().ImportAsync(csv, dryRun: false));
        again.Report!.UnchangedCount.Should().Be(3);
        (await ListAsync(services)).Participants.Single(p => p.Id == jane.Id).Link.JoinUrl.Should().Be(
            jane.Link.JoinUrl, "a re-upload never rotates a link");

        // ---- 03 x 06: a link sign-in is day-capped ------------------------------------------------------------------
        var janeToken = PersonalLinkSeed.TokenOf(jane.Link.JoinUrl!);
        var join = await InScope(services, s => s.GetRequiredService<JoinLoginService>().JoinAsync(new JoinRequestBody { Token = janeToken }));
        join.Outcome.Should().Be(JoinLoginOutcome.Authenticated);
        var joinSession = join.Issued!.Session;
        var endOfDay = ExerciseDay.EndOfDayUtc(TimeZone, joinSession.IssuedAt, 0);
        joinSession.Kind.Should().Be("participant");
        joinSession.RefreshExpiresAt.Should().Be(endOfDay, "06's day cap applies to a link sign-in");
        joinSession.ExpiresAt.Should().BeOnOrBefore(endOfDay);

        // ---- 05 x 06: a word sign-in is day-capped too --------------------------------------------------------------
        var set = await InScope(services, s => s.GetRequiredService<DayWordService>().SetAsync(new DayWordPutBody { Word = "Brave-Otter-42" }));
        set.Outcome.Should().Be(DayWordOutcome.Ok);
        var word = await InScope(services, s => s.GetRequiredService<WordLoginService>().SignInAsync(
            new WordSignInRequestBody { SignInName = "JSmith", Word = "brave otter 42" }));
        word.Outcome.Should().Be(WordLoginOutcome.Authenticated);
        word.Issued!.Session.RefreshExpiresAt.Should().Be(
            ExerciseDay.EndOfDayUtc(TimeZone, word.Issued.Session.IssuedAt, 0), "06's day cap applies to a word sign-in");

        // ---- 02 x 03: liveSessions and useCount agree -----------------------------------------------------------------
        var signedIn = (await ListAsync(services)).Participants.Single(p => p.Id == jane.Id);
        signedIn.LiveSessions.Should().Be(2, "the link session and the word session");
        signedIn.Link.UseCount.Should().Be(1, "only the link sign-in is a use of the link");
        signedIn.Link.LastUsedAt.Should().NotBeNull();

        // ---- 04 x 03: a card decrypts what 03 wrote ---------------------------------------------------------------------
        var sheet = await InScope(services, s => s.GetRequiredService<LinkCardService>().GenerateAsync(
            new RosterCardsRequestBody { ParticipantIds = new List<string?> { jane.Id, bob.Id, pat.Id } }));
        sheet.Outcome.Should().Be(LinkCardOutcome.Ok);
        var printedUrl = sheet.Sheet!.Cards.Single(c => c.ParticipantId == jane.Id).JoinUrl;
        printedUrl.Should().Be(jane.Link.JoinUrl, "the card prints the live link story 03 protected");
        sheet.Sheet.Skipped.Should().ContainSingle(skip => skip.ParticipantId == pat.Id && skip.Reason == "noActiveLink");

        // ---- 03 x 05 x 04: reissue ends every session, resets counters, and kills the printed card -----------------------
        var reissue = await InScope(services, s => s.GetRequiredService<ParticipantAccessService>().ReissueAsync(Guid.Parse(jane.Id)));
        reissue.Outcome.Should().Be(ParticipantAccessOutcome.Ok);
        reissue.Body!.SessionsEnded.Should().Be(2, "the link session AND the word session end");
        var reissued = (await ListAsync(services)).Participants.Single(p => p.Id == jane.Id);
        reissued.LiveSessions.Should().Be(0, "liveSessions drops by exactly sessionsEnded");
        reissued.Link.UseCount.Should().Be(0);
        reissued.Link.LastUsedAt.Should().BeNull();
        reissued.Link.JoinUrl.Should().NotBe(printedUrl);
        (await InScope(services, s => s.GetRequiredService<SessionService>().RefreshAsync(word.Issued.RefreshToken)))
            .Outcome.Should().Be(RefreshOutcome.Invalid, "the word session's refresh token died with the reissue");
        (await InScope(services, s => s.GetRequiredService<JoinLoginService>().JoinAsync(
                new JoinRequestBody { Token = PersonalLinkSeed.TokenOf(printedUrl) })))
            .Outcome.Should().Be(JoinLoginOutcome.Rejected, "a card printed before the reissue is now an unknown token");
        var reprinted = await InScope(services, s => s.GetRequiredService<LinkCardService>().GenerateAsync(
            new RosterCardsRequestBody { ParticipantIds = new List<string?> { jane.Id } }));
        reprinted.Sheet!.Cards.Single().JoinUrl.Should().Be(reissued.Link.JoinUrl, "the next sheet prints the new URL");

        // ---- 03 x 04 x 02: revoke prints no card, and a re-upload does not resurrect the link ----------------------------
        (await InScope(services, s => s.GetRequiredService<ParticipantAccessService>().RevokeAsync(Guid.Parse(bob.Id))))
            .Outcome.Should().Be(ParticipantAccessOutcome.Ok);
        var everyone = await InScope(services, s => s.GetRequiredService<LinkCardService>().GenerateAsync(new RosterCardsRequestBody { All = true }));
        everyone.Sheet!.Skipped.Should().Contain(skip => skip.ParticipantId == bob.Id && skip.Reason == "noActiveLink");
        await InScope(services, s => s.GetRequiredService<RosterService>().ImportAsync(csv, dryRun: false));
        (await ListAsync(services)).Participants.Single(p => p.Id == bob.Id).Link.Status.Should().Be(
            "revoked", "a re-upload never re-activates a revoked link");

        // ---- 03 x 05 x 04: disable refuses the link AND the word, and prints no card -----------------------------------
        (await InScope(services, s => s.GetRequiredService<ParticipantAccessService>().DisableAsync(Guid.Parse(jane.Id))))
            .Outcome.Should().Be(ParticipantAccessOutcome.Ok);
        (await InScope(services, s => s.GetRequiredService<JoinLoginService>().JoinAsync(
                new JoinRequestBody { Token = PersonalLinkSeed.TokenOf(reissued.Link.JoinUrl!) })))
            .Outcome.Should().Be(JoinLoginOutcome.Rejected, "a disabled person's active link is refused");
        (await InScope(services, s => s.GetRequiredService<WordLoginService>().SignInAsync(
                new WordSignInRequestBody { SignInName = "jsmith", Word = "brave-otter-42" })))
            .Outcome.Should().Be(WordLoginOutcome.Rejected, "a disabled person's word sign-in is refused");
        (await InScope(services, s => s.GetRequiredService<LinkCardService>().GenerateAsync(
                new RosterCardsRequestBody { ParticipantIds = new List<string?> { jane.Id } })))
            .Sheet!.Skipped.Should().ContainSingle(skip => skip.Reason == "disabled");

        // ---- 03 x 05: once archived an enabled person is refused by both ----------------------------------------------
        (await InScope(services, s => s.GetRequiredService<ParticipantAccessService>().ReissueAsync(Guid.Parse(bob.Id))))
            .Outcome.Should().Be(ParticipantAccessOutcome.Ok);
        var bobUrl = (await ListAsync(services)).Participants.Single(p => p.Id == bob.Id).Link.JoinUrl!;
        await using (var db = _fixture.CreateContext())
        {
            (await db.Exercises.SingleAsync(e => e.Id == exercise.Id)).Status = "archived";
            await db.SaveChangesAsync();
        }

        (await InScope(services, s => s.GetRequiredService<JoinLoginService>().JoinAsync(
                new JoinRequestBody { Token = PersonalLinkSeed.TokenOf(bobUrl) })))
            .Outcome.Should().Be(JoinLoginOutcome.Rejected, "no sign-in once the run is archived");
        (await InScope(services, s => s.GetRequiredService<WordLoginService>().SignInAsync(
                new WordSignInRequestBody { SignInName = "bjones", Word = "brave-otter-42" })))
            .Outcome.Should().Be(WordLoginOutcome.Rejected, "no sign-in once the run is archived");

        // ---- XC-004: no secret anywhere, every sign-in shape present, every staff event attributed ----------------------
        var events = await PersonalLinkSeed.ReadEventsAsync(_fixture, exercise.Id);
        var secrets = new[]
        {
            janeToken, PersonalLinkSeed.TokenOf(reissued.Link.JoinUrl!), PersonalLinkSeed.TokenOf(bobUrl),
            "brave", "otter", "jane@example.test", PersonalLinkSeed.FrontendBaseUrl,
        };
        foreach (var e in events)
        {
            var carried = $"{e.Payload}|{e.Target?.EntityId}|{e.Actor?.ParticipantId}|{e.Actor?.ActingHumanId}|{e.Actor?.Role}";
            foreach (var secret in secrets)
            {
                carried.Should().NotContainEquivalentOf(secret, "event {0} must carry no secret", e.EventType);
            }
        }

        events.Where(e => e.EventType == EasyLoginTelemetry.LoginEventType).Select(e => e.Payload).Should().Contain(new[]
        {
            "{\"outcome\":\"success\",\"method\":\"link\"}",
            "{\"outcome\":\"success\",\"method\":\"word\"}",
            "{\"outcome\":\"failure\",\"method\":\"link\"}",
            "{\"outcome\":\"failure\",\"method\":\"word\"}",
        });
        events.Where(e => e.EventType is "participant.link.issued" or "participant.link.reissued" or "participant.link.revoked"
                or "participant.disabled" or "roster.imported" or "roster.cards.generated" or "credential.rotated")
            .Should().OnlyContain(e => e.Actor!.Kind == "system"
                && e.Actor.Role == "planner"
                && e.Actor.ActingHumanId == staff.StaffUserId.ToString());
    }

    [RequiresDockerFact]
    public async Task WordSignIn_RacingADisable_IsTheUniformRefusal_AndLeavesNoLiveSession()
    {
        var (services, exercise, account) = await ComposeWithADisableRacingTheIssueAsync();
        await using (services)
        {
            (await InScope(services, s => s.GetRequiredService<DayWordService>().SetAsync(new DayWordPutBody { Word = "calm-heron-77" })))
                .Outcome.Should().Be(DayWordOutcome.Ok);

            var word = await InScope(services, s => s.GetRequiredService<WordLoginService>().SignInAsync(
                new WordSignInRequestBody { SignInName = account.Username, Word = "calm-heron-77" }));

            word.Outcome.Should().Be(WordLoginOutcome.Rejected, "the re-read after minting sees the Disable");
            word.Issued.Should().BeNull("no token reaches the caller");
            await AssertTheRaceLeftNothingLiveAsync(services, exercise.Id, account.Id, "{\"outcome\":\"failure\",\"method\":\"word\"}");
        }
    }

    [RequiresDockerFact]
    public async Task PasswordSignIn_RacingADisable_IsTheOrdinary401_AndLeavesNoLiveSession()
    {
        var (services, exercise, account) = await ComposeWithADisableRacingTheIssueAsync(withPassword: true);
        await using (services)
        {
            var login = await InScope(services, s => s.GetRequiredService<ParticipantLoginService>().LoginAsync(
                new ParticipantLoginRequest { Username = account.Username, Password = PersonalLinkSeed.Password }));

            login.Outcome.Should().Be(ParticipantLoginOutcome.RejectedCredential, "the re-read after minting sees the Disable");
            login.Issued.Should().BeNull("no token reaches the caller");
            await AssertTheRaceLeftNothingLiveAsync(
                services, exercise.Id, account.Id, "{\"outcome\":\"failure\",\"method\":\"password\"}");
        }
    }

    [RequiresDockerFact]
    public async Task ASignInMintingAfterTheDisableSweep_IsRefused_BecauseTheDisableCommittedFirst()
    {
        // Gate-2 S-2, the window that USED to be left: the sign-in admits the account, then the Disable reads the sessions
        // to end (none yet), then the sign-in mints and re-reads, then the Disable saves. Before the fold the Disable
        // committed DisabledAt only in that last save, so the re-read saw an enabled account and a disabled person kept a
        // live session the sweep never saw. Now the Disable commits DisabledAt BEFORE it sweeps, so the re-read sees it.
        // Driven deterministically: the sign-in is paused just before minting; the Disable is paused just before its
        // event save (after its commit and its sweep); the sign-in then mints and re-reads; then the Disable finishes.
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture, timeZone: TimeZone);
        var staff = await PersonalLinkSeed.StaffAsync(_fixture, exercise.Id, role: "controller");
        var account = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id, withPassword: true);
        var timeout = TimeSpan.FromSeconds(60);

        var signInAtMint = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var mint = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var disableAtEventSave = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var finishDisable = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        await using var participantSide = Compose(new RequestContext { ExerciseId = exercise.Id }, race: async _ =>
        {
            signInAtMint.TrySetResult();
            await mint.Task;
        });
        await using var staffSide = Compose(
            new RequestContext { ExerciseId = exercise.Id, Staff = staff.Current },
            interceptor: new PauseBeforeTheEventSave(disableAtEventSave, finishDisable.Task));

        var signIn = InScope(participantSide, s => s.GetRequiredService<ParticipantLoginService>().LoginAsync(
            new ParticipantLoginRequest { Username = account.Username, Password = PersonalLinkSeed.Password }));
        await signInAtMint.Task.WaitAsync(timeout);

        var disable = InScope(staffSide, s => s.GetRequiredService<ParticipantAccessService>().DisableAsync(account.Id));
        await disableAtEventSave.Task.WaitAsync(timeout);

        mint.TrySetResult();
        var login = await signIn.WaitAsync(timeout);

        finishDisable.TrySetResult();
        var disabled = await disable.WaitAsync(timeout);

        login.Outcome.Should().Be(
            ParticipantLoginOutcome.RejectedCredential, "the re-read ran after the Disable's commit, so it saw the Disable");
        login.Issued.Should().BeNull();
        disabled.Outcome.Should().Be(ParticipantAccessOutcome.Ok);
        disabled.Body!.SessionsEnded.Should().Be(0, "precondition: the Disable swept BEFORE the session was minted");
        await AssertTheRaceLeftNothingLiveAsync(
            staffSide, exercise.Id, account.Id, "{\"outcome\":\"failure\",\"method\":\"password\"}");

        var disables = (await PersonalLinkSeed.ReadEventsAsync(_fixture, exercise.Id))
            .Where(e => e.EventType == EasyLoginTelemetry.ParticipantDisabledEventType)
            .ToList();
        disables.Should().ContainSingle("one Disable, one participant.disabled event")
            .Which.Payload.Should().Be("{\"sessionsEnded\":0}", "the count is exactly the sessions this Disable ended");
    }

    [RequiresDockerFact]
    public async Task ASessionOfADisabledAccount_CannotRenew_EvenWhenNoSweepEndedIt()
    {
        // Defence in depth behind Disable's own sweep (which since Gate-2 S-2 cannot miss a session): an account whose
        // DisabledAt is set with NO sweep at all (written directly here) cannot keep its session renewing. The access
        // token stays live until it expires, but refresh refuses it, so it ends within one access-token lifetime.
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture, timeZone: TimeZone);
        var account = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id, withPassword: true);
        await using var services = Compose(new RequestContext { ExerciseId = exercise.Id });

        var login = await InScope(services, s => s.GetRequiredService<ParticipantLoginService>().LoginAsync(
            new ParticipantLoginRequest { Username = account.Username, Password = PersonalLinkSeed.Password }));
        login.Outcome.Should().Be(ParticipantLoginOutcome.Authenticated);

        await using (var staffSide = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id }))
        {
            (await staffSide.Accounts.SingleAsync(a => a.Id == account.Id)).DisabledAt = DateTimeOffset.UtcNow;
            await staffSide.SaveChangesAsync();
        }

        (await InScope(services, s => s.GetRequiredService<SessionService>().RefreshAsync(login.Issued!.RefreshToken)))
            .Outcome.Should().Be(RefreshOutcome.Invalid, "a disabled participant's session cannot renew");
    }

    /// <summary>
    /// A composed container whose session issuer first runs the REAL staff Disable of a fresh participant on its own
    /// scope (so on its own connection), i.e. after the sign-in admitted the account and before its session exists.
    /// </summary>
    private async Task<(ServiceProvider Services, Exercise Exercise, Account Account)> ComposeWithADisableRacingTheIssueAsync(
        bool withPassword = false)
    {
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture, timeZone: TimeZone);
        var staff = await PersonalLinkSeed.StaffAsync(_fixture, exercise.Id, role: "controller");
        var account = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id, withPassword: withPassword);
        var request = new RequestContext { ExerciseId = exercise.Id, Staff = staff.Current };
        var raced = false;

        var services = Compose(request, race: async root =>
        {
            if (raced)
            {
                return;
            }

            raced = true;
            await using var staffScope = root.CreateAsyncScope();
            var disable = await staffScope.ServiceProvider.GetRequiredService<ParticipantAccessService>().DisableAsync(account.Id);
            disable.Outcome.Should().Be(ParticipantAccessOutcome.Ok, "precondition: the racing Disable committed");
        });

        return (services, exercise, account);
    }

    /// <summary>After a raced sign-in: the account is disabled, its one session is revoked, and only a failure was recorded.</summary>
    private async Task AssertTheRaceLeftNothingLiveAsync(ServiceProvider services, Guid exerciseId, Guid accountId, string failurePayload)
    {
        var entry = (await ListAsync(services)).Participants.Single(p => p.Id == accountId.ToString());
        entry.Access.Should().Be("disabled", "precondition: the Disable committed");
        entry.LiveSessions.Should().Be(0, "a disabled person holds no live session");

        await using var unfiltered = _fixture.CreateContext();
        var sessions = await unfiltered.Sessions.AsNoTracking().Where(s => s.AccountId == accountId).ToListAsync();
        sessions.Should().ContainSingle("precondition: the session was minted before the re-read").Which.RevokedAt.Should().NotBeNull(
            "the raced session is ended at once, by the sign-in itself (the Disable's sweep could not see it)");

        var logins = (await PersonalLinkSeed.ReadEventsAsync(_fixture, exerciseId))
            .Where(e => e.EventType == EasyLoginTelemetry.LoginEventType)
            .ToList();
        logins.Should().ContainSingle("a raced attempt emits exactly one login event, and no success event")
            .Which.Payload.Should().Be(failurePayload);
        (await PersonalLinkSeed.ReadAccountAsync(_fixture, exerciseId, accountId)).LastLoginAt.Should().BeNull(
            "LastLoginAt is written only once the re-read passes");
    }

    /// <summary>
    /// Stories 01 to 06 registered as <c>Program.cs</c> registers them, over real SQL. The request context (the
    /// host-resolved exercise and the staff caller) comes from <paramref name="request"/>; Data Protection uses an
    /// ephemeral key ring. With <paramref name="race"/>, the session issuer runs it just before minting; with
    /// <paramref name="interceptor"/>, every context of this container runs it.
    /// </summary>
    private ServiceProvider Compose(
        RequestContext request,
        Func<IServiceProvider, Task>? race = null,
        IInterceptor? interceptor = null)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            [JoinUrlBuilder.FrontendBaseUrlKey] = PersonalLinkSeed.FrontendBaseUrl,
        }).Build();

        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(configuration);
        services.AddLogging();
        services.AddHttpContextAccessor();
        services.AddDbContext<PulseDbContext>(options =>
        {
            options.UseSqlServer(_fixture.ConnectionString);
            if (interceptor is not null)
            {
                options.AddInterceptors(interceptor);
            }
        });
        services.AddExerciseScoping();
        services.AddExerciseClock();
        services.AddStaffIdentity(configuration);
        services.AddSessions(configuration);
        services.AddParticipantAccounts();
        services.AddEasyLoginFoundation();
        services.AddRoster();
        services.AddPersonalLinks();
        services.AddLinkCards();
        services.AddDayWord();
        services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());

        services.RemoveAll<IExerciseContext>();
        services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = request.ExerciseId });
        services.RemoveAll<ICurrentStaffSessionAccessor>();
        services.AddScoped<ICurrentStaffSessionAccessor>(_ => new FixedStaffSessionAccessor(request.Staff));

        ServiceProvider? root = null;
        if (race is not null)
        {
            services.Replace(ServiceDescriptor.Scoped<ISessionIssuer>(provider => new RacingSessionIssuer(
                ActivatorUtilities.CreateInstance<SessionIssuer>(provider), () => race(root!))));
        }

        root = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });
        return root;
    }

    private static async Task<T> InScope<T>(ServiceProvider services, Func<IServiceProvider, Task<T>> body)
    {
        await using var scope = services.CreateAsyncScope();
        return await body(scope.ServiceProvider);
    }

    private static async Task<RosterListDto> ListAsync(ServiceProvider services) =>
        (await InScope(services, s => s.GetRequiredService<RosterQueryService>().ListAsync()))!;

    /// <summary>The stubbed request context: the host-resolved exercise and the staff caller (none for a participant flow).</summary>
    private sealed class RequestContext
    {
        public Guid? ExerciseId { get; init; }

        public CurrentStaffSession? Staff { get; init; }
    }

    /// <summary>
    /// Pauses the first command that inserts a telemetry event (a Disable's last save, after its commit and its sweep)
    /// until <c>proceed</c> completes, signalling <c>reached</c> first.
    /// </summary>
    private sealed class PauseBeforeTheEventSave(TaskCompletionSource reached, Task proceed) : DbCommandInterceptor
    {
        private int _paused;

        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            await PauseAsync(command);
            return result;
        }

        public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            await PauseAsync(command);
            return result;
        }

        private async Task PauseAsync(DbCommand command)
        {
            if (!command.CommandText.Contains("INSERT INTO [TelemetryEvents]", StringComparison.Ordinal)
                || Interlocked.Exchange(ref _paused, 1) == 1)
            {
                return;
            }

            reached.TrySetResult();
            await proceed;
        }
    }

    private sealed class FixedStaffSessionAccessor(CurrentStaffSession? staff) : ICurrentStaffSessionAccessor
    {
        public Task<CurrentStaffSession?> GetCurrentStaffSessionAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(staff);
    }
}
