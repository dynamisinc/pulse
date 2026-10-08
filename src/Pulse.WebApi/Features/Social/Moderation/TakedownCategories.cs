namespace Pulse.WebApi.Features.Social.Moderation;

/// <summary>
/// The takedown incident categories <c>DELETE /api/staff/posts/{postId}?category=</c> accepts (CTL-025,
/// demo-polish DP-9).
/// </summary>
/// <remarks>
/// The server validates the category and stores nothing. DP-9 puts the category only in the console's
/// <c>steering_action</c> telemetry payload, so there is no schema column and no server-side event. Validation
/// still runs so a console bug that sends a value outside the vocabulary fails loudly (400) instead of
/// logging a category the analysts cannot read.
/// </remarks>
public static class TakedownCategories
{
    /// <summary>Content that is inappropriate for the exercise.</summary>
    public const string Inappropriate = "inappropriate";

    /// <summary>Content that exposes personally identifiable information.</summary>
    public const string Pii = "pii";

    /// <summary>Content that references the real world and could break the fiction.</summary>
    public const string RealWorldReference = "real-world-reference";

    /// <summary>Any other reason. Also used when the caller sends no category.</summary>
    public const string Other = "other";

    /// <summary>Every accepted value, in the order the contract lists them.</summary>
    public static IReadOnlyList<string> All { get; } = [Inappropriate, Pii, RealWorldReference, Other];

    /// <summary>
    /// Whether <paramref name="category"/> is acceptable. An absent or empty value counts as the default
    /// (<see cref="Other"/>). Any other value must match one of <see cref="All"/> exactly (ordinal, lower-case),
    /// so everything else is rejected.
    /// </summary>
    /// <param name="category">The raw <c>?category=</c> query value, or <c>null</c> when absent.</param>
    /// <returns><c>true</c> when the value is absent, empty, or one of <see cref="All"/>.</returns>
    public static bool IsValid(string? category) =>
        string.IsNullOrEmpty(category) || All.Contains(category, StringComparer.Ordinal);
}
