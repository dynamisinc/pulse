using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pulse.WebApi.Data.Migrations
{
    /// <summary>
    /// demo-feedback/01 — the feature's ONE migration (<c>docs/features/demo-feedback/implementation.md</c>, "Schema"):
    /// the exercise pin on <c>Posts</c> (DF-7), the MSEL import key on <c>InjectItems</c> (DF-10), the white-noise level on
    /// <c>Exercises</c> and the exercise-scoped <c>NoisePosts</c> pool (DF-12).
    /// </summary>
    /// <remarks>
    /// Purely additive and fully scaffolded: no <c>migrationBuilder.Sql(...)</c>, so nothing in the idempotent deploy
    /// script's single batch names a column before it exists (lesson #413). The two filtered indexes
    /// (<c>IX_Posts_ExerciseId_PinnedForAllAt</c> and the unique <c>IX_InjectItems_ExerciseId_ExternalRef</c>) name columns
    /// added in this same migration, and EF emits each inside <c>EXEC(N'…')</c> in the idempotent script, so the batch
    /// compiles. The one new <c>NOT NULL</c> column on an existing table, <c>Exercises.NoiseLevel</c>, carries
    /// <c>DEFAULT N'off'</c>, so existing exercises read <c>off</c> with no backfill; everything else added to an existing
    /// table is nullable. <c>NoisePosts</c> has no foreign key (its persona is a logical reference, house style).
    /// The column <c>Order</c> is a reserved word — EF brackets it; any raw SQL must write <c>[Order]</c>.
    /// </remarks>
    public partial class DemoFeedbackPinsNoiseImport : Migration
    {
        /// <summary>The exercise-pin read key, in order: scope, then pin instant (CA1861 — not an inline array).</summary>
        private static readonly string[] ExercisePinKeyColumns = ["ExerciseId", "PinnedForAllAt"];

        /// <summary>The MSEL import key, in order: scope, then the <c>Inject #</c> (CA1861 — not an inline array).</summary>
        private static readonly string[] ExternalRefKeyColumns = ["ExerciseId", "ExternalRef"];

        /// <summary>The noise pacer's least-posted-first key, in order: scope, use count, pool order (CA1861).</summary>
        private static readonly string[] NoisePoolKeyColumns = ["ExerciseId", "PostedCount", "Order"];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "PinnedForAllAt",
                table: "Posts",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PinnedForAllByHumanId",
                table: "Posts",
                type: "nvarchar(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ExternalRef",
                table: "InjectItems",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NoiseLevel",
                table: "Exercises",
                type: "nvarchar(8)",
                maxLength: 8,
                nullable: false,
                defaultValue: "off");

            migrationBuilder.CreateTable(
                name: "NoisePosts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    PersonaId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Text = table.Column<string>(type: "nvarchar(280)", maxLength: 280, nullable: false),
                    Order = table.Column<int>(type: "int", nullable: false),
                    PostedCount = table.Column<int>(type: "int", nullable: false, defaultValue: 0),
                    LastPostedWallClock = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    CreatedWallClock = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NoisePosts", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Posts_ExerciseId_PinnedForAllAt",
                table: "Posts",
                columns: ExercisePinKeyColumns,
                filter: "[PinnedForAllAt] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_InjectItems_ExerciseId_ExternalRef",
                table: "InjectItems",
                columns: ExternalRefKeyColumns,
                unique: true,
                filter: "[ExternalRef] IS NOT NULL AND [DeletedAt] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_NoisePosts_ExerciseId_PostedCount_Order",
                table: "NoisePosts",
                columns: NoisePoolKeyColumns);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NoisePosts");

            migrationBuilder.DropIndex(
                name: "IX_Posts_ExerciseId_PinnedForAllAt",
                table: "Posts");

            migrationBuilder.DropIndex(
                name: "IX_InjectItems_ExerciseId_ExternalRef",
                table: "InjectItems");

            migrationBuilder.DropColumn(
                name: "PinnedForAllAt",
                table: "Posts");

            migrationBuilder.DropColumn(
                name: "PinnedForAllByHumanId",
                table: "Posts");

            migrationBuilder.DropColumn(
                name: "ExternalRef",
                table: "InjectItems");

            migrationBuilder.DropColumn(
                name: "NoiseLevel",
                table: "Exercises");
        }
    }
}
