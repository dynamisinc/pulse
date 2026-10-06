#Requires -Version 7.0
<#
.SYNOPSIS
    Puts Pulse UAT into a known, demo-ready state and reports what it found.

.DESCRIPTION
    Run it before every rehearsal and before the demo. It:

      1. Checks the API is alive (/health) and the database reachable (/health/ready).
      2. Checks the deployed code and the database schema agree: /api/exercise-context must return 200
         for the UAT host. A 5xx there is what the 2026-08-03 silent migration failure looked like, while
         both health checks stayed green.
      3. Restarts the App Service (skip with -NoRestart). Engine state — loop registration, storylines,
         autonomy overrides, the kill switch, the pause tier and the scenario clock — lives in process
         memory, so a restart is the only way to clear what the last rehearsal left behind.
      4. Re-seeds the engine (POST /api/ops/seed-engine-content): registers the reaction loop and rebuilds
         the starter storyline at scenario minute 0. Persona rows are reused, never duplicated.
      5. Optionally binds a participant account to a posting persona (-ParticipantUsername with
         -PersonaHandle), so the participant's composer is present.
      6. Confirms the session-gated routes the demo uses answer 401 (wired), never 404 (dead).

    Posts, accounts and other persisted rows are NOT touched.

    The bootstrap secret comes from $env:PULSE_BOOTSTRAP_SECRET if set, otherwise from the App Service's
    settings through YOUR az login. It is held in memory, sent only as the X-Bootstrap-Secret header, and
    never printed, logged or written to disk. The UAT runbook forbids pasting it into an agent session;
    this script exists so nobody has to.

.PARAMETER CheckOnly
    Read-only: run checks 1, 2 and 6, change nothing, need no secret and no az login.

.PARAMETER NoRestart
    Skip the App Service restart (step 3). The engine is still re-seeded, but pause, autonomy and
    kill-switch state from the last session survive.

.PARAMETER ResponseWindowMinutes
    Scenario minutes of participant silence before the storyline escalates. Omit for the server's
    demo-tuned default (3). The server clamps it to 1–180.

.PARAMETER ParticipantUsername
    With -PersonaHandle: bind this participant account to that persona (idempotent; re-binding a
    different persona replaces the old binding and the response says which).

.PARAMETER PersonaHandle
    The persona to bind, e.g. mvega_fh, tbrandt41 or kwardFH (individuals). Org accounts such as
    FairhavenWater are for controllers, not participants.

.EXAMPLE
    pwsh scripts/uat/Reset-DemoState.ps1 -CheckOnly

.EXAMPLE
    pwsh scripts/uat/Reset-DemoState.ps1

.EXAMPLE
    pwsh scripts/uat/Reset-DemoState.ps1 -ParticipantUsername participant1 -PersonaHandle mvega_fh
#>
[CmdletBinding()]
param(
    [switch] $CheckOnly,
    [switch] $NoRestart,
    [ValidateRange(1, 180)] [int] $ResponseWindowMinutes,
    [string] $ParticipantUsername,
    [string] $PersonaHandle,

    # UAT defaults (infrastructure/parameters/uat.bicepparam). The exercise is bound to the API's own host,
    # not pulse-uat.cobrasoftware.com — see docs/features/login/06-uat-goLive-config-runbook.md, step 4.
    [string] $ApiHost = 'app-pulse-api-uat-dynamis.azurewebsites.net',
    [string] $SiteUrl = 'https://pulse-uat.cobrasoftware.com',
    [string] $Subscription = '2a127d53-c9bf-471a-8196-3155eae6cb1b',
    [string] $ResourceGroup = 'rg-pulse-uat-centralus',
    [string] $WebAppName = 'app-pulse-api-uat-dynamis'
)

$ErrorActionPreference = 'Stop'
$api = "https://$ApiHost"
$results = [System.Collections.Generic.List[object]]::new()

function Add-Result([string] $Check, [ValidateSet('PASS', 'WARN', 'FAIL')] [string] $Status, [string] $Detail) {
    $results.Add([pscustomobject]@{ Check = $Check; Status = $Status; Detail = $Detail })
    $color = @{ PASS = 'Green'; WARN = 'Yellow'; FAIL = 'Red' }[$Status]
    Write-Host ("  [{0}] {1} — {2}" -f $Status, $Check, $Detail) -ForegroundColor $color
}

