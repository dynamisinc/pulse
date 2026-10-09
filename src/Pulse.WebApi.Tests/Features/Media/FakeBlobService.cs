namespace Pulse.WebApi.Tests.Features.Media;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Azure.Core;
using Azure.Core.Pipeline;
using Azure.Storage.Blobs;
using Pulse.WebApi.Features.Media;

/// <summary>
/// An in-process stand-in for the Azure Blob service, plugged into the REAL Azure SDK through its HTTP transport —
/// so <see cref="AzureBlobMediaStore"/> and <see cref="BlobServiceUserDelegationKeySource"/> run their genuine SDK
/// calls with no network (Azure is unreachable from CI and from this sandbox). It records every request (method,
/// URI, the <c>Authorization</c> scheme, the relevant headers, the body length) and answers like the service:
/// Put Blob / Put Block / Put Block List → 201, Delete → 202 (or 404 BlobNotFound), Get User Delegation Key → 200 XML.
/// </summary>
internal sealed class FakeBlobService : HttpMessageHandler
{
    public const string AccountName = "stpulsetest";
    public const string ServiceUri = "https://stpulsetest.blob.core.windows.net";
    public const string SignedObjectId = "11111111-2222-3333-4444-555555555555";
    public const string SignedTenantId = "66666666-7777-8888-9999-000000000000";

    private readonly ConcurrentDictionary<string, byte[]> _committed = new(StringComparer.Ordinal);

    public ConcurrentQueue<RecordedRequest> Requests { get; } = new();

    public IReadOnlyDictionary<string, byte[]> Committed => _committed;

    /// <summary>Client options routing the SDK through this fake (no retries, so failures surface at once).</summary>
    public BlobClientOptions ClientOptions() => new()
    {
        Transport = new HttpClientTransport(new HttpClient(this)),
        Retry = { MaxRetries = 0 },
    };

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content is null ? [] : await request.Content.ReadAsByteArrayAsync(cancellationToken);
        var query = request.RequestUri!.Query;
        var path = Uri.UnescapeDataString(request.RequestUri.AbsolutePath);

        Requests.Enqueue(new RecordedRequest(
            request.Method.Method,
            request.RequestUri,
            request.Headers.Authorization?.Scheme,
            Header(request, "x-ms-blob-content-type"),
            Header(request, "If-None-Match"),
            body.Length));

        if (request.Method == HttpMethod.Post && query.Contains("comp=userdelegationkey", StringComparison.Ordinal))
        {
            return UserDelegationKeyResponse(System.Text.Encoding.UTF8.GetString(body));
        }

        if (request.Method == HttpMethod.Put && query.Contains("comp=block&", StringComparison.Ordinal)
            || request.Method == HttpMethod.Put && query.EndsWith("comp=block", StringComparison.Ordinal))
        {
            return Created();
        }

        if (request.Method == HttpMethod.Put && query.Contains("comp=blocklist", StringComparison.Ordinal))
        {
            _committed[path] = [];
            return Created();
        }

        if (request.Method == HttpMethod.Put)
        {
            _committed[path] = body;
            return Created();
        }

        if (request.Method == HttpMethod.Delete)
        {
            if (_committed.TryRemove(path, out _))
            {
                return new HttpResponseMessage(HttpStatusCode.Accepted);
            }

            var notFound = new HttpResponseMessage(HttpStatusCode.NotFound);
            notFound.Headers.Add("x-ms-error-code", "BlobNotFound");
            return notFound;
        }

        return new HttpResponseMessage(HttpStatusCode.BadRequest);
    }

    private static string? Header(HttpRequestMessage request, string name) =>
        request.Headers.TryGetValues(name, out var values) ? values.FirstOrDefault() : null;

    private static HttpResponseMessage Created()
    {
        var response = new HttpResponseMessage(HttpStatusCode.Created) { Content = new ByteArrayContent([]) };
        response.Headers.ETag = new System.Net.Http.Headers.EntityTagHeaderValue("\"0x8DCFAKEETAG\"");
        response.Content.Headers.LastModified = DateTimeOffset.UtcNow;
        return response;
    }

    /// <summary>Echoes the requested window back as the issued key (as the service does).</summary>
    private static HttpResponseMessage UserDelegationKeyResponse(string requestXml)
    {
        static string Between(string xml, string tag)
        {
            var start = xml.IndexOf($"<{tag}>", StringComparison.Ordinal) + tag.Length + 2;
            var end = xml.IndexOf($"</{tag}>", StringComparison.Ordinal);
            return xml[start..end];
        }

        var startsOn = Between(requestXml, "Start");
        var expiresOn = Between(requestXml, "Expiry");
        var key = Convert.ToBase64String(Enumerable.Range(1, 32).Select(i => (byte)i).ToArray());
        var xml =
            "<?xml version=\"1.0\" encoding=\"utf-8\"?><UserDelegationKey>"
            + $"<SignedOid>{SignedObjectId}</SignedOid><SignedTid>{SignedTenantId}</SignedTid>"
            + $"<SignedStart>{startsOn}</SignedStart><SignedExpiry>{expiresOn}</SignedExpiry>"
            + "<SignedService>b</SignedService><SignedVersion>2025-01-05</SignedVersion>"
            + $"<Value>{key}</Value></UserDelegationKey>";

        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(xml, System.Text.Encoding.UTF8, "application/xml"),
        };
    }

    /// <summary>One request the SDK sent.</summary>
    internal sealed record RecordedRequest(
        string Method, Uri Uri, string? AuthorizationScheme, string? BlobContentType, string? IfNoneMatch, int BodyLength);
}

/// <summary>A token credential that hands out a fixed bearer token — the managed identity's stand-in.</summary>
internal sealed class FakeTokenCredential : TokenCredential
{
    public int Requests { get; private set; }

    public override AccessToken GetToken(TokenRequestContext requestContext, CancellationToken cancellationToken)
    {
        Requests++;
        return new AccessToken("fake-managed-identity-token", DateTimeOffset.UtcNow.AddHours(1));
    }

    public override ValueTask<AccessToken> GetTokenAsync(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
        ValueTask.FromResult(GetToken(requestContext, cancellationToken));
}

/// <summary>Helpers for asserting on a minted SAS URL.</summary>
internal static class SasUrl
{
    public static Dictionary<string, string> Query(string url)
    {
        var uri = new Uri(url);
        return Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(uri.Query)
            .ToDictionary(pair => pair.Key, pair => pair.Value.ToString(), StringComparer.Ordinal);
    }

    public static DateTimeOffset Time(string value) =>
        DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);
}
