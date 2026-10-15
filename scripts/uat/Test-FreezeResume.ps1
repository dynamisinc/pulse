#Requires -Version 7.0
<#
.SYNOPSIS
    Live check of Freeze and Resume (demo beat 6; world-steering/07 #350 and /08 #351) against UAT.

.DESCRIPTION
    Signs in as a staff controller and drives the pause tier the way the console's Pause pill does, printing
    PASS / WARN / FAIL per check. It exits non-zero on any FAIL.

      0. Picks the exercise. By default that is a throwaway exercise named -ExerciseName ('Freeze check') from
         the controller's assignments; it never runs against the demo exercise (the one bound to -ApiHost)
         unless -ExerciseId names it explicitly. It refuses an exercise that is not live or is already frozen.
      1. Sets white noise to Low (loading a 3-post "[freeze check]" pool only if the pool is empty) and waits
         for one noise post, whose scenario time anchors the minute check. Then Freeze
         (POST /api/steering/pause-tier, tier freeze, -Register) and GET /api/overlay-state must say pause.
      2. Holds the Freeze for -HoldSeconds (at least 90). Throughout: the tier stays freeze with clockFrozen
         true, no noise post is published and the latest noise post's scenario time does not move. Midway it
         fires a skipped test inject, which must be refused with the server's "world is frozen" message.
      3. Resumes to the tier it found. The overlay must return to none, and the first noise post after the
         resume must carry a scenario time that continues from the frozen minute (within 1 minute), not one
         that ran on through the hold.
      4. With -IncludeRestart: freezes again, restarts the App Service (az), and watches for -RestartWaitMinutes
         (default 9, longer than the ~6-minute process handover seen on 2026-10-07). Freeze must survive: the
         tier stays freeze, the overlay stays pause, the noise clock does not move, and /health is 200. Until
         demo-feedback/18 is deployed a restart clears Freeze; that is reported as a FAIL "expected until
         demo-feedback/18 is deployed".
      5. Always (also after a failure or an exception): puts the pause tier back to the one it found (never
         leaving the exercise FROZEN), deletes the test inject, restores the noise level, clears a pool it
         loaded, and signs out.

    The scenario minute: no staff GET returns the server's current scenario minute (the console's header clock
    is browser-local). The checks read the server clock through two staff signals instead: clockFrozen on
    GET /api/steering/pause-tier (read off the clock itself), and lastPostedAt on GET /api/staff/noise (the
    scenario time the server clock stamped on the latest noise post).

    The overlay: participant sessions are host-bound, so a participant can only read the overlay of the
    exercise bound to -ApiHost. With -ParticipantUsername the overlay is read as that participant when the
    participant's exercise is the one under test; otherwise (the default throwaway exercise) it is read through
    the controller's own session, which serves the same projection, and the script says so with a WARN.

    Secrets: the staff secret comes from $env:PULSE_STAFF_SECRET, else a hidden prompt; the participant password
    from $env:PULSE_PARTICIPANT_PASSWORD, else a hidden prompt. Each is sent only in its sign-in body, to the
    API host, and is never printed, logged or written to disk. The App Service restart uses YOUR az login.

.PARAMETER ExerciseId
    Run against this exercise. Required to run against the demo exercise (the one bound to -ApiHost).

.PARAMETER ExerciseName
    Without -ExerciseId: the name of the throwaway exercise to use, from the controller's assignments. Create it
    in the console (assign -StaffUsername as controller and take it Live) before the first run.

.PARAMETER ParticipantUsername
    A provisioned participant test login (New-DemoParticipant.ps1) to read the overlay as.

.PARAMETER Register
    The holding-page register to freeze with: in-fiction ("We'll be right back") or out-of-fiction.

.PARAMETER HoldSeconds
    How long to hold the Freeze. At least 90.

.PARAMETER IncludeRestart
    Also check that Freeze survives an App Service restart (needs demo-feedback/18 deployed, and az login).

.EXAMPLE
    pwsh scripts/uat/Test-FreezeResume.ps1

.EXAMPLE
    pwsh scripts/uat/Test-FreezeResume.ps1 -Register out-of-fiction

.EXAMPLE
    pwsh scripts/uat/Test-FreezeResume.ps1 -ExerciseId <demo exercise id> -ParticipantUsername pio1 -IncludeRestart
