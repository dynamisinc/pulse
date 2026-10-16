#Requires -Version 7.4

<#
.SYNOPSIS
    Pester 5 tests for New-LoadTestExercise.ps1 (post-demo-feedback/01, #547). No network: two API hosts (the demo's and
    the load-test host) are an in-memory fake behind a mocked Invoke-WebRequest; Import-Roster.ps1 is mocked through
    Invoke-RosterImport.

.DESCRIPTION
    Covers: the happy path (create on the demo host with the load-test hostname, sign-in to the NEW exercise, watermark,
    lifecycle staged → live, Freeze → Engine to start the clock, the generated roster through Import-Roster.ps1, a 200-entry
    pool over NPC personas, valid 20-post burst items at 57 s); -WhatIf writes nothing; refusals (same host, a host already
    bound to an exercise, an unreachable host, a name not starting "Load test"); the demo exercise is never written to;
    the secret never reaches any output.

.EXAMPLE
    Invoke-Pester scripts/uat/New-LoadTestExercise.Tests.ps1 -Output Detailed
#>

BeforeAll {
    . (Join-Path $PSScriptRoot 'New-LoadTestExercise.ps1')

    $script:Secret = 'Sekr1t-' + [guid]::NewGuid().ToString('N')
    $script:SavedSecret = $env:PULSE_STAFF_SECRET

    function New-SetupFake {
        $fake = @{
            DemoId    = '7e1c2f00-1111-4222-8333-444455556666'
            NewId     = '0b5e0b5e-2222-4333-8444-555566667777'
            Token     = 'TOKEN-' + [guid]::NewGuid().ToString('N')
            Calls     = [System.Collections.Generic.List[object]]::new()
            Created   = $false
            Routes    = @{}
        }
        $npc = 1..3 | ForEach-Object { [ordered]@{ id = "aaaaaaaa-0000-4000-8000-00000000000$_"; handle = "ltnpc0$_"; displayName = "Load NPC 0$_"; kind = 'human' } }
        $people = @([ordered]@{ id = 'bbbbbbbb-0000-4000-8000-000000000001'; handle = 'ltp001'; displayName = 'Load participant 001'; kind = 'human' })
        $fake.Routes['api.fake.test GET /api/exercise-context'] = @{ Status = 200; Body = [ordered]@{ exerciseId = $fake.DemoId; exerciseName = 'Kestrel Demo'; status = 'live'; timeZone = 'America/Chicago' } }
        $fake.Routes['api.fake.test POST /api/auth/staff/login'] = @{ Status = 200; Body = [ordered]@{ token = $fake.Token; session = [ordered]@{ actingHumanId = 'human-1'; exerciseId = $fake.DemoId } } }
        $fake.Routes['api.fake.test POST /api/auth/logout'] = @{ Status = 204; Body = $null }
        $fake.Routes['api.fake.test POST /api/org/exercises'] = @{ Status = 201; Body = [ordered]@{ exercise = [ordered]@{ exerciseId = $fake.NewId; name = 'Load test x'; status = 'build'; hostname = 'load.fake.test' }; assignedRole = 'controller' } }
        $fake.Routes['load.fake.test GET /health'] = @{ Status = 200; Body = 'Healthy'; Raw = $true }
        $fake.Routes['load.fake.test POST /api/auth/staff/login'] = @{ Status = 200; Body = [ordered]@{ token = $fake.Token; session = [ordered]@{ actingHumanId = 'human-1'; exerciseId = $fake.NewId } } }
        $fake.Routes['load.fake.test POST /api/auth/logout'] = @{ Status = 204; Body = $null }
        $fake.Routes['load.fake.test PUT /api/staff/chrome-settings'] = @{ Status = 200; Body = [ordered]@{ watermarkEnabled = $true } }
        $fake.Routes['load.fake.test POST /api/staff/exercise-lifecycle/transition'] = @{ Status = 200; Body = [ordered]@{ state = 'live' } }
        $fake.Routes['load.fake.test POST /api/steering/pause-tier'] = @{ Status = 200; Body = [ordered]@{ tier = 'engine' } }
        $fake.Routes['load.fake.test GET /api/personas'] = @{ Status = 200; Body = @($npc + $people) }
        $fake.Routes['load.fake.test PUT /api/staff/noise/pool'] = @{ Status = 200; Body = [ordered]@{ poolSize = 200; rejected = @() } }
        $fake.Routes['load.fake.test POST /api/injects'] = @{ Status = 201; Body = [ordered]@{ id = [guid]::NewGuid().ToString(); kind = 'burst'; status = 'pending' } }
        return $fake
    }

    function Invoke-FakeWeb {
        param($Uri, $Method, $Headers, $Body)
        $fake = $global:SetupFake
        $u = [Uri] [string] $Uri
        $m = if ($Method) { ([string] $Method).ToUpperInvariant() } else { 'GET' }
        $h = @{}
        if ($Headers) { foreach ($k in $Headers.Keys) { $h[$k] = [string] $Headers[$k] } }
        $text = if ($Body -is [byte[]]) { [Text.Encoding]::UTF8.GetString($Body) } elseif ($Body) { [string] $Body } else { '' }
        $fake.Calls.Add([pscustomobject]@{ Method = $m; Host = $u.Host; Path = $u.AbsolutePath; Headers = $h; Body = $text })
        $key = "$($u.Host) $m $($u.AbsolutePath)"
        if ($key -eq 'load.fake.test GET /api/exercise-context') {
            # 404 until the exercise exists; then the new exercise.
            if (-not $fake.Created) { return [pscustomobject]@{ StatusCode = 404; Content = ''; Headers = @{} } }
            $content = ConvertTo-Json -Compress -InputObject ([ordered]@{ exerciseId = $fake.NewId; exerciseName = 'Load test 2026-10-17 0830'; status = 'build'; timeZone = 'UTC' })
            return [pscustomobject]@{ StatusCode = 200; Content = $content; Headers = @{} }
        }
        if ($key -eq 'api.fake.test POST /api/org/exercises') { $fake.Created = $true }
        $route = $fake.Routes[$key]
        if (-not $route) { return [pscustomobject]@{ StatusCode = 404; Content = ''; Headers = @{} } }
        $content = if ($route.Raw) { [string] $route.Body } elseif ($null -eq $route.Body) { '' } else { ConvertTo-Json -InputObject $route.Body -Depth 10 -Compress }
        return [pscustomobject]@{ StatusCode = $route.Status; Content = $content; Headers = @{} }
    }

    function Invoke-Setup {
        param([hashtable] $Extra = @{})
        $arguments = @{ ExerciseHost = 'load.fake.test'; ApiHost = 'api.fake.test'; StaffUsername = 'controller1'; OutFile = (Join-Path $TestDrive 'join.csv') }
        foreach ($key in $Extra.Keys) { $arguments[$key] = $Extra[$key] }
        $text = (& { $script:code = Invoke-NewLoadTestExercise @arguments } *>&1 | Out-String)
        return [pscustomobject]@{ Code = $script:code; Text = $text }
    }

    function Get-Calls([string] $HostName, [string] $Method, [string] $Path) {
        @($global:SetupFake.Calls | Where-Object { $_.Host -eq $HostName -and $_.Method -eq $Method -and $_.Path -eq $Path })
    }
}

