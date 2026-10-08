namespace Pulse.WebApi.Features.Media;

using Azure.Core;
using Azure.Identity;
using Azure.Storage.Blobs;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.Identity.SharedAccess;
using Pulse.WebApi.Features.Social.Follows;

/// <summary>
/// The Azure credential and (optionally) client options the Azure media store and key source are built with.
/// Production registers <c>DefaultAzureCredential</c> (the App Service's managed identity) with default client
/// options; a test host may replace this one registration to substitute the HTTP transport. It carries a
/// <see cref="TokenCredential"/> only — there is no shared-key or connection-string member to put here.
/// </summary>
public sealed class MediaAzureClientSettings
{
    /// <summary>Creates the settings.</summary>
    /// <param name="credential">The token credential.</param>
    /// <param name="clientOptions">Optional client options (transport, retries).</param>
    public MediaAzureClientSettings(TokenCredential credential, BlobClientOptions? clientOptions = null)
    {
        ArgumentNullException.ThrowIfNull(credential);

        Credential = credential;
        ClientOptions = clientOptions;
    }

    /// <summary>The token credential (never a shared key).</summary>
    public TokenCredential Credential { get; }

    /// <summary>Optional client options.</summary>
    public BlobClientOptions? ClientOptions { get; }
}

/// <summary>
/// The media slice's composition-root pair (demo-polish BM): <see cref="AddMedia"/> registers the stores, signers,
/// services, the <c>media-upload</c> rate-limit policy and the Development-only <c>/dev-media</c> mapping;
/// <see cref="MapMedia"/> maps <c>POST /api/media</c> (read-only-denied, rate-limited) and
/// <c>GET /api/staff/media</c> (assigned staff only). The orchestrator wires one line of each into <c>Program.cs</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Provider selection (implementation.md §1.7), decided lazily from the bound options and the host
/// environment</b> — <see cref="SelectProvider"/>: <c>Azure</c> with a valid https <c>ServiceUri</c> →
/// <see cref="AzureBlobMediaStore"/> + <see cref="BlobMediaUrlSigner"/>; <c>Local</c> AND Development →
/// <see cref="LocalFileMediaStore"/> + <see cref="LocalMediaUrlSigner"/>; anything else (unset, <c>None</c>,
/// <c>Local</c> outside Development, <c>Azure</c> without a usable URI) → the fail-closed
/// <see cref="UnconfiguredMediaStore"/>, so uploads answer 503 and nothing else in the API changes.
/// </para>
/// <para>
/// <b>Registration wins regardless of order.</b> The store and signer are registered with plain
/// <c>AddSingleton</c>/<c>AddScoped</c> (never <c>TryAdd</c>): another slice's <c>TryAdd</c> fallback for
/// <see cref="IMediaUrlSigner"/> is then either skipped (registered after this) or shadowed (registered before —
/// the last registration is the one resolved).
/// </para>
/// <para>
/// <b>Middleware.</b> No ordering requirement on <c>Program.cs</c>: the upload's rate limit rides the existing
/// <c>app.UseRateLimiter()</c>, the lifecycle gate covers <c>/api/media</c> through
/// <c>ExerciseLifecycleGatedRoutes</c>, and <c>/dev-media</c> installs itself at the front of the pipeline through
/// <see cref="DevMediaStartupFilter"/> (Development + <c>Local</c> only).
/// </para>
/// </remarks>
public static class MediaEndpoints
{
    /// <summary>The upload route.</summary>
    public const string UploadRoute = "/api/media";

    /// <summary>The staff library route.</summary>
    public const string LibraryRoute = "/api/staff/media";

    /// <summary>The named rate-limit policy on <see cref="UploadRoute"/> (NFR-009, per account).</summary>
    public const string MediaUploadRateLimitPolicy = "media-upload";

    /// <summary>The 503 error code when no store is configured.</summary>
    public const string StoreUnavailableErrorCode = "media-store-unavailable";

    /// <summary>Registers the media slice.</summary>
    /// <param name="services">The service collection.</param>
    /// <param name="configuration">Configuration (<c>Azure:BlobStorage</c>, <c>Media:Upload</c>, <c>Media:Sas</c>).</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddMedia(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services.Configure<MediaStorageOptions>(configuration.GetSection(MediaStorageOptions.SectionName));
        services.Configure<MediaUploadOptions>(configuration.GetSection(MediaUploadOptions.SectionName));
        services.Configure<MediaSasOptions>(configuration.GetSection(MediaSasOptions.SectionName));

        services.AddHttpContextAccessor();
        services.TryAddSingleton(TimeProvider.System);

