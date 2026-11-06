namespace Pulse.WebApi.Tests.Features.Exports;

using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Exports;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Pulse.WebApi.Tests.Features.Social;

/// <summary>
/// A minimal host wired the way the orchestrator will wire story 29 into <c>Program.cs</c>: this story's own
/// <see cref="ExerciseReportEndpoints.AddExerciseReport"/> / <see cref="ExerciseReportEndpoints.MapExerciseReport"/>,
/// over the shared migrated real SQL Server, with the REAL staff-session accessor (as <see cref="PostExportTestHost"/>).
/// The resolved exercise scope is fixed per host, and the media signer is the scope-checking
/// <see cref="FakeMediaUrlSigner"/> (or a throwing one, to prove the report degrades).
/// </summary>
public sealed class ExerciseReportTestHost : IAsyncDisposable
{
    private readonly WebApplication _app;

    private ExerciseReportTestHost(WebApplication app) => _app = app;

    /// <summary>Starts a host whose resolved scope is <paramref name="currentExerciseId"/> (<c>null</c> = unresolved).</summary>
    /// <param name="connectionString">The migrated test database.</param>
    /// <param name="currentExerciseId">The server-resolved scope.</param>
    /// <param name="signingFailure">When set, every signer call throws it.</param>
    /// <param name="utcNow">When set, the server clock is pinned to this instant.</param>
    /// <param name="limits">When set, lowered report limits (story 30), so the limits are tested without bulk rows.</param>
    /// <param name="signerProbe">When set, records every signer call (the assets each call received).</param>
    /// <returns>The started host.</returns>
    public static async Task<ExerciseReportTestHost> StartAsync(
        string connectionString,
        Guid? currentExerciseId,
        Exception? signingFailure = null,
        DateTimeOffset? utcNow = null,
        ExerciseReportLimits? limits = null,
        SignerProbe? signerProbe = null)
    {
        ArgumentNullException.ThrowIfNull(connectionString);

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Configuration["ConnectionStrings:DefaultConnection"] = connectionString;

        builder.Services.AddPulsePersistence(builder.Configuration);
        builder.Services.AddExerciseScoping();
        builder.Services.AddExerciseClock(); // engine-runtime/08: IScenarioNow (+ the clock it reads)

        builder.Services.AddHttpContextAccessor();
        builder.Services.AddScoped<StaffAssignmentService>();
        builder.Services.RemoveAll<ICurrentStaffSessionAccessor>();
        builder.Services.AddScoped<ICurrentStaffSessionAccessor, CurrentStaffSessionAccessor>();

        builder.Services.AddExerciseReport();

        // As AddMedia does in Program.cs: a plain registration that wins over the slice's TryAdd fallback.
        builder.Services.RemoveAll<IMediaUrlSigner>();
        if (signingFailure is null)
        {
            builder.Services.AddScoped<IMediaUrlSigner>(sp =>
                new FakeMediaUrlSigner(sp.GetRequiredService<IExerciseContext>(), signerProbe ?? new SignerProbe()));
        }
        else
        {
            builder.Services.AddSingleton<IMediaUrlSigner>(new ThrowingMediaUrlSigner(signingFailure));
        }

        if (utcNow is { } pinned)
        {
            builder.Services.RemoveAll<TimeProvider>();
            builder.Services.AddSingleton<TimeProvider>(new ManualTimeProvider(pinned));
        }

        if (limits is not null)
        {
            builder.Services.AddSingleton(limits);
        }

        builder.Services.RemoveAll<IExerciseContext>();
        builder.Services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = currentExerciseId });

        var app = builder.Build();
        app.MapExerciseReport();
        await app.StartAsync();
        return new ExerciseReportTestHost(app);
    }

    /// <summary>Calls the report route presenting <paramref name="bearerToken"/> (or none).</summary>
    /// <param name="bearerToken">The raw session token, or <c>null</c> for an anonymous call.</param>
    /// <param name="query">An optional query string, e.g. <c>?includeNoise=true</c>.</param>
    /// <returns>The response.</returns>
    public async Task<HttpResponseMessage> GetReportAsync(string? bearerToken, string query = "")
    {
        using var client = _app.GetTestClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, ExerciseReportEndpoints.ReportRoute + query);
        if (bearerToken is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        }

        return await client.SendAsync(request);
    }

    /// <summary>The host's services (the singleton exercise clock, for the scenario-now tests).</summary>
    public IServiceProvider Services => _app.Services;

    /// <inheritdoc />
    public async ValueTask DisposeAsync() => await _app.DisposeAsync();
}

/// <summary>The extra rows the report suite seeds beyond <see cref="PostExportSeed"/>, fresh ids per test.</summary>
public sealed class ExerciseReportSeed
{
    private readonly MsSqlContainerFixture _fixture;