AfterAll {
    $env:PULSE_STAFF_SECRET = $script:SavedSecret
    Remove-Variable -Name SetupFake, RosterCsv -Scope Global -ErrorAction SilentlyContinue
}

Describe 'New-LoadTestExercise.ps1' {
    BeforeEach {
        $env:PULSE_STAFF_SECRET = $script:Secret
        $global:SetupFake = New-SetupFake
        $global:RosterCsv = $null
        Mock Invoke-WebRequest { Invoke-FakeWeb -Uri $Uri -Method $Method -Headers $Headers -Body $Body }
        Mock Invoke-RosterImport { $global:RosterCsv = Get-Content -LiteralPath $CsvPath -Raw; $global:RosterArgs = @{ ExerciseHost = $ExerciseHost; OutFile = $OutFile; Secret = $Secret }; return 0 }
        Mock Read-Host { throw 'The secret prompt must not appear when PULSE_STAFF_SECRET is set.' }
    }

    Describe 'The happy path' {
        It 'creates the exercise on the demo host with the load-test hostname and a "Load test" name, and returns 0' {
            $run = Invoke-Setup
            $run.Code | Should -Be 0
            $create = Get-Calls 'api.fake.test' POST '/api/org/exercises'
            $create.Count | Should -Be 1
            $body = $create[0].Body | ConvertFrom-Json
            $body.hostname | Should -Be 'load.fake.test'
            $body.name | Should -Match '^Load test \d{4}-\d{2}-\d{2} \d{4}$'
            $run.Text | Should -Match 'READY'
        }

        It 'writes nothing to the demo exercise: on the demo host only sign-in, the create call and sign-out' {
            Invoke-Setup | Out-Null
            $writes = @($global:SetupFake.Calls | Where-Object { $_.Host -eq 'api.fake.test' -and $_.Method -ne 'GET' } | ForEach-Object { "$($_.Method) $($_.Path)" })
            $writes | Should -Be @('POST /api/auth/staff/login', 'POST /api/org/exercises', 'POST /api/auth/logout')
        }

        It 'signs in to the NEW exercise on the load-test host for everything else' {
            Invoke-Setup | Out-Null
            ((Get-Calls 'load.fake.test' POST '/api/auth/staff/login')[0].Body | ConvertFrom-Json).exerciseId | Should -Be $global:SetupFake.NewId
            $global:SetupFake.Calls[-1].Path | Should -Be '/api/auth/logout'
        }

        It 'turns the watermark on, goes staged then live, and starts the clock with Freeze then Engine paused' {
            Invoke-Setup | Out-Null
            ((Get-Calls 'load.fake.test' PUT '/api/staff/chrome-settings')[0].Body | ConvertFrom-Json).watermarkEnabled | Should -BeTrue
            @(Get-Calls 'load.fake.test' POST '/api/staff/exercise-lifecycle/transition' | ForEach-Object { ($_.Body | ConvertFrom-Json).to }) | Should -Be @('staged', 'live')
            $tiers = @(Get-Calls 'load.fake.test' POST '/api/steering/pause-tier' | ForEach-Object { $_.Body | ConvertFrom-Json })
            $tiers.tier | Should -Be @('freeze', 'engine')
            $tiers[0].actingHumanId | Should -Be 'human-1'
        }

        It 'imports N participants plus the NPC authors through Import-Roster.ps1 against the load-test host' {
            Invoke-Setup -Extra @{ Participants = 5; NpcCount = 2 } | Out-Null
            $lines = $global:RosterCsv.Trim() -split "`r`n"
            $lines[0] | Should -Be 'name,agency,role,email,personaHandle,signInName'
            $lines.Count | Should -Be 8
            $lines[1] | Should -Be 'Load participant 001,Load test,Participant,,,ltp001'
            $lines[-1] | Should -Be 'Load NPC 02,Load test,NPC,,,ltnpc02'
            $global:RosterArgs.ExerciseHost | Should -Be 'load.fake.test'
            $global:RosterArgs.OutFile | Should -Be (Join-Path $TestDrive 'join.csv')
            $global:RosterArgs.Secret | Should -Be $script:Secret
        }

        It 'loads a 200-entry pool (replace) over the NPC personas only' {
            Invoke-Setup | Out-Null
            $pool = (Get-Calls 'load.fake.test' PUT '/api/staff/noise/pool')[0].Body | ConvertFrom-Json
            $pool.mode | Should -Be 'replace'
            $pool.posts.Count | Should -Be 200
            @($pool.posts.persona | Sort-Object -Unique) | Should -Be @('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003')
            @($pool.posts | Where-Object { $_.text.Length -gt 280 }).Count | Should -Be 0
        }

        It 'creates valid burst items: 20 posts at the 57 s minimum window, titled "Load burst step N"' {
            Invoke-Setup -Extra @{ BurstItems = 3 } | Out-Null
            $items = @(Get-Calls 'load.fake.test' POST '/api/injects' | ForEach-Object { $_.Body | ConvertFrom-Json })
            $items.Count | Should -Be 3
            foreach ($item in $items) {
                $item.kind | Should -Be 'burst'
                $item.posts.Count | Should -Be 20
                $item.burstWindowSeconds | Should -Be 57
                $item.burstWindowSeconds | Should -BeGreaterOrEqual (19 * 3)
            }
            $items.title | Should -Be @('Load burst step 1', 'Load burst step 2', 'Load burst step 3')
        }

        It 'never sets noise above off (the harness does, per step)' {
            Invoke-Setup | Out-Null
            @(Get-Calls 'load.fake.test' PUT '/api/staff/noise').Count | Should -Be 0
        }

        It 'never prints the secret or the token' {
            $run = Invoke-Setup
            $run.Text | Should -Not -Match ([regex]::Escape($script:Secret))
            $run.Text | Should -Not -Match ([regex]::Escape($global:SetupFake.Token))
        }

        It 'prompts (hidden) for the secret when PULSE_STAFF_SECRET is unset' {
            $env:PULSE_STAFF_SECRET = $null
            Mock Read-Host { ConvertTo-SecureString $script:Secret -AsPlainText -Force } -ParameterFilter { $AsSecureString }
            (Invoke-Setup).Code | Should -Be 0
            Should -Invoke Read-Host -Times 1 -Exactly
        }
    }

    Describe '-WhatIf' {
        It 'runs only the read-only checks: no sign-in, nothing created, nothing written' {
            $run = Invoke-Setup -Extra @{ WhatIf = $true }
            $run.Code | Should -Be 0
            @($global:SetupFake.Calls | Where-Object Method -ne 'GET').Count | Should -Be 0
            Should -Invoke Invoke-RosterImport -Times 0 -Exactly
            Test-Path (Join-Path $TestDrive 'join.csv') | Should -BeFalse
            $run.Text | Should -Match 'WhatIf: nothing was signed in to, created or written'
        }
    }

    Describe 'Refusals' {
        It 'refuses the demo''s own API host as -ExerciseHost, before sending anything' {
            $run = Invoke-Setup -Extra @{ ExerciseHost = 'https://API.fake.test/' }
            $run.Code | Should -Be 1
            $global:SetupFake.Calls.Count | Should -Be 0
            $run.Text | Should -Match 'OWN host name'
        }

        It 'refuses a host that already resolves to an exercise (never reuses or touches one)' {
            $global:SetupFake.Created = $true
            $run = Invoke-Setup
            $run.Code | Should -Be 1
            $run.Text | Should -Match 'already resolves to exercise'
            @($global:SetupFake.Calls | Where-Object Method -ne 'GET').Count | Should -Be 0
        }

        It 'refuses a host that does not reach Pulse (no binding)' {
            $global:SetupFake.Routes.Remove('load.fake.test GET /health')
            $run = Invoke-Setup
            $run.Code | Should -Be 1
            $run.Text | Should -Match 'does not reach the Pulse API'
        }

        It 'refuses a name that does not start with "Load test"' {
            $run = Invoke-Setup -Extra @{ Name = 'Kestrel rehearsal' }
            $run.Code | Should -Be 1
            $global:SetupFake.Calls.Count | Should -Be 0
        }

        It 'refuses plain http and ports' {
            (Invoke-Setup -Extra @{ ExerciseHost = 'http://load.fake.test' }).Code | Should -Be 1
            (Invoke-Setup -Extra @{ ExerciseHost = 'load.fake.test:8443' }).Code | Should -Be 1
            $global:SetupFake.Calls.Count | Should -Be 0
        }
    }

    Describe 'Failures' {
        It 'stops when a step fails, says what was left behind, and still signs out' {
            $global:SetupFake.Routes['load.fake.test PUT /api/staff/noise/pool'] = @{ Status = 400; Body = [ordered]@{ detail = 'persona does not name a persona in this exercise.' } }
            $run = Invoke-Setup
            $run.Code | Should -Be 1
            $run.Text | Should -Match 'The noise pool failed: PUT /api/staff/noise/pool -> 400 persona does not name'
            $run.Text | Should -Match 'Left behind: exercise'
            $run.Text | Should -Match 'Remove-LoadTestExercise.ps1 -ExerciseHost load.fake.test'
            $global:SetupFake.Calls[-1].Path | Should -Be '/api/auth/logout'
        }

        It 'stops when Import-Roster.ps1 fails' {
            Mock Invoke-RosterImport { 1 }
            $run = Invoke-Setup
            $run.Code | Should -Be 1
            $run.Text | Should -Match 'Import-Roster.ps1 exited 1'
            @(Get-Calls 'load.fake.test' PUT '/api/staff/noise/pool').Count | Should -Be 0
        }

        It 'a 409 from the create call names the taken host name' {
            $global:SetupFake.Routes['api.fake.test POST /api/org/exercises'] = @{ Status = 409; Body = 'hostname taken' }
            $run = Invoke-Setup
            $run.Code | Should -Be 1
            $run.Text | Should -Match '409'
        }
    }
}
