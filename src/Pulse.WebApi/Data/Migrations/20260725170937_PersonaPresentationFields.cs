using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pulse.WebApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class PersonaPresentationFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AudienceBand",
                table: "Personas",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "nano");

            migrationBuilder.AddColumn<int>(
                name: "AudienceMagnitude",
                table: "Personas",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "Bio",
                table: "Personas",
                type: "nvarchar(512)",
                maxLength: 512,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "JoinedAt",
                table: "Personas",
                type: "datetimeoffset",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(2026, 6, 15, 12, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<string>(
                name: "PersonaType",
                table: "Personas",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "citizen");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AudienceBand",
                table: "Personas");

            migrationBuilder.DropColumn(
                name: "AudienceMagnitude",
                table: "Personas");

            migrationBuilder.DropColumn(
                name: "Bio",
                table: "Personas");

            migrationBuilder.DropColumn(
                name: "JoinedAt",
                table: "Personas");

            migrationBuilder.DropColumn(
                name: "PersonaType",
                table: "Personas");
        }
    }
}
