using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pulse.WebApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Exercises",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Exercises", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Personas",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    DisplayName = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Handle = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    PersonaTemplateId = table.Column<Guid>(type: "uniqueidentifier", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Personas", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PersonaTemplates",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    DisplayName = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Handle = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PersonaTemplates", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Posts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    AuthorPersonaId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Body = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    CreatedScenarioTime = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    RumorRef = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    MutationOf = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    DeletedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Posts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "TelemetryEvents",
                columns: table => new
                {
                    EventId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    SchemaVersion = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    EventType = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Channel = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Actor_Kind = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Actor_ParticipantId = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Actor_PersonaId = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Actor_ActingHumanId = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Actor_SessionId = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Actor_Role = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Origin = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    InjectId = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CorrelationId = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CausationId = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Sequence = table.Column<long>(type: "bigint", nullable: true),
                    Source = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    WallClockTime = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ScenarioTime = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    TimeZone = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Target_EntityType = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Target_EntityId = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Payload = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    EmittedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TelemetryEvents", x => x.EventId);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Personas_ExerciseId",
                table: "Personas",
                column: "ExerciseId");

            migrationBuilder.CreateIndex(
                name: "IX_Posts_ExerciseId",
                table: "Posts",
                column: "ExerciseId");

            migrationBuilder.CreateIndex(
                name: "IX_TelemetryEvents_ExerciseId",
                table: "TelemetryEvents",
                column: "ExerciseId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Exercises");

            migrationBuilder.DropTable(
                name: "Personas");

            migrationBuilder.DropTable(
                name: "PersonaTemplates");

            migrationBuilder.DropTable(
                name: "Posts");

            migrationBuilder.DropTable(
                name: "TelemetryEvents");
        }
    }
}
