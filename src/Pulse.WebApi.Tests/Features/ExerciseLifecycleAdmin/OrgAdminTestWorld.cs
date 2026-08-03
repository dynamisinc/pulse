namespace Pulse.WebApi.Tests.Features.ExerciseLifecycleAdmin;

using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc.Testing;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// The shared two-customer fixture every exercise-lifecycle-admin suite drives the REAL <c>Program</c> pipeline
/// against: two <see cref="Organization"/> tenants, a staff human and an exercise in each, and live
/// <see cref="Session"/> rows whose raw bearer tokens the tests actually present.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why the real pipeline and a real token, rather than a hand-wired slice host.</b> Everything this feature
/// asserts depends on things a slice-composed <c>TestServer</c> cannot express: that <c>Program.cs</c> maps the
/// routes at all, that it registers the services the handlers resolve, and — the one that has bitten this
/// codebase before — that <c>app.UseOrganizationResolution()</c> sits in the right place, because a host that
/// stubs <see cref="Pulse.WebApi.Data.IOrganizationContext"/> has no ordering to get wrong. So these suites
/// seed rows, present a token, and let the real middleware chain resolve the session, the exercise scope and
/// the customer tenant exactly as production does. Same idiom as
/// <c>ExerciseConfiguration/LifecycleGatingPipelineOrderTests</c>.
/// </para>
/// <para>
/// <b>The fixture is deliberately adversarial.</b> Customer Y always exists, always owns an exercise, and
/// always has its own staff human with an assignment — so a suite that returned "everything" and a suite that
/// returned "the right thing" produce visibly different results. Every id is freshly generated per call, so
/// classes sharing the one migrated database never collide.
/// </para>
/// </remarks>
public static class OrgAdminTestWorld
{
    /// <summary>The staff session kind these endpoints require.</summary>
    public const string StaffKind = "staff";

    /// <summary>
    /// Seeds two customers, each with one exercise and one staff human, and a live staff session for the
    /// caller in customer X carrying <paramref name="callerRole"/>.
    /// </summary>
    /// <param name="fixture">The shared real-SQL fixture.</param>
    /// <param name="callerRole">The role on the caller's session row (the value the gate reads).</param>
    /// <param name="seedCallerStaffUser">
    /// When <c>false</c>, the caller's <c>StaffUser</c> row is deliberately NOT created — the fixture for the
    /// "tenant cannot be resolved" fail-closed case.
    /// </param>
    /// <returns>The seeded world.</returns>
    public static async Task<SeededWorld> SeedAsync(
        MsSqlContainerFixture fixture,
        string callerRole,
        bool seedCallerStaffUser = true)
    {
        ArgumentNullException.ThrowIfNull(fixture);
        ArgumentNullException.ThrowIfNull(callerRole);

        var ownOrganizationId = Guid.NewGuid();
        var otherOrganizationId = Guid.NewGuid();
        var callerStaffUserId = Guid.NewGuid();
        var otherStaffUserId = Guid.NewGuid();
        var token = $"org-admin-token-{Guid.NewGuid():N}";

        var ownExercise = NewExercise(ownOrganizationId, "Own Customer Run", "live");
        var otherExercise = NewExercise(otherOrganizationId, "Other Customer Run", "staged");

        await using var context = fixture.CreateContext();

        context.Organizations.Add(NewOrganization(ownOrganizationId, "Customer X"));
        context.Organizations.Add(NewOrganization(otherOrganizationId, "Customer Y"));

        context.Exercises.Add(ownExercise);
        context.Exercises.Add(otherExercise);

        if (seedCallerStaffUser)
        {
            context.StaffUsers.Add(NewStaffUser(callerStaffUserId, ownOrganizationId, "Caller"));
        }

        context.StaffUsers.Add(NewStaffUser(otherStaffUserId, otherOrganizationId, "Other Customer Staff"));

        // The caller is assigned to their own exercise; the OTHER customer's human is assigned to theirs. The
        // second assignment is the adversarial half: an org-scoped read that forgot its tenant bound would
        // surface it, and one that is correctly bounded never can.
        context.StaffAssignments.Add(NewAssignment(callerStaffUserId, ownExercise.Id, callerRole));
        context.StaffAssignments.Add(NewAssignment(otherStaffUserId, otherExercise.Id, "controller"));

        context.Sessions.Add(new Session
        {
            Id = Guid.NewGuid(),
            TokenHash = SessionTokens.Hash(token),
            Kind = StaffKind,
            ExerciseId = ownExercise.Id,
            PrincipalId = callerStaffUserId.ToString(),
            StaffUserId = callerStaffUserId,
            Role = callerRole,
            ActingHumanId = callerStaffUserId.ToString(),
            IsReadOnly = false,
            IssuedAt = DateTimeOffset.UtcNow.AddMinutes(-5),
            ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
        });

        await context.SaveChangesAsync();

        return new SeededWorld(
            ownOrganizationId,
            otherOrganizationId,
            callerStaffUserId,
            otherStaffUserId,
            ownExercise,
            otherExercise,
            token);
    }

