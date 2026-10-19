using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pulse.WebApi.Data.Migrations
{
    /// <summary>
    /// engine-runtime/08 (CLK-3): the <c>(ExerciseId, CreatedScenarioTime)</c> index on <c>Posts</c> that serves the
    /// scenario-now resolver's <c>MAX(CreatedScenarioTime) WHERE ExerciseId = @id</c> as one seek per exercise. Up only
    /// creates it; Down only drops it. No column, data or other index changes.
    /// </summary>
    public partial class EngineRuntimeScenarioNowPostIndex : Migration
    {
        /// <summary>The index key, in order: scope first, then scenario time (CA1861 — not an inline array).</summary>
        private static readonly string[] IndexKeyColumns = ["ExerciseId", "CreatedScenarioTime"];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_Posts_ExerciseId_CreatedScenarioTime",
                table: "Posts",
                columns: IndexKeyColumns);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Posts_ExerciseId_CreatedScenarioTime",
                table: "Posts");
        }
    }
}
