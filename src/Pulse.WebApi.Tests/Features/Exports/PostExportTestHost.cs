namespace Pulse.WebApi.Tests.Features.Exports;

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading.Tasks;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.Exports;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// A minimal host wired the way the orchestrator will wire story 02 into <c>Program.cs</c> (seam S-2): this story's
/// own <see cref="PostExportEndpoints.AddPostExport"/> / <see cref="PostExportEndpoints.MapPostExport"/>, over the
/// shared migrated real SQL Server, with the REAL staff-session accessor reading real bearer tokens against real
/// <see cref="Session"/> rows, so the gate is exercised with participant, read-only and staff sessions exactly as the
/// filter sees them. The one thing fixed per host is the server-resolved exercise scope (the job host resolution and
/// session middleware do in production), which is how the not-yet-wired slices in this suite are tested (see
/// <c>ChromeTestHost</c>).
/// </summary>
public sealed class PostExportTestHost : IAsyncDisposable
{
    private readonly WebApplication _app;

    private PostExportTestHost(WebApplication app) => _app = app;

    /// <summary>Starts a host whose resolved scope is <paramref name="currentExerciseId"/> (<c>null</c> = unresolved).</summary>
    /// <param name="connectionString">The migrated test database.</param>
    /// <param name="currentExerciseId">The server-resolved scope.</param>
    /// <returns>The started host.</returns>
    public static async Task<PostExportTestHost> StartAsync(string connectionString, Guid? currentExerciseId)
    {
        ArgumentNullException.ThrowIfNull(connectionString);

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Configuration["ConnectionStrings:DefaultConnection"] = connectionString;

        builder.Services.AddPulsePersistence(builder.Configuration);
        builder.Services.AddExerciseScoping();

        // B2's staff identity, as AddStaffIdentity()/AddSessions() register it: the real token-reading accessor.
        builder.Services.AddHttpContextAccessor();
        builder.Services.AddScoped<StaffAssignmentService>();
        builder.Services.RemoveAll<ICurrentStaffSessionAccessor>();
        builder.Services.AddScoped<ICurrentStaffSessionAccessor, CurrentStaffSessionAccessor>();

        builder.Services.AddPostExport();

        builder.Services.RemoveAll<IExerciseContext>();
        builder.Services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = currentExerciseId });

        var app = builder.Build();
        app.MapPostExport();
        await app.StartAsync();
        return new PostExportTestHost(app);
    }

    /// <summary>Calls the export route presenting <paramref name="bearerToken"/> (or none).</summary>
    /// <param name="bearerToken">The raw session token, or <c>null</c> for an anonymous call.</param>
    /// <returns>The response.</returns>
    public async Task<HttpResponseMessage> GetExportAsync(string? bearerToken)
    {
        using var client = _app.GetTestClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, PostExportEndpoints.ExportRoute);
        if (bearerToken is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        }

        return await client.SendAsync(request);
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync() => await _app.DisposeAsync();
}

/// <summary>Seeds the rows the export suites need, with fresh ids per test (no truncation).</summary>
public sealed class PostExportSeed
{
    /// <summary>The scenario instant the first seeded post carries; later posts add minutes.</summary>
    public static readonly DateTimeOffset ScenarioStart = new(2033, 9, 4, 13, 0, 0, TimeSpan.Zero);

    /// <summary>The wall clock the first seeded post carries.</summary>
    public static readonly DateTimeOffset WallStart = new(2026, 10, 14, 18, 30, 15, TimeSpan.Zero);

    private readonly MsSqlContainerFixture _fixture;

