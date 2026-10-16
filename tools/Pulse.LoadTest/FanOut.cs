namespace Pulse.LoadTest;

using System.Collections.Concurrent;

/// <summary>
/// SignalR fan-out lag: for each post the harness writes, the time from "post accepted" (the 201 reaching the harness)
/// to <c>PostReceived</c> at every OTHER connected client. The server broadcasts before it answers, so a frame can land
/// before the 201; that counts as 0 ms lag (and is counted as "early"). The time from the request being SENT is kept
/// too, as end-to-end lag. Frames still missing after <see cref="FanOutSettings.DroppedAfterSeconds"/> are dropped;
/// frames later than <see cref="FanOutSettings.LateAfterSeconds"/> are late.
/// </summary>
internal sealed class FanOutTracker
{
    private readonly FanOutSettings _settings;
    private readonly ConcurrentDictionary<string, TrackedPost> _posts = new(StringComparer.OrdinalIgnoreCase);

    // A frame can arrive before the harness knows the post id (before the 201): keep it, matched on registration.
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<int, DateTimeOffset>> _early = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<int, StepFanOut> _steps = new();
    private readonly ConcurrentQueue<DroppedFrames> _drops = new();

    /// <summary>Every post with missing frames: which clients never got it (written to fanout-drops.csv).</summary>
    public IReadOnlyList<DroppedFrames> Drops => _drops.ToArray();

    public FanOutTracker(FanOutSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        _settings = settings;
    }

    /// <summary>Frames for posts the harness did not write (noise, the burst item): counted, not timed.</summary>
    public long UntrackedFrames => Interlocked.Read(ref _untracked);

    private long _untracked;

    /// <summary>
    /// Registers a post the harness wrote: sent at <paramref name="sentAt"/>, accepted at <paramref name="acceptedAt"/>,
    /// expected at every client in <paramref name="expectedClients"/> (connected at accept time, sender excluded).
    /// </summary>
    public void Register(int step, string postId, DateTimeOffset sentAt, DateTimeOffset acceptedAt, IReadOnlyCollection<int> expectedClients)
    {
        var post = new TrackedPost(step, sentAt, acceptedAt, new HashSet<int>(expectedClients));
        _posts[postId] = post;
        DrainEarly(postId, post);
    }

    private void DrainEarly(string postId, TrackedPost post)
    {
        if (_early.TryRemove(postId, out var early))
        {
            foreach (var (client, at) in early)
            {
                post.Receive(client, at, Stats(post.Step), _settings);
            }
        }
    }

    /// <summary>A <c>PostReceived</c> frame for <paramref name="postId"/> at client <paramref name="clientId"/>.</summary>
    public void OnFrame(int clientId, string postId, DateTimeOffset at)
    {
        if (_posts.TryGetValue(postId, out var post))
        {
            post.Receive(clientId, at, Stats(post.Step), _settings);
            return;
        }

        // Unknown yet: either our POST's 201 has not come back, or the post is not ours. Hold it briefly.
        var bucket = _early.GetOrAdd(postId, _ => new ConcurrentDictionary<int, DateTimeOffset>());
        bucket.TryAdd(clientId, at);
    }

    /// <summary>
    /// Settles everything older than the drop horizon at <paramref name="now"/> (or everything, with
    /// <paramref name="all"/>): missing frames become dropped; held unknown frames become untracked.
    /// </summary>
    public void Sweep(DateTimeOffset now, bool all = false)
    {
        var horizon = TimeSpan.FromSeconds(_settings.DroppedAfterSeconds);
        foreach (var (id, post) in _posts)
        {
            if (all || now - post.AcceptedAt >= horizon)
            {
                if (_posts.TryRemove(id, out _))
                {
                    DrainEarly(id, post); // a frame that raced the registration is a delivery, not a drop
                    var missing = post.Settle(Stats(post.Step));
                    if (missing.Length > 0)
                    {
                        _drops.Enqueue(new DroppedFrames(post.Step, id, post.AcceptedAt, missing));
                    }
                }
            }
        }

        foreach (var (id, bucket) in _early)
        {
            if (_posts.TryGetValue(id, out var known))
            {
                DrainEarly(id, known); // a frame that raced the registration
                continue;
            }

            var oldest = bucket.Values.DefaultIfEmpty(now).Min();
            if ((all || now - oldest >= horizon) && _early.TryRemove(id, out var removed))
            {
                Interlocked.Add(ref _untracked, removed.Count);
            }
        }
    }

