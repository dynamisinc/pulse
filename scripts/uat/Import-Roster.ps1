#Requires -Version 7.0

<#
.SYNOPSIS
    Provisions UAT testers from a CSV through the staff roster API, and writes their personal sign-in links to
    a local file that only you can read.

.DESCRIPTION
    The tester-provisioning path (easy-login story 14, COR-011). It calls the same public roster API as the
    console's Participants screen, as a staff user and with the same authorization (a controller or planner
    assigned to the exercise, EL-13), not the secret-gated ops bootstrap route. Nobody has to invent or relay a
    password.

      1. Reads the exercise bound to -ApiHost (GET /api/exercise-context). This script takes no exercise id: the
         host decides the exercise, and the staff session's active exercise decides where people land.
      2. Signs in as -StaffUsername (POST /api/auth/staff/login).
      3. Uploads the CSV (POST /api/staff/roster/import?dryRun=true|false, multipart field "file") and prints
         the counts and a table of row, name, sign-in name, status and message. Failed rows are red, with the
         server's reason.
      4. After a real import, reads the roster (GET /api/staff/roster) and writes name, signInName and joinUrl
         for every participant in the file to -OutFile. It prints only the file's path, never a link. With
         -CopyLinks it also puts the links on the clipboard.
      5. With -GenerateWord or -Word, sets today's word (PUT /api/staff/day-word), prints it once so it can be
         read out, and copies it to the clipboard.
      6. Signs out (POST /api/auth/logout), always, even after a failure.

    Exit code: 0 when every row was created, updated or unchanged. 1 when any row failed, or on any error.
    An error prints the server's reason (or what a bodyless 401/403/404 means) and never a stack trace. The
    script stops at the first error. Re-running with the same file is safe: rows already on the roster come
    back "unchanged".

    The CSV: UTF-8, one header row, at most 1 MB and 5000 rows. The columns are name (required), agency,
    role, email, personaHandle and signInName; the template is name,agency,role,email,personaHandle,signInName.
    A blank signInName is derived from the name (Jane Smith -> jsmith). A blank personaHandle gets the person
    an auto-created citizen persona. See docs/features/easy-login/implementation.md, "Roster CSV".

    SECRETS (NFR-009). The staff secret comes from $env:PULSE_STAFF_SECRET if set, otherwise from the API's
    App Service settings through YOUR az login (the approach Copy-StaffSecret.ps1 uses). The secret and the
    session token stay in memory: they are never printed, logged, put in a verbose or debug message, or
    written to disk, and the web cmdlet's own verbose and debug output is switched off. Join links are
    personal sign-in credentials. They are written only to the -OutFile you asked for (gitignored by
    default), with permissions for the current user only (mode 600 on Linux and macOS, an owner-only ACL on
    Windows), and to the clipboard only with -CopyLinks. Each cell of that file that begins with =, +, -, @,
    a tab or a carriage return is prefixed with ' so a spreadsheet never runs it as a formula (names come
    from outside agencies).

    Testers who need a single password-based login can still use New-DemoParticipant.ps1.

.PARAMETER CsvPath
    The roster CSV to upload.

.PARAMETER DryRun
    Validate only: uploads with ?dryRun=true. The server saves nothing. This script writes no file, copies
    nothing and sets no word. The table shows what a real import would do.

.PARAMETER OutFile
    Where to write the links file after a real import. The default is
    scripts/uat/out/roster-links-<yyyyMMdd-HHmmss>.csv, which .gitignore excludes. If you choose another
    path, keep it out of the repository. An existing file at the path is replaced.

.PARAMETER CopyLinks
    Also put the links on the clipboard, as tab-separated name, signInName and joinUrl lines with a header.
    They paste into a spreadsheet as columns. They are never echoed. Clear the clipboard afterwards:
    Set-Clipboard -Value $null. On Linux this needs xclip; without it, nothing is copied and the links are in
    the file only.

.PARAMETER GenerateWord
    After the import, have the server generate today's word. The word is printed once, so it can be read
    out, and copied to the clipboard. Setting a word again the same day replaces the earlier one, and the
    earlier word stops working.

.PARAMETER Word
    After the import, set this text as today's word instead of a generated one. Like -GenerateWord, it is
    printed once and copied. Typing a word on the command line leaves it in your shell history, so prefer
    -GenerateWord.

.PARAMETER CheckOnly
    Read-only. Signs in, reads the roster and reports how many participants it holds and how many have an
    active link, then signs out. Needs no CSV and changes nothing.

.PARAMETER StaffUsername
    The staff login to use. It must be a controller or planner assigned to the exercise; evaluators and org
    admins are refused (403). Copy-StaffSecret.ps1 with no arguments lists the staff logins.

