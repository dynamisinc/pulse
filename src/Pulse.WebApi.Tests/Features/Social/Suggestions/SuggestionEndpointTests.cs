namespace Pulse.WebApi.Tests.Features.Social.Suggestions;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Social.Follows;

/// <summary>
/// End-to-end coverage of <c>GET /api/personas/suggestions</c> (<c>profiles-social-graph/08</c>, Gate-2
/// finding CR-001) through the REAL <c>Program</c> host and REAL SQL Server: the deterministic order, the two
/// server-side exclusions, the deliberately-eligible SOC-052 lookalike, the ids-only wire shape, the
/// <c>limit</c> cap, the always-Critical cross-exercise isolation, and the fail-closed outcomes.
/// </summary>
/// <remarks>
/// Every test drives the genuine pipeline — host→exercise resolution, then session authentication, then the
/// endpoint — with the viewer persona coming ONLY from the persisted session. Nothing here overrides the
/// exercise scope. All tests are <see cref="RequiresDockerFactAttribute"/>: a real <c>Skipped</c> without a
/// SQL target, never a silent pass.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public class SuggestionEndpointTests
{
    private const string SuggestionsPath = "/api/personas/suggestions";

    private readonly MsSqlContainerFixture _fixture;

    public SuggestionEndpointTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // ---------------------------------------------------------------------------------------------
    // AC1 — deterministic, planner-seeded (un-ranked) order
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Suggestions_AreReturnedInAStableDeterministicOrder_AcrossRepeatedReads()
    {
        var world = await SeedWorldAsync();

        await using var host = CreateHost();
        using var client = host.CreateClientFor(world.Host, world.Token);

        var first = await ReadSuggestionsAsync(client);
        var second = await ReadSuggestionsAsync(client);

        first.Should().Equal(
            [world.Alpha.ToString(), world.Lookalike.ToString(), world.Delta.ToString(), world.Echo.ToString()],
            "the order is the contract the client relays unmodified — a stable handle order, not a computed "
            + "ranking (SOC-053: planner-seeded, CTL-021-adjustable later)");
        second.Should().Equal(
            first, "the same exercise must return the same sequence on every read, or `limit` is meaningless");
    }

    // ---------------------------------------------------------------------------------------------
    // AC2 — the two server-side exclusions
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Suggestions_NeverIncludeTheCallersOwnPersona()
    {
        var world = await SeedWorldAsync();

        await using var host = CreateHost();
        using var client = host.CreateClientFor(world.Host, world.Token);

        var ids = await ReadSuggestionsAsync(client);

        ids.Should().NotContain(
            world.Viewer.ToString(),
            "there is no participant-meaningful 'follow yourself' — and the viewer's handle sorts in the MIDDLE "
            + "of this cast, so its absence cannot be an artifact of the cap or the ordering");
        ids.Should().HaveCount(
            world.CastSize - 1, "exactly one persona (the viewer) is excluded from an otherwise-unfollowed cast");
    }

    [RequiresDockerFact]
    public async Task Suggestions_ExcludeAlreadyFollowedAccounts_ServerSide()
    {
        var world = await SeedWorldAsync();

        await using var host = CreateHost();
        using var client = host.CreateClientFor(world.Host, world.Token);

        (await client.PostAsync(FollowUri(world.Delta), content: null)).StatusCode.Should().Be(HttpStatusCode.OK);

        var ids = await ReadSuggestionsAsync(client);

        ids.Should().NotContain(
            world.Delta.ToString(),
            "a followed account is excluded by the SERVER: shipping it and letting the client filter is both "
            + "wasteful and racy against the client's own just-completed follow write");
        ids.Should().Equal(
            [world.Alpha.ToString(), world.Lookalike.ToString(), world.Echo.ToString()],
            "removing one entry does not disturb the order of the rest");
    }

    // ---------------------------------------------------------------------------------------------
    // AC3 — the SOC-052 lookalike is ELIGIBLE (D1-R1 / D1-008)
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task AnUnverifiedLookalike_CanAppearInTheSuggestions_TheModuleNeverVouchesForAnyone()
    {
        var world = await SeedWorldAsync();

        await using var host = CreateHost();
        using var client = host.CreateClientFor(world.Host, world.Token);

        var ids = await ReadSuggestionsAsync(client);

        ids.Should().Contain(
            world.Lookalike.ToString(),
            "steering attention onto an unverified lookalike is a legitimate controller lever — the module "
            + "does not vouch for anyone, so Verified is neither a filter nor a sort key (D1-R1/D1-008)");
        ids.IndexOf(world.Lookalike.ToString()).Should().Be(
            1,
            "and it is not sorted DOWN either: it holds its natural position ahead of two verified-agnostic "
            + "ordinary accounts");
    }

    [RequiresDockerFact]
    public async Task ANonCastablePersona_IsNotExcluded_CastableGatesTheEngineNotAHumanFollow()
    {
        // The trap this test exists to fail on: Persona.Castable gates whether the ENGINE may voice a persona.
        // Both seeded SOC-052 accounts ship Castable=false, so quietly reusing that column as an eligibility
        // filter here would silently delete the impersonator from the suggestion module.
        var world = await SeedWorldAsync();

        await using (var verify = _fixture.CreateContext())
        {
            var row = await verify.Personas.IgnoreQueryFilters().SingleAsync(p => p.Id == world.Lookalike);
            row.Castable.Should().BeFalse("this test is meaningless unless the persona really is non-castable");
        }

        await using var host = CreateHost();
        using var client = host.CreateClientFor(world.Host, world.Token);

        (await ReadSuggestionsAsync(client)).Should().Contain(
            world.Lookalike.ToString(),
            "Castable is an ENGINE-voicing gate, not a follow-eligibility gate — excluding non-castable "
            + "personas would defeat the SOC-052 impersonation training this cast exists for");
    }

    // ---------------------------------------------------------------------------------------------
    // AC4 — XC-002 / SOC-052: ids only on the wire
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Response_IsABareArrayOfIdStrings_WithNoPersonaTypeCastableOrArchetypeTell()
    {
        var world = await SeedWorldAsync();

        await using var host = CreateHost();
        using var client = host.CreateClientFor(world.Host, world.Token);

        var response = await client.GetAsync(new Uri(SuggestionsPath, UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadAsStringAsync();

        using var document = JsonDocument.Parse(body);
        document.RootElement.ValueKind.Should().Be(
            JsonValueKind.Array,
            "the frozen client (`resolveSuggestedFollowIds`) type-guards the body with isStringArray and THROWS "
            + "on an envelope — which would fail closed into the very error panel this story removes");
        document.RootElement.EnumerateArray().Should().OnlyContain(
            element => element.ValueKind == JsonValueKind.String, "ids only — never resolved persona objects");

        body.Should().NotContain("personaType", "story 06 closed this machine-readable impersonator tell (D1-008)");
        body.Should().NotContain("bad-actor", "and no archetype VALUE may ride along either");
        body.Should().NotContain("castable", "the engine-voicing gate is server-side authoring state (XC-002)");
        body.Should().NotContain("verified", "the suggestion wire carries no credibility signal at all");
    }

    [RequiresDockerFact]
    public async Task SuggestedIds_MatchThePersonaReadsIdsExactly_SoTheClientCanResolveEveryRow()
    {
        // The id-shape guard: useWhoToFollow resolves each suggested id against usePersonas() (GET
        // /api/personas) by STRING equality, silently skipping anything it cannot resolve. SQL Server renders a
        // uniqueidentifier in UPPERCASE, so a Guid→string conversion pushed into the query would return ids
        // that match nothing and render an empty module while every call returned 200.
        var world = await SeedWorldAsync();

        await using var host = CreateHost();
        using var client = host.CreateClientFor(world.Host, world.Token);

        var suggested = await ReadSuggestionsAsync(client);
        var personaIds = await ReadPersonaIdsAsync(client);

        suggested.Should().NotBeEmpty();
        suggested.Should().BeSubsetOf(
            personaIds,
            "every suggested id must be resolvable, character-for-character, against the persona read the "
            + "client converges it with");
        suggested.Should().OnlyContain(
            id => id == id.ToLowerInvariant(), "and stay in the lowercase form GET /api/personas emits");
    }

    // ---------------------------------------------------------------------------------------------
    // AC5 — the limit the client passes
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Limit_CapsTheResponse_ToThePrefixOfTheSameOrder()
    {
        var world = await SeedWorldAsync();

        await using var host = CreateHost();
        using var client = host.CreateClientFor(world.Host, world.Token);

        var capped = await ReadSuggestionsAsync(client, "?limit=3");
        var uncapped = await ReadSuggestionsAsync(client);

        capped.Should().HaveCount(3, "the mounted module asks for limit=3");
        capped.Should().Equal(
            uncapped.Take(3), "a cap is a PREFIX of the full order — it never reshuffles or re-ranks anything");
    }

    [RequiresDockerFact]
    public async Task Limit_LargerThanTheCast_ReturnsTheWholeEligibleSet_NotAnError()
    {
        var world = await SeedWorldAsync();

        await using var host = CreateHost();
        using var client = host.CreateClientFor(world.Host, world.Token);

        (await ReadSuggestionsAsync(client, "?limit=500")).Should().HaveCount(
            world.CastSize - 1, "asking for more than exists is satisfied by everything that exists");
    }

    [RequiresDockerFact]
    public async Task Limit_ThatIsNotAPositiveInteger_Is400_NeverSilentlyIgnored()
    {
        var world = await SeedWorldAsync();

        await using var host = CreateHost();
        using var client = host.CreateClientFor(world.Host, world.Token);

        foreach (var query in new[] { "?limit=0", "?limit=-1", "?limit=three", "?limit=" })
        {
            (await client.GetAsync(new Uri(SuggestionsPath + query, UriKind.Relative)))
                .StatusCode.Should().Be(
                    HttpStatusCode.BadRequest,
                    $"'{query}' must be rejected — silently ignoring it would serve MORE rows than the caller "
                    + "asked for and hide the bug");
        }
    }

    // ---------------------------------------------------------------------------------------------
    // AC6 — cross-exercise isolation (always-Critical, COR-001)
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Suggestions_NeverContainAnotherExercisesPersona_AndTheRowsProvablyExist()
    {
        var worldA = await SeedWorldAsync();
        var worldB = await SeedWorldAsync();

        // Positively assert exercise B's cast really exists — so an absence below is the filter closing the
        // door, not an empty table.
        await using (var verify = _fixture.CreateContext())
        {
            var countInB = await verify.Personas.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == worldB.Exercise);
            countInB.Should().Be(worldB.CastSize, "exercise B's personas must exist for this test to mean anything");
        }

        await using var host = CreateHost();
        using var client = host.CreateClientFor(worldA.Host, worldA.Token);

        var response = await client.GetAsync(new Uri(SuggestionsPath, UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadAsStringAsync();

        foreach (var idInB in worldB.AllPersonaIds)
        {
            body.Should().NotContain(
                idInB.ToString(),
                "a participant must never be suggested another exercise's persona (COR-001, always-Critical)");
        }

        using var document = JsonDocument.Parse(body);
        document.RootElement.GetArrayLength().Should().Be(
            worldA.CastSize - 1,
            "and the SIZE of the set must not leak another exercise's cast size either");
    }

    [RequiresDockerFact]
    public async Task ASessionFromAnotherExercise_IsRefused_RatherThanServedThisExercisesCast()
    {
        // Defense in depth: a token bound to exercise B presented against exercise A's host. The scope/session
        // disagreement is resolved by REFUSING, never by serving A's cast to B's viewer.
        var worldA = await SeedWorldAsync();
        var worldB = await SeedWorldAsync();

        await using var host = CreateHost();
        using var client = host.CreateClientFor(worldA.Host, worldB.Token);

        var response = await client.GetAsync(new Uri(SuggestionsPath, UriKind.Relative));

        response.StatusCode.Should().BeOneOf(
            [HttpStatusCode.Forbidden, HttpStatusCode.Unauthorized],
            "a cross-exercise session must fail closed — an identity that belongs somewhere ELSE is refused, "
            + "which is a different case from having no identity at all (that one is served)");

        var body = await response.Content.ReadAsStringAsync();
        foreach (var idInA in worldA.AllPersonaIds)
        {
            body.Should().NotContain(idInA.ToString(), "and certainly must not leak exercise A's cast");
        }
    }

    // ---------------------------------------------------------------------------------------------
    // AC7 — fail-closed outcomes
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task UnresolvedScope_Returns401_NotAnEmptyOk()
    {
        _ = await SeedWorldAsync();

        await using var host = CreateHost();
        using var client = host.CreateClientFor($"unknown-{Guid.NewGuid():N}.example.com", bearerToken: null);

        (await client.GetAsync(new Uri(SuggestionsPath, UriKind.Relative))).StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "an unresolved exercise scope fails closed (COR-001) — an empty 200 would read as 'nobody to "
            + "suggest' rather than 'you are not scoped'");
    }

    [RequiresDockerFact]
    public async Task UnboundViewer_IsServedTheUnpersonalizedList_NotRefused()
    {
        // Coordinator-resolved (see the story's "Open decision"): a participant whose session carries no
        // persona binding still reaches the participant shell and the mounted module. Refusing would hand that
        // population the same permanent "Suggestions aren't available right now." panel CR-001 exists to remove.
        // The isolation boundary is untouched — only the two VIEWER-relative exclusions stop applying, because
        // there is no viewer to exclude against.
        var world = await SeedWorldAsync();

        await using var host = CreateHost();
        using var client = host.CreateClientFor(world.Host, bearerToken: null);

        var ids = await ReadSuggestionsAsync(client);

        ids.Should().Equal(
            [
                world.Alpha.ToString(),
                world.Lookalike.ToString(),
                world.Viewer.ToString(),
                world.Delta.ToString(),
                world.Echo.ToString(),
            ],
            "an unbound viewer gets the WHOLE in-scope cast in the same order — nothing is excluded 'as self', "
            + "and nothing is exposed that GET /api/personas does not already serve the same caller");
    }

    [RequiresDockerFact]
    public async Task UnboundViewer_IsStillExerciseScoped_NeverAnotherExercisesCast()
    {
        // The half of the unbound path that IS a hard boundary: dropping the viewer exclusions must not have
        // dropped the scope with them.
        var worldA = await SeedWorldAsync();
        var worldB = await SeedWorldAsync();

        await using (var verify = _fixture.CreateContext())
        {
            (await verify.Personas.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == worldB.Exercise))
                .Should().Be(worldB.CastSize, "exercise B's cast must exist for this test to mean anything");
        }

        await using var host = CreateHost();
        using var client = host.CreateClientFor(worldA.Host, bearerToken: null);

        var response = await client.GetAsync(new Uri(SuggestionsPath, UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadAsStringAsync();

        foreach (var idInB in worldB.AllPersonaIds)
        {
            body.Should().NotContain(
                idInB.ToString(),
                "scope comes from IExerciseContext and the central query filter, NOT from the viewer identity "
                + "— an anonymous caller is scoped exactly as a bound one is (COR-001)");
        }

        using var document = JsonDocument.Parse(body);
        document.RootElement.GetArrayLength().Should().Be(
            worldA.CastSize, "and the SIZE must not leak another exercise's cast size either");
    }

    // ---------------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------------

    private static Uri FollowUri(Guid personaId) => new($"/api/personas/{personaId}/follow", UriKind.Relative);

    private FollowTestHost CreateHost()
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string first");
        return new FollowTestHost(_fixture.ConnectionString!);
    }

    private static async Task<List<string>> ReadSuggestionsAsync(HttpClient client, string query = "")
    {
        var response = await client.GetAsync(new Uri(SuggestionsPath + query, UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.EnumerateArray().Select(element => element.GetString()!).ToList();
    }

    private static async Task<IReadOnlyList<string>> ReadPersonaIdsAsync(HttpClient client)
    {
        var response = await client.GetAsync(new Uri("/api/personas", UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.EnumerateArray()
            .Select(element => element.GetProperty("id").GetString()!)
            .ToArray();
    }

    /// <summary>
    /// Seeds one self-contained exercise: a provisioned host, a five-persona cast whose handles give a KNOWN
    /// deterministic order, and a live participant session bound to the viewer persona (whose handle sorts in
    /// the middle of the cast, so the self-exclusion is observable rather than an ordering artifact).
    /// </summary>
    private async Task<SeededWorld> SeedWorldAsync()
    {
        var exerciseId = Guid.NewGuid();
        var world = new SeededWorld
        {
            Exercise = exerciseId,
            Host = $"suggest-{exerciseId:N}.example.com",
            Alpha = Guid.NewGuid(),
            Lookalike = Guid.NewGuid(),
            Viewer = Guid.NewGuid(),
            Delta = Guid.NewGuid(),
            Echo = Guid.NewGuid(),
            Token = $"suggest-token-{Guid.NewGuid():N}",
        };

        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            Id = exerciseId,
            Name = $"Exercise {exerciseId:N}",
            Hostname = world.Host,
            TimeZone = "America/Chicago",
            Status = "active",
            CurrentScenarioTime = new DateTimeOffset(2033, 9, 4, 9, 30, 0, TimeSpan.Zero),
        });

        // Handle order (the endpoint's stable order): alpha < bravo < charlie < delta < echo.
        seed.Personas.Add(NewPersona(world.Alpha, exerciseId, "alpha", verified: true, castable: true, "agency"));
        seed.Personas.Add(NewPersona(world.Lookalike, exerciseId, "bravo", verified: false, castable: false, "bad-actor"));
        seed.Personas.Add(NewPersona(world.Viewer, exerciseId, "charlie", verified: false, castable: true, "citizen"));
        seed.Personas.Add(NewPersona(world.Delta, exerciseId, "delta", verified: false, castable: true, "citizen"));
        seed.Personas.Add(NewPersona(world.Echo, exerciseId, "echo", verified: false, castable: true, "citizen"));
        seed.Sessions.Add(FollowTestHost.NewSession(world.Token, exerciseId, world.Viewer));
        await seed.SaveChangesAsync();

        return world;
    }

    private static Persona NewPersona(
        Guid id,
        Guid exerciseId,
        string handle,
        bool verified,
        bool castable,
        string personaType) => new()
        {
            Id = id,
            ExerciseId = exerciseId,
            DisplayName = $"Persona {handle}",
            Handle = handle,
            Kind = "human",
            Verified = verified,
            Castable = castable,
            PersonaType = personaType,
        };

    /// <summary>One seeded exercise world — its host, its ordered cast, and the viewer's session token.</summary>
    private sealed class SeededWorld
    {
        public required Guid Exercise { get; init; }

        public required string Host { get; init; }

        /// <summary>Handle <c>alpha</c> — a verified, castable official voice; first in the order.</summary>
        public required Guid Alpha { get; init; }

        /// <summary>Handle <c>bravo</c> — the UNVERIFIED, NON-CASTABLE SOC-052 lookalike; second in the order.</summary>
        public required Guid Lookalike { get; init; }

        /// <summary>Handle <c>charlie</c> — the session's own persona; sorts in the MIDDLE of the cast.</summary>
        public required Guid Viewer { get; init; }

        /// <summary>Handle <c>delta</c> — an ordinary account (the one the follow-exclusion test follows).</summary>
        public required Guid Delta { get; init; }

        /// <summary>Handle <c>echo</c> — an ordinary account; last in the order.</summary>
        public required Guid Echo { get; init; }

        public required string Token { get; init; }

        /// <summary>The number of personas seeded into this exercise (the viewer included).</summary>
        public int CastSize => 5;

        /// <summary>Every persona id in this exercise — used to assert another exercise's body contains none of them.</summary>
        public IEnumerable<Guid> AllPersonaIds => [Alpha, Lookalike, Viewer, Delta, Echo];
    }
}
