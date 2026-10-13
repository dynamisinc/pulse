namespace Pulse.WebApi.Tests.Features.Identity.LinkCards;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using FluentAssertions;
using System.Threading;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Primitives;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.LinkCards;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// easy-login/04: <see cref="LinkCardService"/> against real SQL. A participant whose account is enabled, whose link
/// is active and whose token decrypts gets a card (name, agency, role, sign-in name, join URL, QR of exactly that URL),
/// ordered by name. Everyone else considered is skipped with <c>notFound</c>, <c>noActiveLink</c>, <c>disabled</c> or
/// <c>tokenUnrecoverable</c>, and the request still succeeds. <c>participantIds</c> limits it to those accounts;
/// <c>all: true</c> means every participant (EL-20), and any other body shape is <see cref="LinkCardOutcome.Invalid"/>
/// (400). An unset join base is <see cref="LinkCardOutcome.JoinLinksUnavailable"/> (409) and more than
/// <c>MaxCardsPerRequest</c> ids is <see cref="LinkCardOutcome.TooManyIds"/> (400). Isolation lives in
/// <see cref="LinkCardIsolationTests"/>, telemetry in <see cref="LinkCardTelemetryTests"/>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class LinkCardServiceTests
{
    private readonly LinkCardTestWorld _world;

    public LinkCardServiceTests(MsSqlContainerFixture fixture) => _world = new LinkCardTestWorld(fixture);

    [RequiresDockerFact]
    public async Task EligibleParticipants_GetACardEach_WithEveryField_OrderedByName()
    {
        var exercise = await _world.SeedExerciseAsync(name: "Coastal Surge 2026");
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        var priya = await _world.SeedParticipantAsync(exercise, "Priya Raman", agency: "Regional Medical Center", jobRole: "Incident Commander");
        var aisha = await _world.SeedParticipantAsync(exercise, "Aisha Okafor", agency: "City Public Works");
        var madonna = await _world.SeedParticipantAsync(exercise, "Madonna");

        var result = await _world.GenerateAsync(exercise, staff);

        result.Outcome.Should().Be(LinkCardOutcome.Ok);
        var sheet = result.Sheet!;
        sheet.ExerciseName.Should().Be("Coastal Surge 2026");
        sheet.Skipped.Should().BeEmpty();
        sheet.Cards.Select(c => c.Name).Should().Equal(["Aisha Okafor", "Madonna", "Priya Raman"], "cards are ordered by name");

        var card = sheet.Cards.Single(c => c.ParticipantId == priya.AccountId.ToString());
        card.Name.Should().Be("Priya Raman");
        card.Agency.Should().Be("Regional Medical Center");
        card.Role.Should().Be("Incident Commander", "role is the free-text job label, not the exercise role");
        card.SignInName.Should().Be(priya.SignInName);
        card.JoinUrl.Should().Be(priya.JoinUrl).And.Be($"{LinkCardTestWorld.FrontendBase}/join/{priya.Token}");
        DecodedSvg(card.QrSvgDataUri).Should().Be(new QrSvgRenderer().RenderSvg(card.JoinUrl), "the QR encodes exactly the card's join URL");

        var aishaCard = sheet.Cards.Single(c => c.ParticipantId == aisha.AccountId.ToString());
        aishaCard.Agency.Should().Be("City Public Works");
        aishaCard.Role.Should().BeNull("no job label is omitted, not an empty string");

        var madonnaCard = sheet.Cards.Single(c => c.ParticipantId == madonna.AccountId.ToString());
        madonnaCard.Agency.Should().BeNull();
        madonnaCard.Role.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task EveryCardsQr_EncodesItsOwnJoinUrl_AndPassesTheFrontendGate()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "planner"));
        for (var i = 0; i < 12; i++)
        {
            await _world.SeedParticipantAsync(exercise, $"Participant {i:D2}", agency: i % 2 == 0 ? "Agency" : null);
        }

        var result = await _world.GenerateAsync(exercise, staff);

        result.Sheet!.Cards.Should().HaveCount(12);
        foreach (var card in result.Sheet.Cards)
        {
            FrontendQrGate.Admits(card.QrSvgDataUri).Should().BeTrue(
                $"the card sheet only renders a QR that passes safeQrDataUri.ts (card {card.ParticipantId})");

            DecodedSvg(card.QrSvgDataUri).Should().Be(
                new QrSvgRenderer().RenderSvg(card.JoinUrl), "each QR encodes its own card's join URL, not a neighbour's");
        }

        result.Sheet.Cards.Select(c => c.QrSvgDataUri).Should().OnlyHaveUniqueItems("every card has its own link");
    }

    [RequiresDockerFact]
    public async Task AllTrue_MeansEveryParticipant_AndEveryoneWithoutACard_IsSkippedWithTheReason()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        var active = await _world.SeedParticipantAsync(exercise, "Ann Active");
        var noLink = await _world.SeedParticipantAsync(exercise, "Ben NoLink", SeededLink.None);
        var revoked = await _world.SeedParticipantAsync(exercise, "Cal Revoked", SeededLink.Revoked);
        var disabled = await _world.SeedParticipantAsync(exercise, "Dee Disabled", disabled: true);
        var lostKeys = await _world.SeedParticipantAsync(exercise, "Eve LostKeyRing", SeededLink.LostKeyRing);

        var result = await _world.GenerateAsync(exercise, staff, ids: null);

        result.Outcome.Should().Be(LinkCardOutcome.Ok);
        result.Sheet!.Cards.Should().ContainSingle().Which.ParticipantId.Should().Be(active.AccountId.ToString());
        result.Sheet.Skipped.Select(s => (s.ParticipantId, s.Reason)).Should().Equal(
            [
                (noLink.AccountId.ToString(), RosterCardSkipReasons.NoActiveLink),
                (revoked.AccountId.ToString(), RosterCardSkipReasons.NoActiveLink),
                (disabled.AccountId.ToString(), RosterCardSkipReasons.Disabled),
                (lostKeys.AccountId.ToString(), RosterCardSkipReasons.TokenUnrecoverable),
            ],
            "every participant in the exercise is considered, and the skipped ones are listed in name order");

        var empty = await _world.GenerateAsync(exercise, staff, ids: []);
        empty.Outcome.Should().Be(LinkCardOutcome.Invalid, "an empty participantIds is refused, never read as 'everyone' (EL-20)");
        empty.Sheet.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task Ids_LimitTheSheet_ToThoseAccounts()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        var zoe = await _world.SeedParticipantAsync(exercise, "Zoe Zimmer");
        var yan = await _world.SeedParticipantAsync(exercise, "Yan Young");
        await _world.SeedParticipantAsync(exercise, "Xavier Unrequested");
        await _world.SeedParticipantAsync(exercise, "Wanda Unrequested", SeededLink.None);

        var result = await _world.GenerateAsync(exercise, staff, [zoe.AccountId.ToString(), yan.AccountId.ToString()]);

        result.Sheet!.Cards.Select(c => c.Name).Should().Equal(["Yan Young", "Zoe Zimmer"], "only the requested accounts, by name");
        result.Sheet.Skipped.Should().BeEmpty("an account that was not requested is neither a card nor a skip");
    }

    [RequiresDockerFact]
    public async Task EachSkipReason_IsReported_AndTheRequestStillSucceedsWithTheOthers()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        var ok = await _world.SeedParticipantAsync(exercise, "Okay Person");
        var noLink = await _world.SeedParticipantAsync(exercise, "No Link", SeededLink.None);
        var revoked = await _world.SeedParticipantAsync(exercise, "Revoked Link", SeededLink.Revoked);
        var disabled = await _world.SeedParticipantAsync(exercise, "Disabled Person", disabled: true);
        var disabledNoLink = await _world.SeedParticipantAsync(exercise, "Disabled NoLink", SeededLink.None, disabled: true);
        var lostKeys = await _world.SeedParticipantAsync(exercise, "Lost KeyRing", SeededLink.LostKeyRing);
        var stale = await _world.SeedParticipantAsync(exercise, "Stale Copy", SeededLink.StaleCopy);
        var noCopy = await _world.SeedParticipantAsync(exercise, "No Copy", SeededLink.NoCopy);
        var unknown = Guid.NewGuid();

        var requested = new[] { ok, noLink, revoked, disabled, disabledNoLink, lostKeys, stale, noCopy }
            .Select(p => p.AccountId.ToString())
            .Append(unknown.ToString())
            .ToList();

        var result = await _world.GenerateAsync(exercise, staff, requested);

        result.Outcome.Should().Be(LinkCardOutcome.Ok, "a skip never fails the request");
        result.Sheet!.Cards.Should().ContainSingle().Which.ParticipantId.Should().Be(ok.AccountId.ToString());

        var reasons = result.Sheet.Skipped.ToDictionary(s => s.ParticipantId, s => s.Reason);
        reasons.Should().BeEquivalentTo(new Dictionary<string, string>
        {
            [noLink.AccountId.ToString()] = RosterCardSkipReasons.NoActiveLink,
            [revoked.AccountId.ToString()] = RosterCardSkipReasons.NoActiveLink,
            [disabled.AccountId.ToString()] = RosterCardSkipReasons.Disabled,
            [disabledNoLink.AccountId.ToString()] = RosterCardSkipReasons.Disabled,
            [lostKeys.AccountId.ToString()] = RosterCardSkipReasons.TokenUnrecoverable,
            [stale.AccountId.ToString()] = RosterCardSkipReasons.TokenUnrecoverable,
            [noCopy.AccountId.ToString()] = RosterCardSkipReasons.TokenUnrecoverable,
            [unknown.ToString()] = RosterCardSkipReasons.NotFound,
        });
        result.Sheet.Skipped.Last().Should().BeEquivalentTo(
            new RosterCardSkipDto { ParticipantId = unknown.ToString(), Reason = RosterCardSkipReasons.NotFound },
            "notFound ids follow the skipped participants, in request order");
    }

    [RequiresDockerFact]
    public async Task MalformedOrBlankIds_AreNotFound_AndNeverWidenToEveryone()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        await _world.SeedParticipantAsync(exercise, "Someone Eligible");

        var result = await _world.GenerateAsync(exercise, staff, ["not-a-guid", "", "NOT-A-GUID", "not-a-guid"]);

        result.Outcome.Should().Be(LinkCardOutcome.Ok);
        result.Sheet!.Cards.Should().BeEmpty("a request that names ids, however malformed, never means 'everyone'");
        result.Sheet.Skipped.Should().BeEquivalentTo(
            new[]
            {
                new RosterCardSkipDto { ParticipantId = "not-a-guid", Reason = RosterCardSkipReasons.NotFound },
                new RosterCardSkipDto { ParticipantId = string.Empty, Reason = RosterCardSkipReasons.NotFound },
            },
            options => options.WithStrictOrdering(),
            "each distinct value (case-insensitively) is reported once, as first sent, in request order");
    }

    [RequiresDockerFact]
    public async Task ARepeatedId_GivesOneCard()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        var person = await _world.SeedParticipantAsync(exercise, "Repeated Person");
        var id = person.AccountId.ToString();

        var result = await _world.GenerateAsync(exercise, staff, [id, id.ToUpperInvariant(), id]);

        result.Sheet!.Cards.Should().ContainSingle().Which.ParticipantId.Should().Be(id);
        result.Sheet.Skipped.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task EveryIllShapedBody_IsInvalid_AndReadsNothing()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        var person = await _world.SeedParticipantAsync(exercise, "Would Get A Card");
        var id = person.AccountId.ToString();

        var shapes = new (RosterCardsRequestBody? Body, string Why)[]
        {
            (null, "a JSON null body"),
            (new RosterCardsRequestBody(), "neither member"),
            (new RosterCardsRequestBody { ParticipantIds = [id], All = true }, "both members"),
            (new RosterCardsRequestBody { ParticipantIds = [] }, "an empty participantIds"),
            (new RosterCardsRequestBody { All = false }, "all other than true"),
            (new RosterCardsRequestBody { ParticipantIds = [id, null] }, "a null id"),
        };

        foreach (var (body, why) in shapes)
        {
            var result = await _world.GenerateWithBodyAsync(exercise, staff, body);

            result.Outcome.Should().Be(LinkCardOutcome.Invalid, "{0} is not exactly one of the two shapes", why);
            result.Sheet.Should().BeNull();
            result.Message.Should().NotBeNullOrWhiteSpace("the 400 says what to send ({0})", why);
            result.Message.Should().NotContain(id, "the reason never echoes the request ({0})", why);
        }

        (await _world.CardEventsAsync(exercise)).Should().BeEmpty("a refused body generates no sheet");
    }

    [RequiresDockerFact]
    public async Task AJoinBaseThatDisappearsMidRequest_IsJoinLinksUnavailable_NotAPartialSheet()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        await _world.SeedParticipantAsync(exercise, "First Person");
        await _world.SeedParticipantAsync(exercise, "Second Person");

        // FrontendBaseUrl answers the up-front availability check, then vanishes (a configuration reload): the first
        // card's join URL cannot be built.
        var result = await _world.GenerateWithBodyAsync(
            exercise,
            staff,
            LinkCardTestWorld.Body(null),
            wrapConfiguration: inner => new VanishingFrontendBase(inner, readsBeforeVanishing: 1));

        result.Outcome.Should().Be(LinkCardOutcome.JoinLinksUnavailable, "no card is produced without a join base");
        result.Sheet.Should().BeNull("never a partial sheet");
        (await _world.CardEventsAsync(exercise)).Should().BeEmpty("a 409 records nothing");
    }

    [RequiresDockerFact]
    public async Task UnsetJoinBase_IsJoinLinksUnavailable_AndNoCardIsProduced()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        await _world.SeedParticipantAsync(exercise, "Would Get A Card");

        foreach (var unusable in new[] { null, "", "   ", "not a url", "/relative/path", "ftp://files.example.com" })
        {
            var result = await _world.GenerateAsync(exercise, staff, frontendBase: unusable);

            result.Outcome.Should().Be(LinkCardOutcome.JoinLinksUnavailable, $"'{unusable}' is not a usable join base");
            result.Sheet.Should().BeNull("no card is produced without a join base");
            result.Message.Should().ContainEquivalentOf("join links are not configured");
        }
    }

    [RequiresDockerFact]
    public async Task MoreIdsThanTheCap_IsTooManyIds_AndExactlyTheCapIsFine()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));

        var overDefault = Enumerable.Range(0, 501).Select(_ => Guid.NewGuid().ToString()).ToList();
        var tooMany = await _world.GenerateAsync(exercise, staff, overDefault);
        tooMany.Outcome.Should().Be(LinkCardOutcome.TooManyIds, "the default MaxCardsPerRequest is 500");
        tooMany.Message.Should().Contain("500");
        tooMany.Sheet.Should().BeNull();

        var atDefault = await _world.GenerateAsync(exercise, staff, overDefault.Take(500).ToList());
        atDefault.Outcome.Should().Be(LinkCardOutcome.Ok, "500 ids is at the cap, not over it");
        atDefault.Sheet!.Skipped.Should().HaveCount(500).And.OnlyContain(s => s.Reason == RosterCardSkipReasons.NotFound);

        var overConfigured = await _world.GenerateAsync(exercise, staff, overDefault.Take(4).ToList(), maxCardsPerRequest: 3);
        overConfigured.Outcome.Should().Be(LinkCardOutcome.TooManyIds, "the cap is Authentication:EasyLogin:MaxCardsPerRequest");
        overConfigured.Message.Should().Contain("3");
    }

    [RequiresDockerFact]
    public async Task NoStaffSession_OrAnUnresolvedScope_IsUnauthenticated()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));

        (await _world.GenerateAsync(exercise, staffUserId: null)).Outcome.Should().Be(LinkCardOutcome.Unauthenticated);
        (await _world.GenerateAsync(scope: null, staff)).Outcome.Should().Be(LinkCardOutcome.Unauthenticated);
        (await _world.GenerateAsync(Guid.Empty, staff)).Outcome.Should().Be(LinkCardOutcome.Unauthenticated);
    }

    [RequiresDockerFact]
    public async Task AnEvaluator_OrAnUnassignedStaffUser_IsForbidden()
    {
        var exercise = await _world.SeedExerciseAsync();
        var other = await _world.SeedExerciseAsync();
        var evaluator = await _world.SeedStaffAsync((exercise, "evaluator"));
        var elsewhere = await _world.SeedStaffAsync((other, "controller"));

        (await _world.GenerateAsync(exercise, evaluator)).Outcome.Should().Be(LinkCardOutcome.Forbidden);
        (await _world.GenerateAsync(exercise, elsewhere)).Outcome.Should().Be(
            LinkCardOutcome.Forbidden, "a controller of ANOTHER exercise holds no role on this one");
    }

    [RequiresDockerFact]
    public async Task TheService_ChangesNoLink()
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        var person = await _world.SeedParticipantAsync(exercise, "Unchanged Link");

        await using (var before = _world.Fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise }))
        {
            var snapshot = before.ParticipantLinks.Single(l => l.AccountId == person.AccountId);

            await _world.GenerateAsync(exercise, staff);
            await _world.GenerateAsync(exercise, staff, [person.AccountId.ToString()]);

            await using var after = _world.Fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise });
            after.ParticipantLinks.Single(l => l.AccountId == person.AccountId).Should().BeEquivalentTo(
                snapshot, "printing reads links; it never issues, rotates, uses or revokes one");
        }
    }

    [Fact]
    public void AddLinkCards_IsIdempotent_WithTheRightLifetimes()
    {
        var services = new ServiceCollection();
        services.AddLinkCards();
        services.AddLinkCards();

        services.Count(d => d.ServiceType == typeof(LinkCardService)).Should().Be(1, "AddLinkCards is idempotent");
        services.Count(d => d.ServiceType == typeof(QrSvgRenderer)).Should().Be(1);
        services.Single(d => d.ServiceType == typeof(LinkCardService)).Lifetime.Should().Be(ServiceLifetime.Scoped);
        services.Single(d => d.ServiceType == typeof(QrSvgRenderer)).Lifetime.Should().Be(ServiceLifetime.Singleton);
    }

    [Fact]
    public void AddLinkCards_BringsTheEasyLoginKernel_SoAMissingSeamLineCannot500()
    {
        var services = new ServiceCollection();
        services.AddLinkCards();

        foreach (var kernel in new[]
        {
            typeof(JoinUrlBuilder), typeof(RosterLinkDtoFactory), typeof(ExerciseFactsReader),
            typeof(IParticipantLinkTokenProtector), typeof(IParticipantLinkIssuer),
        })
        {
            services.Count(d => d.ServiceType == kernel).Should().Be(
                1, "AddLinkCards registers {0} through AddEasyLoginFoundation", kernel.Name);
        }

        var again = new ServiceCollection();
        again.AddEasyLoginFoundation();
        again.AddLinkCards();
        again.Count(d => d.ServiceType == typeof(JoinUrlBuilder)).Should().Be(
            1, "the kernel is TryAdd-based: calling it twice registers nothing twice");
    }

    [Fact]
    public void AddLinkCards_NeverDisplacesAReplacedLinkIssuer_WhicheverRunsFirst()
    {
        var replacedFirst = new ServiceCollection();
        replacedFirst.Replace(ServiceDescriptor.Scoped<IParticipantLinkIssuer, StubIssuer>());
        replacedFirst.AddLinkCards();

        var replacedAfter = new ServiceCollection();
        replacedAfter.AddLinkCards();
        replacedAfter.Replace(ServiceDescriptor.Scoped<IParticipantLinkIssuer, StubIssuer>());

        foreach (var services in new[] { replacedFirst, replacedAfter })
        {
            services.Where(d => d.ServiceType == typeof(IParticipantLinkIssuer)).Should().ContainSingle()
                .Which.ImplementationType.Should().Be(
                    typeof(StubIssuer), "story 03's real issuer must win (it Replaces; the kernel TryAdds)");
        }
    }

    private sealed class StubIssuer : IParticipantLinkIssuer
    {
        public Task<ParticipantLink?> EnsureActiveAsync(
            Account account,
            Guid? issuedByStaffUserId,
            DateTimeOffset now,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<ParticipantLink?>(null);
    }

    /// <summary>
    /// An <see cref="IConfiguration"/> whose <c>Authentication:FrontendBaseUrl</c> answers the first N reads and then
    /// disappears, as a configuration reload would make it. Every other key reads through.
    /// </summary>
    private sealed class VanishingFrontendBase : IConfiguration
    {
        private readonly IConfiguration _inner;
        private int _readsLeft;

        public VanishingFrontendBase(IConfiguration inner, int readsBeforeVanishing)
        {
            _inner = inner;
            _readsLeft = readsBeforeVanishing;
        }

        public string? this[string key]
        {
            get => string.Equals(key, JoinUrlBuilder.FrontendBaseUrlKey, StringComparison.OrdinalIgnoreCase)
                ? (Interlocked.Decrement(ref _readsLeft) >= 0 ? _inner[key] : null)
                : _inner[key];
            set => _inner[key] = value;
        }

        public IEnumerable<IConfigurationSection> GetChildren() => _inner.GetChildren();

        public IChangeToken GetReloadToken() => _inner.GetReloadToken();

        public IConfigurationSection GetSection(string key) => _inner.GetSection(key);
    }

    private static string DecodedSvg(string dataUri)
    {
        dataUri.Should().StartWith(QrSvgRenderer.DataUriPrefix);
        return Encoding.UTF8.GetString(Convert.FromBase64String(dataUri[QrSvgRenderer.DataUriPrefix.Length..]));
    }
}
