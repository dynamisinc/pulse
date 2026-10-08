namespace Pulse.WebApi.Tests.Features.Social.PersonaAdmin;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// The REAL <c>Program</c> host over the shared migrated database, for the persona-edit suites (demo-polish PE-BE).
/// Identity is not faked: host resolution, session authentication, the default-deny gate and all three route gates
/// run as in production, driven by real persisted session tokens. Only <see cref="IMediaUrlSigner"/> is replaced:
/// by BP's <see cref="FakeMediaUrlSigner"/> (deterministic URLs; THROWS on a scope mismatch, like the real one) or,
/// when <c>signerFailure</c> is given, by a signer that always throws it. Every log entry is captured.
/// </summary>
public sealed class PersonaAdminWebApplicationFactory : WebApplicationFactory<Program>
{
    private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

    private readonly Exception? _signerFailure;

    /// <summary>Points the host at <paramref name="connectionString"/>.</summary>
    /// <param name="connectionString">The fixture's migrated database.</param>
    /// <param name="signerFailure">When set, every signer call throws this (a storage outage).</param>
    public PersonaAdminWebApplicationFactory(string connectionString, Exception? signerFailure = null)
    {
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);
        _signerFailure = signerFailure;
    }

    /// <summary>Every signer call the fake signer received.</summary>
    public SignerProbe Signer { get; } = new();

    /// <summary>Every log entry the host has written.</summary>
    public CapturingLoggerProvider Logs { get; } = new();

    /// <summary>A client whose base address sets the request host, presenting <paramref name="bearerToken"/> (or none).</summary>
    /// <param name="host">The request host (drives host → exercise resolution).</param>
    /// <param name="bearerToken">The raw session token, or <c>null</c> for an anonymous request.</param>
    /// <returns>The configured client.</returns>
    public HttpClient CreateClientFor(string host, string? bearerToken)
    {
        var client = CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri($"http://{host}") });
        if (bearerToken is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        }

        return client;
    }

    /// <inheritdoc />
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.ConfigureLogging(logging => logging.AddProvider(Logs));

        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IMediaUrlSigner>();
            if (_signerFailure is { } failure)
            {
                services.AddSingleton<IMediaUrlSigner>(new ThrowingMediaUrlSigner(failure));
            }
            else
            {
                services.AddScoped<IMediaUrlSigner>(sp =>
                    new FakeMediaUrlSigner(sp.GetRequiredService<IExerciseContext>(), Signer));
            }
        });
    }

    /// <inheritdoc />
    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
    }
}

/// <summary>A seeded exercise: its id and the provisioned host that resolves to it.</summary>
/// <param name="Id">The exercise id.</param>
/// <param name="Host">The exercise's provisioned hostname.</param>
public sealed record PersonaAdminExercise(Guid Id, string Host);

/// <summary>
/// Seeds and reads back the real rows the persona-edit suites need. Read-backs use <c>IgnoreQueryFilters()</c>, so
/// they see the physical row whatever any scope would allow. Every row gets fresh ids (no truncation).
/// </summary>
public sealed class PersonaAdminSeeder
{
    /// <summary>The bio every seeded persona starts with.</summary>
    public const string OriginalBio = "Official updates from the county emergency office.";

    /// <summary>The location every seeded persona starts with.</summary>
    public const string OriginalLocation = "Fairhaven, OH";

    private readonly MsSqlContainerFixture _fixture;

