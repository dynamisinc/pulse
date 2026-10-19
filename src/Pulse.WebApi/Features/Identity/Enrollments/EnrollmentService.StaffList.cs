namespace Pulse.WebApi.Features.Identity.Enrollments;

using System.Linq;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <content>
/// Story 20 (#575a): the planner Staff tab's read — the exercise's active staff enrollments (with the lead marker) and
/// the organization's people who hold no enrollment in it yet (the grant candidates).
/// </content>
public sealed partial class EnrollmentService
{
    /// <summary>
    /// Lists exercise <paramref name="exerciseId"/>'s ACTIVE staff enrollments (revoked rows excluded) and the people of
    /// the exercise's organization who hold no active enrollment of any role in it. Same gate as the writes: a planner on
    /// THAT exercise (their resolved scope) or an org admin (org-scope session, an exercise of their own organization);
    /// anyone else is refused before the exercise is looked up, and a foreign or missing exercise is the bare 404.
    /// </summary>
    /// <param name="exerciseId">The exercise (route value; for a planner it must be their own resolved exercise).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome the endpoint maps to a status.</returns>
    public async Task<StaffEnrollmentListResult> ListStaffAsync(Guid exerciseId, CancellationToken cancellationToken = default)
    {
        var authorization = await AuthorizeAsync(cancellationToken);
        if (authorization.Refusal is { } refusal)
        {
            return StaffEnrollmentListResult.From(refusal.Outcome);
        }

        var caller = authorization.Caller!;
        var exercise = await FindReachableExerciseAsync(caller, exerciseId, cancellationToken);
        if (exercise is null)
        {
            return StaffEnrollmentListResult.From(EnrollmentOutcome.NotFound);
        }

        // Every active enrollment of the exercise, any role: staff rows are listed, and every enrolled person (a participant
        // too — granting them a staff role would be 409 conflicting-enrollment) is withheld from the candidates.
        // org-scope-exempt(TenantChecked): exercise was just resolved inside the caller's own scope (planner) or their own
        // organization (org admin, InOrganization), so this reads only that one exercise's enrollments.
        var enrollments = await _dbContext.Enrollments
            .IgnoreQueryFilters()
            .Active()
            .AsNoTracking()
            .Where(e => e.ExerciseId == exercise.Id)
            .Select(e => new { e.Id, e.PersonId, e.Role, e.IsLead })
            .ToListAsync(cancellationToken);

        // The exercise's own organization's people only — a person of another tenant is never listed or joined.
        var people = await _dbContext.People
            .AsNoTracking()
            .InOrganization(exercise.OrganizationId)
            .Select(p => new { p.Id, p.DisplayName, p.Email })
            .ToListAsync(cancellationToken);
        var peopleById = people.ToDictionary(p => p.Id);

        var staff = enrollments
            .Where(e => EnrollmentRoles.IsStaffRole(e.Role) && e.PersonId is { } id && peopleById.ContainsKey(id))
            .Select(e =>
            {
                var person = peopleById[e.PersonId!.Value];
                return new StaffEnrollmentDto
                {
                    Id = e.Id.ToString(),
                    PersonId = person.Id.ToString(),
                    DisplayName = person.DisplayName,
                    Email = person.Email,
                    Role = e.Role,
                    IsLead = e.IsLead,
                };
            })
            .OrderBy(dto => RoleOrder(dto.Role))
            .ThenBy(dto => dto.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(dto => dto.Id, StringComparer.Ordinal)
            .ToList();

        var enrolled = enrollments.Where(e => e.PersonId is not null).Select(e => e.PersonId!.Value).ToHashSet();
        var candidates = people
            .Where(p => !enrolled.Contains(p.Id))
            .Select(p => new StaffCandidateDto { PersonId = p.Id.ToString(), DisplayName = p.DisplayName, Email = p.Email })
            .OrderBy(dto => dto.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(dto => dto.PersonId, StringComparer.Ordinal)
            .ToList();

        return StaffEnrollmentListResult.Ok(new StaffEnrollmentListDto
        {
            ExerciseId = exercise.Id.ToString(),
            Enrollments = staff,
            Candidates = candidates,
        });
    }

    private static int RoleOrder(string role) => role switch
    {
        EnrollmentRoles.Planner => 0,
        EnrollmentRoles.Controller => 1,
        EnrollmentRoles.Evaluator => 2,
        _ => 3,
    };
}

/// <summary>The result of <see cref="EnrollmentService.ListStaffAsync"/>.</summary>
public sealed class StaffEnrollmentListResult
{
    private StaffEnrollmentListResult(EnrollmentOutcome outcome, StaffEnrollmentListDto? list)
    {
        Outcome = outcome;
        List = list;
    }

    /// <summary>Which outcome occurred (<see cref="EnrollmentOutcome.Ok"/>, Unauthenticated, Forbidden or NotFound).</summary>
    public EnrollmentOutcome Outcome { get; }

    /// <summary>The list on <see cref="EnrollmentOutcome.Ok"/>.</summary>
    public StaffEnrollmentListDto? List { get; }

    /// <summary>A success.</summary>
    /// <param name="list">The list.</param>
    /// <returns>The result.</returns>
    public static StaffEnrollmentListResult Ok(StaffEnrollmentListDto list)
    {
        ArgumentNullException.ThrowIfNull(list);
        return new(EnrollmentOutcome.Ok, list);
    }

    /// <summary>A refusal carrying only its outcome.</summary>
    /// <param name="outcome">The refusal outcome.</param>
    /// <returns>The result.</returns>
    public static StaffEnrollmentListResult From(EnrollmentOutcome outcome) => new(outcome, null);
}
