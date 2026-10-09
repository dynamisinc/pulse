namespace Pulse.WebApi.Tests.Features.Social.Threads;

using System;
using System.Net;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// The pre-B2 composition contract for <c>GET /api/threads/{postId}</c>: a host that wires only
/// <c>AddSocialFeedRead()</c> and <c>MapSocialThreadEndpoints()</c> (as <c>ExerciseLifecycleTestHost</c> does) must
/// still build and serve the thread. Without this, a missing <c>AddSocialThreads()</c> makes minimal APIs infer the
/// thread service as the request body and the whole host refuses to start.
/// </summary>
[Collection(MsSqlCollection.Name)]
public class ThreadEndpointCompositionTests
{
    private readonly MsSqlContainerFixture _fixture;

    public ThreadEndpointCompositionTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task HostWiringOnlyAddSocialFeedRead_StillServesTheRealThread()
    {
        var exercise = Guid.NewGuid();
        var focused = ThreadSeed.NewPost(exercise, "focused", ThreadSeed.Anchor);
        var reply = ThreadSeed.NewPost(exercise, "reply", ThreadSeed.Anchor.AddMinutes(1), focused.Id);
        await using (var seed = _fixture.CreateContext())
        {
            seed.Posts.AddRange(focused, reply);
            await seed.SaveChangesAsync();
        }

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Configuration["ConnectionStrings:DefaultConnection"] = _fixture.ConnectionString;
        builder.Services.AddPulsePersistence(builder.Configuration);
        builder.Services.AddExerciseScoping();
        builder.Services.AddExerciseClock();
        builder.Services.AddSocialFeedRead();
        builder.Services.RemoveAll<IExerciseContext>();
        builder.Services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = exercise });

        await using var app = builder.Build();
        app.MapSocialThreadEndpoints();
        await app.StartAsync();

        using var client = app.GetTestClient();
        using var response = await client.GetAsync(new Uri($"/api/threads/{focused.Id}", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
        json["focused"]!["id"]!.GetValue<string>().Should().Be(focused.Id.ToString());
        json["replies"]![0]!["id"]!.GetValue<string>().Should().Be(reply.Id.ToString());
        json["replies"]![0]!["status"]!.GetValue<string>().Should().Be("visible");

        await app.StopAsync();
    }
}
