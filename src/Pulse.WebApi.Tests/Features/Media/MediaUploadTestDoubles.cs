namespace Pulse.WebApi.Tests.Features.Media;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Features.Social.Follows;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Pulse.WebApi.Tests.Helpers;

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
        IMediaStore? store = null,
        bool staffAssigned = true,
        bool exerciseHasScenarioTime = true,
        IHttpContextAccessor? httpContextAccessor = null,
        ILogger<MediaUploadService>? logger = null)
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
                CurrentScenarioTime = exerciseHasScenarioTime ? ExerciseScenarioTime : null,
            });

            if (staffUserId is { } staffId)
            {
                seed.StaffUsers.Add(StaffTenantSeed.StaffUserFor(staffId));
                if (staffAssigned)
                {
                    seed.StaffAssignments.Add(new StaffAssignment
                    {
                        Id = Guid.NewGuid(),
                        StaffUserId = staffId,
                        ExerciseId = ExerciseId,
                        Role = "controller",
                        CreatedAt = WallClockNow,
                    });
                }
            }

            seed.SaveChanges();
        }

        Db = CreateContext(ExerciseContext);
        var staffAccessor = new FakeStaffSessionAccessor(staffUserId);
        Service = new MediaUploadService(
            Db,
            ExerciseContext,
            staffAccessor,
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
            new StaffAssignmentService(Db, staffAccessor),
            httpContextAccessor ?? new HttpContextAccessor(),
            Store,
            Signer,
            Clock,
            Time,
            Microsoft.Extensions.Options.Options.Create(Options),
            logger ?? NullLogger<MediaUploadService>.Instance);
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

/// <summary>
/// A store that streams through the production <see cref="MaxLengthReadStream"/> into nothing — so a test can push a
/// production-sized (100 MiB) upload without holding it. Honours the contract: its own partial is "deleted" (recorded)
/// on failure.
/// </summary>
internal sealed class DrainingMediaStore : IMediaStore
{
    public bool IsConfigured => true;

    public List<string> Completed { get; } = [];

    public List<string> Deletes { get; } = [];

    public async Task<long> SaveAsync(string blobName, string contentType, Stream content, long maxBytes, CancellationToken cancellationToken)
    {
        var limited = new MaxLengthReadStream(content, maxBytes);
        try
        {
            await limited.CopyToAsync(Stream.Null, 64 * 1024, cancellationToken);
        }
        catch
        {
            Deletes.Add(blobName);
            throw;
        }

        Completed.Add(blobName);
        return limited.BytesRead;
    }

    public Task DeleteAsync(string blobName, CancellationToken cancellationToken)
    {
        Deletes.Add(blobName);
        return Task.CompletedTask;
    }
}

/// <summary>
/// A store that refuses every save the way a no-overwrite store refuses an EXISTING name (Local <c>CreateNew</c>,
/// Azure 409/412) — the blob it names belongs to someone else, so nobody may delete it.
/// </summary>
internal sealed class NameAlreadyExistsMediaStore : IMediaStore
{
    public bool IsConfigured => true;

    public List<string> Deletes { get; } = [];

    public Task<long> SaveAsync(string blobName, string contentType, Stream content, long maxBytes, CancellationToken cancellationToken) =>
        throw new IOException($"The blob '{blobName}' already exists.");

    public Task DeleteAsync(string blobName, CancellationToken cancellationToken)
    {
        Deletes.Add(blobName);
        return Task.CompletedTask;
    }
}

/// <summary>
/// A lazily generated multipart body — one <c>file</c> part whose payload is <paramref name="head"/> followed by
/// filler up to <c>payloadLength</c> — produced in bulk spans, so a 100 MiB body costs no memory.
/// </summary>
internal sealed class GeneratedUploadBody : Stream
{
    private readonly byte[] _prefix;
    private readonly byte[] _head;
    private readonly long _payloadLength;
    private readonly byte[] _suffix;
    private long _position;

    public GeneratedUploadBody(byte[] head, long payloadLength, string fileName = "upload.bin")
    {
        Boundary = $"generated-{Guid.NewGuid():N}";
        _prefix = System.Text.Encoding.ASCII.GetBytes(
            $"--{Boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{fileName}\"\r\n"
            + "Content-Type: application/octet-stream\r\n\r\n");
        _head = head;
        _payloadLength = payloadLength;
        _suffix = System.Text.Encoding.ASCII.GetBytes($"\r\n--{Boundary}--\r\n");
    }

    public string Boundary { get; }

    public string ContentType => $"multipart/form-data; boundary={Boundary}";

    public override bool CanRead => true;

    public override bool CanSeek => false;

    public override bool CanWrite => false;

    public override long Length => throw new NotSupportedException();

    public override long Position
    {
        get => throw new NotSupportedException();
        set => throw new NotSupportedException();
    }

    public override int Read(byte[] buffer, int offset, int count) => Read(buffer.AsSpan(offset, count));

    public override int Read(Span<byte> buffer)
    {
        var payloadStart = (long)_prefix.Length;
        var payloadEnd = payloadStart + _payloadLength;
        var end = payloadEnd + _suffix.Length;
        var written = 0;

        while (written < buffer.Length && _position < end)
        {
            var destination = buffer[written..];
            int take;
            if (_position < payloadStart)
            {
                take = (int)Math.Min(destination.Length, payloadStart - _position);
                _prefix.AsSpan((int)_position, take).CopyTo(destination);
            }
            else if (_position < payloadEnd)
            {
                var payloadIndex = _position - payloadStart;
                if (payloadIndex < _head.Length)
                {
                    take = (int)Math.Min(destination.Length, Math.Min(_head.Length - payloadIndex, _payloadLength - payloadIndex));
                    _head.AsSpan((int)payloadIndex, take).CopyTo(destination);
                }
                else
                {
                    take = (int)Math.Min(destination.Length, payloadEnd - _position);
                    destination[..take].Fill(0x5A);
                }
            }
            else
            {
                take = (int)Math.Min(destination.Length, end - _position);
                _suffix.AsSpan((int)(_position - payloadEnd), take).CopyTo(destination);
            }

            written += take;
            _position += take;
        }

        return written;
    }

    public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) =>
        ValueTask.FromResult(Read(buffer.Span));

    public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
        Task.FromResult(Read(buffer, offset, count));

    public override void Flush()
    {
    }

    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

    public override void SetLength(long value) => throw new NotSupportedException();

    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}

/// <summary>Captures formatted log messages.</summary>
internal sealed class CapturingLogger<T> : ILogger<T>
{
    public List<string> Messages { get; } = [];

    public IDisposable? BeginScope<TState>(TState state)
        where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
        Messages.Add(formatter(state, exception));
}
