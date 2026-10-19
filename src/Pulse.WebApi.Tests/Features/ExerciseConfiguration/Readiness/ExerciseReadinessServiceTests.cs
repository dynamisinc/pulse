namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration.Readiness;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseConfiguration.Readiness;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Xunit;

/// <summary>
/// exercise-build-golive/03 — the go-live readiness checklist (ADMIN-IDENTITY-MODEL §5.3) against REAL SQL Server: one
/// test per item (its ok case and its open / not-checked case), the fail-closed scope, and the cross-exercise isolation
/// proof (one exercise's rows never count toward another's checklist).
/// </summary>
/// <remarks>
/// Each test starts from <see cref="SeedReadyAsync"/> — an exercise where every evaluable item is ok — and breaks
/// exactly one thing, so a failure names the item that regressed. Fresh GUIDs per test; no table truncation.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class ExerciseReadinessServiceTests
{
    private static readonly string[] BlockingIds =
    [
        "controller-enrolled", "participant-name", "participant-access", "personas-bound", "sign-in-methods",
        "schedule-set", "chrome-valid", "run-sheet-repair",
    ];

    private static readonly string[] WarningIds =
    [
        "run-sheet-items", "opening-feed", "noise-pool", "persona-avatars", "sign-in-issued", "evaluator-enrolled",
        "lead-controller",
    ];

    private readonly MsSqlContainerFixture _fixture;

    public ExerciseReadinessServiceTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    // ---- Shape and the fail-closed scope ----

    [RequiresDockerFact]
    public async Task ReadyWorld_IsReady_WithEveryItemInItsFixedOrder()
    {
        var exerciseId = await SeedReadyAsync();

        var report = await ReadAsync(exerciseId);

        report.Ready.Should().BeTrue("every evaluable blocking item is satisfied");
        report.ExerciseId.Should().Be(exerciseId);
        report.LifecycleState.Should().Be("build");
        report.Blocking.Select(i => i.Id).Should().Equal(BlockingIds, "the blocking items are a fixed, ordered contract");
        report.Warnings.Select(i => i.Id).Should().Equal(WarningIds, "the warnings are a fixed, ordered contract");
        report.Blocking.Where(i => i.Id is not ("participant-name" or "sign-in-methods"))
            .Should().OnlyContain(i => i.Status == ReadinessItemStatuses.Ok && i.Detail == null);
        report.Warnings.Should().OnlyContain(i => i.Status == ReadinessItemStatuses.Ok && i.Detail == null);
        report.Blocking.Concat(report.Warnings).Should().OnlyContain(i => !string.IsNullOrWhiteSpace(i.Label));
    }

    [RequiresDockerFact]
    public async Task UnresolvedScope_FailsClosed_BeforeAnyRead()
    {
        // A built exercise exists, so a zero here is the scope closing the door, not an empty table.
        await SeedReadyAsync();
        await using var context = _fixture.CreateContext();
        var unset = await new ExerciseReadinessService(context, new ExerciseContext { CurrentExerciseId = null }).GetAsync();
        var empty = await new ExerciseReadinessService(context, new ExerciseContext { CurrentExerciseId = Guid.Empty }).GetAsync();

        unset.Outcome.Should().Be(ExerciseReadinessOutcome.ScopeUnresolved);
        unset.Report.Should().BeNull();
        empty.Outcome.Should().Be(ExerciseReadinessOutcome.ScopeUnresolved, "Guid.Empty is the unset scope (fail closed)");
    }

    [RequiresDockerFact]
    public async Task ResolvedScopeWithNoExerciseRow_IsNotFound()
    {
        var result = await ReadResultAsync(Guid.NewGuid());

        result.Outcome.Should().Be(ExerciseReadinessOutcome.NotFound);
    }

    // ---- Blocking items ----

    [RequiresDockerFact]
    public async Task ControllerEnrolled_IsOpen_WithNoControllerEnrollment()
    {
        var exerciseId = await SeedReadyAsync(controller: false);

        var report = await ReadAsync(exerciseId);

        Blocking(report, "controller-enrolled").Status.Should().Be(ReadinessItemStatuses.Open);
        report.Ready.Should().BeFalse("a blocking item is open");
        report.OpenBlocking.Select(i => i.Id).Should().Equal("controller-enrolled");
    }

    [RequiresDockerFact]
    public async Task ParticipantNameAndSignInMethods_AreAlwaysNotChecked_AndNeverBlock()
    {
        var exerciseId = await SeedReadyAsync();

        var report = await ReadAsync(exerciseId);

        var name = Blocking(report, "participant-name");
        name.Status.Should().Be(ReadinessItemStatuses.NotChecked);
        name.Detail.Should().Be("Not checked yet — arrives with story 09 (participant-facing name).");
        var methods = Blocking(report, "sign-in-methods");
        methods.Status.Should().Be(ReadinessItemStatuses.NotChecked);
        methods.Detail.Should().Be("Not checked yet — needs identity-auth-roles 22 (sign-in methods).");
        report.Ready.Should().BeTrue("a not-checked item never blocks");
    }

    [RequiresDockerFact]
    public async Task ParticipantAccess_IsOpen_WithNoAccountAndTheViewOnlyCodeOff()
    {
        var exerciseId = await SeedReadyAsync(accounts: 0);
        await AddSharedCredentialAsync(exerciseId, enabled: false);

        var report = await ReadAsync(exerciseId);

        Blocking(report, "participant-access").Status.Should().Be(ReadinessItemStatuses.Open);
        report.Ready.Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task ParticipantAccess_IsOk_WithNoAccountButTheViewOnlyCodeEnabled()
    {
        var exerciseId = await SeedReadyAsync(accounts: 0);
        await AddSharedCredentialAsync(exerciseId, enabled: true);

        var report = await ReadAsync(exerciseId);

        Blocking(report, "participant-access").Status.Should().Be(ReadinessItemStatuses.Ok);
    }

    [RequiresDockerFact]
    public async Task ParticipantAccess_IsOpen_WhenTheViewOnlyCodeIsEnabledButHasNoHash()
    {
        var exerciseId = await SeedReadyAsync(accounts: 0);
        await AddSharedCredentialAsync(exerciseId, enabled: true, hashed: false);

        var report = await ReadAsync(exerciseId);

        Blocking(report, "participant-access").Status.Should().Be(
            ReadinessItemStatuses.Open, "an enabled view-only code with no hash admits nobody");
    }

    [RequiresDockerFact]
    public async Task ParticipantAccess_IgnoresADisabledAccount()
    {
        var exerciseId = await SeedReadyAsync(accounts: 0);
        await AddAccountAsync(exerciseId, personaBound: true, credential: true, disabled: true);

        var report = await ReadAsync(exerciseId);

        Blocking(report, "participant-access").Status.Should().Be(
            ReadinessItemStatuses.Open, "a disabled account cannot sign in, so it gives no participant access");
    }

    [RequiresDockerFact]
    public async Task PersonasBound_IsOpen_WithTheCount_WhenAccountsHaveNoPersona()
    {
        var exerciseId = await SeedReadyAsync();
        for (var i = 0; i < 3; i++)
        {
            await AddAccountAsync(exerciseId, personaBound: false, credential: true);
        }

        var item = Blocking(await ReadAsync(exerciseId), "personas-bound");

        item.Status.Should().Be(ReadinessItemStatuses.Open);
        item.Detail.Should().Be("3 participant accounts have no persona.");
    }

    /// <summary>Enrollment.PersonaId has no FK, so an id that names no persona in THIS exercise is unbound.</summary>
    [RequiresDockerFact]
    public async Task PersonasBound_CountsADanglingOrForeignPersonaIdAsUnbound()
    {
        var exerciseId = await SeedReadyAsync();
        var otherExercise = await SeedReadyAsync();
        var foreignPersona = await AddPersonaAsync(otherExercise, avatar: true);
        await AddAccountAsync(exerciseId, personaBound: true, credential: true, personaId: Guid.NewGuid());
        await AddAccountAsync(exerciseId, personaBound: true, credential: true, personaId: foreignPersona);

        var report = await ReadAsync(exerciseId);
        var item = Blocking(report, "personas-bound");

        item.Status.Should().Be(ReadinessItemStatuses.Open, "a persona id with no persona row in this exercise binds nothing");
        item.Detail.Should().Be("2 participant accounts have no persona.");
        report.Ready.Should().BeFalse();
    }

    /// <summary>A pio account is a participant-world sign-in, so it counts exactly as a participant account does.</summary>
    [RequiresDockerFact]
    public async Task PioAccount_CountsForParticipantAccess_PersonasBound_AndSignInIssued()
    {
        var access = await SeedReadyAsync(accounts: 0);
        await AddAccountAsync(access, personaBound: true, credential: true, role: EnrollmentRoles.Pio);
        var accessReport = await ReadAsync(access);
        Blocking(accessReport, "participant-access").Status.Should().Be(
            ReadinessItemStatuses.Ok, "a pio account alone gives participant-world access");
        Blocking(accessReport, "personas-bound").Status.Should().Be(ReadinessItemStatuses.Ok);
        Warning(accessReport, "sign-in-issued").Status.Should().Be(ReadinessItemStatuses.Ok);

        var gaps = await SeedReadyAsync(accounts: 0);
        await AddAccountAsync(gaps, personaBound: false, credential: false, role: EnrollmentRoles.Pio);
        var gapsReport = await ReadAsync(gaps);
        Blocking(gapsReport, "personas-bound").Detail.Should().Be(
            "1 participant account has no persona.", "an unbound pio account is counted");
        Warning(gapsReport, "sign-in-issued").Detail.Should().Be(
            "1 participant account has no sign-in link or password yet.", "a pio account with no sign-in is counted");
    }

    [RequiresDockerFact]
    public async Task PersonasBound_UsesTheSingular_ForOneAccount_AndIsOkWithNoAccounts()
    {
        var oneUnbound = await SeedReadyAsync();
        await AddAccountAsync(oneUnbound, personaBound: false, credential: true);
        var noAccounts = await SeedReadyAsync(accounts: 0);

        Blocking(await ReadAsync(oneUnbound), "personas-bound").Detail.Should().Be("1 participant account has no persona.");
        Blocking(await ReadAsync(noAccounts), "personas-bound").Status.Should().Be(
            ReadinessItemStatuses.Ok, "with no accounts there is nothing unbound");
    }

    [RequiresDockerTheory]
    [InlineData(true, "UTC", true)]
    [InlineData(true, "America/New_York", true)]
    [InlineData(false, "UTC", false)]
    [InlineData(true, "Mars/Olympus_Mons", false)]
    [InlineData(true, "Eastern Standard Time", false)]
    public async Task ScheduleSet_NeedsAStartTimeAndAValidIanaZone(bool startSet, string timeZone, bool ok)
    {
        var exerciseId = await SeedReadyAsync();
        await UpdateExerciseAsync(exerciseId, e =>
        {
            e.ScheduledStartAt = startSet ? e.ScheduledStartAt : null;
            e.TimeZone = timeZone;
        });

        var item = Blocking(await ReadAsync(exerciseId), "schedule-set");

        item.Status.Should().Be(ok ? ReadinessItemStatuses.Ok : ReadinessItemStatuses.Open);
        (item.Detail is null).Should().Be(ok);
    }

    [RequiresDockerTheory]
    [InlineData(true, true, true)]
    [InlineData(false, true, true)]
    [InlineData(true, false, true)]
    [InlineData(false, false, false)]
    public async Task ChromeValid_FollowsTheComplianceChromeGuard(bool chrome, bool watermark, bool ok)
    {
        var exerciseId = await SeedReadyAsync();
        await UpdateExerciseAsync(exerciseId, e =>
        {
            e.ComplianceChromeEnabled = chrome;
            e.WatermarkEnabled = watermark;
        });

        var report = await ReadAsync(exerciseId);

        Blocking(report, "chrome-valid").Status.Should().Be(ok ? ReadinessItemStatuses.Ok : ReadinessItemStatuses.Open);
        report.Ready.Should().Be(ok);
    }

    [RequiresDockerFact]
    public async Task RunSheetRepair_IsOpen_WhenAnItemNeedsRepair_AndIgnoresADeletedOne()
    {
        var broken = await SeedReadyAsync();
        await AddInjectAsync(broken, "needs-repair");
        await AddInjectAsync(broken, "needs-repair");
        var deletedOnly = await SeedReadyAsync();
        await AddInjectAsync(deletedOnly, "needs-repair", deleted: true);

        var brokenReport = await ReadAsync(broken);
        var item = Blocking(brokenReport, "run-sheet-repair");
        item.Status.Should().Be(ReadinessItemStatuses.Open);
        item.Detail.Should().Be("2 run sheet items need repair.");
        brokenReport.Ready.Should().BeFalse();

        Blocking(await ReadAsync(deletedOnly), "run-sheet-repair").Status.Should().Be(ReadinessItemStatuses.Ok);
    }

    // ---- Warnings ----

    [RequiresDockerFact]
    public async Task RunSheetItems_WarnsWithNoLiveItem()
    {
        var none = await SeedReadyAsync(inject: false);
        var deletedOnly = await SeedReadyAsync(inject: false);
        await AddInjectAsync(deletedOnly, "pending", deleted: true);

        var report = await ReadAsync(none);
        Warning(report, "run-sheet-items").Status.Should().Be(ReadinessItemStatuses.Open);
        report.Ready.Should().BeTrue("a warning never blocks");
        Warning(await ReadAsync(deletedOnly), "run-sheet-items").Status.Should().Be(ReadinessItemStatuses.Open);
    }

    [RequiresDockerFact]
    public async Task OpeningFeed_WarnsWithNoLivePost()
    {
        var none = await SeedReadyAsync(post: false);
        var takenDown = await SeedReadyAsync(post: false);
        await AddPostAsync(takenDown, deleted: true);

        Warning(await ReadAsync(none), "opening-feed").Status.Should().Be(ReadinessItemStatuses.Open);
        Warning(await ReadAsync(takenDown), "opening-feed").Status.Should().Be(
            ReadinessItemStatuses.Open, "a taken-down post is not in the opening feed");
    }

    [RequiresDockerFact]
    public async Task OpeningFeed_CountsOnlyTopLevelPostsAtOrBeforeTheScenarioStart()
    {
        var afterStart = await SeedReadyAsync(post: false);
        await AddPostAsync(afterStart, deleted: false, scenarioTime: new DateTimeOffset(2033, 3, 1, 12, 0, 0, TimeSpan.Zero));

        var replyOnly = await SeedReadyAsync(post: false);
        var parent = await AddPostAsync(replyOnly, new DateTimeOffset(2033, 3, 1, 12, 0, 0, TimeSpan.Zero));
        await AddPostAsync(replyOnly, deleted: false, parentPostId: parent);

        var atStart = await SeedReadyAsync(post: false);
        await AddPostAsync(atStart, deleted: false, scenarioTime: new DateTimeOffset(2033, 3, 1, 9, 0, 0, TimeSpan.Zero));

        Warning(await ReadAsync(afterStart), "opening-feed").Status.Should().Be(
            ReadinessItemStatuses.Open, "a post dated after the start is not in the opening feed");
        Warning(await ReadAsync(replyOnly), "opening-feed").Status.Should().Be(
            ReadinessItemStatuses.Open, "a reply is not a top-level opening post");
        Warning(await ReadAsync(atStart), "opening-feed").Status.Should().Be(ReadinessItemStatuses.Ok);
    }

    /// <summary>
    /// The scheduled start is a REAL-WORLD planning date (it does not start the clock); the scenario start is
    /// <see cref="Exercise.CurrentScenarioTime"/>. A 2026 planning date must not push 2033 scenario-time posts out of
    /// the opening feed.
    /// </summary>
    [RequiresDockerFact]
    public async Task OpeningFeed_ComparesAgainstTheScenarioStart_NotTheRealWorldScheduledStart()
    {
        var exerciseId = await SeedReadyAsync(post: false);
        await UpdateExerciseAsync(exerciseId, e =>
        {
            e.ScheduledStartAt = new DateTimeOffset(2026, 11, 2, 13, 0, 0, TimeSpan.Zero);
            e.CurrentScenarioTime = new DateTimeOffset(2033, 3, 1, 9, 0, 0, TimeSpan.Zero);
        });
        await AddPostAsync(exerciseId, deleted: false, scenarioTime: new DateTimeOffset(2033, 3, 1, 8, 0, 0, TimeSpan.Zero));

        Warning(await ReadAsync(exerciseId), "opening-feed").Status.Should().Be(
            ReadinessItemStatuses.Ok, "the 08:00 post precedes the 09:00 scenario start; the 2026 real-world date is irrelevant");
    }

    [RequiresDockerFact]
    public async Task OpeningFeed_CountsAnyLiveTopLevelPost_WhenNoScenarioStartIsStored()
    {
        var exerciseId = await SeedReadyAsync(post: false);
        await UpdateExerciseAsync(exerciseId, e => e.CurrentScenarioTime = null);
        await AddPostAsync(exerciseId, deleted: false, scenarioTime: new DateTimeOffset(2040, 1, 1, 0, 0, 0, TimeSpan.Zero));

        Warning(await ReadAsync(exerciseId), "opening-feed").Status.Should().Be(
            ReadinessItemStatuses.Ok, "with no scenario start stored, any live top-level post counts");
    }

    [RequiresDockerFact]
    public async Task NoisePool_WarnsWhenEmpty()
    {
        var exerciseId = await SeedReadyAsync(noise: false);

        Warning(await ReadAsync(exerciseId), "noise-pool").Status.Should().Be(ReadinessItemStatuses.Open);
    }

    [RequiresDockerFact]
    public async Task PersonaAvatars_WarnsWithTheCountOfPersonasWithoutAnAvatar()
    {
        var exerciseId = await SeedReadyAsync();
        await AddPersonaAsync(exerciseId, avatar: false);
        await AddPersonaAsync(exerciseId, avatar: false);

        var item = Warning(await ReadAsync(exerciseId), "persona-avatars");

        item.Status.Should().Be(ReadinessItemStatuses.Open);
        item.Detail.Should().Be("2 personas have no avatar.");
    }

    [RequiresDockerFact]
    public async Task SignInIssued_WarnsForAnAccountWithNoPasswordAndNoLiveLink()
    {
        var exerciseId = await SeedReadyAsync();
        await AddAccountAsync(exerciseId, personaBound: true, credential: false);
        var revokedOnly = await AddAccountAsync(exerciseId, personaBound: true, credential: false);
        await AddLinkAsync(exerciseId, revokedOnly, revoked: true);

        var item = Warning(await ReadAsync(exerciseId), "sign-in-issued");

        item.Status.Should().Be(ReadinessItemStatuses.Open);
        item.Detail.Should().Be(
            "2 participant accounts have no sign-in link or password yet.", "a revoked link is not a sign-in issued");
    }

    [RequiresDockerFact]
    public async Task SignInIssued_IsOk_WhenEveryAccountHasAPasswordOrALiveLink()
    {
        var exerciseId = await SeedReadyAsync();
        var linked = await AddAccountAsync(exerciseId, personaBound: true, credential: false);
        await AddLinkAsync(exerciseId, linked, revoked: false);

        Warning(await ReadAsync(exerciseId), "sign-in-issued").Status.Should().Be(ReadinessItemStatuses.Ok);
    }

    [RequiresDockerFact]
    public async Task EvaluatorEnrolled_WarnsWithNoEvaluator()
    {
        var exerciseId = await SeedReadyAsync(evaluator: false);

        Warning(await ReadAsync(exerciseId), "evaluator-enrolled").Status.Should().Be(ReadinessItemStatuses.Open);
    }

    [RequiresDockerFact]
    public async Task LeadController_WarnsWithNoLead_AndSaysWhatIsUnavailable()
    {
        var exerciseId = await SeedReadyAsync(lead: false);

        var report = await ReadAsync(exerciseId);
        var item = Warning(report, "lead-controller");

        item.Status.Should().Be(ReadinessItemStatuses.Open);
        item.Detail.Should().Be(
            "No lead controller — swamped mode and autonomy raises are unavailable until a planner sets one.");
        report.Ready.Should().BeTrue("no lead is a warning, not a blocker (§5.3)");
    }

    // ---- Isolation (COR-001 / XC-001) ----

    /// <summary>
    /// Two exercises in one organization: A is fully built, B is empty. B's checklist must count none of A's rows, and
    /// A's counts must include none of the rows later added to B.
    /// </summary>
    [RequiresDockerFact]
    public async Task Readiness_NeverCountsAnotherExercisesRows()
    {
        var full = await SeedReadyAsync();
        var empty = Guid.NewGuid();
        await using (var seed = _fixture.CreateContext())
        {
            seed.Exercises.Add(ExerciseLifecycleTestData.ExerciseInState(empty, "build"));
            await seed.SaveChangesAsync();
        }

        await AddSharedCredentialAsync(full, enabled: true);

        var emptyReport = await ReadAsync(empty);
        Blocking(emptyReport, "controller-enrolled").Status.Should().Be(
            ReadinessItemStatuses.Open, "A's controller is not B's");
        Blocking(emptyReport, "participant-access").Status.Should().Be(
            ReadinessItemStatuses.Open, "A's accounts and A's view-only code are not B's");
        foreach (var id in WarningIds)
        {
            Warning(emptyReport, id).Status.Should().Be(
                id == "persona-avatars" || id == "sign-in-issued" ? ReadinessItemStatuses.Ok : ReadinessItemStatuses.Open,
                "B has no rows of its own, so {0} must not see A's",
                id);
        }

        emptyReport.Ready.Should().BeFalse();

        // Vice versa: rows that would break A's counts, written into B only.
        for (var i = 0; i < 3; i++)
        {
            await AddAccountAsync(empty, personaBound: false, credential: false);
            await AddPersonaAsync(empty, avatar: false);
        }

        await AddInjectAsync(empty, "needs-repair");

        var fullReport = await ReadAsync(full);
        fullReport.Ready.Should().BeTrue("B's broken rows must not reach A's checklist");
        Blocking(fullReport, "personas-bound").Status.Should().Be(ReadinessItemStatuses.Ok);
        Blocking(fullReport, "run-sheet-repair").Status.Should().Be(ReadinessItemStatuses.Ok);
        Warning(fullReport, "persona-avatars").Status.Should().Be(ReadinessItemStatuses.Ok);
        Warning(fullReport, "sign-in-issued").Status.Should().Be(ReadinessItemStatuses.Ok);

        var bReport = await ReadAsync(empty);
        Blocking(bReport, "personas-bound").Detail.Should().Be("3 participant accounts have no persona.");
        Warning(bReport, "persona-avatars").Detail.Should().Be("3 personas have no avatar.");

        // The rows do exist across both exercises, so the per-exercise answers above are the filter at work.
        await using var unfiltered = _fixture.CreateContext();
        (await unfiltered.Accounts.IgnoreQueryFilters().CountAsync(a => a.ExerciseId == full || a.ExerciseId == empty))
            .Should().Be(4, "one account in A and three in B");
    }

    // ---- Helpers ----

    private static ReadinessItem Blocking(ExerciseReadinessReport report, string id) =>
        report.Blocking.Should().ContainSingle(i => i.Id == id).Which;

    private static ReadinessItem Warning(ExerciseReadinessReport report, string id) =>
        report.Warnings.Should().ContainSingle(i => i.Id == id).Which;

    private async Task<ExerciseReadinessResult> ReadResultAsync(Guid exerciseId)
    {
        var scope = new ExerciseContext { CurrentExerciseId = exerciseId };
        await using var context = _fixture.CreateContext(scope);
        return await new ExerciseReadinessService(context, scope).GetAsync();
    }

    private async Task<ExerciseReadinessReport> ReadAsync(Guid exerciseId)
    {
        var result = await ReadResultAsync(exerciseId);
        result.Outcome.Should().Be(ExerciseReadinessOutcome.Ok);
        return result.Report!;
    }

    /// <summary>Seeds an exercise where every evaluable item is ok; each flag removes one ingredient.</summary>
    private async Task<Guid> SeedReadyAsync(
        bool controller = true,
        bool lead = true,
        bool evaluator = true,
        int accounts = 1,
        bool inject = true,
        bool post = true,
        bool noise = true)
    {
        var exerciseId = Guid.NewGuid();
        await using (var seed = _fixture.CreateContext())
        {
            var exercise = ExerciseLifecycleTestData.ExerciseInState(exerciseId, "build");
            exercise.ScheduledStartAt = new DateTimeOffset(2033, 3, 1, 9, 0, 0, TimeSpan.Zero);
            exercise.CurrentScenarioTime = new DateTimeOffset(2033, 3, 1, 9, 0, 0, TimeSpan.Zero);
            seed.Exercises.Add(exercise);

            if (controller)
            {
                seed.Enrollments.Add(StaffEnrollment(exerciseId, EnrollmentRoles.Controller, lead));
            }

            if (evaluator)
            {
                seed.Enrollments.Add(StaffEnrollment(exerciseId, EnrollmentRoles.Evaluator, isLead: false));
            }

            await seed.SaveChangesAsync();
        }

        await AddPersonaAsync(exerciseId, avatar: true);
        for (var i = 0; i < accounts; i++)
        {
            await AddAccountAsync(exerciseId, personaBound: true, credential: true);
        }

        if (inject)
        {
            await AddInjectAsync(exerciseId, "pending");
        }

        if (post)
        {
            await AddPostAsync(exerciseId, deleted: false);
        }

        if (noise)
        {
            await using var seed = _fixture.CreateContext();
            seed.NoisePosts.Add(new NoisePost
            {
                Id = Guid.NewGuid(),
                ExerciseId = exerciseId,
                PersonaId = Guid.NewGuid(),
                Text = "Background chatter.",
                Order = 0,
                CreatedWallClock = DateTimeOffset.UtcNow,
            });
            await seed.SaveChangesAsync();
        }

        return exerciseId;
    }

    private static Enrollment StaffEnrollment(Guid exerciseId, string role, bool isLead) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        Role = role,
        IsLead = isLead,
        CreatedAt = DateTimeOffset.UtcNow,
    };

    /// <summary>
    /// Adds a participant-world account. A bound account binds to <paramref name="personaId"/> when given (which may be
    /// dangling, on purpose), otherwise to a freshly seeded persona (with an avatar) in the same exercise.
    /// </summary>
    private async Task<Guid> AddAccountAsync(
        Guid exerciseId,
        bool personaBound,
        bool credential,
        bool disabled = false,
        string role = EnrollmentRoles.Participant,
        Guid? personaId = null)
    {
        Guid? boundPersona = personaBound ? personaId ?? await AddPersonaAsync(exerciseId, avatar: true) : null;
        var accountId = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Accounts.Add(new Account
        {
            Id = accountId,
            ExerciseId = exerciseId,
            Username = $"rd{accountId:N}"[..30],
            DisplayName = "Readiness Participant",
            CredentialHash = credential ? "not-a-real-hash" : null,
            DisabledAt = disabled ? DateTimeOffset.UtcNow : null,
            CreatedAt = DateTimeOffset.UtcNow,
            Enrollment = new Enrollment
            {
                Id = Guid.NewGuid(),
                ExerciseId = exerciseId,
                Role = role,
                PersonaId = boundPersona,
                CreatedAt = DateTimeOffset.UtcNow,
            },
        });
        await seed.SaveChangesAsync();
        return accountId;
    }

    private async Task AddLinkAsync(Guid exerciseId, Guid accountId, bool revoked)
    {
        await using var seed = _fixture.CreateContext();
        seed.ParticipantLinks.Add(new ParticipantLink
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            AccountId = accountId,
            TokenHash = Guid.NewGuid().ToString("N").ToUpperInvariant(),
            Generation = 1,
            IssuedAt = DateTimeOffset.UtcNow,
            RevokedAt = revoked ? DateTimeOffset.UtcNow : null,
        });
        await seed.SaveChangesAsync();
    }

    private async Task AddSharedCredentialAsync(Guid exerciseId, bool enabled, bool hashed = true)
    {
        await using var seed = _fixture.CreateContext();
        seed.SharedCredentials.Add(new SharedCredential
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            CurrentHash = enabled && hashed ? "not-a-real-hash" : null,
            IsEnabled = enabled,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
    }

    private async Task<Guid> AddPersonaAsync(Guid exerciseId, bool avatar)
    {
        var personaId = Guid.NewGuid();
        Guid? avatarId = avatar ? Guid.NewGuid() : null;
        await using var seed = _fixture.CreateContext();
        if (avatarId is { } mediaId)
        {
            seed.MediaAssets.Add(new MediaAsset
            {
                Id = mediaId,
                ExerciseId = exerciseId,
                Kind = "image",
                ContentType = "image/png",
                BlobName = $"{exerciseId:N}/{mediaId:N}.png",
                Bytes = 1024,
                OriginalFileName = "avatar.png",
                UploadedByHumanId = "human-test",
                CreatedScenarioTime = new DateTimeOffset(2033, 3, 1, 9, 0, 0, TimeSpan.Zero),
                CreatedWallClock = DateTimeOffset.UtcNow,
            });
        }

        seed.Personas.Add(new Persona
        {
            Id = personaId,
            ExerciseId = exerciseId,
            DisplayName = "Readiness Persona",
            Handle = $"rd{personaId:N}"[..20],
            Kind = "human",
            AvatarMediaId = avatarId,
        });
        await seed.SaveChangesAsync();
        return personaId;
    }

    private async Task AddInjectAsync(Guid exerciseId, string status, bool deleted = false)
    {
        await using var seed = _fixture.CreateContext();
        seed.InjectItems.Add(new InjectItem
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            Kind = "post",
            Title = "Readiness inject",
            Status = status,
            CreatedByHumanId = Guid.NewGuid(),
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
            DeletedAt = deleted ? DateTimeOffset.UtcNow : null,
        });
        await seed.SaveChangesAsync();
    }

    // Defaults to 08:00, an hour before the seeded 09:00 scenario start (CurrentScenarioTime), so the post is in the
    // opening feed.
    private async Task AddPostAsync(
        Guid exerciseId,
        bool deleted,
        DateTimeOffset? scenarioTime = null,
        Guid? parentPostId = null)
    {
        await using var seed = _fixture.CreateContext();
        var post = ExerciseLifecycleTestData.PostIn(exerciseId, "Opening feed post");
        post.DeletedAt = deleted ? DateTimeOffset.UtcNow : null;
        post.CreatedScenarioTime = scenarioTime ?? new DateTimeOffset(2033, 3, 1, 8, 0, 0, TimeSpan.Zero);
        post.ParentPostId = parentPostId;
        seed.Posts.Add(post);
        await seed.SaveChangesAsync();
    }

    private async Task<Guid> AddPostAsync(Guid exerciseId, DateTimeOffset scenarioTime)
    {
        await using var seed = _fixture.CreateContext();
        var post = ExerciseLifecycleTestData.PostIn(exerciseId, "Opening feed post");
        post.CreatedScenarioTime = scenarioTime;
        seed.Posts.Add(post);
        await seed.SaveChangesAsync();
        return post.Id;
    }

    private async Task UpdateExerciseAsync(Guid exerciseId, Action<Exercise> change)
    {
        await using var context = _fixture.CreateContext();
        var exercise = await context.Exercises.SingleAsync(e => e.Id == exerciseId);
        change(exercise);
        await context.SaveChangesAsync();
    }
}