#>
[CmdletBinding()]
param(
    [string] $ApiHost = 'app-pulse-api-uat-dynamis.azurewebsites.net',
    [string] $ExerciseId,
    [string] $ExerciseName = 'Freeze check',
    [string] $StaffUsername = 'controller1',
    [string] $ParticipantUsername,
    [ValidateSet('in-fiction', 'out-of-fiction')] [string] $Register = 'in-fiction',
    [ValidateRange(90, 900)] [int] $HoldSeconds = 90,
    [ValidateRange(30, 300)] [int] $NoiseWaitSeconds = 75,
    [switch] $IncludeRestart,
    [ValidateRange(1, 30)] [int] $RestartWaitMinutes = 9,
    [string] $Subscription = '2a127d53-c9bf-471a-8196-3155eae6cb1b',
    [string] $ResourceGroup = 'rg-pulse-uat-centralus',
    [string] $WebAppName = 'app-pulse-api-uat-dynamis'
)

$ErrorActionPreference = 'Stop'
$script:Fails = 0
$script:Warns = 0
$script:Base = "https://$ApiHost"
$script:FrozenMessagePattern = 'world is frozen'
$script:MinuteToleranceSeconds = 60
$script:PollSeconds = 5

# ── Seams (the Pester tests mock these) ──────────────────────────────────────────────────────────────────

function Get-Now { [DateTimeOffset]::UtcNow }

function Wait-Seconds([int] $Seconds) { if ($Seconds -gt 0) { Start-Sleep -Seconds $Seconds } }

function Read-HiddenValue([string] $Prompt) {
    $secure = Read-Host $Prompt -AsSecureString
    $value = [System.Net.NetworkCredential]::new('', $secure).Password
    $secure = $null
    return $value
}

function Invoke-AppServiceRestart {
    # Self-contained on purpose (no Common.ps1): az's stdout is discarded and only its error text is surfaced.
    $errors = az webapp restart --resource-group $ResourceGroup --name $WebAppName --subscription $Subscription --only-show-errors 2>&1 |
        Where-Object { $_ -is [System.Management.Automation.ErrorRecord] -and $_.ToString() -notmatch 'cryptography|UserWarning|32-bit Python' }
    if ($LASTEXITCODE -ne 0) { throw "az webapp restart failed: $($errors -join ' ') (check 'az login' and access to the subscription)" }
}

function Invoke-Api {
    param([string] $Method, [string] $Path, [object] $Body, [string] $Token, [switch] $Anonymous)
    $headers = @{}
    if (-not $Anonymous -and $Token) { $headers['Authorization'] = "Bearer $Token" }
    $request = @{ Method = $Method; Uri = "$script:Base$Path"; Headers = $headers; SkipHttpErrorCheck = $true; TimeoutSec = 90 }
    if ($null -ne $Body) { $request['Body'] = ($Body | ConvertTo-Json -Depth 16 -Compress); $request['ContentType'] = 'application/json' }
    $response = Invoke-WebRequest @request
    $json = $null
    if ($response.Content -and ($response.Headers['Content-Type'] -join '') -match 'json') {
        try { $json = $response.Content | ConvertFrom-Json -AsHashtable -Depth 64 } catch { $json = $null }
    }
    [pscustomobject]@{ Status = [int] $response.StatusCode; Json = $json; Content = [string] $response.Content }
}

# ── Helpers ──────────────────────────────────────────────────────────────────────────────────────────────

function Write-Check([string] $Level, [string] $Text) {
    $color = @{ PASS = 'Green'; WARN = 'Yellow'; FAIL = 'Red'; INFO = 'Gray' }[$Level]
    if ($Level -eq 'FAIL') { $script:Fails++ }
    if ($Level -eq 'WARN') { $script:Warns++ }
    Write-Host ("  {0,-4} {1}" -f $Level, $Text) -ForegroundColor $color
}

function Write-Step([string] $Text) { Write-Host "`n$Text" -ForegroundColor Cyan }

function Stop-Run([string] $Text) { Write-Check FAIL $Text; throw 'stop' }

function Get-Field($Json, [string] $Name) {
    if ($Json -is [System.Collections.IDictionary] -and $Json.Contains($Name)) { return $Json[$Name] }
    return $null
}

function ConvertTo-Instant($Value) {
    if ($null -eq $Value -or ($Value -is [string] -and [string]::IsNullOrWhiteSpace($Value))) { return $null }
    if ($Value -is [DateTimeOffset]) { return $Value }
    if ($Value -is [DateTime]) { return [DateTimeOffset] $Value }
    return [DateTimeOffset]::Parse([string] $Value, [Globalization.CultureInfo]::InvariantCulture)
}

