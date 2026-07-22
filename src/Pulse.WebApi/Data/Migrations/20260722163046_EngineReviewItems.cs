using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pulse.WebApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class EngineReviewItems : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "EngineReviewItems",
                columns: table => new
                {
                    DraftId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    StorylineId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    RoutedAtLevel = table.Column<int>(type: "int", nullable: false),
                    Disposition = table.Column<int>(type: "int", nullable: false),
                    CountdownStartedScenarioMinute = table.Column<int>(type: "int", nullable: true),
                    CountdownMinutes = table.Column<int>(type: "int", nullable: true),
                    CountdownDecision = table.Column<int>(type: "int", nullable: true),
                    StorylineTag = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    StorylineBrief = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    ActionLabel = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Posts = table.Column<string>(type: "nvarchar(max)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EngineReviewItems", x => x.DraftId);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EngineReviewItems_ExerciseId",
                table: "EngineReviewItems",
                column: "ExerciseId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EngineReviewItems");
        }
    }
}
