using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pulse.WebApi.Data.Migrations
{
    /// <summary>
    /// exercise-build-golive/09 (#376, Tier-2: schema + information leak) — the ADMIN-IDENTITY-MODEL A3 migration:
    /// <c>Exercises.ParticipantName</c> (§8.4, the participant-facing name with no fallback) and the setup/conduct flag
    /// <c>IsSetupContent</c> on <c>Posts</c> and <c>Follows</c> (§5.4). Columns and backfills only: the write-path stamp
    /// of <c>IsSetupContent</c> is story 01, so a row written after this migration defaults to 0 (conduct).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>The backfills.</b> <c>ParticipantName</c> is <c>WorldName</c> trimmed, cut to 80 and re-trimmed (null when
    /// <c>WorldName</c> is null, empty or whitespace); it is
    /// NEVER taken from the internal <c>Name</c>, which can leak the scenario. For <c>IsSetupContent</c>, let
    /// <c>leftBuildAt</c> be the exercise's earliest <c>exercise.lifecycle.transitioned</c> telemetry event whose payload
    /// <c>from</c> is <c>build</c>. A follow is setup when the exercise is in <c>build</c> now, or when it was created before
    /// <c>leftBuildAt</c>; a post is setup by the same rule unless its <c>Origin</c> is <c>participant</c>, which is always
    /// conduct (applied in <c>build</c> too). An exercise with no such event leaves its rows conduct, which fails safe:
    /// reset deletes them and duplicate does not copy them. The MIN of build exits is exact today, because nothing can
    /// return an exercise to <c>build</c> yet (no unstage/reset); once story 07 adds unstage, posts and follows from a
    /// second build period would be classed conduct by this one-shot backfill — accepted per the spec.
    /// </para>
    /// <para>
    /// <b>The legacy literal.</b> The transition payload's <c>from</c> is always the CANONICAL state
    /// (<c>ExerciseLifecycleStates.TryParse</c> folds the stored value first; the raw value rides in
    /// <c>storedStatusBefore</c>), and the <c>ExerciseConfiguration</c> migration rewrote every stored <c>scheduled</c> to
    /// <c>build</c>, landing (feature #41) before the lifecycle service that emits the transition event. So <c>from = 'scheduled'</c> and a stored
    /// <c>scheduled</c> status cannot occur through the app; both are still accepted as <c>build</c> here, at no cost, in case
    /// a hand-edited row carries one (the lifecycle service itself still reads <c>scheduled</c> as <c>build</c>). The
    /// comparisons run under the database's case-insensitive collation, as the service's parse is case-insensitive.
    /// </para>
    /// <para>
    /// <b>Every hand-written statement is wrapped in <c>EXEC(N'…')</c> — load-bearing, do not unwrap</b> (OPERATE.md; the
    /// 2026-08-03 incident recorded on <c>OrganizationTenantBoundary</c>): the backfills name columns added earlier in the
    /// same idempotent-script batch, which would otherwise fail to compile. Each backfill only writes rows that still differ
    /// from the computed value, so a replay is a no-op.
    /// </para>
    /// <para>
    /// <b>Down</b> drops the three columns (EF drops their default constraints first). It is reversible but not loss-free:
    /// planner-entered participant names and the setup/conduct split are discarded, and a replayed Up re-derives them from
    /// <c>WorldName</c> and the lifecycle telemetry.
    /// </para>
    /// </remarks>
    public partial class A3SetupContentParticipantName : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsSetupContent",
                table: "Posts",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IsSetupContent",
                table: "Follows",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "ParticipantName",
                table: "Exercises",
                type: "nvarchar(80)",
                maxLength: 80,
                nullable: true);

            // ParticipantName from the in-fiction WorldName (trimmed, truncated to the column width, re-trimmed so the cut
            // leaves no trailing space; blank/whitespace -> NULL), NEVER the internal Name.
            migrationBuilder.Sql(Exec("""
                UPDATE [Exercises] SET [ParticipantName] = NULLIF(RTRIM(LEFT(LTRIM(RTRIM([WorldName])), 80)), N'')
                WHERE [WorldName] IS NOT NULL AND [ParticipantName] IS NULL;
                """));

            // Posts: setup when not participant-origin AND (the exercise is in build, or the post predates leftBuildAt).
            migrationBuilder.Sql(Exec(SetupBackfill("Posts", "AND r.[Origin] <> 'participant'")));

            // Follows: the same rule without the Origin test.
            migrationBuilder.Sql(Exec(SetupBackfill("Follows", string.Empty)));
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsSetupContent",
                table: "Posts");

            migrationBuilder.DropColumn(
                name: "IsSetupContent",
                table: "Follows");

            migrationBuilder.DropColumn(
                name: "ParticipantName",
                table: "Exercises");
        }

        /// <summary>
        /// The <c>IsSetupContent</c> backfill for <paramref name="table"/> (alias <c>r</c>), with an optional extra row
        /// predicate. Writes only rows that are not yet 1, so a replay is a no-op. <c>leftBuildAt</c> is pre-aggregated once
        /// per exercise (one scan of the lifecycle events, hash-joined), not a correlated per-row lookup.
        /// </summary>
        private static string SetupBackfill(string table, string extraRowPredicate) => $"""
            WITH lb AS (
                SELECT t.[ExerciseId], MIN(t.[WallClockTime]) AS [LeftBuildAt]
                FROM [TelemetryEvents] t
                WHERE t.[EventType] = 'exercise.lifecycle.transitioned'
                  AND (CASE WHEN ISJSON(t.[Payload]) = 1 THEN JSON_VALUE(t.[Payload], '$.from') END) IN ('build', 'scheduled')
                GROUP BY t.[ExerciseId]
            )
            UPDATE r SET [IsSetupContent] = 1
            FROM [{table}] r
            JOIN [Exercises] e ON e.[Id] = r.[ExerciseId]
            LEFT JOIN lb ON lb.[ExerciseId] = e.[Id]
            WHERE r.[IsSetupContent] = 0
              {extraRowPredicate}
              AND (e.[Status] IN ('build', 'scheduled')
                   OR (lb.[LeftBuildAt] IS NOT NULL AND r.[CreatedWallClock] < lb.[LeftBuildAt]));
            """;

        private static string Exec(string sql) => $"EXEC(N'{sql.Replace("'", "''", StringComparison.Ordinal)}');";
    }
}
