namespace Pulse.WebApi.Tests.Features.Identity.DayWord;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
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
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Features.Identity.DayWord;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;

/// <summary>
/// A minimal ASP.NET Core pipeline that wires the REAL host resolution, session authentication, default-deny
/// authorization, rate limiter and the REAL day-word slice in <c>Program.cs</c>'s relative order
/// (<c>UseExerciseResolution()</c> → <c>UseSessionAuthentication()</c> → <c>UseAuthorization()</c> →
/// <c>UseRateLimiter()</c> → endpoints), against the shared SQL Server. <c>Program.cs</c> does not map these routes
/// until the orchestrator's seam commit, so this is the documented "test the slice without editing the composition
/// root" host (as <c>SharedReadOnlyTestHost</c>). The wall clock is a fixed <see cref="ManualTimeProvider"/> registered
/// before <c>AddEasyLoginFoundation()</c> (whose <c>TryAdd</c> keeps it), so "today" is deterministic. Every log line
/// any component writes, at every level, is captured for the no-secret assertions.
/// </summary>
internal sealed class DayWordHttpTestHost : IAsyncDisposable
{
    private readonly IHost _host;

    private DayWordHttpTestHost(IHost host, CapturingLoggerProvider logs)
    {
        _host = host;
        Logs = logs;
    }

    /// <summary>Every log entry written while the host ran.</summary>
    public CapturingLoggerProvider Logs { get; }

    /// <summary>The host's root services (for metadata assertions).</summary>
    public IServiceProvider Services => _host.Services;

    /// <summary>Boots the pipeline against <paramref name="connectionString"/>.</summary>
    public static async Task<DayWordHttpTestHost> StartAsync(
        string connectionString,
        DateTimeOffset? now = null,
        IDictionary<string, string?>? settings = null)
    {
        var logs = new CapturingLoggerProvider();

        var host = await new HostBuilder()
            .ConfigureAppConfiguration(configuration => configuration.AddInMemoryCollection(settings ?? new Dictionary<string, string?>()))
            .ConfigureLogging(logging => logging.AddProvider(logs).SetMinimumLevel(LogLevel.Trace))
            .ConfigureWebHost(webHost =>
            {
                webHost
                    .UseTestServer()
                    .ConfigureServices((context, services) =>
                    {
                        services.AddRouting();
                        services.AddSingleton<TimeProvider>(new ManualTimeProvider(now ?? DayWordTestSupport.DefaultNow));
                        services.AddDbContext<PulseDbContext>(options => options.UseSqlServer(connectionString));
                        services.AddExerciseScoping();
                        services.AddExerciseResolution();
                        services.AddStaffIdentity(context.Configuration);
                        services.AddSessions(context.Configuration);
                        services.AddSessionAuthorization();
                        services.AddExerciseClock();
                        services.AddEasyLoginFoundation();
                        services.AddDayWord();
                    })
                    .Configure(app =>
                    {
                        app.UseRouting();
                        app.UseExerciseResolution();
                        app.UseSessionAuthentication();
                        app.UseAuthorization();
                        app.UseRateLimiter();
                        app.UseEndpoints(endpoints => endpoints.MapDayWordEndpoints());
                    });
            })
            .StartAsync();

        return new DayWordHttpTestHost(host, logs);
    }

    /// <summary>A client whose base-address host populates <c>Request.Host</c>, optionally bearing a session token.</summary>
    public HttpClient CreateClient(string host, string? bearerToken = null)
    {
        var client = _host.GetTestClient();
        client.BaseAddress = new Uri($"http://{host}");
        if (bearerToken is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        }

        return client;
    }

    /// <summary>A live staff session row for <paramref name="staffUserId"/> whose active exercise is <paramref name="exerciseId"/>.</summary>
    public static Session StaffSession(string rawToken, Guid exerciseId, Guid staffUserId, string role = "controller") => new()
    {
        Id = Guid.NewGuid(),
        TokenHash = SessionTokens.Hash(rawToken),
        Kind = "staff",
        ExerciseId = exerciseId,
        PrincipalId = staffUserId.ToString(),
        StaffUserId = staffUserId,
        Role = role,
        ActingHumanId = staffUserId.ToString(),
        IsReadOnly = false,
        IssuedAt = DateTimeOffset.UtcNow.AddMinutes(-5),
        ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
    };

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        await _host.StopAsync();
        _host.Dispose();
    }
}

/// <summary>Captures every log entry (message and exception text) from every category, at every level.</summary>
internal sealed class CapturingLoggerProvider : ILoggerProvider
{
    public ConcurrentQueue<string> Entries { get; } = new();

    public ILogger CreateLogger(string categoryName) => new CapturingLogger(categoryName, Entries);

    public void Dispose()
    {
    }

    private sealed class CapturingLogger : ILogger
    {
        private readonly string _category;
        private readonly ConcurrentQueue<string> _entries;

        public CapturingLogger(string category, ConcurrentQueue<string> entries)
        {
            _category = category;
            _entries = entries;
        }

        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            var structured = state is IEnumerable<KeyValuePair<string, object?>> pairs
                ? string.Join(";", System.Linq.Enumerable.Select(pairs, pair => $"{pair.Key}={pair.Value}"))
                : string.Empty;
            _entries.Enqueue($"{logLevel} {_category}: {formatter(state, exception)} | {structured} | {exception}");
        }
    }
}
