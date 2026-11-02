namespace Pulse.WebApi.Tests.Features.Press;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Channels.Outlets;
using Pulse.WebApi.Features.Press.Contracts;
using Pulse.WebApi.Features.Press.Outlets;

/// <summary>
/// Press story 01 (#738), PRS-012 / Q2: one child newsroom outlet per publishing org under The Wire Room, idempotent,
/// isolated per exercise (XC-001), with the org's image avatar as logo and the Wire Room's skin inherited.
/// </summary>
public sealed class OrgNewsroomProvisionerTests : IDisposable
{
    private readonly PressHarness _harness = new();

    public void Dispose() => _harness.Dispose();

    [Fact]
    public async Task EveryPublishingOrg_GetsExactlyOneChildNewsroom_AndASecondRunCreatesNothing()
    {
        var logo = await _harness.AddMediaAsync(_harness.ExerciseId, MediaKinds.Image, "fulton.png");
        var fulton = await _harness.AddOrgAsync(_harness.ExerciseId, "Fulton County EM", "@FultonEM", avatarMediaId: logo);
        var harbor = await _harness.AddOrgAsync(_harness.ExerciseId, "Harbor Point Fire Rescue", "HarborPointFire");
        await _harness.AddOrgAsync(_harness.ExerciseId, "Not a PIO org", "NotPio", pio: false);

        var first = await ProvisionAsync();
        var second = await ProvisionAsync();

        first.Status.Should().Be(OrgNewsroomProvisionStatus.Ok);
        first.Created.Should().HaveCount(2);
        second.Created.Should().BeEmpty("running it twice creates no duplicates");
        second.Existing.Should().BeEquivalentTo([fulton, harbor]);

        var newsrooms = await NewsroomsAsync();
        var wireRoom = await WireRoomAsync();
        newsrooms.Should().HaveCount(2);
        newsrooms.Should().OnlyContain(o => o.ParentOutletId == wireRoom.Id && o.ChannelId == "press" && o.Enabled);
        newsrooms.Should().OnlyContain(o => o.SkinKey == wireRoom.SkinKey, "the skin is inherited from The Wire Room");
        newsrooms.Should().OnlyContain(o => o.SkinOverridesJson == null, "a new newsroom starts with a neutral letterhead");
        newsrooms.Should().OnlyContain(o => ChannelVocabulary.IsSlug(o.Slug));

        var fultonRoom = newsrooms.Single(o => o.PairedPersonaId == fulton);
        fultonRoom.Name.Should().Be("Fulton County EM");
        fultonRoom.Slug.Should().Be("fultonem");
        fultonRoom.LogoMediaId.Should().Be(logo);
        newsrooms.Single(o => o.PairedPersonaId == harbor).LogoMediaId.Should().BeNull();
    }

    [Fact]
    public async Task EachNewsroom_EmitsOneOutletCreateEvent_AttributedToTheStaffUser()
    {
        var staff = Guid.NewGuid();
        _harness.StaffUserId = staff;
        await _harness.AddOrgAsync(_harness.ExerciseId, "Fulton County EM", "FultonEM");

        var result = await ProvisionAsync();

        var events = (await _harness.Funnel.EventsAsync()).Where(e => e.EventType == OutletTelemetry.EventType).ToList();
        events.Should().ContainSingle();
        events[0].Target!.EntityId.Should().Be(result.Created.Single().ToString());
        events[0].Actor.ActingHumanId.Should().Be(staff.ToString());
        JsonNode.Parse(events[0].Payload!)!["source"]!.GetValue<string>().Should().Be(OrgNewsroomProvisioner.TelemetrySource);
    }

    [Fact]
    public async Task AParticipantSessionGrant_IsAttributedToNoStaffUser()
    {
        var org = await _harness.AddOrgAsync(_harness.ExerciseId, "Fulton County EM", "FultonEM");
        using var scope = _harness.InA();

        (await _harness.Provisioner(scope).EnsureForPersonaAsync(org)).Created.Should().ContainSingle();

        var created = (await _harness.Funnel.EventsAsync()).Single(e => e.EventType == OutletTelemetry.EventType);
        created.Actor.ActingHumanId.Should().BeNull("there is no staff user behind a participant-session grant");
    }

    [Fact]
    public async Task EnsureForPersona_ProvisionsOneGrant_AndAnotherExercisesPersonaIsNotFound()
    {
        var org = await _harness.AddOrgAsync(_harness.ExerciseId, "Fulton County EM", "FultonEM", pio: false);
        var foreign = await _harness.AddOrgAsync(_harness.OtherExerciseId, "Elsewhere EM", "ElsewhereEM");
        using var scope = _harness.InA();
        var provisioner = _harness.Provisioner(scope);

        (await provisioner.EnsureForPersonaAsync(org)).Created.Should().ContainSingle();
        (await provisioner.EnsureForPersonaAsync(org)).Existing.Should().Equal(org);
        (await provisioner.EnsureForPersonaAsync(foreign)).Status.Should().Be(OrgNewsroomProvisionStatus.PersonaNotFound);
        (await provisioner.EnsureForPersonaAsync(Guid.NewGuid())).Status.Should().Be(OrgNewsroomProvisionStatus.PersonaNotFound);
    }

