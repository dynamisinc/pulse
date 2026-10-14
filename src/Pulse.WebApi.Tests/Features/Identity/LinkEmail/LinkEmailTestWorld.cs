namespace Pulse.WebApi.Tests.Features.Identity.LinkEmail;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.LinkEmail;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Pulse.WebApi.Tests.Helpers;

/// <summary>The link state a seeded participant starts with.</summary>
internal enum EmailSeededLink
{
    /// <summary>No <c>ParticipantLink</c> row at all.</summary>
    None,

    /// <summary>Active, with a protected copy that decrypts to the token the hash names.</summary>
    Active,

    /// <summary>Revoked (protected copy cleared, as story 03 revokes).</summary>
    Revoked,

    /// <summary>Active, but the protected copy was written under another key ring (a lost key ring).</summary>
    LostKeyRing,
}

/// <summary>A seeded participant: ids, the address on file and, for a recoverable link, the join URL an email must carry.</summary>
internal sealed record EmailSeededParticipant(
    Guid AccountId,
    Guid? LinkId,
    string Name,
    string SignInName,
    string? Email,
    string? JoinUrl,
    string? Token);

/// <summary>
/// Seeds the real rows story 13 reads (exercise, staff user + assignment, accounts with an email, links) into the shared
/// migrated database, and builds <see cref="LinkEmailService"/> the way the host composes it
/// (<c>AddLinkEmail()</c>, which brings the easy-login kernel) with only the edges doubled: the staff-session accessor,
/// the exercise scope, the Data Protection key ring (shared with the seeding so a seeded copy decrypts), the mailer
/// (<see cref="FakeParticipantLinkMailer"/>) and the pacing (no pause). Fresh ids everywhere.
/// </summary>
internal sealed class LinkEmailTestWorld
{
    /// <summary>The SPA origin every recoverable link's join URL starts with.</summary>
    public const string FrontendBase = "https://pulse-uat.cobrasoftware.com";

    /// <summary>A usable ACS endpoint for configuration (never contacted: the mailer is faked).</summary>
    public const string AcsEndpoint = "https://acs-pulse-test.unitedstates.communication.azure.com";

    /// <summary>A usable managed-domain sender.</summary>
    public const string Sender = "DoNotReply@00000000-0000-0000-0000-000000000000.azurecomm.net";

    private readonly MsSqlContainerFixture _fixture;