        // The participant arm of the uploader resolution (same accessor the follow/post slices use); TryAdd so the
        // slices converge on one registration in any order. ICurrentStaffSessionAccessor and StaffAssignmentService
        // come from the identity slices Program.cs already wires.
        services.TryAddScoped<ICurrentSessionPersonaAccessor, CurrentSessionPersonaAccessor>();

        // Keyless: a token credential only (managed identity in App Service). Constructing it performs no I/O.
        services.TryAddSingleton(_ => new MediaAzureClientSettings(new DefaultAzureCredential()));

        services.AddSingleton<IUserDelegationKeySource>(provider =>
        {
            var settings = provider.GetRequiredService<MediaAzureClientSettings>();
            return new BlobServiceUserDelegationKeySource(
                provider.GetRequiredService<IOptions<MediaStorageOptions>>(), settings.Credential, settings.ClientOptions);
        });
        services.AddSingleton<UserDelegationKeyCache>();

        services.AddSingleton<IMediaStore>(CreateStore);
        services.AddScoped<IMediaUrlSigner>(CreateSigner);

        services.AddScoped<MediaUploadService>();
        services.AddScoped<MediaLibraryService>();

        // Development + Local only: serves /dev-media/* ahead of the default-deny gate (see DevMediaStartupFilter).
        services.AddSingleton<IStartupFilter, DevMediaStartupFilter>();

        // NFR-009 — per ACCOUNT, not per session or IP. AddRateLimiter is additive across slices; enforcement is the
        // already-wired app.UseRateLimiter().
        services.AddRateLimiter(options =>
            options.AddPolicy<string, MediaUploadRateLimiterPolicy>(MediaUploadRateLimitPolicy));

