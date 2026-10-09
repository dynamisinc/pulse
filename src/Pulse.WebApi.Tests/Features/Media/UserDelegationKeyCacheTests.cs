namespace Pulse.WebApi.Tests.Features.Media;

using System;
using System.Diagnostics;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Azure;
using Azure.Core.Pipeline;
using Azure.Identity;
using Azure.Storage.Blobs.Models;
using FluentAssertions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Xunit;

/// <summary>
/// Wave 1b Gate-2 M-1: a storage-auth outage fails FAST instead of queuing every media read behind a slow key fetch.
/// The user-delegation-key cache bounds each fetch, remembers a failure for <see cref="UserDelegationKeyCache.FailureBackoff"/>
/// (negative cache) and retries after it. The media Blob clients retry once with a bounded network timeout. Outside
/// Development the credential is the system-assigned managed identity, not <c>DefaultAzureCredential</c>'s chain.
/// Model-only: no Docker, no database.
/// </summary>
public sealed class UserDelegationKeyCacheTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 10, 15, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset SasExpiry = Now.AddHours(13);

    [Fact]
    public void Bounds_AreFiveSecondsPerFetch_AndAThirtySecondBackOff()
    {
        UserDelegationKeyCache.DefaultFetchTimeout.Should().Be(TimeSpan.FromSeconds(5));
        UserDelegationKeyCache.FailureBackoff.Should().Be(TimeSpan.FromSeconds(30));
    }

    [Fact]
    public async Task AFailingKeySource_FailsTheFirstCallAfterOneAttempt_ThenFailsFastInsideTheWindow_ThenRetriesAfterIt()
    {
        var time = new ManualTimeProvider(Now);
        var failure = new RequestFailedException(403, "AuthorizationPermissionMismatch");
        var source = new ScriptedKeySource { Failure = failure };
        using var cache = new UserDelegationKeyCache(source, time);

        var first = () => cache.GetKeyAsync(SasExpiry, CancellationToken.None);
        (await first.Should().ThrowAsync<RequestFailedException>()).Which.Should().BeSameAs(failure, "the first caller sees the real cause");
        source.Calls.Should().Be(1, "one attempt, not a queue of them");

        time.Advance(UserDelegationKeyCache.FailureBackoff - TimeSpan.FromSeconds(1));
        for (var i = 0; i < 3; i++)
        {
            var insideWindow = () => cache.GetKeyAsync(SasExpiry, CancellationToken.None);
            (await insideWindow.Should().ThrowAsync<MediaStoreUnavailableException>(
                "inside the back-off window every call fails fast")).Which.InnerException.Should().BeSameAs(failure);
        }

        source.Calls.Should().Be(1, "a fail-fast call never reaches the key source");

        time.Advance(TimeSpan.FromSeconds(1));
        source.Failure = null;
        (await cache.GetKeyAsync(SasExpiry, CancellationToken.None)).SignedExpiresOn.Should().BeOnOrAfter(SasExpiry);
        source.Calls.Should().Be(2, "the first call after the window retries");

        (await cache.GetKeyAsync(SasExpiry, CancellationToken.None)).Should().NotBeNull();
        source.Calls.Should().Be(2, "a success closes the window and the key is cached again");
    }

    [Fact]
    public async Task CallersQueuedBehindAFailingFetch_FailFast_InsteadOfEachFetchingAgain()
    {
        var time = new ManualTimeProvider(Now);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var source = new ScriptedKeySource { Failure = new RequestFailedException(503, "ServerBusy"), Gate = release.Task };
        using var cache = new UserDelegationKeyCache(source, time, TimeSpan.FromSeconds(30));

        var callers = Enumerable.Range(0, 8).Select(_ => cache.GetKeyAsync(SasExpiry, CancellationToken.None)).ToArray();
        await source.Entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
        release.SetResult();

        foreach (var caller in callers)
        {
            var awaited = () => caller;
            await awaited.Should().ThrowAsync<Exception>();
        }

        source.Calls.Should().Be(1, "eight concurrent readers during an outage cost ONE key request, not eight in series");
    }

    [Fact]
    public async Task AHungKeySource_IsCancelledAtTheFetchBound_AsAStorageFailure_NotTheCallersCancellation()
    {
        var time = new ManualTimeProvider(Now);
        var source = new ScriptedKeySource { Hang = true };
        using var cache = new UserDelegationKeyCache(source, time, TimeSpan.FromMilliseconds(200));
        var stopwatch = Stopwatch.StartNew();

        var hung = () => cache.GetKeyAsync(SasExpiry, CancellationToken.None);

        (await hung.Should().ThrowAsync<MediaStoreUnavailableException>(
            "a consumer degrades on a storage failure but would let a cancellation escape and fail the read"))
            .Which.InnerException.Should().BeAssignableTo<OperationCanceledException>();
        stopwatch.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(5), "the bound, not the SDK's 100 s default, ends the wait");
        source.ObservedCancellation.Should().BeTrue("the key request itself is cancelled, not abandoned");

        var next = () => cache.GetKeyAsync(SasExpiry, CancellationToken.None);
        await next.Should().ThrowAsync<MediaStoreUnavailableException>("a timeout opens the back-off window too");
        source.Calls.Should().Be(1);
    }

    [Fact]
    public async Task TheCallersOwnCancellation_Propagates_AndOpensNoWindow()
    {
        var time = new ManualTimeProvider(Now);
        var source = new ScriptedKeySource { Hang = true };
        using var cache = new UserDelegationKeyCache(source, time, TimeSpan.FromSeconds(30));
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));

        var cancelled = () => cache.GetKeyAsync(SasExpiry, cts.Token);

        await cancelled.Should().ThrowAsync<OperationCanceledException>("the caller asked for it");
        source.Hang = false;
        (await cache.GetKeyAsync(SasExpiry, CancellationToken.None)).Should().NotBeNull(
            "a caller that gave up is not a storage failure, so the next call fetches");
        source.Calls.Should().Be(2);
    }

    [Fact]
    public async Task ACachedKeyThatStillCoversTheSas_IsServedEvenWhileARefreshIsBackingOff()
    {
        var time = new ManualTimeProvider(Now);
        var source = new ScriptedKeySource();
        using var cache = new UserDelegationKeyCache(source, time);
        var key = await cache.GetKeyAsync(SasExpiry, CancellationToken.None);

        source.Failure = new RequestFailedException(403, "AuthorizationPermissionMismatch");
        var refresh = () => cache.GetKeyAsync(key.SignedExpiresOn.AddHours(1), CancellationToken.None);
        await refresh.Should().ThrowAsync<RequestFailedException>("this SAS outlives the cached key, so a refresh is needed and fails");

        (await cache.GetKeyAsync(SasExpiry, CancellationToken.None)).Should().BeSameAs(
            key, "a failed refresh never takes away a key that still outlives the SAS");
        source.Calls.Should().Be(2);
    }

    [Fact]
    public void MediaClientOptions_RetryOnce_WithBoundedNetworkTimeouts()
    {
        MediaBlobServiceClientFactory.MaxRetries.Should().Be(1);
        MediaBlobServiceClientFactory.SigningNetworkTimeout.Should().Be(TimeSpan.FromSeconds(10));
        MediaBlobServiceClientFactory.UploadNetworkTimeout.Should().Be(TimeSpan.FromSeconds(30));

        var options = MediaBlobServiceClientFactory.CreateClientOptions(MediaBlobServiceClientFactory.SigningNetworkTimeout);
        options.Retry.MaxRetries.Should().Be(1, "the SDK default of 3 with back-off is what made readers queue");
        options.Retry.NetworkTimeout.Should().Be(TimeSpan.FromSeconds(10), "the SDK default is 100 s");
    }

    [Fact]
    public async Task AKeySourceOnTheProductionOptions_MakesExactlyTwoAttempts_AgainstAFailingService()
    {
        var handler = new AlwaysUnavailableHandler();
        var clientOptions = MediaBlobServiceClientFactory.CreateClientOptions(MediaBlobServiceClientFactory.SigningNetworkTimeout);
        clientOptions.Transport = new HttpClientTransport(new HttpClient(handler));
        var source = new BlobServiceUserDelegationKeySource(
            Options.Create(new MediaStorageOptions { Provider = "Azure", ServiceUri = FakeBlobService.ServiceUri }),
            new FakeTokenCredential(),
            clientOptions);

        var fetch = () => source.GetUserDelegationKeyAsync(Now.AddMinutes(-5), Now.AddHours(19), CancellationToken.None);

        await fetch.Should().ThrowAsync<RequestFailedException>();
        handler.Requests.Should().Be(2, "the first attempt plus exactly one retry");
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    public void OutsideDevelopment_TheCredentialIsTheSystemAssignedManagedIdentity(string environment) =>
        MediaEndpoints.CreateCredential(new MediaStoreTests.TestHostEnvironment(environment, AppContext.BaseDirectory))
            .Should().BeOfType<ManagedIdentityCredential>("webapp.bicep gives the App Service a SystemAssigned identity; no credential chain");

    [Fact]
    public void InDevelopment_TheCredentialIsDefaultAzureCredential() =>
        MediaEndpoints.CreateCredential(new MediaStoreTests.TestHostEnvironment(Environments.Development, AppContext.BaseDirectory))
            .Should().BeOfType<DefaultAzureCredential>("a developer signs in with their own identity");

    /// <summary>A key source that fails, hangs, or issues a key that outlives whatever was asked for.</summary>
    private sealed class ScriptedKeySource : IUserDelegationKeySource
    {
        private int _calls;

        public Exception? Failure { get; set; }

        public bool Hang { get; set; }

        /// <summary>When set, the fetch waits for it (after signalling <see cref="Entered"/>) before answering.</summary>
        public Task? Gate { get; init; }

        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public bool ObservedCancellation { get; private set; }

        public int Calls => Volatile.Read(ref _calls);

        public string AccountName => FakeBlobService.AccountName;

        public async Task<UserDelegationKey> GetUserDelegationKeyAsync(
            DateTimeOffset startsOn, DateTimeOffset expiresOn, CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref _calls);
            Entered.TrySetResult();

            if (Gate is { } gate)
            {
                await gate;
            }

            if (Hang)
            {
                try
                {
                    await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
                }
                catch (OperationCanceledException)
                {
                    ObservedCancellation = true;
                    throw;
                }
            }

            if (Failure is { } failure)
            {
                throw failure;
            }

            return BlobsModelFactory.UserDelegationKey(
                FakeBlobService.SignedObjectId,
                FakeBlobService.SignedTenantId,
                startsOn,
                expiresOn,
                "b",
                "2025-01-05",
                Convert.ToBase64String(Enumerable.Range(1, 32).Select(i => (byte)i).ToArray()));
        }
    }

    /// <summary>Answers every request 503 (a retriable status) and counts the requests.</summary>
    private sealed class AlwaysUnavailableHandler : HttpMessageHandler
    {
        private int _requests;

        public int Requests => Volatile.Read(ref _requests);

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref _requests);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable) { Content = new ByteArrayContent([]) });
        }
    }
}
