# Shared helpers for the load-test scripts (post-demo-feedback/01, #547): New-LoadTestExercise.ps1 and
# Remove-LoadTestExercise.ps1. Dot-source it: . "$PSScriptRoot/LoadTest.Common.ps1"
#
# The same conventions as Import-Roster.ps1 / Test-DemoReady.ps1: -ApiHost normalised once (https on 443 only), no
# redirect ever followed (MaximumRedirection 0: a redirected POST would re-send the secret), the web cmdlet's verbose
# and debug streams off, request bodies wiped after sending, and the error records a failed request leaves in $Error
# removed (their HttpRequestMessage holds the Authorization header). The staff secret comes from
# $env:PULSE_STAFF_SECRET or a hidden prompt and is never printed, logged or written to disk.

# The name every load-test exercise starts with. The harness and Remove-LoadTestExercise.ps1 refuse anything else.
$script:LoadTestNamePrefix = 'Load test'
# Roster rows named like this are NPC authors (noise pool, burst items, controller-as-persona writes), never joined.
$script:LoadTestNpcPrefix = 'Load NPC'
# Burst items are found by this title prefix (the harness fires one per step).
$script:LoadTestBurstPrefix = 'Load burst'
# The join-URL file name pattern under scripts/uat/out (git-ignored). Remove-LoadTestExercise.ps1 deletes these.
$script:LoadTestJoinFilePattern = 'loadtest-join-urls-*.csv'

function Write-LoadLine {
    <# One PASS / WARN / FAIL / INFO line, in the UAT scripts' style. #>
    param([Parameter(Mandatory)] [ValidateSet('PASS', 'WARN', 'FAIL', 'INFO', 'SKIP')] [string] $Status, [Parameter(Mandatory)] [string] $Message)
    $color = @{ PASS = 'Green'; WARN = 'Yellow'; FAIL = 'Red'; INFO = 'Gray'; SKIP = 'DarkGray' }[$Status]
    Write-Host ('  [{0}] {1}' -f $Status, $Message) -ForegroundColor $color
}

function Get-PrintableText {
    <# Server text made safe for the console: control and format characters removed, cut to -Max characters. #>
    param([AllowNull()] [object] $Value, [int] $Max = 0)
    $text = ([string] $Value) -replace '[\t\r\n]', ' ' -replace '[\p{Cc}\p{Cf}]', ''
    if ($Max -gt 1 -and $text.Length -gt $Max) { $text = $text.Substring(0, $Max - 1) + '…' }
    return $text
}

function Resolve-ApiHost {
    <#
    .SYNOPSIS
        Normalises a host parameter ONCE, before any network call: a bare host name, or an https URL reduced to its host.
        Returns @{ Host; BaseUrl }. http:// (localhost included), an explicit port, a user name or a non-host value are
        refused, as in Test-DemoReady.ps1: the UAT scripts target https on 443 only.
    #>
    param([AllowNull()] [AllowEmptyString()] [string] $ApiHost, [string] $ParameterName = '-ApiHost')
    $value = ([string] $ApiHost).Trim()
    $hint = "Use a host name, e.g. app-pulse-api-uat-dynamis.azurewebsites.net (an https:// URL is accepted too). Nothing was sent."
    if (-not $value) { throw "$ParameterName is empty. $hint" }
    if ($value -notmatch '^[A-Za-z][A-Za-z0-9+.-]*://') { $value = "https://$value" }
    $uri = $null
    if (-not [Uri]::TryCreate($value, [UriKind]::Absolute, [ref] $uri) -or $uri.Scheme -notin 'https', 'http' -or
        $uri.UserInfo -or $uri.HostNameType -notin 'Dns', 'IPv4' -or $uri.Host -notmatch '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$') {
        throw "$ParameterName '$ApiHost' is not a host name or an https URL. $hint"
    }
    if ($uri.Scheme -ne 'https') { throw "$ParameterName '$ApiHost' uses plain http: https only (the staff secret must not travel in the clear). Nothing was sent." }
    if ($value -match '^[A-Za-z][A-Za-z0-9+.-]*://[^/?#]*:\d*(?:[/?#]|$)') { throw "$ParameterName '$ApiHost' names a port: https on 443 only. Nothing was sent." }
    if ($uri.AbsolutePath -ne '/' -or $uri.Query) { throw "$ParameterName '$ApiHost' has a path or query: give the host only. Nothing was sent." }
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
        One request to the API. Returns @{ Status; Json; Text }. Throws a readable error when no response arrives or the
        host answers with a redirect (never followed).
    #>
    param(
        [Parameter(Mandatory)] [string] $BaseUrl,
        [Parameter(Mandatory)] [ValidateSet('GET', 'POST', 'PUT')] [string] $Method,
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
    if ($null -ne $Body) {
        $request['Body'] = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Body -Compress -Depth 8))
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
            if ($redirected) { throw [System.Exception]::new("$Method $bare answered a redirect, which was not followed. Check the host ($BaseUrl).") }
            throw [System.Exception]::new("No answer from $BaseUrl to $Method ${bare}: $reason.")
        }
    }
    finally {
        if ($request['Body'] -is [byte[]]) { [Array]::Clear($request['Body'], 0, $request['Body'].Length) }
        $headers.Clear()
    }
    $status = [int] $response.StatusCode
    if ($status -ge 300 -and $status -lt 400) { throw [System.Exception]::new("$Method $bare answered a redirect ($status), which was not followed. Check the host ($BaseUrl).") }
    $content = $response.Content
    $text = if ($content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($content) } else { [string] $content }
    $json = $null
    if ($text.Trim()) {
        try { $json = ConvertFrom-Json -InputObject $text -AsHashtable -NoEnumerate }
        catch { $json = $null }
    }
    return [pscustomobject]@{ Status = $status; Json = $json; Text = $text }
}

