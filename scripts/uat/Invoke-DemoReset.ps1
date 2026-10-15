#Requires -Version 7.0

<#
.SYNOPSIS
    The one-shot demo reset: puts Pulse UAT back to the demo's opening state and checks it (story 26, #544).

.DESCRIPTION
    Runs, in order, and stops at the first failure, naming the step:

      1. The runtime reset: POST /api/steering/runtime-state/reset (story 18, DF-28) as a staff controller. It
         sets the pause tier to running, clears the scenario clock (unstarted) and the overlay. Until story 18 is
         deployed the route answers 404, and this step falls back to an App Service restart:
           a. it marks the OLD process: if the pause tier reads running, it sets engine (POST
              /api/steering/pause-tier), so the old process never reads running;
           b. Reset-DemoState.ps1 -Restart (which restarts the App Service and exits 3);
           c. instead of a fixed 8-minute wait, it polls /health and GET /api/steering/pause-tier until the tier
              reads running twice in a row: only the NEW process, which starts empty, answers that. On
              2026-10-07 a seed sent before the handover landed on the old process and was lost. This proof
              assumes ONE instance (UAT's plan runs one): with several, the polls could reach a new instance
              while an old one still serves. If story 17 is deployed without 18, the tier is persisted but not
              cleared by a restart, so the marker survives it, running is never read, and the wait times out:
              deploy 18 (the reset route), or set the tier to running in the console and run again.
         Before its first call, step 1 waits for /health and then /health/ready (up to 2 minutes each): on
         demo morning serverless SQL is usually paused and takes a while to wake.
      2. Reset-DemoState.ps1: the engine loop re-seed (with -AutoConfirmResponses if you pass it).
      3. Clear-DemoContent.ps1: archives old posts and the MSEL-imported run-sheet items, vetoes stale drafts.
      4. Seed-DemoContent.ps1 -RunSheet exceptMsel: the opening feed, pins, noise pool, media marking, the run
         sheet without the msel items (DF-16), and pause tier engine (DF-38).
      5. Test-DemoReady.ps1: the pre-flight.

    If a step after step 1 fails, the script makes a best-effort POST /api/steering/pause-tier { tier: engine }
    before it exits, so a half-reset world (step 1 left the tier at running) does not leave the engine reacting,
    and prints the tier it ended on in red (or says to pause the engine from the console if that call fails).
 Its results also go to scripts/uat/logs/demo-ready-<timestamp>.json.

    -WhatIf prints the plan and each script's own preview, and writes nothing: no runtime reset and no restart
    (step 1 is described, not run), Reset-DemoState.ps1 -CheckOnly (its read-only mode; it has no -WhatIf),
    Clear-DemoContent.ps1 -WhatIf, Seed-DemoContent.ps1 -RunSheet exceptMsel -WhatIf. Step 5 is not run (it
    would only report the state before the reset). A -WhatIf run goes through every preview even if one fails.

    A transcript of the whole run goes to scripts/uat/logs/demo-reset-<yyyyMMdd-HHmmss>.log (git-ignored).

    SECRETS. This script takes no secret and passes none to another script, on a command line or otherwise.
    Step 1 reads the staff secret like Import-Roster.ps1 ($env:PULSE_STAFF_SECRET, else the App Service setting
    through YOUR az login); the other scripts get their own: Reset-DemoState.ps1 the bootstrap secret
    (PULSE_BOOTSTRAP_SECRET or az), Clear-DemoContent.ps1 an Entra token from your az login, Seed-DemoContent.ps1
    the staff secret from PULSE_STAFF_SECRET or a hidden prompt, which you answer in this window. A hidden
    prompt's answer is not echoed, so the transcript never holds it, and no script prints a secret or a token.

    Needs: az login (Shared SandBox subscription) and the SQL firewall rule for Clear-DemoContent.ps1.

.PARAMETER WhatIf
    Print the plan and each script's own preview; write nothing.

.PARAMETER ApiHost
    The API's host name, which the exercise is bound to.

.PARAMETER SiteUrl
    The participant site.

.PARAMETER StaffUsername
    The staff controller for the runtime reset, the seed and the pre-flight.

.PARAMETER ExerciseId
    Passed to Test-DemoReady.ps1. The other scripts resolve the exercise from -ApiHost.

.PARAMETER AutoConfirmResponses
    Passed to Reset-DemoState.ps1 (step 2): demo beat 4's setting.

.PARAMETER ReloadFiredRunSheet
    Passed to Seed-DemoContent.ps1 (step 4): after a rehearsal that fired the run sheet (README-seed.md).

.PARAMETER RestartTimeoutMinutes
    The fallback's longest wait for the new process (step 1c). Default 15.

.PARAMETER PollSeconds
    How often the fallback polls (step 1c). Default 20.

.PARAMETER LogDirectory
    Where the transcript and the pre-flight's JSON go. Default scripts/uat/logs.

.EXAMPLE
    pwsh scripts/uat/Invoke-DemoReset.ps1 -WhatIf

.EXAMPLE
    pwsh scripts/uat/Invoke-DemoReset.ps1 -AutoConfirmResponses

.EXAMPLE
    pwsh scripts/uat/Invoke-DemoReset.ps1 -AutoConfirmResponses -ReloadFiredRunSheet     # after a rehearsal
#>
[CmdletBinding()]
param(
    [switch] $WhatIf,
    [ValidateNotNullOrEmpty()] [string] $ApiHost = 'app-pulse-api-uat-dynamis.azurewebsites.net',
    [string] $SiteUrl = 'https://pulse-uat.cobrasoftware.com',
    [ValidateNotNullOrEmpty()] [string] $StaffUsername = 'controller1',
    [string] $ExerciseId,
    [switch] $AutoConfirmResponses,
    [switch] $ReloadFiredRunSheet,
    [ValidateRange(1, 120)] [int] $RestartTimeoutMinutes = 15,
    [ValidateRange(1, 600)] [int] $PollSeconds = 20,
    [string] $LogDirectory = (Join-Path $PSScriptRoot 'logs'),
    [string] $Subscription = '2a127d53-c9bf-471a-8196-3155eae6cb1b',
    [string] $ResourceGroup = 'rg-pulse-uat-centralus',
    [string] $WebAppName = 'app-pulse-api-uat-dynamis'
)

$ErrorActionPreference = 'Stop'
$PSDefaultParameterValues = @{}
. "$PSScriptRoot/Common.ps1"

# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# HTTP and the staff session (as Import-Roster.ps1 and Test-DemoReady.ps1; each UAT script is self-contained)
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

function Get-PrintableText {
    param([AllowNull()] [object] $Value, [int] $Max = 0)
    $text = ([string] $Value) -replace '[\t\r\n]', ' ' -replace '[\p{Cc}\p{Cf}]', ''
    if ($Max -gt 1 -and $text.Length -gt $Max) { $text = $text.Substring(0, $Max - 1) + '…' }
    return $text
}

function Resolve-ApiBaseUrl {
    param([Parameter(Mandatory)] [string] $ApiHost)
    $value = $ApiHost.Trim().TrimEnd('/')
    if ($value -notmatch '^[A-Za-z][A-Za-z0-9+.-]*://') { $value = "https://$value" }
    $uri = $null
    if (-not [Uri]::TryCreate($value, [UriKind]::Absolute, [ref] $uri)) { throw "-ApiHost '$ApiHost' is not a host name." }
    if ($uri.Scheme -ne 'https' -and -not ($uri.Scheme -eq 'http' -and $uri.IsLoopback)) {
        throw '-ApiHost must use https (plain http only for localhost): the staff secret and the session token must not travel in the clear.'
    }
    if ($uri.AbsolutePath -ne '/' -or $uri.Query) { throw "-ApiHost must be a host name or an origin, without a path: '$ApiHost'." }
    return $uri.GetLeftPart([UriPartial]::Authority)
}

function Clear-WebErrorRecord {
    param([AllowEmptyCollection()] [object[]] $Exceptions = @())
    foreach ($record in @($global:Error)) {
        if ($record -isnot [System.Management.Automation.ErrorRecord]) { continue }
        $fromRequest = $record.TargetObject -is [System.Net.Http.HttpRequestMessage]
        $listed = @($Exceptions | Where-Object { $null -ne $_ -and [object]::ReferenceEquals($_, $record.Exception) }).Count -gt 0
        if ($fromRequest -or $listed) { $global:Error.Remove($record) }
    }
}

function Invoke-PulseApi {
    <# One request to the API. Returns @{ Status; Json; Text }. Throws a readable error when no response arrives. #>
    param(
        [Parameter(Mandatory)] [string] $BaseUrl,
        [Parameter(Mandatory)] [ValidateSet('GET', 'POST')] [string] $Method,
        [Parameter(Mandatory)] [string] $Path,
        [string] $Token,
        [AllowNull()] [object] $Body,
        [int] $TimeoutSec = 90
    )
    $headers = @{ Accept = 'application/json' }
    if ($Token) { $headers['Authorization'] = "Bearer $Token" }
    $request = @{
        Uri = "$BaseUrl$Path"; Method = $Method; Headers = $headers; TimeoutSec = $TimeoutSec
        SkipHttpErrorCheck = $true; MaximumRedirection = 0; Debug = $false; Verbose = $false; ErrorAction = 'Stop'
    }
    if ($BaseUrl -like 'http://*') { $request['AllowUnencryptedAuthentication'] = $true }
    if ($null -ne $Body) {
        $request['Body'] = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Body -Compress -Depth 5))
        $request['ContentType'] = 'application/json; charset=utf-8'
    }
    $bare = ($Path -split '\?', 2)[0]
    $response = $null
    try {
        try { $response = Invoke-WebRequest @request }
        catch {
            $redirected = "$($_.FullyQualifiedErrorId)" -like 'MaximumRedirect*'
            $reason = (Get-PrintableText $_.Exception.Message).TrimEnd('.')
            Clear-WebErrorRecord -Exceptions @($_.Exception)
            if ($redirected) { throw [System.Exception]::new("$Method $bare answered a redirect, which was not followed. Check -ApiHost ($BaseUrl).") }
            throw [System.Exception]::new("No answer from the API to $Method ${bare}: $reason. Check -ApiHost ($BaseUrl).")
        }
    }
    finally {
        if ($request['Body'] -is [byte[]]) { [Array]::Clear($request['Body'], 0, $request['Body'].Length) }
        $headers.Clear()
    }
    $status = [int] $response.StatusCode
    if ($status -ge 300 -and $status -lt 400) { throw [System.Exception]::new("$Method $bare answered a redirect ($status), which was not followed. Check -ApiHost ($BaseUrl).") }
    $content = $response.Content
    $text = if ($content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($content) } else { [string] $content }
    $json = $null
    if ($text.Trim()) {
        try { $json = ConvertFrom-Json -InputObject $text -AsHashtable }
        catch { $json = $null }
    }
    return [pscustomobject]@{ Status = $status; Json = $json; Text = $text }
}

