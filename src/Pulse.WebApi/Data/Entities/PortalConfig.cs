namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// The exercise portal's settings (exercise-portal PC-2; created by channels-foundation story 01's M1, Q-28). At most
/// one row per exercise; an absent row means the defaults. Behaviour over it is exercise-portal's (stories 01/03).
/// </summary>
/// <remarks>
/// <see cref="IExerciseScoped"/>, behind the central filter and write guard. Columns are exactly PC-2's, which gives this
/// row no <c>DeletedAt</c>: it is a settings row, reset by editing rather than deleting, so it is NOT
/// <see cref="ISoftDeletable"/> (see the PR's spec-gap note).
/// </remarks>
public sealed class PortalConfig : IExerciseScoped
{
    /// <summary>Bound of <see cref="PortalName"/> (the masthead limit is 60 code points; sized for astral characters).</summary>
    public const int MaxPortalNameLength = 120;

    /// <summary>Bound of <see cref="CityName"/>.</summary>
    public const int MaxCityNameLength = 120;

    /// <summary>Bound of <see cref="Tagline"/>.</summary>
    public const int MaxTaglineLength = 200;

    /// <summary>Bound of <see cref="LayoutKey"/>.</summary>
    public const int MaxLayoutKeyLength = 16;

    /// <summary>Primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>The owning exercise run (COR-001); unique, so one row per exercise.</summary>
    public Guid ExerciseId { get; set; }

    /// <summary>The masthead name, else the default.</summary>
    public string? PortalName { get; set; }

    /// <summary>The in-fiction city name, else the default.</summary>
    public string? CityName { get; set; }

    /// <summary>The masthead tagline.</summary>
    public string? Tagline { get; set; }

    /// <summary>The masthead logo (a media-library asset), else <c>null</c>.</summary>
    public Guid? LogoMediaId { get; set; }

    /// <summary>The layout (<c>anchor</c> only in December).</summary>
    public required string LayoutKey { get; set; }

    /// <summary>The ordered module list, <c>[{id, enabled}]</c>.</summary>
    public string ModulesJson { get; set; } = "[]";

    /// <summary>A partial <c>OutletSkinTokens</c> override (FC-3b), validated by the portal config API.</summary>
    public string? SkinOverridesJson { get; set; }

    /// <summary>The optimistic-concurrency token every write bumps.</summary>
    public int Version { get; set; }
}
