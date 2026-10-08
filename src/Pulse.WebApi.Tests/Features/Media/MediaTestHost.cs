namespace Pulse.WebApi.Tests.Features.Media;

using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// The REAL <c>Program</c> host for the media suites — no self-mapped routes, no <see cref="IExerciseContext"/>
/// override: every request travels host→exercise resolution, session authentication (real seeded sessions and
/// bearer tokens), the default-deny gate, the lifecycle gate, the rate limiter and the read-only filter, exactly as
/// in production. Settings are applied with <c>UseSetting</c> (the options bind lazily, so they are honoured) and the
/// environment is selectable; the Development <c>Local</c> store writes under a per-host temp directory.
/// </summary>
internal sealed class MediaTestHost : WebApplicationFactory<Program>
{
    private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

    private readonly string _environment;
    private readonly IReadOnlyDictionary<string, string?> _settings;
    private readonly Action<IServiceCollection>? _configureServices;

    public MediaTestHost(
        string connectionString,
        string environment = "Development",
        IReadOnlyDictionary<string, string?>? settings = null,
        Action<IServiceCollection>? configureServices = null)
    {
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);
        _environment = environment;
        LocalRoot = Path.Combine(Path.GetTempPath(), $"pulse-media-host-{Guid.NewGuid():N}");
        _configureServices = configureServices;

        var merged = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase)
        {
            ["Azure:BlobStorage:LocalRootPath"] = LocalRoot,
        };
        foreach (var (key, value) in settings ?? new Dictionary<string, string?>())
        {
            merged[key] = value;
        }

        _settings = merged;
    }

    /// <summary>The temp directory the Development <c>Local</c> store writes to for this host.</summary>
    public string LocalRoot { get; }

    public HttpClient CreateClientFor(string host, string? bearerToken)
    {
        var client = CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri($"http://{host}") });
        if (bearerToken is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        }

        return client;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.UseEnvironment(_environment);
        foreach (var (key, value) in _settings)
        {
            builder.UseSetting(key, value);
        }

        if (_configureServices is not null)
        {
            builder.ConfigureTestServices(_configureServices);
        }
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        if (Directory.Exists(LocalRoot))
        {
            Directory.Delete(LocalRoot, recursive: true);
        }
    }
}

/// <summary>Seeds the exercises, sessions, staff and media rows the media suites drive the real host with.</summary>
internal static class MediaSeed
{
    public static readonly DateTimeOffset ScenarioTime = new(2033, 9, 4, 13, 0, 0, TimeSpan.FromHours(-5));

    /// <summary>An exercise with a provisioned host the real resolution middleware maps to it.</summary>
    public sealed record SeededExercise(Guid ExerciseId, string Host);

    /// <summary>A seeded live session and the raw token to present.</summary>
    public sealed record SeededSession(string Token, Session Session);

    public static SeededExercise NewExercise(PulseDbContext context, string status = "live")
    {
        var exerciseId = Guid.NewGuid();
        var host = $"media-{exerciseId:N}.pulse.test";
        context.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = exerciseId,
            Name = "Media suite exercise",
            Hostname = host,
            TimeZone = "UTC",
            Status = status,
            CurrentScenarioTime = ScenarioTime,
        });
        return new SeededExercise(exerciseId, host);
    }

    /// <summary>A live participant session bound to a persona in <paramref name="exercise"/>.</summary>
    public static SeededSession Participant(PulseDbContext context, SeededExercise exercise, string? accountId = null, bool withPersona = true)
    {
        var token = $"media-participant-{Guid.NewGuid():N}";
        var session = TestSessions.NewSession(token, exercise.ExerciseId, personaId: withPersona ? Guid.NewGuid() : null);
        session.PrincipalId = accountId ?? Guid.NewGuid().ToString();
        context.Sessions.Add(session);
        return new SeededSession(token, session);
    }

    /// <summary>A live shared read-only session for <paramref name="exercise"/>.</summary>
    public static SeededSession ReadOnly(PulseDbContext context, SeededExercise exercise)
    {
        var token = $"media-readonly-{Guid.NewGuid():N}";
        var session = TestSessions.NewSession(token, exercise.ExerciseId, personaId: Guid.NewGuid(), kind: "readonly", isReadOnly: true);
        context.Sessions.Add(session);
        return new SeededSession(token, session);
    }

    /// <summary>A live staff session whose active exercise is <paramref name="activeExercise"/>, optionally assigned to it.</summary>
    public static SeededSession Staff(PulseDbContext context, SeededExercise activeExercise, bool assigned = true, string role = "controller")
    {
        var staffUserId = Guid.NewGuid();
        context.StaffUsers.Add(StaffTenantSeed.StaffUserFor(staffUserId));
        if (assigned)
        {
            context.StaffAssignments.Add(new StaffAssignment
            {
                Id = Guid.NewGuid(),
                StaffUserId = staffUserId,
                ExerciseId = activeExercise.ExerciseId,
                Role = role,
                CreatedAt = DateTimeOffset.UtcNow,
            });
        }

        var token = $"media-staff-{Guid.NewGuid():N}";
        var session = TestSessions.NewSession(token, activeExercise.ExerciseId, kind: "staff");
        session.StaffUserId = staffUserId;
        session.PrincipalId = staffUserId.ToString();
        context.Sessions.Add(session);
        return new SeededSession(token, session);
    }

    /// <summary>A media row (no blob needed for list/poster checks).</summary>
    public static MediaAsset Asset(
        PulseDbContext context,
        SeededExercise exercise,
        string kind = MediaKinds.Image,
        string uploadedBy = "seed-human",
        DateTimeOffset? scenarioTime = null,
        Guid? posterId = null,
        string? fileName = null)
    {
        var id = Guid.NewGuid();
        var extension = kind == MediaKinds.Image ? "png" : "mp4";
        var asset = new MediaAsset
        {
            Id = id,
            ExerciseId = exercise.ExerciseId,
            Kind = kind,
            ContentType = kind == MediaKinds.Image ? "image/png" : "video/mp4",
            BlobName = Pulse.WebApi.Features.Media.MediaBlobNames.Build(exercise.ExerciseId, id, extension),
            Bytes = 1234,
            Width = 640,
            Height = 480,
            DurationSec = kind == MediaKinds.Video ? 12.5 : null,
            OriginalFileName = fileName ?? $"seed-{id:N}.{extension}",
            UploadedByHumanId = uploadedBy,
            CreatedScenarioTime = scenarioTime ?? ScenarioTime,
            CreatedWallClock = DateTimeOffset.UtcNow,
            PosterMediaAssetId = posterId,
        };
        context.MediaAssets.Add(asset);
        return asset;
    }
}