    /// <summary>Creates the seeder.</summary>
    /// <param name="fixture">The migrated-database fixture.</param>
    public PostExportSeed(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>The fixture's connection string.</summary>
    public string ConnectionString => _fixture.ConnectionString
        ?? throw new InvalidOperationException("The MsSql fixture has no connection string.");

    /// <summary>Seeds an exercise in the default tenant.</summary>
    /// <param name="name">The display name (drives the file-name slug).</param>
    /// <param name="timeZone">The IANA zone.</param>
    /// <returns>The exercise id.</returns>
    public async Task<Guid> ExerciseAsync(string name = "Kestrel Flood 2033", string timeZone = "UTC")
    {
        var id = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            Id = id,
            OrganizationId = Organization.DefaultOrganizationId,
            Name = name,
            Hostname = $"export-{id:N}.example.com",
            TimeZone = timeZone,
            Status = "live",
        });
        await seed.SaveChangesAsync();
        return id;
    }

    /// <summary>Seeds a persona.</summary>
    /// <param name="exerciseId">The owning exercise.</param>
    /// <param name="handle">The handle (unique per exercise).</param>
    /// <param name="displayName">The display name.</param>
    /// <returns>The persona id.</returns>
    public async Task<Guid> PersonaAsync(Guid exerciseId, string handle, string displayName)
    {
        var id = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Personas.Add(new Persona { Id = id, ExerciseId = exerciseId, Handle = handle, DisplayName = displayName, Kind = "human" });
        await seed.SaveChangesAsync();
        return id;
    }

    /// <summary>Seeds a post and returns its id.</summary>
    /// <param name="exerciseId">The owning exercise.</param>
    /// <param name="authorPersonaId">The author.</param>
    /// <param name="minute">Scenario minutes after <see cref="ScenarioStart"/>.</param>
    /// <param name="configure">Optional tweaks to the row.</param>
    /// <returns>The post id.</returns>
    public async Task<Guid> PostAsync(Guid exerciseId, Guid authorPersonaId, int minute, Action<Post>? configure = null)
    {
        var post = new Post
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            AuthorPersonaId = authorPersonaId,
            Body = $"Export body {Guid.NewGuid():N}",
            CreatedScenarioTime = ScenarioStart.AddMinutes(minute),
            CreatedWallClock = WallStart.AddMinutes(minute),
            Origin = "controller-as-persona",
            ActingHumanId = string.Empty,
        };
        configure?.Invoke(post);

        await using var seed = _fixture.CreateContext();
        seed.Posts.Add(post);
        await seed.SaveChangesAsync();
        return post.Id;
    }

    /// <summary>Seeds an active reaction.</summary>
    /// <param name="exerciseId">The owning exercise.</param>
    /// <param name="postId">The post.</param>
    /// <param name="kind">The reaction kind (any string: <c>pin</c> needs no schema change, DF-6).</param>
    /// <param name="deleted">Whether the reaction is an un-liked history row.</param>
    /// <returns>A task.</returns>
    public async Task ReactionAsync(Guid exerciseId, Guid postId, string kind, bool deleted = false)
    {
        await using var seed = _fixture.CreateContext();
        seed.PostReactions.Add(new PostReaction
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            PostId = postId,
            PersonaId = Guid.NewGuid(),
            Kind = kind,
            CreatedScenarioTime = ScenarioStart,
            DeletedAt = deleted ? ScenarioStart.AddMinutes(1) : null,
        });
        await seed.SaveChangesAsync();
    }

    /// <summary>Attaches a media asset of <paramref name="kind"/> to a post.</summary>
    /// <param name="exerciseId">The owning exercise.</param>
    /// <param name="postId">The post.</param>
    /// <param name="kind">The media kind.</param>
    /// <param name="order">The slot.</param>
    /// <returns>A task.</returns>
    public async Task MediaAsync(Guid exerciseId, Guid postId, string kind, int order)
    {
        var assetId = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.MediaAssets.Add(new MediaAsset
        {
            Id = assetId,
            ExerciseId = exerciseId,
            Kind = kind,
            ContentType = kind == MediaKinds.Video ? "video/mp4" : "image/jpeg",
            BlobName = $"{exerciseId:D}/{assetId:N}",
            Bytes = 4096,
            OriginalFileName = "file",
            UploadedByHumanId = "export-test",
            CreatedScenarioTime = ScenarioStart,
            CreatedWallClock = WallStart,
        });
        seed.PostMediaItems.Add(new PostMediaItem
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            PostId = postId,
            MediaAssetId = assetId,
            Alt = "alt",
            Order = order,
        });
        await seed.SaveChangesAsync();
    }

    /// <summary>Seeds an inject item.</summary>
    /// <param name="exerciseId">The owning exercise.</param>
    /// <param name="title">The item title.</param>
    /// <param name="externalRef">The MSEL Inject # (DF-10), or <c>null</c> for a console-authored item.</param>
    /// <returns>The item id.</returns>
    public async Task<Guid> InjectItemAsync(Guid exerciseId, string title, string? externalRef = null)
    {
        var id = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.InjectItems.Add(new InjectItem
        {
            Id = id,
            ExerciseId = exerciseId,
            Kind = "post",
            Title = title,
            ExternalRef = externalRef,
            Status = "fired",
            CreatedByHumanId = Guid.NewGuid(),
            CreatedAt = WallStart,
            UpdatedAt = WallStart,
        });
        await seed.SaveChangesAsync();
        return id;
    }

    /// <summary>Seeds a participant account.</summary>
    /// <param name="exerciseId">The owning exercise.</param>
    /// <param name="displayName">The display name.</param>
    /// <returns>The account id.</returns>
    public async Task<Guid> AccountAsync(Guid exerciseId, string displayName)
    {
        var id = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Accounts.Add(new Account
        {
            Id = id,
            ExerciseId = exerciseId,
            Username = $"user-{id:N}",
            DisplayName = displayName,
            Role = "participant",
            CreatedAt = WallStart,
        });
        await seed.SaveChangesAsync();
        return id;
    }

    /// <summary>
    /// Seeds a staff user with the given assignments and a live staff session active on <paramref name="activeExerciseId"/>.
    /// </summary>
    /// <param name="activeExerciseId">The session's active exercise.</param>
    /// <param name="assignments">The (exercise, role) assignments.</param>
    /// <param name="displayName">The staff user's display name.</param>
    /// <returns>The raw token and the staff user id.</returns>
    public async Task<(string Token, Guid StaffUserId)> StaffAsync(
        Guid activeExerciseId,
        IReadOnlyList<(Guid ExerciseId, string Role)> assignments,
        string displayName = "Test Staff User")
    {
        var token = $"export-staff-{Guid.NewGuid():N}";
        var staffUserId = Guid.NewGuid();
        var session = TestSessions.NewSession(token, activeExerciseId, kind: "staff");
        session.StaffUserId = staffUserId;
        session.PrincipalId = staffUserId.ToString();

        var staffUser = StaffTenantSeed.StaffUserFor(staffUserId);
        staffUser.DisplayName = displayName;

        await using var seed = _fixture.CreateContext();
        seed.StaffUsers.Add(staffUser);
        foreach (var (exerciseId, role) in assignments)
        {
            seed.StaffAssignments.Add(new StaffAssignment
            {
                Id = Guid.NewGuid(),
                StaffUserId = staffUserId,
                ExerciseId = exerciseId,
                Role = role,
                CreatedAt = DateTimeOffset.UtcNow,
            });
        }

        seed.Sessions.Add(session);
        await seed.SaveChangesAsync();
        return (token, staffUserId);
    }

    /// <summary>Seeds a live session of a non-staff kind.</summary>
    /// <param name="exerciseId">The bound exercise.</param>
    /// <param name="kind"><c>participant</c> or <c>readonly</c>.</param>
    /// <returns>The raw token.</returns>
    public async Task<string> NonStaffSessionAsync(Guid exerciseId, string kind)
    {
        var token = $"export-{kind}-{Guid.NewGuid():N}";
        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(TestSessions.NewSession(token, exerciseId, kind: kind, isReadOnly: kind == "readonly"));
        await seed.SaveChangesAsync();
        return token;
    }

    /// <summary>Inserts <paramref name="count"/> engine posts in one statement (for the row-limit test).</summary>
    /// <param name="exerciseId">The owning exercise.</param>
    /// <param name="count">How many posts.</param>
    /// <returns>A task.</returns>
    public async Task BulkPostsAsync(Guid exerciseId, int count)
    {
        await using var seed = _fixture.CreateContext();
        var scenario = ScenarioStart;
        var wall = WallStart;
        await seed.Database.ExecuteSqlAsync($@"
INSERT INTO [Posts] ([Id], [ExerciseId], [AuthorPersonaId], [Body], [CreatedScenarioTime], [CreatedWallClock], [Origin], [ActingHumanId])
SELECT TOP ({count}) NEWID(), {exerciseId}, NEWID(), N'bulk', {scenario}, {wall}, N'engine', N''
FROM sys.all_objects a CROSS JOIN sys.all_objects b;");
    }

    /// <summary>Reads every telemetry row for the exercise, ignoring query filters.</summary>
    /// <param name="exerciseId">The exercise.</param>
    /// <returns>The rows.</returns>
    public async Task<List<TelemetryEvent>> TelemetryAsync(Guid exerciseId)
    {
        await using var read = _fixture.CreateContext();
        return await read.TelemetryEvents.IgnoreQueryFilters().AsNoTracking().Where(e => e.ExerciseId == exerciseId).ToListAsync();
    }
}

