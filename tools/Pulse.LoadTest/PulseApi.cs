namespace Pulse.LoadTest;

using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;

/// <summary>A signed-in session (participant or staff). The token is mutable: a refresh rotates it.</summary>
internal sealed class PulseSession
{
    public required string Token { get; set; }

    public string? RefreshToken { get; set; }

    public DateTimeOffset? ExpiresAt { get; set; }

    public required string ExerciseId { get; init; }

    public string? PersonaId { get; init; }

    public string? ActingHumanId { get; init; }

    public static PulseSession FromLoginJson(JsonNode node)
    {
        var session = node["session"] ?? throw new InvalidDataException("the sign-in answer has no session.");
        return new PulseSession
        {
            Token = (string?)node["token"] ?? throw new InvalidDataException("the sign-in answer has no token."),
            RefreshToken = (string?)node["refreshToken"],
            ExpiresAt = DateTimeOffset.TryParse((string?)session["expiresAt"], System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AssumeUniversal, out var expires) ? expires : null,
            ExerciseId = (string?)session["exerciseId"] ?? string.Empty,
            PersonaId = (string?)session["personaId"],
            ActingHumanId = (string?)session["actingHumanId"],
        };
    }
}

/// <summary>The shared step counter samples are stamped with.</summary>
internal sealed class RunClock
{
    private int _step = -1;

    public int Step { get => Volatile.Read(ref _step); set => Volatile.Write(ref _step, value); }
}

/// <summary>The result of one API call: status (0 = no answer), parsed JSON body when there was one.</summary>
internal sealed record ApiResult(int Status, JsonNode? Json)
{
    public bool Success => Status is >= 200 and < 300;
}

/// <summary>
/// Every Pulse route the harness uses, each verified against src/Pulse.WebApi. Calls are timed into the
/// <see cref="SampleLog"/>. Redirects are never followed (a redirect on a secret-bearing call is refused, as in the UAT
/// scripts), and no token, secret or join link is ever logged.
/// </summary>
internal sealed class PulseApi : IDisposable
{
    public const string HubPath = "/hubs/exercise";

    private readonly HttpClient _http;
    private readonly SampleLog _log;
    private readonly RunClock _clock;