function Get-ExerciseId {
    <# The exercise bound to the API host (anonymous GET /api/exercise-context). #>
    param([Parameter(Mandatory)] [string] $BaseUrl)
    $response = Invoke-PulseApi -BaseUrl $BaseUrl -Method GET -Path '/api/exercise-context'
    $id = [guid]::Empty
    if ($response.Status -eq 200 -and $response.Json -is [System.Collections.IDictionary] -and [guid]::TryParse([string] $response.Json['exerciseId'], [ref] $id)) { return $id.ToString('D') }
    throw "GET /api/exercise-context answered $($response.Status): no exercise is bound to $BaseUrl, or the API is not healthy (Reset-DemoState.ps1 -CheckOnly)."
}

function Get-StaffSecret {
    <# $env:PULSE_STAFF_SECRET, otherwise the App Service setting through the caller's az login. Never printed. #>
    param([Parameter(Mandatory)] [string] $StaffUsername, [string] $Subscription, [string] $ResourceGroup, [string] $WebAppName)
    if ($env:PULSE_STAFF_SECRET) { return $env:PULSE_STAFF_SECRET }
    $hint = "Set PULSE_STAFF_SECRET instead (Copy-StaffSecret.ps1 $StaffUsername copies the secret to the clipboard)."
    try {
        $json = Invoke-Az webapp config appsettings list --resource-group $ResourceGroup --name $WebAppName --subscription $Subscription `
            --query "[?starts_with(name, 'Authentication__StaffIdentity__Accounts__') && ends_with(name, '__Username')]" -o json
        $names = @($json | ConvertFrom-Json)
    }
    catch { throw "Could not read the staff logins from ${WebAppName}: $($_.Exception.Message) $hint" }
    $entry = $names | Where-Object { $_.value -ieq $StaffUsername } | Select-Object -First 1
    if (-not $entry) { throw "No staff login '$StaffUsername' is configured on $WebAppName. Use -StaffUsername, or $hint" }
    $index = [regex]::Match([string] $entry.name, '__Accounts__(\d+)__').Groups[1].Value
    try {
        $value = Invoke-Az webapp config appsettings list --resource-group $ResourceGroup --name $WebAppName --subscription $Subscription `
            --query "[?name == 'Authentication__StaffIdentity__Accounts__${index}__Secret'] | [0]" -o json
        $secret = [string] ($value | ConvertFrom-Json).value
    }
    catch { throw "Could not read the secret for '$StaffUsername' from ${WebAppName}: $($_.Exception.Message) $hint" }
    finally { $value = $null }
    if ([string]::IsNullOrEmpty($secret)) { throw "'$StaffUsername' has no secret configured on $WebAppName. $hint" }
    return $secret
}

