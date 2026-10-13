namespace Pulse.WebApi.Features.Injects;

using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;

/// <summary>
/// The source of randomness for burst jitter (IQ-4). An interface so tests can pin the draw and assert exact offsets;
/// production uses <see cref="CryptoBurstJitterSource"/>.
/// </summary>
public interface IBurstJitterSource
{
    /// <summary>Returns a uniformly distributed integer in <c>[minInclusive, maxExclusive)</c>.</summary>
    /// <param name="minInclusive">The inclusive lower bound.</param>
    /// <param name="maxExclusive">The exclusive upper bound (greater than <paramref name="minInclusive"/>).</param>
    /// <returns>The draw.</returns>
    int Draw(int minInclusive, int maxExclusive);
}

/// <summary>
/// The production jitter source. Uses <see cref="RandomNumberGenerator"/> — not because pacing needs to be
/// unpredictable to an attacker, but because it is thread-safe, allocation-free and keeps the analyzers quiet.
/// </summary>
public sealed class CryptoBurstJitterSource : IBurstJitterSource
{
    /// <inheritdoc />
    public int Draw(int minInclusive, int maxExclusive) => RandomNumberGenerator.GetInt32(minInclusive, maxExclusive);
}

/// <summary>
/// The pure burst-pacing core (IQ-4): spreads a burst's children across its window with jitter.
/// </summary>
/// <remarks>
/// <para><b>The guarantees, each covered by a unit test:</b></para>
/// <list type="bullet">
///   <item>the first child is due at offset 0 (one click gives an immediate post);</item>
///   <item>offsets are strictly increasing — never two posts at the same instant;</item>
///   <item>no gap is under <see cref="MinGapSeconds"/>;</item>
///   <item>the last child is due no later than the window.</item>
/// </list>
/// <para>
/// <b>Algorithm.</b> The window's slack (window minus the mandatory 3 s per gap) is split at <c>n − 1</c> sorted
/// uniform cut points; child <c>k</c> is due at <c>3·(k−1) + cut(k−1)</c>. Each gap is therefore 3 s plus a
/// non-negative share of the slack, and the last offset is at most <c>3·(n−1) + slack = window</c>.
/// </para>
/// </remarks>
public static class InjectBurstPacing
{
    /// <summary>The smallest gap between two consecutive burst posts, in seconds.</summary>
    public const int MinGapSeconds = 3;

    /// <summary>The shortest window that can hold <paramref name="postCount"/> posts at the minimum gap.</summary>
    /// <param name="postCount">The number of posts in the burst.</param>
    /// <returns>The minimum window in seconds.</returns>
    public static int MinimumWindowSeconds(int postCount) => Math.Max(0, postCount - 1) * MinGapSeconds;

    /// <summary>Computes the due offsets (seconds after release) for a burst of <paramref name="postCount"/> posts.</summary>
    /// <param name="postCount">The number of posts (at least 1).</param>
    /// <param name="windowSeconds">The release window; must be at least <see cref="MinimumWindowSeconds"/>.</param>
    /// <param name="jitter">The randomness source.</param>
    /// <returns>One offset per post, in sequence order.</returns>
    /// <exception cref="ArgumentOutOfRangeException">When the window cannot hold the posts at the minimum gap.</exception>
    public static IReadOnlyList<int> ComputeOffsets(int postCount, int windowSeconds, IBurstJitterSource jitter)
    {
        ArgumentNullException.ThrowIfNull(jitter);
        ArgumentOutOfRangeException.ThrowIfLessThan(postCount, 1);

        var slack = windowSeconds - MinimumWindowSeconds(postCount);
        ArgumentOutOfRangeException.ThrowIfNegative(slack, nameof(windowSeconds));

        var cuts = Enumerable.Range(0, postCount - 1)
            .Select(_ => jitter.Draw(0, slack + 1))
            .Order()
            .ToList();

        var offsets = new List<int>(postCount) { 0 };
        for (var k = 1; k < postCount; k++)
        {
            offsets.Add((k * MinGapSeconds) + cuts[k - 1]);
        }

        return offsets;
    }
}
