namespace Pulse.WebApi.Tests.Features.Identity.DayWord;

using System;
using System.Collections.Generic;
using System.Data.Common;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.DayWord;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.SharedAccess;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// Shared seeding and doubles for the easy-login story 05 suites. Every helper uses fresh ids, so classes sharing the
/// one migrated database never collide (no truncation).
/// </summary>
internal static class DayWordTestSupport
{
    /// <summary>A fixed "now" most tests run at: Tue 2026-10-13 14:00 UTC (10:00 EDT).</summary>
    public static readonly DateTimeOffset DefaultNow = new(2026, 10, 13, 14, 0, 0, TimeSpan.Zero);

    /// <summary>The staff display name the seeded staff users carry.</summary>
    public const string StaffDisplayName = "Test Staff User";

    /// <summary>Seeds an exercise in the default tenant.</summary>
    public static async Task<Exercise> SeedExerciseAsync(
        MsSqlContainerFixture fixture,
        string timeZone = "America/New_York",
        string status = "live",
        string? hostname = null,
        DateTimeOffset? scenarioTime = null)
    {
        var exercise = new Exercise
        {
            Id = Guid.NewGuid(),
            OrganizationId = Organization.DefaultOrganizationId,
            Name = $"Day word {Guid.NewGuid():N}",
            TimeZone = timeZone,
            Status = status,
            Hostname = hostname,
            CurrentScenarioTime = scenarioTime,
        };

        await using var seed = fixture.CreateContext();
        seed.Exercises.Add(exercise);
        await seed.SaveChangesAsync();
        return exercise;
    }

    /// <summary>Seeds a staff user (default tenant) assigned to <paramref name="exerciseId"/> with <paramref name="role"/>.</summary>
    public static async Task<Guid> SeedStaffAsync(MsSqlContainerFixture fixture, Guid exerciseId, string role = "controller")
    {
        var staffUserId = Guid.NewGuid();

        await using var seed = fixture.CreateContext();
        seed.StaffUsers.Add(StaffTenantSeed.StaffUserFor(staffUserId));
        seed.StaffAssignments.Add(new StaffAssignment
        {
            Id = Guid.NewGuid(),
            StaffUserId = staffUserId,
            ExerciseId = exerciseId,
            Role = role,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
        return staffUserId;
    }

    /// <summary>Seeds a participant-world account (no password: the word is its only credential here).</summary>
    public static async Task<Account> SeedAccountAsync(
        MsSqlContainerFixture fixture,
        Guid exerciseId,
        string username,
        string role = "participant",
        DateTimeOffset? disabledAt = null,
        Guid? personaId = null,
        string? actingHumanId = null)
    {
        var account = new Account
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            Username = username,
            DisplayName = $"Display {username}",
            Role = role,
            PersonaId = personaId,
            ActingHumanId = actingHumanId,
            CreatedAt = DateTimeOffset.UtcNow,
            DisabledAt = disabledAt,
        };

        await using var seed = fixture.CreateContext();
        seed.Accounts.Add(account);
        await seed.SaveChangesAsync();
        return account;
    }

    /// <summary>Seeds a day word row directly (hash of the NORMALISED word), as a staff set would leave it.</summary>
    public static async Task<ExerciseDayWord> SeedWordAsync(
        MsSqlContainerFixture fixture,
        Guid exerciseId,
        DateOnly date,
        string word,
        Guid? setBy = null)
    {
        var row = new ExerciseDayWord
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            ForDate = date,
            WordHash = new SharedCredentialHasher().Hash(DayWordNormalizer.Normalize(word)),
            SetAt = DateTimeOffset.UtcNow,
            SetByStaffUserId = setBy ?? Guid.NewGuid(),
        };

        await using var seed = fixture.CreateContext();
        seed.ExerciseDayWords.Add(row);
        await seed.SaveChangesAsync();
        return row;
    }

    /// <summary>Every day word row of an exercise, read past the filter.</summary>
    public static async Task<List<ExerciseDayWord>> ReadWordsAsync(MsSqlContainerFixture fixture, Guid exerciseId)
    {
        await using var read = fixture.CreateContext();
        return await read.ExerciseDayWords.IgnoreQueryFilters().Where(r => r.ExerciseId == exerciseId).ToListAsync();
    }

    /// <summary>Every telemetry event of an exercise, read past the filter.</summary>
    public static async Task<List<TelemetryEvent>> ReadEventsAsync(MsSqlContainerFixture fixture, Guid exerciseId)
    {
        await using var read = fixture.CreateContext();
        return await read.TelemetryEvents.IgnoreQueryFilters().Where(e => e.ExerciseId == exerciseId).ToListAsync();
    }