    /// <summary>The fan-out numbers for one step.</summary>
    public FanOutSummary Summary(int step) => Stats(step).Summarize();

    private StepFanOut Stats(int step) => _steps.GetOrAdd(step, _ => new StepFanOut());

    private sealed class TrackedPost(int step, DateTimeOffset sentAt, DateTimeOffset acceptedAt, HashSet<int> pending)
    {
        private readonly object _gate = new();

        public int Step { get; } = step;

        public DateTimeOffset AcceptedAt { get; } = acceptedAt;

        public void Receive(int client, DateTimeOffset at, StepFanOut stats, FanOutSettings settings)
        {
            lock (_gate)
            {
                if (!pending.Remove(client))
                {
                    return; // the sender, a duplicate, or a client that connected after the accept
                }
            }

            var lag = (at - AcceptedAt).TotalMilliseconds;
            stats.Add(Math.Max(0, lag), (at - sentAt).TotalMilliseconds, early: lag < 0, late: lag > settings.LateAfterSeconds * 1000);
        }

        public int[] Settle(StepFanOut stats)
        {
            int[] missing;
            lock (_gate)
            {
                missing = [.. pending];
                pending.Clear();
            }

            stats.AddDropped(missing.Length);
            return missing;
        }
    }
}

/// <summary>A post some expected clients never received.</summary>
internal sealed record DroppedFrames(int Step, string PostId, DateTimeOffset AcceptedAt, IReadOnlyList<int> MissingClients);

/// <summary>Accumulates one step's fan-out samples.</summary>
internal sealed class StepFanOut
{
    private readonly ConcurrentBag<double> _lags = [];
    private readonly ConcurrentBag<double> _endToEnd = [];
    private long _late;
    private long _early;
    private long _dropped;

    public void Add(double lagMs, double endToEndMs, bool early, bool late)
    {
        _lags.Add(lagMs);
        _endToEnd.Add(endToEndMs);
        if (early)
        {
            Interlocked.Increment(ref _early);
        }

        if (late)
        {
            Interlocked.Increment(ref _late);
        }
    }

    public void AddDropped(int count) => Interlocked.Add(ref _dropped, count);

    public FanOutSummary Summarize()
    {
        var lag = SeriesSummary.FromLatencies("fan-out-lag", _lags.ToArray());
        var e2e = SeriesSummary.FromLatencies("fan-out-end-to-end", _endToEnd.ToArray());
        var delivered = lag.Count;
        var dropped = Interlocked.Read(ref _dropped);
        return new FanOutSummary(
            delivered,
            Interlocked.Read(ref _late),
            dropped,
            Interlocked.Read(ref _early),
            delivered + dropped == 0 ? 0 : Math.Round((double)dropped / (delivered + dropped), 4),
            lag.P50Ms,
            lag.P95Ms,
            lag.MaxMs,
            e2e.P50Ms,
            e2e.P95Ms,
            e2e.MaxMs);
    }
}

/// <summary>One step's fan-out result.</summary>
internal sealed record FanOutSummary(
    long FramesDelivered,
    long FramesLate,
    long FramesDropped,
    long FramesBeforeAccept,
    double DropRate,
    double? LagP50Ms,
    double? LagP95Ms,
    double? LagMaxMs,
    double? EndToEndP50Ms,
    double? EndToEndP95Ms,
    double? EndToEndMaxMs);
