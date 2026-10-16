namespace Pulse.WebApi.Tests.Features.Identity.PersonalLinks;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Features.Identity.Accounts;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.PersonalLinks;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Helpers;

/// <summary>Seeds the rows the personal-link suites need, with fresh ids per call (no table truncation).</summary>
internal static class PersonalLinkSeed
{
    /// <summary>The SPA origin the test hosts configure, so join URLs are buildable.</summary>
    public const string FrontendBaseUrl = "https://spa.pulse.test";

    /// <summary>A password the seeded password accounts use.</summary>
    public const string Password = "pw-personal-link-123";

    public static async Task<Exercise> ExerciseAsync(
        MsSqlContainerFixture fixture,
        string status = "live",
        DateTimeOffset? scenarioTime = null,
        string timeZone = "America/Chicago")
    {
        var id = Guid.NewGuid();
        var exercise = new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = id,
            Name = $"Personal links {id:N}",
            Hostname = $"pl-{id:N}.pulse.test",
            TimeZone = timeZone,
            Status = status,
            CurrentScenarioTime = scenarioTime,
        };

        await using var seed = fixture.CreateContext();
        seed.Exercises.Add(exercise);
        await seed.SaveChangesAsync();
        return exercise;
    }

    public static async Task<Account> AccountAsync(
        MsSqlContainerFixture fixture,
        Guid exerciseId,
        Guid? personaId = null,
        bool withPassword = false,
        DateTimeOffset? disabledAt = null,
        string role = "participant",
        Guid? accountId = null)
    {
        var id = accountId ?? Guid.NewGuid();
        var account = new Account
        {
            Id = id,
            ExerciseId = exerciseId,
            Username = $"user{id:N}"[..30],
            DisplayName = "Pat Participant",
            CredentialHash = withPassword ? new ParticipantPasswordHasher().Hash(Password) : null,
            CreatedAt = DateTimeOffset.UtcNow,
            DisabledAt = disabledAt,
            Enrollment = new Enrollment { Id = Guid.NewGuid(), ExerciseId = exerciseId, Role = role, PersonaId = personaId },
        };

        await using var seed = fixture.CreateContext();
        seed.Accounts.Add(account);
        await seed.SaveChangesAsync();
        return account;
    }

    /// <summary>Seeds a link for <paramref name="account"/> and returns it with its raw token.</summary>
    public static async Task<(ParticipantLink Link, string Token)> LinkAsync(
        MsSqlContainerFixture fixture,
        Account account,
        IParticipantLinkTokenProtector? protector = null,
        bool revoked = false,
        int useCount = 0,
        DateTimeOffset? lastUsedAt = null)
    {
        var token = ParticipantLinkTokens.Generate();
        var link = new ParticipantLink
        {
            Id = Guid.NewGuid(),
            ExerciseId = account.ExerciseId,
            AccountId = account.Id,
            TokenHash = ParticipantLinkTokens.Hash(token),
            ProtectedToken = revoked ? null : (protector ?? Protector()).Protect(token),
            Generation = 1,
            IssuedAt = DateTimeOffset.UtcNow.AddHours(-2),
            RevokedAt = revoked ? DateTimeOffset.UtcNow.AddHours(-1) : null,
            UseCount = useCount,
            LastUsedAt = lastUsedAt,
        };

        await using var seed = fixture.CreateContext();
        seed.ParticipantLinks.Add(link);
        await seed.SaveChangesAsync();
        return (link, token);
    }

    /// <summary>A staff user assigned to <paramref name="exerciseId"/> with <paramref name="role"/>, and a live staff session.</summary>
    public static async Task<SeededStaff> StaffAsync(MsSqlContainerFixture fixture, Guid exerciseId, string role = "controller")
    {
        var staffUserId = Guid.NewGuid();
        var rawToken = $"staff-token-{Guid.NewGuid():N}";
        var session = new Session
        {
            Id = Guid.NewGuid(),
            TokenHash = SessionTokens.Hash(rawToken),
            Kind = "staff",
            ExerciseId = exerciseId,
            PrincipalId = staffUserId.ToString(),
            StaffUserId = staffUserId,
            Role = role,
            ActingHumanId = staffUserId.ToString(),
            IssuedAt = DateTimeOffset.UtcNow.AddMinutes(-5),
            ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
        };

        await using var seed = fixture.CreateContext();
        seed.StaffUsers.Add(StaffTenantSeed.StaffUserFor(staffUserId));
        seed.Enrollments.Add(new Enrollment
        {
            Id = Guid.NewGuid(),
            PersonId = staffUserId,
            ExerciseId = exerciseId,
            Role = role,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        seed.Sessions.Add(session);
        await seed.SaveChangesAsync();

        return new SeededStaff(staffUserId, session.Id, rawToken, role);
    }

    /// <summary>A participant session for the account (live by default), with a raw refresh token.</summary>
    public static async Task<SeededSession> ParticipantSessionAsync(
        MsSqlContainerFixture fixture,
        Guid exerciseId,
        Guid accountId,
        DateTimeOffset? expiresAt = null,
        DateTimeOffset? refreshExpiresAt = null,
        DateTimeOffset? revokedAt = null)
    {
        var rawToken = $"participant-token-{Guid.NewGuid():N}";
        var rawRefresh = $"participant-refresh-{Guid.NewGuid():N}";
        var session = new Session
        {
            Id = Guid.NewGuid(),
            TokenHash = SessionTokens.Hash(rawToken),
            RefreshTokenHash = SessionTokens.Hash(rawRefresh),
            Kind = "participant",
            ExerciseId = exerciseId,
            PrincipalId = accountId.ToString(),
            AccountId = accountId,
            Role = "participant",
            ActingHumanId = accountId.ToString(),
            IssuedAt = DateTimeOffset.UtcNow.AddMinutes(-30),
            ExpiresAt = expiresAt ?? DateTimeOffset.UtcNow.AddHours(1),
            RefreshExpiresAt = refreshExpiresAt ?? DateTimeOffset.UtcNow.AddHours(12),
            RevokedAt = revokedAt,
        };

        await using var seed = fixture.CreateContext();
        seed.Sessions.Add(session);
        await seed.SaveChangesAsync();
        return new SeededSession(session.Id, rawToken, rawRefresh);
    }

    public static async Task<Session> ReadSessionAsync(MsSqlContainerFixture fixture, Guid sessionId)
    {
        await using var read = fixture.CreateContext();
        return await read.Sessions.AsNoTracking().SingleAsync(s => s.Id == sessionId);
    }

    public static async Task<ParticipantLink?> ReadLinkAsync(MsSqlContainerFixture fixture, Guid exerciseId, Guid accountId)
    {
        await using var read = fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
        return await read.ParticipantLinks.AsNoTracking().SingleOrDefaultAsync(l => l.AccountId == accountId);
    }

    public static async Task<Account> ReadAccountAsync(MsSqlContainerFixture fixture, Guid exerciseId, Guid accountId)
    {
        await using var read = fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
        return await read.Accounts.AsNoTracking().SingleAsync(a => a.Id == accountId);
    }

    public static async Task<List<TelemetryEvent>> ReadEventsAsync(MsSqlContainerFixture fixture, Guid exerciseId)
    {
        await using var read = fixture.CreateContext();
        return await read.TelemetryEvents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(e => e.ExerciseId == exerciseId)
            .OrderBy(e => e.EmittedAt)
            .ToListAsync();
    }

    /// <summary>A link service whose resolved scope is <paramref name="exerciseId"/> (the S-004 guard checks it).</summary>
    public static ParticipantLinkService LinkService(PulseDbContext context, Guid? exerciseId, IParticipantLinkTokenProtector? protector = null) =>
        new(context, new ExerciseContext { CurrentExerciseId = exerciseId }, protector ?? Protector());

    /// <summary>A protector over an ephemeral key ring (for service-level tests).</summary>
    public static IParticipantLinkTokenProtector Protector() =>
        new ParticipantLinkTokenProtector(new EphemeralDataProtectionProvider());

    /// <summary>The raw token at the end of a join URL.</summary>
    public static string TokenOf(string joinUrl) => joinUrl[(joinUrl.LastIndexOf('/') + 1)..];
}

/// <summary>A seeded staff caller.</summary>
internal sealed record SeededStaff(Guid StaffUserId, Guid SessionId, string RawToken, string Role)
{
    public CurrentStaffSession Current => new() { SessionId = SessionId, StaffUserId = StaffUserId };
}

/// <summary>A seeded participant session and its raw tokens.</summary>
internal sealed record SeededSession(Guid Id, string RawToken, string RawRefreshToken);

/// <summary>
/// A slice host composed like <c>Program.cs</c> for this feature: REAL host resolution, REAL session middleware, the
/// REAL default-deny gate, the real staff accessor, the easy-login foundation and <see cref="PersonalLinkExtensions"/>,
/// plus the password login and the session endpoints (to prove disable/refresh behaviour end to end). Every log
/// message is captured so a suite can grep it for secrets. <c>Program.cs</c> does not map these routes until the
/// orchestrator's seam commit.
/// </summary>
internal sealed class PersonalLinksTestHost : IAsyncDisposable
{
    private readonly IHost _host;

    private PersonalLinksTestHost(IHost host, CapturingLoggerProvider logs)
    {
        _host = host;
        Logs = logs;
    }

    /// <summary>Every log message the host wrote.</summary>
    public CapturingLoggerProvider Logs { get; }

    /// <summary>The host's services.</summary>
    public IServiceProvider Services => _host.Services;

    public static async Task<PersonalLinksTestHost> StartAsync(
        string connectionString,
        IDictionary<string, string?>? settings = null,
        Action<IServiceCollection>? configureServices = null)
    {
        var values = new Dictionary<string, string?> { [JoinUrlBuilder.FrontendBaseUrlKey] = PersonalLinkSeed.FrontendBaseUrl };
        foreach (var (key, value) in settings ?? new Dictionary<string, string?>())
        {
            values[key] = value;
        }

        var configuration = new ConfigurationBuilder().AddInMemoryCollection(values).Build();
        var logs = new CapturingLoggerProvider();

        var host = await new HostBuilder()
            .ConfigureAppConfiguration(builder => builder.AddConfiguration(configuration))
            .ConfigureLogging(logging =>
            {
                logging.ClearProviders();
                logging.SetMinimumLevel(LogLevel.Trace);
                logging.AddProvider(logs);
            })
            .ConfigureWebHost(webHost =>
            {
                webHost
                    .UseTestServer()
                    .ConfigureServices(services =>
                    {
                        services.AddRouting();
                        services.AddDbContext<PulseDbContext>(options => options.UseSqlServer(connectionString));
                        services.AddExerciseScoping();
                        services.AddExerciseResolution();
                        services.AddStaffIdentity(configuration);
                        services.AddSessions(configuration);
                        services.AddSessionAuthorization();
                        services.AddParticipantAccounts();
                        services.AddEasyLoginFoundation();
                        services.AddPersonalLinks();
                        configureServices?.Invoke(services);
                    })
                    .Configure(app =>
                    {
                        app.UseRouting();

                        // Program.cs order: host (provisional) → session (precedence) → default-deny → limiter.
                        app.UseExerciseResolution();
                        app.UseSessionAuthentication();
                        app.UseAuthorization();
                        app.UseRateLimiter();

                        app.UseEndpoints(endpoints =>
                        {
                            endpoints.MapPersonalLinkEndpoints();
                            endpoints.MapAccountEndpoints();
                            endpoints.MapSessionEndpoints();
                        });
                    });
            })
            .StartAsync();

        return new PersonalLinksTestHost(host, logs);
    }

    /// <summary>A client whose base address sets the request <c>Host</c> (host resolution), optionally bearing a token.</summary>
    public HttpClient Client(string? host, string? bearerToken = null)
    {
        var client = _host.GetTestClient();
        client.BaseAddress = new Uri($"http://{host ?? "unknown.pulse.test"}");
        if (bearerToken is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        }

        return client;
    }

    public static Task<HttpResponseMessage> JoinAsync(HttpClient client, string token) =>
        client.PostAsJsonAsync(JoinEndpoints.JoinRoute, new { token });

    public static Task<HttpResponseMessage> ActionAsync(HttpClient client, Guid accountId, string action) =>
        client.PostAsync($"/api/staff/roster/{accountId}/{action}", content: null);

    public static async Task<JsonElement> JsonAsync(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();

    public async ValueTask DisposeAsync()
    {
        await _host.StopAsync();
        _host.Dispose();
    }
}

/// <summary>
/// Wraps the real issuer and runs <c>race</c> (a staff change on another connection) just before the session is minted,
/// i.e. AFTER the join's lookup admitted the token: the Gate-1 W-001 race, made deterministic.
/// </summary>
internal sealed class RacingSessionIssuer(ISessionIssuer inner, Func<Task> race) : ISessionIssuer
{
    public async Task<SessionIssueResult> IssueAsync(SessionIssueRequest request, CancellationToken cancellationToken = default)
    {
        await race();
        return await inner.IssueAsync(request, cancellationToken);
    }
}

/// <summary>Collects every formatted log message (and exception text) a host writes.</summary>
internal sealed class CapturingLoggerProvider : ILoggerProvider
{
    private readonly ConcurrentQueue<string> _messages = new();

    public IReadOnlyCollection<string> Messages => _messages.ToArray();

    public ILogger CreateLogger(string categoryName) => new CapturingLogger(categoryName, _messages);

    public void Dispose()
    {
    }

    private sealed class CapturingLogger(string category, ConcurrentQueue<string> messages) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull
        {
            messages.Enqueue($"{category} scope: {state}");
            return null;
        }

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            var structured = state is IEnumerable<KeyValuePair<string, object?>> pairs
                ? string.Join(";", pairs.Select(pair => $"{pair.Key}={pair.Value}"))
                : string.Empty;
            messages.Enqueue($"{category} [{logLevel}] {formatter(state, exception)} {structured} {exception}");
        }
    }
}
