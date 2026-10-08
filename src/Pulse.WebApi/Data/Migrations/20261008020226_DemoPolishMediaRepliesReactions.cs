using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pulse.WebApi.Data.Migrations
{
    /// <summary>
    /// demo-polish B1 — the push's ONE migration (<c>docs/features/demo-polish/implementation.md</c> §1.2–§1.3,
    /// §6, DP-15): the <c>MediaAssets</c>, <c>PostMediaItems</c> and <c>PostReactions</c> tables (all
    /// exercise-scoped, <c>IExerciseScoped</c>), the reply/baseline columns on <c>Posts</c>, and the
    /// avatar/banner/location columns on <c>Personas</c>.
    /// </summary>
    /// <remarks>
    /// Purely additive and fully scaffolded: no <c>migrationBuilder.Sql(...)</c>, so nothing in the idempotent
    /// deploy script's single batch names a column before it exists (lesson #413). The one filtered index
    /// (<c>IX_PostReactions_PostId_PersonaId_Kind</c>, <c>WHERE [DeletedAt] IS NULL</c> — DP-15, active reactions
    /// only) is emitted by EF inside <c>EXEC(N'…')</c> in the idempotent script. New <c>NOT NULL</c> columns carry
    /// <c>DEFAULT 0</c>; everything else is nullable, so existing rows need no backfill. Every foreign key is
    /// <c>Restrict</c> (<c>ON DELETE NO ACTION</c>): no cascade path, no hard-delete path (XC-010). The column
    /// <c>Order</c> is a reserved word — EF brackets it; any raw SQL must write <c>[Order]</c>.
    /// </remarks>
    public partial class DemoPolishMediaRepliesReactions : Migration
    {
        /// <summary>The unique media-slot key, in order: post, then display position (CA1861 — not an inline array).</summary>
        private static readonly string[] MediaSlotKeyColumns = ["PostId", "Order"];

        /// <summary>The active-reaction unique key, in order: post, persona, kind (CA1861 — not an inline array).</summary>
        private static readonly string[] ReactionKeyColumns = ["PostId", "PersonaId", "Kind"];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "BaselineLikeCount",
                table: "Posts",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "BaselineReplyCount",
                table: "Posts",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "BaselineRepostCount",
                table: "Posts",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<Guid>(
                name: "ParentPostId",
                table: "Posts",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "AvatarMediaId",
                table: "Personas",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "BannerMediaId",
                table: "Personas",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Location",
                table: "Personas",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "MediaAssets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    ContentType = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    BlobName = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    Bytes = table.Column<long>(type: "bigint", nullable: false),
                    Width = table.Column<int>(type: "int", nullable: true),
                    Height = table.Column<int>(type: "int", nullable: true),
                    DurationSec = table.Column<double>(type: "float", nullable: true),
                    OriginalFileName = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                    UploadedByHumanId = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    CreatedScenarioTime = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    CreatedWallClock = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    PosterMediaAssetId = table.Column<Guid>(type: "uniqueidentifier", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MediaAssets", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MediaAssets_MediaAssets_PosterMediaAssetId",
                        column: x => x.PosterMediaAssetId,
                        principalTable: "MediaAssets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PostReactions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    PostId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    PersonaId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    CreatedScenarioTime = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    DeletedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PostReactions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PostReactions_Posts_PostId",
                        column: x => x.PostId,
                        principalTable: "Posts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PostMediaItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    PostId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    MediaAssetId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    PosterMediaAssetId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    Alt = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: false),
                    Order = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PostMediaItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PostMediaItems_MediaAssets_MediaAssetId",
                        column: x => x.MediaAssetId,
                        principalTable: "MediaAssets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PostMediaItems_MediaAssets_PosterMediaAssetId",
                        column: x => x.PosterMediaAssetId,
                        principalTable: "MediaAssets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PostMediaItems_Posts_PostId",
                        column: x => x.PostId,
                        principalTable: "Posts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Posts_ParentPostId",
                table: "Posts",
                column: "ParentPostId");

            migrationBuilder.CreateIndex(
                name: "IX_Personas_AvatarMediaId",
                table: "Personas",
                column: "AvatarMediaId");

            migrationBuilder.CreateIndex(
                name: "IX_Personas_BannerMediaId",
                table: "Personas",
                column: "BannerMediaId");

            migrationBuilder.CreateIndex(
                name: "IX_MediaAssets_BlobName",
                table: "MediaAssets",
                column: "BlobName",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MediaAssets_ExerciseId",
                table: "MediaAssets",
                column: "ExerciseId");

            migrationBuilder.CreateIndex(
                name: "IX_MediaAssets_PosterMediaAssetId",
                table: "MediaAssets",
                column: "PosterMediaAssetId");

            migrationBuilder.CreateIndex(
                name: "IX_PostMediaItems_ExerciseId",
                table: "PostMediaItems",
                column: "ExerciseId");

            migrationBuilder.CreateIndex(
                name: "IX_PostMediaItems_MediaAssetId",
                table: "PostMediaItems",
                column: "MediaAssetId");

            migrationBuilder.CreateIndex(
                name: "IX_PostMediaItems_PosterMediaAssetId",
                table: "PostMediaItems",
                column: "PosterMediaAssetId");

            migrationBuilder.CreateIndex(
                name: "IX_PostMediaItems_PostId_Order",
                table: "PostMediaItems",
                columns: MediaSlotKeyColumns,
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PostReactions_ExerciseId",
                table: "PostReactions",
                column: "ExerciseId");

            migrationBuilder.CreateIndex(
                name: "IX_PostReactions_PostId_PersonaId_Kind",
                table: "PostReactions",
                columns: ReactionKeyColumns,
                unique: true,
                filter: "[DeletedAt] IS NULL");

            migrationBuilder.AddForeignKey(
                name: "FK_Personas_MediaAssets_AvatarMediaId",
                table: "Personas",
                column: "AvatarMediaId",
                principalTable: "MediaAssets",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Personas_MediaAssets_BannerMediaId",
                table: "Personas",
                column: "BannerMediaId",
                principalTable: "MediaAssets",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Posts_Posts_ParentPostId",
                table: "Posts",
                column: "ParentPostId",
                principalTable: "Posts",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Personas_MediaAssets_AvatarMediaId",
                table: "Personas");

            migrationBuilder.DropForeignKey(
                name: "FK_Personas_MediaAssets_BannerMediaId",
                table: "Personas");

            migrationBuilder.DropForeignKey(
                name: "FK_Posts_Posts_ParentPostId",
                table: "Posts");

            migrationBuilder.DropTable(
                name: "PostMediaItems");

            migrationBuilder.DropTable(
                name: "PostReactions");

            migrationBuilder.DropTable(
                name: "MediaAssets");

            migrationBuilder.DropIndex(
                name: "IX_Posts_ParentPostId",
                table: "Posts");

            migrationBuilder.DropIndex(
                name: "IX_Personas_AvatarMediaId",
                table: "Personas");

            migrationBuilder.DropIndex(
                name: "IX_Personas_BannerMediaId",
                table: "Personas");

            migrationBuilder.DropColumn(
                name: "BaselineLikeCount",
                table: "Posts");

            migrationBuilder.DropColumn(
                name: "BaselineReplyCount",
                table: "Posts");

            migrationBuilder.DropColumn(
                name: "BaselineRepostCount",
                table: "Posts");

            migrationBuilder.DropColumn(
                name: "ParentPostId",
                table: "Posts");

            migrationBuilder.DropColumn(
                name: "AvatarMediaId",
                table: "Personas");

            migrationBuilder.DropColumn(
                name: "BannerMediaId",
                table: "Personas");

            migrationBuilder.DropColumn(
                name: "Location",
                table: "Personas");
        }
    }
}
