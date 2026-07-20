using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pulse.WebApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class PersonaKindVerified : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Kind",
                table: "Personas",
                type: "nvarchar(max)",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<bool>(
                name: "Verified",
                table: "Personas",
                type: "bit",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Kind",
                table: "Personas");

            migrationBuilder.DropColumn(
                name: "Verified",
                table: "Personas");
        }
    }
}