/// <summary>Reads a downloaded workbook back with ClosedXML.</summary>
public static class ExportWorkbookReader
{
    /// <summary>Opens the bytes as a workbook. The caller disposes it.</summary>
    /// <param name="content">The <c>.xlsx</c> bytes.</param>
    /// <returns>The workbook.</returns>
    public static XLWorkbook Open(byte[] content) => new(new MemoryStream(content));

    /// <summary>The data rows of the <c>Posts</c> sheet as header → displayed text maps, in row order.</summary>
    /// <param name="content">The <c>.xlsx</c> bytes.</param>
    /// <returns>One dictionary per data row.</returns>
    public static List<Dictionary<string, string>> Rows(byte[] content)
    {
        using var workbook = Open(content);
        var sheet = workbook.Worksheet(PostExportWorkbook.SheetName);
        var lastRow = sheet.LastRowUsed()?.RowNumber() ?? 1;
        var rows = new List<Dictionary<string, string>>();
        for (var r = 2; r <= lastRow; r++)
        {
            var row = new Dictionary<string, string>(StringComparer.Ordinal);
            for (var c = 1; c <= PostExportWorkbook.Headers.Count; c++)
            {
                row[PostExportWorkbook.Headers[c - 1]] = sheet.Cell(r, c).GetString();
            }

            rows.Add(row);
        }

        return rows;
    }
}
