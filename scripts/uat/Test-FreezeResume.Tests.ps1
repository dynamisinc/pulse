#Requires -Version 7.0

<#
.SYNOPSIS
    Pester 5 tests for Test-FreezeResume.ps1 against a simulated Pulse API. No network, no az, no real waiting.

.DESCRIPTION
    Runs the real script (`& Test-FreezeResume.ps1 ...`). A Pester mock's alias wins over the function of the same
    name that the script defines, so the script itself is unchanged. The seams mocked are Invoke-Api (every HTTP
    call), Get-Now and Wait-Seconds (a fake wall clock, so a 90 s hold or a 9-minute restart window runs
    instantly), Read-HiddenValue (prompts) and Invoke-AppServiceRestart (az).

    The simulator models the server: the pause tier and its scenario clock (frozen or running at 1x wall time),
    the overlay, the noise knob (a post every 30 s while running, stamped with the scenario time), the inject
    queue with the Freeze fire refusal, and an App Service restart that clears in-memory state after the
    ~6-minute handover unless Freeze is persisted (demo-feedback/18). Faults are switched on per test.

    Covers: the pass path; a scenario minute that moves across the Freeze; an overlay that never shows pause; an
    inject fire that is not refused; the tier restored to the one found, also when a step throws; the refusal to
    run against the demo exercise unless -ExerciseId names it; the restart path before and after story 18; and
    that the staff secret is never printed.

.EXAMPLE
    Invoke-Pester scripts/uat/Test-FreezeResume.Tests.ps1 -Output Detailed
#>

