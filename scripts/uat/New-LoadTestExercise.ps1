#Requires -Version 7.4

<#
.SYNOPSIS
    Creates the throwaway "Load test <date>" exercise the load-test harness drives (post-demo-feedback/01, #547), and
    writes its participants' join URLs to a git-ignored local file. Never touches another exercise.

.DESCRIPTION
    Pulse resolves a participant's exercise from the HOST NAME the request arrives on (GET /api/exercise-context;
    participant sessions and SignalR groups are host-bound), and the UAT API host is bound to the demo exercise. So the
    load-test exercise needs its OWN host name bound to the same App Service (-ExerciseHost): see
    tools/Pulse.LoadTest/README.md, "Before Saturday". This script refuses to run without one.

      1. Local checks (nothing is sent when one fails): -ExerciseHost and -ApiHost are https host names and differ;
         the counts are in range; the join-URL file's folder can be written.
      2. Read-only checks: GET https://<ExerciseHost>/health answers 200 (the binding reaches Pulse) and
         /api/exercise-context there answers 404 (no exercise owns that host yet). GET /api/exercise-context on -ApiHost
         names the demo exercise, which is only ever signed in to, never changed.
         -WhatIf stops here and prints the plan: nothing is signed in, created or written.
      3. Signs in (PULSE_STAFF_SECRET or a hidden prompt) on -ApiHost to the demo exercise, only to call
         POST /api/org/exercises { name: "Load test <yyyy-MM-dd HHmm>", hostname: <ExerciseHost> } (the creator gets
         the controller assignment on the new exercise), then signs out.
      4. Signs in to the NEW exercise and checks /api/exercise-context on -ExerciseHost now names it (otherwise stops).
      5. Media marking on (PUT /api/staff/chrome-settings { watermarkEnabled: true }); lifecycle build → staged → live
         (POST /api/staff/exercise-lifecycle/transition); pause tier Freeze then Engine paused (POST
         /api/steering/pause-tier) — entering Freeze starts the in-memory scenario clock and leaving it unfreezes it,
         which white noise needs (WhiteNoiseService.IsStopped: no noise while the clock is not running).
      6. A generated roster of -Participants participants ("Load participant 001", sign-in ltp001, …) plus -NpcCount
         NPC authors ("Load NPC 01", …), each with an auto-created citizen persona, imported with Import-Roster.ps1
         against -ExerciseHost (so into the new exercise). Its links file IS the join-URL file (mode 600). The
         temporary CSV is deleted.
      7. A 200-entry white-noise pool over the NPC personas (PUT /api/staff/noise/pool, mode replace). Noise stays OFF;
         the harness turns it to High per step.
      8. -BurstItems run-sheet items (default 3, one per step), each a valid 20-post burst (InjectItemValidator
         MaxBurstPosts) at the minimum 57 s window (3 s between posts): POST /api/injects.
      9. Signs out and prints the harness command line.

    Exit code 0 on success, 1 on any failure (with what was left behind). Re-running needs a FRESH -ExerciseHost: an
    exercise keeps its host name, and teardown cannot release it (there is no route to change it).

