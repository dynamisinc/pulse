namespace Pulse.WebApi.Tests.Features.ExerciseLifecycleAdmin;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Features.ExerciseLifecycleAdmin;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// exercise-lifecycle-admin story 01 (COR-074) — the real, role-gated, session-authenticated exercise creation
/// path, driven end to end over the REAL <c>Program</c> pipeline against real SQL.
/// </summary>
/// <remarks>
/// Every test presents a real bearer token for a real seeded staff session, so the exercise scope, the customer
/// tenant, the default-deny gate and the role filter are all decided by production middleware rather than by a
/// stub. The two-customer fixture (<see cref="OrgAdminTestWorld"/>) means an endpoint that ignored its tenant
/// bound would visibly reach customer Y.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class ExerciseCreationEndpointTests
{
    private readonly MsSqlContainerFixture _fixture;

    /// <summary>Creates the suite over the shared real-SQL fixture.</summary>
    /// <param name="fixture">The shared migrated database.</param>
    public ExerciseCreationEndpointTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>
    /// AC1 + AC2 + AC3 + AC4: a planner's create yields a <c>build</c> exercise with a unique hostname, a
    /// creator assignment, the caller's own organization, and the documented column defaults untouched.
    /// </summary>
    [RequiresDockerFact]
    public async Task Create_AsPlanner_PersistsABuildExercise_OwnedByTheCallersOrganization_WithACreatorAssignment()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.Planner);

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        var response = await client.PostAsJsonAsync(
            ExerciseLifecycleAdminEndpoints.ExercisesRoute,
            new { name = "Fairhaven County CIE" });

        response.StatusCode.Should().Be(
            HttpStatusCode.Created,
            "a Planner session may create an exercise (COR-074 AC1) — a 401 here means the customer tenant was "
            + "never resolved, a 403 means the role gate refused a role it must admit, and a 404 means "
            + "Program.cs never mapped the route");

        var created = await response.Content.ReadFromJsonAsync<CreateExerciseWire>();
        created.Should().NotBeNull();

        created!.Exercise.Status.Should().Be(
            ExerciseLifecycleStates.Build,
            "COR-032 / AC1: a newly created exercise is in staff-only content development, never any other "
            + "state — bootstrap's 'live' seed is a different path with a different purpose");
        created.AssignedRole.Should().Be(
            ExerciseAdminRoles.Planner,
            "AC3: the auto-created assignment carries the CREATOR'S OWN role");

        var exerciseId = Guid.Parse(created.Exercise.ExerciseId);

        await using var read = _fixture.CreateContext();
        var exercise = await read.Exercises.AsNoTracking().SingleAsync(e => e.Id == exerciseId);

        exercise.OrganizationId.Should().Be(
            world.OwnOrganizationId,
            "AC4: the owning tenant is derived server-side from the caller's own resolved organization");
        exercise.OrganizationId.Should().NotBe(
            world.OtherOrganizationId, "and it is emphatically not the other customer's");
        exercise.Status.Should().Be(ExerciseLifecycleStates.Build, "the persisted row, not just the response");
        exercise.CreatedAt.Should().NotBeNull("the creation instant is server-stamped (story 02 renders it)");
        exercise.Hostname.Should().NotBeNullOrWhiteSpace("AC2: the platform allocates a hostname (COR-008)");

        // AC1: "otherwise indistinguishable from a bootstrap-seeded exercise" — the COR-030 defaults are the
        // entity's documented ones, not values this endpoint invented.
        exercise.TimeZone.Should().Be("UTC");
        exercise.ComplianceChromeEnabled.Should().BeTrue();
        exercise.WatermarkEnabled.Should().BeTrue();
        exercise.IsPracticeMode.Should().BeFalse();
        exercise.WorldName.Should().BeNull("an unconfigured exercise leaves every COR-030 setting null");

        var assignment = await read.StaffAssignments
            .AsNoTracking()
            .SingleAsync(a => a.ExerciseId == exerciseId);

        assignment.StaffUserId.Should().Be(
            world.CallerStaffUserId,
            "AC3: the creator is assigned so they reach the run through the switcher with no separate "
            + "provisioning step");
        assignment.Role.Should().Be(ExerciseAdminRoles.Planner);
    }

    /// <summary>
    /// AC3, the org-admin arm: an <c>orgAdmin</c> creator gets an <c>orgAdmin</c> assignment — the role is
    /// copied from the creator, not coerced onto a staff role.
    /// </summary>
    [RequiresDockerFact]
    public async Task Create_AsOrgAdmin_MintsAnOrgAdminAssignment_NotAStaffRoleSubstitute()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.OrgAdmin);

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        var response = await client.PostAsJsonAsync(
            ExerciseLifecycleAdminEndpoints.ExercisesRoute,
            new { name = "Org Admin Created Run" });

        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var created = await response.Content.ReadFromJsonAsync<CreateExerciseWire>();
        created!.AssignedRole.Should().Be(
            ExerciseAdminRoles.OrgAdmin,
            "orgAdmin is a real, stored role in its own right (COR-076) — AC3 says 'planner or orgAdmin', so "
            + "silently writing 'planner' here would erase the very role this feature makes real");

        await using var read = _fixture.CreateContext();
        var assignment = await read.StaffAssignments
            .AsNoTracking()
            .SingleAsync(a => a.ExerciseId == Guid.Parse(created.Exercise.ExerciseId));

        assignment.Role.Should().Be(ExerciseAdminRoles.OrgAdmin, "the persisted assignment, not just the echo");
    }

    /// <summary>
    /// AC2: a caller-proposed hostname is validated and stored; the same normalizer the host → exercise
    /// resolution path uses, so a hostname this endpoint accepts is one the middleware can later resolve.
    /// </summary>
    [RequiresDockerFact]
    public async Task Create_WithAProposedHostname_NormalizesAndStoresIt_SoHostResolutionCanFindIt()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.Planner);
        var proposed = $"Proposed-{Guid.NewGuid():N}.Pulse.Test";

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        var response = await client.PostAsJsonAsync(
            ExerciseLifecycleAdminEndpoints.ExercisesRoute,
            new { name = "Proposed Host Run", hostname = proposed });

        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var created = await response.Content.ReadFromJsonAsync<CreateExerciseWire>();
        created!.Exercise.Hostname.Should().Be(
            proposed.ToLowerInvariant(),
            "the proposed host is normalized by the SAME ExerciseHostName normalizer host resolution uses, so "
            + "the stored value is the lower-cased form a Host header will be compared against");
    }

    /// <summary>
    /// AC2: a server-allocated hostname is always a value <see cref="ExerciseHostName"/> accepts — otherwise
    /// the exercise could never be reached by host resolution at all.
    /// </summary>
    [RequiresDockerFact]
    public async Task Create_WithNoProposedHostname_AllocatesOneThatHostResolutionWouldAccept()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.Planner);

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        // A name that is pure markup-adjacent punctuation and non-ASCII once sanitized still has to produce a
        // legal DNS label — this is the case a naive slug would break on.
        var response = await client.PostAsJsonAsync(
            ExerciseLifecycleAdminEndpoints.ExercisesRoute,
            new { name = "  Ådalen  //  Vinter-Øvelse 2033!!  " });

        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var created = await response.Content.ReadFromJsonAsync<CreateExerciseWire>();
        var hostname = created!.Exercise.Hostname;

        hostname.Should().NotBeNullOrWhiteSpace();
        ExerciseHostName.TryNormalize(hostname, out var normalized).Should().BeTrue(
            "a generated hostname that the resolution path's own validator rejects would make the exercise "
            + "permanently unreachable by host (COR-008)");
        normalized.Should().Be(hostname, "the generated value must already be in normalized form");
    }

    /// <summary>
    /// AC2 + the task's "duplicate hostname fails cleanly": a colliding hostname is a <c>409</c> that persists
    /// NOTHING — no exercise, no assignment, no telemetry. Uniqueness is global across organizations.
    /// </summary>
    [RequiresDockerFact]
    public async Task Create_WithAHostnameAnotherCustomersExerciseAlreadyHolds_Conflicts_AndCreatesNothing()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.Planner);
        var takenHost = $"taken-{Guid.NewGuid():N}.pulse.test";

        // Park the hostname on the OTHER customer's exercise: "no two exercises, across any organization, ever
        // collide on a hostname" (AC2), and HostExerciseResolver fails closed on ambiguity, so a cross-tenant
        // collision is a correctness break rather than a cosmetic one.
        await using (var seed = _fixture.CreateContext())
        {
            var other = await seed.Exercises.SingleAsync(e => e.Id == world.OtherExercise.Id);
            other.Hostname = takenHost;
            await seed.SaveChangesAsync();
        }

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        var response = await client.PostAsJsonAsync(
            ExerciseLifecycleAdminEndpoints.ExercisesRoute,
            new { name = "Colliding Host Run", hostname = takenHost });

        response.StatusCode.Should().Be(
            HttpStatusCode.Conflict,
            "a hostname collision must fail cleanly. A 201 would mean the filtered unique index is gone and "
            + "host resolution now fails closed for BOTH exercises; a 500 would mean the violation escaped "
            + "unhandled");

        await using var read = _fixture.CreateContext();

        var exercisesOnHost = await read.Exercises
            .AsNoTracking()
            .CountAsync(e => e.Hostname == takenHost);
        exercisesOnHost.Should().Be(1, "the pre-existing exercise is the only holder; nothing was added");

        var created = await read.Exercises
            .AsNoTracking()
            .Where(e => e.OrganizationId == world.OwnOrganizationId && e.Name == "Colliding Host Run")
            .ToListAsync();
        created.Should().BeEmpty("no half-created exercise may survive a refused create");

        var assignmentCount = await read.StaffAssignments
            .AsNoTracking()
            .CountAsync(a => a.StaffUserId == world.CallerStaffUserId);
        assignmentCount.Should().Be(
            1,
            "the single unit of work rolls back completely: only the fixture's own assignment remains, so no "
            + "orphan StaffAssignment points at an exercise that was never created");

        var telemetry = await read.TelemetryEvents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .CountAsync(e => e.EventType == "exercise.created"
                && e.Actor.ActingHumanId == world.CallerStaffUserId.ToString());
        telemetry.Should().Be(0, "a refused create emits no 'it happened' audit event");
    }

    /// <summary>AC5: a Controller session cannot create an exercise.</summary>
    [RequiresDockerFact]
    public async Task Create_AsController_IsRefused()
    {
        await AssertRoleIsRefusedAsync(ExerciseAdminRoles.Controller);
    }

    /// <summary>AC5: an Evaluator session cannot create an exercise.</summary>
    [RequiresDockerFact]
    public async Task Create_AsEvaluator_IsRefused()
    {
        await AssertRoleIsRefusedAsync(ExerciseAdminRoles.Evaluator);
    }

    /// <summary>
    /// The default-deny floor: no credential at all is a <c>401</c> from the shipped fallback policy, before
    /// this feature's own filter ever runs.
    /// </summary>
    [RequiresDockerFact]
    public async Task Create_WithNoSession_IsUnauthorized()
    {
        await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.Planner);

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            ExerciseLifecycleAdminEndpoints.ExercisesRoute,
            new { name = "Anonymous Attempt" });

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "creation is session-authenticated — it is emphatically not a second, weaker bootstrap seam");
    }

    /// <summary>Validation: a missing name is a 400 and writes nothing.</summary>
    [RequiresDockerFact]
    public async Task Create_WithNoName_IsRejected_AndWritesNothing()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.Planner);

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        var response = await client.PostAsJsonAsync(
            ExerciseLifecycleAdminEndpoints.ExercisesRoute,
            new { name = "   " });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        await using var read = _fixture.CreateContext();
        var count = await read.Exercises
            .AsNoTracking()
            .CountAsync(e => e.OrganizationId == world.OwnOrganizationId);
        count.Should().Be(1, "only the fixture's own exercise exists — a rejected request created nothing");
    }

    /// <summary>
    /// NFR-004: free text is STRIPPED, not encoded, on ingest — a stored script must never be able to execute
    /// on the staff surface that renders the exercise name.
    /// </summary>
    [RequiresDockerFact]
    public async Task Create_SanitizesTheName_StrippingMarkupRatherThanStoringIt()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.Planner);

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        var response = await client.PostAsJsonAsync(
            ExerciseLifecycleAdminEndpoints.ExercisesRoute,
            new { name = "County <script>alert('x')</script> Drill" });

        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var created = await response.Content.ReadFromJsonAsync<CreateExerciseWire>();
        created!.Exercise.Name.Should().NotContain("<script", "markup is stripped on ingest, never persisted");
        created.Exercise.Name.Should().NotContain(
            "&lt;", "it is STRIPPED, not HTML-encoded — an encoded payload is still a payload one decode away");
        created.Exercise.Name.Should().Contain("County").And.Contain("Drill", "the real text survives");
    }

    /// <summary>
    /// XC-004: exactly ONE <c>exercise.created</c> event, in the same unit of work, attributed to the acting
    /// staff human and stamped with the new exercise's own id.
    /// </summary>
    [RequiresDockerFact]
    public async Task Create_EmitsExactlyOneAuditEvent_AttributedToTheActingStaffHuman()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.OrgAdmin);

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        var response = await client.PostAsJsonAsync(
            ExerciseLifecycleAdminEndpoints.ExercisesRoute,
            new { name = "Audited Run" });
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var created = await response.Content.ReadFromJsonAsync<CreateExerciseWire>();
        var exerciseId = Guid.Parse(created!.Exercise.ExerciseId);

        await using var read = _fixture.CreateContext();
        var events = await read.TelemetryEvents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(e => e.ExerciseId == exerciseId)
            .ToListAsync();

        var auditEvent = events.Should().ContainSingle(
            "exactly one XC-004 event per meaningful action, persisted in the same unit of work as the "
            + "mutation").Subject;

        auditEvent.EventType.Should().Be("exercise.created");
        auditEvent.Actor.Kind.Should().Be(
            "system",
            "the v0 envelope has no dedicated staff actor.kind, so a genuine staff action rides 'system' + "
            + "actingHumanId — the same shape exercise.switched and exercise.bootstrapped already use");
        auditEvent.Actor.ActingHumanId.Should().Be(
            world.CallerStaffUserId.ToString(), "the acting human is who the audit trail is for");
        auditEvent.Actor.Role.Should().Be(ExerciseAdminRoles.OrgAdmin);
        auditEvent.Target!.EntityId.Should().Be(exerciseId.ToString());
        auditEvent.Payload.Should().NotContain(
            world.OwnOrganizationId.ToString(),
            "XC-002: the customer tenant is a staff/platform tier that must not be written into an event "
            + "payload that downstream export surfaces read");
    }

    /// <summary>
    /// AC6 regression guard: nothing in this story routes through, weakens or re-implements the secret-gated
    /// ops bootstrap seam. Its own suites (<c>BootstrapEndpointsHttpTests</c>,
    /// <c>BootstrapSecretGateTests</c>) prove the gate itself; this asserts the ONE property they cannot —
    /// that the new customer-facing path did not become a second, unguarded way in.
    /// </summary>
    [RequiresDockerFact]
    public async Task TheNewCreationPath_IsNotReachableWithABootstrapSecretHeader_OnlyWithAStaffSession()
    {
        await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.Planner);

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Bootstrap-Secret", "any-value-at-all");

        var response = await client.PostAsJsonAsync(
            ExerciseLifecycleAdminEndpoints.ExercisesRoute,
            new { name = "Secret Header Attempt" });

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "the deployment secret is the ops seam's credential and must buy nothing on the customer-facing "
            + "path — if this ever returned 201, the two gates would have been fused and the ops seam's "
            + "'disabled by default, never customer-facing' posture silently widened");
    }

    /// <summary>Shared arrangement for AC5: a staff role that is not an exercise administrator gets a 403.</summary>
    private async Task AssertRoleIsRefusedAsync(string role)
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, role);

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        var response = await client.PostAsJsonAsync(
            ExerciseLifecycleAdminEndpoints.ExercisesRoute,
            new { name = $"{role} Attempt" });

        response.StatusCode.Should().Be(
            HttpStatusCode.Forbidden,
            "AC5: creation is Planner/OrgAdmin only, so a live, perfectly valid {0} session must be refused — "
            + "a 201 here means the endpoint gates on 'any staff session' (exercise-configuration's open "
            + "question (a) gap) rather than on role, and a 401 would mean the session itself was not honored, "
            + "which would make this pass for the wrong reason",
            role);

        await using var read = _fixture.CreateContext();
        var count = await read.Exercises
            .AsNoTracking()
            .CountAsync(e => e.OrganizationId == world.OwnOrganizationId);
        count.Should().Be(1, "a refused caller created nothing");
    }
}
