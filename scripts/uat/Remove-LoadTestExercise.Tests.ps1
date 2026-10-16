#Requires -Version 7.4

<#
.SYNOPSIS
    Pester 5 tests for Remove-LoadTestExercise.ps1 (post-demo-feedback/01, #547). No network: the two API hosts are an
    in-memory fake behind a mocked Invoke-WebRequest.

.DESCRIPTION
    Remove: noise off, tier engine, lifecycle live → completed → archived (and from staged), the join-URL file(s)
    deleted, refusal of the demo exercise and of a non-"Load test" exercise, -WhatIf changes and deletes nothing, a
    failed step is reported and the rest still run, what is left is listed, the secret never printed.

.EXAMPLE
    Invoke-Pester scripts/uat/Remove-LoadTestExercise.Tests.ps1 -Output Detailed
#>

BeforeAll {
    . (Join-Path $PSScriptRoot 'Remove-LoadTestExercise.ps1')

    $script:Secret = 'Sekr1t-' + [guid]::NewGuid().ToString('N')
    $script:SavedSecret = $env:PULSE_STAFF_SECRET

    function New-TeardownFake {
        param([string] $Name = 'Load test 2026-10-17 0830', [string] $State = 'live')
        $fake = @{
            DemoId = '7e1c2f00-1111-4222-8333-444455556666'
            LoadId = '0b5e0b5e-2222-4333-8444-555566667777'
            Token  = 'TOKEN-' + [guid]::NewGuid().ToString('N')
            State  = $State
            Calls  = [System.Collections.Generic.List[object]]::new()
            Routes = @{}
            Fail   = @{}
        }
        $fake.Routes['api.fake.test GET /api/exercise-context'] = [ordered]@{ exerciseId = $fake.DemoId; exerciseName = 'Kestrel Demo'; status = 'live' }
        $fake.Routes['load.fake.test GET /api/exercise-context'] = [ordered]@{ exerciseId = $fake.LoadId; exerciseName = $Name; status = $State }
        $fake.Routes['load.fake.test POST /api/auth/staff/login'] = [ordered]@{ token = $fake.Token; session = [ordered]@{ actingHumanId = 'human-1'; exerciseId = $fake.LoadId } }
        return $fake
    }

    function Invoke-FakeWeb {
        param($Uri, $Method, $Headers, $Body)
        $fake = $global:TeardownFake
        $u = [Uri] [string] $Uri
        $m = if ($Method) { ([string] $Method).ToUpperInvariant() } else { 'GET' }
        $text = if ($Body -is [byte[]]) { [Text.Encoding]::UTF8.GetString($Body) } elseif ($Body) { [string] $Body } else { '' }
        $fake.Calls.Add([pscustomobject]@{ Method = $m; Host = $u.Host; Path = $u.AbsolutePath; Body = $text })
        $key = "$($u.Host) $m $($u.AbsolutePath)"
        $reply = { param($Status, $Object) [pscustomobject]@{ StatusCode = $Status; Content = $(if ($null -eq $Object) { '' } else { ConvertTo-Json -InputObject $Object -Depth 8 -Compress }); Headers = @{} } }
        if ($fake.Fail.ContainsKey($key)) { return & $reply $fake.Fail[$key] ([ordered]@{ detail = 'nope' }) }
        switch ($key) {
            'load.fake.test POST /api/auth/logout' { return & $reply 204 $null }
            'load.fake.test PUT /api/staff/noise' { return & $reply 200 ([ordered]@{ level = 'off' }) }
            'load.fake.test POST /api/steering/pause-tier' { return & $reply 200 ([ordered]@{ tier = 'engine' }) }
            'load.fake.test GET /api/staff/exercise-lifecycle' { return & $reply 200 ([ordered]@{ state = $fake.State }) }
            'load.fake.test POST /api/staff/exercise-lifecycle/transition' {
                $to = ($text | ConvertFrom-Json).to
                $allowed = @{ build = @('staged'); staged = @('live'); live = @('paused', 'completed'); paused = @('live', 'completed'); completed = @('archived'); archived = @() }
                if ($allowed[$fake.State] -notcontains $to) { return & $reply 409 ([ordered]@{ detail = "not allowed from $($fake.State)" }) }
                $fake.State = $to
                return & $reply 200 ([ordered]@{ state = $to })
            }
        }
        if ($fake.Routes.ContainsKey($key)) { return & $reply 200 $fake.Routes[$key] }
        return & $reply 404 $null
    }

    function Invoke-Teardown {
        param([hashtable] $Extra = @{})
        $arguments = @{ ExerciseHost = 'load.fake.test'; ApiHost = 'api.fake.test'; StaffUsername = 'controller1'; ResourceGroup = 'rg'; WebAppName = 'app' }
        foreach ($key in $Extra.Keys) { $arguments[$key] = $Extra[$key] }
        $text = (& { $script:code = Invoke-RemoveLoadTestExercise @arguments } *>&1 | Out-String)
        return [pscustomobject]@{ Code = $script:code; Text = $text }
    }

    function Get-Writes { @($global:TeardownFake.Calls | Where-Object Method -ne 'GET' | ForEach-Object { "$($_.Method) $($_.Path)" }) }
}

AfterAll {
    $env:PULSE_STAFF_SECRET = $script:SavedSecret
    Remove-Variable -Name TeardownFake -Scope Global -ErrorAction SilentlyContinue
}

Describe 'Remove-LoadTestExercise.ps1' {
    BeforeEach {
        $env:PULSE_STAFF_SECRET = $script:Secret
        $global:TeardownFake = New-TeardownFake
        Mock Invoke-WebRequest { Invoke-FakeWeb -Uri $Uri -Method $Method -Headers $Headers -Body $Body }
        Mock Read-Host { throw 'The secret prompt must not appear when PULSE_STAFF_SECRET is set.' }
        $script:JoinFile = Join-Path $TestDrive ('loadtest-join-urls-{0}.csv' -f [guid]::NewGuid().ToString('N'))
        Set-Content -LiteralPath $script:JoinFile -Value '"name","signInName","joinUrl"'
    }

    It 'turns noise off, sets Engine paused, moves live → completed → archived, deletes the join file, returns 0' {
        $run = Invoke-Teardown -Extra @{ JoinUrlFile = @($script:JoinFile) }
        $run.Code | Should -Be 0
        Get-Writes | Should -Be @('POST /api/auth/staff/login', 'PUT /api/staff/noise', 'POST /api/steering/pause-tier',
            'POST /api/staff/exercise-lifecycle/transition', 'POST /api/staff/exercise-lifecycle/transition', 'POST /api/auth/logout')
        $global:TeardownFake.State | Should -Be 'archived'
        (($global:TeardownFake.Calls | Where-Object Path -eq '/api/staff/noise').Body | ConvertFrom-Json).level | Should -Be 'off'
        $tier = ($global:TeardownFake.Calls | Where-Object Path -eq '/api/steering/pause-tier').Body | ConvertFrom-Json
        $tier.tier | Should -Be 'engine'
        $tier.actingHumanId | Should -Be 'human-1'
        Test-Path -LiteralPath $script:JoinFile | Should -BeFalse
        $run.Text | Should -Match 'az webapp config hostname delete --resource-group rg --webapp-name app --hostname load.fake.test'
        $run.Text | Should -Match 'Test-DemoReady.ps1'
    }

    It 'signs in to the load-test exercise only; never writes to the demo host' {
        Invoke-Teardown | Out-Null
        @($global:TeardownFake.Calls | Where-Object { $_.Host -eq 'api.fake.test' -and $_.Method -ne 'GET' }).Count | Should -Be 0
        (($global:TeardownFake.Calls | Where-Object Path -eq '/api/auth/staff/login').Body | ConvertFrom-Json).exerciseId | Should -Be $global:TeardownFake.LoadId
    }

    It 'takes a staged exercise through live to completed and archived' {
        $global:TeardownFake = New-TeardownFake -State 'staged'
        (Invoke-Teardown).Code | Should -Be 0
        $global:TeardownFake.State | Should -Be 'archived'
    }

    It 'is idempotent on an archived exercise' {
        $global:TeardownFake = New-TeardownFake -State 'archived'
        $run = Invoke-Teardown
        $run.Code | Should -Be 0
        $run.Text | Should -Match 'already archived'
    }

    It 'refuses the demo exercise (the load host resolving to it): nothing changed, nothing deleted' {
        $global:TeardownFake.Routes['load.fake.test GET /api/exercise-context']['exerciseId'] = $global:TeardownFake.DemoId
        $run = Invoke-Teardown -Extra @{ JoinUrlFile = @($script:JoinFile) }
        $run.Code | Should -Be 1
        $run.Text | Should -Match 'IS the demo exercise'
        Get-Writes | Should -BeNullOrEmpty
        Test-Path -LiteralPath $script:JoinFile | Should -BeTrue
    }

    It 'refuses an exercise not named "Load test …"' {
        $global:TeardownFake = New-TeardownFake -Name 'Kestrel rehearsal'
        $run = Invoke-Teardown
        $run.Code | Should -Be 1
        $run.Text | Should -Match "not named 'Load test"
        Get-Writes | Should -BeNullOrEmpty
    }

    It 'refuses -ExerciseHost equal to the demo''s API host before sending anything' {
        $run = Invoke-Teardown -Extra @{ ExerciseHost = 'api.fake.test' }
        $run.Code | Should -Be 1
        $global:TeardownFake.Calls.Count | Should -Be 0
    }

    It '-WhatIf changes nothing and deletes nothing' {
        $run = Invoke-Teardown -Extra @{ WhatIf = $true; JoinUrlFile = @($script:JoinFile) }
        $run.Code | Should -Be 0
        Get-Writes | Should -BeNullOrEmpty
        Test-Path -LiteralPath $script:JoinFile | Should -BeTrue
        $run.Text | Should -Match 'WhatIf: nothing was signed in to, changed or deleted'
    }

    It 'reports a failed step, still runs the rest and signs out, and returns 1' {
        $global:TeardownFake.Fail['load.fake.test PUT /api/staff/noise'] = 500
        $run = Invoke-Teardown -Extra @{ JoinUrlFile = @($script:JoinFile) }
        $run.Code | Should -Be 1
        $run.Text | Should -Match 'White noise off\. — PUT /api/staff/noise -> 500'
        $global:TeardownFake.State | Should -Be 'archived'
        Test-Path -LiteralPath $script:JoinFile | Should -BeFalse
        $global:TeardownFake.Calls[-1].Path | Should -Be '/api/auth/logout'
        $run.Text | Should -Match 'NOT CLEAN'
    }

    It 'never prints the secret or the token' {
        $run = Invoke-Teardown
        $run.Text | Should -Not -Match ([regex]::Escape($script:Secret))
        $run.Text | Should -Not -Match ([regex]::Escape($global:TeardownFake.Token))
    }
}
