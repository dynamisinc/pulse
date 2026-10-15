#Requires -Version 7.0

<#
.SYNOPSIS
    Pester 5 tests for Clear-DemoContent.ps1's run-sheet part (the items an MSEL import created) and its restore
    safety. No database: the script's two database seams, Open-DemoDatabase and Invoke-Sql, are mocked.

.DESCRIPTION
    Runs the real script (`& Clear-DemoContent.ps1 ...`). A Pester mock's alias wins over the function of the same
    name that the script defines when it runs, so the script itself is unchanged. Open-DemoDatabase returns a fake
    connection whose transaction records begin, commit and rollback; Invoke-Sql records every statement (its SQL,
    parameters and transaction) in the same log and answers from canned results.

    Covers:
      - every statement on InjectItems names this exercise and imported items only (ExternalRef IS NOT NULL), and
        every claim check matches the child post's exercise too;
      - the item archive soft-deletes as the console's Delete does (DeletedAt, UpdatedAt, Version + 1), locks the
        claim check (UPDLOCK, HOLDLOCK), skips an item mid-publish, and runs with the queue-token bump inside the
        post archive's transaction, before the commit; a failure rolls everything back and leaves no manifest; a
        failed commit keeps the manifest and says so;
      - the summary lists the imported items, the ones mid-publish, and a stuck claim (older than the lease);
        -WhatIf writes nothing;
      - the manifest records the database, and the drafts and items the UPDATEs changed (their OUTPUT);
      - -RestoreManifest refuses another database, restores the items, warns about a restored firing item, skips
        and reports an item whose Inject # a live item holds (or that is no longer archived by that run), and an
        older manifest still restores posts and drafts;
      - -ConnectionString never reaches any output stream, the manifest or $Error.

.EXAMPLE
    Invoke-Pester scripts/uat/Clear-DemoContent.Tests.ps1 -Output Detailed
#>

