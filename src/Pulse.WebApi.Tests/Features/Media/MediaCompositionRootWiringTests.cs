namespace Pulse.WebApi.Tests.Features.Media;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Media;
using Xunit;

/// <summary>
/// Composition-root guard for the media slice (plain <see cref="FactAttribute"/>s, no Docker, no database): boots the
/// REAL <c>Program</c> host and proves <c>AddMedia</c>/<c>MapMedia</c> are wired — each route mapped exactly once and
/// answering 401 (the gate), not 404 (the #310→#317 dead-route lesson) — and that provider selection resolves the
/// right store and ALWAYS a signer (Gate-2 M-2): Development/<c>Local</c>, <c>None</c>, <c>Azure</c> with and without
/// a <c>ServiceUri</c>. Also pins the rate-limit partition (per account), the request-size limit, and that this
/// slice's registrations win over another slice's <c>TryAdd</c> fallback in either order.
/// </summary>
public sealed class MediaCompositionRootWiringTests
{
    [Fact]
    public void ProgramCs_MapsBothMediaRoutesExactlyOnce_GatedAndRateLimited()
    {
        using var factory = new WiringProbe();
        var endpoints = factory.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>().ToList();

        var upload = endpoints.Where(endpoint => Matches(endpoint, "POST", "/api/media")).ToList();
        var library = endpoints.Where(endpoint => Matches(endpoint, "GET", "/api/staff/media")).ToList();

        upload.Should().ContainSingle("POST /api/media must be mapped by Program.cs exactly once");
        library.Should().ContainSingle("GET /api/staff/media must be mapped by Program.cs exactly once");
        upload[0].Metadata.GetMetadata<EnableRateLimitingAttribute>()?.PolicyName.Should().Be(
            MediaEndpoints.MediaUploadRateLimitPolicy, "the upload carries the per-account media-upload policy (NFR-009)");
        upload[0].Metadata.GetMetadata<IAllowAnonymous>().Should().BeNull("the upload is NOT on the pre-auth allowlist");
        library[0].Metadata.GetMetadata<IAllowAnonymous>().Should().BeNull("the library is NOT on the pre-auth allowlist");
        endpoints.Should().NotContain(
            endpoint => (endpoint.RoutePattern.RawText ?? string.Empty).StartsWith("/dev-media", StringComparison.OrdinalIgnoreCase),
            "/dev-media is never an endpoint (it would have to be allowlisted) — it is a Development-only static mapping");
    }