.PARAMETER ExerciseHost
    The extra host name bound to the API App Service for the load-test exercise (not the demo's -ApiHost).

.PARAMETER Participants
    Participant rows (load users). Default 100, the largest step.

.PARAMETER NpcCount
    NPC author rows (never joined). Default 20.

.PARAMETER NoisePoolSize
    White-noise pool entries. Default 200.

.PARAMETER BurstItems
    20-post burst items to create. Default 3 (one per step).

.PARAMETER Name
    The exercise name. Must start with "Load test". Default "Load test <yyyy-MM-dd HHmm>".

.PARAMETER OutFile
    The join-URL file. Default scripts/uat/out/loadtest-join-urls-<yyyyMMdd-HHmmss>.csv (git-ignored).

.PARAMETER ApiHost
    The UAT API host (bound to the demo exercise). Used only to sign in for the create call.

.PARAMETER StaffUsername
    A controller (or planner) assigned to the demo exercise. Default controller1.

.PARAMETER WhatIf
    Runs the local and read-only checks and prints the plan. Signs in to nothing and writes nothing.

.EXAMPLE
    pwsh scripts/uat/New-LoadTestExercise.ps1 -ExerciseHost pulse-loadtest-api.cobrasoftware.com -WhatIf

.EXAMPLE
    $env:PULSE_STAFF_SECRET = Get-Clipboard; pwsh scripts/uat/New-LoadTestExercise.ps1 -ExerciseHost pulse-loadtest-api.cobrasoftware.com; $env:PULSE_STAFF_SECRET = $null
#>
[CmdletBinding()]
param(
    # Required; checked in the run (not [Parameter(Mandatory)], so the Pester tests can dot-source the script).
    [string] $ExerciseHost,
    [ValidateRange(1, 1000)] [int] $Participants = 100,
    [ValidateRange(1, 100)] [int] $NpcCount = 20,
    [ValidateRange(1, 1000)] [int] $NoisePoolSize = 200,
    [ValidateRange(0, 20)] [int] $BurstItems = 3,
    [string] $Name,
    [string] $OutFile,
    [ValidateNotNullOrEmpty()] [string] $ApiHost = 'app-pulse-api-uat-dynamis.azurewebsites.net',
    [ValidateNotNullOrEmpty()] [string] $StaffUsername = 'controller1',
    [switch] $WhatIf
)

$ErrorActionPreference = 'Stop'
$PSDefaultParameterValues = @{}
. "$PSScriptRoot/LoadTest.Common.ps1"

# InjectItemValidator.MaxBurstPosts and InjectBurstPacing.MinimumWindowSeconds(20) = 19 × 3 s.
$script:BurstPosts = 20
$script:BurstWindowSeconds = 57

function New-LoadRosterCsv {
    <# The generated roster: participants then NPC authors. name,agency,role,email,personaHandle,signInName (blank handle → auto persona). #>
    param([Parameter(Mandatory)] [int] $Participants, [Parameter(Mandatory)] [int] $NpcCount)
    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add('name,agency,role,email,personaHandle,signInName')
    for ($i = 1; $i -le $Participants; $i++) { $lines.Add(('Load participant {0:000},Load test,Participant,,,ltp{0:000}' -f $i)) }
    for ($i = 1; $i -le $NpcCount; $i++) { $lines.Add(('{1} {0:00},Load test,NPC,,,ltnpc{0:00}' -f $i, $script:LoadTestNpcPrefix)) }
    return ($lines -join "`r`n") + "`r`n"
}

function New-NoisePool {
    <# -Size entries round-robin over the NPC persona ids. #>
    param([Parameter(Mandatory)] [string[]] $PersonaIds, [Parameter(Mandatory)] [int] $Size)
    $topics = @('Traffic is backed up near the river bridge.', 'Power flickered again on the east side.', 'Anyone know if the shelter on 5th is open?',
        'Heard sirens heading downtown.', 'Water pressure is low here.', 'Phones are spotty near the school.', 'Stay safe out there, everyone.',
        'Roads look clear on the north side.', 'Store shelves are emptying fast.', 'Is the bus still running?')
    for ($i = 0; $i -lt $Size; $i++) {
        [ordered]@{ persona = $PersonaIds[$i % $PersonaIds.Count]; text = ('{0} (load noise {1:000})' -f $topics[$i % $topics.Count], ($i + 1)) }
    }
}

function New-BurstItemBody {
    <# One valid 20-post burst item at the minimum window. #>
    param([Parameter(Mandatory)] [string[]] $PersonaIds, [Parameter(Mandatory)] [int] $Number)
    $posts = for ($i = 0; $i -lt $script:BurstPosts; $i++) {
        [ordered]@{ personaId = $PersonaIds[$i % $PersonaIds.Count]; text = ('Load burst {0}, post {1:00}: reports coming in from the field.' -f $Number, ($i + 1)) }
    }
    return [ordered]@{
        kind = 'burst'; title = "$($script:LoadTestBurstPrefix) step $Number"; burstWindowSeconds = $script:BurstWindowSeconds
        notes = 'Load-test burst item (post-demo-feedback/01). The harness fires one per step.'; posts = @($posts)
    }
}

function Resolve-JoinFilePath {
    <# -OutFile as a full path, or the default under scripts/uat/out (git-ignored); its folder is created. #>
    param([string] $OutFile)
    $path = if ($OutFile) { $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutFile) }
    else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'out' ('loadtest-join-urls-{0}.csv' -f (Get-Date -Format 'yyyyMMdd-HHmmss')))) }
    if (Test-Path -LiteralPath $path -PathType Container) { throw "-OutFile '$path' is a folder; name a file. Nothing was sent." }
    return $path
}

