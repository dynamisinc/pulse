namespace Pulse.WebApi.Tests.Data;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text.Json.Serialization;
using FluentAssertions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Xunit;

/// <summary>
/// exercise-isolation/11 cross-cutting AC (XC-002): <b>no participant surface exposes the organization
/// concept</b> — the customer tenant is a staff/platform tier and must never reach the wire.
/// </summary>
/// <remarks>
/// <para>
/// The tenant is server-resolved, and the whole point of the tier is that a client neither supplies nor sees
/// it. Two distinct failure modes are closed here: a DTO that <i>leaks</i> the tenant outward (one customer's
/// id disclosed to a participant, and, worse, a shape that invites a client to start sending it back), and a
/// REQUEST DTO that would <i>accept</i> a client-supplied tenant — the cross-tenant analogue of the
/// client-supplied <c>exerciseId</c> that COR-001 forbids on the inner axis.
/// </para>
/// <para>
/// Reflection over the shipped types, not a grep, so a DTO added by a later story is covered automatically.
/// Model-only: runs on every machine and in every CI job.
/// </para>
/// </remarks>
public sealed class OrganizationIsNotWireVisibleTests
{
    /// <summary>Every DTO the API serializes or deserializes — discovered by convention, not enumerated.</summary>
    private static List<Type> DtoTypes() =>
        typeof(PulseDbContext).Assembly
            .GetTypes()
            .Where(type => type is { IsClass: true, IsAbstract: false, IsPublic: true })
            .Where(type => type.Name.EndsWith("Dto", StringComparison.Ordinal))
            .ToList();

    [Fact]
    public void NoDto_ExposesTheOrganizationTenantOnTheWire()
    {
        var dtos = DtoTypes();

        dtos.Should().HaveCountGreaterThan(
            20, "the reflection must actually be finding the DTOs — a near-empty set would make this guard "
            + "vacuous and it would pass on a leaking wire contract");

        var offenders = new List<string>();
        foreach (var dto in dtos)
        {
            foreach (var property in dto.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                var jsonName = property.GetCustomAttribute<JsonPropertyNameAttribute>()?.Name;

                if (property.Name.Contains("Organization", StringComparison.OrdinalIgnoreCase)
                    || (jsonName?.Contains("organization", StringComparison.OrdinalIgnoreCase) ?? false))
                {
                    offenders.Add($"{dto.Name}.{property.Name}" + (jsonName is null ? "" : $" (\"{jsonName}\")"));
                }
            }
        }

        offenders.Should().BeEmpty(
            "the organization is a STAFF/PLATFORM tier (XC-002) — no participant-facing response may disclose "
            + "another concept-layer's tenant id, and no request DTO may ACCEPT one, because a client-supplied "
            + "tenant is the cross-customer analogue of the client-supplied exerciseId COR-001 forbids. Scope "
            + "comes only from IOrganizationContext / the authenticated staff user's own row. If a genuine "
            + "org-admin surface later needs to name a tenant, that is a deliberate staff-only DTO and this "
            + "guard should be narrowed to participant-facing DTOs rather than deleted. Offending member(s): "
            + string.Join(", ", offenders));
    }

    [Fact]
    public void TheOrganizationEntity_IsNeitherExerciseScopedNorOrganizationOwned_BecauseItIsTheTenantRoot()
    {
        // Structural: the aggregate root of a tier never carries that tier's marker (exactly as Exercise
        // carries no IExerciseScoped). Getting this wrong would make Organization filter itself out of
        // existence and break every tenant resolution.
        typeof(IOrganizationOwned).IsAssignableFrom(typeof(Organization)).Should().BeFalse(
            "Organization IS the tenant scope — its own Id is what every IOrganizationOwned row points at");
        typeof(IExerciseScoped).IsAssignableFrom(typeof(Organization)).Should().BeFalse(
            "the customer tenant sits ABOVE the exercise and cannot belong to one");
    }

    [Fact]
    public void TheOrgOwnedEntitySet_IsExactlyTheStaffAndPlatformTier_WithNoParticipantContentOnIt()
    {
        // The org axis must never creep onto participant content. An IExerciseScoped entity that also became
        // IOrganizationOwned would carry a de-normalized second copy of the tenant that could drift out of
        // sync with Exercise.OrganizationId — a strictly worse guarantee than the one derived from it.
        var orgOwnedParticipantEntities = typeof(PulseDbContext).Assembly
            .GetTypes()
            .Where(type => typeof(IOrganizationOwned).IsAssignableFrom(type) && type is { IsClass: true, IsAbstract: false })
            .Where(type => typeof(IExerciseScoped).IsAssignableFrom(type))
            .Select(type => type.Name)
            .ToList();

        orgOwnedParticipantEntities.Should().BeEmpty(
            "an exercise belongs to exactly one organization, so every IExerciseScoped row is ALREADY bounded "
            + "by its exercise's tenant. Adding OrganizationId to one buys no isolation and creates a second "
            + "copy of the truth that can drift. Offending entity type(s): "
            + string.Join(", ", orgOwnedParticipantEntities));
    }
}
