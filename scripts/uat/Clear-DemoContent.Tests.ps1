#Requires -Version 7.0

<#
.SYNOPSIS
    Pester 5 tests for Clear-DemoContent.ps1's run-sheet part: the items an MSEL import created. No database:
    the script's two database seams, Open-DemoDatabase and Invoke-Sql, are mocked.

.DESCRIPTION
    Runs the real script (`& Clear-DemoContent.ps1 ...`). A Pester mock's alias wins over the function of the same
    name that the script defines when it runs, so the script itself is unchanged. Open-DemoDatabase returns a fake
    connection whose transaction records begin, commit and rollback; Invoke-Sql records every statement (its SQL,
    parameters and transaction) in the same log and answers from canned results.

    Covers:
      - every statement on InjectItems names this exercise and imported items only (ExternalRef IS NOT NULL);
      - the item archive soft-deletes as the console's Delete does (DeletedAt, UpdatedAt, Version + 1), skips an
        item mid-publish, and runs with the queue-token bump inside the post archive's transaction, before the
        commit; a failure rolls everything back and leaves no manifest;
      - the summary lists the imported items; -WhatIf writes nothing;
      - the manifest records the archived item ids (from the UPDATE's OUTPUT);
      - -RestoreManifest restores them, skips and reports an item whose Inject # a live item holds (or that is no
        longer archived by that run), and an older manifest without items still restores posts and drafts.

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

    # Stand-ins for the script's own functions, so that Pester can mock them.
    function Open-DemoDatabase { }
    function Invoke-Sql { param([string] $Sql, [hashtable] $Parameters = @{}, $Transaction, [switch] $Scalar, [switch] $NonQuery) }

    function New-FakeDb {
        [pscustomobject]@{
            ExerciseId    = $script:ExerciseId
            OldPosts      = 3
            NewPosts      = 1
            Drafts        = @([pscustomobject]@{ DraftId = [guid]::NewGuid(); Disposition = 0 })
            # The preview (ImportedItemsSql): two to archive, one mid-publish, one created after -Before.
            ImportedItems = @(
                [pscustomobject]@{ Id = $script:ItemA; ExternalRef = 'INJ-001'; Status = 'pending'; CreatedBefore = 1; Publishing = 0 }
                [pscustomobject]@{ Id = $script:ItemB; ExternalRef = 'INJ-002'; Status = 'fired'; CreatedBefore = 1; Publishing = 0 }
                [pscustomobject]@{ Id = [guid]::NewGuid(); ExternalRef = 'INJ-003'; Status = 'firing'; CreatedBefore = 1; Publishing = 1 }
                [pscustomobject]@{ Id = [guid]::NewGuid(); ExternalRef = 'INJ-004'; Status = 'pending'; CreatedBefore = 0; Publishing = 0 }
            )
            # The archive UPDATE's OUTPUT rows.
            ArchivedItems = @(
                [pscustomobject]@{ Id = $script:ItemA; ExternalRef = 'INJ-001'; Status = 'pending' }
                [pscustomobject]@{ Id = $script:ItemB; ExternalRef = 'INJ-002'; Status = 'fired' }
            )
            Restore       = @{}      # item id -> rows the restore UPDATE changes (1 or 0)
            TakenBy       = @{}      # item id -> the live item holding its Inject #
            Fail          = $null    # a regex: the statement that throws
            Calls         = [System.Collections.Generic.List[object]]::new()
            Log           = [System.Collections.Generic.List[string]]::new()
            Transaction   = $null
        }
    }

    function New-FakeConnection {
        $connection = [pscustomobject]@{ Name = 'fake' }
        $connection | Add-Member ScriptMethod BeginTransaction {
            $transaction = [pscustomobject]@{ Connection = $this }
            $transaction | Add-Member ScriptMethod Commit { $global:ClearFake.Log.Add('commit'); $this.Connection = $null }
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
        $fake.Calls.Add([pscustomobject]@{ Sql = $Sql; Parameters = $Parameters.Clone(); Transaction = $Transaction; Scalar = $Scalar; NonQuery = $NonQuery })
        $fake.Log.Add(($Sql -split "`n")[0].Trim())
        if ($fake.Fail -and $Sql -match $fake.Fail) { throw 'simulated SQL failure' }
        switch -Regex ($Sql) {
            '^SELECT Id FROM Exercises WHERE Hostname' { return $fake.ExerciseId }
            '^SELECT COUNT\(\*\) FROM Posts .*CreatedWallClock < @before' { return $fake.OldPosts }
            '^SELECT COUNT\(\*\) FROM Posts .*CreatedWallClock >= @before' { return $fake.NewPosts }
            '^SELECT DraftId' { return $fake.Drafts }
            '^SELECT COUNT\(\*\) FROM EngineReviewItems' { return 0 }
            '^SELECT i\.Id, i\.ExternalRef' { return $fake.ImportedItems }
            '^UPDATE Posts SET DeletedAt = @stamp' { return $fake.OldPosts }
            '^UPDATE Posts SET DeletedAt = NULL' { return $fake.OldPosts }
            '^UPDATE EngineReviewItems SET Disposition = @vetoed' { return @($fake.Drafts).Count }
            '^UPDATE EngineReviewItems SET Disposition = @from' { return 1 }
            '^UPDATE i SET DeletedAt = @stamp' { return $fake.ArchivedItems }
            '^UPDATE i SET DeletedAt = NULL' { return [int] $fake.Restore["$($Parameters['@id'])"] }
            '^SELECT TOP 1 live\.Id' { return $fake.TakenBy["$($Parameters['@id'])"] }
            '^UPDATE InjectQueueStates' { return 1 }
            default { throw "Unexpected SQL: $Sql" }
        }
    }

    function Invoke-Clear {
        <# Runs the real script. Returns { Records; Text }. #>
        param([hashtable] $Arguments = @{})
        $all = @{ ApiHost = 'fake.test'; KeepStorylineId = $script:Storyline; Before = $script:Before }
        foreach ($key in $Arguments.Keys) { $all[$key] = $Arguments[$key] }
        $records = @(& $script:ScriptFile @all *>&1)
        [pscustomobject]@{ Records = $records; Text = ($records | ForEach-Object { "$_" }) -join "`n" }
    }

    function Format-Sql([string] $Sql) { ($Sql -replace '\s+', ' ').Trim() }

    function Get-Call([string] $Pattern) { @($global:ClearFake.Calls | Where-Object { $_.Sql -match $Pattern }) }

    function Get-Manifest { @(Get-ChildItem -LiteralPath (Join-Path $TestDrive 'appdata') -Recurse -File -ErrorAction SilentlyContinue) }

    function New-RestoreManifest {
        param([object[]] $Items)
        $path = Join-Path $TestDrive 'restore-input.json'
        $manifest = [ordered]@{
            exerciseId    = "$script:ExerciseId"
            archiveStamp  = '2026-10-20T11:30:00.1230000+00:00'
            postsArchived = 3
            vetoedDrafts  = @([ordered]@{ id = "$([guid]::NewGuid())"; from = 0 })
        }
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
                'UPDATE EngineReviewItems SET Disposition = @vetoed WHERE ExerciseId = @ex AND Disposition IN (0,2) AND StorylineId <> @current'
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

            # The whole statement, pinned: it was checked against a real SQL Server, so a change here must be too.
            $sql = (Get-Call '^UPDATE i SET DeletedAt = @stamp')[0].Sql
            Format-Sql $sql | Should -BeExactly (Format-Sql @'
UPDATE i SET DeletedAt = @stamp, UpdatedAt = @stamp, Version = i.Version + 1
OUTPUT inserted.Id, inserted.ExternalRef, inserted.Status
FROM InjectItems AS i
WHERE i.ExerciseId = @ex AND i.DeletedAt IS NULL AND i.ExternalRef IS NOT NULL AND i.CreatedAt < @before
  AND NOT EXISTS (SELECT 1 FROM InjectItemPosts AS p WHERE p.InjectItemId = i.Id AND p.DeletedAt IS NULL AND p.ClaimedAt IS NOT NULL)
'@)
            ($sql -split 'WHERE', 2)[1] | Should -Not -Match 'Status' -Because 'every status is archived, fired included'
        }

        It 'every statement on InjectItems names this exercise and imported items only' {
            Invoke-Clear | Out-Null
            $global:ClearFake.Restore["$script:ItemA"] = 1
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
        }

        It 'the summary lists the imported items to archive, the one left alone mid-publish, and the one kept' {
            $run = Invoke-Clear

            $run.Text | Should -Match 'Imported run-sheet items to archive \(MSEL, any status\):\s+2\s+\(kept, created since: 1\)'
            $run.Text | Should -Match 'Inject # \(status\): INJ-001 \(pending\), INJ-002 \(fired\)'
            $run.Text | Should -Match 'PUBLISHING a post right now, left alone:\s+1\s+\(Inject # INJ-003; run again in a few seconds\)'
            $run.Text | Should -Match 'Archived 3 post\(s\) and 2 imported run-sheet item\(s\); vetoed 1 stale draft\(s\)\.'
        }

        It 'warns that archiving a firing item stops its unreleased posts' {
            $global:ClearFake.ImportedItems[1].Status = 'firing'

            (Invoke-Clear -Arguments @{ WhatIf = $true }).Text | Should -Match '1 of them still FIRING: archiving stops the posts they have not released yet\.'
        }

        It 'writes the archived item ids, from the UPDATE''s OUTPUT, to the restore manifest' {
            $global:ClearFake.ArchivedItems = @($global:ClearFake.ArchivedItems[1])     # the preview said two; one changed

            Invoke-Clear | Out-Null

            $files = Get-Manifest
            $files.Count | Should -Be 1
            $manifest = Get-Content -LiteralPath $files[0].FullName -Raw | ConvertFrom-Json
            $manifest.exerciseId | Should -Be "$script:ExerciseId"
            @($manifest.importedItems).Count | Should -Be 1
            $manifest.importedItems[0].id | Should -Be "$script:ItemB"
            $manifest.importedItems[0].externalRef | Should -Be 'INJ-002'
            $manifest.importedItems[0].status | Should -Be 'fired'
            ([DateTimeOffset] $manifest.archiveStamp) | Should -Be (Get-Call '^UPDATE i SET DeletedAt = @stamp')[0].Parameters['@stamp']
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

            { Invoke-Clear } | Should -Throw '*simulated SQL failure*'

            $global:ClearFake.Log | Should -Contain 'rollback'
            $global:ClearFake.Log | Should -Not -Contain 'commit'
            Get-Manifest | Should -BeNullOrEmpty
        }
    }

    Context 'Restore' {
        It 'restores the items in the restore transaction, bumps the queue token, and skips and reports one whose Inject # is taken' {
            $global:ClearFake.Restore["$script:ItemA"] = 1
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
                # Pinned whole, like the archive: never restore over a live item holding the same Inject #.
                Format-Sql $call.Sql | Should -BeExactly (Format-Sql @'
UPDATE i SET DeletedAt = NULL, UpdatedAt = @now, Version = i.Version + 1
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

            { Invoke-Clear -Arguments @{ RestoreManifest = (New-RestoreManifest -Items @()) } } | Should -Throw '*That manifest is for exercise*'

            $global:ClearFake.Log | Should -Not -Contain 'begin'
            Get-Call '^UPDATE' | Should -BeNullOrEmpty
        }
    }
}