    /// <summary>A client on the booted real host presenting <paramref name="token"/> as its bearer credential.</summary>
    /// <remarks>
    /// A STAFF session is deliberately NOT host-bound (only a participant session is), so the base address's
    /// host resolves to no exercise and the request's scope comes wholly from the session — which is exactly
    /// the shape an org-tier surface has: it operates above any one exercise.
    /// </remarks>
    /// <param name="factory">The booted host.</param>
    /// <param name="token">The raw bearer token of a seeded session.</param>
    /// <returns>An HTTP client bound to the host.</returns>
    public static HttpClient CreateClient(WebApplicationFactory<Program> factory, string token)
    {
        ArgumentNullException.ThrowIfNull(factory);

        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static Organization NewOrganization(Guid id, string label) => new()
    {
        Id = id,

        // The Name column carries a unique index, so it must be distinct per seeded world.
        Name = $"{label} {id:N}",
        CreatedAt = DateTimeOffset.UtcNow,
    };

    private static Exercise NewExercise(Guid organizationId, string label, string status) => new()
    {
        Id = Guid.NewGuid(),
        OrganizationId = organizationId,
        Name = $"{label} {Guid.NewGuid():N}",
        TimeZone = "America/Chicago",
        Status = status,
        CreatedAt = DateTimeOffset.UtcNow.AddDays(-1),
    };

    private static StaffUser NewStaffUser(Guid id, Guid organizationId, string displayName) => new()
    {
        Id = id,
        OrganizationId = organizationId,

        // Unique per human (the column carries a unique index) and derived from the id, so parallel classes
        // sharing the one migrated database cannot collide.
        ExternalSubject = $"idp|{id:N}",
        DisplayName = $"{displayName} {id:N}",
        CreatedAt = DateTimeOffset.UtcNow,
    };

    private static StaffAssignment NewAssignment(Guid staffUserId, Guid exerciseId, string role) => new()
    {
        Id = Guid.NewGuid(),
        StaffUserId = staffUserId,
        ExerciseId = exerciseId,
        Role = role,
        CreatedAt = DateTimeOffset.UtcNow,
    };

    /// <summary>The seeded two-customer world.</summary>
    /// <param name="OwnOrganizationId">The CALLER's customer tenant.</param>
    /// <param name="OtherOrganizationId">The other customer's tenant — nothing the caller does may ever reach it.</param>
    /// <param name="CallerStaffUserId">The caller's staff human id.</param>
    /// <param name="OtherStaffUserId">The other customer's staff human id.</param>
    /// <param name="OwnExercise">The caller's organization's exercise.</param>
    /// <param name="OtherExercise">The other customer's exercise.</param>
    /// <param name="Token">The caller's raw bearer token.</param>
    public sealed record SeededWorld(
        Guid OwnOrganizationId,
        Guid OtherOrganizationId,
        Guid CallerStaffUserId,
        Guid OtherStaffUserId,
        Exercise OwnExercise,
        Exercise OtherExercise,
        string Token);
}

/// <summary>
/// The real <c>Program</c> host with <c>ConnectionStrings__DefaultConnection</c> pointed at the shared migrated
/// database. It overrides NOTHING else — an override of the pipeline, the exercise context or the organization
/// context would make the wiring and ordering these suites exist to prove unobservable.
/// </summary>
public sealed class OrgAdminProbeFactory : WebApplicationFactory<Program>
{
    private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

    /// <summary>Points the booted host at the shared migrated test database.</summary>
    /// <param name="connectionString">The fixture's connection string.</param>
    public OrgAdminProbeFactory(string connectionString)
        => Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);

    /// <inheritdoc />
    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
    }
}

/// <summary>The wire shape the org-admin suites deserialize an exercise row into (mirrors <c>OrgExerciseDto</c>).</summary>
/// <param name="ExerciseId">The exercise id.</param>
/// <param name="Name">The staff-facing name.</param>
/// <param name="Status">The COR-032 lifecycle literal.</param>
/// <param name="Hostname">The provisioned host.</param>
/// <param name="CreatedAt">The ISO-8601 creation instant, or <c>null</c>.</param>
public sealed record OrgExerciseWire(
    string ExerciseId,
    string Name,
    string Status,
    string? Hostname,
    string? CreatedAt);

/// <summary>The wire shape for a created exercise (mirrors <c>CreateExerciseResponseDto</c>).</summary>
/// <param name="Exercise">The created exercise.</param>
/// <param name="AssignedRole">The role of the assignment minted for the creator.</param>
public sealed record CreateExerciseWire(OrgExerciseWire Exercise, string AssignedRole);

/// <summary>The wire shape for one org-scoped staff assignment (mirrors <c>OrgStaffAssignmentDto</c>).</summary>
/// <param name="ExerciseId">The assigned exercise id.</param>
/// <param name="ExerciseName">The assigned exercise name.</param>
/// <param name="StaffUserId">The assigned staff human id.</param>
/// <param name="DisplayName">The assigned staff human's display name.</param>
/// <param name="Role">The role held.</param>
/// <param name="AssignedAt">The ISO-8601 assignment instant.</param>
public sealed record OrgStaffAssignmentWire(
    string ExerciseId,
    string ExerciseName,
    string StaffUserId,
    string DisplayName,
    string Role,
    string AssignedAt);