function Invoke-RosterImport {
    <#
    .SYNOPSIS
        Runs Import-Roster.ps1 against the load-test host (so into the load-test exercise). The secret goes to it through
        PULSE_STAFF_SECRET for the duration of the call only; the previous value is restored. Returns its exit code.
    #>
    param([Parameter(Mandatory)] [string] $CsvPath, [Parameter(Mandatory)] [string] $OutFile, [Parameter(Mandatory)] [string] $ExerciseHost,
        [Parameter(Mandatory)] [string] $StaffUsername, [Parameter(Mandatory)] [string] $Secret)
    $saved = $env:PULSE_STAFF_SECRET
    try {
        $env:PULSE_STAFF_SECRET = $Secret
        & (Join-Path $PSScriptRoot 'Import-Roster.ps1') -CsvPath $CsvPath -OutFile $OutFile -ApiHost $ExerciseHost -StaffUsername $StaffUsername | Out-Host
        return [int] $LASTEXITCODE
    }
    finally { $env:PULSE_STAFF_SECRET = $saved }
}

function Invoke-Step {
    <# One staff call that must succeed: throws the server's reason otherwise. Returns the response. #>
    param([Parameter(Mandatory)] [string] $BaseUrl, [Parameter(Mandatory)] [string] $Method, [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [string] $Token, [AllowNull()] [object] $Body, [Parameter(Mandatory)] [string] $What)
    $response = Invoke-PulseApi -BaseUrl $BaseUrl -Method $Method -Path $Path -Token $Token -Body $Body
    if ($response.Status -lt 200 -or $response.Status -ge 300) { throw "$What failed: $Method $Path -> $($response.Status) $(Get-ApiErrorText $response)" }
    return $response
}

function Invoke-NewLoadTestExercise {
    [CmdletBinding()]
    param(
        [AllowEmptyString()] [string] $ExerciseHost,
        [int] $Participants = 100, [int] $NpcCount = 20, [int] $NoisePoolSize = 200, [int] $BurstItems = 3,
        [string] $Name, [string] $OutFile,
        [Parameter(Mandatory)] [string] $ApiHost, [Parameter(Mandatory)] [string] $StaffUsername,
        [switch] $WhatIf
    )
    $ProgressPreference = 'SilentlyContinue'
    Write-Host 'Pulse load-test exercise setup (post-demo-feedback/01)' -ForegroundColor Cyan

    # ── 1. Local checks ───────────────────────────────────────────────────────────────────────────────────────────
    try {
        $api = Resolve-ApiHost -ApiHost $ApiHost
        $load = Resolve-ApiHost -ApiHost $ExerciseHost -ParameterName '-ExerciseHost'
        if ($api.Host -eq $load.Host) { throw "-ExerciseHost is the demo's API host ($($api.Host)). The load-test exercise needs its OWN host name bound to the App Service (README, 'Before Saturday'). Nothing was sent." }
        if (-not $Name) { $Name = '{0} {1}' -f $script:LoadTestNamePrefix, (Get-Date -Format 'yyyy-MM-dd HHmm') }
        if (-not $Name.StartsWith($script:LoadTestNamePrefix, [StringComparison]::Ordinal)) { throw "-Name must start with '$($script:LoadTestNamePrefix)' (the harness refuses anything else). Nothing was sent." }
        $joinFile = Resolve-JoinFilePath -OutFile $OutFile
    }
    catch { Write-LoadLine FAIL $_.Exception.Message; return 1 }

    # ── 2. Read-only host checks ──────────────────────────────────────────────────────────────────────────────────
    try {
        $health = Invoke-PulseApi -BaseUrl $load.BaseUrl -Method GET -Path '/health'
        if ($health.Status -ne 200) { throw "GET $($load.BaseUrl)/health -> $($health.Status): -ExerciseHost does not reach the Pulse API (is the host name bound to the App Service, with a certificate?). Nothing was changed." }
        Write-LoadLine PASS "$($load.Host) reaches the Pulse API."
        $existing = Get-ExerciseContext -BaseUrl $load.BaseUrl
        if ($existing.Id) { throw "$($load.Host) already resolves to exercise '$(Get-PrintableText $existing.Name -Max 80)' ($($existing.Id)). Use a fresh host name; this script never reuses or touches an existing exercise. Nothing was changed." }
        if ($existing.HttpStatus -ne 404) { throw "GET $($load.BaseUrl)/api/exercise-context -> $($existing.HttpStatus) (expected 404: no exercise yet). Nothing was changed." }
        Write-LoadLine PASS "$($load.Host) is not bound to any exercise yet."
        $demo = Get-ExerciseContext -BaseUrl $api.BaseUrl
        if (-not $demo.Id) { throw "GET $($api.BaseUrl)/api/exercise-context -> $($demo.HttpStatus): cannot find the exercise to sign in to. Nothing was changed." }
        Write-LoadLine INFO "Demo exercise '$(Get-PrintableText $demo.Name -Max 80)' ($($demo.Id)) on $($api.Host): used only to sign in, never changed."
    }
    catch { Write-LoadLine FAIL $_.Exception.Message; return 1 }

    $plan = @(
        "create exercise '$Name' bound to $($load.Host)", 'watermark on; lifecycle build → staged → live; pause tier Freeze → Engine paused (starts the clock)',
        "roster: $Participants participants + $NpcCount NPC authors (Import-Roster.ps1); join URLs → $joinFile",
        "white-noise pool: $NoisePoolSize entries over the NPC personas (noise stays off)", "$BurstItems burst item(s) of $($script:BurstPosts) posts at a $($script:BurstWindowSeconds) s window")
    if ($WhatIf) {
        foreach ($line in $plan) { Write-LoadLine SKIP "WhatIf: would $line" }
        Write-Host 'WhatIf: nothing was signed in to, created or written.' -ForegroundColor Cyan
        return 0
    }

    # ── 3. Create (signed in to the demo exercise only for this call) ─────────────────────────────────────────────
    $secret = $null
    $exerciseId = $null
    $token = $null
    $done = [System.Collections.Generic.List[string]]::new()
    $tempCsv = $null
    try {
        $secret = Read-StaffSecret -StaffUsername $StaffUsername
        $creator = Connect-StaffSession -BaseUrl $api.BaseUrl -StaffUsername $StaffUsername -Secret $secret -ExerciseId $demo.Id
        try {
            $created = Invoke-PulseApi -BaseUrl $api.BaseUrl -Method POST -Path '/api/org/exercises' -Token $creator.Token -Body ([ordered]@{ name = $Name; hostname = $load.Host })
        }
        finally { Disconnect-StaffSession -BaseUrl $api.BaseUrl -Token $creator.Token }
        if ($created.Status -ne 201 -or $created.Json -isnot [System.Collections.IDictionary]) {
            throw "Creating the exercise failed: POST /api/org/exercises -> $($created.Status) $(Get-ApiErrorText $created) (409: the host name is taken)."
        }
        $exerciseId = [string] $created.Json['exercise']['exerciseId']
        $done.Add("exercise '$Name' ($exerciseId) on $($load.Host)")
        Write-LoadLine PASS "Created '$Name' ($exerciseId), role $([string] $created.Json['assignedRole'])."

        # ── 4. Sign in to the NEW exercise; prove the host resolves to it ───────────────────────────────────────
        $session = Connect-StaffSession -BaseUrl $load.BaseUrl -StaffUsername $StaffUsername -Secret $secret -ExerciseId $exerciseId
        $token = $session.Token
        $resolved = Get-ExerciseContext -BaseUrl $load.BaseUrl
        $refusal = Test-LoadTestTarget -ExerciseId $resolved.Id -Name $resolved.Name -DemoExerciseId $demo.Id
        if ($refusal -or $resolved.Id -ne $exerciseId) { throw "$($load.Host) does not resolve to the new exercise ($refusal). Stopping before anything else is written." }
        Write-LoadLine PASS "$($load.Host) resolves to the new exercise."

        # ── 5. Watermark, lifecycle, clock ──────────────────────────────────────────────────────────────────────
        Invoke-Step $load.BaseUrl PUT '/api/staff/chrome-settings' $token ([ordered]@{ watermarkEnabled = $true }) 'Media marking' | Out-Null
        Write-LoadLine PASS 'Media marking (watermark) on.'
        foreach ($to in 'staged', 'live') {
            Invoke-Step $load.BaseUrl POST '/api/staff/exercise-lifecycle/transition' $token ([ordered]@{ to = $to }) "Lifecycle → $to" | Out-Null
        }
        $done.Add('lifecycle live')
        Write-LoadLine PASS 'Lifecycle staged → live.'
        foreach ($tier in 'freeze', 'engine') {
            Invoke-Step $load.BaseUrl POST '/api/steering/pause-tier' $token ([ordered]@{ tier = $tier; actingHumanId = $session.ActingHumanId }) "Pause tier $tier" | Out-Null
        }
        Write-LoadLine PASS 'Scenario clock started (Freeze → Engine paused).'

        # ── 6. Roster ───────────────────────────────────────────────────────────────────────────────────────────
        $tempCsv = Join-Path ([IO.Path]::GetTempPath()) ('loadtest-roster-{0}.csv' -f [guid]::NewGuid().ToString('N'))
        Set-Content -LiteralPath $tempCsv -Value (New-LoadRosterCsv -Participants $Participants -NpcCount $NpcCount) -NoNewline -Encoding utf8
        $importExit = Invoke-RosterImport -CsvPath $tempCsv -OutFile $joinFile -ExerciseHost $load.Host -StaffUsername $StaffUsername -Secret $secret
        if ($importExit -ne 0) { throw "Import-Roster.ps1 exited $importExit (see its table above)." }
        $done.Add("roster ($Participants + $NpcCount) and $joinFile")
        Write-LoadLine PASS "Roster imported; join URLs in $joinFile (keep it local; Remove-LoadTestExercise.ps1 deletes it)."

        # ── 7. Noise pool ───────────────────────────────────────────────────────────────────────────────────────
        $personas = (Invoke-Step $load.BaseUrl GET '/api/personas' $token $null 'Reading personas').Json
        $npcIds = @(Get-JsonList $personas | Where-Object { $_ -is [System.Collections.IDictionary] -and ([string] $_['displayName']).StartsWith($script:LoadTestNpcPrefix, [StringComparison]::Ordinal) } | ForEach-Object { [string] $_['id'] })
        if ($npcIds.Count -eq 0) { throw "No '$($script:LoadTestNpcPrefix)' personas after the import." }
        $pool = Invoke-Step $load.BaseUrl PUT '/api/staff/noise/pool' $token ([ordered]@{ mode = 'replace'; posts = @(New-NoisePool -PersonaIds $npcIds -Size $NoisePoolSize) }) 'The noise pool'
        $poolSize = [int] $pool.Json['poolSize']
        $rejected = @(Get-JsonList $pool.Json['rejected']).Count
        Write-LoadLine $(if ($rejected -eq 0 -and $poolSize -eq $NoisePoolSize) { 'PASS' } else { 'WARN' }) "Noise pool: $poolSize entries over $($npcIds.Count) NPC personas, $rejected rejected. Noise is off."

        # ── 8. Burst items ──────────────────────────────────────────────────────────────────────────────────────
        for ($n = 1; $n -le $BurstItems; $n++) {
            Invoke-Step $load.BaseUrl POST '/api/injects' $token (New-BurstItemBody -PersonaIds $npcIds -Number $n) "Burst item $n" | Out-Null
        }
        Write-LoadLine PASS "$BurstItems burst item(s): $($script:BurstPosts) posts each, $($script:BurstWindowSeconds) s window."
    }
    catch {
        Write-LoadLine FAIL $_.Exception.Message
        if ($done.Count -gt 0) {
            Write-LoadLine WARN "Left behind: $($done -join '; '). Run Remove-LoadTestExercise.ps1 -ExerciseHost $($load.Host) to end it."
        }
        return 1
    }
    finally {
        if ($token) { Disconnect-StaffSession -BaseUrl $load.BaseUrl -Token $token }
        $token = $null
        $secret = $null
        if ($tempCsv -and (Test-Path -LiteralPath $tempCsv)) { Remove-Item -LiteralPath $tempCsv -Force }
    }

    Write-Host ''
    Write-Host "READY — '$Name' ($exerciseId) on $($load.Host)." -ForegroundColor Green
    Write-Host '  Next (tools/Pulse.LoadTest/README.md):'
    Write-Host "    dotnet run --project tools/Pulse.LoadTest -c Release -- --api-host $($load.Host) --join-urls `"$joinFile`" --demo-exercise-id $($demo.Id) --dry-run"
    return 0
}

# Dot-sourcing (the Pester tests) loads the functions above and stops here.
if ($MyInvocation.InvocationName -eq '.') { return }

$runArguments = @{
    ExerciseHost = $ExerciseHost; Participants = $Participants; NpcCount = $NpcCount; NoisePoolSize = $NoisePoolSize; BurstItems = $BurstItems
    Name = $Name; OutFile = $OutFile; ApiHost = $ApiHost; StaffUsername = $StaffUsername; WhatIf = $WhatIf
}
$exitCode = Invoke-NewLoadTestExercise @runArguments | Select-Object -Last 1
exit ([int] $exitCode)
