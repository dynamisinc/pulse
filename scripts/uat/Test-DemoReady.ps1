#Requires -Version 7.0

<#
.SYNOPSIS
    Demo pre-flight: a read-only yes/no on whether Pulse UAT is ready for the show (story 26, #544).

.DESCRIPTION
    Signs in as a staff controller the way Import-Roster.ps1 does, runs eleven checks, signs out, and prints PASS /
    WARN / FAIL (or SKIP, with the reason) per check, each with the value it expected. It exits 1 on any FAIL and 0
    otherwise. It writes nothing to Pulse: every request is a GET, apart from the sign-in and the sign-out.

      1. API health and schema. /health, then /health/ready (the first call wakes serverless SQL, which auto-pauses
         after 60 minutes; the wake time is reported), then /api/exercise-context (200 means the deployed code and
         the database schema agree). Wave 4: the API does not expose applied migrations, so the
         DemoFeedbackWave4RuntimeAndEdits migration (story 17) is read from its contract: GET
         /api/steering/pause-tier carries `persisted` once 17 is deployed. WARN until then.
      2. Pause tier (GET /api/steering/pause-tier) is `engine` (DF-38). FAIL on `running` or `injects`; FAIL on
         `freeze`: never leave FROZEN.
      3. Engine review queue (GET /api/engine/review-queue): 0 pending drafts (queued, counting down or held).
         WARN on 1 to 5, FAIL on more.
      4. Generation provider (GET /api/engine/settings): the effective provider is Fake (DF-38).
      5. White noise (GET /api/staff/noise) is `off`, and media marking (GET /api/staff/chrome-settings,
         `watermarkEnabled`) is on. Noise posts newer than the seed anchor cannot be flagged: GET /api/feed has no
         origin field, so that line is a SKIP that reports the noise post count and the last one's scenario time.
      6. The pack's exercise pins (p09 and p10) are pinned for everyone (GET /api/feed/pinned, as staff), matched
         by the pack post's text.
      7. Run sheet (GET /api/injects): every seeded item (a pack item without an msel ref) is there and pending,
         and nothing an MSEL import created is, so the on-stage import shows its rows (DF-16). The API does not
         expose an item's Inject # (ExternalRef), so the check goes by title: a pending or held item whose title
         is not a seeded pack item's FAILS (an import, a seeded copy of an msel item, or a console item), and a
         spent one WARNS (if an import created it, Clear-DemoContent.ps1 archives it).
      8. Media: one image and one video from the feed (a pack item, matched by its alt text or file name, when
         there is one; otherwise any) answer a ranged GET with 200 or 206 and an image/* or
         video/* content type (the SAS links are reachable). Sent without the session token. The links themselves
         are never printed: they carry a SAS signature.
      9. Scenario clock. No API route reads the server's scenario clock, and the participant app's scenario "now"
         is the browser's wall clock (README-seed.md, "Why Tuesday"). So this check reads the seed's anchor from
         the feed (a pack post's scenarioTime plus its minutesBeforeAnchor) and reports the scenario minute now
         falls on: inside the pack's window is 0 to 720 minutes after the anchor (Trending counts 12 hours). WARN
         otherwise, or when the server says its clock is frozen.
     10. Wave 3 and 4 routes answer (not 404): GET /api/feed/pinned, and GET /api/posts/{a seeded post}/edits. A
         404 on the edits route is a WARN until Wave 4 (story 19) is deployed.
     11. Exercise lifecycle (GET /api/staff/exercise-lifecycle, for the signed-in exercise): `live` PASS; `staged`
         WARN (participants see the pre-start page until StartEx; the demo may start staged); anything else FAIL.

    SECRETS. The staff secret comes from $env:PULSE_STAFF_SECRET if set, otherwise from the API's App Service
    settings through YOUR az login (as Import-Roster.ps1 and Copy-StaffSecret.ps1 do). The secret and the session
    token stay in memory. They are never printed, logged or written to the -Json file, and the web cmdlet's own
    verbose and debug output is switched off.

.PARAMETER ExerciseId
    The exercise to sign in to. Default: the exercise bound to -ApiHost (GET /api/exercise-context), as the other
    UAT scripts resolve it.

.PARAMETER ApiHost
    The API's host name, which the exercise is bound to (not the participant site). An https URL is accepted and
    reduced to its host; http:// and an explicit port are refused (https on 443 only).

.PARAMETER SiteUrl
    The participant site, printed at the end.

.PARAMETER StaffUsername
    The staff login to read as: a controller or planner assigned to the exercise.

.PARAMETER PackPath
    The demo pack the pins, run sheet and anchor checks compare against. Default: docs/demo/pack/pack.json.

.PARAMETER Json
    Also write the results as JSON for the run-of-show log: to -JsonPath, or by default to
    scripts/uat/logs/demo-ready-<yyyyMMdd-HHmmss>.json (git-ignored). It holds no secret, token or media link.

.PARAMETER JsonPath
    Where -Json writes.

.EXAMPLE
    pwsh scripts/uat/Test-DemoReady.ps1

.EXAMPLE
    pwsh scripts/uat/Test-DemoReady.ps1 -Json

.EXAMPLE
    $env:PULSE_STAFF_SECRET = Get-Clipboard; pwsh scripts/uat/Test-DemoReady.ps1; $env:PULSE_STAFF_SECRET = $null
#>
[CmdletBinding()]
param(
    [string] $ExerciseId,

    # UAT defaults, the same as the other UAT scripts. The exercise is bound to the API's own host, not to
    # pulse-uat.cobrasoftware.com (docs/features/login/06-uat-goLive-config-runbook.md, step 4).
    [ValidateNotNullOrEmpty()] [string] $ApiHost = 'app-pulse-api-uat-dynamis.azurewebsites.net',
    [string] $SiteUrl = 'https://pulse-uat.cobrasoftware.com',
    [ValidateNotNullOrEmpty()] [string] $StaffUsername = 'controller1',
    [string] $PackPath = (Join-Path $PSScriptRoot '../../docs/demo/pack/pack.json'),
    [switch] $Json,
    [string] $JsonPath,
    [string] $Subscription = '2a127d53-c9bf-471a-8196-3155eae6cb1b',
    [string] $ResourceGroup = 'rg-pulse-uat-centralus',
    [string] $WebAppName = 'app-pulse-api-uat-dynamis'
)

$ErrorActionPreference = 'Stop'
$PSDefaultParameterValues = @{}
. "$PSScriptRoot/Common.ps1"

# The review-queue dispositions that are still pending (EngineReviewItemDto.disposition).
$script:PendingDispositions = @('queued', 'counting-down', 'held')
# Run-sheet statuses (InjectItemDto.status). Armable: the console can still fire it.
$script:ArmableStatuses = @('pending', 'held')
$script:SpentStatuses = @('fired', 'skipped', 'failed')
# The pack's window after its anchor, in scenario minutes: Trending counts the last 12 hours.
$script:WindowMinutes = 720

# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# Results
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

$script:ReadyResults = [System.Collections.Generic.List[object]]::new()

function Add-ReadyResult {
    param(
        [Parameter(Mandatory)] [string] $Number,
        [Parameter(Mandatory)] [string] $Check,
        [Parameter(Mandatory)] [ValidateSet('PASS', 'WARN', 'FAIL', 'SKIP')] [string] $Status,
        [Parameter(Mandatory)] [string] $Detail
    )
    $script:ReadyResults.Add([pscustomobject][ordered]@{ number = $Number; check = $Check; status = $Status; detail = $Detail })
    $color = @{ PASS = 'Green'; WARN = 'Yellow'; FAIL = 'Red'; SKIP = 'DarkGray' }[$Status]
    Write-Host ('  [{0}] {1}. {2} — {3}' -f $Status, $Number, $Check, $Detail) -ForegroundColor $color
}

function Get-PrintableText {
    <# Server text made safe for the console: control and format characters removed, cut to -Max characters. #>
    param([AllowNull()] [object] $Value, [int] $Max = 0)
    $text = ([string] $Value) -replace '[\t\r\n]', ' ' -replace '[\p{Cc}\p{Cf}]', ''
    if ($Max -gt 1 -and $text.Length -gt $Max) { $text = $text.Substring(0, $Max - 1) + '…' }
    return $text
}

function ConvertTo-Instant {
    <# An ISO-8601 instant from the API (ConvertFrom-Json may already have made it a DateTime), or $null. #>
    param([AllowNull()] [object] $Value)
    if ($Value -is [DateTimeOffset]) { return $Value }
    if ($Value -is [datetime]) { return [DateTimeOffset] $Value }
    $parsed = [DateTimeOffset]::MinValue
    if ([DateTimeOffset]::TryParse([string] $Value, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal, [ref] $parsed)) { return $parsed }
    return $null
}

function Get-JsonList {
    <#
    .SYNOPSIS
        The elements of a JSON array, one per pipeline item; nothing for an empty or missing one. Wrap the call in
        @(). ConvertFrom-Json turns [] into $null and a one-element array into its element, so @($json) alone
        would count a $null.
    #>
    param([AllowNull()] [object] $Value)
    if ($null -eq $Value) { return }
    foreach ($element in @($Value)) { if ($null -ne $element) { $element } }
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# HTTP (as Import-Roster.ps1): no redirects followed, the web cmdlet's verbose and debug streams off, the body
# bytes wiped after sending, and the error records a failed request leaves in $Error removed (their
# HttpRequestMessage holds the Authorization header).
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

function Resolve-ApiHost {
    <#
    .SYNOPSIS
        Normalizes -ApiHost ONCE, before any network call: a bare host name, or an http(s) URL whose scheme, trailing
        slash, path and query are dropped. Returns @{ Host (the bare host, with a port only when not the default);
        BaseUrl (the origin this script calls) }. Only the bare host is passed to other scripts: Reset-DemoState.ps1
        prepends https:// itself, and Clear-DemoContent.ps1 looks the exercise up by host name. Anything else (another
        scheme, a user name or password, characters a host name cannot hold) is refused with a clear error. So are
        any http:// (localhost included) and any explicit port: the UAT scripts all target https on 443
        (Reset-DemoState.ps1 always uses https://, and Clear-DemoContent.ps1 matches Exercises.Hostname, which
        holds no port), so a value they would read differently is refused rather than half-run.
    #>
    param([AllowNull()] [AllowEmptyString()] [string] $ApiHost)
    $value = ([string] $ApiHost).Trim()
    $hint = "Use the API's host name, e.g. app-pulse-api-uat-dynamis.azurewebsites.net (an https:// URL is accepted too). Nothing was sent."
    if (-not $value) { throw "-ApiHost is empty. $hint" }
    if ($value -notmatch '^[A-Za-z][A-Za-z0-9+.-]*://') { $value = "https://$value" }
    $uri = $null
    if (-not [Uri]::TryCreate($value, [UriKind]::Absolute, [ref] $uri) -or $uri.Scheme -notin 'https', 'http' -or
        $uri.UserInfo -or $uri.HostNameType -notin 'Dns', 'IPv4' -or $uri.Host -notmatch '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$') {
        throw "-ApiHost '$ApiHost' is not a host name or an http(s) URL. $hint"
    }
    if ($uri.Scheme -ne 'https') {
        throw "-ApiHost '$ApiHost' uses plain http: the UAT scripts use https only (localhost included; the staff secret and the session token must not travel in the clear). Nothing was sent."
    }
    # An explicit port, even :443: the authority as typed (before any path, query or fragment) ends in :digits.
    if ($value -match '^[A-Za-z][A-Za-z0-9+.-]*://[^/?#]*:\d*(?:[/?#]|$)') {
        throw "-ApiHost '$ApiHost' names a port: the UAT scripts use https on 443 only (Clear-DemoContent.ps1 looks the exercise up by a host name without a port). Nothing was sent."
    }
    return [pscustomobject]@{ Host = $uri.Host.ToLowerInvariant(); BaseUrl = 'https://' + $uri.Host.ToLowerInvariant() }
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
    <#
    .SYNOPSIS
        One request to the API. Returns @{ Status; Json; Text; ContentType }. Throws a readable error when no
        response arrives or the host answers with a redirect.
    #>
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

function Wait-ApiStatus {
    <# Polls an anonymous route until it answers one of -Accept; returns the last status (0: no answer). #>
    param([string] $BaseUrl, [string] $Path, [int[]] $Accept = @(200), [int] $Attempts = 12, [int] $DelaySeconds = 10)
    $code = 0
    for ($i = 1; $i -le $Attempts; $i++) {
        try { $code = (Invoke-PulseApi -BaseUrl $BaseUrl -Method GET -Path $Path -TimeoutSec 90).Status }
        catch { $code = 0 }
        if ($Accept -contains $code) { return $code }
        if ($i -lt $Attempts) {
            Write-Host "    $Path -> $code (attempt $i/$Attempts), retrying in ${DelaySeconds}s…" -ForegroundColor DarkGray
            Start-Sleep -Seconds $DelaySeconds
        }
    }
    return $code
}

function Invoke-MediaProbe {
    <#
    .SYNOPSIS
        A ranged GET (bytes=0-1) of one media link, WITHOUT the session token. Returns @{ Status; ContentType }.
        The link is never printed or put in an error: it carries a SAS signature.
    #>
    param([Parameter(Mandatory)] [string] $Url)
    try {
        $response = Invoke-WebRequest -Uri $Url -Method GET -Headers @{ Range = 'bytes=0-1' } -TimeoutSec 60 `
            -SkipHttpErrorCheck -MaximumRedirection 0 -Debug:$false -Verbose:$false -ErrorAction Stop
        $type = [string] (@($response.Headers['Content-Type']) -join '')
        return [pscustomobject]@{ Status = [int] $response.StatusCode; ContentType = $type }
    }
    catch {
        Clear-WebErrorRecord -Exceptions @($_.Exception)
        return [pscustomobject]@{ Status = 0; ContentType = '' }
    }
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# Staff session (as Import-Roster.ps1: Get-StaffSecret, Connect-StaffSession, Disconnect-StaffSession)
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

function Get-StaffSecret {
    <#
    .SYNOPSIS
        The staff secret: $env:PULSE_STAFF_SECRET, otherwise the App Service setting through the caller's az login.
        It reads the usernames first and then only the one secret it needs. Never printed.
    #>
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
    <# POST /api/auth/staff/login { username, secret, exerciseId }; returns the session token. #>
    param([Parameter(Mandatory)] [string] $BaseUrl, [Parameter(Mandatory)] [string] $StaffUsername, [Parameter(Mandatory)] [string] $Secret, [Parameter(Mandatory)] [string] $ExerciseId)
    $body = [ordered]@{ username = $StaffUsername; secret = $Secret; exerciseId = $ExerciseId }
    try { $response = Invoke-PulseApi -BaseUrl $BaseUrl -Method POST -Path '/api/auth/staff/login' -Body $body }
    finally { $body['secret'] = $null }
    if ($response.Status -eq 200 -and $response.Json -is [System.Collections.IDictionary] -and $response.Json['token']) {
        $token = [string] $response.Json['token']
        $response.Json.Clear()
        return $token
    }
    switch ($response.Status) {
        401 { throw "Sign-in was refused (401): '$StaffUsername' or its secret was rejected. Check -StaffUsername and PULSE_STAFF_SECRET (or the App Service setting)." }
        403 { throw "Sign-in was refused (403): '$StaffUsername' is not assigned to exercise $ExerciseId." }
        429 { throw 'Sign-in was refused (429): too many sign-in attempts (10 a minute). Wait a minute and run again.' }
        default { throw "Sign-in failed ($($response.Status))." }
    }
}

function Disconnect-StaffSession {
    <# POST /api/auth/logout. Never throws: a failed sign-out only warns (the session then expires on its own). #>
    param([Parameter(Mandatory)] [string] $BaseUrl, [AllowNull()] [AllowEmptyString()] [string] $Token)
    if (-not $Token) { return }
    try {
        $response = Invoke-PulseApi -BaseUrl $BaseUrl -Method POST -Path '/api/auth/logout' -Token $Token -TimeoutSec 30
        if ($response.Status -ge 200 -and $response.Status -lt 300) { Write-Host 'Signed out.' -ForegroundColor DarkGray }
        else { Write-Warning "Sign-out answered $($response.Status); the staff session will expire on its own." }
    }
    catch { Write-Warning "Sign-out failed ($($_.Exception.Message)); the staff session will expire on its own." }
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# Checks
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

function Test-HealthAndSchema {
    <# Check 1 (health, wake time, schema). Returns the host's exercise @{ Id; Name }, or $null when the API is not up. #>
    param([Parameter(Mandatory)] [string] $BaseUrl)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $health = Wait-ApiStatus -BaseUrl $BaseUrl -Path '/health' -Attempts 12 -DelaySeconds 10
    if ($health -ne 200) { Add-ReadyResult 1 'API health' FAIL "expected /health 200; got $health. The App Service is down or still starting"; return $null }
    $ready = Wait-ApiStatus -BaseUrl $BaseUrl -Path '/health/ready' -Attempts 12 -DelaySeconds 10
    $wake = [math]::Round($watch.Elapsed.TotalSeconds)
    if ($ready -ne 200) { Add-ReadyResult 1 'API health' FAIL "expected /health/ready 200; got $ready after $wake s. Serverless SQL may still be resuming: run again in a minute"; return $null }
    Add-ReadyResult 1 'API health' PASS "expected /health and /health/ready 200; got both, the database answering after $wake s (the first call wakes serverless SQL, which auto-pauses after 60 min)"

    $context = $null
    try { $context = Invoke-PulseApi -BaseUrl $BaseUrl -Method GET -Path '/api/exercise-context' }
    catch { Add-ReadyResult 1 'Schema matches code' FAIL $_.Exception.Message; return $null }
    $id = [guid]::Empty
    if ($context.Status -eq 200 -and $context.Json -is [System.Collections.IDictionary] -and [guid]::TryParse([string] $context.Json['exerciseId'], [ref] $id)) {
        $name = Get-PrintableText $context.Json['exerciseName'] -Max 80
        Add-ReadyResult 1 'Schema matches code' PASS "expected /api/exercise-context 200; got 200, exercise '$name' ($id), status $(Get-PrintableText $context.Json['status'] -Max 20)"
        return [pscustomobject]@{ Id = $id.ToString('D'); Name = $name }
    }
    if ($context.Status -eq 404) { Add-ReadyResult 1 'Schema matches code' FAIL "expected /api/exercise-context 200; got 404: no exercise is bound to $BaseUrl (runbook step 4)"; return $null }
    Add-ReadyResult 1 'Schema matches code' FAIL "expected /api/exercise-context 200; got $($context.Status): the deployed code and the database disagree (check the last Deploy Backend run's migration step)"
    return $null
}

function Test-Wave4Schema {
    <# Check 1, Wave 4: the migration is not readable through the API; story 17's contract field `persisted` is. #>
    param([AllowNull()] [object] $TierState)
    if ($TierState -isnot [System.Collections.IDictionary]) { Add-ReadyResult 1 'Wave 4 schema' SKIP 'the pause tier could not be read (check 2), so story 17''s contract could not be seen'; return }
    if (-not $TierState.Contains('persisted')) {
        Add-ReadyResult 1 'Wave 4 schema' WARN 'expected migration DemoFeedbackWave4RuntimeAndEdits (story 17); not deployed yet: the pause tier carries no `persisted` field. The tier and clock live in memory until 17 and 18 deploy'
    }
    elseif ($TierState['persisted'] -eq $true) {
        Add-ReadyResult 1 'Wave 4 schema' PASS 'expected migration DemoFeedbackWave4RuntimeAndEdits (story 17); deployed: the pause tier reports persisted = true'
    }
    else {
        Add-ReadyResult 1 'Wave 4 schema' WARN 'story 17 is deployed but the pause tier reports persisted = false: its write-through failed (see the API log), so a restart would not keep the tier'
    }
}

function Test-PauseTier {
    <# Check 2. Returns the pause-tier body (for checks 1 and 9), or $null. #>
    param([string] $BaseUrl, [string] $Token)
    $r = Invoke-PulseApi -BaseUrl $BaseUrl -Method GET -Path '/api/steering/pause-tier' -Token $Token
    if ($r.Status -ne 200 -or $r.Json -isnot [System.Collections.IDictionary]) { Add-ReadyResult 2 'Pause tier' FAIL "expected GET /api/steering/pause-tier 200; got $($r.Status)"; return $null }
    $tier = Get-PrintableText $r.Json['tier'] -Max 20
    switch ($tier) {
        'engine' { Add-ReadyResult 2 'Pause tier' PASS 'expected engine (DF-38); got engine' }
        'freeze' { Add-ReadyResult 2 'Pause tier' FAIL 'expected engine; got freeze. Never leave FROZEN: run Invoke-DemoReset.ps1 (the runtime reset, then the seed sets engine)' }
        default { Add-ReadyResult 2 'Pause tier' FAIL "expected engine; got $tier. The engine would react to the demo: run Seed-DemoContent.ps1 (it sets engine) or pause the engine from the console" }
    }
    return $r.Json
}

function Test-ReviewQueue {
    <# Check 3. #>
    param([string] $BaseUrl, [string] $Token)
    $r = Invoke-PulseApi -BaseUrl $BaseUrl -Method GET -Path '/api/engine/review-queue' -Token $Token
    if ($r.Status -ne 200) { Add-ReadyResult 3 'Engine review queue' FAIL "expected GET /api/engine/review-queue 200; got $($r.Status)"; return }
    # The queue is a JSON array (ConvertFrom-Json hides that: [] is $null, a one-item array its item), so read the text.
    if (-not $r.Text.TrimStart().StartsWith('[')) { Add-ReadyResult 3 'Engine review queue' FAIL 'expected 0 pending drafts; GET /api/engine/review-queue answered an unexpected shape (not a JSON array)'; return }
    $pending = @((Get-JsonList $r.Json) | Where-Object { $_ -is [System.Collections.IDictionary] -and $script:PendingDispositions -contains [string] $_['disposition'] })
    $byKind = ($script:PendingDispositions | ForEach-Object { $d = $_; "$d $(@($pending | Where-Object { $_['disposition'] -eq $d }).Count)" }) -join ', '
    $n = $pending.Count
    if ($n -eq 0) { Add-ReadyResult 3 'Engine review queue' PASS 'expected 0 pending drafts; got 0' }
    elseif ($n -le 5) { Add-ReadyResult 3 'Engine review queue' WARN "expected 0 pending drafts; got $n ($byKind). Veto them in the console, or run Clear-DemoContent.ps1 (it vetoes other storylines' drafts)" }
    else { Add-ReadyResult 3 'Engine review queue' FAIL "expected 0 pending drafts; got $n ($byKind). Batch approve would publish them: run Clear-DemoContent.ps1, then re-run this check" }
}

function Test-GenerationProvider {
    <# Check 4. #>
    param([string] $BaseUrl, [string] $Token)
    $r = Invoke-PulseApi -BaseUrl $BaseUrl -Method GET -Path '/api/engine/settings' -Token $Token
    if ($r.Status -ne 200 -or $r.Json -isnot [System.Collections.IDictionary]) { Add-ReadyResult 4 'Generation provider' FAIL "expected GET /api/engine/settings 200; got $($r.Status)"; return }
    $effective = Get-PrintableText $r.Json['effectiveProvider'] -Max 40
    if ($effective -ceq 'Fake') { Add-ReadyResult 4 'Generation provider' PASS 'expected Fake (DF-38); got Fake' }
    else { Add-ReadyResult 4 'Generation provider' FAIL "expected Fake (DF-38); got $effective (configured $(Get-PrintableText $r.Json['provider'] -Max 40)). Cut generation to Fake in the console's engine settings" }
}

function Test-NoiseAndWatermark {
    <# Check 5. #>
    param([string] $BaseUrl, [string] $Token)
    $noise = Invoke-PulseApi -BaseUrl $BaseUrl -Method GET -Path '/api/staff/noise' -Token $Token
    if ($noise.Status -ne 200 -or $noise.Json -isnot [System.Collections.IDictionary]) { Add-ReadyResult 5 'White noise' FAIL "expected GET /api/staff/noise 200; got $($noise.Status)" }
    else {
        $level = Get-PrintableText $noise.Json['level'] -Max 20
        if ($level -ceq 'off') { Add-ReadyResult 5 'White noise' PASS "expected off; got off (pool $([int] $noise.Json['poolSize']))" }
        else { Add-ReadyResult 5 'White noise' FAIL "expected off; got $level. Turn it off with the console's knob (turn it up on stage)" }
        # Noise posts newer than the seed anchor would sit in the opening feed, but GET /api/feed has no origin field
        # (only the write route's StaffPostDto does), so they cannot be picked out. Say so, with what the noise state knows.
        $lastAt = ConvertTo-Instant $noise.Json['lastPostedAt']
        $last = if ($lastAt) { "the last at scenario time $($lastAt.UtcDateTime.ToString('yyyy-MM-dd HH:mm')) UTC" } else { 'none yet' }
        Add-ReadyResult 5 'Noise posts in the opening feed' SKIP "expected none newer than the seed anchor; the feed does not expose a post's origin, so they cannot be picked out. White noise has published $([int] $noise.Json['postedCount']) post(s), $last"
    }
    $chrome = Invoke-PulseApi -BaseUrl $BaseUrl -Method GET -Path '/api/staff/chrome-settings' -Token $Token
    if ($chrome.Status -ne 200 -or $chrome.Json -isnot [System.Collections.IDictionary]) { Add-ReadyResult 5 'Media marking' FAIL "expected GET /api/staff/chrome-settings 200; got $($chrome.Status)"; return }
    if ($chrome.Json['watermarkEnabled'] -eq $true) { Add-ReadyResult 5 'Media marking' PASS 'expected watermarkEnabled on; got on' }
    else { Add-ReadyResult 5 'Media marking' FAIL 'expected watermarkEnabled on; got off. Run Seed-DemoContent.ps1 (it turns it on) or switch it on in exercise settings' }
}

function Test-ExercisePins {
    <# Check 6. Returns the GET /api/feed/pinned status for check 10. #>
    param([string] $BaseUrl, [string] $Token, [AllowNull()] [System.Collections.IDictionary] $Pack)
    $r = Invoke-PulseApi -BaseUrl $BaseUrl -Method GET -Path '/api/feed/pinned' -Token $Token
    if ($null -eq $Pack) { Add-ReadyResult 6 'Exercise pins' FAIL "expected the pack's pins pinned for everyone; $(Get-PackFailure)"; return $r.Status }
    $pins = @(Get-JsonList $Pack['pins'])
    $expected = "$($pins -join ', ') pinned for everyone"
    if ($r.Status -ne 200 -or $r.Json -isnot [System.Collections.IDictionary]) { Add-ReadyResult 6 'Exercise pins' FAIL "expected $expected; GET /api/feed/pinned answered $($r.Status)"; return $r.Status }
    $pinnedTexts = @((Get-JsonList $r.Json['items']) | Where-Object { $_['reason'] -eq 'exercise' -and $_['post'] -is [System.Collections.IDictionary] -and $_['post']['pinnedForAll'] } | ForEach-Object { [string] $_['post']['text'] })
    $missing = @(foreach ($key in $pins) {
            $post = @(Get-JsonList $Pack['posts']) | Where-Object { $_['key'] -ceq $key } | Select-Object -First 1
            if (-not $post -or $pinnedTexts -notcontains [string] $post['text']) { $key }
        })
    if ($missing.Count -eq 0) { Add-ReadyResult 6 'Exercise pins' PASS "expected $expected; got all $($pins.Count)" }
    else { Add-ReadyResult 6 'Exercise pins' FAIL "expected $expected; missing $($missing -join ', '). Run Seed-DemoContent.ps1 (it pins them)" }
    return $r.Status
}

function Test-ExerciseLifecycle {
    <# Check 11: the lifecycle of the signed-in exercise (so -ExerciseId is honoured). #>
    param([string] $BaseUrl, [string] $Token)
    $r = Invoke-PulseApi -BaseUrl $BaseUrl -Method GET -Path '/api/staff/exercise-lifecycle' -Token $Token
    if ($r.Status -ne 200 -or $r.Json -isnot [System.Collections.IDictionary]) { Add-ReadyResult 11 'Exercise lifecycle' FAIL "expected live; GET /api/staff/exercise-lifecycle answered $($r.Status)"; return }
    $state = Get-PrintableText $r.Json['state'] -Max 20
    switch -CaseSensitive ($state) {
        'live' { Add-ReadyResult 11 'Exercise lifecycle' PASS 'expected live; got live' }
        'staged' { Add-ReadyResult 11 'Exercise lifecycle' WARN 'expected live; got staged: participants see the pre-start page until StartEx (fine if the demo starts staged)' }
        default { Add-ReadyResult 11 'Exercise lifecycle' FAIL "expected live (or staged); got $(if ($state) { $state } else { 'no state' }). Participants cannot use the exercise: move it to live in Exercise Management" }
    }
}

function Test-RunSheet {
    <# Check 7. The API hides an item's Inject # (ExternalRef), so items are told apart by title (see the help). #>
    param([string] $BaseUrl, [string] $Token, [AllowNull()] [System.Collections.IDictionary] $Pack)
    if ($null -eq $Pack) { Add-ReadyResult 7 'Run sheet' FAIL "expected the seeded items pending and no MSEL-imported item; $(Get-PackFailure)"; return }
    $r = Invoke-PulseApi -BaseUrl $BaseUrl -Method GET -Path '/api/injects' -Token $Token
    if ($r.Status -ne 200 -or $r.Json -isnot [System.Collections.IDictionary]) { Add-ReadyResult 7 'Run sheet' FAIL "expected GET /api/injects 200; got $($r.Status)"; return }
    $queue = @((Get-JsonList $r.Json['items']) | Where-Object { $_ -is [System.Collections.IDictionary] })
    $runSheet = $Pack['runSheet']
    $packItems = @(if ($runSheet -is [System.Collections.IDictionary]) { Get-JsonList $runSheet['items'] | Where-Object { $_ -is [System.Collections.IDictionary] } })
    $seeded = @($packItems | Where-Object { [string]::IsNullOrEmpty([string] $_['msel']) })
    $mselItems = @($packItems | Where-Object { -not [string]::IsNullOrEmpty([string] $_['msel']) })
    $seededTitles = @($seeded | ForEach-Object { [string] $_['title'] })
    $mselTitles = @($mselItems | ForEach-Object { [string] $_['title'] })

    $missing = @(foreach ($item in $seeded) {
            $copies = @($queue | Where-Object { [string] $_['title'] -ceq [string] $item['title'] -and [string] $_['kind'] -ceq [string] $item['kind'] })
            if (@($copies | Where-Object { $_['status'] -eq 'pending' }).Count -eq 0) {
                $state = if ($copies.Count) { ($copies | ForEach-Object { [string] $_['status'] }) -join '/' } else { 'not in the queue' }
                "$($item['key']) ($state)"
            }
        })
    $foreign = @($queue | Where-Object { $seededTitles -cnotcontains [string] $_['title'] })
    $mselCopies = @($foreign | Where-Object { $mselTitles -ccontains [string] $_['title'] -and $script:SpentStatuses -notcontains [string] $_['status'] })
    $unknownLive = @($foreign | Where-Object { $mselTitles -cnotcontains [string] $_['title'] -and $script:SpentStatuses -notcontains [string] $_['status'] })
    $unknownSpent = @($foreign | Where-Object { $mselTitles -cnotcontains [string] $_['title'] -and $script:SpentStatuses -contains [string] $_['status'] })

    $expected = "expected the $($seeded.Count) seeded items pending and no MSEL-imported item (DF-16)"
    $problems = [System.Collections.Generic.List[string]]::new()
    if ($missing.Count) { $problems.Add("seeded items not pending: $($missing -join ', ') (run Seed-DemoContent.ps1 -RunSheet exceptMsel, with -ReloadFiredRunSheet after a rehearsal)") }
    if ($mselCopies.Count) { $problems.Add("$($mselCopies.Count) seeded cop$(if ($mselCopies.Count -eq 1) { 'y' } else { 'ies' }) of an msel item still armable ('$(($mselCopies | ForEach-Object { Get-PrintableText $_['title'] -Max 60 }) -join "', '")'): the import would add a second one; delete it in the console") }
    if ($unknownLive.Count) { $problems.Add("$($unknownLive.Count) item(s) the seed did not load, not spent ('$(($unknownLive | ForEach-Object { Get-PrintableText $_['title'] -Max 60 }) -join "', '")'): an MSEL import or a console item (the API does not show Inject #). Run Clear-DemoContent.ps1 -WhatIf: it lists the imported ones and archives them") }
    if ($problems.Count) { Add-ReadyResult 7 'Run sheet' FAIL "$expected; $($problems -join '; ')"; return }
    $duplicates = @(foreach ($item in $seeded) {
            $pending = @($queue | Where-Object { [string] $_['title'] -ceq [string] $item['title'] -and [string] $_['kind'] -ceq [string] $item['kind'] -and $_['status'] -eq 'pending' }).Count
            if ($pending -gt 1) { "$($item['key']) ($pending pending)" }
        })
    if ($duplicates.Count) {
        Add-ReadyResult 7 'Run sheet' WARN "$expected; duplicate pending copies of a seeded item: $($duplicates -join ', '). ""Fire next"" would fire each; Skip or delete the extra copies in the console"
        return
    }
    if ($unknownSpent.Count) {
        Add-ReadyResult 7 'Run sheet' WARN "$expected; the seeded items are pending, but $($unknownSpent.Count) spent item(s) the seed did not load remain ('$(($unknownSpent | ForEach-Object { Get-PrintableText $_['title'] -Max 60 }) -join "', '")'). If an MSEL import created them the on-stage import skips their rows: run Clear-DemoContent.ps1"
        return
    }
    Add-ReadyResult 7 'Run sheet' PASS "$expected; got all $($seeded.Count) pending, no other live item (judged by title: the API does not show Inject #)"
}

function Find-PackPostsInFeed {
    <# The pack's posts found in the feed (by text): @{ Key; MinutesBeforeAnchor; Post }, nearest the anchor first. #>
    param([object[]] $Feed, [AllowNull()] [System.Collections.IDictionary] $Pack)
    if ($null -eq $Pack) { return }
    $found = foreach ($packPost in @(Get-JsonList $Pack['posts'])) {
        $post = $Feed | Where-Object { [string] $_['text'] -ceq [string] $packPost['text'] } | Select-Object -First 1
        if ($post) { [pscustomobject]@{ Key = [string] $packPost['key']; MinutesBeforeAnchor = [int] $packPost['minutesBeforeAnchor']; Post = $post } }
    }
    $found | Sort-Object MinutesBeforeAnchor
}

function Test-Media {
    <#
    Check 8: one image and one video link from the feed, probed without the token. A pack media item is preferred
    (matched by the pack's alt text, or its file name in the link); any feed media of that kind is the fallback.
    #>
    param([string] $BaseUrl, [object[]] $Feed, [AllowNull()] [System.Collections.IDictionary] $Pack)
    $packMedia = @(if ($Pack) { Get-JsonList $Pack['media'] | Where-Object { $_ -is [System.Collections.IDictionary] } })
    foreach ($kind in 'image', 'video') {
        $candidates = @(foreach ($post in $Feed) { Get-JsonList $post['media'] | Where-Object { $_ -is [System.Collections.IDictionary] -and $_['kind'] -eq $kind -and $_['url'] } })
        $ofKind = @($packMedia | Where-Object { [string] $_['kind'] -eq $kind })
        $alts = @($ofKind | ForEach-Object { [string] $_['alt'] } | Where-Object { $_ })
        $files = @($ofKind | ForEach-Object { [IO.Path]::GetFileName([string] $_['file']) } | Where-Object { $_ })
        $media = $candidates | Where-Object {
            $path = try { [Uri]::UnescapeDataString(([Uri] [string] $_['url']).AbsolutePath) } catch { [string] $_['url'] }
            $alts -ccontains [string] $_['alt'] -or @($files | Where-Object { $path.EndsWith("/$_", [StringComparison]::OrdinalIgnoreCase) }).Count
        } | Select-Object -First 1
        $source = 'a pack'
        if (-not $media) { $media = $candidates | Select-Object -First 1; $source = 'a non-pack' }
        if ($media -and $packMedia.Count -and $source -eq 'a non-pack') { Write-Host "    No pack $kind found in the feed; probing $source $kind instead." -ForegroundColor DarkGray }
        if (-not $media) { Add-ReadyResult 8 "Media ($kind)" FAIL "expected a pack $kind in the feed answering 200 with $kind/*; the feed has no $kind (did the seed run?)"; continue }
        $url = [string] $media['url']
        if ($url -notmatch '^https?://') { $url = "$BaseUrl/$($url.TrimStart('/'))" }
        $probe = Invoke-MediaProbe -Url $url
        $hostName = try { ([Uri] $url).Host } catch { 'the media host' }
        if ($probe.Status -in 200, 206 -and $probe.ContentType -like "$kind/*") {
            Add-ReadyResult 8 "Media ($kind)" PASS "expected 200 with $kind/*; got $($probe.Status) $(Get-PrintableText $probe.ContentType -Max 40) from $hostName (SAS reachable)"
        }
        else {
            $got = if ($probe.Status -eq 0) { 'no answer' } else { "$($probe.Status) $(Get-PrintableText $probe.ContentType -Max 40)" }
            Add-ReadyResult 8 "Media ($kind)" FAIL "expected 200 with $kind/*; got $got from $hostName. Check the storage account and the SAS lifetime"
        }
    }
}

function Test-ScenarioWindow {
    <# Check 9 (see the help: the server's scenario clock has no read route). #>
    param([object[]] $Found, [AllowNull()] [object] $TierState, [DateTimeOffset] $Now = [DateTimeOffset]::UtcNow)
    $note = 'the server''s scenario clock has no read route; the participant clock is the browser''s wall clock'
    if ($script:PackError) { Add-ReadyResult 9 'Scenario clock' FAIL "expected a minute inside the pack's window; $(Get-PackFailure)"; return }
    if ($Found.Count -eq 0) { Add-ReadyResult 9 'Scenario clock' WARN "expected a minute inside the pack's window; no pack post is in the feed to read the anchor from ($note). Run Seed-DemoContent.ps1"; return }
    $nearest = $Found[0]
    $at = ConvertTo-Instant $nearest.Post['scenarioTime']
    if ($null -eq $at) { Add-ReadyResult 9 'Scenario clock' SKIP "post $($nearest.Key) has no readable scenarioTime ($note)"; return }
    $anchor = $at.AddMinutes($nearest.MinutesBeforeAnchor)
    $minute = [math]::Floor(($Now - $anchor).TotalMinutes)
    $expected = "expected a minute inside the pack's window (0 to $($script:WindowMinutes) after the seed anchor $($anchor.UtcDateTime.ToString('yyyy-MM-dd HH:mm')) UTC)"
    $frozen = $TierState -is [System.Collections.IDictionary] -and $TierState['clockFrozen'] -eq $true
    if ($frozen) { Add-ReadyResult 9 'Scenario clock' WARN "$expected; the server reports its clock FROZEN, so run-sheet and engine posts would be stamped behind ($note)"; return }
    if ($minute -ge 0 -and $minute -le $script:WindowMinutes) { Add-ReadyResult 9 'Scenario clock' PASS "$expected; got minute $minute ($note)" }
    else { Add-ReadyResult 9 'Scenario clock' WARN "$expected; got minute ${minute}: the opening feed would not trend. Seed on the morning of the show ($note)" }
}

function Test-NewRoutes {
    <# Check 10. #>
    param([string] $BaseUrl, [string] $Token, [int] $PinnedStatus, [object[]] $Found)
    if ($PinnedStatus -le 0) { Add-ReadyResult 10 'Route /api/feed/pinned' FAIL 'expected an answer, not 404; got no answer (see check 6)' }
    elseif ($PinnedStatus -eq 404) { Add-ReadyResult 10 'Route /api/feed/pinned' FAIL 'expected an answer, not 404; got 404: Wave 3 is not deployed on this host' }
    else { Add-ReadyResult 10 'Route /api/feed/pinned' PASS "expected an answer, not 404; got $PinnedStatus" }
    if ($script:PackError) { Add-ReadyResult 10 'Route /api/posts/{id}/edits' FAIL "expected an answer for a seeded post; $(Get-PackFailure)"; return }
    if ($Found.Count -eq 0) { Add-ReadyResult 10 'Route /api/posts/{id}/edits' SKIP 'no seeded post in the feed to ask about'; return }
    $postId = [string] $Found[0].Post['id']
    $guid = [guid]::Empty
    if (-not [guid]::TryParse($postId, [ref] $guid)) { Add-ReadyResult 10 'Route /api/posts/{id}/edits' SKIP "seeded post $($Found[0].Key) has no readable id"; return }
    $r = Invoke-PulseApi -BaseUrl $BaseUrl -Method GET -Path "/api/posts/$($guid.ToString('D'))/edits" -Token $Token
    switch ($r.Status) {
        200 { Add-ReadyResult 10 'Route /api/posts/{id}/edits' PASS "expected an answer, not 404; got 200 for seeded post $($Found[0].Key)" }
        404 { Add-ReadyResult 10 'Route /api/posts/{id}/edits' WARN 'expected an answer, not 404; got 404: Wave 4 (story 19) is not deployed yet. A FAIL once it is' }
        default { Add-ReadyResult 10 'Route /api/posts/{id}/edits' FAIL "expected 200; got $($r.Status)" }
    }
}

function Invoke-ReadyStep {
    <# Runs one check; a thrown error (no answer from the API) becomes that check's FAIL, and the run goes on. #>
    param([string] $Number, [string] $Name, [scriptblock] $Body)
    try { & $Body } catch { Add-ReadyResult $Number $Name FAIL $_.Exception.Message }
}

function Read-DemoPack {
    <#
    The demo pack, or $null after recording a FAIL ("demo pack could not be loaded: <reason>") and setting
    $script:PackError, which makes the checks that need the pack (6, 7, 9 and the edits route in 10) FAIL too.
    #>
    param([string] $Path)
    $script:PackError = $null
    $pack = $null
    try {
        if (-not $Path) { throw 'no -PackPath given' }
        if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "no file at '$Path'" }
        $text = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
        try { $pack = ConvertFrom-Json -InputObject $text -AsHashtable -NoEnumerate -ErrorAction Stop } catch { throw "'$Path' is not valid JSON" }
        if ($pack -isnot [System.Collections.IDictionary]) { throw "'$Path' is not a demo pack (not a JSON object)" }
        return $pack
    }
    catch {
        $script:PackError = Get-PrintableText $_.Exception.Message -Max 200
        Add-ReadyResult 0 'Demo pack' FAIL "demo pack could not be loaded: $($script:PackError). The pins, run-sheet, anchor and edits checks fail with it"
        return $null
    }
}

function Get-PackFailure {
    <# The FAIL text for a check that needs the pack, when it could not be loaded. #>
    return "demo pack could not be loaded: $($script:PackError)"
}

function Write-ReadyJson {
    param([string] $Path, [string] $ApiHost, [string] $ExerciseId)
    $directory = Split-Path -Parent $Path
    if ($directory -and -not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
    $failed = @($script:ReadyResults | Where-Object status -eq 'FAIL').Count
    [ordered]@{
        schema      = 'pulse.demoready.v1'
        checkedAt   = [DateTimeOffset]::UtcNow.ToString('o')     # wall clock: a staff run log, never shown to participants
        apiHost     = $ApiHost
        exerciseId  = $ExerciseId
        ready       = ($failed -eq 0)
        counts      = [ordered]@{
            pass = @($script:ReadyResults | Where-Object status -eq 'PASS').Count
            warn = @($script:ReadyResults | Where-Object status -eq 'WARN').Count
            fail = $failed
            skip = @($script:ReadyResults | Where-Object status -eq 'SKIP').Count
        }
        results     = @($script:ReadyResults)
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $Path -Encoding utf8
    Write-Host "Results written to $Path" -ForegroundColor DarkGray
}

function Invoke-DemoReadyCheck {
    <# The whole run. Returns the exit code: 1 on any FAIL, 0 otherwise. #>
    [CmdletBinding()]
    param(
        [string] $ExerciseId,
        [Parameter(Mandatory)] [string] $ApiHost,
        [string] $SiteUrl,
        [Parameter(Mandatory)] [string] $StaffUsername,
        [string] $PackPath,
        [switch] $Json,
        [string] $JsonPath,
        [string] $Subscription,
        [string] $ResourceGroup,
        [string] $WebAppName
    )
    $ProgressPreference = 'SilentlyContinue'
    $script:ReadyResults = [System.Collections.Generic.List[object]]::new()
    $script:PackError = $null
    try { $resolved = Resolve-ApiHost -ApiHost $ApiHost }
    catch { Write-Host $_.Exception.Message -ForegroundColor Red; return 1 }
    $baseUrl = $resolved.BaseUrl
    $ApiHost = $resolved.Host
    if ($Json -and -not $JsonPath) { $JsonPath = Join-Path $PSScriptRoot 'logs' ('demo-ready-{0}.json' -f (Get-Date -Format 'yyyyMMdd-HHmmss')) }

    Write-Host "Pulse demo pre-flight (read-only) — $baseUrl" -ForegroundColor Cyan
    $exercise = Test-HealthAndSchema -BaseUrl $baseUrl
    $token = $null
    $targetId = $null
    try {
        if ($exercise) {
            $targetId = $exercise.Id
            if ($ExerciseId) {
                $given = [guid]::Empty
                if (-not [guid]::TryParse($ExerciseId, [ref] $given)) { throw "-ExerciseId '$ExerciseId' is not a GUID." }
                $targetId = $given.ToString('D')
                if ($targetId -ne $exercise.Id) { Write-Host "  -ExerciseId $targetId is not the exercise bound to the host ($($exercise.Id)); checking $targetId." -ForegroundColor Yellow }
            }
            $secret = Get-StaffSecret -StaffUsername $StaffUsername -Subscription $Subscription -ResourceGroup $ResourceGroup -WebAppName $WebAppName
            try { $token = Connect-StaffSession -BaseUrl $baseUrl -StaffUsername $StaffUsername -Secret $secret -ExerciseId $targetId }
            finally { $secret = $null }
            Write-Host "  Signed in as $StaffUsername." -ForegroundColor DarkGray

            $pack = Read-DemoPack -Path $PackPath
            $tierState = Invoke-ReadyStep 2 'Pause tier' { Test-PauseTier -BaseUrl $baseUrl -Token $token }
            Test-Wave4Schema -TierState $tierState
            Invoke-ReadyStep 3 'Engine review queue' { Test-ReviewQueue -BaseUrl $baseUrl -Token $token }
            Invoke-ReadyStep 4 'Generation provider' { Test-GenerationProvider -BaseUrl $baseUrl -Token $token }
            Invoke-ReadyStep 5 'White noise and media marking' { Test-NoiseAndWatermark -BaseUrl $baseUrl -Token $token }
            $pinnedStatus = Invoke-ReadyStep 6 'Exercise pins' { Test-ExercisePins -BaseUrl $baseUrl -Token $token -Pack $pack }
            Invoke-ReadyStep 7 'Run sheet' { Test-RunSheet -BaseUrl $baseUrl -Token $token -Pack $pack }
            Invoke-ReadyStep 11 'Exercise lifecycle' { Test-ExerciseLifecycle -BaseUrl $baseUrl -Token $token }

            $feed = @()
            try {
                $feedResponse = Invoke-PulseApi -BaseUrl $baseUrl -Method GET -Path '/api/feed?includeReplies=true' -Token $token
                if ($feedResponse.Status -eq 200) { $feed = @(Get-JsonList $feedResponse.Json | Where-Object { $_ -is [System.Collections.IDictionary] }) }
                else { Write-Host "  GET /api/feed answered $($feedResponse.Status): checks 8 to 10 see an empty feed." -ForegroundColor Yellow }
            }
            catch { Write-Host "  $($_.Exception.Message): checks 8 to 10 see an empty feed." -ForegroundColor Yellow }
            $found = @(Find-PackPostsInFeed -Feed $feed -Pack $pack)
            Invoke-ReadyStep 8 'Media' { Test-Media -BaseUrl $baseUrl -Feed $feed -Pack $pack }
            Invoke-ReadyStep 9 'Scenario clock' { Test-ScenarioWindow -Found $found -TierState $tierState }
            Invoke-ReadyStep 10 'Wave 3/4 routes' { Test-NewRoutes -BaseUrl $baseUrl -Token $token -PinnedStatus ([int] $pinnedStatus) -Found $found }
        }
    }
    catch { Add-ReadyResult 0 'Sign-in' FAIL $_.Exception.Message }
    finally {
        Disconnect-StaffSession -BaseUrl $baseUrl -Token $token
        $token = $null
    }

    if ($Json) { Write-ReadyJson -Path $JsonPath -ApiHost $ApiHost -ExerciseId $targetId }
    $failed = @($script:ReadyResults | Where-Object status -eq 'FAIL').Count
    $warned = @($script:ReadyResults | Where-Object status -eq 'WARN').Count
    $skipped = @($script:ReadyResults | Where-Object status -eq 'SKIP').Count
    Write-Host ''
    if ($failed -eq 0) {
        Write-Host "READY — $($script:ReadyResults.Count) checks, $warned warning(s), $skipped skipped." -ForegroundColor Green
        Write-Host "  Participant: $SiteUrl/login     Controller: $SiteUrl/staff/login"
        return 0
    }
    Write-Host "NOT READY — $failed check(s) failed, $warned warning(s)." -ForegroundColor Red
    return 1
}

# Dot-sourcing (the Pester tests) loads the functions above and stops here.
if ($MyInvocation.InvocationName -eq '.') { return }

$runArguments = @{
    ExerciseId = $ExerciseId; ApiHost = $ApiHost; SiteUrl = $SiteUrl; StaffUsername = $StaffUsername; PackPath = $PackPath
    Json = $Json; JsonPath = $JsonPath; Subscription = $Subscription; ResourceGroup = $ResourceGroup; WebAppName = $WebAppName
}
$exitCode = Invoke-DemoReadyCheck @runArguments | Select-Object -Last 1
exit ([int] $exitCode)