    [Fact]
    public async Task AnExerciseWithoutAWireRoom_ProvisionsNothing_AndNeverParentsUnderAnotherExercisesWireRoom()
    {
        await _harness.AddOrgAsync(_harness.OtherExerciseId, "Elsewhere EM", "ElsewhereEM");
        using var scope = _harness.In(_harness.OtherExerciseId);

        (await _harness.Provisioner(scope).ProvisionAsync()).Status.Should().Be(OrgNewsroomProvisionStatus.NoWireRoom);
        (await scope.Db.Outlets.CountAsync(o => o.ChannelId == "press")).Should().Be(0);
    }

    [Fact]
    public async Task AnUnresolvedScope_FailsClosed()
    {
        using var scope = _harness.In(null);
        var provisioner = _harness.Provisioner(scope);

        (await provisioner.ProvisionAsync()).Status.Should().Be(OrgNewsroomProvisionStatus.ScopeUnresolved);
        (await provisioner.EnsureForPersonaAsync(Guid.NewGuid())).Status.Should().Be(OrgNewsroomProvisionStatus.ScopeUnresolved);
    }

    [Fact]
    public async Task ANewsroomStaffDeleted_IsNotRecreated_AndItsSlugStaysReserved()
    {
        var org = await _harness.AddOrgAsync(_harness.ExerciseId, "Fulton County EM", "FultonEM");
        var created = (await ProvisionAsync()).Created.Single();
        using (var scope = _harness.InA())
        {
            var outlet = await scope.Db.Outlets.SingleAsync(o => o.Id == created);
            scope.Db.Outlets.Remove(outlet);
            await scope.Db.SaveChangesAsync();
        }

        (await ProvisionAsync()).Existing.Should().Equal(org);
        var twin = await _harness.AddOrgAsync(_harness.ExerciseId, "Fulton County EM", "fultonem");
        var twinRoom = (await ProvisionAsync()).Created.Single();

        using var check = _harness.InA();
        (await check.Db.Outlets.SingleAsync(o => o.Id == twinRoom)).Slug.Should().Be("fultonem-2");
        (await check.Db.Outlets.SingleAsync(o => o.Id == twinRoom)).PairedPersonaId.Should().Be(twin);
    }

    [Fact]
    public async Task ANonImageAvatar_IsNotUsedAsTheLogo()
    {
        var pdf = await _harness.AddMediaAsync(_harness.ExerciseId, MediaKinds.Document);
        await _harness.AddOrgAsync(_harness.ExerciseId, "Fulton County EM", "FultonEM", avatarMediaId: pdf);

        await ProvisionAsync();

        (await NewsroomsAsync()).Single().LogoMediaId.Should().BeNull();
    }

    [Theory]
    [InlineData("@FultonEM", "Fulton County EM", "fultonem")]
    [InlineData("Fulton_County.EM", "x", "fulton-county-em")]
    [InlineData("@@@", "Harbor Point Fire & Rescue", "harbor-point-fire-rescue")]
    [InlineData("", "!!!", "newsroom")]
    public void UniqueSlug_IsAValidFcSlug(string handle, string name, string expected)
    {
        OrgNewsroomProvisioner.UniqueSlug(handle, name, new HashSet<string>()).Should().Be(expected);
    }

    [Fact]
    public void UniqueSlug_StaysWithinTheLengthCap_WhenSuffixed()
    {
        var handle = new string('a', 120);
        var first = OrgNewsroomProvisioner.UniqueSlug(handle, null, new HashSet<string>());

        var second = OrgNewsroomProvisioner.UniqueSlug(handle, null, new HashSet<string> { first });

        first.Length.Should().Be(Outlet.MaxSlugLength);
        second.Should().EndWith("-2");
        second.Length.Should().BeLessThanOrEqualTo(Outlet.MaxSlugLength);
        ChannelVocabulary.IsSlug(second).Should().BeTrue();
    }

    private async Task<OrgNewsroomProvisionResult> ProvisionAsync()
    {
        using var scope = _harness.InA();
        return await _harness.Provisioner(scope).ProvisionAsync();
    }

    private async Task<List<Outlet>> NewsroomsAsync()
    {
        using var scope = _harness.InA();
        return await scope.Db.Outlets.AsNoTracking().Where(o => o.ParentOutletId != null).ToListAsync();
    }

    private async Task<Outlet> WireRoomAsync()
    {
        using var scope = _harness.InA();
        return await scope.Db.Outlets.AsNoTracking().SingleAsync(o => o.Id == _harness.WireRoomId);
    }
}
