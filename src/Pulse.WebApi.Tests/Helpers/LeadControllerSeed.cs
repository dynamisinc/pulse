namespace Pulse.WebApi.Tests.Helpers;

using System;
using System.Linq;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Enrollments;

/// <summary>
/// Seeds (and demotes) the LEAD controller a raise path's post-write lead re-check reads (Tier-2 M-1,
/// <c>ExerciseCallerRole.IsStillLeadAsync</c>). Service-level suites that drive a raise directly pass the seeded person
/// as the session person, exactly as the endpoint passes <c>ExerciseCallerRole.PersonId</c>.
/// </summary>
public static class LeadControllerSeed
{
    /// <summary>
    /// Seeds a person + staff facet and their lead <c>controller</c> enrollment on <paramref name="exerciseId"/> through
    /// <paramref name="seedContext"/> (a fresh context the caller owns), and returns the person id. Idempotent per
    /// exercise: when the exercise already has a lead (at most one is allowed), that lead's person is returned.
    /// </summary>
    /// <param name="seedContext">A short-lived context to write through (saved here).</param>
    /// <param name="exerciseId">The exercise the lead enrollment is on.</param>
    /// <param name="personId">The lead's person id (a fresh one when <c>null</c>), e.g. a harness's session person.</param>
    /// <returns>The lead's person id.</returns>
    public static Guid Seed(PulseDbContext seedContext, Guid exerciseId, Guid? personId = null)
    {
        ArgumentNullException.ThrowIfNull(seedContext);

        var existing = seedContext.Enrollments
            .IgnoreQueryFilters()
            .Where(e => e.ExerciseId == exerciseId && e.IsLead)
            .Select(e => e.PersonId)
            .FirstOrDefault();
        if (existing is { } existingLead)
        {
            return existingLead;
        }

        var leadId = personId ?? Guid.NewGuid();
        seedContext.StaffUsers.Add(StaffTenantSeed.StaffUserFor(leadId));
        seedContext.Enrollments.Add(new Enrollment
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            PersonId = leadId,
            Role = EnrollmentRoles.Controller,
            IsLead = true,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        seedContext.SaveChanges();
        return leadId;
    }

    /// <summary>
    /// Demotes <paramref name="personId"/> on <paramref name="exerciseId"/> (clears <c>IsLead</c>) and commits it — the
    /// concurrent planner demotion a race test lands between the lead read and the post-write re-check. Synchronous so it
    /// can run inside a test hook.
    /// </summary>
    /// <param name="scopedContext">A short-lived context scoped to <paramref name="exerciseId"/>.</param>
    /// <param name="exerciseId">The exercise.</param>
    /// <param name="personId">The lead to demote.</param>
    public static void Demote(PulseDbContext scopedContext, Guid exerciseId, Guid personId)
    {
        ArgumentNullException.ThrowIfNull(scopedContext);

        var demoted = scopedContext.Enrollments
            .Where(e => e.ExerciseId == exerciseId && e.PersonId == personId && e.IsLead)
            .ExecuteUpdate(set => set.SetProperty(e => e.IsLead, false));
        if (demoted != 1)
        {
            throw new InvalidOperationException($"expected to demote exactly one lead enrollment, demoted {demoted}");
        }
    }
}