function Invoke-Probe([string] $Path, [string] $Method = 'GET', [hashtable] $Headers = @{}, [string] $Body) {
    $params = @{ Uri = "$api$Path"; Method = $Method; Headers = $Headers; TimeoutSec = 90; SkipHttpErrorCheck = $true }
    if ($Body) { $params.Body = $Body; $params.ContentType = 'application/json' }
    try { return Invoke-WebRequest @params } catch { return $null }
}

function Wait-ForStatus([string] $Path, [int[]] $Accept, [int] $Attempts, [int] $DelaySeconds) {
    for ($i = 1; $i -le $Attempts; $i++) {
        $response = Invoke-Probe $Path
        $code = if ($response) { [int] $response.StatusCode } else { 0 }
        if ($Accept -contains $code) { return $response }
        if ($i -lt $Attempts) {
            Write-Host "    $Path -> $code (attempt $i/$Attempts), retrying in ${DelaySeconds}s…" -ForegroundColor DarkGray
            Start-Sleep -Seconds $DelaySeconds
        }
    }
    return $response
}

function Test-ApiAndSchema([int] $Attempts) {
    $health = Wait-ForStatus '/health' -Accept 200 -Attempts $Attempts -DelaySeconds 10
    if ($health -and $health.StatusCode -eq 200) { Add-Result 'API alive' PASS '/health -> 200' }
    else { Add-Result 'API alive' FAIL "/health -> $($health.StatusCode) — the App Service is down or still cold-starting"; return $false }

    $ready = Wait-ForStatus '/health/ready' -Accept 200 -Attempts 6 -DelaySeconds 10
    if ($ready -and $ready.StatusCode -eq 200) { Add-Result 'Database reachable' PASS '/health/ready -> 200' }
    else { Add-Result 'Database reachable' FAIL "/health/ready -> $($ready.StatusCode) — serverless SQL may be resuming; re-run in a minute" }

    # Reads [Exercises] through the full model: a code/schema mismatch shows up here and nowhere else.
    $context = Wait-ForStatus '/api/exercise-context' -Accept 200, 404 -Attempts 3 -DelaySeconds 10
    switch ([int] $context.StatusCode) {
        200 {
            $exercise = $context.Content | ConvertFrom-Json
            Add-Result 'Schema matches code' PASS "exercise '$($exercise.exerciseName)' resolves for $ApiHost"
            if ($exercise.status -eq 'live') { Add-Result 'Exercise is live' PASS 'status = live (Freeze works only in a live world)' }
            else { Add-Result 'Exercise is live' WARN "status = $($exercise.status) — Freeze is refused (409) outside a live world" }
            return $true
        }
        404 { Add-Result 'Schema matches code' FAIL "no exercise is bound to $ApiHost — run the bootstrap (runbook step 4)"; return $false }
        default { Add-Result 'Schema matches code' FAIL "/api/exercise-context -> $($context.StatusCode). The deployed code and the database disagree; check the last Deploy Backend run's migration step for 'Msg' lines."; return $false }
    }
}

function Test-Wiring {
    # Session-gated: an anonymous call must be refused (401). 404 means the route was never mapped.
    $routes = '/api/engine/settings', '/api/engine/review-queue', '/api/engine/usage', '/api/steering/pause-tier', '/api/overlay-state'
    $bad = foreach ($route in $routes) {
        $code = [int] (Invoke-Probe $route).StatusCode
        if ($code -ne 401) { "$route -> $code" }
    }
    if ($bad) { Add-Result 'Demo routes wired' FAIL ($bad -join '; ') }
    else { Add-Result 'Demo routes wired' PASS "$($routes.Count) session-gated routes answer 401, none 404" }
}

function Get-BootstrapSecret {
    if ($env:PULSE_BOOTSTRAP_SECRET) { return $env:PULSE_BOOTSTRAP_SECRET }
    $value = az webapp config appsettings list --resource-group $ResourceGroup --name $WebAppName `
        --subscription $Subscription --only-show-errors `
        --query "[?name=='Authentication__Bootstrap__Secret'].value | [0]" -o tsv
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($value)) {
        throw "Could not read Authentication__Bootstrap__Secret from $WebAppName. Run 'az login' with access to the Shared SandBox subscription, or set PULSE_BOOTSTRAP_SECRET."
    }
    return $value.Trim()
}

Write-Host "Pulse UAT demo reset — $api" -ForegroundColor Cyan
Write-Host "`n1-2. Health and schema" -ForegroundColor Cyan
$healthy = Test-ApiAndSchema -Attempts 3

