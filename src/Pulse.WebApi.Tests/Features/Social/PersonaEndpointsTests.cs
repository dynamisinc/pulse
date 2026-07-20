namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
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
using Pulse.WebApi.Tests.Data;

/// <summary>
/// Integration tests for <c>GET /api/personas</c> (story <c>social-api/04</c>, #273). Boots the real host
/// via <see cref="WebApplicationFactory{TEntryPoint}"/> (reusing <c>telemetry/02</c>'s test-host pattern:
/// <c>ConnectionStrings__DefaultConnection</c> set before <c>builder.Build()</c>), pointed at the shared
/// Testcontainers SQL Server (<see cref="MsSqlContainerFixture"/>), then drives the endpoint over HTTP.
/// Exercise scope is set per test via a <c>ConfigureTestServices</c> override of <see cref="IExerciseContext"/>
/// (COR-001) — the client itself can never supply/override an exerciseId. Covers XC-005/COR-003 (exercise-
/// scoped instance read, including the same-template two-exercise no-collision case extending the standing
/// <c>exercise-isolation/07</c> suite), the <c>isValidPersona</c> response shape, XC-002 (no field beyond the
/// shipped <c>Persona</c> contract — asserted at the wire/JSON level, not merely unread), and the fail-closed
/// 401 on an unresolved scope.
/// </summary>
/// <remarks>
/// Every test is <see cref="RequiresDockerFactAttribute"/> (Gate-1 W-001): a real <c>Skipped</c> on a
/// Docker-less machine, never a silent <c>Passed</c>. The assembly disables cross-class parallelization (see
/// <c>AssemblyInfo.cs</c>), so the process-wide connection-string env var this factory sets can't race
/// another class's host build.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public class PersonaEndpointsTests
{
    private static readonly Uri PersonasUri = new("/api/personas", UriKind.Relative);

    /// <summary>
    /// The exact JSON property set the shipped, frozen <c>Persona</c> contract (<c>personas/types.ts:84-101</c>)
    /// allows — anything outside this set (in particular a provenance/operator/session field) is an XC-002
    /// violation. <c>bio</c> is contract-optional and, per <c>PersonaResponseDto</c>'s own documented
    /// behaviour, never emitted this phase, so it is intentionally NOT in this allow-list — its presence
    /// would also fail the exact-set assertion below, which is fine: either shape is contract-valid, but the
    /// test pins the one this service actually produces today.
    /// </summary>
    private static readonly HashSet<string> AllowedPersonaFields =
    [
        "id", "exerciseId", "templateId", "displayName", "handle", "kind", "personaType", "verified",
        "avatarColor", "initials", "audienceBand", "followerCount", "joinedAt",
    ];

    /// <summary>
    /// The specific provenance/session keys the harness contract calls out by name (XC-002) — never present
    /// on a participant-facing persona payload, even though nothing on the current <c>Persona</c> entity
    /// would produce them yet. Asserted explicitly, by name, in addition to the exact-set check above.
    /// </summary>
    private static readonly string[] ForbiddenProvenanceFields =
        ["origin", "actingHumanId", "createdWallClock", "injectId", "operatorId", "sessionId", "controllerId"];

    private readonly MsSqlContainerFixture _fixture;

    public PersonaEndpointsTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task ScopedRequest_ReturnsExactlyExerciseAPersonas_EachSatisfyingIsValidPersona()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var personaA1 = NewPersona(Guid.NewGuid(), exerciseA, kind: "human", verified: true);
        var personaA2 = NewPersona(Guid.NewGuid(), exerciseA, kind: "org", verified: false);
        var personaB = NewPersona(Guid.NewGuid(), exerciseB, kind: "human", verified: false);

        await using (var seed = _fixture.CreateContext())
        {
            seed.Personas.AddRange(personaA1, personaA2, personaB);
            await seed.SaveChangesAsync();
        }

        await using var factory = CreateFactory(exerciseA);
        using var client = factory.CreateClient();

        var response = await client.GetAsync(PersonasUri);
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var items = doc.RootElement.EnumerateArray().ToList();

        items.Should().HaveCount(
            2, "the response must contain exactly exercise A's two seeded personas, never B's");

        var ids = items.Select(e => e.GetProperty("id").GetString()).ToList();
        ids.Should().BeEquivalentTo([personaA1.Id.ToString(), personaA2.Id.ToString()]);
        ids.Should().NotContain(personaB.Id.ToString(), "a scope-A request must never return exercise B's persona");

        foreach (var item in items)
        {
            AssertIsValidPersona(item);
        }
    }

    [RequiresDockerFact]
    public async Task SameTemplate_TwoExercises_ScopeA_NeverReturnsExerciseBInstance_NoCollision()
    {
        // COR-003 "no collision": A and B each instantiate a persona from the SAME PersonaTemplateId — a
        // naive template-keyed (rather than exercise-scoped) lookup could conflate them.
        var templateId = Guid.NewGuid();
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var personaA = NewPersona(Guid.NewGuid(), exerciseA, kind: "human", verified: false, templateId: templateId);
        var personaB = NewPersona(Guid.NewGuid(), exerciseB, kind: "human", verified: true, templateId: templateId);

        await using (var seed = _fixture.CreateContext())
        {
            seed.Personas.AddRange(personaA, personaB);
            await seed.SaveChangesAsync();
        }

        await using var factory = CreateFactory(exerciseA);
        using var client = factory.CreateClient();

        var response = await client.GetAsync(PersonasUri);
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var items = doc.RootElement.EnumerateArray().ToList();

        items.Should().ContainSingle(
            "exercise A seeded exactly one persona, sharing a template with exercise B's — the shared "
            + "templateId must not cause a collision that also returns/merges B's instance");

        var only = items.Single();
        only.GetProperty("id").GetString().Should().Be(personaA.Id.ToString());
        only.GetProperty("templateId").GetString().Should().Be(
            templateId.ToString(), "the returned instance still carries the shared templateId verbatim");
        only.GetProperty("id").GetString().Should().NotBe(
            personaB.Id.ToString(), "exercise B's same-template instance must never appear under exercise A's scope");
    }

    [RequiresDockerFact]
    public async Task Response_ContainsOnlyShippedPersonaFields_NoProvenanceOrOperatorLeak()
    {
        var exerciseA = Guid.NewGuid();
        var persona = NewPersona(Guid.NewGuid(), exerciseA, kind: "org", verified: true);

        await using (var seed = _fixture.CreateContext())
        {
            seed.Personas.Add(persona);
            await seed.SaveChangesAsync();
        }

        await using var factory = CreateFactory(exerciseA);
        using var client = factory.CreateClient();

        var response = await client.GetAsync(PersonasUri);
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var item = doc.RootElement.EnumerateArray().Single(e => e.GetProperty("id").GetString() == persona.Id.ToString());

        var actualFields = item.EnumerateObject().Select(p => p.Name).ToHashSet();

        actualFields.Should().BeEquivalentTo(
            AllowedPersonaFields,
            "the wire payload must carry exactly the shipped Persona contract's fields — no more, no fewer "
            + "(XC-002: a future staff-only presence/operator field must never leak onto this participant-facing shape)");

        foreach (var forbidden in ForbiddenProvenanceFields)
        {
            item.TryGetProperty(forbidden, out _).Should().BeFalse(
                $"'{forbidden}' is a provenance/operator/session key and must be wire-ABSENT, not merely unread (XC-002)");
        }
    }

    [RequiresDockerFact]
    public async Task UnresolvedScope_Returns401_NotEmptyOkOrUnscopedData()
    {
        // No ConfigureTestServices override: IExerciseContext is the default-registered ExerciseContext,
        // which starts UNSET (CurrentExerciseId is null) — exactly the fail-closed "no per-request scope
        // resolution yet" case the endpoint itself must refuse outright, per PersonaEndpoints' own doc.
        await using var factory = CreateFactory(exerciseId: null);
        using var client = factory.CreateClient();

        var response = await client.GetAsync(PersonasUri);

        response.StatusCode.Should().BeOneOf(HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden);
    }

    [RequiresDockerFact]
    public async Task Persona_MigrationRoundTrip_PersistsKindAndVerified()
    {
        // Nice-to-have per the story's Tests section: Kind/Verified (this story's schema addition) survive a
        // real round trip through a SEPARATE read context, against a real SQL Server (Testcontainers), not
        // just an in-memory change tracker.
        var exerciseId = Guid.NewGuid();
        var personaId = Guid.NewGuid();
        var persona = NewPersona(personaId, exerciseId, kind: "org", verified: true);

        await using (var writeContext = _fixture.CreateContext())
        {
            writeContext.Personas.Add(persona);
            await writeContext.SaveChangesAsync();
        }

        await using var readContext = _fixture.CreateContext();
        var reloaded = await readContext.Personas.IgnoreQueryFilters().SingleAsync(p => p.Id == personaId);

        reloaded.Kind.Should().Be("org");
        reloaded.Verified.Should().BeTrue();
    }

    private static void AssertIsValidPersona(JsonElement item)
    {
        item.GetProperty("id").GetString().Should().NotBeNullOrWhiteSpace();
        item.GetProperty("displayName").GetString().Should().NotBeNullOrWhiteSpace();
        item.GetProperty("handle").GetString().Should().NotBeNullOrWhiteSpace();
        item.GetProperty("kind").GetString().Should().BeOneOf("human", "org");
        item.GetProperty("verified").ValueKind.Should().BeOneOf(JsonValueKind.True, JsonValueKind.False);
    }

    private static Persona NewPersona(Guid id, Guid exerciseId, string kind, bool verified, Guid? templateId = null) => new()
    {
        Id = id,
        ExerciseId = exerciseId,
        DisplayName = $"Persona {id:N}",
        Handle = $"@p_{id:N}",
        Kind = kind,
        Verified = verified,
        PersonaTemplateId = templateId,
    };

    private PersonaWebApplicationFactory CreateFactory(Guid? exerciseId)
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");
        return new PersonaWebApplicationFactory(_fixture.ConnectionString!, exerciseId);
    }
}

