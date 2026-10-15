#Requires -Version 7.0
<#
.SYNOPSIS
    Live check of the demo-feedback backend (#496 stories 01-05, merged in #513) against UAT.

.DESCRIPTION
    Signs in as a staff controller and exercises each new backend surface, printing PASS / WARN / FAIL per
    check. Everything it writes is undone before it exits:

      1. GET /api/chrome-config carries `watermark` (01).
      2. GET /api/staff/exports/posts.xlsx: 200, xlsx content type, an attachment file name, PK bytes, and
         Content-Disposition exposed to the site origin by CORS (02).
      3. POST /api/injects/import with a small Cadence-layout CSV: dry run (writes nothing), apply (creates one
         item), dry run again (unchanged). The created item is deleted afterwards (03).
      4. Pin the newest post for everyone, see it in GET /api/feed/pinned, then unpin it (04).
      5. White noise: read the state, set Low, check `running`, set Off (05). With -IncludeNoisePublish it also
         loads a 3-post pool (only if the pool is empty), waits for one post to publish, then sets Off and
         clears the pool again. That leaves one "[live check]" post in the UAT feed.

    The staff secret comes from $env:PULSE_STAFF_SECRET, else a hidden prompt (Copy-StaffSecret.ps1 puts it on
    the clipboard). It is sent only in the sign-in body, to the API host.

.EXAMPLE
    pwsh scripts/uat/Test-DemoFeedbackLive.ps1

.EXAMPLE
    pwsh scripts/uat/Test-DemoFeedbackLive.ps1 -IncludeNoisePublish
#>
param(
    [string] $ApiHost = 'app-pulse-api-uat-dynamis.azurewebsites.net',
    [string] $SiteUrl = 'https://pulse-uat.cobrasoftware.com',
    [string] $StaffUsername = 'controller1',
    [switch] $IncludeNoisePublish
)

$ErrorActionPreference = 'Stop'
$script:Fails = 0
$script:Warns = 0
$base = "https://$ApiHost"

function Write-Check([string] $Level, [string] $Text) {
    $color = @{ PASS = 'Green'; WARN = 'Yellow'; FAIL = 'Red'; INFO = 'Gray' }[$Level]
    if ($Level -eq 'FAIL') { $script:Fails++ }
    if ($Level -eq 'WARN') { $script:Warns++ }
    Write-Host ("  {0,-4} {1}" -f $Level, $Text) -ForegroundColor $color
}

function Invoke-Api {
    param([string] $Method, [string] $Path, [object] $Body, [hashtable] $Headers = @{}, [string] $OutFile,
        [switch] $Anonymous, [string] $ContentType = 'application/json', [object] $Form)
    $h = @{} + $Headers
    if (-not $Anonymous -and $script:Token) { $h['Authorization'] = "Bearer $script:Token" }
    $req = @{ Method = $Method; Uri = "$base$Path"; Headers = $h; SkipHttpErrorCheck = $true; TimeoutSec = 90 }
    if ($null -ne $Form) { $req['Form'] = $Form }
    elseif ($null -ne $Body) { $req['Body'] = ($Body | ConvertTo-Json -Depth 16 -Compress); $req['ContentType'] = $ContentType }
    if ($OutFile) { $req['OutFile'] = $OutFile; $req['PassThru'] = $true }
    $r = Invoke-WebRequest @req
    $json = $null
    if (-not $OutFile -and $r.Content -and ($r.Headers['Content-Type'] -join '') -match 'json') {
        try { $json = $r.Content | ConvertFrom-Json -AsHashtable -Depth 64 } catch { $json = $null }
    }
    [pscustomobject]@{ Status = [int] $r.StatusCode; Json = $json; Headers = $r.Headers; Raw = $r }
}

# ── 0. Exercise + sign-in ────────────────────────────────────────────────────────────────────────────────
Write-Host "`n0. Exercise and sign-in ($ApiHost)" -ForegroundColor Cyan
$ctx = Invoke-Api GET '/api/exercise-context' -Anonymous
if ($ctx.Status -ne 200) { Write-Check FAIL "/api/exercise-context -> $($ctx.Status)"; exit 1 }
$exerciseId = [string] $ctx.Json['exerciseId']
Write-Check PASS "exercise '$($ctx.Json['exerciseName'])' ($exerciseId), status $($ctx.Json['status'])"

$secret = $env:PULSE_STAFF_SECRET
if (-not $secret) {
    $secure = Read-Host "Staff secret for '$StaffUsername' (hidden)" -AsSecureString
    $secret = [System.Net.NetworkCredential]::new('', $secure).Password
    $secure = $null
}
if ([string]::IsNullOrWhiteSpace($secret)) { Write-Check FAIL 'No secret given. Nothing was sent.'; exit 1 }
$login = Invoke-Api POST '/api/auth/staff/login' -Anonymous -Body @{ username = $StaffUsername; secret = $secret; exerciseId = $exerciseId }
$secret = $null
if ($login.Status -ne 200) { Write-Check FAIL "sign-in -> $($login.Status)"; exit 1 }
$script:Token = [string] $login.Json['token']
$actingHumanId = [string] $login.Json['session']['actingHumanId']
Write-Check PASS "signed in as $StaffUsername"

$created = @{ InjectId = $null; PinnedPostId = $null; NoiseLevelBefore = $null; PoolLoaded = $false }
try {
    # ── 1. chrome-config watermark ───────────────────────────────────────────────────────────────────────
    Write-Host "`n1. Chrome config (01)" -ForegroundColor Cyan
    $cc = Invoke-Api GET '/api/chrome-config'
    if ($cc.Status -eq 200 -and $cc.Json.ContainsKey('watermark')) { Write-Check PASS "watermark = $($cc.Json['watermark']), enabled = $($cc.Json['enabled'])" }
    else { Write-Check FAIL "/api/chrome-config -> $($cc.Status), keys: $(@($cc.Json.Keys) -join ',')" }

    # ── 2. Export ────────────────────────────────────────────────────────────────────────────────────────
    Write-Host "`n2. Post export (02)" -ForegroundColor Cyan
    $xlsx = Join-Path ([IO.Path]::GetTempPath()) "pulse-livecheck-$([guid]::NewGuid().ToString('N')).xlsx"
    $ex = Invoke-Api GET '/api/staff/exports/posts.xlsx' -OutFile $xlsx -Headers @{ Origin = $SiteUrl }
    if ($ex.Status -eq 200) {
        $bytes = [IO.File]::ReadAllBytes($xlsx)
        $ct = $ex.Headers['Content-Type'] -join ''
        $cd = $ex.Headers['Content-Disposition'] -join ''
        $expose = $ex.Headers['Access-Control-Expose-Headers'] -join ''
        $pk = $bytes.Length -gt 4 -and $bytes[0] -eq 0x50 -and $bytes[1] -eq 0x4B
        if ($ct -match 'spreadsheetml' -and $pk) { Write-Check PASS ("xlsx, {0:N0} bytes" -f $bytes.Length) } else { Write-Check FAIL "content-type '$ct', PK=$pk" }
        if ($cd -match 'attachment' -and $cd -match 'pulse-posts-') { Write-Check PASS "file name: $cd" } else { Write-Check FAIL "Content-Disposition: '$cd'" }
        if ($expose -match 'Content-Disposition') { Write-Check PASS 'CORS exposes Content-Disposition to the site' }
        else { Write-Check WARN "Access-Control-Expose-Headers: '$expose' (the console may fall back to a generic file name)" }
        Write-Check INFO "saved to $xlsx (open it in Excel to eyeball the columns)"
    }
    else { Write-Check FAIL "export -> $($ex.Status)" }

    # ── 3. MSEL import ───────────────────────────────────────────────────────────────────────────────────
    Write-Host "`n3. MSEL import (03)" -ForegroundColor Cyan
    $personas = Invoke-Api GET '/api/personas'
    $handle = @($personas.Json | Where-Object { $_['handle'] } | Select-Object -First 1)[0]['handle']
    if (-not $handle) { Write-Check FAIL 'no persona handle found'; throw 'stop' }
    $csv = @(
        '"Inject #","Title","Description","Scheduled Time","Scenario Day","Scenario Time","From / Source","To / Target","Delivery Method","Track","Phase","Expected Action","Notes","Priority","Location","Responsible Controller"'
        '"LC-0","StartEx","Exercise begins","08:00","1","08:00","SimCell","All","In Person","","","","","","",""'
        ('"LC-1","[live check] import","[live check] imported from a Cadence MSEL; safe to ignore","08:10","1","08:10","@{0}","Public","Social Media","","","","live-check","","",""' -f $handle)
        '"LC-2","Email to EOC","Not a social inject","08:20","1","08:20","SimCell","EOC","Email","","","","","","",""'
    ) -join "`r`n"
    $csvPath = Join-Path ([IO.Path]::GetTempPath()) "pulse-livecheck-msel.csv"
    [IO.File]::WriteAllText($csvPath, $csv, [Text.UTF8Encoding]::new($false))

    function Invoke-Import([string] $DryRun) {
        Invoke-Api POST "/api/injects/import?dryRun=$DryRun" -Form @{ file = Get-Item $csvPath }
    }
    $dry = Invoke-Import 'true'
    if ($dry.Status -eq 200 -and $dry.Json['socialRows'] -eq 1 -and $dry.Json['skippedCount'] -eq 2) {
        Write-Check PASS "dry run: social 1, skipped 2, create $($dry.Json['createdCount']), unchanged $($dry.Json['unchangedCount']), failed $($dry.Json['failedCount'])"
    }
    else { Write-Check FAIL "dry run -> $($dry.Status) $($dry.Raw.Content)" }
    if ($dry.Json -and $dry.Json['failedCount'] -gt 0) {
        foreach ($row in @($dry.Json['rows'] | Where-Object { $_['status'] -eq 'failed' })) { Write-Check WARN "row $($row['rowNumber']): $($row['message'])" }
    }
    $apply = Invoke-Import 'false'
    if ($apply.Status -eq 200 -and ($apply.Json['createdCount'] + $apply.Json['unchangedCount']) -eq 1) { Write-Check PASS "apply: created $($apply.Json['createdCount']), unchanged $($apply.Json['unchangedCount'])" }
    else { Write-Check FAIL "apply -> $($apply.Status) $($apply.Raw.Content)" }
    $again = Invoke-Import 'true'
    if ($again.Status -eq 200 -and $again.Json['unchangedCount'] -eq 1 -and $again.Json['createdCount'] -eq 0) { Write-Check PASS 're-import: unchanged 1, created 0 (idempotent)' }
    else { Write-Check FAIL "re-import -> $($again.Status) $($again.Raw.Content)" }
    $queue = Invoke-Api GET '/api/injects'
    $item = @($queue.Json['items'] | Where-Object { $_['title'] -eq '[live check] import' }) | Select-Object -First 1
    if ($item) { $created.InjectId = [string] $item['id']; $created.InjectVersion = $item['version']; Write-Check PASS "item on the run sheet ($($created.InjectId))" }
    else { Write-Check FAIL 'imported item not found on GET /api/injects' }

    # ── 4. Pins ──────────────────────────────────────────────────────────────────────────────────────────
    Write-Host "`n4. Exercise pin + pinned feed (04)" -ForegroundColor Cyan
    $feed = Invoke-Api GET '/api/feed'
    $post = @($feed.Json) | Where-Object { -not $_['pinnedForAll'] } | Select-Object -First 1
    if (-not $post) { Write-Check WARN 'feed is empty or every post is already pinned; pin check skipped' }
    else {
        $postId = [string] $post['id']
        $pin = Invoke-Api PUT "/api/staff/posts/$postId/pin"
        if ($pin.Status -eq 204) { $created.PinnedPostId = $postId; Write-Check PASS "pinned $postId for everyone" } else { Write-Check FAIL "pin -> $($pin.Status)" }
        $pinned = Invoke-Api GET '/api/feed/pinned'
        $hit = @($pinned.Json['items'] | Where-Object { $_['post']['id'] -eq $postId })
        if ($pinned.Status -eq 200 -and $hit.Count -eq 1 -and $hit[0]['reason'] -eq 'exercise' -and $hit[0]['post']['pinnedForAll']) { Write-Check PASS 'GET /api/feed/pinned lists it (reason exercise, pinnedForAll true)' }
        else { Write-Check FAIL "pinned feed -> $($pinned.Status), match $($hit.Count)" }
    }

    # ── 5. White noise ───────────────────────────────────────────────────────────────────────────────────
    Write-Host "`n5. White noise (05)" -ForegroundColor Cyan
    $noise = Invoke-Api GET '/api/staff/noise'
    if ($noise.Status -ne 200) { Write-Check FAIL "GET /api/staff/noise -> $($noise.Status)"; throw 'stop' }
    $created.NoiseLevelBefore = [string] $noise.Json['level']
    Write-Check PASS "state: level $($noise.Json['level']), pool $($noise.Json['poolSize']), posted $($noise.Json['postedCount']), running $($noise.Json['running'])"
    if ($IncludeNoisePublish -and [int] $noise.Json['poolSize'] -eq 0) {
        $pool = @{ mode = 'replace'; posts = @(1..3 | ForEach-Object { @{ persona = $handle; text = "[live check] background chatter test $_" } }) }
        $p = Invoke-Api PUT '/api/staff/noise/pool' -Body $pool
        if ($p.Status -eq 200 -and $p.Json['poolSize'] -eq 3) { $created.PoolLoaded = $true; Write-Check PASS 'loaded a 3-post test pool' } else { Write-Check FAIL "pool -> $($p.Status) $($p.Raw.Content)" }
    }
    $low = Invoke-Api PUT '/api/staff/noise' -Body @{ level = 'low' }
    if ($low.Status -eq 200 -and $low.Json['level'] -eq 'low' -and $low.Json['ratePerMinute'] -eq 2) {
        Write-Check PASS "set Low: rate 2/min, running $($low.Json['running'])"
        if (-not $low.Json['running']) { Write-Check WARN 'running is false: empty pool, frozen, clock not running, or lifecycle not staged/live' }
    }
    else { Write-Check FAIL "set Low -> $($low.Status) $($low.Raw.Content)" }
    if ($IncludeNoisePublish -and $low.Json -and $low.Json['running']) {
        $start = [int] $low.Json['postedCount']; $deadline = (Get-Date).AddSeconds(75); $published = $false
        while ((Get-Date) -lt $deadline) {
            Start-Sleep -Seconds 5
            $s = Invoke-Api GET '/api/staff/noise'
            if ([int] $s.Json['postedCount'] -gt $start) { $published = $true; break }
        }
        if ($published) { Write-Check PASS 'a noise post published within 75 s' } else { Write-Check FAIL 'no noise post within 75 s at Low' }
    }
}
catch { if ($_.ToString() -ne 'stop') { Write-Check FAIL "unexpected: $($_.Exception.Message)" } }
finally {
    Write-Host "`n6. Clean up" -ForegroundColor Cyan
    if ($created.NoiseLevelBefore) {
        $r = Invoke-Api PUT '/api/staff/noise' -Body @{ level = $created.NoiseLevelBefore }
        Write-Check ($(if ($r.Status -eq 200) { 'PASS' } else { 'WARN' })) "noise level restored to '$($created.NoiseLevelBefore)' -> $($r.Status)"
    }
    if ($created.PoolLoaded) {
        $r = Invoke-Api PUT '/api/staff/noise/pool' -Body @{ mode = 'replace'; posts = @() }
        Write-Check ($(if ($r.Status -eq 200) { 'PASS' } else { 'WARN' })) "test pool cleared -> $($r.Status)"
    }
    if ($created.PinnedPostId) {
        $r = Invoke-Api DELETE "/api/staff/posts/$($created.PinnedPostId)/pin"
        Write-Check ($(if ($r.Status -eq 204) { 'PASS' } else { 'WARN' })) "unpinned -> $($r.Status)"
    }
    if ($created.InjectId) {
        $r = Invoke-Api DELETE "/api/injects/$($created.InjectId)?version=$($created.InjectVersion)"
        Write-Check ($(if ($r.Status -in 200, 204) { 'PASS' } else { 'WARN' })) "imported test item deleted -> $($r.Status)"
    }
    $script:Token = $null
    Write-Host ("`nDone: {0} failed, {1} warnings." -f $script:Fails, $script:Warns) -ForegroundColor ($(if ($script:Fails) { 'Red' } elseif ($script:Warns) { 'Yellow' } else { 'Green' }))
}
exit ([int] [bool] $script:Fails)
