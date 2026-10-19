namespace Pulse.WebApi.Tests.Features.Identity.PersonalLinks;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.PersonalLinks;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// easy-login/03 (Telemetry AC, XC-004; secrets, gotcha 8) — every staff action emits exactly one valid v0 event
/// (<c>participant.link.reissued</c> / <c>.revoked</c>, <c>participant.disabled</c> / <c>.enabled</c>) with the staff role,
/// the acting human and the <c>sessionsEnded</c> count, in the SAME <c>SaveChanges</c> as its mutation; and a grep over
/// every emitted event, every log message and every response body of a full join / reissue / revoke / disable flow finds
/// no raw link token, join URL, session token or session id, except the staff <c>link.joinUrl</c> field itself.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PersonalLinkTelemetryTests
{
    private readonly MsSqlContainerFixture _fixture;

    public PersonalLinkTelemetryTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task EveryStaffAction_EmitsOneValidEvent_WithTheStaffRole_ActingHuman_AndSessionsEnded()
    {
        var scenario = new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5));
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture, scenarioTime: scenario);
        var account = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id);
        var (link, _) = await PersonalLinkSeed.LinkAsync(_fixture, account);
        var staff = await PersonalLinkSeed.StaffAsync(_fixture, exercise.Id, role: "planner");

        await using var host = await PersonalLinksTestHost.StartAsync(_fixture.ConnectionString!);
        using var staffClient = host.Client(exercise.Hostname, staff.RawToken);

        var expected = new List<(string Type, string EntityType, Guid EntityId, string Payload)>();

        await PersonalLinkSeed.ParticipantSessionAsync(_fixture, exercise.Id, account.Id);
        await Ok(PersonalLinksTestHost.ActionAsync(staffClient, account.Id, "link/reissue"));
        expected.Add(("participant.link.reissued", "participantLink", link.Id, $"{{\"accountId\":\"{account.Id}\",\"sessionsEnded\":1}}"));

        await PersonalLinkSeed.ParticipantSessionAsync(_fixture, exercise.Id, account.Id);
        await PersonalLinkSeed.ParticipantSessionAsync(_fixture, exercise.Id, account.Id);
        await Ok(PersonalLinksTestHost.ActionAsync(staffClient, account.Id, "link/revoke"));
        expected.Add(("participant.link.revoked", "participantLink", link.Id, $"{{\"accountId\":\"{account.Id}\",\"sessionsEnded\":2}}"));

        await PersonalLinkSeed.ParticipantSessionAsync(_fixture, exercise.Id, account.Id);
        await Ok(PersonalLinksTestHost.ActionAsync(staffClient, account.Id, "disable"));
        expected.Add(("participant.disabled", "account", account.Id, "{\"sessionsEnded\":1}"));

        await Ok(PersonalLinksTestHost.ActionAsync(staffClient, account.Id, "enable"));
        expected.Add(("participant.enabled", "account", account.Id, "{\"sessionsEnded\":0}"));

        // The idempotent repeats emit nothing.
        await Ok(PersonalLinksTestHost.ActionAsync(staffClient, account.Id, "link/revoke"));
        await Ok(PersonalLinksTestHost.ActionAsync(staffClient, account.Id, "enable"));

        var events = await PersonalLinkSeed.ReadEventsAsync(_fixture, exercise.Id);
        events.Select(e => (e.EventType, e.Target!.EntityType!, Guid.Parse(e.Target.EntityId!), e.Payload!)).Should().Equal(
            expected, "one event per action, in order; no event for a no-op");

        foreach (var evt in events)
        {
            evt.SchemaVersion.Should().Be("v0");
            evt.Channel.Should().Be("system");
            evt.Actor.Kind.Should().Be("system", "a staff action is a system actor carrying the staff role and human");
            evt.Actor.Role.Should().Be("planner");
            evt.Actor.ActingHumanId.Should().Be(staff.StaffUserId.ToString());
            evt.Actor.ParticipantId.Should().BeNull();
            evt.ScenarioTime.Should().Be(scenario);
            evt.TimeZone.Should().Be("America/Chicago");
            evt.EmittedAt.Should().Be(evt.WallClockTime);
            TelemetryEnvelopeRules.Validate(TelemetryAttributionFacts.FromEntity(evt)).Should().BeEmpty(evt.EventType);
        }
    }

    [RequiresDockerTheory]
    [InlineData("reissue")]
    [InlineData("revoke")]
    [InlineData("disable")]
    [InlineData("enable")]
    public async Task EveryStaffAction_CommitsItsMutationSessionsAndEvent_InOneSaveChanges(string action)
    {
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var account = await PersonalLinkSeed.AccountAsync(
            _fixture, exercise.Id, disabledAt: action == "enable" ? DateTimeOffset.UtcNow : null);
        await PersonalLinkSeed.LinkAsync(_fixture, account);
        var session = await PersonalLinkSeed.ParticipantSessionAsync(_fixture, exercise.Id, account.Id);
        var staff = await PersonalLinkSeed.StaffAsync(_fixture, exercise.Id);

        var interceptor = new SaveRecorder();
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(_fixture.ConnectionString)
            .AddInterceptors(interceptor)
            .Options;
        await using var context = new PulseDbContext(options, new ExerciseContext { CurrentExerciseId = exercise.Id });
        var protector = PersonalLinkSeed.Protector();
        var service = new ParticipantAccessService(
            context,
            new ExerciseContext { CurrentExerciseId = exercise.Id },
            new StubCurrentStaffSessionAccessor(staff.Current),
            PersonalLinkSeed.LinkService(context, exercise.Id, protector),
            new RosterLinkDtoFactory(protector, new JoinUrlBuilder(new Microsoft.Extensions.Configuration.ConfigurationBuilder().Build())),
            new ExerciseFactsReader(context),
            new ManualTimeProvider(DateTimeOffset.UtcNow),
            TestScenarioNow.Over(context));

        var result = action switch
        {
            "reissue" => await service.ReissueAsync(account.Id),
            "revoke" => await service.RevokeAsync(account.Id),
            "disable" => await service.DisableAsync(account.Id),
            _ => await service.EnableAsync(account.Id),
        };

        result.Outcome.Should().Be(ParticipantAccessOutcome.Ok);
        if (action == "disable")
        {
            // Gate-2 S-2: a first disable commits DisabledAt BEFORE it reads the sessions to end (so a racing sign-in
            // either re-reads after it or is swept), then the terminations and the one event commit together.
            interceptor.Saves.Should().HaveCount(2, "disable commits DisabledAt first, then its terminations and event");
            interceptor.Saves[0].Should().Equal(["Account"], "the first save is the disable alone");
            interceptor.Saves[1].Should().Equal(["Session", "TelemetryEvent"], "the terminations and the event commit together (XC-004)");
        }
        else
        {
            interceptor.Saves.Should().ContainSingle("{0}: mutation, session terminations and event commit together (XC-004)", action);
        }
        (await PersonalLinkSeed.ReadEventsAsync(_fixture, exercise.Id)).Should().ContainSingle();
        (await PersonalLinkSeed.ReadSessionAsync(_fixture, session.Id)).RevokedAt.HasValue.Should().Be(action != "enable");
    }

    [RequiresDockerFact]
    public async Task NoRawToken_JoinUrl_SessionToken_OrSessionId_AppearsInAnyEventLogOrResponseBody_ExceptTheStaffJoinUrl()
    {
        var exercise = await PersonalLinkSeed.ExerciseAsync(_fixture);
        var account = await PersonalLinkSeed.AccountAsync(_fixture, exercise.Id);
        var staff = await PersonalLinkSeed.StaffAsync(_fixture, exercise.Id);
        var bogus = ParticipantLinkTokens.Generate();

        await using var host = await PersonalLinksTestHost.StartAsync(_fixture.ConnectionString!);
        using var staffClient = host.Client(exercise.Hostname, staff.RawToken);
        using var anonymous = host.Client(exercise.Hostname);

        var staffBodies = new List<string>();
        var joinBodies = new List<string>();

        async Task<string> StaffAsync(string action)
        {
            using var response = await PersonalLinksTestHost.ActionAsync(staffClient, account.Id, action);
            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var body = await response.Content.ReadAsStringAsync();
            staffBodies.Add(body);
            return body;
        }

        async Task<string> JoinAsync(string token, HttpStatusCode expected)
        {
            using var response = await PersonalLinksTestHost.JoinAsync(anonymous, token);
            response.StatusCode.Should().Be(expected);
            var body = await response.Content.ReadAsStringAsync();
            joinBodies.Add(body);
            return body;
        }

        var joinUrl1 = JoinUrlOf(await StaffAsync("link/reissue"));
        var token1 = PersonalLinkSeed.TokenOf(joinUrl1);
        var envelope = JsonDocument.Parse(await JoinAsync(token1, HttpStatusCode.OK)).RootElement;
        var sessionToken = envelope.GetProperty("token").GetString()!;
        var refreshToken = envelope.GetProperty("refreshToken").GetString()!;
        await JoinAsync(bogus, HttpStatusCode.Unauthorized);

        var joinUrl2 = JoinUrlOf(await StaffAsync("link/reissue"));
        var token2 = PersonalLinkSeed.TokenOf(joinUrl2);
        await JoinAsync(token1, HttpStatusCode.Unauthorized);
        await StaffAsync("link/revoke");
        await JoinAsync(token2, HttpStatusCode.Unauthorized);
        await StaffAsync("disable");
        await StaffAsync("enable");

        await using var unfiltered = _fixture.CreateContext();
        var sessionIds = await unfiltered.Sessions.AsNoTracking()
            .Where(s => s.AccountId == account.Id)
            .Select(s => s.Id.ToString())
            .ToListAsync();
        sessionIds.Should().NotBeEmpty("precondition: the join minted a session");

        var linkSecrets = new[] { token1, token2, bogus, joinUrl1, joinUrl2 };
        var secrets = linkSecrets.Concat(new[] { sessionToken, refreshToken }).Concat(sessionIds).ToArray();

        var events = await PersonalLinkSeed.ReadEventsAsync(_fixture, exercise.Id);
        events.Should().NotBeEmpty();
        foreach (var evt in events)
        {
            var serialized = JsonSerializer.Serialize(evt);
            foreach (var secret in secrets)
            {
                serialized.Should().NotContain(secret, "telemetry never carries a token, join URL or session id ({0})", evt.EventType);
            }
        }

        var logs = host.Logs.Messages;
        logs.Should().NotBeEmpty("precondition: the host logged");
        foreach (var message in logs)
        {
            foreach (var secret in secrets)
            {
                message.Should().NotContain(secret, "no log message may carry a token, join URL or session id");
            }
        }

        foreach (var body in staffBodies)
        {
            var withoutJoinUrl = JsonNode.Parse(body)!.AsObject();
            withoutJoinUrl["link"]!.AsObject().Remove("joinUrl");
            foreach (var secret in secrets)
            {
                withoutJoinUrl.ToJsonString().Should().NotContain(secret, "only the staff joinUrl field carries the link");
            }
        }

        foreach (var body in joinBodies)
        {
            foreach (var secret in linkSecrets)
            {
                body.Should().NotContain(secret, "a join response never echoes the link token");
            }
        }
    }

    private static async Task Ok(Task<HttpResponseMessage> request)
    {
        using var response = await request;
        response.StatusCode.Should().Be(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
    }

    private static string JoinUrlOf(string staffBody) =>
        JsonDocument.Parse(staffBody).RootElement.GetProperty("link").GetProperty("joinUrl").GetString()!;

    /// <summary>Records, per <c>SaveChanges</c>, the (non-owned) entity types it writes, sorted by name.</summary>
    private sealed class SaveRecorder : SaveChangesInterceptor
    {
        public List<string[]> Saves { get; } = [];

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            Saves.Add(eventData.Context!.ChangeTracker.Entries()
                .Where(entry => (entry.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
                    && !entry.Metadata.IsOwned())
                .Select(entry => entry.Metadata.ClrType.Name)
                .Distinct()
                .OrderBy(name => name, StringComparer.Ordinal)
                .ToArray());
            return base.SavingChangesAsync(eventData, result, cancellationToken);
        }
    }
}
