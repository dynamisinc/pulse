namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// Integration tests for <c>POST /api/posts</c> (story <c>social-api/02-post-write-api</c>, #271; extended by
/// <c>identity-auth-roles/12</c>, #366 — server-derived attribution). Boots the real host via
/// <see cref="WebApplicationFactory{TEntryPoint}"/> against the shared, migrated real SQL Server
/// (<see cref="MsSqlContainerFixture"/>), with a separate <see cref="Pulse.WebApi.Data.PulseDbContext"/> for DB
/// assertions so nothing is proven by an in-memory change tracker alone.
/// </summary>
/// <remarks>
/// <para>
/// <b>Real sessions, real tokens — the harness change story 12 forced.</b> This suite used to fake the request's
/// identity twice over: a DI-swapped <see cref="Pulse.WebApi.Data.IExerciseContext"/> for the scope and a
/// principal-only shim (<c>UseFakeAuthenticatedSession</c>) for the credential, then sent
/// <c>authorPersonaId</c>/<c>origin</c>/<c>actingHumanId</c> in the body. That is exactly the arrangement
/// #366 removes: attribution now resolves from the PRESENTED TOKEN, so a shim that stamps a principal without a
/// persisted session proves nothing (and correctly 403s). Every test therefore seeds a real
/// <see cref="Exercise"/> with a provisioned <c>Hostname</c>, real <see cref="Persona"/> rows and real
/// <see cref="Session"/> rows, and addresses the host so the genuine pipeline runs end to end:
/// host→exercise resolution, session authentication, the default-deny gate (story 11), the read-only write
/// filter, then the endpoint. Only <see cref="IFeedBroadcaster"/> is still faked — the SignalR hub is not what
/// this suite asserts.
/// </para>
/// <para>
/// Every test is <see cref="RequiresDockerFactAttribute"/> (Gate-1 W-001): a real <c>Skipped</c> without a SQL
/// target, never a silent <c>Passed</c>.
/// </para>
/// </remarks>
[Collection(MsSqlCollection.Name)]
public class PostWriteEndpointTests
{
    private static readonly Uri PostsUri = new("/api/posts", UriKind.Relative);

    private readonly MsSqlContainerFixture _fixture;

    public PostWriteEndpointTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // ---------------------------------------------------------------------------------------------
    // Server-side stamping: scope, wall clock, sanitization (social-api/02) — unchanged guarantees,
    // now asserted through a real session.
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task HappyPath_ParticipantOrigin_Returns201_AndStampsServerScope_EvenWithDifferentBodyExerciseId()
    {
        var world = await SeedWorldAsync();
        var foreignExerciseId = Guid.NewGuid();

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        var before = DateTimeOffset.UtcNow;

        var body = ValidRequestBody(world.ParticipantPersona, "participant", text: "Hello exercise");
        // A manipulated/naive client attempts to inject its own exerciseId and a stale createdWallClock.
        // CreatePostRequest binds neither field, so both are structurally ignored — the server's
        // resolved scope and its own clock reading win unconditionally.
        body["exerciseId"] = foreignExerciseId.ToString();
        body["createdWallClock"] = "2000-01-01T00:00:00Z";

        var response = await client.PostAsync(PostsUri, JsonContent(body));
        var after = DateTimeOffset.UtcNow;

        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var postId = await ReadPostIdAsync(response);

        await using var readContext = _fixture.CreateContext();
        var stored = await readContext.Posts.IgnoreQueryFilters().SingleAsync(p => p.Id == postId);

        stored.ExerciseId.Should().Be(world.Exercise, "the server's resolved scope must win, never a client-supplied exerciseId");
        stored.ExerciseId.Should().NotBe(foreignExerciseId);
        stored.Body.Should().Be("Hello exercise");
        stored.CreatedWallClock.Should().BeOnOrAfter(before.AddSeconds(-1))
            .And.BeOnOrBefore(after.AddSeconds(1), "createdWallClock must be the server's own clock, never client input");
        stored.Origin.Should().Be("participant");
    }