function Get-ApiErrorText {
    <# A short, printable reason from an error response (problem detail, a JSON string, or the status). #>
    param([Parameter(Mandatory)] [object] $Response)
    $json = $Response.Json
    if ($json -is [System.Collections.IDictionary]) {
        foreach ($key in 'detail', 'title', 'error', 'message') { if ($json[$key]) { return Get-PrintableText $json[$key] -Max 200 } }
    }
    if ($json -is [string]) { return Get-PrintableText $json -Max 200 }
    if ($Response.Text) { return Get-PrintableText $Response.Text -Max 200 }
    return "status $($Response.Status)"
}

function Get-ExerciseContext {
    <# GET /api/exercise-context on a host: @{ Status; Id; Name; Status; TimeZone }. Id is $null when the host resolves to no exercise. #>
    param([Parameter(Mandatory)] [string] $BaseUrl)
    $response = Invoke-PulseApi -BaseUrl $BaseUrl -Method GET -Path '/api/exercise-context'
    $id = [guid]::Empty
    if ($response.Status -eq 200 -and $response.Json -is [System.Collections.IDictionary] -and [guid]::TryParse([string] $response.Json['exerciseId'], [ref] $id)) {
        return [pscustomobject]@{
            HttpStatus = 200; Id = $id.ToString('D'); Name = [string] $response.Json['exerciseName']
            Lifecycle = [string] $response.Json['status']; TimeZone = [string] $response.Json['timeZone']
        }
    }
    return [pscustomobject]@{ HttpStatus = $response.Status; Id = $null; Name = $null; Lifecycle = $null; TimeZone = $null }
}

function Read-StaffSecret {
    <# The staff secret: $env:PULSE_STAFF_SECRET, otherwise a hidden prompt. Never printed. #>
    param([Parameter(Mandatory)] [string] $StaffUsername)
    if ($env:PULSE_STAFF_SECRET) { return $env:PULSE_STAFF_SECRET }
    $secure = Read-Host "Staff secret for '$StaffUsername' (hidden; Copy-StaffSecret.ps1 $StaffUsername puts it on the clipboard)" -AsSecureString
    $secret = [System.Net.NetworkCredential]::new('', $secure).Password
    $secure = $null
    if ([string]::IsNullOrWhiteSpace($secret)) { throw 'No staff secret given. Set PULSE_STAFF_SECRET or type it at the prompt.' }
    return $secret
}

function Connect-StaffSession {
    <# POST /api/auth/staff/login { username, secret, exerciseId }; returns @{ Token; ActingHumanId; ExerciseId }. #>
    param([Parameter(Mandatory)] [string] $BaseUrl, [Parameter(Mandatory)] [string] $StaffUsername, [Parameter(Mandatory)] [string] $Secret, [Parameter(Mandatory)] [string] $ExerciseId)
    $body = [ordered]@{ username = $StaffUsername; secret = $Secret; exerciseId = $ExerciseId }
    try { $response = Invoke-PulseApi -BaseUrl $BaseUrl -Method POST -Path '/api/auth/staff/login' -Body $body }
    finally { $body['secret'] = $null }
    if ($response.Status -eq 200 -and $response.Json -is [System.Collections.IDictionary] -and $response.Json['token']) {
        $session = $response.Json['session']
        $result = [pscustomobject]@{
            Token         = [string] $response.Json['token']
            ActingHumanId = if ($session -is [System.Collections.IDictionary]) { [string] $session['actingHumanId'] } else { '' }
            ExerciseId    = if ($session -is [System.Collections.IDictionary]) { [string] $session['exerciseId'] } else { '' }
        }
        $response.Json.Clear()
        return $result
    }
    switch ($response.Status) {
        401 { throw "Sign-in was refused (401): '$StaffUsername' or its secret was rejected. Check -StaffUsername and PULSE_STAFF_SECRET." }
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
        if ($response.Status -ge 200 -and $response.Status -lt 300) { Write-Host 'Signed out.' -ForegroundColor DarkGray }
        else { Write-Warning "Sign-out answered $($response.Status); the staff session will expire on its own." }
    }
    catch { Write-Warning "Sign-out failed ($($_.Exception.Message)); the staff session will expire on its own." }
}

function Test-LoadTestTarget {
    <#
    .SYNOPSIS
        The refusal rule shared with the harness: returns the reason to refuse, or $null when the exercise is a load-test
        exercise that is not the demo exercise.
    #>
    param([AllowNull()] [string] $ExerciseId, [AllowNull()] [string] $Name, [AllowNull()] [string] $DemoExerciseId)
    $target = [guid]::Empty
    $demo = [guid]::Empty
    if (-not [guid]::TryParse([string] $ExerciseId, [ref] $target) -or $target -eq [guid]::Empty) { return 'the host resolves to no exercise.' }
    if ([guid]::TryParse([string] $DemoExerciseId, [ref] $demo) -and $demo -eq $target) { return "exercise $target IS the demo exercise. Load-test scripts never touch it." }
    if (-not ([string] $Name).StartsWith($script:LoadTestNamePrefix, [StringComparison]::Ordinal)) {
        return "exercise '$(Get-PrintableText $Name -Max 80)' ($target) is not named '$($script:LoadTestNamePrefix) …'. Only exercises made by New-LoadTestExercise.ps1 are touched."
    }
    return $null
}

function Get-JsonList {
    <# The elements of a JSON array (or a dictionary's -Key array), one per pipeline item. Wrap in @(). #>
    param([AllowNull()] [object] $Value)
    if ($null -eq $Value) { return }
    foreach ($element in @($Value)) { if ($null -ne $element) { $element } }
}