    [Theory]
    [InlineData("POST", "/api/media")]
    [InlineData("GET", "/api/staff/media")]
    public async Task MediaRoutes_AnswerTheGates401_Not404_WithNoCredential(string method, string route)
    {
        using var factory = new WiringProbe();
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(new HttpMethod(method), route);

        using var response = await client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "{0} {1} is wired (a dead route would 404)", method, route);
        response.Headers.WwwAuthenticate.Should().NotBeEmpty("and it is the default-deny GATE that answers, before any media work");
    }

    [Fact]
    public void ProgramCs_ResolvesEveryMediaService_AndInstallsTheDevMediaStartupFilter()
    {
        using var factory = new WiringProbe();
        using var scope = factory.Services.CreateScope();

        scope.ServiceProvider.GetRequiredService<MediaUploadService>().Should().NotBeNull();
        scope.ServiceProvider.GetRequiredService<MediaLibraryService>().Should().NotBeNull();
        factory.Services.GetServices<IStartupFilter>().Should().Contain(filter => filter is DevMediaStartupFilter);

        // Development (the test host's environment) + appsettings.Development.json's Local provider.
        scope.ServiceProvider.GetRequiredService<IMediaStore>().Should().BeOfType<LocalFileMediaStore>();
        scope.ServiceProvider.GetRequiredService<IMediaUrlSigner>().Should().BeOfType<LocalMediaUrlSigner>();
    }

    /// <summary>Gate-2 M-2: with <c>Provider=None</c> a signer is still resolvable (the projector resolves it on every feed read).</summary>
    [Fact]
    public async Task ProviderNone_StillRegistersASigner_ThatOnlyThrowsWhenAskedToSign()
    {
        using var factory = new WiringProbe(settings: new() { ["Azure:BlobStorage:Provider"] = "None" });
        using var scope = factory.Services.CreateScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = Guid.NewGuid();

        var signer = scope.ServiceProvider.GetRequiredService<IMediaUrlSigner>();

        signer.Should().BeOfType<UnconfiguredMediaUrlSigner>();
        (await signer.GetReadUrlsAsync([], CancellationToken.None)).Should().BeEmpty("a feed with no media asks nothing of it");
        scope.ServiceProvider.GetRequiredService<IMediaStore>().IsConfigured.Should().BeFalse();
    }

    /// <summary>
    /// Gate-2 M-2: the live UAT App Service still has the pre-I1 settings until Tom deploys I1 — <c>Provider=Azure</c>,
    /// an empty <c>ConnectionString</c>, no <c>ServiceUri</c>. The host must BOOT (no startup throw), the store must be
    /// unconfigured (uploads 503) and a signer must still resolve.
    /// </summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("http://not-https.blob.core.windows.net")]
    public void ProviderAzure_WithoutAUsableServiceUri_BootsAsUnconfigured(string? serviceUri)
    {
        var settings = new Dictionary<string, string?>
        {
            ["Azure:BlobStorage:Provider"] = "Azure",
            ["Azure:BlobStorage:ConnectionString"] = string.Empty,
        };
        if (serviceUri is not null)
        {
            settings["Azure:BlobStorage:ServiceUri"] = serviceUri;
        }

        using var factory = new WiringProbe(Environments.Production, settings);
        using var client = factory.CreateClient();
        using var scope = factory.Services.CreateScope();

        scope.ServiceProvider.GetRequiredService<IMediaStore>().Should().BeOfType<UnconfiguredMediaStore>()
            .Which.IsConfigured.Should().BeFalse("Provider=Azure with no usable ServiceUri is treated as unconfigured");
        scope.ServiceProvider.GetRequiredService<IMediaUrlSigner>().Should().BeOfType<UnconfiguredMediaUrlSigner>();
    }

    [Fact]
    public void ProviderAzure_WithAnHttpsServiceUri_SelectsTheKeylessAzureStoreAndSigner()
    {
        using var factory = new WiringProbe(Environments.Production, new()
        {
            ["Azure:BlobStorage:Provider"] = "Azure",
            ["Azure:BlobStorage:ServiceUri"] = "https://stpulseuat.blob.core.windows.net",
        });
        using var scope = factory.Services.CreateScope();

        scope.ServiceProvider.GetRequiredService<IMediaStore>().Should().BeOfType<AzureBlobMediaStore>();
        scope.ServiceProvider.GetRequiredService<IMediaUrlSigner>().Should().BeOfType<BlobMediaUrlSigner>();
    }

    [Fact]
    public void ProviderLocal_OutsideDevelopment_IsNeverSelected_AndTheLocalStoreIsNotRegistered()
    {
        using var factory = new WiringProbe(Environments.Production, new() { ["Azure:BlobStorage:Provider"] = "Local" });
        using var scope = factory.Services.CreateScope();

        scope.ServiceProvider.GetRequiredService<IMediaStore>().Should().BeOfType<UnconfiguredMediaStore>();
        scope.ServiceProvider.GetService<LocalFileMediaStore>().Should().BeNull("the Local store type is never registered");
        scope.ServiceProvider.GetRequiredService<IMediaUrlSigner>().Should().BeOfType<UnconfiguredMediaUrlSigner>();
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void AddMedia_WinsOverAnotherSlicesTryAddSignerFallback_InEitherOrder(bool fallbackFirst)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IHostEnvironment>(new MediaStoreTests.TestHostEnvironment(Environments.Production, AppContext.BaseDirectory));
        services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = Guid.NewGuid() });
        var configuration = new ConfigurationBuilder().AddInMemoryCollection().Build();

        if (fallbackFirst)
        {
            services.TryAddScoped<IMediaUrlSigner, FallbackSigner>();
        }

        services.AddMedia(configuration);

        if (!fallbackFirst)
        {
            services.TryAddScoped<IMediaUrlSigner, FallbackSigner>();
        }

        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();
        scope.ServiceProvider.GetRequiredService<IMediaUrlSigner>().Should().NotBeOfType<FallbackSigner>(
            "AddMedia registers with plain AddScoped/AddSingleton, so a TryAdd fallback never wins");
    }

    [Fact]
    public void RateLimitPartition_IsTheStableAccount_NeverTheSession()
    {
        var accountId = Guid.NewGuid().ToString();
        var staffUserId = Guid.NewGuid();

        var firstSignIn = Context(Session("participant", accountId));
        var freshSignIn = Context(Session("participant", accountId));
        var otherAccount = Context(Session("participant", Guid.NewGuid().ToString()));
        var staff = Context(Session("staff", staffUserId.ToString(), staffUserId));

        MediaUploadRateLimiterPolicy.PartitionKeyFor(freshSignIn).Should().Be(
            MediaUploadRateLimiterPolicy.PartitionKeyFor(firstSignIn), "two sessions of one account share one quota");
        MediaUploadRateLimiterPolicy.PartitionKeyFor(firstSignIn).Should().Be($"participant:{accountId}");
        MediaUploadRateLimiterPolicy.PartitionKeyFor(otherAccount).Should().NotBe(MediaUploadRateLimiterPolicy.PartitionKeyFor(firstSignIn));
        MediaUploadRateLimiterPolicy.PartitionKeyFor(staff).Should().Be($"staff:{staffUserId:D}");
        MediaUploadRateLimiterPolicy.PartitionKeyFor(new DefaultHttpContext()).Should().Be("anonymous");
    }

    [Fact]
    public void Upload_SetsItsOwnRequestSizeLimit_AboveKestrelsDefault()
    {
        var options = new MediaUploadOptions();
        var feature = new MaxBodySizeFeature();
        var context = new DefaultHttpContext();
        context.Features.Set<IHttpMaxRequestBodySizeFeature>(feature);

        MediaEndpoints.ApplyRequestSizeLimit(context, options);

        feature.MaxRequestBodySize.Should().Be(options.VideoMaxBytes + MediaUploadOptions.MultipartOverheadBytes);
        feature.MaxRequestBodySize.Should().BeGreaterThan(30_000_000, "Kestrel's ~30 MB default would cut a legal 100 MiB video off");

        var readOnly = new MaxBodySizeFeature { IsReadOnly = true, MaxRequestBodySize = 123 };
        context.Features.Set<IHttpMaxRequestBodySizeFeature>(readOnly);
        MediaEndpoints.ApplyRequestSizeLimit(context, options);
        readOnly.MaxRequestBodySize.Should().Be(123, "a body already being read is left alone");
    }

    private static bool Matches(RouteEndpoint endpoint, string method, string route) =>
        string.Equals(endpoint.RoutePattern.RawText, route, StringComparison.OrdinalIgnoreCase)
        && (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false);

    private static AuthenticatedSession Session(string kind, string principalId, Guid? staffUserId = null) => new()
    {
        SessionId = Guid.NewGuid(),
        ExerciseId = Guid.NewGuid(),
        Kind = kind,
        PrincipalId = principalId,
        ActingHumanId = $"human-{Guid.NewGuid():N}",
        StaffUserId = staffUserId,
    };

    private static DefaultHttpContext Context(AuthenticatedSession session) => new() { User = SessionPrincipal.Create(session) };

    private sealed class MaxBodySizeFeature : IHttpMaxRequestBodySizeFeature
    {
        public bool IsReadOnly { get; set; }

        public long? MaxRequestBodySize { get; set; } = 30_000_000;
    }

    private sealed class FallbackSigner : IMediaUrlSigner
    {
        public Task<string> GetReadUrlAsync(MediaAsset asset, CancellationToken cancellationToken) => Task.FromResult("fallback");

        public Task<IReadOnlyDictionary<Guid, string>> GetReadUrlsAsync(IReadOnlyCollection<MediaAsset> assets, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyDictionary<Guid, string>>(new Dictionary<Guid, string>());
    }

    /// <summary>
    /// The real <c>Program</c> host with a never-connecting connection string and a fixed host→exercise resolver, so
    /// it BUILDS and answers the gate's 401 with no database work.
    /// </summary>
    private sealed class WiringProbe : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

        private readonly string _environment;
        private readonly Dictionary<string, string?> _settings;

        public WiringProbe(string environment = "Development", Dictionary<string, string?>? settings = null)
        {
            _environment = environment;
            _settings = settings ?? [];
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, "Server=nonexistent;Database=pulse;Trusted_Connection=False;");
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            ArgumentNullException.ThrowIfNull(builder);

            builder.UseEnvironment(_environment);
            foreach (var (key, value) in _settings)
            {
                builder.UseSetting(key, value);
            }

            builder.ConfigureLogging(logging => logging.SetMinimumLevel(LogLevel.Warning));
            builder.ConfigureTestServices(services =>
                services.AddSingleton<IHostExerciseResolver>(new FixedHostExerciseResolver(Guid.Parse("cccccccc-0000-4000-8000-00000000000c"))));
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }

    private sealed class FixedHostExerciseResolver : IHostExerciseResolver
    {
        private readonly Guid _exerciseId;

        public FixedHostExerciseResolver(Guid exerciseId) => _exerciseId = exerciseId;

        public Task<Guid?> ResolveExerciseIdAsync(string? rawHost, CancellationToken cancellationToken) => Task.FromResult<Guid?>(_exerciseId);
    }
}
