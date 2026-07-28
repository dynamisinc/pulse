using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pulse.WebApi.Data.Migrations
{
    /// <summary>
    /// Enforces per-exercise persona-handle uniqueness at the database level — <c>backend-host/03</c>, resolving
    /// <c>docs/01-platform-core-isolation.md</c> §7 Q3 in favour of the recommended per-exercise scope. Two
    /// steps: narrow <c>Personas.Handle</c> from <c>nvarchar(max)</c> (not index-key eligible in SQL Server) to
    /// <c>nvarchar(256)</c>, then add the unique index on <c>(ExerciseId, Handle)</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Case-insensitive by collation.</b> The database is <c>SQL_Latin1_General_CP1_CI_AS</c> (set model-wide
    /// in <c>PulseDbContext.OnModelCreating</c>, matching <c>infrastructure/modules/database.bicep</c>), and a
    /// unique index compares its key columns under the column's collation — so <c>mvega_fh</c> and
    /// <c>MVega_FH</c> COLLIDE rather than coexisting. That matches, rather than contradicts, the
    /// case-insensitive matching the callers already rely on: <c>PersonaCastSeeder</c>'s in-memory
    /// <c>OrdinalIgnoreCase</c> grouping and the CI <c>==</c>/<c>Contains</c> the by-handle resolvers run on the
    /// server. The <c>GROUP BY</c> in the pre-flight guard below is CI for the same reason, so it detects exactly
    /// the rows the index would reject.
    /// </para>
    /// <para>
    /// <b>Pre-flight guard, deliberately NOT a de-duplication step.</b> <c>Up</c> opens by failing fast with a
    /// diagnostic naming every offending <c>(ExerciseId, Handle)</c> group instead of deleting rows to make the
    /// index fit. Auto-dedup was rejected: a duplicate persona row can already be referenced by
    /// <c>Posts.AuthorPersonaId</c> and <c>Accounts.PersonaId</c> (neither is a declared FK, so nothing would
    /// stop the delete), and silently orphaning a live exercise's authored posts is a worse outcome than a
    /// refused migration an operator can resolve deliberately. In practice no environment should trip this:
    /// <c>PersonaCastSeeder</c> is the only production insert path and is idempotent on <c>(ExerciseId,
    /// Handle)</c>, so duplicates require concurrent seeds of the same exercise or a manual INSERT. See the
    /// story's Technical Notes for the read-only pre-flight query and the remediation shape.
    /// </para>
    /// </remarks>
    public partial class PersonaHandleUniqueIndex : Migration
    {
        /// <summary>The composite index key, in order: scope first, then handle (CA1861 — not an inline array).</summary>
        private static readonly string[] IndexKeyColumns = ["ExerciseId", "Handle"];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Pre-flight, inside the migration's own transaction: a THROW here rolls the whole migration back
            // having changed nothing, and reports WHICH data is in the way (a bare CREATE UNIQUE INDEX failure
            // names the index, not the rows). Both checks are for data that would make the two operations below
            // fail: duplicates for the index, over-length handles for the narrowing ALTER.
            migrationBuilder.Sql("""
                DECLARE @duplicates nvarchar(max);

                -- CI collation: this GROUP BY folds case exactly the way the unique index key will.
                SELECT @duplicates = STRING_AGG(
                        CONVERT(nvarchar(max), CONCAT(N'[', d.ExerciseId, N'] ', d.Handle, N' ×', d.Occurrences)),
                        N'; ')
                FROM (
                    SELECT ExerciseId, MIN(Handle) AS Handle, COUNT(*) AS Occurrences
                    FROM [Personas]
                    GROUP BY ExerciseId, Handle
                    HAVING COUNT(*) > 1
                ) AS d;

                IF @duplicates IS NOT NULL
                BEGIN
                    DECLARE @duplicateMessage nvarchar(2048) = CONCAT(
                        N'Cannot add IX_Personas_ExerciseId_Handle: Personas already contains duplicate ',
                        N'(ExerciseId, Handle) rows (case-insensitive, per the database collation). ',
                        N'Resolve each group by hand — decide which persona id the exercise''s posts and ',
                        N'participant accounts should point at, repoint or delete the loser, then re-run. ',
                        N'Offending groups: ', @duplicates);
                    THROW 50000, @duplicateMessage, 1;
                END;

                -- DATALENGTH/2 is the exact character count for nvarchar (LEN would ignore trailing spaces).
                IF EXISTS (SELECT 1 FROM [Personas] WHERE DATALENGTH([Handle]) > 512)
                BEGIN
                    THROW 50000, N'Cannot narrow Personas.Handle to nvarchar(256): at least one existing handle is longer than 256 characters. Shorten it before re-running this migration.', 1;
                END;
                """);

            migrationBuilder.AlterColumn<string>(
                name: "Handle",
                table: "Personas",
                type: "nvarchar(256)",
                maxLength: 256,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(max)");

            migrationBuilder.CreateIndex(
                name: "IX_Personas_ExerciseId_Handle",
                table: "Personas",
                columns: IndexKeyColumns,
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Personas_ExerciseId_Handle",
                table: "Personas");

            migrationBuilder.AlterColumn<string>(
                name: "Handle",
                table: "Personas",
                type: "nvarchar(max)",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(256)",
                oldMaxLength: 256);
        }
    }
}
