namespace Pulse.WebApi.Features.WhiteNoise;

using System.Collections.Generic;
using System.Security.Cryptography;

/// <summary>
/// The white-noise vocabulary and rates (demo-feedback DF-12): the four levels a controller sets, how many posts per
/// minute each releases, and the jittered gap between two posts. Pure functions, no state.
/// </summary>
/// <remarks>
/// <b>Burst legibility (NFR-002).</b> The highest level is 15 posts per minute, and a gap is never shorter than
/// 60 % of its mean (2.4 s at High), so noise stays far below the 120-per-minute burst bar.
/// </remarks>
public static class NoiseRates
{
    /// <summary>No noise. The level every exercise starts at.</summary>
    public const string Off = "off";

    /// <summary>2 posts per minute.</summary>
    public const string Low = "low";

    /// <summary>6 posts per minute.</summary>
    public const string Medium = "medium";

    /// <summary>15 posts per minute.</summary>
    public const string High = "high";

    /// <summary>The <c>origin</c> every noise post is published with (never <c>inject</c>: noise is not an inject).</summary>
    public const string NoiseOrigin = "noise";

    /// <summary>How far a gap may stray from its mean, either way: ±40 %.</summary>
    public const double JitterFraction = 0.4;

    /// <summary>Every level, in knob order.</summary>
    public static IReadOnlyList<string> All { get; } = [Off, Low, Medium, High];

    /// <summary>
    /// Whether <paramref name="raw"/> is exactly one of the four wire literals (lowercase, no padding).
    /// </summary>
    /// <param name="raw">The value to check.</param>
    /// <returns><c>true</c> for <c>off</c>, <c>low</c>, <c>medium</c> or <c>high</c>.</returns>
    public static bool IsLevel(string? raw) =>
        raw is Off or Low or Medium or High;

    /// <summary>Posts per minute at <paramref name="level"/>: 0 / 2 / 6 / 15, and 0 for anything unknown.</summary>
    /// <param name="level">A level literal.</param>
    /// <returns>The rate.</returns>
    public static int PerMinute(string? level) => level switch
    {
        Low => 2,
        Medium => 6,
        High => 15,
        _ => 0,
    };

    /// <summary>The mean gap between two posts at <paramref name="level"/>, or <c>null</c> when it posts nothing.</summary>
    /// <param name="level">A level literal.</param>
    /// <returns>60 s divided by the rate, or <c>null</c> for <c>off</c> and unknown levels.</returns>
    public static TimeSpan? MeanGap(string? level)
    {
        var rate = PerMinute(level);
        return rate <= 0 ? null : TimeSpan.FromSeconds(60.0 / rate);
    }

    /// <summary>
    /// One jittered gap: the mean gap scaled by a factor between 0.6 and 1.4, picked by <paramref name="unit"/>
    /// (0 gives the shortest gap, 1 the longest, 0.5 the mean).
    /// </summary>
    /// <param name="level">A level that posts (not <c>off</c>).</param>
    /// <param name="unit">A draw in [0, 1]; values outside are clamped.</param>
    /// <returns>The gap.</returns>
    /// <exception cref="ArgumentException">The level posts nothing.</exception>
    public static TimeSpan Gap(string level, double unit)
    {
        var mean = MeanGap(level) ?? throw new ArgumentException($"Level '{level}' posts nothing.", nameof(level));
        var clamped = double.IsNaN(unit) ? 0.5 : Math.Clamp(unit, 0.0, 1.0);
        var factor = 1.0 + (JitterFraction * ((2.0 * clamped) - 1.0));
        return TimeSpan.FromTicks((long)(mean.Ticks * factor));
    }

    /// <summary>
    /// When the post after one that was due at <paramref name="previousDue"/> is due: one gap after the previous due
    /// time, so tick granularity never erodes the rate; but if that is already past (the pacer fell behind, for
    /// example after a slow publish), one gap from <paramref name="now"/>, so it never catches up in a burst.
    /// </summary>
    /// <param name="previousDue">When the post just handled was due.</param>
    /// <param name="now">The current server time.</param>
    /// <param name="gap">The next jittered gap.</param>
    /// <returns>The next due time, always after <paramref name="now"/>.</returns>
    public static DateTimeOffset NextDue(DateTimeOffset previousDue, DateTimeOffset now, TimeSpan gap)
    {
        var candidate = previousDue + gap;
        return candidate > now ? candidate : now + gap;
    }
}

/// <summary>The source of the pacer's jitter draws — a seam so the rate tests are deterministic.</summary>
public interface INoiseJitterSource
{
    /// <summary>The next draw, uniformly in [0, 1].</summary>
    /// <returns>A value between 0 and 1 inclusive.</returns>
    double NextUnit();
}

/// <summary>
/// The production jitter: <see cref="RandomNumberGenerator"/>, so no analyzer exception for an insecure random is
/// needed. Nothing here is security-sensitive; it only spaces background posts.
/// </summary>
public sealed class CryptoNoiseJitterSource : INoiseJitterSource
{
    private const int Resolution = 1_000_000;

    /// <inheritdoc />
    public double NextUnit() => RandomNumberGenerator.GetInt32(0, Resolution + 1) / (double)Resolution;
}
