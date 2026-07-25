namespace Pulse.WebApi.Tests.Features.Ops.EngineContentSeed;

using System;
using System.Globalization;
using System.Runtime.CompilerServices;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Ops.EngineContentSeed;
using Xunit;

/// <summary>
/// Model-only (no database, so plain <see cref="FactAttribute"/>) coverage of
/// <c>profiles-social-graph/06</c>'s derivations: the SOC-054 audience magnitude and the COR-021/COR-023
/// backdated scenario join instant. These are the documented PARITY assertions against the frontend mock's
/// <c>features/personas/seedCast.ts</c> (<c>BAND_BASE</c> + <c>deriveFollowerCount</c> +
/// <c>deriveJoinedAt</c>): the expected values below were computed by running that module's own arithmetic
/// over the live catalog's handles, so a drift on either side fails here.
/// </summary>
public sealed class PersonaCastDerivationTests
{
    /// <summary>The frontend <c>BAND_BASE</c> floors (<c>seedCast.ts</c>), duplicated here as the parity oracle.</summary>
    public static TheoryData<string, int> BandFloors => new()
    {
        { "nano", 450 },
        { "micro", 4800 },
        { "mid", 46000 },
        { "large", 220000 },
        { "mega", 1500000 },
    };

    /// <summary>Per-handle magnitudes the frontend derivation produces for the live nine-persona catalog.</summary>
    public static TheoryData<string, string, int> MagnitudeParityCast => new()
    {
        { "FairhavenWater", "mid", 50232 },
        { "FairhavenWaterUpd", "nano", 550 },
        { "FulcoEM", "mid", 54095 },
        { "Newsline7", "large", 276540 },
        { "TheScoopHQ", "mid", 50186 },
        { "mvega_fh", "micro", 5913 },
        { "tbrandt41", "nano", 568 },
        { "kwardFH", "micro", 5577 },
        { "dreyes_fh", "nano", 496 },
    };

    /// <summary>Per-handle backdated join instants the frontend derivation produces for the same catalog.</summary>
    public static TheoryData<string, string, string> JoinedAtParityCast => new()
    {
        { "FairhavenWater", "agency", "2025-07-08T12:00:00Z" },
        { "FairhavenWaterUpd", "bad-actor", "2026-06-09T12:00:00Z" },
        { "FulcoEM", "agency", "2025-09-22T12:00:00Z" },
        { "Newsline7", "news-outlet", "2024-08-17T12:00:00Z" },
        { "TheScoopHQ", "influencer", "2025-07-09T12:00:00Z" },
        { "mvega_fh", "citizen", "2024-06-23T12:00:00Z" },
        { "tbrandt41", "citizen", "2025-06-27T12:00:00Z" },
        { "kwardFH", "citizen", "2025-10-06T12:00:00Z" },
        { "dreyes_fh", "citizen", "2025-06-26T12:00:00Z" },
    };

    [Theory]
    [MemberData(nameof(MagnitudeParityCast))]
    public void DeriveAudienceMagnitude_MatchesTheFrontendMock_ForTheSameHandleAndBand(
        string handle, string band, int expectedMagnitude)
    {
        PersonaCastSeeder.DeriveAudienceMagnitude(band, handle).Should().Be(
            expectedMagnitude,
            "the live seed and the frontend mock (seedCast.ts deriveFollowerCount) must agree on the same "
            + "handle/band pairing so a mock→live flip does not change a rendered follower count");
    }

    [Theory]
    [MemberData(nameof(JoinedAtParityCast))]
    public void DeriveJoinedAt_MatchesTheFrontendMock_AndAlwaysPredatesTheEpoch(
        string handle, string personaType, string expectedJoinedAt)
    {
        var joinedAt = PersonaCastSeeder.DeriveJoinedAt(personaType, handle);

        joinedAt.Should().Be(
            DateTimeOffset.Parse(expectedJoinedAt, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal),
            "the join instant mirrors seedCast.ts's deriveJoinedAt exactly (COR-021)");
        joinedAt.Should().BeBefore(
            PersonaCastSeeder.SeedEpoch, "every seeded join instant PREDATES the exercise (COR-023)");
    }

    [Theory]
    [MemberData(nameof(BandFloors))]
    public void DeriveAudienceMagnitude_StaysWithinTheBandsFloorPlusForty(string band, int floor)
    {
        // The frontend's contract: base + up to +40% deterministic spread. Sampled across handles so the
        // band boundaries hold generally, not just for the catalog's nine.
        foreach (var handle in new[] { "a", "someHandle", "FairhavenWater", "zz_9", "TheScoopHQ" })
        {
            var magnitude = PersonaCastSeeder.DeriveAudienceMagnitude(band, handle);

            magnitude.Should().BeGreaterThanOrEqualTo(floor, $"'{band}' never falls below its floor (SOC-054)");
            magnitude.Should().BeLessThan(
                (int)(floor * 1.4), $"'{band}' spreads at most +40% above its floor, matching BAND_BASE usage");
        }
    }

