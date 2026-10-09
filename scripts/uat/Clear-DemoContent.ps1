#Requires -Version 7.0

<#
.SYNOPSIS
    Clears old rehearsal content from Pulse UAT so the demo opens fresh. Reversible.

.DESCRIPTION
    Two things make a rehearsed UAT look stale:
      - Posts. The participant feed shows every post ever made in the exercise, newest first.
      - Engine drafts. The review queue keeps every queued or held draft across restarts, and "Batch approve"
        would publish them.

    This script:
      1. ARCHIVES posts created (wall clock) before -Before (default: now) by setting Posts.DeletedAt. The
         participant feed, Following feed and threads already skip archived posts; nothing is deleted.
      2. VETOES drafts still Queued or Held (Disposition 0 or 2) that belong to any storyline other than
         the current one, i.e. the storyline of the latest engine.content_seeded event, or -KeepStorylineId.
         Drafts that are CountingDown are left alone and reported, because their timers live in the app's
         memory.
      3. Writes a restore manifest (the archive stamp + the vetoed draft ids) under
         $env:LOCALAPPDATA\Pulse\demo-restore\. Pass it to -RestoreManifest to put everything back.

    It writes straight to UAT's database with an Entra token from YOUR az login. That needs the
    tbull-workstation firewall rule for this machine's IP. It's an ops action outside the app, so no
    telemetry event records it. -WhatIf previews the counts and changes nothing.

    Rehearsal order: Clear-DemoContent.ps1, then Reset-DemoState.ps1 (which seeds a new storyline).

.EXAMPLE
    pwsh scripts/uat/Clear-DemoContent.ps1 -WhatIf

.EXAMPLE
    pwsh scripts/uat/Clear-DemoContent.ps1

.EXAMPLE
    pwsh scripts/uat/Clear-DemoContent.ps1 -RestoreManifest "$env:LOCALAPPDATA\Pulse\demo-restore\20261007T030000Z.json"
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
    [string] $Database = 'sqldb-pulse-uat'
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/Common.ps1"

$Vetoed = 4                  # DraftDisposition.Vetoed  (Pulse.Core Features/Autonomy/Models/EngineReviewItem.cs)
$Clearable = @(0, 2)         # DraftDisposition.Queued, DraftDisposition.Held
$CountingDown = 1            # DraftDisposition.CountingDown — left alone (its timer lives in app memory)

$token = Invoke-Az account get-access-token --resource https://database.windows.net/ --subscription $Subscription --query accessToken -o tsv
$connection = [System.Data.SqlClient.SqlConnection]::new("Server=tcp:$SqlServer,1433;Initial Catalog=$Database;Encrypt=True;TrustServerCertificate=False;Connect Timeout=120;")
$connection.AccessToken = $token.Trim()
$token = $null
$connection.Open()

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
        $transaction = $connection.BeginTransaction()
        $posts = Invoke-Sql 'UPDATE Posts SET DeletedAt = NULL WHERE ExerciseId = @ex AND DeletedAt = @stamp' @{ '@ex' = $exerciseId; '@stamp' = [DateTimeOffset] $manifest.archiveStamp } -Transaction $transaction -NonQuery
        $drafts = 0
        foreach ($draft in $manifest.vetoedDrafts) {
            $drafts += Invoke-Sql 'UPDATE EngineReviewItems SET Disposition = @from WHERE DraftId = @id AND ExerciseId = @ex AND Disposition = @vetoed' @{ '@from' = [int] $draft.from; '@id' = [Guid] $draft.id; '@ex' = $exerciseId; '@vetoed' = $Vetoed } -Transaction $transaction -NonQuery
        }
        $transaction.Commit()
        Write-Host "Restored $posts post(s) and $drafts draft(s) from $RestoreManifest." -ForegroundColor Green
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

    Write-Host "Exercise $exerciseId ($ApiHost); current storyline $current"
    Write-Host "  Posts to archive (created before $($Before.ToString('u'))): $postCount   (kept: $keptPosts)"
    Write-Host "  Stale drafts to veto (Queued/Held, other storylines):      $(@($draftRows).Count)"
    if ($counting -gt 0) { Write-Host "  Stale drafts COUNTING DOWN, left alone:                    $counting" -ForegroundColor Yellow }

    if ($WhatIf) { Write-Host 'WhatIf: nothing changed.' -ForegroundColor Cyan; return }
    if ($postCount -eq 0 -and @($draftRows).Count -eq 0) { Write-Host 'Nothing to clear.' -ForegroundColor Green; return }

    # Microsecond-truncated so the stamp round-trips exactly through datetimeoffset(7) and the manifest.
    $stamp = [DateTimeOffset]::FromUnixTimeMilliseconds([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    $transaction = $connection.BeginTransaction()
    $archived = Invoke-Sql 'UPDATE Posts SET DeletedAt = @stamp WHERE ExerciseId = @ex AND DeletedAt IS NULL AND CreatedWallClock < @before' @{ '@stamp' = $stamp; '@ex' = $exerciseId; '@before' = $Before } -Transaction $transaction -NonQuery
    $vetoed = Invoke-Sql "UPDATE EngineReviewItems SET Disposition = @vetoed WHERE ExerciseId = @ex AND Disposition IN ($($Clearable -join ',')) AND StorylineId <> @current" @{ '@vetoed' = $Vetoed; '@ex' = $exerciseId; '@current' = $current } -Transaction $transaction -NonQuery

    $folder = Join-Path $env:LOCALAPPDATA 'Pulse\demo-restore'
    New-Item -ItemType Directory -Force $folder | Out-Null
    $manifestPath = Join-Path $folder ($stamp.ToString('yyyyMMddTHHmmssZ') + '.json')
    [ordered]@{
        exerciseId   = "$exerciseId"
        archiveStamp = $stamp.ToString('o')
        postsArchived = $archived
        vetoedDrafts = @($draftRows | ForEach-Object { [ordered]@{ id = "$($_.DraftId)"; from = [int] $_.Disposition } })
    } | ConvertTo-Json -Depth 4 | Set-Content $manifestPath
    $transaction.Commit()

    Write-Host "Archived $archived post(s) and vetoed $vetoed stale draft(s)." -ForegroundColor Green
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