BeforeAll {
    $script:ScriptFile = Join-Path $PSScriptRoot 'Clear-DemoContent.ps1'
    $script:ExerciseId = [guid] '6f1d2c3b-0a9e-4d8c-b7a6-5e4f3d2c1b0a'
    $script:Storyline = [guid] '0b5e7c1a-2d3f-4a6b-8c9d-1e2f3a4b5c6d'
    $script:Before = [DateTimeOffset]::Parse('2026-10-20T12:00:00Z')
    $script:ItemA = [guid] 'aaaaaaaa-0000-4000-8000-000000000001'
    $script:ItemB = [guid] 'bbbbbbbb-0000-4000-8000-000000000002'
    $script:ItemC = [guid] 'cccccccc-0000-4000-8000-000000000003'
    $script:LiveB = [guid] 'dddddddd-0000-4000-8000-000000000004'
    $script:DraftQueued = [guid] 'eeeeeeee-0000-4000-8000-000000000005'
    $script:DraftHeld = [guid] 'ffffffff-0000-4000-8000-000000000006'

    # Stand-ins for the script's own functions, so that Pester can mock them.
    function Open-DemoDatabase { }
    function Invoke-Sql { param([string] $Sql, [hashtable] $Parameters = @{}, $Transaction, [switch] $Scalar, [switch] $NonQuery) }

    function New-FakeDb {
        [pscustomobject]@{
            ExerciseId    = $script:ExerciseId
            Server        = 'sql-fake'
            Database      = 'sqldb-fake'
            OldPosts      = 3
            NewPosts      = 1
            # The preview's drafts, and the veto UPDATE's OUTPUT rows (the drafts it changed).
            Drafts        = @(
                [pscustomobject]@{ DraftId = $script:DraftQueued; Disposition = 0 }
                [pscustomobject]@{ DraftId = $script:DraftHeld; Disposition = 2 }
            )
            VetoedDrafts  = @(
                [pscustomobject]@{ DraftId = $script:DraftQueued; Disposition = 0 }
                [pscustomobject]@{ DraftId = $script:DraftHeld; Disposition = 2 }
            )
            # The preview (ImportedItemsSql): two to archive, one mid-publish, one created after -Before.
            ImportedItems = @(
                [pscustomobject]@{ Id = $script:ItemA; ExternalRef = 'INJ-001'; Status = 'pending'; CreatedBefore = 1; Publishing = 0; ClaimStuck = 0 }
                [pscustomobject]@{ Id = $script:ItemB; ExternalRef = 'INJ-002'; Status = 'fired'; CreatedBefore = 1; Publishing = 0; ClaimStuck = 0 }
                [pscustomobject]@{ Id = [guid]::NewGuid(); ExternalRef = 'INJ-003'; Status = 'firing'; CreatedBefore = 1; Publishing = 1; ClaimStuck = 0 }
                [pscustomobject]@{ Id = [guid]::NewGuid(); ExternalRef = 'INJ-004'; Status = 'pending'; CreatedBefore = 0; Publishing = 0; ClaimStuck = 0 }
            )
            # The archive UPDATE's OUTPUT rows.
            ArchivedItems = @(
                [pscustomobject]@{ Id = $script:ItemA; ExternalRef = 'INJ-001'; Status = 'pending' }
                [pscustomobject]@{ Id = $script:ItemB; ExternalRef = 'INJ-002'; Status = 'fired' }
            )
            Restore       = @{}      # item id -> the status the restore UPDATE outputs (absent: it changes nothing)
            TakenBy       = @{}      # item id -> the live item holding its Inject #
            Fail          = $null    # a regex: the statement that throws
            CommitFails   = $false
            Calls         = [System.Collections.Generic.List[object]]::new()
            Log           = [System.Collections.Generic.List[string]]::new()
            Transaction   = $null
        }
    }

    function New-FakeConnection {
        $connection = [pscustomobject]@{ Name = 'fake' }
        $connection | Add-Member ScriptMethod BeginTransaction {
            $transaction = [pscustomobject]@{ Connection = $this }
            $transaction | Add-Member ScriptMethod Commit {
                if ($global:ClearFake.CommitFails) { $global:ClearFake.Log.Add('commit failed'); throw 'simulated commit failure' }
                $global:ClearFake.Log.Add('commit'); $this.Connection = $null
            }
            $transaction | Add-Member ScriptMethod Rollback { $global:ClearFake.Log.Add('rollback'); $this.Connection = $null }
            $global:ClearFake.Log.Add('begin')
            $global:ClearFake.Transaction = $transaction
            return $transaction
        }
        $connection | Add-Member ScriptMethod Close { $global:ClearFake.Log.Add('close') }
        return $connection
    }

    function Invoke-FakeSql {
        param([string] $Sql, [hashtable] $Parameters, $Transaction, [bool] $Scalar, [bool] $NonQuery)
        $fake = $global:ClearFake
        if (-not $Parameters) { $Parameters = @{} }     # a mock does not apply the stand-in's default
        $fake.Calls.Add([pscustomobject]@{ Sql = $Sql; Parameters = $Parameters.Clone(); Transaction = $Transaction; Scalar = $Scalar; NonQuery = $NonQuery })
        $fake.Log.Add(($Sql -split "`n")[0].Trim())
        if ($fake.Fail -and $Sql -match $fake.Fail) { throw 'simulated SQL failure' }
        switch -Regex ($Sql) {
            '^SELECT Id FROM Exercises WHERE Hostname' { return $fake.ExerciseId }
            '^SELECT @@SERVERNAME AS ServerName, DB_NAME\(\) AS DatabaseName$' { return [pscustomobject]@{ ServerName = $fake.Server; DatabaseName = $fake.Database } }
            '^SELECT COUNT\(\*\) FROM Posts .*CreatedWallClock < @before' { return $fake.OldPosts }
            '^SELECT COUNT\(\*\) FROM Posts .*CreatedWallClock >= @before' { return $fake.NewPosts }
            '^SELECT DraftId' { return $fake.Drafts }
            '^SELECT COUNT\(\*\) FROM EngineReviewItems' { return 0 }
            '^SELECT i\.Id, i\.ExternalRef' { return $fake.ImportedItems }
            '^UPDATE Posts SET DeletedAt = @stamp' { return $fake.OldPosts }
            '^UPDATE Posts SET DeletedAt = NULL' { return $fake.OldPosts }
            '^UPDATE EngineReviewItems SET Disposition = @vetoed OUTPUT' { return $fake.VetoedDrafts }
            '^UPDATE EngineReviewItems SET Disposition = @from' { return 1 }
            '^UPDATE i SET DeletedAt = @stamp' { return $fake.ArchivedItems }
            '^UPDATE i SET DeletedAt = NULL' {
                $status = $fake.Restore["$($Parameters['@id'])"]
                if ($status) { return [pscustomobject]@{ Status = $status } }
                return
            }
            '^SELECT TOP 1 live\.Id' { return $fake.TakenBy["$($Parameters['@id'])"] }
            '^UPDATE InjectQueueStates' { return 1 }
            default { throw "Unexpected SQL: $Sql" }
        }
    }

    function Invoke-Clear {
        <#
            Runs the real script; returns { Records; Text; Error }. The output is collected as it streams, so a run
            that throws still shows what it printed. A throw is rethrown unless -AllowError.
        #>
        param([hashtable] $Arguments = @{}, [switch] $AllowError)
        $all = @{ ApiHost = 'fake.test'; KeepStorylineId = $script:Storyline; Before = $script:Before }
        foreach ($key in $Arguments.Keys) { $all[$key] = $Arguments[$key] }
        $records = [System.Collections.Generic.List[object]]::new()
        $failure = $null
        try { & $script:ScriptFile @all *>&1 | ForEach-Object { $records.Add($_) } }
        catch { $failure = $_ }
        if ($failure -and -not $AllowError) { throw $failure }
        [pscustomobject]@{ Records = $records; Text = ($records | ForEach-Object { "$_" }) -join "`n"; Error = $failure }
    }

    function Format-Sql([string] $Sql) { ($Sql -replace '\s+', ' ').Trim() }

    function Get-Call([string] $Pattern) { @($global:ClearFake.Calls | Where-Object { $_.Sql -match $Pattern }) }

    function Get-Manifest { @(Get-ChildItem -LiteralPath (Join-Path $TestDrive 'appdata') -Recurse -File -ErrorAction SilentlyContinue) }

    function New-RestoreManifest {
        param([object[]] $Items, [switch] $NoTarget, [string] $Database = 'sqldb-fake')
        $path = Join-Path $TestDrive 'restore-input.json'
        $manifest = [ordered]@{ exerciseId = "$script:ExerciseId" }
        if (-not $NoTarget) { $manifest['target'] = [ordered]@{ server = 'sql-fake'; database = $Database } }
        $manifest['archiveStamp'] = '2026-10-20T11:30:00.1230000+00:00'
        $manifest['postsArchived'] = 3
        $manifest['vetoedDrafts'] = @([ordered]@{ id = "$script:DraftQueued"; from = 0 })
        if ($null -ne $Items) { $manifest['importedItems'] = $Items }
        $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $path
        return $path
    }
}

