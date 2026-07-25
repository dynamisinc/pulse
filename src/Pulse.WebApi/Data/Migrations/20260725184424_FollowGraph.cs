using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pulse.WebApi.Data.Migrations
{
    /// <summary>
    /// Adds the REAL follow graph — <c>profiles-social-graph/07</c>, SOC-051. One table of directed
    /// persona→persona edges, exercise-scoped (<c>IExerciseScoped</c>), so it inherits
    /// <c>PulseDbContext</c>'s central read filter + write guard with no per-query scoping (COR-001).
    /// </summary>
    /// <remarks>
    /// Purely additive: a new table plus its three indexes, no change to any existing column. The unique
    /// <c>(ExerciseId, FollowerPersonaId, FolloweePersonaId)</c> key is what makes following twice the SAME
    /// row rather than a duplicate; leading with the scope keeps the same ordered persona pair in two
    /// exercises two distinct, non-colliding edges.
    /// </remarks>
    public partial class FollowGraph : Migration
    {
        /// <summary>The unique edge key, in order: scope first, then follower, then followee (CA1861 — not an inline array).</summary>
        private static readonly string[] EdgeKeyColumns = ["ExerciseId", "FollowerPersonaId", "FolloweePersonaId"];

        /// <summary>The inbound-direction lookup key ("who follows persona X") — the profile/follower-count read.</summary>
        private static readonly string[] InboundKeyColumns = ["ExerciseId", "FolloweePersonaId"];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Follows",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    FollowerPersonaId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    FolloweePersonaId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CreatedScenarioTime = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    CreatedWallClock = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Follows", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Follows_ExerciseId",
                table: "Follows",
                column: "ExerciseId");

            migrationBuilder.CreateIndex(
                name: "IX_Follows_ExerciseId_FolloweePersonaId",
                table: "Follows",
                columns: InboundKeyColumns);

            migrationBuilder.CreateIndex(
                name: "IX_Follows_ExerciseId_FollowerPersonaId_FolloweePersonaId",
                table: "Follows",
                columns: EdgeKeyColumns,
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Follows");
        }
    }
}
