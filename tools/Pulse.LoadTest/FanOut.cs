namespace Pulse.LoadTest;

using System.Collections.Concurrent;

/// <summary>
/// SignalR fan-out lag: for each post the harness writes, the time from "post accepted" (the 201 reaching the harness)
/// to <c>PostReceived</c> at every OTHER connected client. The server broadcasts before it answers, so a frame can land
/// before the 201; that counts as 0 ms lag (and is counted as "early"). The time from the request being SENT is kept
/// too, as end-to-end lag. Frames still missing after <see cref="FanOutSettings.DroppedAfterSeconds"/> are dropped;
/// frames later than <see cref="FanOutSettings.LateAfterSeconds"/> are late. Frames still pending when the run ends
/// before that horizon are UNFINISHED observations, reported apart from drops. The verdict on a frame depends only on
/// its ARRIVAL time against the post's deadline (accept + the drop horizon) — never on when a sweep happens to run.
/// </summary>
/// <remarks>
/// All state sits behind ONE lock: registration, frame arrival, early-frame buffering and sweeping can interleave from
/// the SignalR receive threads and the harness, and a frame must never land in a buffer a registration already drained
/// (it would then be settled as a drop). The work under the lock is a few dictionary operations per frame — at
/// 120 posts/min × 100 clients that is about 200 frames/s, nowhere near contention.
/// </remarks>
internal sealed class FanOutTracker
{
    private readonly FanOutSettings _settings;
    private readonly object _gate = new();
    private readonly Dictionary<string, TrackedPost> _posts = new(StringComparer.OrdinalIgnoreCase);

    // A frame can arrive before the harness knows the post id (before the 201): keep it, matched on registration.
    private readonly Dictionary<string, EarlyFrames> _early = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<int, StepFanOut> _steps = [];

    // Posts already settled, kept so a frame processed after its post was swept is still judged by ITS arrival time:
    // before the deadline it is a delivery (the drop is undone), after it the frame stays dropped (never "untracked").
    private readonly Dictionary<string, TrackedPost> _settled = new(StringComparer.OrdinalIgnoreCase);
    private long _untracked;

    public FanOutTracker(FanOutSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        _settings = settings;
    }

    /// <summary>Every post with missing frames: which clients never got it (written to fanout-drops.csv).</summary>
    public IReadOnlyList<DroppedFrames> Drops
    {
        get
        {
            lock (_gate)
            {
                return [.. _settled
                    .Where(p => p.Value.Missing.Count > 0)
                    .OrderBy(p => p.Value.AcceptedAt)
                    .Select(p => new DroppedFrames(
                        p.Value.Step,
                        p.Key,
                        p.Value.AcceptedAt,
                        [.. p.Value.Missing.OrderBy(m => m.Key).Select(m => new MissingFrame(m.Key, m.Value))]))];
            }
        }
    }

    /// <summary>Frames for posts the harness did not write (noise, the burst item): counted, not timed.</summary>
    public long UntrackedFrames
    {
        get
        {
            lock (_gate)
            {
                return _untracked;
            }
        }
    }

    /// <summary>Registered posts still waiting for at least one frame.</summary>
    public int PendingPosts
    {
        get
        {
            lock (_gate)
            {
                return _posts.Values.Count(p => p.Pending.Count > 0);
            }
        }
    }

    /// <summary>
    /// Registers a post the harness wrote: sent at <paramref name="sentAt"/>, accepted at <paramref name="acceptedAt"/>,
    /// expected at every client in <paramref name="expectedClients"/> (connected when the post was sent, sender
    /// excluded), each with that client's connection time AT SEND, kept for the drop record.
    /// </summary>
    public void Register(int step, string postId, DateTimeOffset sentAt, DateTimeOffset acceptedAt, IReadOnlyDictionary<int, DateTimeOffset?> expectedClients)
    {
        ArgumentNullException.ThrowIfNull(expectedClients);
        lock (_gate)
        {
            var post = new TrackedPost(step, sentAt, acceptedAt, new Dictionary<int, DateTimeOffset?>(expectedClients));
            _posts[postId] = post;
            if (_early.Remove(postId, out var early))
            {
                foreach (var (client, at) in early.Frames)
                {
                    ReceiveLocked(post, client, at);
                }
            }
        }
    }

    /// <summary>A <c>PostReceived</c> frame for <paramref name="postId"/> at client <paramref name="clientId"/>.</summary>
    public void OnFrame(int clientId, string postId, DateTimeOffset at)
    {
        lock (_gate)
        {
            if (_posts.TryGetValue(postId, out var post))
            {
                ReceiveLocked(post, clientId, at);
                return;
            }

            if (_settled.TryGetValue(postId, out var settled))
            {
                // Swept already. The verdict follows the frame's ARRIVAL time, not the sweep's timing.
                if (at <= Deadline(settled) && settled.Missing.Remove(clientId, out _))
                {
                    Stats(settled.Step).AddDropped(-1);
                    Deliver(settled, at);
                }

                return; // after the deadline: it was rightly settled as dropped
            }

            // Unknown yet: either our POST's 201 has not come back, or the post is not ours. Hold it until the horizon.
            if (!_early.TryGetValue(postId, out var bucket))
            {
                bucket = new EarlyFrames(at);
                _early[postId] = bucket;
            }

            bucket.Frames.TryAdd(clientId, at);
        }
    }

