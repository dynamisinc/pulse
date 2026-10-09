namespace Pulse.WebApi.Tests.Features.Media;

using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Azure.Storage;
using FluentAssertions;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Features.Media;
using Xunit;

/// <summary>
/// demo-polish BM — the two real <see cref="IMediaStore"/>s. <see cref="AzureBlobMediaStore"/> runs the genuine
/// Azure SDK against <see cref="FakeBlobService"/> (AC "No account key, ever": token credential only, fails closed
/// without <c>ServiceUri</c>; AC "Streaming with per-kind limits": the ceiling while streaming, partial blob never
/// committed and deleted). <see cref="LocalFileMediaStore"/> runs against a temp directory (Development only).
/// </summary>
public sealed class MediaStoreTests : IDisposable
{
    private readonly string _tempRoot = Path.Combine(Path.GetTempPath(), $"pulse-media-store-{Guid.NewGuid():N}");

    public void Dispose()
    {
        if (Directory.Exists(_tempRoot))
        {
            Directory.Delete(_tempRoot, recursive: true);
        }
    }

    // ---- AC "No account key, ever" -------------------------------------------------------------------------

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not a uri")]
    [InlineData("http://stpulsetest.blob.core.windows.net")]
    [InlineData("https://stpulsetest.blob.core.windows.net/?sv=2025-01-05&sig=abc")]
    [InlineData("DefaultEndpointsProtocol=https;AccountName=stpulsetest;AccountKey=a2V5;EndpointSuffix=core.windows.net")]
    public void AzureStore_FailsClosedAtConstruction_WithoutAUsableHttpsServiceUri(string? serviceUri)
    {
        var options = Options.Create(new MediaStorageOptions { Provider = "Azure", ServiceUri = serviceUri });

        var construct = () => new AzureBlobMediaStore(options, new FakeTokenCredential(), NullLogger<AzureBlobMediaStore>.Instance);

        construct.Should().Throw<InvalidOperationException>(
            "there is no connection-string or account-key fallback: without an https ServiceUri the store cannot exist");
    }