# The simulator's state lives in $global:Frz* variables (removed in AfterAll): the functions and mocks below run
# while the script under test is on the call stack, and $script: would resolve to THAT script's scope.
BeforeAll {
    $global:FrzScriptFile = Join-Path $PSScriptRoot 'Test-FreezeResume.ps1'
    $global:FrzDemoId = '11111111-1111-4111-8111-111111111111'
    $global:FrzCheckId = '22222222-2222-4222-8222-222222222222'
    $global:FrzSecret = 'not-a-real-secret-7f3a'

    # Stand-ins for the script's own functions, so that Pester can mock them.
    function Invoke-Api { param([string] $Method, [string] $Path, [object] $Body, [string] $Token, [switch] $Anonymous) }
    function Get-Now { }
    function Wait-Seconds([int] $Seconds) { }
    function Read-HiddenValue([string] $Prompt) { }
    function Invoke-AppServiceRestart { }

    function New-Server([hashtable] $Faults = @{}) {
        $start = [DateTimeOffset]::Parse('2026-10-16T15:00:00Z')
        $global:FrzS = @{
            Wall           = $start
            # Scenario clock: scenario = Base (+ Wall - WallBase while running).
            ScenarioBase   = [DateTimeOffset]::Parse('2026-03-14T09:00:00Z')
            WallBase       = $start
            ClockFrozen    = $false
            Tier           = 'engine'
            Register       = 'in-fiction'
            Lifecycle      = 'live'
            NoiseLevel     = 'off'
            PoolSize       = 0
            PostedCount    = 4
            LastPostedAt   = '2026-03-14T08:55:00.0000000+00:00'
            NextPostAt     = $start.AddSeconds(30)
            Items          = @{}
            ActiveExercise = $null
            RestartAt      = $null
            Tokens         = [System.Collections.Generic.HashSet[string]]::new()
            TokenSeq       = 0
            Logins         = 0
            HealthCalls    = 0
            PoolPersonas   = @()
            InjectPersonas = @()
            Calls          = [System.Collections.Generic.List[string]]::new()
            TierPosts      = [System.Collections.Generic.List[string]]::new()
            Faults         = $Faults
        }
    }

    function Get-SimScenario([DateTimeOffset] $At) {
        if ($global:FrzS.ClockFrozen -and -not $global:FrzS.Faults.ClockRunsDuringFreeze) { return $global:FrzS.ScenarioBase }
        return $global:FrzS.ScenarioBase + ($At - $global:FrzS.WallBase)
    }

    function Test-SimNoiseRunning {
        $global:FrzS.NoiseLevel -ne 'off' -and $global:FrzS.PoolSize -gt 0 -and $global:FrzS.Tier -ne 'freeze'
    }

    function Step-SimTime([int] $Seconds) {
        $target = $global:FrzS.Wall.AddSeconds($Seconds)
        while ($global:FrzS.NextPostAt -le $target) {
            if (Test-SimNoiseRunning) {
                $global:FrzS.PostedCount++
                $global:FrzS.LastPostedAt = (Get-SimScenario $global:FrzS.NextPostAt).ToString('O')
            }
            $global:FrzS.NextPostAt = $global:FrzS.NextPostAt.AddSeconds(30)
        }
        $global:FrzS.Wall = $target
        # The ~6-minute handover: the new process starts with an empty in-memory pause tier unless persisted (18).
        if ($global:FrzS.RestartAt -and ($global:FrzS.Wall - $global:FrzS.RestartAt).TotalMinutes -ge 6) {
            $global:FrzS.RestartAt = $null
            $global:FrzS.Handover = $global:FrzS.Wall
            if ($global:FrzS.Faults.SessionsLost) { $global:FrzS.Tokens.Clear() }
            if (-not $global:FrzS.Faults.FreezePersisted) {
                $global:FrzS.Tier = 'running'
                $global:FrzS.ScenarioBase = Get-SimScenario $global:FrzS.Wall
                $global:FrzS.WallBase = $global:FrzS.Wall
                $global:FrzS.ClockFrozen = $false
            }
        }
    }

    function New-Response([int] $Status, $Json) { [pscustomobject]@{ Status = $Status; Json = $Json; Content = ($Json | ConvertTo-Json -Depth 8 -Compress) } }

    function Invoke-SimApi([string] $Method, [string] $Path, $Body, [string] $Token, [bool] $Anonymous) {
        $S = $global:FrzS
        $S.Calls.Add("$Method $Path")
        if ($S.Faults.ThrowOn -and "$Method $Path" -match $S.Faults.ThrowOn) { throw "simulated network failure on $Method $Path" }
        $isParticipant = $Token -eq 'participant-token'
        $route = ($Path -split '\?')[0]
        $query = if ($Path -match '\?(.*)$') { $Matches[1] } else { '' }
        $preAuth = $route -in '/api/exercise-context', '/api/auth/staff/login', '/api/auth/login', '/api/auth/logout', '/health'
        if (-not $preAuth -and -not $isParticipant -and -not $S.Tokens.Contains($Token)) { return New-Response 401 $null }
        switch -Regex ("$Method $route") {
            '^GET /api/exercise-context$' { return New-Response 200 @{ exerciseId = $global:FrzDemoId; exerciseName = 'Kestrel demo'; status = 'live' } }
            '^POST /api/auth/staff/login$' {
                if ($Body.secret -ne $global:FrzSecret) { return New-Response 401 $null }
                $S.ActiveExercise = $Body.exerciseId
                $S.Logins++
                $S.TokenSeq++
                $token = "staff-token-$($S.TokenSeq)"
                [void] $S.Tokens.Add($token)
                return New-Response 200 @{ token = $token; session = @{ actingHumanId = 'staff-human-1'; exerciseId = $Body.exerciseId } }
            }
            '^POST /api/auth/login$' { return New-Response 200 @{ token = 'participant-token'; session = @{ exerciseId = $global:FrzDemoId } } }
            '^POST /api/auth/logout$' { [void] $S.Tokens.Remove($Token); return New-Response 204 $null }
            '^GET /api/staff/assignments$' {
                return New-Response 200 @(
                    @{ exerciseId = $global:FrzDemoId; exerciseName = 'Kestrel demo'; role = 'controller' }
                    @{ exerciseId = $global:FrzCheckId; exerciseName = 'Freeze check'; role = 'controller' }
                )
            }
            '^POST /api/staff/active-exercise$' { $S.ActiveExercise = $Body.exerciseId; return New-Response 200 @{ exerciseId = $Body.exerciseId } }
            '^GET /api/session$' { return New-Response 200 @{ exerciseId = $(if ($isParticipant) { $global:FrzDemoId } else { $S.ActiveExercise }) } }
            '^GET /api/staff/exercise-lifecycle$' { return New-Response 200 @{ state = $S.Lifecycle } }
            '^GET /api/steering/pause-tier$' { return New-Response 200 @{ tier = $S.Tier; clockFrozen = [bool] $S.ClockFrozen } }
            '^POST /api/steering/pause-tier$' {
                $S.TierPosts.Add($Body.tier)
                if ($Body.tier -eq 'freeze' -and $S.Lifecycle -ne 'live') { return New-Response 409 @{ outcome = 'not-applicable-in-lifecycle-state'; reason = 'not live' } }
                if ($Body.tier -eq 'freeze' -and $S.Tier -ne 'freeze') {
                    $S.ScenarioBase = Get-SimScenario $S.Wall
                    $S.ClockFrozen = $true
                    $S.Register = if ($Body.overlayRegister -eq 'in-fiction') { 'in-fiction' } else { 'out-of-fiction' }
                }
                elseif ($Body.tier -ne 'freeze' -and $S.Tier -eq 'freeze') {
                    if ($S.Faults.RestoreFails -eq 'throw') { throw 'simulated network failure on the restore' }
                    if ($S.Faults.RestoreFails) { return New-Response 500 $null }
                    $S.ScenarioBase = Get-SimScenario $S.Wall
                    $S.WallBase = $S.Wall
                    $S.ClockFrozen = $false
                }
                $S.Tier = $Body.tier
                $state = @{ tier = $S.Tier; clockFrozen = [bool] $S.ClockFrozen }
                if ($S.Faults.FreezePersisted) { $state['persisted'] = $true }
                return New-Response 200 $state
            }
            '^GET /api/overlay-state$' {
                $state = if ($S.Tier -eq 'freeze' -and -not $S.Faults.OverlayMissing) { 'pause' } else { 'none' }
                return New-Response 200 @{ state = $state; register = $S.Register; message = '' }
            }
            '^GET /api/staff/noise$' {
                return New-Response 200 @{ level = $S.NoiseLevel; poolSize = $S.PoolSize; postedCount = $S.PostedCount; lastPostedAt = $S.LastPostedAt; running = [bool] (Test-SimNoiseRunning) }
            }
            '^PUT /api/staff/noise$' {
                if ($S.Faults.NoiseRestoreFails -and $Body.level -ne 'low') { return New-Response 500 $null }
                $S.NoiseLevel = $Body.level; return New-Response 200 @{ level = $S.NoiseLevel }
            }
            '^PUT /api/staff/noise/pool$' {
                if ($S.Faults.PoolClearFails -and @($Body.posts).Count -eq 0) { return New-Response 500 $null }
                if (@($Body.posts).Count -gt 0) { $S.PoolPersonas = @($Body.posts | ForEach-Object { $_.persona }) }
                $S.PoolSize = @($Body.posts).Count; return New-Response 200 @{ poolSize = $S.PoolSize }
            }
            '^GET /api/personas$' {
                # The PIO participant's org persona comes first: "the first persona" would be the wrong voice.
                return New-Response 200 @(
                    @{ id = '33333333-3333-4333-8333-333333333333'; handle = 'KestrelCoEM'; kind = 'org'; personaType = 'official' }
                    @{ id = '44444444-4444-4444-8444-444444444444'; handle = 'MetroDesk9'; kind = 'org'; personaType = 'media' }
                    @{ id = '55555555-5555-4555-8555-555555555555'; handle = 'mvega_fh'; kind = 'human'; personaType = 'citizen' }
                )
            }
            '^POST /api/injects$' {
                if ($S.Faults.CreateLost) {
                    $id = [guid]::NewGuid().ToString()
                    $S.Items[$id] = @{ id = $id; title = $Body.title; status = 'pending'; version = 1 }
                    throw 'simulated lost response on create'
                }
                $id = [guid]::NewGuid().ToString()
                $S.InjectPersonas = @($Body.posts | ForEach-Object { $_.personaId })
                $S.Items[$id] = @{ id = $id; title = $Body.title; status = 'pending'; version = 1 }
                return New-Response 201 $S.Items[$id]
            }
            '^POST /api/injects/[^/]+/skip$' {
                $item = $S.Items[($route -split '/')[3]]
                $item.status = 'skipped'; $item.version++
                return New-Response 200 $item
            }
            '^POST /api/injects/[^/]+/fire$' {
                $item = $S.Items[($route -split '/')[3]]
                if ($S.Tier -eq 'freeze' -and -not $S.Faults.FireNotRefused) {
                    return New-Response 409 @{ detail = 'The world is frozen. Resume the exercise before firing.' }
                }
                return New-Response 409 @{ detail = "This item is $($item.status) and cannot be fired." }
            }
            '^GET /api/injects$' { return New-Response 200 @{ items = @($S.Items.Values); pauseTier = $S.Tier } }
            '^DELETE /api/injects/[^/]+$' {
                if ($S.Faults.DeleteFails) { return New-Response 500 $null }
                $id = ($route -split '/')[3]
                if (-not $S.Items.ContainsKey($id)) { return New-Response 404 $null }
                if ($query -ne "version=$($S.Items[$id].version)") { return New-Response 409 @{ detail = 'stale version' } }
                $S.Items.Remove($id); return New-Response 204 $null
            }
            '^GET /health$' {
                $S.HealthCalls++
                # A restart is visible as a failing /health around the handover, unless the fault hides it.
                $inHandover = $S.RestartAt -and ($S.Wall - $S.RestartAt).TotalMinutes -ge 5
                if ($inHandover -and -not $S.Faults.NoRestartEvidence) {
                    if ($S.Faults.HealthThrows) { throw 'simulated connection reset during the restart' }
                    return New-Response 503 $null
                }
                return New-Response 200 $null
            }
            default { throw "simulator: unhandled $Method $route" }
        }
    }

    function Invoke-FreezeScript([hashtable] $Parameters = @{}) {
        $env:PULSE_STAFF_SECRET = $global:FrzSecret
        $env:PULSE_PARTICIPANT_PASSWORD = 'not-a-real-password'
        try {
            $output = & $global:FrzScriptFile @Parameters -Confirm:$false 6>&1 2>&1 | ForEach-Object { "$_" }
            $code = $LASTEXITCODE
        }
        finally {
            Remove-Item Env:PULSE_STAFF_SECRET -ErrorAction SilentlyContinue
            Remove-Item Env:PULSE_PARTICIPANT_PASSWORD -ErrorAction SilentlyContinue
        }
        [pscustomobject]@{ Code = $code; Text = ($output -join "`n"); Lines = $output }
    }
}