if ($CheckOnly) {
    Write-Host "`n6. Wiring" -ForegroundColor Cyan
    Test-Wiring
}
elseif (-not $healthy -and -not $NoRestart) {
    Write-Host "`nThe API or schema check failed. A restart won't fix a schema mismatch; continuing to restart anyway, since a wedged process looks the same." -ForegroundColor Yellow
}

if (-not $CheckOnly) {
    if (-not $NoRestart) {
        Write-Host "`n3. Restart the App Service (clears in-memory engine, pause and autonomy state)" -ForegroundColor Cyan
        az webapp restart --resource-group $ResourceGroup --name $WebAppName --subscription $Subscription --only-show-errors
        if ($LASTEXITCODE -ne 0) { Add-Result 'Restart' FAIL 'az webapp restart failed — check your az login and access to the Shared SandBox subscription' }
        else {
            Add-Result 'Restart' PASS "$WebAppName restarted"
            Start-Sleep -Seconds 15
            $healthy = Test-ApiAndSchema -Attempts 18
        }
    }

    Write-Host "`n4. Re-seed the engine" -ForegroundColor Cyan
    $secret = $null
    try {
        $secret = Get-BootstrapSecret
        $headers = @{ 'X-Bootstrap-Secret' = $secret }

        $seedBody = @{ hostname = $ApiHost }
        if ($PSBoundParameters.ContainsKey('ResponseWindowMinutes')) { $seedBody.responseWindowMinutes = $ResponseWindowMinutes }
        $seed = Invoke-Probe '/api/ops/seed-engine-content' -Method POST -Headers $headers -Body ($seedBody | ConvertTo-Json -Compress)
        switch ([int] $seed.StatusCode) {
            200 {
                $s = $seed.Content | ConvertFrom-Json
                Add-Result 'Engine seeded' PASS ("storyline '{0}' at minute 0; escalates after {1} scenario min of silence; personas {2} created / {3} reused" -f `
                    $s.storylineTitle, $s.responseWindowMinutes, $s.personasCreated, $s.personasReused)
                if ($s.personasBackfilled -gt 0 -or $s.personasCastableClosed -gt 0) { Add-Result 'Seed modified rows' WARN $s.note }
            }
            404 { Add-Result 'Engine seeded' FAIL '404 — the secret was rejected, or no exercise is bound to the host (the endpoint does not say which)' }
            429 { Add-Result 'Engine seeded' FAIL '429 — seed rate limit (10/min); wait a minute and re-run' }
            default { Add-Result 'Engine seeded' FAIL "$($seed.StatusCode) $($seed.Content)" }
        }

        if ($ParticipantUsername -and $PersonaHandle) {
            Write-Host "`n5. Bind the participant to a posting persona" -ForegroundColor Cyan
            $bindBody = @{ hostname = $ApiHost; username = $ParticipantUsername; personaHandle = $PersonaHandle } | ConvertTo-Json -Compress
            $bind = Invoke-Probe '/api/ops/bind-participant-persona' -Method POST -Headers $headers -Body $bindBody
            if ([int] $bind.StatusCode -eq 200) { Add-Result 'Participant bound' PASS "$ParticipantUsername -> @$PersonaHandle" }
            else { Add-Result 'Participant bound' FAIL "$($bind.StatusCode) — unknown username or persona, or the secret was rejected (all answer 404)" }
        }
        elseif ($ParticipantUsername -or $PersonaHandle) {
            Add-Result 'Participant bound' WARN 'pass BOTH -ParticipantUsername and -PersonaHandle to bind; skipped'
        }
    }
    catch {
        Add-Result 'Engine seeded' FAIL $_.Exception.Message
    }
    finally {
        $secret = $null
        $headers = $null
    }

    Write-Host "`n6. Wiring" -ForegroundColor Cyan
    Test-Wiring
}

$failed = @($results | Where-Object Status -eq 'FAIL').Count
$warned = @($results | Where-Object Status -eq 'WARN').Count
Write-Host ''
if ($failed -eq 0) {
    Write-Host "READY — $($results.Count) checks, $warned warning(s)." -ForegroundColor Green
    if (-not $CheckOnly) {
        Write-Host "  Participant: $SiteUrl/login     Controller: $SiteUrl/staff/login  (then /staff/console)"
        Write-Host '  Use two FRESH tabs, not a duplicated one: each tab keeps its own session.'
        Write-Host '  Tabs opened before the restart must be refreshed.'
    }
    exit 0
}
Write-Host "NOT READY — $failed check(s) failed." -ForegroundColor Red
exit 1
