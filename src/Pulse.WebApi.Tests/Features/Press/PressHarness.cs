namespace Pulse.WebApi.Tests.Features.Press;

using System;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Press;
using Pulse.WebApi.Features.Press.Contracts;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Channels.Publish;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// Press story 01 test host: the F04 funnel harness (two exercises over the EF in-memory provider; exercise A has The
/// Wire Room) with the REAL <c>AddPress()</c> registrations in place of the funnel's test <c>release</c> descriptor, plus
/// seeding helpers for org personas, PIO grants and media assets.
/// </summary>
internal sealed class PressHarness : IDisposable
{
    private readonly StaffHolder _staff = new();

    public PressHarness()
    {
        Funnel = FunnelHarness.Create(services =>
        {
            services.RemoveAll<IContentKindDescriptor>();
            services.AddScoped<IContentKindDescriptor>(_ => new TestKindDescriptor(
                ChannelVocabulary.KindArticle, ChannelVocabulary.News, ISanitizerProfileRegistry.RichBasic));
            services.AddPress();
            services.TryAddScoped<ExerciseFactsReader>();
            services.RemoveAll<ICurrentStaffSessionAccessor>();
            services.AddScoped<ICurrentStaffSessionAccessor>(_ => new StubCurrentStaffSessionAccessor(
                _staff.StaffUserId is { } staff ? new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = staff } : null));
        });
    }

    public FunnelHarness Funnel { get; }

    public Guid ExerciseId => Funnel.ExerciseId;

    public Guid OtherExerciseId => Funnel.OtherExerciseId;

    /// <summary>The Wire Room of exercise A.</summary>
    public Guid WireRoomId => Funnel.PressOutletId;

    /// <summary>The staff user behind the next scope, or null for a participant-session call.</summary>
    public Guid? StaffUserId
    {
        get => _staff.StaffUserId;
        set => _staff.StaffUserId = value;
    }

    public FunnelHarness.Scope In(Guid? exerciseId) => Funnel.In(exerciseId);

    public FunnelHarness.Scope InA() => Funnel.InA();

    public IOrgNewsroomProvisioner Provisioner(FunnelHarness.Scope scope) =>
        scope.Services.GetRequiredService<IOrgNewsroomProvisioner>();

    /// <summary>Seeds an org persona in <paramref name="exerciseId"/>, optionally granted to a PIO enrollment.</summary>
    public async Task<Guid> AddOrgAsync(
        Guid exerciseId, string displayName, string handle, bool pio = true, Guid? avatarMediaId = null)
    {
        using var scope = In(exerciseId);
        var persona = new Persona
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            DisplayName = displayName,
            Handle = handle,
            Kind = "org",
            AvatarMediaId = avatarMediaId,
        };
        scope.Db.Personas.Add(persona);
        if (pio)
        {
            scope.Db.Enrollments.Add(new Enrollment
            {
                Id = Guid.NewGuid(),
                ExerciseId = exerciseId,
                Role = EnrollmentRoles.Pio,
                PersonaId = persona.Id,
                CreatedAt = FunnelHarness.WallStart,
            });
        }

        await scope.Db.SaveChangesAsync();
        return persona.Id;
    }

    /// <summary>Seeds a media asset of <paramref name="kind"/> in <paramref name="exerciseId"/>.</summary>
    public async Task<Guid> AddMediaAsync(Guid exerciseId, string kind, string fileName = "statement.pdf", long bytes = 48_213)
    {
        using var scope = In(exerciseId);
        var asset = ChannelRows.MediaAsset(exerciseId);
        asset.Kind = kind;
        asset.ContentType = kind == MediaKinds.Document ? "application/pdf" : "image/jpeg";
        asset.OriginalFileName = fileName;
        asset.Bytes = bytes;
        scope.Db.MediaAssets.Add(asset);
        await scope.Db.SaveChangesAsync();
        return asset.Id;
    }

    /// <summary>The validation context the funnel builds for a write in <paramref name="scope"/>.</summary>
    public static PayloadValidationContext Context(FunnelHarness.Scope scope, Guid exerciseId) => new()
    {
        ExerciseId = exerciseId,
        Db = scope.Db,
        Services = scope.Services,
        TargetStatus = ChannelVocabulary.StatusDraft,
    };

    /// <summary>A valid PC-1 payload for <paramref name="orgPersonaId"/>.</summary>
    public static JsonObject Payload(Guid orgPersonaId) => new()
    {
        ["orgPersonaId"] = orgPersonaId.ToString(),
        ["inputPath"] = "rich",
        ["contact"] = new JsonObject
        {
            ["name"] = "Jordan Alvarez",
            ["title"] = "Public Information Officer",
            ["phone"] = "404-555-0142",
            ["email"] = "pio@fulton-em.example",
        },
        ["dateline"] = "FULTON COUNTY, Ga. —",
        ["boilerplate"] = "Fulton County Emergency Management coordinates the county's response.",
        ["crossPost"] = new JsonObject { ["text"] = "Shelters are open." },
        ["approval"] = new JsonObject { ["required"] = false },
    };

    public void Dispose() => Funnel.Dispose();

    private sealed class StaffHolder
    {
        public Guid? StaffUserId { get; set; }
    }
}