AfterAll {
    Remove-Variable -Scope Global -Name Frz* -ErrorAction SilentlyContinue
}

Describe 'Test-FreezeResume.ps1' {
    BeforeEach {
        New-Server
        Mock Invoke-Api { Invoke-SimApi -Method $Method -Path $Path -Body $Body -Token $Token -Anonymous $Anonymous.IsPresent }
        Mock Get-Now { $global:FrzS.Wall }
        Mock Wait-Seconds { Step-SimTime $Seconds }
        Mock Read-HiddenValue { throw 'the script prompted although the value was in the environment' }
        Mock Invoke-AppServiceRestart { $global:FrzS.RestartAt = $global:FrzS.Wall }
    }

    Context 'pass path' {
        It 'passes, exits 0 and leaves the exercise as it found it' {
            $r = Invoke-FreezeScript

            $r.Text | Should -Not -Match '\bFAIL\b'
            $r.Code | Should -Be 0
            $r.Text | Should -Match 'PASS\s+Freeze applied: tier freeze, clockFrozen true'
            $r.Text | Should -Match 'PASS\s+after Freeze: overlay is pause, register in-fiction'
            $r.Text | Should -Match 'PASS\s+inject fire refused while frozen'
            $r.Text | Should -Match 'PASS\s+no noise post while frozen'
            $r.Text | Should -Match 'PASS\s+scenario clock did not move while frozen'
            $r.Text | Should -Match 'PASS\s+scenario time continued from the frozen minute'
            $r.Text | Should -Match 'PASS\s+after Resume: overlay is back to none'
            $r.Text | Should -Match 'INFO\s+pre-18'
            $global:FrzS.Tier | Should -Be 'engine'
            $global:FrzS.NoiseLevel | Should -Be 'off'
            $global:FrzS.PoolSize | Should -Be 0
            $global:FrzS.Items.Count | Should -Be 0
            $global:FrzS.ActiveExercise | Should -Be $global:FrzCheckId
            $global:FrzS.Tokens.Count | Should -Be 0 -Because 'every staff session is signed out'
        }

        It 'authors the test content as an NPC citizen persona, never the first (participant) persona' {
            $r = Invoke-FreezeScript

            $r.Code | Should -Be 0
            $global:FrzS.PoolPersonas | Should -Be @('mvega_fh', 'mvega_fh', 'mvega_fh')
            $global:FrzS.InjectPersonas | Should -Be @('55555555-5555-4555-8555-555555555555')
        }

        It 'freezes with the out-of-fiction register when asked' {
            $r = Invoke-FreezeScript @{ Register = 'out-of-fiction' }

            $r.Code | Should -Be 0
            $r.Text | Should -Match 'overlay is pause, register out-of-fiction'
        }

        It 'never prints the staff secret' {
            $r = Invoke-FreezeScript
            $r.Text | Should -Not -Match ([regex]::Escape($global:FrzSecret))
        }
    }

    Context 'failures' {
        It 'fails when the scenario minute moves across the Freeze' {
            New-Server @{ ClockRunsDuringFreeze = $true }

            $r = Invoke-FreezeScript

            $r.Code | Should -Be 1
            $r.Text | Should -Match 'FAIL\s+scenario minute moved across the Freeze'
            $global:FrzS.Tier | Should -Be 'engine'
        }

        It 'fails when the overlay never shows the holding page' {
            New-Server @{ OverlayMissing = $true }

            $r = Invoke-FreezeScript

            $r.Code | Should -Be 1
            $r.Text | Should -Match "FAIL\s+after Freeze: overlay is 'none', expected pause"
            $global:FrzS.Tier | Should -Be 'engine'
        }

        It 'fails when an inject fire is not refused for Freeze' {
            New-Server @{ FireNotRefused = $true }

            $r = Invoke-FreezeScript

            $r.Code | Should -Be 1
            $r.Text | Should -Match 'FAIL\s+inject fire was refused, but not for Freeze'
            $global:FrzS.Tier | Should -Be 'engine'
        }
    }

    Context 'the tier is always restored' {
        It 'restores the tier it found (<tier>) and cleans up after a step throws mid-hold' -ForEach @(
            @{ tier = 'engine' }, @{ tier = 'running' }, @{ tier = 'injects' }
        ) {
            New-Server @{ ThrowOn = '^POST /api/injects/[^/]+/fire$' }
            $global:FrzS.Tier = $tier

            $r = Invoke-FreezeScript

            $r.Code | Should -Be 1
            $r.Text | Should -Match 'FAIL\s+unexpected: simulated network failure'
            $r.Text | Should -Match "PASS\s+pause tier restored to '$tier'"
            $r.Text | Should -Match 'PASS\s+test inject deleted'
            $global:FrzS.Tier | Should -Be $tier
            $global:FrzS.TierPosts[-1] | Should -Be $tier
            $global:FrzS.Items.Count | Should -Be 0
            $global:FrzS.NoiseLevel | Should -Be 'off'
            $global:FrzS.PoolSize | Should -Be 0
        }

        It 'restores the tier when the overlay read throws right after Freeze' {
            New-Server @{ ThrowOn = '^GET /api/overlay-state$' }

            $r = Invoke-FreezeScript

            $r.Code | Should -Be 1
            $global:FrzS.TierPosts | Should -Contain 'freeze'
            $global:FrzS.Tier | Should -Be 'engine'
            $global:FrzS.NoiseLevel | Should -Be 'off'
        }

        It 'fails loudly with the manual step when the restore POST answers <fault> after Freeze' -ForEach @(
            @{ fault = '500'; value = $true }, @{ fault = 'a transport error'; value = 'throw' }
        ) {
            New-Server @{ RestoreFails = $value }

            $r = Invoke-FreezeScript

            $r.Code | Should -Be 1
            $r.Text | Should -Match "FAIL\s+COULD NOT RESTORE the pause tier to 'engine'\. Open the console .* set the Pause pill back to 'engine' NOW"
            $global:FrzS.Tier | Should -Be 'freeze'
        }

        It 'refuses an exercise that is already frozen and changes nothing' {
            $global:FrzS.Tier = 'freeze'

            $r = Invoke-FreezeScript

            $r.Code | Should -Be 1
            $r.Text | Should -Match 'already FROZEN'
            $global:FrzS.TierPosts.Count | Should -Be 0
        }

        It 'refuses an exercise that is not live before writing anything' {
            $global:FrzS.Lifecycle = 'staged'

            $r = Invoke-FreezeScript

            $r.Code | Should -Be 1
            $r.Text | Should -Match "is 'staged', not live"
            $global:FrzS.TierPosts.Count | Should -Be 0
            ($global:FrzS.Calls | Where-Object { $_ -match '^(PUT|POST) /api/(staff/noise|injects)' }).Count | Should -Be 0
        }
    }

    Context 'cleanup failures are FAILs with a manual step' {
        It 'fails when the test inject cannot be deleted' {
            New-Server @{ DeleteFails = $true }

            $r = Invoke-FreezeScript

            $r.Code | Should -Be 1
            $r.Text | Should -Match "FAIL\s+deleting the test inject -> 500\. Delete '\[freeze check\] fire refusal probe'"
        }

        It 'finds and deletes a test inject whose create response was lost' {
            New-Server @{ CreateLost = $true }

            $r = Invoke-FreezeScript

            $r.Code | Should -Be 1 -Because 'the lost create is itself an unexpected failure'
            $r.Text | Should -Match 'PASS\s+test inject deleted'
            $global:FrzS.Items.Count | Should -Be 0
            $global:FrzS.Tier | Should -Be 'engine'
        }

        It 'fails when the noise level cannot be restored' {
            New-Server @{ NoiseRestoreFails = $true }

            $r = Invoke-FreezeScript

            $r.Code | Should -Be 1
            $r.Text | Should -Match "FAIL\s+restoring the noise level -> 500\. Set the white-noise knob .* back to 'off'"
        }

        It 'fails when the test pool cannot be cleared' {
            New-Server @{ PoolClearFails = $true }

            $r = Invoke-FreezeScript

            $r.Code | Should -Be 1
            $r.Text | Should -Match 'FAIL\s+clearing the test noise pool -> 500\. Empty the white-noise pool'
        }
    }

    Context 'the demo exercise' {
        It 'refuses when the name lookup resolves to the demo exercise' {
            $r = Invoke-FreezeScript @{ ExerciseName = 'Kestrel demo' }

            $r.Code | Should -Be 1
            $r.Text | Should -Match 'is the demo exercise .* Refusing: pass -ExerciseId'
            $global:FrzS.TierPosts.Count | Should -Be 0
            $global:FrzS.Calls | Should -Not -Contain 'POST /api/staff/active-exercise'
        }

        It 'fails cleanly when no throwaway exercise exists' {
            $r = Invoke-FreezeScript @{ ExerciseName = 'Nope' }

            $r.Code | Should -Be 1
            $r.Text | Should -Match "no exercise named 'Nope'"
            $global:FrzS.TierPosts.Count | Should -Be 0
        }

        It 'with an explicit demo -ExerciseId, makes zero noise writes and reads the overlay as the participant' {
            $global:FrzS.PoolSize = 5   # the demo's own pool
            $r = Invoke-FreezeScript @{ ExerciseId = $global:FrzDemoId.ToUpperInvariant(); ParticipantUsername = 'pio1' }

            $r.Code | Should -Be 0
            $r.Text | Should -Match 'WARN\s+running against the DEMO exercise'
            $r.Text | Should -Match 'WARN\s+minute continuity after Resume: not run on the demo exercise'
            $r.Text | Should -Match 'overlay is pause, register in-fiction \(participant pio1\)'
            $r.Text | Should -Match 'PASS\s+inject fire refused while frozen'
            ($global:FrzS.Calls | Where-Object { $_ -match '^PUT /api/staff/noise' }).Count | Should -Be 0
            $global:FrzS.NoiseLevel | Should -Be 'off'
            $global:FrzS.PoolSize | Should -Be 5
            $global:FrzS.Tier | Should -Be 'engine'
        }

        It 'falls back to the staff overlay read when the participant is on another exercise' {
            $r = Invoke-FreezeScript @{ ParticipantUsername = 'pio1' }

            $r.Code | Should -Be 0
            $r.Text | Should -Match 'WARN\s+participant sessions are host-bound'
            $r.Text | Should -Match 'overlay is pause, register in-fiction \(staff session\)'
        }
    }

    Context '-IncludeRestart' {
        It 'refuses to restart before demo-feedback/18 is detected unless -Force' {
            $r = Invoke-FreezeScript @{ IncludeRestart = $true }

            $r.Code | Should -Be 1
            $r.Text | Should -Match 'FAIL\s+restart check refused: demo-feedback/18 is not detected'
            Should -Invoke Invoke-AppServiceRestart -Times 0 -Exactly
            $global:FrzS.Tier | Should -Be 'engine'
        }

        It 'with -Force before 18, reports the cleared Freeze as expected until demo-feedback/18 is deployed' {
            $r = Invoke-FreezeScript @{ IncludeRestart = $true; Force = $true }

            $r.Code | Should -Be 1
            $r.Text | Should -Match "FAIL\s+the restart cleared Freeze \(tier now 'running'\): expected until demo-feedback/18 is deployed"
            $global:FrzS.Tier | Should -Be 'engine'
        }

        It 'passes once Freeze is persisted (18) and the restart was observed' {
            New-Server @{ FreezePersisted = $true }

            $r = Invoke-FreezeScript @{ IncludeRestart = $true }

            $r.Text | Should -Not -Match '\bFAIL\b'
            $r.Code | Should -Be 0
            $r.Text | Should -Match 'demo-feedback/18 detected'
            $r.Text | Should -Match 'PASS\s+Freeze survived the restart \(restart observed'
            $r.Text | Should -Match 'PASS\s+scenario clock unchanged across the restart'
            Should -Invoke Invoke-AppServiceRestart -Times 1 -Exactly
            $global:FrzS.Tier | Should -Be 'engine'
        }

        It 'survives transport exceptions in the restart wait loop' {
            New-Server @{ FreezePersisted = $true; HealthThrows = $true }

            $r = Invoke-FreezeScript @{ IncludeRestart = $true }

            $r.Code | Should -Be 0
            $r.Text | Should -Match 'PASS\s+Freeze survived the restart \(restart observed'
            $global:FrzS.Tier | Should -Be 'engine'
        }

        It 'signs in again on 401 after the restart and still restores the tier' {
            New-Server @{ FreezePersisted = $true; SessionsLost = $true }

            $r = Invoke-FreezeScript @{ IncludeRestart = $true }

            $r.Code | Should -Be 0
            $global:FrzS.Logins | Should -Be 2 -Because 'the first session was lost at the handover and the script signed in again'
            $r.Text | Should -Match 'PASS\s+Freeze survived the restart'
            $global:FrzS.Tier | Should -Be 'engine'
            $global:FrzS.NoiseLevel | Should -Be 'off'
        }

        It 'warns instead of passing when no restart was observed' {
            New-Server @{ FreezePersisted = $true; NoRestartEvidence = $true }

            $r = Invoke-FreezeScript @{ IncludeRestart = $true }

            $r.Text | Should -Match 'WARN\s+restart not observed .* persistence not proven'
            $r.Text | Should -Not -Match 'PASS\s+Freeze survived the restart'
            $global:FrzS.Tier | Should -Be 'engine'
        }

        It 'skips the restart under -WhatIf' {
            New-Server @{ FreezePersisted = $true }

            $r = Invoke-FreezeScript @{ IncludeRestart = $true; WhatIf = $true }

            $r.Text | Should -Match 'WARN\s+-IncludeRestart declined'
            Should -Invoke Invoke-AppServiceRestart -Times 0 -Exactly
        }
    }
}
