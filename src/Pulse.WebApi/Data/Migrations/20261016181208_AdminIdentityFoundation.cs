﻿using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pulse.WebApi.Data.Migrations
{
    /// <summary>
    /// identity-auth-roles/16 (#572, Tier-2: schema + isolation) — the ADMIN-IDENTITY-MODEL A1 foundation (§9), in ONE
    /// migration cleared by the orchestrator: <c>People</c> with the shared-key <c>StaffUsers</c> facet;
    /// <c>Organizations.Slug</c>; <c>Enrollments</c> replacing <c>StaffAssignments</c> and re-homing
    /// <c>Accounts.Role</c>/<c>Accounts.PersonaId</c>; the orgAdmin move to <c>People.OrgRole</c>; the
    /// <c>Sessions</c> org-scope / person / origin columns; the lead-controller backfill; <c>LoginChoices</c>(+<c>Candidates</c>);
    /// <c>OrgAuditEvents</c>; and <c>Exercises.FirstLiveAt</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Hand-edited away from the scaffolded shape, deliberately.</b> EF scaffolded drop-then-add, which would have
    /// discarded every staff assignment and every account's role and persona, and would have added
    /// <c>Accounts.EnrollmentId</c> / <c>Organizations.Slug</c> as NOT NULL with a <c>Guid.Empty</c> / empty-string
    /// default — the orphan sentinels the write-guards exist to refuse. Instead every new required column is added
    /// NULLABLE, backfilled, checked by a <c>THROW</c> pre-flight guard, and only then made NOT NULL (no default
    /// constraint is left behind), and the old tables/columns are dropped only after their data has moved.
    /// </para>
    /// <para>
    /// <b>The backfills.</b> One <c>Person</c> per <c>StaffUser</c>, SAME id (legacy rows have a null email until
    /// invited). Every <c>StaffAssignment</c> becomes an <c>Enrollment</c> with the SAME id; an <c>orgAdmin</c>
    /// assignment becomes a <c>planner</c> enrollment and sets <c>People.OrgRole = 'orgAdmin'</c> (so the person keeps
    /// the access they have today). An assignment whose staff user no longer exists is NOT migrated: it could never
    /// be used (staff login resolves the staff user first) and it has no person to belong to. One <c>Enrollment</c>
    /// per <c>Account</c> (role and persona copied; the enrollment reuses the ACCOUNT's id, so the backfill is
    /// deterministic and a Down→Up replay converges). <c>Organizations.Slug</c> from <c>Name</c> by the same rule as
    /// <c>OrganizationSlug.FromName</c>, suffixed <c>-2</c>, <c>-3</c>… on collision. <c>Exercises.FirstLiveAt</c>:
    /// for an exercise past <c>staged</c> (live/paused/completed/archived, and the legacy active/complete) it is NEVER
    /// null — the first lifecycle transition to <c>live</c>, else the <c>exercise.bootstrapped</c> event (bootstrap
    /// creates exercises directly in <c>live</c>), else the earliest post, else <c>CreatedAt</c>, else the migration
    /// time (the older ExerciseConfiguration migration mapped <c>active</c>→<c>live</c> with no event); a
    /// build/staged exercise is set only if a transition-to-live event exists. <c>Enrollments.IsLead</c> on exactly one controller per exercise that
    /// has any: the earliest-created, tiebreak the lowest id. <c>Sessions.PersonId</c> = <c>StaffUserId</c> for staff sessions.
    /// Live sessions carrying the retired exercise role <c>orgAdmin</c> are REVOKED: the grant they were minted from
    /// changed (§1.1 "revoking a grant revokes the sessions built on it"), and <c>orgAdmin</c> with an exercise
    /// scope is no longer a valid session shape.
    /// </para>
    /// <para>
    /// <b>Every hand-written statement is wrapped in <c>EXEC(N'…')</c> — load-bearing, do not unwrap</b> (OPERATE.md;
    /// the 2026-08-03 incident recorded on <c>OrganizationTenantBoundary</c>): in the idempotent deploy script a
    /// statement naming a column added earlier in the same batch fails to compile and nothing runs. A <c>THROW</c>
    /// inside an <c>EXEC</c> still aborts the batch and rolls the whole migration back.
    /// </para>
    /// <para>
    /// <b>Down is reversible but not loss-free</b> (OPERATE.md "Rollback"). It restores <c>StaffAssignments</c> (same
    /// ids) from the staff enrollments and <c>Accounts.Role</c>/<c>PersonaId</c> from their enrollments. A planner
    /// enrollment of a person whose <c>OrgRole</c> is <c>orgAdmin</c> is restored as <c>orgAdmin</c> (the access that
    /// person held before), so a planner who was ALSO an org admin collapses to orgAdmin. Org-scope sessions
    /// (no exercise) are deleted, because the restored column is NOT NULL and they have no exercise to point at.
    /// Data that only exists from A1 on (people's emails/passwords, org audit, login choices, slugs, FirstLiveAt) is
    /// dropped.
    /// </para>
    /// </remarks>
    public partial class AdminIdentityFoundation : Migration
    {
        private static readonly string[] EnrollmentPersonKeyColumns = ["ExerciseId", "PersonId"];
        private static readonly string[] PersonEmailKeyColumns = ["OrganizationId", "Email"];
        private static readonly string[] OrgAuditKeyColumns = ["OrganizationId", "OccurredAt"];
        private static readonly string[] StaffAssignmentKeyColumns = ["StaffUserId", "ExerciseId"];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ---------------------------------------------------------------------------------------------------
            // 1. People + the shared-key StaffUsers facet.
            // ---------------------------------------------------------------------------------------------------
            migrationBuilder.CreateTable(
                name: "People",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Email = table.Column<string>(type: "nvarchar(254)", maxLength: 254, nullable: true),
                    DisplayName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    PasswordHash = table.Column<string>(type: "nvarchar(512)", maxLength: 512, nullable: true),
                    PasswordChangedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    FailedLoginCount = table.Column<int>(type: "int", nullable: false, defaultValue: 0),
                    LockedOutUntil = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    OrgRole = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    DisabledAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_People", x => x.Id);
                    table.CheckConstraint("CK_People_OrgRole", "[OrgRole] IS NULL OR [OrgRole] = 'orgAdmin'");
                });

            migrationBuilder.CreateIndex(
                name: "IX_People_OrganizationId",
                table: "People",
                column: "OrganizationId");

            migrationBuilder.CreateIndex(
                name: "IX_People_OrganizationId_Email",
                table: "People",
                columns: PersonEmailKeyColumns,
                unique: true,
                filter: "[Email] IS NOT NULL");

            // One person per staff user, SAME id and tenant; no email until invited (A2). Idempotent (NOT EXISTS).
            migrationBuilder.Sql(Exec("""
                INSERT INTO [People] ([Id], [OrganizationId], [Email], [DisplayName], [FailedLoginCount], [CreatedAt])
                SELECT su.[Id], su.[OrganizationId], NULL, LEFT(su.[DisplayName], 200), 0, su.[CreatedAt]
                FROM [StaffUsers] su
                WHERE NOT EXISTS (SELECT 1 FROM [People] p WHERE p.[Id] = su.[Id]);
                """));

            // The org-admin grant moves to the person (§1.1). CI collation: a hand-seeded 'orgadmin' counts too.
            migrationBuilder.Sql(Exec("""
                UPDATE p SET [OrgRole] = 'orgAdmin'
                FROM [People] p
                WHERE EXISTS (SELECT 1 FROM [StaffAssignments] sa WHERE sa.[StaffUserId] = p.[Id] AND sa.[Role] = 'orgAdmin');
                """));

            migrationBuilder.AddForeignKey(
                name: "FK_StaffUsers_People_Id",
                table: "StaffUsers",
                column: "Id",
                principalTable: "People",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            // ---------------------------------------------------------------------------------------------------
            // 2. Organizations.Slug (nullable → backfill → guard → NOT NULL → unique).
            // ---------------------------------------------------------------------------------------------------
            migrationBuilder.AddColumn<string>(
                name: "Slug",
                table: "Organizations",
                type: "nvarchar(63)",
                maxLength: 63,
                nullable: true);

            migrationBuilder.Sql(Exec("""
                DECLARE @id uniqueidentifier, @name nvarchar(200), @base nvarchar(63), @slug nvarchar(63);
                DECLARE @i int, @len int, @c nchar(1), @dash bit, @n int, @suffix nvarchar(12);
                DECLARE org_slug_cursor CURSOR LOCAL FAST_FORWARD FOR
                    SELECT [Id], [Name] FROM [Organizations] WHERE [Slug] IS NULL ORDER BY [CreatedAt], [Id];
                OPEN org_slug_cursor;
                FETCH NEXT FROM org_slug_cursor INTO @id, @name;
                WHILE @@FETCH_STATUS = 0
                BEGIN
                    SET @base = N''; SET @dash = 0; SET @i = 1; SET @len = LEN(@name);
                    WHILE @i <= @len AND LEN(@base) < 63
                    BEGIN
                        SET @c = SUBSTRING(@name, @i, 1);
                        IF @c COLLATE Latin1_General_BIN LIKE N'[A-Za-z0-9]'
                        BEGIN
                            SET @base = @base + LOWER(@c); SET @dash = 0;
                        END
                        ELSE IF @dash = 0 AND LEN(@base) > 0
                        BEGIN
                            SET @base = @base + N'-'; SET @dash = 1;
                        END
                        SET @i = @i + 1;
                    END
                    WHILE LEN(@base) > 0 AND RIGHT(@base, 1) = N'-'
                        SET @base = LEFT(@base, LEN(@base) - 1);
                    IF LEN(@base) = 0 SET @base = N'org';
                    SET @slug = @base; SET @n = 2;
                    WHILE EXISTS (SELECT 1 FROM [Organizations] WHERE [Slug] = @slug)
                    BEGIN
                        SET @suffix = N'-' + CAST(@n AS nvarchar(10));
                        SET @slug = LEFT(@base, 63 - LEN(@suffix)) + @suffix;
                        SET @n = @n + 1;
                    END
                    UPDATE [Organizations] SET [Slug] = @slug WHERE [Id] = @id;
                    FETCH NEXT FROM org_slug_cursor INTO @id, @name;
                END
                CLOSE org_slug_cursor;
                DEALLOCATE org_slug_cursor;
                """));

            migrationBuilder.Sql(Exec("""
                IF EXISTS (SELECT 1 FROM [Organizations] WHERE [Slug] IS NULL OR [Slug] = N'')
                    THROW 50016, 'AdminIdentityFoundation: an organization was left without a slug after the backfill (identity-auth-roles/16).', 1;
                """));

            migrationBuilder.AlterColumn<string>(
                name: "Slug",
                table: "Organizations",
                type: "nvarchar(63)",
                maxLength: 63,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(63)",
                oldMaxLength: 63,
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Organizations_Slug",
                table: "Organizations",
                column: "Slug",
                unique: true);

            // ---------------------------------------------------------------------------------------------------
            // 3. Exercises.FirstLiveAt (backfilled from lifecycle telemetry for exercises past staged).
            // ---------------------------------------------------------------------------------------------------
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "FirstLiveAt",
                table: "Exercises",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.Sql(Exec("""
                UPDATE e SET [FirstLiveAt] = CASE
                    WHEN e.[Status] IN ('live', 'paused', 'completed', 'archived', 'active', 'complete') THEN COALESCE(
                        (SELECT MIN(t.[WallClockTime]) FROM [TelemetryEvents] t
                         WHERE t.[ExerciseId] = e.[Id]
                           AND t.[EventType] = 'exercise.lifecycle.transitioned'
                           AND (CASE WHEN ISJSON(t.[Payload]) = 1 THEN JSON_VALUE(t.[Payload], '$.to') END) IN ('live', 'active')),
                        (SELECT MIN(t.[WallClockTime]) FROM [TelemetryEvents] t
                         WHERE t.[ExerciseId] = e.[Id] AND t.[EventType] = 'exercise.bootstrapped'),
                        (SELECT MIN(p.[CreatedWallClock]) FROM [Posts] p WHERE p.[ExerciseId] = e.[Id]),
                        e.[CreatedAt],
                        SYSDATETIMEOFFSET())
                    ELSE
                        (SELECT MIN(t.[WallClockTime]) FROM [TelemetryEvents] t
                         WHERE t.[ExerciseId] = e.[Id]
                           AND t.[EventType] = 'exercise.lifecycle.transitioned'
                           AND (CASE WHEN ISJSON(t.[Payload]) = 1 THEN JSON_VALUE(t.[Payload], '$.to') END) IN ('live', 'active'))
                    END
                FROM [Exercises] e
                WHERE e.[FirstLiveAt] IS NULL;
                """));

            // ---------------------------------------------------------------------------------------------------
            // 4. Enrollments (replaces StaffAssignments; re-homes Accounts.Role / Accounts.PersonaId).
            // ---------------------------------------------------------------------------------------------------
            migrationBuilder.CreateTable(
                name: "Enrollments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    PersonId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    Role = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PersonaId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    IsLead = table.Column<bool>(type: "bit", nullable: false, defaultValue: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Enrollments", x => x.Id);
                    table.CheckConstraint("CK_Enrollments_IsLead_ControllerOnly", "[IsLead] = 0 OR [Role] = 'controller'");
                    table.CheckConstraint("CK_Enrollments_PersonaId_ParticipantRolesOnly", "[PersonaId] IS NULL OR [Role] IN ('participant', 'pio')");
                    table.CheckConstraint("CK_Enrollments_Role", "[Role] IN ('planner', 'controller', 'evaluator', 'participant', 'pio')");
                    table.ForeignKey(
                        name: "FK_Enrollments_People_PersonId",
                        column: x => x.PersonId,
                        principalTable: "People",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Enrollments_ExerciseId",
                table: "Enrollments",
                column: "ExerciseId");

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

            migrationBuilder.CreateIndex(
                name: "IX_Enrollments_PersonId",
                table: "Enrollments",
                column: "PersonId");

            // PRE-FLIGHT: every role being moved must land in the new vocabulary (orgAdmin maps to planner), so the
            // check constraint can never be what fails the deploy halfway — refuse loudly instead.
            migrationBuilder.Sql(Exec("""
                IF EXISTS (
                    SELECT 1 FROM [StaffAssignments] sa
                    WHERE EXISTS (SELECT 1 FROM [StaffUsers] su WHERE su.[Id] = sa.[StaffUserId])
                      AND sa.[Role] NOT IN ('planner', 'controller', 'evaluator', 'orgAdmin')
                    UNION ALL
                    SELECT 1 FROM [Accounts] a WHERE a.[Role] NOT IN ('participant', 'pio', 'planner', 'controller', 'evaluator', 'orgAdmin'))
                    THROW 50017, 'AdminIdentityFoundation: a staff assignment or account carries a role outside the enrollment vocabulary (identity-auth-roles/16). Fix the row, then re-run.', 1;
                """));

            // Every staff assignment → an enrollment with the SAME id (orgAdmin → planner). Orphans are skipped.
            migrationBuilder.Sql(Exec("""
                INSERT INTO [Enrollments] ([Id], [ExerciseId], [PersonId], [Role], [PersonaId], [IsLead], [CreatedAt])
                SELECT sa.[Id], sa.[ExerciseId], sa.[StaffUserId],
                       CASE WHEN sa.[Role] = 'orgAdmin' THEN 'planner' ELSE LOWER(sa.[Role]) END,
                       NULL, 0, sa.[CreatedAt]
                FROM [StaffAssignments] sa
                WHERE EXISTS (SELECT 1 FROM [People] p WHERE p.[Id] = sa.[StaffUserId])
                  AND NOT EXISTS (SELECT 1 FROM [Enrollments] e WHERE e.[Id] = sa.[Id]);
                """));

            // The lead controller (Tom, 2026-10-16): every exercise that has any controller gets exactly one lead — the
            // earliest-created controller enrollment, tiebreak the lowest Id (SQL Server uniqueidentifier order).
            // Idempotent: an exercise that already has a lead is left alone.
            migrationBuilder.Sql(Exec("""
                UPDATE e SET [IsLead] = 1
                FROM [Enrollments] e
                WHERE e.[Id] = (SELECT TOP (1) c.[Id] FROM [Enrollments] c
                                WHERE c.[ExerciseId] = e.[ExerciseId] AND c.[Role] = 'controller'
                                ORDER BY c.[CreatedAt], c.[Id])
                  AND NOT EXISTS (SELECT 1 FROM [Enrollments] l WHERE l.[ExerciseId] = e.[ExerciseId] AND l.[IsLead] = 1);
                """));

            // One enrollment per account (the enrollment reuses the account id). A persona is copied only onto a
            // participant-world role: the check constraint refuses one on a staff role.
            migrationBuilder.AddColumn<Guid>(
                name: "EnrollmentId",
                table: "Accounts",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.Sql(Exec("""
                INSERT INTO [Enrollments] ([Id], [ExerciseId], [PersonId], [Role], [PersonaId], [IsLead], [CreatedAt])
                SELECT a.[Id], a.[ExerciseId], NULL,
                       CASE WHEN a.[Role] = 'orgAdmin' THEN 'planner' ELSE LOWER(a.[Role]) END,
                       CASE WHEN a.[Role] IN ('participant', 'pio') THEN a.[PersonaId] ELSE NULL END,
                       0, a.[CreatedAt]
                FROM [Accounts] a
                WHERE a.[EnrollmentId] IS NULL
                  AND NOT EXISTS (SELECT 1 FROM [Enrollments] e WHERE e.[Id] = a.[Id]);
                UPDATE [Accounts] SET [EnrollmentId] = [Id] WHERE [EnrollmentId] IS NULL;
                """));

            migrationBuilder.Sql(Exec("""
                IF EXISTS (
                    SELECT 1 FROM [Accounts] a
                    WHERE a.[EnrollmentId] IS NULL
                       OR a.[EnrollmentId] = '00000000-0000-0000-0000-000000000000'
                       OR NOT EXISTS (SELECT 1 FROM [Enrollments] e WHERE e.[Id] = a.[EnrollmentId] AND e.[ExerciseId] = a.[ExerciseId]))
                    THROW 50018, 'AdminIdentityFoundation: an account was left without an enrollment in its own exercise after the backfill (identity-auth-roles/16).', 1;
                """));

            migrationBuilder.AlterColumn<Guid>(
                name: "EnrollmentId",
                table: "Accounts",
                type: "uniqueidentifier",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uniqueidentifier",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Accounts_EnrollmentId",
                table: "Accounts",
                column: "EnrollmentId",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Accounts_Enrollments_EnrollmentId",
                table: "Accounts",
                column: "EnrollmentId",
                principalTable: "Enrollments",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            // The data has moved: drop the old homes.
            migrationBuilder.DropColumn(
                name: "PersonaId",
                table: "Accounts");

            migrationBuilder.DropColumn(
                name: "Role",
                table: "Accounts");

            migrationBuilder.DropTable(
                name: "StaffAssignments");

            // ---------------------------------------------------------------------------------------------------
            // 5. Sessions: nullable ExerciseId (NULL = org scope), PersonId, Origin. (No lead column: Session.isLead is
            //    read live from the enrollment.)
            // ---------------------------------------------------------------------------------------------------
            migrationBuilder.AlterColumn<Guid>(
                name: "ExerciseId",
                table: "Sessions",
                type: "uniqueidentifier",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uniqueidentifier");

            migrationBuilder.AddColumn<string>(
                name: "Origin",
                table: "Sessions",
                type: "nvarchar(256)",
                maxLength: 256,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "PersonId",
                table: "Sessions",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.Sql(Exec("""
                UPDATE [Sessions] SET [PersonId] = [StaffUserId] WHERE [PersonId] IS NULL AND [StaffUserId] IS NOT NULL;
                UPDATE [Sessions] SET [RevokedAt] = SYSDATETIMEOFFSET() WHERE [Role] = 'orgAdmin' AND [RevokedAt] IS NULL;
                """));

            migrationBuilder.CreateIndex(
                name: "IX_Sessions_PersonId",
                table: "Sessions",
                column: "PersonId");

            // ---------------------------------------------------------------------------------------------------
            // 6. LoginChoices + LoginChoiceCandidates (slugless org choice, §1.2) and OrgAuditEvents (§7.5).
            // ---------------------------------------------------------------------------------------------------
            migrationBuilder.CreateTable(
                name: "LoginChoices",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TokenHash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ConsumedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    CreatedFromIpHash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LoginChoices", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_LoginChoices_TokenHash",
                table: "LoginChoices",
                column: "TokenHash",
                unique: true);

            migrationBuilder.CreateTable(
                name: "LoginChoiceCandidates",
                columns: table => new
                {
                    ChoiceId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    PersonId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LoginChoiceCandidates", x => new { x.ChoiceId, x.PersonId });
                    table.ForeignKey(
                        name: "FK_LoginChoiceCandidates_LoginChoices_ChoiceId",
                        column: x => x.ChoiceId,
                        principalTable: "LoginChoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_LoginChoiceCandidates_People_PersonId",
                        column: x => x.PersonId,
                        principalTable: "People",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_LoginChoiceCandidates_PersonId",
                table: "LoginChoiceCandidates",
                column: "PersonId");

            migrationBuilder.CreateTable(
                name: "OrgAuditEvents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Outcome = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ActorPersonId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    SubjectPersonId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    Payload = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    OccurredAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrgAuditEvents", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_OrgAuditEvents_OrganizationId_OccurredAt",
                table: "OrgAuditEvents",
                columns: OrgAuditKeyColumns);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // 6. The A1-only tables.
            migrationBuilder.DropTable(
                name: "OrgAuditEvents");

            migrationBuilder.DropTable(
                name: "LoginChoiceCandidates");

            migrationBuilder.DropTable(
                name: "LoginChoices");

            // 5. Sessions: org-scope sessions have no exercise to point at once the column is NOT NULL again.
            migrationBuilder.DropIndex(
                name: "IX_Sessions_PersonId",
                table: "Sessions");

            migrationBuilder.Sql(Exec("""
                DELETE FROM [Sessions] WHERE [ExerciseId] IS NULL;
                """));

            migrationBuilder.DropColumn(
                name: "Origin",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "PersonId",
                table: "Sessions");

            migrationBuilder.AlterColumn<Guid>(
                name: "ExerciseId",
                table: "Sessions",
                type: "uniqueidentifier",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uniqueidentifier",
                oldNullable: true);

            // 4. StaffAssignments + Accounts.Role/PersonaId back from the enrollments, then drop Enrollments.
            migrationBuilder.CreateTable(
                name: "StaffAssignments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Role = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    StaffUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StaffAssignments", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_StaffAssignments_ExerciseId",
                table: "StaffAssignments",
                column: "ExerciseId");

            migrationBuilder.CreateIndex(
                name: "IX_StaffAssignments_StaffUserId_ExerciseId",
                table: "StaffAssignments",
                columns: StaffAssignmentKeyColumns,
                unique: true);

            migrationBuilder.AddColumn<Guid>(
                name: "PersonaId",
                table: "Accounts",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Role",
                table: "Accounts",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.Sql(Exec("""
                UPDATE a SET [Role] = e.[Role], [PersonaId] = e.[PersonaId]
                FROM [Accounts] a
                JOIN [Enrollments] e ON e.[Id] = a.[EnrollmentId];

                INSERT INTO [StaffAssignments] ([Id], [CreatedAt], [ExerciseId], [Role], [StaffUserId])
                SELECT e.[Id], e.[CreatedAt], e.[ExerciseId],
                       CASE WHEN e.[Role] = 'planner' AND p.[OrgRole] = 'orgAdmin' THEN 'orgAdmin' ELSE e.[Role] END,
                       e.[PersonId]
                FROM [Enrollments] e
                JOIN [People] p ON p.[Id] = e.[PersonId]
                WHERE e.[Role] IN ('planner', 'controller', 'evaluator')
                  AND EXISTS (SELECT 1 FROM [StaffUsers] su WHERE su.[Id] = e.[PersonId])
                  AND NOT EXISTS (SELECT 1 FROM [Accounts] a WHERE a.[EnrollmentId] = e.[Id]);
                """));

            migrationBuilder.Sql(Exec("""
                IF EXISTS (SELECT 1 FROM [Accounts] WHERE [Role] IS NULL)
                    THROW 50019, 'AdminIdentityFoundation (Down): an account could not be given back its role from its enrollment.', 1;
                """));

            migrationBuilder.AlterColumn<string>(
                name: "Role",
                table: "Accounts",
                type: "nvarchar(max)",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(max)",
                oldNullable: true);

            migrationBuilder.DropForeignKey(
                name: "FK_Accounts_Enrollments_EnrollmentId",
                table: "Accounts");

            migrationBuilder.DropIndex(
                name: "IX_Accounts_EnrollmentId",
                table: "Accounts");

            migrationBuilder.DropColumn(
                name: "EnrollmentId",
                table: "Accounts");

            migrationBuilder.DropTable(
                name: "Enrollments");

            // 3. FirstLiveAt.
            migrationBuilder.DropColumn(
                name: "FirstLiveAt",
                table: "Exercises");

            // 2. Slug.
            migrationBuilder.DropIndex(
                name: "IX_Organizations_Slug",
                table: "Organizations");

            migrationBuilder.DropColumn(
                name: "Slug",
                table: "Organizations");

            // 1. The staff facet's FK, then People.
            migrationBuilder.DropForeignKey(
                name: "FK_StaffUsers_People_Id",
                table: "StaffUsers");

            migrationBuilder.DropTable(
                name: "People");
        }

        /// <summary>
        /// Wraps hand-written SQL in <c>EXEC(N'…')</c> (quotes doubled) so it compiles only when it runs — see the
        /// remarks; never unwrap.
        /// </summary>
        private static string Exec(string sql) => $"EXEC(N'{sql.Replace("'", "''", StringComparison.Ordinal)}');";
    }
}