    /// <summary>Creates the seeder over the shared fixture.</summary>
    /// <param name="fixture">The migrated-database fixture.</param>
    public PersonaAdminSeeder(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>The fixture's connection string (asserted non-null by the Docker gate).</summary>
    public string ConnectionString => _fixture.ConnectionString
        ?? throw new InvalidOperationException("The MsSql fixture has no connection string.");

    /// <summary>A factory over the shared database.</summary>
    /// <param name="signerFailure">When set, every signer call throws this.</param>
    /// <returns>The factory.</returns>
    public PersonaAdminWebApplicationFactory CreateFactory(Exception? signerFailure = null) =>
        new(ConnectionString, signerFailure);

    /// <summary>Seeds an exercise with its own hostname.</summary>
    /// <param name="status">The lifecycle status (default <c>live</c>, so participant reads pass the lifecycle gate).</param>
    /// <returns>The seeded exercise.</returns>
    public async Task<PersonaAdminExercise> SeedExerciseAsync(string status = "live")
    {
        var id = Guid.NewGuid();
        var host = $"persona-admin-{id:N}.example.com";

        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = id,
            Name = $"Persona admin {id:N}",
            Hostname = host,
            TimeZone = "UTC",
            Status = status,
        });
        await seed.SaveChangesAsync();
        return new PersonaAdminExercise(id, host);
    }

    /// <summary>
    /// Seeds a persona in <paramref name="exerciseId"/> with every editable field populated (so an "absent = unchanged"
    /// check has something to compare) and distinctive immutable fields.
    /// </summary>
    /// <param name="exerciseId">The owning exercise.</param>
    /// <param name="avatarMediaId">An initial avatar, or <c>null</c>.</param>
    /// <param name="bannerMediaId">An initial banner, or <c>null</c>.</param>
    /// <param name="handle">The handle, or a fresh unique one.</param>
    /// <returns>The persona id.</returns>
    public async Task<Guid> SeedPersonaAsync(
        Guid exerciseId, Guid? avatarMediaId = null, Guid? bannerMediaId = null, string? handle = null)
    {
        var id = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Personas.Add(new Persona
        {
            Id = id,
            ExerciseId = exerciseId,
            DisplayName = $"Persona {id:N}",
            Handle = handle ?? $"pa_{id:N}",
            Kind = "org",
            PersonaType = "agency",
            AudienceBand = "large",
            AudienceMagnitude = 12000,
            Verified = true,
            Castable = false,
            Bio = OriginalBio,
            Location = OriginalLocation,
            AvatarMediaId = avatarMediaId,
            BannerMediaId = bannerMediaId,
        });
        await seed.SaveChangesAsync();
        return id;
    }

    /// <summary>Seeds a media asset in <paramref name="exerciseId"/>.</summary>
    /// <param name="exerciseId">The owning exercise.</param>
    /// <param name="kind">The media kind (default image).</param>
    /// <returns>The asset id.</returns>
    public async Task<Guid> SeedMediaAsync(Guid exerciseId, string kind = MediaKinds.Image)
    {
        var id = Guid.NewGuid();
        var isVideo = kind == MediaKinds.Video;
        await using var seed = _fixture.CreateContext();
        seed.MediaAssets.Add(new MediaAsset
        {
            Id = id,
            ExerciseId = exerciseId,
            Kind = kind,
            ContentType = isVideo ? "video/mp4" : "image/jpeg",
            BlobName = $"{exerciseId:D}/{id:N}.{(isVideo ? "mp4" : "jpg")}",
            Bytes = 4096,
            Width = 400,
            Height = 400,
            DurationSec = isVideo ? 8.0 : null,
            OriginalFileName = "avatar.jpg",
            UploadedByHumanId = "human-persona-admin-test",
            CreatedScenarioTime = new DateTimeOffset(2033, 9, 4, 13, 0, 0, TimeSpan.Zero),
            CreatedWallClock = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
        return id;
    }

    /// <summary>
    /// Seeds a live STAFF session active on <paramref name="activeExerciseId"/> for a fresh staff user (homed on the
    /// default organization) with the given assignments.
    /// </summary>
    /// <param name="activeExerciseId">The session's active exercise (the resolved scope).</param>
    /// <param name="assignments">The staff user's (exercise, role) assignments.</param>
    /// <param name="configure">Optional tweak to the session row (expire it, make it read-only).</param>
    /// <returns>The raw bearer token.</returns>
    public async Task<string> SeedStaffSessionAsync(
        Guid activeExerciseId,
        IReadOnlyList<(Guid ExerciseId, string Role)> assignments,
        Action<Session>? configure = null)
    {
        var token = $"persona-admin-staff-{Guid.NewGuid():N}";
        var staffUserId = Guid.NewGuid();
        var session = TestSessions.NewSession(token, activeExerciseId, kind: "staff");
        session.StaffUserId = staffUserId;
        session.PrincipalId = staffUserId.ToString();
        configure?.Invoke(session);

        await using var seed = _fixture.CreateContext();
        seed.StaffUsers.Add(StaffTenantSeed.StaffUserFor(staffUserId));
        foreach (var (exerciseId, role) in assignments)
        {
            seed.StaffAssignments.Add(new StaffAssignment
            {
                Id = Guid.NewGuid(),
                StaffUserId = staffUserId,
                ExerciseId = exerciseId,
                Role = role,
                CreatedAt = DateTimeOffset.UtcNow,
            });
        }

        seed.Sessions.Add(session);
        await seed.SaveChangesAsync();
        return token;
    }

    /// <summary>A live staff session assigned to <paramref name="exerciseId"/> as controller, active on it.</summary>
    /// <param name="exerciseId">The exercise.</param>
    /// <returns>The raw bearer token.</returns>
    public Task<string> SeedControllerSessionAsync(Guid exerciseId) =>
        SeedStaffSessionAsync(exerciseId, [(exerciseId, "controller")]);

    /// <summary>Seeds a live PARTICIPANT session bound to <paramref name="exerciseId"/>.</summary>
    /// <param name="exerciseId">The exercise (the session is host-bound to it).</param>
    /// <param name="personaId">The session's persona, or <c>null</c>.</param>
    /// <returns>The raw bearer token.</returns>
    public async Task<string> SeedParticipantSessionAsync(Guid exerciseId, Guid? personaId = null)
    {
        var token = $"persona-admin-participant-{Guid.NewGuid():N}";
        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(TestSessions.NewSession(token, exerciseId, personaId));
        await seed.SaveChangesAsync();
        return token;
    }

    /// <summary>Seeds a live SHARED READ-ONLY session bound to <paramref name="exerciseId"/>.</summary>
    /// <param name="exerciseId">The exercise.</param>
    /// <returns>The raw bearer token.</returns>
    public async Task<string> SeedReadOnlySessionAsync(Guid exerciseId)
    {
        var token = $"persona-admin-readonly-{Guid.NewGuid():N}";
        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(TestSessions.NewSession(token, exerciseId, kind: "readonly", isReadOnly: true));
        await seed.SaveChangesAsync();
        return token;
    }

    /// <summary>Reads the physical persona row, ignoring every query filter, and asserts it exists.</summary>
    /// <param name="personaId">The persona id.</param>
    /// <returns>The row, untracked.</returns>
    public async Task<Persona> ReadPersonaAsync(Guid personaId)
    {
        await using var read = _fixture.CreateContext();
        var row = await read.Personas.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(p => p.Id == personaId);
        row.Should().NotBeNull("a persona row is never deleted (XC-010)");
        return row!;
    }

    /// <summary>Whether the physical media row exists, ignoring every query filter.</summary>
    /// <param name="mediaId">The asset id.</param>
    /// <returns><c>true</c> when the row exists.</returns>
    public async Task<bool> MediaExistsAsync(Guid mediaId)
    {
        await using var read = _fixture.CreateContext();
        return await read.MediaAssets.IgnoreQueryFilters().AnyAsync(asset => asset.Id == mediaId);
    }

    /// <summary>Counts every telemetry row for <paramref name="exerciseId"/>, ignoring query filters.</summary>
    /// <param name="exerciseId">The exercise.</param>
    /// <returns>The count.</returns>
    public async Task<int> CountTelemetryAsync(Guid exerciseId)
    {
        await using var read = _fixture.CreateContext();
        return await read.TelemetryEvents.IgnoreQueryFilters().CountAsync(e => e.ExerciseId == exerciseId);
    }

    /// <summary>A fresh DbContext over the shared database (no scope, no tenant).</summary>
    /// <returns>The context.</returns>
    public PulseDbContext CreateContext() => _fixture.CreateContext();
}

/// <summary>HTTP helpers for the persona-edit suites.</summary>
public static class PersonaAdminHttp
{
    /// <summary>The merge-patch media type (RFC 7396).</summary>
    public const string MergePatchContentType = "application/merge-patch+json";

    /// <summary>The persona edit URI for <paramref name="personaId"/>.</summary>
    /// <param name="personaId">The persona id.</param>
    /// <returns>The relative URI.</returns>
    public static Uri PersonaUri(Guid personaId) => new($"/api/staff/personas/{personaId}", UriKind.Relative);

    /// <summary>Sends <c>PATCH /api/staff/personas/{personaId}</c> with <paramref name="json"/> as the body.</summary>
    /// <param name="client">The client.</param>
    /// <param name="personaId">The persona id.</param>
    /// <param name="json">The raw body.</param>
    /// <param name="contentType">The content type (default merge-patch).</param>
    /// <returns>The response.</returns>
    public static Task<HttpResponseMessage> PatchAsync(
        HttpClient client, Guid personaId, string json, string contentType = MergePatchContentType)
    {
        ArgumentNullException.ThrowIfNull(client);
        var request = new HttpRequestMessage(HttpMethod.Patch, PersonaUri(personaId))
        {
            Content = new StringContent(json, Encoding.UTF8, contentType),
        };
        return client.SendAsync(request);
    }

    /// <summary>Serializes <paramref name="body"/> (an anonymous object or dictionary) and PATCHes it.</summary>
    /// <param name="client">The client.</param>
    /// <param name="personaId">The persona id.</param>
    /// <param name="body">The body to serialize.</param>
    /// <returns>The response.</returns>
    public static Task<HttpResponseMessage> PatchAsync(HttpClient client, Guid personaId, object body) =>
        PatchAsync(client, personaId, JsonSerializer.Serialize(body));

    /// <summary>Reads a 400's plain-JSON-string body (implementation.md §1.1).</summary>
    /// <param name="response">The response.</param>
    /// <returns>The message.</returns>
    public static async Task<string> ReadMessageAsync(HttpResponseMessage response)
    {
        ArgumentNullException.ThrowIfNull(response);
        var raw = await response.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<string>(raw)
            ?? throw new InvalidOperationException("Expected a JSON string body.");
    }

    /// <summary>Reads a JSON object body.</summary>
    /// <param name="response">The response.</param>
    /// <returns>The root element (cloned).</returns>
    public static async Task<JsonElement> ReadObjectAsync(HttpResponseMessage response)
    {
        ArgumentNullException.ThrowIfNull(response);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    /// <summary>Reads <c>GET /api/personas</c> and returns the entry for <paramref name="personaId"/>, or <c>null</c>.</summary>
    /// <param name="client">The client.</param>
    /// <param name="personaId">The persona id.</param>
    /// <returns>The entry, or <c>null</c> when absent.</returns>
    public static async Task<JsonElement?> ReadPersonaFromListAsync(HttpClient client, Guid personaId)
    {
        ArgumentNullException.ThrowIfNull(client);
        var response = await client.GetAsync(new Uri("/api/personas", UriKind.Relative));
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        foreach (var entry in document.RootElement.EnumerateArray())
        {
            if (entry.GetProperty("id").GetString() == personaId.ToString())
            {
                return entry.Clone();
            }
        }

        return null;
    }

    /// <summary>Every property name on <paramref name="element"/>.</summary>
    /// <param name="element">A JSON object.</param>
    /// <returns>The names.</returns>
    public static IReadOnlyList<string> PropertyNames(JsonElement element) =>
        element.EnumerateObject().Select(property => property.Name).ToArray();
}
