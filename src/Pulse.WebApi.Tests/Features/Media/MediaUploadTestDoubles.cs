namespace Pulse.WebApi.Tests.Features.Media;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Features.Social.Follows;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;

/// <summary>
/// An in-memory <see cref="IMediaStore"/> that honours the frozen contract exactly like the real stores: it enforces
/// <c>maxBytes</c> WHILE reading (via the production <see cref="MaxLengthReadStream"/>), deletes the partial blob on
/// any failure, and records every save and delete so a test can assert "nothing left behind".
/// </summary>
internal sealed class RecordingMediaStore : IMediaStore
{
    public RecordingMediaStore(bool isConfigured = true) => IsConfigured = isConfigured;

    public bool IsConfigured { get; }

    public ConcurrentDictionary<string, (string ContentType, byte[] Bytes)> Blobs { get; } = new();

    public List<string> SaveAttempts { get; } = [];

    public List<string> Deletes { get; } = [];

    public async Task<long> SaveAsync(string blobName, string contentType, Stream content, long maxBytes, CancellationToken cancellationToken)
    {
        SaveAttempts.Add(blobName);
        var limited = new MaxLengthReadStream(content, maxBytes);
        using var sink = new MemoryStream();
        try
        {
            await limited.CopyToAsync(sink, 8192, cancellationToken);
        }
        catch
        {
            await DeleteAsync(blobName, CancellationToken.None);
            throw;
        }

        Blobs[blobName] = (contentType, sink.ToArray());
        return limited.BytesRead;
    }

    public Task DeleteAsync(string blobName, CancellationToken cancellationToken)
    {
        Deletes.Add(blobName);
        Blobs.TryRemove(blobName, out _);
        return Task.CompletedTask;
    }
}

/// <summary>A scope-checking signer that returns a recognisable URL — enough to see what was signed.</summary>
internal sealed class FakeMediaUrlSigner : IMediaUrlSigner
{
    private readonly IExerciseContext _exerciseContext;

    public FakeMediaUrlSigner(IExerciseContext exerciseContext) => _exerciseContext = exerciseContext;

    public List<Guid> Signed { get; } = [];

    public async Task<string> GetReadUrlAsync(MediaAsset asset, CancellationToken cancellationToken) =>
        (await GetReadUrlsAsync([asset], cancellationToken))[asset.Id];

    public Task<IReadOnlyDictionary<Guid, string>> GetReadUrlsAsync(IReadOnlyCollection<MediaAsset> assets, CancellationToken cancellationToken)
    {
        MediaScopeGuard.EnsureInScope(_exerciseContext, assets);
        Signed.AddRange(assets.Select(asset => asset.Id));
        return Task.FromResult<IReadOnlyDictionary<Guid, string>>(
            assets.ToDictionary(asset => asset.Id, asset => $"https://signed.test/{asset.BlobName}"));
    }
}

internal sealed class FakeStaffSessionAccessor : ICurrentStaffSessionAccessor
{
    private readonly CurrentStaffSession? _session;

    public FakeStaffSessionAccessor(Guid? staffUserId) =>
        _session = staffUserId is { } id ? new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = id } : null;

    public Task<CurrentStaffSession?> GetCurrentStaffSessionAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult(_session);
}

internal sealed class FakeSessionPersonaAccessor : ICurrentSessionPersonaAccessor
{
    private readonly CurrentSessionPersona? _persona;

    public FakeSessionPersonaAccessor(CurrentSessionPersona? persona) => _persona = persona;

    public Task<CurrentSessionPersona?> GetCurrentSessionPersonaAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult(_persona);
}

/// <summary>
/// Composes a <see cref="MediaUploadService"/> over the EF in-memory provider (the central exercise filter still
/// applies), a recording store, a fake signer and a real (initially idle) exercise clock.
/// </summary>
internal sealed class UploadHarness : IDisposable
{
    public static readonly DateTimeOffset WallClockNow = new(2026, 10, 10, 15, 30, 0, TimeSpan.Zero);
    public static readonly DateTimeOffset ExerciseScenarioTime = new(2033, 9, 4, 13, 0, 0, TimeSpan.FromHours(-5));

    private readonly string _databaseName = $"media-{Guid.NewGuid():N}";

    public UploadHarness(
        bool scopeResolved = true,
        string? participantKind = "participant",
        Guid? staffUserId = null,
        bool storeConfigured = true,
        MediaUploadOptions? options = null,
        IMediaStore? store = null)
    {
        ExerciseId = Guid.NewGuid();
        ExerciseContext = new ExerciseContext { CurrentExerciseId = scopeResolved ? ExerciseId : null };

        Time = new ManualTimeProvider(WallClockNow);
        Clock = new ExerciseClockService(Time);
        Store = store ?? new RecordingMediaStore(storeConfigured);
        Signer = new FakeMediaUrlSigner(ExerciseContext);
        ActingHumanId = $"human-{Guid.NewGuid():N}";
        Options = options ?? new MediaUploadOptions();

        using (var seed = CreateContext(null))
        {
            seed.Exercises.Add(new Exercise
            {
                Id = ExerciseId,
                OrganizationId = Organization.DefaultOrganizationId,
                Name = "media harness",
                Status = "live",
                CurrentScenarioTime = ExerciseScenarioTime,
            });
            seed.SaveChanges();
        }

        Db = CreateContext(ExerciseContext);
        Service = new MediaUploadService(
            Db,
            ExerciseContext,
            new FakeStaffSessionAccessor(staffUserId),
            new FakeSessionPersonaAccessor(participantKind is null
                ? null
                : new CurrentSessionPersona
                {
                    SessionId = Guid.NewGuid(),
                    PersonaId = Guid.NewGuid(),
                    Kind = participantKind,
                    ExerciseId = ExerciseId,
                    ActingHumanId = ActingHumanId,
                }),
            Store,
            Signer,
            Clock,
            Time,
            Microsoft.Extensions.Options.Options.Create(Options),
            NullLogger<MediaUploadService>.Instance);
    }

    public Guid ExerciseId { get; }

    public ExerciseContext ExerciseContext { get; }

    public ManualTimeProvider Time { get; }

    public ExerciseClockService Clock { get; }

    public IMediaStore Store { get; }

    public RecordingMediaStore Recording => (RecordingMediaStore)Store;

    public FakeMediaUrlSigner Signer { get; }

    public string ActingHumanId { get; }

    public MediaUploadOptions Options { get; }

    public PulseDbContext Db { get; }

    public MediaUploadService Service { get; }

    public PulseDbContext CreateContext(IExerciseContext? exerciseContext) =>
        new(new DbContextOptionsBuilder<PulseDbContext>().UseInMemoryDatabase(_databaseName).Options, exerciseContext);

    public List<MediaAsset> AllAssets()
    {
        using var context = CreateContext(null);
        return context.MediaAssets.IgnoreQueryFilters().AsNoTracking().ToList();
    }

    public void Seed(MediaAsset asset)
    {
        using var context = CreateContext(null);
        context.MediaAssets.Add(asset);
        context.SaveChanges();
    }

    public async Task<MediaUploadResult> UploadAsync(System.Net.Http.MultipartFormDataContent form)
    {
        var (contentType, body) = await MediaTestFiles.Serialize(form);
        return await Service.UploadAsync(contentType, body);
    }

    public void Dispose() => Db.Dispose();
}
