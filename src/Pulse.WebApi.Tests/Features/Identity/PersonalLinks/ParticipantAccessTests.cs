namespace Pulse.WebApi.Tests.Features.Identity.PersonalLinks;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.PersonalLinks;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// easy-login/03 (reissue, revoke, disable/enable ACs; authorization AC) — the four staff routes over the REAL pipeline
/// (host resolution, session middleware, default-deny gate, staff + roster-role filters) against real SQL Server.
/// Proves the effects a participant feels: reissue and revoke end every live session (including one whose access token
/// has lapsed but whose refresh window is open) so the refresh then fails; the old URL stops at once; revoke is
/// idempotent and leaves other sign-in methods alone; disable blocks the link AND the password sign-in (with the wrong-
/// password telemetry); enable restores both and changes nothing else.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ParticipantAccessTests
{
    private readonly MsSqlContainerFixture _fixture;

    public ParticipantAccessTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task Reissue_EndsEveryLiveSession_TheirRefreshFails_TheOldUrlStops_AndTheNewOneWorks()
    {
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var account = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id);
        var (seededLink, oldToken) = await PersonalLinkSeed.LinkAsync(_fixture, account);
        var staff = await PersonalLinkSeed.StaffAsync(_fixture, exercise.Id);
        var now = DateTimeOffset.UtcNow;

        var live = await PersonalLinkSeed.ParticipantSessionAsync(_fixture, exercise.Id, account.Id);
        var lapsedAccess = await PersonalLinkSeed.ParticipantSessionAsync(
            _fixture, exercise.Id, account.Id, expiresAt: now.AddMinutes(-10), refreshExpiresAt: now.AddHours(6));
        var dead = await PersonalLinkSeed.ParticipantSessionAsync(
            _fixture, exercise.Id, account.Id, expiresAt: now.AddHours(-13), refreshExpiresAt: now.AddHours(-1));
        var alreadyRevokedAt = now.AddHours(-3);
        var alreadyRevoked = await PersonalLinkSeed.ParticipantSessionAsync(_fixture, exercise.Id, account.Id, revokedAt: alreadyRevokedAt);
        var someoneElse = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id);
        var otherPerson = await PersonalLinkSeed.ParticipantSessionAsync(_fixture, exercise.Id, someoneElse.Id);

        await using var host = await PersonalLinksTestHost.StartAsync(_fixture.ConnectionString!);
        using var staffClient = host.Client(exercise.Hostname, staff.RawToken);

        using var response = await PersonalLinksTestHost.ActionAsync(staffClient, account.Id, "link/reissue");

        response.StatusCode.Should().Be(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        response.Headers.CacheControl!.NoStore.Should().BeTrue("staff responses can carry a join URL");
        var body = await PersonalLinksTestHost.JsonAsync(response);
        body.GetProperty("participantId").GetString().Should().Be(account.Id.ToString());
        body.GetProperty("access").GetString().Should().Be("enabled");
        body.GetProperty("sessionsEnded").GetInt32().Should().Be(
            2, "the live session and the lapsed-access-open-refresh session were usable; the dead and revoked ones were not");
        var link = body.GetProperty("link");
        link.GetProperty("status").GetString().Should().Be("active");
        link.TryGetProperty("needsReissue", out _).Should().BeFalse();
        var joinUrl = link.GetProperty("joinUrl").GetString()!;
        joinUrl.Should().StartWith($"{PersonalLinkSeed.FrontendBaseUrl}/join/", "the response carries the new join URL");
        var newToken = PersonalLinkSeed.TokenOf(joinUrl);
        newToken.Should().NotBe(oldToken);

        foreach (var ended in new[] { live, lapsedAccess, dead })
        {
            (await PersonalLinkSeed.ReadSessionAsync(_fixture, ended.Id)).RevokedAt.Should().NotBeNull("every non-revoked session of the person is ended");
        }

        (await PersonalLinkSeed.ReadSessionAsync(_fixture, alreadyRevoked.Id)).RevokedAt.Should().Be(alreadyRevokedAt, "an earlier revoke is kept");
        (await PersonalLinkSeed.ReadSessionAsync(_fixture, otherPerson.Id)).RevokedAt.Should().BeNull("only this participant's sessions end");

        var stored = await PersonalLinkSeed.ReadLinkAsync(_fixture, exercise.Id, account.Id);
        stored!.Id.Should().Be(seededLink.Id);
        stored.Generation.Should().Be(2);
        stored.IssuedByStaffUserId.Should().Be(staff.StaffUserId);

        using var anonymous = host.Client(exercise.Hostname);
        foreach (var ended in new[] { live, lapsedAccess })
        {
            using var refresh = await anonymous.PostAsJsonAsync("/api/auth/refresh", new { refreshToken = ended.RawRefreshToken });
            refresh.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "an ended session's refresh token fails");
        }

        using var participantSession = host.Client(exercise.Hostname, live.RawToken);
        (await participantSession.GetAsync("/api/session")).StatusCode.Should().Be(HttpStatusCode.Unauthorized, "the ended session is dead");

        (await PersonalLinksTestHost.JoinAsync(anonymous, oldToken)).StatusCode.Should().Be(HttpStatusCode.Unauthorized, "the old URL stops at once");
        (await PersonalLinksTestHost.JoinAsync(anonymous, newToken)).StatusCode.Should().Be(HttpStatusCode.OK, "the new URL works");
    }

    [RequiresDockerFact]
    public async Task Reissue_WorksForAPersonWithNoLinkYet_AndForALinkThatNeedsReissue()
    {
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var noLink = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id);
        var unrecoverable = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id);

        // Protected under a key ring this host does not have: the roster would show needsReissue.
        await PersonalLinkSeed.LinkAsync(_fixture, unrecoverable, PersonalLinkSeed.Protector());
        var staff = await PersonalLinkSeed.StaffAsync(_fixture, exercise.Id, role: "planner");

        await using var host = await PersonalLinksTestHost.StartAsync(_fixture.ConnectionString!);
        using var staffClient = host.Client(exercise.Hostname, staff.RawToken);

        foreach (var account in new[] { noLink, unrecoverable })
        {
            using var response = await PersonalLinksTestHost.ActionAsync(staffClient, account.Id, "link/reissue");
            response.StatusCode.Should().Be(HttpStatusCode.OK, "a planner may reissue");
            var link = (await PersonalLinksTestHost.JsonAsync(response)).GetProperty("link");
            link.GetProperty("status").GetString().Should().Be("active");
            link.TryGetProperty("needsReissue", out _).Should().BeFalse("a reissued link is recoverable again");

            var token = PersonalLinkSeed.TokenOf(link.GetProperty("joinUrl").GetString()!);
            using var anonymous = host.Client(exercise.Hostname);
            (await PersonalLinksTestHost.JoinAsync(anonymous, token)).StatusCode.Should().Be(HttpStatusCode.OK);
        }

        (await PersonalLinkSeed.ReadLinkAsync(_fixture, exercise.Id, noLink.Id))!.Generation.Should().Be(1, "the first link was issued");
    }

    [RequiresDockerFact]
    public async Task Revoke_EndsSessions_ClearsTheCopy_IsIdempotent_AndLeavesOtherSignInMethodsAlone()
    {
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var account = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id, withPassword: true);
        var (_, token) = await PersonalLinkSeed.LinkAsync(_fixture, account);
        var staff = await PersonalLinkSeed.StaffAsync(_fixture, exercise.Id);
        var live = await PersonalLinkSeed.ParticipantSessionAsync(_fixture, exercise.Id, account.Id);

        await using var host = await PersonalLinksTestHost.StartAsync(_fixture.ConnectionString!);
        using var staffClient = host.Client(exercise.Hostname, staff.RawToken);
        using var anonymous = host.Client(exercise.Hostname);

        using var first = await PersonalLinksTestHost.ActionAsync(staffClient, account.Id, "link/revoke");
        first.StatusCode.Should().Be(HttpStatusCode.OK);
        var firstBody = await PersonalLinksTestHost.JsonAsync(first);
        firstBody.GetProperty("sessionsEnded").GetInt32().Should().Be(1);
        firstBody.GetProperty("access").GetString().Should().Be("enabled", "revoke is not disable");
        var link = firstBody.GetProperty("link");
        link.GetProperty("status").GetString().Should().Be("revoked");
        link.TryGetProperty("revokedAt", out _).Should().BeTrue();
        link.TryGetProperty("joinUrl", out _).Should().BeFalse("a revoked link is never printable");

        var stored = await PersonalLinkSeed.ReadLinkAsync(_fixture, exercise.Id, account.Id);
        stored!.RevokedAt.Should().NotBeNull();
        stored.RevokedByStaffUserId.Should().Be(staff.StaffUserId);
        stored.ProtectedToken.Should().BeNull("revoke clears the protected copy (EL-5)");
        (await PersonalLinkSeed.ReadSessionAsync(_fixture, live.Id)).RevokedAt.Should().NotBeNull();
        (await PersonalLinksTestHost.JoinAsync(anonymous, token)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        // Not disabled, so another sign-in method still works (the day word in production; the password here).
        using var password = await anonymous.PostAsJsonAsync("/api/auth/login", new { username = account.Username, password = PersonalLinkSeed.Password });
        password.StatusCode.Should().Be(HttpStatusCode.OK, "revoking the link does not lock the person out");
        var newSession = (await PersonalLinksTestHost.JsonAsync(password)).GetProperty("token").GetString();

        using var again = await PersonalLinksTestHost.ActionAsync(staffClient, account.Id, "link/revoke");
        again.StatusCode.Should().Be(HttpStatusCode.OK, "revoking again is not an error");
        var againBody = await PersonalLinksTestHost.JsonAsync(again);
        againBody.GetProperty("sessionsEnded").GetInt32().Should().Be(0, "a repeat revoke is a no-op");
        againBody.GetProperty("link").GetProperty("revokedAt").GetString().Should().Be(link.GetProperty("revokedAt").GetString());

        using var stillSignedIn = host.Client(exercise.Hostname, newSession);
        (await stillSignedIn.GetAsync("/api/session")).StatusCode.Should().Be(
            HttpStatusCode.OK, "the no-op repeat revoke ended nothing");

        var revokeEvents = (await PersonalLinkSeed.ReadEventsAsync(_fixture, exercise.Id))
            .Where(e => e.EventType == EasyLoginTelemetry.LinkRevokedEventType);
        revokeEvents.Should().ContainSingle("the no-op emits nothing");
    }

    [RequiresDockerFact]
    public async Task Disable_EndsSessions_AndBlocksTheLinkAndThePassword_EnableRestoresBoth_AndChangesNothingElse()
    {
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var account = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id, withPassword: true);
        var (seededLink, token) = await PersonalLinkSeed.LinkAsync(_fixture, account);
        var staff = await PersonalLinkSeed.StaffAsync(_fixture, exercise.Id);

        await using var host = await PersonalLinksTestHost.StartAsync(_fixture.ConnectionString!);
        using var staffClient = host.Client(exercise.Hostname, staff.RawToken);
        using var anonymous = host.Client(exercise.Hostname);
        var login = new { username = account.Username, password = PersonalLinkSeed.Password };

        (await PersonalLinksTestHost.JoinAsync(anonymous, token)).StatusCode.Should().Be(HttpStatusCode.OK);
        (await anonymous.PostAsJsonAsync("/api/auth/login", login)).StatusCode.Should().Be(HttpStatusCode.OK);

        using var disabled = await PersonalLinksTestHost.ActionAsync(staffClient, account.Id, "disable");
        disabled.StatusCode.Should().Be(HttpStatusCode.OK);
        var disabledBody = await PersonalLinksTestHost.JsonAsync(disabled);
        disabledBody.GetProperty("access").GetString().Should().Be("disabled");
        disabledBody.GetProperty("sessionsEnded").GetInt32().Should().Be(2, "the link session and the password session both end");
        disabledBody.GetProperty("link").GetProperty("status").GetString().Should().Be("active", "disable leaves the link alone");
        var disabledAt = (await PersonalLinkSeed.ReadAccountAsync(_fixture, exercise.Id, account.Id)).DisabledAt;
        disabledAt.Should().NotBeNull();

        using var joinRefused = await PersonalLinksTestHost.JoinAsync(anonymous, token);
        joinRefused.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "a disabled person's link is refused");
        (await joinRefused.Content.ReadAsByteArrayAsync()).Should().BeEmpty();

        using var passwordRefused = await anonymous.PostAsJsonAsync("/api/auth/login", login);
        passwordRefused.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "a disabled person's password is refused with its normal 401");
        using var wrongPassword = await anonymous.PostAsJsonAsync("/api/auth/login", new { username = account.Username, password = "WRONG-password" });
        (await passwordRefused.Content.ReadAsStringAsync()).Should().Be(
            await wrongPassword.Content.ReadAsStringAsync(), "the refusal is indistinguishable from a wrong password");

        var loginFailures = (await PersonalLinkSeed.ReadEventsAsync(_fixture, exercise.Id))
            .Where(e => e.EventType == "login" && e.Payload == "{\"outcome\":\"failure\"}")
            .ToList();
        loginFailures.Should().HaveCount(2, "the disabled refusal and the wrong password each emit one password-login failure");
        loginFailures.Select(e => (e.Actor.Kind, e.Target?.EntityType, e.Target?.EntityId)).Distinct().Should().ContainSingle(
            "the disabled refusal carries exactly the wrong-password telemetry");

        using var disabledAgain = await PersonalLinksTestHost.ActionAsync(staffClient, account.Id, "disable");
        disabledAgain.StatusCode.Should().Be(HttpStatusCode.OK, "disable is idempotent");
        (await PersonalLinksTestHost.JsonAsync(disabledAgain)).GetProperty("sessionsEnded").GetInt32().Should().Be(0);
        (await PersonalLinkSeed.ReadAccountAsync(_fixture, exercise.Id, account.Id)).DisabledAt.Should().Be(disabledAt, "the first instant is kept");

        using var enabled = await PersonalLinksTestHost.ActionAsync(staffClient, account.Id, "enable");
        enabled.StatusCode.Should().Be(HttpStatusCode.OK);
        var enabledBody = await PersonalLinksTestHost.JsonAsync(enabled);
        enabledBody.GetProperty("access").GetString().Should().Be("enabled");
        enabledBody.GetProperty("sessionsEnded").GetInt32().Should().Be(0);

        var afterEnable = await PersonalLinkSeed.ReadLinkAsync(_fixture, exercise.Id, account.Id);
        afterEnable!.TokenHash.Should().Be(seededLink.TokenHash, "enable changes nothing but DisabledAt");
        afterEnable.Generation.Should().Be(seededLink.Generation);
        afterEnable.RevokedAt.Should().BeNull();

        (await PersonalLinksTestHost.JoinAsync(anonymous, token)).StatusCode.Should().Be(HttpStatusCode.OK, "the same link works again");
        (await anonymous.PostAsJsonAsync("/api/auth/login", login)).StatusCode.Should().Be(HttpStatusCode.OK, "so does the password");

        using var enabledAgain = await PersonalLinksTestHost.ActionAsync(staffClient, account.Id, "enable");
        enabledAgain.StatusCode.Should().Be(HttpStatusCode.OK, "enable is idempotent");
        (await PersonalLinkSeed.ReadEventsAsync(_fixture, exercise.Id))
            .Count(e => e.EventType == EasyLoginTelemetry.ParticipantEnabledEventType).Should().Be(1, "the no-op enable emits nothing");
    }

    [RequiresDockerFact]
    public async Task StaffRoutes_AreGated_401WithoutAStaffSession_403ForAnEvaluator_AndAnotherExercisesStaffFindsNothing()
    {
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var other = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var account = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id);
        var evaluator = await PersonalLinkSeed.StaffAsync(_fixture, exercise.Id, role: "evaluator");
        var participantSession = await PersonalLinkSeed.ParticipantSessionAsync(_fixture, exercise.Id, account.Id);

        await using var host = await PersonalLinksTestHost.StartAsync(_fixture.ConnectionString!);

        // A controller whose session is bound to ANOTHER exercise and who is not assigned here.
        var elsewhere = await PersonalLinkSeed.StaffAsync(_fixture, other.Id);

        foreach (var action in new[] { "link/reissue", "link/revoke", "disable", "enable" })
        {
            using var anonymous = host.Client(exercise.Hostname);
            (await PersonalLinksTestHost.ActionAsync(anonymous, account.Id, action)).StatusCode.Should().Be(
                HttpStatusCode.Unauthorized, "{0} needs a session", action);

            using var participant = host.Client(exercise.Hostname, participantSession.RawToken);
            (await PersonalLinksTestHost.ActionAsync(participant, account.Id, action)).StatusCode.Should().Be(
                HttpStatusCode.Unauthorized, "{0}: a participant session is not a staff session", action);

            using var evaluatorClient = host.Client(exercise.Hostname, evaluator.RawToken);
            (await PersonalLinksTestHost.ActionAsync(evaluatorClient, account.Id, action)).StatusCode.Should().Be(
                HttpStatusCode.Forbidden, "{0}: evaluators observe; they do not hand out credentials (EL-13)", action);

            using var otherStaff = host.Client(exercise.Hostname, elsewhere.RawToken);
            (await PersonalLinksTestHost.ActionAsync(otherStaff, account.Id, action)).StatusCode.Should().Be(
                HttpStatusCode.NotFound, "{0}: a staff session is scoped to its own exercise, where this account does not exist", action);
        }

        (await PersonalLinkSeed.ReadSessionAsync(_fixture, participantSession.Id)).RevokedAt.Should().BeNull("nothing ran");
        (await PersonalLinkSeed.ReadAccountAsync(_fixture, exercise.Id, account.Id)).DisabledAt.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task StaffRoutes_AnUnknownOrMalformedId_Is404()
    {
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var staff = await PersonalLinkSeed.StaffAsync(_fixture, exercise.Id);

        await using var host = await PersonalLinksTestHost.StartAsync(_fixture.ConnectionString!);
        using var staffClient = host.Client(exercise.Hostname, staff.RawToken);

        using var unknown = await PersonalLinksTestHost.ActionAsync(staffClient, Guid.NewGuid(), "disable");
        unknown.StatusCode.Should().Be(HttpStatusCode.NotFound);
        unknown.Content.Headers.ContentType?.MediaType.Should().Be("application/problem+json");
        (await PersonalLinksTestHost.JsonAsync(unknown)).GetProperty("detail").GetString().Should().Be(ParticipantAccessEndpoints.NotFoundDetail);
        unknown.Headers.CacheControl!.NoStore.Should().BeTrue();

        using var malformed = await staffClient.PostAsync("/api/staff/roster/not-a-guid/disable", content: null);
        malformed.StatusCode.Should().Be(HttpStatusCode.NotFound, "{id:guid}: a malformed id is a 404 like an unknown one");
    }
}
