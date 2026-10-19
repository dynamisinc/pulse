namespace Pulse.WebApi.Tests.Features.Identity.EasyLogin;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// easy-login/01 (Sessions and gates AC, EL-13) — <see cref="RosterStaffRoleFilter"/> answers <c>401</c> with no staff
/// session or no resolved scope, <c>403</c> for an assigned EVALUATOR or a staff user not assigned to the resolved
/// exercise, and passes an assigned CONTROLLER or PLANNER. Driven through the REAL
/// <see cref="StaffAssignmentService"/> against real SQL (the assignment read joins exercises within the caller's
/// tenant), with only the staff-session accessor stubbed. The exercise always comes from <see cref="IExerciseContext"/>:
/// a route or query value naming another exercise is never consulted.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class RosterStaffRoleFilterTests
{
    private const string HandlerResult = "handler ran";

    private readonly MsSqlContainerFixture _fixture;

    public RosterStaffRoleFilterTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [Theory]
    [InlineData("controller")]
    [InlineData("planner")]
    [InlineData("Controller")]
    [InlineData("PLANNER")]
    public void IsAdmittedRole_AdmitsControllerAndPlanner_InAnyCasing(string role)
    {
        RosterStaffRoleFilter.IsAdmittedRole(role).Should().BeTrue();
    }

    [Theory]
    [InlineData("evaluator")]
    [InlineData("orgAdmin")]
    [InlineData("participant")]
    [InlineData("pio")]
    [InlineData("")]
    [InlineData(null)]
    public void IsAdmittedRole_RefusesEveryOtherRole(string? role)
    {
        RosterStaffRoleFilter.IsAdmittedRole(role).Should().BeFalse("only controllers and planners hand out credentials (EL-13)");
    }

    [RequiresDockerFact]
    public async Task AssignedController_PassesToTheHandler()
    {
        var (staffUserId, exerciseA, _) = await SeedAsync(roleOnA: "controller");

        var (result, handlerRan) = await InvokeAsync(new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = staffUserId }, exerciseA);

        handlerRan.Should().BeTrue();
        result.Should().Be(HandlerResult);
    }

    [RequiresDockerFact]
    public async Task AssignedPlanner_PassesToTheHandler()
    {
        var (staffUserId, exerciseA, _) = await SeedAsync(roleOnA: "planner");

        var (result, handlerRan) = await InvokeAsync(new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = staffUserId }, exerciseA);

        handlerRan.Should().BeTrue("a planner may provision participants (EL-13)");
        result.Should().Be(HandlerResult);
    }

    [RequiresDockerFact]
    public async Task AssignedEvaluator_Is403()
    {
        var (staffUserId, exerciseA, _) = await SeedAsync(roleOnA: "evaluator");

        var (result, handlerRan) = await InvokeAsync(new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = staffUserId }, exerciseA);

        handlerRan.Should().BeFalse();
        StatusOf(result).Should().Be(StatusCodes.Status403Forbidden, "an evaluator observes; they do not hand out credentials");
    }

    [RequiresDockerFact]
    public async Task UnassignedStaffUser_Is403()
    {
        // A controller on exercise B whose request is scoped to exercise A, where they hold no assignment.
        var (staffUserId, exerciseA, _) = await SeedAsync(roleOnA: null, roleOnB: "controller");

        var (result, handlerRan) = await InvokeAsync(new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = staffUserId }, exerciseA);

        handlerRan.Should().BeFalse();
        StatusOf(result).Should().Be(StatusCodes.Status403Forbidden, "a staff user not assigned to the resolved exercise is refused");
    }

    [RequiresDockerFact]
    public async Task NoStaffSession_Is401()
    {
        var (_, exerciseA, _) = await SeedAsync(roleOnA: "controller");

        // A participant, read-only or anonymous caller: the staff accessor yields no staff session.
        var (result, handlerRan) = await InvokeAsync(current: null, exerciseA);

        handlerRan.Should().BeFalse();
        result.Should().BeOfType<UnauthorizedHttpResult>("no staff session is a 401, never a default");
    }

    [RequiresDockerFact]
    public async Task UnresolvedOrEmptyScope_Is401()
    {
        var (staffUserId, _, _) = await SeedAsync(roleOnA: "controller");
        var staff = new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = staffUserId };

        var (unresolved, ranUnresolved) = await InvokeAsync(staff, scope: null);
        var (empty, ranEmpty) = await InvokeAsync(staff, scope: Guid.Empty);

        ranUnresolved.Should().BeFalse();
        ranEmpty.Should().BeFalse();
        unresolved.Should().BeOfType<UnauthorizedHttpResult>("an unresolved scope fails closed");
        empty.Should().BeOfType<UnauthorizedHttpResult>("the empty-guid scope fails closed");
    }

    [RequiresDockerFact]
    public async Task TheExercise_ComesFromTheResolvedScope_NeverFromTheRequest()
    {
        // The caller controls exercise B but the request is scoped to A. Naming B in the route and the query must not
        // help: the filter reads only IExerciseContext.
        var (staffUserId, exerciseA, exerciseB) = await SeedAsync(roleOnA: "evaluator", roleOnB: "controller");
        var staff = new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = staffUserId };

        var (result, handlerRan) = await InvokeAsync(staff, exerciseA, requestNamesExercise: exerciseB);

        handlerRan.Should().BeFalse();
        StatusOf(result).Should().Be(
            StatusCodes.Status403Forbidden, "the caller's controller role on B is irrelevant to a request scoped to A");

        var (onB, ranOnB) = await InvokeAsync(staff, exerciseB, requestNamesExercise: exerciseA);
        ranOnB.Should().BeTrue("scoped to B, where they are controller, they pass whatever the request names");
        onB.Should().Be(HandlerResult);
    }

    private static int? StatusOf(object? result) => (result as IStatusCodeHttpResult)?.StatusCode;

    /// <summary>Seeds a staff user (in the default tenant), two exercises, and the requested assignments.</summary>
    private async Task<(Guid StaffUserId, Guid ExerciseA, Guid ExerciseB)> SeedAsync(string? roleOnA, string? roleOnB = null)
    {
        var staffUserId = Guid.NewGuid();
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();

        await using var seed = _fixture.CreateContext();
        seed.StaffUsers.Add(StaffTenantSeed.StaffUserFor(staffUserId));
        seed.Exercises.Add(new Exercise { Id = exerciseA, OrganizationId = Organization.DefaultOrganizationId, Name = $"A {exerciseA:N}" });
        seed.Exercises.Add(new Exercise { Id = exerciseB, OrganizationId = Organization.DefaultOrganizationId, Name = $"B {exerciseB:N}" });

        if (roleOnA is not null)
        {
            seed.Enrollments.Add(new Enrollment
            {
                Id = Guid.NewGuid(),
                PersonId = staffUserId,
                ExerciseId = exerciseA,
                Role = roleOnA,
                CreatedAt = DateTimeOffset.UtcNow,
            });
        }

        if (roleOnB is not null)
        {
            seed.Enrollments.Add(new Enrollment
            {
                Id = Guid.NewGuid(),
                PersonId = staffUserId,
                ExerciseId = exerciseB,
                Role = roleOnB,
                CreatedAt = DateTimeOffset.UtcNow,
            });
        }

        await seed.SaveChangesAsync();
        return (staffUserId, exerciseA, exerciseB);
    }

    /// <summary>Runs the filter in a request scope built from the real assignment service and the given stubs.</summary>
    private async Task<(object? Result, bool HandlerRan)> InvokeAsync(
        CurrentStaffSession? current,
        Guid? scope,
        Guid? requestNamesExercise = null)
    {
        var services = new ServiceCollection();
        services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = scope });
        services.AddScoped<ICurrentStaffSessionAccessor>(_ => new StubCurrentStaffSessionAccessor(current));
        services.AddScoped(provider => _fixture.CreateContext(provider.GetRequiredService<IExerciseContext>()));
        services.AddScoped<StaffAssignmentService>();

        await using var provider = services.BuildServiceProvider();
        await using var requestScope = provider.CreateAsyncScope();

        var httpContext = new DefaultHttpContext { RequestServices = requestScope.ServiceProvider };
        if (requestNamesExercise is { } named)
        {
            httpContext.Request.QueryString = new QueryString($"?exerciseId={named}");
            httpContext.Request.RouteValues["exerciseId"] = named.ToString();
        }

        var handlerRan = false;
        var result = await new RosterStaffRoleFilter().InvokeAsync(
            new DefaultEndpointFilterInvocationContext(httpContext),
            _ =>
            {
                handlerRan = true;
                return ValueTask.FromResult<object?>(HandlerResult);
            });

        return (result, handlerRan);
    }
}
