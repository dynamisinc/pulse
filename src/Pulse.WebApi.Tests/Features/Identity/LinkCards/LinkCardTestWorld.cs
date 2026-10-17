namespace Pulse.WebApi.Tests.Features.Identity.LinkCards;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.LinkCards;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Pulse.WebApi.Tests.Helpers;

/// <summary>The link state a seeded participant starts with.</summary>
internal enum SeededLink
{
    /// <summary>No <c>ParticipantLink</c> row at all.</summary>
    None,

    /// <summary>Active, with a protected copy that decrypts to the token the hash names.</summary>
    Active,

    /// <summary>Revoked (protected copy cleared, as story 03 revokes).</summary>
    Revoked,

    /// <summary>Active, but the protected copy was written under another key ring (a lost key ring).</summary>
    LostKeyRing,

    /// <summary>Active, but the protected copy decrypts to a token whose hash is NOT the row's (a stale copy).</summary>
    StaleCopy,

    /// <summary>Active, but with no protected copy at all.</summary>
    NoCopy,
}

/// <summary>A seeded participant: the account id and, for a recoverable link, the join URL its card must carry.</summary>
/// <param name="AccountId">The account id.</param>
/// <param name="Name">The display name.</param>
/// <param name="SignInName">The sign-in name.</param>
/// <param name="JoinUrl">The expected join URL (base + <c>/join/</c> + token), or <c>null</c> when none is recoverable.</param>
/// <param name="Token">The raw token behind the link, or <c>null</c>.</param>
internal sealed record SeededParticipant(Guid AccountId, string Name, string SignInName, string? JoinUrl, string? Token);

/// <summary>
/// Seeds the real rows story 04 reads (exercise, staff user + assignment, accounts, links) into the shared migrated
/// database, and builds the card service the way the host composes it (<c>AddEasyLoginFoundation()</c> +
/// <c>AddLinkCards()</c>) with only the edges doubled: the staff-session accessor, the exercise scope and the Data
/// Protection key ring (ephemeral, shared with the seeding so a seeded copy decrypts). Fresh ids everywhere.
/// </summary>
internal sealed class LinkCardTestWorld
{
    /// <summary>The SPA origin every recoverable link's join URL starts with.</summary>
    public const string FrontendBase = "https://pulse-uat.cobrasoftware.com";

    private readonly MsSqlContainerFixture _fixture;