Describe 'Clear-DemoContent.ps1: imported run-sheet items' {
    BeforeEach {
        $global:ClearFake = New-FakeDb
        Mock Open-DemoDatabase { New-FakeConnection }
        Mock Invoke-Sql { Invoke-FakeSql -Sql $Sql -Parameters $Parameters -Transaction $Transaction -Scalar ([bool] $Scalar) -NonQuery ([bool] $NonQuery) }
        $script:SavedLocalAppData = $env:LOCALAPPDATA
        $env:LOCALAPPDATA = Join-Path $TestDrive 'appdata'
    }

    AfterEach {
        $env:LOCALAPPDATA = $script:SavedLocalAppData
        Get-ChildItem -LiteralPath $TestDrive -Recurse -File -ErrorAction SilentlyContinue | Remove-Item -Force
    }

    AfterAll {
        Remove-Variable -Name ClearFake -Scope Global -ErrorAction SilentlyContinue
    }

    Context 'Clear' {
        It 'archives the imported items and bumps the queue token inside the post archive''s transaction, then commits' {
            Invoke-Clear | Out-Null

            $fake = $global:ClearFake
            $fake.Transaction | Should -Not -BeNullOrEmpty
            $writes = @($fake.Calls | Where-Object Sql -Match '^UPDATE')
            $writes.Count | Should -Be 4
            foreach ($write in $writes) {
                [object]::ReferenceEquals($write.Transaction, $fake.Transaction) | Should -BeTrue -Because $write.Sql
            }
            @($fake.Log | Where-Object { $_ -match '^(begin|commit|rollback|close|UPDATE)' }) | Should -Be @(
                'begin'
                'UPDATE Posts SET DeletedAt = @stamp WHERE ExerciseId = @ex AND DeletedAt IS NULL AND CreatedWallClock < @before'
                'UPDATE EngineReviewItems SET Disposition = @vetoed OUTPUT deleted.DraftId, deleted.Disposition WHERE ExerciseId = @ex AND Disposition IN (0,2) AND StorylineId <> @current'
                'UPDATE i SET DeletedAt = @stamp, UpdatedAt = @stamp, Version = i.Version + 1'
                'UPDATE InjectQueueStates SET Version = Version + 1 WHERE ExerciseId = @ex'
                'commit'
                'close'
            )

            $posts = (Get-Call '^UPDATE Posts SET DeletedAt = @stamp')[0]
            $items = (Get-Call '^UPDATE i SET DeletedAt = @stamp')[0]
            $items.Parameters['@stamp'] | Should -Be $posts.Parameters['@stamp']
            $items.Parameters['@ex'] | Should -Be $script:ExerciseId
            $items.Parameters['@before'] | Should -Be $script:Before
            $items.Scalar | Should -BeFalse
            $items.NonQuery | Should -BeFalse -Because 'the OUTPUT rows are read, so the manifest names exactly what was archived'
            (Get-Call '^UPDATE InjectQueueStates')[0].Parameters['@ex'] | Should -Be $script:ExerciseId
        }

        It 'soft-deletes as the console''s Delete does, only live imported items of this exercise created before -Before, never one mid-publish' {
            Invoke-Clear | Out-Null

            # The whole statement, pinned: it was checked by hand against a real SQL Server (a scratch database with
            # the EF schema; that harness is not committed), so a change here needs that check again.
            $sql = (Get-Call '^UPDATE i SET DeletedAt = @stamp')[0].Sql
            Format-Sql $sql | Should -BeExactly (Format-Sql @'
UPDATE i SET DeletedAt = @stamp, UpdatedAt = @stamp, Version = i.Version + 1
OUTPUT inserted.Id, inserted.ExternalRef, inserted.Status
FROM InjectItems AS i
WHERE i.ExerciseId = @ex AND i.DeletedAt IS NULL AND i.ExternalRef IS NOT NULL AND i.CreatedAt < @before
  AND NOT EXISTS (SELECT 1 FROM InjectItemPosts AS p WITH (UPDLOCK, HOLDLOCK)
                  WHERE p.InjectItemId = i.Id AND p.ExerciseId = i.ExerciseId AND p.DeletedAt IS NULL AND p.ClaimedAt IS NOT NULL)
'@)
            ($sql -split 'WHERE', 2)[1] | Should -Not -Match 'Status' -Because 'every status is archived, fired included'
        }

        It 'the preview passes the claim lease and matches each claim check on the child''s exercise' {
            Invoke-Clear -Arguments @{ WhatIf = $true } | Out-Null

            $preview = (Get-Call '^SELECT i\.Id, i\.ExternalRef')[0]
            $preview.Parameters['@lease'] | Should -Be 60
            $preview.Sql | Should -Match 'CASE WHEN c\.OldestClaim < DATEADD\(SECOND, -@lease, SYSDATETIMEOFFSET\(\)\) THEN 1 ELSE 0 END AS ClaimStuck'
            $preview.Sql | Should -Match 'WHERE p\.InjectItemId = i\.Id AND p\.ExerciseId = i\.ExerciseId AND p\.DeletedAt IS NULL AND p\.ClaimedAt IS NOT NULL'
        }

        It 'every statement on InjectItems names this exercise and imported items only' {
            Invoke-Clear | Out-Null
            $global:ClearFake.Restore["$script:ItemA"] = 'pending'
            $global:ClearFake.TakenBy["$script:ItemB"] = $script:LiveB
            Invoke-Clear @{ RestoreManifest = (New-RestoreManifest -Items @(
                        [ordered]@{ id = "$script:ItemA"; externalRef = 'INJ-001'; status = 'pending' }
                        [ordered]@{ id = "$script:ItemB"; externalRef = 'INJ-002'; status = 'fired' })) } | Out-Null

            $onItems = @($global:ClearFake.Calls | Where-Object Sql -Match '\bInjectItems\b')
            $onItems.Count | Should -Be 5      # preview, archive; then restore A, restore B, and who holds B's Inject #
            foreach ($call in $onItems) {
                $call.Sql | Should -Match 'i\.ExerciseId = @ex' -Because $call.Sql
                $call.Sql | Should -Match 'i\.ExternalRef IS NOT NULL' -Because $call.Sql
                $call.Parameters['@ex'] | Should -Be $script:ExerciseId
            }
            foreach ($call in $global:ClearFake.Calls | Where-Object Sql -Match '\bInjectItemPosts\b') {
                $call.Sql | Should -Match 'p\.ExerciseId = i\.ExerciseId' -Because $call.Sql
            }
        }

        It 'the summary lists the imported items to archive, the one left alone mid-publish, and the one kept' {
            $run = Invoke-Clear

            $run.Text | Should -Match 'Exercise 6f1d2c3b-0a9e-4d8c-b7a6-5e4f3d2c1b0a \(fake\.test\) on sql-fake/sqldb-fake;'
            $run.Text | Should -Match 'Imported run-sheet items to archive \(MSEL, any status\):\s+2\s+\(kept, created since: 1\)'
            $run.Text | Should -Match 'Inject # \(status\): INJ-001 \(pending\), INJ-002 \(fired\)'
            $run.Text | Should -Match 'PUBLISHING a post right now, left alone:\s+1\s+\(Inject # INJ-003; run again in a few seconds\)'
            $run.Text | Should -Not -Match 'claim stuck'
            $run.Text | Should -Match 'Archived 3 post\(s\) and 2 imported run-sheet item\(s\); vetoed 2 stale draft\(s\)\.'
        }

        It 'a claim older than the lease is reported as stuck, with what to do, instead of "run again in a few seconds"' {
            $global:ClearFake.ImportedItems[2].ClaimStuck = 1

            $run = Invoke-Clear -Arguments @{ WhatIf = $true }

            $run.Text | Should -Match 'with a STUCK claim, left alone:\s+1\s+\(Inject # INJ-003 \(firing\)\)'
            $run.Text | Should -Match 'claim stuck \(over 60 s\): Release/Retry it in the console, then run again\. A firing item settles by itself once PAUSE INJECTS and FREEZE are off\.'
            $run.Text | Should -Not -Match 'run again in a few seconds'
        }

        It 'warns that archiving a firing item stops its unreleased posts' {
            $global:ClearFake.ImportedItems[1].Status = 'firing'

            (Invoke-Clear -Arguments @{ WhatIf = $true }).Text | Should -Match '1 of them still FIRING: archiving stops the posts they have not released yet\.'
        }

        It 'the manifest records the database and exactly the drafts and items the UPDATEs changed (their OUTPUT)' {
            $global:ClearFake.ArchivedItems = @($global:ClearFake.ArchivedItems[1])    # the preview said two; one changed
            $global:ClearFake.VetoedDrafts = @($global:ClearFake.VetoedDrafts[1])      # a draft vetoed in the console meanwhile

            $run = Invoke-Clear

            $files = Get-Manifest
            $files.Count | Should -Be 1
            $manifest = Get-Content -LiteralPath $files[0].FullName -Raw | ConvertFrom-Json
            $manifest.exerciseId | Should -Be "$script:ExerciseId"
            $manifest.target.server | Should -Be 'sql-fake'
            $manifest.target.database | Should -Be 'sqldb-fake'
            @($manifest.importedItems).Count | Should -Be 1
            $manifest.importedItems[0].id | Should -Be "$script:ItemB"
            $manifest.importedItems[0].externalRef | Should -Be 'INJ-002'
            $manifest.importedItems[0].status | Should -Be 'fired'
            @($manifest.vetoedDrafts).Count | Should -Be 1
            $manifest.vetoedDrafts[0].id | Should -Be "$script:DraftHeld"
            $manifest.vetoedDrafts[0].from | Should -Be 2
            ([DateTimeOffset] $manifest.archiveStamp) | Should -Be (Get-Call '^UPDATE i SET DeletedAt = @stamp')[0].Parameters['@stamp']
            $run.Text | Should -Match 'Archived 3 post\(s\) and 1 imported run-sheet item\(s\); vetoed 1 stale draft\(s\)\.'
        }

        It 'the undo hint for a UAT run repeats the target parameters given, and never mentions -ConnectionString' {
            $run = Invoke-Clear -Arguments @{ ApiHost = 'app-pulse-api-uat-dynamis.azurewebsites.net' }

            $run.Text | Should -Match '(?m)^Undo with:  pwsh .*Clear-DemoContent\.ps1 -RestoreManifest ".*\.json" -ApiHost ''app-pulse-api-uat-dynamis\.azurewebsites\.net''$' -Because 'a bound -ApiHost is repeated'
            $run.Text | Should -Not -Match '-ConnectionString'
        }

        It '-WhatIf lists the imported items and writes nothing' {
            $run = Invoke-Clear -Arguments @{ WhatIf = $true }

            $run.Text | Should -Match 'Imported run-sheet items to archive \(MSEL, any status\):\s+2'
            $run.Text | Should -Match 'WhatIf: nothing changed\.'
            Get-Call '^UPDATE' | Should -BeNullOrEmpty
            $global:ClearFake.Log | Should -Not -Contain 'begin'
            Get-Manifest | Should -BeNullOrEmpty
        }

        It 'does not bump the queue token when no imported item was archived' {
            $global:ClearFake.ImportedItems = @()
            $global:ClearFake.ArchivedItems = @()

            $run = Invoke-Clear

            Get-Call '^UPDATE InjectQueueStates' | Should -BeNullOrEmpty
            @((Get-Content -LiteralPath (Get-Manifest)[0].FullName -Raw | ConvertFrom-Json).importedItems).Count | Should -Be 0
            $run.Text | Should -Match 'Archived 3 post\(s\) and 0 imported run-sheet item\(s\)'
        }

        It 'imported items alone are enough to clear' {
            $global:ClearFake.OldPosts = 0
            $global:ClearFake.Drafts = @()
            $global:ClearFake.VetoedDrafts = @()

            $run = Invoke-Clear

            $run.Text | Should -Not -Match 'Nothing to clear'
            Get-Call '^UPDATE i SET DeletedAt = @stamp' | Should -HaveCount 1
            $global:ClearFake.Log | Should -Contain 'commit'
        }

        It 'nothing to clear when there are no posts, drafts or imported items' {
            $global:ClearFake.OldPosts = 0
            $global:ClearFake.Drafts = @()
            $global:ClearFake.ImportedItems = @()

            (Invoke-Clear).Text | Should -Match 'Nothing to clear\.'
            $global:ClearFake.Log | Should -Not -Contain 'begin'
            Get-Call '^UPDATE' | Should -BeNullOrEmpty
        }

        It 'a failure archiving the items rolls back the post archive too and leaves no manifest' {
            $global:ClearFake.Fail = '^UPDATE i SET DeletedAt = @stamp'

            $run = Invoke-Clear -AllowError

            "$($run.Error)" | Should -Match 'simulated SQL failure'
            $global:ClearFake.Log | Should -Contain 'rollback'
            $global:ClearFake.Log | Should -Not -Contain 'commit'
            Get-Manifest | Should -BeNullOrEmpty
        }

        It 'a manifest write that fails part-way rolls back and removes the partial manifest' {
            Mock Set-Content { [System.IO.File]::WriteAllText($Path[0], '{ "exerciseId": '); throw 'simulated disk full' }

            $run = Invoke-Clear -AllowError

            "$($run.Error)" | Should -Match 'simulated disk full'
            $global:ClearFake.Log | Should -Contain 'rollback'
            $global:ClearFake.Log | Should -Not -Contain 'commit'
            Get-Manifest | Should -BeNullOrEmpty
        }

        It 'a commit that throws keeps the manifest (the outcome is unknown) and says so' {
            $global:ClearFake.CommitFails = $true

            $run = Invoke-Clear -AllowError

            "$($run.Error)" | Should -Match 'simulated commit failure'
            $files = Get-Manifest
            $files.Count | Should -Be 1
            $run.Text | Should -Match "The commit failed or its answer was lost, so whether this clear landed is unknown\. Kept the manifest: .*$([regex]::Escape($files[0].Name))"
            $run.Text | Should -Match 'Run -WhatIf to see what is still live before restoring from it\.'
            $run.Text | Should -Not -Match 'Undo with'
            $global:ClearFake.Log | Should -Contain 'commit failed'
        }
    }

    Context 'Restore' {
        It 'restores the items in the restore transaction, bumps the queue token, and skips and reports one whose Inject # is taken' {
            $global:ClearFake.Restore["$script:ItemA"] = 'pending'
            $global:ClearFake.TakenBy["$script:ItemB"] = $script:LiveB
            $path = New-RestoreManifest -Items @(
                [ordered]@{ id = "$script:ItemA"; externalRef = 'INJ-001'; status = 'pending' }
                [ordered]@{ id = "$script:ItemB"; externalRef = 'INJ-002'; status = 'fired' }
                [ordered]@{ id = "$script:ItemC"; externalRef = 'INJ-003'; status = 'held' }
            )

            $run = Invoke-Clear -Arguments @{ RestoreManifest = $path }

            $restores = Get-Call '^UPDATE i SET DeletedAt = NULL'
            $restores.Count | Should -Be 3
            @($restores | ForEach-Object { "$($_.Parameters['@id'])" }) | Should -Be @("$script:ItemA", "$script:ItemB", "$script:ItemC")
            foreach ($call in $restores) {
                $call.Parameters['@stamp'] | Should -Be ([DateTimeOffset] '2026-10-20T11:30:00.1230000+00:00')
                $call.NonQuery | Should -BeFalse -Because 'its OUTPUT says whether the item was firing'
                # Pinned whole, like the archive: never restore over a live item holding the same Inject #.
                Format-Sql $call.Sql | Should -BeExactly (Format-Sql @'
UPDATE i SET DeletedAt = NULL, UpdatedAt = @now, Version = i.Version + 1
OUTPUT inserted.Status
FROM InjectItems AS i
WHERE i.Id = @id AND i.ExerciseId = @ex AND i.DeletedAt = @stamp AND i.ExternalRef IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM InjectItems AS live WHERE live.ExerciseId = i.ExerciseId AND live.ExternalRef = i.ExternalRef AND live.DeletedAt IS NULL)
'@)
            }
            @(Get-Call '^SELECT TOP 1 live\.Id' | ForEach-Object { "$($_.Parameters['@id'])" }) | Should -Be @("$script:ItemB", "$script:ItemC")
            Get-Call '^UPDATE InjectQueueStates' | Should -HaveCount 1
            foreach ($call in $global:ClearFake.Calls | Where-Object Sql -Match '^UPDATE|^SELECT TOP 1 live') {
                [object]::ReferenceEquals($call.Transaction, $global:ClearFake.Transaction) | Should -BeTrue -Because $call.Sql
            }
            @($global:ClearFake.Log | Where-Object { $_ -in 'begin', 'commit', 'rollback' }) | Should -Be @('begin', 'commit')

            $run.Text | Should -Match 'Restored 3 post\(s\), 1 draft\(s\) and 1 imported run-sheet item\(s\)'
            $run.Text | Should -Match "Not restored: Inject # INJ-002 \(item $script:ItemB\): live item $script:LiveB \(a newer import\) holds that Inject #, so it stays archived\."
            $run.Text | Should -Match "Not restored: Inject # INJ-003 \(item $script:ItemC\): no longer archived by that run"
            $run.Text | Should -Not -Match 'Not restored: Inject # INJ-001'
            $run.Text | Should -Not -Match 'publishes its remaining posts'
        }

        It 'warns about each restored item that was firing' {
            $global:ClearFake.Restore["$script:ItemA"] = 'firing'
            $global:ClearFake.Restore["$script:ItemB"] = 'fired'
            $path = New-RestoreManifest -Items @(
                [ordered]@{ id = "$script:ItemA"; externalRef = 'INJ-001'; status = 'firing' }
                [ordered]@{ id = "$script:ItemB"; externalRef = 'INJ-002'; status = 'fired' }
            )

            $run = Invoke-Clear -Arguments @{ RestoreManifest = $path }

            $run.Text | Should -Match 'Restored 3 post\(s\), 1 draft\(s\) and 2 imported run-sheet item\(s\)'
            $warnings = @($run.Records | Where-Object { $_ -is [System.Management.Automation.InformationRecord] -and $_.MessageData.ForegroundColor -eq 'Yellow' } | ForEach-Object { "$($_.MessageData)" })
            $warnings | Should -Be @('  Inject # INJ-001 was firing when archived: it publishes its remaining posts now, unless PAUSE INJECTS or FREEZE is on.')
        }

        It 'refuses a manifest from another database and writes nothing' {
            $run = Invoke-Clear -Arguments @{ RestoreManifest = (New-RestoreManifest -Items @() -Database 'sqldb-scratch') } -AllowError

            "$($run.Error)" | Should -Match 'That manifest was written on sql-fake/sqldb-scratch, but this run is connected to sql-fake/sqldb-fake\. Restore it with the same connection as the run that wrote it'
            $global:ClearFake.Log | Should -Not -Contain 'begin'
            Get-Call '^UPDATE' | Should -BeNullOrEmpty
        }

        It 'an older manifest without a database proceeds as before, with a note' {
            $global:ClearFake.Restore["$script:ItemA"] = 'pending'

            $run = Invoke-Clear -Arguments @{ RestoreManifest = (New-RestoreManifest -NoTarget -Items @([ordered]@{ id = "$script:ItemA"; externalRef = 'INJ-001'; status = 'pending' })) }

            $run.Text | Should -Match 'This manifest does not record its database \(it predates that check\); restoring into sql-fake/sqldb-fake\.'
            $run.Text | Should -Match 'Restored 3 post\(s\), 1 draft\(s\) and 1 imported run-sheet item\(s\)'
        }

        It 'does not bump the queue token when no item was restored' {
            $global:ClearFake.TakenBy["$script:ItemB"] = $script:LiveB

            Invoke-Clear -Arguments @{ RestoreManifest = (New-RestoreManifest -Items @([ordered]@{ id = "$script:ItemB"; externalRef = 'INJ-002'; status = 'fired' })) } | Out-Null

            Get-Call '^UPDATE InjectQueueStates' | Should -BeNullOrEmpty
            $global:ClearFake.Log | Should -Contain 'commit'
        }

        It 'an older manifest without importedItems restores posts and drafts and touches no inject item' {
            $run = Invoke-Clear -Arguments @{ RestoreManifest = (New-RestoreManifest -Items $null) }

            $run.Text | Should -Match 'Restored 3 post\(s\), 1 draft\(s\) and 0 imported run-sheet item\(s\)'
            Get-Call 'InjectItems|InjectQueueStates' | Should -BeNullOrEmpty
            $global:ClearFake.Log | Should -Contain 'commit'
        }

        It 'refuses a manifest for another exercise and writes nothing' {
            $global:ClearFake.ExerciseId = [guid]::NewGuid()

            $run = Invoke-Clear -Arguments @{ RestoreManifest = (New-RestoreManifest -Items @()) } -AllowError

            "$($run.Error)" | Should -Match 'That manifest is for exercise'
            $global:ClearFake.Log | Should -Not -Contain 'begin'
            Get-Call '^UPDATE' | Should -BeNullOrEmpty
        }
    }

    Context '-ConnectionString' {
        It 'is never printed: not in any stream (verbose and debug included), the undo hint, the manifest or $Error' {
            $marker = 'MARKER-' + [guid]::NewGuid().ToString('N')
            $connectionString = "Server=tcp:scratch.test,1433;Initial Catalog=scratch;User Id=sa;Password=$marker"
            $Error.Clear()

            $clear = Invoke-Clear -Arguments @{ ConnectionString = $connectionString; ApiHost = 'scratch.test'; Verbose = $true; Debug = $true }
            $manifestFile = (Get-Manifest)[0].FullName
            $global:ClearFake.Restore["$script:ItemA"] = 'firing'
            $restore = Invoke-Clear -Arguments @{ ConnectionString = $connectionString; ApiHost = 'scratch.test'; RestoreManifest = $manifestFile; Verbose = $true; Debug = $true }
            $global:ClearFake.Server = 'sql-elsewhere'
            $refused = Invoke-Clear -Arguments @{ ConnectionString = $connectionString; ApiHost = 'scratch.test'; RestoreManifest = $manifestFile; Verbose = $true; Debug = $true } -AllowError
            $global:ClearFake.Fail = '^UPDATE i SET DeletedAt = @stamp'
            $global:ClearFake.Server = 'sql-fake'
            $failed = Invoke-Clear -Arguments @{ ConnectionString = $connectionString; ApiHost = 'scratch.test'; Verbose = $true; Debug = $true } -AllowError

            $refused.Error | Should -Not -BeNullOrEmpty
            $failed.Error | Should -Not -BeNullOrEmpty
            $clear.Text | Should -Match "Undo with:  pwsh .*-RestoreManifest `".*\.json`" -ApiHost 'scratch\.test' -ConnectionString <the same -ConnectionString as this run>"
            foreach ($run in $clear, $restore, $refused, $failed) {
                $run.Text | Should -Not -Match $marker
                "$($run.Error)" | Should -Not -Match $marker
            }
            Get-Content -LiteralPath $manifestFile -Raw | Should -Not -Match $marker
            $everything = (@($Error) | ForEach-Object {
                    ($_ | Out-String) + ($_ | Get-Error | Out-String) + ($_ | Format-List * -Force | Out-String) + [string] $_.TargetObject
                    if ($_ -is [System.Management.Automation.ErrorRecord] -and $_.InvocationInfo) { ($_.InvocationInfo | Format-List * -Force | Out-String) + ($_.InvocationInfo.BoundParameters | Out-String) }
                }) -join "`n"
            $everything | Should -Not -Match $marker
            (Get-Error | Out-String) | Should -Not -Match $marker
            Should -Invoke Open-DemoDatabase -Times 4 -Exactly
        }
    }
}
