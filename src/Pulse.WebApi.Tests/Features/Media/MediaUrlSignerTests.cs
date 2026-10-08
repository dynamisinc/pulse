namespace Pulse.WebApi.Tests.Features.Media;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Azure.Storage.Blobs.Models;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Xunit;

/// <summary>
/// demo-polish BM AC "SAS scope and expiry" — the minted URL is parsed and every load-bearing SAS field asserted:
/// <c>sp=r</c>, <c>sr=b</c>, <c>spr=https</c>, one blob path, a user-delegation key (<c>skoid</c>) that outlives
/// the SAS, the pinned response type, the bucketed expiry (identical URLs within a bucket, ≥ 12 h left), and the
/// isolation throw for an out-of-scope asset (COR-001/COR-002). No Azure: the key comes from a fake source, or
/// from <see cref="FakeBlobService"/> through the real SDK.
/// </summary>
public sealed class MediaUrlSignerTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 10, 15, 30, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset BucketStart = new(2026, 10, 10, 15, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task MintedSas_IsReadOnly_SingleBlob_HttpsOnly_UserDelegation_WithThePinnedTypeAndBucketedExpiry()
    {
        var harness = new SignerHarness();
        var asset = harness.Asset("png");

        var url = await harness.Signer.GetReadUrlAsync(asset, CancellationToken.None);

        var uri = new Uri(url);
        uri.Scheme.Should().Be("https");
        uri.Host.Should().Be($"{FakeBlobService.AccountName}.blob.core.windows.net");
        uri.AbsolutePath.Should().Be($"/post-media/{asset.BlobName}", "the SAS names exactly one blob in the private container");

        var sas = SasUrl.Query(url);
        sas["sp"].Should().Be("r", "the SAS grants READ and nothing else");
        sas["sr"].Should().Be("b", "the SAS is scoped to a single blob, not a container");
        sas["spr"].Should().Be("https", "HTTPS only");
        sas.Should().ContainKey("skoid", "a USER-DELEGATION SAS (signed by the managed identity's delegation key), not an account-key SAS");
        sas["skoid"].Should().Be(FakeBlobService.SignedObjectId);
        sas.Should().ContainKeys("sktid", "skt", "ske", "sks", "skv", "sig", "sv");
        sas["rsct"].Should().Be("image/png", "the response Content-Type is pinned to the stored, sniffed type");
        sas["rscd"].Should().Be("inline");
        sas.Should().NotContainKeys(["srt", "ss", "sdd", "sip"], "never an account SAS, never a directory SAS");

        var expiresOn = SasUrl.Time(sas["se"]);
        expiresOn.Should().Be(BucketStart.AddHours(13), "expiry is bucketStart(1 h) + 13 h");
        SasUrl.Time(sas["ske"]).Should().BeOnOrAfter(expiresOn, "the delegation key outlives the SAS it signs");
    }

    [Fact]
    public async Task TwoMintsInOneBucket_ReturnIdenticalUrls_AndANewBucketChangesTheExpiry()
    {
        var harness = new SignerHarness();
        var asset = harness.Asset("mp4");

        var first = await harness.Signer.GetReadUrlAsync(asset, CancellationToken.None);
        harness.Time.Advance(TimeSpan.FromMinutes(29) + TimeSpan.FromSeconds(59)); // 15:59:59 — same bucket
        var second = await harness.Signer.GetReadUrlAsync(asset, CancellationToken.None);
        harness.Time.Advance(TimeSpan.FromSeconds(1)); // 16:00:00 — next bucket
        var third = await harness.Signer.GetReadUrlAsync(asset, CancellationToken.None);

        second.Should().Be(first, "any URL minted inside one bucket is byte-identical, so the browser cache works");
        third.Should().NotBe(first);
        SasUrl.Time(SasUrl.Query(third)["se"]).Should().Be(BucketStart.AddHours(14));
        harness.Keys.Calls.Should().Be(1, "the cached delegation key is reused while it outlives the SAS");
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(1799)]
    [InlineData(3599)]
    public async Task EveryMintedUrl_HasAtLeastTwelveHoursLeft(int secondsIntoBucket)
    {
        var harness = new SignerHarness(BucketStart.AddSeconds(secondsIntoBucket));

        var url = await harness.Signer.GetReadUrlAsync(harness.Asset("jpg"), CancellationToken.None);

        (SasUrl.Time(SasUrl.Query(url)["se"]) - harness.Time.GetUtcNow()).Should().BeGreaterThanOrEqualTo(
            TimeSpan.FromHours(12), "every URL has at least LifetimeHours left");
    }

    [Fact]
    public async Task MintingForAnotherExercisesAsset_ThrowsExerciseScopeViolation_AndFetchesNoKey()
    {
        var harness = new SignerHarness();
        var foreign = harness.Asset("png", exerciseId: Guid.NewGuid());

        var mint = () => harness.Signer.GetReadUrlAsync(foreign, CancellationToken.None);

        await mint.Should().ThrowAsync<ExerciseScopeViolationException>("a URL is never minted outside the scope (COR-001/COR-002)");
        harness.Keys.Calls.Should().Be(0);
    }

    [Fact]
    public async Task ABatchWithOneForeignAsset_MintsNothingAtAll()
    {
        var harness = new SignerHarness();
        var batch = new[] { harness.Asset("png"), harness.Asset("jpg", exerciseId: Guid.NewGuid()), harness.Asset("mp4") };

        var mint = () => harness.Signer.GetReadUrlsAsync(batch, CancellationToken.None);

        await mint.Should().ThrowAsync<ExerciseScopeViolationException>();
        harness.Keys.Calls.Should().Be(0, "the whole batch is checked before any URL is minted");
    }

    [Fact]
    public async Task AnUnresolvedScope_FailsClosed()
    {
        var harness = new SignerHarness(scopeResolved: false);

        var mint = () => harness.Signer.GetReadUrlAsync(harness.Asset("png"), CancellationToken.None);

        await mint.Should().ThrowAsync<ExerciseScopeViolationException>();
    }

    [Fact]
    public async Task BatchMint_SignsEveryAssetWithTheSameExpiry()
    {
        var harness = new SignerHarness();
        var assets = new[] { harness.Asset("png"), harness.Asset("webm") };

        var urls = await harness.Signer.GetReadUrlsAsync(assets, CancellationToken.None);

        urls.Keys.Should().BeEquivalentTo(assets.Select(asset => asset.Id));
        urls.Values.Select(url => SasUrl.Query(url)["se"]).Distinct().Should().ContainSingle();
        SasUrl.Query(urls[assets[1].Id])["rsct"].Should().Be("video/webm");
    }

    [Fact]
    public async Task KeyCache_RequestsAKeyThatOutlivesTheSas_AndRefreshesOnlyWhenTheCachedOneWouldNot()
    {
        var harness = new SignerHarness();
        var asset = harness.Asset("png");

        await harness.Signer.GetReadUrlAsync(asset, CancellationToken.None);
        var firstRequest = harness.Keys.Requested.Single();
        firstRequest.ExpiresOn.Should().BeOnOrAfter(BucketStart.AddHours(13));
        firstRequest.StartsOn.Should().BeBefore(Now, "the key is backdated for clock skew");

        harness.Time.Advance(UserDelegationKeyCache.ReuseWindow - TimeSpan.FromHours(1));
        await harness.Signer.GetReadUrlAsync(asset, CancellationToken.None);
        harness.Keys.Calls.Should().Be(1, "still inside the reuse window — the cached key outlives this SAS too");

        harness.Time.Advance(TimeSpan.FromHours(2));
        var url = await harness.Signer.GetReadUrlAsync(asset, CancellationToken.None);
        harness.Keys.Calls.Should().Be(2, "the cached key would die before the new SAS, so a fresh one is fetched");
        SasUrl.Time(SasUrl.Query(url)["ske"]).Should().BeOnOrAfter(SasUrl.Time(SasUrl.Query(url)["se"]));
    }

    [Fact]
    public async Task KeyCache_RefusesToSignWithAKeyThatDiesBeforeTheSas()
    {
        var harness = new SignerHarness(keyLifetimeOverride: TimeSpan.FromHours(1));

        var mint = () => harness.Signer.GetReadUrlAsync(harness.Asset("png"), CancellationToken.None);

        await mint.Should().ThrowAsync<InvalidOperationException>("a URL that 403s before its stated expiry is never minted");
    }

    [Fact]
    public async Task RealKeySource_FetchesTheUserDelegationKeyWithABearerToken_ThroughTheSdk()
    {
        var service = new FakeBlobService();
        var source = new BlobServiceUserDelegationKeySource(
            Options.Create(new MediaStorageOptions { Provider = "Azure", ServiceUri = FakeBlobService.ServiceUri }),
            new FakeTokenCredential(),
            service.ClientOptions());
        var exerciseContext = new ExerciseContext { CurrentExerciseId = Guid.NewGuid() };
        var time = new ManualTimeProvider(Now);
        var signer = new BlobMediaUrlSigner(
            exerciseContext,
            new UserDelegationKeyCache(source, time),
            Options.Create(new MediaStorageOptions { Provider = "Azure", ServiceUri = FakeBlobService.ServiceUri }),
            Options.Create(new MediaSasOptions()),
            time);
        var id = Guid.NewGuid();
        var asset = NewAsset(exerciseContext.CurrentExerciseId!.Value, id, "png");

        var url = await signer.GetReadUrlAsync(asset, CancellationToken.None);

        source.AccountName.Should().Be(FakeBlobService.AccountName);
        var request = service.Requests.Should().ContainSingle().Subject;
        request.Method.Should().Be("POST");
        request.Uri.Query.Should().Contain("restype=service").And.Contain("comp=userdelegationkey");
        request.AuthorizationScheme.Should().Be("Bearer", "the delegation key is requested by the managed identity, never with an account key");
        SasUrl.Query(url)["skoid"].Should().Be(FakeBlobService.SignedObjectId);
        SasUrl.Query(url)["sp"].Should().Be("r");
    }

    // ---- Development + unconfigured signers ----------------------------------------------------------------

    [Fact]
    public async Task LocalSigner_MintsAnAbsoluteDevMediaUrl_AndEnforcesTheSameScopeCheck()
    {
        var exerciseId = Guid.NewGuid();
        var httpContext = new DefaultHttpContext();
        httpContext.Request.Scheme = "http";
        httpContext.Request.Host = new HostString("localhost", 5080);
        var signer = new LocalMediaUrlSigner(
            new ExerciseContext { CurrentExerciseId = exerciseId }, new HttpContextAccessor { HttpContext = httpContext });
        var asset = NewAsset(exerciseId, Guid.NewGuid(), "webm");

        var url = await signer.GetReadUrlAsync(asset, CancellationToken.None);
        var foreign = () => signer.GetReadUrlAsync(NewAsset(Guid.NewGuid(), Guid.NewGuid(), "png"), CancellationToken.None);

        url.Should().Be($"http://localhost:5080/dev-media/{asset.BlobName}");
        await foreign.Should().ThrowAsync<ExerciseScopeViolationException>("Development must not teach a different isolation contract");
    }

    [Fact]
    public async Task UnconfiguredSigner_ChecksScopeFirst_ThenRefusesToFabricateAUrl()
    {
        var exerciseId = Guid.NewGuid();
        var signer = new UnconfiguredMediaUrlSigner(new ExerciseContext { CurrentExerciseId = exerciseId });

        (await signer.GetReadUrlsAsync([], CancellationToken.None)).Should().BeEmpty();
        var inScope = () => signer.GetReadUrlAsync(NewAsset(exerciseId, Guid.NewGuid(), "png"), CancellationToken.None);
        var foreign = () => signer.GetReadUrlAsync(NewAsset(Guid.NewGuid(), Guid.NewGuid(), "png"), CancellationToken.None);

        await inScope.Should().ThrowAsync<MediaStoreUnavailableException>();
        await foreign.Should().ThrowAsync<ExerciseScopeViolationException>();
    }

    [Theory]
    [InlineData("2026-10-10T15:00:00Z", "2026-10-11T04:00:00Z")]
    [InlineData("2026-10-10T15:59:59.9999999Z", "2026-10-11T04:00:00Z")]
    [InlineData("2026-10-10T16:00:00Z", "2026-10-11T05:00:00Z")]
    [InlineData("2026-10-10T23:30:00+09:00", "2026-10-11T03:00:00Z")]
    public void SasExpiry_IsBucketStartPlusThirteenHours(string now, string expected) =>
        MediaSasExpiry.ExpiresOn(DateTimeOffset.Parse(now, System.Globalization.CultureInfo.InvariantCulture), new MediaSasOptions())
            .Should().Be(DateTimeOffset.Parse(expected, System.Globalization.CultureInfo.InvariantCulture));

    private static MediaAsset NewAsset(Guid exerciseId, Guid id, string extension) => new()
    {
        Id = id,
        ExerciseId = exerciseId,
        Kind = extension is "mp4" or "webm" ? MediaKinds.Video : MediaKinds.Image,
        ContentType = extension switch
        {
            "png" => "image/png",
            "jpg" => "image/jpeg",
            "mp4" => "video/mp4",
            "webm" => "video/webm",
            _ => "image/gif",
        },
        BlobName = MediaBlobNames.Build(exerciseId, id, extension),
        Bytes = 10,
        OriginalFileName = $"f.{extension}",
        UploadedByHumanId = "human",
    };

    private sealed class SignerHarness
    {
        public SignerHarness(DateTimeOffset? now = null, bool scopeResolved = true, TimeSpan? keyLifetimeOverride = null)
        {
            ExerciseId = Guid.NewGuid();
            Time = new ManualTimeProvider(now ?? Now);
            Keys = new FakeKeySource(keyLifetimeOverride);
            Signer = new BlobMediaUrlSigner(
                new ExerciseContext { CurrentExerciseId = scopeResolved ? ExerciseId : null },
                new UserDelegationKeyCache(Keys, Time),
                Options.Create(new MediaStorageOptions { Provider = "Azure", ServiceUri = FakeBlobService.ServiceUri }),
                Options.Create(new MediaSasOptions()),
                Time);
        }

        public Guid ExerciseId { get; }

        public ManualTimeProvider Time { get; }

        public FakeKeySource Keys { get; }

        public BlobMediaUrlSigner Signer { get; }

        public MediaAsset Asset(string extension, Guid? exerciseId = null) =>
            NewAsset(exerciseId ?? ExerciseId, Guid.NewGuid(), extension);
    }

    private sealed class FakeKeySource : IUserDelegationKeySource
    {
        private readonly TimeSpan? _lifetimeOverride;

        public FakeKeySource(TimeSpan? lifetimeOverride) => _lifetimeOverride = lifetimeOverride;

        public string AccountName => FakeBlobService.AccountName;

        public int Calls => Requested.Count;

        public List<(DateTimeOffset StartsOn, DateTimeOffset ExpiresOn)> Requested { get; } = [];

        public Task<UserDelegationKey> GetUserDelegationKeyAsync(DateTimeOffset startsOn, DateTimeOffset expiresOn, CancellationToken cancellationToken)
        {
            Requested.Add((startsOn, expiresOn));
            var issuedExpiry = _lifetimeOverride is { } lifetime ? startsOn + lifetime : expiresOn;
            return Task.FromResult(BlobsModelFactory.UserDelegationKey(
                FakeBlobService.SignedObjectId,
                FakeBlobService.SignedTenantId,
                startsOn,
                issuedExpiry,
                "b",
                "2025-01-05",
                Convert.ToBase64String(Enumerable.Range(1, 32).Select(i => (byte)i).ToArray())));
        }
    }
}