    [RequiresDockerFact]
    public async Task ContentSecurity_ScriptAndImgOnErrorPayload_IsSanitizedOnIngest_StoredBodyHasNoExecutableMarkup()
    {
        // NFR-004 stored-XSS, end to end: post a classic payload, then read the PERSISTED row back
        // through a separate PulseDbContext (not the response) — the standing stored-XSS suite
        // (exercise-isolation/07, COR-007/NFR-004) this AC is added to.
        var world = await SeedWorldAsync();

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        const string payload = "<script>alert(document.cookie)</script>Shelter in place <img src=x onerror=alert(2)> now.";
        var body = ValidRequestBody(world.ParticipantPersona, "participant", text: payload);

        var response = await client.PostAsync(PostsUri, JsonContent(body));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var postId = await ReadPostIdAsync(response);

        await using var readContext = _fixture.CreateContext();
        var stored = await readContext.Posts.IgnoreQueryFilters().SingleAsync(p => p.Id == postId);

        stored.Body.Should().NotContain("<script", "a stored script must never be able to execute in another session");
        stored.Body.Should().NotContain("onerror");
        stored.Body.Should().NotContain("<img");
        stored.Body.Should().NotContain("<").And.NotContain(">");
        stored.Body.Should().Contain("Shelter in place").And.Contain("now.", "the author's literal text survives sanitization");
    }

