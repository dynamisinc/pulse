namespace Pulse.WebApi.Tests.Features.Injects;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Features.Injects;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// NFR-009 on the routes that publish (Copilot High on #458): <c>fire</c>, <c>retry</c> and <c>release</c> share a
/// per-staff-user token bucket (<see cref="InjectFireRateLimiterPolicy"/>). Over HTTP on real SQL: one staff user over
/// the limit gets a readable 429 ProblemDetails; another staff user is unaffected; reads and hold are never limited.
/// The bucket is spent with CONCURRENT requests on unknown item ids — every request reaches the limiter within
/// milliseconds, so a one-per-second refill cannot blur the count, and no post is created.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class InjectFireRateLimitTests
{
    // Comfortably more than the bucket plus any refill during the burst of requests.
    private const int OverTheLimit = InjectFireRateLimiterPolicy.TokenLimit + 15;

    private readonly MsSqlContainerFixture _fixture;

    public InjectFireRateLimitTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task OneStaffUser_FiringPastTheBucket_Gets429ProblemDetails_WithARetryAfter()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);

        var responses = await SpendAsync(host, "fire");

        var limited = responses.Where(r => r.StatusCode == HttpStatusCode.TooManyRequests).ToList();
        responses.Count(r => r.StatusCode != HttpStatusCode.TooManyRequests).Should().BeInRange(
            InjectFireRateLimiterPolicy.TokenLimit,
            InjectFireRateLimiterPolicy.TokenLimit + 2,
            "the bucket admits {0} presses back to back (plus at most a refill tick)", InjectFireRateLimiterPolicy.TokenLimit);
        limited.Should().NotBeEmpty("one staff user past the bucket is refused");

        var refusal = limited[0];
        refusal.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
        var problem = await InjectTestHost.ReadProblemAsync(refusal);
        problem.Status.Should().Be(429);
        problem.Detail.Should().Be(InjectFireRateLimiterPolicy.RateLimitedMessage, "the console shows detail as it does for every refusal");
        refusal.Headers.RetryAfter.Should().NotBeNull("the client is told when to try again");
    }

    [RequiresDockerFact]
    public async Task RetryAndRelease_DrawOnTheSameBucketAsFire()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);

        await SpendAsync(host, "fire");

        (await host.ActionAsync(Guid.NewGuid(), "retry")).StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        (await host.ActionAsync(Guid.NewGuid(), "release")).StatusCode.Should().Be(
            HttpStatusCode.TooManyRequests, "a release can restart a held burst, so it counts");
    }

    [RequiresDockerFact]
    public async Task ADifferentStaffUser_IsUnaffected_ByAnotherUsersSpentBucket()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        var colleague = await host.AddStaffAsync(seeded.ExerciseId, "controller", "Dana Controller");
        host.ActAs(seeded.ExerciseId, colleague);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));

        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        (await SpendAsync(host, "fire")).Should().Contain(r => r.StatusCode == HttpStatusCode.TooManyRequests);

        host.ActAs(seeded.ExerciseId, colleague);
        (await host.ActionOkAsync(item.Guid, "fire")).Status.Should().Be(
            "fired", "the bucket is per staff user — one controller's runaway client never blocks another's Fire");
    }

    [RequiresDockerFact]
    public async Task ReadsAndHold_AreNeverLimited_EvenWithTheBucketSpent()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));

        (await SpendAsync(host, "fire")).Should().Contain(r => r.StatusCode == HttpStatusCode.TooManyRequests);

        // More requests than the bucket holds: were any of these routes under the policy, most would be 429s.
        var reads = await Task.WhenAll(Enumerable.Range(0, OverTheLimit)
            .Select(_ => host.Client.GetAsync(new Uri("/api/injects", UriKind.Relative))));
        var holds = await Task.WhenAll(Enumerable.Range(0, OverTheLimit).Select(_ => host.ActionAsync(item.Guid, "hold")));

        reads.Should().OnlyContain(r => r.StatusCode == HttpStatusCode.OK, "the queue read is not rate-limited");
        holds.Should().NotContain(r => r.StatusCode == HttpStatusCode.TooManyRequests, "hold publishes nothing and is never limited");
        holds.Count(r => r.StatusCode == HttpStatusCode.OK).Should().Be(1, "one hold lands; the rest are the ordinary 409");
    }

    // ---- helpers ----

    private async Task<InjectTestHost> StartAsync()
    {
        _fixture.ConnectionString.Should().NotBeNull();
        return await InjectTestHost.StartAsync(_fixture.ConnectionString!);
    }

    /// <summary>Sends more concurrent <paramref name="action"/> presses (on unknown ids) than the bucket holds.</summary>
    private static async Task<HttpResponseMessage[]> SpendAsync(InjectTestHost host, string action) =>
        await Task.WhenAll(Enumerable.Range(0, OverTheLimit).Select(_ => host.ActionAsync(Guid.NewGuid(), action)));
}
