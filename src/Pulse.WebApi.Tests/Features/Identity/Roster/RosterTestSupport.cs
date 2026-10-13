namespace Pulse.WebApi.Tests.Features.Identity.Roster;

using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Roster;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Pulse.WebApi.Tests.Helpers;

/// <summary>One seeded exercise with a staff user assigned to it.</summary>
/// <param name="ExerciseId">The exercise.</param>
/// <param name="StaffUserId">The staff user (assigned with the seeded role).</param>
internal sealed record RosterWorld(Guid ExerciseId, Guid StaffUserId)
{
    /// <summary>The stubbed staff session of <see cref="StaffUserId"/>.</summary>
    public CurrentStaffSession StaffSession { get; } = new() { SessionId = Guid.NewGuid(), StaffUserId = StaffUserId };
}

/// <summary>Seeds roster test data with fresh ids (no truncation between tests).</summary>
internal static class RosterSeed
{
    public const string FrontendBaseUrl = "https://pulse.example.test";

    /// <summary>Seeds an exercise (default tenant), a staff user and their assignment with <paramref name="staffRole"/>.</summary>
    public static async Task<RosterWorld> ExerciseAsync(MsSqlContainerFixture fixture, string staffRole = "controller")
    {
        var world = new RosterWorld(Guid.NewGuid(), Guid.NewGuid());

        await using var seed = fixture.CreateContext();
        seed.StaffUsers.Add(StaffTenantSeed.StaffUserFor(world.StaffUserId));
        seed.Exercises.Add(new Exercise
        {
            Id = world.ExerciseId,
            OrganizationId = Organization.DefaultOrganizationId,
            Name = $"Roster {world.ExerciseId:N}",
            TimeZone = "America/New_York",
        });
        seed.StaffAssignments.Add(new StaffAssignment
        {
            Id = Guid.NewGuid(),
            StaffUserId = world.StaffUserId,
            ExerciseId = world.ExerciseId,
            Role = staffRole,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
        return world;
    }

    /// <summary>Seeds a persona in <paramref name="exerciseId"/>.</summary>
    public static async Task<Guid> PersonaAsync(MsSqlContainerFixture fixture, Guid exerciseId, string handle, string kind = "org")
    {
        var id = Guid.NewGuid();
        await using var seed = fixture.CreateContext();
        seed.Personas.Add(new Persona { Id = id, ExerciseId = exerciseId, Handle = handle, DisplayName = handle, Kind = kind });
        await seed.SaveChangesAsync();
        return id;
    }

    /// <summary>Seeds an account (a legacy-style one unless told otherwise) in <paramref name="exerciseId"/>.</summary>
    public static async Task<Account> AccountAsync(
        MsSqlContainerFixture fixture,
        Guid exerciseId,
        string username,
        string displayName,
        string role = "participant",
        string? agency = null,
        string? email = null,
        Guid? personaId = null)
    {
        var account = new Account
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            Username = username,
            DisplayName = displayName,
            Role = role,
            Agency = agency,
            Email = email,
            PersonaId = personaId,
            CreatedAt = DateTimeOffset.UtcNow,
        };

        await using var seed = fixture.CreateContext();
        seed.Accounts.Add(account);
        await seed.SaveChangesAsync();
        return account;
    }

    /// <summary>Configuration with the SPA origin set, so join URLs can be built.</summary>
    public static IConfiguration Configuration(string? frontendBaseUrl = FrontendBaseUrl, string? emailEndpoint = null) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                [JoinUrlBuilder.FrontendBaseUrlKey] = frontendBaseUrl,
                [RosterQueryService.EmailEndpointKey] = emailEndpoint,
            })
            .Build();

    /// <summary>A multipart upload of <paramref name="csv"/> as field <c>file</c>.</summary>
    public static MultipartFormDataContent CsvUpload(string csv, string fileName = "roster.csv", string contentType = "text/csv")
    {
        var content = new MultipartFormDataContent();
        var file = new ByteArrayContent(Encoding.UTF8.GetBytes(csv));
        file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        content.Add(file, "file", fileName);
        return content;
    }
}

/// <summary>
/// A real-enough <see cref="IParticipantLinkIssuer"/> (story 03 supplies the real one): it stages a fresh active link on
/// the caller's context, exactly as the seam's contract says (no save, no telemetry), and records whom it was asked for.
/// </summary>
internal sealed class RecordingLinkIssuer : IParticipantLinkIssuer
{
    private readonly PulseDbContext _dbContext;
    private readonly IParticipantLinkTokenProtector _protector;

    public RecordingLinkIssuer(PulseDbContext dbContext, IParticipantLinkTokenProtector protector)
    {
        _dbContext = dbContext;
        _protector = protector;
    }

    public List<Guid> Calls { get; } = [];

    public List<Guid?> IssuedBy { get; } = [];

    public Task<ParticipantLink?> EnsureActiveAsync(Account account, Guid? issuedByStaffUserId, DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        Calls.Add(account.Id);
        IssuedBy.Add(issuedByStaffUserId);
        var token = ParticipantLinkTokens.Generate();
        var link = new ParticipantLink
        {
            Id = Guid.NewGuid(),
            ExerciseId = account.ExerciseId,
            AccountId = account.Id,
            TokenHash = ParticipantLinkTokens.Hash(token),
            ProtectedToken = _protector.Protect(token),
            Generation = 1,
            IssuedAt = now,
            IssuedByStaffUserId = issuedByStaffUserId,
        };
        _dbContext.ParticipantLinks.Add(link);
        return Task.FromResult<ParticipantLink?>(link);
    }
}

