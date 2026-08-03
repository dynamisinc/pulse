using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pulse.WebApi.Data.Migrations
{
    /// <summary>
    /// exercise-isolation/11 (Tier-2, COR-001 / COR-010) — the CUSTOMER tenant boundary above the exercise.
    /// Creates the <c>Organizations</c> table, seeds the well-known DEFAULT organization, and puts a
    /// non-nullable <c>OrganizationId</c> on the three org-owned tables (<c>Exercises</c>,
    /// <c>PersonaTemplates</c>, <c>StaffUsers</c>), backfilling every pre-existing row onto that default
    /// tenant.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Hand-edited away from the scaffolded shape, deliberately.</b> EF scaffolds
    /// <c>AddColumn(nullable: false, defaultValue: Guid.Empty)</c>, which would (a) home every existing row on
    /// the <c>Guid.Empty</c> sentinel that <c>GuardOrganizationScope</c> exists to reject and the read filters
    /// can never match — i.e. instantly orphan all of UAT/production — and (b) leave a permanent
    /// <c>DEFAULT</c> constraint of that same sentinel on the column, so any future raw-SQL insert that omits
    /// the tenant would silently create another unreachable orphan. Instead each column is added NULLABLE,
    /// backfilled, verified, and only then altered to <c>NOT NULL</c>, which leaves NO default constraint
    /// behind: from here on the tenant must always be stated explicitly.
    /// </para>
    /// <para>
    /// <b>Ordering is load-bearing.</b> The <c>Organizations</c> row must exist before the backfill points at
    /// it, and the backfill must complete before the <c>ALTER … NOT NULL</c>, or the alter fails on a
    /// populated table. There are deliberately no FOREIGN KEYs — consistent with the rest of this model
    /// ("Wave-0 deferred FKs"), where every cross-entity id is a plain indexed <c>uniqueidentifier</c>
    /// validated at the service layer.
    /// </para>
    /// <para>
    /// <b>The <c>THROW</c> pre-flight guard fails SAFELY.</b> The deploy applies migrations as an idempotent
    /// script with one transaction per migration, so a <c>THROW</c> raised here rolls this migration back
    /// whole — no half-applied tenant tier, no row recorded in <c>__EFMigrationsHistory</c>, and the deploy
    /// stops loudly. That is strictly better than the alternative failure mode: an <c>ALTER … NOT NULL</c>
    /// succeeding over rows that were quietly left on the empty sentinel.
    /// </para>
    /// <para>
    /// <b>Idempotent by construction.</b> The seed insert is <c>IF NOT EXISTS</c>-guarded on the fixed
    /// <c>Organization.DefaultOrganizationId</c>, and each backfill only touches <c>NULL</c>s — so a replay
    /// (e.g. <c>sqlcmd -I</c> against a partially-applied database) is a no-op rather than a duplicate tenant.
    /// </para>
    /// </remarks>
    public partial class OrganizationTenantBoundary : Migration
    {
        /// <summary>
        /// The fixed id of the default organization — kept in sync with
        /// <c>Pulse.WebApi.Data.Entities.Organization.DefaultOrganizationId</c>. Written out as a literal
        /// because a migration must describe the schema at a POINT IN TIME and must not drift if the constant
        /// is ever re-pointed; <c>OrganizationTenantBoundaryMigrationTests</c> asserts the two still agree.
        /// </summary>
        private const string DefaultOrganizationId = "9F2F0E26-6A1D-4C1E-9A54-1F0B4A3D7C80";

        /// <summary>The display name seeded for the default organization.</summary>
        private const string DefaultOrganizationName = "Default Organization";

        /// <summary>The fail-closed "no tenant" sentinel no org-owned row may carry.</summary>
        private const string EmptyTenantSentinel = "00000000-0000-0000-0000-000000000000";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 1. The tenant table + its unique-name index.
            migrationBuilder.CreateTable(
                name: "Organizations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Organizations", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Organizations_Name",
                table: "Organizations",
                column: "Name",
                unique: true);

            // 2. Seed the DEFAULT tenant every pre-existing row is backfilled onto. SYSDATETIMEOFFSET() is the
            //    server clock (never a client value), matching the server-authoritative stamping rule.
            migrationBuilder.Sql($"""
                IF NOT EXISTS (SELECT 1 FROM [Organizations] WHERE [Id] = '{DefaultOrganizationId}')
                BEGIN
                    INSERT INTO [Organizations] ([Id], [Name], [CreatedAt])
                    VALUES ('{DefaultOrganizationId}', N'{DefaultOrganizationName}', SYSDATETIMEOFFSET());
                END
                """);

            // 3. Add each tenant column NULLABLE (see the remarks: never defaulted to the empty sentinel).
            migrationBuilder.AddColumn<Guid>(
                name: "OrganizationId",
                table: "Exercises",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "OrganizationId",
                table: "PersonaTemplates",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "OrganizationId",
                table: "StaffUsers",
                type: "uniqueidentifier",
                nullable: true);

            // 4. Backfill the existing UAT/production data onto the default tenant. Single-customer is the
            //    documented operating assumption up to this migration, so one tenant is the correct and only
            //    truthful mapping — there is no per-row customer information in the model to split on.
            //    NULL-only, so a replay changes nothing.
            migrationBuilder.Sql($"""
                UPDATE [Exercises]        SET [OrganizationId] = '{DefaultOrganizationId}' WHERE [OrganizationId] IS NULL;
                UPDATE [PersonaTemplates] SET [OrganizationId] = '{DefaultOrganizationId}' WHERE [OrganizationId] IS NULL;
                UPDATE [StaffUsers]       SET [OrganizationId] = '{DefaultOrganizationId}' WHERE [OrganizationId] IS NULL;
                """);

            // 5. PRE-FLIGHT GUARD. Refuse to proceed if the backfill left anything unhomed, or homed on the
            //    Guid.Empty sentinel the write-guard / read-filters treat as "no tenant". Either would produce
            //    rows that satisfy NOT NULL yet are permanently unreachable by every org-bounded surface — a
            //    silent data-loss outcome. THROW rolls the whole migration back (see the remarks).
            migrationBuilder.Sql($"""
                IF EXISTS (
                    SELECT 1 FROM [Exercises]        WHERE [OrganizationId] IS NULL OR [OrganizationId] = '{EmptyTenantSentinel}'
                    UNION ALL
                    SELECT 1 FROM [PersonaTemplates] WHERE [OrganizationId] IS NULL OR [OrganizationId] = '{EmptyTenantSentinel}'
                    UNION ALL
                    SELECT 1 FROM [StaffUsers]       WHERE [OrganizationId] IS NULL OR [OrganizationId] = '{EmptyTenantSentinel}')
                BEGIN
                    THROW 50011, 'OrganizationTenantBoundary: an org-owned row was left without a usable OrganizationId after the backfill. Refusing to enforce NOT NULL over unreachable rows (exercise-isolation/11, COR-010).', 1;
                END
                """);

            // 6. Now the columns can honestly be NOT NULL — with no residual DEFAULT constraint.
            migrationBuilder.AlterColumn<Guid>(
                name: "OrganizationId",
                table: "Exercises",
                type: "uniqueidentifier",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uniqueidentifier",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "OrganizationId",
                table: "PersonaTemplates",
                type: "uniqueidentifier",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uniqueidentifier",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "OrganizationId",
                table: "StaffUsers",
                type: "uniqueidentifier",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uniqueidentifier",
                oldNullable: true);

            // 7. The tenant lookup indexes — created last, over the now-populated, non-nullable columns.
            migrationBuilder.CreateIndex(
                name: "IX_Exercises_OrganizationId",
                table: "Exercises",
                column: "OrganizationId");

            migrationBuilder.CreateIndex(
                name: "IX_PersonaTemplates_OrganizationId",
                table: "PersonaTemplates",
                column: "OrganizationId");

            migrationBuilder.CreateIndex(
                name: "IX_StaffUsers_OrganizationId",
                table: "StaffUsers",
                column: "OrganizationId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Exact reverse order. Dropping the columns discards the tenant assignment, which is lossless in
            // the single-customer state this migration is applied from; a rollback taken AFTER a second
            // customer exists would merge their data back into one undifferentiated set, so it must not be
            // treated as a routine operation once multi-customer go-live has happened.
            migrationBuilder.DropIndex(
                name: "IX_StaffUsers_OrganizationId",
                table: "StaffUsers");

            migrationBuilder.DropIndex(
                name: "IX_PersonaTemplates_OrganizationId",
                table: "PersonaTemplates");

            migrationBuilder.DropIndex(
                name: "IX_Exercises_OrganizationId",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "OrganizationId",
                table: "StaffUsers");

            migrationBuilder.DropColumn(
                name: "OrganizationId",
                table: "PersonaTemplates");

            migrationBuilder.DropColumn(
                name: "OrganizationId",
                table: "Exercises");

            migrationBuilder.DropTable(
                name: "Organizations");
        }
    }
}