    public LinkEmailTestWorld(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>The key ring the service decrypts with (and the seeding encrypts with).</summary>
    public EphemeralDataProtectionProvider KeyRing { get; } = new();

    public MsSqlContainerFixture Fixture => _fixture;

    /// <summary>Seeds an exercise.</summary>
    public async Task<Guid> SeedExerciseAsync(string? name = null)
    {
        var id = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            Id = id,
            OrganizationId = Organization.DefaultOrganizationId,
            Name = name ?? $"Coastal Surge {id:N}",
            TimeZone = "America/New_York",
            Status = "live",
            CurrentScenarioTime = new DateTimeOffset(2026, 10, 20, 9, 0, 0, TimeSpan.Zero),
        });
        await seed.SaveChangesAsync();
        return id;
    }

    /// <summary>Seeds a staff user (default tenant) with the given (exercise, role) assignments.</summary>
    public async Task<Guid> SeedStaffAsync(params (Guid ExerciseId, string Role)[] assignments)
    {
        var staffUserId = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.StaffUsers.Add(StaffTenantSeed.StaffUserFor(staffUserId));
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

        await seed.SaveChangesAsync();
        return staffUserId;
    }

    /// <summary>
    /// Seeds one participant in <paramref name="exerciseId"/>. <paramref name="email"/> defaults to a unique address
    /// (pass <c>""</c> for none).
    /// </summary>
    public async Task<EmailSeededParticipant> SeedParticipantAsync(
        Guid exerciseId,
        string name,
        EmailSeededLink link = EmailSeededLink.Active,
        string? email = null,
        bool disabled = false,
        string role = "participant")
    {
        var accountId = Guid.NewGuid();
        var signInName = $"p{accountId:N}"[..20];
        var address = email ?? $"{signInName}@example.org";

        var account = new Account
        {
            Id = accountId,
            ExerciseId = exerciseId,
            Username = signInName,
            DisplayName = name,
            Role = role,
            CreatedAt = DateTimeOffset.UtcNow,
            Email = address.Length == 0 ? null : address,
            DisabledAt = disabled ? DateTimeOffset.UtcNow.AddMinutes(-5) : null,
        };

        string? token = null;
        string? joinUrl = null;
        ParticipantLink? row = null;

        if (link != EmailSeededLink.None)
        {
            token = ParticipantLinkTokens.Generate();
            var protector = new ParticipantLinkTokenProtector(KeyRing);
            row = new ParticipantLink
            {
                Id = Guid.NewGuid(),
                ExerciseId = exerciseId,
                AccountId = accountId,
                TokenHash = ParticipantLinkTokens.Hash(token),
                Generation = 1,
                IssuedAt = DateTimeOffset.UtcNow.AddHours(-1),
            };

            switch (link)
            {
                case EmailSeededLink.Active:
                    row.ProtectedToken = protector.Protect(token);
                    joinUrl = $"{FrontendBase}/join/{token}";
                    break;
                case EmailSeededLink.Revoked:
                    row.ProtectedToken = null;
                    row.RevokedAt = DateTimeOffset.UtcNow.AddMinutes(-10);
                    break;
                case EmailSeededLink.LostKeyRing:
                    row.ProtectedToken = new ParticipantLinkTokenProtector(new EphemeralDataProtectionProvider()).Protect(token);
                    break;
            }
        }

        await using var seed = _fixture.CreateContext();
        seed.Accounts.Add(account);
        if (row is not null)
        {
            seed.ParticipantLinks.Add(row);
        }

        await seed.SaveChangesAsync();
        return new EmailSeededParticipant(accountId, row?.Id, name, signInName, account.Email, joinUrl, token);
    }

    /// <summary>
    /// The service as the host composes it, in its own provider. <paramref name="scope"/> is the resolved exercise
    /// (<c>null</c> = unresolved); <paramref name="staffUserId"/> the staff caller (<c>null</c> = none).
    /// </summary>
    public ServiceProvider BuildServices(
        Guid? scope,
        Guid? staffUserId,
        IParticipantLinkMailer mailer,
        LinkEmailCapturingLoggerProvider? logs = null,
        string? frontendBase = FrontendBase,
        Action<LinkEmailPacing>? pacing = null)
    {
        var settings = new Dictionary<string, string?>
        {
            [JoinUrlBuilder.FrontendBaseUrlKey] = frontendBase,
            [LinkEmailSettings.EndpointKey] = AcsEndpoint,
            [LinkEmailSettings.SenderAddressKey] = Sender,
        };

        var services = new ServiceCollection();
        services.AddLogging(builder =>
        {
            if (logs is not null)
            {
                builder.AddProvider(logs);
            }
        });
        services.AddSingleton<IConfiguration>(new ConfigurationBuilder().AddInMemoryCollection(settings).Build());
        services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = scope });
        services.AddScoped(provider => _fixture.CreateContext(provider.GetRequiredService<IExerciseContext>()));
        services.AddScoped<ICurrentStaffSessionAccessor>(_ => new StubCurrentStaffSessionAccessor(
            staffUserId is { } staff ? new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = staff } : null));
        services.AddScoped<StaffAssignmentService>();
        services.AddExerciseClock();
        services.AddSingleton(mailer);
        services.AddLinkEmail();
        services.Configure<LinkEmailPacing>(options =>
        {
            options.SendPause = TimeSpan.Zero;
            pacing?.Invoke(options);
        });
        services.AddSingleton<IDataProtectionProvider>(KeyRing);

        return services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true, ValidateOnBuild = true });
    }

    /// <summary>Runs one email request: <c>{}</c> when <paramref name="ids"/> is <c>null</c>, otherwise <c>{ participantIds }</c>.</summary>
    public Task<LinkEmailResult> SendAsync(
        Guid? scope,
        Guid? staffUserId,
        IParticipantLinkMailer mailer,
        IReadOnlyList<string>? ids = null,
        LinkEmailCapturingLoggerProvider? logs = null,
        string? frontendBase = FrontendBase,
        Action<LinkEmailPacing>? pacing = null) =>
        SendWithBodyAsync(scope, staffUserId, mailer, new RosterEmailLinksBody { ParticipantIds = ids }, logs, frontendBase, pacing);

    /// <summary>Runs one email request with exactly <paramref name="body"/> (which may be <c>null</c>).</summary>
    public async Task<LinkEmailResult> SendWithBodyAsync(
        Guid? scope,
        Guid? staffUserId,
        IParticipantLinkMailer mailer,
        RosterEmailLinksBody? body,
        LinkEmailCapturingLoggerProvider? logs = null,
        string? frontendBase = FrontendBase,
        Action<LinkEmailPacing>? pacing = null)
    {
        await using var provider = BuildServices(scope, staffUserId, mailer, logs, frontendBase, pacing);
        await using var request = provider.CreateAsyncScope();
        return await request.ServiceProvider.GetRequiredService<LinkEmailService>().SendAsync(body);
    }

    /// <summary>
    /// Changes one account in its own context, past any filter, as a concurrent roster import or access action would
    /// (Copilot review on #487: the batch must send to what is there at send time, not to what it planned).
    /// </summary>
    public async Task ChangeAccountAsync(Guid accountId, Action<Account> change)
    {
        await using var write = _fixture.CreateContext();
        change(await write.Accounts.IgnoreQueryFilters().SingleAsync(a => a.Id == accountId));
        await write.SaveChangesAsync();
    }

    /// <summary>Changes one link row in its own context, past any filter, as a concurrent staff link action would.</summary>
    public async Task ChangeLinkAsync(Guid linkId, Action<ParticipantLink> change)
    {
        await using var write = _fixture.CreateContext();
        change(await write.ParticipantLinks.IgnoreQueryFilters().SingleAsync(l => l.Id == linkId));
        await write.SaveChangesAsync();
    }

    /// <summary>Revokes a link as story 03 does: <c>RevokedAt</c> stamped, the protected copy cleared.</summary>
    public Task RevokeLinkAsync(Guid linkId) => ChangeLinkAsync(linkId, link =>
    {
        link.RevokedAt = DateTimeOffset.UtcNow;
        link.ProtectedToken = null;
    });

    /// <summary>
    /// Reissues a link IN PLACE as story 03 does (a new token, hash and protected copy, <c>Generation</c> + 1, not
    /// revoked) and returns the new join URL. The old token is dead from then on.
    /// </summary>
    public async Task<string> ReissueLinkAsync(Guid linkId)
    {
        var token = ParticipantLinkTokens.Generate();
        await ChangeLinkAsync(linkId, link =>
        {
            link.TokenHash = ParticipantLinkTokens.Hash(token);
            link.ProtectedToken = new ParticipantLinkTokenProtector(KeyRing).Protect(token);
            link.Generation += 1;
            link.RevokedAt = null;
        });
        return $"{FrontendBase}/join/{token}";
    }

    /// <summary>Every <c>participant.link.emailed</c> event persisted for <paramref name="exerciseId"/> (read past any filter).</summary>
    public async Task<List<TelemetryEvent>> EmailEventsAsync(Guid exerciseId)
    {
        await using var read = _fixture.CreateContext();
        return await read.TelemetryEvents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(e => e.ExerciseId == exerciseId && e.EventType == EasyLoginTelemetry.LinkEmailedEventType)
            .ToListAsync();
    }
}