/// <summary>
/// An issuer that simulates a concurrent request: while the roster is staging (before its one save) it commits, through
/// a separate context, an account holding the very sign-in name being created, so the save hits the database's unique
/// index exactly as a real race would. Issues no link.
/// </summary>
internal sealed class RacingLinkIssuer : IParticipantLinkIssuer
{
    private readonly MsSqlContainerFixture _fixture;
    private int _racesLeft;

    public RacingLinkIssuer(MsSqlContainerFixture fixture, int races)
    {
        _fixture = fixture;
        _racesLeft = races;
    }

    public async Task<ParticipantLink?> EnsureActiveAsync(Account account, Guid? issuedByStaffUserId, DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        if (_racesLeft-- > 0)
        {
            await RosterSeed.AccountAsync(_fixture, account.ExerciseId, account.Username.ToUpperInvariant(), "Concurrent Person");
        }

        return null;
    }
}

/// <summary>The services a roster request uses, built by hand over one scoped context (the service-level tests).</summary>
internal sealed class RosterHarness : IAsyncDisposable
{
    /// <summary>One key ring for every harness, as one host has: a link issued in one request decrypts in the next.</summary>
    private static readonly EphemeralDataProtectionProvider KeyRing = new();

    private RosterHarness(PulseDbContext context, RosterService service, RosterQueryService query, RecordingLinkIssuer? issuer)
    {
        Context = context;
        Service = service;
        Query = query;
        Issuer = issuer;
    }

    public PulseDbContext Context { get; }

    public RosterService Service { get; }

    public RosterQueryService Query { get; }

    /// <summary>The recording issuer, or <c>null</c> when the harness uses story 01's null issuer.</summary>
    public RecordingLinkIssuer? Issuer { get; }

    /// <summary>Builds the harness for a request scoped to <paramref name="scope"/> by <paramref name="staff"/>.</summary>
    public static RosterHarness Create(
        MsSqlContainerFixture fixture,
        Guid? scope,
        CurrentStaffSession? staff,
        bool realIssuer = true,
        IConfiguration? configuration = null,
        Func<PulseDbContext, IParticipantLinkIssuer>? issuerOverride = null)
    {
        var context = fixture.CreateContext(new ExerciseContext { CurrentExerciseId = scope });
        var protector = new ParticipantLinkTokenProtector(KeyRing);
        configuration ??= RosterSeed.Configuration();
        var joinUrls = new JoinUrlBuilder(configuration);
        var linkDtos = new RosterLinkDtoFactory(protector, joinUrls);
        var issuer = realIssuer ? new RecordingLinkIssuer(context, protector) : null;
        var exerciseContext = new ExerciseContext { CurrentExerciseId = scope };

        var service = new RosterService(
            context,
            exerciseContext,
            new StubCurrentStaffSessionAccessor(staff),
            new ExerciseFactsReader(context),
            issuerOverride?.Invoke(context) ?? (issuer is null ? new NullParticipantLinkIssuer() : issuer),
            linkDtos,
            TimeProvider.System);
        var query = new RosterQueryService(context, exerciseContext, linkDtos, joinUrls, configuration, TimeProvider.System);

        return new RosterHarness(context, service, query, issuer);
    }

    public static RosterHarness For(MsSqlContainerFixture fixture, RosterWorld world, bool realIssuer = true) =>
        Create(fixture, world.ExerciseId, world.StaffSession, realIssuer);

    public ValueTask DisposeAsync() => Context.DisposeAsync();
}

/// <summary>A self-hosted test server mapping exactly <see cref="RosterEndpoints.MapRosterEndpoints"/> (Program.cs does not, until the seam commit).</summary>
internal static class RosterHttpHost
{
    /// <summary>Starts a host over real SQL, scoped to <paramref name="scope"/>, with <paramref name="staff"/> as the caller.</summary>
    public static Task<IHost> StartAsync(MsSqlContainerFixture fixture, Guid? scope, CurrentStaffSession? staff) =>
        StartAsync(services =>
        {
            services.AddScoped(provider => fixture.CreateContext(provider.GetRequiredService<IExerciseContext>()));
            services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = scope });
            services.AddScoped<ICurrentStaffSessionAccessor>(_ => new StubCurrentStaffSessionAccessor(staff));
        });

    /// <summary>Starts a host whose persistence and caller are configured by <paramref name="configure"/>.</summary>
    public static async Task<IHost> StartAsync(Action<IServiceCollection> configure)
    {
        return await new HostBuilder()
            .ConfigureAppConfiguration(config => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                [JoinUrlBuilder.FrontendBaseUrlKey] = RosterSeed.FrontendBaseUrl,
            }))
            .ConfigureWebHost(web =>
            {
                web.UseTestServer();
                web.ConfigureServices(services =>
                {
                    services.AddRouting();
                    services.AddEasyLoginFoundation();
                    services.AddRoster();
                    services.AddScoped<StaffAssignmentService>();
                    services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());
                    services.Replace(ServiceDescriptor.Scoped<IParticipantLinkIssuer>(provider => new RecordingLinkIssuer(
                        provider.GetRequiredService<PulseDbContext>(),
                        provider.GetRequiredService<IParticipantLinkTokenProtector>())));
                    configure(services);
                });
                web.Configure(app =>
                {
                    app.UseRouting();
                    app.UseEndpoints(endpoints => endpoints.MapRosterEndpoints());
                });
            })
            .StartAsync();
    }
}