    public PulseApi(Uri origin, TimeSpan timeout, SampleLog log, RunClock clock)
    {
        Origin = origin;
        _log = log;
        _clock = clock;
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            MaxConnectionsPerServer = 512,
            PooledConnectionLifetime = TimeSpan.FromMinutes(5),
            AutomaticDecompression = DecompressionMethods.All,
        };
        _http = new HttpClient(handler) { BaseAddress = origin, Timeout = timeout };
        _http.DefaultRequestHeaders.Accept.ParseAdd("application/json");
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("Pulse.LoadTest/1.0");
    }

    public Uri Origin { get; }

    public Uri HubUrl => new(Origin, HubPath);

    // ── Anonymous ────────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>GET /api/exercise-context — the exercise the host resolves to (exerciseId, exerciseName, timeZone, status).</summary>
    public Task<ApiResult> GetExerciseContextAsync(CancellationToken ct) => SendAsync(HttpMethod.Get, "/api/exercise-context", null, null, null, ct);

    /// <summary>POST /api/auth/join {token} — a participant session (rate-limited: 30/min, one global bucket).</summary>
    public Task<ApiResult> JoinAsync(string joinToken, CancellationToken ct) =>
        SendAsync(HttpMethod.Post, "/api/auth/join", null, new { token = joinToken }, Metrics.Join, ct);

    /// <summary>POST /api/auth/staff/login {username, secret, exerciseId} (10/min).</summary>
    public Task<ApiResult> StaffLoginAsync(string username, string secret, string exerciseId, CancellationToken ct) =>
        SendAsync(HttpMethod.Post, "/api/auth/staff/login", null, new { username, secret, exerciseId }, null, ct);

    /// <summary>POST /api/auth/refresh {refreshToken} — rotates the session's tokens.</summary>
    public async Task<bool> RefreshAsync(PulseSession session, CancellationToken ct)
    {
        if (session.RefreshToken is null)
        {
            return false;
        }

        var result = await SendAsync(HttpMethod.Post, "/api/auth/refresh", null, new { refreshToken = session.RefreshToken }, Metrics.Refresh, ct);
        if (!result.Success || result.Json is null)
        {
            return false;
        }

        var renewed = PulseSession.FromLoginJson(result.Json);
        session.Token = renewed.Token;
        session.RefreshToken = renewed.RefreshToken ?? session.RefreshToken;
        session.ExpiresAt = renewed.ExpiresAt;
        return true;
    }

    /// <summary>Refreshes when the session expires within <paramref name="margin"/>. Never throws for a failed refresh.</summary>
    public async Task EnsureFreshAsync(PulseSession session, TimeSpan margin, CancellationToken ct)
    {
        if (session.ExpiresAt is { } expires && expires - DateTimeOffset.UtcNow < margin)
        {
            await RefreshAsync(session, ct);
        }
    }

    /// <summary>POST /api/auth/logout — always 204. Best effort.</summary>
    public async Task LogoutAsync(PulseSession session, CancellationToken ct)
    {
        try
        {
            await SendAsync(HttpMethod.Post, "/api/auth/logout", session, null, null, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or OperationCanceledException)
        {
            // The session expires on its own.
        }
    }

    // ── Participant ──────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>GET /api/feed — the whole All feed (an unpaged array of ParticipantPostDto).</summary>
    public Task<ApiResult> GetFeedAsync(PulseSession session, CancellationToken ct) => SendAsync(HttpMethod.Get, "/api/feed", session, null, Metrics.Feed, ct);

    /// <summary>POST /api/posts as a participant (origin participant; the author is the session's persona).</summary>
    public Task<ApiResult> CreateParticipantPostAsync(PulseSession session, string text, string timeZone, string? parentPostId, CancellationToken ct) =>
        SendAsync(HttpMethod.Post, "/api/posts", session, new
        {
            text,
            timeZone,
            scenarioTime = DateTimeOffset.UtcNow.ToString("O", System.Globalization.CultureInfo.InvariantCulture),
            origin = "participant",
            parentPostId,
        }, parentPostId is null ? Metrics.Post : Metrics.Reply, ct);

    /// <summary>PUT /api/posts/{id}/reactions/{like|repost} — idempotent.</summary>
    public Task<ApiResult> ReactAsync(PulseSession session, string postId, string kind, CancellationToken ct) =>
        SendAsync(HttpMethod.Put, $"/api/posts/{Uri.EscapeDataString(postId)}/reactions/{kind}", session, null, Metrics.Reaction, ct);

    // ── Controller (staff) ───────────────────────────────────────────────────────────────────────────────────────

    /// <summary>POST /api/posts as controller-as-persona (staff session; the persona must be in the exercise).</summary>
    public Task<ApiResult> CreateControllerPostAsync(PulseSession staff, string personaId, string text, string timeZone, CancellationToken ct) =>
        SendAsync(HttpMethod.Post, "/api/posts", staff, new
        {
            authorPersonaId = personaId,
            actingHumanId = staff.ActingHumanId,
            text,
            timeZone,
            scenarioTime = DateTimeOffset.UtcNow.ToString("O", System.Globalization.CultureInfo.InvariantCulture),
            origin = "controller-as-persona",
        }, Metrics.ControllerPost, ct);

    /// <summary>GET /api/personas (staff projection: id, handle, displayName, kind, ...).</summary>
    public Task<ApiResult> GetPersonasAsync(PulseSession staff, CancellationToken ct) => SendAsync(HttpMethod.Get, "/api/personas", staff, null, null, ct);

    /// <summary>PUT /api/staff/noise {level: off|low|medium|high} (controller).</summary>
    public Task<ApiResult> SetNoiseAsync(PulseSession staff, string level, CancellationToken ct) =>
        SendAsync(HttpMethod.Put, "/api/staff/noise", staff, new { level }, Metrics.Noise, ct);

    /// <summary>GET /api/injects — the run sheet ({items: [{id, kind, title, status, order, ...}], pauseTier}).</summary>
    public Task<ApiResult> GetInjectsAsync(PulseSession staff, CancellationToken ct) => SendAsync(HttpMethod.Get, "/api/injects", staff, null, null, ct);

    /// <summary>POST /api/injects — creates a run-sheet item (here: a 20-post burst at the 57 s minimum window).</summary>
    public Task<ApiResult> CreateBurstItemAsync(PulseSession staff, string title, IReadOnlyList<string> personaIds, CancellationToken ct)
    {
        var posts = Enumerable.Range(0, BurstItem.Posts)
            .Select(i => new { personaId = personaIds[i % personaIds.Count], text = $"Load burst post {i + 1:00} ({title})." })
            .ToArray();
        return SendAsync(HttpMethod.Post, "/api/injects", staff, new
        {
            kind = "burst",
            title,
            burstWindowSeconds = BurstItem.WindowSeconds,
            posts,
        }, null, ct);
    }

    /// <summary>POST /api/injects/{id}/fire (controller; its own rate limit).</summary>
    public Task<ApiResult> FireInjectAsync(PulseSession staff, string itemId, CancellationToken ct) =>
        SendAsync(HttpMethod.Post, $"/api/injects/{Uri.EscapeDataString(itemId)}/fire", staff, null, Metrics.InjectFire, ct);

    // ── Transport ────────────────────────────────────────────────────────────────────────────────────────────────

    private async Task<ApiResult> SendAsync(HttpMethod method, string path, PulseSession? session, object? body, string? metric, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(method, path);
        if (session is not null)
        {
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", session.Token);
        }

        if (body is not null)
        {
            request.Content = JsonContent.Create(body, options: SerializerOptions);
        }

        var started = DateTimeOffset.UtcNow;
        var watch = Stopwatch.StartNew();
        var status = 0;
        JsonNode? json = null;
        try
        {
            using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseContentRead, ct);
            status = (int)response.StatusCode;
            var text = await response.Content.ReadAsStringAsync(ct);
            watch.Stop();
            if (status is >= 200 and < 300 && text.Length > 0 && (text[0] == '{' || text[0] == '['))
            {
                try
                {
                    json = JsonNode.Parse(text);
                }
                catch (JsonException)
                {
                    json = null;
                }
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            watch.Stop();
            status = 0;
        }

        if (metric is not null)
        {
            _log.Add(new RequestSample(started, _clock.Step, metric, Math.Round(watch.Elapsed.TotalMilliseconds, 1), status, status is >= 200 and < 300));
        }

        return new ApiResult(status, json);
    }

    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    public void Dispose() => _http.Dispose();
}

/// <summary>The burst item's shape: the validator's maximum posts at the minimum 3 s gap (InjectItemValidator / InjectBurstPacing).</summary>
internal static class BurstItem
{
    /// <summary>InjectItemValidator.MaxBurstPosts.</summary>
    public const int Posts = 20;

    /// <summary>InjectBurstPacing.MinimumWindowSeconds(20) = 19 gaps × 3 s.</summary>
    public const int WindowSeconds = 57;
}
