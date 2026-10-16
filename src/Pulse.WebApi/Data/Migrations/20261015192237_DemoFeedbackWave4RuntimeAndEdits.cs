using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pulse.WebApi.Data.Migrations
{
    /// <summary>
    /// demo-feedback/17 — Wave 4's ONE migration (<c>docs/features/demo-feedback/WAVE-4.md</c>, "Schema"): the per-exercise
    /// <c>ExerciseRuntimeStates</c> row that lets the pause tier, scenario clock and holding page survive a restart
    /// (DF-24..DF-27), edit tracking on <c>Posts</c> (<c>EditCount</c>, <c>LastEditedAt</c>, <c>LastEditedScenarioTime</c>)
    /// and the exercise-scoped <c>PostEdits</c> history (DF-29..DF-31).
    /// </summary>
    /// <remarks>
    /// Purely additive and fully scaffolded: no <c>migrationBuilder.Sql(...)</c> and no filtered index, so nothing in the
    /// idempotent deploy script's single batch names a column before it exists (lesson #413). The one new <c>NOT NULL</c>
    /// column on an existing table, <c>Posts.EditCount</c>, carries <c>DEFAULT 0</c>, so existing posts read "never edited"
    /// with no backfill; the two last-edit instants are nullable. <c>ExerciseRuntimeStates</c> is keyed by its exercise
    /// (<c>Restrict</c> FK to <c>Exercises</c>); <c>PostEdits.PostId</c> is a <c>Restrict</c> FK to <c>Posts</c>. Every FK
    /// is <c>Restrict</c> (XC-010).
    /// </remarks>
    public partial class DemoFeedbackWave4RuntimeAndEdits : Migration
    {
        /// <summary>The one-row-per-edit key, in order: post, then edit number (CA1861 — not an inline array).</summary>
        private static readonly string[] PostEditKeyColumns = ["PostId", "EditNumber"];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "EditCount",
                table: "Posts",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "LastEditedAt",
                table: "Posts",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "LastEditedScenarioTime",
                table: "Posts",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ExerciseRuntimeStates",
                columns: table => new
                {
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    PauseTier = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false, defaultValue: "running"),
                    ClockScenarioStart = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    ClockTimeZone = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    ClockElapsedAtAnchorTicks = table.Column<long>(type: "bigint", nullable: true),
                    ClockWallAnchorUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    ClockFrozen = table.Column<bool>(type: "bit", nullable: false, defaultValue: false),
                    OverlayState = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false, defaultValue: "none"),
                    OverlayRegister = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: true),
                    OverlayMessage = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    OverlaySequence = table.Column<long>(type: "bigint", nullable: false, defaultValue: 0L),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExerciseRuntimeStates", x => x.ExerciseId);
                    table.ForeignKey(
                        name: "FK_ExerciseRuntimeStates_Exercises_ExerciseId",
                        column: x => x.ExerciseId,
                        principalTable: "Exercises",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PostEdits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    PostId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    EditNumber = table.Column<int>(type: "int", nullable: false),
                    PreviousBody = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    EditedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    EditedScenarioTime = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ActingHumanId = table.Column<string>(type: "nvarchar(max)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PostEdits", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PostEdits_Posts_PostId",
                        column: x => x.PostId,
                        principalTable: "Posts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PostEdits_ExerciseId",
                table: "PostEdits",
                column: "ExerciseId");

            migrationBuilder.CreateIndex(
                name: "IX_PostEdits_PostId_EditNumber",
                table: "PostEdits",
                columns: PostEditKeyColumns,
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ExerciseRuntimeStates");

            migrationBuilder.DropTable(
                name: "PostEdits");

            migrationBuilder.DropColumn(
                name: "EditCount",
                table: "Posts");

            migrationBuilder.DropColumn(
                name: "LastEditedAt",
                table: "Posts");

            migrationBuilder.DropColumn(
                name: "LastEditedScenarioTime",
                table: "Posts");
        }
    }
}