function Connect-StaffSession {
    <#
    .SYNOPSIS
        POST /api/auth/staff/login { username, secret, exerciseId }. Returns @{ Token; ActingHumanId }: the pause
        tier needs the staff user's actingHumanId (COR-018).
    #>
    param([Parameter(Mandatory)] [string] $BaseUrl, [Parameter(Mandatory)] [string] $StaffUsername, [Parameter(Mandatory)] [string] $Secret, [Parameter(Mandatory)] [string] $ExerciseId)
    $body = [ordered]@{ username = $StaffUsername; secret = $Secret; exerciseId = $ExerciseId }
    try { $response = Invoke-PulseApi -BaseUrl $BaseUrl -Method POST -Path '/api/auth/staff/login' -Body $body }
    finally { $body['secret'] = $null }
    if ($response.Status -eq 200 -and $response.Json -is [System.Collections.IDictionary] -and $response.Json['token']) {
        $session = $response.Json['session']
        $result = [pscustomobject]@{
            Token         = [string] $response.Json['token']
            ActingHumanId = if ($session -is [System.Collections.IDictionary]) { [string] $session['actingHumanId'] } else { '' }
        }
        $response.Json.Clear()
        return $result
    }
    switch ($response.Status) {
        401 { throw "Sign-in was refused (401): '$StaffUsername' or its secret was rejected. Check -StaffUsername and PULSE_STAFF_SECRET (or the App Service setting)." }
        403 { throw "Sign-in was refused (403): '$StaffUsername' is not assigned to exercise $ExerciseId." }
        429 { throw 'Sign-in was refused (429): too many sign-in attempts (10 a minute). Wait a minute and run again.' }
        default { throw "Sign-in failed ($($response.Status))." }
    }
}