    public LinkCardTestWorld(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>The key ring the service decrypts with (and the seeding encrypts with).</summary>
    public EphemeralDataProtectionProvider KeyRing { get; } = new();

    public MsSqlContainerFixture Fixture => _fixture;

    /// <summary>Seeds an exercise with a stored scenario instant and zone (the telemetry fallbacks).</summary>
    public async Task<Guid> SeedExerciseAsync(string? name = null, DateTimeOffset? scenarioTime = null, string timeZone = "America/New_York")
    {
        var id = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            Id = id,
            OrganizationId = Organization.DefaultOrganizationId,
            Name = name ?? $"Coastal Surge {id:N}",
            TimeZone = timeZone,
            Status = "live",
            CurrentScenarioTime = scenarioTime,
        });
        await seed.SaveChangesAsync();
        return id;
    }

    /// <summary>Seeds a staff user (default tenant) with the given (exercise, role) assignments.</summary>
    public async Task<Guid> SeedStaffAsync(params (Guid ExerciseId, string Role)[] assignments)
    {
        var staffUserId = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.StaffUsers.Add(StaffTenantSeed.StaffUserFor(staffUserId));
        foreach (var (exerciseId, role) in assignments)
        {
            seed.Enrollments.Add(new Enrollment
            {
                Id = Guid.NewGuid(),
                PersonId = staffUserId,
                ExerciseId = exerciseId,
                Role = role,
                CreatedAt = DateTimeOffset.UtcNow,
            });
        }

        await seed.SaveChangesAsync();
        return staffUserId;
    }

    /// <summary>Seeds one participant account in <paramref name="exerciseId"/> with the requested link state.</summary>
    public async Task<SeededParticipant> SeedParticipantAsync(
        Guid exerciseId,
        string name,
        SeededLink link = SeededLink.Active,
        string? agency = null,
        string? jobRole = null,
        bool disabled = false)
    {
        var accountId = Guid.NewGuid();
        var signInName = $"p{accountId:N}"[..20];

        var account = new Account
        {
            Id = accountId,
            ExerciseId = exerciseId,
            Username = signInName,
            DisplayName = name,
            CreatedAt = DateTimeOffset.UtcNow,
            Agency = agency,
            JobRole = jobRole,
            DisabledAt = disabled ? DateTimeOffset.UtcNow.AddMinutes(-5) : null,
            Enrollment = new Enrollment { Id = Guid.NewGuid(), ExerciseId = exerciseId, Role = "participant" },
        };

        string? token = null;
        string? joinUrl = null;
        ParticipantLink? row = null;

        if (link != SeededLink.None)
        {
            token = ParticipantLinkTokens.Generate();
            var protector = new ParticipantLinkTokenProtector(KeyRing);
            row = new ParticipantLink
            {
                Id = Guid.NewGuid(),
                ExerciseId = exerciseId,
                AccountId = accountId,
                TokenHash = ParticipantLinkTokens.Hash(token),
                Generation = 1,
                IssuedAt = DateTimeOffset.UtcNow.AddHours(-1),
            };

            switch (link)
            {
                case SeededLink.Active:
                    row.ProtectedToken = protector.Protect(token);
                    joinUrl = $"{FrontendBase}/join/{token}";
                    break;
                case SeededLink.Revoked:
                    row.ProtectedToken = null;
                    row.RevokedAt = DateTimeOffset.UtcNow.AddMinutes(-10);
                    break;
                case SeededLink.LostKeyRing:
                    row.ProtectedToken = new ParticipantLinkTokenProtector(new EphemeralDataProtectionProvider()).Protect(token);
                    break;
                case SeededLink.StaleCopy:
                    row.ProtectedToken = protector.Protect(ParticipantLinkTokens.Generate());
                    break;
                case SeededLink.NoCopy:
                    row.ProtectedToken = null;
                    break;
            }
        }

        await using var seed = _fixture.CreateContext();
        seed.Accounts.Add(account);
        if (row is not null)
        {
            seed.ParticipantLinks.Add(row);
        }

        await seed.SaveChangesAsync();
        return new SeededParticipant(accountId, name, signInName, joinUrl, token);
    }

    /// <summary>
    /// The card service as the host composes it, in its own request scope. <paramref name="scope"/> is the resolved
    /// exercise (<c>null</c> = unresolved); <paramref name="staffUserId"/> the staff caller (<c>null</c> = none).
    /// </summary>
    public ServiceProvider BuildServices(
        Guid? scope,
        Guid? staffUserId,
        string? frontendBase = FrontendBase,
        int? maxCardsPerRequest = null,
        Func<IConfiguration, IConfiguration>? wrapConfiguration = null)
    {
        var settings = new Dictionary<string, string?> { [JoinUrlBuilder.FrontendBaseUrlKey] = frontendBase };
        if (maxCardsPerRequest is { } max)
        {
            settings["Authentication:EasyLogin:MaxCardsPerRequest"] = max.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }

        var services = new ServiceCollection();
        services.AddLogging();
        IConfiguration configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        services.AddSingleton(wrapConfiguration is null ? configuration : wrapConfiguration(configuration));
        services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = scope });
        services.AddScoped(provider => _fixture.CreateContext(provider.GetRequiredService<IExerciseContext>()));
        services.AddScoped<ICurrentStaffSessionAccessor>(_ => new StubCurrentStaffSessionAccessor(
            staffUserId is { } staff ? new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = staff } : null));
        services.AddScoped<StaffAssignmentService>();
        services.AddExerciseClock();
        services.AddLinkCards();
        services.AddSingleton<IDataProtectionProvider>(KeyRing);

        return services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true, ValidateOnBuild = true });
    }

    /// <summary>The body for <paramref name="ids"/>: <c>{ all: true }</c> when <c>null</c>, otherwise <c>{ participantIds }</c>.</summary>
    public static RosterCardsRequestBody Body(IReadOnlyList<string?>? ids) =>
        ids is null ? new RosterCardsRequestBody { All = true } : new RosterCardsRequestBody { ParticipantIds = ids };

    /// <summary>
    /// Runs one card request as <paramref name="staffUserId"/> scoped to <paramref name="scope"/>: <c>{ all: true }</c>
    /// when <paramref name="ids"/> is <c>null</c>, otherwise <c>{ participantIds: ids }</c>.
    /// </summary>
    public Task<LinkCardResult> GenerateAsync(
        Guid? scope,
        Guid? staffUserId,
        IReadOnlyList<string?>? ids = null,
        string? frontendBase = FrontendBase,
        int? maxCardsPerRequest = null) =>
        GenerateWithBodyAsync(scope, staffUserId, Body(ids), frontendBase, maxCardsPerRequest);

    /// <summary>Runs one card request with exactly <paramref name="body"/> (which may be <c>null</c> or ill-shaped).</summary>
    public async Task<LinkCardResult> GenerateWithBodyAsync(
        Guid? scope,
        Guid? staffUserId,
        RosterCardsRequestBody? body,
        string? frontendBase = FrontendBase,
        int? maxCardsPerRequest = null,
        Func<IConfiguration, IConfiguration>? wrapConfiguration = null)
    {
        await using var provider = BuildServices(scope, staffUserId, frontendBase, maxCardsPerRequest, wrapConfiguration);
        await using var request = provider.CreateAsyncScope();
        return await request.ServiceProvider.GetRequiredService<LinkCardService>().GenerateAsync(body);
    }

    /// <summary>Every <c>roster.cards.generated</c> event persisted for <paramref name="exerciseId"/> (read past any filter).</summary>
    public async Task<List<TelemetryEvent>> CardEventsAsync(Guid exerciseId)
    {
        await using var read = _fixture.CreateContext();
        return await read.TelemetryEvents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(e => e.ExerciseId == exerciseId && e.EventType == EasyLoginTelemetry.RosterCardsGeneratedEventType)
            .ToListAsync();
    }
}

/// <summary>
/// A byte-for-byte mirror of the frontend gate every card QR must pass before it reaches an <c>&lt;img src&gt;</c>
/// (<c>src/frontend/src/features/participantAdmin/cards/safeQrDataUri.ts</c>): the same regular expression and the
/// same 512 KB cap. If this admits a string, the card sheet renders it.
/// </summary>
internal static partial class FrontendQrGate
{
    /// <summary><c>MAX_QR_DATA_URI_LENGTH</c> in <c>safeQrDataUri.ts</c>.</summary>
    public const int MaxLength = 512 * 1024;

    /// <summary>Whether <c>resolveSafeQrDataUri(raw)</c> would return the string unchanged.</summary>
    public static bool Admits(string? raw) =>
        raw is { Length: > 0 and <= MaxLength } && QrDataUri().IsMatch(raw);

    /// <summary><c>QR_DATA_URI</c> in <c>safeQrDataUri.ts</c>: <c>/^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+={0,2}$/</c>.</summary>
    [GeneratedRegex(@"^data:image/svg\+xml;base64,[A-Za-z0-9+/]+={0,2}\z", RegexOptions.CultureInvariant)]
    private static partial Regex QrDataUri();
}