        return services;
    }

    /// <summary>Maps <c>POST /api/media</c> and <c>GET /api/staff/media</c>.</summary>
    /// <param name="endpoints">The endpoint route builder.</param>
    /// <returns>The same builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapMedia(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        // A sim WRITE: a shared read-only session is refused (403) before the handler runs (COR-015).
        var writes = endpoints.MapGroup(string.Empty).DenyReadOnlySessions();
        writes.MapPost(UploadRoute, UploadAsync)
            .RequireRateLimiting(MediaUploadRateLimitPolicy);

        // Staff-only: a live staff session (401 otherwise) assigned to the resolved exercise (403 otherwise).
        var staff = endpoints.MapGroup(string.Empty).AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>();
        staff.MapGet(LibraryRoute, ListAsync);

        return endpoints;
    }

    /// <summary>
    /// The effective provider for <paramref name="options"/> in <paramref name="environment"/> — always one of
    /// <see cref="MediaStorageProviders"/>, failing closed to <see cref="MediaStorageProviders.None"/>.
    /// </summary>
    /// <param name="options">The storage options.</param>
    /// <param name="environment">The host environment.</param>
    /// <returns>The effective provider.</returns>
    public static string SelectProvider(MediaStorageOptions options, IHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(environment);

        var configured = options.Provider?.Trim();
        if (string.Equals(configured, MediaStorageProviders.Azure, StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                MediaBlobServiceClientFactory.ValidateServiceUri(options.ServiceUri);
                MediaBlobServiceClientFactory.ValidateContainerName(options.ContainerName);
                return MediaStorageProviders.Azure;
            }
            catch (InvalidOperationException)
            {
                return MediaStorageProviders.None;
            }
        }

        if (string.Equals(configured, MediaStorageProviders.Local, StringComparison.OrdinalIgnoreCase) && environment.IsDevelopment())
        {
            return MediaStorageProviders.Local;
        }

        return MediaStorageProviders.None;
    }

    /// <summary>
    /// Sets <c>POST /api/media</c>'s own request-body ceiling (the larger per-kind limit plus multipart overhead), so
    /// the server's ~30 MB default never cuts a legal video off. A no-op if the server has no such feature or the
    /// body is already being read.
    /// </summary>
    /// <param name="httpContext">The request.</param>
    /// <param name="options">The upload options.</param>
    public static void ApplyRequestSizeLimit(HttpContext httpContext, MediaUploadOptions options)
    {
        ArgumentNullException.ThrowIfNull(httpContext);
        ArgumentNullException.ThrowIfNull(options);

        var feature = httpContext.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (feature is not null && !feature.IsReadOnly)
        {
            feature.MaxRequestBodySize = options.MaxRequestBodyBytes();
        }
    }

    private static IMediaStore CreateStore(IServiceProvider provider)
    {
        var storage = provider.GetRequiredService<IOptions<MediaStorageOptions>>();
        var environment = provider.GetRequiredService<IHostEnvironment>();
        var selected = SelectProvider(storage.Value, environment);
        WarnIfDowngraded(provider, storage.Value, selected);

        switch (selected)
        {
            case MediaStorageProviders.Azure:
                var settings = provider.GetRequiredService<MediaAzureClientSettings>();
                return new AzureBlobMediaStore(
                    storage, settings.Credential, provider.GetRequiredService<ILogger<AzureBlobMediaStore>>(), settings.ClientOptions);

            case MediaStorageProviders.Local:
                return ActivatorUtilities.CreateInstance<LocalFileMediaStore>(provider);

            default:
                return new UnconfiguredMediaStore();
        }
    }

    private static IMediaUrlSigner CreateSigner(IServiceProvider provider)
    {
        var storage = provider.GetRequiredService<IOptions<MediaStorageOptions>>().Value;
        var environment = provider.GetRequiredService<IHostEnvironment>();

        return SelectProvider(storage, environment) switch
        {
            MediaStorageProviders.Azure => ActivatorUtilities.CreateInstance<BlobMediaUrlSigner>(provider),
            MediaStorageProviders.Local => ActivatorUtilities.CreateInstance<LocalMediaUrlSigner>(provider),
            _ => new UnconfiguredMediaUrlSigner(provider.GetRequiredService<IExerciseContext>()),
        };
    }

    private static void WarnIfDowngraded(IServiceProvider provider, MediaStorageOptions storage, string selected)
    {
        var configured = storage.Provider?.Trim();
        if (selected == MediaStorageProviders.None
            && !string.IsNullOrEmpty(configured)
            && !string.Equals(configured, MediaStorageProviders.None, StringComparison.OrdinalIgnoreCase))
        {
            provider.GetRequiredService<ILoggerFactory>()
                .CreateLogger(typeof(MediaEndpoints).FullName!)
                .LogMediaProviderDowngraded(configured);
        }
    }

    /// <summary>
    /// <c>POST /api/media</c> — multipart upload, streamed. 201 <see cref="MediaAssetView"/>; 400/401/403/413/415;
    /// 429 from the rate limiter; 503 <c>{"error":"media-store-unavailable"}</c> when no store is configured.
    /// </summary>
    private static async Task<IResult> UploadAsync(
        HttpContext httpContext,
        [FromServices] MediaUploadService uploadService,
        [FromServices] IOptions<MediaUploadOptions> uploadOptions,
        CancellationToken cancellationToken)
    {
        ApplyRequestSizeLimit(httpContext, uploadOptions.Value);

        var result = await uploadService.UploadAsync(httpContext.Request.ContentType, httpContext.Request.Body, cancellationToken);
        return result.Outcome switch
        {
            MediaUploadOutcome.Created => Results.Json(result.View, statusCode: StatusCodes.Status201Created),
            MediaUploadOutcome.ScopeUnresolved => Results.Unauthorized(),
            MediaUploadOutcome.Forbidden => Results.StatusCode(StatusCodes.Status403Forbidden),
            MediaUploadOutcome.Invalid => Results.BadRequest(result.Error),
            MediaUploadOutcome.TooLarge => Results.Json(result.Error, statusCode: StatusCodes.Status413PayloadTooLarge),
            MediaUploadOutcome.UnsupportedMediaType => Results.Json(result.Error, statusCode: StatusCodes.Status415UnsupportedMediaType),
            MediaUploadOutcome.StoreUnavailable => Results.Json(
                new MediaErrorDto(StoreUnavailableErrorCode), statusCode: StatusCodes.Status503ServiceUnavailable),

            // Unreachable; fail closed rather than emit a bare 200.
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }

    /// <summary><c>GET /api/staff/media?kind=&amp;take=</c> — the resolved exercise's library, newest first.</summary>
    private static async Task<IResult> ListAsync(
        [FromQuery] string? kind,
        [FromQuery] string? take,
        [FromServices] MediaLibraryService libraryService,
        CancellationToken cancellationToken)
    {
        MediaLibraryResult result;
        try
        {
            result = await libraryService.ListAsync(kind, take, cancellationToken);
        }
        catch (MediaStoreUnavailableException)
        {
            // Rows exist but no store is configured to sign them — say so rather than fabricate URLs.
            return Results.Json(new MediaErrorDto(StoreUnavailableErrorCode), statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        return result.Outcome switch
        {
            MediaLibraryOutcome.Ok => Results.Ok(result.Items),
            MediaLibraryOutcome.Invalid => Results.BadRequest(result.Error),
            MediaLibraryOutcome.ScopeUnresolved => Results.Unauthorized(),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }
}

/// <summary>Source-generated log messages for the media composition root.</summary>
internal static partial class MediaEndpointsLog
{
    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Azure:BlobStorage:Provider is '{ConfiguredProvider}' but it cannot be used here (Local outside Development, or Azure without a usable https ServiceUri). Media uploads will answer 503 (fail closed).")]
    public static partial void LogMediaProviderDowngraded(this ILogger logger, string configuredProvider);
}
