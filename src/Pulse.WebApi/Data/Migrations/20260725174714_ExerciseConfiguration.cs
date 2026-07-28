using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pulse.WebApi.Data.Migrations
{
    /// <summary>
    /// The exercise-configuration feature's ONE and ONLY migration (story 01a). It does two things:
    /// authors EVERY <c>Exercises</c> column stories 01b / 02 / 03 / 04 need — the COR-030 settings, the
    /// COR-031 compliance-chrome config, the NFR-008 watermark switch and the COR-033 practice flag — and
    /// carries the COR-032 <c>Status</c> vocabulary widening (Option B, Tier-2 sign-off given), default
    /// included, plus the data migration that maps existing rows.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Why one migration.</b> Four stories all want columns on this table, and two builders scaffolding
    /// EF migrations in parallel corrupt <c>PulseDbContextModelSnapshot.cs</c>. Every later story in the
    /// feature layers behaviour onto columns that already exist and authors NO migration.
    /// </para>
    /// <para>
    /// <b>Applies cleanly to a populated table.</b> Every added settings column is nullable (<c>null</c> =
    /// "not configured", so the shell projection keeps serving the shipped Phase-1 constant) or non-nullable
    /// with a safe default (chrome + watermark ON, practice OFF) — so no backfill is required and no existing
    /// row changes behaviour.
    /// </para>
    /// <para>
    /// <b>The Status data migration (COR-032, Option B).</b> The stored vocabulary becomes
    /// <c>build | staged | live | paused | completed | archived</c> — note <c>completed</c>, not the legacy
    /// <c>complete</c>. Existing rows only ever carry the <c>HasDefaultValue</c> (<c>scheduled</c>) or the
    /// <c>BootstrapService</c> seed (<c>active</c>), but all four legacy literals are mapped for safety:
    /// <c>scheduled</c> → <c>build</c> (created and never configured is still staff-only content
    /// development), <c>active</c> → <c>live</c> (a running exercise; StartEx has effectively occurred),
    /// <c>complete</c> → <c>completed</c> (spelling only), <c>archived</c> unchanged. There is deliberately
    /// NO CHECK constraint: the legacy four stay VALID through the transition, which is what keeps the
    /// wave-1 diff small and lets the additively-widened frontend guard (which fails closed on an unknown
    /// status) accept the transitional superset under UAT's independent frontend/backend deploys.
    /// </para>
    /// </remarks>
    public partial class ExerciseConfiguration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "Status",
                table: "Exercises",
                type: "nvarchar(max)",
                nullable: false,
                defaultValue: "build",
                oldClrType: typeof(string),
                oldType: "nvarchar(max)",
                oldDefaultValue: "scheduled");

            // Data migration: legacy vocabulary → COR-032. Runs inside the migration's own transaction, so a
            // failure rolls back the default change with it. The comparisons are case-insensitive by the
            // database collation (SQL_Latin1_General_CP1_CI_AS), which is what we want — a hand-entered
            // "Active" is mapped too. Rows already carrying a COR-032 literal are untouched, so a re-run
            // (idempotent-by-construction: no legacy value survives the first pass) is a no-op.
            migrationBuilder.Sql("""
                UPDATE [Exercises] SET [Status] = N'build'     WHERE [Status] = N'scheduled';
                UPDATE [Exercises] SET [Status] = N'live'      WHERE [Status] = N'active';
                UPDATE [Exercises] SET [Status] = N'completed' WHERE [Status] = N'complete';
                -- 'archived' is unchanged between the two vocabularies; nothing to do.
                """);

            migrationBuilder.AddColumn<string>(
                name: "BrandAccent",
                table: "Exercises",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BrandName",
                table: "Exercises",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BrandOnSurface",
                table: "Exercises",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BrandPrimary",
                table: "Exercises",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BrandSurface",
                table: "Exercises",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ChromeBottomBg",
                table: "Exercises",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ChromeBottomFg",
                table: "Exercises",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ChromeBottomText",
                table: "Exercises",
                type: "nvarchar(512)",
                maxLength: 512,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ChromeTopBg",
                table: "Exercises",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ChromeTopFg",
                table: "Exercises",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ChromeTopText",
                table: "Exercises",
                type: "nvarchar(512)",
                maxLength: 512,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "ComplianceChromeEnabled",
                table: "Exercises",
                type: "bit",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "EnabledChannels",
                table: "Exercises",
                type: "nvarchar(256)",
                maxLength: 256,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsPracticeMode",
                table: "Exercises",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "Locale",
                table: "Exercises",
                type: "nvarchar(35)",
                maxLength: 35,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OutletNamesJson",
                table: "Exercises",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ScheduledEndAt",
                table: "Exercises",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ScheduledStartAt",
                table: "Exercises",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "WatermarkEnabled",
                table: "Exercises",
                type: "bit",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "WorldName",
                table: "Exercises",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BrandAccent",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "BrandName",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "BrandOnSurface",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "BrandPrimary",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "BrandSurface",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "ChromeBottomBg",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "ChromeBottomFg",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "ChromeBottomText",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "ChromeTopBg",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "ChromeTopFg",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "ChromeTopText",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "ComplianceChromeEnabled",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "EnabledChannels",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "IsPracticeMode",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "Locale",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "OutletNamesJson",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "ScheduledEndAt",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "ScheduledStartAt",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "WatermarkEnabled",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "WorldName",
                table: "Exercises");

            migrationBuilder.AlterColumn<string>(
                name: "Status",
                table: "Exercises",
                type: "nvarchar(max)",
                nullable: false,
                defaultValue: "scheduled",
                oldClrType: typeof(string),
                oldType: "nvarchar(max)",
                oldDefaultValue: "build");

            // Reverse data migration. DELIBERATELY LOSSY, and that is the correct trade: the legacy
            // vocabulary has no Staged and no Paused, so both collapse onto their nearest legacy neighbour.
            // What matters on a rollback is that EVERY row lands back inside the legacy four — a row left on
            // a COR-032 literal would be an unknown status to a rolled-back, un-widened client, whose guard
            // fails closed and blanks the participant world.
            migrationBuilder.Sql("""
                UPDATE [Exercises] SET [Status] = N'scheduled' WHERE [Status] IN (N'build', N'staged');
                UPDATE [Exercises] SET [Status] = N'active'    WHERE [Status] IN (N'live', N'paused');
                UPDATE [Exercises] SET [Status] = N'complete'  WHERE [Status] = N'completed';
                -- 'archived' is unchanged between the two vocabularies; nothing to do.
                """);
        }
    }
}
