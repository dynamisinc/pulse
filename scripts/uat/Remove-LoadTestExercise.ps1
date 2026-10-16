#Requires -Version 7.4

<#
.SYNOPSIS
    Ends the throwaway load-test exercise (post-demo-feedback/01, #547): noise off, pause tier Engine paused, lifecycle
    completed then archived, and deletes the local join-URL file(s). Never touches another exercise.

.DESCRIPTION
    1. Local checks: -ExerciseHost and -ApiHost are https host names and differ.
    2. GET /api/exercise-context on -ExerciseHost names the exercise; on -ApiHost, the demo exercise. Refuses unless the
       load-test exercise's name starts with "Load test" and it is NOT the demo exercise (the harness's rule).
       -WhatIf stops here: prints what it would do and changes nothing (no sign-in, no file deleted).
    3. Signs in to the load-test exercise (PULSE_STAFF_SECRET or a hidden prompt):
         PUT  /api/staff/noise { level: off }
         POST /api/steering/pause-tier { tier: engine }
         POST /api/staff/exercise-lifecycle/transition { to: completed } (from live or paused), then { to: archived }.
       Story 22's archive route is not built; the existing lifecycle route allows completed → archived, so that is
       used. Each step that fails is reported and the rest still run.
    4. Signs out; deletes the join-URL file(s): -JoinUrlFile, or every scripts/uat/out/loadtest-join-urls-*.csv.
    5. Reports what is left: the archived exercise row with its participant accounts (archived exercises serve no
       participant route), and the host name still bound to the App Service (the az command to unbind it is printed,
       not run).

    Exit code 0 when everything above succeeded, 1 otherwise.

.PARAMETER ExerciseHost
    The load-test exercise's host name (New-LoadTestExercise.ps1 -ExerciseHost).

.PARAMETER JoinUrlFile
    The join-URL file(s) to delete. Default: every loadtest-join-urls-*.csv under scripts/uat/out.

.PARAMETER ApiHost
    The UAT API host (bound to the demo exercise): read only, to refuse the demo exercise.

.PARAMETER StaffUsername
    A controller assigned to the load-test exercise (its creator). Default controller1.

.PARAMETER WhatIf
    Checks and prints the plan. Signs in to nothing, changes nothing, deletes nothing.

.EXAMPLE
    pwsh scripts/uat/Remove-LoadTestExercise.ps1 -ExerciseHost pulse-loadtest-api.cobrasoftware.com -WhatIf
#>
[CmdletBinding()]
param(
    # Required; checked in the run (not [Parameter(Mandatory)], so the Pester tests can dot-source the script).
    [string] $ExerciseHost,
    [string[]] $JoinUrlFile,
    [ValidateNotNullOrEmpty()] [string] $ApiHost = 'app-pulse-api-uat-dynamis.azurewebsites.net',
    [ValidateNotNullOrEmpty()] [string] $StaffUsername = 'controller1',
    [string] $ResourceGroup = 'rg-pulse-uat-centralus',
    [string] $WebAppName = 'app-pulse-api-uat-dynamis',
    [switch] $WhatIf
)

$ErrorActionPreference = 'Stop'
$PSDefaultParameterValues = @{}
. "$PSScriptRoot/LoadTest.Common.ps1"

function Get-JoinUrlFiles {
    <# The files to delete: -JoinUrlFile as given (existing ones only), or the default pattern under scripts/uat/out. #>
    param([string[]] $JoinUrlFile)
    if ($JoinUrlFile) {
        foreach ($path in $JoinUrlFile) {
            $full = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($path)
            if (Test-Path -LiteralPath $full -PathType Leaf) { $full }
        }
        return
    }
    $out = Join-Path $PSScriptRoot 'out'
    if (Test-Path -LiteralPath $out -PathType Container) {
        Get-ChildItem -LiteralPath $out -Filter $script:LoadTestJoinFilePattern -File | ForEach-Object { $_.FullName }
    }
}

