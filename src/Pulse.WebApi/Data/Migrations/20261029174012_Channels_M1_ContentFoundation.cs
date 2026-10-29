using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pulse.WebApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class Channels_M1_ContentFoundation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ContentItemId",
                table: "InjectItems",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_MediaAssets_ExerciseId_Id",
                table: "MediaAssets",
                columns: new[] { "ExerciseId", "Id" });

            migrationBuilder.CreateTable(
                name: "ChannelAlerts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Severity = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    Headline = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false),
                    SourceChannel = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    SourceContentId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    Href = table.Column<string>(type: "nvarchar(512)", maxLength: 512, nullable: true),
                    IssuedScenarioTime = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ExpiresScenarioTime = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    ClearedScenarioTime = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    Origin = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    ActingHumanId = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    Version = table.Column<int>(type: "int", nullable: false),
                    DeletedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChannelAlerts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Outlets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ChannelId = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    Slug = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    Tagline = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    ParentOutletId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    PairedPersonaId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    LogoMediaId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    CategoriesJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    SkinKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    SkinOverridesJson = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    SortOrder = table.Column<int>(type: "int", nullable: false),
                    Enabled = table.Column<bool>(type: "bit", nullable: false),
                    Version = table.Column<int>(type: "int", nullable: false),
                    DeletedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Outlets", x => x.Id);
                    table.UniqueConstraint("AK_Outlets_ExerciseId_Id", x => new { x.ExerciseId, x.Id });
                    table.UniqueConstraint("AK_Outlets_ExerciseId_Id_ChannelId", x => new { x.ExerciseId, x.Id, x.ChannelId });
                    table.ForeignKey(
                        name: "FK_Outlets_MediaAssets_ExerciseId_LogoMediaId",
                        columns: x => new { x.ExerciseId, x.LogoMediaId },
                        principalTable: "MediaAssets",
                        principalColumns: new[] { "ExerciseId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Outlets_Outlets_ExerciseId_ParentOutletId",
                        columns: x => new { x.ExerciseId, x.ParentOutletId },
                        principalTable: "Outlets",
                        principalColumns: new[] { "ExerciseId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PortalConfigs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    PortalName = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: true),
                    CityName = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: true),
                    Tagline = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    LogoMediaId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    LayoutKey = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    ModulesJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    SkinOverridesJson = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Version = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PortalConfigs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PortalConfigs_MediaAssets_ExerciseId_LogoMediaId",
                        columns: x => new { x.ExerciseId, x.LogoMediaId },
                        principalTable: "MediaAssets",
                        principalColumns: new[] { "ExerciseId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PortalResources",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Title = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Summary = table.Column<string>(type: "nvarchar(600)", maxLength: 600, nullable: true),
                    BodyHtml = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    MediaAssetId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    SortOrder = table.Column<int>(type: "int", nullable: false),
                    Visible = table.Column<bool>(type: "bit", nullable: false),
                    DeletedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    Version = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PortalResources", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PortalResources_MediaAssets_ExerciseId_MediaAssetId",
                        columns: x => new { x.ExerciseId, x.MediaAssetId },
                        principalTable: "MediaAssets",
                        principalColumns: new[] { "ExerciseId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "WeatherZones",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Slug = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    SortOrder = table.Column<int>(type: "int", nullable: false),
                    IsDefault = table.Column<bool>(type: "bit", nullable: false),
                    Version = table.Column<int>(type: "int", nullable: false),
                    DeletedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WeatherZones", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ContentItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ChannelId = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OutletId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Slug = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    Status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    Headline = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false),
                    Dek = table.Column<string>(type: "nvarchar(600)", maxLength: 600, nullable: true),
                    Kicker = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: true),
                    Category = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: true),
                    BylineName = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: true),
                    BylinePersonaId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    BodyHtml = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    HeroMediaId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    PayloadJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Background = table.Column<bool>(type: "bit", nullable: false),
                    FeaturedRank = table.Column<int>(type: "int", nullable: true),
                    ScheduledScenarioTime = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    PublishedScenarioTime = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    PublishedWallClock = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    RetractedScenarioTime = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    CreatedScenarioTime = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    CreatedWallClock = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Origin = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    ActingHumanId = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    InjectId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    PairedPostId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    AlertId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    ExternalSource = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    ExternalRef = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: true),
                    UpdatedScenarioTime = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    PublishOptionsJson = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    LastError = table.Column<string>(type: "nvarchar(1024)", maxLength: 1024, nullable: true),
                    RevisionCount = table.Column<int>(type: "int", nullable: false),
                    Version = table.Column<int>(type: "int", nullable: false),
                    DeletedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ContentItems", x => x.Id);
                    table.UniqueConstraint("AK_ContentItems_ExerciseId_Id", x => new { x.ExerciseId, x.Id });
                    table.ForeignKey(
                        name: "FK_ContentItems_MediaAssets_ExerciseId_HeroMediaId",
                        columns: x => new { x.ExerciseId, x.HeroMediaId },
                        principalTable: "MediaAssets",
                        principalColumns: new[] { "ExerciseId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ContentItems_Outlets_ExerciseId_OutletId_ChannelId",
                        columns: x => new { x.ExerciseId, x.OutletId, x.ChannelId },
                        principalTable: "Outlets",
                        principalColumns: new[] { "ExerciseId", "Id", "ChannelId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ContentItemMedia",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ContentItemId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    MediaAssetId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Role = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    SortOrder = table.Column<int>(type: "int", nullable: false),
                    Alt = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    DeletedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ContentItemMedia", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ContentItemMedia_ContentItems_ExerciseId_ContentItemId",
                        columns: x => new { x.ExerciseId, x.ContentItemId },
                        principalTable: "ContentItems",
                        principalColumns: new[] { "ExerciseId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ContentItemMedia_MediaAssets_ExerciseId_MediaAssetId",
                        columns: x => new { x.ExerciseId, x.MediaAssetId },
                        principalTable: "MediaAssets",
                        principalColumns: new[] { "ExerciseId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ContentItemRevisions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ContentItemId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Number = table.Column<int>(type: "int", nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    Note = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    SnapshotJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    ScenarioTime = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    WallClock = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ActingHumanId = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    Visible = table.Column<bool>(type: "bit", nullable: false),
                    DeletedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ContentItemRevisions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ContentItemRevisions_ContentItems_ExerciseId_ContentItemId",
                        columns: x => new { x.ExerciseId, x.ContentItemId },
                        principalTable: "ContentItems",
                        principalColumns: new[] { "ExerciseId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_InjectItems_ExerciseId_ContentItemId",
                table: "InjectItems",
                columns: new[] { "ExerciseId", "ContentItemId" });

            migrationBuilder.CreateIndex(
                name: "IX_ChannelAlerts_ExerciseId_IssuedScenarioTime",
                table: "ChannelAlerts",
                columns: new[] { "ExerciseId", "IssuedScenarioTime" });

            migrationBuilder.CreateIndex(
                name: "IX_ContentItemMedia_ExerciseId_ContentItemId_SortOrder",
                table: "ContentItemMedia",
                columns: new[] { "ExerciseId", "ContentItemId", "SortOrder" });

            migrationBuilder.CreateIndex(
                name: "IX_ContentItemMedia_ExerciseId_MediaAssetId",
                table: "ContentItemMedia",
                columns: new[] { "ExerciseId", "MediaAssetId" });

            migrationBuilder.CreateIndex(
                name: "IX_ContentItemRevisions_ExerciseId_ContentItemId_Number",
                table: "ContentItemRevisions",
                columns: new[] { "ExerciseId", "ContentItemId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ContentItems_ExerciseId_ChannelId_Status_PublishedScenarioTime",
                table: "ContentItems",
                columns: new[] { "ExerciseId", "ChannelId", "Status", "PublishedScenarioTime" });

            migrationBuilder.CreateIndex(
                name: "IX_ContentItems_ExerciseId_ExternalSource_ExternalRef",
                table: "ContentItems",
                columns: new[] { "ExerciseId", "ExternalSource", "ExternalRef" },
                unique: true,
                filter: "[ExternalSource] IS NOT NULL AND [ExternalRef] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ContentItems_ExerciseId_HeroMediaId",
                table: "ContentItems",
                columns: new[] { "ExerciseId", "HeroMediaId" });

            migrationBuilder.CreateIndex(
                name: "IX_ContentItems_ExerciseId_OutletId_ChannelId",
                table: "ContentItems",
                columns: new[] { "ExerciseId", "OutletId", "ChannelId" });

            migrationBuilder.CreateIndex(
                name: "IX_ContentItems_ExerciseId_OutletId_Slug",
                table: "ContentItems",
                columns: new[] { "ExerciseId", "OutletId", "Slug" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ContentItems_ExerciseId_ScheduledScenarioTime",
                table: "ContentItems",
                columns: new[] { "ExerciseId", "ScheduledScenarioTime" },
                filter: "[Status] = N'scheduled' AND [DeletedAt] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Outlets_ExerciseId_ChannelId_Slug",
                table: "Outlets",
                columns: new[] { "ExerciseId", "ChannelId", "Slug" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Outlets_ExerciseId_LogoMediaId",
                table: "Outlets",
                columns: new[] { "ExerciseId", "LogoMediaId" });

            migrationBuilder.CreateIndex(
                name: "IX_Outlets_ExerciseId_ParentOutletId",
                table: "Outlets",
                columns: new[] { "ExerciseId", "ParentOutletId" });

            migrationBuilder.CreateIndex(
                name: "IX_PortalConfigs_ExerciseId",
                table: "PortalConfigs",
                column: "ExerciseId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PortalConfigs_ExerciseId_LogoMediaId",
                table: "PortalConfigs",
                columns: new[] { "ExerciseId", "LogoMediaId" });

            migrationBuilder.CreateIndex(
                name: "IX_PortalResources_ExerciseId_MediaAssetId",
                table: "PortalResources",
                columns: new[] { "ExerciseId", "MediaAssetId" });

            migrationBuilder.CreateIndex(
                name: "IX_PortalResources_ExerciseId_SortOrder",
                table: "PortalResources",
                columns: new[] { "ExerciseId", "SortOrder" });

            migrationBuilder.CreateIndex(
                name: "IX_WeatherZones_ExerciseId_Slug",
                table: "WeatherZones",
                columns: new[] { "ExerciseId", "Slug" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_InjectItems_ContentItems_ExerciseId_ContentItemId",
                table: "InjectItems",
                columns: new[] { "ExerciseId", "ContentItemId" },
                principalTable: "ContentItems",
                principalColumns: new[] { "ExerciseId", "Id" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_InjectItems_ContentItems_ExerciseId_ContentItemId",
                table: "InjectItems");

            migrationBuilder.DropTable(
                name: "ChannelAlerts");

            migrationBuilder.DropTable(
                name: "ContentItemMedia");

            migrationBuilder.DropTable(
                name: "ContentItemRevisions");

            migrationBuilder.DropTable(
                name: "PortalConfigs");

            migrationBuilder.DropTable(
                name: "PortalResources");

            migrationBuilder.DropTable(
                name: "WeatherZones");

            migrationBuilder.DropTable(
                name: "ContentItems");

            migrationBuilder.DropTable(
                name: "Outlets");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_MediaAssets_ExerciseId_Id",
                table: "MediaAssets");

            migrationBuilder.DropIndex(
                name: "IX_InjectItems_ExerciseId_ContentItemId",
                table: "InjectItems");

            migrationBuilder.DropColumn(
                name: "ContentItemId",
                table: "InjectItems");
        }
    }
}
