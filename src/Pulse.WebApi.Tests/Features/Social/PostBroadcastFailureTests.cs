namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Linq;
using System.Net;
using System.Net.Http.Headers;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using static Pulse.WebApi.Tests.Features.Social.PostMediaSeed;

/// <summary>
/// Wave 3 Gate-2 L-1: <c>POST /api/posts</c> on the real <c>Program</c> host with a feed broadcaster that throws.
/// The broadcast runs after the post has committed, so its failure is logged and the caller still gets its 201
/// for the one row written, exactly as B6's takedown treats its <c>PostRemoved</c> push. A 500 here would invite a
/// retry that duplicates the post.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PostBroadcastFailureTests
{
    private readonly MsSqlContainerFixture _fixture;

    public PostBroadcastFailureTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task AThrowingBroadcaster_StillAnswers201_WithExactlyOneRow_AndLogsAWarning()
    {
        var world = await SeedWorldAsync(_fixture);
        await using var factory = new PostMediaWebApplicationFactory(_fixture.ConnectionString!);
        await using var throwing = factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IFeedBroadcaster>();
            services.AddSingleton<IFeedBroadcaster, ThrowingFeedBroadcaster>();
        }));

        using var client = throwing.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri($"http://{world.Host}") });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", world.ParticipantToken);

        using var response = await client.PostAsync(PostsUri, Json(Body(text: "Water over Main St again")));

        response.StatusCode.Should().Be(HttpStatusCode.Created, "the post committed before the broadcast failed");
        var (posts, _, events) = await CountRowsAsync(_fixture, world.Exercise);
        posts.Should().Be(1, "exactly one row: the failed push neither rolls the post back nor writes it twice");
        events.Should().Be(1, "the post's single XC-004 event committed with it");
        factory.Logs.Entries.Should().Contain(
            entry => entry.Category == typeof(PostIngestService).FullName
                && entry.Level == LogLevel.Warning
                && entry.EventId.Id == 5
                && entry.Exception is InvalidOperationException,
            "the swallowed broadcast fault is logged, never silent");
    }

    private sealed class ThrowingFeedBroadcaster : IFeedBroadcaster
    {
        public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("hub connection lost");
    }
}