function Disconnect-StaffSession {
    <# POST /api/auth/logout. Never throws. #>
    param([Parameter(Mandatory)] [string] $BaseUrl, [AllowNull()] [AllowEmptyString()] [string] $Token)
    if (-not $Token) { return }
    try {
        $response = Invoke-PulseApi -BaseUrl $BaseUrl -Method POST -Path '/api/auth/logout' -Token $Token -TimeoutSec 30
        if ($response.Status -ge 200 -and $response.Status -lt 300) { Write-Host '    Signed out.' -ForegroundColor DarkGray }
        else { Write-Warning "Sign-out answered $($response.Status); the staff session will expire on its own." }
    }
    catch { Write-Warning "Sign-out failed ($($_.Exception.Message)); the staff session will expire on its own." }
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# Steps
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

function Invoke-DemoScript {
    <#
    .SYNOPSIS
        Runs one of the UAT scripts in this session (so its colours, prompts and output reach the console and the
        transcript) and returns its exit code. A script that throws, or ends without an exit code, is handled:
        a throw is a failure, no exit code is 0.
    #>
    param([Parameter(Mandatory)] [string] $Name, [hashtable] $Arguments = @{})
    $path = Join-Path $PSScriptRoot $Name
    $global:LASTEXITCODE = 0
    & $path @Arguments | Out-Host
    return [int] $global:LASTEXITCODE
}

function Format-StepArguments {
    <# The arguments a step runs with, for the plan and the transcript. They never include a secret (none is passed). #>
    param([hashtable] $Arguments)
    $parts = foreach ($key in ($Arguments.Keys | Sort-Object)) {
        $value = $Arguments[$key]
        if ($value -is [switch] -or $value -is [bool]) { if ($value) { "-$key" } }
        else { "-$key '$value'" }
    }
    return ($parts -join ' ')
}

function Wait-NewProcess {
    <#
    .SYNOPSIS
        After the fallback restart: polls /health and the pause tier until the tier reads running twice in a row.
        The old process was marked (never running), so only the new process answers running.
    #>
    param([string] $BaseUrl, [string] $Token, [int] $TimeoutMinutes, [int] $PollSeconds)
    $attempts = [int] [math]::Ceiling($TimeoutMinutes * 60 / $PollSeconds)
    $streak = 0
    for ($i = 1; $i -le $attempts; $i++) {
        $health = 0; $tier = '-'
        try { $health = (Invoke-PulseApi -BaseUrl $BaseUrl -Method GET -Path '/health' -TimeoutSec 30).Status } catch { $health = 0 }
        if ($health -eq 200) {
            try {
                $read = Invoke-PulseApi -BaseUrl $BaseUrl -Method GET -Path '/api/steering/pause-tier' -Token $Token -TimeoutSec 30
                $tier = if ($read.Status -eq 200 -and $read.Json -is [System.Collections.IDictionary]) { Get-PrintableText $read.Json['tier'] -Max 20 } else { "($($read.Status))" }
            }
            catch { $tier = '(no answer)' }
        }
        $streak = if ($tier -eq 'running') { $streak + 1 } else { 0 }
        $elapsed = [math]::Round(($i - 1) * $PollSeconds / 60, 1)
        Write-Host "    ~$elapsed min: /health $health, pause tier $tier" -ForegroundColor DarkGray
        if ($streak -ge 2) { return [pscustomobject]@{ Ok = $true; Minutes = $elapsed } }
        if ($i -lt $attempts) { Start-Sleep -Seconds $PollSeconds }
    }
    return [pscustomobject]@{ Ok = $false; Minutes = $TimeoutMinutes }
}

function Wait-ApiStatus {
    <# Polls an anonymous route until it answers 200; returns the last status (0: no answer). #>
    param([string] $BaseUrl, [string] $Path, [int] $Attempts = 12, [int] $DelaySeconds = 10)
    $code = 0
    for ($i = 1; $i -le $Attempts; $i++) {
        try { $code = (Invoke-PulseApi -BaseUrl $BaseUrl -Method GET -Path $Path -TimeoutSec 90).Status } catch { $code = 0 }
        if ($code -eq 200) { return $code }
        if ($i -lt $Attempts) {
            Write-Host "    $Path -> $code (attempt $i/$Attempts), retrying in ${DelaySeconds}s…" -ForegroundColor DarkGray
            Start-Sleep -Seconds $DelaySeconds
        }
    }
    return $code
}

function Connect-DemoStaff {
    <# The host's exercise, the staff secret and the sign-in, as one call. The secret is dropped at once. #>
    param([string] $BaseUrl, [string] $StaffUsername, [string] $Subscription, [string] $ResourceGroup, [string] $WebAppName)
    $exerciseId = Get-ExerciseId -BaseUrl $BaseUrl
    $secret = Get-StaffSecret -StaffUsername $StaffUsername -Subscription $Subscription -ResourceGroup $ResourceGroup -WebAppName $WebAppName
    try { return (Connect-StaffSession -BaseUrl $BaseUrl -StaffUsername $StaffUsername -Secret $secret -ExerciseId $exerciseId) }
    finally { $secret = $null }
}

function Set-EngineTierAfterFailure {
    <#
    .SYNOPSIS
        After a failed step 2 to 5: best effort POST /api/steering/pause-tier { tier: engine }, so a half-reset world
        never leaves the engine reacting. Never throws; prints the tier it ended on in red.
    #>
    param([string] $BaseUrl, [string] $StaffUsername, [string] $Subscription, [string] $ResourceGroup, [string] $WebAppName)
    $session = $null
    try {
        $session = Connect-DemoStaff -BaseUrl $BaseUrl -StaffUsername $StaffUsername -Subscription $Subscription -ResourceGroup $ResourceGroup -WebAppName $WebAppName
        $set = Invoke-PulseApi -BaseUrl $BaseUrl -Method POST -Path '/api/steering/pause-tier' -Token $session.Token -Body ([ordered]@{ tier = 'engine'; actingHumanId = $session.ActingHumanId })
        $tier = if ($set.Json -is [System.Collections.IDictionary] -and $set.Json['tier']) { Get-PrintableText $set.Json['tier'] -Max 20 } else { $null }
        if ($set.Status -eq 200 -and $tier) { Write-Host "  Pause tier after the failure: $tier (set engine, so the engine does not react to a half-reset world)." -ForegroundColor Red }
        else { Write-Host "  Pause tier after the failure: UNKNOWN (POST /api/steering/pause-tier -> $($set.Status)). Pause the engine from the console." -ForegroundColor Red }
    }
    catch { Write-Host "  Pause tier after the failure: UNKNOWN ($(Get-PrintableText $_.Exception.Message -Max 200)). Pause the engine from the console." -ForegroundColor Red }
    finally { if ($session) { Disconnect-StaffSession -BaseUrl $BaseUrl -Token $session.Token; $session.Token = $null } }
}

function Invoke-RuntimeReset {
    <#
    .SYNOPSIS
        Step 1. The runtime reset route, or (404: story 18 not deployed) the restart fallback. Returns
        @{ Ok; Detail }. Signs out whatever happens.
    #>
    param(
        [Parameter(Mandatory)] [string] $BaseUrl,
        [Parameter(Mandatory)] [string] $StaffUsername,
        [string] $ApiHost, [string] $SiteUrl, [string] $Subscription, [string] $ResourceGroup, [string] $WebAppName,
        [int] $RestartTimeoutMinutes, [int] $PollSeconds
    )
    $session = $null
    try {
        # Serverless SQL is usually paused on demo morning: wake it before the first real call.
        $health = Wait-ApiStatus -BaseUrl $BaseUrl -Path '/health'
        if ($health -ne 200) { return [pscustomobject]@{ Ok = $false; Detail = "/health -> $health after 2 min: the App Service is down or still starting" } }
        $ready = Wait-ApiStatus -BaseUrl $BaseUrl -Path '/health/ready'
        if ($ready -ne 200) { return [pscustomobject]@{ Ok = $false; Detail = "/health/ready -> $ready after 2 min: serverless SQL has not woken; run again in a minute" } }
        $session = Connect-DemoStaff -BaseUrl $BaseUrl -StaffUsername $StaffUsername -Subscription $Subscription -ResourceGroup $ResourceGroup -WebAppName $WebAppName
        Write-Host "    Signed in as $StaffUsername." -ForegroundColor DarkGray

        $reset = Invoke-PulseApi -BaseUrl $BaseUrl -Method POST -Path '/api/steering/runtime-state/reset' -Token $session.Token -Body ([ordered]@{ actingHumanId = $session.ActingHumanId })
        if ($reset.Status -eq 200) {
            $tier = if ($reset.Json -is [System.Collections.IDictionary]) { Get-PrintableText $reset.Json['tier'] -Max 20 } else { '?' }
            return [pscustomobject]@{ Ok = $true; Detail = "POST /api/steering/runtime-state/reset -> 200: tier $tier, scenario clock unstarted, overlay none (DF-28)" }
        }
        if ($reset.Status -ne 404) {
            return [pscustomobject]@{ Ok = $false; Detail = "POST /api/steering/runtime-state/reset -> $($reset.Status) (expected 200; 403 means '$StaffUsername' is not a controller)" }
        }

        Write-Host '    POST /api/steering/runtime-state/reset -> 404: story 18 is not deployed. Falling back to an App Service restart.' -ForegroundColor Yellow
        # a. Mark the old process, so that "running" can only come from the new one.
        $read = Invoke-PulseApi -BaseUrl $BaseUrl -Method GET -Path '/api/steering/pause-tier' -Token $session.Token
        if ($read.Status -ne 200 -or $read.Json -isnot [System.Collections.IDictionary]) {
            return [pscustomobject]@{ Ok = $false; Detail = "fallback: GET /api/steering/pause-tier -> $($read.Status); the old process could not be marked" }
        }
        $before = Get-PrintableText $read.Json['tier'] -Max 20
        if ($before -eq 'running') {
            $mark = Invoke-PulseApi -BaseUrl $BaseUrl -Method POST -Path '/api/steering/pause-tier' -Token $session.Token -Body ([ordered]@{ tier = 'engine'; actingHumanId = $session.ActingHumanId })
            if ($mark.Status -ne 200) { return [pscustomobject]@{ Ok = $false; Detail = "fallback: marking the old process (pause tier engine) -> $($mark.Status)" } }
            Write-Host '    Marked the old process: pause tier running -> engine.' -ForegroundColor DarkGray
        }
        else { Write-Host "    The old process reads pause tier $before (not running): already marked." -ForegroundColor DarkGray }

        # b. Restart.
        $restartArguments = @{ Restart = $true; ApiHost = $ApiHost; SiteUrl = $SiteUrl; Subscription = $Subscription; ResourceGroup = $ResourceGroup; WebAppName = $WebAppName }
        Write-Host "    Reset-DemoState.ps1 $(Format-StepArguments $restartArguments)" -ForegroundColor DarkGray
        $code = Invoke-DemoScript -Name 'Reset-DemoState.ps1' -Arguments $restartArguments
        if ($code -ne 3) { return [pscustomobject]@{ Ok = $false; Detail = "fallback: Reset-DemoState.ps1 -Restart exited $code (expected 3, restarted)" } }

        # c. Wait for the new process instead of a fixed 8 minutes.
        Write-Host "    Waiting for the new process (polling every $PollSeconds s, at most $RestartTimeoutMinutes min)…" -ForegroundColor Cyan
        $wait = Wait-NewProcess -BaseUrl $BaseUrl -Token $session.Token -TimeoutMinutes $RestartTimeoutMinutes -PollSeconds $PollSeconds
        if (-not $wait.Ok) { return [pscustomobject]@{ Ok = $false; Detail = "fallback: the new process did not answer within $RestartTimeoutMinutes min (the tier never read running twice). Check the App Service, then run again. If story 17 is deployed without 18 the marker (pause tier engine) persists across the restart: set the tier to running in the console, or deploy 18" } }
        return [pscustomobject]@{ Ok = $true; Detail = "restart fallback: the new process is serving after ~$($wait.Minutes) min (tier running, clock unstarted)" }
    }
    catch { return [pscustomobject]@{ Ok = $false; Detail = $_.Exception.Message } }
    finally {
        if ($session) { Disconnect-StaffSession -BaseUrl $BaseUrl -Token $session.Token; $session.Token = $null }
    }
}

function Get-DemoResetPlan {
    <# The steps after step 1: name, script and arguments. -WhatIf swaps in each script's own preview. #>
    param(
        [string] $ApiHost, [string] $SiteUrl, [string] $StaffUsername, [string] $ExerciseId, [switch] $AutoConfirmResponses,
        [switch] $ReloadFiredRunSheet, [switch] $WhatIf, [string] $Subscription, [string] $ResourceGroup, [string] $WebAppName,
        [string] $ReadyJsonPath
    )
    $resetArguments = @{ ApiHost = $ApiHost; SiteUrl = $SiteUrl; Subscription = $Subscription; ResourceGroup = $ResourceGroup; WebAppName = $WebAppName }
    if ($WhatIf) { $resetArguments['CheckOnly'] = $true }
    elseif ($AutoConfirmResponses) { $resetArguments['AutoConfirmResponses'] = $true }

    $clearArguments = @{ ApiHost = $ApiHost; Subscription = $Subscription }
    if ($WhatIf) { $clearArguments['WhatIf'] = $true }

    $seedArguments = @{ ApiHost = $ApiHost; SiteUrl = $SiteUrl; StaffUsername = $StaffUsername; RunSheet = 'exceptMsel' }
    if ($ReloadFiredRunSheet) { $seedArguments['ReloadFiredRunSheet'] = $true }
    if ($WhatIf) { $seedArguments['WhatIf'] = $true }

    $readyArguments = @{ ApiHost = $ApiHost; SiteUrl = $SiteUrl; StaffUsername = $StaffUsername; Subscription = $Subscription; ResourceGroup = $ResourceGroup; WebAppName = $WebAppName; Json = $true; JsonPath = $ReadyJsonPath }
    if ($ExerciseId) { $readyArguments['ExerciseId'] = $ExerciseId }

    @(
        [pscustomobject]@{ Number = 2; Name = 'Engine re-seed'; Script = 'Reset-DemoState.ps1'; Arguments = $resetArguments; Run = $true }
        [pscustomobject]@{ Number = 3; Name = 'Clear old content'; Script = 'Clear-DemoContent.ps1'; Arguments = $clearArguments; Run = $true }
        [pscustomobject]@{ Number = 4; Name = 'Seed the demo'; Script = 'Seed-DemoContent.ps1'; Arguments = $seedArguments; Run = $true }
        [pscustomobject]@{ Number = 5; Name = 'Pre-flight'; Script = 'Test-DemoReady.ps1'; Arguments = $readyArguments; Run = (-not $WhatIf) }
    )
}

function Invoke-DemoReset {
    <# The whole run. Returns the exit code: 0 when every step passed (or every preview ran), 1 otherwise. #>
    [CmdletBinding()]
    param(
        [switch] $WhatIf,
        [Parameter(Mandatory)] [string] $ApiHost,
        [string] $SiteUrl,
        [Parameter(Mandatory)] [string] $StaffUsername,
        [string] $ExerciseId,
        [switch] $AutoConfirmResponses,
        [switch] $ReloadFiredRunSheet,
        [int] $RestartTimeoutMinutes = 15,
        [int] $PollSeconds = 20,
        [Parameter(Mandatory)] [string] $LogDirectory,
        [string] $Subscription,
        [string] $ResourceGroup,
        [string] $WebAppName
    )
    $ProgressPreference = 'SilentlyContinue'
    try { $baseUrl = Resolve-ApiBaseUrl -ApiHost $ApiHost }
    catch { Write-Host $_.Exception.Message -ForegroundColor Red; return 1 }

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    if (-not (Test-Path -LiteralPath $LogDirectory)) { New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null }
    $logPath = Join-Path $LogDirectory "demo-reset-$stamp.log"
    $readyJson = Join-Path $LogDirectory "demo-ready-$stamp.json"
    Start-Transcript -LiteralPath $logPath -UseMinimalHeader | Out-Null
    $exitCode = 1
    try {
        $mode = if ($WhatIf) { 'WHATIF: plan and previews only, nothing is written' } else { 'live' }
        Write-Host "Pulse demo reset — $baseUrl — $mode" -ForegroundColor Cyan
        Write-Host "  Transcript: $logPath" -ForegroundColor DarkGray

        $planArguments = @{
            ApiHost = $ApiHost; SiteUrl = $SiteUrl; StaffUsername = $StaffUsername; ExerciseId = $ExerciseId
            AutoConfirmResponses = $AutoConfirmResponses; ReloadFiredRunSheet = $ReloadFiredRunSheet; WhatIf = $WhatIf
            Subscription = $Subscription; ResourceGroup = $ResourceGroup; WebAppName = $WebAppName; ReadyJsonPath = $readyJson
        }
        $plan = @(Get-DemoResetPlan @planArguments)

        Write-Host "`nPlan:" -ForegroundColor Cyan
        Write-Host '  1. Runtime reset: POST /api/steering/runtime-state/reset (story 18); on 404, Reset-DemoState.ps1 -Restart, then poll until the new process serves'
        foreach ($step in $plan) {
            $note = if ($step.Run) { '' } else { '   (not run with -WhatIf)' }
            Write-Host "  $($step.Number). $($step.Name): $($step.Script) $(Format-StepArguments $step.Arguments)$note"
        }

        $failures = [System.Collections.Generic.List[string]]::new()
        Write-Host "`n1. Runtime reset" -ForegroundColor Cyan
        if ($WhatIf) {
            Write-Host '    WhatIf: would POST /api/steering/runtime-state/reset as a staff controller (no sign-in now, nothing sent).'
        }
        else {
            $resetArguments = @{
                BaseUrl = $baseUrl; StaffUsername = $StaffUsername; ApiHost = $ApiHost; SiteUrl = $SiteUrl; Subscription = $Subscription
                ResourceGroup = $ResourceGroup; WebAppName = $WebAppName; RestartTimeoutMinutes = $RestartTimeoutMinutes; PollSeconds = $PollSeconds
            }
            $result = Invoke-RuntimeReset @resetArguments
            if ($result.Ok) { Write-Host "  [PASS] 1. Runtime reset — $($result.Detail)" -ForegroundColor Green }
            else {
                Write-Host "  [FAIL] 1. Runtime reset — $($result.Detail)" -ForegroundColor Red
                $failures.Add('1. Runtime reset')
            }
        }

        foreach ($step in $plan) {
            if ($failures.Count -and -not $WhatIf) { break }
            Write-Host "`n$($step.Number). $($step.Name): $($step.Script) $(Format-StepArguments $step.Arguments)" -ForegroundColor Cyan
            if (-not $step.Run) { Write-Host '    WhatIf: not run (it would only report the state before the reset).'; continue }
            $code = 1
            $reason = $null
            try { $code = Invoke-DemoScript -Name $step.Script -Arguments $step.Arguments }
            catch { $reason = Get-PrintableText $_.Exception.Message -Max 400 }
            if ($null -eq $reason -and $code -eq 0) { Write-Host "  [PASS] $($step.Number). $($step.Name) — $($step.Script) exited 0" -ForegroundColor Green; continue }
            $why = if ($reason) { "it stopped with an error: $reason" } else { "exited $code" }
            Write-Host "  [FAIL] $($step.Number). $($step.Name) — $($step.Script) $why" -ForegroundColor Red
            $failures.Add("$($step.Number). $($step.Name) ($($step.Script))")
        }

        Write-Host ''
        if ($failures.Count -eq 0) {
            if ($WhatIf) { Write-Host 'WHATIF DONE — every preview ran; nothing was written. Run again without -WhatIf to reset.' -ForegroundColor Green }
            else { Write-Host "DEMO RESET DONE — every step passed, and Test-DemoReady says READY ($readyJson)." -ForegroundColor Green }
            $exitCode = 0
        }
        elseif ($WhatIf) {
            Write-Host "WHATIF — $($failures.Count) preview(s) failed: $($failures -join '; ')." -ForegroundColor Red
        }
        else {
            if ($failures[0] -notlike '1.*') {
                Set-EngineTierAfterFailure -BaseUrl $baseUrl -StaffUsername $StaffUsername -Subscription $Subscription -ResourceGroup $ResourceGroup -WebAppName $WebAppName
            }
            $remaining = @($plan | Where-Object { $_.Number -gt [int] ($failures[0] -replace '^(\d+)\..*$', '$1') } | ForEach-Object { "$($_.Number). $($_.Name)" })
            Write-Host "STOPPED at step $($failures[0]). Not run: $(if ($remaining) { $remaining -join ', ' } else { 'nothing' }). Fix the cause and run again (every step is safe to re-run; the pause tier was set to engine above if the failure came after step 1)." -ForegroundColor Red
        }
    }
    finally {
        Stop-Transcript | Out-Null
    }
    return $exitCode
}

# Dot-sourcing (the Pester tests) loads the functions above and stops here.
if ($MyInvocation.InvocationName -eq '.') { return }

$runArguments = @{
    WhatIf = $WhatIf; ApiHost = $ApiHost; SiteUrl = $SiteUrl; StaffUsername = $StaffUsername; ExerciseId = $ExerciseId
    AutoConfirmResponses = $AutoConfirmResponses; ReloadFiredRunSheet = $ReloadFiredRunSheet
    RestartTimeoutMinutes = $RestartTimeoutMinutes; PollSeconds = $PollSeconds; LogDirectory = $LogDirectory
    Subscription = $Subscription; ResourceGroup = $ResourceGroup; WebAppName = $WebAppName
}
$exitCode = Invoke-DemoReset @runArguments | Select-Object -Last 1
exit ([int] $exitCode)