.PARAMETER ApiHost
    The API's host name, which the exercise is bound to. This is not the site's host. Plain http is accepted
    for localhost only (for example http://localhost:5000).

.PARAMETER SiteUrl
    The participant site, used only in the hint about where people sign in with today's word.

.PARAMETER Subscription
    The Azure subscription that holds the API's App Service. Used only when PULSE_STAFF_SECRET is unset.

.PARAMETER ResourceGroup
    The resource group of the API's App Service. Used only when PULSE_STAFF_SECRET is unset.

.PARAMETER WebAppName
    The API's App Service. Its Authentication__StaffIdentity__Accounts__N__Username / __Secret settings hold
    the staff logins. Used only when PULSE_STAFF_SECRET is unset.

.EXAMPLE
    pwsh scripts/uat/Import-Roster.ps1 -CsvPath testers.csv -DryRun

    Checks the file. Nothing is created and nothing is written.

.EXAMPLE
    pwsh scripts/uat/Import-Roster.ps1 -CsvPath testers.csv

    Imports the file and writes the links to scripts/uat/out/roster-links-<timestamp>.csv.

.EXAMPLE
    pwsh scripts/uat/Import-Roster.ps1 testers.csv -GenerateWord -CopyLinks

    Imports the file, writes the links file, copies the links, and sets, prints and copies today's word.

.EXAMPLE
    pwsh scripts/uat/Import-Roster.ps1 -CheckOnly -StaffUsername planner1

.EXAMPLE
    $env:PULSE_STAFF_SECRET = Get-Clipboard; pwsh scripts/uat/Import-Roster.ps1 testers.csv; $env:PULSE_STAFF_SECRET = $null

    Uses a secret copied with Copy-StaffSecret.ps1 instead of reading it through az.

.NOTES
    Needs the easy-login backend on the API host: stories 02 (roster), 03 (personal links) and 05 (day word).
    A 404 from these routes means they are not deployed there, or -ApiHost names the wrong host.
#>
[CmdletBinding(DefaultParameterSetName = 'Import')]
param(
    [Parameter(Mandatory, Position = 0, ParameterSetName = 'Import')]
    [ValidateNotNullOrEmpty()]
    [string] $CsvPath,

    [Parameter(ParameterSetName = 'Import')] [switch] $DryRun,
    [Parameter(ParameterSetName = 'Import')] [ValidateNotNullOrEmpty()] [string] $OutFile,
    [Parameter(ParameterSetName = 'Import')] [switch] $CopyLinks,
    [Parameter(ParameterSetName = 'Import')] [switch] $GenerateWord,
    [Parameter(ParameterSetName = 'Import')] [ValidateNotNullOrEmpty()] [string] $Word,

    [Parameter(Mandatory, ParameterSetName = 'Check')] [switch] $CheckOnly,

    [ValidateNotNullOrEmpty()] [string] $StaffUsername = 'controller1',

    # UAT defaults, the same as New-DemoParticipant.ps1. The exercise is bound to the API's own host, not to
    # pulse-uat.cobrasoftware.com (docs/features/login/06-uat-goLive-config-runbook.md, step 4).
    [ValidateNotNullOrEmpty()] [string] $ApiHost = 'app-pulse-api-uat-dynamis.azurewebsites.net',
    [string] $SiteUrl = 'https://pulse-uat.cobrasoftware.com',
    [string] $Subscription = '2a127d53-c9bf-471a-8196-3155eae6cb1b',
    [string] $ResourceGroup = 'rg-pulse-uat-centralus',
    [string] $WebAppName = 'app-pulse-api-uat-dynamis'
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/Common.ps1"

# The server's limit (RosterEndpoints.MaxImportFileBytes). Checked here too, so an oversized file fails before
# anything is sent.
$script:MaxCsvBytes = 1024 * 1024

# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# Text helpers
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

function Get-PrintableText {
    <#
    .SYNOPSIS
        Server and CSV text made safe for the console. Control and format characters (escape sequences, bidi
        overrides) are removed, line breaks and tabs become spaces, and long text is cut to -Max characters.
    #>
    param([AllowNull()] [object] $Value, [int] $Max = 0)
    $text = ([string] $Value) -replace '[\t\r\n]', ' ' -replace '[\p{Cc}\p{Cf}]', ''
    if ($Max -gt 1 -and $text.Length -gt $Max) { $text = $text.Substring(0, $Max - 1) + '…' }
    return $text
}

function ConvertTo-FormulaSafeText {
    <#
    .SYNOPSIS
        Prefixes ' to text that begins with =, +, -, @, a tab or a carriage return, so that a spreadsheet shows
        it as text and never evaluates it as a formula (CSV/formula injection; story 02 Gate-1 W-3, recorded in
        docs/features/easy-login/implementation.md). Names come from outside agencies.
    #>
    param([AllowNull()] [object] $Value)
    $text = [string] $Value
    if ($text -match '^[=+\-@\t\r]') { return "'" + $text }
    return $text
}

function ConvertTo-CsvCell {
    <# One CSV cell: formula-safe, always double-quoted, embedded quotes doubled. #>
    param([AllowNull()] [object] $Value)
    return '"' + (ConvertTo-FormulaSafeText $Value).Replace('"', '""') + '"'
}

function ConvertTo-LinksCsv {
    <# The links file: a name,signInName,joinUrl header and one row per participant, CRLF line ends. #>
    param([AllowEmptyCollection()] [object[]] $Links)
    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add((@('name', 'signInName', 'joinUrl') | ForEach-Object { ConvertTo-CsvCell $_ }) -join ',')
    foreach ($link in $Links) {
        $lines.Add((@($link.Name, $link.SignInName, $link.JoinUrl) | ForEach-Object { ConvertTo-CsvCell $_ }) -join ',')
    }
    return ($lines -join "`r`n") + "`r`n"
}

function ConvertTo-LinksClipboardText {
    <#
    .SYNOPSIS
        The -CopyLinks text: a header and one tab-separated line per participant, so it pastes into a
        spreadsheet as columns. Formula-safe like the file. A tab or line break inside a cell becomes a space.
    #>
    param([AllowEmptyCollection()] [object[]] $Links)
    $cell = { param($Value) (ConvertTo-FormulaSafeText $Value) -replace '[\t\r\n]', ' ' }
    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add("name`tsignInName`tjoinUrl")
    foreach ($link in $Links) { $lines.Add(((& $cell $link.Name), (& $cell $link.SignInName), (& $cell $link.JoinUrl)) -join "`t") }
    return $lines -join [Environment]::NewLine
}

function Format-Instant {
    <# An ISO-8601 instant from the API (ConvertFrom-Json may already have made it a DateTime), in local time. #>
    param([AllowNull()] [object] $Value)
    if ($Value -is [datetime]) { return ([DateTimeOffset] $Value).ToLocalTime().ToString('yyyy-MM-dd HH:mm zzz') }
    $parsed = [DateTimeOffset]::MinValue
    if ([DateTimeOffset]::TryParse([string] $Value, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref] $parsed)) {
        return $parsed.ToLocalTime().ToString('yyyy-MM-dd HH:mm zzz')
    }
    return Get-PrintableText $Value
}

function Write-Failure([string] $Message) { Write-Host $Message -ForegroundColor Red }

# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# Local checks (nothing is sent when one fails)
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

function Resolve-ApiBaseUrl {
    <# -ApiHost as an https origin. A bare host name gets https://. Plain http is for localhost only. #>
    param([Parameter(Mandatory)] [string] $ApiHost)
    $value = $ApiHost.Trim().TrimEnd('/')
    if ($value -notmatch '^[A-Za-z][A-Za-z0-9+.-]*://') { $value = "https://$value" }
    $uri = $null
    if (-not [Uri]::TryCreate($value, [UriKind]::Absolute, [ref] $uri)) {
        throw "-ApiHost '$ApiHost' is not a host name. Use the API's host, e.g. app-pulse-api-uat-dynamis.azurewebsites.net."
    }
    if ($uri.Scheme -ne 'https' -and -not ($uri.Scheme -eq 'http' -and $uri.IsLoopback)) {
        throw '-ApiHost must use https (plain http only for localhost): the staff secret and the session token must not travel in the clear.'
    }
    if ($uri.AbsolutePath -ne '/' -or $uri.Query) { throw "-ApiHost must be a host name or an origin, without a path: '$ApiHost'." }
    return $uri.GetLeftPart([UriPartial]::Authority)
}

function Get-RosterCsvFile {
    <# The CSV as a FileInfo, after the checks the server would make anyway (exists, not empty, at most 1 MB). #>
    param([Parameter(Mandatory)] [string] $Path)
    $full = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "No file at '$Path'. Nothing was sent." }
    $file = Get-Item -LiteralPath $full
    if ($file.Length -eq 0) { throw "'$Path' is empty. Nothing was sent." }
    if ($file.Length -gt $script:MaxCsvBytes) {
        throw "'$Path' is $($file.Length) bytes; the server takes at most $($script:MaxCsvBytes) bytes (1 MB) and 5000 rows. Nothing was sent."
    }
    return $file
}

