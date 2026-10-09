namespace Pulse.WebApi.Tests.Features.Social.Threads;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.Social.Follows;
using Pulse.WebApi.Tests.Helpers;

/// <summary>Seed helpers shared by the B2 thread suites. Fresh ids per test; no table truncation.</summary>
internal static class ThreadSeed
{
    /// <summary>A fixed scenario anchor. Tests offset from it so ordering is by scenario time only.</summary>
    public static readonly DateTimeOffset Anchor = new(2033, 9, 4, 14, 0, 0, TimeSpan.FromHours(-5));

    /// <summary>Builds a post row. Provenance is set to distinctive values so a leak would be visible.</summary>
    public static Post NewPost(
        Guid exerciseId,
        string body,
        DateTimeOffset scenarioTime,
        Guid? parentPostId = null,
        Guid? authorPersonaId = null,
        Guid? id = null,
        DateTimeOffset? deletedAt = null,
        DateTimeOffset? wallClock = null) => new()
        {
            Id = id ?? Guid.NewGuid(),
            ExerciseId = exerciseId,
            AuthorPersonaId = authorPersonaId ?? Guid.NewGuid(),
            Body = body,
            CreatedScenarioTime = scenarioTime,
            Origin = "inject",
            ActingHumanId = "human-thread-should-never-appear",
            CreatedWallClock = wallClock ?? new DateTimeOffset(2033, 9, 4, 13, 15, 0, TimeSpan.Zero),
            InjectId = "inject-thread-should-never-appear",
            ParentPostId = parentPostId,
            DeletedAt = deletedAt,
        };
}

/// <summary>
/// A test <see cref="IParticipantPostProjector"/> standing in for BP's real one, which lands in parallel. It
/// records every call and returns values that the default <see cref="ParticipantPostDto.FromPost"/> never would
/// (non-zero counts, media, <c>inReplyTo</c>, <c>viewer</c>), so a test can prove the thread read passes the
/// projector's output through unchanged.
/// </summary>
internal sealed class RecordingPostProjector : IParticipantPostProjector
{
    /// <summary>The counts every projected post carries.</summary>
    public static readonly ParticipantPostCounts ProjectedCounts = new(Reply: 41, Repost: 42, Like: 43);

    /// <summary>The handle the fake puts on every <c>inReplyTo</c>.</summary>
    public const string ParentHandle = "fake_parent_handle";

    /// <summary>Every call: the post ids in input order and the options passed.</summary>
    public List<(IReadOnlyList<Guid> PostIds, PostProjectionOptions Options)> Calls { get; } = new();

    /// <summary>When set, the projector breaks its same-count contract by dropping the last post.</summary>
    public bool DropLast { get; init; }

    /// <summary>When set, the projector breaks its same-order contract by reversing its output.</summary>
    public bool Reverse { get; init; }

    /// <inheritdoc />
    public Task<IReadOnlyList<ParticipantPostDto>> ProjectAsync(
        IReadOnlyCollection<Post> posts, PostProjectionOptions options, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(posts);
        ArgumentNullException.ThrowIfNull(options);

        Calls.Add((posts.Select(post => post.Id).ToList(), options));

        IEnumerable<ParticipantPostDto> projected = posts.Select(post => new ParticipantPostDto
        {
            Id = post.Id.ToString(),
            AuthorPersonaId = post.AuthorPersonaId.ToString(),
            Text = post.Body,
            ScenarioTime = post.CreatedScenarioTime.ToString("O"),
            Counts = ProjectedCounts,
            Media = new[] { new PostMediaDto($"media-{post.Id:N}", "image", $"https://media.example/{post.Id:N}", "alt text") },
            InReplyTo = post.ParentPostId is { } parentId ? new PostInReplyToDto(parentId.ToString(), ParentHandle) : null,
            Viewer = options.IncludeViewerState && options.ViewerPersonaId is not null ? new PostViewerStateDto(true, false) : null,
        });

        if (Reverse)
        {
            projected = projected.Reverse();
        }

        var list = projected.ToList();
        if (DropLast && list.Count > 0)
        {
            list.RemoveAt(list.Count - 1);
        }

        return Task.FromResult<IReadOnlyList<ParticipantPostDto>>(list);
    }
}

/// <summary>A fixed <see cref="ICurrentSessionPersonaAccessor"/>: returns the persona it was given, or none.</summary>
internal sealed class StubSessionPersonaAccessor : ICurrentSessionPersonaAccessor
{
    private readonly CurrentSessionPersona? _persona;

    public StubSessionPersonaAccessor(CurrentSessionPersona? persona = null) => _persona = persona;

    /// <summary>A live session of <paramref name="kind"/> bound to <paramref name="personaId"/> in <paramref name="exerciseId"/>.</summary>
    public static StubSessionPersonaAccessor For(Guid exerciseId, Guid personaId, string kind = "participant") => new(
        new CurrentSessionPersona
        {
            SessionId = Guid.NewGuid(),
            PersonaId = personaId,
            Kind = kind,
            ExerciseId = exerciseId,
            ActingHumanId = $"human-{Guid.NewGuid():N}",
        });

    /// <inheritdoc />
    public Task<CurrentSessionPersona?> GetCurrentSessionPersonaAsync(CancellationToken cancellationToken = default)
        => Task.FromResult(_persona);
}

/// <summary>
/// Boots the real <c>Program</c> host (so <c>Program.cs</c>'s <c>AddSocialThreads()</c> and
/// <c>MapSocialThreadEndpoints()</c> are what serve the route) against the shared migrated database, with the
/// request's exercise scope faked through DI and a matching live-session principal, exactly as
/// <c>SocialApiWebApplicationFactory</c> does. It can also swap in a test projector and session-persona accessor.
/// </summary>
internal sealed class ThreadApiWebApplicationFactory : WebApplicationFactory<Program>
{
    private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

    private readonly Guid? _exerciseId;
    private readonly IParticipantPostProjector? _projector;
    private readonly ICurrentSessionPersonaAccessor? _sessionPersonaAccessor;

    public ThreadApiWebApplicationFactory(
        string connectionString,
        Guid? exerciseId,
        IParticipantPostProjector? projector = null,
        ICurrentSessionPersonaAccessor? sessionPersonaAccessor = null)
    {
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);
        _exerciseId = exerciseId;
        _projector = projector;
        _sessionPersonaAccessor = sessionPersonaAccessor;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.UseFakeAuthenticatedSession(_exerciseId);

        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IExerciseContext>();
            services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = _exerciseId });

            if (_projector is not null)
            {
                services.RemoveAll<IParticipantPostProjector>();
                services.AddSingleton(_projector);
            }

            if (_sessionPersonaAccessor is not null)
            {
                services.RemoveAll<ICurrentSessionPersonaAccessor>();
                services.AddSingleton(_sessionPersonaAccessor);
            }
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
    }
}