function Format-Seconds([double] $Seconds) {
    $sign = if ($Seconds -lt 0) { '-' } else { '+' }
    return '{0}{1:N0} s' -f $sign, [math]::Abs($Seconds)
}

function Invoke-Staff([string] $Method, [string] $Path, [object] $Body) {
    Invoke-Api -Method $Method -Path $Path -Body $Body -Token $script:StaffToken
}

function Get-PauseTier {
    $r = Invoke-Staff GET '/api/steering/pause-tier'
    if ($r.Status -ne 200) { return $null }
    [pscustomobject]@{ Tier = [string] (Get-Field $r.Json 'tier'); ClockFrozen = [bool] (Get-Field $r.Json 'clockFrozen') }
}

function Set-PauseTier([string] $Tier, [string] $OverlayRegister) {
    $body = @{ tier = $Tier; actingHumanId = $script:ActingHumanId }
    if ($OverlayRegister) { $body['overlayRegister'] = $OverlayRegister }
    Invoke-Staff POST '/api/steering/pause-tier' $body
}

function Get-NoiseState {
    $r = Invoke-Staff GET '/api/staff/noise'
    if ($r.Status -ne 200) { return $null }
    [pscustomobject]@{
        Level        = [string] (Get-Field $r.Json 'level')
        PoolSize     = [int] (Get-Field $r.Json 'poolSize')
        PostedCount  = [int] (Get-Field $r.Json 'postedCount')
        LastPostedAt = ConvertTo-Instant (Get-Field $r.Json 'lastPostedAt')
        Running      = [bool] (Get-Field $r.Json 'running')
    }
}

function Get-OverlayState {
    # As the participant when that session belongs to the exercise under test, else through the staff session.
    $token = if ($script:ParticipantToken) { $script:ParticipantToken } else { $script:StaffToken }
    $r = Invoke-Api -Method GET -Path '/api/overlay-state' -Token $token
    if ($r.Status -ne 200) { return [pscustomobject]@{ Status = $r.Status; State = $null; Register = $null } }
    [pscustomobject]@{ Status = 200; State = [string] (Get-Field $r.Json 'state'); Register = [string] (Get-Field $r.Json 'register') }
}

function Test-OverlayPause([string] $When) {
    $o = Get-OverlayState
    if ($o.Status -ne 200) { Write-Check FAIL "$When`: GET /api/overlay-state -> $($o.Status) ($script:OverlayReader)"; return }
    if ($o.State -eq 'pause' -and $o.Register -eq $Register) { Write-Check PASS "$When`: overlay is pause, register $($o.Register) ($script:OverlayReader)" }
    elseif ($o.State -eq 'pause') { Write-Check FAIL "$When`: overlay is pause but register is '$($o.Register)', expected '$Register' ($script:OverlayReader)" }
    else { Write-Check FAIL "$When`: overlay is '$($o.State)', expected pause: the participant would not see the holding page ($script:OverlayReader)" }
}

function Test-OverlayNone([string] $When) {
    $o = Get-OverlayState
    if ($o.Status -eq 200 -and $o.State -eq 'none') { Write-Check PASS "$When`: overlay is back to none ($script:OverlayReader)" }
    else { Write-Check FAIL "$When`: overlay is '$($o.State)' (HTTP $($o.Status)), expected none: the holding page would stay up" }
}

function Wait-NoisePost([int] $AfterCount, [int] $TimeoutSeconds) {
    # Polls until postedCount passes $AfterCount; returns the scenario time stamped and the wall time it was seen.
    $deadline = (Get-Now).AddSeconds($TimeoutSeconds)
    while ((Get-Now) -lt $deadline) {
        Wait-Seconds $script:PollSeconds
        $n = Get-NoiseState
        if ($n -and $n.PostedCount -gt $AfterCount -and $n.LastPostedAt) {
            return [pscustomobject]@{ Scenario = $n.LastPostedAt; Wall = Get-Now; Count = $n.PostedCount }
        }
    }
    return $null
}

function Get-Anchor([string] $Label) {
    $n = Get-NoiseState
    if (-not $n) { Write-Check WARN "$Label`: GET /api/staff/noise failed; no scenario-time anchor"; return $null }
    if (-not $n.Running) { Write-Check WARN "$Label`: noise is not running (empty pool, clock not running, or not live); no scenario-time anchor"; return $null }
    $anchor = Wait-NoisePost -AfterCount $n.PostedCount -TimeoutSeconds $NoiseWaitSeconds
    if ($anchor) { Write-Check PASS "$Label`: noise post at scenario $($anchor.Scenario.ToString('u')) anchors the minute check" }
    else { Write-Check WARN "$Label`: no noise post within $NoiseWaitSeconds s; the minute check falls back to clockFrozen only" }
    return $anchor
}

