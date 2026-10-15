using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pulse.WebApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class EasyLoginSchema : Migration
    {
        /// <summary>The one-word-per-local-date key, in order: scope first, then the date (CA1861 — not an inline array).</summary>
        private static readonly string[] DayWordKeyColumns = ["ExerciseId", "ForDate"];

        /// <summary>The one-link-per-account key, in order: scope first, then the account (CA1861 — not an inline array).</summary>
        private static readonly string[] LinkKeyColumns = ["ExerciseId", "AccountId"];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Agency",
                table: "Accounts",
                type: "nvarchar(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "DisabledAt",
                table: "Accounts",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Email",
                table: "Accounts",
                type: "nvarchar(254)",
                maxLength: 254,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "JobRole",
                table: "Accounts",
                type: "nvarchar(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "PersonaAutoCreated",
                table: "Accounts",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "ExerciseDayWords",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ForDate = table.Column<DateOnly>(type: "date", nullable: false),
                    WordHash = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    SetAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    SetByStaffUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ReplacedCount = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExerciseDayWords", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ParticipantLinks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    AccountId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TokenHash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ProtectedToken = table.Column<string>(type: "nvarchar(512)", maxLength: 512, nullable: true),
                    Generation = table.Column<int>(type: "int", nullable: false),
                    IssuedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    IssuedByStaffUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    RevokedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    RevokedByStaffUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    LastUsedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    UseCount = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ParticipantLinks", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ExerciseDayWords_ExerciseId_ForDate",
                table: "ExerciseDayWords",
                columns: DayWordKeyColumns,
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantLinks_ExerciseId_AccountId",
                table: "ParticipantLinks",
                columns: LinkKeyColumns,
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantLinks_TokenHash",
                table: "ParticipantLinks",
                column: "TokenHash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ExerciseDayWords");

            migrationBuilder.DropTable(
                name: "ParticipantLinks");

            migrationBuilder.DropColumn(
                name: "Agency",
                table: "Accounts");

            migrationBuilder.DropColumn(
                name: "DisabledAt",
                table: "Accounts");

            migrationBuilder.DropColumn(
                name: "Email",
                table: "Accounts");

            migrationBuilder.DropColumn(
                name: "JobRole",
                table: "Accounts");

            migrationBuilder.DropColumn(
                name: "PersonaAutoCreated",
                table: "Accounts");
        }
    }
}