    [Fact]
    public void AzureKeySource_AndSigner_FailClosedAtConstruction_WithoutAServiceUri()
    {
        var options = Options.Create(new MediaStorageOptions { Provider = "Azure", ServiceUri = null });

        var keySource = () => new BlobServiceUserDelegationKeySource(options, new FakeTokenCredential());

        keySource.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void NoMediaTypeAcceptsASharedKey_AndTheOptionsCarryNoKeyOrConnectionString()
    {
        var mediaTypes = typeof(IMediaStore).Assembly.GetTypes()
            .Where(type => type.Namespace == typeof(IMediaStore).Namespace)
            .ToList();

        var keyedParameters = mediaTypes
            .SelectMany(type => type.GetConstructors().Cast<MethodBase>().Concat(type.GetMethods()))
            .SelectMany(method => method.GetParameters())
            .Where(parameter => parameter.ParameterType == typeof(StorageSharedKeyCredential)
                || (parameter.Name ?? string.Empty).Contains("connectionString", StringComparison.OrdinalIgnoreCase)
                || (parameter.Name ?? string.Empty).Contains("accountKey", StringComparison.OrdinalIgnoreCase))
            .ToList();

        keyedParameters.Should().BeEmpty("no media type can be handed a shared key or a connection string (COR-002)");
        typeof(MediaStorageOptions).GetProperties().Select(property => property.Name).Should().BeEquivalentTo(
            ["Provider", "ServiceUri", "ContainerName", "LocalRootPath"],
            "the storage options carry an endpoint and a container — never a key, SAS or connection string");
    }

    [Fact]
    public async Task AzureStore_UploadsWithABearerTokenOnly_TheSniffedContentType_AndNeverOverwrites()
    {
        var service = new FakeBlobService();
        var store = NewAzureStore(service);
        var blobName = MediaBlobNames.Build(Guid.NewGuid(), Guid.NewGuid(), "png");
        var bytes = MediaTestFiles.Png(2048);

        var written = await store.SaveAsync(blobName, "image/png", new MemoryStream(bytes), 4096, CancellationToken.None);

        written.Should().Be(bytes.Length);
        service.Requests.Should().NotBeEmpty().And.OnlyContain(
            request => request.AuthorizationScheme == "Bearer",
            "the managed identity's token is the only credential on every call — never SharedKey");
        service.Requests.Should().OnlyContain(
            request => request.Method == "PUT" && request.Uri.AbsolutePath == $"/post-media/{blobName}",
            "the blob lands in the private container under its scoped name");
        service.Requests.Sum(request => request.Uri.Query.Contains("comp=blocklist", StringComparison.Ordinal) ? 0 : request.BodyLength)
            .Should().Be(bytes.Length, "every byte was streamed up");

        // A non-seekable body is staged as blocks and COMMITTED by Put Block List — the request that names the blob's
        // type and refuses to overwrite.
        var commit = service.Requests.Last();
        commit.BlobContentType.Should().Be("image/png", "the blob carries the SNIFFED type");
        commit.IfNoneMatch.Should().Be("*", "an upload never overwrites an existing blob");
        service.Committed.Should().ContainKey($"/post-media/{blobName}");
    }

    // ---- AC "Streaming with per-kind limits" — Azure -------------------------------------------------------

    [Fact]
    public async Task AzureStore_OverTheCeiling_ThrowsMediaTooLarge_CommitsNothing_AndDeletesThePartial()
    {
        var service = new FakeBlobService();
        var store = NewAzureStore(service);
        var blobName = MediaBlobNames.Build(Guid.NewGuid(), Guid.NewGuid(), "mp4");

        // > one 4 MiB block so the SDK actually STAGES blocks before the ceiling trips mid-stream.
        var maxBytes = (2 * AzureBlobMediaStore.TransferBlockBytes) + 1024;
        var source = new NonSeekableStream(new MemoryStream(MediaTestFiles.Mp4((3 * AzureBlobMediaStore.TransferBlockBytes) + 10)));

        var save = () => store.SaveAsync(blobName, "video/mp4", source, maxBytes, CancellationToken.None);

        await save.Should().ThrowAsync<MediaTooLargeException>();
        service.Requests.Should().NotContain(
            request => request.Uri.Query.Contains("comp=blocklist", StringComparison.Ordinal),
            "the block list is never committed, so no partial blob ever becomes visible");
        service.Requests.Should().Contain(
            request => request.Method == "DELETE" && request.Uri.AbsolutePath == $"/post-media/{blobName}",
            "the store still issues the partial-blob delete");
        service.Committed.Should().BeEmpty();
    }

    [Fact]
    public async Task AzureStore_SmallOverTheCeiling_ThrowsBeforeAnyPut_AndDeletes()
    {
        var service = new FakeBlobService();
        var store = NewAzureStore(service);
        var blobName = MediaBlobNames.Build(Guid.NewGuid(), Guid.NewGuid(), "png");

        var save = () => store.SaveAsync(blobName, "image/png", new MemoryStream(MediaTestFiles.Png(5000)), 4096, CancellationToken.None);

        await save.Should().ThrowAsync<MediaTooLargeException>();
        service.Requests.Should().NotContain(request => request.Method == "PUT");
        service.Requests.Should().Contain(request => request.Method == "DELETE");
    }

    [Fact]
    public async Task AzureStore_RefusesAMalformedBlobName()
    {
        var store = NewAzureStore(new FakeBlobService());

        var save = () => store.SaveAsync("../../other-container/x.png", "image/png", new MemoryStream(MediaTestFiles.Png()), 4096, CancellationToken.None);

        await save.Should().ThrowAsync<ArgumentException>();
    }

    // ---- LocalFileMediaStore (Development only) ------------------------------------------------------------

    [Fact]
    public void LocalStore_RefusesToExistOutsideDevelopment()
    {
        var construct = () => new LocalFileMediaStore(LocalOptions(), new TestHostEnvironment(Environments.Production, _tempRoot), NullLogger<LocalFileMediaStore>.Instance);

        construct.Should().Throw<InvalidOperationException>("the local store is Development-only");
    }

    [Fact]
    public async Task LocalStore_WritesUnderTheRoot_AndReportsBytes()
    {
        var store = NewLocalStore();
        var blobName = MediaBlobNames.Build(Guid.NewGuid(), Guid.NewGuid(), "jpg");
        var bytes = MediaTestFiles.Jpeg(3000);

        var written = await store.SaveAsync(blobName, "image/jpeg", new MemoryStream(bytes), 4096, CancellationToken.None);

        written.Should().Be(3000);
        File.ReadAllBytes(Path.Combine(store.RootPath, blobName)).Should().Equal(bytes);
    }

    [Fact]
    public async Task LocalStore_OverTheCeiling_ThrowsMediaTooLarge_AndLeavesNoFile()
    {
        var store = NewLocalStore();
        var blobName = MediaBlobNames.Build(Guid.NewGuid(), Guid.NewGuid(), "png");

        var save = () => store.SaveAsync(blobName, "image/png", new MemoryStream(MediaTestFiles.Png(200_000)), 100_000, CancellationToken.None);

        await save.Should().ThrowAsync<MediaTooLargeException>();
        File.Exists(Path.Combine(store.RootPath, blobName)).Should().BeFalse("the partial file is deleted");
    }

    [Fact]
    public async Task LocalStore_NeverOverwrites_AndAFailedOverwriteDoesNotDeleteTheOriginal()
    {
        var store = NewLocalStore();
        var blobName = MediaBlobNames.Build(Guid.NewGuid(), Guid.NewGuid(), "png");
        var original = MediaTestFiles.Png(300);
        await store.SaveAsync(blobName, "image/png", new MemoryStream(original), 4096, CancellationToken.None);

        var overwrite = () => store.SaveAsync(blobName, "image/png", new MemoryStream(MediaTestFiles.Png(400)), 4096, CancellationToken.None);

        await overwrite.Should().ThrowAsync<IOException>();
        File.ReadAllBytes(Path.Combine(store.RootPath, blobName)).Should().Equal(original);
    }

    [Theory]
    [InlineData("../escape.png")]
    [InlineData("/etc/passwd")]
    [InlineData("not-a-guid/abc.png")]
    public async Task LocalStore_RefusesAnyNameThatIsNotAMediaBlobName(string blobName)
    {
        var store = NewLocalStore();

        var save = () => store.SaveAsync(blobName, "image/png", new MemoryStream(MediaTestFiles.Png()), 4096, CancellationToken.None);

        await save.Should().ThrowAsync<ArgumentException>();
    }

    [Fact]
    public async Task UnconfiguredStore_IsNotConfigured_AndNeverStores()
    {
        var store = new UnconfiguredMediaStore();

        store.IsConfigured.Should().BeFalse();
        var save = () => store.SaveAsync("x", "image/png", new MemoryStream(), 1, CancellationToken.None);
        await save.Should().ThrowAsync<MediaStoreUnavailableException>();
    }

    private static AzureBlobMediaStore NewAzureStore(FakeBlobService service) => new(
        Options.Create(new MediaStorageOptions { Provider = "Azure", ServiceUri = FakeBlobService.ServiceUri }),
        new FakeTokenCredential(),
        NullLogger<AzureBlobMediaStore>.Instance,
        service.ClientOptions());

    private IOptions<MediaStorageOptions> LocalOptions() =>
        Options.Create(new MediaStorageOptions { Provider = "Local", LocalRootPath = _tempRoot });

    private LocalFileMediaStore NewLocalStore() =>
        new(LocalOptions(), new TestHostEnvironment(Environments.Development, _tempRoot), NullLogger<LocalFileMediaStore>.Instance);

    /// <summary>A minimal host environment.</summary>
    internal sealed class TestHostEnvironment : IHostEnvironment
    {
        public TestHostEnvironment(string environmentName, string contentRoot)
        {
            EnvironmentName = environmentName;
            ContentRootPath = contentRoot;
        }

        public string EnvironmentName { get; set; }

        public string ApplicationName { get; set; } = "Pulse.WebApi.Tests";

        public string ContentRootPath { get; set; }

        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    /// <summary>Hides seekability, as a request body does.</summary>
    private sealed class NonSeekableStream : Stream
    {
        private readonly Stream _inner;

        public NonSeekableStream(Stream inner) => _inner = inner;

        public override bool CanRead => true;

        public override bool CanSeek => false;

        public override bool CanWrite => false;

        public override long Length => throw new NotSupportedException();

        public override long Position
        {
            get => throw new NotSupportedException();
            set => throw new NotSupportedException();
        }

        public override int Read(byte[] buffer, int offset, int count) => _inner.Read(buffer, offset, count);

        public override void Flush()
        {
        }

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
