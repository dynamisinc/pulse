#Requires -Version 7.0

<#
.SYNOPSIS
    Clears old rehearsal content from Pulse UAT so the demo opens fresh. Reversible.

.DESCRIPTION
    Three things a rehearsal leaves behind get in the way of the show:
      - Posts. The participant feed shows every post ever made in the exercise, newest first.
      - Engine drafts. The review queue keeps every queued or held draft across restarts, and "Batch approve"
        would publish them.
      - Imported run-sheet items. The MSEL import (Import MSEL in the controller console) keys each item on its
        Inject # and leaves an item that already exists alone. So once a rehearsal has imported the MSEL, and
        perhaps fired it, the show's import creates nothing. The console cannot delete a fired item.

    This script:
      1. ARCHIVES posts created (wall clock) before -Before (default: now) by setting Posts.DeletedAt. The
         participant feed, Following feed and threads already skip archived posts; nothing is deleted.
      2. VETOES drafts still Queued or Held (Disposition 0 or 2) that belong to any storyline other than
         the current one, i.e. the storyline of the latest engine.content_seeded event, or -KeepStorylineId.
         Drafts that are CountingDown are left alone and reported, because their timers live in the app's
         memory.
      3. ARCHIVES the run-sheet items an MSEL import created (InjectItems.ExternalRef holds their Inject #) that
         were created (wall clock) before -Before, whatever their status: pending, held, firing, fired, skipped
         or failed. It soft-deletes them the way the console's Delete does: DeletedAt and UpdatedAt set to the
         archive stamp, the item's Version bumped, and the exercise's queue token (InjectQueueStates.Version)
         bumped. Their Inject #s are then free, so the show's import creates them fresh. Items seeded by
         Seed-DemoContent.ps1 or written in the console have no Inject # and are never touched. An item that is
         publishing a post at that instant is left alone and reported (run again a few seconds later); an
         archived item that was still firing releases no more posts. Open consoles drop the archived items at
         their next poll, within about 3 seconds.
      4. Writes a restore manifest (the archive stamp, the vetoed draft ids and the archived item ids) under
         $env:LOCALAPPDATA\Pulse\demo-restore\. Pass it to -RestoreManifest to put everything back. An archived
         item whose Inject # a live item holds by then (a newer import) stays archived and is reported, because
         two live items can never share an Inject #.

    All of it is one transaction: everything is cleared and the manifest written, or nothing changes.

    It writes straight to UAT's database with an Entra token from YOUR az login. That needs the
    tbull-workstation firewall rule for this machine's IP. -ConnectionString connects to another database
    instead (a scratch copy, to try the script out); it is never printed. It's an ops action outside the app,
    so no telemetry event records it. -WhatIf previews the counts and changes nothing.

    Rehearsal order: Clear-DemoContent.ps1, then Reset-DemoState.ps1 (which seeds a new storyline).

.EXAMPLE
    pwsh scripts/uat/Clear-DemoContent.ps1 -WhatIf

.EXAMPLE
    pwsh scripts/uat/Clear-DemoContent.ps1

.EXAMPLE
    pwsh scripts/uat/Clear-DemoContent.ps1 -RestoreManifest "$env:LOCALAPPDATA\Pulse\demo-restore\20261007T030000Z.json"

.EXAMPLE
    pwsh scripts/uat/Clear-DemoContent.ps1 -ConnectionString $env:SCRATCH_SQL -ApiHost scratch.test -KeepStorylineId <guid> -WhatIf
#>
[CmdletBinding()]
param(
    [switch] $WhatIf,
    [DateTimeOffset] $Before = [DateTimeOffset]::UtcNow,
    [Guid] $KeepStorylineId,
    [string] $RestoreManifest,
    [string] $ApiHost = 'app-pulse-api-uat-dynamis.azurewebsites.net',
    [string] $Subscription = '2a127d53-c9bf-471a-8196-3155eae6cb1b',
    [string] $SqlServer = 'sql-pulse-uat.database.windows.net',
    [string] $Database = 'sqldb-pulse-uat',
    [string] $ConnectionString
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/Common.ps1"

$Vetoed = 4                  # DraftDisposition.Vetoed  (Pulse.Core Features/Autonomy/Models/EngineReviewItem.cs)
$Clearable = @(0, 2)         # DraftDisposition.Queued, DraftDisposition.Held
$CountingDown = 1            # DraftDisposition.CountingDown — left alone (its timer lives in app memory)

# Run-sheet items. Every statement on InjectItems keeps "this exercise" and "ExternalRef IS NOT NULL" (an MSEL
# import's Inject #, demo-feedback DF-10), so a seeded or console-written item is never read or written.
# A live child post with ClaimedAt set is being published right now: the console's Delete refuses that item
# (InjectTransitions.WhyNotDeletable), and so does this script, so the post lands and is recorded.
$ImportedItemsSql = @'
SELECT i.Id, i.ExternalRef, i.Status,
       CASE WHEN i.CreatedAt < @before THEN 1 ELSE 0 END AS CreatedBefore,
       CASE WHEN EXISTS (SELECT 1 FROM InjectItemPosts AS p WHERE p.InjectItemId = i.Id AND p.DeletedAt IS NULL AND p.ClaimedAt IS NOT NULL) THEN 1 ELSE 0 END AS Publishing
FROM InjectItems AS i
WHERE i.ExerciseId = @ex AND i.DeletedAt IS NULL AND i.ExternalRef IS NOT NULL
ORDER BY i.[Order]
'@
$ArchiveItemsSql = @'
UPDATE i SET DeletedAt = @stamp, UpdatedAt = @stamp, Version = i.Version + 1
OUTPUT inserted.Id, inserted.ExternalRef, inserted.Status
FROM InjectItems AS i
WHERE i.ExerciseId = @ex AND i.DeletedAt IS NULL AND i.ExternalRef IS NOT NULL AND i.CreatedAt < @before
  AND NOT EXISTS (SELECT 1 FROM InjectItemPosts AS p WHERE p.InjectItemId = i.Id AND p.DeletedAt IS NULL AND p.ClaimedAt IS NOT NULL)
'@
# The filtered unique index IX_InjectItems_ExerciseId_ExternalRef allows one LIVE item per Inject # (compared with
# the column's collation, as the index does), so an item whose Inject # is taken again is not restored.
$RestoreItemSql = @'
UPDATE i SET DeletedAt = NULL, UpdatedAt = @now, Version = i.Version + 1
FROM InjectItems AS i
WHERE i.Id = @id AND i.ExerciseId = @ex AND i.DeletedAt = @stamp AND i.ExternalRef IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM InjectItems AS live WHERE live.ExerciseId = i.ExerciseId AND live.ExternalRef = i.ExternalRef AND live.DeletedAt IS NULL)
'@
$TakenBySql = @'
SELECT TOP 1 live.Id
FROM InjectItems AS i
JOIN InjectItems AS live ON live.ExerciseId = i.ExerciseId AND live.ExternalRef = i.ExternalRef AND live.DeletedAt IS NULL
WHERE i.Id = @id AND i.ExerciseId = @ex AND i.DeletedAt = @stamp AND i.ExternalRef IS NOT NULL
'@
# The queue-membership token the app bumps on every create, delete and reorder (InjectQueueState), so a reorder a
# console computed against the old set of items is refused (409) instead of saved.
$BumpQueueSql = 'UPDATE InjectQueueStates SET Version = Version + 1 WHERE ExerciseId = @ex'

function Open-DemoDatabase {
    <# Opens the connection: an Entra token from your az login, or -ConnectionString as given. #>
    if ($ConnectionString) {
        $db = [System.Data.SqlClient.SqlConnection]::new($ConnectionString)
    }
    else {
        $token = Invoke-Az account get-access-token --resource https://database.windows.net/ --subscription $Subscription --query accessToken -o tsv
        $db = [System.Data.SqlClient.SqlConnection]::new("Server=tcp:$SqlServer,1433;Initial Catalog=$Database;Encrypt=True;TrustServerCertificate=False;Connect Timeout=120;")
        $db.AccessToken = $token.Trim()
        $token = $null
    }
    $db.Open()
    return $db
}

$connection = Open-DemoDatabase

function Invoke-Sql([string] $Sql, [hashtable] $Parameters = @{}, [System.Data.SqlClient.SqlTransaction] $Transaction, [switch] $Scalar, [switch] $NonQuery) {
    $command = $connection.CreateCommand()
    $command.CommandText = $Sql
    $command.CommandTimeout = 120
    if ($Transaction) { $command.Transaction = $Transaction }
    foreach ($key in $Parameters.Keys) { [void] $command.Parameters.AddWithValue($key, $Parameters[$key]) }
    if ($Scalar) { return $command.ExecuteScalar() }
    if ($NonQuery) { return $command.ExecuteNonQuery() }
    $reader = $command.ExecuteReader()
    try {
        $rows = [System.Collections.Generic.List[object]]::new()
        while ($reader.Read()) {
            $row = [ordered]@{}
            for ($i = 0; $i -lt $reader.FieldCount; $i++) { $row[$reader.GetName($i)] = $reader.GetValue($i) }
            $rows.Add([pscustomobject] $row)
        }
        return $rows
    }
    finally { $reader.Close() }
}

try {
    $exerciseId = Invoke-Sql 'SELECT Id FROM Exercises WHERE Hostname = @host' @{ '@host' = $ApiHost } -Scalar
    if (-not $exerciseId) { throw "No exercise is bound to $ApiHost." }

    if ($RestoreManifest) {
        $manifest = Get-Content $RestoreManifest -Raw | ConvertFrom-Json
        if ([Guid] $manifest.exerciseId -ne [Guid] $exerciseId) { throw "That manifest is for exercise $($manifest.exerciseId), not $exerciseId." }
        $archiveStamp = [DateTimeOffset] $manifest.archiveStamp
        $transaction = $connection.BeginTransaction()
        $posts = Invoke-Sql 'UPDATE Posts SET DeletedAt = NULL WHERE ExerciseId = @ex AND DeletedAt = @stamp' @{ '@ex' = $exerciseId; '@stamp' = $archiveStamp } -Transaction $transaction -NonQuery
        $drafts = 0
        foreach ($draft in $manifest.vetoedDrafts) {
            $drafts += Invoke-Sql 'UPDATE EngineReviewItems SET Disposition = @from WHERE DraftId = @id AND ExerciseId = @ex AND Disposition = @vetoed' @{ '@from' = [int] $draft.from; '@id' = [Guid] $draft.id; '@ex' = $exerciseId; '@vetoed' = $Vetoed } -Transaction $transaction -NonQuery
        }
        # A manifest written before this script archived run-sheet items has no importedItems: none to restore.
        $items = 0
        $notRestored = [System.Collections.Generic.List[string]]::new()
        $now = [DateTimeOffset]::UtcNow
        foreach ($item in $manifest.importedItems) {
            $parameters = @{ '@id' = [Guid] $item.id; '@ex' = $exerciseId; '@stamp' = $archiveStamp }
            if ((Invoke-Sql $RestoreItemSql ($parameters + @{ '@now' = $now }) -Transaction $transaction -NonQuery) -eq 1) { $items++; continue }
            $holder = Invoke-Sql $TakenBySql $parameters -Transaction $transaction -Scalar
            $why = if ($holder) { "live item $holder (a newer import) holds that Inject #, so it stays archived" } else { 'no longer archived by that run (restored already, or deleted since), so left as it is' }
            $notRestored.Add("Inject # $($item.externalRef) (item $($item.id)): $why.")
        }
        if ($items -gt 0) { [void] (Invoke-Sql $BumpQueueSql @{ '@ex' = $exerciseId } -Transaction $transaction -NonQuery) }
        $transaction.Commit()
        Write-Host "Restored $posts post(s), $drafts draft(s) and $items imported run-sheet item(s) from $RestoreManifest." -ForegroundColor Green
        foreach ($line in $notRestored) { Write-Host "  Not restored: $line" -ForegroundColor Yellow }
        return
    }

    $current = if ($PSBoundParameters.ContainsKey('KeepStorylineId')) { $KeepStorylineId } else {
        Invoke-Sql "SELECT TOP 1 JSON_VALUE(Payload, '$.storylineId') FROM TelemetryEvents WHERE ExerciseId = @ex AND EventType = 'engine.content_seeded' ORDER BY WallClockTime DESC" @{ '@ex' = $exerciseId } -Scalar
    }
    if (-not $current) { throw 'No engine.content_seeded event found; pass -KeepStorylineId (or seed first).' }
    $current = [Guid] $current

    $postCount = Invoke-Sql 'SELECT COUNT(*) FROM Posts WHERE ExerciseId = @ex AND DeletedAt IS NULL AND CreatedWallClock < @before' @{ '@ex' = $exerciseId; '@before' = $Before } -Scalar
    $keptPosts = Invoke-Sql 'SELECT COUNT(*) FROM Posts WHERE ExerciseId = @ex AND DeletedAt IS NULL AND CreatedWallClock >= @before' @{ '@ex' = $exerciseId; '@before' = $Before } -Scalar
    $draftRows = Invoke-Sql "SELECT DraftId, Disposition FROM EngineReviewItems WHERE ExerciseId = @ex AND Disposition IN ($($Clearable -join ',')) AND StorylineId <> @current" @{ '@ex' = $exerciseId; '@current' = $current }
    $counting = Invoke-Sql 'SELECT COUNT(*) FROM EngineReviewItems WHERE ExerciseId = @ex AND Disposition = @cd AND StorylineId <> @current' @{ '@ex' = $exerciseId; '@cd' = $CountingDown; '@current' = $current } -Scalar
    $importedRows = @(Invoke-Sql $ImportedItemsSql @{ '@ex' = $exerciseId; '@before' = $Before })
    $itemsToArchive = @($importedRows | Where-Object { $_.CreatedBefore -eq 1 -and $_.Publishing -eq 0 })
    $itemsPublishing = @($importedRows | Where-Object { $_.CreatedBefore -eq 1 -and $_.Publishing -eq 1 })
    $keptItems = @($importedRows | Where-Object { $_.CreatedBefore -eq 0 }).Count

    Write-Host "Exercise $exerciseId ($ApiHost); current storyline $current"
    Write-Host "  Posts to archive (created before $($Before.ToString('u'))): $postCount   (kept: $keptPosts)"
    Write-Host "  Stale drafts to veto (Queued/Held, other storylines):      $(@($draftRows).Count)"
    if ($counting -gt 0) { Write-Host "  Stale drafts COUNTING DOWN, left alone:                    $counting" -ForegroundColor Yellow }
    Write-Host "  Imported run-sheet items to archive (MSEL, any status):    $($itemsToArchive.Count)   (kept, created since: $keptItems)"
    if ($itemsToArchive.Count -gt 0) {
        Write-Host "    Inject # (status): $(($itemsToArchive | ForEach-Object { "$($_.ExternalRef) ($($_.Status))" }) -join ', ')"
        $firing = @($itemsToArchive | Where-Object Status -eq 'firing').Count
        if ($firing -gt 0) { Write-Host "    $firing of them still FIRING: archiving stops the posts they have not released yet." -ForegroundColor Yellow }
    }
    if ($itemsPublishing.Count -gt 0) {
        Write-Host "  Imported items PUBLISHING a post right now, left alone:    $($itemsPublishing.Count)   (Inject # $(($itemsPublishing | ForEach-Object ExternalRef) -join ', '); run again in a few seconds)" -ForegroundColor Yellow
    }

    if ($WhatIf) { Write-Host 'WhatIf: nothing changed.' -ForegroundColor Cyan; return }
    if ($postCount -eq 0 -and @($draftRows).Count -eq 0 -and $itemsToArchive.Count -eq 0) { Write-Host 'Nothing to clear.' -ForegroundColor Green; return }

    # Microsecond-truncated so the stamp round-trips exactly through datetimeoffset(7) and the manifest.
    $stamp = [DateTimeOffset]::FromUnixTimeMilliseconds([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    $transaction = $connection.BeginTransaction()
    $archived = Invoke-Sql 'UPDATE Posts SET DeletedAt = @stamp WHERE ExerciseId = @ex AND DeletedAt IS NULL AND CreatedWallClock < @before' @{ '@stamp' = $stamp; '@ex' = $exerciseId; '@before' = $Before } -Transaction $transaction -NonQuery
    $vetoed = Invoke-Sql "UPDATE EngineReviewItems SET Disposition = @vetoed WHERE ExerciseId = @ex AND Disposition IN ($($Clearable -join ',')) AND StorylineId <> @current" @{ '@vetoed' = $Vetoed; '@ex' = $exerciseId; '@current' = $current } -Transaction $transaction -NonQuery
    # The manifest names the rows this statement changed (its OUTPUT), not the preview's.
    $itemRows = @(Invoke-Sql $ArchiveItemsSql @{ '@stamp' = $stamp; '@ex' = $exerciseId; '@before' = $Before } -Transaction $transaction)
    if ($itemRows.Count -gt 0) { [void] (Invoke-Sql $BumpQueueSql @{ '@ex' = $exerciseId } -Transaction $transaction -NonQuery) }

    $folder = Join-Path $env:LOCALAPPDATA 'Pulse\demo-restore'
    New-Item -ItemType Directory -Force $folder | Out-Null
    $manifestPath = Join-Path $folder ($stamp.ToString('yyyyMMddTHHmmssZ') + '.json')
    [ordered]@{
        exerciseId    = "$exerciseId"
        archiveStamp  = $stamp.ToString('o')
        postsArchived = $archived
        vetoedDrafts  = @($draftRows | ForEach-Object { [ordered]@{ id = "$($_.DraftId)"; from = [int] $_.Disposition } })
        importedItems = @($itemRows | ForEach-Object { [ordered]@{ id = "$($_.Id)"; externalRef = "$($_.ExternalRef)"; status = "$($_.Status)" } })
    } | ConvertTo-Json -Depth 4 | Set-Content $manifestPath
    $transaction.Commit()

    Write-Host "Archived $archived post(s) and $($itemRows.Count) imported run-sheet item(s); vetoed $vetoed stale draft(s)." -ForegroundColor Green
    Write-Host "Undo with:  pwsh $PSCommandPath -RestoreManifest `"$manifestPath`""
    Write-Host 'Refresh the participant and console tabs to see the cleared state.'
}
catch {
    if ($transaction -and $transaction.Connection) { $transaction.Rollback() }
    throw
}
finally {
    $connection.Close()
}