    [RequiresDockerFact]
    public async Task ParticipantPost_LandsOnlyInItsOwnExercise_AndIsInvisibleToAnother()
    {
        // The always-Critical read-back (COR-001/XC-001): a participant write in exercise A is invisible under
        // exercise B's scope, and IgnoreQueryFilters proves the zero is the filter closing the door rather than
        // a write that never happened.
        var worldA = await SeedWorldAsync();
        var worldB = await SeedWorldAsync();

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(worldA.Host, worldA.ParticipantToken);

        var response = await client.PostAsync(
            PostsUri, JsonContent(ValidRequestBody(worldA.ParticipantPersona, "participant", text: "A-ONLY-POST")));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var postId = await ReadPostIdAsync(response);

        await using var scopedToB = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = worldB.Exercise });
        (await scopedToB.Posts.CountAsync(p => p.Id == postId)).Should().Be(
            0, "a post written in exercise A must never be visible under exercise B's scope (COR-001)");

        await using var unfiltered = _fixture.CreateContext();
        (await unfiltered.Posts.IgnoreQueryFilters().SingleAsync(p => p.Id == postId)).ExerciseId
            .Should().Be(worldA.Exercise, "the row really exists in A — so B's zero is the filter, not an empty table");
    }

    // ---------------------------------------------------------------------------------------------
    // identity-auth-roles/12 AC1 — a participant posts only as its own bound persona (COR-018)
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task ParticipantSession_PostsAsItsOwnSessionPersona_IgnoringADivergentBodyPersonaAndActingHuman()
    {
        // The body names ANOTHER persona (a real one, in the same exercise, so only the identity logic can keep
        // it out) and a self-reported actingHumanId. Both are ignored: the author is the session's binding and
        // the acting human is the session's identity.
        var world = await SeedWorldAsync();

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        var body = ValidRequestBody(
            world.OtherPersona, "participant", actingHumanId: "i-am-whoever-i-say-i-am", text: "Posting as myself");

        var response = await client.PostAsync(PostsUri, JsonContent(body));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var postId = await ReadPostIdAsync(response);

        await using var readContext = _fixture.CreateContext();
        var stored = await readContext.Posts.IgnoreQueryFilters().SingleAsync(p => p.Id == postId);

        stored.AuthorPersonaId.Should().Be(
            world.ParticipantPersona,
            "the author is the SESSION's bound persona — a body-supplied authorPersonaId is ignored, not honored");
        stored.AuthorPersonaId.Should().NotBe(world.OtherPersona);
        stored.Origin.Should().Be("participant", "a non-staff session's origin is forced server-side");
        stored.ActingHumanId.Should().Be(
            world.ParticipantActingHumanId,
            "actingHumanId comes from the persisted session (COR-018), never from the body");
        stored.ActingHumanId.Should().NotBe("i-am-whoever-i-say-i-am");
        stored.ActingHumanId.Should().NotBeEmpty(
            "PostIngestService's old `request.ActingHumanId ?? string.Empty` is exactly the bug this AC removes");
    }

    [RequiresDockerFact]
    public async Task ParticipantSession_OmittingOriginEntirely_StillPostsAsParticipant()
    {
        // An ABSENT origin is not a claim, so it is not a refusal: the server simply derives 'participant'.
        var world = await SeedWorldAsync();

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        var body = ValidRequestBody(world.ParticipantPersona, origin: null);

        var response = await client.PostAsync(PostsUri, JsonContent(body));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var postId = await ReadPostIdAsync(response);

        await using var readContext = _fixture.CreateContext();
        (await readContext.Posts.IgnoreQueryFilters().SingleAsync(p => p.Id == postId)).Origin
            .Should().Be("participant");
    }

    // ---------------------------------------------------------------------------------------------
    // identity-auth-roles/12 AC3 — a privileged origin is unreachable from a non-staff session
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task ParticipantSession_ClaimingAPrivilegedOrigin_Returns403_AndPersistsNothing()
    {
        // ENDPOINT-AUTH-AUDIT.md exploit 1's second half: the audited request injected a post dressed up as
        // engine-generated content. A non-staff session can no longer reach ANY privileged origin — and the
        // claim is REFUSED rather than silently downgraded, so the attempt cannot succeed as an ordinary post.
        //
        // Written as a loop over a fresh world per case rather than a [Theory]: one host boot instead of three,
        // and the because-reason names the origin, so a failure still says which case broke.
        await using var factory = CreateFactory();

        foreach (var origin in new[] { "controller-as-persona", "engine", "inject" })
        {
            var world = await SeedWorldAsync();
            using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

            var body = ValidRequestBody(world.ParticipantPersona, origin, actingHumanId: "spoofed", injectId: "INJ-001");

            var response = await client.PostAsync(PostsUri, JsonContent(body));

            response.StatusCode.Should().Be(
                HttpStatusCode.Forbidden,
                "origin '{0}' must be unreachable from a non-staff session (COR-018)",
                origin);
            (await CountPostsInAsync(world.Exercise)).Should().Be(
                0, "a refused '{0}' write persists nothing", origin);
        }

        factory.Broadcaster.Calls.Should().BeEmpty("a rejected request must never reach the broadcast fan-out");
    }

    // ---------------------------------------------------------------------------------------------
    // identity-auth-roles/12 AC2 — a staff session is attributed to the operator, not the body
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task StaffSession_ControllerAsPersona_AttributesTheStaffIdentity_AndKeepsTheBodyPersonaChoice()
    {
        var world = await SeedWorldAsync();
        const string clientSuppliedActingHumanId = "controller-operating-shared-account";

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.StaffToken);

        // The console picks WHICH persona to operate (body-supplied, by design) and sends whatever identity
        // string it happens to hold (ignored).
        var body = ValidRequestBody(world.OtherPersona, "controller-as-persona", actingHumanId: clientSuppliedActingHumanId);

        var response = await client.PostAsync(PostsUri, JsonContent(body));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var json = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(json);

        // Role-conditional exception to XC-002 (this feature's one deliberate carve-out): the controller
        // console's originConsoleLabel(lastPublished) reads these off its OWN write. Sound now that origin is
        // server-derived — a participant can no longer reach this shape by claiming a staff origin.
        document.RootElement.TryGetProperty("origin", out var originProp).Should().BeTrue(
            "a staff/controller caller's own write response must carry origin (PersonaComposer.tsx:150-157)");
        originProp.GetString().Should().Be("controller-as-persona");

        document.RootElement.TryGetProperty("actingHumanId", out var actingHumanIdProp).Should().BeTrue();
        actingHumanIdProp.GetString().Should().Be(
            world.StaffUserId.ToString(),
            "the response echoes the SERVER's attribution — the operating staff user — not the client's string");
        actingHumanIdProp.GetString().Should().NotBe(clientSuppliedActingHumanId);

        var postId = await ReadPostIdAsync(response);

        await using var readContext = _fixture.CreateContext();
        var stored = await readContext.Posts.IgnoreQueryFilters().SingleAsync(p => p.Id == postId);

        stored.ActingHumanId.Should().Be(
            world.StaffUserId.ToString(),
            "COR-018: the operating controller behind the shared persona is attributed from the STAFF SESSION, "
            + "never as free client-supplied text");
        stored.ActingHumanId.Should().NotBe(
            clientSuppliedActingHumanId, "the body value must not be what landed — that is the whole point of #366");
        stored.AuthorPersonaId.Should().Be(
            world.OtherPersona, "the persona CHOICE stays body-supplied: what must be proven is the caller's staff-ness");
    }

    [RequiresDockerFact]
    public async Task StaffSession_WithNoActingHumanIdInTheBody_StillAttributesTheStaffIdentity()
    {
        // DELIBERATE CHANGE OF EXPECTATION (identity-auth-roles/12). This case previously asserted 400: with the
        // body as the only source of actingHumanId, refusing a controller-as-persona post that omitted it was
        // the only way to honour COR-018. The server now derives the value from the staff session, so rejecting
        // the request would refuse a write whose attribution is already known — and COR-018 ends up STRONGER,
        // because the field can no longer be omitted at all. PostIngestService's "required when
        // controller-as-persona" guard is retained for in-process callers and is covered directly by
        // PostIngestServiceAttributionTests.
        var world = await SeedWorldAsync();

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.StaffToken);

        var body = ValidRequestBody(world.OtherPersona, "controller-as-persona", actingHumanId: null);

        var response = await client.PostAsync(PostsUri, JsonContent(body));

        response.StatusCode.Should().Be(
            HttpStatusCode.Created, "the client no longer supplies the acting human, so it cannot omit it either");

        var postId = await ReadPostIdAsync(response);

        await using var readContext = _fixture.CreateContext();
        (await readContext.Posts.IgnoreQueryFilters().SingleAsync(p => p.Id == postId)).ActingHumanId
            .Should().Be(world.StaffUserId.ToString(), "COR-018 attribution is server-derived, so it is never blank");
    }

    [RequiresDockerFact]
    public async Task StaffSession_ClaimingANonControllerOrigin_Returns400_AndPersistsNothing()
    {
        // 'engine' and 'inject' are in-process-only provenances — the engine reaches PostIngestService directly
        // and MSEL inject-fire is Phase 4 — so no HTTP caller can hold either. 'participant' is refused for the
        // mirror-image reason: a staff console is not a participant, and self-reporting as one would make an
        // operator's write indistinguishable from a trainee's in the evaluation record.
        await using var factory = CreateFactory();

        foreach (var origin in new[] { "engine", "inject", "participant" })
        {
            var world = await SeedWorldAsync();
            using var client = factory.CreateClientFor(world.Host, world.StaffToken);

            var body = ValidRequestBody(world.OtherPersona, origin, actingHumanId: "staff-1", injectId: "INJ-002");

            var response = await client.PostAsync(PostsUri, JsonContent(body));

            response.StatusCode.Should().Be(
                HttpStatusCode.BadRequest,
                "a staff session may only post with origin 'controller-as-persona', never '{0}'",
                origin);
            (await CountPostsInAsync(world.Exercise)).Should().Be(
                0, "a refused '{0}' write persists nothing", origin);
        }

        factory.Broadcaster.Calls.Should().BeEmpty();
    }

    // ---------------------------------------------------------------------------------------------
    // identity-auth-roles/12 cross-cutting — isolation (COR-001) and the fail-closed identity doors
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task StaffSession_NamingAnotherExercisesPersona_IsRejected_AndPersistsNothing()
    {
        // Defense in depth over the session's own scope (COR-001): the console's persona CHOICE is the one
        // client-supplied identity field left, so it is resolved through an explicit in-exercise predicate. A
        // persona belonging to another exercise is indistinguishable from one that does not exist.
        var worldA = await SeedWorldAsync();
        var worldB = await SeedWorldAsync();

        // Positively assert the target really exists in B, so the rejection cannot be a false pass against an
        // id that was simply never seeded.
        await using (var verify = _fixture.CreateContext())
        {
            var target = await verify.Personas.IgnoreQueryFilters().SingleOrDefaultAsync(p => p.Id == worldB.OtherPersona);
            target.Should().NotBeNull("exercise B's persona must exist for this test to mean anything");
            target!.ExerciseId.Should().Be(worldB.Exercise);
        }

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(worldA.Host, worldA.StaffToken);

        var body = ValidRequestBody(worldB.OtherPersona, "controller-as-persona", text: "CROSS-EXERCISE-ATTEMPT");

        var response = await client.PostAsync(PostsUri, JsonContent(body));

        response.StatusCode.Should().Be(
            HttpStatusCode.BadRequest,
            "an authorPersonaId naming ANOTHER exercise's persona is refused — the scoped lookup cannot see it, "
            + "so it is indistinguishable from an unknown id (COR-001)");

        await using var check = _fixture.CreateContext();
        (await check.Posts.IgnoreQueryFilters().CountAsync(p => p.AuthorPersonaId == worldB.OtherPersona)).Should().Be(
            0, "asserted with IgnoreQueryFilters so a scoped read cannot hide a row that was actually written");
        (await CountPostsInAsync(worldA.Exercise)).Should().Be(0);
        (await CountPostsInAsync(worldB.Exercise)).Should().Be(0, "and certainly nothing lands in the TARGET exercise");
    }

    [RequiresDockerFact]
    public async Task LiveSessionWithNoPersonaBinding_AndNotStaff_Returns403_AndPersistsNothing()
    {
        // The caller is authenticated (story 11's gate let it through) but there is nobody to post AS. 403, the
        // same shape and reasoning as FollowService's NoSessionPersona — fail closed rather than guess an
        // identity. An ANONYMOUS caller never reaches here (the gate answers 401), and a READ-ONLY session is
        // refused upstream by ReadOnlySessionWriteFilter; both are covered by their own suites.
        var world = await SeedWorldAsync();
        var unboundToken = $"unbound-{Guid.NewGuid():N}";

        await using (var seed = _fixture.CreateContext())
        {
            seed.Sessions.Add(TestSessions.NewSession(unboundToken, world.Exercise, personaId: null));
            await seed.SaveChangesAsync();
        }

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, unboundToken);

        var response = await client.PostAsync(
            PostsUri, JsonContent(ValidRequestBody(world.ParticipantPersona, "participant")));

        response.StatusCode.Should().Be(
            HttpStatusCode.Forbidden, "a session with no persona binding has nobody to post as");
        (await CountPostsInAsync(world.Exercise)).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task SessionWithNoActingHumanAttribution_Returns403_AndPersistsNothing()
    {
        // COR-018: a blank attribution is not an acceptable outcome. Storing "" is precisely the bug #366
        // removes, so a session that cannot say WHO is behind it may not write at all.
        var world = await SeedWorldAsync();
        var blankToken = $"blank-human-{Guid.NewGuid():N}";

        await using (var seed = _fixture.CreateContext())
        {
            var session = TestSessions.NewSession(blankToken, world.Exercise, world.ParticipantPersona);
            session.ActingHumanId = string.Empty;
            seed.Sessions.Add(session);
            await seed.SaveChangesAsync();
        }

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, blankToken);

        var response = await client.PostAsync(
            PostsUri, JsonContent(ValidRequestBody(world.ParticipantPersona, "participant")));

        response.StatusCode.Should().Be(
            HttpStatusCode.Forbidden,
            "a session carrying no acting-human attribution must not write — an empty actingHumanId satisfies no "
            + "evaluator and is off the locked v0 telemetry envelope (COR-018)");
        (await CountPostsInAsync(world.Exercise)).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task UnresolvedExerciseScope_FailsClosed_Returns401_AndNeverPersistsOrBroadcasts()
    {
        // The fail-closed door, reached through the REAL pipeline instead of a DI-stubbed scope: a STAFF session
        // is not host-bound, so its own bound exercise becomes the request scope — and a session bound to
        // Guid.Empty (the fail-closed sentinel no persisted row can carry) leaves the scope unresolved.
        var world = await SeedWorldAsync();
        var emptyScopeToken = $"empty-scope-{Guid.NewGuid():N}";

        await using (var seed = _fixture.CreateContext())
        {
            var session = TestSessions.NewSession(emptyScopeToken, Guid.Empty, personaId: null, kind: "staff");
            session.StaffUserId = Guid.NewGuid();
            seed.Sessions.Add(session);
            await seed.SaveChangesAsync();
        }

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, emptyScopeToken);

        var response = await client.PostAsync(
            PostsUri, JsonContent(ValidRequestBody(world.OtherPersona, "controller-as-persona", actingHumanId: "staff-x")));

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized, "an unresolved exercise scope fails closed with 401 (COR-001)");
        factory.Broadcaster.Calls.Should().BeEmpty();
        (await CountPostsInAsync(world.Exercise)).Should().Be(0);
    }

    // ---------------------------------------------------------------------------------------------
    // XC-004 telemetry — one event per post, attributed from the SAME source as the row
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task SuccessfulIngest_EmitsExactlyOneTelemetryEvent_MatchingV0Envelope()
    {
        var world = await SeedWorldAsync();
        const string clientSuppliedActingHumanId = "controller-42";

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.StaffToken);

        var body = ValidRequestBody(
            world.OtherPersona, "controller-as-persona", actingHumanId: clientSuppliedActingHumanId);

        var response = await client.PostAsync(PostsUri, JsonContent(body));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var postId = await ReadPostIdAsync(response);

        await using var readContext = _fixture.CreateContext();
        var events = await readContext.TelemetryEvents.IgnoreQueryFilters()
            .Where(e => e.Target != null && e.Target.EntityId == postId.ToString())
            .ToListAsync();

        events.Should().ContainSingle("exactly one 'post' telemetry event must be emitted per successful post, never zero or double-counted");

        var telemetryEvent = events[0];
        telemetryEvent.ExerciseId.Should().Be(world.Exercise);
        telemetryEvent.EventType.Should().Be("post");
        telemetryEvent.Channel.Should().Be("social");
        telemetryEvent.Actor.Kind.Should().Be("persona");
        telemetryEvent.Actor.PersonaId.Should().Be(world.OtherPersona.ToString());
        telemetryEvent.Actor.ActingHumanId.Should().Be(
            world.StaffUserId.ToString(),
            "the event's acting human is the SERVER-derived staff identity, not the body's string");
        telemetryEvent.Actor.ActingHumanId.Should().NotBe(clientSuppliedActingHumanId);
        telemetryEvent.Origin.Should().Be("controller-as-persona");
        telemetryEvent.Target.Should().NotBeNull();
        telemetryEvent.Target!.EntityType.Should().Be("post");
        telemetryEvent.Target.EntityId.Should().Be(postId.ToString());
    }

    [RequiresDockerFact]
    public async Task PersistedActingHumanId_AndTheTelemetryActors_Agree_ForBothParticipantAndStaff()
    {
        // AC "one source of truth, not two independently-trusted paths": Post.ActingHumanId and the post event's
        // actor.actingHumanId are projected from the SAME server-derived value, so they cannot drift.
        //
        // DELIBERATE CHANGE OF EXPECTATION: this replaces the older
        // "ActingHumanId is NULL for participant, non-null for controller-as-persona" test. A participant post
        // used to null-omit the actor's acting human because the body simply omitted the field — which was the
        // COR-018 hole, not a rule. Both kinds now carry a real human. The v0 envelope's null-omission rule for
        // an EMPTY acting human still holds and still has a real caller (an engine post, whose attribution has
        // no human by definition); it is asserted where that caller lives, in EnginePublishServiceTests.
        var world = await SeedWorldAsync();

        await using var factory = CreateFactory();

        Guid participantPostId;
        using (var participantClient = factory.CreateClientFor(world.Host, world.ParticipantToken))
        {
            var response = await participantClient.PostAsync(
                PostsUri, JsonContent(ValidRequestBody(world.ParticipantPersona, "participant")));
            response.StatusCode.Should().Be(HttpStatusCode.Created);
            participantPostId = await ReadPostIdAsync(response);
        }

        Guid staffPostId;
        using (var staffClient = factory.CreateClientFor(world.Host, world.StaffToken))
        {
            var response = await staffClient.PostAsync(
                PostsUri, JsonContent(ValidRequestBody(world.OtherPersona, "controller-as-persona")));
            response.StatusCode.Should().Be(HttpStatusCode.Created);
            staffPostId = await ReadPostIdAsync(response);
        }

        await using var readContext = _fixture.CreateContext();

        foreach (var (postId, expected, kind) in new[]
        {
            (participantPostId, world.ParticipantActingHumanId, "participant"),
            (staffPostId, world.StaffUserId.ToString(), "staff"),
        })
        {
            var stored = await readContext.Posts.IgnoreQueryFilters().SingleAsync(p => p.Id == postId);
            var telemetryEvent = await readContext.TelemetryEvents.IgnoreQueryFilters()
                .SingleAsync(e => e.Target != null && e.Target.EntityId == postId.ToString());

            stored.ActingHumanId.Should().Be(expected, "the {0} post's stored attribution is session-derived", kind);
            telemetryEvent.Actor.ActingHumanId.Should().Be(
                stored.ActingHumanId,
                "the {0} post's event and row must carry the SAME acting human — one source of truth", kind);
            telemetryEvent.Actor.ActingHumanId.Should().NotBeNullOrEmpty();
        }
    }

    // ---------------------------------------------------------------------------------------------
    // XC-002 projection + the real-time fan-out seam (social-api/02, unchanged)
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Participant_ResponseCarriesNoProvenanceKeys_AtTheWireLevel()
    {
        var world = await SeedWorldAsync();

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        var response = await client.PostAsync(
            PostsUri, JsonContent(ValidRequestBody(world.ParticipantPersona, "participant")));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        // XC-002 at the WIRE level: parse the raw JSON and assert the provenance keys are ABSENT —
        // not merely unread by a strongly-typed client — identical to 01's read-path guarantee.
        var json = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(json);

        document.RootElement.TryGetProperty("origin", out _).Should().BeFalse("a participant response must never carry origin");
        document.RootElement.TryGetProperty("actingHumanId", out _).Should().BeFalse("a participant response must never carry actingHumanId");
        document.RootElement.TryGetProperty("createdWallClock", out _).Should().BeFalse("a participant response must never carry createdWallClock");
        document.RootElement.TryGetProperty("injectId", out _).Should().BeFalse("a participant response must never carry injectId");
    }

    [RequiresDockerFact]
    public async Task Broadcaster_IsInvokedExactlyOnce_WithTheParticipantSafePayload()
    {
        var world = await SeedWorldAsync();

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.StaffToken);

        var body = ValidRequestBody(
            world.OtherPersona, "controller-as-persona", actingHumanId: "controller-1", text: "Broadcast me");

        var response = await client.PostAsync(PostsUri, JsonContent(body));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var postId = await ReadPostIdAsync(response);

        factory.Broadcaster.Calls.Should().ContainSingle("the real-time fan-out must be called exactly once per persisted post");
        var call = factory.Broadcaster.Calls[0];
        call.ExerciseId.Should().Be(world.Exercise);
        call.Post.Id.Should().Be(postId.ToString());
        call.Post.AuthorPersonaId.Should().Be(world.OtherPersona.ToString());
        call.Post.Text.Should().Be("Broadcast me");

        // ParticipantPostDto is the frozen participant-safe shape — it structurally has no origin/
        // actingHumanId/createdWallClock/injectId property, so the broadcast payload cannot carry
        // provenance even for a controller-as-persona-origin post (XC-002 is unconditional on this seam).
        var broadcastJson = JsonSerializer.Serialize(call.Post);
        using var document = JsonDocument.Parse(broadcastJson);
        document.RootElement.TryGetProperty("origin", out _).Should().BeFalse();
        document.RootElement.TryGetProperty("actingHumanId", out _).Should().BeFalse();
    }

    // ---------------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------------

    private PostWriteWebApplicationFactory CreateFactory()
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");
        return new PostWriteWebApplicationFactory(_fixture.ConnectionString!);
    }

    private async Task<int> CountPostsInAsync(Guid exerciseId)
    {
        await using var context = _fixture.CreateContext();
        return await context.Posts.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == exerciseId);
    }

    private static async Task<Guid> ReadPostIdAsync(HttpResponseMessage response)
    {
        var json = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(json);
        return Guid.Parse(document.RootElement.GetProperty("id").GetString()!);
    }

    private static StringContent JsonContent(object body)
        => new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    private static Dictionary<string, object?> ValidRequestBody(
        Guid authorPersonaId,
        string? origin,
        string? actingHumanId = null,
        string? injectId = null,
        string text = "Hello exercise") => new()
    {
        ["authorPersonaId"] = authorPersonaId.ToString(),
        ["actingHumanId"] = actingHumanId,
        ["text"] = text,
        ["scenarioTime"] = "2033-06-14T09:00:00-05:00",
        ["timeZone"] = "America/Chicago",
        ["origin"] = origin,
        ["injectId"] = injectId,
    };

    /// <summary>
    /// Seeds one self-contained exercise: a provisioned host, two exercise-scoped personas, a LIVE participant
    /// session bound to the first, and a LIVE staff session bound to a staff user. Everything the attribution
    /// path reads is real persisted state — nothing is stubbed.
    /// </summary>
    private async Task<SeededWorld> SeedWorldAsync()
    {
        var exerciseId = Guid.NewGuid();
        var participantPersona = Guid.NewGuid();
        var participantToken = $"participant-{Guid.NewGuid():N}";
        var staffToken = $"staff-{Guid.NewGuid():N}";
        var staffUserId = Guid.NewGuid();

        var participantSession = TestSessions.NewSession(participantToken, exerciseId, participantPersona);

        // A staff session carries NO persona binding (its operator picks one per write) and is not host-bound.
        var staffSession = TestSessions.NewSession(staffToken, exerciseId, personaId: null, kind: "staff");
        staffSession.StaffUserId = staffUserId;

        var world = new SeededWorld
        {
            Exercise = exerciseId,
            Host = $"postwrite-{exerciseId:N}.example.com",
            ParticipantPersona = participantPersona,
            OtherPersona = Guid.NewGuid(),
            ParticipantToken = participantToken,
            ParticipantActingHumanId = participantSession.ActingHumanId,
            StaffToken = staffToken,
            StaffUserId = staffUserId,
        };

        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = exerciseId,
            Name = $"Exercise {exerciseId:N}",
            Hostname = world.Host,
            TimeZone = "America/Chicago",

            // 'active' canonicalizes to 'live' — a participant-accessible lifecycle state, so
            // ExerciseLifecycleGatingMiddleware serves the participant write rather than refusing it (COR-032).
            Status = "active",
        });
        seed.Personas.Add(NewPersona(world.ParticipantPersona, exerciseId));
        seed.Personas.Add(NewPersona(world.OtherPersona, exerciseId));
        seed.Sessions.Add(participantSession);
        seed.Sessions.Add(staffSession);
        await seed.SaveChangesAsync();

        return world;
    }

    private static Persona NewPersona(Guid id, Guid exerciseId) => new()
    {
        Id = id,
        ExerciseId = exerciseId,
        DisplayName = $"Persona {id:N}",
        Handle = $"p_{id:N}",
        Kind = "human",
        Verified = false,
    };

    /// <summary>One seeded exercise world — its host, personas, and the two live sessions its tests present.</summary>
    private sealed class SeededWorld
    {
        public required Guid Exercise { get; init; }

        public required string Host { get; init; }

        /// <summary>The persona the PARTICIPANT session is bound to — the only author a participant can post as.</summary>
        public required Guid ParticipantPersona { get; init; }

        /// <summary>
        /// A second, real, in-exercise persona: the staff console's legitimate persona CHOICE, and the divergent
        /// value a participant's body names to prove it is ignored.
        /// </summary>
        public required Guid OtherPersona { get; init; }

        public required string ParticipantToken { get; init; }

        /// <summary>The participant session's persisted <c>ActingHumanId</c> (COR-018) — what must land on the row.</summary>
        public required string ParticipantActingHumanId { get; init; }

        public required string StaffToken { get; init; }

        /// <summary>The staff session's <c>StaffUserId</c> — the attribution a controller-as-persona write must carry.</summary>
        public required Guid StaffUserId { get; init; }
    }
}