function Connect-Staff([string] $ExerciseIdToEnter) {
    $login = Invoke-Api -Method POST -Path '/api/auth/staff/login' -Anonymous -Body @{ username = $StaffUsername; secret = $script:StaffSecret; exerciseId = $ExerciseIdToEnter }
    if ($login.Status -ne 200) { return $false }
    $script:StaffToken = [string] (Get-Field $login.Json 'token')
    $script:ActingHumanId = [string] (Get-Field (Get-Field $login.Json 'session') 'actingHumanId')
    return [bool] $script:StaffToken
}

function Restore-PauseTier {
    # Never leaves the exercise FROZEN: puts back the tier found at the start, whatever happened before.
    if (-not $script:OriginalTier -or -not $script:StaffToken) { return }
    $current = $null
    try { $current = Get-PauseTier } catch { $current = $null }
    if ($current -and $current.Tier -eq $script:OriginalTier) {
        Write-Check PASS "pause tier is '$($script:OriginalTier)', as found"
        return
    }
    $restored = $false
    for ($attempt = 1; $attempt -le 3 -and -not $restored; $attempt++) {
        try {
            $r = Set-PauseTier $script:OriginalTier
            $restored = $r.Status -eq 200 -and (Get-Field $r.Json 'tier') -eq $script:OriginalTier
        }
        catch { $restored = $false }
        if (-not $restored -and $attempt -lt 3) { Wait-Seconds 5 }
    }
    if ($restored) { Write-Check PASS "pause tier restored to '$($script:OriginalTier)'" }
    else { Write-Check FAIL "COULD NOT RESTORE the pause tier to '$($script:OriginalTier)': the exercise may be left FROZEN. Resume it in the console now." }
}

# ── 0. Exercise and sign-in ──────────────────────────────────────────────────────────────────────────────

$script:StaffToken = $null
$script:ParticipantToken = $null
$script:StaffSecret = $null
$script:OriginalTier = $null
$script:OverlayReader = 'staff session'
$created = @{ InjectId = $null; NoiseLevelBefore = $null; PoolLoaded = $false }
$skipFailed = $false