    /// <summary>Builds the staff service over a context scoped to <paramref name="scope"/>.</summary>
    public static DayWordService StaffService(
        PulseDbContext context,
        Guid? scope,
        Guid? staffUserId,
        TimeProvider clock,
        ISharedCredentialHasher? hasher = null,
        int rolloverHour = 0,
        IExerciseClock? exerciseClock = null,
        ILogger<DayWordService>? logger = null) =>
        new(
            context,
            new ExerciseContext { CurrentExerciseId = scope },
            new StubCurrentStaffSessionAccessor(
                staffUserId is { } id ? new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = id } : null),
            new ExerciseFactsReader(context),
            hasher ?? new SharedCredentialHasher(),
            exerciseClock ?? new StubExerciseClock(null),
            clock,
            Options.Create(new EasyLoginOptions { DayRolloverHour = rolloverHour }),
            logger ?? NullLogger<DayWordService>.Instance);

    /// <summary>Builds the sign-in service over a context scoped to <paramref name="scope"/>.</summary>
    public static WordLoginService LoginService(
        PulseDbContext context,
        Guid? scope,
        TimeProvider clock,
        RecordingSessionIssuer issuer,
        ISharedCredentialHasher? hasher = null,
        int rolloverHour = 0,
        IExerciseClock? exerciseClock = null,
        ILogger<WordLoginService>? logger = null) =>
        new(
            context,
            new ExerciseContext { CurrentExerciseId = scope },
            issuer,
            hasher ?? new SharedCredentialHasher(),
            new ExerciseFactsReader(context),
            exerciseClock ?? new StubExerciseClock(null),
            clock,
            Options.Create(new EasyLoginOptions { DayRolloverHour = rolloverHour }),
            logger ?? NullLogger<WordLoginService>.Instance);

    /// <summary>A hand-advanced wall clock at <paramref name="now"/> (no real sleeping).</summary>
    public static ManualTimeProvider ClockAt(DateTimeOffset now) => new(now);

    /// <summary>A sign-in body.</summary>
    public static WordSignInRequestBody Body(string? signInName, string? word) => new() { SignInName = signInName, Word = word };
}

/// <summary>
/// The real PBKDF2 hasher, recording each call (and, optionally, into a shared ordered log alongside the SQL the
/// context ran), so a test can prove "exactly one slow-KDF verification" and "before the account lookup".
/// </summary>
internal sealed class CountingHasher : ISharedCredentialHasher
{
    private readonly SharedCredentialHasher _inner = new();
    private readonly List<string>? _sharedLog;

    public CountingHasher(List<string>? sharedLog = null) => _sharedLog = sharedLog;

    public List<string> Calls { get; } = [];

    /// <summary>How many slow-KDF verifications ran (real or decoy).</summary>
    public int Verifications => Calls.FindAll(call => call is "Verify" or "VerifyDecoy").Count;

    public string Hash(string password)
    {
        Record("Hash");
        return _inner.Hash(password);
    }

    public bool Verify(string? currentHash, string providedPassword)
    {
        Record("Verify");
        return _inner.Verify(currentHash, providedPassword);
    }

    public bool VerifyDecoy(string? providedPassword)
    {
        Record("VerifyDecoy");
        return _inner.VerifyDecoy(providedPassword);
    }

    private void Record(string call)
    {
        Calls.Add(call);
        _sharedLog?.Add("KDF:" + call);
    }
}

/// <summary>Records every SQL command text (reader, non-query and scalar) into a shared ordered log.</summary>
internal sealed class CommandLogInterceptor : DbCommandInterceptor
{
    private readonly List<string> _log;

    public CommandLogInterceptor(List<string> log) => _log = log;

    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<DbDataReader> result,
        CancellationToken cancellationToken = default)
    {
        _log.Add("SQL:" + command.CommandText);
        return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
    }

    public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        _log.Add("SQL:" + command.CommandText);
        return base.NonQueryExecutingAsync(command, eventData, result, cancellationToken);
    }

    public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<object> result,
        CancellationToken cancellationToken = default)
    {
        _log.Add("SQL:" + command.CommandText);
        return base.ScalarExecutingAsync(command, eventData, result, cancellationToken);
    }
}

/// <summary>An <see cref="ILogger{TCategoryName}"/> that keeps every entry (level and formatted message).</summary>
internal sealed class ListLogger<T> : ILogger<T>
{
    public List<(LogLevel Level, string Message)> Entries { get; } = [];

    public IDisposable? BeginScope<TState>(TState state)
        where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
        Entries.Add((logLevel, formatter(state, exception)));
}

/// <summary>An <see cref="IExerciseClock"/> that reports a fixed scenario instant (or none).</summary>
internal sealed class StubExerciseClock : IExerciseClock
{
    private readonly DateTimeOffset? _scenario;

    public StubExerciseClock(DateTimeOffset? scenario) => _scenario = scenario;

    public void Start(Guid exerciseId, DateTimeOffset scenarioStart, TimeZoneInfo timeZone)
    {
    }

    public void Freeze(Guid exerciseId)
    {
    }

    public void Unfreeze(Guid exerciseId)
    {
    }

    public void Jump(Guid exerciseId, int scenarioMinutes)
    {
    }

    public int CurrentScenarioMinute(Guid exerciseId) => 0;

    public DateTimeOffset? CurrentScenarioTime(Guid exerciseId) => _scenario;

    public bool IsFrozen(Guid exerciseId) => false;

    public bool IsRunning(Guid exerciseId) => _scenario is not null;
}