    /// <summary>Creates the seeder.</summary>
    /// <param name="fixture">The migrated-database fixture.</param>
    public ExerciseReportSeed(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>Seeds a persona with the verified flag and an optional avatar.</summary>
    /// <param name="exerciseId">The owning exercise.</param>
    /// <param name="handle">The handle.</param>
    /// <param name="displayName">The display name.</param>
    /// <param name="verified">The verified badge.</param>
    /// <param name="avatarMediaId">The avatar asset.</param>
    /// <param name="imitatesPersonaId">The persona a controller named this one as imitating (story 33).</param>
    /// <returns>The persona id.</returns>
    public async Task<Guid> PersonaAsync(
        Guid exerciseId,
        string handle,
        string displayName,
        bool verified = false,
        Guid? avatarMediaId = null,
        Guid? imitatesPersonaId = null)
    {
        var id = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Personas.Add(new Persona
        {
            Id = id,
            ExerciseId = exerciseId,
            Handle = handle,
            DisplayName = displayName,
            Kind = "human",
            Verified = verified,
            AvatarMediaId = avatarMediaId,
            ImitatesPersonaId = imitatesPersonaId,
        });
        await seed.SaveChangesAsync();
        return id;
    }

    /// <summary>Seeds a media asset.</summary>
    /// <param name="exerciseId">The owning exercise.</param>
    /// <param name="kind">The media kind.</param>
    /// <param name="configure">Optional tweaks.</param>
    /// <returns>The asset id.</returns>
    public async Task<Guid> AssetAsync(Guid exerciseId, string kind, Action<MediaAsset>? configure = null)
    {
        var asset = new MediaAsset
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            Kind = kind,
            ContentType = kind == MediaKinds.Video ? "video/mp4" : "image/jpeg",
            BlobName = string.Empty,
            Bytes = 4096,
            OriginalFileName = "file",
            UploadedByHumanId = "report-test",
            CreatedScenarioTime = PostExportSeed.ScenarioStart,
            CreatedWallClock = PostExportSeed.WallStart,
        };
        asset.BlobName = $"{exerciseId:D}/{asset.Id:N}";
        configure?.Invoke(asset);

        await using var seed = _fixture.CreateContext();
        seed.MediaAssets.Add(asset);
        await seed.SaveChangesAsync();
        return asset.Id;
    }

    /// <summary>Attaches an asset to a post.</summary>
    /// <param name="exerciseId">The owning exercise.</param>
    /// <param name="postId">The post.</param>
    /// <param name="assetId">The asset.</param>
    /// <param name="order">The slot.</param>
    /// <param name="alt">The alt text.</param>
    /// <param name="posterId">The item's poster override.</param>
    /// <returns>A task.</returns>
    public async Task AttachAsync(Guid exerciseId, Guid postId, Guid assetId, int order, string alt, Guid? posterId = null)
    {
        await using var seed = _fixture.CreateContext();
        seed.PostMediaItems.Add(new PostMediaItem
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            PostId = postId,
            MediaAssetId = assetId,
            PosterMediaAssetId = posterId,
            Alt = alt,
            Order = order,
        });
        await seed.SaveChangesAsync();
    }

    /// <summary>Seeds an inject item.</summary>
    /// <param name="exerciseId">The owning exercise.</param>
    /// <param name="title">The title.</param>
    /// <param name="externalRef">The MSEL Inject #.</param>
    /// <param name="firedMinute">Scenario minutes after the start when it fired, or <c>null</c> for unfired.</param>
    /// <param name="deleted">Whether the item is deleted.</param>
    /// <returns>The item id.</returns>
    public async Task<Guid> InjectAsync(Guid exerciseId, string title, string? externalRef = null, int? firedMinute = 0, bool deleted = false)
    {
        var id = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.InjectItems.Add(new InjectItem
        {
            Id = id,
            ExerciseId = exerciseId,
            Kind = "post",
            Title = title,
            ExternalRef = externalRef,
            Status = "fired",
            CreatedByHumanId = Guid.NewGuid(),
            CreatedAt = PostExportSeed.WallStart,
            UpdatedAt = PostExportSeed.WallStart,
            FiredScenarioTime = firedMinute is { } minute ? PostExportSeed.ScenarioStart.AddMinutes(minute) : null,
            DeletedAt = deleted ? PostExportSeed.WallStart : null,
        });
        await seed.SaveChangesAsync();
        return id;
    }

    /// <summary>Seeds an account.</summary>
    /// <param name="exerciseId">The owning exercise.</param>
    /// <param name="role">The <c>ExerciseRole</c>.</param>
    /// <param name="signedIn">Whether it has signed in.</param>
    /// <returns>The account id.</returns>
    public async Task<Guid> AccountAsync(Guid exerciseId, string role, bool signedIn)
    {
        var id = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Accounts.Add(new Account
        {
            Id = id,
            ExerciseId = exerciseId,
            Username = $"user-{id:N}",
            DisplayName = $"Player {id:N}",
            CreatedAt = PostExportSeed.WallStart,
            LastLoginAt = signedIn ? PostExportSeed.WallStart : null,
            Enrollment = new Enrollment { Id = Guid.NewGuid(), ExerciseId = exerciseId, Role = role },
        });
        await seed.SaveChangesAsync();
        return id;
    }
}