try {
    Write-Step "0. Exercise and sign-in ($ApiHost)"
    $ctx = Invoke-Api -Method GET -Path '/api/exercise-context' -Anonymous
    if ($ctx.Status -ne 200) { Stop-Run "/api/exercise-context -> $($ctx.Status)" }
    $demoExerciseId = [string] (Get-Field $ctx.Json 'exerciseId')
    Write-Check INFO "demo exercise (bound to $ApiHost): '$(Get-Field $ctx.Json 'exerciseName')' ($demoExerciseId)"

    $explicit = $PSBoundParameters.ContainsKey('ExerciseId') -and -not [string]::IsNullOrWhiteSpace($ExerciseId)

    $script:StaffSecret = $env:PULSE_STAFF_SECRET
    if (-not $script:StaffSecret) { $script:StaffSecret = Read-HiddenValue "Staff secret for '$StaffUsername' (hidden)" }
    if ([string]::IsNullOrWhiteSpace($script:StaffSecret)) { Stop-Run 'No staff secret given. Nothing was sent.' }

    $signInExercise = if ($explicit) { $ExerciseId } else { $demoExerciseId }
    if (-not (Connect-Staff $signInExercise)) { Stop-Run "staff sign-in as $StaffUsername failed (wrong secret, or not assigned to $signInExercise)" }
    Write-Check PASS "signed in as $StaffUsername"

    if ($explicit) {
        $targetExerciseId = $ExerciseId
        if ($targetExerciseId -eq $demoExerciseId) { Write-Check WARN 'running against the DEMO exercise, because -ExerciseId names it' }
    }
    else {
        $assignments = Invoke-Staff GET '/api/staff/assignments'
        if ($assignments.Status -ne 200) { Stop-Run "GET /api/staff/assignments -> $($assignments.Status)" }
        $found = @($assignments.Json | Where-Object { [string] $_['exerciseName'] -ieq $ExerciseName })
        if ($found.Count -eq 0) {
            Stop-Run ("no exercise named '$ExerciseName' is assigned to $StaffUsername. Create a throwaway exercise with " +
                "that name in the console, assign $StaffUsername as controller and take it Live, or pass -ExerciseId.")
        }
        if ($found.Count -gt 1) { Stop-Run "$($found.Count) exercises are named '$ExerciseName'; pass -ExerciseId to pick one" }
        $targetExerciseId = [string] $found[0]['exerciseId']
        if ($targetExerciseId -eq $demoExerciseId) {
            Stop-Run "'$ExerciseName' is the demo exercise (bound to $ApiHost). Refusing: pass -ExerciseId explicitly to run against it."
        }
        $switch = Invoke-Staff POST '/api/staff/active-exercise' @{ exerciseId = $targetExerciseId }
        if ($switch.Status -ne 200) { Stop-Run "switching the staff session to '$ExerciseName' -> $($switch.Status)" }
    }
    $session = Invoke-Staff GET '/api/session'
    $sessionExercise = [string] (Get-Field $session.Json 'exerciseId')
    if ($session.Status -ne 200 -or $sessionExercise -ne $targetExerciseId) {
        Stop-Run "the staff session is on exercise '$sessionExercise', not $targetExerciseId (GET /api/session -> $($session.Status))"
    }
    Write-Check PASS "exercise under test: $targetExerciseId"

    $lifecycle = Invoke-Staff GET '/api/staff/exercise-lifecycle'
    if ($lifecycle.Status -eq 200) {
        $state = [string] (Get-Field $lifecycle.Json 'state')
        if ($state -ne 'live') { Stop-Run "the exercise is '$state', not live: Freeze is refused outside a running world. Take it Live first." }
        Write-Check PASS 'exercise is live'
    }
    else { Write-Check WARN "GET /api/staff/exercise-lifecycle -> $($lifecycle.Status); continuing (a Freeze outside live answers 409)" }

    $tier = Get-PauseTier
    if (-not $tier) { Stop-Run 'GET /api/steering/pause-tier failed' }
    if ($tier.Tier -eq 'freeze') { Stop-Run 'the exercise is already FROZEN. Resume it in the console first; nothing was changed.' }
    $script:OriginalTier = $tier.Tier
    Write-Check PASS "pause tier found: '$($script:OriginalTier)' (it is put back at the end)"

    if ($ParticipantUsername) {
        $password = $env:PULSE_PARTICIPANT_PASSWORD
        if (-not $password) { $password = Read-HiddenValue "Password for participant '$ParticipantUsername' (hidden)" }
        $p = Invoke-Api -Method POST -Path '/api/auth/login' -Anonymous -Body @{ username = $ParticipantUsername; password = $password }
        $password = $null
        if ($p.Status -ne 200) { Write-Check WARN "participant sign-in -> $($p.Status); reading the overlay through the staff session" }
        else {
            $token = [string] (Get-Field $p.Json 'token')
            $pExercise = [string] (Get-Field (Get-Field $p.Json 'session') 'exerciseId')
            if ($pExercise -eq $targetExerciseId) {
                $script:ParticipantToken = $token
                $script:OverlayReader = "participant $ParticipantUsername"
                Write-Check PASS "participant $ParticipantUsername signed in; the overlay is read as them"
            }
            else {
                Invoke-Api -Method POST -Path '/api/auth/logout' -Token $token | Out-Null
                Write-Check WARN "participant sessions are host-bound: $ParticipantUsername is on $pExercise, not the exercise under test; reading the overlay through the staff session"
            }
            $token = $null
        }
    }
    else { Write-Check WARN 'no -ParticipantUsername: the overlay is read through the staff session (same projection as the participant read)' }

    # ── 1. Freeze ────────────────────────────────────────────────────────────────────────────────────────
    Write-Step "1. Freeze ($Register)"
    $noise = Get-NoiseState
    if (-not $noise) { Stop-Run 'GET /api/staff/noise failed' }
    $created.NoiseLevelBefore = $noise.Level
    $personas = Invoke-Staff GET '/api/personas'
    $persona = @($personas.Json | Where-Object { $_['id'] -and $_['handle'] } | Select-Object -First 1)[0]
    if (-not $persona) { Stop-Run 'no persona found on GET /api/personas (needed for the test inject and noise pool)' }
    if ($noise.PoolSize -eq 0) {
        $pool = @{ mode = 'replace'; posts = @(1..3 | ForEach-Object { @{ persona = $persona['handle']; text = "[freeze check] background chatter $_" } }) }
        $r = Invoke-Staff PUT '/api/staff/noise/pool' $pool
        if ($r.Status -eq 200) { $created.PoolLoaded = $true; Write-Check PASS 'loaded a 3-post [freeze check] noise pool (cleared at the end)' }
        else { Write-Check WARN "loading a noise pool -> $($r.Status); the noise checks may be inconclusive" }
    }
    $r = Invoke-Staff PUT '/api/staff/noise' @{ level = 'low' }
    if ($r.Status -eq 200) { Write-Check PASS "noise set to Low (was '$($created.NoiseLevelBefore)')" } else { Write-Check WARN "setting noise to Low -> $($r.Status)" }
    $anchor = Get-Anchor 'before Freeze'

    # The fire probe: a skipped item, so even a fire that Freeze failed to refuse publishes nothing.
    $item = Invoke-Staff POST '/api/injects' @{
        kind = 'post'; title = '[freeze check] fire refusal probe'; notes = 'Created and deleted by Test-FreezeResume.ps1'
        posts = @(@{ personaId = [string] $persona['id']; text = '[freeze check] this post must never publish' })
    }
    if ($item.Status -eq 201) {
        $created.InjectId = [string] (Get-Field $item.Json 'id')
        $skip = Invoke-Staff POST "/api/injects/$($created.InjectId)/skip"
        if ($skip.Status -eq 200) { Write-Check PASS 'test inject created and skipped (it cannot publish)' }
        else { Write-Check WARN "skipping the test inject -> $($skip.Status); the fire probe is skipped"; $skipFailed = $true }
    }
    else { Write-Check WARN "creating the test inject -> $($item.Status); the fire probe is skipped" }

    $frozeAt = Get-Now
    $freeze = Set-PauseTier 'freeze' $Register
    if ($freeze.Status -eq 409) { Stop-Run "Freeze refused (409): $(Get-Field $freeze.Json 'reason')" }
    if ($freeze.Status -ne 200) { Stop-Run "Freeze -> $($freeze.Status) $($freeze.Content)" }
    if ((Get-Field $freeze.Json 'tier') -eq 'freeze' -and (Get-Field $freeze.Json 'clockFrozen')) { Write-Check PASS 'Freeze applied: tier freeze, clockFrozen true' }
    else { Write-Check FAIL "Freeze answered tier '$(Get-Field $freeze.Json 'tier')', clockFrozen $(Get-Field $freeze.Json 'clockFrozen')" }
    Test-OverlayPause 'after Freeze'

    # ── 2. Hold ──────────────────────────────────────────────────────────────────────────────────────────
    Write-Step "2. Hold the Freeze for $HoldSeconds s"
    $noiseAtFreeze = Get-NoiseState
    $tierBreaks = [System.Collections.Generic.List[string]]::new()
    $noiseBreaks = [System.Collections.Generic.List[string]]::new()
    $minuteBreaks = [System.Collections.Generic.List[string]]::new()
    $fired = $false
    $holdUntil = $frozeAt.AddSeconds($HoldSeconds)
    while ((Get-Now) -lt $holdUntil) {
        Wait-Seconds ([math]::Min(15, [math]::Max(1, [int] ($holdUntil - (Get-Now)).TotalSeconds)))
        $t = Get-PauseTier
        if (-not $t -or $t.Tier -ne 'freeze' -or -not $t.ClockFrozen) { $tierBreaks.Add("tier '$($t.Tier)', clockFrozen $($t.ClockFrozen)") }
        $n = Get-NoiseState
        if ($n -and $noiseAtFreeze) {
            if ($n.PostedCount -ne $noiseAtFreeze.PostedCount) { $noiseBreaks.Add("postedCount $($noiseAtFreeze.PostedCount) -> $($n.PostedCount)") }
            if ($n.Running) { $noiseBreaks.Add('running true') }
            if ("$($n.LastPostedAt)" -ne "$($noiseAtFreeze.LastPostedAt)") { $minuteBreaks.Add("lastPostedAt $($noiseAtFreeze.LastPostedAt) -> $($n.LastPostedAt)") }
        }
        if (-not $fired -and $created.InjectId -and -not $skipFailed -and ((Get-Now) - $frozeAt).TotalSeconds -ge ($HoldSeconds / 2)) {
            $fired = $true
            $fire = Invoke-Staff POST "/api/injects/$($created.InjectId)/fire"
            $detail = [string] (Get-Field $fire.Json 'detail')
            if ($fire.Status -eq 409 -and $detail -match $script:FrozenMessagePattern) { Write-Check PASS "inject fire refused while frozen: '$detail'" }
            elseif ($fire.Status -eq 409) { Write-Check FAIL "inject fire was refused, but not for Freeze: '$detail'" }
            else { Write-Check FAIL "inject fire was NOT refused while frozen -> $($fire.Status)" }
        }
    }
    if ($tierBreaks.Count -eq 0) { Write-Check PASS "tier stayed freeze with clockFrozen true for $HoldSeconds s" }
    else { Write-Check FAIL "the Freeze did not hold: $($tierBreaks | Select-Object -Unique | Join-String -Separator '; ')" }
    if (-not $noiseAtFreeze) { Write-Check WARN 'noise state unreadable; noise and minute checks skipped' }
    else {
        if ($noiseBreaks.Count -eq 0) { Write-Check PASS "no noise post while frozen (postedCount stayed $($noiseAtFreeze.PostedCount), running false)" }
        else { Write-Check FAIL "noise kept going while frozen: $($noiseBreaks | Select-Object -Unique | Join-String -Separator '; ')" }
        if ($minuteBreaks.Count -eq 0) { Write-Check PASS 'scenario clock did not move while frozen (latest noise stamp unchanged)' }
        else { Write-Check FAIL "scenario minute moved while frozen: $($minuteBreaks | Select-Object -Unique | Join-String -Separator '; ')" }
    }
    if (-not $fired) { Write-Check WARN 'inject fire probe not run (no test inject)' }
    Test-OverlayPause 'end of hold'

    # ── 3. Resume ────────────────────────────────────────────────────────────────────────────────────────
    Write-Step "3. Resume to '$($script:OriginalTier)'"
    $resumedAt = Get-Now
    $resume = Set-PauseTier $script:OriginalTier
    if ($resume.Status -eq 200 -and (Get-Field $resume.Json 'tier') -eq $script:OriginalTier -and -not (Get-Field $resume.Json 'clockFrozen')) {
        Write-Check PASS "resumed: tier '$($script:OriginalTier)', clockFrozen false"
    }
    else { Write-Check FAIL "Resume -> $($resume.Status), tier '$(Get-Field $resume.Json 'tier')', clockFrozen $(Get-Field $resume.Json 'clockFrozen')" }
    Test-OverlayNone 'after Resume'

    $afterCount = if ($noiseAtFreeze) { $noiseAtFreeze.PostedCount } else { 0 }
    $next = Wait-NoisePost -AfterCount $afterCount -TimeoutSeconds $NoiseWaitSeconds
    if (-not $next) { Write-Check WARN "no noise post within $NoiseWaitSeconds s of Resume; minute continuity not measured" }
    elseif (-not $anchor) { Write-Check WARN "noise resumed (post at scenario $($next.Scenario.ToString('u'))), but there is no pre-Freeze anchor to compare with" }
    else {
        # Running time only: anchor -> Freeze, and Resume -> the post. The hold itself must add nothing.
        $runningSeconds = ($frozeAt - $anchor.Wall).TotalSeconds + ($next.Wall - $resumedAt).TotalSeconds
        $drift = ($next.Scenario - $anchor.Scenario).TotalSeconds - $runningSeconds
        if ([math]::Abs($drift) -le $script:MinuteToleranceSeconds) {
            Write-Check PASS "scenario time continued from the frozen minute (drift $(Format-Seconds $drift), tolerance 1 min)"
        }
        else { Write-Check FAIL "scenario minute moved across the Freeze: drift $(Format-Seconds $drift) after a $HoldSeconds s hold (expected within 1 min)" }
    }

    # ── 4. Restart (opt-in) ──────────────────────────────────────────────────────────────────────────────
    if ($IncludeRestart) {
        Write-Step '4. Freeze survives an App Service restart (needs demo-feedback/18)'
        $freeze2 = Set-PauseTier 'freeze' $Register
        if ($freeze2.Status -ne 200 -or (Get-Field $freeze2.Json 'tier') -ne 'freeze') { Stop-Run "second Freeze -> $($freeze2.Status) $($freeze2.Content)" }
        Write-Check PASS 'frozen again'
        $noiseFrozen = Get-NoiseState
        Invoke-AppServiceRestart
        Write-Check PASS "restart requested for $WebAppName"

        $cleared = $null
        $healthOk = $false
        $deadline = (Get-Now).AddMinutes($RestartWaitMinutes)
        while ((Get-Now) -lt $deadline) {
            Wait-Seconds 20
            $health = Invoke-Api -Method GET -Path '/health' -Anonymous
            $healthOk = $health.Status -eq 200
            if (-not $healthOk) { continue }
            $t = Get-PauseTier
            if (-not $t) {
                # A lost session would hide the tier; sign in again once and carry on.
                if (Connect-Staff $targetExerciseId) { $t = Get-PauseTier }
            }
            if ($t -and $t.Tier -ne 'freeze') { $cleared = $t.Tier; break }
        }
        if ($cleared) {
            Write-Check FAIL "the restart cleared Freeze (tier now '$cleared'): expected until demo-feedback/18 is deployed"
        }
        else {
            if ($healthOk) { Write-Check PASS '/health -> 200 after the restart' } else { Write-Check FAIL "/health is not 200 after $RestartWaitMinutes min" }
            $t = Get-PauseTier
            if ($t -and $t.Tier -eq 'freeze' -and $t.ClockFrozen) {
                Write-Check PASS "Freeze held for $RestartWaitMinutes min after the restart (tier freeze, clockFrozen true)"
                Write-Check INFO 'persistence is inferred from the full wait window, which outlasts the ~6-minute process handover'
            }
            else { Write-Check FAIL "after the restart: tier '$($t.Tier)', clockFrozen $($t.ClockFrozen)" }
            Test-OverlayPause 'after the restart'
            $n = Get-NoiseState
            if ($n -and $noiseFrozen) {
                if ($n.PostedCount -eq $noiseFrozen.PostedCount -and "$($n.LastPostedAt)" -eq "$($noiseFrozen.LastPostedAt)") {
                    Write-Check PASS 'scenario clock unchanged across the restart (no noise post, latest stamp unchanged)'
                }
                else { Write-Check FAIL "scenario clock moved across the restart: postedCount $($noiseFrozen.PostedCount) -> $($n.PostedCount), lastPostedAt $($noiseFrozen.LastPostedAt) -> $($n.LastPostedAt)" }
            }
            else { Write-Check WARN 'noise state unreadable; minute-after-restart check skipped' }
        }
        $resume2 = Set-PauseTier $script:OriginalTier
        if ($resume2.Status -eq 200) { Write-Check PASS "resumed to '$($script:OriginalTier)'" } else { Write-Check FAIL "Resume after the restart -> $($resume2.Status)" }
        Test-OverlayNone 'after the restart Resume'
    }
}
catch {
    if ($_.ToString() -ne 'stop') { Write-Check FAIL "unexpected: $($_.Exception.Message)" }
}
finally {
    Write-Step '5. Clean up'
    try { Restore-PauseTier } catch { Write-Check FAIL "restoring the pause tier threw: $($_.Exception.Message). Check the console: the exercise may be FROZEN." }
    if ($created.InjectId) {
        try {
            $queue = Invoke-Staff GET '/api/injects'
            $current = @(Get-Field $queue.Json 'items' | Where-Object { $_['id'] -eq $created.InjectId }) | Select-Object -First 1
            $version = if ($current) { $current['version'] } else { $null }
            $r = Invoke-Staff DELETE "/api/injects/$($created.InjectId)?version=$version"
            Write-Check ($(if ($r.Status -in 200, 204) { 'PASS' } else { 'WARN' })) "test inject deleted -> $($r.Status)"
        }
        catch { Write-Check WARN "deleting the test inject threw: $($_.Exception.Message)" }
    }
    if ($created.NoiseLevelBefore) {
        try {
            $r = Invoke-Staff PUT '/api/staff/noise' @{ level = $created.NoiseLevelBefore }
            Write-Check ($(if ($r.Status -eq 200) { 'PASS' } else { 'WARN' })) "noise level restored to '$($created.NoiseLevelBefore)' -> $($r.Status)"
        }
        catch { Write-Check WARN "restoring the noise level threw: $($_.Exception.Message)" }
    }
    if ($created.PoolLoaded) {
        try {
            $r = Invoke-Staff PUT '/api/staff/noise/pool' @{ mode = 'replace'; posts = @() }
            Write-Check ($(if ($r.Status -eq 200) { 'PASS' } else { 'WARN' })) "test noise pool cleared -> $($r.Status)"
        }
        catch { Write-Check WARN "clearing the test pool threw: $($_.Exception.Message)" }
    }
    foreach ($token in @($script:ParticipantToken, $script:StaffToken)) {
        if ($token) { try { Invoke-Api -Method POST -Path '/api/auth/logout' -Token $token | Out-Null } catch { } }
    }
    $script:StaffToken = $null
    $script:ParticipantToken = $null
    $script:StaffSecret = $null
    Write-Host ("`nDone: {0} failed, {1} warnings." -f $script:Fails, $script:Warns) -ForegroundColor ($(if ($script:Fails) { 'Red' } elseif ($script:Warns) { 'Yellow' } else { 'Green' }))
}
exit ([int] [bool] $script:Fails)
