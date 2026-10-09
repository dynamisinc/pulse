using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pulse.WebApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class InjectQueueItems : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "InjectItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    Title = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    Notes = table.Column<string>(type: "nvarchar(1024)", maxLength: 1024, nullable: true),
                    PlannedMinute = table.Column<int>(type: "int", nullable: true),
                    AssigneeId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    BurstWindowSeconds = table.Column<int>(type: "int", nullable: true),
                    Order = table.Column<int>(type: "int", nullable: false),
                    Status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    Version = table.Column<int>(type: "int", nullable: false),
                    CreatedByHumanId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    FiredByHumanId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    FiredScenarioTime = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    DriverHumanId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    ReleasedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    ShiftSeconds = table.Column<double>(type: "float", nullable: false),
                    LastPublishedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    Error = table.Column<string>(type: "nvarchar(1024)", maxLength: 1024, nullable: true),
                    DeletedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InjectItems", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "InjectQueueStates",
                columns: table => new
                {
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Version = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InjectQueueStates", x => x.ExerciseId);
                });

            migrationBuilder.CreateTable(
                name: "InjectItemPosts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    InjectItemId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Sequence = table.Column<int>(type: "int", nullable: false),
                    PersonaId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Text = table.Column<string>(type: "nvarchar(1024)", maxLength: 1024, nullable: false),
                    ReplyToInjectPostId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    ReplyToPostId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    BaselineLike = table.Column<int>(type: "int", nullable: true),
                    BaselineRepost = table.Column<int>(type: "int", nullable: true),
                    BaselineReply = table.Column<int>(type: "int", nullable: true),
                    Status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    DueOffsetSeconds = table.Column<int>(type: "int", nullable: true),
                    ClaimedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    ClaimEventId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    ClaimAction = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: true),
                    ClaimActorId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    FiredPostId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    FiredScenarioTime = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    FiredWallClock = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    FiredByHumanId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    Error = table.Column<string>(type: "nvarchar(1024)", maxLength: 1024, nullable: true),
                    DeletedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    Media = table.Column<string>(type: "nvarchar(max)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InjectItemPosts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_InjectItemPosts_InjectItems_InjectItemId",
                        column: x => x.InjectItemId,
                        principalTable: "InjectItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_InjectItemPosts_ExerciseId",
                table: "InjectItemPosts",
                column: "ExerciseId");

            migrationBuilder.CreateIndex(
                name: "IX_InjectItemPosts_InjectItemId",
                table: "InjectItemPosts",
                column: "InjectItemId");

            migrationBuilder.CreateIndex(
                name: "IX_InjectItems_ExerciseId",
                table: "InjectItems",
                column: "ExerciseId");

            migrationBuilder.CreateIndex(
                name: "IX_InjectItems_Status",
                table: "InjectItems",
                column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "InjectItemPosts");

            migrationBuilder.DropTable(
                name: "InjectQueueStates");

            migrationBuilder.DropTable(
                name: "InjectItems");
        }
    }
}