/// <summary>
/// Captures every <see cref="IFeedBroadcaster.BroadcastPostAsync"/> call so tests can assert the
/// real-time fan-out seam (03's contract) is invoked exactly once, with a participant-safe payload,
/// without a real SignalR host (03 owns that implementation; this story only calls the interface).
/// </summary>
public sealed class FakeFeedBroadcaster : IFeedBroadcaster
{
    public List<(Guid ExerciseId, ParticipantPostDto Post)> Calls { get; } = new();

    public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default)
    {
        Calls.Add((exerciseId, post));
        return Task.CompletedTask;
    }
}

/// <summary>
/// Boots the real <c>Program</c> host against the shared migrated database (env-var-fed connection string,
/// exactly as <c>TelemetryWebApplicationFactory</c> does) and overrides NOTHING about identity: no
/// <c>IExerciseContext</c> stub and no principal shim, so every request travels the genuine pipeline —
/// host→exercise resolution, session authentication, the default-deny gate, the read-only write filter, then the
/// endpoint. That is required, not merely tidy: <c>identity-auth-roles/12</c> resolves the post's attribution
/// from the PRESENTED TOKEN, so a faked scope or a principal-only shim would prove nothing about it (and a
/// mismatched host would fail the participant host-binding check for real reasons of its own).
/// </summary>
/// <remarks>
/// The only test double is <see cref="FakeFeedBroadcaster"/>, swapped in <c>ConfigureTestServices</c> (which
/// runs last and reliably wins over <c>Program.cs</c>'s real <c>SignalRFeedBroadcaster</c>) so the fan-out seam
/// is assertable without a live SignalR hub.
/// </remarks>
public sealed class PostWriteWebApplicationFactory : WebApplicationFactory<Program>
{
    private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

    public FakeFeedBroadcaster Broadcaster { get; } = new();

    public PostWriteWebApplicationFactory(string connectionString)
    {
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);
    }

    /// <summary>
    /// A client whose <see cref="HttpClient.BaseAddress"/> host populates <c>Request.Host</c> exactly as a real
    /// <c>Host</c> header would (driving host→exercise resolution), presenting the given session token.
    /// </summary>
    /// <param name="host">The request host to simulate — an exercise's provisioned <c>Hostname</c>.</param>
    /// <param name="bearerToken">The raw session token, or <c>null</c> for an anonymous request.</param>
    /// <returns>The configured client.</returns>
    public HttpClient CreateClientFor(string host, string? bearerToken)
    {
        var client = CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri($"http://{host}"),
        });

        if (bearerToken is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        }

        return client;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IFeedBroadcaster>();
            services.AddSingleton<IFeedBroadcaster>(Broadcaster);
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
    }
}