    [Fact]
    public void DeriveAudienceMagnitude_IsDeterministic_AndBandOrdered()
    {
        PersonaCastSeeder.DeriveAudienceMagnitude("mid", "FulcoEM").Should().Be(
            PersonaCastSeeder.DeriveAudienceMagnitude("mid", "FulcoEM"),
            "the derivation is pure — no Random, so a re-seed never changes a persona's reach");

        PersonaCastSeeder.DeriveAudienceMagnitude("nano", "kwardFH").Should().BeLessThan(
            PersonaCastSeeder.DeriveAudienceMagnitude("micro", "kwardFH"),
            "a bigger band always means a bigger magnitude for the same handle (SOC-054 ordering)");
    }

    [Fact]
    public void DeriveAudienceMagnitude_UnknownBand_Throws_RatherThanInventingANumber()
    {
        var act = () => PersonaCastSeeder.DeriveAudienceMagnitude("colossal", "mvega_fh");

        act.Should().Throw<ArgumentOutOfRangeException>(
            "the SOC-054 vocabulary is closed — an unknown band is a bug, never a silently defaulted count");
    }

    [Fact]
    public void DeriveJoinedAt_BadActor_JoinsWithinAWeekOfTheEpoch_EstablishedPersonasJoinMuchEarlier()
    {
        var lookalike = PersonaCastSeeder.DeriveJoinedAt("bad-actor", "FairhavenWaterUpd");
        var utility = PersonaCastSeeder.DeriveJoinedAt("agency", "FairhavenWater");

        lookalike.Should().BeAfter(
            PersonaCastSeeder.SeedEpoch.AddDays(-7),
            "a bad-actor archetype joins 3-6 days before the epoch — the lookalike 'joined this week' tell (SOC-052)");
        utility.Should().BeBefore(
            PersonaCastSeeder.SeedEpoch.AddDays(-89),
            "every other archetype is an established account (~3 months to ~2 years old)");
        lookalike.Should().BeAfter(utility, "the impersonator is always the newer of the pair");
    }

    [Fact]
    public void Catalog_PassesItsAuthoringTimeGuard_BiosFitTheColumn_AndBandsAreKnown()
    {
        // S-002: the seeder's static constructor validates every authored bio against the stored column bound
        // and every authored band against the closed SOC-054 vocabulary, so an over-long bio or a typo'd band
        // fails HERE (first touch of the type) rather than as an opaque truncation at SaveChangesAsync.
        var act = () => RuntimeHelpers.RunClassConstructor(typeof(PersonaCastSeeder).TypeHandle);

        act.Should().NotThrow(
            "every catalog bio must fit Persona.MaxBioLength and every catalog band must be a known SOC-054 band");
        Persona.MaxBioLength.Should().Be(512, "the guard and the schema bound are the same constant");
    }

    [Fact]
    public void DeriveAudienceMagnitude_IsCaseSensitive_MatchingTheBadActorComparison()
    {
        // S-001: both closed vocabularies are compared ORDINALLY, so a mis-cased value fails loudly in the
        // band lookup instead of being folded there and missed by the archetype check.
        var act = () => PersonaCastSeeder.DeriveAudienceMagnitude("Mid", "FulcoEM");
        act.Should().Throw<ArgumentOutOfRangeException>("the band vocabulary is ordinal, lower-case only");

        PersonaCastSeeder.DeriveJoinedAt("BAD-ACTOR", "FairhavenWaterUpd").Should().Be(
            PersonaCastSeeder.DeriveJoinedAt("citizen", "FairhavenWaterUpd"),
            "the archetype comparison is ordinal too — a mis-cased 'bad-actor' is simply not the bad-actor "
            + "archetype, consistently with the band lookup rejecting a mis-cased band");
    }

    [Fact]
    public void SeedEpoch_IsTheFixedPreExerciseScenarioConstant_NeverTheWallClock()
    {
        PersonaCastSeeder.SeedEpoch.Should().Be(
            new DateTimeOffset(2026, 6, 15, 12, 0, 0, TimeSpan.Zero),
            "the epoch is seedCast.ts's SEED_EPOCH_MS, a hardcoded scenario instant (COR-053)");
        PersonaCastSeeder.SeedEpoch.Should().Be(
            Persona.DefaultJoinedAt, "exactly one epoch constant exists, shared with the entity's column default");
    }
}
