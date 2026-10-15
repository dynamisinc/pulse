#Requires -Version 7.0

<#
.SYNOPSIS
    Pester 5 tests for Invoke-DemoReset.ps1 (demo-feedback story 26, #544). No network and no child script really
    runs: the API is an in-memory fake behind a mocked Invoke-WebRequest, Invoke-DemoScript (the one seam that runs
    Reset-DemoState / Clear-DemoContent / Seed-DemoContent / Test-DemoReady) is mocked, and Start-Sleep is mocked.

.DESCRIPTION
    Covers:
      - the order: the runtime reset, then Reset-DemoState, Clear-DemoContent, Seed-DemoContent -RunSheet
        exceptMsel and Test-DemoReady, with the arguments each gets;
      - stop at the first failure (a non-zero exit or a throw), naming the failed step and the steps not run;
      - the fallback when POST /api/steering/runtime-state/reset answers 404 (story 18 not deployed): mark the old
        process, Reset-DemoState -Restart, poll until the new process serves; its failures;
      - -WhatIf: no request at all, each script's own preview (-CheckOnly / -WhatIf), Test-DemoReady not run;
      - the transcript in the log folder; no secret or token in it, in any output stream or in any argument;
      - .gitignore lists scripts/uat/logs/, and Reset-DemoState -Restart's help says what a restart no longer clears.

.EXAMPLE
    Invoke-Pester scripts/uat/Invoke-DemoReset.Tests.ps1 -Output Detailed
#>

BeforeAll {
    $script:ScriptFile = Join-Path $PSScriptRoot 'Invoke-DemoReset.ps1'
    . $script:ScriptFile

    $script:Secret = 'Sekr1t-' + [guid]::NewGuid().ToString('N')
    $script:SavedSecret = $env:PULSE_STAFF_SECRET
    $env:PULSE_STAFF_SECRET = $script:Secret

    function New-ResetFake {
        $fake = @{
            ExerciseId  = '7e1c2f00-1111-4222-8333-444455556666'
            Token       = 'TOKEN-' + [guid]::NewGuid().ToString('N')
            ResetStatus = 200                     # POST /api/steering/runtime-state/reset
            Tier        = 'engine'                # the old process's pause tier
            AfterRestart = [System.Collections.Generic.Queue[string]]::new()   # tiers the polls read after the restart
            MarkStatus  = 200
            ReadyCodes  = [System.Collections.Generic.Queue[int]]::new()   # /health/ready answers, then 200
            NoiseLevel  = 'off'
            NoisePutStatus = 200
            NoiseCounts = [System.Collections.Generic.Queue[int]]::new()  # postedCount per GET /api/staff/noise, then the last
            NoiseLast   = 0
            Restarted   = $false
            Codes       = @{}                     # script name (or 'Reset-DemoState.ps1 -Restart') -> exit code
            Throws      = @{}                     # script name -> message it throws
            Log         = [System.Collections.Generic.List[string]]::new()
            Calls       = [System.Collections.Generic.List[object]]::new()
            Scripts     = [System.Collections.Generic.List[object]]::new()
        }
        return $fake
    }

    function Invoke-FakeWeb {
        param($Uri, $Method, $Headers, $Body)
        $fake = $global:ResetFake
        $u = [Uri] [string] $Uri
        $Method = ([string] $Method).ToUpperInvariant()     # the mocked cmdlet's -Method is a WebRequestMethod ('Post')
        $h = @{}
        if ($Headers) { foreach ($k in $Headers.Keys) { $h[$k] = [string] $Headers[$k] } }
        $text = if ($Body -is [byte[]]) { [Text.Encoding]::UTF8.GetString($Body) } elseif ($Body) { [string] $Body } else { '' }
        $fake.Calls.Add([pscustomobject]@{ Method = $Method; Host = $u.Host; Path = $u.AbsolutePath; Headers = $h; Body = $text })
        $fake.Log.Add("$Method $($u.AbsolutePath)")
        $reply = { param([int] $Status, $Json) [pscustomobject]@{ StatusCode = $Status; Content = $(if ($null -ne $Json) { ConvertTo-Json -InputObject $Json -Compress } else { '' }); Headers = @{} } }
        $authorized = $h['Authorization'] -ceq "Bearer $($fake.Token)"
        switch ("$Method $($u.AbsolutePath)") {
            'GET /api/exercise-context' { return & $reply 200 ([ordered]@{ exerciseId = $fake.ExerciseId; exerciseName = 'Kestrel Demo' }) }
            'POST /api/auth/staff/login' { return & $reply 200 ([ordered]@{ token = $fake.Token; session = [ordered]@{ actingHumanId = 'human-1' } }) }
            'POST /api/auth/logout' { return & $reply 204 $null }
            'GET /health' { return & $reply 200 $null }
            'GET /health/ready' { return & $reply $(if ($fake.ReadyCodes.Count) { $fake.ReadyCodes.Dequeue() } else { 200 }) $null }
            'POST /api/steering/runtime-state/reset' {
                if (-not $authorized) { return & $reply 401 $null }
                if ($fake.ResetStatus -eq 200) { return & $reply 200 ([ordered]@{ tier = 'running'; clockFrozen = $false; persisted = $true }) }
                return & $reply $fake.ResetStatus $null
            }
            'GET /api/steering/pause-tier' {
                if (-not $authorized) { return & $reply 401 $null }
                $tier = if ($fake.Restarted -and $fake.AfterRestart.Count) { $fake.AfterRestart.Dequeue() } elseif ($fake.Restarted) { 'engine' } else { $fake.Tier }
                return & $reply 200 ([ordered]@{ tier = $tier; clockFrozen = $false })
            }
            'POST /api/steering/pause-tier' {
                if (-not $authorized) { return & $reply 401 $null }
                if ($fake.MarkStatus -eq 200) { $fake.Tier = ($text | ConvertFrom-Json).tier }
                return & $reply $fake.MarkStatus ([ordered]@{ tier = $fake.Tier; clockFrozen = $false })
            }
            'PUT /api/staff/noise' {
                if (-not $authorized) { return & $reply 401 $null }
                if ($fake.NoisePutStatus -ne 200) { return & $reply $fake.NoisePutStatus $null }
                $fake.NoiseLevel = ($text | ConvertFrom-Json).level
                return & $reply 200 ([ordered]@{ level = $fake.NoiseLevel; postedCount = $fake.NoiseLast; running = $false })
            }
            'GET /api/staff/noise' {
                if (-not $authorized) { return & $reply 401 $null }
                if ($fake.NoiseCounts.Count) { $fake.NoiseLast = $fake.NoiseCounts.Dequeue() }
                return & $reply 200 ([ordered]@{ level = $fake.NoiseLevel; postedCount = $fake.NoiseLast; running = ($fake.NoiseLevel -ne 'off') })
            }
            default { return & $reply 404 $null }
        }
    }

    function Invoke-FakeScript {
        param([string] $Name, [hashtable] $Arguments)
        $fake = $global:ResetFake
        $copy = @{} + $Arguments
        $fake.Scripts.Add([pscustomobject]@{ Name = $Name; Arguments = $copy })
        $key = if ($Name -eq 'Reset-DemoState.ps1' -and $Arguments['Restart']) { 'Reset-DemoState.ps1 -Restart' } else { $Name }
        $fake.Log.Add("script $key")
        Write-Host "[$key says hello]"
        if ($fake.Throws.ContainsKey($key)) { throw $fake.Throws[$key] }
        if ($key -eq 'Reset-DemoState.ps1 -Restart') { $fake.Restarted = $true }
        if ($fake.Codes.ContainsKey($key)) { return $fake.Codes[$key] }
        if ($key -eq 'Reset-DemoState.ps1 -Restart') { return 3 }
        return 0
    }

    function Invoke-Reset {
        <# Runs the reset (the function, as the script's last lines do); returns { Code; Text; Log }. #>
        param([hashtable] $Extra = @{})
        $logs = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        $arguments = @{ ApiHost = 'api.fake.test'; SiteUrl = 'https://site.fake.test'; StaffUsername = 'controller1'; LogDirectory = $logs; PollSeconds = 20; RestartTimeoutMinutes = 15; Subscription = 'sub'; ResourceGroup = 'rg'; WebAppName = 'app' }
        foreach ($key in $Extra.Keys) { $arguments[$key] = $Extra[$key] }
        $text = (& { $script:code = Invoke-DemoReset @arguments } *>&1 | Out-String)
        $logFile = Get-ChildItem -LiteralPath $logs -Filter 'demo-reset-*.log' -ErrorAction SilentlyContinue | Select-Object -First 1
        return [pscustomobject]@{ Code = $script:code; Text = $text; LogFile = $logFile; LogText = $(if ($logFile) { Get-Content -LiteralPath $logFile.FullName -Raw } else { '' }) }
    }

    function Get-ScriptNames { @($global:ResetFake.Scripts | ForEach-Object { if ($_.Name -eq 'Reset-DemoState.ps1' -and $_.Arguments['Restart']) { 'Reset-DemoState.ps1 -Restart' } else { $_.Name } }) }
}

AfterAll {
    $env:PULSE_STAFF_SECRET = $script:SavedSecret
    Remove-Variable -Name ResetFake -Scope Global -ErrorAction SilentlyContinue
}

Describe 'Invoke-DemoReset.ps1' {
    BeforeEach {
        $global:ResetFake = New-ResetFake
        Mock Invoke-WebRequest { Invoke-FakeWeb -Uri $Uri -Method $Method -Headers $Headers -Body $Body }
        Mock Invoke-DemoScript { Invoke-FakeScript -Name $Name -Arguments $Arguments }
        Mock Start-Sleep { }
        Mock Invoke-Az { throw 'az must not be called while PULSE_STAFF_SECRET is set' }
    }

    Describe 'Order' {
        It 'runs the runtime reset, then Reset-DemoState, Clear-DemoContent, Seed-DemoContent and Test-DemoReady, and exits 0' {
            $run = Invoke-Reset
            $run.Code | Should -Be 0
            $log = @($global:ResetFake.Log | Where-Object { $_ -like 'script *' -or $_ -eq 'POST /api/steering/runtime-state/reset' })
            $log | Should -Be @(
                'POST /api/steering/runtime-state/reset'
                'script Reset-DemoState.ps1'
                'script Clear-DemoContent.ps1'
                'script Seed-DemoContent.ps1'
                'script Test-DemoReady.ps1'
            )
            $run.Text | Should -Match 'DEMO RESET DONE'
        }

        It 'the runtime reset signs in as staff for the host''s exercise and signs out before step 2' {
            Invoke-Reset | Out-Null
            $login = $global:ResetFake.Calls | Where-Object Path -eq '/api/auth/staff/login' | Select-Object -First 1
            ($login.Body | ConvertFrom-Json).exerciseId | Should -Be $global:ResetFake.ExerciseId
            $logoutAt = $global:ResetFake.Log.IndexOf('POST /api/auth/logout')
            $logoutAt | Should -BeGreaterThan $global:ResetFake.Log.IndexOf('POST /api/steering/runtime-state/reset')
            $logoutAt | Should -BeLessThan $global:ResetFake.Log.IndexOf('script Reset-DemoState.ps1')
        }

        It 'passes each script its arguments: the seed gets -RunSheet exceptMsel, the pre-flight writes its JSON beside the transcript' {
            $run = Invoke-Reset -Extra @{ AutoConfirmResponses = $true; ReloadFiredRunSheet = $true; ExerciseId = '11111111-2222-4333-8444-555555555555' }
            $byName = @{}; foreach ($s in $global:ResetFake.Scripts) { $byName[$s.Name] = $s.Arguments }
            $byName['Reset-DemoState.ps1']['AutoConfirmResponses'] | Should -BeTrue
            $byName['Reset-DemoState.ps1'].ContainsKey('Restart') | Should -BeFalse
            $byName['Reset-DemoState.ps1']['ApiHost'] | Should -Be 'api.fake.test'
            $byName['Clear-DemoContent.ps1'].ContainsKey('WhatIf') | Should -BeFalse
            $byName['Seed-DemoContent.ps1']['RunSheet'] | Should -Be 'exceptMsel'
            $byName['Seed-DemoContent.ps1']['ReloadFiredRunSheet'] | Should -BeTrue
            $byName['Seed-DemoContent.ps1']['StaffUsername'] | Should -Be 'controller1'
            $byName['Test-DemoReady.ps1']['ExerciseId'] | Should -Be '11111111-2222-4333-8444-555555555555'
            $byName['Test-DemoReady.ps1']['Json'] | Should -BeTrue
            (Split-Path -Parent $byName['Test-DemoReady.ps1']['JsonPath']) | Should -Be $run.LogFile.DirectoryName
        }
    }

    Describe '-ApiHost is normalized once, before any request (PR #548 review)' {
        It '<Value>: every request goes to the origin, and every script gets the bare host api.fake.test' -ForEach @(
            @{ Value = 'https://api.fake.test' }
            @{ Value = 'https://api.fake.test/' }
            @{ Value = 'api.fake.test/' }
            @{ Value = 'HTTPS://Api.Fake.Test/swagger' }
        ) {
            $global:ResetFake.ResetStatus = 404          # the fallback passes -ApiHost to Reset-DemoState -Restart too
            'running', 'running' | ForEach-Object { $global:ResetFake.AfterRestart.Enqueue($_) }
            $run = Invoke-Reset -Extra @{ ApiHost = $Value }
            $run.Code | Should -Be 0
            @($global:ResetFake.Calls | ForEach-Object Host | Select-Object -Unique) | Should -Be 'api.fake.test'
            @($global:ResetFake.Scripts).Count | Should -Be 5
            foreach ($s in $global:ResetFake.Scripts) { $s.Arguments['ApiHost'] | Should -BeExactly 'api.fake.test' }
        }

        It '<Value> is refused before anything is sent: no request, no script, exit 1' -ForEach @(
            @{ Value = 'ftp://api.fake.test' }
            @{ Value = 'api fake test' }
            @{ Value = 'https://user:pw@api.fake.test' }
            @{ Value = 'http://api.fake.test' }
            @{ Value = '   ' }
        ) {
            $run = Invoke-Reset -Extra @{ ApiHost = $Value }
            $run.Code | Should -Be 1
            $global:ResetFake.Calls | Should -BeNullOrEmpty
            $global:ResetFake.Scripts | Should -BeNullOrEmpty
            $run.Text | Should -Match 'Nothing was sent'
        }
    }

    Describe 'Stop at the first failure' {
        It 'step <Number> (<Script>) failing with <How> stops the run, names the step, and runs nothing after it' -ForEach @(
            @{ Number = 2; Script = 'Reset-DemoState.ps1'; How = 'exit 1'; Throw = $null }
            @{ Number = 3; Script = 'Clear-DemoContent.ps1'; How = 'a throw'; Throw = 'No exercise is bound to api.fake.test.' }
            @{ Number = 4; Script = 'Seed-DemoContent.ps1'; How = 'exit 1'; Throw = $null }
            @{ Number = 5; Script = 'Test-DemoReady.ps1'; How = 'exit 1'; Throw = $null }
        ) {
            if ($Throw) { $global:ResetFake.Throws[$Script] = $Throw } else { $global:ResetFake.Codes[$Script] = 1 }
            $run = Invoke-Reset
            $run.Code | Should -Be 1
            $order = 'Reset-DemoState.ps1', 'Clear-DemoContent.ps1', 'Seed-DemoContent.ps1', 'Test-DemoReady.ps1'
            Get-ScriptNames | Should -Be @($order[0..($Number - 2)])
            $run.Text | Should -Match "\[FAIL\] $Number\. .*$([regex]::Escape($Script))"
            $run.Text | Should -Match "STOPPED at step $Number\."
            if ($Throw) { $run.Text | Should -Match ([regex]::Escape($Throw)) }
            if ($Number -lt 5) { $run.Text | Should -Match 'Not run: .*5\. Pre-flight' }
        }

        It 'a refused runtime reset (<Status>) stops at step 1 and runs no script' -ForEach @(@{ Status = 403 }, @{ Status = 500 }) {
            $global:ResetFake.ResetStatus = $Status
            $run = Invoke-Reset
            $run.Code | Should -Be 1
            $global:ResetFake.Scripts | Should -BeNullOrEmpty
            $run.Text | Should -Match "\[FAIL\] 1\. Runtime reset — POST /api/steering/runtime-state/reset -> $Status"
            $run.Text | Should -Match 'STOPPED at step 1\. Runtime reset'
            $global:ResetFake.Log[-1] | Should -Be 'POST /api/auth/logout'
        }
    }

    Describe 'After a failure past step 1, the engine is paused (M-1)' {
        It 'a failed step <Number> sets pause tier engine after the failure and prints the tier in red' -ForEach @(@{ Number = 3; Script = 'Clear-DemoContent.ps1' }, @{ Number = 5; Script = 'Test-DemoReady.ps1' }) {
            $global:ResetFake.Codes[$Script] = 1
            $global:ResetFake.Tier = 'running'
            $run = Invoke-Reset
            $run.Code | Should -Be 1
            $failedAt = $global:ResetFake.Log.IndexOf("script $Script")
            $posts = @(for ($i = 0; $i -lt $global:ResetFake.Calls.Count; $i++) { $global:ResetFake.Calls[$i] } ) | Where-Object { $_.Method -eq 'POST' -and $_.Path -eq '/api/steering/pause-tier' }
            @($posts).Count | Should -Be 1
            (@($posts)[0].Body | ConvertFrom-Json).tier | Should -Be 'engine'
            $global:ResetFake.Log.LastIndexOf('POST /api/steering/pause-tier') | Should -BeGreaterThan $failedAt
            $global:ResetFake.Log[-1] | Should -Be 'POST /api/auth/logout'
            $run.Text | Should -Match 'Pause tier after the failure: engine'
            $run.Text | Should -Match 'safe to re-run; the pause tier was set to engine'
        }

        It 'a refused pause tier says to pause the engine from the console' {
            $global:ResetFake.Codes['Seed-DemoContent.ps1'] = 1
            $global:ResetFake.MarkStatus = 500
            $run = Invoke-Reset
            $run.Text | Should -Match 'Pause tier after the failure: UNKNOWN .*Pause the engine from the console'
        }

        It 'no pause-tier call after a step 1 failure, or under -WhatIf' {
            $global:ResetFake.ResetStatus = 403
            Invoke-Reset | Out-Null
            @($global:ResetFake.Calls | Where-Object { $_.Path -eq '/api/steering/pause-tier' }) | Should -BeNullOrEmpty
            $global:ResetFake = New-ResetFake
            $global:ResetFake.Codes['Clear-DemoContent.ps1'] = 1
            Invoke-Reset -Extra @{ WhatIf = $true } | Out-Null
            $global:ResetFake.Calls | Should -BeNullOrEmpty
        }
    }

    Describe 'White noise goes off and settles before Clear-DemoContent picks its cutoff (PR #548 review)' {
        It 'a reset that starts with noise ON: PUT off, checked, polled until postedCount is still for 10 s, all before step 2' {
            $global:ResetFake.NoiseLevel = 'low'
            $global:ResetFake.NoiseLast = 5
            5, 6, 6, 6 | ForEach-Object { $global:ResetFake.NoiseCounts.Enqueue($_) }   # one post lands while settling
            $run = Invoke-Reset
            $run.Code | Should -Be 0
            $global:ResetFake.NoiseLevel | Should -Be 'off'
            $put = @($global:ResetFake.Calls | Where-Object { $_.Method -eq 'PUT' -and $_.Path -eq '/api/staff/noise' })
            $put.Count | Should -Be 1
            ($put[0].Body | ConvertFrom-Json).level | Should -Be 'off'
            $log = $global:ResetFake.Log
            $log.IndexOf('PUT /api/staff/noise') | Should -BeGreaterThan $log.IndexOf('POST /api/steering/runtime-state/reset')
            $log.LastIndexOf('GET /api/staff/noise') | Should -BeLessThan $log.IndexOf('script Reset-DemoState.ps1')
            $log.LastIndexOf('GET /api/staff/noise') | Should -BeLessThan $log.IndexOf('script Clear-DemoContent.ps1')
            # Read after the PUT (5), then 6 (moved), 6, 6: still for 10 s after three 5-second waits.
            @($log | Where-Object { $_ -eq 'GET /api/staff/noise' }).Count | Should -Be 4
            Should -Invoke Start-Sleep -ParameterFilter { $Seconds -eq 5 } -Times 3 -Exactly
            $run.Text | Should -Match '\[PASS\] 1b\. White noise off — level off; postedCount still at 6 for 10 s \(1 landed while settling\)'
        }

        It 'the noise-off write failing (<Status>) stops the run before step 2, and the engine is paused' -ForEach @(@{ Status = 500 }, @{ Status = 403 }) {
            $global:ResetFake.NoiseLevel = 'low'
            $global:ResetFake.NoisePutStatus = $Status
            $run = Invoke-Reset
            $run.Code | Should -Be 1
            $global:ResetFake.Scripts | Should -BeNullOrEmpty
            $run.Text | Should -Match "\[FAIL\] 1b\. White noise off — PUT /api/staff/noise \{ level: off \} -> $Status"
            $run.Text | Should -Match 'STOPPED at step 1b\. White noise off\. Not run: 2\. Engine re-seed, 3\. Clear old content, 4\. Seed the demo, 5\. Pre-flight'
            @($global:ResetFake.Calls | Where-Object { $_.Method -eq 'POST' -and $_.Path -eq '/api/steering/pause-tier' }).Count | Should -Be 1
            $run.Text | Should -Match 'Pause tier after the failure: engine'
        }

        It 'noise that reads back on after the PUT stops the run' {
            Mock Invoke-WebRequest {
                $r = Invoke-FakeWeb -Uri $Uri -Method $Method -Headers $Headers -Body $Body
                if ("$Method" -eq 'Get' -and ([Uri] [string] $Uri).AbsolutePath -eq '/api/staff/noise') { $global:ResetFake.NoiseLevel = 'low'; return [pscustomobject]@{ StatusCode = 200; Content = '{"level":"low","postedCount":0}'; Headers = @{} } }
                $r
            }
            $run = Invoke-Reset
            $run.Code | Should -Be 1
            $run.Text | Should -Match "level 'low' \(expected off\)"
            $global:ResetFake.Scripts | Should -BeNullOrEmpty
        }

        It 'noise that never settles (postedCount keeps moving for 90 s) stops the run' {
            1..40 | ForEach-Object { $global:ResetFake.NoiseCounts.Enqueue($_) }
            $run = Invoke-Reset
            $run.Code | Should -Be 1
            $run.Text | Should -Match 'postedCount kept moving for 90 s'
            $global:ResetFake.Scripts | Should -BeNullOrEmpty
        }

        It '-WhatIf only describes it' {
            $run = Invoke-Reset -Extra @{ WhatIf = $true }
            $run.Text | Should -Match 'WhatIf: would then PUT /api/staff/noise'
            $global:ResetFake.Calls | Should -BeNullOrEmpty
        }
    }

    Describe 'Step 1 waits for the API and serverless SQL first (M-2)' {
        It 'polls /health then /health/ready before the first call, and goes on once SQL answers' {
            503, 503 | ForEach-Object { $global:ResetFake.ReadyCodes.Enqueue($_) }
            $run = Invoke-Reset
            $run.Code | Should -Be 0
            @($global:ResetFake.Log | Select-Object -First 5) | Should -Be @('GET /health', 'GET /health/ready', 'GET /health/ready', 'GET /health/ready', 'GET /api/exercise-context')
            Should -Invoke Start-Sleep -ParameterFilter { $Seconds -eq 10 } -Times 2 -Exactly
        }

        It 'SQL never waking fails step 1 before any sign-in or reset' {
            1..12 | ForEach-Object { $global:ResetFake.ReadyCodes.Enqueue(503) }
            $run = Invoke-Reset
            $run.Code | Should -Be 1
            @($global:ResetFake.Calls | Where-Object { $_.Method -eq 'POST' }) | Should -BeNullOrEmpty
            $run.Text | Should -Match '/health/ready -> 503 after 2 min'
            $global:ResetFake.Scripts | Should -BeNullOrEmpty
        }
    }

    Describe 'Fallback: the reset route answers 404 (story 18 not deployed)' {
        BeforeEach { $global:ResetFake.ResetStatus = 404 }

        It 'marks the old process, restarts, polls until the new process serves, then runs steps 2 to 5' {
            $global:ResetFake.Tier = 'running'
            'engine', 'engine', 'running', 'running' | ForEach-Object { $global:ResetFake.AfterRestart.Enqueue($_) }
            $run = Invoke-Reset
            $run.Code | Should -Be 0
            $log = @($global:ResetFake.Log | Where-Object { $_ -like 'script *' -or $_ -like 'POST /api/steering/*' })
            $log | Should -Be @(
                'POST /api/steering/runtime-state/reset'
                'POST /api/steering/pause-tier'
                'script Reset-DemoState.ps1 -Restart'
                'script Reset-DemoState.ps1'
                'script Clear-DemoContent.ps1'
                'script Seed-DemoContent.ps1'
                'script Test-DemoReady.ps1'
            )
            (($global:ResetFake.Calls | Where-Object { $_.Method -eq 'POST' -and $_.Path -eq '/api/steering/pause-tier' }).Body | ConvertFrom-Json).tier | Should -Be 'engine'
            # Four polls (engine, engine, running, running): three waits between them, never a fixed 8 minutes.
            Should -Invoke Start-Sleep -ParameterFilter { $Seconds -eq 20 } -Times 3 -Exactly
            $run.Text | Should -Match 'restart fallback: the new process is serving after ~1 min'
        }

        It 'an old process already off running is not marked again' {
            $global:ResetFake.Tier = 'freeze'
            'running', 'running' | ForEach-Object { $global:ResetFake.AfterRestart.Enqueue($_) }
            (Invoke-Reset).Code | Should -Be 0
            @($global:ResetFake.Calls | Where-Object { $_.Method -eq 'POST' -and $_.Path -eq '/api/steering/pause-tier' }) | Should -BeNullOrEmpty
        }

        It 'one running read is not enough: a flapping handover needs two in a row' {
            'running', 'engine', 'running', 'running' | ForEach-Object { $global:ResetFake.AfterRestart.Enqueue($_) }
            (Invoke-Reset).Code | Should -Be 0
            @($global:ResetFake.Calls | Where-Object { $_.Method -eq 'GET' -and $_.Path -eq '/api/steering/pause-tier' }).Count | Should -Be 5   # 1 before + 4 polls
        }

        It 'Reset-DemoState -Restart exiting <Code> (not 3) fails step 1' -ForEach @(@{ Code = 1 }, @{ Code = 0 }) {
            $global:ResetFake.Codes['Reset-DemoState.ps1 -Restart'] = $Code
            $run = Invoke-Reset
            $run.Code | Should -Be 1
            Get-ScriptNames | Should -Be @('Reset-DemoState.ps1 -Restart')
            $run.Text | Should -Match "Reset-DemoState.ps1 -Restart exited $Code \(expected 3"
        }

        It 'the new process never answering within -RestartTimeoutMinutes fails step 1' {
            $run = Invoke-Reset -Extra @{ RestartTimeoutMinutes = 2; PollSeconds = 60 }
            $run.Code | Should -Be 1
            Should -Invoke Start-Sleep -ParameterFilter { $Seconds -eq 60 } -Times 1 -Exactly
            $run.Text | Should -Match 'did not answer within 2 min'
            Get-ScriptNames | Should -Be @('Reset-DemoState.ps1 -Restart')
        }

        It 'a refused marker fails step 1 before any restart' {
            $global:ResetFake.Tier = 'running'
            $global:ResetFake.MarkStatus = 403
            $run = Invoke-Reset
            $run.Code | Should -Be 1
            $global:ResetFake.Scripts | Should -BeNullOrEmpty
            $run.Text | Should -Match 'marking the old process \(pause tier engine\) -> 403'
        }
    }

    Describe '-WhatIf' {
        It 'sends no request, runs each script''s own preview, does not run the pre-flight, and exits 0' {
            $run = Invoke-Reset -Extra @{ WhatIf = $true }
            $run.Code | Should -Be 0
            $global:ResetFake.Calls | Should -BeNullOrEmpty
            Get-ScriptNames | Should -Be @('Reset-DemoState.ps1', 'Clear-DemoContent.ps1', 'Seed-DemoContent.ps1')
            $byName = @{}; foreach ($s in $global:ResetFake.Scripts) { $byName[$s.Name] = $s.Arguments }
            $byName['Reset-DemoState.ps1']['CheckOnly'] | Should -BeTrue
            $byName['Reset-DemoState.ps1'].ContainsKey('Restart') | Should -BeFalse
            $byName['Reset-DemoState.ps1'].ContainsKey('AutoConfirmResponses') | Should -BeFalse
            $byName['Clear-DemoContent.ps1']['WhatIf'] | Should -BeTrue
            $byName['Seed-DemoContent.ps1']['WhatIf'] | Should -BeTrue
            $byName['Seed-DemoContent.ps1']['RunSheet'] | Should -Be 'exceptMsel'
            $run.Text | Should -Match 'Plan:'
            $run.Text | Should -Match 'WhatIf: would POST /api/steering/runtime-state/reset'
            $run.Text | Should -Match '\[Seed-DemoContent.ps1 says hello\]'
            $run.Text | Should -Match 'WHATIF DONE'
        }

        It 'a failed preview is reported, the other previews still run, and it exits 1' {
            $global:ResetFake.Throws['Clear-DemoContent.ps1'] = 'az login needed'
            $run = Invoke-Reset -Extra @{ WhatIf = $true }
            $run.Code | Should -Be 1
            Get-ScriptNames | Should -Be @('Reset-DemoState.ps1', 'Clear-DemoContent.ps1', 'Seed-DemoContent.ps1')
            $run.Text | Should -Match 'WHATIF — 1 preview\(s\) failed: 3\. Clear old content'
        }
    }

    Describe 'Transcript and secrets' {
        It 'writes a transcript to the log folder as demo-reset-<timestamp>.log, holding every step''s output' {
            $run = Invoke-Reset
            $run.LogFile.Name | Should -Match '^demo-reset-\d{8}-\d{6}\.log$'
            foreach ($name in 'Reset-DemoState.ps1', 'Clear-DemoContent.ps1', 'Seed-DemoContent.ps1', 'Test-DemoReady.ps1') {
                $run.LogText | Should -Match ([regex]::Escape("[$name says hello]"))
            }
            $run.LogText | Should -Match 'DEMO RESET DONE'
        }

        It 'never passes or logs a secret or a token: not in an argument, the transcript or any output stream (live, fallback and -WhatIf)' {
            $runs = @(Invoke-Reset -Extra @{ Verbose = $true })
            $global:ResetFake.ResetStatus = 404
            'running', 'running' | ForEach-Object { $global:ResetFake.AfterRestart.Enqueue($_) }
            $runs += Invoke-Reset
            $runs += Invoke-Reset -Extra @{ WhatIf = $true }
            foreach ($needle in $script:Secret, $global:ResetFake.Token) {
                foreach ($run in $runs) {
                    $run.Text | Should -Not -Match ([regex]::Escape($needle))
                    $run.LogText | Should -Not -Match ([regex]::Escape($needle))
                }
                foreach ($s in $global:ResetFake.Scripts) { ($s.Arguments.Values | Out-String) | Should -Not -Match ([regex]::Escape($needle)) }
                ($global:Error | Out-String) | Should -Not -Match ([regex]::Escape($needle))
            }
            # The secret goes only in the sign-in body.
            @($global:ResetFake.Calls | Where-Object { $_.Body -match [regex]::Escape($script:Secret) } | ForEach-Object Path | Select-Object -Unique) | Should -Be '/api/auth/staff/login'
        }

        It '.gitignore lists scripts/uat/logs/' {
            $gitignore = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../../.gitignore')
            $gitignore | Should -Contain 'scripts/uat/logs/'
        }

        It 'Reset-DemoState.ps1 -Restart''s help says a restart no longer clears the tier or the clock after story 18 (DF-28)' {
            $help = (Get-Help (Join-Path $PSScriptRoot 'Reset-DemoState.ps1') -Parameter Restart | Out-String)
            $help | Should -Match 'DF-28'
            $help | Should -Match 'runtime-state/reset'
            $help | Should -Match 'no longer'
        }
    }

    Describe 'Invoke-DemoScript (the real seam)' {
        It 'returns a script''s exit code and survives its exit; a script that ends without one returns 0' {
            $folder = Join-Path $TestDrive 'scripts'
            New-Item -ItemType Directory -Force -Path $folder | Out-Null
            Set-Content -LiteralPath (Join-Path $folder 'Exits3.ps1') -Value "param([switch] `$Restart)`nWrite-Host 'restarting'`nexit 3"
            Set-Content -LiteralPath (Join-Path $folder 'Returns.ps1') -Value "param([switch] `$WhatIf)`nWrite-Host 'previewing'`nreturn"
            Mock Join-Path { [IO.Path]::Combine($folder, $ChildPath) } -ParameterFilter { $ChildPath -like '*.ps1' -and $Path -ne $folder }
            $real = (Get-Command Invoke-DemoScript -CommandType Function).ScriptBlock
            & $real -Name 'Exits3.ps1' -Arguments @{ Restart = $true } 6>$null | Should -Be 3
            & $real -Name 'Returns.ps1' -Arguments @{ WhatIf = $true } 6>$null | Should -Be 0
        }
    }
}