/// <summary>
/// Boots the real <c>Program</c> host with <c>ConnectionStrings__DefaultConnection</c> set (in the
/// constructor, before the host's config is captured) to the shared Testcontainers database — same pattern
/// as <c>Telemetry/TelemetryIngestTests</c>' <c>TelemetryWebApplicationFactory</c>. <c>Program.cs</c> now
/// owns the composition root: it calls <c>AddSocialPersonaRead()</c> and maps
/// <c>MapSocialPersonaEndpoints()</c> itself, so the booted host already serves <c>GET /api/personas</c> and
/// this factory no longer self-maps it (a second mapping would DOUBLE-MAP the route and raise an
/// <c>AmbiguousMatchException</c> at request time). It optionally swaps the registered
/// <see cref="IExerciseContext"/> for a fixed scope so a request-scoped read test doesn't depend on
/// per-request scope resolution landing (Phase B2) — a <c>null</c> <paramref name="exerciseId"/> leaves the
/// default (UNSET) registration in place, for the fail-closed 401 case.
/// </summary>
public sealed class PersonaWebApplicationFactory : WebApplicationFactory<Program>
{
    private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

    private readonly Guid? _exerciseId;

    public PersonaWebApplicationFactory(string connectionString, Guid? exerciseId)
    {
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);
        _exerciseId = exerciseId;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        if (_exerciseId is { } exerciseId)
        {
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IExerciseContext>();
                services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = exerciseId });
            });
        }
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
    }
}