function Invoke-RemoveLoadTestExercise {
    [CmdletBinding()]
    param(
        [AllowEmptyString()] [string] $ExerciseHost, [string[]] $JoinUrlFile,
        [Parameter(Mandatory)] [string] $ApiHost, [Parameter(Mandatory)] [string] $StaffUsername,
        [string] $ResourceGroup, [string] $WebAppName, [switch] $WhatIf
    )
    $ProgressPreference = 'SilentlyContinue'
    Write-Host 'Pulse load-test exercise teardown (post-demo-feedback/01)' -ForegroundColor Cyan

    # ── 1-2. Checks ───────────────────────────────────────────────────────────────────────────────────────────────
    try {
        $api = Resolve-ApiHost -ApiHost $ApiHost
        $load = Resolve-ApiHost -ApiHost $ExerciseHost -ParameterName '-ExerciseHost'
        if ($api.Host -eq $load.Host) { throw "-ExerciseHost is the demo's API host ($($api.Host)). Refused: teardown never touches the demo exercise." }
        $target = Get-ExerciseContext -BaseUrl $load.BaseUrl
        $demo = Get-ExerciseContext -BaseUrl $api.BaseUrl
        if (-not $demo.Id) { throw "GET $($api.BaseUrl)/api/exercise-context -> $($demo.HttpStatus): the demo exercise cannot be identified, so the refusal rule cannot be checked. Nothing was changed." }
        $refusal = Test-LoadTestTarget -ExerciseId $target.Id -Name $target.Name -DemoExerciseId $demo.Id
        if ($refusal) { throw "REFUSED: $($load.Host): $refusal Nothing was changed." }
        Write-LoadLine PASS "Target '$(Get-PrintableText $target.Name -Max 80)' ($($target.Id)), lifecycle $(Get-PrintableText $target.Lifecycle -Max 20); not the demo exercise ($($demo.Id))."
    }
    catch { Write-LoadLine FAIL $_.Exception.Message; return 1 }

    $files = @(Get-JoinUrlFiles -JoinUrlFile $JoinUrlFile)
    if ($WhatIf) {
        Write-LoadLine SKIP 'WhatIf: would set noise off and the pause tier to Engine paused'
        Write-LoadLine SKIP 'WhatIf: would move the lifecycle to completed, then archived'
        Write-LoadLine SKIP "WhatIf: would delete $($files.Count) join-URL file(s)$(if ($files.Count) { ': ' + ($files -join ', ') })"
        Write-Host 'WhatIf: nothing was signed in to, changed or deleted.' -ForegroundColor Cyan
        return 0
    }

    # ── 3. Teardown ───────────────────────────────────────────────────────────────────────────────────────────────
    $failures = 0
    $token = $null
    $state = $null
    try {
        $secret = Read-StaffSecret -StaffUsername $StaffUsername
        try { $session = Connect-StaffSession -BaseUrl $load.BaseUrl -StaffUsername $StaffUsername -Secret $secret -ExerciseId $target.Id }
        finally { $secret = $null }
        $token = $session.Token

        $step = {
            param([string] $Method, [string] $Path, [object] $Body, [string] $What)
            try {
                $response = Invoke-PulseApi -BaseUrl $load.BaseUrl -Method $Method -Path $Path -Token $token -Body $Body
                if ($response.Status -ge 200 -and $response.Status -lt 300) { Write-LoadLine PASS $What; return $response }
                Write-LoadLine FAIL "$What — $Method $Path -> $($response.Status) $(Get-ApiErrorText $response)"
            }
            catch { Write-LoadLine FAIL "$What — $($_.Exception.Message)" }
            $script:RemoveFailures++
            return $null
        }
        $script:RemoveFailures = 0

        & $step PUT '/api/staff/noise' ([ordered]@{ level = 'off' }) 'White noise off.' | Out-Null
        & $step POST '/api/steering/pause-tier' ([ordered]@{ tier = 'engine'; actingHumanId = $session.ActingHumanId }) 'Pause tier Engine paused.' | Out-Null

        $lifecycle = Invoke-PulseApi -BaseUrl $load.BaseUrl -Method GET -Path '/api/staff/exercise-lifecycle' -Token $token
        $state = if ($lifecycle.Status -eq 200 -and $lifecycle.Json -is [System.Collections.IDictionary]) { [string] $lifecycle.Json['state'] } else { $null }
        if (-not $state) { Write-LoadLine FAIL "GET /api/staff/exercise-lifecycle -> $($lifecycle.Status)"; $script:RemoveFailures++ }
        if ($state -in 'build', 'staged') {
            # COR-032 allows only live/paused → completed; a run that never went live goes staged → live first.
            if ($state -eq 'build') { if (& $step POST '/api/staff/exercise-lifecycle/transition' ([ordered]@{ to = 'staged' }) 'Lifecycle → staged.') { $state = 'staged' } }
            if ($state -eq 'staged') { if (& $step POST '/api/staff/exercise-lifecycle/transition' ([ordered]@{ to = 'live' }) 'Lifecycle → live (on the way to completed).') { $state = 'live' } }
        }
        if ($state -in 'live', 'paused') { if (& $step POST '/api/staff/exercise-lifecycle/transition' ([ordered]@{ to = 'completed' }) 'Lifecycle → completed.') { $state = 'completed' } }
        if ($state -eq 'completed') { if (& $step POST '/api/staff/exercise-lifecycle/transition' ([ordered]@{ to = 'archived' }) 'Lifecycle → archived.') { $state = 'archived' } }
        elseif ($state -eq 'archived') { Write-LoadLine PASS 'Lifecycle already archived.' }
        $failures = $script:RemoveFailures
    }
    catch { Write-LoadLine FAIL $_.Exception.Message; $failures++ }
    finally {
        if ($token) { Disconnect-StaffSession -BaseUrl $load.BaseUrl -Token $token }
        $token = $null
    }

    # ── 4. The token file(s) ──────────────────────────────────────────────────────────────────────────────────────
    foreach ($file in $files) {
        try { Remove-Item -LiteralPath $file -Force; Write-LoadLine PASS "Deleted $file." }
        catch { Write-LoadLine FAIL "Could not delete $file ($($_.Exception.Message)). Delete it by hand: it holds sign-in links."; $failures++ }
    }
    if ($files.Count -eq 0) { Write-LoadLine INFO 'No join-URL file found to delete.' }

    # ── 5. What is left ───────────────────────────────────────────────────────────────────────────────────────────
    Write-Host ''
    Write-Host 'Left in place (by design):' -ForegroundColor Cyan
    Write-Host "  - Exercise '$(Get-PrintableText $target.Name -Max 80)' ($($target.Id)), lifecycle $(if ($state) { $state } else { 'unknown' }), with its roster accounts, posts and telemetry. An archived exercise serves no participant route; there is no delete route."
    Write-Host "  - The host name $($load.Host), still bound to the App Service and owned by this exercise. To unbind it:"
    Write-Host "      az webapp config hostname delete --resource-group $ResourceGroup --webapp-name $WebAppName --hostname $($load.Host)"
    Write-Host '  Then run Test-DemoReady.ps1 on the demo exercise.'
    if ($failures -gt 0) { Write-Host "NOT CLEAN — $failures step(s) failed (above)." -ForegroundColor Red; return 1 }
    Write-Host 'DONE.' -ForegroundColor Green
    return 0
}

# Dot-sourcing (the Pester tests) loads the functions above and stops here.
if ($MyInvocation.InvocationName -eq '.') { return }

$runArguments = @{
    ExerciseHost = $ExerciseHost; JoinUrlFile = $JoinUrlFile; ApiHost = $ApiHost; StaffUsername = $StaffUsername
    ResourceGroup = $ResourceGroup; WebAppName = $WebAppName; WhatIf = $WhatIf
}
$exitCode = Invoke-RemoveLoadTestExercise @runArguments | Select-Object -Last 1
exit ([int] $exitCode)
