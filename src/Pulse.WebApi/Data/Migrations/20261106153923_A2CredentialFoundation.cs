using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pulse.WebApi.Data.Migrations
{
    /// <summary>
    /// identity-auth-roles/21 (#576, Tier-2: schema + security) — the ADMIN-IDENTITY-MODEL A2 wave's ONE migration (§9),
    /// cleared by the orchestrator: the <c>CredentialTokens</c> table (§3.3); the schema-only A2 columns
    /// <c>People.AvatarBlobName</c> (§4.2), <c>Exercises.SignInMethods</c> (§3.4) and <c>MediaAssets.UploadedByAccountId</c>
    /// (§4.1); and the XC-010 soft-delete revoke of an enrollment, <c>Enrollments.DeletedAt</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>No backfill, and every existing row satisfies every new rule by construction.</b> Each new column is nullable
    /// except <c>Exercises.SignInMethods</c>, which is added NOT NULL with the default 7 (all three methods — today's
    /// behaviour). <c>Enrollments.DeletedAt</c> is NULL on every existing row, so both rewritten filtered unique indexes
    /// (now also <c>[DeletedAt] IS NULL</c>) are strictly LOOSER than the ones they replace and cannot fail to build, and
    /// both new <c>Enrollments</c> CHECKs (<c>DeletedAt</c> only on a staff role, never on the lead) hold trivially.
    /// </para>
    /// <para>
    /// <b>Every CHECK naming a column this migration adds is hand-written inside <c>EXEC(N'…')</c> — load-bearing, do
    /// not unwrap</b> (OPERATE.md; the 2026-08-03 incident recorded on <c>OrganizationTenantBoundary</c>): in the
    /// idempotent deploy script a statement naming a column added earlier in the same batch can fail to compile, and
    /// then nothing runs. EF already emits the two filtered <c>CREATE INDEX</c> statements inside <c>EXEC</c> in that
    /// script (#413).
    /// </para>
    /// <para>
    /// <b>Down is reversible but not loss-free</b> (OPERATE.md "Rollback"): every issued invite / reset token is dropped
    /// (outstanding links stop working), staff avatar names and upload attribution are dropped, and every REVOKED
    /// (soft-deleted) enrollment row is hard-deleted first — which is exactly what a revoke did before this migration,
    /// and is required because the restored unfiltered unique index on <c>(ExerciseId, PersonId)</c> would otherwise
    /// collide with a re-grant of the same person.
    /// </para>
    /// </remarks>
    public partial class A2CredentialFoundation : Migration
    {
        private static readonly string[] EnrollmentPersonKeyColumns = ["ExerciseId", "PersonId"];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Enrollments_ExerciseId_Lead",
                table: "Enrollments");

            migrationBuilder.DropIndex(
                name: "IX_Enrollments_ExerciseId_PersonId",
                table: "Enrollments");

            migrationBuilder.AddColumn<string>(
                name: "AvatarBlobName",
                table: "People",
                type: "nvarchar(256)",
                maxLength: 256,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "UploadedByAccountId",
                table: "MediaAssets",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SignInMethods",
                table: "Exercises",
                type: "int",
                nullable: false,
                defaultValue: 7);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "DeletedAt",
                table: "Enrollments",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "CredentialTokens",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TokenHash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Purpose = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    PersonId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    AccountId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    OrganizationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UsedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    IssuedByPersonId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CredentialTokens", x => x.Id);
                    table.CheckConstraint("CK_CredentialTokens_OneSubject", "([PersonId] IS NOT NULL AND [AccountId] IS NULL) OR ([PersonId] IS NULL AND [AccountId] IS NOT NULL)");
                    table.CheckConstraint("CK_CredentialTokens_Purpose", "[Purpose] IN ('invite', 'reset')");
                    table.ForeignKey(
                        name: "FK_CredentialTokens_Accounts_AccountId",
                        column: x => x.AccountId,
                        principalTable: "Accounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CredentialTokens_Organizations_OrganizationId",
                        column: x => x.OrganizationId,
                        principalTable: "Organizations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CredentialTokens_People_IssuedByPersonId",
                        column: x => x.IssuedByPersonId,
                        principalTable: "People",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CredentialTokens_People_PersonId",
                        column: x => x.PersonId,
                        principalTable: "People",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_MediaAssets_UploadedByAccountId",
                table: "MediaAssets",
                column: "UploadedByAccountId");

            // Hand-written in EXEC (see the remarks): the CHECK names the column added above, in the same script batch.
            migrationBuilder.Sql(Exec("""
                ALTER TABLE [Exercises] ADD CONSTRAINT [CK_Exercises_SignInMethods] CHECK ([SignInMethods] >= 0 AND [SignInMethods] <= 7);
                """));

            migrationBuilder.CreateIndex(
                name: "IX_Enrollments_ExerciseId_Lead",
                table: "Enrollments",
                column: "ExerciseId",
                unique: true,
                filter: "[IsLead] = 1 AND [DeletedAt] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Enrollments_ExerciseId_PersonId",
                table: "Enrollments",
                columns: EnrollmentPersonKeyColumns,
                unique: true,
                filter: "[PersonId] IS NOT NULL AND [DeletedAt] IS NULL");

            // XC-010 soft delete: only a staff enrollment is ever revoked this way, and a revoked row is never the lead.
            migrationBuilder.Sql(Exec("""
                ALTER TABLE [Enrollments] ADD CONSTRAINT [CK_Enrollments_DeletedAt_NotLead] CHECK ([DeletedAt] IS NULL OR [IsLead] = 0);
                """));

            migrationBuilder.Sql(Exec("""
                ALTER TABLE [Enrollments] ADD CONSTRAINT [CK_Enrollments_DeletedAt_StaffOnly] CHECK ([DeletedAt] IS NULL OR [Role] IN ('planner', 'controller', 'evaluator'));
                """));

            migrationBuilder.CreateIndex(
                name: "IX_CredentialTokens_AccountId",
                table: "CredentialTokens",
                column: "AccountId");

            migrationBuilder.CreateIndex(
                name: "IX_CredentialTokens_IssuedByPersonId",
                table: "CredentialTokens",
                column: "IssuedByPersonId");

            migrationBuilder.CreateIndex(
                name: "IX_CredentialTokens_OrganizationId",
                table: "CredentialTokens",
                column: "OrganizationId");

            migrationBuilder.CreateIndex(
                name: "IX_CredentialTokens_PersonId",
                table: "CredentialTokens",
                column: "PersonId");

            migrationBuilder.CreateIndex(
                name: "IX_CredentialTokens_TokenHash",
                table: "CredentialTokens",
                column: "TokenHash",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_MediaAssets_Accounts_UploadedByAccountId",
                table: "MediaAssets",
                column: "UploadedByAccountId",
                principalTable: "Accounts",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // A revoked enrollment is hard-deleted, as a revoke did before this migration: the restored unfiltered unique
            // index on (ExerciseId, PersonId) would otherwise collide with a re-grant of the same person. Not loss-free.
            migrationBuilder.Sql(Exec("""
                DELETE FROM [Enrollments] WHERE [DeletedAt] IS NOT NULL;
                """));

            migrationBuilder.DropForeignKey(
                name: "FK_MediaAssets_Accounts_UploadedByAccountId",
                table: "MediaAssets");

            migrationBuilder.DropTable(
                name: "CredentialTokens");

            migrationBuilder.DropIndex(
                name: "IX_MediaAssets_UploadedByAccountId",
                table: "MediaAssets");

            migrationBuilder.Sql(Exec("""
                ALTER TABLE [Exercises] DROP CONSTRAINT IF EXISTS [CK_Exercises_SignInMethods];
                """));

            migrationBuilder.DropIndex(
                name: "IX_Enrollments_ExerciseId_Lead",
                table: "Enrollments");

            migrationBuilder.DropIndex(
                name: "IX_Enrollments_ExerciseId_PersonId",
                table: "Enrollments");

            migrationBuilder.Sql(Exec("""
                ALTER TABLE [Enrollments] DROP CONSTRAINT IF EXISTS [CK_Enrollments_DeletedAt_NotLead];
                """));

            migrationBuilder.Sql(Exec("""
                ALTER TABLE [Enrollments] DROP CONSTRAINT IF EXISTS [CK_Enrollments_DeletedAt_StaffOnly];
                """));

            migrationBuilder.DropColumn(
                name: "AvatarBlobName",
                table: "People");

            migrationBuilder.DropColumn(
                name: "UploadedByAccountId",
                table: "MediaAssets");

            migrationBuilder.DropColumn(
                name: "SignInMethods",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "DeletedAt",
                table: "Enrollments");

            migrationBuilder.CreateIndex(
                name: "IX_Enrollments_ExerciseId_Lead",
                table: "Enrollments",
                column: "ExerciseId",
                unique: true,
                filter: "[IsLead] = 1");

            migrationBuilder.CreateIndex(
                name: "IX_Enrollments_ExerciseId_PersonId",
                table: "Enrollments",
                columns: EnrollmentPersonKeyColumns,
                unique: true,
                filter: "[PersonId] IS NOT NULL");
        }

        /// <summary>
        /// Wraps hand-written SQL in <c>EXEC(N'…')</c> (quotes doubled) so it compiles only when it runs — see the
        /// remarks; never unwrap.
        /// </summary>
        private static string Exec(string sql) => $"EXEC(N'{sql.Replace("'", "''", StringComparison.Ordinal)}');";
    }
}
