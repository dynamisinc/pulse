namespace Pulse.WebApi.Tests.Features.Weather.Zones;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Weather.Zones;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Pulse.WebApi.Tests.Features.Identity.DayWord;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// Weather story 02 service harness (no Docker): one in-memory <see cref="PulseDbContext"/> store shared by every exercise,
/// with the REAL central exercise + soft-delete filter, write guard and soft-delete conversion, so a cross-exercise lookup
/// misses and a delete is retained exactly as on SQL Server. Each <see cref="Service"/> call builds the service the way a
/// request scope would: a fresh context scoped to the caller's exercise and a stub staff session. HTTP, gate, role and
/// unique-index behaviour is covered on real SQL by <c>WeatherZoneEndpointsTests</c>.
/// </summary>
internal sealed class WeatherZoneHarness : IDisposable
{
    public static readonly DateTimeOffset ScenarioNow = new(2026, 12, 2, 14, 0, 0, TimeSpan.Zero);

    private readonly string _dbName = $"weather-zones-{Guid.NewGuid():N}";
    private readonly List<IDisposable> _disposables = [];

    public ManualTimeProvider Time { get; } = new(new DateTimeOffset(2026, 11, 2, 9, 0, 0, TimeSpan.Zero));

    /// <summary>A fresh exercise row (no zones: nothing is auto-created) and its staff user id.</summary>
    public (Guid ExerciseId, Guid StaffUserId) NewExercise()
    {
        var exerciseId = Guid.NewGuid();
        using var db = Db(exerciseId);
        db.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = exerciseId,
            Name = "Kestrel County storm",
            TimeZone = "America/Chicago",
            Status = "live",
        });
        db.SaveChanges();
        return (exerciseId, Guid.NewGuid());
    }

    /// <summary>The service as one request in <paramref name="exerciseId"/> as <paramref name="staffUserId"/> would get it.</summary>
    public WeatherZoneService Service(Guid? exerciseId, Guid? staffUserId)
    {
        Time.Advance(TimeSpan.FromMilliseconds(10));
        var db = Db(exerciseId);
        _disposables.Add(db);
        return new WeatherZoneService(
            db,
            new ExerciseContext { CurrentExerciseId = exerciseId },
            new StubCurrentStaffSessionAccessor(staffUserId is { } staff
                ? new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = staff }
                : null),
            new StubExerciseClock(ScenarioNow),
            new ExerciseFactsReader(db),
            Time,
            NullLogger<WeatherZoneService>.Instance);
    }

    /// <summary>A context outside any request, scoped to <paramref name="exerciseId"/> (null = unscoped).</summary>
    public PulseDbContext Db(Guid? exerciseId) =>
        new(
            new DbContextOptionsBuilder<PulseDbContext>().UseInMemoryDatabase(_dbName).Options,
            new ExerciseContext { CurrentExerciseId = exerciseId });

    /// <summary>Seeds a zone directly (bypassing the service), for read-side and isolation setups.</summary>
    public WeatherZone AddZone(
        Guid exerciseId,
        string slug,
        string? name = null,
        int sortOrder = 1,
        bool isDefault = false,
        bool deleted = false)
    {
        var zone = new WeatherZone
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            Slug = slug,
            Name = name ?? slug,
            Kind = "county",
            SortOrder = sortOrder,
            IsDefault = isDefault,
            Version = 1,
            DeletedAt = deleted ? DateTimeOffset.UtcNow : null,
        };
        using var db = Db(exerciseId);
        db.WeatherZones.Add(zone);
        db.SaveChanges();
        return zone;
    }

    /// <summary>Every zone row of an exercise, deleted included, in display order.</summary>
    public async Task<List<WeatherZone>> AllZonesAsync(Guid exerciseId)
    {
        await using var db = Db(exerciseId);
        return (await db.IncludingSoftDeleted<WeatherZone>().AsNoTracking().ToListAsync())
            .OrderBy(zone => zone.SortOrder).ThenBy(zone => zone.Slug, StringComparer.Ordinal).ToList();
    }

    /// <summary>The <c>weather_zone_changed</c> events of an exercise, oldest first.</summary>
    public async Task<List<TelemetryEvent>> ZoneEventsAsync(Guid exerciseId)
    {
        await using var db = Db(exerciseId);
        return (await db.TelemetryEvents.AsNoTracking().Where(e => e.EventType == "weather_zone_changed").ToListAsync())
            .OrderBy(e => e.WallClockTime).ToList();
    }

    public static JsonElement Payload(TelemetryEvent telemetryEvent) => JsonDocument.Parse(telemetryEvent.Payload!).RootElement;

    public static WeatherZoneWriteRequest Body(
        string slug = "kestrel-county-north",
        string name = "Kestrel County (North)",
        string kind = "county",
        string? description = null,
        int? sortOrder = null,
        bool? isDefault = null,
        int? version = null) => new()
        {
            Slug = slug,
            Name = name,
            Kind = kind,
            Description = description,
            SortOrder = sortOrder,
            IsDefault = isDefault,
            Version = version,
        };

    public void Dispose()
    {
        foreach (var disposable in _disposables)
        {
            disposable.Dispose();
        }
    }
}