function Resolve-LinksFilePath {
    <# -OutFile as a full path, or the default: scripts/uat/out/roster-links-<yyyyMMdd-HHmmss>.csv (gitignored). #>
    param([string] $OutFile)
    if ($OutFile) { return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutFile) }
    return [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'out' ("roster-links-{0}.csv" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))))
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# HTTP. Every call goes through Invoke-PulseApi: no redirects followed, the web cmdlet's verbose and debug
# streams off (they carry request headers and bodies), the body bytes wiped after sending, and the error
# records a failed request leaves in $Error removed (their HttpRequestMessage holds the Authorization header,
# and Get-Error would print it).
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

function Clear-WebErrorRecord {
    param([AllowEmptyCollection()] [object[]] $Exceptions = @())
    foreach ($record in @($global:Error)) {
        if ($record -isnot [System.Management.Automation.ErrorRecord]) { continue }
        $fromRequest = $record.TargetObject -is [System.Net.Http.HttpRequestMessage]
        $listed = @($Exceptions | Where-Object { $null -ne $_ -and [object]::ReferenceEquals($_, $record.Exception) }).Count -gt 0
        if ($fromRequest -or $listed) { $global:Error.Remove($record) }
    }
}

function Get-ApiHostHint {
    param([string] $BaseUrl)
    return "Check -ApiHost: it is the API's own host name (default app-pulse-api-uat-dynamis.azurewebsites.net), not the participant site; this run used $BaseUrl."
}

function Invoke-PulseApi {
    <#
    .SYNOPSIS
        One request to the API. Returns @{ Status; Json; Text }. Throws a readable error, naming -ApiHost, when
        no response arrives (DNS, connection, TLS or timeout) or the host answers with a redirect.
    #>
    param(
        [Parameter(Mandatory)] [string] $BaseUrl,
        [Parameter(Mandatory)] [ValidateSet('GET', 'POST', 'PUT')] [string] $Method,
        [Parameter(Mandatory)] [string] $Path,
        [string] $Token,
        [AllowNull()] [object] $Body,
        [System.Collections.IDictionary] $Form,
        [int] $TimeoutSec = 120
    )
    $headers = @{ Accept = 'application/json' }
    if ($Token) { $headers['Authorization'] = "Bearer $Token" }
    $request = @{
        Uri                = "$BaseUrl$Path"
        Method             = $Method
        Headers            = $headers
        TimeoutSec         = $TimeoutSec
        SkipHttpErrorCheck = $true
        MaximumRedirection = 0          # a redirected POST would re-send its body (the secret) to another host
        Debug              = $false     # the web cmdlet's debug stream carries bodies and the Authorization header
        Verbose            = $false
        ErrorAction        = 'Stop'
    }
    if ($BaseUrl -like 'http://*') { $request['AllowUnencryptedAuthentication'] = $true }
    if ($Form) { $request['Form'] = $Form }
    elseif ($null -ne $Body) {
        $request['Body'] = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Body -Compress -Depth 5))
        $request['ContentType'] = 'application/json; charset=utf-8'
    }

    $bare = ($Path -split '\?', 2)[0]
    Write-Verbose "$Method $Path"
    $response = $null
    try {
        try { $response = Invoke-WebRequest @request }
        catch {
            $reason = Get-PrintableText $_.Exception.Message
            Clear-WebErrorRecord -Exceptions @($_.Exception)
            throw [System.Exception]::new("No answer from the API to $Method ${bare}: $reason. $(Get-ApiHostHint $BaseUrl)")
        }
    }
    finally {
        if ($request['Body'] -is [byte[]]) { [Array]::Clear($request['Body'], 0, $request['Body'].Length) }
        $headers.Clear()
    }

    $status = [int] $response.StatusCode
    if ($status -ge 300 -and $status -lt 400) {
        throw [System.Exception]::new("$Method $bare answered a redirect ($status). The API never redirects, so it was not followed. $(Get-ApiHostHint $BaseUrl)")
    }
    $content = $response.Content
    $text = if ($content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($content) } else { [string] $content }
    $json = $null
    if ($text.Trim()) {
        try { $json = ConvertFrom-Json -InputObject $text -AsHashtable }
        catch { $json = $null }
    }
    Write-Verbose "$Method $bare -> $status"
    Write-Debug "$Method $bare -> $status, $($text.Length) characters of $(if ($null -ne $json) { 'JSON' } else { 'non-JSON' })"
    return [pscustomobject]@{ Status = $status; Json = $json; Text = $text }
}