/// <summary>
/// A configured mailer that sends nothing: it records every message and answers each from a script (by recipient),
/// defaulting to <see cref="LinkMailSendOutcome.Sent"/>. A recipient can also be scripted to THROW, to prove one
/// unexpected fault does not abort a batch.
/// </summary>
internal sealed class FakeParticipantLinkMailer : IParticipantLinkMailer
{
    private readonly ConcurrentQueue<LinkEmailMessage> _sent = new();
    private readonly Dictionary<string, LinkMailSendOutcome> _outcomes = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> _throwFor = new(StringComparer.OrdinalIgnoreCase);

    public FakeParticipantLinkMailer(bool configured = true) => IsConfigured = configured;

    public bool IsConfigured { get; }

    /// <summary>Every message handed to the mailer, in order (including the ones answered as failures).</summary>
    public IReadOnlyList<LinkEmailMessage> Messages => _sent.ToArray();

    /// <summary>
    /// Optional hook run on each send, with the message being sent, BEFORE it is answered (e.g. to change rows mid-batch,
    /// as a concurrent roster import or link action would, deterministically between two sends).
    /// </summary>
    public Func<LinkEmailMessage, Task>? OnSend { get; set; }

    public FakeParticipantLinkMailer Answer(string recipient, LinkMailSendOutcome outcome)
    {
        _outcomes[recipient] = outcome;
        return this;
    }

    public FakeParticipantLinkMailer ThrowFor(string recipient)
    {
        _throwFor.Add(recipient);
        return this;
    }

    public async Task<LinkMailSendOutcome> SendAsync(LinkEmailMessage message, CancellationToken cancellationToken)
    {
        _sent.Enqueue(message);
        if (OnSend is { } onSend)
        {
            await onSend(message);
        }

        if (_throwFor.Contains(message.RecipientAddress))
        {
            throw new InvalidOperationException($"boom for {message.RecipientAddress}");
        }

        return _outcomes.TryGetValue(message.RecipientAddress, out var outcome) ? outcome : LinkMailSendOutcome.Sent;
    }
}

/// <summary>Captures every log line (message, structured values and exception) for "no secret in a log" assertions.</summary>
internal sealed class LinkEmailCapturingLoggerProvider : ILoggerProvider
{
    private readonly ConcurrentQueue<string> _messages = new();

    public IReadOnlyCollection<string> Messages => _messages.ToArray();

    public string All => string.Join("\n", _messages);

    public ILogger CreateLogger(string categoryName) => new CapturingLogger(categoryName, _messages);

    public void Dispose()
    {
    }

    private sealed class CapturingLogger(string category, ConcurrentQueue<string> messages) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull
        {
            messages.Enqueue($"{category} scope: {state}");
            return null;
        }

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            var structured = state is IEnumerable<KeyValuePair<string, object?>> pairs
                ? string.Join(";", pairs.Select(pair => $"{pair.Key}={pair.Value}"))
                : string.Empty;
            messages.Enqueue($"{category} [{logLevel}] {formatter(state, exception)} {structured} {exception}");
        }
    }
}