    /// <summary>
    /// Settles everything older than the drop horizon at <paramref name="now"/>: missing frames become dropped; held
    /// unknown frames become untracked. Younger posts are left alone.
    /// </summary>
    public void Sweep(DateTimeOffset now) => SettleLocked(now, finish: false);

    /// <summary>
    /// The end of the run: posts past the horizon are settled as in <see cref="Sweep"/>; frames still pending on younger
    /// posts are UNFINISHED observations (the run ended before they could be judged), never drops.
    /// </summary>
    public void Finish(DateTimeOffset now) => SettleLocked(now, finish: true);

    /// <summary>The fan-out numbers for one step.</summary>
    public FanOutSummary Summary(int step)
    {
        lock (_gate)
        {
            return Stats(step).Summarize();
        }
    }

    private void SettleLocked(DateTimeOffset now, bool finish)
    {
        var horizon = TimeSpan.FromSeconds(_settings.DroppedAfterSeconds);
        lock (_gate)
        {
            foreach (var (id, post) in _posts.ToArray())
            {
                var expired = now - post.AcceptedAt >= horizon;
                if (!expired && !finish)
                {
                    continue;
                }

                _posts.Remove(id);
                if (expired)
                {
                    // Pending here means: no frame by the deadline (frames after it were left pending on arrival).
                    Stats(post.Step).AddDropped(post.Pending.Count);
                    foreach (var (client, connectedAt) in post.Pending)
                    {
                        post.Missing[client] = connectedAt;
                    }

                    _settled[id] = post;
                }
                else if (post.Pending.Count > 0)
                {
                    Stats(post.Step).AddUnfinished(post.Pending.Count);
                }

                post.Pending.Clear();
            }

            foreach (var (id, bucket) in _early.ToArray())
            {
                if (finish || now - bucket.FirstSeen >= horizon)
                {
                    _early.Remove(id);
                    _untracked += bucket.Frames.Count;
                }
            }
        }
    }

    private void ReceiveLocked(TrackedPost post, int client, DateTimeOffset at)
    {
        if (at > Deadline(post))
        {
            return; // arrived after the deadline: it stays pending and is settled as dropped, whatever the sweep timing
        }

        if (!post.Pending.Remove(client))
        {
            return; // the sender, a duplicate, or a client that connected after the post was sent
        }

        Deliver(post, at);
    }

    private DateTimeOffset Deadline(TrackedPost post) => post.AcceptedAt + TimeSpan.FromSeconds(_settings.DroppedAfterSeconds);

    private void Deliver(TrackedPost post, DateTimeOffset at)
    {
        var lag = (at - post.AcceptedAt).TotalMilliseconds;
        Stats(post.Step).Add(Math.Max(0, lag), (at - post.SentAt).TotalMilliseconds, early: lag < 0, late: lag > _settings.LateAfterSeconds * 1000);
    }

    private StepFanOut Stats(int step)
    {
        if (!_steps.TryGetValue(step, out var stats))
        {
            stats = new StepFanOut();
            _steps[step] = stats;
        }

        return stats;
    }

    private sealed class TrackedPost(int step, DateTimeOffset sentAt, DateTimeOffset acceptedAt, Dictionary<int, DateTimeOffset?> pending)
    {
        public int Step { get; } = step;

        public DateTimeOffset SentAt { get; } = sentAt;

        public DateTimeOffset AcceptedAt { get; } = acceptedAt;

        /// <summary>Client id → that client's connection time when the post was sent.</summary>
        public Dictionary<int, DateTimeOffset?> Pending { get; } = pending;

        /// <summary>After settling: the clients with no frame by the deadline (same shape as <see cref="Pending"/>).</summary>
        public Dictionary<int, DateTimeOffset?> Missing { get; } = [];
    }

    private sealed class EarlyFrames(DateTimeOffset firstSeen)
    {
        public DateTimeOffset FirstSeen { get; } = firstSeen;

        public Dictionary<int, DateTimeOffset> Frames { get; } = [];
    }
}

/// <summary>A post some expected clients never received.</summary>
internal sealed record DroppedFrames(int Step, string PostId, DateTimeOffset AcceptedAt, IReadOnlyList<MissingFrame> MissingClients);

/// <summary>A client that never received a post, with its connection time as it stood when the post was sent.</summary>
internal sealed record MissingFrame(int ClientId, DateTimeOffset? ConnectedAtSend);

/// <summary>Accumulates one step's fan-out samples.</summary>
internal sealed class StepFanOut
{
    private readonly ConcurrentBag<double> _lags = [];
    private readonly ConcurrentBag<double> _endToEnd = [];
    private long _late;
    private long _early;
    private long _dropped;
    private long _unfinished;

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

    public void AddUnfinished(int count) => Interlocked.Add(ref _unfinished, count);

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
            Interlocked.Read(ref _unfinished),
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
    long FramesUnfinished,
    long FramesBeforeAccept,
    double DropRate,
    double? LagP50Ms,
    double? LagP95Ms,
    double? LagMaxMs,
    double? EndToEndP50Ms,
    double? EndToEndP95Ms,
    double? EndToEndMaxMs);
