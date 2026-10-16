namespace Pulse.LoadTest;

using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR.Client;

/// <summary>Counters shared by every connection, per step.</summary>
internal sealed class ConnectionCounters
{
    private readonly ConcurrentDictionary<int, long> _reconnects = new();
    private readonly ConcurrentDictionary<int, long> _closed = new();
    private readonly ConcurrentDictionary<int, long> _connectFailures = new();

    public void Reconnect(int step) => _reconnects.AddOrUpdate(step, 1, (_, n) => n + 1);

    public void Closed(int step) => _closed.AddOrUpdate(step, 1, (_, n) => n + 1);

    public void ConnectFailure(int step) => _connectFailures.AddOrUpdate(step, 1, (_, n) => n + 1);

    public long Reconnects(int step) => _reconnects.GetValueOrDefault(step);

    public long ClosedCount(int step) => _closed.GetValueOrDefault(step);

    public long ConnectFailures(int step) => _connectFailures.GetValueOrDefault(step);
}

/// <summary>
/// One load user: a real participant session (from POST /api/auth/join), one SignalR connection to the real hub
/// (/hubs/exercise, the session token through AccessTokenProvider exactly as the web client's accessTokenFactory), and
/// the activity mix: a feed read every 30 s, a like or repost about once a minute, a post about every 5 minutes,
/// some of them replies.
/// </summary>
internal sealed class VirtualParticipant : IAsyncDisposable
{
    private static readonly TimeSpan RefreshMargin = TimeSpan.FromMinutes(5);

    private readonly PulseApi _api;
    private readonly FanOutTracker _tracker;
    private readonly ConnectionCounters _counters;
    private readonly RunClock _clock;
    private readonly ActivityMix _mix;
    private readonly string _timeZone;
    private readonly Func<int, IReadOnlyCollection<int>> _otherClients;
    private readonly Random _random;
    private readonly List<string> _recentPostIds = [];
    private HubConnection? _hub;

    public VirtualParticipant(
        int id,
        PulseSession session,
        PulseApi api,
        FanOutTracker tracker,
        ConnectionCounters counters,
        RunClock clock,
        ActivityMix mix,
        string timeZone,
        Func<int, IReadOnlyCollection<int>> otherClients)
    {
        Id = id;
        Session = session;
        _api = api;
        _tracker = tracker;
        _counters = counters;
        _clock = clock;
        _mix = mix;
        _timeZone = timeZone;
        _otherClients = otherClients;
        _random = new Random(HashCode.Combine(id, Environment.TickCount));
    }

    public int Id { get; }

    public PulseSession Session { get; }

    public bool IsConnected => _hub?.State == HubConnectionState.Connected;

    /// <summary>When the hub connection last (re)connected: a frame missing right after it is a join-window artifact.</summary>
    public DateTimeOffset? ConnectedAt { get; private set; }

    /// <summary>The connection is closed for good: SignalR's automatic reconnects gave up (or it never connected).</summary>
    public bool IsClosed => _hub is null || _hub.State == HubConnectionState.Disconnected;

    /// <summary>Replaces a closed connection with a new one (step start). Returns whether it connected.</summary>
    public async Task<bool> RebuildAsync(CancellationToken ct)
    {
        await DisposeAsync();
        _hub = null;
        return await ConnectAsync(ct);
    }