function Get-ServerReason {
    <#
    .SYNOPSIS
        The readable reason in an error body: a ProblemDetails "detail" (the roster and day-word routes), a plain
        JSON string (the staff login's 400), or {"error": ...}. Empty when the body has none (a bodyless 401/403).
    #>
    param([Parameter(Mandatory)] [object] $Response)
    $json = $Response.Json
    $text = $null
    if ($json -is [string]) { $text = $json }
    elseif ($json -is [System.Collections.IDictionary]) {
        foreach ($key in 'detail', 'error', 'reason', 'title') {
            if ($json[$key]) { $text = [string] $json[$key]; break }
        }
    }
    elseif ($Response.Text.Trim() -and $Response.Text.TrimStart() -notmatch '^<') { $text = $Response.Text }
    return Get-PrintableText $text -Max 400
}

function Get-StaffRouteFailure {
    <# The message for a failed staff route: the server's reason when it gives one, otherwise what the status means. #>
    param(
        [Parameter(Mandatory)] [object] $Response,
        [Parameter(Mandatory)] [string] $What,
        [Parameter(Mandatory)] [string] $Route,
        [Parameter(Mandatory)] [string] $BaseUrl,
        [Parameter(Mandatory)] [string] $StaffUsername
    )
    $reason = Get-ServerReason $Response
    switch ($Response.Status) {
        400 { return "$What was refused (400): $(if ($reason) { $reason } else { 'the server gave no reason.' })" }
        401 { return "$What was refused (401): the API did not accept the staff session (it expired, or the host now resolves no exercise). Run again. If it repeats: $(Get-ApiHostHint $BaseUrl)" }
        403 { return "$What was refused (403): '$StaffUsername' must be a controller or planner assigned to this exercise. Evaluators and org admins cannot provision participants (EL-13). Use -StaffUsername." }
        404 { return "$What failed: $Route answered 404. The easy-login backend (stories 02, 03, 05) is not deployed on this host, or -ApiHost names the wrong host. $(Get-ApiHostHint $BaseUrl)" }
        413 { return "$What was refused (413): the file is too large. The server takes at most 1 MB and 5000 rows." }
        429 { return "$What was refused (429): too many requests. Wait a minute and run again." }
        default {
            $detail = if ($reason) { ": $($reason.TrimEnd('.'))" } elseif ($Response.Status -ge 500) { ': the API had a problem (serverless SQL may be resuming). Try again in a minute; Reset-DemoState.ps1 -CheckOnly checks its health' } else { '' }
            return "$What failed ($($Response.Status))$detail."
        }
    }
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# Steps
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

function Get-ExerciseContext {
    <# The exercise bound to the API host (anonymous). Its id is what the staff login names. #>
    param([Parameter(Mandatory)] [string] $BaseUrl)
    $response = Invoke-PulseApi -BaseUrl $BaseUrl -Method GET -Path '/api/exercise-context' -TimeoutSec 90
    $json = $response.Json
    $id = [guid]::Empty
    if ($response.Status -eq 200 -and $json -is [System.Collections.IDictionary] -and [guid]::TryParse([string] $json['exerciseId'], [ref] $id) -and $id -ne [guid]::Empty) {
        return [pscustomobject]@{ Id = $id.ToString('D'); Name = Get-PrintableText $json['exerciseName'] -Max 80 }
    }
    switch ($response.Status) {
        200 { throw "$BaseUrl answered GET /api/exercise-context, but not the way the Pulse API does (no exercise id). $(Get-ApiHostHint $BaseUrl)" }
        404 { throw "No exercise is bound to $BaseUrl (GET /api/exercise-context answered 404), or this is not the Pulse API. $(Get-ApiHostHint $BaseUrl)" }
        default {
            $reason = Get-ServerReason $response
            throw "GET /api/exercise-context answered $($response.Status)$(if ($reason) { ": $($reason.TrimEnd('.'))" }). The API is not healthy (serverless SQL may be resuming): try again in a minute, or run Reset-DemoState.ps1 -CheckOnly."
        }
    }
}

function Get-StaffSecret {
    <#
    .SYNOPSIS
        The staff secret: $env:PULSE_STAFF_SECRET, otherwise the App Service setting through the caller's az
        login. Like Copy-StaffSecret.ps1 it reads the usernames first and then only the one secret it needs.
        The secret is returned to the caller and never printed.
    #>
    param(
        [Parameter(Mandatory)] [string] $StaffUsername,
        [string] $Subscription,
        [string] $ResourceGroup,
        [string] $WebAppName
    )
    if ($env:PULSE_STAFF_SECRET) {
        Write-Verbose 'Staff secret: from PULSE_STAFF_SECRET.'
        return $env:PULSE_STAFF_SECRET
    }
    Write-Verbose "Staff secret: reading the '$StaffUsername' entry from $WebAppName's settings through az."
    $hint = "Set PULSE_STAFF_SECRET instead (Copy-StaffSecret.ps1 $StaffUsername copies the secret to the clipboard)."
    try {
        $json = Invoke-Az webapp config appsettings list --resource-group $ResourceGroup --name $WebAppName --subscription $Subscription `
            --query "[?starts_with(name, 'Authentication__StaffIdentity__Accounts__') && ends_with(name, '__Username')]" -o json
        $names = @($json | ConvertFrom-Json)
    }
    catch { throw "Could not read the staff logins from ${WebAppName}: $($_.Exception.Message) $hint" }
    $entry = $names | Where-Object { $_.value -ieq $StaffUsername } | Select-Object -First 1
    if (-not $entry) {
        $known = @($names | ForEach-Object value) -join ', '
        throw "No staff login '$StaffUsername' is configured on $WebAppName$(if ($known) { " (there are: $known)" }). Use -StaffUsername, or $hint"
    }
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
        POST /api/auth/staff/login { username, secret, exerciseId } and returns the session token. The server
        requires the exercise the session enters; it is the one bound to the host, never one chosen here. The
        refresh token is dropped: this run is short.
    #>
    param(
        [Parameter(Mandatory)] [string] $BaseUrl,
        [Parameter(Mandatory)] [string] $StaffUsername,
        [Parameter(Mandatory)] [string] $Secret,
        [Parameter(Mandatory)] [object] $Exercise
    )
    $body = [ordered]@{ username = $StaffUsername; secret = $Secret; exerciseId = $Exercise.Id }
    try { $response = Invoke-PulseApi -BaseUrl $BaseUrl -Method POST -Path '/api/auth/staff/login' -Body $body -TimeoutSec 90 }
    finally { $body['secret'] = $null }

    if ($response.Status -eq 200 -and $response.Json -is [System.Collections.IDictionary] -and $response.Json['token']) {
        $token = [string] $response.Json['token']
        $response.Json.Clear()
        return $token
    }
    $reason = Get-ServerReason $response
    switch ($response.Status) {
        200 { throw "Sign-in answered 200 without a session token. $(Get-ApiHostHint $BaseUrl)" }
        400 { throw "Sign-in was refused (400): $(if ($reason) { $reason } else { 'the server gave no reason.' })" }
        401 { throw "Sign-in was refused (401): '$StaffUsername' or its secret was rejected. Check -StaffUsername and PULSE_STAFF_SECRET (or the App Service setting)." }
        403 { throw "Sign-in was refused (403): '$StaffUsername' is not assigned to exercise '$($Exercise.Name)'. Use a controller or planner assigned to it (-StaffUsername)." }
        404 { throw "Sign-in failed: POST /api/auth/staff/login answered 404. $(Get-ApiHostHint $BaseUrl)" }
        429 { throw 'Sign-in was refused (429): too many sign-in attempts from this address (10 a minute). Wait a minute and run again.' }
        default { throw "Sign-in failed ($($response.Status))$(if ($reason) { ": $($reason.TrimEnd('.'))" })." }
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

function Write-ImportReport {
    <# The counts, then a table of row, name, sign-in name, status and message. Failed rows are red. #>
    param([Parameter(Mandatory)] [System.Collections.IDictionary] $Report, [Parameter(Mandatory)] [string] $FileName)
    $rows = @($Report['rows'] | Where-Object { $_ -is [System.Collections.IDictionary] })
    $lead = if ($Report['dryRun']) { 'Dry run of' } else { 'Imported' }
    Write-Host ''
    Write-Host ("{0} {1}: {2} row(s), {3} created, {4} updated, {5} unchanged, {6} failed." -f $lead, (Get-PrintableText $FileName),
        [int] $Report['totalRows'], [int] $Report['createdCount'], [int] $Report['updatedCount'], [int] $Report['unchangedCount'], [int] $Report['failedCount']) `
        -ForegroundColor $(if ([int] $Report['failedCount'] -gt 0) { 'Yellow' } else { 'Green' })
    if (-not $rows.Count) { return }

    $table = foreach ($row in $rows) {
        [pscustomobject]@{
            Row     = [string] $row['rowNumber']
            Name    = Get-PrintableText $row['name'] -Max 32
            SignIn  = Get-PrintableText $row['signInName'] -Max 32
            Status  = Get-PrintableText $row['status'] -Max 12
            Message = Get-PrintableText $row['message']
        }
    }
    $width = @{}
    foreach ($column in @(
            @{ Key = 'Row'; Title = 'Row' }, @{ Key = 'Name'; Title = 'Name' }, @{ Key = 'SignIn'; Title = 'Sign-in name' }, @{ Key = 'Status'; Title = 'Status' })) {
        $width[$column.Key] = [int] [Math]::Max($column.Title.Length, (@($table | ForEach-Object { $_.($column.Key).Length }) | Measure-Object -Maximum).Maximum)
    }
    $format = "  {0,$($width.Row)}  {1,-$($width.Name)}  {2,-$($width.SignIn)}  {3,-$($width.Status)}  {4}"
    Write-Host ''
    Write-Host ($format -f 'Row', 'Name', 'Sign-in name', 'Status', 'Message') -ForegroundColor Cyan
    Write-Host ($format -f ('-' * $width.Row), ('-' * $width.Name), ('-' * $width.SignIn), ('-' * $width.Status), '-------') -ForegroundColor Cyan
    foreach ($line in $table) {
        $text = ($format -f $line.Row, $line.Name, $line.SignIn, $line.Status, $line.Message).TrimEnd()
        switch ($line.Status) {
            'failed' { Write-Host $text -ForegroundColor Red }
            'created' { Write-Host $text -ForegroundColor Green }
            default { Write-Host $text }
        }
    }
}

function Get-RosterLinks {
    <#
    .SYNOPSIS
        One entry per participant the file created, updated or left unchanged (failed rows are skipped), in file
        order, joined to the roster by sign-in name. JoinUrl is empty when the person has no usable link
        (revoked, needs reissue, or join links not configured).
    #>
    param([Parameter(Mandatory)] [System.Collections.IDictionary] $Report, [Parameter(Mandatory)] [System.Collections.IDictionary] $Roster)
    $bySignIn = @{}   # case-insensitive
    foreach ($entry in @($Roster['participants'])) {
        if ($entry -is [System.Collections.IDictionary] -and $entry['signInName']) { $bySignIn[[string] $entry['signInName']] = $entry }
    }
    $seen = @{}
    foreach ($row in @($Report['rows'])) {
        if ($row -isnot [System.Collections.IDictionary] -or $row['status'] -eq 'failed') { continue }
        $signIn = [string] $row['signInName']
        if (-not $signIn -or $seen.ContainsKey($signIn)) { continue }
        $seen[$signIn] = $true
        $entry = $bySignIn[$signIn]
        $link = if ($entry) { $entry['link'] } else { $null }
        [pscustomobject]@{
            Name       = if ($entry) { [string] $entry['name'] } else { [string] $row['name'] }
            SignInName = if ($entry) { [string] $entry['signInName'] } else { $signIn }
            JoinUrl    = if ($link -is [System.Collections.IDictionary] -and $link['joinUrl']) { [string] $link['joinUrl'] } else { '' }
            OnRoster   = [bool] $entry
            Disabled   = [bool] ($entry -and $entry['access'] -eq 'disabled')
        }
    }
}

function New-PrivateFileStream {
    <#
    .SYNOPSIS
        Creates the file (replacing one already there) readable and writable by the current user only, BEFORE
        any content is written: mode 600 on Linux and macOS, an owner-only ACL without inheritance on Windows.
    #>
    param([Parameter(Mandatory)] [string] $Path)
    $directory = Split-Path -Parent $Path
    if ($directory -and -not (Test-Path -LiteralPath $directory -PathType Container)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
    if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Force }   # recreated, so the restricted mode applies

    if ($IsWindows) {
        # Created empty, restricted (inherited entries dropped, one FullControl entry for the current user), and
        # only then opened for the content.
        [System.IO.File]::WriteAllBytes($Path, [byte[]]::new(0))
        try {
            $acl = Get-Acl -LiteralPath $Path
            $acl.SetAccessRuleProtection($true, $false)
            $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
            $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($me, 'FullControl', 'Allow'))
            Set-Acl -LiteralPath $Path -AclObject $acl
        }
        catch { Write-Warning "Could not restrict the links file to your account ($($_.Exception.Message)). Delete it when you are done." }
        return [System.IO.FileStream]::new($Path, [System.IO.FileMode]::Truncate, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    }

    $optionsType = 'System.IO.FileStreamOptions' -as [type]
    if ($optionsType -and $optionsType.GetProperty('UnixCreateMode')) {
        # .NET 7+ (PowerShell 7.3+): the file is born with mode 600, so it is never readable by others.
        $options = [System.IO.FileStreamOptions]::new()
        $options.Mode = [System.IO.FileMode]::CreateNew
        $options.Access = [System.IO.FileAccess]::Write
        $options.Share = [System.IO.FileShare]::None
        $options.UnixCreateMode = [System.IO.UnixFileMode] 'UserRead, UserWrite'
        return [System.IO.FileStream]::new($Path, $options)
    }
    # PowerShell 7.0-7.2: create it empty, restrict it, then write.
    $stream = [System.IO.FileStream]::new($Path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    & chmod 600 -- $Path
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Could not restrict the links file to your account (chmod 600 failed). Delete it when you are done.' }
    return $stream
}

function Write-PrivateTextFile {
    <# Writes UTF-8 with a BOM (so Excel reads accented names correctly) to a file only the current user can read. #>
    param([Parameter(Mandatory)] [string] $Path, [Parameter(Mandatory)] [string] $Text)
    $preamble = [System.Text.UTF8Encoding]::new($true).GetPreamble()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $stream = New-PrivateFileStream -Path $Path
    try {
        $stream.Write($preamble, 0, $preamble.Length)
        $stream.Write($bytes, 0, $bytes.Length)
    }
    finally {
        $stream.Dispose()
        [Array]::Clear($bytes, 0, $bytes.Length)
    }
}

function Test-ClipboardAvailable {
    <# Linux needs xclip for Set-Clipboard; without it PowerShell keeps the text in-process and nothing is copied. #>
    if ($IsLinux) { return [bool] (Get-Command xclip -CommandType Application -ErrorAction SilentlyContinue) }
    return $true
}

function Set-ClipboardText {
    <# Copies text to the clipboard without ever echoing it. Returns $true when it was copied. #>
    param([Parameter(Mandatory)] [string] $Text, [Parameter(Mandatory)] [string] $What)
    if (-not (Test-ClipboardAvailable)) {
        Write-Warning "Nothing was copied ($What): there is no clipboard here (on Linux, install xclip)."
        return $false
    }
    try {
        Set-Clipboard -Value $Text
        return $true
    }
    catch {
        # The clipboard's own error never contains the text, but it is not needed either.
        Clear-WebErrorRecord -Exceptions @($_.Exception)
        Write-Warning "Nothing was copied ($What): the clipboard could not be used."
        return $false
    }
}

function Set-TodaysWord {
    <#
    .SYNOPSIS
        PUT /api/staff/day-word: {} has the server generate today's word; { word } sets the given one. Prints the
        word once, as the API returns it, and copies it.
    #>
    param(
        [Parameter(Mandatory)] [string] $BaseUrl,
        [Parameter(Mandatory)] [string] $Token,
        [AllowNull()] [AllowEmptyString()] [string] $Word,
        [Parameter(Mandatory)] [string] $StaffUsername,
        [string] $SiteUrl
    )
    $body = if ($Word) { [ordered]@{ word = $Word } } else { [ordered]@{} }
    try { $response = Invoke-PulseApi -BaseUrl $BaseUrl -Method PUT -Path '/api/staff/day-word' -Token $Token -Body $body }
    finally { if ($body.Contains('word')) { $body['word'] = $null } }
    if ($response.Status -ne 200 -or $response.Json -isnot [System.Collections.IDictionary] -or -not $response.Json['word']) {
        if ($response.Status -eq 200) { throw "Today's word: PUT /api/staff/day-word answered 200 without a word. $(Get-ApiHostHint $BaseUrl)" }
        throw (Get-StaffRouteFailure -Response $response -What "Setting today's word" -Route 'PUT /api/staff/day-word' -BaseUrl $BaseUrl -StaffUsername $StaffUsername)
    }
    $result = $response.Json
    $set = [string] $result['word']
    Write-Host ''
    Write-Host ("Today's word for {0} ({1}; read it out, it is shown only this once):" -f (Get-PrintableText $result['date']), $(if ($result['generated']) { 'generated' } else { 'as given' })) -ForegroundColor Cyan
    Write-Host ''
    Write-Host "    $(Get-PrintableText $set)" -ForegroundColor Yellow
    Write-Host ''
    Write-Host "  It works until $(Format-Instant $result['validUntil']). Participants sign in at $SiteUrl/login with their sign-in name and this word."
    if ($result['replaced']) { Write-Host '  It REPLACED the word already set for that day: the earlier word no longer works.' -ForegroundColor Yellow }
    if (Set-ClipboardText -Text $set -What "today's word") {
        Write-Host '  Copied to the clipboard. Clear it afterwards: Set-Clipboard -Value $null' -ForegroundColor DarkGray
    }
    $set = $null
    $result.Clear()
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# The run
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

function Invoke-RosterImport {
    <# The whole run. Returns the process exit code: 0 = every row created, updated or unchanged; 1 otherwise. #>
    [CmdletBinding()]
    param(
        [string] $CsvPath,
        [switch] $DryRun,
        [string] $OutFile,
        [switch] $CopyLinks,
        [switch] $GenerateWord,
        [string] $Word,
        [switch] $CheckOnly,
        [Parameter(Mandatory)] [string] $StaffUsername,
        [Parameter(Mandatory)] [string] $ApiHost,
        [string] $SiteUrl,
        [string] $Subscription,
        [string] $ResourceGroup,
        [string] $WebAppName
    )
    $ProgressPreference = 'SilentlyContinue'

    # ── 0. Local checks: when one fails, nothing is sent ─────────────────────────────────────────────────────
    $csvFile = $null
    $linksPath = $null
    try {
        if ($GenerateWord -and $Word) { throw 'Pass -GenerateWord or -Word, not both. Nothing was sent.' }
        $baseUrl = Resolve-ApiBaseUrl -ApiHost $ApiHost
        if (-not $CheckOnly) {
            $csvFile = Get-RosterCsvFile -Path $CsvPath
            if (-not $DryRun) { $linksPath = Resolve-LinksFilePath -OutFile $OutFile }
        }
    }
    catch { Write-Failure $_.Exception.Message; return 1 }

    $title = if ($CheckOnly) { 'roster check' } elseif ($DryRun) { 'roster import (DRY RUN: nothing is saved)' } else { 'roster import' }
    Write-Host "Pulse $title — $baseUrl" -ForegroundColor Cyan

    # ── 1. Exercise and sign-in ──────────────────────────────────────────────────────────────────────────────
    $token = $null
    try {
        $exercise = Get-ExerciseContext -BaseUrl $baseUrl
        Write-Verbose "Exercise '$($exercise.Name)' ($($exercise.Id)), resolved from the host."
        $secret = Get-StaffSecret -StaffUsername $StaffUsername -Subscription $Subscription -ResourceGroup $ResourceGroup -WebAppName $WebAppName
        try { $token = Connect-StaffSession -BaseUrl $baseUrl -StaffUsername $StaffUsername -Secret $secret -Exercise $exercise }
        finally { $secret = $null }
        Write-Host "Signed in as $StaffUsername to exercise '$($exercise.Name)'."
    }
    catch { Write-Failure $_.Exception.Message; return 1 }

    # ── 2. The work, then sign out whatever happened ─────────────────────────────────────────────────────────
    $exitCode = 1
    try {
        if ($CheckOnly) {
            Show-RosterSummary -BaseUrl $baseUrl -Token $token -StaffUsername $StaffUsername
            $exitCode = 0
        }
        else {
            $importArguments = @{
                BaseUrl = $baseUrl; Token = $token; CsvFile = $csvFile; DryRun = $DryRun; LinksPath = $linksPath
                CopyLinks = $CopyLinks; GenerateWord = $GenerateWord; Word = $Word; StaffUsername = $StaffUsername; SiteUrl = $SiteUrl
            }
            $exitCode = Invoke-ImportSteps @importArguments
        }
    }
    catch {
        Write-Failure $_.Exception.Message
        $exitCode = 1
    }
    finally {
        Disconnect-StaffSession -BaseUrl $baseUrl -Token $token
        $token = $null
    }
    return $exitCode
}

function Show-RosterSummary {
    <# -CheckOnly: GET /api/staff/roster and report the counts. Throws a readable error. #>
    param([Parameter(Mandatory)] [string] $BaseUrl, [Parameter(Mandatory)] [string] $Token, [Parameter(Mandatory)] [string] $StaffUsername)
    $response = Invoke-PulseApi -BaseUrl $BaseUrl -Method GET -Path '/api/staff/roster' -Token $Token
    if ($response.Status -ne 200 -or $response.Json -isnot [System.Collections.IDictionary]) {
        throw (Get-StaffRouteFailure -Response $response -What 'Reading the roster' -Route 'GET /api/staff/roster' -BaseUrl $BaseUrl -StaffUsername $StaffUsername)
    }
    $people = @($response.Json['participants'] | Where-Object { $_ -is [System.Collections.IDictionary] })
    $active = @($people | Where-Object { $_['link'] -is [System.Collections.IDictionary] -and $_['link']['status'] -eq 'active' }).Count
    $disabled = @($people | Where-Object { $_['access'] -eq 'disabled' }).Count
    $links = if ($response.Json['joinLinksAvailable']) { 'available' } else { 'NOT available (Authentication:FrontendBaseUrl is unset on the API)' }
    $response.Json.Clear()
    Write-Host "Roster: $($people.Count) participant(s), $active with an active personal link, $disabled disabled. Join links: $links." -ForegroundColor Green
}

function Invoke-ImportSteps {
    <#
    .SYNOPSIS
        Upload, report, links file, today's word. Returns 1 when any row failed, otherwise 0; throws a readable
        error (and stops) at the first failed request.
    #>
    param(
        [Parameter(Mandatory)] [string] $BaseUrl,
        [Parameter(Mandatory)] [string] $Token,
        [Parameter(Mandatory)] [System.IO.FileInfo] $CsvFile,
        [switch] $DryRun,
        [string] $LinksPath,
        [switch] $CopyLinks,
        [switch] $GenerateWord,
        [string] $Word,
        [Parameter(Mandatory)] [string] $StaffUsername,
        [string] $SiteUrl
    )
    # ── Upload (multipart field "file"; dryRun always explicit, the server refuses an empty value) ───────────
    $query = if ($DryRun) { 'true' } else { 'false' }
    $response = Invoke-PulseApi -BaseUrl $BaseUrl -Method POST -Path "/api/staff/roster/import?dryRun=$query" -Token $Token -Form @{ file = $CsvFile }
    if ($response.Status -ne 200 -or $response.Json -isnot [System.Collections.IDictionary]) {
        throw (Get-StaffRouteFailure -Response $response -What 'The import' -Route 'POST /api/staff/roster/import' -BaseUrl $BaseUrl -StaffUsername $StaffUsername)
    }
    $report = $response.Json
    Write-ImportReport -Report $report -FileName $CsvFile.Name
    $exitCode = 0
    $failed = [Math]::Max([int] $report['failedCount'], @($report['rows'] | Where-Object { $_ -is [System.Collections.IDictionary] -and $_['status'] -eq 'failed' }).Count)
    if ($failed -gt 0) {
        $exitCode = 1
        Write-Host ''
        Write-Failure "$failed row(s) failed; the reason is on each red row. Fix them in the file and run again (rows already imported come back unchanged)."
    }

    if ($DryRun) {
        $skipped = @('no links file was written') + @(if ($CopyLinks) { 'nothing was copied' }) + @(if ($GenerateWord -or $Word) { "today's word was not set" })
        Write-Host ''
        Write-Host "Dry run: the server saved nothing, $($skipped -join ', ')." -ForegroundColor Cyan
        return $exitCode
    }

    # ── The links file: every participant in the file, written only to the file, never echoed ──────────────
    $saved = @($report['rows'] | Where-Object { $_ -is [System.Collections.IDictionary] -and $_['status'] -ne 'failed' -and $_['signInName'] }).Count
    if ($saved -eq 0) {
        Write-Host ''
        Write-Host 'No participant from the file was saved, so no links file was written.' -ForegroundColor Yellow
    }
    else {
        $response = Invoke-PulseApi -BaseUrl $BaseUrl -Method GET -Path '/api/staff/roster' -Token $Token
        if ($response.Status -ne 200 -or $response.Json -isnot [System.Collections.IDictionary]) {
            $why = Get-StaffRouteFailure -Response $response -What 'Reading the roster for the links' -Route 'GET /api/staff/roster' -BaseUrl $BaseUrl -StaffUsername $StaffUsername
            throw "The import was saved, but no links file was written. $why Run again with the same file to write it (every row comes back unchanged)."
        }
        $roster = $response.Json
        $links = @(Get-RosterLinks -Report $report -Roster $roster)
        $joinLinksAvailable = [bool] $roster['joinLinksAvailable']
        $roster.Clear()
        $text = ConvertTo-LinksCsv -Links $links
        Write-PrivateTextFile -Path $LinksPath -Text $text
        $text = $null

        $withLink = @($links | Where-Object { $_.JoinUrl }).Count
        Write-Host ''
        Write-Host "Links file: $($links.Count) participant(s), $withLink with a personal link (readable by you only):" -ForegroundColor Green
        Write-Host "  $LinksPath"
        Write-Host '  Each link signs its owner in: give each person only their own, and delete the file when you are done.' -ForegroundColor DarkGray
        if (-not $joinLinksAvailable) {
            Write-Host "  Join links are NOT available on this API (Authentication:FrontendBaseUrl is unset): the file has sign-in names only. Participants can sign in with today's word." -ForegroundColor Yellow
        }
        elseif ($withLink -lt $links.Count) {
            Write-Host "  $($links.Count - $withLink) participant(s) have no usable link (revoked, or it needs reissuing): reissue it on the console's Participants screen, or use today's word." -ForegroundColor Yellow
        }
        $notFound = @($links | Where-Object { -not $_.OnRoster }).Count
        if ($notFound) { Write-Host "  $notFound participant(s) were not on the roster when it was read back (changed meanwhile?): run again to refresh the file." -ForegroundColor Yellow }
        $disabled = @($links | Where-Object Disabled).Count
        if ($disabled) { Write-Host "  $disabled participant(s) are disabled: their links do not work until they are enabled on the console's Participants screen." -ForegroundColor Yellow }

        if ($CopyLinks) {
            $clip = ConvertTo-LinksClipboardText -Links $links
            if (Set-ClipboardText -Text $clip -What 'the links') {
                Write-Host '  The links are also on the clipboard. Clear it afterwards: Set-Clipboard -Value $null' -ForegroundColor DarkGray
            }
            $clip = $null
        }
        $links = $null
    }

    # ── Today's word ───────────────────────────────────────────────────────────────────────────────────────────
    if ($GenerateWord -or $Word) {
        Set-TodaysWord -BaseUrl $BaseUrl -Token $Token -Word $Word -StaffUsername $StaffUsername -SiteUrl $SiteUrl
    }
    return $exitCode
}

# Dot-sourcing (the Pester tests) loads the functions above and stops here.
if ($MyInvocation.InvocationName -eq '.') { return }

$runArguments = @{
    CsvPath       = $CsvPath
    DryRun        = $DryRun
    OutFile       = $OutFile
    CopyLinks     = $CopyLinks
    GenerateWord  = $GenerateWord
    Word          = $Word
    CheckOnly     = $CheckOnly
    StaffUsername = $StaffUsername
    ApiHost       = $ApiHost
    SiteUrl       = $SiteUrl
    Subscription  = $Subscription
    ResourceGroup = $ResourceGroup
    WebAppName    = $WebAppName
}
$exitCode = Invoke-RosterImport @runArguments | Select-Object -Last 1
exit ([int] $exitCode)