    /// <summary>Opens the hub connection. Returns false (and counts a failure) when it cannot connect.</summary>
    public async Task<bool> ConnectAsync(CancellationToken ct)
    {
        _hub = new HubConnectionBuilder()
            .WithUrl(_api.HubUrl, options => options.AccessTokenProvider = () => Task.FromResult<string?>(Session.Token))
            .WithAutomaticReconnect()
            .Build();

        _hub.On<JsonElement>("PostReceived", payload =>
        {
            var at = DateTimeOffset.UtcNow;
            if (payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty("id", out var id) && id.GetString() is { } postId)
            {
                _tracker.OnFrame(Id, postId, at);
            }
        });
        _hub.Reconnecting += _ =>
        {
            _counters.Reconnect(_clock.Step);
            return Task.CompletedTask;
        };
        _hub.Reconnected += _ =>
        {
            ConnectedAt = DateTimeOffset.UtcNow;
            return Task.CompletedTask;
        };
        _hub.Closed += _ =>
        {
            _counters.Closed(_clock.Step);
            return Task.CompletedTask;
        };

        try
        {
            await _hub.StartAsync(ct);
            ConnectedAt = DateTimeOffset.UtcNow;
            return true;
        }
        catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException or System.Net.WebSockets.WebSocketException or TimeoutException
            || (ex is OperationCanceledException && !ct.IsCancellationRequested))
        {
            _counters.ConnectFailure(_clock.Step);
            return false;
        }
    }

    /// <summary>Runs the activity mix until <paramref name="ct"/> is cancelled.</summary>
    public async Task RunAsync(CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var nextFeed = now + TimeSpan.FromSeconds(_random.NextDouble() * _mix.FeedReadSeconds); // spread the herd
        var nextReaction = now + Exponential(_mix.ReactionMeanSeconds);
        var nextPost = now + Exponential(_mix.PostMeanSeconds);

        try
        {
            while (!ct.IsCancellationRequested)
            {
                var due = Min(nextFeed, nextReaction, nextPost);
                var wait = due - DateTimeOffset.UtcNow;
                if (wait > TimeSpan.Zero)
                {
                    await Task.Delay(wait, ct);
                }

                await _api.EnsureFreshAsync(Session, RefreshMargin, ct);
                now = DateTimeOffset.UtcNow;
                if (now >= nextFeed)
                {
                    await ReadFeedAsync(ct);
                    nextFeed = now + TimeSpan.FromSeconds(_mix.FeedReadSeconds);
                }
                else if (now >= nextReaction)
                {
                    await ReactAsync(ct);
                    nextReaction = now + Exponential(_mix.ReactionMeanSeconds);
                }
                else if (now >= nextPost)
                {
                    await PostAsync(ct);
                    nextPost = now + Exponential(_mix.PostMeanSeconds);
                }
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Stopped.
        }
    }

    private async Task ReadFeedAsync(CancellationToken ct)
    {
        var result = await _api.GetFeedAsync(Session, ct);
        if (result.Success && result.Json is System.Text.Json.Nodes.JsonArray posts)
        {
            _recentPostIds.Clear();
            foreach (var post in posts.Take(20))
            {
                if ((string?)post?["id"] is { } id)
                {
                    _recentPostIds.Add(id);
                }
            }
        }
    }

    private async Task ReactAsync(CancellationToken ct)
    {
        if (_recentPostIds.Count == 0)
        {
            await ReadFeedAsync(ct);
            if (_recentPostIds.Count == 0)
            {
                return;
            }
        }

        var postId = _recentPostIds[_random.Next(_recentPostIds.Count)];
        var kind = _random.NextDouble() < _mix.RepostShare ? "repost" : "like";
        await _api.ReactAsync(Session, postId, kind, ct);
    }

    private async Task PostAsync(CancellationToken ct)
    {
        string? parent = null;
        if (_recentPostIds.Count > 0 && _random.NextDouble() < _mix.ReplyShare)
        {
            parent = _recentPostIds[_random.Next(_recentPostIds.Count)];
        }

        var step = _clock.Step;
        var sentAt = DateTimeOffset.UtcNow;
        var text = parent is null
            ? $"Load participant {Id:000}: checking in, step {step + 1}, {sentAt:HH:mm:ss}."
            : $"Load participant {Id:000}: replying, step {step + 1}, {sentAt:HH:mm:ss}.";
        var expected = _otherClients(Id); // the clients connected when the post is written, sender excluded
        var result = await _api.CreateParticipantPostAsync(Session, text, _timeZone, parent, ct);
        if (result.Success && (string?)result.Json?["id"] is { } postId)
        {
            _tracker.Register(step, postId, sentAt, DateTimeOffset.UtcNow, expected);
        }
    }

    private TimeSpan Exponential(double meanSeconds) =>
        TimeSpan.FromSeconds(-Math.Log(1 - _random.NextDouble()) * meanSeconds);

    private static DateTimeOffset Min(DateTimeOffset a, DateTimeOffset b, DateTimeOffset c) =>
        a < b ? (a < c ? a : c) : (b < c ? b : c);

    public async ValueTask DisposeAsync()
    {
        if (_hub is not null)
        {
            try
            {
                await _hub.DisposeAsync();
            }
            catch (Exception ex) when (ex is InvalidOperationException or OperationCanceledException or HttpRequestException)
            {
                // Closing anyway.
            }
        }
    }
}
